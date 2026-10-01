//! Normalize exact game dates; hydrate only matched broadcast rounds.
//! Never use an archive month, event name, or finishedAt as a playing date.
use super::*;

fn full_date(value: &str) -> Option<String> {
    let value = value.trim().replace('-', ".");
    if value.len() != 10 {
        return None;
    }
    let date = chrono::NaiveDate::parse_from_str(&value, "%Y.%m.%d").ok()?;
    (date.year() >= 1000).then(|| date.format("%Y.%m.%d").to_string())
}

pub(super) fn preferred_date(headers: &[(String, String)]) -> Option<String> {
    ["Date", "UTCDate"]
        .iter()
        .find_map(|key| header(headers, key).and_then(full_date))
        .or_else(|| {
            header(headers, "Date")
                .filter(|value| value.chars().any(|c| c.is_ascii_digit()))
                .map(str::to_string)
        })
}

fn set_date(pgn: &str, date: &str, source: &str) -> String {
    let mut lines = vec![format!("[Date \"{date}\"]")];
    let mut in_headers = true;
    for line in pgn.lines() {
        if in_headers && !line.trim().is_empty() && !line.trim().starts_with('[') {
            in_headers = false;
        }
        if in_headers
            && parse_headers(line)
                .iter()
                .any(|(key, _)| key.eq_ignore_ascii_case("Date"))
        {
            continue;
        }
        lines.push(line.to_string());
    }
    if source.starts_with("https://") {
        lines.insert(
            1,
            format!("[OutpostDateSource \"{}\"]", escape_pgn_header(source)),
        );
    }
    lines.join("\n") + "\n"
}

pub(super) fn with_header_date(pgn: &str) -> String {
    let headers = parse_headers(pgn);
    if header(&headers, "Date").and_then(full_date).is_some() {
        return pgn.to_string();
    }
    match header(&headers, "UTCDate").and_then(full_date) {
        Some(date) => set_date(pgn, &date, "UTCDate"),
        None => pgn.to_string(),
    }
}

fn round_api(pgn: &str) -> Option<String> {
    let headers = parse_headers(pgn);
    ["BroadcastURL", "GameURL", "Site"].iter().find_map(|key| {
        let url = reqwest::Url::parse(header(&headers, key)?).ok()?;
        if url.scheme() != "https"
            || url.host_str() != Some("lichess.org")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
        {
            return None;
        }
        let parts = url
            .path()
            .trim_end_matches('/')
            .split('/')
            .collect::<Vec<_>>();
        if !(parts.len() == 5 || parts.len() == 6)
            || parts[1] != "broadcast"
            || parts[4].len() != 8
            || !parts[4].bytes().all(|b| b.is_ascii_alphanumeric())
        {
            return None;
        }
        Some(format!("https://lichess.org/api{}", parts[..5].join("/")))
    })
}

fn round_date(value: &serde_json::Value, api: &str) -> Option<String> {
    let round = value.get("round")?;
    if round.get("id")?.as_str()? != api.rsplit('/').next()? {
        return None;
    }
    let timestamp = round
        .get("startedAt")
        .or_else(|| round.get("startsAt"))?
        .as_i64()?;
    let date = chrono::DateTime::<Utc>::from_timestamp_millis(timestamp)?;
    (2000..=2099)
        .contains(&date.year())
        .then(|| date.format("%Y.%m.%d").to_string())
}

