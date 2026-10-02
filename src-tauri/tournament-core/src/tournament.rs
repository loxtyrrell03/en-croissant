use std::{
    collections::{BTreeMap, HashSet},
    time::Duration,
};

use chrono::Utc;
use futures_util::{stream, StreamExt};
use reqwest::{redirect, Client, Url};
use scraper::{ElementRef, Html, Selector};
use serde::Serialize;

pub mod discovery;
mod media;
mod schedule;

const CHESS_RESULTS_ORIGIN: &str = "https://chess-results.com";
const TOURNAMENT_USER_AGENT: &str = "Outpost tournament prep/0.1";
const ROUND_FETCH_CONCURRENCY: usize = 4;
const TOURNAMENT_SEARCH_LIMIT: usize = 200;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentSearchResult {
    pub tournament_id: String,
    pub source_url: String,
    pub title: String,
    pub section: Option<String>,
    pub federation: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub last_update: Option<String>,
    pub location: Option<String>,
    pub time_control: Option<String>,
    pub player_count: Option<usize>,
    pub organizer: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentSection {
    pub tournament_id: String,
    pub source_url: String,
    pub name: String,
    pub is_current: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentPlayer {
    pub start_number: u32,
    pub name: String,
    pub fide_id: Option<String>,
    pub federation: Option<String>,
    pub title: Option<String>,
    pub rating: Option<u32>,
    pub rank: Option<u32>,
    pub points: f32,
    pub active: bool,
    /// Rounds where Chess-Results lists this player as not paired (including
    /// requested byes and withdrawals). Pairing forecasts use this instead of
    /// assuming every name on the starting list remains available forever.
    pub not_paired_rounds: Vec<u16>,
    /// Subset of `not_paired_rounds` explicitly labelled `bye` by
    /// Chess-Results. These count as half-point byes in Swiss history.
    pub half_point_bye_rounds: Vec<u16>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentPairing {
    pub round: u16,
    pub board: Option<u32>,
    pub white_start_number: Option<u32>,
    pub black_start_number: Option<u32>,
    pub white_points: Option<f32>,
    pub black_points: Option<f32>,
    pub result: Option<String>,
    pub decided: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentRoundStandings {
    pub round: u16,
    pub players: Vec<TournamentPlayer>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentSnapshot {
    pub tournament_id: String,
    pub source_url: String,
    pub title: String,
    /// Active Chess-Results tournament section, such as `U2400`, `U1900`,
    /// `Major`, or `Open`. Each section has its own tournament id and roster.
    pub section: Option<String>,
    /// Other sections published from the same Chess-Results event selector.
    /// Selecting one of these IDs changes both the roster and pairings.
    pub sections: Vec<TournamentSection>,
    /// Stable machine value: `swiss`, `round-robin`, `team`, or `other`.
    pub format: String,
    pub format_label: String,
    pub total_rounds: u16,
    pub completed_round: u16,
    pub published_round: u16,
    pub live_round: Option<u16>,
    /// The user's next game when pairings are published; otherwise the round
    /// for which the frontend should produce an estimate.
    pub next_round: Option<u16>,
    /// `registration`, `pairings-published`, `round-in-progress`,
    /// `between-rounds`, or `complete`.
    pub phase: String,
    pub date_range: Option<String>,
    pub round_one_start: Option<schedule::RoundOneStart>,
    pub time_control: Option<String>,
    pub source_updated_at: Option<String>,
    pub fetched_at: String,
    pub players: Vec<TournamentPlayer>,
    pub pairings: Vec<TournamentPairing>,
    /// Published ranking table after each completed round. Keeping the
    /// organizer's rank (rather than reconstructing tie-breaks locally) lets
    /// the tournament workspace show an accurate historical table.
    pub round_standings: Vec<TournamentRoundStandings>,
    /// Published rounds with failed fetches, empty tables or unresolved rows.
    pub incomplete_pairing_rounds: Vec<u16>,
    pub warnings: Vec<String>,
    pub metadata: discovery::EventMetadata,
}

#[derive(Clone, Debug, Default)]
struct TournamentDetails {
    title: String,
    section: Option<String>,
    sections: Vec<TournamentSection>,
    format_label: String,
    total_rounds: u16,
    date_range: Option<String>,
    time_control: Option<String>,
    source_updated_at: Option<String>,
    final_round: Option<u16>,
    pairing_rounds: Vec<u16>,
    ranking_rounds: Vec<u16>,
    players: Vec<TournamentPlayer>,
}

pub async fn search_tournaments(query: String) -> Result<Vec<TournamentSearchResult>, String> {
    let query = query.split_whitespace().collect::<Vec<_>>().join(" ");
    if query.chars().count() < 2 {
        return Err("Type at least two characters of the tournament name.".to_string());
    }
    if query.chars().count() > 100 {
        return Err("Keep the tournament search under 100 characters.".to_string());
    }

    let client = tournament_client()?;
    let response = client
        .get(format!("{CHESS_RESULTS_ORIGIN}/TurnierSuche.aspx?lan=1"))
        .send()
        .await
        .map_err(|error| format!("Chess-Results search could not be opened: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Chess-Results search could not be opened: {error}"))?;
    let action_url = response.url().clone();
    let search_html = response
        .text()
        .await
        .map_err(|error| format!("Chess-Results search could not be read: {error}"))?;
    let form = parse_tournament_search_form(&search_html)?;

    let mut results = submit_tournament_search(&client, &action_url, &form, &query).await?;
    if results.is_empty() {
        let seeds = fuzzy_search_seeds(&query);
        let fallback_results = stream::iter(seeds.into_iter().map(|seed| {
            let client = client.clone();
            let action_url = action_url.clone();
            let form = form.clone();
            async move { submit_tournament_search(&client, &action_url, &form, &seed).await }
        }))
        .buffer_unordered(3)
        .collect::<Vec<_>>()
        .await;
        for mut fallback in fallback_results.into_iter().flatten() {
            results.append(&mut fallback);
        }
    }

    let mut seen = HashSet::new();
    results.retain(|result| seen.insert(result.tournament_id.clone()));
    results.truncate(TOURNAMENT_SEARCH_LIMIT);
    Ok(results)
}

pub async fn fetch_tournament_snapshot(url: String) -> Result<TournamentSnapshot, String> {
    let tournament_id = tournament_id_from_url(&url)?;
    let canonical_url = canonical_tournament_url(&tournament_id);
    let client = tournament_client()?;
    let detail_url = tournament_page_url(&tournament_id, "turdet=YES&zeilen=99999");
    let detail_html = fetch_html(&client, &detail_url).await?;
    let mut details = parse_tournament_details(&detail_html);
    let mut warnings = Vec::new();

    // Some archived/print-style Chess-Results pages omit navigation and
    // tournament metadata from the starting list. Their final-ranking page
    // still exposes the completed round count and standings, so use it as a
    // compatibility fallback before declaring the event unreadable.
    if details.total_rounds == 0
        || details.format_label.is_empty()
        || details.pairing_rounds.is_empty()
    {
        let ranking_url = tournament_page_url(&tournament_id, "art=1&turdet=YES&zeilen=99999");
        match fetch_html(&client, &ranking_url).await {
            Ok(html) => merge_tournament_details(&mut details, parse_tournament_details(&html)),
            Err(error) => warnings.push(format!(
                "The archived final-ranking page could not be inspected: {error}"
            )),
        }
    }

    if details.total_rounds == 0 {
        details.total_rounds = details.final_round.unwrap_or(0);
    }
    if details.format_label.is_empty() && details.total_rounds > 0 && !details.players.is_empty() {
        details.format_label =
            if usize::from(details.total_rounds) >= details.players.len().saturating_sub(1) {
                "Round Robin".to_string()
            } else {
                "Swiss-System".to_string()
            };
    }
    if details.pairing_rounds.is_empty() {
        if let Some(final_round) = details.final_round {
            details.pairing_rounds.extend(1..=final_round);
        }
    }
    if details.ranking_rounds.is_empty() {
        if let Some(final_round) = details.final_round {
            details.ranking_rounds.extend(1..=final_round);
        }
    }

    if details.title.is_empty() {
        return Err(
            "That Chess-Results page did not contain a readable tournament. Check the link and try again."
                .to_string(),
        );
    }
    // A published event may not have entrants yet. Keep its readable metadata
    // and registration state so it can be followed before the first entry.

    let completed_round = details.ranking_rounds.iter().copied().max().unwrap_or(0);
    let published_round = details.pairing_rounds.iter().copied().max().unwrap_or(0);

    let standings_future = stream::iter((1..=completed_round).map(|round| {
        let client = client.clone();
        let tournament_id = tournament_id.clone();
        async move {
            let standings_url =
                tournament_page_url(&tournament_id, &format!("art=1&rd={round}&zeilen=99999"));
            (
                round,
                fetch_html(&client, &standings_url)
                    .await
                    .map(|html| parse_player_table(&html)),
            )
        }
    }))
    .buffer_unordered(ROUND_FETCH_CONCURRENCY)
    .collect::<Vec<_>>();

    let pairings_future = stream::iter((1..=published_round).map(|round| {
        let client = client.clone();
        let tournament_id = tournament_id.clone();
        let roster = &details.players;
        async move {
            let round_url =
                tournament_page_url(&tournament_id, &format!("art=2&rd={round}&zeilen=99999"));
            (
                round,
                fetch_html(&client, &round_url)
                    .await
                    .map(|html| parse_pairing_table_with_status(&html, round, roster)),
            )
        }
    }))
    .buffer_unordered(ROUND_FETCH_CONCURRENCY)
    .collect::<Vec<_>>();

    // The two histories are independent and share bounded per-history
    // concurrency, so load them together without serially doubling refresh
    // time for a long event.
    let start_future = async {
        if completed_round > 0 || published_round > 1 {
            return None;
        }
        let url = tournament_page_url(&tournament_id, "art=14");
        let html = tokio::time::timeout(Duration::from_secs(8), fetch_html(&client, &url))
            .await
            .ok()?
            .ok()?;
        schedule::parse_round_one_start(&html)
    };
    let (standings_results, round_results, round_one_start) =
        futures_util::future::join3(standings_future, pairings_future, start_future).await;

    let mut round_standings = Vec::new();
    for (round, result) in standings_results {
        match result {
            Ok(players) => round_standings.push(TournamentRoundStandings { round, players }),
            Err(error) => warnings.push(format!(
                "Standings after round {round} could not be refreshed: {error}"
            )),
        }
    }
    round_standings.sort_by_key(|standing| standing.round);
    let standings = round_standings
        .iter()
        .find(|standing| standing.round == completed_round)
        .map(|standing| standing.players.clone())
        .unwrap_or_default();

    let mut pairings = Vec::new();
    let mut incomplete_pairing_rounds = Vec::new();
    for (round, result) in round_results {
        match result {
            Ok((mut parsed, unmatched)) => {
                if parsed.is_empty() || unmatched > 0 {
                    incomplete_pairing_rounds.push(round);
                }
                if unmatched > 0 {
                    warnings.push(format!("Round {round}: {unmatched} pairing rows could not be matched to the roster; pairing history is incomplete."));
                }
                if parsed.is_empty() {
                    warnings.push(format!("No readable pairings found for round {round}; pairing history may be incomplete."));
                }
                pairings.append(&mut parsed);
            }
            Err(error) => {
                incomplete_pairing_rounds.push(round);
                warnings.push(format!(
                    "Pairings for round {round} could not be refreshed: {error}"
                ));
            }
        }
    }
    incomplete_pairing_rounds.sort_unstable();
    pairings.sort_by_key(|pairing| (pairing.round, pairing.board.unwrap_or(u32::MAX)));

    let not_paired_url = tournament_page_url(&tournament_id, "art=40&zeilen=99999");
    let not_paired_rounds = match fetch_html(&client, &not_paired_url).await {
        Ok(html) => parse_not_paired_rounds(&html),
        Err(error) => {
            warnings.push(format!(
                "Round-specific withdrawals and byes could not be refreshed: {error}"
            ));
            BTreeMap::new()
        }
    };

    let mut players = merge_player_lists(details.players, standings);
    for player in &mut players {
        player.not_paired_rounds = not_paired_rounds
            .get(&player.start_number)
            .map(|status| status.rounds.clone())
            .unwrap_or_default();
        player.half_point_bye_rounds = not_paired_rounds
            .get(&player.start_number)
            .map(|status| status.half_point_bye_rounds.clone())
            .unwrap_or_default();
    }
    let latest_pairings = pairings
        .iter()
        .filter(|pairing| pairing.round == published_round)
        .filter(|pairing| {
            pairing.white_start_number.is_some() && pairing.black_start_number.is_some()
        })
        .collect::<Vec<_>>();
    let latest_has_result = latest_pairings.iter().any(|pairing| pairing.decided);
    let latest_has_pending = latest_pairings.iter().any(|pairing| !pairing.decided);
    let total_rounds = details
        .total_rounds
        .max(published_round)
        .max(completed_round);

    let (phase, live_round, next_round) = tournament_phase(
        total_rounds,
        completed_round,
        published_round,
        latest_has_result,
        latest_has_pending,
    );
    if let Some(target_round) = next_round {
        for player in &mut players {
            player.active = !player.not_paired_rounds.contains(&target_round);
        }
    }

    let sections =
        finalize_tournament_sections(details.sections, &tournament_id, details.section.as_deref());

    Ok(TournamentSnapshot {
        tournament_id,
        source_url: canonical_url,
        title: details.title,
        section: details.section,
        sections,
        format: format_key(&details.format_label),
        format_label: if details.format_label.is_empty() {
            "Unknown format".to_string()
        } else {
            details.format_label
        },
        total_rounds,
        completed_round,
        published_round,
        live_round,
        next_round,
        phase,
        date_range: details.date_range,
        round_one_start,
        time_control: details.time_control,
        source_updated_at: details.source_updated_at,
        fetched_at: Utc::now().to_rfc3339(),
        players,
        pairings,
        round_standings,
        incomplete_pairing_rounds,
        warnings,
        metadata: discovery::parse_metadata(&detail_html),
    })
}

fn tournament_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(TOURNAMENT_USER_AGENT)
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(35))
        // Chess-Results fans canonical URLs out to s1/s2/... nodes. Follow
        // those redirects, but never let this trusted-source command become a
        // general redirecting HTTP proxy.
        .redirect(redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 6 {
                return attempt.error("too many Chess-Results redirects");
            }
            if is_chess_results_host(attempt.url().host_str().unwrap_or_default()) {
                attempt.follow()
            } else {
                attempt.error("Chess-Results redirected outside its own site")
            }
        }))
        .build()
        .map_err(|error| error.to_string())
}

async fn fetch_html(client: &Client, url: &str) -> Result<String, String> {
    client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .text()
        .await
        .map_err(|error| error.to_string())
}

fn parse_tournament_search_form(html: &str) -> Result<Vec<(String, String)>, String> {
    let document = Html::parse_document(html);
    let mut fields = Vec::new();

    for input in document.select(&selector("input[name]")) {
        let Some(name) = input.value().attr("name") else {
            continue;
        };
        if input.value().attr("type") == Some("hidden") {
            fields.push((
                name.to_string(),
                input.value().attr("value").unwrap_or_default().to_string(),
            ));
        }
    }
    for select in document.select(&selector("select[name]")) {
        let Some(name) = select.value().attr("name") else {
            continue;
        };
        let selected = select
            .select(&selector("option[selected]"))
            .next()
            .or_else(|| select.select(&selector("option")).next())
            .and_then(|option| option.value().attr("value"))
            .unwrap_or_default();
        fields.push((name.to_string(), selected.to_string()));
    }
    if !fields.iter().any(|(name, _)| name == "__VIEWSTATE") {
        return Err("Chess-Results returned an unfamiliar tournament search page.".to_string());
    }
    Ok(fields)
}

async fn submit_tournament_search(
    client: &Client,
    action_url: &Url,
    base_form: &[(String, String)],
    query: &str,
) -> Result<Vec<TournamentSearchResult>, String> {
    let mut form = base_form.to_vec();
    form.push(("ctl00$P1$txt_bez".to_string(), query.to_string()));
    form.push(("ctl00$P1$cb_suchen".to_string(), "Search".to_string()));
    let html = client
        .post(action_url.clone())
        .form(&form)
        .send()
        .await
        .map_err(|error| format!("Chess-Results tournament search failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Chess-Results tournament search failed: {error}"))?
        .text()
        .await
        .map_err(|error| format!("Chess-Results tournament search could not be read: {error}"))?;
    Ok(parse_tournament_search_results(&html))
}

fn parse_tournament_search_results(html: &str) -> Vec<TournamentSearchResult> {
    let document = Html::parse_document(html);
    let link_selector = selector("a[href]");
    let mut results = Vec::new();

    for row in document.select(&selector("table.CRs2 > tbody > tr, table.CRs2 > tr")) {
        let cells = direct_cells(row);
        if cells.len() < 3 {
            continue;
        }
        let Some((tournament_id, title)) = cells[1].select(&link_selector).find_map(|link| {
            let tournament_id = tournament_id_from_href(link.value().attr("href")?)?;
            let title = clean_text(link);
            (!title.is_empty()).then_some((tournament_id, title))
        }) else {
            continue;
        };
        results.push(TournamentSearchResult {
            source_url: canonical_tournament_url(&tournament_id),
            section: section_from_title(&title),
            tournament_id,
            title,
            federation: cells
                .get(2)
                .map(|cell| clean_text(*cell))
                .and_then(non_empty),
            last_update: cells
                .get(4)
                .map(|cell| clean_text(*cell))
                .and_then(non_empty),
            start_date: cells
                .get(5)
                .map(|cell| clean_text(*cell))
                .and_then(non_empty),
            end_date: cells
                .get(6)
                .map(|cell| clean_text(*cell))
                .and_then(non_empty),
            location: cells
                .get(12)
                .map(|cell| clean_text(*cell))
                .and_then(non_empty),
            time_control: cells
                .get(13)
                .map(|cell| clean_text(*cell))
                .and_then(non_empty),
            player_count: cells
                .get(17)
                .and_then(|cell| clean_text(*cell).parse::<usize>().ok())
                .filter(|count| *count > 0),
            organizer: cells
                .get(8)
                .map(|cell| clean_text(*cell))
                .and_then(non_empty),
        });
    }
    results
}

fn fuzzy_search_seeds(query: &str) -> Vec<String> {
    let words = query
        .split_whitespace()
        .map(|word| {
            word.chars()
                .filter(|character| character.is_alphanumeric())
                .collect::<String>()
        })
        .filter(|word| word.chars().count() >= 3)
        .collect::<Vec<_>>();
    let mut seeds = Vec::new();
    for word in &words {
        seeds.push(word.clone());
    }
    if words.len() == 1 {
        let characters = words[0].chars().collect::<Vec<_>>();
        if characters.len() >= 7 {
            for start in [0, (characters.len() - 4) / 2, characters.len() - 4] {
                seeds.push(characters[start..start + 4].iter().collect());
            }
        }
    }
    let mut seen = HashSet::new();
    seeds.retain(|seed| seen.insert(seed.to_lowercase()));
    seeds.truncate(4);
    seeds
}

fn is_chess_results_host(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == "chess-results.com" || host.ends_with(".chess-results.com")
}

fn tournament_id_from_url(input: &str) -> Result<String, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("Paste a Chess-Results tournament link.".to_string());
    }
    let with_scheme = if input.contains("://") {
        input.to_string()
    } else {
        format!("https://{input}")
    };
    let parsed = Url::parse(&with_scheme)
        .map_err(|_| "Enter a valid Chess-Results tournament link.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !is_chess_results_host(parsed.host_str().unwrap_or_default())
    {
        return Err("Only chess-results.com tournament links are supported.".to_string());
    }
    let file = parsed
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .unwrap_or_default();
    let lower = file.to_ascii_lowercase();
    if !lower.starts_with("tnr") || !lower.ends_with(".aspx") || file.len() <= 8 {
        return Err(
            "Use the tournament page link, for example chess-results.com/tnr123456.aspx."
                .to_string(),
        );
    }
    let digits = &file[3..file.len() - 5];
    if digits.is_empty() || digits.len() > 12 || !digits.chars().all(|char| char.is_ascii_digit()) {
        return Err("The Chess-Results tournament number is invalid.".to_string());
    }
    Ok(digits.to_string())
}

