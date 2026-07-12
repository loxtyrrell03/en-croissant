use std::{
    collections::{HashMap, HashSet},
    fs::{create_dir_all, File},
    io::{BufRead, BufReader, Cursor, Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

use chrono::{Datelike, Utc};
use pgn_reader::{BufferedReader as PgnReader, SanPlus, Skip, Visitor};
use reqwest::header::{COOKIE, SET_COOKIE};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri_specta::Event;

const LICHESS_BROADCAST_LIST: &str = "https://database.lichess.org/broadcast/list.txt";
const TWIC_ARCHIVE: &str = "https://theweekinchess.com/twic";
const CHESSBASE_SEARCH: &str = "https://en.chessbase.com/search";
const CHESSBASE_ORIGIN: &str = "https://en.chessbase.com";
const CHESS_RESULTS_PLAYER_SEARCH: &str = "https://s1.chess-results.com/partiesuche.aspx?lan=1";
const FOUR_NCL_PGN_INDEX: &str = "https://www.4ncl.co.uk/pgn-replay.htm";
const FOUR_NCL_ORIGIN: &str = "https://www.4ncl.co.uk";
const USER_AGENT: &str = "Outpost OTB importer/0.1";

#[derive(Clone, Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OtbImportRequest {
    pub job_id: String,
    pub player_name: String,
    pub fide_id: Option<String>,
    pub from_year: u16,
    pub include_lichess_broadcasts: bool,
    pub include_chess_results: bool,
    pub include_chessbase_news: bool,
    pub include_official_pgn_indexes: bool,
    pub include_twic: bool,
    pub local_pgn_paths: Vec<PathBuf>,
    pub cache_dir: PathBuf,
    pub output_path: PathBuf,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OtbImportSourceReport {
    pub source: String,
    pub archives_checked: u32,
    pub cached_archives: u32,
    pub matched_games: u32,
    pub unique_games_added: u32,
    pub errors: Vec<String>,
}

impl OtbImportSourceReport {
    fn new(source: impl Into<String>) -> Self {
        Self {
            source: source.into(),
            archives_checked: 0,
            cached_archives: 0,
            matched_games: 0,
            unique_games_added: 0,
            errors: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OtbImportNewestGame {
    pub date: String,
    pub event: String,
    pub white: String,
    pub black: String,
    pub result: String,
    pub source: String,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OtbImportReport {
    pub player_name: String,
    pub fide_id: Option<String>,
    pub output_path: String,
    pub games_found: u32,
    pub duplicates_removed: u32,
    pub suspected_online_games_excluded: u32,
    pub identity_mismatches_excluded: u32,
    pub newest_game: Option<OtbImportNewestGame>,
    pub sources: Vec<OtbImportSourceReport>,
}

#[derive(Clone, Debug, Serialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct OtbImportProgress {
    pub job_id: String,
    pub source: String,
    pub phase: String,
    pub current: u32,
    pub total: u32,
    pub games_found: u32,
    pub message: String,
}

#[derive(Clone, Debug)]
struct CollectedGame {
    pgn: String,
    date: String,
    event: String,
    white: String,
    black: String,
    result: String,
    source: String,
}

#[derive(Default)]
struct Collection {
    games: Vec<CollectedGame>,
    broad_fingerprints: HashMap<String, Vec<usize>>,
    move_fingerprints: HashMap<String, Vec<usize>>,
    duplicates_removed: u32,
    suspected_online_games_excluded: u32,
    identity_mismatches_excluded: u32,
}

#[derive(Clone, Debug)]
struct PlayerIdentity {
    canonical_name: String,
    fide_id: Option<String>,
    core_name_tokens: HashSet<String>,
}

impl PlayerIdentity {
    fn new(name: &str, fide_id: Option<&str>) -> Result<Self, String> {
        let canonical_name = name.trim().to_string();
        if canonical_name.len() < 3 {
            return Err("Enter the opponent's full name.".to_string());
        }

        let fide_id = fide_id
            .map(|value| {
                value
                    .chars()
                    .filter(|char| char.is_ascii_digit())
                    .collect::<String>()
            })
            .filter(|value| !value.is_empty());
        let core_name_tokens = core_name_tokens(&canonical_name);
        if core_name_tokens.len() < 2 {
            return Err("Enter at least a first name and surname.".to_string());
        }

        Ok(Self {
            canonical_name,
            fide_id,
            core_name_tokens,
        })
    }

    fn name_matches(&self, candidate: &str) -> bool {
        let candidate_tokens = core_name_tokens(candidate);
        candidate_tokens.len() >= 2 && candidate_tokens == self.core_name_tokens
    }
}

#[derive(Default)]
struct PgnStreamState {
    pending_line: Option<String>,
    first_line: bool,
}

impl PgnStreamState {
    fn new() -> Self {
        Self {
            pending_line: None,
            first_line: true,
        }
    }
}

#[derive(Clone, Debug)]
struct TwicArchiveLink {
    date: String,
    url: String,
}

#[tauri::command]
#[specta::specta]
pub async fn collect_otb_games(
    request: OtbImportRequest,
    app: tauri::AppHandle,
) -> Result<OtbImportReport, String> {
    let current_year = Utc::now().year().max(2020) as u16;
    if request.from_year < 1900 || request.from_year > current_year {
        return Err(format!(
            "The start year must be between 1900 and {current_year}."
        ));
    }
    if !request.include_lichess_broadcasts
        && !request.include_chess_results
        && !request.include_chessbase_news
        && !request.include_official_pgn_indexes
        && !request.include_twic
        && request.local_pgn_paths.is_empty()
    {
        return Err("Select at least one OTB game source.".to_string());
    }

    let identity = PlayerIdentity::new(&request.player_name, request.fide_id.as_deref())?;
    create_dir_all(&request.cache_dir).map_err(|error| error.to_string())?;
    if let Some(parent) = request.output_path.parent() {
        create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| error.to_string())?;
    let mut collection = Collection::default();
    let mut reports = Vec::new();

    if !request.local_pgn_paths.is_empty() {
        let report = scan_local_pgn_sources(&request, &identity, &mut collection, &app);
        reports.push(report);
    }

    if request.include_chess_results {
        let report = scan_chess_results(&client, &request, &identity, &mut collection, &app).await;
        reports.push(report);
    }

    if request.include_lichess_broadcasts {
        let live_report =
            scan_lichess_fide_broadcasts(&client, &request, &identity, &mut collection, &app).await;
        reports.push(live_report);
        let report =
            scan_lichess_broadcasts(&client, &request, &identity, &mut collection, &app).await;
        reports.push(report);
    }

    if request.include_chessbase_news {
        let report = scan_chessbase_news(&client, &request, &identity, &mut collection, &app).await;
        reports.push(report);
    }

    if request.include_official_pgn_indexes {
        let report =
            scan_4ncl_otb_archive(&client, &request, &identity, &mut collection, &app).await;
        reports.push(report);
    }

    if request.include_twic {
        let report = scan_twic(&client, &request, &identity, &mut collection, &app).await;
        reports.push(report);
    }

    collection.games.sort_by(|left, right| {
        left.date
            .cmp(&right.date)
            .then_with(|| left.event.cmp(&right.event))
            .then_with(|| left.white.cmp(&right.white))
            .then_with(|| left.black.cmp(&right.black))
    });
    write_collection(&request.output_path, &collection.games)?;

    let newest_game = collection
        .games
        .iter()
        .filter(|game| game.date.len() >= 4 && game.date != "????.??.??")
        .max_by(|left, right| left.date.cmp(&right.date))
        .map(|game| OtbImportNewestGame {
            date: game.date.clone(),
            event: game.event.clone(),
            white: game.white.clone(),
            black: game.black.clone(),
            result: game.result.clone(),
            source: game.source.clone(),
        });

    emit_progress(
        &app,
        &request,
        "Complete",
        "complete",
        1,
        1,
        collection.games.len(),
        format!("Found {} unique OTB games", collection.games.len()),
    );

    Ok(OtbImportReport {
        player_name: identity.canonical_name,
        fide_id: identity.fide_id,
        output_path: request.output_path.to_string_lossy().into_owned(),
        games_found: collection.games.len().min(u32::MAX as usize) as u32,
        duplicates_removed: collection.duplicates_removed,
        suspected_online_games_excluded: collection.suspected_online_games_excluded,
        identity_mismatches_excluded: collection.identity_mismatches_excluded,
        newest_game,
        sources: reports,
    })
}

fn scan_local_pgn_sources(
    request: &OtbImportRequest,
    identity: &PlayerIdentity,
    collection: &mut Collection,
    app: &tauri::AppHandle,
) -> OtbImportSourceReport {
    let mut report = OtbImportSourceReport::new("Local PGN / ChessBase export");
    let total = request.local_pgn_paths.len();

    for (index, path) in request.local_pgn_paths.iter().enumerate() {
        report.archives_checked += 1;
        let label = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("local PGN")
            .to_string();
        emit_progress(
            app,
            request,
            "Local PGN / ChessBase export",
            "scanning",
            index,
            total,
            collection.games.len(),
            format!("Scanning {label}"),
        );

        let before = collection.games.len();
        match scan_local_path(path, identity, collection, &label, request.from_year) {
            Ok(matched) => {
                report.matched_games += matched;
                report.unique_games_added += collection
                    .games
                    .len()
                    .saturating_sub(before)
                    .min(u32::MAX as usize) as u32;
            }
            Err(error) => report.errors.push(format!("{label}: {error}")),
        }
    }

    report
}

async fn scan_lichess_fide_broadcasts(
    client: &Client,
    request: &OtbImportRequest,
    identity: &PlayerIdentity,
    collection: &mut Collection,
    app: &tauri::AppHandle,
) -> OtbImportSourceReport {
    let mut report = OtbImportSourceReport::new("Lichess live FIDE broadcasts");
    let Some(fide_id) = identity.fide_id.as_deref() else {
        report
            .errors
            .push("Live Lichess tournament discovery requires a FIDE ID.".to_string());
        return report;
    };
    let mut round_paths = HashSet::new();

    for page in 1..=20u32 {
        emit_progress(
            app,
            request,
            "Lichess live broadcasts",
            "discovering",
            page.saturating_sub(1) as usize,
            20,
            collection.games.len(),
            format!("Checking Lichess FIDE tournament page {page}"),
        );
        let page_url = format!("https://lichess.org/fide/{fide_id}/player?page={page}");
        let response = match get_lichess_with_backoff(client, &page_url).await {
            Ok(response) => response,
            Err(error) => {
                report.errors.push(error);
                break;
            }
        };
        let html = match response.text().await {
            Ok(html) => html,
            Err(error) => {
                report.errors.push(error.to_string());
                break;
            }
        };
        let paths = extract_lichess_round_paths_for_range(&html, request.from_year);
        let page_reaches_before_range = extract_quoted_values(&html, "datetime=")
            .into_iter()
            .filter_map(|value| value.get(..4)?.parse::<u16>().ok())
            .any(|year| year < request.from_year);
        if paths.is_empty() {
            break;
        }
        let before_count = round_paths.len();
        round_paths.extend(paths);
        let has_next = html.contains("rel=\"next\"") || html.contains("rel='next'");
        if page_reaches_before_range || !has_next || round_paths.len() == before_count {
            break;
        }
    }

    let mut round_paths = round_paths.into_iter().collect::<Vec<_>>();
    round_paths.sort();
    let mut tours = HashMap::<String, String>::new();
    for round_path in round_paths {
        let api_url = format!("https://lichess.org/api{round_path}");
        let response = match get_lichess_with_backoff(client, &api_url).await {
            Ok(response) => response,
            Err(error) => {
                report.errors.push(format!("{api_url}: {error}"));
                continue;
            }
        };
        let value = match response.json::<serde_json::Value>().await {
            Ok(value) => value,
            Err(error) => {
                report.errors.push(format!("{api_url}: {error}"));
                continue;
            }
        };
        let Some(tour_id) = value
            .get("tour")
            .and_then(|tour| tour.get("id"))
            .and_then(serde_json::Value::as_str)
        else {
            continue;
        };
        let starts_at = value
            .get("round")
            .and_then(|round| round.get("startsAt"))
            .and_then(serde_json::Value::as_i64);
        if starts_at.is_some_and(|timestamp| timestamp_year(timestamp) < request.from_year) {
            continue;
        }
        tours.insert(
            tour_id.to_string(),
            value
                .get("tour")
                .and_then(|tour| tour.get("name"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("Lichess broadcast")
                .to_string(),
        );
    }

    let mut tours = tours.into_iter().collect::<Vec<_>>();
    tours.sort_by(|left, right| left.1.cmp(&right.1));
    for (index, (tour_id, tour_name)) in tours.iter().enumerate() {
        emit_progress(
            app,
            request,
            "Lichess live broadcasts",
            "downloading",
            index,
            tours.len(),
            collection.games.len(),
            format!("Scanning {tour_name}"),
        );
        report.archives_checked = report.archives_checked.saturating_add(1);
        let pgn_url = format!("https://lichess.org/api/broadcast/{tour_id}.pgn");
        let bytes = match get_lichess_with_backoff(client, &pgn_url).await {
            Ok(response) => match response.bytes().await {
                Ok(bytes) => bytes,
                Err(error) => {
                    report.errors.push(format!("{pgn_url}: {error}"));
                    continue;
                }
            },
            Err(error) => {
                report.errors.push(format!("{pgn_url}: {error}"));
                continue;
            }
        };
        let before = collection.games.len();
        match scan_pgn_reader(
            BufReader::new(Cursor::new(bytes)),
            identity,
            collection,
            "Lichess live FIDE broadcasts",
            &pgn_url,
            request.from_year,
        ) {
            Ok(matched) => {
                report.matched_games = report.matched_games.saturating_add(matched);
                report.unique_games_added += collection
                    .games
                    .len()
                    .saturating_sub(before)
                    .min(u32::MAX as usize) as u32;
            }
            Err(error) => report.errors.push(format!("{pgn_url}: {error}")),
        }
    }

    report
}

async fn scan_lichess_broadcasts(
    client: &Client,
    request: &OtbImportRequest,
    identity: &PlayerIdentity,
    collection: &mut Collection,
    app: &tauri::AppHandle,
) -> OtbImportSourceReport {
    let mut report = OtbImportSourceReport::new("Lichess broadcast database");
    let list = match client.get(LICHESS_BROADCAST_LIST).send().await {
        Ok(response) => match response.error_for_status() {
            Ok(response) => match response.text().await {
                Ok(text) => text,
                Err(error) => {
                    report.errors.push(error.to_string());
                    return report;
                }
            },
            Err(error) => {
                report.errors.push(error.to_string());
                return report;
            }
        },
        Err(error) => {
            report.errors.push(error.to_string());
            return report;
        }
    };

    let mut urls = list
        .lines()
        .map(str::trim)
        .filter(|url| url.ends_with(".pgn.zst"))
        .filter(|url| archive_year(url).is_some_and(|year| year >= request.from_year))
        .map(str::to_string)
        .collect::<Vec<_>>();
    urls.sort();

    for (index, url) in urls.iter().enumerate() {
        let label = file_name_from_url(url);
        emit_progress(
            app,
            request,
            "Lichess broadcasts",
            "downloading",
            index,
            urls.len(),
            collection.games.len(),
            format!("Checking {label}"),
        );
        report.archives_checked += 1;
        let cache_path = request.cache_dir.join(&label);
        let (bytes, cached) = match fetch_cached(client, url, &cache_path).await {
            Ok(result) => result,
            Err(error) => {
                report.errors.push(format!("{label}: {error}"));
                continue;
            }
        };
        if cached {
            report.cached_archives += 1;
        }

        let before = collection.games.len();
        match zstd::stream::read::Decoder::new(Cursor::new(bytes)) {
            Ok(decoder) => match scan_pgn_reader(
                BufReader::new(decoder),
                identity,
                collection,
                "Lichess broadcast database",
                url,
                request.from_year,
            ) {
                Ok(matched) => {
                    report.matched_games += matched;
                    report.unique_games_added += collection
                        .games
                        .len()
                        .saturating_sub(before)
                        .min(u32::MAX as usize)
                        as u32;
                }
                Err(error) => report.errors.push(format!("{label}: {error}")),
            },
            Err(error) => report.errors.push(format!("{label}: {error}")),
        }
    }

    report
}

async fn scan_chess_results(
    client: &Client,
    request: &OtbImportRequest,
    identity: &PlayerIdentity,
    collection: &mut Collection,
    app: &tauri::AppHandle,
) -> OtbImportSourceReport {
    let mut report = OtbImportSourceReport::new("Chess-Results FIDE player search");
    let Some(fide_id) = identity.fide_id.as_deref() else {
        report
            .errors
            .push("Chess-Results requires a FIDE ID.".to_string());
        return report;
    };
    report.archives_checked = 1;
    emit_progress(
        app,
        request,
        "Chess-Results",
        "searching",
        0,
        1,
        collection.games.len(),
        format!("Searching Chess-Results for FIDE {fide_id}"),
    );

    let initial_response = match client.get(CHESS_RESULTS_PLAYER_SEARCH).send().await {
        Ok(response) => match response.error_for_status() {
            Ok(response) => response,
            Err(error) => {
                report.errors.push(error.to_string());
                return report;
            }
        },
        Err(error) => {
            report.errors.push(error.to_string());
            return report;
        }
    };
    let cookie = collect_response_cookies(&initial_response);
    let initial_html = match initial_response.text().await {
        Ok(html) => html,
        Err(error) => {
            report.errors.push(error.to_string());
            return report;
        }
    };
    let mut search_form = extract_hidden_form_fields(&initial_html);
    set_form_field(&mut search_form, "ctl00$P1$Txt_FideID", fide_id);
    set_form_field(&mut search_form, "ctl00$P1$combo_anzahl_zeilen", "5");
    set_form_field(&mut search_form, "ctl00$P1$cb_SuchenPartie", "Search");

    let mut search_request = client.post(CHESS_RESULTS_PLAYER_SEARCH).form(&search_form);
    if !cookie.is_empty() {
        search_request = search_request.header(COOKIE, &cookie);
    }
    let search_response = match search_request.send().await {
        Ok(response) => match response.error_for_status() {
            Ok(response) => response,
            Err(error) => {
                report.errors.push(error.to_string());
                return report;
            }
        },
        Err(error) => {
            report.errors.push(error.to_string());
            return report;
        }
    };
    let search_html = match search_response.text().await {
        Ok(html) => html,
        Err(error) => {
            report.errors.push(error.to_string());
            return report;
        }
    };
    let mut download_form = extract_hidden_form_fields(&search_html);
    set_form_field(&mut download_form, "ctl00$P1$Txt_FideID", fide_id);
    set_form_field(&mut download_form, "ctl00$P1$combo_anzahl_zeilen", "5");
    set_form_field(
        &mut download_form,
        "ctl00$P1$cb_DownLoadPGN",
        "Download as PGN-File",
    );

    let mut download_request = client
        .post(CHESS_RESULTS_PLAYER_SEARCH)
        .form(&download_form);
    if !cookie.is_empty() {
        download_request = download_request.header(COOKIE, &cookie);
    }
    let bytes = match download_request.send().await {
        Ok(response) => match response.error_for_status() {
            Ok(response) => match response.bytes().await {
                Ok(bytes) => bytes,
                Err(error) => {
                    report.errors.push(error.to_string());
                    return report;
                }
            },
            Err(error) => {
                report.errors.push(error.to_string());
                return report;
            }
        },
        Err(error) => {
            report.errors.push(error.to_string());
            return report;
        }
    };

    let before = collection.games.len();
    match scan_pgn_reader(
        BufReader::new(Cursor::new(bytes)),
        identity,
        collection,
        "Chess-Results FIDE player search",
        CHESS_RESULTS_PLAYER_SEARCH,
        request.from_year,
    ) {
        Ok(matched) => {
            report.matched_games = matched;
            report.unique_games_added = collection
                .games
                .len()
                .saturating_sub(before)
                .min(u32::MAX as usize) as u32;
        }
        Err(error) => report.errors.push(error),
    }
    report
}

async fn scan_chessbase_news(
    client: &Client,
    request: &OtbImportRequest,
    identity: &PlayerIdentity,
    collection: &mut Collection,
    app: &tauri::AppHandle,
) -> OtbImportSourceReport {
    let mut report = OtbImportSourceReport::new("ChessBase public news PGNs");
    let mut article_urls = HashSet::new();

    for query in chessbase_search_queries(identity) {
        let response = match client
            .get(CHESSBASE_SEARCH)
            .query(&[("pattern", query.as_str())])
            .send()
            .await
        {
            Ok(response) => match response.error_for_status() {
                Ok(response) => response,
                Err(error) => {
                    report.errors.push(format!("Search for {query}: {error}"));
                    continue;
                }
            },
            Err(error) => {
                report.errors.push(format!("Search for {query}: {error}"));
                continue;
            }
        };
        match response.text().await {
            Ok(html) => {
                for href in extract_quoted_values(&html, "href=") {
                    let clean = decode_basic_html_entities(&href);
                    if clean.starts_with("/post/") || clean.starts_with("/newsroom/post/") {
                        article_urls.insert(format!("{CHESSBASE_ORIGIN}{clean}"));
                    }
                }
            }
            Err(error) => report.errors.push(format!("Search for {query}: {error}")),
        }
    }

    let mut article_urls = article_urls.into_iter().collect::<Vec<_>>();
    article_urls.sort();
    let mut pgn_urls = HashSet::new();
    for (index, article_url) in article_urls.iter().enumerate() {
        emit_progress(
            app,
            request,
            "ChessBase",
            "discovering",
            index,
            article_urls.len(),
            collection.games.len(),
            format!(
                "Checking ChessBase article {} of {}",
                index + 1,
                article_urls.len()
            ),
        );
        report.archives_checked = report.archives_checked.saturating_add(1);
        let response = match client.get(article_url).send().await {
            Ok(response) => match response.error_for_status() {
                Ok(response) => response,
                Err(error) => {
                    report.errors.push(format!("{article_url}: {error}"));
                    continue;
                }
            },
            Err(error) => {
                report.errors.push(format!("{article_url}: {error}"));
                continue;
            }
        };
        match response.text().await {
            Ok(html) => {
                for marker in ["data-url=", "href="] {
                    for value in extract_quoted_values(&html, marker) {
                        let value = decode_basic_html_entities(&value);
                        if value.starts_with("http") && value.to_ascii_lowercase().contains(".pgn")
                        {
                            pgn_urls.insert(value);
                        }
                    }
                }
            }
            Err(error) => report.errors.push(format!("{article_url}: {error}")),
        }
    }

    let mut pgn_urls = pgn_urls.into_iter().collect::<Vec<_>>();
    pgn_urls.sort();
    for (index, pgn_url) in pgn_urls.iter().enumerate() {
        emit_progress(
            app,
            request,
            "ChessBase",
            "downloading",
            index,
            pgn_urls.len(),
            collection.games.len(),
            format!("Scanning ChessBase PGN {} of {}", index + 1, pgn_urls.len()),
        );
        let response = match client.get(pgn_url).send().await {
            Ok(response) => match response.error_for_status() {
                Ok(response) => response,
                Err(error) => {
                    report.errors.push(format!("{pgn_url}: {error}"));
                    continue;
                }
            },
            Err(error) => {
                report.errors.push(format!("{pgn_url}: {error}"));
                continue;
            }
        };
        let bytes = match response.bytes().await {
            Ok(bytes) => bytes,
            Err(error) => {
                report.errors.push(format!("{pgn_url}: {error}"));
                continue;
            }
        };
        let before = collection.games.len();
        match scan_pgn_reader(
            BufReader::new(Cursor::new(bytes)),
            identity,
            collection,
            "ChessBase public news PGNs",
            pgn_url,
            request.from_year,
        ) {
            Ok(matched) => {
                report.matched_games = report.matched_games.saturating_add(matched);
                report.unique_games_added += collection
                    .games
                    .len()
                    .saturating_sub(before)
                    .min(u32::MAX as usize) as u32;
            }
            Err(error) => report.errors.push(format!("{pgn_url}: {error}")),
        }
    }

    report
}

async fn scan_4ncl_otb_archive(
    client: &Client,
    request: &OtbImportRequest,
    identity: &PlayerIdentity,
    collection: &mut Collection,
    app: &tauri::AppHandle,
) -> OtbImportSourceReport {
    let mut report = OtbImportSourceReport::new("Official tournament PGN indexes (4NCL)");
    let index_html = match client.get(FOUR_NCL_PGN_INDEX).send().await {
        Ok(response) => match response.error_for_status() {
            Ok(response) => match response.text().await {
                Ok(text) => text,
                Err(error) => {
                    report.errors.push(error.to_string());
                    return report;
                }
            },
            Err(error) => {
                report.errors.push(error.to_string());
                return report;
            }
        },
        Err(error) => {
            report.errors.push(error.to_string());
            return report;
        }
    };

    let mut pgn_urls = extract_quoted_values(&index_html, "href=")
        .into_iter()
        .filter_map(|href| absolute_4ncl_url(&decode_basic_html_entities(&href)))
        .filter(|url| is_4ncl_otb_archive_url(url))
        .collect::<HashSet<_>>();

    // The archive index can lag behind a just-finished congress. Probe the
    // current Easter congress' stable section paths as a small deterministic
    // supplement; missing sections are silently ignored.
    let year = Utc::now().year();
    let season = format!(
        "{:02}{:02}",
        (year - 1).rem_euclid(100),
        year.rem_euclid(100)
    );
    let easter = format!("easter{}", year.rem_euclid(100));
    let mut optional_current_urls = HashSet::new();
    for section in ["open", "u2000", "u1700", "u1500", "u1400", "u1200"] {
        let url = format!("{FOUR_NCL_ORIGIN}/pgn/{season}/congress/{easter}/{section}.pgn");
        optional_current_urls.insert(url.clone());
        pgn_urls.insert(url);
    }

    let mut pgn_urls = pgn_urls.into_iter().collect::<Vec<_>>();
    pgn_urls.sort();
    for (index, pgn_url) in pgn_urls.iter().enumerate() {
        emit_progress(
            app,
            request,
            "Official tournament sites",
            "downloading",
            index,
            pgn_urls.len(),
            collection.games.len(),
            format!(
                "Scanning official 4NCL PGN {} of {}",
                index + 1,
                pgn_urls.len()
            ),
        );
        let response = match client.get(pgn_url).send().await {
            Ok(response) if response.status() == reqwest::StatusCode::NOT_FOUND => {
                if !optional_current_urls.contains(pgn_url) {
                    report.errors.push(format!("{pgn_url}: not found"));
                }
                continue;
            }
            Ok(response) => match response.error_for_status() {
                Ok(response) => response,
                Err(error) => {
                    report.errors.push(format!("{pgn_url}: {error}"));
                    continue;
                }
            },
            Err(error) => {
                report.errors.push(format!("{pgn_url}: {error}"));
                continue;
            }
        };
        report.archives_checked = report.archives_checked.saturating_add(1);
        let bytes = match response.bytes().await {
            Ok(bytes) => bytes,
            Err(error) => {
                report.errors.push(format!("{pgn_url}: {error}"));
                continue;
            }
        };
        let before = collection.games.len();
        match scan_pgn_reader(
            BufReader::new(Cursor::new(bytes)),
            identity,
            collection,
            "Official tournament PGN indexes (4NCL)",
            pgn_url,
            request.from_year,
        ) {
            Ok(matched) => {
                report.matched_games = report.matched_games.saturating_add(matched);
                report.unique_games_added = report.unique_games_added.saturating_add(
                    collection
                        .games
                        .len()
                        .saturating_sub(before)
                        .min(u32::MAX as usize) as u32,
                );
            }
            Err(error) => report.errors.push(format!("{pgn_url}: {error}")),
        }
    }

    report
}

fn absolute_4ncl_url(href: &str) -> Option<String> {
    let href = href.trim();
    if href.starts_with("https://") || href.starts_with("http://") {
        return Some(href.to_string());
    }
    if let Some(path) = href.strip_prefix("//") {
        return Some(format!("https://{path}"));
    }
    if href.starts_with('/') {
        return Some(format!("{FOUR_NCL_ORIGIN}{href}"));
    }
    (!href.is_empty()).then(|| format!("{FOUR_NCL_ORIGIN}/{href}"))
}

fn is_4ncl_otb_archive_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    if !lower.contains(".pgn")
        || lower.contains("online")
        || lower.contains("junonline")
        || lower.contains("/autumn")
        || (lower.contains("/congress/spring") && !lower.contains("gmspring"))
    {
        return false;
    }
    lower.contains("all.pgn")
        || lower.contains("4nclall")
        || lower.contains("4nclotb")
        || lower.contains("/fide/pgn/")
        || lower.contains("/rp/")
        || lower.contains("gmspring")
}

async fn scan_twic(
    client: &Client,
    request: &OtbImportRequest,
    identity: &PlayerIdentity,
    collection: &mut Collection,
    app: &tauri::AppHandle,
) -> OtbImportSourceReport {
    let mut report = OtbImportSourceReport::new("The Week in Chess");
    let page = match client.get(TWIC_ARCHIVE).send().await {
        Ok(response) => match response.error_for_status() {
            Ok(response) => match response.text().await {
                Ok(text) => text,
                Err(error) => {
                    report.errors.push(error.to_string());
                    return report;
                }
            },
            Err(error) => {
                report.errors.push(error.to_string());
                return report;
            }
        },
        Err(error) => {
            report.errors.push(error.to_string());
            return report;
        }
    };
    let mut archives = parse_twic_archive_links(&page)
        .into_iter()
        .filter(|archive| {
            archive
                .date
                .get(..4)
                .and_then(|year| year.parse::<u16>().ok())
                .is_some_and(|year| year >= request.from_year)
        })
        .collect::<Vec<_>>();
    archives.sort_by(|left, right| left.date.cmp(&right.date));

    for (index, archive) in archives.iter().enumerate() {
        let label = file_name_from_url(&archive.url);
        emit_progress(
            app,
            request,
            "The Week in Chess",
            "downloading",
            index,
            archives.len(),
            collection.games.len(),
            format!("Checking {label}"),
        );
        report.archives_checked += 1;
        let cache_path = request.cache_dir.join(&label);
        let (bytes, cached) = match fetch_cached(client, &archive.url, &cache_path).await {
            Ok(result) => result,
            Err(error) => {
                report.errors.push(format!("{label}: {error}"));
                continue;
            }
        };
        if cached {
            report.cached_archives += 1;
        }

        let before = collection.games.len();
        match scan_zip_pgns(
            bytes,
            identity,
            collection,
            "The Week in Chess",
            &archive.url,
            request.from_year,
        ) {
            Ok(matched) => {
                report.matched_games += matched;
                report.unique_games_added += collection
                    .games
                    .len()
                    .saturating_sub(before)
                    .min(u32::MAX as usize) as u32;
            }
            Err(error) => report.errors.push(format!("{label}: {error}")),
        }
    }

    report
}

async fn fetch_cached(
    client: &Client,
    url: &str,
    cache_path: &Path,
) -> Result<(Vec<u8>, bool), String> {
    if cache_path.is_file() {
        let bytes = std::fs::read(cache_path).map_err(|error| error.to_string())?;
        if !bytes.is_empty() {
            return Ok((bytes, true));
        }
    }

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let bytes = response
        .bytes()
        .await
        .map_err(|error| error.to_string())?
        .to_vec();
    if let Some(parent) = cache_path.parent() {
        create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(cache_path, &bytes).map_err(|error| error.to_string())?;
    Ok((bytes, false))
}

async fn get_lichess_with_backoff(client: &Client, url: &str) -> Result<reqwest::Response, String> {
    let mut last_error = None;
    for attempt in 0_u32..3 {
        tokio::time::sleep(Duration::from_millis(300 * u64::from(attempt + 1))).await;
        match client.get(url).send().await {
            Ok(response) if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS => {
                let retry_seconds = response
                    .headers()
                    .get("retry-after")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(60)
                    .max(1);
                last_error = Some(format!("Lichess rate-limited {url}"));
                tokio::time::sleep(Duration::from_secs(retry_seconds)).await;
            }
            Ok(response) => {
                return response
                    .error_for_status()
                    .map_err(|error| error.to_string());
            }
            Err(error) => {
                last_error = Some(error.to_string());
                tokio::time::sleep(Duration::from_secs(2_u64.pow(attempt))).await;
            }
        }
    }
    Err(last_error.unwrap_or_else(|| format!("Could not download {url}")))
}

fn scan_local_path(
    path: &Path,
    identity: &PlayerIdentity,
    collection: &mut Collection,
    label: &str,
    from_year: u16,
) -> Result<u32, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "zip" => {
            let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
            scan_zip_pgns(
                bytes,
                identity,
                collection,
                "Local PGN / ChessBase export",
                label,
                from_year,
            )
        }
        "zst" => {
            let file = File::open(path).map_err(|error| error.to_string())?;
            let decoder =
                zstd::stream::read::Decoder::new(file).map_err(|error| error.to_string())?;
            scan_pgn_reader(
                BufReader::new(decoder),
                identity,
                collection,
                "Local PGN / ChessBase export",
                label,
                from_year,
            )
        }
        _ => {
            let file = File::open(path).map_err(|error| error.to_string())?;
            scan_pgn_reader(
                BufReader::new(file),
                identity,
                collection,
                "Local PGN / ChessBase export",
                label,
                from_year,
            )
        }
    }
}

fn scan_zip_pgns(
    bytes: Vec<u8>,
    identity: &PlayerIdentity,
    collection: &mut Collection,
    source: &str,
    source_url: &str,
    from_year: u16,
) -> Result<u32, String> {
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|error| error.to_string())?;
    let mut matched = 0u32;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|error| error.to_string())?;
        if !file.name().to_ascii_lowercase().ends_with(".pgn") {
            continue;
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        let text = String::from_utf8_lossy(&bytes);
        matched = matched.saturating_add(scan_pgn_reader(
            BufReader::new(Cursor::new(text.as_bytes())),
            identity,
            collection,
            source,
            source_url,
            from_year,
        )?);
    }
    Ok(matched)
}

fn scan_pgn_reader<R: BufRead>(
    mut reader: R,
    identity: &PlayerIdentity,
    collection: &mut Collection,
    source: &str,
    source_url: &str,
    from_year: u16,
) -> Result<u32, String> {
    let mut state = PgnStreamState::new();
    let mut matched = 0u32;
    loop {
        let Some(game) =
            read_next_game(&mut reader, &mut state).map_err(|error| error.to_string())?
        else {
            break;
        };
        let headers = parse_headers(&game);
        let match_side = match_player_side(&headers, identity);
        let Some(side) = match_side else {
            if name_matches_without_identity(&headers, identity) {
                collection.identity_mismatches_excluded =
                    collection.identity_mismatches_excluded.saturating_add(1);
            }
            continue;
        };
        matched = matched.saturating_add(1);

        if is_suspected_online_game(&headers) {
            collection.suspected_online_games_excluded =
                collection.suspected_online_games_excluded.saturating_add(1);
            continue;
        }
        if header(&headers, "Date").is_some_and(|date| date_before_year(date, from_year)) {
            continue;
        }

        let canonical_pgn = canonicalize_target_name(&game, side, &identity.canonical_name);
        let canonical_pgn = add_provenance_headers(&canonical_pgn, source, source_url);
        add_game(collection, canonical_pgn, source, side);
    }
    Ok(matched)
}

fn add_game(collection: &mut Collection, pgn: String, source: &str, target_side: &str) {
    let headers = parse_headers(&pgn);
    let white = header(&headers, "White").unwrap_or("Unknown").to_string();
    let black = header(&headers, "Black").unwrap_or("Unknown").to_string();
    let date = header(&headers, "Date").unwrap_or("????.??.??").to_string();
    let event = header(&headers, "Event")
        .unwrap_or("Unknown event")
        .to_string();
    let result = header(&headers, "Result").unwrap_or("*").to_string();
    let moves = normalized_movetext(&pgn);
    if moves.is_empty() {
        return;
    }
    let mainline_moves = mainline_move_fingerprint(&pgn).unwrap_or_else(|| moves.clone());
    let move_fingerprint = format!("{target_side}|{mainline_moves}");
    if let Some(indices) = collection.move_fingerprints.get(&move_fingerprint) {
        let duplicate = indices.iter().any(|index| {
            let existing = &collection.games[*index];
            dates_overlap(&existing.date, &date, &mainline_moves)
        });
        if duplicate {
            collection.duplicates_removed = collection.duplicates_removed.saturating_add(1);
            return;
        }
    }

    let broad_fingerprint = format!(
        "{}|{}|{}|{}",
        normalized_name(&white),
        normalized_name(&black),
        result,
        moves
    );
    if let Some(indices) = collection.broad_fingerprints.get(&broad_fingerprint) {
        let duplicate = indices.iter().any(|index| {
            let existing = &collection.games[*index];
            dates_overlap(&existing.date, &date, &moves)
        });
        if duplicate {
            collection.duplicates_removed = collection.duplicates_removed.saturating_add(1);
            return;
        }
    }

    let index = collection.games.len();
    collection
        .broad_fingerprints
        .entry(broad_fingerprint)
        .or_default()
        .push(index);
    collection
        .move_fingerprints
        .entry(move_fingerprint)
        .or_default()
        .push(index);
    collection.games.push(CollectedGame {
        pgn,
        date,
        event,
        white,
        black,
        result,
        source: source.to_string(),
    });
}

#[derive(Default)]
struct MainlineMoveVisitor {
    moves: Vec<String>,
}

impl Visitor for MainlineMoveVisitor {
    type Result = Vec<String>;

    fn begin_game(&mut self) {
        self.moves.clear();
    }

    fn san(&mut self, san: SanPlus) {
        self.moves.push(san.to_string());
    }

    fn begin_variation(&mut self) -> Skip {
        Skip(true)
    }

    fn end_game(&mut self) -> Self::Result {
        self.moves.clone()
    }
}

fn mainline_move_fingerprint(game: &str) -> Option<String> {
    let mut reader = PgnReader::new(game.as_bytes());
    let mut visitor = MainlineMoveVisitor::default();
    reader
        .read_game(&mut visitor)
        .ok()
        .flatten()
        .filter(|moves| !moves.is_empty())
        .map(|moves| moves.join(" "))
}

fn read_next_game<R: BufRead>(
    reader: &mut R,
    state: &mut PgnStreamState,
) -> std::io::Result<Option<String>> {
    let mut game = String::new();
    let mut line = String::new();
    let mut in_comment = false;
    let mut saw_movetext = false;

    loop {
        line.clear();
        if let Some(pending) = state.pending_line.take() {
            line.push_str(&pending);
        } else if reader.read_line(&mut line)? == 0 {
            break;
        }

        if state.first_line {
            state.first_line = false;
            if line.starts_with('\u{feff}') {
                line = line.trim_start_matches('\u{feff}').to_string();
            }
        }

        let trimmed = line.trim();
        let is_header = !in_comment && trimmed.starts_with('[');
        if is_header && saw_movetext {
            state.pending_line = Some(line.clone());
            break;
        }
        if !is_header && !trimmed.is_empty() {
            saw_movetext = true;
        }
        game.push_str(&line);
        for char in line.chars() {
            match char {
                '{' => in_comment = true,
                '}' => in_comment = false,
                _ => {}
            }
        }
    }

    if game.trim().is_empty() {
        Ok(None)
    } else {
        if !game.ends_with('\n') {
            game.push('\n');
        }
        Ok(Some(game))
    }
}

fn parse_headers(game: &str) -> Vec<(String, String)> {
    game.lines()
        .map(str::trim)
        .take_while(|line| line.is_empty() || line.starts_with('['))
        .filter_map(|line| {
            let line = line.strip_prefix('[')?.strip_suffix(']')?;
            let split = line.find(char::is_whitespace)?;
            let key = line[..split].to_string();
            let raw = line[split..].trim();
            let value = raw.strip_prefix('"')?.strip_suffix('"')?;
            Some((key, value.replace("\\\"", "\"").replace("\\\\", "\\")))
        })
        .collect()
}

fn header<'a>(headers: &'a [(String, String)], key: &str) -> Option<&'a str> {
    headers.iter().find_map(|(candidate, value)| {
        candidate
            .eq_ignore_ascii_case(key)
            .then_some(value.as_str())
    })
}

fn match_player_side(
    headers: &[(String, String)],
    identity: &PlayerIdentity,
) -> Option<&'static str> {
    let white_id = normalized_fide_header(header(headers, "WhiteFideId"));
    let black_id = normalized_fide_header(header(headers, "BlackFideId"));
    if let Some(target_id) = identity.fide_id.as_deref() {
        if white_id.as_deref() == Some(target_id) {
            return Some("White");
        }
        if black_id.as_deref() == Some(target_id) {
            return Some("Black");
        }
    }

    if header(headers, "White").is_some_and(|name| identity.name_matches(name)) {
        if identity.fide_id.is_none() || white_id.is_none() {
            return Some("White");
        }
        return None;
    }
    if header(headers, "Black").is_some_and(|name| identity.name_matches(name)) {
        if identity.fide_id.is_none() || black_id.is_none() {
            return Some("Black");
        }
        return None;
    }
    None
}