pub(super) async fn recover_broadcast_dates(
    client: &Client,
    cache_dir: &Path,
    collection: &mut Collection,
    reports: &mut Vec<OtbImportSourceReport>,
    cancellation: &Arc<AtomicBool>,
) -> bool {
    let mut rounds = HashMap::<String, Vec<usize>>::new();
    for (i, game) in collection.games.iter().enumerate() {
        if full_date(&game.date).is_none() && !game.date.chars().any(|c| c.is_ascii_digit()) {
            if let Some(api) = round_api(&game.pgn) {
                rounds.entry(api).or_default().push(i);
            }
        }
    }
    if rounds.is_empty() {
        return false;
    }
    let mut report = OtbImportSourceReport::new("Broadcast game dates");
    let mut rounds = rounds.into_iter().collect::<Vec<_>>();
    rounds.sort_by(|a, b| a.0.cmp(&b.0));
    let mut lookups = stream::iter(rounds.into_iter().map(|(api, indices)| async move {
        // Reuse the existing discovery cache and shared cooldown/request lane.
        let cache = cache_dir.join(cache_file_name("lichess-fide-round", &api));
        let result = fetch_lichess_cached_within(client, &api, &cache, Some(PAGE_CACHE_MAX_AGE))
            .await
            .and_then(|(bytes, _)| {
                serde_json::from_slice::<serde_json::Value>(&bytes).map_err(|e| e.to_string())
            });
        (api, indices, result)
    }))
    .buffer_unordered(LICHESS_CONCURRENCY);
    let stopped = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let next = Box::pin(lookups.next());
            let stop = Box::pin(wait_for_cancellation(cancellation.clone()));
            let result = match future::select(next, stop).await {
                Either::Left((result, _)) => result,
                Either::Right(_) => return true,
            };
            let Some((api, indices, result)) = result else {
                return false;
            };
            match result.and_then(|value| {
                round_date(&value, &api).ok_or_else(|| "round has no usable start date".to_string())
            }) {
                Ok(date) => {
                    for index in indices {
                        let game = &mut collection.games[index];
                        game.pgn = set_date(&game.pgn, &date, &api);
                        game.date = date.clone();
                    }
                }
                Err(error) => report.errors.push(format!("{api}: {error}")),
            }
        }
    })
    .await;
    if stopped.is_err() {
        report
            .errors
            .push("Date recovery time limit reached; undated games were retained.".into());
    }
    reports.push(report);
    stopped.unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dates_fall_back_to_utc_without_using_archive_months() {
        let pgn = "[UTCDate \"2025.07.28\"]\n\n1. d4 *";
        assert_eq!(
            preferred_date(&parse_headers(pgn)).as_deref(),
            Some("2025.07.28")
        );
        let normalized = with_header_date(pgn);
        assert_eq!(
            header(&parse_headers(&normalized), "Date"),
            Some("2025.07.28")
        );
        assert!(normalized.ends_with("1. d4 *\n"));
        assert_eq!(full_date("2025.02.29"), None);
        assert_eq!(full_date("2024.02.29").as_deref(), Some("2024.02.29"));
        let dated = "[Date \"2025.07.30\"]\n[UTCDate \"2025.07.28\"]\n\n*";
        assert_eq!(with_header_date(dated), dated);
        assert_eq!(
            preferred_date(&parse_headers(
                "[OutpostSourceUrl \"lichess_db_broadcast_2025-08.pgn.zst\"]"
            )),
            None
        );
    }
    #[test]
    fn dates_pin_the_round_and_do_not_use_the_finished_timestamp() {
        let api = "https://lichess.org/api/broadcast/event/round-3/PIYocaUW";
        let pgn =
            "[GameURL \"https://lichess.org/broadcast/event/round-3/PIYocaUW/abcdefgh\"]\n\n*";
        assert_eq!(round_api(pgn).as_deref(), Some(api));
        assert_eq!(round_api(&pgn.replace("lichess.org", "evil.test")), None);
        let value = serde_json::json!({"round":{"id":"PIYocaUW","startsAt":1754381700000i64,"finishedAt":1754392958231i64}});
        assert_eq!(round_date(&value, api).as_deref(), Some("2025.08.05"));
        assert_eq!(
            round_date(&value, &api.replace("PIYocaUW", "abcdefgh")),
            None
        );
        assert_eq!(
            round_date(
                &serde_json::json!({"round":{"id":"PIYocaUW","finishedAt":1754392958231i64}}),
                api
            ),
            None
        );
    }

    #[tokio::test]
    async fn cached_round_recovery_retains_games_and_skips_known_dates() {
        let cache = tempfile::tempdir().unwrap();
        let api = "https://lichess.org/api/broadcast/event/round-3/PIYocaUW";
        let pgn = "[White \"Fixture, One\"]\n[Black \"Fixture, Two\"]\n[BroadcastURL \"https://lichess.org/broadcast/event/round-3/PIYocaUW\"]\n\n1. d4 Nf6 *";
        let mut collection = Collection::default();
        add_game(&mut collection, pgn.into(), "Fixture", "black");
        let count = collection.games.len();
        assert_eq!(count, 1);
        let value = serde_json::json!({"round":{"id":"PIYocaUW","startsAt":1754381700000i64}});
        std::fs::write(
            cache
                .path()
                .join(cache_file_name("lichess-fide-round", api)),
            value.to_string(),
        )
        .unwrap();
        let mut reports = vec![];
        let stop = Arc::new(AtomicBool::new(false));
        let client = Client::new();
        assert!(
            !recover_broadcast_dates(&client, cache.path(), &mut collection, &mut reports, &stop)
                .await
        );
        assert_eq!(collection.games.len(), count);
        assert_eq!(collection.games[0].date, "2025.08.05");
        assert!(collection.games[0].pgn.contains(
            "[OutpostDateSource \"https://lichess.org/api/broadcast/event/round-3/PIYocaUW\"]"
        ));
        assert!(collection.games[0].pgn.ends_with("1. d4 Nf6 *\n"));
        assert!(reports[0].errors.is_empty());
        reports.clear();
        assert!(
            !recover_broadcast_dates(&client, cache.path(), &mut collection, &mut reports, &stop)
                .await
        );
        assert!(reports.is_empty());
    }
}