fn tournament_id_from_href(href: &str) -> Option<String> {
    let path = href.split(['?', '#']).next().unwrap_or_default();
    let file = path.rsplit('/').next().unwrap_or_default();
    let lower = file.to_ascii_lowercase();
    if !lower.starts_with("tnr") || !lower.ends_with(".aspx") || file.len() <= 8 {
        return None;
    }
    let digits = &file[3..file.len() - 5];
    (!digits.is_empty()
        && digits.len() <= 12
        && digits.chars().all(|character| character.is_ascii_digit()))
    .then(|| digits.to_string())
}

fn canonical_tournament_url(tournament_id: &str) -> String {
    format!("{CHESS_RESULTS_ORIGIN}/tnr{tournament_id}.aspx?lan=1")
}

fn tournament_page_url(tournament_id: &str, query: &str) -> String {
    format!("{CHESS_RESULTS_ORIGIN}/tnr{tournament_id}.aspx?lan=1&{query}")
}

fn selector(value: &str) -> Selector {
    Selector::parse(value).expect("static tournament selector")
}

fn clean_text(element: ElementRef<'_>) -> String {
    element
        .text()
        .flat_map(str::split_whitespace)
        .collect::<Vec<_>>()
        .join(" ")
}

fn direct_cells<'a>(row: ElementRef<'a>) -> Vec<ElementRef<'a>> {
    row.children()
        .filter_map(ElementRef::wrap)
        .filter(|element| matches!(element.value().name(), "td" | "th"))
        .collect()
}

