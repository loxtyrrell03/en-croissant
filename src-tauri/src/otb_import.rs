use std::{
    collections::{HashMap, HashSet},
    fs::{create_dir_all, File},
    io::{BufRead, BufReader, Cursor, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

use chrono::{Datelike, Utc};
use futures_util::future::{self, BoxFuture, Either};
use futures_util::stream::FuturesUnordered;
use futures_util::{stream, StreamExt};
use pgn_reader::{BufferedReader as PgnReader, SanPlus, Skip, Visitor};
use reqwest::header::{COOKIE, SET_COOKIE};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use tauri_specta::Event;

#[path = "otb_import/index.rs"]
mod index;

use index::{archive_index_path, ArchiveFormat};

const LICHESS_BROADCAST_LIST: &str = "https://database.lichess.org/broadcast/list.txt";
const TWIC_ARCHIVE: &str = "https://theweekinchess.com/twic";
const CHESSBASE_SEARCH: &str = "https://en.chessbase.com/search";
const CHESSBASE_ORIGIN: &str = "https://en.chessbase.com";
const CHESS_RESULTS_PLAYER_SEARCH: &str = "https://s1.chess-results.com/partiesuche.aspx?lan=1";
/// The Chess-Results row-limit dropdown posts option INDEXES, not row counts:
/// "1"=250, "2"=500, "3"=1000, "5"=2000. Anything else — including a literal
/// row count — makes the server answer 500. "5" selects the 2000-row maximum.
const CHESS_RESULTS_MAX_ROWS: &str = "5";
/// Lichess documents page 20 as the upper bound for broadcast listings.
const LICHESS_COMMUNITY_MAX_PAGES: u32 = 20;
/// A finished tour's PGN can still gain a few late corrections, so only tours
/// that ended comfortably in the past are cached as immutable.
const LICHESS_COMMUNITY_CACHE_SETTLE: Duration = Duration::from_secs(14 * 24 * 60 * 60);
const FOUR_NCL_PGN_INDEX: &str = "https://www.4ncl.co.uk/pgn-replay.htm";
const FOUR_NCL_ORIGIN: &str = "https://www.4ncl.co.uk";
const CHESSCOPE_ORIGIN: &str = "https://chesscope.com";
const BRITBASE_ORIGINS: &[&str] = &["https://www.saund.org.uk", "https://www.saund.co.uk"];
const PGN_MENTOR_INDEX: &str = "https://www.pgnmentor.com/files.html?outpost=1";
const USER_AGENT: &str = "En Croissant OTB importer/0.4";

/// Bounded fan-out for general archive hosts. Downloads dominate the wall clock,
/// so archives are fetched concurrently and merged in their sorted order.
const ARCHIVE_CONCURRENCY: usize = 8;
const BRITBASE_CONCURRENCY: usize = 32;
/// Lichess work keeps modest CPU fan-out, while the network helper below
/// serializes requests as required by Lichess's published API guidance.
const LICHESS_CONCURRENCY: usize = 8;
/// Minimum spacing between lichess requests across every concurrent task, so the
/// lane stays around eight requests a second instead of bursting.
const LICHESS_MIN_REQUEST_SPACING: Duration = Duration::from_millis(120);
/// A dead upstream must not make an indexed all-source search look frozen.
/// Connection setup and gaps between response chunks are bounded separately,
/// so large PGNs can still download for as long as they keep transferring.
const NETWORK_CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
const NETWORK_READ_STALL_TIMEOUT: Duration = Duration::from_secs(6);
/// Search/index pages are small. A per-page deadline prevents a host that
/// accepts a socket but never serves a body from holding a source lane open.
const DISCOVERY_PAGE_TIMEOUT: Duration = Duration::from_secs(6);
/// Respect a Lichess cooldown without parking an interactive search behind it.
/// Cached/indexed data remains available and a later search can refresh it.
const MAX_INTERACTIVE_LICHESS_WAIT: Duration = Duration::from_secs(2);
/// Upper bound on an honoured `Retry-After`, so one header cannot stall a run.
const MAX_RETRY_AFTER_SECONDS: u64 = 120;
/// Discovery pages (search results, archive indexes) move slowly but are not
/// immutable, so a cached copy is only reused while it is fresh.
const PAGE_CACHE_MAX_AGE: Duration = Duration::from_secs(60 * 60);
/// Season aggregates such as the 4NCL "all games" PGNs keep growing, so their
/// cached copies expire rather than pinning a half-finished season.
const GROWING_ARCHIVE_CACHE_MAX_AGE: Duration = Duration::from_secs(6 * 60 * 60);

const BRITBASE_INDEXES: &[(&str, u16)] = &[
    ("/britbase/brit2020.htm", 2020),
    ("/britbase/brit2010.htm", 2010),
    ("/britbase/brit2000.htm", 2000),
    ("/britbase/brit90.htm", 1990),
    ("/britbase/brit80.htm", 1980),
    ("/britbase/brit70.htm", 1970),
    ("/britbase/brit60.htm", 1960),
    ("/britbase/brit50.htm", 1950),
    ("/britbase/brit40.htm", 1940),
    ("/britbase/brit30.htm", 1930),
    ("/britbase/brit20.htm", 1920),
    ("/britbase/britpre1920.html", 0),
];

#[derive(Clone, Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OtbImportRequest {
    pub job_id: String,
    pub player_name: String,
    pub fide_id: Option<String>,
    pub from_year: u16,
    pub include_lichess_broadcasts: bool,
    #[serde(default)]
    pub include_lichess_broadcast_archives: bool,
    #[serde(default)]
    pub include_lichess_community_broadcasts: bool,
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
    pub cancelled: bool,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overall_current: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overall_total: Option<u32>,
}

static OTB_IMPORT_CANCELLATIONS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    OnceLock::new();

fn cancellation_registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    OTB_IMPORT_CANCELLATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_cancellations() -> std::sync::MutexGuard<'static, HashMap<String, Arc<AtomicBool>>> {
    cancellation_registry()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Owns one registry entry and removes only that exact run on drop. This keeps
/// validation or output errors from leaving a stale cancellable job behind.
struct CancellationRegistration {
    job_id: String,
    signal: Arc<AtomicBool>,
}

impl CancellationRegistration {
    fn new(job_id: &str) -> Result<Self, String> {
        let job_id = job_id.trim();
        if job_id.is_empty() {
            return Err("The OTB search job ID is missing.".to_string());
        }
        let mut registry = lock_cancellations();
        if registry.contains_key(job_id) {
            return Err("An OTB search with this job ID is already running.".to_string());
        }
        let signal = Arc::new(AtomicBool::new(false));
        registry.insert(job_id.to_string(), signal.clone());
        Ok(Self {
            job_id: job_id.to_string(),
            signal,
        })
    }
}

impl Drop for CancellationRegistration {
    fn drop(&mut self) {
        let mut registry = lock_cancellations();
        if registry
            .get(&self.job_id)
            .is_some_and(|signal| Arc::ptr_eq(signal, &self.signal))
        {
            registry.remove(&self.job_id);
        }
    }
}

async fn wait_for_cancellation(signal: Arc<AtomicBool>) {
    while !signal.load(Ordering::Acquire) {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Stops outstanding source requests. The collector still sorts and writes
/// the games already merged into its shared collection before returning.
#[tauri::command]
#[specta::specta]
pub fn cancel_otb_games(job_id: String) -> bool {
    let signal = lock_cancellations().get(job_id.trim()).cloned();
    if let Some(signal) = signal {
        signal.store(true, Ordering::Release);
        true
    } else {
        false
    }
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
    mainline_moves: String,
}

#[derive(Default)]
struct Collection {
    games: Vec<CollectedGame>,
    identity_fingerprints: HashMap<String, Vec<usize>>,
    broad_fingerprints: HashMap<String, Vec<usize>>,
    move_fingerprints: HashMap<String, Vec<usize>>,
    duplicates_removed: u32,
    suspected_online_games_excluded: u32,
    identity_mismatches_excluded: u32,
}

impl Collection {
    /// Folds one archive's scan into the shared collection and reports
    /// `(matched, unique_added)`. Archives download concurrently but are merged
    /// in their sorted order, so deduplication stays deterministic.
    fn merge(&mut self, outcome: ScanOutcome, source: &str) -> (u32, u32) {
        self.suspected_online_games_excluded = self
            .suspected_online_games_excluded
            .saturating_add(outcome.suspected_online_games_excluded);
        self.identity_mismatches_excluded = self
            .identity_mismatches_excluded
            .saturating_add(outcome.identity_mismatches_excluded);
        let before = self.games.len();
        for game in outcome.games {
            add_game(self, game.pgn, source, &game.side);
        }
        let added = self
            .games
            .len()
            .saturating_sub(before)
            .min(u32::MAX as usize) as u32;
        (outcome.matched, added)
    }
}

/// Sources scan concurrently, so the shared collection lives behind a lock;
/// merges are short CPU bursts and the guard is never held across an await.
fn lock_collection(collection: &Mutex<Collection>) -> std::sync::MutexGuard<'_, Collection> {
    collection
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn games_len(collection: &Mutex<Collection>) -> usize {
    lock_collection(collection).games.len()
}

fn merge_into(collection: &Mutex<Collection>, outcome: ScanOutcome, source: &str) -> (u32, u32) {
    lock_collection(collection).merge(outcome, source)
}

/// One archive's scan result, kept detached from [`Collection`] so the CPU-heavy
/// decompress-and-parse step can run on the blocking pool without shared state.
/// A failure part-way through an archive is carried in `error`, never by
/// discarding the games that were already parsed.
#[derive(Default, Deserialize, Serialize)]
struct ScanOutcome {
    matched: u32,
    suspected_online_games_excluded: u32,
    identity_mismatches_excluded: u32,
    games: Vec<PendingGame>,
    error: Option<String>,
}

impl ScanOutcome {
    /// An archive that could not be opened at all: no games, just the error.
    fn failed(error: String) -> Self {
        Self {
            error: Some(error),
            ..Self::default()
        }
    }

    fn absorb(&mut self, other: ScanOutcome) {
        self.matched = self.matched.saturating_add(other.matched);
        self.suspected_online_games_excluded = self
            .suspected_online_games_excluded
            .saturating_add(other.suspected_online_games_excluded);
        self.identity_mismatches_excluded = self
            .identity_mismatches_excluded
            .saturating_add(other.identity_mismatches_excluded);
        self.games.extend(other.games);
        if self.error.is_none() {
            self.error = other.error;
        }
    }
}

#[derive(Deserialize, Serialize)]
struct PendingGame {
    pgn: String,
    side: String,
}

#[derive(Clone, Debug)]
struct PlayerIdentity {
    canonical_name: String,
    fide_id: Option<String>,
    /// Surname anchor tokens: the comma-form surname when one was given,
    /// otherwise the outer tokens of the typed name (either end could be the
    /// surname in "Given Surname" or "Surname Given" order).
    surname_tokens: Vec<String>,
    /// Every normalized name token in order, single-letter initials included.
    name_tokens: Vec<String>,
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
        let name_tokens = player_name_tokens(&canonical_name);
        let full_token_count = name_tokens.iter().filter(|token| token.len() > 1).count();
        if name_tokens.len() < 2 || full_token_count == 0 {
            return Err("Enter at least a first name and surname.".to_string());
        }
        let mut surname_tokens = canonical_name
            .split_once(',')
            .map(|(surname, _)| player_name_tokens(surname))
            .unwrap_or_default();
        if surname_tokens.is_empty() {
            surname_tokens = [name_tokens.first(), name_tokens.last()]
                .into_iter()
                .flatten()
                .cloned()
                .collect();
            surname_tokens.dedup();
        }

        Ok(Self {
            canonical_name,
            fide_id,
            surname_tokens,
            name_tokens,
        })
    }

    /// Whether `candidate` plausibly names this player. Public archives
    /// disagree about how much of a name they print — "Tyrrell, Lachlan Baly
    /// Hughes" appears elsewhere as "Tyrrell, Lachlan", "Lachlan Tyrrell", or
    /// "Tyrrell, L.B.H." — so the shorter form only has to be contained in the
    /// longer one (with initials standing in for the names they abbreviate),
    /// anchored on the surname so shared given names alone never match.
    fn name_matches(&self, candidate: &str) -> bool {
        let candidate_tokens = player_name_tokens(candidate);
        if candidate_tokens.len() < 2 {
            return false;
        }
        // Arbiters mistype surnames ("Tyrell" for "Tyrrell"), so one edit is
        // tolerated — but only when a FIDE ID pins exactly who is meant, so a
        // name-only search can never drift onto a similarly-named stranger.
        // A game whose same-side FIDE ID conflicts is rejected regardless.
        let allow_fuzzy = self.fide_id.is_some();
        if !self.surname_tokens.iter().any(|anchor| {
            candidate_tokens
                .iter()
                .any(|token| token == anchor || (allow_fuzzy && fuzzy_token_eq(anchor, token)))
        }) {
            return false;
        }
        if candidate_tokens.len() <= self.name_tokens.len() {
            tokens_subsume(&candidate_tokens, &self.name_tokens, allow_fuzzy)
        } else {
            tokens_subsume(&self.name_tokens, &candidate_tokens, allow_fuzzy)
        }
    }
}

/// True when every token of `smaller` claims a distinct token of `larger`,
/// either verbatim or as an initial of it (in either direction) — plus, when
/// `allow_fuzzy` is set, with one typo of tolerance. Verbatim pairs are
/// claimed first so an initial can never steal the token a full name needs.
fn tokens_subsume(smaller: &[String], larger: &[String], allow_fuzzy: bool) -> bool {
    let mut used = vec![false; larger.len()];
    let mut relaxed_pending = Vec::new();
    for token in smaller {
        let exact = larger
            .iter()
            .enumerate()
            .find(|(index, candidate)| !used[*index] && *candidate == token);
        match exact {
            Some((index, _)) => used[index] = true,
            None => relaxed_pending.push(token),
        }
    }
    for token in relaxed_pending {
        let by_relaxed = larger.iter().enumerate().find(|(index, candidate)| {
            !used[*index]
                && (initial_matches(token, candidate)
                    || (allow_fuzzy && fuzzy_token_eq(token, candidate)))
        });
        match by_relaxed {
            Some((index, _)) => used[index] = true,
            None => return false,
        }
    }
    true
}

fn initial_matches(left: &str, right: &str) -> bool {
    (left.chars().count() == 1 && right.starts_with(left))
        || (right.chars().count() == 1 && left.starts_with(right))
}

/// One typo of tolerance for long-enough tokens: a single substituted,
/// inserted, or dropped letter. Short tokens stay exact — one edit on a short
/// name changes who it is.
fn fuzzy_token_eq(left: &str, right: &str) -> bool {
    let left_chars: Vec<char> = left.chars().collect();
    let right_chars: Vec<char> = right.chars().collect();
    if left_chars.len().min(right_chars.len()) < 5 {
        return false;
    }
    match left_chars.len().abs_diff(right_chars.len()) {
        0 => {
            left_chars
                .iter()
                .zip(&right_chars)
                .filter(|(a, b)| a != b)
                .count()
                == 1
        }
        1 => {
            let (short, long) = if left_chars.len() < right_chars.len() {
                (&left_chars, &right_chars)
            } else {
                (&right_chars, &left_chars)
            };
            let split = short
                .iter()
                .zip(long.iter())
                .take_while(|(a, b)| a == b)
                .count();
            short[split..] == long[split + 1..]
        }
        _ => false,
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
    collect_otb_games_with_runtime(request, app).await
}

pub async fn collect_otb_games_with_runtime<R: tauri::Runtime>(
    request: OtbImportRequest,
    app: tauri::AppHandle<R>,
) -> Result<OtbImportReport, String> {
    let progress = |event: OtbImportProgress| {
        let _ = event.emit(&app);
    };
    collect_otb_games_with_progress(request, &progress).await
}

type OtbProgressSink<'a> = dyn Fn(OtbImportProgress) + Sync + 'a;

pub async fn collect_otb_games_with_progress(
    request: OtbImportRequest,
    app: &OtbProgressSink<'_>,
) -> Result<OtbImportReport, String> {
    let current_year = Utc::now().year().max(2020) as u16;
    if request.from_year < 1900 || request.from_year > current_year {
        return Err(format!(
            "The start year must be between 1900 and {current_year}."
        ));
    }
    if !request.include_lichess_broadcasts
        && !request.include_lichess_broadcast_archives
        && !request.include_lichess_community_broadcasts
        && !request.include_chess_results
        && !request.include_chessbase_news
        && !request.include_official_pgn_indexes
        && !request.include_twic
        && request.local_pgn_paths.is_empty()
    {
        return Err("Select at least one OTB game source.".to_string());
    }

    let identity = Arc::new(PlayerIdentity::new(
        &request.player_name,
        request.fide_id.as_deref(),
    )?);
    lichess_failed_hosts()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clear();
    let cancellation = CancellationRegistration::new(&request.job_id)?;
    create_dir_all(&request.cache_dir).map_err(|error| error.to_string())?;
    let index_path = archive_index_path(&request.cache_dir);
    if !index_path.exists() {
        let _ = index::initialize(&index_path).await;
    }
    if let Some(parent) = request.output_path.parent() {
        create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    // No total request timeout: monthly broadcast dumps and TWIC zips can be
    // large on slow links. The read timeout only fires when a transfer stalls.
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(NETWORK_CONNECT_TIMEOUT)
        .read_timeout(NETWORK_READ_STALL_TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?;
    let collection = Mutex::new(Collection::default());
    let mut reports = Vec::new();
    let mut cancelled = false;

    // Every source lane runs concurrently: the wall clock follows the slowest
    // single lane instead of the sum of all of them. Each lane merges into the
    // shared collection as its archives finish, so cross-source deduplication
    // still happens on the fly, and the shared lichess pacing lane keeps the
    // combined request rate polite. Reports keep a fixed order via the index.
    {
        let client = &client;
        let request = &request;
        let identity = &identity;
        let collection = &collection;
        let app = &app;
        let mut lanes: FuturesUnordered<BoxFuture<'_, (usize, OtbImportSourceReport)>> =
            FuturesUnordered::new();

        if !request.local_pgn_paths.is_empty() {
            let index = lanes.len();
            lanes.push(Box::pin(finish_lane(
                index,
                scan_local_pgn_sources(request, identity, collection, app),
                app,
                request,
                collection,
            )));
        }
        if request.include_chess_results {
            let index = lanes.len();
            lanes.push(Box::pin(finish_lane(
                index,
                scan_chess_results(client, request, identity, collection, app),
                app,
                request,
                collection,
            )));
        }
        if request.include_lichess_broadcasts {
            let index = lanes.len();
            lanes.push(Box::pin(finish_lane(
                index,
                scan_lichess_fide_broadcasts(client, request, identity, collection, app),
                app,
                request,
                collection,
            )));
            let index = lanes.len();
            lanes.push(Box::pin(finish_lane(
                index,
                scan_chessscope_broadcasts(client, request, identity, collection, app),
                app,
                request,
                collection,
            )));
        }
        if request.include_lichess_broadcast_archives {
            let index = lanes.len();
            lanes.push(Box::pin(finish_lane(
                index,
                scan_lichess_broadcasts(client, request, identity, collection, app),
                app,
                request,
                collection,
            )));
        }
        if request.include_lichess_community_broadcasts {
            let index = lanes.len();
            lanes.push(Box::pin(finish_lane(
                index,
                scan_lichess_community_broadcasts(client, request, identity, collection, app),
                app,
                request,
                collection,
            )));
        }
        if request.include_chessbase_news {
            let index = lanes.len();
            lanes.push(Box::pin(finish_lane(
                index,
                scan_chessbase_news(client, request, identity, collection, app),
                app,
                request,
                collection,
            )));
        }
        if request.include_official_pgn_indexes {
            let index = lanes.len();
            lanes.push(Box::pin(finish_lane(
                index,
                scan_4ncl_otb_archive(client, request, identity, collection, app),
                app,
                request,
                collection,
            )));
            let index = lanes.len();
            lanes.push(Box::pin(finish_lane(
                index,
                scan_britbase(client, request, identity, collection, app),
                app,
                request,
                collection,
            )));
            let index = lanes.len();
            lanes.push(Box::pin(finish_lane(
                index,
                scan_pgn_mentor(client, request, identity, collection, app),
                app,
                request,
                collection,
            )));
        }
        if request.include_twic {
            let index = lanes.len();
            lanes.push(Box::pin(finish_lane(
                index,
                scan_twic(client, request, identity, collection, app),
                app,
                request,
                collection,
            )));
        }

        let lane_total = lanes.len();
        emit_overall_progress(
            app,
            request,
            "starting",
            0,
            lane_total,
            0,
            format!("Searching {} public source lanes in parallel", lanes.len()),
        );
        let mut finished = Vec::new();
        while !lanes.is_empty() {
            let next_lane = Box::pin(lanes.next());
            let stop_requested = Box::pin(wait_for_cancellation(cancellation.signal.clone()));
            match future::select(next_lane, stop_requested).await {
                Either::Left((Some(result), _)) => {
                    finished.push(result);
                    emit_overall_progress(
                        app,
                        request,
                        "searching",
                        finished.len(),
                        lane_total,
                        games_len(collection),
                        format!("{} of {} source lanes finished", finished.len(), lane_total),
                    );
                }
                Either::Left((None, _)) => break,
                Either::Right(((), pending_lane)) => {
                    drop(pending_lane);
                    cancelled = true;
                    break;
                }
            }
        }
        drop(lanes);
        finished.sort_by_key(|(index, _)| *index);
        reports.extend(finished.into_iter().map(|(_, report)| report));
    }

    // All archive writers have finished, so fold the temporary WAL back into
    // the compact corpus before returning to the desktop or phone service.
    let _ = index::checkpoint(&index_path, false).await;

    let mut collection = collection
        .into_inner()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

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
        if cancelled { "cancelled" } else { "complete" },
        1,
        1,
        collection.games.len(),
        if cancelled {
            format!(
                "Search stopped — keeping {} unique OTB games found so far",
                collection.games.len()
            )
        } else {
            format!("Found {} unique OTB games", collection.games.len())
        },
    );

    Ok(OtbImportReport {
        player_name: identity.canonical_name.clone(),
        fide_id: identity.fide_id.clone(),
        output_path: request.output_path.to_string_lossy().into_owned(),
        cancelled,
        games_found: collection.games.len().min(u32::MAX as usize) as u32,
        duplicates_removed: collection.duplicates_removed,
        suspected_online_games_excluded: collection.suspected_online_games_excluded,
        identity_mismatches_excluded: collection.identity_mismatches_excluded,
        newest_game,
        sources: reports,
    })
}

/// Awaits one source lane, then announces its completion so the UI can mark
/// the lane done the moment it finishes rather than when the whole run ends.
async fn finish_lane<F>(
    index: usize,
    scan: F,
    app: &OtbProgressSink<'_>,
    request: &OtbImportRequest,
    collection: &Mutex<Collection>,
) -> (usize, OtbImportSourceReport)
where
    F: std::future::Future<Output = OtbImportSourceReport>,
{
    let report = scan.await;
    emit_progress(
        app,
        request,
        &report.source,
        "done",
        1,
        1,
        games_len(collection),
        format!(
            "{} finished — {} unique game{} added",
            report.source,
            report.unique_games_added,
            if report.unique_games_added == 1 {
                ""
            } else {
                "s"
            }
        ),
    );
    (index, report)
}

async fn scan_local_pgn_sources(
    request: &OtbImportRequest,
    identity: &Arc<PlayerIdentity>,
    collection: &Mutex<Collection>,
    app: &OtbProgressSink<'_>,
) -> OtbImportSourceReport {
    const SOURCE: &str = "Local PGN / ChessBase export";
    let mut report = OtbImportSourceReport::new(SOURCE);
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
            SOURCE,
            "scanning",
            index,
            total,
            games_len(collection),
            format!("Scanning {label}"),
        );

        // Reading and parsing a local archive is blocking, CPU-heavy work; it
        // runs on the blocking pool so the async runtime stays responsive.
        let path = path.clone();
        let identity = Arc::clone(identity);
        let from_year = request.from_year;
        let scan_label = label.clone();
        let result = tokio::task::spawn_blocking(move || {
            scan_local_path(&path, &identity, &scan_label, from_year)
        })
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| result);

        match result {
            Ok(mut outcome) => {
                if let Some(error) = outcome.error.take() {
                    report.errors.push(format!("{label}: {error}"));
                }
                let (matched, added) = merge_into(collection, outcome, SOURCE);
                report.matched_games = report.matched_games.saturating_add(matched);
                report.unique_games_added = report.unique_games_added.saturating_add(added);
            }
            Err(error) => report.errors.push(format!("{label}: {error}")),
        }
    }

    report
}

async fn scan_lichess_fide_broadcasts(
    client: &Client,
    request: &OtbImportRequest,
    identity: &Arc<PlayerIdentity>,
    collection: &Mutex<Collection>,
    app: &OtbProgressSink<'_>,
) -> OtbImportSourceReport {
    const SOURCE: &str = "Lichess live FIDE broadcasts";
    let mut report = OtbImportSourceReport::new(SOURCE);
    let Some(fide_id) = identity.fide_id.as_deref() else {
        report
            .errors
            .push("Live Lichess tournament discovery requires a FIDE ID.".to_string());
        return report;
    };
    // Completed monthly broadcast dumps already contain every historical
    // Lichess broadcast. The live FIDE lane only needs the gap after the newest
    // dump that is actually present in our corpus; downloading dozens of full
    // historical tours again adds no games and dominates new-player searches.
    let live_cutoff = lichess_live_cutoff(request).await;
    let mut round_paths = HashSet::new();

    for page in 1..=20u32 {
        emit_progress(
            app,
            request,
            SOURCE,
            "discovering",
            page.saturating_sub(1) as usize,
            20,
            games_len(collection),
            format!("Checking Lichess FIDE tournament page {page}"),
        );
        let page_url = format!("https://lichess.org/fide/{fide_id}/player?page={page}");
        let cache_path = request
            .cache_dir
            .join(cache_file_name("lichess-fide-page", &page_url));
        let bytes = match fetch_lichess_cached_within(
            client,
            &page_url,
            &cache_path,
            Some(PAGE_CACHE_MAX_AGE),
        )
        .await
        {
            Ok((bytes, _)) => bytes,
            Err(error) => {
                report.errors.push(error);
                break;
            }
        };
        let html = String::from_utf8_lossy(&bytes).into_owned();
        let paths = extract_lichess_round_paths_since(&html, &live_cutoff);
        let page_reaches_before_range =
            extract_quoted_values(&html, "datetime=")
                .into_iter()
                .any(|value| {
                    value
                        .get(..10)
                        .is_some_and(|date| date < live_cutoff.as_str())
                });
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
    let mut round_lookups = stream::iter(round_paths.into_iter().map(|round_path| {
        let client = client.clone();
        let api_url = format!("https://lichess.org/api{round_path}");
        let cache_path = request
            .cache_dir
            .join(cache_file_name("lichess-fide-round", &api_url));
        async move {
            let value = async {
                let (bytes, _) = fetch_lichess_cached_within(
                    &client,
                    &api_url,
                    &cache_path,
                    Some(PAGE_CACHE_MAX_AGE),
                )
                .await?;
                serde_json::from_slice::<serde_json::Value>(&bytes)
                    .map_err(|error| error.to_string())
            }
            .await;
            (api_url, value)
        }
    }))
    .buffered(LICHESS_CONCURRENCY);
    while let Some((api_url, result)) = round_lookups.next().await {
        let value = match result {
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
    // The six-hour refresh window keeps a currently-running tour fresh while
    // avoiding the old behavior of redownloading every historical tour for
    // every search.
    let specs = tours
        .into_iter()
        .map(|(tour_id, _)| {
            let url = format!("https://lichess.org/api/broadcast/{tour_id}.pgn");
            let cache_path = request
                .cache_dir
                .join(cache_file_name("lichess-broadcast", &url));
            IndexedArchiveSpec::lichess(url, cache_path)
        })
        .collect();
    scan_indexed_archives(
        client,
        request,
        identity,
        collection,
        app,
        SOURCE,
        &mut report,
        specs,
        Some(GROWING_ARCHIVE_CACHE_MAX_AGE),
        LICHESS_CONCURRENCY,
    )
    .await;

    report
}

/// Parses a downloaded PGN payload on the blocking pool. A parse failure comes
/// back inside the outcome — the archive still counts as downloaded and every
/// game read before the failure is kept.
async fn scan_pgn_bytes(
    bytes: Vec<u8>,
    identity: Arc<PlayerIdentity>,
    source: &'static str,
    source_url: String,
    from_year: u16,
) -> ScanOutcome {
    tokio::task::spawn_blocking(move || {
        scan_pgn_reader(
            BufReader::new(Cursor::new(bytes)),
            &identity,
            source,
            &source_url,
            from_year,
        )
    })
    .await
    .unwrap_or_else(|error| ScanOutcome::failed(error.to_string()))
}

/// Decompresses and parses a zstd-compressed PGN archive on the blocking pool.
async fn scan_zst_bytes(
    bytes: Vec<u8>,
    identity: Arc<PlayerIdentity>,
    source: &'static str,
    source_url: String,
    from_year: u16,
) -> ScanOutcome {
    tokio::task::spawn_blocking(move || {
        match zstd::stream::read::Decoder::new(Cursor::new(bytes)) {
            Ok(decoder) => scan_pgn_reader(
                BufReader::new(decoder),
                &identity,
                source,
                &source_url,
                from_year,
            ),
            Err(error) => ScanOutcome::failed(error.to_string()),
        }
    })
    .await
    .unwrap_or_else(|error| ScanOutcome::failed(error.to_string()))
}

/// Unpacks and parses a zip of PGNs on the blocking pool.
async fn scan_zip_bytes(
    bytes: Vec<u8>,
    identity: Arc<PlayerIdentity>,
    source: &'static str,
    source_url: String,
    from_year: u16,
) -> ScanOutcome {
    tokio::task::spawn_blocking(move || {
        scan_zip_pgns(bytes, &identity, source, &source_url, from_year)
            .unwrap_or_else(ScanOutcome::failed)
    })
    .await
    .unwrap_or_else(|error| ScanOutcome::failed(error.to_string()))
}

/// Picks the zip or plain-PGN reader from the archive URL, off the async runtime.
async fn scan_archive_bytes(
    bytes: Vec<u8>,
    identity: Arc<PlayerIdentity>,
    source: &'static str,
    source_url: String,
    from_year: u16,
) -> ScanOutcome {
    match archive_format_from_url(&source_url) {
        ArchiveFormat::Zip => scan_zip_bytes(bytes, identity, source, source_url, from_year).await,
        ArchiveFormat::Pgn => scan_pgn_bytes(bytes, identity, source, source_url, from_year).await,
        ArchiveFormat::Zstd => scan_zst_bytes(bytes, identity, source, source_url, from_year).await,
    }
}

fn archive_format_from_url(url: &str) -> ArchiveFormat {
    let lower = url.split('?').next().unwrap_or(url).to_ascii_lowercase();
    if lower.ends_with(".zip") {
        ArchiveFormat::Zip
    } else if lower.ends_with(".zst") {
        ArchiveFormat::Zstd
    } else {
        ArchiveFormat::Pgn
    }
}

#[derive(Clone)]
struct IndexedArchiveSpec {
    url: String,
    label: String,
    cache_path: PathBuf,
    format: ArchiveFormat,
    optional: bool,
    lichess: bool,
}

impl IndexedArchiveSpec {
    fn immutable(url: String, cache_path: PathBuf, format: ArchiveFormat) -> Self {
        Self {
            label: file_name_from_url(&url),
            url,
            cache_path,
            format,
            optional: false,
            lichess: false,
        }
    }

    fn lichess(url: String, cache_path: PathBuf) -> Self {
        Self {
            label: file_name_from_url(&url),
            url,
            cache_path,
            format: ArchiveFormat::Pgn,
            optional: false,
            lichess: true,
        }
    }
}

struct IndexedArchiveAttempt {
    spec: IndexedArchiveSpec,
    cached: bool,
    outcome: Option<ScanOutcome>,
    error: Option<String>,
}

/// Scans a set of archives through the persistent corpus index. Immutable files
/// are parsed exactly once across every player search. Growing files can pass a
/// maximum age, which expires both their downloaded bytes and indexed content.
///
/// The archive cache remains the source-of-truth fallback: if the SQLite query
/// fails, indexed hits are read and filtered directly with the same matcher.
/// An index failure can therefore cost time, but never silently reduce results.
async fn scan_indexed_archives(
    client: &Client,
    request: &OtbImportRequest,
    identity: &Arc<PlayerIdentity>,
    collection: &Mutex<Collection>,
    app: &OtbProgressSink<'_>,
    source: &'static str,
    report: &mut OtbImportSourceReport,
    specs: Vec<IndexedArchiveSpec>,
    max_age: Option<Duration>,
    concurrency: usize,
) {
    if specs.is_empty() {
        return;
    }

    let index_path = archive_index_path(&request.cache_dir);
    let urls = specs
        .iter()
        .map(|spec| spec.url.clone())
        .collect::<Vec<_>>();
    let mut indexed = match index::indexed_urls(&index_path, &urls, max_age).await {
        Ok(indexed) => indexed,
        Err(error) => {
            report.errors.push(format!("Archive index: {error}"));
            HashSet::new()
        }
    };
    let fresh_pending = specs
        .iter()
        .filter(|spec| !indexed.contains(&spec.url))
        .collect::<Vec<_>>();
    let preflight_circuit_open = fresh_pending.len() >= concurrency.max(1)
        && fresh_pending.first().is_some_and(|spec| !spec.lichess)
        && !archive_host_responds(client, &fresh_pending[0].url).await;
    if preflight_circuit_open {
        // An expired index is still the highest-quality answer available while
        // its host is offline. Re-enable all complete stale rows in one query;
        // raw cache entries without index rows are handled locally below.
        if max_age.is_some() {
            if let Ok(stale_indexed) = index::indexed_urls(&index_path, &urls, None).await {
                indexed.extend(stale_indexed);
            }
        }
        report.errors.push(format!(
            "{source} archive host did not answer one bounded health probe; stale indexed and cached games were kept without retrying every URL."
        ));
    }
    // Indexed archives do not need one future (and one progress event) apiece.
    // Seed their attempts directly, query them in one SQLite operation below,
    // and reserve the network fan-out for genuinely missing/stale artifacts.
    let mut attempts = specs
        .iter()
        .filter(|spec| indexed.contains(&spec.url))
        .cloned()
        .map(|spec| {
            (
                spec.url.clone(),
                IndexedArchiveAttempt {
                    spec,
                    cached: true,
                    outcome: None,
                    error: None,
                },
            )
        })
        .collect::<HashMap<_, _>>();
    let pending_specs = specs
        .iter()
        .filter(|spec| !indexed.contains(&spec.url))
        .cloned()
        .collect::<Vec<_>>();
    let started = AtomicUsize::new(0);
    let games_found = AtomicUsize::new(games_len(collection));
    let total = pending_specs.len();
    let mut scans = stream::iter(pending_specs.into_iter().map(|spec| {
        let client = client.clone();
        let identity = Arc::clone(identity);
        let index_path = index_path.clone();
        let started = &started;
        let games_found = &games_found;
        async move {
            let position = started.fetch_add(1, Ordering::Relaxed);
            emit_progress(
                app,
                request,
                source,
                "downloading",
                position,
                total,
                games_found.load(Ordering::Relaxed),
                format!("Indexing {} of {} missing archives", position + 1, total),
            );
            let fetched = if preflight_circuit_open {
                Ok(read_cache_entry(&spec.cache_path, None)
                    .await
                    .map(|bytes| (bytes, true)))
            } else {
                fetch_indexed_archive(&client, &spec, max_age).await
            };
            match fetched {
                Ok(Some((bytes, cached))) => {
                    let indexed = index::index_and_scan(
                        &index_path,
                        spec.url.clone(),
                        bytes,
                        spec.format,
                        identity,
                        source,
                        request.from_year,
                    )
                    .await;
                    IndexedArchiveAttempt {
                        spec,
                        cached,
                        outcome: Some(indexed.outcome),
                        error: indexed.index_error.map(|error| format!("index: {error}")),
                    }
                }
                Ok(None) => IndexedArchiveAttempt {
                    error: (!spec.optional).then(|| "not found".to_string()),
                    spec,
                    cached: false,
                    outcome: None,
                },
                Err(error) => IndexedArchiveAttempt {
                    spec,
                    cached: false,
                    outcome: None,
                    error: Some(error),
                },
            }
        }
    }))
    .buffered(concurrency);

    let mut consecutive_transport_failures = 0usize;
    let mut unreachable_host_circuit_open = preflight_circuit_open;
    while let Some(attempt) = scans.next().await {
        if attempt.error.as_deref().is_some_and(is_transport_failure) {
            consecutive_transport_failures += 1;
        } else {
            consecutive_transport_failures = 0;
        }
        attempts.insert(attempt.spec.url.clone(), attempt);
        if consecutive_transport_failures >= concurrency.max(1) {
            unreachable_host_circuit_open = true;
            report.errors.push(format!(
                "{source} stopped retrying its unreachable archive host after {} consecutive transport failures; indexed and cached games were kept.",
                consecutive_transport_failures
            ));
            break;
        }
    }
    drop(scans);

    let mut indexed_hits = Vec::new();
    for spec in &specs {
        if indexed.contains(&spec.url) {
            indexed_hits.push(spec.url.clone());
        }
    }
    match index::query_indexed(
        &index_path,
        &indexed_hits,
        Arc::clone(identity),
        source,
        request.from_year,
    )
    .await
    {
        Ok(outcomes) => {
            for (url, outcome) in outcomes {
                if let Some(attempt) = attempts.get_mut(&url) {
                    attempt.outcome = Some(outcome);
                }
            }
        }
        Err(error) => {
            report.errors.push(format!("Archive index query: {error}"));
            let mut fallback_specs = Vec::new();
            for spec in &specs {
                if indexed.contains(&spec.url) {
                    fallback_specs.push(spec.clone());
                }
            }
            let mut fallbacks = stream::iter(fallback_specs.into_iter().map(|spec| {
                let client = client.clone();
                let identity = Arc::clone(identity);
                let index_path = index_path.clone();
                async move {
                    let result = fetch_indexed_archive(&client, &spec, max_age).await;
                    let attempt = match result {
                        Ok(Some((bytes, cached))) => {
                            let indexed = index::index_and_scan(
                                &index_path,
                                spec.url.clone(),
                                bytes,
                                spec.format,
                                identity,
                                source,
                                request.from_year,
                            )
                            .await;
                            IndexedArchiveAttempt {
                                spec,
                                cached,
                                outcome: Some(indexed.outcome),
                                error: indexed.index_error.map(|error| format!("index: {error}")),
                            }
                        }
                        Ok(None) => IndexedArchiveAttempt {
                            error: (!spec.optional).then(|| "not found".to_string()),
                            spec,
                            cached: false,
                            outcome: None,
                        },
                        Err(error) => IndexedArchiveAttempt {
                            spec,
                            cached: false,
                            outcome: None,
                            error: Some(error),
                        },
                    };
                    attempt
                }
            }))
            .buffered(concurrency);
            while let Some(attempt) = fallbacks.next().await {
                attempts.insert(attempt.spec.url.clone(), attempt);
            }
        }
    }

    for spec in specs {
        report.archives_checked = report.archives_checked.saturating_add(1);
        let Some(mut attempt) = attempts.remove(&spec.url) else {
            if !unreachable_host_circuit_open {
                report
                    .errors
                    .push(format!("{}: no archive result", spec.label));
            }
            continue;
        };
        if attempt.cached {
            report.cached_archives = report.cached_archives.saturating_add(1);
        }
        if let Some(error) = attempt.error {
            report.errors.push(format!("{}: {error}", spec.label));
        }
        let Some(mut outcome) = attempt.outcome.take() else {
            continue;
        };
        if let Some(error) = outcome.error.take() {
            report.errors.push(format!("{}: {error}", spec.label));
        }
        let (matched, added) = merge_into(collection, outcome, source);
        report.matched_games = report.matched_games.saturating_add(matched);
        report.unique_games_added = report.unique_games_added.saturating_add(added);
        games_found.store(games_len(collection), Ordering::Relaxed);
    }
}

async fn fetch_indexed_archive(
    client: &Client,
    spec: &IndexedArchiveSpec,
    max_age: Option<Duration>,
) -> Result<Option<(Vec<u8>, bool)>, String> {
    if spec.lichess {
        fetch_lichess_cached_within(client, &spec.url, &spec.cache_path, max_age)
            .await
            .map(Some)
    } else {
        fetch_cached_within(client, &spec.url, &spec.cache_path, max_age).await
    }
}

async fn archive_host_responds(client: &Client, url: &str) -> bool {
    client
        .head(url)
        .timeout(DISCOVERY_PAGE_TIMEOUT)
        .send()
        .await
        .is_ok()
}

async fn scan_chessscope_broadcasts(
    client: &Client,
    request: &OtbImportRequest,
    identity: &Arc<PlayerIdentity>,
    collection: &Mutex<Collection>,
    app: &OtbProgressSink<'_>,
) -> OtbImportSourceReport {
    const SOURCE: &str = "Chessscope broadcast discovery";
    let mut report = OtbImportSourceReport::new(SOURCE);
    emit_progress(
        app,
        request,
        SOURCE,
        "discovering",
        0,
        1,
        games_len(collection),
        "Resolving the player on Chessscope".to_string(),
    );

    let (search_html, chessscope_online) = match client
        .get(format!("{CHESSCOPE_ORIGIN}/search"))
        .query(&[("q", identity.canonical_name.as_str())])
        .timeout(DISCOVERY_PAGE_TIMEOUT)
        .send()
        .await
    {
        Ok(response) => match response.error_for_status() {
            Ok(response) => match response.text().await {
                Ok(html) => (html, true),
                Err(error) => {
                    report.errors.push(error.to_string());
                    (String::new(), false)
                }
            },
            Err(error) => {
                report.errors.push(error.to_string());
                (String::new(), false)
            }
        },
        Err(error) => {
            report.errors.push(error.to_string());
            (String::new(), false)
        }
    };
    report.archives_checked = 1;

    let mut player_urls = extract_quoted_values(&search_html, "href=")
        .into_iter()
        .filter(|href| href.starts_with("/player/") && !href.contains('?') && !href.contains('#'))
        .map(|href| format!("{CHESSCOPE_ORIGIN}{href}"))
        .collect::<HashSet<_>>();
    for slug in chessscope_slug_candidates(&identity.canonical_name) {
        player_urls.insert(format!("{CHESSCOPE_ORIGIN}/player/{slug}"));
    }

    let mut player_urls = player_urls.into_iter().collect::<Vec<_>>();
    player_urls.sort();
    player_urls.truncate(20);
    let total_candidates = player_urls.len();
    let started = AtomicUsize::new(0);
    let games_so_far = games_len(collection);
    // Player pages use the same short discovery TTL as other rolling indexes;
    // per-game pages remain immutable once published.
    let mut candidates = stream::iter(player_urls.into_iter().map(|player_url| {
        let client = client.clone();
        let cache_dir = request.cache_dir.clone();
        let started = &started;
        async move {
            let position = started.fetch_add(1, Ordering::Relaxed);
            emit_progress(
                app,
                request,
                SOURCE,
                "discovering",
                position,
                total_candidates,
                games_so_far,
                format!("Checking Chessscope player candidate {}", position + 1),
            );
            let html = if chessscope_online {
                fetch_page_cached(&client, &player_url, &cache_dir, "chessscope-player").await
            } else {
                read_page_cache_stale(&player_url, &cache_dir, "chessscope-player").await
            };
            (player_url, html)
        }
    }))
    .buffered(ARCHIVE_CONCURRENCY);

    let mut game_urls = HashMap::<String, Option<u16>>::new();
    while let Some((player_url, result)) = candidates.next().await {
        let html = match result {
            Ok(Some(html)) => html,
            Ok(None) => continue,
            Err(error) => {
                report.errors.push(format!("{player_url}: {error}"));
                continue;
            }
        };
        report.archives_checked = report.archives_checked.saturating_add(1);
        if !chessscope_page_matches_identity(&html, identity) {
            continue;
        }
        for (path, year) in extract_chessscope_games(&html, request.from_year) {
            let url = format!("{CHESSCOPE_ORIGIN}{path}");
            game_urls
                .entry(url)
                .and_modify(|existing| *existing = (*existing).max(year))
                .or_insert(year);
        }
    }

    let mut game_urls = game_urls.into_iter().collect::<Vec<_>>();
    game_urls.sort_by(|left, right| left.0.cmp(&right.0));
    let total_game_pages = game_urls.len();
    let mut game_pages = stream::iter(game_urls.into_iter().map(|(game_url, year)| {
        let client = client.clone();
        let cache_dir = request.cache_dir.clone();
        async move {
            let html = if chessscope_online {
                fetch_page_cached(&client, &game_url, &cache_dir, "chessscope").await
            } else {
                read_page_cache_stale(&game_url, &cache_dir, "chessscope").await
            };
            (game_url, year, html)
        }
    }))
    .buffered(ARCHIVE_CONCURRENCY);
    let mut rounds = HashMap::<String, (Option<u16>, Option<String>)>::new();
    let current_year = Utc::now().year().max(1900) as u16;
    let mut checked_game_pages = 0usize;
    let mut consecutive_transport_failures = 0usize;
    while let Some((game_url, year, result)) = game_pages.next().await {
        checked_game_pages += 1;
        emit_progress(
            app,
            request,
            SOURCE,
            "discovering",
            checked_game_pages,
            total_game_pages,
            games_len(collection),
            format!(
                "Resolving Chessscope broadcast game {} of {}",
                checked_game_pages, total_game_pages
            ),
        );
        match result {
            Ok(Some(html)) => {
                consecutive_transport_failures = 0;
                report.archives_checked = report.archives_checked.saturating_add(1);
                let game_date = extract_chessscope_game_date(&html);
                for round_path in extract_chessscope_round_paths(&html) {
                    rounds
                        .entry(round_path)
                        .and_modify(|(existing_year, existing_date)| {
                            *existing_year = (*existing_year).max(year);
                            if game_date > *existing_date {
                                *existing_date = game_date.clone();
                            }
                        })
                        .or_insert_with(|| (year, game_date.clone()));
                }
            }
            Ok(None) => consecutive_transport_failures = 0,
            Err(error) => {
                if is_transport_failure(&error) {
                    consecutive_transport_failures += 1;
                } else {
                    consecutive_transport_failures = 0;
                }
                report.errors.push(format!("{game_url}: {error}"));
                if consecutive_transport_failures >= ARCHIVE_CONCURRENCY {
                    report.errors.push(format!(
                        "Chessscope stopped retrying this unreachable host after {} consecutive transport failures; indexed and cached games were kept.",
                        consecutive_transport_failures
                    ));
                    break;
                }
            }
        }
    }

    let mut rounds = rounds.into_iter().collect::<Vec<_>>();
    rounds.sort_by(|left, right| left.0.cmp(&right.0));
    let mut historical_rounds = Vec::new();
    let mut recent_rounds = Vec::new();
    // Chessscope points back to Lichess broadcast rounds. Completed monthly
    // Lichess dumps already contain those exact historical broadcasts, so only
    // fetch a round whose game date falls in the not-yet-archived gap. Unknown
    // dates retain the original fetch path to avoid losing any result.
    let corpus_cutoff = lichess_live_cutoff(request).await;
    for (round_path, (year, game_date)) in rounds {
        // Some older Chessscope rows have a real event year but no exact game
        // date. The whole year is covered only when even its final day precedes
        // the verified monthly cutoff; otherwise retain the original fetch.
        if chessscope_round_is_in_corpus(year, game_date.as_deref(), &corpus_cutoff) {
            continue;
        }
        let recent = year.is_none_or(|year| year >= current_year);
        if recent {
            recent_rounds.push(round_path);
        } else {
            historical_rounds.push(round_path);
        }
    }
    let historical_specs = resolve_lichess_tour_specs(
        client,
        request,
        historical_rounds,
        &corpus_cutoff,
        SOURCE,
        &mut report,
    )
    .await;
    let recent_specs = resolve_lichess_tour_specs(
        client,
        request,
        recent_rounds,
        &corpus_cutoff,
        SOURCE,
        &mut report,
    )
    .await;
    scan_indexed_archives(
        client,
        request,
        identity,
        collection,
        app,
        SOURCE,
        &mut report,
        historical_specs,
        None,
        LICHESS_CONCURRENCY,
    )
    .await;
    scan_indexed_archives(
        client,
        request,
        identity,
        collection,
        app,
        SOURCE,
        &mut report,
        recent_specs,
        Some(GROWING_ARCHIVE_CACHE_MAX_AGE),
        LICHESS_CONCURRENCY,
    )
    .await;

    report
}

/// Resolves Chessscope's per-round links to tournament aggregates. A player can
/// have dozens of rounds from only a handful of events; fetching each event PGN
/// once preserves every round while avoiding repeated large Lichess downloads.
/// If metadata cannot be resolved, the exact round PGN remains the fallback.
async fn resolve_lichess_tour_specs(
    client: &Client,
    request: &OtbImportRequest,
    round_paths: Vec<String>,
    corpus_cutoff: &str,
    source: &'static str,
    report: &mut OtbImportSourceReport,
) -> Vec<IndexedArchiveSpec> {
    let mut lookups = stream::iter(round_paths.into_iter().map(|round_path| {
        let client = client.clone();
        let cache_dir = request.cache_dir.clone();
        async move {
            let api_url = format!("https://lichess.org/api{round_path}");
            let cache_path = cache_dir.join(cache_file_name("lichess-fide-round", &api_url));
            let result: Result<(String, Option<String>), String> = async {
                let (bytes, _) = fetch_lichess_cached_within(
                    &client,
                    &api_url,
                    &cache_path,
                    Some(PAGE_CACHE_MAX_AGE),
                )
                .await?;
                let value = serde_json::from_slice::<serde_json::Value>(&bytes)
                    .map_err(|error| error.to_string())?;
                let tour_id = value
                    .get("tour")
                    .and_then(|tour| tour.get("id"))
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
                    .ok_or_else(|| {
                        "Lichess round metadata did not contain a tour ID".to_string()
                    })?;
                let starts_at = value
                    .get("round")
                    .and_then(|round| round.get("startsAt"))
                    .and_then(serde_json::Value::as_i64)
                    .and_then(chrono::DateTime::<Utc>::from_timestamp_millis)
                    .map(|date| date.format("%Y-%m-%d").to_string());
                Ok((tour_id, starts_at))
            }
            .await;
            (round_path, api_url, result)
        }
    }))
    .buffered(LICHESS_CONCURRENCY);

    let mut tour_ids = HashSet::new();
    let mut fallback_round_ids = HashSet::new();
    while let Some((round_path, api_url, result)) = lookups.next().await {
        match result {
            Ok((_, Some(starts_at))) if starts_at.as_str() < corpus_cutoff => {}
            Ok((tour_id, _)) => {
                tour_ids.insert(tour_id);
            }
            Err(error) => {
                report.errors.push(format!("{source} {api_url}: {error}"));
                if let Some(round_id) = round_path.rsplit('/').next() {
                    fallback_round_ids.insert(round_id.to_string());
                }
            }
        }
    }

    let mut urls = tour_ids
        .into_iter()
        .map(|tour_id| format!("https://lichess.org/api/broadcast/{tour_id}.pgn"))
        .chain(
            fallback_round_ids
                .into_iter()
                .map(|round_id| format!("https://lichess.org/api/broadcast/round/{round_id}.pgn")),
        )
        .collect::<Vec<_>>();
    urls.sort();
    urls.into_iter()
        .map(|url| {
            let cache_path = request
                .cache_dir
                .join(cache_file_name("lichess-broadcast", &url));
            IndexedArchiveSpec::lichess(url, cache_path)
        })
        .collect()
}

async fn scan_lichess_broadcasts(
    client: &Client,
    request: &OtbImportRequest,
    identity: &Arc<PlayerIdentity>,
    collection: &Mutex<Collection>,
    app: &OtbProgressSink<'_>,
) -> OtbImportSourceReport {
    const SOURCE: &str = "Lichess broadcast database";
    let mut report = OtbImportSourceReport::new(SOURCE);
    let list = match fetch_page_cached(
        client,
        LICHESS_BROADCAST_LIST,
        &request.cache_dir,
        "lichess-index",
    )
    .await
    {
        Ok(Some(text)) => text,
        Ok(None) => {
            report
                .errors
                .push(format!("{LICHESS_BROADCAST_LIST}: not found"));
            return report;
        }
        Err(error) => {
            report.errors.push(error);
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

    let specs = urls
        .into_iter()
        .map(|url| {
            let cache_path = request.cache_dir.join(file_name_from_url(&url));
            IndexedArchiveSpec::immutable(url, cache_path, ArchiveFormat::Zstd)
        })
        .collect();
    scan_indexed_archives(
        client,
        request,
        identity,
        collection,
        app,
        SOURCE,
        &mut report,
        specs,
        None,
        LICHESS_CONCURRENCY,
    )
    .await;

    report
}

/// Community broadcasts never appear in the monthly dumps, and the player's
/// FIDE page only links a broadcast when its organizer tagged FIDE IDs — a
/// university or league event relayed on a DGT board is invisible to both.
/// This lane walks the public past-broadcast listing, keeps only tours carrying
/// Lichess's `communityOwner` marker, checks each tournament's much smaller
/// player roster, and downloads a PGN only when the target appears. Tours
/// without a usable roster still fall back to a full scan for completeness.
async fn scan_lichess_community_broadcasts(
    client: &Client,
    request: &OtbImportRequest,
    identity: &Arc<PlayerIdentity>,
    collection: &Mutex<Collection>,
    app: &OtbProgressSink<'_>,
) -> OtbImportSourceReport {
    const SOURCE: &str = "Lichess community broadcasts";
    let mut report = OtbImportSourceReport::new(SOURCE);
    let from_millis = year_start_millis(request.from_year);

    let mut tours: Vec<(String, String, Option<i64>, bool)> = Vec::new();
    let mut seen = HashSet::new();
    let mut pages_all_before_range = 0u32;
    let mut oldest_dated: Option<i64> = None;
    for page in 1..=LICHESS_COMMUNITY_MAX_PAGES {
        emit_progress(
            app,
            request,
            SOURCE,
            "discovering",
            page.saturating_sub(1) as usize,
            0,
            games_len(collection),
            format!("Checking past community broadcasts, page {page}"),
        );
        let url = format!("https://lichess.org/api/broadcast/top?page={page}");
        let value = match fetch_lichess_page_cached(
            client,
            &url,
            &request.cache_dir,
            "lichess-community-list",
        )
        .await
        {
            Ok(bytes) => match serde_json::from_slice::<serde_json::Value>(&bytes) {
                Ok(value) => value,
                Err(error) => {
                    report.errors.push(format!("{url}: {error}"));
                    break;
                }
            },
            Err(error) => {
                report.errors.push(error);
                break;
            }
        };
        let (page_tours, all_before_range, has_next, page_oldest) =
            extract_community_tour_page(&value, from_millis);
        if let Some(page_oldest) = page_oldest {
            oldest_dated = Some(oldest_dated.map_or(page_oldest, |value| value.min(page_oldest)));
        }
        for tour in page_tours {
            if seen.insert(tour.0.clone()) {
                tours.push(tour);
            }
        }
        if all_before_range {
            pages_all_before_range += 1;
        } else {
            pages_all_before_range = 0;
        }
        // The listing is only loosely date-ordered, so one all-old page can
        // still be followed by newer tours; two in a row means we are done.
        if pages_all_before_range >= 2 || !has_next {
            break;
        }
        if page == LICHESS_COMMUNITY_MAX_PAGES {
            report.errors.push(format!(
                "The community broadcast listing was capped at {LICHESS_COMMUNITY_MAX_PAGES} pages before reaching {}.",
                request.from_year
            ));
        }
    }

    // Lichess only exposes a rolling window of past broadcasts (about twenty
    // listing pages). Say so instead of silently missing older events.
    if oldest_dated.is_some_and(|oldest| oldest > from_millis) {
        let reach = oldest_dated
            .and_then(chrono::DateTime::<Utc>::from_timestamp_millis)
            .map(|date| date.format("%Y-%m-%d").to_string())
            .unwrap_or_else(|| "recent months".to_string());
        report.errors.push(format!(
            "The public broadcast listing only reaches back to {reach}; community events before then cannot be discovered automatically — add their PGN files as local sources instead.",
        ));
    }

    // A tournament with a Chess-Results standings link is already searched by
    // the dedicated player-name/FIDE-ID lane. Avoid asking Lichess for the same
    // hundreds of rosters again when that lane is enabled; the community lane
    // remains responsible for events without a searchable Chess-Results entry.
    if request.include_chess_results {
        tours.retain(|tour| !tour.3);
    }
    tours.sort_by(|left, right| left.0.cmp(&right.0));
    let total = tours.len();
    let completed = AtomicUsize::new(0);
    let now_millis = Utc::now().timestamp_millis();
    let mut downloads = stream::iter(tours.into_iter().map(|(tour_id, tour_name, ends_at, _)| {
        let client = client.clone();
        let identity = Arc::clone(identity);
        let roster_url = format!("https://lichess.org/broadcast/{tour_id}/players");
        let pgn_url = format!("https://lichess.org/api/broadcast/{tour_id}.pgn");
        let settled = ends_at.is_some_and(|ends| {
            now_millis.saturating_sub(ends) > LICHESS_COMMUNITY_CACHE_SETTLE.as_millis() as i64
        });
        let roster_cache_path = request
            .cache_dir
            .join(cache_file_name("lichess-community-roster", &roster_url));
        let cache_path = settled.then(|| {
            request
                .cache_dir
                .join(cache_file_name("lichess-community", &pgn_url))
        });
        let from_year = request.from_year;
        let completed = &completed;
        async move {
            emit_progress(
                app,
                request,
                SOURCE,
                "downloading",
                completed.load(Ordering::Relaxed),
                total,
                games_len(collection),
                format!("Checking {tour_name} player roster"),
            );
            let outcome = async {
                // Completed rosters are immutable. Reuse a recent roster for
                // one hour too: without this, every player import reissues
                // hundreds of identical requests and repeatedly trips the
                // host-wide rate limit. The short TTL still picks up entrants
                // added to a live event promptly.
                let roster_max_age = (!settled).then_some(PAGE_CACHE_MAX_AGE);
                let roster = fetch_lichess_cached_within(
                    &client,
                    &roster_url,
                    &roster_cache_path,
                    roster_max_age,
                )
                .await
                .ok()
                .and_then(|(bytes, _)| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
                .and_then(|value| community_roster_contains_player(&value, &identity));
                if roster == Some(false) {
                    return Ok::<_, String>(None);
                }

                emit_progress(
                    app,
                    request,
                    SOURCE,
                    "downloading",
                    completed.load(Ordering::Relaxed),
                    total,
                    games_len(collection),
                    format!("Scanning {tour_name}"),
                );
                let (bytes, cached) =
                    fetch_lichess_maybe_cached(&client, &pgn_url, cache_path.as_deref()).await?;
                Ok(Some((
                    cached,
                    scan_pgn_bytes(bytes, identity, SOURCE, pgn_url.clone(), from_year).await,
                )))
            }
            .await;
            (pgn_url, outcome)
        }
    }))
    .buffered(LICHESS_CONCURRENCY);

    while let Some((pgn_url, result)) = downloads.next().await {
        report.archives_checked = report.archives_checked.saturating_add(1);
        match result {
            Ok(Some((cached, mut outcome))) => {
                if cached {
                    report.cached_archives = report.cached_archives.saturating_add(1);
                }
                if let Some(error) = outcome.error.take() {
                    report.errors.push(format!("{pgn_url}: {error}"));
                }
                let (matched, added) = merge_into(collection, outcome, SOURCE);
                report.matched_games = report.matched_games.saturating_add(matched);
                report.unique_games_added = report.unique_games_added.saturating_add(added);
            }
            Ok(None) => {}
            Err(error) => report.errors.push(format!("{pgn_url}: {error}")),
        }
        let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
        emit_progress(
            app,
            request,
            SOURCE,
            "downloading",
            done,
            total,
            games_len(collection),
            format!("Checked {done} of {total} community broadcasts"),
        );
    }

    report
}

/// Returns `None` when the endpoint supplied no usable roster, which tells the
/// caller to preserve completeness by scanning the tournament PGN. A populated
/// roster can safely reject a tournament by FIDE ID first and name second.
fn community_roster_contains_player(
    value: &serde_json::Value,
    identity: &PlayerIdentity,
) -> Option<bool> {
    let players = value.as_array()?;
    if players.is_empty() {
        return None;
    }
    let usable = players.iter().any(|player| {
        player
            .get("name")
            .and_then(serde_json::Value::as_str)
            .is_some()
            || roster_fide_id(player).is_some()
    });
    if !usable {
        return None;
    }

    if let Some(target_id) = identity.fide_id.as_deref() {
        if players
            .iter()
            .any(|player| roster_fide_id(player).as_deref() == Some(target_id))
        {
            return Some(true);
        }
        return Some(players.iter().any(|player| {
            roster_fide_id(player).is_none()
                && player
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|name| identity.name_matches(name))
        }));
    }

    Some(players.iter().any(|player| {
        player
            .get("name")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|name| identity.name_matches(name))
    }))
}

fn roster_fide_id(player: &serde_json::Value) -> Option<String> {
    let value = player.get("fideId")?;
    match value {
        serde_json::Value::Number(number) => Some(number.to_string()),
        serde_json::Value::String(value) => normalized_fide_header(Some(value)),
        _ => None,
    }
}

fn year_start_millis(year: u16) -> i64 {
    chrono::NaiveDate::from_ymd_opt(year as i32, 1, 1)
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .map(|datetime| datetime.and_utc().timestamp_millis())
        .unwrap_or(0)
}

/// Pulls the past-broadcast entries out of one `/api/broadcast/top` page.
/// Returns the tours overlapping the requested range, whether every dated
/// tour on the page ended before the range, whether another page exists, and
/// the oldest dated tour end seen on the page.
fn extract_community_tour_page(
    value: &serde_json::Value,
    from_millis: i64,
) -> (
    Vec<(String, String, Option<i64>, bool)>,
    bool,
    bool,
    Option<i64>,
) {
    let past = value.get("past");
    let results = past
        .and_then(|past| past.get("currentPageResults"))
        .and_then(serde_json::Value::as_array);
    let mut tours = Vec::new();
    let mut dated = 0usize;
    let mut before_range = 0usize;
    let mut oldest_dated: Option<i64> = None;
    if let Some(results) = results {
        for entry in results {
            let Some(tour) = entry.get("tour") else {
                continue;
            };
            // BroadcastTop mixes featured official and user-created tours. The
            // generic tour schema identifies the latter with communityOwner;
            // scanning every unmarked tour here duplicates the targeted and
            // archive lanes and is what caused hundreds of pointless requests.
            if tour.get("communityOwner").is_none() {
                continue;
            }
            let Some(id) = tour.get("id").and_then(serde_json::Value::as_str) else {
                continue;
            };
            let name = tour
                .get("name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("Lichess broadcast");
            let dates = tour.get("dates").and_then(serde_json::Value::as_array);
            let starts = dates
                .and_then(|dates| dates.first())
                .and_then(serde_json::Value::as_i64);
            let ends = dates
                .and_then(|dates| dates.get(1))
                .and_then(serde_json::Value::as_i64)
                .or(starts);
            if let Some(ends_at) = ends {
                dated += 1;
                oldest_dated = Some(oldest_dated.map_or(ends_at, |value| value.min(ends_at)));
                if ends_at < from_millis {
                    before_range += 1;
                    continue;
                }
            }
            let chess_results_backed = tour
                .get("info")
                .and_then(|info| info.get("standings"))
                .and_then(serde_json::Value::as_str)
                .is_some_and(|url| url.to_ascii_lowercase().contains("chess-results.com"));
            tours.push((id.to_string(), name.to_string(), ends, chess_results_backed));
        }
    }
    let has_next = past
        .and_then(|past| past.get("nextPage"))
        .and_then(serde_json::Value::as_u64)
        .is_some();
    (
        tours,
        dated > 0 && before_range == dated,
        has_next,
        oldest_dated,
    )
}

/// Downloads a lichess PGN through the paced lane, optionally backed by an
/// immutable cache entry for tours that finished long ago.
async fn fetch_lichess_maybe_cached(
    client: &Client,
    url: &str,
    cache_path: Option<&Path>,
) -> Result<(Vec<u8>, bool), String> {
    if let Some(path) = cache_path {
        if let Some(bytes) = read_cache_entry(path, None).await {
            return Ok((bytes, true));
        }
    }
    let bytes = get_lichess_with_backoff(client, url).await?;
    if let Some(path) = cache_path {
        write_cache_entry(path, &bytes).await;
    }
    Ok((bytes, false))
}

/// Fetches a Lichess artifact through the shared request lane and a required
/// cache path. `max_age = None` treats the entry as immutable; a duration keeps
/// changing resources fresh without downloading them for every player search.
async fn fetch_lichess_cached_within(
    client: &Client,
    url: &str,
    cache_path: &Path,
    max_age: Option<Duration>,
) -> Result<(Vec<u8>, bool), String> {
    if let Some(bytes) = read_cache_entry(cache_path, max_age).await {
        return Ok((bytes, true));
    }
    let stale = if max_age.is_some() {
        read_cache_entry(cache_path, None).await
    } else {
        None
    };
    let bytes = match get_lichess_with_backoff(client, url).await {
        Ok(bytes) => bytes,
        Err(error) => return stale.map(|bytes| (bytes, true)).ok_or(error),
    };
    write_cache_entry(cache_path, &bytes).await;
    Ok((bytes, false))
}

async fn scan_chess_results(
    client: &Client,
    request: &OtbImportRequest,
    identity: &Arc<PlayerIdentity>,
    collection: &Mutex<Collection>,
    app: &OtbProgressSink<'_>,
) -> OtbImportSourceReport {
    // Chess-Results is a stateful ASP.NET form flow (cookie plus __VIEWSTATE
    // round-trip), so nothing here can be served from the disk cache.
    const SOURCE: &str = "Chess-Results player search";
    let mut report = OtbImportSourceReport::new(SOURCE);

    // Two passes: the FIDE-ID search finds correctly-tagged uploads, and the
    // name search recovers events whose organizers uploaded player records
    // without FIDE IDs (university and league PGNs especially). The identity
    // filter prunes same-surname strangers from the name pass afterwards.
    let mut passes: Vec<(String, Vec<(&'static str, String)>)> = Vec::new();
    if let Some(fide_id) = identity.fide_id.as_deref() {
        passes.push((
            format!("FIDE {fide_id}"),
            vec![("ctl00$P1$Txt_FideID", fide_id.to_string())],
        ));
    }
    if let Some(fields) = chess_results_name_fields(identity) {
        passes.push(("name".to_string(), fields));
    }
    if passes.is_empty() {
        report
            .errors
            .push("Chess-Results needs a player name or FIDE ID.".to_string());
        return report;
    }

    let total = passes.len();
    for (index, (label, fields)) in passes.into_iter().enumerate() {
        report.archives_checked = report.archives_checked.saturating_add(1);
        emit_progress(
            app,
            request,
            SOURCE,
            "searching",
            index,
            total,
            games_len(collection),
            format!("Searching Chess-Results by {label}"),
        );
        match chess_results_download(client, &fields).await {
            Ok(bytes) => {
                let mut outcome = scan_pgn_bytes(
                    bytes,
                    Arc::clone(identity),
                    SOURCE,
                    CHESS_RESULTS_PLAYER_SEARCH.to_string(),
                    request.from_year,
                )
                .await;
                if let Some(error) = outcome.error.take() {
                    report.errors.push(format!("{label}: {error}"));
                }
                let (matched, added) = merge_into(collection, outcome, SOURCE);
                report.matched_games = report.matched_games.saturating_add(matched);
                report.unique_games_added = report.unique_games_added.saturating_add(added);
            }
            Err(error) => report.errors.push(format!("{label}: {error}")),
        }
    }
    report
}

/// Surname plus the first full given name, matching how organizers key player
/// records: "Tyrrell" + "Lachlan" finds both "Tyrrell, Lachlan" and
/// "Tyrrell, Lachlan Baly Hughes". Initials are never sent — the search treats
/// them literally and would miss everything.
fn chess_results_name_fields(identity: &PlayerIdentity) -> Option<Vec<(&'static str, String)>> {
    let (surname, given_names) = match identity.canonical_name.split_once(',') {
        Some((surname, given_names)) => {
            (surname.trim().to_string(), given_names.trim().to_string())
        }
        None => {
            let mut tokens = identity.canonical_name.split_whitespace();
            let first = tokens.next()?.to_string();
            let last = tokens.last()?.to_string();
            (last, first)
        }
    };
    if surname.chars().count() < 2 {
        return None;
    }
    let mut fields = vec![("ctl00$P1$txt_nachname", surname)];
    let forename = given_names
        .split_whitespace()
        .find(|token| token.chars().count() > 1 && !token.contains('.'));
    if let Some(forename) = forename {
        fields.push(("ctl00$P1$txt_vorname", forename.to_string()));
    }
    Some(fields)
}

/// One full Chess-Results round-trip: fresh session and view state, the search
/// POST, then the PGN download POST against the refreshed state.
async fn chess_results_download(
    client: &Client,
    fields: &[(&'static str, String)],
) -> Result<Vec<u8>, String> {
    let initial_response = client
        .get(CHESS_RESULTS_PLAYER_SEARCH)
        .timeout(DISCOVERY_PAGE_TIMEOUT)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let cookie = collect_response_cookies(&initial_response);
    let initial_html = initial_response
        .text()
        .await
        .map_err(|error| error.to_string())?;

    let mut search_form = extract_hidden_form_fields(&initial_html);
    for (name, value) in fields {
        set_form_field(&mut search_form, name, value);
    }
    set_form_field(
        &mut search_form,
        "ctl00$P1$combo_anzahl_zeilen",
        CHESS_RESULTS_MAX_ROWS,
    );
    set_form_field(&mut search_form, "ctl00$P1$cb_SuchenPartie", "Search");

    let mut search_request = client
        .post(CHESS_RESULTS_PLAYER_SEARCH)
        .form(&search_form)
        .timeout(DISCOVERY_PAGE_TIMEOUT);
    if !cookie.is_empty() {
        search_request = search_request.header(COOKIE, &cookie);
    }
    let search_html = search_request
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .text()
        .await
        .map_err(|error| error.to_string())?;

    let mut download_form = extract_hidden_form_fields(&search_html);
    for (name, value) in fields {
        set_form_field(&mut download_form, name, value);
    }
    set_form_field(
        &mut download_form,
        "ctl00$P1$combo_anzahl_zeilen",
        CHESS_RESULTS_MAX_ROWS,
    );
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
    let bytes = download_request
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .bytes()
        .await
        .map_err(|error| error.to_string())?;
    Ok(bytes.to_vec())
}

async fn scan_chessbase_news(
    client: &Client,
    request: &OtbImportRequest,
    identity: &Arc<PlayerIdentity>,
    collection: &Mutex<Collection>,
    app: &OtbProgressSink<'_>,
) -> OtbImportSourceReport {
    const SOURCE: &str = "ChessBase public news PGNs";
    let mut report = OtbImportSourceReport::new(SOURCE);
    let mut article_urls = HashSet::new();

    // The search itself stays live so freshly published articles are never
    // missed; everything it fans out to is cached.
    let mut searches = stream::iter(chessbase_search_queries(identity).into_iter().map(|query| {
        let client = client.clone();
        async move {
            let html = async {
                client
                    .get(CHESSBASE_SEARCH)
                    .query(&[("pattern", query.as_str())])
                    .send()
                    .await
                    .map_err(|error| error.to_string())?
                    .error_for_status()
                    .map_err(|error| error.to_string())?
                    .text()
                    .await
                    .map_err(|error| error.to_string())
            }
            .await;
            (query, html)
        }
    }))
    .buffered(ARCHIVE_CONCURRENCY);
    while let Some((query, result)) = searches.next().await {
        match result {
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
    let total_articles = article_urls.len();
    let started = AtomicUsize::new(0);
    let games_so_far = games_len(collection);
    let mut articles = stream::iter(article_urls.into_iter().map(|article_url| {
        let client = client.clone();
        let cache_dir = request.cache_dir.clone();
        let started = &started;
        async move {
            let position = started.fetch_add(1, Ordering::Relaxed);
            emit_progress(
                app,
                request,
                SOURCE,
                "discovering",
                position,
                total_articles,
                games_so_far,
                format!(
                    "Checking ChessBase article {} of {}",
                    position + 1,
                    total_articles
                ),
            );
            let html = fetch_page_cached(&client, &article_url, &cache_dir, "chessbase").await;
            (article_url, html)
        }
    }))
    .buffered(ARCHIVE_CONCURRENCY);

    let mut pgn_urls = HashSet::new();
    while let Some((article_url, result)) = articles.next().await {
        report.archives_checked = report.archives_checked.saturating_add(1);
        match result {
            Ok(Some(html)) => {
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
            Ok(None) => {}
            Err(error) => report.errors.push(format!("{article_url}: {error}")),
        }
    }

    let mut pgn_urls = pgn_urls.into_iter().collect::<Vec<_>>();
    pgn_urls.sort();
    // An article covering a running event appends rounds to the same PGN URL, so
    // its downloaded bytes and indexed content expire together.
    let specs = pgn_urls
        .into_iter()
        .map(|url| {
            let cache_path = request.cache_dir.join(cache_file_name("chessbase", &url));
            IndexedArchiveSpec::immutable(url, cache_path, ArchiveFormat::Pgn)
        })
        .collect();
    scan_indexed_archives(
        client,
        request,
        identity,
        collection,
        app,
        SOURCE,
        &mut report,
        specs,
        Some(GROWING_ARCHIVE_CACHE_MAX_AGE),
        ARCHIVE_CONCURRENCY,
    )
    .await;

    report
}

async fn scan_4ncl_otb_archive(
    client: &Client,
    request: &OtbImportRequest,
    identity: &Arc<PlayerIdentity>,
    collection: &Mutex<Collection>,
    app: &OtbProgressSink<'_>,
) -> OtbImportSourceReport {
    const SOURCE: &str = "Official tournament PGN indexes (4NCL)";
    let mut report = OtbImportSourceReport::new(SOURCE);
    let index_html =
        match fetch_page_cached(client, FOUR_NCL_PGN_INDEX, &request.cache_dir, "4ncl-index").await
        {
            Ok(Some(text)) => text,
            Ok(None) => {
                report
                    .errors
                    .push(format!("{FOUR_NCL_PGN_INDEX}: not found"));
                return report;
            }
            Err(error) => {
                report.errors.push(error);
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
    // Season aggregates keep growing while the season runs, so both their
    // downloaded bytes and index entries expire together.
    let specs = pgn_urls
        .into_iter()
        .map(|url| IndexedArchiveSpec {
            label: file_name_from_url(&url),
            cache_path: request.cache_dir.join(cache_file_name("4ncl", &url)),
            format: ArchiveFormat::Pgn,
            optional: optional_current_urls.contains(&url),
            lichess: false,
            url,
        })
        .collect();
    scan_indexed_archives(
        client,
        request,
        identity,
        collection,
        app,
        SOURCE,
        &mut report,
        specs,
        Some(GROWING_ARCHIVE_CACHE_MAX_AGE),
        ARCHIVE_CONCURRENCY,
    )
    .await;

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

async fn scan_britbase(
    client: &Client,
    request: &OtbImportRequest,
    identity: &Arc<PlayerIdentity>,
    collection: &Mutex<Collection>,
    app: &OtbProgressSink<'_>,
) -> OtbImportSourceReport {
    const SOURCE: &str = "BritBase public OTB archive";
    let mut report = OtbImportSourceReport::new(SOURCE);
    let relevant_indexes = BRITBASE_INDEXES
        .iter()
        .filter(|(_, start_year)| {
            (*start_year == 0 && request.from_year < 1920)
                || (*start_year > 0 && start_year.saturating_add(9) >= request.from_year)
        })
        .map(|(path, _)| (*path).to_string())
        .collect::<Vec<_>>();

    let total_indexes = relevant_indexes.len();
    let started = AtomicUsize::new(0);
    let games_so_far = games_len(collection);
    let mut indexes = stream::iter(relevant_indexes.into_iter().map(|path| {
        let client = client.clone();
        let cache_dir = request.cache_dir.clone();
        let from_year = request.from_year;
        let started = &started;
        async move {
            let position = started.fetch_add(1, Ordering::Relaxed);
            emit_progress(
                app,
                request,
                SOURCE,
                "discovering",
                position,
                total_indexes,
                games_so_far,
                format!("Checking BritBase archive index {}", position + 1),
            );
            // Each index is mirrored on two hosts; the fallback stays sequential
            // so a healthy primary is never double-fetched.
            let mut errors = Vec::new();
            let mut checked = 0u32;
            let mut urls = Vec::new();
            let mut loaded = false;
            for origin in BRITBASE_ORIGINS {
                let index_url = format!("{origin}{path}");
                match fetch_page_cached(&client, &index_url, &cache_dir, "britbase-index").await {
                    Ok(Some(html)) => {
                        checked += 1;
                        urls = extract_britbase_archive_urls(&html, from_year, origin);
                        loaded = true;
                        break;
                    }
                    Ok(None) => errors.push(format!("{index_url}: not found")),
                    Err(error) => errors.push(format!("{index_url}: {error}")),
                }
            }
            if !loaded {
                errors.push(format!(
                    "BritBase index {path} was unavailable from both public hosts"
                ));
            }
            (checked, errors, urls)
        }
    }))
    .buffered(ARCHIVE_CONCURRENCY);

    let mut archive_urls = HashSet::new();
    while let Some((checked, errors, urls)) = indexes.next().await {
        report.archives_checked = report.archives_checked.saturating_add(checked);
        report.errors.extend(errors);
        archive_urls.extend(urls);
    }

    let mut archive_urls = archive_urls.into_iter().collect::<Vec<_>>();
    archive_urls.sort();
    let index_path = archive_index_path(&request.cache_dir);
    let indexed = index::indexed_urls(&index_path, &archive_urls, None)
        .await
        .unwrap_or_default();
    if indexed.len() < archive_urls.len()
        && !britbase_archive_host_available(client, &archive_urls).await
    {
        let discovered = archive_urls.len();
        archive_urls.retain(|url| indexed.contains(url));
        report.errors.push(format!(
            "BritBase's archive hosts did not answer bounded health probes; used {} already indexed files and skipped {}/{} unreachable downloads for this search.",
            archive_urls.len(),
            discovered.saturating_sub(archive_urls.len()),
            discovered,
        ));
    }
    let specs = archive_urls
        .into_iter()
        .map(|url| {
            let cache_path = request.cache_dir.join(cache_file_name("britbase", &url));
            let format = archive_format_from_url(&url);
            IndexedArchiveSpec::immutable(url, cache_path, format)
        })
        .collect();
    scan_indexed_archives(
        client,
        request,
        identity,
        collection,
        app,
        SOURCE,
        &mut report,
        specs,
        None,
        BRITBASE_CONCURRENCY,
    )
    .await;

    report
}

async fn britbase_archive_host_available(client: &Client, archive_urls: &[String]) -> bool {
    if archive_urls.is_empty() {
        return true;
    }
    let mut probe_paths = Vec::new();
    for index in [
        0,
        archive_urls.len() / 2,
        archive_urls.len().saturating_sub(1),
    ] {
        let Some(url) = archive_urls.get(index) else {
            continue;
        };
        let path = BRITBASE_ORIGINS
            .iter()
            .find_map(|origin| url.strip_prefix(origin))
            .unwrap_or(url);
        probe_paths.push(path.to_string());
    }
    probe_paths.sort();
    probe_paths.dedup();
    let required_paths = probe_paths.len() / 2 + 1;

    // A single exceptional file must not unlock more than a thousand archive
    // requests. Treat a sampled path as reachable when either mirror serves it,
    // then require a majority of independent paths to pass.
    let mut requests = stream::iter(probe_paths.into_iter().map(|path| {
        let client = client.clone();
        async move {
            future::join_all(BRITBASE_ORIGINS.iter().map(|origin| {
                let client = client.clone();
                let url = format!("{origin}{path}");
                async move {
                    tokio::time::timeout(Duration::from_secs(3), client.get(url).send())
                        .await
                        .ok()
                        .and_then(Result::ok)
                        .is_some_and(|response| response.status().is_success())
                }
            }))
            .await
            .into_iter()
            .any(|available| available)
        }
    }))
    .buffer_unordered(3);
    let mut available_paths = 0usize;
    while let Some(available) = requests.next().await {
        if available {
            available_paths += 1;
            if available_paths >= required_paths {
                return true;
            }
        }
    }
    false
}

async fn scan_pgn_mentor(
    client: &Client,
    request: &OtbImportRequest,
    identity: &Arc<PlayerIdentity>,
    collection: &Mutex<Collection>,
    app: &OtbProgressSink<'_>,
) -> OtbImportSourceReport {
    const SOURCE: &str = "PGN Mentor public collections";
    let mut report = OtbImportSourceReport::new(SOURCE);
    emit_progress(
        app,
        request,
        SOURCE,
        "discovering",
        0,
        1,
        games_len(collection),
        "Checking PGN Mentor public collections".to_string(),
    );
    let html = match fetch_page_cached(
        client,
        PGN_MENTOR_INDEX,
        &request.cache_dir,
        "pgnmentor-index",
    )
    .await
    {
        Ok(Some(html)) => html,
        Ok(None) => {
            report.errors.push(format!("{PGN_MENTOR_INDEX}: not found"));
            return report;
        }
        Err(error) => {
            report.errors.push(error);
            return report;
        }
    };
    report.archives_checked = 1;
    let mut archive_urls = extract_pgn_mentor_archive_urls(&html, identity, request.from_year);
    archive_urls.sort();
    archive_urls.dedup();

    let specs = archive_urls
        .into_iter()
        .map(|url| {
            let filename = file_name_from_url(&url);
            let cache_path = request.cache_dir.join(format!("pgnmentor-{filename}"));
            let format = archive_format_from_url(&url);
            IndexedArchiveSpec::immutable(url, cache_path, format)
        })
        .collect();
    scan_indexed_archives(
        client,
        request,
        identity,
        collection,
        app,
        SOURCE,
        &mut report,
        specs,
        None,
        ARCHIVE_CONCURRENCY,
    )
    .await;

    report
}

async fn scan_twic(
    client: &Client,
    request: &OtbImportRequest,
    identity: &Arc<PlayerIdentity>,
    collection: &Mutex<Collection>,
    app: &OtbProgressSink<'_>,
) -> OtbImportSourceReport {
    const SOURCE: &str = "The Week in Chess";
    let mut report = OtbImportSourceReport::new(SOURCE);
    let page = match fetch_page_cached(client, TWIC_ARCHIVE, &request.cache_dir, "twic-index").await
    {
        Ok(Some(text)) => text,
        Ok(None) => {
            report.errors.push(format!("{TWIC_ARCHIVE}: not found"));
            return report;
        }
        Err(error) => {
            report.errors.push(error);
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

    let specs = archives
        .into_iter()
        .map(|archive| {
            let url = archive.url;
            let cache_path = request.cache_dir.join(file_name_from_url(&url));
            IndexedArchiveSpec::immutable(url, cache_path, ArchiveFormat::Zip)
        })
        .collect();
    scan_indexed_archives(
        client,
        request,
        identity,
        collection,
        app,
        SOURCE,
        &mut report,
        specs,
        None,
        ARCHIVE_CONCURRENCY,
    )
    .await;

    report
}

/// Downloads an artifact that never changes once published, reusing the cached
/// copy whenever one exists.
async fn fetch_cached(
    client: &Client,
    url: &str,
    cache_path: &Path,
) -> Result<(Vec<u8>, bool), String> {
    fetch_cached_within(client, url, cache_path, None)
        .await?
        .ok_or_else(|| "not found".to_string())
}

/// Downloads an artifact that can still grow — an event's PGN gains rounds while
/// the event runs — so its cache entry expires instead of freezing the event.
async fn fetch_cached_growing(
    client: &Client,
    url: &str,
    cache_path: &Path,
) -> Result<(Vec<u8>, bool), String> {
    fetch_cached_within(client, url, cache_path, Some(GROWING_ARCHIVE_CACHE_MAX_AGE))
        .await?
        .ok_or_else(|| "not found".to_string())
}

/// Downloads `url` unless a usable cache entry exists. `max_age` bounds how long
/// a cached copy stays usable for artifacts that can still grow; `None` treats
/// the artifact as immutable. `Ok(None)` means the host answered 404, so probes
/// for optional files can stay quiet.
async fn fetch_cached_within(
    client: &Client,
    url: &str,
    cache_path: &Path,
    max_age: Option<Duration>,
) -> Result<Option<(Vec<u8>, bool)>, String> {
    if let Some(bytes) = read_cache_entry(cache_path, max_age).await {
        return Ok(Some((bytes, true)));
    }
    let stale = if max_age.is_some() {
        read_cache_entry(cache_path, None).await
    } else {
        None
    };

    let response = match client.get(url).send().await {
        Ok(response) => response,
        Err(error) => {
            return match stale {
                Some(bytes) => Ok(Some((bytes, true))),
                None => Err(error.to_string()),
            };
        }
    };
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let bytes = response
        .error_for_status()
        .map_err(|error| error.to_string())?
        .bytes()
        .await
        .map_err(|error| error.to_string())?
        .to_vec();
    write_cache_entry(cache_path, &bytes).await;
    Ok(Some((bytes, false)))
}

/// Fetches a page without touching the cache, for listings that are the only
/// place a newly played game can show up. `Ok(None)` means the host answered 404.
async fn fetch_page_live(client: &Client, url: &str) -> Result<Option<String>, String> {
    let response = client
        .get(url)
        .timeout(DISCOVERY_PAGE_TIMEOUT)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let html = response
        .error_for_status()
        .map_err(|error| error.to_string())?
        .text()
        .await
        .map_err(|error| error.to_string())?;
    Ok(Some(html))
}

/// Fetches a discovery page (search results, archive index) through the
/// short-lived page cache. `Ok(None)` means the host answered 404.
async fn fetch_page_cached(
    client: &Client,
    url: &str,
    cache_dir: &Path,
    prefix: &str,
) -> Result<Option<String>, String> {
    let cache_path = cache_dir.join(cache_file_name(prefix, url));
    if let Some(bytes) = read_cache_entry(&cache_path, Some(PAGE_CACHE_MAX_AGE)).await {
        return Ok(Some(String::from_utf8_lossy(&bytes).into_owned()));
    }
    let stale = read_cache_entry(&cache_path, None).await;
    let response = match client.get(url).timeout(DISCOVERY_PAGE_TIMEOUT).send().await {
        Ok(response) => response,
        Err(error) => {
            return match stale {
                Some(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
                None => Err(error.to_string()),
            };
        }
    };
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let bytes = match response.error_for_status() {
        Ok(response) => response
            .bytes()
            .await
            .map_err(|error| error.to_string())?
            .to_vec(),
        Err(error) => {
            return match stale {
                Some(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
                None => Err(error.to_string()),
            };
        }
    };
    write_cache_entry(&cache_path, &bytes).await;
    Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
}

async fn read_page_cache_stale(
    url: &str,
    cache_dir: &Path,
    prefix: &str,
) -> Result<Option<String>, String> {
    let cache_path = cache_dir.join(cache_file_name(prefix, url));
    Ok(read_cache_entry(&cache_path, None)
        .await
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned()))
}

/// Fetches a Lichess discovery page through both the shared rate-limit lane and
/// the short-lived page cache. Community discovery is identical for every
/// player, so repeated imports should not walk the same listing pages again.
async fn fetch_lichess_page_cached(
    client: &Client,
    url: &str,
    cache_dir: &Path,
    prefix: &str,
) -> Result<Vec<u8>, String> {
    let cache_path = cache_dir.join(cache_file_name(prefix, url));
    if let Some(bytes) = read_cache_entry(&cache_path, Some(PAGE_CACHE_MAX_AGE)).await {
        return Ok(bytes);
    }
    let stale = read_cache_entry(&cache_path, None).await;
    let bytes = match get_lichess_with_backoff(client, url).await {
        Ok(bytes) => bytes,
        Err(error) => return stale.ok_or(error),
    };
    write_cache_entry(&cache_path, &bytes).await;
    Ok(bytes)
}

/// A source archive is large, but the games matching one player are normally
/// tiny. Cache that filtered result by source, identity, year, and scan format
/// so repeat imports do not decompress and parse the same bulk archive again.
fn filtered_scan_cache_path(
    cache_dir: &Path,
    prefix: &str,
    source_url: &str,
    identity: &PlayerIdentity,
    from_year: u16,
) -> PathBuf {
    const FORMAT_VERSION: u8 = 1;
    let key = format!(
        "{FORMAT_VERSION}|{source_url}|{}|{}|{from_year}",
        normalized_name(&identity.canonical_name),
        identity.fide_id.as_deref().unwrap_or_default(),
    );
    cache_dir.join(cache_file_name(prefix, &key))
}

async fn read_filtered_scan_cache(cache_path: &Path) -> Option<ScanOutcome> {
    let bytes = read_cache_entry(cache_path, None).await?;
    serde_json::from_slice(&bytes).ok()
}

async fn write_filtered_scan_cache(cache_path: &Path, outcome: &ScanOutcome) {
    if outcome.error.is_some() {
        return;
    }
    if let Ok(bytes) = serde_json::to_vec(outcome) {
        write_cache_entry(cache_path, &bytes).await;
    }
}

/// Deterministic cache file name: the URL digest keeps distinct sources apart
/// while the sanitised tail keeps the cache directory readable.
fn cache_file_name(prefix: &str, url: &str) -> String {
    let digest = hex::encode(Sha256::digest(url.as_bytes()));
    let tail = file_name_from_url(url)
        .split('?')
        .next()
        .unwrap_or_default()
        .chars()
        .take(60)
        .map(|char| {
            if char.is_ascii_alphanumeric() || char == '.' || char == '-' || char == '_' {
                char
            } else {
                '_'
            }
        })
        .collect::<String>();
    let tail = if tail.is_empty() {
        "page"
    } else {
        tail.as_str()
    };
    format!("{prefix}-{}-{tail}", &digest[..16])
}

async fn read_cache_entry(cache_path: &Path, max_age: Option<Duration>) -> Option<Vec<u8>> {
    let cache_path = cache_path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let metadata = std::fs::metadata(&cache_path).ok()?;
        if !metadata.is_file() || metadata.len() == 0 {
            return None;
        }
        if let Some(max_age) = max_age {
            if metadata.modified().ok()?.elapsed().ok()? > max_age {
                return None;
            }
        }
        let bytes = std::fs::read(&cache_path).ok()?;
        (!bytes.is_empty()).then_some(bytes)
    })
    .await
    .ok()
    .flatten()
}

/// Writes a cache entry atomically: concurrent downloads of the same artifact
/// each stage their own temporary file and then rename it into place, so no
/// reader can ever observe a torn file. Caching is best effort — a failed write
/// must not fail the archive that was downloaded successfully.
async fn write_cache_entry(cache_path: &Path, bytes: &[u8]) {
    let cache_path = cache_path.to_path_buf();
    let bytes = bytes.to_vec();
    let _ = tokio::task::spawn_blocking(move || {
        if let Some(parent) = cache_path.parent() {
            if create_dir_all(parent).is_err() {
                return;
            }
        }
        let ticket = CACHE_WRITE_TICKET.fetch_add(1, Ordering::Relaxed);
        let file_name = cache_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("otb-cache")
            .to_string();
        let temp_path =
            cache_path.with_file_name(format!("{file_name}.{}.{ticket}.tmp", std::process::id()));
        if std::fs::write(&temp_path, &bytes).is_err() {
            let _ = std::fs::remove_file(&temp_path);
            return;
        }
        if std::fs::rename(&temp_path, &cache_path).is_err() {
            let _ = std::fs::remove_file(&temp_path);
        }
    })
    .await;
}

static CACHE_WRITE_TICKET: AtomicUsize = AtomicUsize::new(0);

async fn get_lichess_with_backoff(client: &Client, url: &str) -> Result<Vec<u8>, String> {
    // Hold the permit through the body download so every Lichess source shares
    // one polite request lane. A failed request returns immediately; cached or
    // indexed fallbacks are handled by the caller instead of retrying a dead
    // host until the phone appears frozen.
    let host = request_host(url);
    if lichess_failed_hosts()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .contains(&host)
    {
        return Err(format!(
            "{host} did not answer an earlier request in this search; cached and indexed data were kept"
        ));
    }
    let _request_permit = LICHESS_REQUEST_LANE.lock().await;
    if lichess_failed_hosts()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .contains(&host)
    {
        return Err(format!(
            "{host} did not answer an earlier request in this search; cached and indexed data were kept"
        ));
    }
    take_lichess_slot().await?;
    match client.get(url).send().await {
        Ok(response) if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS => {
            let retry_seconds = retry_after_seconds(&response).unwrap_or(60);
            hold_lichess_lane(Duration::from_secs(retry_seconds));
            Err(format!(
                "Lichess rate-limited {url}; respecting Retry-After without blocking this search"
            ))
        }
        Ok(response) if response.status().is_server_error() => {
            let status = response.status();
            let retry_seconds = retry_after_seconds(&response).unwrap_or(2);
            hold_lichess_lane(Duration::from_secs(retry_seconds.max(1)));
            Err(format!("Lichess returned {status} for {url}"))
        }
        Ok(response) => response
            .error_for_status()
            .map_err(|error| error.to_string())?
            .bytes()
            .await
            .map(|bytes| bytes.to_vec())
            .map_err(|error| error.to_string()),
        Err(error) => {
            lichess_failed_hosts()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .insert(host);
            Err(error.to_string())
        }
    }
}

fn retry_after_seconds(response: &reqwest::Response) -> Option<u64> {
    response
        .headers()
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .and_then(parse_retry_after)
}

/// Parses a `Retry-After` delay, clamped so a hostile or mistaken header cannot
/// park the import for hours.
fn parse_retry_after(value: &str) -> Option<u64> {
    value
        .trim()
        .parse::<u64>()
        .ok()
        .map(|seconds| seconds.clamp(1, MAX_RETRY_AFTER_SECONDS))
}

/// Waits for the shared lichess lane and reserves the next slot in it. The lane
/// paces every lichess request (whatever source issued it) and a rate-limit hold
/// applies to all of them, not only the task that was refused.
async fn take_lichess_slot() -> Result<(), String> {
    loop {
        let now = Instant::now();
        let wait = {
            let mut gate = LICHESS_LANE_GATE
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            match gate.filter(|open_at| *open_at > now) {
                Some(open_at) => Some(open_at.saturating_duration_since(now)),
                None => {
                    *gate = Some(now + LICHESS_MIN_REQUEST_SPACING);
                    None
                }
            }
        };
        match wait {
            Some(delay) if delay > MAX_INTERACTIVE_LICHESS_WAIT => {
                return Err(format!(
                    "Lichess is cooling down for {} more seconds; cached and indexed data were kept",
                    delay.as_secs().max(1)
                ));
            }
            Some(delay) => tokio::time::sleep(delay).await,
            None => return Ok(()),
        }
    }
}

/// Closes the shared lichess lane for `delay`, never shortening an existing hold.
fn hold_lichess_lane(delay: Duration) {
    let open_at = Instant::now() + delay;
    let mut gate = LICHESS_LANE_GATE
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if gate.is_none_or(|existing| existing < open_at) {
        *gate = Some(open_at);
    }
}

static LICHESS_LANE_GATE: Mutex<Option<Instant>> = Mutex::new(None);
static LICHESS_REQUEST_LANE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static LICHESS_FAILED_HOSTS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn lichess_failed_hosts() -> &'static Mutex<HashSet<String>> {
    LICHESS_FAILED_HOSTS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn request_host(url: &str) -> String {
    url.split('/').nth(2).unwrap_or(url).to_ascii_lowercase()
}

fn scan_local_path(
    path: &Path,
    identity: &PlayerIdentity,
    label: &str,
    from_year: u16,
) -> Result<ScanOutcome, String> {
    const SOURCE: &str = "Local PGN / ChessBase export";
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "zip" => {
            let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
            scan_zip_pgns(bytes, identity, SOURCE, label, from_year)
        }
        "zst" => {
            let file = File::open(path).map_err(|error| error.to_string())?;
            let decoder =
                zstd::stream::read::Decoder::new(file).map_err(|error| error.to_string())?;
            Ok(scan_pgn_reader(
                BufReader::new(decoder),
                identity,
                SOURCE,
                label,
                from_year,
            ))
        }
        _ => {
            let file = File::open(path).map_err(|error| error.to_string())?;
            Ok(scan_pgn_reader(
                BufReader::new(file),
                identity,
                SOURCE,
                label,
                from_year,
            ))
        }
    }
}

fn scan_zip_pgns(
    bytes: Vec<u8>,
    identity: &PlayerIdentity,
    source: &str,
    source_url: &str,
    from_year: u16,
) -> Result<ScanOutcome, String> {
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|error| error.to_string())?;
    let mut outcome = ScanOutcome::default();
    for index in 0..archive.len() {
        // A damaged entry stops the archive but keeps every game read so far.
        let mut file = match archive.by_index(index) {
            Ok(file) => file,
            Err(error) => {
                outcome.error = Some(error.to_string());
                break;
            }
        };
        if !file.name().to_ascii_lowercase().ends_with(".pgn") {
            continue;
        }
        let mut bytes = Vec::new();
        if let Err(error) = file.read_to_end(&mut bytes) {
            outcome.error = Some(error.to_string());
            break;
        }
        outcome.absorb(scan_pgn_reader(
            BufReader::new(Cursor::new(bytes)),
            identity,
            source,
            source_url,
            from_year,
        ));
        if outcome.error.is_some() {
            break;
        }
    }
    Ok(outcome)
}

fn scan_pgn_reader<R: BufRead>(
    mut reader: R,
    identity: &PlayerIdentity,
    source: &str,
    source_url: &str,
    from_year: u16,
) -> ScanOutcome {
    let mut state = PgnStreamState::new();
    let mut outcome = ScanOutcome::default();
    loop {
        // A read failure part-way through a stream ends the scan but keeps the
        // games already parsed; the caller still reports the error.
        let next_game = match read_next_game(&mut reader, &mut state) {
            Ok(game) => game,
            Err(error) => {
                outcome.error = Some(error.to_string());
                break;
            }
        };
        let Some(game) = next_game else {
            break;
        };
        let headers = parse_headers(&game);
        let match_side = match_player_side(&headers, identity);
        let Some(side) = match_side else {
            if name_matches_without_identity(&headers, identity) {
                outcome.identity_mismatches_excluded =
                    outcome.identity_mismatches_excluded.saturating_add(1);
            }
            continue;
        };
        outcome.matched = outcome.matched.saturating_add(1);

        if is_suspected_online_game(&headers) {
            outcome.suspected_online_games_excluded =
                outcome.suspected_online_games_excluded.saturating_add(1);
            continue;
        }
        if header(&headers, "Date").is_some_and(|date| date_before_year(date, from_year)) {
            continue;
        }

        let canonical_pgn = canonicalize_target_name(&game, side, &identity.canonical_name);
        let canonical_pgn = add_provenance_headers(&canonical_pgn, source, source_url);
        outcome.games.push(PendingGame {
            pgn: canonical_pgn,
            side: side.to_string(),
        });
    }
    outcome
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
    let normalized_white = normalized_name(&white);
    let normalized_black = normalized_name(&black);
    let identity_fingerprint =
        format!("{target_side}|{normalized_white}|{normalized_black}|{result}");

    let matching_game = collection
        .identity_fingerprints
        .get(&identity_fingerprint)
        .and_then(|indices| {
            indices.iter().copied().find(|index| {
                let existing = &collection.games[*index];
                (existing.date == date || existing.date.contains('?') || date.contains('?'))
                    && move_lines_match_through_terminal_noise(
                        &existing.mainline_moves,
                        &mainline_moves,
                    )
            })
        });
    if let Some(index) = matching_game {
        let existing = &collection.games[index];
        let incoming_is_better = mainline_moves.split_whitespace().count()
            > existing.mainline_moves.split_whitespace().count()
            || (mainline_moves.split_whitespace().count()
                == existing.mainline_moves.split_whitespace().count()
                && pgn.len() > existing.pgn.len());
        collection.duplicates_removed = collection.duplicates_removed.saturating_add(1);
        if incoming_is_better {
            let broad_fingerprint = format!(
                "{}|{}|{}|{}",
                normalized_name(&white),
                normalized_name(&black),
                result,
                moves
            );
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
            collection.games[index] = CollectedGame {
                pgn,
                date,
                event,
                white,
                black,
                result,
                source: source.to_string(),
                mainline_moves,
            };
        }
        return;
    }

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
        normalized_white, normalized_black, result, moves
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
        .identity_fingerprints
        .entry(identity_fingerprint)
        .or_default()
        .push(index);
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
        mainline_moves,
    });
}

/// Treat source copies as the same game when their mainlines agree through the
/// finish and differ only in a tiny terminal tail. Live DGT feeds can append a
/// few spurious plies or report the final move differently after a result is
/// already known. Requiring the same players/date/result at the call site, a
/// substantial exact prefix here, and no more than one full move of differing
/// tail avoids turning ordinary opening transpositions into duplicates.
fn move_lines_match_through_terminal_noise(left: &str, right: &str) -> bool {
    const MIN_SHARED_PLIES: usize = 12;
    const MAX_DIVERGENT_TAIL_PLIES: usize = 2;

    let left = left.split_whitespace().collect::<Vec<_>>();
    let right = right.split_whitespace().collect::<Vec<_>>();
    let shared_prefix = left
        .iter()
        .zip(&right)
        .take_while(|(left_move, right_move)| left_move == right_move)
        .count();
    if shared_prefix < MIN_SHARED_PLIES {
        return false;
    }

    let left_tail = left.len().saturating_sub(shared_prefix);
    let right_tail = right.len().saturating_sub(shared_prefix);
    left_tail == 0
        || right_tail == 0
        || (left_tail <= MAX_DIVERGENT_TAIL_PLIES && right_tail <= MAX_DIVERGENT_TAIL_PLIES)
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
    let mut raw_line = Vec::new();
    let mut in_comment = false;
    let mut saw_movetext = false;

    loop {
        line.clear();
        if let Some(pending) = state.pending_line.take() {
            line.push_str(&pending);
        } else {
            // Public archives are not always UTF-8 — Latin-1/CP1252 is the
            // ChessBase export default — so bytes are decoded lossily instead of
            // failing the whole stream on the first accented name.
            raw_line.clear();
            if reader.read_until(b'\n', &mut raw_line)? == 0 {
                break;
            }
            line.push_str(&String::from_utf8_lossy(&raw_line));
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

fn player_name_tokens(name: &str) -> Vec<String> {
    const TITLES: &[&str] = &["gm", "im", "fm", "cm", "wgm", "wim", "wfm", "wcm", "nm"];
    normalized_name(name)
        .split_whitespace()
        .filter(|token| !TITLES.contains(token))
        .map(str::to_string)
        .collect()
}

fn chessscope_slug_candidates(name: &str) -> Vec<String> {
    let mut candidates = vec![slugify_name(name)];
    if let Some((surname, given_names)) = name.split_once(',') {
        candidates.push(slugify_name(&format!("{surname} {given_names}")));
        candidates.push(slugify_name(&format!("{given_names} {surname}")));
    } else {
        let tokens = normalized_name(name)
            .split_whitespace()
            .map(str::to_string)
            .collect::<Vec<_>>();
        if tokens.len() >= 2 {
            let mut surname_first = vec![tokens.last().cloned().unwrap_or_default()];
            surname_first.extend(tokens[..tokens.len() - 1].iter().cloned());
            candidates.push(surname_first.join("-"));
        }
    }
    candidates.retain(|candidate| !candidate.is_empty());
    candidates.sort();
    candidates.dedup();
    candidates
}

fn slugify_name(name: &str) -> String {
    normalized_name(name)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-")
}

fn chessscope_page_matches_identity(html: &str, identity: &PlayerIdentity) -> bool {
    if let Some(fide_id) = identity.fide_id.as_deref() {
        return html.contains(&format!("FIDE ID {fide_id}"))
            || html.contains(&format!("FIDE ID <!-- -->{fide_id}"))
            || html.contains(&format!(r#"\"FIDE ID \",\"{fide_id}\""#));
    }
    let Some((_, title_tail)) = html.split_once("<title>") else {
        return false;
    };
    let Some((title, _)) = title_tail.split_once("</title>") else {
        return false;
    };
    let name = decode_basic_html_entities(title)
        .split(['—', '·'])
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();
    identity.name_matches(&name)
}

fn extract_chessscope_game_paths(html: &str, from_year: u16) -> Vec<String> {
    extract_chessscope_games(html, from_year)
        .into_iter()
        .map(|(path, _)| path)
        .collect()
}

fn extract_chessscope_games(html: &str, from_year: u16) -> Vec<(String, Option<u16>)> {
    let mut paths = HashMap::<String, Option<u16>>::new();
    for row in html.split("<tr").skip(1) {
        let row = row.split_once("</tr>").map_or(row, |(row, _)| row);
        let year = find_plausible_year(row);
        if year.is_some_and(|year| year < from_year) {
            continue;
        }
        for href in extract_quoted_values(row, "href=") {
            if let Some(path) = href.strip_prefix("/game/") {
                let hash = path.split(['?', '#', '/']).next().unwrap_or_default();
                if hash.len() == 40 && hash.chars().all(|char| char.is_ascii_hexdigit()) {
                    paths
                        .entry(format!("/game/{hash}"))
                        .and_modify(|existing| *existing = (*existing).max(year))
                        .or_insert(year);
                }
            }
        }
    }
    let mut paths = paths.into_iter().collect::<Vec<_>>();
    paths.sort_by(|left, right| left.0.cmp(&right.0));
    paths
}

fn extract_chessscope_round_ids(html: &str) -> Vec<String> {
    extract_chessscope_round_paths(html)
        .into_iter()
        .filter_map(|path| path.rsplit('/').next().map(str::to_string))
        .collect()
}

fn extract_chessscope_round_paths(html: &str) -> Vec<String> {
    let mut round_paths = extract_quoted_values(html, "href=")
        .into_iter()
        .filter(|href| href.contains("lichess.org/broadcast/"))
        .filter_map(|href| {
            let clean = decode_basic_html_entities(&href);
            let path = clean
                .split(['?', '#'])
                .next()?
                .trim_end_matches(".pgn")
                .strip_prefix("https://lichess.org")?;
            is_lichess_round_path(path).then(|| path.to_string())
        })
        .collect::<Vec<_>>();
    round_paths.sort();
    round_paths.dedup();
    round_paths
}

fn extract_chessscope_game_date(html: &str) -> Option<String> {
    const MONTHS: &[&str] = &[
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
        "January",
        "February",
        "March",
        "April",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    for month in MONTHS {
        for (position, _) in html.match_indices(month) {
            let tail = &html[position..html.len().min(position + 24)];
            let Some(comma) = tail.find(',') else {
                continue;
            };
            let end = comma.saturating_add(6);
            let Some(candidate) = tail.get(..end) else {
                continue;
            };
            for format in ["%b %e, %Y", "%B %e, %Y"] {
                if let Ok(date) = chrono::NaiveDate::parse_from_str(candidate, format) {
                    return Some(date.format("%Y-%m-%d").to_string());
                }
            }
        }
    }
    None
}

fn chessscope_round_is_in_corpus(year: Option<u16>, date: Option<&str>, cutoff: &str) -> bool {
    date.is_some_and(|date| date < cutoff)
        || year.is_some_and(|year| format!("{year:04}-12-31").as_str() < cutoff)
}

fn extract_britbase_archive_urls(html: &str, from_year: u16, origin: &str) -> Vec<String> {
    let mut urls = extract_quoted_values(html, "href=")
        .into_iter()
        .filter_map(|href| absolute_britbase_url(&decode_basic_html_entities(&href), origin))
        .filter(|url| {
            let path = url.split('?').next().unwrap_or(url).to_ascii_lowercase();
            path.ends_with(".pgn") || path.ends_with(".zip")
        })
        .filter(|url| archive_file_year(url).map_or(true, |year| year >= from_year))
        .collect::<Vec<_>>();
    urls.sort();
    urls.dedup();
    urls
}

fn absolute_britbase_url(href: &str, origin: &str) -> Option<String> {
    let href = href.trim();
    if href.starts_with("https://") || href.starts_with("http://") {
        return Some(href.to_string());
    }
    if let Some(path) = href.strip_prefix("//") {
        return Some(format!("https://{path}"));
    }
    if href.starts_with('/') {
        return Some(format!("{origin}{href}"));
    }
    (!href.is_empty()).then(|| format!("{origin}/britbase/{}", href.trim_start_matches("./")))
}

fn extract_pgn_mentor_archive_urls(
    html: &str,
    identity: &PlayerIdentity,
    from_year: u16,
) -> Vec<String> {
    extract_quoted_values(html, "href=")
        .into_iter()
        .filter_map(|href| absolute_pgn_mentor_url(&decode_basic_html_entities(&href)))
        .filter(|url| {
            let lower = url.to_ascii_lowercase();
            if lower.contains("/events/") {
                return archive_file_year(url).is_some_and(|year| year >= from_year);
            }
            lower.contains("/players/") && pgn_mentor_player_file_matches(url, identity)
        })
        .collect()
}

fn absolute_pgn_mentor_url(href: &str) -> Option<String> {
    let href = href.trim();
    if href.starts_with("https://") || href.starts_with("http://") {
        return Some(href.to_string());
    }
    if let Some(path) = href.strip_prefix("//") {
        return Some(format!("https://{path}"));
    }
    if href.starts_with('/') {
        return Some(format!("https://www.pgnmentor.com{href}"));
    }
    (!href.is_empty()).then(|| format!("https://www.pgnmentor.com/{href}"))
}

fn pgn_mentor_player_file_matches(url: &str, identity: &PlayerIdentity) -> bool {
    let filename = file_name_from_url(url);
    let stem = filename
        .split('?')
        .next()
        .unwrap_or(&filename)
        .rsplit_once('.')
        .map_or(filename.as_str(), |(stem, _)| stem);
    let normalized = normalized_name(stem).replace(' ', "");
    let surname = identity
        .canonical_name
        .split_once(',')
        .map(|(surname, _)| normalized_name(surname).replace(' ', ""))
        .filter(|surname| surname.len() >= 3)
        .or_else(|| {
            identity
                .name_tokens
                .iter()
                .filter(|token| token.len() >= 3)
                .max_by_key(|token| token.len())
                .cloned()
        });
    surname.is_some_and(|surname| normalized == surname)
}

fn archive_file_year(url: &str) -> Option<u16> {
    let filename = file_name_from_url(url);
    find_plausible_year(&filename)
}

fn find_plausible_year(value: &str) -> Option<u16> {
    value.as_bytes().windows(4).find_map(|window| {
        if !window.iter().all(u8::is_ascii_digit) {
            return None;
        }
        let year = std::str::from_utf8(window).ok()?.parse::<u16>().ok()?;
        (1900..=2200).contains(&year).then_some(year)
    })
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

async fn lichess_live_cutoff(request: &OtbImportRequest) -> String {
    let requested_cutoff = format!("{:04}-01-01", request.from_year);
    let Ok(Some(list)) =
        read_page_cache_stale(LICHESS_BROADCAST_LIST, &request.cache_dir, "lichess-index").await
    else {
        return requested_cutoff;
    };
    let Some((url, month)) = list
        .lines()
        .map(str::trim)
        .filter_map(|url| archive_month(url).map(|month| (url.to_string(), month)))
        .max_by_key(|(_, month)| *month)
    else {
        return requested_cutoff;
    };
    let indexed = index::indexed_urls(
        &archive_index_path(&request.cache_dir),
        &[url.clone()],
        None,
    )
    .await
    .unwrap_or_default();
    if !indexed.contains(&url) {
        return requested_cutoff;
    }
    let (year, month) = if month.1 == 12 {
        (month.0.saturating_add(1), 1)
    } else {
        (month.0, month.1 + 1)
    };
    requested_cutoff.max(format!("{year:04}-{month:02}-01"))
}

fn extract_lichess_round_paths_since(html: &str, cutoff: &str) -> Vec<String> {
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
                .all(|value| value.get(..10).is_none_or(|date| date >= cutoff));
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
    archive_month(url).map(|month| month.0)
}

fn archive_month(url: &str) -> Option<(u16, u8)> {
    let marker = "lichess_db_broadcast_";
    let start = url.find(marker)? + marker.len();
    let year = url.get(start..start + 4)?.parse().ok()?;
    let month = url.get(start + 5..start + 7)?.parse::<u8>().ok()?;
    (1..=12).contains(&month).then_some((year, month))
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
    app: &OtbProgressSink<'_>,
    request: &OtbImportRequest,
    source: &str,
    phase: &str,
    current: usize,
    total: usize,
    games_found: usize,
    message: String,
) {
    app(OtbImportProgress {
        job_id: request.job_id.clone(),
        source: source.to_string(),
        phase: phase.to_string(),
        current: current.min(u32::MAX as usize) as u32,
        total: total.min(u32::MAX as usize) as u32,
        games_found: games_found.min(u32::MAX as usize) as u32,
        message,
        overall_current: None,
        overall_total: None,
    });
}

fn emit_overall_progress(
    app: &OtbProgressSink<'_>,
    request: &OtbImportRequest,
    phase: &str,
    current: usize,
    total: usize,
    games_found: usize,
    message: String,
) {
    app(OtbImportProgress {
        job_id: request.job_id.clone(),
        source: "All sources".to_string(),
        phase: phase.to_string(),
        current: current.min(u32::MAX as usize) as u32,
        total: total.min(u32::MAX as usize) as u32,
        games_found: games_found.min(u32::MAX as usize) as u32,
        message,
        overall_current: Some(current.min(u32::MAX as usize) as u32),
        overall_total: Some(total.min(u32::MAX as usize) as u32),
    });
}

fn is_transport_failure(error: &str) -> bool {
    let error = error.to_ascii_lowercase();
    error.contains("error sending request")
        || error.contains("timed out")
        || error.contains("connection")
        || error.contains("dns")
        || error.contains("resolve")
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
    fn accepts_initial_heavy_names_without_matching_bare_forenames() {
        let identity = PlayerIdentity::new("Sooraj M R", Some("35014730")).unwrap();
        assert!(identity.name_matches("R, Sooraj M"));
        assert!(identity.name_matches("Sooraj M R"));
        assert!(!identity.name_matches("Sooraj Kumar"));
    }

    /// Archives shorten long names unpredictably: the full FIDE form must
    /// match the "Surname, Firstname" and initials forms that league and
    /// university PGNs actually print, and the short typed form must still
    /// find the full archive spelling.
    #[test]
    fn matches_partial_and_initial_name_forms() {
        let full = PlayerIdentity::new("Tyrrell, Lachlan Baly Hughes", Some("6003788")).unwrap();
        assert!(full.name_matches("Tyrrell, Lachlan"));
        assert!(full.name_matches("Lachlan Tyrrell"));
        assert!(full.name_matches("Tyrrell, L.B.H."));
        assert!(full.name_matches("Tyrrell, Lachlan Baly Hughes"));
        assert!(!full.name_matches("Tyrrell"));
        assert!(!full.name_matches("Tyrrell, James"));
        assert!(!full.name_matches("Hughes, Baly"));

        let short = PlayerIdentity::new("Tyrrell, Lachlan", None).unwrap();
        assert!(short.name_matches("Tyrrell, Lachlan Baly Hughes"));
        assert!(!short.name_matches("Tyrrell, Angus Baly Hughes"));
    }

    /// A real broadcast listed "Tyrrell, Lachlan Baly Hughes" as
    /// "Lachlan Tyrell" — forename first with a one-letter surname typo. One
    /// edit is tolerated on long tokens, never on short ones, and only when a
    /// FIDE ID pins the identity: a name-only search stays strict.
    #[test]
    fn matches_misspelled_surnames_only_with_a_pinned_fide_id() {
        let full = PlayerIdentity::new("Tyrrell, Lachlan Baly Hughes", Some("6003788")).unwrap();
        assert!(full.name_matches("Lachlan Tyrell"));
        assert!(full.name_matches("Tyrell, Lachlan"));
        assert!(!full.name_matches("Lachlan Tyre"));
        let unpinned = PlayerIdentity::new("Tyrrell, Lachlan Baly Hughes", None).unwrap();
        assert!(!unpinned.name_matches("Lachlan Tyrell"));
        assert!(unpinned.name_matches("Tyrrell, Lachlan"));
        assert!(fuzzy_token_eq("tyrrell", "tyrell"));
        assert!(fuzzy_token_eq("tyrrell", "tyrrel"));
        assert!(!fuzzy_token_eq("tyrrell", "terrll"));
        assert!(!fuzzy_token_eq("lee", "leo"));
    }

    #[test]
    fn extracts_community_tours_within_range() {
        let value = serde_json::json!({
            "past": {
                "currentPageResults": [
                    { "tour": { "id": "AtOSTGx3", "name": "BUCA Championships", "communityOwner": { "id": "buca" }, "dates": [1771678800000i64, 1771767900000i64], "info": { "standings": "https://chess-results.com/tnr123.aspx" } } },
                    { "tour": { "id": "OldTour1", "name": "Old event", "communityOwner": { "id": "club" }, "dates": [1600000000000i64, 1600086400000i64] } },
                    { "tour": { "id": "NoDates1", "name": "Undated event", "communityOwner": { "id": "organiser" } } },
                    { "tour": { "id": "Official", "name": "Official event", "dates": [1771678800000i64, 1771767900000i64] } }
                ],
                "nextPage": 2
            }
        });
        // 2026-01-01 as the range start keeps BUCA and drops the 2020 event.
        let from_millis = year_start_millis(2026);
        let (tours, all_before, has_next, oldest) =
            extract_community_tour_page(&value, from_millis);
        assert_eq!(
            tours.iter().map(|tour| tour.0.as_str()).collect::<Vec<_>>(),
            vec!["AtOSTGx3", "NoDates1"]
        );
        assert!(
            tours[0].3,
            "Chess-Results-backed tours are marked for deduplication"
        );
        assert!(!tours[1].3);
        assert!(!all_before);
        assert!(has_next);
        assert_eq!(oldest, Some(1600086400000));

        let (tours, all_before, has_next, _) =
            extract_community_tour_page(&value, year_start_millis(2030));
        assert_eq!(tours.len(), 1, "only the undated tour survives");
        assert!(all_before);
        assert!(has_next);
    }

    #[test]
    fn filters_community_tours_by_roster_identity() {
        let identity = identity();
        let exact_id = serde_json::json!([
            { "name": "A different spelling", "fideId": 24276111 },
            { "name": "Other, Player", "fideId": 12345678 }
        ]);
        assert_eq!(
            community_roster_contains_player(&exact_id, &identity),
            Some(true)
        );

        let conflicting_id = serde_json::json!([
            { "name": "Lapidus, Alexey M.", "fideId": 99999999 },
            { "name": "Other, Player" }
        ]);
        assert_eq!(
            community_roster_contains_player(&conflicting_id, &identity),
            Some(false)
        );

        let name_without_id = serde_json::json!([
            { "name": "Alexey Lapidus" },
            { "name": "Other, Player", "fideId": 12345678 }
        ]);
        assert_eq!(
            community_roster_contains_player(&name_without_id, &identity),
            Some(true)
        );
    }

    #[test]
    fn falls_back_when_a_community_roster_is_unavailable() {
        let identity = identity();
        assert_eq!(
            community_roster_contains_player(&serde_json::json!([]), &identity),
            None
        );
        assert_eq!(
            community_roster_contains_player(&serde_json::json!({ "error": "missing" }), &identity,),
            None
        );
    }

    #[test]
    fn filtered_archive_results_round_trip_through_the_cache_format() {
        let outcome = ScanOutcome {
            matched: 1,
            games: vec![PendingGame {
                pgn: "[White \"Lapidus, Alexey M.\"]\n\n1. e4 *\n".to_string(),
                side: "White".to_string(),
            }],
            ..ScanOutcome::default()
        };
        let bytes = serde_json::to_vec(&outcome).unwrap();
        let decoded: ScanOutcome = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decoded.matched, 1);
        assert_eq!(decoded.games.len(), 1);
        assert_eq!(decoded.games[0].side, "White");
    }

    #[test]
    fn builds_chess_results_name_fields_from_canonical_forms() {
        let comma = PlayerIdentity::new("Tyrrell, Lachlan Baly Hughes", None).unwrap();
        assert_eq!(
            chess_results_name_fields(&comma),
            Some(vec![
                ("ctl00$P1$txt_nachname", "Tyrrell".to_string()),
                ("ctl00$P1$txt_vorname", "Lachlan".to_string()),
            ])
        );
        // Initials are skipped, never sent as a literal forename.
        let initials = PlayerIdentity::new("Lapidus, A. M.", None).unwrap();
        assert_eq!(
            chess_results_name_fields(&initials),
            Some(vec![("ctl00$P1$txt_nachname", "Lapidus".to_string())])
        );
        let plain = PlayerIdentity::new("Lachlan Tyrrell", None).unwrap();
        assert_eq!(
            chess_results_name_fields(&plain),
            Some(vec![
                ("ctl00$P1$txt_nachname", "Tyrrell".to_string()),
                ("ctl00$P1$txt_vorname", "Lachlan".to_string()),
            ])
        );
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
    fn live_lichess_discovery_skips_months_already_in_the_corpus() {
        let html = r#"<a href="/broadcast/old-event/round-1/OldRound" datetime="2026-07-31T18:00:00Z">Old</a>
<a href="/broadcast/new-event/round-1/NewRound" datetime="2026-08-01T18:00:00Z">New</a>
<a href="/broadcast/undated-event/round-1/NoDate01">Undated</a>"#;
        assert_eq!(
            extract_lichess_round_paths_since(html, "2026-08-01"),
            vec![
                "/broadcast/new-event/round-1/NewRound".to_string(),
                "/broadcast/undated-event/round-1/NoDate01".to_string(),
            ]
        );
        assert_eq!(
            archive_month(
                "https://database.lichess.org/broadcast/lichess_db_broadcast_2026-07.pgn.zst"
            ),
            Some((2026, 7))
        );
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

    #[test]
    fn resolves_chessscope_candidates_and_recent_rounds() {
        assert_eq!(
            chessscope_slug_candidates("Mesropyan, Hayk"),
            vec!["hayk-mesropyan".to_string(), "mesropyan-hayk".to_string()]
        );
        let html = r#"<meta name="description" content="110 games, FIDE ID 499455">
<table><tr><td>May 9, 2026</td><td><a href="/game/0123456789abcdef0123456789abcdef01234567">Game</a></td></tr>
<tr><td>May 9, 2023</td><td><a href="/game/fedcba9876543210fedcba9876543210fedcba98">Old</a></td></tr></table>"#;
        assert!(chessscope_page_matches_identity(
            html,
            &PlayerIdentity::new("Mesropyan, Hayk", Some("499455")).unwrap()
        ));
        assert_eq!(
            extract_chessscope_game_paths(html, 2024),
            vec!["/game/0123456789abcdef0123456789abcdef01234567".to_string()]
        );
        assert_eq!(
            extract_chessscope_round_ids(
                r#"<a href="https://lichess.org/broadcast/event/round/M5XEUuPJ">Source</a>"#
            ),
            vec!["M5XEUuPJ".to_string()]
        );
        assert_eq!(
            extract_chessscope_game_date(
                r#"<meta name="description" content="Event, Dec 30, 2024. White vs Black">"#
            ),
            Some("2024-12-30".to_string())
        );
        assert_eq!(
            extract_chessscope_game_date("<p>September 3, 2026 · Round 4</p>"),
            Some("2026-09-03".to_string())
        );
        assert!(chessscope_round_is_in_corpus(
            Some(2022),
            None,
            "2026-08-01"
        ));
        assert!(!chessscope_round_is_in_corpus(
            Some(2026),
            None,
            "2026-08-01"
        ));
    }

    #[test]
    fn parses_recent_britbase_downloads() {
        let html = r#"<a href="pgn/202506event.pgn">2025</a>
<a href="/britbase/pgn/202301old.zip">2023</a>"#;
        assert_eq!(
            extract_britbase_archive_urls(html, 2024, BRITBASE_ORIGINS[0]),
            vec!["https://www.saund.org.uk/britbase/pgn/202506event.pgn".to_string()]
        );
    }

    #[test]
    fn merging_scanned_archives_keeps_counters_and_dedupe() {
        let pgn = r#"[Event "British Championship"]
[Date "2026.05.10"]
[White "Lapidus, Alexey M."]
[Black "Opponent, One"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 1-0

[Event "Online Chess Championship"]
[Site "https://chess.com"]
[Date "2026.05.11"]
[White "Opponent, Two"]
[Black "Lapidus, Alexey M."]
[Result "0-1"]

1. d4 d5 0-1

[Event "Old Open"]
[Date "2019.01.01"]
[White "Lapidus, Alexey M."]
[Black "Opponent, Three"]
[Result "1/2-1/2"]

1. c4 c5 1/2-1/2
"#;
        let scan = || {
            scan_pgn_reader(
                BufReader::new(Cursor::new(pgn.as_bytes())),
                &identity(),
                "Test archive",
                "test://archive",
                2020,
            )
        };

        let outcome = scan();
        assert_eq!(outcome.matched, 3);
        assert_eq!(outcome.suspected_online_games_excluded, 1);
        assert_eq!(outcome.games.len(), 1);

        let mut collection = Collection::default();
        assert_eq!(collection.merge(outcome, "Test archive"), (3, 1));
        // Re-merging the same archive must add nothing, whatever order archives
        // are downloaded in.
        assert_eq!(collection.merge(scan(), "Test archive"), (3, 0));
        assert_eq!(collection.games.len(), 1);
        assert_eq!(collection.duplicates_removed, 1);
        assert_eq!(collection.suspected_online_games_excluded, 2);
    }

    #[test]
    fn dedupes_truncated_game_against_full_copy_and_keeps_fuller_pgn() {
        let truncated = r#"[Event "Welsh Open"]
[Date "2026.04.06"]
[White "Thomas, Mark"]
[Black "Tyrrell, Lachlan Baly Hughes"]
[Result "0-1"]

1. e4 g6 2. d4 Bg7 3. Nc3 d6 4. Be2 a6 5. Be3 Nd7 6. Nf3 b5 7. a3 Bb7 8. O-O Ngf6 9. e5 Nd5 10. e6 fxe6 11. Ng5 Nf8 12. Bg4 Nxc3 13. bxc3 Bd5 14. Re1 h6 15. Nh3 e5 0-1
"#;
        let full = truncated.replace("15. Nh3 e5 0-1", "15. Nh3 e5 16. f4 exd4 17. cxd4 0-1");
        let mut collection = Collection::default();

        add_game(
            &mut collection,
            truncated.to_string(),
            "Chess-Results",
            "Black",
        );
        add_game(&mut collection, full.clone(), "Lichess broadcast", "Black");

        assert_eq!(collection.games.len(), 1);
        assert_eq!(collection.duplicates_removed, 1);
        assert_eq!(collection.games[0].pgn, full);
        assert_eq!(collection.games[0].source, "Lichess broadcast");
    }

    #[test]
    fn dedupes_real_dgt_tail_after_the_recorded_game_ended() {
        let official = r#"[Event "2026 Welsh Open"]
[Date "2026.04.06"]
[White "Thomas, Mark"]
[Black "Tyrrell, Lachlan Baly Hughes"]
[Result "0-1"]

1. e4 g6 2. d4 Bg7 3. Nc3 d6 4. Be2 a6 5. Be3 Nd7 6. Nf3 b5 7. a3 Bb7 8. O-O Ngf6 9. e5 Nd5 10. e6 fxe6 11. Ng5 Nf8 12. Bg4 Nxc3 13. bxc3 Bd5 14. Re1 h6 15. Nh3 Qd7 16. Nf4 Bc4 17. Qf3 c6 18. Bd2 Bf6 19. a4 b4 20. cxb4 Bxd4 21. c3 Be5 22. b5 Rc8 23. Qe4 Bd5 24. Qd3 Bxf4 25. Bxf4 cxb5 26. axb5 Qxb5 27. Qh3 Qc4 28. Be3 Ra8 29. Be2 Qxc3 30. Rec1 Qf6 31. Rxa6 Rxa6 32. Bxa6 Kf7 33. Rd1 Be4 34. f3 Bc2 35. Rc1 Bb3 36. Qg4 e5 37. Qb4 Be6 38. f4 Nd7 39. Rf1 Rb8 40. Qd2 e4 41. Bd4 Qf5 42. Be2 Nf6 43. h3 h5 44. Qd1 Rb3 45. Qa1 Rg3 46. Bf2 Qxh3 47. Bxg3 Qxg3 48. Qd4 h4 49. Qf2 Ng4 50. Qxg3 hxg3 51. Bxg4 Bxg4 52. Re1 d5 53. Re3 Ke6 54. Rxg3 Kf5 55. Ra3 Kxf4 56. Kf2 d4 57. g3+ Kf5 58. Ra8 e3+ 59. Ke1 d3 0-1
"#;
        let dgt = official
            .replace(
                "2026 Welsh Open",
                "Round 7: Thomas, Mark - Tyrrell, Lachlan Baly Hughes",
            )
            .replace("59. Ke1 d3 0-1", "59. Ke1 d3 60. Ra4 Ke5 61. Ra1 0-1");
        let mut collection = Collection::default();

        add_game(
            &mut collection,
            official.to_string(),
            "Chess-Results player search",
            "Black",
        );
        add_game(
            &mut collection,
            dgt,
            "Lichess live FIDE broadcasts",
            "Black",
        );

        assert_eq!(collection.games.len(), 1);
        assert_eq!(collection.duplicates_removed, 1);
    }

    #[test]
    fn dedupes_a_differently_recorded_final_move_but_not_an_earlier_divergence() {
        let shared = "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3";
        assert!(move_lines_match_through_terminal_noise(
            &format!("{shared} Nb8 d4"),
            &format!("{shared} Na5 d4"),
        ));
        assert!(!move_lines_match_through_terminal_noise(
            &format!("{shared} Nb8 d4 Nbd7 Nbd2"),
            &format!("{shared} Na5 d4 c5 d5"),
        ));
    }

    #[test]
    fn limits_pgn_mentor_to_recent_events_and_matching_player_files() {
        let html = r#"<a href="events/London2025.pgn">Event</a>
<a href="events/London2023.pgn">Old</a>
<a href="players/Mesropyan.zip">Player</a>
<a href="players/Carlsen.zip">Other player</a>"#;
        let identity = PlayerIdentity::new("Mesropyan, Hayk", Some("499455")).unwrap();
        let mut urls = extract_pgn_mentor_archive_urls(html, &identity, 2024);
        urls.sort();
        assert_eq!(
            urls,
            vec![
                "https://www.pgnmentor.com/events/London2025.pgn".to_string(),
                "https://www.pgnmentor.com/players/Mesropyan.zip".to_string(),
            ]
        );
        assert!(!pgn_mentor_player_file_matches(
            "https://www.pgnmentor.com/players/Tom.zip",
            &identity
        ));
    }

    #[test]
    fn cancellation_targets_only_the_registered_search() {
        let registration =
            CancellationRegistration::new("otb-cancellation-test").expect("register search");
        assert!(!registration.signal.load(Ordering::Acquire));
        assert!(cancel_otb_games("otb-cancellation-test".to_string()));
        assert!(registration.signal.load(Ordering::Acquire));
        assert!(!cancel_otb_games("another-search".to_string()));
        drop(registration);
        assert!(!cancel_otb_games("otb-cancellation-test".to_string()));
    }
}