fn name_matches_without_identity(headers: &[(String, String)], identity: &PlayerIdentity) -> bool {
    header(headers, "White").is_some_and(|name| identity.name_matches(name))
        || header(headers, "Black").is_some_and(|name| identity.name_matches(name))
}

fn normalized_fide_header(value: Option<&str>) -> Option<String> {
    value
        .map(|value| {
            value
                .chars()
                .filter(|char| char.is_ascii_digit())
                .collect::<String>()
        })
        .filter(|value| !value.is_empty())
}

fn canonicalize_target_name(game: &str, side: &str, canonical_name: &str) -> String {
    let prefix = format!("[{side} ");
    game.lines()
        .map(|line| {
            if line.trim_start().starts_with(&prefix) {
                format!("[{side} \"{}\"]", escape_pgn_header(canonical_name))
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

fn add_provenance_headers(game: &str, source: &str, source_url: &str) -> String {
    let mut output = String::new();
    let mut inserted = false;
    for line in game.lines() {
        if !inserted && !line.trim().starts_with('[') {
            output.push_str(&format!(
                "[OutpostSource \"{}\"]\n[OutpostSourceUrl \"{}\"]\n",
                escape_pgn_header(source),
                escape_pgn_header(source_url)
            ));
            inserted = true;
        }
        output.push_str(line);
        output.push('\n');
    }
    if !inserted {
        output.push_str(&format!(
            "[OutpostSource \"{}\"]\n[OutpostSourceUrl \"{}\"]\n",
            escape_pgn_header(source),
            escape_pgn_header(source_url)
        ));
    }
    output
}

fn escape_pgn_header(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn is_suspected_online_game(headers: &[(String, String)]) -> bool {
    let event = header(headers, "Event")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let site = header(headers, "Site")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let is_lichess_broadcast = site.contains("lichess.org/broadcast/")
        || header(headers, "BroadcastURL").is_some_and(|value| {
            value
                .to_ascii_lowercase()
                .contains("lichess.org/broadcast/")
        });
    let is_chess_com = site == "chess.com"
        || site.starts_with("https://chess.com")
        || site.starts_with("http://chess.com")
        || site.contains("www.chess.com")
        || event.contains("chess.com");
    let is_lichess_account = site.contains("lichess.org") && !is_lichess_broadcast;
    if is_chess_com || is_lichess_account {
        return true;
    }

    let combined = format!("{event} {site}");
    [
        "playchess",
        "online arena",
        "online chess",
        "internet chess",
        "live chess",
        "titled arena",
        "web chess",
        "chessable masters online",
    ]
    .iter()
    .any(|marker| combined.contains(marker))
}

fn normalized_movetext(game: &str) -> String {
    let movetext = game
        .lines()
        .filter(|line| !line.trim_start().starts_with('['))
        .collect::<Vec<_>>()
        .join(" ");
    let mut output = String::new();
    let mut comment_depth = 0u32;
    let mut variation_depth = 0u32;
    let mut nag = false;
    let mut previous_space = true;
    for char in movetext.chars() {
        match char {
            '{' => comment_depth = comment_depth.saturating_add(1),
            '}' => comment_depth = comment_depth.saturating_sub(1),
            '(' if comment_depth == 0 => variation_depth = variation_depth.saturating_add(1),
            ')' if comment_depth == 0 => variation_depth = variation_depth.saturating_sub(1),
            '$' if comment_depth == 0 && variation_depth == 0 => nag = true,
            value if nag && value.is_ascii_digit() => {}
            value if nag => {
                nag = false;
                if value.is_whitespace() && !previous_space {
                    output.push(' ');
                    previous_space = true;
                }
            }
            _ if comment_depth > 0 || variation_depth > 0 => {}
            value if value.is_whitespace() => {
                if !previous_space {
                    output.push(' ');
                    previous_space = true;
                }
            }
            value => {
                output.push(value);
                previous_space = false;
            }
        }
    }
    output.trim().to_string()
}

fn core_name_tokens(name: &str) -> HashSet<String> {
    const TITLES: &[&str] = &["gm", "im", "fm", "cm", "wgm", "wim", "wfm", "wcm", "nm"];
    normalized_name(name)
        .split_whitespace()
        .filter(|token| token.len() > 1 && !TITLES.contains(token))
        .map(str::to_string)
        .collect()
}

fn chessbase_search_queries(identity: &PlayerIdentity) -> Vec<String> {
    let mut queries = vec![identity.canonical_name.clone()];
    if let Some((surname, given_names)) = identity.canonical_name.split_once(',') {
        let forename_first = format!("{} {}", given_names.trim(), surname.trim());
        if !forename_first.eq_ignore_ascii_case(&identity.canonical_name) {
            queries.push(forename_first);
        }
    }
    if let Some(fide_id) = identity.fide_id.as_ref() {
        queries.push(fide_id.clone());
    }
    queries.sort_by_key(|query| query.to_ascii_lowercase());
    queries.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    queries
}

fn extract_quoted_values(value: &str, marker: &str) -> Vec<String> {
    let mut results = Vec::new();
    let mut remaining = value;
    while let Some(marker_index) = remaining.find(marker) {
        remaining = &remaining[marker_index + marker.len()..];
        let trimmed = remaining.trim_start();
        let Some(quote) = trimmed
            .chars()
            .next()
            .filter(|char| *char == '"' || *char == '\'')
        else {
            remaining = trimmed.get(1..).unwrap_or_default();
            continue;
        };
        let content = &trimmed[quote.len_utf8()..];
        let Some(end) = content.find(quote) else {
            break;
        };
        results.push(content[..end].to_string());
        remaining = &content[end + quote.len_utf8()..];
    }
    results
}

fn extract_hidden_form_fields(html: &str) -> Vec<(String, String)> {
    html.split("<input")
        .skip(1)
        .filter_map(|tail| tail.split_once('>').map(|(tag, _)| tag))
        .filter(|tag| {
            extract_quoted_values(tag, "type=")
                .first()
                .is_some_and(|value| value.eq_ignore_ascii_case("hidden"))
        })
        .filter_map(|tag| {
            let name = extract_quoted_values(tag, "name=").into_iter().next()?;
            let value = extract_quoted_values(tag, "value=")
                .into_iter()
                .next()
                .unwrap_or_default();
            Some((
                decode_basic_html_entities(&name),
                decode_basic_html_entities(&value),
            ))
        })
        .collect()
}

fn set_form_field(fields: &mut Vec<(String, String)>, name: &str, value: &str) {
    if let Some((_, current)) = fields.iter_mut().find(|(key, _)| key == name) {
        *current = value.to_string();
    } else {
        fields.push((name.to_string(), value.to_string()));
    }
}

fn collect_response_cookies(response: &reqwest::Response) -> String {
    response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .filter_map(|value| value.split(';').next())
        .collect::<Vec<_>>()
        .join("; ")
}

fn decode_basic_html_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&#38;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn date_before_year(date: &str, from_year: u16) -> bool {
    date.get(..4)
        .and_then(|year| year.parse::<u16>().ok())
        .is_some_and(|year| year < from_year)
}

fn is_lichess_round_path(value: &str) -> bool {
    if !value.starts_with("/broadcast/") || value.contains('?') || value.contains('#') {
        return false;
    }
    let segments = value.trim_matches('/').split('/').collect::<Vec<_>>();
    segments.len() == 4
        && segments[0] == "broadcast"
        && segments[3].len() == 8
        && segments[3].chars().all(|char| char.is_ascii_alphanumeric())
}

fn extract_lichess_round_paths_for_range(html: &str, from_year: u16) -> Vec<String> {
    html.split("<a")
        .skip(1)
        .filter_map(|tail| tail.split_once("</a>").map(|(anchor, _)| anchor))
        .filter_map(|anchor| {
            let href = extract_quoted_values(anchor, "href=").into_iter().next()?;
            if !is_lichess_round_path(&href) {
                return None;
            }
            let in_range = extract_quoted_values(anchor, "datetime=")
                .into_iter()
                .filter_map(|value| value.get(..4)?.parse::<u16>().ok())
                .all(|year| year >= from_year);
            in_range.then_some(href)
        })
        .collect()
}

fn timestamp_year(timestamp_millis: i64) -> u16 {
    chrono::DateTime::<Utc>::from_timestamp_millis(timestamp_millis)
        .map(|date| date.year().max(0).min(u16::MAX as i32) as u16)
        .unwrap_or_default()
}

fn normalized_name(name: &str) -> String {
    let mut output = String::new();
    let mut previous_space = true;
    for char in name.chars().flat_map(char::to_lowercase) {
        if char.is_alphanumeric() {
            output.push(char);
            previous_space = false;
        } else if !previous_space {
            output.push(' ');
            previous_space = true;
        }
    }
    output.trim().to_string()
}

fn dates_overlap(left: &str, right: &str, normalized_moves: &str) -> bool {
    if left.contains('?') || right.contains('?') {
        return true;
    }
    left == right || normalized_moves.split_whitespace().count() >= 12
}

fn parse_twic_archive_links(html: &str) -> Vec<TwicArchiveLink> {
    let mut links = Vec::new();
    let mut seen = HashSet::new();
    for row in html.split("<tr>") {
        let Some(url_start) = row.find("https://theweekinchess.com/zips/twic") else {
            continue;
        };
        let url_tail = &row[url_start..];
        let Some(url_end) = url_tail.find('"') else {
            continue;
        };
        let url = &url_tail[..url_end];
        if !url.ends_with("g.zip") || !seen.insert(url.to_string()) {
            continue;
        }
        let Some(date) = find_iso_date(row) else {
            continue;
        };
        links.push(TwicArchiveLink {
            date,
            url: url.to_string(),
        });
    }
    links
}

fn find_iso_date(value: &str) -> Option<String> {
    value.as_bytes().windows(10).find_map(|window| {
        let date = std::str::from_utf8(window).ok()?;
        let bytes = date.as_bytes();
        (bytes.get(4) == Some(&b'-')
            && bytes.get(7) == Some(&b'-')
            && bytes
                .iter()
                .enumerate()
                .all(|(index, char)| index == 4 || index == 7 || char.is_ascii_digit()))
        .then(|| date.to_string())
    })
}

fn archive_year(url: &str) -> Option<u16> {
    let marker = "lichess_db_broadcast_";
    let start = url.find(marker)? + marker.len();
    url.get(start..start + 4)?.parse().ok()
}

fn file_name_from_url(url: &str) -> String {
    url.rsplit('/').next().unwrap_or("otb-source").to_string()
}

fn write_collection(path: &Path, games: &[CollectedGame]) -> Result<(), String> {
    let mut file = File::create(path).map_err(|error| error.to_string())?;
    for game in games {
        file.write_all(game.pgn.trim().as_bytes())
            .map_err(|error| error.to_string())?;
        file.write_all(b"\n\n").map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn emit_progress(
    app: &tauri::AppHandle,
    request: &OtbImportRequest,
    source: &str,
    phase: &str,
    current: usize,
    total: usize,
    games_found: usize,
    message: String,
) {
    let _ = OtbImportProgress {
        job_id: request.job_id.clone(),
        source: source.to_string(),
        phase: phase.to_string(),
        current: current.min(u32::MAX as usize) as u32,
        total: total.min(u32::MAX as usize) as u32,
        games_found: games_found.min(u32::MAX as usize) as u32,
        message,
    }
    .emit(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> PlayerIdentity {
        PlayerIdentity::new("Lapidus, Alexey M.", Some("24276111")).unwrap()
    }

    #[test]
    fn matches_name_order_and_ignores_title_and_middle_initial() {
        let identity = identity();
        assert!(identity.name_matches("Alexey Lapidus"));
        assert!(identity.name_matches("Lapidus, Alexey M."));
        assert!(identity.name_matches("CM Lapidus, Alexey"));
        assert!(!identity.name_matches("Sarana, Alexey"));
    }

    #[test]
    fn fide_id_overrides_same_name_mismatch() {
        let pgn = r#"[White "Lapidus, Alexey M."]
[Black "Opponent, One"]
[WhiteFideId "99999999"]
[BlackFideId "11111111"]
[Result "1-0"]

1. e4 e5 1-0
"#;
        let headers = parse_headers(pgn);
        assert_eq!(match_player_side(&headers, &identity()), None);
        assert!(name_matches_without_identity(&headers, &identity()));
    }

    #[test]
    fn removes_comments_variations_and_nags_from_move_fingerprint() {
        let plain = "[Result \"1-0\"]\n\n1. e4 e5 2. Nf3 Nc6 1-0";
        let annotated = "[Result \"1-0\"]\n\n1. e4 { [%clk 1:00] } e5 (1... c5) 2. Nf3 $1 Nc6 1-0";
        assert_eq!(normalized_movetext(plain), normalized_movetext(annotated));
    }

    #[test]
    fn identifies_obvious_online_events_but_not_lichess_broadcast_provenance() {
        let otb = parse_headers(
            "[Event \"British Championship\"]\n[Site \"https://lichess.org/broadcast/event/round/id\"]\n[BroadcastURL \"https://lichess.org/broadcast/x\"]\n",
        );
        let online =
            parse_headers("[Event \"Online Chess Championship\"]\n[Site \"https://chess.com\"]\n");
        let id_chess =
            parse_headers("[Event \"World Schools Team Championship\"]\n[Site \"idChess.com\"]\n");
        assert!(!is_suspected_online_game(&otb));
        assert!(!is_suspected_online_game(&id_chess));
        assert!(is_suspected_online_game(&online));
    }

    #[test]
    fn accepts_name_match_when_only_the_opponent_has_a_fide_id() {
        let pgn = r#"[White "Opponent, One"]
[Black "Lapidus, Alexey M."]
[WhiteFideId "11111111"]
[BlackFideId "-"]
[Result "1-0"]

1. e4 e5 1-0
"#;
        assert_eq!(
            match_player_side(&parse_headers(pgn), &identity()),
            Some("Black")
        );
    }

    #[test]
    fn parses_twic_rows_with_dates_and_pgn_links() {
        let html = r#"<tr>
<td>1652</td><td>2026-07-06</td>
<td><a href="https://theweekinchess.com/zips/twic1652g.zip">PGN</a></td>
</tr>"#;
        assert_eq!(
            parse_twic_archive_links(html)
                .into_iter()
                .map(|item| (item.date, item.url))
                .collect::<Vec<_>>(),
            vec![(
                "2026-07-06".to_string(),
                "https://theweekinchess.com/zips/twic1652g.zip".to_string()
            )]
        );
    }

    #[test]
    fn dedupes_complete_games_despite_source_date_disagreement() {
        assert!(dates_overlap(
            "2026.05.10",
            "2026.05.13",
            "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 1-0"
        ));
        assert!(!dates_overlap("2026.06.01", "2026.06.03", "1. e4 1-0"));
    }

    #[test]
    fn parses_chess_results_hidden_state() {
        let html = r#"<form><input type="hidden" name="__VIEWSTATE" value="abc+/=" />
<input type="hidden" name="__VIEWSTATEGENERATOR" value="A76FDF19" /></form>"#;
        assert_eq!(
            extract_hidden_form_fields(html),
            vec![
                ("__VIEWSTATE".to_string(), "abc+/=".to_string()),
                ("__VIEWSTATEGENERATOR".to_string(), "A76FDF19".to_string())
            ]
        );
    }

    #[test]
    fn recognizes_only_lichess_broadcast_round_paths() {
        assert!(is_lichess_round_path(
            "/broadcast/event-name/round-5/BErZv5hY"
        ));
        assert!(!is_lichess_round_path("/broadcast/event-name/tour-id"));
        assert!(!is_lichess_round_path(
            "/broadcast/event-name/round-5/BErZv5hY/chapter1"
        ));
    }

    #[test]
    fn keeps_4ncl_otb_aggregates_and_rejects_online_archives() {
        assert!(is_4ncl_otb_archive_url(
            "https://www.4ncl.co.uk/pgn/2526/otb/4NCLotb2526all.pgn"
        ));
        assert!(is_4ncl_otb_archive_url(
            "https://www.4ncl.co.uk/pgn/2425/congress/easter25/easter25all.pgn"
        ));
        assert!(!is_4ncl_otb_archive_url(
            "https://www.4ncl.co.uk/pgn/2425/congress/online/onlines11/4NCLonline11all.pgn"
        ));
    }
}