fn normalized_header(value: &str) -> String {
    value
        .chars()
        .filter(|char| char.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn header_index(headers: &[String], values: &[&str]) -> Option<usize> {
    headers
        .iter()
        .position(|header| values.iter().any(|value| header == value))
}

fn parse_tournament_details(html: &str) -> TournamentDetails {
    let document = Html::parse_document(html);
    let mut details = TournamentDetails::default();

    for heading in document.select(&selector("h2")) {
        let text = clean_text(heading);
        let normalized = text.to_ascii_lowercase();
        details.final_round = details
            .final_round
            .or_else(|| final_round_from_heading(&text));
        if details.title.is_empty()
            && !text.is_empty()
            && !normalized.contains("tournament search")
            && !normalized.contains("player search")
            && !normalized.contains("starting rank")
            && !normalized.contains("final ranking")
        {
            details.title = text;
        }
    }

    for row in document.select(&selector("tr")) {
        let cells = direct_cells(row);
        if cells.len() != 2 {
            continue;
        }
        let label = clean_text(cells[0]);
        let value = clean_text(cells[1]);
        match normalized_header(&label).as_str() {
            "tournamentselection" if details.section.is_none() => {
                details.section = cells[1]
                    .select(&selector("i b"))
                    .map(clean_text)
                    .find(|value| !value.is_empty());
                details.sections = cells[1]
                    .select(&selector("a[href]"))
                    .filter_map(|link| {
                        let tournament_id = tournament_id_from_href(link.value().attr("href")?)?;
                        let name = clean_text(link);
                        (!name.is_empty()).then(|| TournamentSection {
                            source_url: canonical_tournament_url(&tournament_id),
                            tournament_id,
                            name,
                            is_current: false,
                        })
                    })
                    .collect();
            }
            "numberofrounds" if details.total_rounds == 0 => {
                details.total_rounds = value.parse().unwrap_or(0)
            }
            "tournamenttype" if details.format_label.is_empty() => details.format_label = value,
            "date" if details.date_range.is_none() => details.date_range = non_empty(value),
            label if label.starts_with("timecontrol") && details.time_control.is_none() => {
                details.time_control = non_empty(value)
            }
            _ => {}
        }
    }

    for paragraph in document.select(&selector("p")) {
        let text = clean_text(paragraph);
        if let Some((_, tail)) = text.split_once("Last update") {
            let timestamp = tail
                .trim_start_matches([' ', ':'])
                .split(", Creator")
                .next()
                .unwrap_or_default()
                .trim();
            details.source_updated_at = non_empty(timestamp.to_string());
            break;
        }
    }

    for link in document.select(&selector("a[href]")) {
        let Some(href) = link.value().attr("href") else {
            continue;
        };
        match query_u16(href, "art") {
            Some(2) => {
                if let Some(round) = query_u16(href, "rd") {
                    details.pairing_rounds.push(round);
                }
            }
            Some(1) => {
                if let Some(round) = query_u16(href, "rd") {
                    details.ranking_rounds.push(round);
                }
            }
            _ => {}
        }
    }
    details.pairing_rounds.sort_unstable();
    details.pairing_rounds.dedup();
    details.ranking_rounds.sort_unstable();
    details.ranking_rounds.dedup();
    details.section = details
        .section
        .or_else(|| section_from_title(&details.title));
    details.players = parse_player_document(&document);
    details
}

fn finalize_tournament_sections(
    mut sections: Vec<TournamentSection>,
    current_id: &str,
    current_name: Option<&str>,
) -> Vec<TournamentSection> {
    if !sections
        .iter()
        .any(|section| section.tournament_id == current_id)
    {
        if let Some(name) = current_name.filter(|name| !name.trim().is_empty()) {
            sections.push(TournamentSection {
                tournament_id: current_id.to_string(),
                source_url: canonical_tournament_url(current_id),
                name: name.to_string(),
                is_current: true,
            });
        }
    }
    for section in &mut sections {
        section.is_current = section.tournament_id == current_id;
    }
    sections.sort_by(|left, right| {
        natural_section_key(&left.name).cmp(&natural_section_key(&right.name))
    });
    sections.dedup_by(|left, right| left.tournament_id == right.tournament_id);
    sections
}

fn natural_section_key(value: &str) -> (u8, u32, String) {
    let normalized = value.trim().to_ascii_uppercase();
    if normalized == "OPEN" {
        return (0, u32::MAX, normalized);
    }
    let digits = normalized
        .strip_prefix('U')
        .or_else(|| normalized.strip_prefix("UNDER "))
        .unwrap_or_default()
        .trim_end_matches('S');
    if let Ok(rating) = digits.parse::<u32>() {
        return (1, u32::MAX - rating, normalized);
    }
    (2, 0, normalized)
}

fn section_from_title(title: &str) -> Option<String> {
    let tokens = title
        .split_whitespace()
        .map(|token| token.trim_matches(|char: char| !char.is_alphanumeric()))
        .collect::<Vec<_>>();
    for (index, token) in tokens.iter().enumerate() {
        let uppercase = token.to_ascii_uppercase();
        let rating_digits = uppercase
            .strip_prefix('U')
            .unwrap_or_default()
            .trim_end_matches('S');
        if rating_digits.len() >= 3 && rating_digits.chars().all(|char| char.is_ascii_digit()) {
            return Some(format!("U{rating_digits}"));
        }
        if uppercase == "UNDER" {
            if let Some(rating) = tokens.get(index + 1) {
                let digits = rating.trim_end_matches('s').trim_end_matches('S');
                if digits.len() >= 3 && digits.chars().all(|char| char.is_ascii_digit()) {
                    return Some(format!("U{digits}"));
                }
            }
        }
    }
    None
}

fn final_round_from_heading(value: &str) -> Option<u16> {
    if !value.to_ascii_lowercase().contains("final ranking") {
        return None;
    }
    let parts = value.split_whitespace().collect::<Vec<_>>();
    parts.iter().enumerate().find_map(|(index, part)| {
        (part
            .trim_matches(|char: char| !char.is_alphanumeric())
            .to_ascii_lowercase()
            .starts_with("round")
            && index > 0)
            .then(|| {
                parts[index - 1]
                    .trim_matches(|char: char| !char.is_ascii_digit())
                    .parse::<u16>()
                    .ok()
            })
            .flatten()
    })
}

fn merge_tournament_details(primary: &mut TournamentDetails, fallback: TournamentDetails) {
    if primary.title.is_empty() {
        primary.title = fallback.title;
    }
    if primary.format_label.is_empty() {
        primary.format_label = fallback.format_label;
    }
    primary.section = primary.section.take().or(fallback.section);
    primary.sections.extend(fallback.sections);
    let mut seen_sections = HashSet::new();
    primary
        .sections
        .retain(|section| seen_sections.insert(section.tournament_id.clone()));
    if primary.total_rounds == 0 {
        primary.total_rounds = fallback.total_rounds;
    }
    primary.date_range = primary.date_range.take().or(fallback.date_range);
    primary.time_control = primary.time_control.take().or(fallback.time_control);
    primary.source_updated_at = primary
        .source_updated_at
        .take()
        .or(fallback.source_updated_at);
    primary.final_round = primary.final_round.max(fallback.final_round);
    primary.pairing_rounds.extend(fallback.pairing_rounds);
    primary.pairing_rounds.sort_unstable();
    primary.pairing_rounds.dedup();
    primary.ranking_rounds.extend(fallback.ranking_rounds);
    primary.ranking_rounds.sort_unstable();
    primary.ranking_rounds.dedup();
    primary.players = merge_player_lists(std::mem::take(&mut primary.players), fallback.players);
}

fn parse_player_table(html: &str) -> Vec<TournamentPlayer> {
    parse_player_document(&Html::parse_document(html))
}

fn parse_player_document(document: &Html) -> Vec<TournamentPlayer> {
    let table_selector = selector("table.CRs1");
    let row_selector = selector("tr");
    let link_selector = selector("a[href]");
    let mut players = BTreeMap::<u32, TournamentPlayer>::new();

    for table in document.select(&table_selector) {
        let mut rows = table.select(&row_selector);
        let Some(header_row) = rows.next() else {
            continue;
        };
        let headers = direct_cells(header_row)
            .into_iter()
            .map(clean_text)
            .map(|value| normalized_header(&value))
            .collect::<Vec<_>>();
        let Some(name_index) = header_index(&headers, &["name", "playername"]) else {
            continue;
        };
        let start_number_index = header_index(&headers, &["sno", "no", "startno"]);
        let rank_index = header_index(&headers, &["rk", "rank"]);
        let points_index = header_index(&headers, &["pts", "points"]);
        let fide_index = header_index(&headers, &["fideid"]);
        let federation_index = header_index(&headers, &["fed", "federation"]);
        let rating_indexes = ["rtgi", "rtg", "rating", "rtgn"]
            .into_iter()
            .filter_map(|header| header_index(&headers, &[header]))
            .collect::<Vec<_>>();

        for row in rows {
            let cells = direct_cells(row);
            let Some(name_cell) = cells.get(name_index).copied() else {
                continue;
            };
            let player_link = name_cell.select(&link_selector).find(|link| {
                link.value()
                    .attr("href")
                    .is_some_and(|href| query_u16(href, "art") == Some(9))
            });
            let Some(start_number) = player_link
                .and_then(|link| link.value().attr("href"))
                .and_then(|href| query_u32(href, "snr"))
                .or_else(|| {
                    start_number_index
                        .and_then(|index| cells.get(index).copied())
                        .map(clean_text)
                        .and_then(|value| value.parse::<u32>().ok())
                })
            else {
                continue;
            };
            let name = player_link
                .map(clean_text)
                .unwrap_or_else(|| clean_text(name_cell));
            if name.is_empty() {
                continue;
            }

            let fide_id = fide_index
                .and_then(|index| cells.get(index).copied())
                .and_then(|cell| digits_only(&clean_text(cell)))
                .or_else(|| {
                    row.select(&link_selector).find_map(|link| {
                        let href = link.value().attr("href")?;
                        if !href
                            .to_ascii_lowercase()
                            .contains("ratings.fide.com/profile")
                        {
                            return None;
                        }
                        href.trim_end_matches('/')
                            .rsplit('/')
                            .next()
                            .and_then(digits_only)
                    })
                });
            let federation = federation_index
                .and_then(|index| cells.get(index).copied())
                .map(clean_text)
                .filter(|value| is_federation(value));
            let rating = rating_indexes.iter().find_map(|index| {
                cells
                    .get(*index)
                    .map(|cell| clean_text(*cell))
                    .and_then(|value| value.parse::<u32>().ok())
                    .filter(|value| (100..=4000).contains(value))
            });
            let title = cells
                .get(name_index.saturating_sub(1))
                .map(|cell| clean_text(*cell))
                .filter(|value| is_chess_title(value));
            let rank = rank_index
                .and_then(|index| cells.get(index).copied())
                .map(clean_text)
                .and_then(|value| value.parse::<u32>().ok());
            let points = points_index
                .and_then(|index| cells.get(index).copied())
                .map(clean_text)
                .and_then(|value| parse_points(&value))
                .unwrap_or(0.0);

            players.insert(
                start_number,
                TournamentPlayer {
                    start_number,
                    name,
                    fide_id,
                    federation,
                    title,
                    rating,
                    rank,
                    points,
                    active: true,
                    not_paired_rounds: Vec::new(),
                    half_point_bye_rounds: Vec::new(),
                },
            );
        }
    }
    players.into_values().collect()
}

fn merge_player_lists(
    starting: Vec<TournamentPlayer>,
    standings: Vec<TournamentPlayer>,
) -> Vec<TournamentPlayer> {
    let mut players = BTreeMap::<u32, TournamentPlayer>::new();
    for player in starting {
        players.insert(player.start_number, player);
    }
    for standing in standings {
        players
            .entry(standing.start_number)
            .and_modify(|player| {
                player.name = standing.name.clone();
                player.rank = standing.rank;
                player.points = standing.points;
                player.rating = standing.rating.or(player.rating);
                player.federation = standing.federation.clone().or(player.federation.clone());
                player.title = standing.title.clone().or(player.title.clone());
                player.fide_id = standing.fide_id.clone().or(player.fide_id.clone());
            })
            .or_insert(standing);
    }
    players.into_values().collect()
}

#[derive(Clone, Debug, Default)]
struct NotPairedStatus {
    rounds: Vec<u16>,
    half_point_bye_rounds: Vec<u16>,
}

fn parse_not_paired_rounds(html: &str) -> BTreeMap<u32, NotPairedStatus> {
    let document = Html::parse_document(html);
    let row_selector = selector("tr");
    let mut players = BTreeMap::<u32, NotPairedStatus>::new();

    for table in document.select(&selector("table.CRs1")) {
        let mut rows = table.select(&row_selector);
        let Some(header_row) = rows.next() else {
            continue;
        };
        let headers = direct_cells(header_row)
            .into_iter()
            .map(clean_text)
            .collect::<Vec<_>>();
        let start_number_index = headers
            .iter()
            .position(|header| matches!(normalized_header(header).as_str(), "sno" | "no"));
        let Some(start_number_index) = start_number_index else {
            continue;
        };
        let round_columns = headers
            .iter()
            .enumerate()
            .filter_map(|(index, header)| {
                let normalized = normalized_header(header);
                let round = normalized
                    .strip_suffix("rd")
                    .and_then(|value| value.parse::<u16>().ok())?;
                Some((index, round))
            })
            .collect::<Vec<_>>();
        if round_columns.is_empty() {
            continue;
        }

        for row in rows {
            let cells = direct_cells(row);
            let Some(start_number) = cells
                .get(start_number_index)
                .map(|cell| clean_text(*cell))
                .and_then(|value| value.parse::<u32>().ok())
            else {
                continue;
            };
            let mut status = NotPairedStatus::default();
            for (index, round) in &round_columns {
                let value = cells
                    .get(*index)
                    .map(|cell| clean_text(*cell))
                    .unwrap_or_default();
                if value.is_empty() || value == "-" {
                    continue;
                }
                status.rounds.push(*round);
                if value.eq_ignore_ascii_case("bye") {
                    status.half_point_bye_rounds.push(*round);
                }
            }
            if !status.rounds.is_empty() {
                players.insert(start_number, status);
            }
        }
    }

    players
}

#[cfg(test)]
fn parse_pairing_table(
    html: &str,
    round: u16,
    roster: &[TournamentPlayer],
) -> Vec<TournamentPairing> {
    parse_pairing_table_with_status(html, round, roster).0
}

fn parse_pairing_table_with_status(
    html: &str,
    round: u16,
    roster: &[TournamentPlayer],
) -> (Vec<TournamentPairing>, usize) {
    let document = Html::parse_document(html);
    let row_selector = selector("tr");
    let link_selector = selector("a[href]");
    let mut pairings = Vec::new();
    let mut unmatched = 0;

    // Name-only layouts are usable only when the roster identity is unique.
    let normalize_name = |name: &str| {
        name.split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
    };
    let mut names = BTreeMap::<String, Option<u32>>::new();
    let mut names_with_federation = BTreeMap::<(String, String), Option<u32>>::new();
    for player in roster {
        names
            .entry(normalize_name(&player.name))
            .and_modify(|value| *value = None)
            .or_insert(Some(player.start_number));
        if let Some(federation) = player
            .federation
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            names_with_federation
                .entry((
                    normalize_name(&player.name),
                    federation.trim().to_uppercase(),
                ))
                .and_modify(|value| *value = None)
                .or_insert(Some(player.start_number));
        }
    }
    let has_fixed_board_legend = normalize_name(&clean_text(document.root_element()))
        .contains("*) this player is assigned to a fixed board.");
    let pairing_name = |cell: ElementRef<'_>| {
        let name = normalize_name(&clean_text(cell));
        // Chess-Results decorates unlinked names on fixed boards. Interpret
        // only its documented suffix, after preserving literal roster names
        // (including ambiguous ones). The normal uniqueness/FED rules remain.
        if has_fixed_board_legend && !names.contains_key(&name) {
            name.strip_suffix(" *)").unwrap_or(&name).to_owned()
        } else {
            name
        }
    };
    for table in document.select(&selector("table.CRs1")) {
        let mut headers = Vec::<String>::new();
        let mut current_round = round;
        for row in table.select(&row_selector) {
            let cells = direct_cells(row);
            let texts = cells
                .iter()
                .map(|cell| clean_text(*cell))
                .collect::<Vec<_>>();
            if texts.len() == 1 && texts[0].starts_with("Round ") {
                if let Some(number) = texts[0]
                    .split_whitespace()
                    .nth(1)
                    .and_then(|value| value.parse::<u16>().ok())
                {
                    current_round = number;
                }
                continue;
            }
            let possible_headers = texts
                .iter()
                .map(|value| normalized_header(value))
                .collect::<Vec<_>>();
            if possible_headers.iter().any(|value| value == "white")
                && possible_headers.iter().any(|value| value == "result")
            {
                headers = possible_headers;
                continue;
            }
            // Round-robin pages contain every round in one table. Never label
            // all of them as the requested round or duplicate their history.
            if current_round != round {
                continue;
            }
            let Some(white_index) = header_index(&headers, &["white"]) else {
                continue;
            };
            let Some(black_index) = header_index(&headers, &["black"]) else {
                continue;
            };
            let Some(result_index) = header_index(&headers, &["result"]) else {
                continue;
            };
            let board_index = header_index(&headers, &["bo", "board"]).unwrap_or(0);
            let number_indexes = headers
                .iter()
                .enumerate()
                .filter_map(|(index, header)| {
                    matches!(header.as_str(), "no" | "sno").then_some(index)
                })
                .collect::<Vec<_>>();
            let white_number_index = number_indexes
                .iter()
                .copied()
                .filter(|index| *index < white_index)
                .next_back();
            let black_number_index = number_indexes
                .iter()
                .copied()
                .find(|index| *index > black_index);

            if cells.len() <= black_index.max(result_index).max(white_index) {
                if cells
                    .get(board_index)
                    .is_some_and(|cell| clean_text(*cell).parse::<u32>().is_ok())
                {
                    unmatched += 1;
                }
                continue;
            }
            let start_number = |name_index: usize, number_index: Option<usize>| {
                cells
                    .get(name_index)
                    .and_then(|cell| {
                        cell.select(&link_selector).find_map(|link| {
                            let href = link.value().attr("href")?;
                            (query_u16(href, "art") == Some(9))
                                .then(|| query_u32(href, "snr"))
                                .flatten()
                        })
                    })
                    .or_else(|| {
                        number_index
                            .and_then(|index| cells.get(index).copied())
                            .map(clean_text)
                            .and_then(|value| value.parse::<u32>().ok())
                    })
                    .or_else(|| {
                        cells
                            .get(name_index)
                            .and_then(|cell| names.get(&pairing_name(*cell)).copied().flatten())
                    })
                    .or_else(|| {
                        // An unlinked duplicate name can still be unique with
                        // the source's explicit FED column. Never guess when
                        // both name and federation remain ambiguous.
                        let end = if name_index == white_index {
                            result_index
                        } else {
                            headers.len()
                        };
                        let federation_index =
                            (name_index + 1..end).find(|index| headers[*index] == "fed")?;
                        let federation = clean_text(*cells.get(federation_index)?)
                            .trim()
                            .to_uppercase();
                        let name = pairing_name(*cells.get(name_index)?);
                        names_with_federation
                            .get(&(name, federation))
                            .copied()
                            .flatten()
                    })
            };
            let white_start_number = start_number(white_index, white_number_index);
            let black_start_number = start_number(black_index, black_number_index);
            let absent_name = |index: usize| {
                matches!(
                    clean_text(cells[index]).trim().to_lowercase().as_str(),
                    "" | "-" | "bye" | "not paired"
                )
            };
            // An unresolved identity is missing data, not an allocated bye.
            if (white_start_number.is_none() && !absent_name(white_index))
                || (black_start_number.is_none() && !absent_name(black_index))
            {
                unmatched += 1;
                continue;
            }
            if white_start_number.is_none() && black_start_number.is_none() {
                continue;
            }
            let result_text = clean_text(cells[result_index]);
            let result = non_empty(result_text.clone());
            let decided = result.as_deref().is_some_and(|value| is_decided_result(
                value, white_start_number.is_some(), black_start_number.is_some(),
            ));
            let white_points = cells
                .get(white_index + 1..result_index)
                .unwrap_or(&[])
                .iter()
                .rev()
                .find_map(|cell| parse_points(&clean_text(*cell)));
            let black_points = if result_index + 1 < black_index {
                cells[result_index + 1..black_index]
                    .iter()
                    .find_map(|cell| parse_points(&clean_text(*cell)))
            } else {
                None
            };
            let board = cells
                .get(board_index)
                .map(|cell| clean_text(*cell))
                .and_then(|value| value.parse::<u32>().ok());
            pairings.push(TournamentPairing {
                round,
                board,
                white_start_number,
                black_start_number,
                white_points,
                black_points,
                result,
                decided,
            });
        }
    }
    (pairings, unmatched)
}

fn tournament_phase(
    total_rounds: u16,
    completed_round: u16,
    published_round: u16,
    latest_has_result: bool,
    latest_has_pending: bool,
) -> (String, Option<u16>, Option<u16>) {
    if total_rounds > 0 && completed_round >= total_rounds {
        return ("complete".to_string(), None, None);
    }
    if published_round > completed_round {
        if latest_has_result {
            let target = published_round.saturating_add(1);
            if total_rounds > 0 && target > total_rounds && !latest_has_pending {
                return ("complete".to_string(), Some(published_round), None);
            }
            return (
                "round-in-progress".to_string(),
                Some(published_round),
                (total_rounds == 0 || target <= total_rounds).then_some(target),
            );
        }
        return (
            "pairings-published".to_string(),
            None,
            Some(published_round),
        );
    }
    let target = completed_round.saturating_add(1);
    if completed_round == 0 && published_round == 0 {
        return (
            "registration".to_string(),
            None,
            (total_rounds == 0 || target <= total_rounds).then_some(target),
        );
    }
    (
        "between-rounds".to_string(),
        None,
        (total_rounds == 0 || target <= total_rounds).then_some(target),
    )
}

fn format_key(label: &str) -> String {
    let lower = label.to_ascii_lowercase();
    if lower.contains("team") {
        "team".to_string()
    } else if lower.contains("swiss") {
        "swiss".to_string()
    } else if lower.contains("round robin") || lower.contains("round-robin") {
        "round-robin".to_string()
    } else {
        "other".to_string()
    }
}

fn non_empty(value: String) -> Option<String> {
    (!value.trim().is_empty()).then(|| value.trim().to_string())
}

fn digits_only(value: &str) -> Option<String> {
    let digits = value
        .chars()
        .filter(|char| char.is_ascii_digit())
        .collect::<String>();
    (!digits.is_empty()).then_some(digits)
}

fn is_federation(value: &str) -> bool {
    (2..=4).contains(&value.len()) && value.chars().all(|char| char.is_ascii_uppercase())
}

fn is_chess_title(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_uppercase().as_str(),
        "GM" | "IM" | "FM" | "CM" | "WGM" | "WIM" | "WFM" | "WCM"
    )
}

fn parse_points(value: &str) -> Option<f32> {
    let normalized = value
        .trim()
        .replace(',', ".")
        .replace('½', ".5")
        .replace('¼', ".25")
        .replace('¾', ".75");
    if normalized.is_empty() {
        return None;
    }
    normalized.parse::<f32>().ok()
}

fn is_decided_result(value: &str, white_present: bool, black_present: bool) -> bool {
    let compact = value.chars().filter(|char| !char.is_whitespace()).collect::<String>()
        .to_ascii_lowercase().replace(['–', '—'], "-").replace(',', ".");
    let half = |text: &str| matches!(text, "½" | "1/2" | "0.5" | ".5");
    if white_present && black_present {
        return matches!(compact.as_str(), "1-0" | "0-1" | "0-0" | "0f-0f" | "---" |
            "+-" | "+--" | "-+" | "--+" | "1f-0" | "1-0f" | "1f-0f" |
            "0f-1" | "0-1f" | "0f-1f") ||
            compact.split_once('-').is_some_and(|(white, black)| half(white) && half(black));
    }
    if !white_present && !black_present { return false; }
    let award = |text: &str| matches!(text, "0" | "0f" | "1" | "1f" | "+") || half(text);
    if award(&compact) { return true; }
    // A solo assignment proves only its occupied seat's explicit award. A
    // dash, missing score or unknown text must never be inferred to mean zero.
    compact.match_indices('-').any(|(index, _)| {
        let (white, rest) = compact.split_at(index);
        let black = &rest[1..];
        let seat = |text: &str| text.is_empty() || text == "-" || award(text);
        seat(white) && seat(black) && award(if white_present { white } else { black })
    })
}

fn query_u16(href: &str, key: &str) -> Option<u16> {
    query_value(href, key)?.parse().ok()
}

fn query_u32(href: &str, key: &str) -> Option<u32> {
    query_value(href, key)?.parse().ok()
}

fn query_value<'a>(href: &'a str, key: &str) -> Option<&'a str> {
    href.split(['?', '&'])
        .filter_map(|part| part.split_once('='))
        .find_map(|(candidate, value)| candidate.eq_ignore_ascii_case(key).then_some(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    const INDIVIDUAL_FIXTURE: &str = r#"
<html><body>
  <h2>Summer Open A</h2>
  <p>Last update 06.08.2026 14:00:08, Creator/Last Upload: Club</p>
  <table class="daten">
    <tr><td>Tournament selection</td><td><a href="tnr41.aspx">U2400</a>, <i><b>U1900</b></i>, <a href="tnr43.aspx">U1600</a></td></tr>
    <tr><td>Number of rounds</td><td>7</td></tr>
    <tr><td>Tournament type</td><td>Swiss-System</td></tr>
    <tr><td>Date</td><td>2026/08/03 to 2026/08/09</td></tr>
    <tr><td>Time control (Standard)</td><td>90 min + 30 sec</td></tr>
  </table>
  <a href="tnr42.aspx?lan=1&amp;art=2&amp;rd=1">Rd.1</a>
  <a href="tnr42.aspx?lan=1&amp;art=2&amp;rd=2">Rd.2</a>
  <a href="tnr42.aspx?lan=1&amp;art=1&amp;rd=1">Ranking Rd.1</a>
  <table class="CRs1">
    <tr><th>No.</th><th></th><th></th><th>Name</th><th>FideID</th><th>FED</th><th>RtgI</th><th>RtgN</th></tr>
    <tr><td>1</td><td></td><td>IM</td><td><a href="tnr42.aspx?art=9&amp;snr=1">Able, Alice</a></td><td><a href="https://ratings.fide.com/profile/123">123</a></td><td>ENG</td><td>2345</td><td>0</td></tr>
    <tr><td>2</td><td></td><td></td><td><a href="tnr42.aspx?art=9&amp;snr=2">Baker, Bob</a></td><td>-</td><td>WLS</td><td>2190</td><td>0</td></tr>
    <tr><td>3</td><td></td><td>FM</td><td>Clark, Cam</td><td><a href="https://ratings.fide.com/profile/789">789</a></td><td>SCO</td><td>2110</td><td>0</td></tr>
  </table>
</body></html>"#;

    const PAIRING_FIXTURE: &str = r#"
<table class="CRs1">
  <tr><th>Bo.</th><th>No.</th><th></th><th></th><th>White</th><th>Rtg</th><th>Pts.</th><th>Result</th><th>Pts.</th><th></th><th>Black</th><th>Rtg</th><th></th><th>No.</th></tr>
  <tr><td>1</td><td>1</td><td></td><td>IM</td><td><a href="tnr42.aspx?art=9&amp;snr=1">Able, Alice</a></td><td>2345</td><td>1½</td><td>½ - ½</td><td>1,5</td><td></td><td><a href="tnr42.aspx?art=9&amp;snr=2">Baker, Bob</a></td><td>2190</td><td></td><td>2</td></tr>
  <tr><td>2</td><td>3</td><td></td><td></td><td><a href="tnr42.aspx?art=9&amp;snr=3">Clark, Cam</a></td><td>2100</td><td>1</td><td></td><td>1</td><td></td><td><a href="tnr42.aspx?art=9&amp;snr=4">Dunn, Dee</a></td><td>2080</td><td></td><td>4</td></tr>
  <tr><td>3</td><td>5</td><td></td><td></td><td>Evans, Eve</td><td>2050</td><td>1</td><td>1 - 0</td><td>1</td><td></td><td>Fox, Finn</td><td>2010</td><td></td><td>6</td></tr>
</table>"#;

    const NOT_PAIRED_FIXTURE: &str = r#"
<table class="CRs1">
  <tr><th>SNo</th><th></th><th>Name</th><th>Rtg</th><th>FED</th><td>1.Rd</td><td>2.Rd</td><td>3.Rd</td></tr>
  <tr><td>7</td><td></td><td>Seven, Sam</td><td>1900</td><td>ENG</td><td></td><td>*</td><td>bye</td></tr>
  <tr><td>9</td><td></td><td>Nine, Nina</td><td>1800</td><td>ENG</td><td>*</td><td></td><td></td></tr>
</table>"#;

    const SEARCH_FIXTURE: &str = r#"
<table class="CRs2">
  <tr><td>No.</td><td>Tournament</td><td>FED</td><td></td><td>Last update</td><td>from</td><td>to</td></tr>
  <tr><td>1</td><td><a href="https://chess-results.com/tnr901.aspx?lan=1">Southall Congress 260718 U1900</a></td><td>ENG</td><td></td><td>2 Days</td><td>2026/07/18</td><td>2026/07/19</td></tr>
</table>"#;

    #[test]
    fn matches_fixed_board_name_suffix_only_with_the_published_legend() {
        let roster = parse_player_table(INDIVIDUAL_FIXTURE);
        let page = |white: &str, black: &str, legend: &str| {
            format!(
                r#"<table class="CRs1"><tr><th>Bo.</th><th>White</th><th>Result</th><th>Black</th></tr><tr><td>5</td><td>{white}</td><td>1-0</td><td>{black}</td></tr></table><p>{legend}</p>"#
            )
        };
        let legend = "*) This player is assigned to a fixed board.";
        for (white, black) in [
            ("Able, Alice *)", "Baker, Bob"),
            ("Able, Alice", "Baker, Bob *)"),
            ("  Able,   Alice&nbsp;*) ", "Baker, Bob *)"),
        ] {
            let (rows, unmatched) =
                parse_pairing_table_with_status(&page(white, black, legend), 2, &roster);
            assert_eq!(unmatched, 0);
            assert_eq!(rows.len(), 1);
            assert_eq!(
                (rows[0].white_start_number, rows[0].black_start_number),
                (Some(1), Some(2))
            );
            assert_eq!(rows[0].board, Some(5));
            assert_eq!(rows[0].result.as_deref(), Some("1-0"));
            assert_eq!(
                parse_pairing_table_with_status(&page(white, black, ""), 2, &roster).1,
                1
            );
        }
        for suffix in [" **)", " *", " †", " (F)", "*)"] {
            let (rows, unmatched) = parse_pairing_table_with_status(
                &page(&format!("Able, Alice{suffix}"), "Baker, Bob", legend),
                2,
                &roster,
            );
            assert!(rows.is_empty());
            assert_eq!(unmatched, 1);
        }
    }

    #[test]
    fn fixed_board_suffix_preserves_literal_names_and_duplicate_ambiguity() {
        let mut roster = parse_player_table(INDIVIDUAL_FIXTURE);
        let html = r#"<table class="CRs1"><tr><th>Bo.</th><th>White</th><th>Result</th><th>Black</th></tr><tr><td>1</td><td>Able, Alice *)</td><td>0-1</td><td>Baker, Bob</td></tr></table><p>*) This player is assigned to a fixed board.</p>"#;
        roster[2].name = "Able, Alice *)".into();
        assert_eq!(
            parse_pairing_table(html, 1, &roster)[0].white_start_number,
            Some(3)
        );
        roster.push(roster[2].clone());
        assert_eq!(parse_pairing_table_with_status(html, 1, &roster).1, 1);
        roster.pop();
        roster[2].name = "Able, Alice".into();
        assert_eq!(parse_pairing_table_with_status(html, 1, &roster).1, 1);
        let linked = html.replace(
            "<td>Able, Alice *)</td>",
            "<td><a href='tnr42.aspx?art=9&amp;snr=1'>Able, Alice *)</a></td>",
        );
        assert_eq!(
            parse_pairing_table(&linked, 1, &roster)[0].white_start_number,
            Some(1)
        );
    }

    #[test]
    fn fixed_board_suffix_retains_unique_explicit_federation_matching() {
        let mut roster = parse_player_table(INDIVIDUAL_FIXTURE);
        roster.truncate(2);
        for player in &mut roster {
            player.name = "Same Name".into();
        }
        roster[0].federation = Some("ENG".into());
        roster[1].federation = Some("SCO".into());
        let html = r#"<table class="CRs1"><tr><th>Bo.</th><th>White</th><th>FED</th><th>Result</th><th>Black</th><th>FED</th></tr><tr><td>1</td><td>Same Name *)</td><td>ENG</td><td>1-0</td><td>Same Name *)</td><td>SCO</td></tr></table><p>*) This player is assigned to a fixed board.</p>"#;
        let rows = parse_pairing_table(html, 1, &roster);
        assert_eq!(rows.len(), 1);
        assert_eq!(
            (rows[0].white_start_number, rows[0].black_start_number),
            (Some(1), Some(2))
        );
        assert_eq!(
            parse_pairing_table_with_status(
                &html.replace("<td>ENG</td>", "<td>USA</td>"),
                1,
                &roster
            )
            .1,
            1
        );
        roster.push(roster[0].clone());
        assert_eq!(parse_pairing_table_with_status(html, 1, &roster).1, 1);
    }

    #[test]
    fn reports_partial_pairing_tables_without_turning_unknown_names_into_byes() {
        let roster = parse_player_table(INDIVIDUAL_FIXTURE);
        let html = format!(
            r#"<table class="CRs1"><tr><th>Bo.</th><th>White</th><th>Result</th><th>Black</th></tr><tr><td>1</td><td>{}</td><td>1-0</td><td>{}</td></tr><tr><td>2</td><td>Unresolved player</td><td>0-1</td><td>{}</td></tr></table>"#,
            roster[0].name, roster[1].name, roster[2].name
        );
        let (rows, unmatched) = parse_pairing_table_with_status(&html, 1, &roster);
        assert_eq!(rows.len(), 1);
        assert_eq!(unmatched, 1);
        assert!(rows[0].white_start_number.is_some() && rows[0].black_start_number.is_some());
    }

    #[test]
    fn resolves_unlinked_duplicate_names_only_with_unique_federation_evidence() {
        let mut roster = parse_player_table(INDIVIDUAL_FIXTURE);
        roster.truncate(2);
        roster[0].name = "Same Name".into();
        roster[0].federation = Some("ENG".into());
        roster[1].name = "Same Name".into();
        roster[1].federation = Some("SCO".into());
        let html = r#"<table class="CRs1"><tr><th>Bo.</th><th>White</th><th>FED</th><th>Result</th><th>Black</th><th>FED</th></tr><tr><td>1</td><td>Same Name</td><td>ENG</td><td>1-0</td><td>Same Name</td><td>SCO</td></tr></table>"#;
        let rows = parse_pairing_table(html, 1, &roster);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].white_start_number, Some(roster[0].start_number));
        assert_eq!(rows[0].black_start_number, Some(roster[1].start_number));
        assert!(
            parse_pairing_table(&html.replace("<td>ENG</td>", "<td></td>"), 1, &roster).is_empty()
        );
        assert!(
            parse_pairing_table(&html.replace("<td>ENG</td>", "<td>USA</td>"), 1, &roster)
                .is_empty()
        );
        roster.push(roster[0].clone());
        assert!(parse_pairing_table(html, 1, &roster).is_empty());
    }

    #[test]
    fn handles_all_round_tables_and_unique_unlinked_names() {
        let roster = parse_player_table(INDIVIDUAL_FIXTURE);
        let html = r#"<table class="CRs1">
          <tr><td colspan="4">Round 1</td></tr>
          <tr><th>Bo.</th><th>White</th><th>Result</th><th>Black</th></tr>
          <tr><td>1</td><td>Able, Alice</td><td>1 - 0</td><td>Baker, Bob</td></tr>
          <tr><td colspan="4">Round 2</td></tr>
          <tr><th>Bo.</th><th>White</th><th>Result</th><th>Black</th></tr>
          <tr><td>1</td><td>Clark, Cam</td><td>- - -</td><td>Able, Alice</td></tr>
          <tr><td>-</td><td>Baker, Bob</td><td>1 - 0</td><td>bye</td></tr>
        </table>"#;
        let first = parse_pairing_table(html, 1, &roster);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].white_start_number, Some(1));
        let second = parse_pairing_table(html, 2, &roster);
        assert_eq!(second.len(), 2);
        assert!(second
            .iter()
            .all(|pairing| pairing.round == 2 && pairing.decided));
        assert_eq!(second[0].white_start_number, Some(3));
        assert_eq!(second[1].black_start_number, None);
        assert_eq!(second[1].board, None);
        assert!(parse_pairing_table(html, 3, &roster).is_empty());
        let mut ambiguous = roster.clone();
        ambiguous.push(roster[0].clone());
        // Missing/ambiguous names must not become fictitious byes.
        assert!(parse_pairing_table(html, 1, &ambiguous).is_empty());
        assert!(parse_pairing_table(html, 1, &[]).is_empty());
        assert!(is_decided_result("0 - 0", true, true));
        assert!(!is_decided_result(" - ", true, true));
    }

    #[test]
    fn accepts_only_chess_results_tournament_links() {
        assert_eq!(
            tournament_id_from_url("https://s1.chess-results.com/tnr1342553.aspx?lan=1"),
            Ok("1342553".to_string())
        );
        assert_eq!(
            tournament_id_from_url("chess-results.com/tnr42.aspx"),
            Ok("42".to_string())
        );
        assert!(tournament_id_from_url("https://example.com/tnr42.aspx").is_err());
        assert!(tournament_id_from_url("https://chess-results.com/SpielerSuche.aspx").is_err());
    }

    #[test]
    fn parses_details_roster_and_round_navigation() {
        let details = parse_tournament_details(INDIVIDUAL_FIXTURE);
        assert_eq!(details.title, "Summer Open A");
        assert_eq!(details.section.as_deref(), Some("U1900"));
        let sections = finalize_tournament_sections(
            details.sections.clone(),
            "42",
            details.section.as_deref(),
        );
        assert_eq!(sections.len(), 3);
        assert!(sections
            .iter()
            .any(|section| section.tournament_id == "42" && section.is_current));
        assert_eq!(sections[0].name, "U2400");
        assert_eq!(details.format_label, "Swiss-System");
        assert_eq!(details.total_rounds, 7);
        assert_eq!(details.pairing_rounds, vec![1, 2]);
        assert_eq!(details.ranking_rounds, vec![1]);
        assert_eq!(details.players.len(), 3);
        assert_eq!(details.players[0].name, "Able, Alice");
        assert_eq!(details.players[0].fide_id.as_deref(), Some("123"));
        assert_eq!(details.players[0].rating, Some(2345));
        assert_eq!(details.players[0].title.as_deref(), Some("IM"));
        assert_eq!(details.players[2].start_number, 3);
        assert_eq!(details.players[2].name, "Clark, Cam");
        assert_eq!(details.players[2].fide_id.as_deref(), Some("789"));
    }

    #[test]
    fn recognizes_only_complete_seat_specific_results() {
        for result in ["1-0", "0 - 1", "½-½", "1/2-1/2", "0.5-0.5", "0,5-0,5", "1–0",
            "1F-0F", "0F-1F", "+ - -", "- - +", "+-", "-+", "0-0", "0F-0F", "---"] {
            assert!(is_decided_result(result, true, true), "{result}");
        }
        for result in ["", " ", "-", "--", "*", "...", "…", "adjourned", "pending", "0", "1", "½",
            "1-unknown", "unknown-1", "garbage.5", "½-0", "1-0 trailing", "2-0", "1w-0l", "0l-1w"] {
            assert!(!is_decided_result(result, true, true), "{result}");
        }
        for result in ["0", "1", "½", "1/2", "0.5", "0,5", "1F", "0F"] {
            assert!(is_decided_result(result, true, false), "{result}");
            assert!(is_decided_result(result, false, true), "{result}");
        }
        assert!(is_decided_result("0-½", false, true));
        assert!(is_decided_result("½-0", true, false));
        assert!(!is_decided_result("+--", false, true));
        assert!(!is_decided_result("--+", true, false));
        for result in ["", "-", "--", "---", "*", "adjourned", "unknown-1"] {
            assert!(!is_decided_result(result, true, false), "{result}");
            assert!(!is_decided_result(result, false, true), "{result}");
        }
        assert!(!is_decided_result("1", false, false));
    }

    #[test]
    fn unfinished_public_text_cannot_finish_the_final_round() {
        for text in ["*", "...", "adjourned", "1-unknown", "garbage.5"] {
            let html = PAIRING_FIXTURE.replace("½ - ½", text).replace("1 - 0", text);
            let pairings = parse_pairing_table(&html, 7, &[]);
            assert_eq!(pairings.len(), 3);
            assert!(pairings.iter().all(|pairing| !pairing.decided), "{text}");
            assert_eq!(tournament_phase(7, 6, 7, false, true), ("pairings-published".to_string(), None, Some(7)));
            // One real result plus unreadable/pending games is still a live final round.
            assert_eq!(tournament_phase(7, 6, 7, true, true), ("round-in-progress".to_string(), Some(7), None));
        }
        assert_eq!(tournament_phase(7, 7, 7, true, true), ("complete".to_string(), None, None));
        assert_eq!(tournament_phase(7, 6, 7, true, false), ("complete".to_string(), Some(7), None));
    }

    #[test]
    fn parses_decided_and_pending_pairings() {
        let pairings = parse_pairing_table(PAIRING_FIXTURE, 2, &[]);
        assert_eq!(pairings.len(), 3);
        assert_eq!(pairings[0].board, Some(1));
        assert_eq!(pairings[0].white_start_number, Some(1));
        assert_eq!(pairings[0].black_start_number, Some(2));
        assert_eq!(pairings[0].white_points, Some(1.5));
        assert_eq!(pairings[0].black_points, Some(1.5));
        assert!(pairings[0].decided);
        assert!(!pairings[1].decided);
        assert_eq!(pairings[2].white_start_number, Some(5));
        assert_eq!(pairings[2].black_start_number, Some(6));
    }

    #[test]
    fn parses_round_specific_withdrawals_and_byes() {
        let rounds = parse_not_paired_rounds(NOT_PAIRED_FIXTURE);
        assert_eq!(
            rounds.get(&7).map(|status| &status.rounds),
            Some(&vec![2, 3])
        );
        assert_eq!(
            rounds.get(&7).map(|status| &status.half_point_bye_rounds),
            Some(&vec![3])
        );
        assert_eq!(rounds.get(&9).map(|status| &status.rounds), Some(&vec![1]));
    }

    #[test]
    fn describes_published_and_live_rounds_without_overclaiming() {
        assert_eq!(
            tournament_phase(7, 1, 2, false, true),
            ("pairings-published".to_string(), None, Some(2))
        );
        assert_eq!(
            tournament_phase(7, 1, 2, true, true),
            ("round-in-progress".to_string(), Some(2), Some(3))
        );
        assert_eq!(
            tournament_phase(7, 2, 2, true, false),
            ("between-rounds".to_string(), None, Some(3))
        );
    }

    #[test]
    fn parses_chess_results_point_notation() {
        assert_eq!(parse_points("4,5"), Some(4.5));
        assert_eq!(parse_points("3½"), Some(3.5));
        assert_eq!(parse_points(" 2 "), Some(2.0));
        assert_eq!(
            final_round_from_heading("Final Ranking after 11 Rounds"),
            Some(11)
        );
        assert_eq!(
            section_from_title("Southall Congress U2400s"),
            Some("U2400".to_string())
        );
        assert_eq!(
            section_from_title("East Devon Major (Under 1900)"),
            Some("U1900".to_string())
        );
        assert_eq!(section_from_title("Summer Open"), None);
    }

    #[test]
    fn parses_search_rows_and_builds_fuzzy_fallback_seeds() {
        let results = parse_tournament_search_results(SEARCH_FIXTURE);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].tournament_id, "901");
        assert_eq!(results[0].section.as_deref(), Some("U1900"));
        assert_eq!(results[0].federation.as_deref(), Some("ENG"));
        assert_eq!(results[0].start_date.as_deref(), Some("2026/07/18"));

        let seeds = fuzzy_search_seeds("Suthall");
        assert!(seeds.iter().any(|seed| seed == "hall"));
    }
}
