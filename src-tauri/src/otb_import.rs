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
use pgn_reader::{BufferedReader as PgnReader, RawHeader, SanPlus, Skip, Visitor};
use reqwest::header::{ACCEPT, COOKIE, REFERER, SET_COOKIE};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use shakmaty::{fen::Fen, CastlingMode, Chess, FromSetup, Position, PositionError};
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
const BRITBASE_CANONICAL_ORIGIN: &str = "https://www.saund.org.uk";
const BRITBASE_ORIGINS: &[&str] = &["https://www.saund.org.uk", "https://www.saund.co.uk"];
const PGN_MENTOR_INDEX: &str = "https://www.pgnmentor.com/files.html?outpost=1";
const USER_AGENT: &str = "En Croissant OTB importer/0.4";

/// Bounded fan-out for general archive hosts. Downloads dominate the wall clock,
/// so archives are fetched concurrently and merged in their sorted order.
const ARCHIVE_CONCURRENCY: usize = 8;
/// BritBase's anti-hotlink check is satisfied by the decade-index Referer below.
/// Keep a bounded burst rather than globally sleeping between every immutable
/// archive: the latter made a cold historical decade take 350 ms per file even
/// when the host was answering immediately. Explicit 429 cooldowns are still
/// honoured by `wait_for_britbase_lane`.
const BRITBASE_CONCURRENCY: usize = 16;
/// Lichess work keeps modest CPU fan-out, while the network helper below
/// serializes complete requests as required by Lichess's published API guidance.
const LICHESS_CONCURRENCY: usize = 8;
/// Lichess also rate-limits rapid sequential requests even when no requests
/// overlap. Reserving the next start keeps a long exact-game import below the
/// observed burst limit; slower responses naturally satisfy the interval.
const LICHESS_MIN_REQUEST_SPACING: Duration = Duration::from_millis(120);
/// Study exports are the only Lichess PGN route that lets callers retain the
/// complete broadcast payload. Keep all four flags explicit: the broadcast
/// round API silently drops comments and variations, which is unacceptable for
/// a lossless importer even when its main line happens to match.
const LICHESS_STUDY_EXPORT_QUERY: &str =
    "comments=true&clocks=true&variations=true&orientation=true";
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
    /// Wall-clock time for this concurrent source lane. This is deliberately
    /// measured around the whole lane so benchmark reports expose discovery,
    /// network, index, and merge stalls rather than only download time.
    pub elapsed_ms: u64,
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
            elapsed_ms: 0,
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
    pub coverage_complete: bool,
    pub coverage_gaps: Vec<String>,
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

fn index_run_for_request(request: &OtbImportRequest) -> index::IndexRun {
    let signal = lock_cancellations()
        .get(request.job_id.trim())
        .cloned()
        .unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
    index::IndexRun::new(request.job_id.clone(), signal)
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
    legal_mainline: bool,
}

#[derive(Clone)]
struct CandidateGame {
    game: CollectedGame,
    target_side: String,
    identity_fingerprint: String,
    broad_fingerprint: String,
    move_fingerprint: Option<String>,
}

#[derive(Clone, Debug)]
struct LichessCorpusCoverage {
    complete_months: HashSet<(u16, u8)>,
}

impl LichessCorpusCoverage {
    fn from_complete_months(_from_year: u16, complete_months: HashSet<(u16, u8)>) -> Self {
        Self { complete_months }
    }

    fn empty(from_year: u16) -> Self {
        Self::from_complete_months(from_year, HashSet::new())
    }

    fn covers_date(&self, date: &str) -> bool {
        let Some(year) = date.get(..4).and_then(|value| value.parse::<u16>().ok()) else {
            return false;
        };
        let Some(month) = date.get(5..7).and_then(|value| value.parse::<u8>().ok()) else {
            return false;
        };
        self.complete_months.contains(&(year, month))
    }

    fn covers_year(&self, year: u16) -> bool {
        (1..=12).all(|month| self.complete_months.contains(&(year, month)))
    }

    fn covers_timestamp_range(&self, start_millis: i64, end_millis: i64) -> bool {
        let Some(start) = chrono::DateTime::<Utc>::from_timestamp_millis(start_millis) else {
            return false;
        };
        let Some(end) = chrono::DateTime::<Utc>::from_timestamp_millis(end_millis) else {
            return false;
        };
        if end < start {
            return false;
        }

        let mut year = start.year().clamp(0, u16::MAX as i32) as u16;
        let mut month = start.month() as u8;
        let end_year = end.year().clamp(0, u16::MAX as i32) as u16;
        let end_month = end.month() as u8;
        loop {
            if !self.complete_months.contains(&(year, month)) {
                return false;
            }
            if (year, month) == (end_year, end_month) {
                return true;
            }
            if month == 12 {
                year = year.saturating_add(1);
                month = 1;
            } else {
                month += 1;
            }
        }
    }
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
    candidate_games: Vec<CandidateGame>,
    capture_candidates: bool,
}

impl Collection {
    fn capturing() -> Self {
        Self {
            capture_candidates: true,
            ..Self::default()
        }
    }

    /// Source lanes merge concurrently for speed, so their provisional unique
    /// counts can arrive in any order. Replaying every accepted candidate in a
    /// total order makes fuzzy-prefix duplicate clusters and the chosen PGN
    /// byte-for-byte repeatable without serializing network work.
    fn into_deterministic(mut self) -> Self {
        self.candidate_games.sort_by(|left, right| {
            left.target_side
                .cmp(&right.target_side)
                .then_with(|| left.game.source.cmp(&right.game.source))
                .then_with(|| left.game.pgn.cmp(&right.game.pgn))
        });
        let mut rebuilt = Self {
            suspected_online_games_excluded: self.suspected_online_games_excluded,
            identity_mismatches_excluded: self.identity_mismatches_excluded,
            ..Self::default()
        };
        for candidate in self.candidate_games {
            add_candidate(&mut rebuilt, candidate);
        }
        rebuilt
    }

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
    let collection = Mutex::new(Collection::capturing());
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

    // Dropping a lane cancels its async future but cannot abort an already
    // running `spawn_blocking` closure. Drain those cooperatively-cancelled
    // workers before checkpointing so no stale writer survives this import.
    index::wait_for_workers(&request.job_id).await;
    // All archive writers have finished, so fold the temporary WAL back into
    // the compact corpus before returning to the desktop or phone service.
    let _ = index::checkpoint(&index_path, false).await;

    let mut collection = collection
        .into_inner()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .into_deterministic();

    // Provisional lane counts reflect lock-arrival order. Reconcile them from
    // the deterministic final winners so the durable report names the source
    // whose PGN was actually retained and is byte-for-byte repeatable.
    reconcile_source_reports(&mut reports, &collection.games);

    collection.games.sort_by(|left, right| {
        left.date
            .cmp(&right.date)
            .then_with(|| left.event.cmp(&right.event))
            .then_with(|| left.white.cmp(&right.white))
            .then_with(|| left.black.cmp(&right.black))
            .then_with(|| left.result.cmp(&right.result))
            .then_with(|| left.mainline_moves.cmp(&right.mainline_moves))
            .then_with(|| left.pgn.cmp(&right.pgn))
            .then_with(|| left.source.cmp(&right.source))
    });
    write_collection(&request.output_path, &collection.games)?;

    let newest_game = collection
        .games
        .iter()
        .filter(|game| pgn_date_has_numeric_year(&game.date))
        .max_by(|left, right| left.date.cmp(&right.date))
        .map(|game| OtbImportNewestGame {
            date: game.date.clone(),
            event: game.event.clone(),
            white: game.white.clone(),
            black: game.black.clone(),
            result: game.result.clone(),
            source: game.source.clone(),
        });

    let mut coverage_gaps = reports
        .iter()
        .flat_map(|report| {
            report
                .errors
                .iter()
                .map(|error| format!("{}: {error}", report.source))
        })
        .collect::<Vec<_>>();
    if cancelled {
        coverage_gaps
            .push("Import was cancelled before every selected source finished.".to_string());
    }
    coverage_gaps.sort();
    coverage_gaps.dedup();
    let coverage_complete = coverage_gaps.is_empty();

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
        } else if coverage_complete {
            format!("Found {} unique OTB games", collection.games.len())
        } else {
            format!(
                "Found {} unique OTB games, but {} coverage gap{} must be resolved",
                collection.games.len(),
                coverage_gaps.len(),
                if coverage_gaps.len() == 1 { "" } else { "s" }
            )
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
        coverage_complete,
        coverage_gaps,
        newest_game,
        sources: reports,
    })
}

fn pgn_date_has_numeric_year(date: &str) -> bool {
    date.as_bytes()
        .get(..4)
        .is_some_and(|year| year.iter().all(u8::is_ascii_digit))
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
    let started = Instant::now();
    let mut report = scan.await;
    report.elapsed_ms = started.elapsed().as_millis().try_into().unwrap_or(u64::MAX);
    emit_progress(
        app,
        request,
        &report.source,
        "done",
        1,
        1,
        games_len(collection),
        format!(
            "{} finished in {:.2}s — {} unique game{} added",
            report.source,
            report.elapsed_ms as f64 / 1_000.0,
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
    let corpus_coverage = lichess_corpus_coverage(request).await;
    // Discover the player's full requested range, then use each tournament's
    // exact date span to remove only tours whose every month is already in the
    // indexed dump. A cutoff derived from the player's birth year is unsafe:
    // the broadcast database starts much later, so the missing pre-database
    // years otherwise force every already-indexed tour to be downloaded again.
    // The placeholder slug redirects to Lichess's canonical player URL. Every
    // later cursor must come from that response's rel=next link: synthesizing
    // `/player?page=N` makes the redirect discard `page=N` and repeats page 1.
    let (round_paths, discovery_errors) = discover_lichess_fide_rounds(
        client,
        request,
        collection,
        app,
        SOURCE,
        fide_id,
        "https://lichess.org",
        &format!("https://lichess.org/fide/{fide_id}/player"),
    )
    .await;
    report.errors.extend(discovery_errors);
    // Round metadata identifies the exact study chapter for this FIDE player.
    // A chapter export is byte-for-byte the same annotated game as the whole
    // round export but avoids making Lichess synthesize every board in the
    // round. Missing/ambiguous metadata and failed chapter downloads retain a
    // lossless whole-round fallback.
    scan_lichess_rounds_pipelined(
        client,
        request,
        identity,
        collection,
        app,
        SOURCE,
        &mut report,
        round_paths,
        &corpus_coverage,
        "https://lichess.org",
        Some(GROWING_ARCHIVE_CACHE_MAX_AGE),
    )
    .await;

    report
}

async fn discover_lichess_fide_rounds(
    client: &Client,
    request: &OtbImportRequest,
    collection: &Mutex<Collection>,
    app: &OtbProgressSink<'_>,
    source: &'static str,
    fide_id: &str,
    origin: &str,
    initial_url: &str,
) -> (Vec<String>, Vec<String>) {
    let requested_cutoff = format!("{:04}-01-01", request.from_year);
    let mut seen_round_paths = HashSet::new();
    let mut seen_page_urls = HashSet::new();
    let mut errors = Vec::new();
    let mut page_url = initial_url.to_string();
    let mut page = 1usize;
    loop {
        if !seen_page_urls.insert(page_url.clone()) {
            errors.push(format!(
                "Lichess FIDE pagination repeated {page_url}; coverage may be incomplete"
            ));
            break;
        }
        emit_progress(
            app,
            request,
            source,
            "discovering",
            page.saturating_sub(1),
            0,
            games_len(collection),
            format!("Checking Lichess FIDE tournament page {page}"),
        );
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
                errors.push(error);
                break;
            }
        };
        let html = String::from_utf8_lossy(&bytes).into_owned();
        for (round_path, _) in extract_lichess_rounds_since(&html, &requested_cutoff) {
            seen_round_paths.insert(round_path);
        }
        let next_page_url =
            match lichess_fide_next_page_url_at_origin(&html, fide_id, &seen_page_urls, origin) {
                Ok(next_page_url) => next_page_url,
                Err(error) => {
                    errors.push(error);
                    break;
                }
            };
        let Some(next_page_url) = next_page_url else {
            break;
        };
        page_url = next_page_url;
        page = page.saturating_add(1);
    }
    let mut round_paths = seen_round_paths.into_iter().collect::<Vec<_>>();
    round_paths.sort();
    (round_paths, errors)
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
    lichess_fallback: Option<(String, PathBuf)>,
    require_match: bool,
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
            lichess_fallback: None,
            require_match: false,
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
            lichess_fallback: None,
            require_match: false,
        }
    }

    fn lichess_with_fallback(
        url: String,
        cache_path: PathBuf,
        fallback_url: String,
        fallback_cache_path: PathBuf,
    ) -> Self {
        Self {
            label: file_name_from_url(&url),
            url,
            cache_path,
            format: ArchiveFormat::Pgn,
            optional: false,
            lichess: true,
            lichess_fallback: Some((fallback_url, fallback_cache_path)),
            require_match: false,
        }
    }

    fn lichess_complete_tour(url: String, cache_path: PathBuf) -> Self {
        let mut spec = Self::lichess(url, cache_path);
        spec.require_match = true;
        spec
    }
}

#[derive(Clone, Debug)]
struct BritBaseArchiveSpec {
    url: String,
    label: String,
    referer: String,
    fetch_urls: Vec<String>,
    index_keys: Vec<String>,
    cache_paths: Vec<PathBuf>,
    format: ArchiveFormat,
}

impl BritBaseArchiveSpec {
    fn new(url: String, referer: String, cache_dir: &Path) -> Self {
        let index_keys = britbase_equivalent_urls(&url);
        let url = canonical_britbase_url(&url);
        let fetch_urls = index_keys.clone();
        let cache_paths = index_keys
            .iter()
            .map(|key| cache_dir.join(cache_file_name("britbase", key)))
            .collect();
        Self {
            label: file_name_from_url(&url),
            format: archive_format_from_url(&url),
            url,
            referer,
            fetch_urls,
            index_keys,
            cache_paths,
        }
    }
}

#[derive(Default, Debug, Eq, PartialEq)]
struct BritBaseCoverage {
    advertised: usize,
    indexed: usize,
    raw_cached: usize,
    live_attempted: usize,
    live_downloaded: usize,
    confirmed_absent: usize,
    forbidden: usize,
    rate_limited: usize,
    not_found: usize,
    http_errors: usize,
    transport_errors: usize,
}

impl BritBaseCoverage {
    fn available(&self) -> usize {
        self.indexed
            .saturating_add(self.raw_cached)
            .saturating_add(self.live_downloaded)
    }

    fn failed_live_attempts(&self) -> usize {
        self.live_attempted
            .saturating_sub(self.live_downloaded)
            .saturating_sub(self.confirmed_absent)
    }

    fn accounted(&self) -> usize {
        self.available().saturating_add(self.confirmed_absent)
    }

    fn not_attempted(&self) -> usize {
        self.advertised
            .saturating_sub(self.accounted())
            .saturating_sub(self.failed_live_attempts())
    }

    fn is_complete(&self) -> bool {
        self.accounted() == self.advertised
    }

    fn incomplete_message(&self) -> String {
        let mut statuses = Vec::new();
        if self.forbidden > 0 {
            statuses.push(format!("{} returned HTTP 403 Forbidden", self.forbidden));
        }
        if self.rate_limited > 0 {
            statuses.push(format!("{} were rate-limited", self.rate_limited));
        }
        if self.not_found > 0 {
            statuses.push(format!(
                "{} were confirmed absent after all equivalent URLs returned HTTP 404",
                self.not_found
            ));
        }
        if self.http_errors > 0 {
            statuses.push(format!("{} returned other HTTP errors", self.http_errors));
        }
        if self.transport_errors > 0 {
            statuses.push(format!(
                "{} timed out or had transport errors",
                self.transport_errors
            ));
        }
        let status_summary = if statuses.is_empty() {
            "no live archive request was completed".to_string()
        } else {
            statuses.join(", ")
        };
        format!(
            "BritBase coverage is partial: {}/{} advertised files are accounted for ({} available from the index/cache/download and {} confirmed absent after every equivalent URL returned 404); {} advertised files were attempted live this run ({} downloaded; {}); {} advertised files were not attempted. These are file counts, not missing-game counts.",
            self.accounted(),
            self.advertised,
            self.available(),
            self.confirmed_absent,
            self.live_attempted,
            self.live_downloaded,
            status_summary,
            self.not_attempted(),
        )
    }
}

#[derive(Debug)]
enum BritBaseFetchFailure {
    Forbidden,
    RateLimited(Option<u64>),
    Http(u16),
    Transport(String),
}

impl BritBaseFetchFailure {
    fn blocks_host(&self) -> bool {
        matches!(
            self,
            Self::Forbidden | Self::RateLimited(_) | Self::Transport(_)
        ) || matches!(self, Self::Http(status) if *status >= 500)
    }

    fn description(&self) -> String {
        match self {
            Self::Forbidden => "HTTP 403 Forbidden".to_string(),
            Self::RateLimited(Some(seconds)) => {
                format!("HTTP 429 Too Many Requests (Retry-After {seconds}s)")
            }
            Self::RateLimited(None) => "HTTP 429 Too Many Requests".to_string(),
            Self::Http(status) => format!("HTTP {status}"),
            Self::Transport(error) => format!("transport error: {error}"),
        }
    }
}

enum BritBaseLiveFetch {
    Downloaded(Vec<u8>),
    NotFound,
    Failed(BritBaseFetchFailure),
}

struct IndexedArchiveAttempt {
    spec: IndexedArchiveSpec,
    cached: bool,
    outcome: Option<ScanOutcome>,
    error: Option<String>,
}

struct DirectLichessAttempt {
    spec: IndexedArchiveSpec,
    result: Result<(bool, ScanOutcome), String>,
}

/// Scans small Lichess round or tournament PGNs straight from the same persistent
/// byte cache used by the archive index. Updating the global SQLite indexes for
/// a transient broadcast can dominate an otherwise sub-second player filter;
/// direct parsing preserves the exact payload, matcher, freshness, and source
/// accounting without performing that multi-gigabyte index write.
async fn scan_direct_lichess_pgn_archives(
    client: &Client,
    request: &OtbImportRequest,
    identity: &Arc<PlayerIdentity>,
    collection: &Mutex<Collection>,
    app: &OtbProgressSink<'_>,
    source: &'static str,
    report: &mut OtbImportSourceReport,
    specs: Vec<IndexedArchiveSpec>,
    max_age: Option<Duration>,
) {
    if specs.is_empty() {
        return;
    }

    let total = specs.len();
    let started = AtomicUsize::new(0);
    let mut scans = stream::iter(specs.into_iter().map(|spec| {
        let client = client.clone();
        let identity = Arc::clone(identity);
        let started = &started;
        async move {
            let position = started.fetch_add(1, Ordering::Relaxed);
            emit_progress(
                app,
                request,
                source,
                "downloading",
                position,
                total,
                games_len(collection),
                format!("Scanning broadcast {}", spec.url),
            );
            fetch_and_scan_direct_lichess_spec(
                &client,
                identity,
                source,
                request.from_year,
                spec,
                max_age,
            )
            .await
        }
    }))
    .buffer_unordered(LICHESS_CONCURRENCY);

    let mut attempts = Vec::new();
    while let Some(attempt) = scans.next().await {
        attempts.push(attempt);
    }
    merge_direct_lichess_attempts(request, collection, app, source, report, attempts);
}

fn merge_direct_lichess_attempts(
    request: &OtbImportRequest,
    collection: &Mutex<Collection>,
    app: &OtbProgressSink<'_>,
    source: &'static str,
    report: &mut OtbImportSourceReport,
    mut attempts: Vec<DirectLichessAttempt>,
) {
    attempts.sort_by(|left, right| left.spec.url.cmp(&right.spec.url));
    let total = attempts.len();
    for (index, DirectLichessAttempt { spec, result }) in attempts.into_iter().enumerate() {
        report.archives_checked = report.archives_checked.saturating_add(1);
        match result {
            Ok((cached, mut outcome)) => {
                if cached {
                    report.cached_archives = report.cached_archives.saturating_add(1);
                }
                if let Some(error) = outcome.error.take() {
                    report.errors.push(format!("{}: {error}", spec.url));
                }
                let (matched, added) = merge_into(collection, outcome, source);
                report.matched_games = report.matched_games.saturating_add(matched);
                report.unique_games_added = report.unique_games_added.saturating_add(added);
            }
            Err(error) => report.errors.push(format!("{}: {error}", spec.url)),
        }
        let done = index + 1;
        emit_progress(
            app,
            request,
            source,
            "downloading",
            done,
            total,
            games_len(collection),
            format!("Scanned {done} of {total} broadcasts"),
        );
    }
}

async fn fetch_and_scan_direct_lichess_spec(
    client: &Client,
    identity: Arc<PlayerIdentity>,
    source: &'static str,
    from_year: u16,
    spec: IndexedArchiveSpec,
    max_age: Option<Duration>,
) -> DirectLichessAttempt {
    let primary = fetch_and_scan_direct_lichess_pgn(
        client,
        Arc::clone(&identity),
        source,
        from_year,
        &spec.url,
        &spec.cache_path,
        max_age,
    )
    .await;
    let needs_fallback = match &primary {
        Ok((_, outcome)) => outcome.matched == 0 || outcome.error.is_some(),
        Err(_) => true,
    };
    let result = if needs_fallback {
        if let Some((fallback_url, fallback_cache_path)) = &spec.lichess_fallback {
            match fetch_and_scan_direct_lichess_pgn(
                client,
                identity,
                source,
                from_year,
                fallback_url,
                fallback_cache_path,
                max_age,
            )
            .await
            {
                Ok((cached, mut outcome)) => {
                    if outcome.matched == 0 && outcome.error.is_none() {
                        outcome.error = Some(format!(
                            "The exact-game endpoint and whole-round fallback contained no matching game for {}.",
                            spec.url
                        ));
                    }
                    Ok((cached, outcome))
                }
                Err(fallback_error) => match primary {
                    Ok((cached, mut outcome)) => {
                        let primary_error = outcome.error.take().unwrap_or_else(|| {
                            "the exact-game endpoint contained no matching game".to_string()
                        });
                        outcome.error = Some(format!(
                            "{primary_error}; whole-round fallback {fallback_url} also failed: {fallback_error}"
                        ));
                        Ok((cached, outcome))
                    }
                    Err(primary_error) => Err(format!(
                        "exact-game endpoint failed: {primary_error}; whole-round fallback {fallback_url} also failed: {fallback_error}"
                    )),
                },
            }
        } else {
            primary
        }
    } else {
        primary
    };
    let result = if spec.require_match {
        result.map(|(cached, mut outcome)| {
            if outcome.matched == 0 && outcome.error.is_none() {
                outcome.error = Some(
                    "The complete tournament export contained no matching game for the FIDE player advertised by Lichess."
                        .to_string(),
                );
            }
            (cached, outcome)
        })
    } else {
        result
    };
    DirectLichessAttempt { spec, result }
}

async fn fetch_and_scan_direct_lichess_pgn(
    client: &Client,
    identity: Arc<PlayerIdentity>,
    source: &'static str,
    from_year: u16,
    url: &str,
    cache_path: &Path,
    max_age: Option<Duration>,
) -> Result<(bool, ScanOutcome), String> {
    let (bytes, cached) = fetch_lichess_cached_within(client, url, cache_path, max_age).await?;
    let outcome = scan_pgn_bytes(bytes, identity, source, url.to_string(), from_year).await;
    Ok((cached, outcome))
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
    let index_run = index_run_for_request(request);
    let urls = specs
        .iter()
        .map(|spec| spec.url.clone())
        .collect::<Vec<_>>();
    let mut indexed =
        match index::indexed_urls(&index_path, &urls, max_age, index_run.clone()).await {
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
            if let Ok(stale_indexed) =
                index::indexed_urls(&index_path, &urls, None, index_run.clone()).await
            {
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
        let index_run = index_run.clone();
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
                        index_run,
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
        index_run.clone(),
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
                let index_run = index_run.clone();
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
                                index_run,
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
    // A historical Chessscope row ultimately points back to a Lichess round.
    // Once the complete year is already inside the verified monthly corpus,
    // fetching its per-game HTML merely rediscovers data the indexed archive
    // lane is already querying. Unknown and partially covered years retain the
    // original page path, so this removes requests without removing coverage.
    let corpus_coverage = lichess_corpus_coverage(request).await;
    let discovered_game_pages = game_urls.len();
    game_urls.retain(|(_, year)| !year.is_some_and(|year| corpus_coverage.covers_year(year)));
    let corpus_covered_game_pages = discovered_game_pages.saturating_sub(game_urls.len());
    if corpus_covered_game_pages > 0 {
        emit_progress(
            app,
            request,
            SOURCE,
            "discovering",
            corpus_covered_game_pages,
            discovered_game_pages,
            games_len(collection),
            format!(
                "Skipped {corpus_covered_game_pages} historical Chessscope pages already covered by the indexed Lichess corpus"
            ),
        );
    }
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
    for (round_path, (year, game_date)) in rounds {
        // Some older Chessscope rows have a real event year but no exact game
        // date. The whole year is covered only when even its final day precedes
        // the verified monthly cutoff; otherwise retain the original fetch.
        if game_date
            .as_deref()
            .is_some_and(|date| corpus_coverage.covers_date(date))
            || (game_date.is_none() && year.is_some_and(|year| corpus_coverage.covers_year(year)))
        {
            continue;
        }
        let recent = year.is_none_or(|year| year >= current_year);
        if recent {
            recent_rounds.push(round_path);
        } else {
            historical_rounds.push(round_path);
        }
    }
    let historical_specs = resolve_lichess_round_specs(
        client,
        request,
        historical_rounds,
        &corpus_coverage,
        identity,
        SOURCE,
        &mut report,
    )
    .await;
    let recent_specs = resolve_lichess_round_specs(
        client,
        request,
        recent_rounds,
        &corpus_coverage,
        identity,
        SOURCE,
        &mut report,
    )
    .await;
    scan_direct_lichess_pgn_archives(
        client,
        request,
        identity,
        collection,
        app,
        SOURCE,
        &mut report,
        historical_specs,
        None,
    )
    .await;
    scan_direct_lichess_pgn_archives(
        client,
        request,
        identity,
        collection,
        app,
        SOURCE,
        &mut report,
        recent_specs,
        Some(GROWING_ARCHIVE_CACHE_MAX_AGE),
    )
    .await;

    report
}

/// Resolves each advertised card to its complete tournament, then asks Lichess
/// for every exact chapter belonging to this player. FIDE cards link only the
/// last round of multi-round events, so scanning the card's round alone is not a
/// complete player import. Each bounded chunk resolves metadata concurrently,
/// then finishes its selected tours while the network lane remains serial.
struct LichessFideResolvedCard {
    round_path: String,
    tour_id: Option<String>,
    dates: Option<(i64, i64)>,
    finished: bool,
    player_keys: Vec<String>,
    direct_specs: Vec<IndexedArchiveSpec>,
    fallback: Option<IndexedArchiveSpec>,
    error: Option<String>,
}

async fn scan_lichess_rounds_pipelined(
    client: &Client,
    request: &OtbImportRequest,
    identity: &Arc<PlayerIdentity>,
    collection: &Mutex<Collection>,
    app: &OtbProgressSink<'_>,
    source: &'static str,
    report: &mut OtbImportSourceReport,
    mut round_paths: Vec<String>,
    corpus_coverage: &LichessCorpusCoverage,
    origin: &str,
    max_age: Option<Duration>,
) {
    round_paths.sort();
    let mut seen_round_ids = HashSet::new();
    round_paths.retain(|round_path| {
        round_path.rsplit('/').next().is_some_and(|round_id| {
            !round_id.is_empty() && seen_round_ids.insert(round_id.to_string())
        })
    });
    if round_paths.is_empty() {
        return;
    }

    let total_rounds = round_paths.len();
    let mut seen_tours = HashSet::<String>::new();
    let mut attempts = Vec::new();
    let mut errors = Vec::new();
    for (chunk_index, chunk) in round_paths.chunks(LICHESS_CONCURRENCY).enumerate() {
        let chunk_start = chunk_index * LICHESS_CONCURRENCY;
        let mut resolutions = stream::iter(chunk.iter().cloned().enumerate().map(
            |(offset, round_path)| {
                let client = client.clone();
                let identity = Arc::clone(identity);
                let cache_dir = request.cache_dir.clone();
                let origin = origin.to_string();
                async move {
                    emit_progress(
                        app,
                        request,
                        source,
                        "downloading",
                        chunk_start + offset,
                        total_rounds,
                        games_len(collection),
                        format!("Resolving broadcast {round_path}"),
                    );
                    resolve_lichess_fide_card_metadata(
                        &client, &cache_dir, round_path, &identity, &origin,
                    )
                    .await
                }
            },
        ))
        .buffer_unordered(LICHESS_CONCURRENCY);

        let mut resolved = Vec::with_capacity(chunk.len());
        while let Some(card) = resolutions.next().await {
            resolved.push(card);
        }
        resolved.sort_by(|left, right| {
            left.tour_id
                .as_deref()
                .unwrap_or("")
                .cmp(right.tour_id.as_deref().unwrap_or(""))
                .then_with(|| left.round_path.cmp(&right.round_path))
        });

        // Finish the selected tours from this bounded metadata window before
        // opening the next one. Sorting above makes duplicate-tour selection
        // independent of cache/network response order.
        for card in resolved {
            if let Some(error) = card.error {
                errors.push(error);
            }
            let Some(tour_id) = card.tour_id else {
                if let Some(spec) = card.fallback {
                    attempts.push(
                        fetch_and_scan_direct_lichess_spec(
                            client,
                            Arc::clone(identity),
                            source,
                            request.from_year,
                            spec,
                            max_age,
                        )
                        .await,
                    );
                }
                continue;
            };
            if card
                .dates
                .is_some_and(|(starts, ends)| corpus_coverage.covers_timestamp_range(starts, ends))
            {
                continue;
            }
            if !seen_tours.insert(tour_id.clone()) {
                continue;
            }

            // Player-tour JSON has no per-game dates. If even one month in the
            // tour is uncovered, fetch every exact chapter and let the PGN year
            // filter decide; skipping individual chapters would lose games.
            // A round page also carries the tour's exhaustive round list. When
            // it proves this is a one-round tour, its chapter roster is already
            // the complete player roster and a second HTTP lookup cannot add a
            // game. Multi-round tours retain the complete player endpoint.
            let mut specs = card.direct_specs;
            if specs.is_empty() {
                specs = resolve_lichess_tour_player_specs(
                    client,
                    &request.cache_dir,
                    origin.trim_end_matches('/'),
                    &tour_id,
                    &card.player_keys,
                    card.finished,
                )
                .await;
            }
            if specs.is_empty() {
                // Every player key failed or returned no complete game list.
                // Scan the full tour as the lossless, required-match fallback.
                let url = format!(
                    "{}/api/broadcast/{tour_id}.pgn",
                    origin.trim_end_matches('/')
                );
                let cache_path = request
                    .cache_dir
                    .join(cache_file_name("lichess-broadcast-tour", &url));
                specs.push(IndexedArchiveSpec::lichess_complete_tour(url, cache_path));
            }
            for spec in specs {
                attempts.push(
                    fetch_and_scan_direct_lichess_spec(
                        client,
                        Arc::clone(identity),
                        source,
                        request.from_year,
                        spec,
                        max_age,
                    )
                    .await,
                );
            }
        }
    }
    errors.sort();
    report.errors.extend(errors);
    // Task completion is intentionally unordered. Merge only after restoring a
    // total URL order so source precedence, deduplication and output are stable.
    merge_direct_lichess_attempts(request, collection, app, source, report, attempts);
}

async fn resolve_lichess_fide_card_metadata(
    client: &Client,
    cache_dir: &Path,
    round_path: String,
    identity: &PlayerIdentity,
    origin: &str,
) -> LichessFideResolvedCard {
    let origin = origin.trim_end_matches('/');
    let Some(round_id) = round_path.rsplit('/').next().filter(|id| !id.is_empty()) else {
        return LichessFideResolvedCard {
            round_path: round_path.clone(),
            tour_id: None,
            dates: None,
            finished: false,
            player_keys: Vec::new(),
            direct_specs: Vec::new(),
            fallback: None,
            error: Some(format!("Invalid Lichess round path {round_path}")),
        };
    };
    let round_id = round_id.to_string();
    let page_url = format!("{origin}{round_path}");
    let metadata =
        fetch_lichess_round_metadata(client, cache_dir, origin, round_path.as_str(), &round_id)
            .await;

    let value = match metadata {
        Ok(value) => value,
        Err(error) => {
            return LichessFideResolvedCard {
                round_path,
                tour_id: None,
                dates: None,
                finished: false,
                player_keys: Vec::new(),
                direct_specs: Vec::new(),
                fallback: Some(lichess_round_fallback_spec(cache_dir, origin, &round_id)),
                error: Some(format!(
                    "{page_url}: round metadata failed ({error}); only the advertised round could be recovered, so tournament coverage may be incomplete"
                )),
            };
        }
    };
    let Some((tour_id, dates)) = lichess_tour_id_and_dates(&value) else {
        return LichessFideResolvedCard {
            round_path,
            tour_id: None,
            dates: None,
            finished: false,
            player_keys: Vec::new(),
            direct_specs: Vec::new(),
            fallback: Some(lichess_round_fallback_spec(cache_dir, origin, &round_id)),
            error: Some(format!(
                "{page_url}: round metadata did not identify its tournament; only the advertised round could be recovered, so tournament coverage may be incomplete"
            )),
        };
    };
    let player_keys = lichess_tour_player_keys(&value, identity);
    let direct_specs =
        lichess_single_round_player_specs(&value, identity, cache_dir, origin, &round_id);
    let finished = value
        .get("round")
        .and_then(|round| round.get("finished"))
        .and_then(serde_json::Value::as_bool)
        == Some(true);
    LichessFideResolvedCard {
        round_path,
        tour_id: Some(tour_id),
        dates,
        finished,
        player_keys,
        direct_specs,
        fallback: None,
        error: None,
    }
}

/// The normal broadcast page already embeds the tour, exhaustive round list and
/// current chapter roster in `page-init-data`. Reusing that one browser payload
/// avoids a redundant unauthenticated round-API call; the official API remains
/// the compatibility fallback if the HTML contract changes.
async fn fetch_lichess_round_metadata(
    client: &Client,
    cache_dir: &Path,
    origin: &str,
    round_path: &str,
    round_id: &str,
) -> Result<serde_json::Value, String> {
    let origin = origin.trim_end_matches('/');
    let page_url = format!("{origin}{round_path}");
    let page_cache_path = cache_dir.join(cache_file_name("lichess-round-page", &page_url));
    let page_error = match fetch_cached_within(
        client,
        &page_url,
        &page_cache_path,
        Some(PAGE_CACHE_MAX_AGE),
    )
    .await
    {
        Ok(Some((bytes, _))) => {
            let html = String::from_utf8_lossy(&bytes);
            match extract_lichess_round_page_metadata(&html, round_id) {
                Ok(value) => return Ok(value),
                Err(error) => error,
            }
        }
        Ok(None) => "the public round page returned 404".to_string(),
        Err(error) => error,
    };

    let api_url = format!("{origin}/api{round_path}");
    let api_cache_path = cache_dir.join(cache_file_name("lichess-fide-round", &api_url));
    let api_result = async {
        let (bytes, _) = fetch_lichess_json_cached_within(
            client,
            &api_url,
            &api_cache_path,
            Some(PAGE_CACHE_MAX_AGE),
        )
        .await?;
        serde_json::from_slice::<serde_json::Value>(&bytes).map_err(|error| error.to_string())
    }
    .await;
    api_result.map_err(|api_error| {
        format!("public round page failed ({page_error}); API fallback failed ({api_error})")
    })
}

fn extract_lichess_round_page_metadata(
    html: &str,
    round_id: &str,
) -> Result<serde_json::Value, String> {
    let json = html
        .split("<script")
        .skip(1)
        .find_map(|tail| {
            let (attributes, body) = tail.split_once('>')?;
            let is_page_data = extract_quoted_values(attributes, "id=")
                .into_iter()
                .any(|id| id == "page-init-data");
            is_page_data
                .then(|| body.split_once("</script>").map(|(json, _)| json))
                .flatten()
        })
        .ok_or_else(|| "page-init-data was missing from the public round page".to_string())?;
    let page = serde_json::from_str::<serde_json::Value>(json)
        .map_err(|error| format!("invalid page-init-data JSON: {error}"))?;
    let relay = page
        .get("relay")
        .ok_or_else(|| "page-init-data omitted relay metadata".to_string())?;
    let tour = relay
        .get("tour")
        .cloned()
        .ok_or_else(|| "page-init-data omitted the tournament".to_string())?;
    let rounds = relay
        .get("rounds")
        .and_then(serde_json::Value::as_array)
        .filter(|rounds| !rounds.is_empty())
        .ok_or_else(|| "page-init-data omitted the tournament round list".to_string())?;
    let round = rounds
        .iter()
        .find(|round| round.get("id").and_then(serde_json::Value::as_str) == Some(round_id))
        .cloned()
        .ok_or_else(|| format!("page-init-data did not contain advertised round {round_id}"))?;
    let games = page
        .get("study")
        .and_then(|study| study.get("chapters"))
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut metadata = serde_json::Map::new();
    metadata.insert("tour".to_string(), tour);
    metadata.insert("round".to_string(), round);
    metadata.insert("games".to_string(), serde_json::Value::Array(games));
    // Unlike the JSON round endpoint, the browser bootstrap includes the
    // exhaustive tour round list. Its cardinality proves when the advertised
    // round roster is the complete tournament roster.
    metadata.insert(
        "tourRounds".to_string(),
        serde_json::Value::Array(rounds.clone()),
    );
    Ok(serde_json::Value::Object(metadata))
}

fn lichess_single_round_player_specs(
    value: &serde_json::Value,
    identity: &PlayerIdentity,
    cache_dir: &Path,
    origin: &str,
    round_id: &str,
) -> Vec<IndexedArchiveSpec> {
    let finished = value
        .get("round")
        .and_then(|round| round.get("finished"))
        .and_then(serde_json::Value::as_bool)
        == Some(true);
    let single_round = value
        .get("tourRounds")
        .and_then(serde_json::Value::as_array)
        .filter(|rounds| rounds.len() == 1)
        .and_then(|rounds| rounds.first())
        .and_then(|round| round.get("id"))
        .and_then(serde_json::Value::as_str)
        == Some(round_id);
    // A live singleton can still gain chapters. Only a finished round makes
    // the page bootstrap roster exhaustive enough to replace the fresh player
    // endpoint without risking a silent partial import.
    if !finished || !single_round {
        return Vec::new();
    }
    let Some(chapter_ids) = lichess_player_chapter_ids(value, identity) else {
        return Vec::new();
    };
    let origin = origin.trim_end_matches('/');
    let fallback = lichess_round_fallback_spec(cache_dir, origin, round_id);
    chapter_ids
        .into_iter()
        .map(|chapter_id| {
            let url = lichess_study_chapter_url(origin, round_id, &chapter_id);
            let cache_path = cache_dir.join(cache_file_name("lichess-broadcast-game", &url));
            IndexedArchiveSpec::lichess_with_fallback(
                url,
                cache_path,
                fallback.url.clone(),
                fallback.cache_path.clone(),
            )
        })
        .collect()
}

async fn resolve_lichess_tour_player_specs(
    client: &Client,
    cache_dir: &Path,
    origin: &str,
    tour_id: &str,
    player_keys: &[String],
    finished: bool,
) -> Vec<IndexedArchiveSpec> {
    for player_key in player_keys {
        let url = format!("{origin}/broadcast/{tour_id}/players/{player_key}");
        let cache_path = cache_dir.join(cache_file_name("lichess-fide-tour-player", &url));
        let fetched = if finished {
            fetch_lichess_json_cached_within(client, &url, &cache_path, Some(PAGE_CACHE_MAX_AGE))
                .await
        } else {
            fetch_lichess_json_fresh(client, &url, &cache_path).await
        };
        let value = match fetched {
            Ok((bytes, _)) => serde_json::from_slice::<serde_json::Value>(&bytes).ok(),
            Err(_) => None,
        };
        if let Some(specs) = value
            .as_ref()
            .and_then(|value| lichess_tour_player_specs(value, cache_dir, origin))
        {
            return specs;
        }
    }
    Vec::new()
}

/// Chooses the most specific tour-player key without wasting a request known to
/// be absent. Older broadcasts often have the exact player name but no FIDE ID;
/// their advertised round proves that before the tour lookup. Modern tagged
/// rounds keep the FIDE ID first, and every ordering retains the other key as a
/// lossless fallback.
fn lichess_tour_player_keys(
    round_metadata: &serde_json::Value,
    identity: &PlayerIdentity,
) -> Vec<String> {
    let mut exact_names = Vec::new();
    let mut target_fide_is_tagged = false;
    if let Some(games) = round_metadata
        .get("games")
        .and_then(serde_json::Value::as_array)
    {
        for player in games
            .iter()
            .filter_map(|game| game.get("players").and_then(serde_json::Value::as_array))
            .flatten()
        {
            let fide_id = roster_fide_id(player);
            let name = player.get("name").and_then(serde_json::Value::as_str);
            let matched = identity.fide_id.as_deref().is_some_and(|target_id| {
                fide_id.as_deref() == Some(target_id)
                    || (fide_id.is_none() && name.is_some_and(|name| identity.name_matches(name)))
            });
            if !matched {
                continue;
            }
            target_fide_is_tagged |= fide_id.is_some();
            if let Some(name) = name {
                exact_names.push(percent_encode_path_segment(name));
            }
        }
    }
    exact_names.sort();
    exact_names.dedup();

    let numeric = identity.fide_id.clone();
    let canonical_name = percent_encode_path_segment(&identity.canonical_name);
    let mut keys = Vec::new();
    if target_fide_is_tagged {
        keys.extend(numeric.iter().cloned());
        keys.extend(exact_names);
        keys.push(canonical_name);
    } else if !exact_names.is_empty() {
        keys.extend(exact_names);
        keys.push(canonical_name);
        keys.extend(numeric);
    } else {
        keys.extend(numeric);
        keys.push(canonical_name);
    }
    let mut seen = HashSet::new();
    keys.retain(|key| seen.insert(key.clone()));
    keys
}

fn lichess_tour_id_and_dates(value: &serde_json::Value) -> Option<(String, Option<(i64, i64)>)> {
    let tour = value.get("tour")?;
    let id = tour
        .get("id")
        .and_then(serde_json::Value::as_str)
        .filter(|id| valid_lichess_id(id))?
        .to_string();
    let dates = tour
        .get("dates")
        .and_then(serde_json::Value::as_array)
        .and_then(|dates| {
            let starts = dates.first()?.as_i64()?;
            let ends = dates
                .get(1)
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(starts);
            Some((starts, ends))
        });
    Some((id, dates))
}

fn lichess_tour_player_specs(
    value: &serde_json::Value,
    cache_dir: &Path,
    origin: &str,
) -> Option<Vec<IndexedArchiveSpec>> {
    let games = value.get("games").and_then(serde_json::Value::as_array)?;
    if games.is_empty() {
        return None;
    }
    let mut specs = HashMap::new();
    for game in games {
        let round_id = game
            .get("round")
            .and_then(serde_json::Value::as_str)
            .filter(|id| valid_lichess_id(id))?;
        let chapter_id = game
            .get("id")
            .and_then(serde_json::Value::as_str)
            .filter(|id| valid_lichess_id(id))?;
        let url = lichess_study_chapter_url(origin, round_id, chapter_id);
        let cache_path = cache_dir.join(cache_file_name("lichess-broadcast-game", &url));
        let fallback = lichess_round_fallback_spec(cache_dir, origin, round_id);
        specs.insert(
            url.clone(),
            IndexedArchiveSpec::lichess_with_fallback(
                url,
                cache_path,
                fallback.url,
                fallback.cache_path,
            ),
        );
    }
    let mut specs = specs.into_values().collect::<Vec<_>>();
    specs.sort_by(|left, right| left.url.cmp(&right.url));
    (!specs.is_empty()).then_some(specs)
}

fn lichess_round_fallback_spec(
    cache_dir: &Path,
    origin: &str,
    round_id: &str,
) -> IndexedArchiveSpec {
    let url = lichess_study_round_url(origin, round_id);
    let cache_path = cache_dir.join(cache_file_name("lichess-broadcast", &url));
    IndexedArchiveSpec::lichess(url, cache_path)
}

fn lichess_study_chapter_url(origin: &str, round_id: &str, chapter_id: &str) -> String {
    format!(
        "{}/api/study/{round_id}/{chapter_id}.pgn?{LICHESS_STUDY_EXPORT_QUERY}",
        origin.trim_end_matches('/')
    )
}

fn lichess_study_round_url(origin: &str, round_id: &str) -> String {
    format!(
        "{}/api/study/{round_id}.pgn?{LICHESS_STUDY_EXPORT_QUERY}",
        origin.trim_end_matches('/')
    )
}

fn valid_lichess_id(id: &str) -> bool {
    id.len() == 8
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
}

fn percent_encode_path_segment(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(*byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(*byte as char);
        } else {
            encoded.push('%');
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
    }
    encoded
}

/// Resolves already-known player rounds to exact single-game study PGNs.
/// Lichess round metadata contains the chapter IDs and player FIDE IDs, so a
/// target chapter preserves every PGN byte and annotation without synthesizing
/// the other boards. Any missing, ambiguous, or failed exact export falls back
/// to the whole round in [`scan_direct_lichess_pgn_archives`].
async fn resolve_lichess_round_specs(
    client: &Client,
    request: &OtbImportRequest,
    round_paths: Vec<String>,
    corpus_coverage: &LichessCorpusCoverage,
    identity: &Arc<PlayerIdentity>,
    _source: &'static str,
    _report: &mut OtbImportSourceReport,
) -> Vec<IndexedArchiveSpec> {
    let mut lookups = stream::iter(round_paths.into_iter().map(|round_path| {
        let client = client.clone();
        let cache_dir = request.cache_dir.clone();
        let identity = Arc::clone(identity);
        async move {
            resolve_lichess_round_specs_for_path(
                &client,
                &cache_dir,
                &round_path,
                corpus_coverage,
                &identity,
                "https://lichess.org",
            )
            .await
        }
    }))
    .buffered(LICHESS_CONCURRENCY);

    let mut specs = HashMap::<String, IndexedArchiveSpec>::new();
    while let Some(round_specs) = lookups.next().await {
        for spec in round_specs {
            specs.insert(spec.url.clone(), spec);
        }
    }

    let mut specs = specs.into_values().collect::<Vec<_>>();
    specs.sort_by(|left, right| left.url.cmp(&right.url));
    specs
}

async fn resolve_lichess_round_specs_for_path(
    client: &Client,
    cache_dir: &Path,
    round_path: &str,
    corpus_coverage: &LichessCorpusCoverage,
    identity: &PlayerIdentity,
    origin: &str,
) -> Vec<IndexedArchiveSpec> {
    let Some(round_id) = round_path.rsplit('/').next().filter(|id| !id.is_empty()) else {
        return Vec::new();
    };
    let origin = origin.trim_end_matches('/');
    let result: Result<(Option<String>, serde_json::Value), String> = async {
        let value =
            fetch_lichess_round_metadata(client, cache_dir, origin, round_path, round_id).await?;
        let starts_at = value
            .get("round")
            .and_then(|round| round.get("startsAt"))
            .and_then(serde_json::Value::as_i64)
            .and_then(chrono::DateTime::<Utc>::from_timestamp_millis)
            .map(|date| date.format("%Y-%m-%d").to_string());
        Ok((starts_at, value))
    }
    .await;

    let fallback = lichess_round_fallback_spec(cache_dir, origin, round_id);
    let fallback_url = fallback.url;
    let fallback_cache_path = fallback.cache_path;
    let mut specs = Vec::new();
    match result {
        Ok((Some(starts_at), _)) if corpus_coverage.covers_date(&starts_at) => {}
        Ok((_, value)) => {
            if let Some(chapter_ids) = lichess_player_chapter_ids(&value, identity) {
                for chapter_id in chapter_ids {
                    let url = lichess_study_chapter_url(origin, round_id, &chapter_id);
                    let cache_path =
                        cache_dir.join(cache_file_name("lichess-broadcast-game", &url));
                    specs.push(IndexedArchiveSpec::lichess_with_fallback(
                        url,
                        cache_path,
                        fallback_url.clone(),
                        fallback_cache_path.clone(),
                    ));
                }
            } else {
                specs.push(IndexedArchiveSpec::lichess(
                    fallback_url,
                    fallback_cache_path,
                ));
            }
        }
        Err(_error) => {
            // Metadata is only an optimization. The original whole-round
            // request remains authoritative, so report a coverage error only
            // if that fallback also fails during the direct scan.
            specs.push(IndexedArchiveSpec::lichess(
                fallback_url,
                fallback_cache_path,
            ));
        }
    }
    specs.sort_by(|left, right| left.url.cmp(&right.url));
    specs
}

fn lichess_player_chapter_ids(
    value: &serde_json::Value,
    identity: &PlayerIdentity,
) -> Option<Vec<String>> {
    let games = value.get("games")?.as_array()?;
    if games.is_empty() {
        return None;
    }

    let mut usable_roster = false;
    let mut chapter_ids = Vec::new();
    for game in games {
        let Some(players) = game.get("players").and_then(serde_json::Value::as_array) else {
            continue;
        };
        let matched = players.iter().any(|player| {
            let fide_id = roster_fide_id(player);
            let name = player.get("name").and_then(serde_json::Value::as_str);
            if fide_id.is_some() || name.is_some() {
                usable_roster = true;
            }
            if let Some(target_id) = identity.fide_id.as_deref() {
                fide_id.as_deref() == Some(target_id)
                    || (fide_id.is_none() && name.is_some_and(|name| identity.name_matches(name)))
            } else {
                name.is_some_and(|name| identity.name_matches(name))
            }
        });
        if !matched {
            continue;
        }
        let Some(chapter_id) = game
            .get("id")
            .and_then(serde_json::Value::as_str)
            .filter(|id| valid_lichess_id(id))
        else {
            return None;
        };
        chapter_ids.push(chapter_id.to_string());
    }
    chapter_ids.sort();
    chapter_ids.dedup();
    (usable_roster && !chapter_ids.is_empty()).then_some(chapter_ids)
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

    let advertised_urls = list
        .lines()
        .map(str::trim)
        .filter(|url| url.ends_with(".pgn.zst"))
        .collect::<Vec<_>>();
    if let Err(error) =
        validate_discovery_count(SOURCE, LICHESS_BROADCAST_LIST, advertised_urls.len())
    {
        report.errors.push(error);
        return report;
    }
    let mut urls = advertised_urls
        .into_iter()
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
            Err(error) if page > 1 && lichess_listing_is_exhausted(&error) => break,
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

    // A Chess-Results standings link is not proof that its concurrent lane
    // succeeded or served the same (possibly richer/corrected) PGN. Retain
    // those tours, let the roster reject non-target events cheaply, and let
    // final deterministic deduplication select the best copy.
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

fn lichess_listing_is_exhausted(error: &str) -> bool {
    error.to_ascii_lowercase().contains("resource too old")
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
    fetch_lichess_cached_within_mode(client, url, cache_path, max_age, false).await
}

async fn fetch_lichess_json_cached_within(
    client: &Client,
    url: &str,
    cache_path: &Path,
    max_age: Option<Duration>,
) -> Result<(Vec<u8>, bool), String> {
    fetch_lichess_cached_within_mode(client, url, cache_path, max_age, true).await
}

/// Ongoing tournament rosters can gain a new round between imports. Bypass any
/// cached copy and never substitute stale bytes for a failed live refresh; the
/// caller will use the complete-tour PGN fallback instead.
async fn fetch_lichess_json_fresh(
    client: &Client,
    url: &str,
    cache_path: &Path,
) -> Result<(Vec<u8>, bool), String> {
    let bytes = get_lichess_with_backoff_mode(client, url, true).await?;
    write_cache_entry(cache_path, &bytes).await;
    Ok((bytes, false))
}

async fn fetch_lichess_cached_within_mode(
    client: &Client,
    url: &str,
    cache_path: &Path,
    max_age: Option<Duration>,
    accept_json: bool,
) -> Result<(Vec<u8>, bool), String> {
    if let Some(bytes) = read_cache_entry(cache_path, max_age).await {
        return Ok((bytes, true));
    }
    let stale = if max_age.is_some() {
        read_cache_entry(cache_path, None).await
    } else {
        None
    };
    let bytes = match get_lichess_with_backoff_mode(client, url, accept_json).await {
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
            let mut spec = IndexedArchiveSpec::immutable(url, cache_path, ArchiveFormat::Pgn);
            // ChessBase articles commonly retain placeholder or retired live
            // board links ending in `.pgn`. A confirmed 404 contains no online
            // game to omit; keep retrying it on later imports without turning
            // a fully completed search into a false coverage failure.
            spec.optional = true;
            spec
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
    let now = Utc::now();
    let year = now.year();
    let easter_season = format!(
        "{:02}{:02}",
        (year - 1).rem_euclid(100),
        year.rem_euclid(100)
    );
    let easter = format!("easter{}", year.rem_euclid(100));
    let mut optional_current_urls = HashSet::new();
    for section in ["open", "u2000", "u1700", "u1500", "u1400", "u1200"] {
        let url = format!("{FOUR_NCL_ORIGIN}/pgn/{easter_season}/congress/{easter}/{section}.pgn");
        optional_current_urls.insert(url.clone());
        pgn_urls.insert(url);
    }

    // 4NCL seasons roll over in autumn, and the index can advertise the new
    // directory before a calendar-only calculation would. Refresh whichever
    // season is newest between the calendar and the observed index so the
    // first early snapshot of a new season never becomes immutable.
    let calendar_season = four_ncl_season_for_date(year, now.month());
    let season = pgn_urls
        .iter()
        .filter_map(|url| four_ncl_season_from_url(url))
        .max()
        .map_or(calendar_season.clone(), |observed| {
            observed.max(calendar_season)
        });

    let mut pgn_urls = pgn_urls.into_iter().collect::<Vec<_>>();
    pgn_urls.sort();
    // Only the current season can still grow. Historical PGNs are immutable;
    // expiring every indexed season together caused needless host probes and
    // re-indexing on a brand-new player's first search.
    let specs = pgn_urls
        .into_iter()
        .map(|url| IndexedArchiveSpec {
            label: file_name_from_url(&url),
            cache_path: request.cache_dir.join(cache_file_name("4ncl", &url)),
            format: ArchiveFormat::Pgn,
            optional: optional_current_urls.contains(&url),
            lichess: false,
            lichess_fallback: None,
            require_match: false,
            url,
        })
        .collect::<Vec<_>>();
    let (growing_specs, immutable_specs): (Vec<_>, Vec<_>) = specs
        .into_iter()
        .partition(|spec| four_ncl_archive_is_growing(&spec.url, &season));
    scan_indexed_archives(
        client,
        request,
        identity,
        collection,
        app,
        SOURCE,
        &mut report,
        immutable_specs,
        None,
        ARCHIVE_CONCURRENCY,
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
        growing_specs,
        Some(GROWING_ARCHIVE_CACHE_MAX_AGE),
        ARCHIVE_CONCURRENCY,
    )
    .await;

    report
}

fn four_ncl_archive_is_growing(url: &str, current_season: &str) -> bool {
    url.to_ascii_lowercase()
        .contains(&format!("/pgn/{}/", current_season.to_ascii_lowercase()))
}

fn four_ncl_season_for_date(year: i32, month: u32) -> String {
    let (start, end) = if month >= 9 {
        (year, year + 1)
    } else {
        (year - 1, year)
    };
    format!("{:02}{:02}", start.rem_euclid(100), end.rem_euclid(100))
}

fn four_ncl_season_from_url(url: &str) -> Option<String> {
    let lower = url.to_ascii_lowercase();
    let tail = lower.split("/pgn/").nth(1)?;
    let season = tail.split('/').next()?;
    (season.len() == 4 && season.chars().all(|char| char.is_ascii_digit()))
        .then(|| season.to_string())
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
            // These names currently share one physical host. Keep the alias
            // fallback sequential and normalize every discovered archive to one
            // stable key so failover never invalidates an existing index row.
            let mut errors = Vec::new();
            let mut checked = 0u32;
            let mut urls = Vec::new();
            let mut loaded = false;
            for origin in BRITBASE_ORIGINS {
                let index_url = format!("{origin}{path}");
                match fetch_page_cached(&client, &index_url, &cache_dir, "britbase-index").await {
                    Ok(Some(html)) => {
                        checked += 1;
                        urls = extract_britbase_archive_urls(
                            &html,
                            from_year,
                            BRITBASE_CANONICAL_ORIGIN,
                        );
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
            } else if urls.is_empty() {
                errors.push(
                    validate_discovery_count(
                        SOURCE,
                        &format!("{BRITBASE_CANONICAL_ORIGIN}{path}"),
                        0,
                    )
                    .expect_err("an empty BritBase index must be rejected"),
                );
            } else {
                // A failed alias is only fallback telemetry. Once an equivalent
                // index loads, retaining that transient error would incorrectly
                // mark the source and whole import as coverage-incomplete.
                errors.clear();
            }
            (
                checked,
                errors,
                format!("{BRITBASE_CANONICAL_ORIGIN}{path}"),
                urls,
            )
        }
    }))
    .buffered(ARCHIVE_CONCURRENCY);

    let mut archive_referers = HashMap::new();
    while let Some((checked, errors, referer, urls)) = indexes.next().await {
        report.archives_checked = report.archives_checked.saturating_add(checked);
        report.errors.extend(errors);
        for url in urls {
            archive_referers
                .entry(canonical_britbase_url(&url))
                .or_insert_with(|| (url, referer.clone()));
        }
    }

    let mut specs = archive_referers
        .into_iter()
        .map(|(_, (url, referer))| BritBaseArchiveSpec::new(url, referer, &request.cache_dir))
        .collect::<Vec<_>>();
    specs.sort_by(|left, right| left.url.cmp(&right.url));
    scan_britbase_archives(
        client,
        request,
        identity,
        collection,
        app,
        SOURCE,
        &mut report,
        specs,
    )
    .await;

    report
}

async fn scan_britbase_archives(
    client: &Client,
    request: &OtbImportRequest,
    identity: &Arc<PlayerIdentity>,
    collection: &Mutex<Collection>,
    app: &OtbProgressSink<'_>,
    source: &'static str,
    report: &mut OtbImportSourceReport,
    specs: Vec<BritBaseArchiveSpec>,
) {
    if specs.is_empty() {
        if report.errors.is_empty() {
            report.errors.push(
                validate_discovery_count(source, "the selected BritBase indexes", 0)
                    .expect_err("an empty BritBase discovery must be rejected"),
            );
        }
        return;
    }

    let index_path = archive_index_path(&request.cache_dir);
    let index_run = index_run_for_request(request);
    let all_index_keys = specs
        .iter()
        .flat_map(|spec| spec.index_keys.iter().cloned())
        .collect::<Vec<_>>();
    let indexed_keys =
        match index::indexed_urls(&index_path, &all_index_keys, None, index_run.clone()).await {
            Ok(indexed) => indexed,
            Err(error) => {
                report.errors.push(format!("Archive index: {error}"));
                HashSet::new()
            }
        };
    let selected_index_keys = specs
        .iter()
        .filter_map(|spec| {
            spec.index_keys
                .iter()
                .find(|key| indexed_keys.contains(*key))
                .map(|key| (spec.url.clone(), key.clone()))
        })
        .collect::<Vec<_>>();
    let key_to_canonical = selected_index_keys
        .iter()
        .map(|(canonical, key)| (key.clone(), canonical.clone()))
        .collect::<HashMap<_, _>>();
    let query_keys = selected_index_keys
        .iter()
        .map(|(_, key)| key.clone())
        .collect::<Vec<_>>();
    let mut coverage = BritBaseCoverage {
        advertised: specs.len(),
        ..BritBaseCoverage::default()
    };
    let mut available = HashSet::new();

    if !query_keys.is_empty() {
        match index::query_indexed(
            &index_path,
            &query_keys,
            Arc::clone(identity),
            source,
            request.from_year,
            index_run.clone(),
        )
        .await
        {
            Ok(outcomes) => {
                for (key, outcome) in outcomes {
                    let Some(canonical) = key_to_canonical.get(&key) else {
                        continue;
                    };
                    available.insert(canonical.clone());
                    coverage.indexed += 1;
                    report.archives_checked = report.archives_checked.saturating_add(1);
                    report.cached_archives = report.cached_archives.saturating_add(1);
                    merge_britbase_outcome(collection, report, outcome, source, canonical);
                }
            }
            Err(error) => report.errors.push(format!("Archive index query: {error}")),
        }
    }

    // A downloaded file can survive a cancelled or interrupted index write.
    // Recover every such cache entry before deciding whether network access is
    // needed; alias-named cache files are recognized without rewriting them.
    let cache_candidates = specs
        .iter()
        .filter(|spec| !available.contains(&spec.url))
        .cloned()
        .collect::<Vec<_>>();
    for spec in &cache_candidates {
        let Some(bytes) = read_britbase_cache_entry(spec).await else {
            continue;
        };
        let indexed = index::index_and_scan(
            &index_path,
            spec.url.clone(),
            bytes,
            spec.format,
            Arc::clone(identity),
            source,
            request.from_year,
            index_run.clone(),
        )
        .await;
        if let Some(error) = indexed.index_error {
            report
                .errors
                .push(format!("{}: index: {error}", spec.label));
        }
        available.insert(spec.url.clone());
        coverage.raw_cached += 1;
        report.archives_checked = report.archives_checked.saturating_add(1);
        report.cached_archives = report.cached_archives.saturating_add(1);
        merge_britbase_outcome(collection, report, indexed.outcome, source, &spec.url);
    }

    let pending = specs
        .iter()
        .filter(|spec| !available.contains(&spec.url))
        .cloned()
        .collect::<Vec<_>>();
    let mut consecutive_host_failures = 0usize;
    let mut stop_live_fetches = false;
    let mut diagnostics = Vec::new();

    // Fetch in explicit batches so a host-level failure burst cannot
    // accidentally start another batch while the stream buffer refills.
    for batch in pending.chunks(BRITBASE_CONCURRENCY) {
        let results = fetch_britbase_batch(client, batch).await;

        for (spec, result) in results {
            coverage.live_attempted += 1;
            report.archives_checked = report.archives_checked.saturating_add(1);
            emit_progress(
                app,
                request,
                source,
                "downloading",
                coverage.live_attempted,
                pending.len(),
                games_len(collection),
                format!(
                    "Tried {} of {} missing BritBase archives",
                    coverage.live_attempted,
                    pending.len()
                ),
            );
            match result {
                BritBaseLiveFetch::Downloaded(bytes) => {
                    consecutive_host_failures = 0;
                    coverage.live_downloaded += 1;
                    available.insert(spec.url.clone());
                    let indexed = index::index_and_scan(
                        &index_path,
                        spec.url.clone(),
                        bytes,
                        spec.format,
                        Arc::clone(identity),
                        source,
                        request.from_year,
                        index_run.clone(),
                    )
                    .await;
                    if let Some(error) = indexed.index_error {
                        report
                            .errors
                            .push(format!("{}: index: {error}", spec.label));
                    }
                    merge_britbase_outcome(collection, report, indexed.outcome, source, &spec.url);
                }
                BritBaseLiveFetch::NotFound => {
                    consecutive_host_failures = 0;
                    coverage.not_found += 1;
                    coverage.confirmed_absent += 1;
                    if diagnostics.len() < 3 {
                        diagnostics.push(format!(
                            "{}: every equivalent URL returned HTTP 404 Not Found",
                            spec.url
                        ));
                    }
                }
                BritBaseLiveFetch::Failed(failure) => {
                    let blocks_host = failure.blocks_host();
                    let rate_limited = matches!(failure, BritBaseFetchFailure::RateLimited(_));
                    match &failure {
                        BritBaseFetchFailure::Forbidden => coverage.forbidden += 1,
                        BritBaseFetchFailure::RateLimited(_) => coverage.rate_limited += 1,
                        BritBaseFetchFailure::Http(_) => coverage.http_errors += 1,
                        BritBaseFetchFailure::Transport(_) => coverage.transport_errors += 1,
                    }
                    if diagnostics.len() < 3 {
                        diagnostics.push(format!("{}: {}", spec.url, failure.description()));
                    }
                    if blocks_host {
                        consecutive_host_failures += 1;
                    } else {
                        consecutive_host_failures = 0;
                    }
                    stop_live_fetches |= rate_limited;
                }
            }
        }
        if stop_live_fetches || consecutive_host_failures >= BRITBASE_CONCURRENCY {
            break;
        }
    }

    if !coverage.is_complete() {
        let mut message = coverage.incomplete_message();
        if !diagnostics.is_empty() {
            message.push_str(" Examples: ");
            message.push_str(&diagnostics.join("; "));
        }
        report.errors.push(message);
    }
}

fn merge_britbase_outcome(
    collection: &Mutex<Collection>,
    report: &mut OtbImportSourceReport,
    mut outcome: ScanOutcome,
    source: &'static str,
    url: &str,
) {
    if let Some(error) = outcome.error.take() {
        report.errors.push(format!("{url}: {error}"));
    }
    let (matched, added) = merge_into(collection, outcome, source);
    report.matched_games = report.matched_games.saturating_add(matched);
    report.unique_games_added = report.unique_games_added.saturating_add(added);
}

async fn read_britbase_cache_entry(spec: &BritBaseArchiveSpec) -> Option<Vec<u8>> {
    for path in &spec.cache_paths {
        if let Some(bytes) = read_cache_entry(path, None).await {
            return Some(bytes);
        }
    }
    None
}

fn britbase_request(
    client: &Client,
    spec: &BritBaseArchiveSpec,
    url: &str,
) -> reqwest::RequestBuilder {
    client.get(url).header(REFERER, &spec.referer)
}

async fn fetch_britbase_archive(client: &Client, spec: &BritBaseArchiveSpec) -> BritBaseLiveFetch {
    for url in &spec.fetch_urls {
        wait_for_britbase_lane().await;
        let response = match britbase_request(client, spec, url).send().await {
            Ok(response) => response,
            Err(error) => {
                return BritBaseLiveFetch::Failed(BritBaseFetchFailure::Transport(
                    error.to_string(),
                ))
            }
        };
        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            continue;
        }
        if status == reqwest::StatusCode::FORBIDDEN {
            return BritBaseLiveFetch::Failed(BritBaseFetchFailure::Forbidden);
        }
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let retry_after = retry_after_seconds(&response);
            hold_britbase_lane(Duration::from_secs(retry_after.unwrap_or(60)));
            return BritBaseLiveFetch::Failed(BritBaseFetchFailure::RateLimited(retry_after));
        }
        if !status.is_success() {
            return BritBaseLiveFetch::Failed(BritBaseFetchFailure::Http(status.as_u16()));
        }
        let bytes = match response.bytes().await {
            Ok(bytes) => bytes.to_vec(),
            Err(error) => {
                return BritBaseLiveFetch::Failed(BritBaseFetchFailure::Transport(
                    error.to_string(),
                ))
            }
        };
        if let Some(cache_path) = spec.cache_paths.first() {
            write_cache_entry(cache_path, &bytes).await;
        }
        return BritBaseLiveFetch::Downloaded(bytes);
    }
    BritBaseLiveFetch::NotFound
}

async fn fetch_britbase_batch(
    client: &Client,
    specs: &[BritBaseArchiveSpec],
) -> Vec<(BritBaseArchiveSpec, BritBaseLiveFetch)> {
    future::join_all(specs.iter().cloned().map(|spec| {
        let client = client.clone();
        async move {
            let result = fetch_britbase_archive(&client, &spec).await;
            (spec, result)
        }
    }))
    .await
}

/// Waits only for a server-requested cooldown. Successful archive requests do
/// not extend the gate, so a cold corpus can fill the bounded download batch.
async fn wait_for_britbase_lane() {
    loop {
        let now = Instant::now();
        let wait = {
            let gate = BRITBASE_LANE_GATE
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            gate.filter(|open_at| *open_at > now)
                .map(|open_at| open_at.saturating_duration_since(now))
        };
        match wait {
            Some(delay) => tokio::time::sleep(delay).await,
            None => return,
        }
    }
}

fn hold_britbase_lane(delay: Duration) {
    let open_at = Instant::now() + delay;
    let mut gate = BRITBASE_LANE_GATE
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if gate.is_none_or(|existing| existing < open_at) {
        *gate = Some(open_at);
    }
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
    let parsed_archives = parse_twic_archive_links(&page);
    if let Err(error) = validate_discovery_count(SOURCE, TWIC_ARCHIVE, parsed_archives.len()) {
        report.errors.push(error);
        return report;
    }
    let mut archives = parsed_archives
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

fn validate_discovery_count(source: &str, index_url: &str, count: usize) -> Result<(), String> {
    if count > 0 {
        return Ok(());
    }
    Err(format!(
        "{index_url}: {source} discovery returned no usable archive links; refusing to treat a possible challenge or changed index page as complete coverage"
    ))
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
    get_lichess_with_backoff_mode(client, url, false).await
}

async fn get_lichess_with_backoff_mode(
    client: &Client,
    url: &str,
    accept_json: bool,
) -> Result<Vec<u8>, String> {
    // Hold the permit through the body download so every Lichess source shares
    // one strictly serial request lane. The shared start gate also prevents a
    // burst of tiny sequential responses from triggering a minute-long 429.
    // A failed request returns immediately and callers keep cached/indexed data.
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
    wait_for_lichess_lane().await?;
    let mut request = client.get(url);
    if accept_json {
        request = request.header(ACCEPT, "application/json");
    }
    match request.send().await {
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
        Ok(response) if response.status().is_client_error() => {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let body = body.split_whitespace().collect::<Vec<_>>().join(" ");
            let body = body.chars().take(240).collect::<String>();
            Err(if body.is_empty() {
                format!("Lichess returned {status} for {url}")
            } else {
                format!("Lichess returned {status} for {url}: {body}")
            })
        }
        Ok(response) => response
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

/// Waits for an explicit shared cooldown or the next polite request-start slot.
/// Complete-body serialization is enforced independently by
/// `LICHESS_REQUEST_LANE`; this gate matters only when responses finish faster
/// than the minimum start interval.
async fn wait_for_lichess_lane() -> Result<(), String> {
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

static BRITBASE_LANE_GATE: Mutex<Option<Instant>> = Mutex::new(None);
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
        let canonical_pgn = sanitize_pgn_headers(&canonical_pgn);
        let canonical_pgn = add_provenance_headers(&canonical_pgn, source, source_url);
        outcome.games.push(PendingGame {
            pgn: canonical_pgn,
            side: side.to_string(),
        });
    }
    outcome
}

fn add_game(collection: &mut Collection, pgn: String, source: &str, target_side: &str) {
    let Some(candidate) = prepare_candidate(pgn, source, target_side) else {
        return;
    };
    if collection.capture_candidates {
        collection.candidate_games.push(candidate.clone());
    }
    add_candidate(collection, candidate);
}

/// Performs the expensive header, legality, and movetext work exactly once.
/// The concurrent capture pass can still maintain live unique counts, while
/// deterministic replay reuses this prepared record instead of parsing every
/// accepted PGN a second time after all source lanes finish.
fn prepare_candidate(pgn: String, source: &str, target_side: &str) -> Option<CandidateGame> {
    let headers = parse_headers(&pgn);
    let white = header(&headers, "White")?.trim();
    let black = header(&headers, "Black")?.trim();
    // Stateful public exporters occasionally emit a torn tail containing the
    // target name and a result but no opponent (or vice versa). It is not a
    // reconstructable game and strict readers turn it into an Unknown-player
    // phantom, so require the two player identities every real pairing has.
    if white.is_empty() || black.is_empty() {
        return None;
    }
    let white = white.to_string();
    let black = black.to_string();
    let date = header(&headers, "Date").unwrap_or("????.??.??").to_string();
    let event = header(&headers, "Event")
        .unwrap_or("Unknown event")
        .to_string();
    let round = header(&headers, "Round").unwrap_or("");
    let site = header(&headers, "Site").unwrap_or("");
    let result = header(&headers, "Result").unwrap_or("*").to_string();
    let moves = normalized_movetext(&pgn);
    let legal_mainline = pgn_has_legal_standard_mainline(&pgn);
    let mainline = mainline_move_fingerprint(&pgn);
    let mainline_moves = mainline.moves;
    if mainline_moves.is_empty() {
        let target_header = if target_side.eq_ignore_ascii_case("White") {
            header(&headers, "White")
        } else {
            header(&headers, "Black")
        };
        // A matched, named zero-move OTB record can be a forfeit, bye, or
        // adjourned pairing and is still part of the player's online corpus.
        // Bare/result/comment-only fragments have no target-side player and
        // remain rejected.
        if target_header.is_none_or(|value| value.trim().is_empty()) {
            return None;
        }
    }
    let normalized_white = normalized_name(&white);
    let normalized_black = normalized_name(&black);
    let normalized_event = normalized_name(&event);
    let normalized_round = normalized_name(round);
    let normalized_site = normalized_name(site);
    let opponent = if target_side.eq_ignore_ascii_case("White") {
        &black
    } else {
        &white
    };
    let opponent_key = normalized_player_key(opponent);
    let record_identity =
        format!("{date}|{normalized_event}|{normalized_round}|{normalized_site}|{result}");
    let identity_fingerprint =
        format!("{target_side}|{normalized_white}|{normalized_black}|{record_identity}");
    let broad_fingerprint =
        format!("{normalized_white}|{normalized_black}|{record_identity}|{moves}");
    let move_fingerprint = (legal_mainline && mainline.complete)
        .then(|| format!("{target_side}|{opponent_key}|{record_identity}|{mainline_moves}"));
    let game = CollectedGame {
        legal_mainline,
        pgn,
        date,
        event,
        white,
        black,
        result,
        source: source.to_string(),
        mainline_moves,
    };

    Some(CandidateGame {
        game,
        target_side: target_side.to_string(),
        identity_fingerprint,
        broad_fingerprint,
        move_fingerprint,
    })
}

fn add_candidate(collection: &mut Collection, candidate: CandidateGame) {
    let CandidateGame {
        game: incoming,
        identity_fingerprint,
        broad_fingerprint,
        move_fingerprint,
        ..
    } = candidate;

    let prefix_duplicate = collection
        .identity_fingerprints
        .get(&identity_fingerprint)
        .and_then(|indices| {
            indices.iter().copied().find(|index| {
                let existing = &collection.games[*index];
                move_lines_are_prefixes(&existing.mainline_moves, &incoming.mainline_moves)
            })
        });
    if let Some(index) = prefix_duplicate {
        collection.duplicates_removed = collection.duplicates_removed.saturating_add(1);
        retain_preferred_duplicate(
            collection,
            index,
            incoming,
            &identity_fingerprint,
            &broad_fingerprint,
            move_fingerprint.as_deref(),
        );
        return;
    }

    let move_duplicate = move_fingerprint
        .as_deref()
        .and_then(|fingerprint| collection.move_fingerprints.get(fingerprint))
        .and_then(|indices| indices.first().copied());
    if let Some(index) = move_duplicate {
        collection.duplicates_removed = collection.duplicates_removed.saturating_add(1);
        retain_preferred_duplicate(
            collection,
            index,
            incoming,
            &identity_fingerprint,
            &broad_fingerprint,
            move_fingerprint.as_deref(),
        );
        return;
    }

    let broad_duplicate = collection
        .broad_fingerprints
        .get(&broad_fingerprint)
        .and_then(|indices| indices.first().copied());
    if let Some(index) = broad_duplicate {
        collection.duplicates_removed = collection.duplicates_removed.saturating_add(1);
        retain_preferred_duplicate(
            collection,
            index,
            incoming,
            &identity_fingerprint,
            &broad_fingerprint,
            move_fingerprint.as_deref(),
        );
        return;
    }

    let index = collection.games.len();
    register_game_fingerprints(
        collection,
        index,
        &identity_fingerprint,
        &broad_fingerprint,
        move_fingerprint.as_deref(),
    );
    collection.games.push(incoming);
}

/// Every duplicate path uses the same total quality ordering. This matters
/// because source lanes finish concurrently: keeping the first copy makes an
/// annotated Lichess PGN or a plain archive PGN win nondeterministically.
fn retain_preferred_duplicate(
    collection: &mut Collection,
    index: usize,
    incoming: CollectedGame,
    identity_fingerprint: &str,
    broad_fingerprint: &str,
    move_fingerprint: Option<&str>,
) {
    if !collected_game_is_better(&incoming, &collection.games[index]) {
        return;
    }
    register_game_fingerprints(
        collection,
        index,
        identity_fingerprint,
        broad_fingerprint,
        move_fingerprint,
    );
    collection.games[index] = incoming;
}

fn collected_game_is_better(incoming: &CollectedGame, existing: &CollectedGame) -> bool {
    let incoming_moves = incoming.mainline_moves.split_whitespace().count();
    let existing_moves = existing.mainline_moves.split_whitespace().count();
    let incoming_annotations = incoming.pgn.matches("[%").count();
    let existing_annotations = existing.pgn.matches("[%").count();

    (
        incoming.legal_mainline,
        incoming_moves,
        incoming_annotations,
        incoming.pgn.len(),
        &incoming.pgn,
    ) > (
        existing.legal_mainline,
        existing_moves,
        existing_annotations,
        existing.pgn.len(),
        &existing.pgn,
    )
}

fn reconcile_source_reports(reports: &mut [OtbImportSourceReport], games: &[CollectedGame]) {
    let mut retained = HashMap::<&str, u32>::new();
    for game in games {
        let count = retained.entry(game.source.as_str()).or_default();
        *count = count.saturating_add(1);
    }
    for report in reports {
        report.unique_games_added = retained.get(report.source.as_str()).copied().unwrap_or(0);
    }
}

fn register_game_fingerprints(
    collection: &mut Collection,
    index: usize,
    identity_fingerprint: &str,
    broad_fingerprint: &str,
    move_fingerprint: Option<&str>,
) {
    for (fingerprints, fingerprint) in [
        (&mut collection.identity_fingerprints, identity_fingerprint),
        (&mut collection.broad_fingerprints, broad_fingerprint),
    ] {
        let indices = fingerprints.entry(fingerprint.to_string()).or_default();
        if !indices.contains(&index) {
            indices.push(index);
        }
    }
    if let Some(fingerprint) = move_fingerprint {
        let indices = collection
            .move_fingerprints
            .entry(fingerprint.to_string())
            .or_default();
        if !indices.contains(&index) {
            indices.push(index);
        }
    }
}

fn move_lines_are_prefixes(left: &str, right: &str) -> bool {
    let left = left.split_whitespace().collect::<Vec<_>>();
    let right = right.split_whitespace().collect::<Vec<_>>();
    let shared = left.len().min(right.len());
    shared >= 12 && left[..shared] == right[..shared]
}

struct MainlineLegalityVisitor {
    position: Chess,
    legal: bool,
}

impl Default for MainlineLegalityVisitor {
    fn default() -> Self {
        Self {
            position: Chess::default(),
            legal: true,
        }
    }
}

impl Visitor for MainlineLegalityVisitor {
    type Result = bool;

    fn begin_game(&mut self) {
        self.position = Chess::default();
        self.legal = true;
    }

    fn header(&mut self, key: &[u8], value: RawHeader<'_>) {
        if key != b"FEN" {
            return;
        }
        self.position = Fen::from_ascii(value.as_bytes())
            .ok()
            .and_then(|fen| {
                let setup = fen.into_setup();
                let castling_mode = CastlingMode::detect(&setup);
                Chess::from_setup(setup, castling_mode)
                    .or_else(PositionError::ignore_too_much_material)
                    .ok()
            })
            .unwrap_or_else(|| {
                self.legal = false;
                Chess::default()
            });
    }

    fn end_headers(&mut self) -> Skip {
        Skip(!self.legal)
    }

    fn san(&mut self, san: SanPlus) {
        let Some(chess_move) = san.san.to_move(&self.position).ok() else {
            self.legal = false;
            return;
        };
        self.position.play_unchecked(&chess_move);
    }

    fn begin_variation(&mut self) -> Skip {
        // Duplicate selection only needs to know whether the complete mainline
        // can be used by every consumer. Source annotations and variations are
        // still retained when that mainline is legal.
        Skip(true)
    }

    fn end_game(&mut self) -> Self::Result {
        self.legal
    }
}

fn pgn_has_legal_standard_mainline(game: &str) -> bool {
    let mut reader = PgnReader::new(game.as_bytes());
    let mut visitor = MainlineLegalityVisitor::default();
    reader
        .read_game(&mut visitor)
        .ok()
        .flatten()
        .unwrap_or(false)
}

struct MainlineFingerprint {
    moves: String,
    complete: bool,
}

/// Returns a notation-only fingerprint of the mainline. Unknown source words
/// remain explicit sentinels: deleting them could make two distinct games look
/// identical. Only a complete, independently legal fingerprint is eligible for
/// the cross-source exact-move index.
fn mainline_move_fingerprint(game: &str) -> MainlineFingerprint {
    let movetext = game
        .lines()
        .filter(|line| !line.trim_start().starts_with('['))
        .collect::<Vec<_>>()
        .join("\n");
    let mut words = Vec::new();
    let mut word = String::new();
    let mut brace_depth = 0u32;
    let mut variation_depth = 0u32;
    let mut line_comment = false;

    for char in movetext.chars() {
        if line_comment {
            if char == '\n' {
                line_comment = false;
            }
            continue;
        }
        if brace_depth > 0 {
            match char {
                '{' => brace_depth = brace_depth.saturating_add(1),
                '}' => brace_depth = brace_depth.saturating_sub(1),
                _ => {}
            }
            continue;
        }
        match char {
            '{' => {
                push_mainline_word(&mut words, &mut word);
                brace_depth = 1;
            }
            ';' => {
                push_mainline_word(&mut words, &mut word);
                line_comment = true;
            }
            '(' => {
                push_mainline_word(&mut words, &mut word);
                variation_depth = variation_depth.saturating_add(1);
            }
            ')' => {
                push_mainline_word(&mut words, &mut word);
                variation_depth = variation_depth.saturating_sub(1);
            }
            '$' if variation_depth == 0 => push_mainline_word(&mut words, &mut word),
            value if value.is_whitespace() => push_mainline_word(&mut words, &mut word),
            value if variation_depth == 0 => word.push(value),
            _ => {}
        }
    }
    push_mainline_word(&mut words, &mut word);

    let mut moves = Vec::new();
    let mut complete = true;
    for word in words {
        let word = strip_pgn_move_number(&word);
        let word = word.trim_end_matches(['!', '?']);
        if word.is_empty()
            || word
                .chars()
                .all(|char| char.is_ascii_digit() || char == '.')
            || matches!(
                word,
                "1-0" | "0-1" | "1/2-1/2" | "*" | "e.p." | "e.p" | "ep"
            )
        {
            continue;
        }
        match canonicalize_san_word(word) {
            SanWord::Move(san) => moves.push(san),
            SanWord::Unknown => {
                complete = false;
                moves.push(format!("?{word}"));
            }
        }
    }
    MainlineFingerprint {
        moves: moves.join(" "),
        complete: complete && !moves.is_empty(),
    }
}

fn push_mainline_word(words: &mut Vec<String>, word: &mut String) {
    if !word.is_empty() {
        words.push(std::mem::take(word));
    }
}

fn strip_pgn_move_number(word: &str) -> &str {
    let bytes = word.as_bytes();
    let mut index = 0;
    while index < bytes.len() && bytes[index].is_ascii_digit() {
        index += 1;
    }
    if index == 0 || index >= bytes.len() || bytes[index] != b'.' {
        return word;
    }
    while index < bytes.len() && bytes[index] == b'.' {
        index += 1;
    }
    &word[index..]
}

enum SanWord {
    Move(String),
    Unknown,
}

fn canonicalize_san_word(word: &str) -> SanWord {
    let (core, suffix) = if let Some(core) = word.strip_suffix("++") {
        (core, "+")
    } else if let Some(core) = word.strip_suffix('+') {
        (core, "+")
    } else if let Some(core) = word.strip_suffix('#') {
        (core, "#")
    } else {
        (word, "")
    };

    let castle = core.replace('0', "O");
    if matches!(castle.as_str(), "O-O" | "O-O-O") {
        return SanWord::Move(format!("{castle}{suffix}"));
    }
    if core == "--" {
        return SanWord::Move(format!("{core}{suffix}"));
    }
    if let Some(drop) = canonical_san_drop(core) {
        return SanWord::Move(format!("{drop}{suffix}"));
    }

    let (move_body, promotion) = match core.rsplit_once('=') {
        Some((body, promotion))
            if promotion.len() == 1
                && matches!(promotion.as_bytes()[0], b'Q' | b'R' | b'B' | b'N') =>
        {
            (body, Some(promotion))
        }
        Some(_) => return SanWord::Unknown,
        None => (core, None),
    };
    let bytes = move_body.as_bytes();
    if promotion.is_none()
        && bytes.len() >= 3
        && matches!(bytes[bytes.len() - 1], b'Q' | b'R' | b'B' | b'N')
        && matches!(bytes[bytes.len() - 2], b'1' | b'8')
        && bytes[0].is_ascii_lowercase()
    {
        return SanWord::Unknown;
    }
    if bytes.len() < 2
        || !matches!(bytes[bytes.len() - 2], b'a'..=b'h')
        || !matches!(bytes[bytes.len() - 1], b'1'..=b'8')
    {
        return SanWord::Unknown;
    }
    if promotion.is_some() && !matches!(bytes[bytes.len() - 1], b'1' | b'8') {
        return SanWord::Unknown;
    }

    let prefix = &move_body[..move_body.len() - 2];
    let valid = if prefix.is_empty() {
        true
    } else if prefix.as_bytes()[0].is_ascii_lowercase() {
        prefix.len() == 2
            && matches!(prefix.as_bytes()[0], b'a'..=b'h')
            && prefix.as_bytes()[1] == b'x'
    } else if matches!(prefix.as_bytes()[0], b'K' | b'Q' | b'R' | b'B' | b'N') {
        valid_piece_disambiguation(&prefix[1..])
    } else {
        false
    };
    if !valid {
        return SanWord::Unknown;
    }
    SanWord::Move(format!("{core}{suffix}"))
}

fn canonical_san_drop(core: &str) -> Option<&str> {
    let bytes = core.as_bytes();
    if bytes.len() == 3
        && bytes[0] == b'@'
        && matches!(bytes[1], b'a'..=b'h')
        && matches!(bytes[2], b'1'..=b'8')
    {
        return Some(core);
    }
    if bytes.len() == 4
        && matches!(bytes[0], b'P' | b'N' | b'B' | b'R' | b'Q' | b'K')
        && bytes[1] == b'@'
        && matches!(bytes[2], b'a'..=b'h')
        && matches!(bytes[3], b'1'..=b'8')
    {
        return Some(if bytes[0] == b'P' { &core[1..] } else { core });
    }
    None
}

fn valid_piece_disambiguation(value: &str) -> bool {
    let value = value.strip_suffix('x').unwrap_or(value);
    match value.as_bytes() {
        [] => true,
        [file_or_rank] => matches!(file_or_rank, b'a'..=b'h' | b'1'..=b'8'),
        [file, rank] => matches!(file, b'a'..=b'h') && matches!(rank, b'1'..=b'8'),
        _ => false,
    }
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
    let mut saw_event_header = false;

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
        let is_event_header = is_header
            && trimmed
                .strip_prefix("[Event")
                .and_then(|tail| tail.chars().next())
                .is_some_and(char::is_whitespace);
        if is_header && (saw_movetext || (is_event_header && saw_event_header)) {
            state.pending_line = Some(line.clone());
            break;
        }
        saw_event_header |= is_event_header;
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
    let white_name_matches =
        header(headers, "White").is_some_and(|name| identity.name_matches(name));
    let black_name_matches =
        header(headers, "Black").is_some_and(|name| identity.name_matches(name));
    if white_name_matches && black_name_matches {
        // A damaged exporter can repeat the target on both sides when several
        // header-only records are concatenated. Only distinct FIDE IDs can
        // disambiguate a genuinely same-named pairing.
        let target_id = identity.fide_id.as_deref()?;
        return match (
            white_id.as_deref() == Some(target_id),
            black_id.as_deref() == Some(target_id),
        ) {
            (true, false) => Some("White"),
            (false, true) => Some("Black"),
            (false, false) if white_id.is_some() && black_id.is_none() => Some("Black"),
            (false, false) if white_id.is_none() && black_id.is_some() => Some("White"),
            _ => None,
        };
    }
    if let Some(target_id) = identity.fide_id.as_deref() {
        if white_id.as_deref() == Some(target_id) {
            return Some("White");
        }
        if black_id.as_deref() == Some(target_id) {
            return Some("Black");
        }
    }

    if white_name_matches {
        if identity.fide_id.is_none() || white_id.is_none() {
            return Some("White");
        }
        return None;
    }
    if black_name_matches {
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

/// Public archives sometimes place literal quotes inside a tag value without
/// PGN escaping (for example an event name containing a quoted sponsor). Our
/// permissive matcher can still read those tags, but a strict downstream PGN
/// reader may treat the following tags as separate phantom games. Normalize
/// every header escape exactly once while leaving movetext byte-for-byte intact.
fn sanitize_pgn_headers(game: &str) -> String {
    let mut in_headers = true;
    let mut output = Vec::new();
    for line in game.lines() {
        let trimmed = line.trim();
        if in_headers && trimmed.is_empty() {
            output.push(String::new());
            continue;
        }
        if in_headers && trimmed.starts_with('[') {
            output.push(sanitize_pgn_header_line(trimmed).unwrap_or_else(|| line.to_string()));
            continue;
        }
        in_headers = false;
        output.push(line.to_string());
    }
    output.join("\n") + "\n"
}

fn sanitize_pgn_header_line(line: &str) -> Option<String> {
    let line = line.strip_prefix('[')?;
    let header_end = line.rfind(']')?;
    let trailing = line[header_end + 1..].trim();
    if !trailing.is_empty() && !matches!(trailing, "1-0" | "0-1" | "1/2-1/2" | "*") {
        return None;
    }
    let inner = &line[..header_end];
    let split = inner.find(char::is_whitespace)?;
    let key = &inner[..split];
    let raw = inner[split..].trim();
    let value = raw.strip_prefix('"')?.strip_suffix('"')?;
    let decoded = value.replace("\\\"", "\"").replace("\\\\", "\\");
    Some(format!("[{key} \"{}\"]", escape_pgn_header(&decoded)))
}

fn add_provenance_headers(game: &str, source: &str, source_url: &str) -> String {
    let mut output = String::new();
    let mut inserted = false;
    for line in game.lines() {
        if !inserted && line.trim().is_empty() {
            // Archives occasionally contain several blank header separators.
            // Ignore all of them here and emit exactly one below; otherwise a
            // strict reader sees the detached movetext as a phantom game.
            continue;
        }
        if !inserted && !line.trim_start().starts_with('[') {
            output.push_str(&format!(
                "[OutpostSource \"{}\"]\n[OutpostSourceUrl \"{}\"]\n\n",
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
            "[OutpostSource \"{}\"]\n[OutpostSourceUrl \"{}\"]\n\n",
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

    let event_words = format!(" {} ", normalized_name(&event));
    if event_words.contains(" titled tuesday ") || event_words.contains(" titled tue ") {
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
        "playzone game",
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
            let Some(rest) = html.get(position..) else {
                continue;
            };
            // Chessscope descriptions often contain typographic dashes or
            // accented names. Bound by characters, not bytes, so a nearby
            // multibyte code point can never crash the entire import.
            let tail = rest.chars().take(24).collect::<String>();
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

fn canonical_britbase_url(url: &str) -> String {
    let canonical_host = BRITBASE_ORIGINS
        .iter()
        .find_map(|origin| {
            url.strip_prefix(origin)
                .filter(|path| path.starts_with('/'))
        })
        .map_or_else(
            || url.to_string(),
            |path| format!("{BRITBASE_CANONICAL_ORIGIN}{path}"),
        );
    let Some(path) = canonical_host.strip_prefix(BRITBASE_CANONICAL_ORIGIN) else {
        return canonical_host;
    };
    let Some(file_name) = path.strip_prefix("/britbase/") else {
        return canonical_host;
    };
    // Modern BritBase stores PGNs below /britbase/pgn/. The 2010s index has
    // one bare 201707countyfinal.pgn link while every other current PGN uses
    // that directory. Repair only this unambiguous root-PGN shape; legacy root
    // ZIP files are intentionally left where the archive advertises them.
    if !file_name.contains('/') && file_name.to_ascii_lowercase().ends_with(".pgn") {
        format!("{BRITBASE_CANONICAL_ORIGIN}/britbase/pgn/{file_name}")
    } else {
        canonical_host
    }
}

fn britbase_equivalent_urls(url: &str) -> Vec<String> {
    let canonical = canonical_britbase_url(url);
    let Some(path) = canonical.strip_prefix(BRITBASE_CANONICAL_ORIGIN) else {
        return vec![canonical];
    };
    let original_host_normalized = BRITBASE_ORIGINS
        .iter()
        .find_map(|origin| {
            url.strip_prefix(origin)
                .filter(|candidate| candidate.starts_with('/'))
        })
        .map(|candidate| candidate.to_string());
    let mut paths = vec![path.to_string()];
    if let Some(original_path) = original_host_normalized {
        if original_path != path {
            paths.push(original_path);
        }
    }
    let mut keys = paths
        .into_iter()
        .flat_map(|path| {
            BRITBASE_ORIGINS
                .iter()
                .map(move |origin| format!("{origin}{path}"))
        })
        .collect::<Vec<_>>();
    keys.dedup();
    keys
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

async fn lichess_corpus_coverage(request: &OtbImportRequest) -> LichessCorpusCoverage {
    if !request.include_lichess_broadcast_archives {
        return LichessCorpusCoverage::empty(request.from_year);
    }
    let Ok(Some(list)) =
        read_page_cache_stale(LICHESS_BROADCAST_LIST, &request.cache_dir, "lichess-index").await
    else {
        return LichessCorpusCoverage::empty(request.from_year);
    };
    let advertised = list
        .lines()
        .map(str::trim)
        .filter_map(|url| archive_month(url).map(|month| (url.to_string(), month)))
        .collect::<Vec<_>>();
    if advertised.is_empty() {
        return LichessCorpusCoverage::empty(request.from_year);
    }
    let urls = advertised
        .iter()
        .map(|(url, _)| url.clone())
        .collect::<Vec<_>>();
    let indexed = index::indexed_urls(
        &archive_index_path(&request.cache_dir),
        &urls,
        None,
        index_run_for_request(request),
    )
    .await
    .unwrap_or_default();
    let complete_months = advertised
        .into_iter()
        .filter_map(|(url, month)| indexed.contains(&url).then_some(month))
        .collect::<HashSet<_>>();
    LichessCorpusCoverage::from_complete_months(request.from_year, complete_months)
}

fn extract_lichess_rounds_since(html: &str, cutoff: &str) -> Vec<(String, Option<String>)> {
    html.split("<a")
        .skip(1)
        .filter_map(|tail| tail.split_once("</a>").map(|(anchor, _)| anchor))
        .filter_map(|anchor| {
            let href = extract_quoted_values(anchor, "href=").into_iter().next()?;
            if !is_lichess_round_path(&href) {
                return None;
            }
            let date = extract_quoted_values(anchor, "datetime=")
                .into_iter()
                .next();
            let in_range = date
                .as_deref()
                .and_then(|value| value.get(..10))
                .is_none_or(|value| value >= cutoff);
            in_range.then_some((href, date))
        })
        .collect()
}

/// Returns the canonical next page advertised by a Lichess FIDE listing.
/// Only same-origin FIDE links are accepted, and a cursor already visited by
/// this scan is an error rather than permission to repeat a page forever.
fn lichess_fide_next_page_url(
    html: &str,
    fide_id: &str,
    seen_page_urls: &HashSet<String>,
) -> Result<Option<String>, String> {
    lichess_fide_next_page_url_at_origin(html, fide_id, seen_page_urls, "https://lichess.org")
}

fn lichess_fide_next_page_url_at_origin(
    html: &str,
    fide_id: &str,
    seen_page_urls: &HashSet<String>,
    origin: &str,
) -> Result<Option<String>, String> {
    let mut next_urls = Vec::new();
    let origin = origin.trim_end_matches('/');
    let expected_player_prefix = format!("{origin}/fide/{fide_id}/");
    for tail in html.split("<a").skip(1) {
        let Some((anchor, _)) = tail.split_once('>') else {
            continue;
        };
        let is_next = extract_quoted_values(anchor, "rel=")
            .into_iter()
            .any(|value| {
                value
                    .split_ascii_whitespace()
                    .any(|relation| relation.eq_ignore_ascii_case("next"))
            });
        if !is_next {
            continue;
        }

        let href = extract_quoted_values(anchor, "href=")
            .into_iter()
            .next()
            .ok_or_else(|| {
                "Lichess FIDE pagination returned rel=next without an href; coverage may be incomplete"
                    .to_string()
            })?;
        let href = decode_basic_html_entities(&href);
        let next_url = if href.starts_with("/fide/") {
            format!("{origin}{href}")
        } else if href.starts_with(&format!("{origin}/fide/")) {
            href
        } else {
            return Err(format!(
                "Lichess FIDE pagination returned an invalid next-page link ({href}); coverage may be incomplete"
            ));
        };
        if !next_url.starts_with(&expected_player_prefix)
            || next_url.chars().any(char::is_whitespace)
            || next_url.contains('#')
        {
            return Err(format!(
                "Lichess FIDE pagination returned an invalid next-page link ({next_url}); coverage may be incomplete"
            ));
        }
        next_urls.push(next_url);
    }

    next_urls.sort();
    next_urls.dedup();
    if next_urls.len() > 1 {
        return Err(
            "Lichess FIDE pagination returned conflicting next-page links; coverage may be incomplete"
                .to_string(),
        );
    }
    let Some(next_url) = next_urls.pop() else {
        return Ok(None);
    };
    if seen_page_urls.contains(&next_url) {
        return Err(format!(
            "Lichess FIDE pagination repeated {next_url}; coverage may be incomplete"
        ));
    }
    Ok(Some(next_url))
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

fn normalized_player_key(name: &str) -> String {
    let mut tokens = player_name_tokens(name);
    tokens.sort();
    tokens.dedup();
    tokens.join(" ")
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

    static LICHESS_TEST_LANE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    fn identity() -> PlayerIdentity {
        PlayerIdentity::new("Lapidus, Alexey M.", Some("24276111")).unwrap()
    }

    fn test_request(cache_dir: &Path) -> OtbImportRequest {
        OtbImportRequest {
            job_id: "lichess-pipeline-test".to_string(),
            player_name: "Lapidus, Alexey M.".to_string(),
            fide_id: Some("24276111".to_string()),
            from_year: 2020,
            include_lichess_broadcasts: true,
            include_lichess_broadcast_archives: true,
            include_lichess_community_broadcasts: true,
            include_chess_results: true,
            include_chessbase_news: true,
            include_official_pgn_indexes: true,
            include_twic: true,
            local_pgn_paths: Vec::new(),
            cache_dir: cache_dir.to_path_buf(),
            output_path: cache_dir.join("unused.pgn"),
        }
    }

    async fn read_mock_request(socket: &mut tokio::net::TcpStream) -> String {
        use tokio::io::AsyncReadExt;

        let mut request = Vec::new();
        loop {
            let mut chunk = [0u8; 1024];
            let read = socket.read(&mut chunk).await.expect("mock request read");
            if read == 0 {
                break;
            }
            request.extend_from_slice(&chunk[..read]);
            if request.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        String::from_utf8_lossy(&request).into_owned()
    }

    async fn write_mock_response(socket: &mut tokio::net::TcpStream, status: &str, body: &str) {
        use tokio::io::AsyncWriteExt;

        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        socket
            .write_all(response.as_bytes())
            .await
            .expect("mock response write");
    }

    fn lichess_round_page(
        tour_id: &str,
        dates: [i64; 2],
        rounds: &[(&str, bool)],
        chapters: serde_json::Value,
    ) -> String {
        let rounds = rounds
            .iter()
            .map(|(id, finished)| {
                serde_json::json!({
                    "id": id,
                    "finished": finished,
                    "startsAt": dates[0]
                })
            })
            .collect::<Vec<_>>();
        let page = serde_json::json!({
            "relay": {
                "tour": { "id": tour_id, "dates": dates },
                "rounds": rounds
            },
            "study": { "chapters": chapters }
        });
        format!(
            "<html><script type=\"application/json\" data-test=\"round\" id=\"page-init-data\">{page}</script></html>"
        )
    }

    fn reset_lichess_test_state() {
        *LICHESS_LANE_GATE
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = None;
        lichess_failed_hosts()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
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
    fn treats_only_lichess_resource_too_old_as_the_listing_boundary() {
        assert!(lichess_listing_is_exhausted(
            "Lichess returned 400 Bad Request for https://lichess.org/api/broadcast/top?page=6: resource too old"
        ));
        assert!(!lichess_listing_is_exhausted(
            "Lichess returned 400 Bad Request: malformed page"
        ));
        assert!(!lichess_listing_is_exhausted(
            "Lichess returned 503 Service Unavailable"
        ));
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
    fn tolerant_mainline_fingerprint_keeps_moves_after_noisy_archive_words() {
        let pgn = "[Result \"1-0\"]\n\n1. e4 e5 2. Nf3 archive-noise 2... Nc6 3. Bb5 a6 1-0";
        let fingerprint = mainline_move_fingerprint(pgn);
        assert_eq!(fingerprint.moves, "e4 e5 Nf3 ?archive-noise Nc6 Bb5 a6");
        assert!(!fingerprint.complete);
    }

    #[test]
    fn malformed_pawn_promotion_cannot_enter_the_exact_move_index() {
        let pgn = "[Result \"1-0\"]\n\n1. e4 a5 2. e5 a4 3. e6 a3 4. e7 a2 5. e8Q 1-0";
        let fingerprint = mainline_move_fingerprint(pgn);
        assert!(fingerprint.moves.contains("?e8Q"));
        assert!(!fingerprint.complete);
    }

    #[test]
    fn double_check_notation_remains_a_fingerprint_ply() {
        let pgn = "[Result \"1-0\"]\n\n1. e4 e5 2. Nf3++ Nc6 1-0";
        let fingerprint = mainline_move_fingerprint(pgn);
        assert_eq!(fingerprint.moves, "e4 e5 Nf3+ Nc6");
        assert!(fingerprint.complete);
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
        let titled_tuesday =
            parse_headers("[Event \"Titled Tue 14th Jul 2026\"]\n[Site \"The Internet\"]\n");
        let untitled_tuesday =
            parse_headers("[Event \"Untitled Tuesday OTB Open\"]\n[Site \"Cardiff Chess Club\"]\n");
        let playzone = parse_headers(
            "[Event \"Playzone game\"]\n[Site \"https://lichess.org/broadcast/archive/round/id\"]\n",
        );
        assert!(!is_suspected_online_game(&otb));
        assert!(!is_suspected_online_game(&id_chess));
        assert!(is_suspected_online_game(&online));
        assert!(is_suspected_online_game(&titled_tuesday));
        assert!(!is_suspected_online_game(&untitled_tuesday));
        assert!(is_suspected_online_game(&playzone));
    }

    #[test]
    fn provenance_normalizes_multiple_header_separators() {
        let game = "[Event \"Test\"]\n[Result \"1-0\"]\n\n\n1. d4 1-0\n";
        let enriched = add_provenance_headers(game, "Archive", "https://example.test/a.pgn");
        assert!(enriched.contains("[OutpostSourceUrl \"https://example.test/a.pgn\"]\n\n1. d4 1-0"));
        assert!(!enriched.contains("\n\n\n"));
    }

    #[test]
    fn repeated_event_headers_split_header_only_games_without_phantoms() {
        let malformed = r#"[Event "Header-only one"]
[Date "2024.01.01"]
[White "Opponent, One"]
[Black "Royal, Shreyas"]
[Result "0-1"]
[Event "Header-only two"]
[Date "2024.01.02"]
[White "Royal, Shreyas"]
[Black "Opponent, Two"]
[Result "1-0"]
[BlackClock "0:12:44"] 1-0
[Event "Corrupt repeated target"]
[Date "2024.01.03"]
[White "Royal, Shreyas"]
[Black "Royal, Shreyas"]
[Result "1-0"]

1. e4 e5 1-0
"#;
        let identity = PlayerIdentity::new("Royal, Shreyas", Some("448869")).unwrap();
        let outcome = scan_pgn_reader(
            BufReader::new(Cursor::new(malformed.as_bytes())),
            &identity,
            "Chess-Results player search",
            "https://example.test/player.pgn",
            2020,
        );

        assert_eq!(outcome.matched, 2);
        assert_eq!(outcome.games.len(), 2);
        assert!(outcome.games.iter().all(|game| {
            game.pgn.matches("[Event ").count() == 1
                && game.pgn.matches("[OutpostSource ").count() == 1
        }));
        assert!(outcome.games[1].pgn.contains("[BlackClock \"0:12:44\"]\n"));
    }

    #[test]
    fn sanitizer_escapes_literal_quotes_inside_header_values() {
        let game = "[Event \"The \"Open\" Final\"]\n[Result \"*\"]\n\n1. e4 *\n";
        let sanitized = sanitize_pgn_headers(game);

        assert_eq!(
            sanitized,
            "[Event \"The \\\"Open\\\" Final\"]\n[Result \"*\"]\n\n1. e4 *\n"
        );
    }

    #[test]
    fn sanitizer_removes_a_result_stranded_after_a_header() {
        assert_eq!(
            sanitize_pgn_header_line("[BlackClock \"0:12:44\"] 0-1"),
            Some("[BlackClock \"0:12:44\"]".to_string())
        );
    }

    #[test]
    fn sanitizer_round_trips_existing_header_escapes() {
        let game = r#"[Event "The \"Open\" at C:\\Chess"]
[Site "A\\B \"Hall\""]

1. d4 d5 *
"#;

        assert_eq!(sanitize_pgn_headers(game), game);
    }

    #[test]
    fn sanitizer_leaves_movetext_untouched() {
        let movetext =
            "1. e4 {literal \"quote\", \\\\ slash, and  two spaces} e5 *\n[not a header here]\n";
        let game = format!("[Event \"The \"Open\" Final\"]\n\n{movetext}");
        let sanitized = sanitize_pgn_headers(&game);

        assert_eq!(sanitized.split_once("\n\n").unwrap().1, movetext);
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
    fn exact_move_dedupe_does_not_merge_different_records() {
        let first = "[Event \"Open\"]\n[Date \"2026.05.10\"]\n[Round \"1\"]\n[White \"Target\"]\n[Black \"Opponent One\"]\n[Result \"1-0\"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0\n";
        let different_date = first.replace("2026.05.10", "2026.05.13");
        let different_opponent = first.replace("Opponent One", "Opponent Two");
        let mut collection = Collection::default();
        add_game(&mut collection, first.to_string(), "A", "White");
        add_game(&mut collection, different_date, "B", "White");
        add_game(&mut collection, different_opponent, "C", "White");
        assert_eq!(collection.games.len(), 3);
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
    fn live_lichess_listing_filters_cards_by_cutoff_but_keeps_undated_cards() {
        let html = r#"<a href="/broadcast/old-event/round-1/OldRound" datetime="2026-07-31T18:00:00Z">Old</a>
<a href="/broadcast/new-event/round-1/NewRound" datetime="2026-08-01T18:00:00Z">New</a>
<a href="/broadcast/undated-event/round-1/NoDate01">Undated</a>"#;
        assert_eq!(
            extract_lichess_rounds_since(html, "2026-08-01"),
            vec![
                (
                    "/broadcast/new-event/round-1/NewRound".to_string(),
                    Some("2026-08-01T18:00:00Z".to_string()),
                ),
                (
                    "/broadcast/undated-event/round-1/NoDate01".to_string(),
                    None,
                ),
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
    fn follows_the_canonical_lichess_fide_next_page_link() {
        let seen = HashSet::from(["https://lichess.org/fide/4100018/player".to_string()]);
        let html = r#"<section class="relay-cards">
<a class="pager" href="/fide/4100018/Kasparov_Garry?page=2&amp;order=date" rel="nofollow next">Next</a>
</section>"#;

        assert_eq!(
            lichess_fide_next_page_url(html, "4100018", &seen).unwrap(),
            Some("https://lichess.org/fide/4100018/Kasparov_Garry?page=2&order=date".to_string())
        );
    }

    #[test]
    fn lichess_fide_pagination_rejects_loops_and_external_cursors() {
        let page_two = "https://lichess.org/fide/4100018/Kasparov_Garry?page=2";
        let seen = HashSet::from([
            "https://lichess.org/fide/4100018/player".to_string(),
            page_two.to_string(),
        ]);
        let looped = format!(r#"<a rel='next' href='{page_two}'>Next</a>"#);
        assert!(
            lichess_fide_next_page_url(&looped, "4100018", &seen)
                .unwrap_err()
                .contains("repeated"),
            "a previously visited cursor must stop the listing scan"
        );

        let external = r#"<a rel="next" href="https://example.com/fide/4100018?page=3">Next</a>"#;
        assert!(
            lichess_fide_next_page_url(external, "4100018", &seen)
                .unwrap_err()
                .contains("invalid next-page link"),
            "a pagination link must remain on the Lichess FIDE origin"
        );
        let wrong_player = r#"<a rel="next" href="/fide/1503014/Polgar_Judit?page=3">Next</a>"#;
        assert!(
            lichess_fide_next_page_url(wrong_player, "4100018", &seen)
                .unwrap_err()
                .contains("invalid next-page link"),
            "a pagination link must remain on the requested FIDE player"
        );
        assert_eq!(
            lichess_fide_next_page_url(
                r#"<a rel="prev" href="/fide/4100018/x?page=1">Previous</a>"#,
                "4100018",
                &seen
            )
            .unwrap(),
            None,
            "the absence of rel=next terminates pagination normally"
        );
    }

    #[tokio::test]
    async fn lichess_fide_discovery_follows_every_page_even_after_an_old_card() {
        let _lane = LICHESS_TEST_LANE.lock().await;
        reset_lichess_test_state();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("mock Lichess listener");
        let address = listener.local_addr().expect("mock address");
        let server = tokio::spawn(async move {
            let mut requested = Vec::new();
            for page in 1..=21usize {
                let (mut socket, _) = listener.accept().await.expect("mock accept");
                let request = read_mock_request(&mut socket).await;
                requested.push(
                    request
                        .lines()
                        .next()
                        .and_then(|line| line.split_whitespace().nth(1))
                        .expect("request path")
                        .to_string(),
                );
                let date = if page == 1 {
                    "2010-01-01"
                } else {
                    "2026-01-01"
                };
                let next = if page < 21 {
                    format!(
                        "<a rel=\"next\" href=\"/fide/24276111/Lapidus_Alexey?page={}\">Next</a>",
                        page + 1
                    )
                } else {
                    String::new()
                };
                let body = format!(
                    "<a href=\"/broadcast/test/round-{page}/P{page:07}\" datetime=\"{date}T00:00:00Z\">Card</a>{next}"
                );
                write_mock_response(&mut socket, "200 OK", &body).await;
            }
            requested
        });

        let temp = tempfile::tempdir().expect("temporary cache");
        let request = test_request(temp.path());
        let collection = Mutex::new(Collection::default());
        let progress = |_progress: OtbImportProgress| {};
        let origin = format!("http://{address}");
        let (rounds, errors) = discover_lichess_fide_rounds(
            &Client::new(),
            &request,
            &collection,
            &progress,
            "Lichess live FIDE broadcasts",
            "24276111",
            &origin,
            &format!("{origin}/fide/24276111/player"),
        )
        .await;
        let requested = server.await.expect("mock server task");

        assert_eq!(requested.len(), 21, "discovery must not stop at page 20");
        assert_eq!(
            rounds.len(),
            20,
            "the old card is filtered, not a stop signal"
        );
        assert!(rounds.iter().any(|round| round.ends_with("P0000021")));
        assert!(errors.is_empty(), "{errors:?}");
        reset_lichess_test_state();
    }

    #[test]
    fn resolves_exact_lichess_study_chapters_by_fide_id() {
        let identity = PlayerIdentity::new("Price, Gwilym", Some("443980")).unwrap();
        let round = serde_json::json!({
            "games": [
                {
                    "id": "iNMW9Eeg",
                    "name": "Roberson, Peter T - Price, Gwilym",
                    "players": [
                        { "name": "Roberson, Peter T", "fideId": 412384 },
                        { "name": "Price, Gwilym", "fideId": 443980 }
                    ]
                },
                {
                    "id": "Other001",
                    "name": "Other - Players",
                    "players": [
                        { "name": "Other, One", "fideId": 1 },
                        { "name": "Other, Two", "fideId": 2 }
                    ]
                }
            ]
        });
        assert_eq!(
            lichess_player_chapter_ids(&round, &identity),
            Some(vec!["iNMW9Eeg".to_string()])
        );

        let conflicting_id = serde_json::json!({
            "games": [{
                "id": "iNMW9Eeg",
                "players": [{ "name": "Price, Gwilym", "fideId": 999999 }]
            }]
        });
        assert_eq!(
            lichess_player_chapter_ids(&conflicting_id, &identity),
            None,
            "an ambiguous roster must retain the whole-round fallback"
        );
    }

    #[test]
    fn parses_public_round_bootstrap_and_uses_only_finished_singletons_directly() {
        let chapters = serde_json::json!([{
            "id": "Chap0001",
            "players": [
                { "name": "Lapidus, Alexey M.", "fideId": 24276111 },
                { "name": "Example, Opponent", "fideId": 1 }
            ]
        }]);
        let html = lichess_round_page(
            "Tour0001",
            [1767225600000, 1767312000000],
            &[("Round001", true)],
            chapters,
        );
        let value =
            extract_lichess_round_page_metadata(&html, "Round001").expect("valid bootstrap");
        assert_eq!(
            lichess_tour_id_and_dates(&value),
            Some(("Tour0001".to_string(), Some((1767225600000, 1767312000000))))
        );

        let temp = tempfile::tempdir().expect("temporary cache");
        let specs = lichess_single_round_player_specs(
            &value,
            &identity(),
            temp.path(),
            "https://lichess.org/",
            "Round001",
        );
        assert_eq!(specs.len(), 1);
        assert_eq!(
            specs[0].url,
            format!(
                "https://lichess.org/api/study/Round001/Chap0001.pgn?{LICHESS_STUDY_EXPORT_QUERY}"
            )
        );
        let expected_fallback =
            format!("https://lichess.org/api/study/Round001.pgn?{LICHESS_STUDY_EXPORT_QUERY}");
        assert_eq!(
            specs[0]
                .lichess_fallback
                .as_ref()
                .map(|(url, _)| url.as_str()),
            Some(expected_fallback.as_str())
        );

        for rounds in [
            vec![("Round001", false)],
            vec![("Round001", true), ("Round002", true)],
        ] {
            let html = lichess_round_page(
                "Tour0001",
                [1767225600000, 1767312000000],
                &rounds,
                serde_json::json!([{
                    "id": "Chap0001",
                    "players": [
                        { "name": "Lapidus, Alexey M.", "fideId": 24276111 }
                    ]
                }]),
            );
            let value = extract_lichess_round_page_metadata(&html, "Round001")
                .expect("valid non-direct bootstrap");
            assert!(lichess_single_round_player_specs(
                &value,
                &identity(),
                temp.path(),
                "https://lichess.org",
                "Round001",
            )
            .is_empty());
        }
    }

    #[tokio::test]
    async fn malformed_public_round_page_falls_back_to_the_official_api() {
        let _lane = LICHESS_TEST_LANE.lock().await;
        reset_lichess_test_state();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("mock Lichess listener");
        let address = listener.local_addr().expect("mock address");
        let server = tokio::spawn(async move {
            let mut paths = Vec::new();
            for _ in 0..2 {
                let (mut socket, _) = listener.accept().await.expect("mock accept");
                let request = read_mock_request(&mut socket).await;
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .expect("request path")
                    .to_string();
                let body = if path == "/broadcast/test/round/Round001" {
                    "<html>page-init-data changed</html>".to_string()
                } else if path == "/api/broadcast/test/round/Round001" {
                    assert!(request
                        .to_ascii_lowercase()
                        .contains("accept: application/json"));
                    serde_json::json!({
                        "tour": {
                            "id": "Tour0001",
                            "dates": [1767225600000i64, 1767312000000i64]
                        },
                        "round": { "id": "Round001", "finished": true },
                        "games": []
                    })
                    .to_string()
                } else {
                    panic!("unexpected mock request {path}");
                };
                paths.push(path);
                write_mock_response(&mut socket, "200 OK", &body).await;
            }
            paths
        });

        let temp = tempfile::tempdir().expect("temporary cache");
        let origin = format!("http://{address}");
        let value = fetch_lichess_round_metadata(
            &Client::new(),
            temp.path(),
            &origin,
            "/broadcast/test/round/Round001",
            "Round001",
        )
        .await
        .expect("API fallback metadata");
        let paths = server.await.expect("mock server task");
        assert_eq!(
            paths,
            vec![
                "/broadcast/test/round/Round001".to_string(),
                "/api/broadcast/test/round/Round001".to_string()
            ]
        );
        assert_eq!(
            lichess_tour_id_and_dates(&value).map(|(id, _)| id),
            Some("Tour0001".to_string())
        );
        reset_lichess_test_state();
    }

    #[test]
    fn avoids_known_missing_fide_lookup_for_legacy_tours() {
        let identity = PlayerIdentity::new("Houska, Jovanka", Some("405094")).unwrap();
        let legacy = serde_json::json!({
            "games": [{
                "players": [
                    { "name": "Houska, Jovanka" },
                    { "name": "Example, Opponent" }
                ]
            }]
        });
        assert_eq!(
            lichess_tour_player_keys(&legacy, &identity),
            vec!["Houska%2C%20Jovanka".to_string(), "405094".to_string()]
        );

        let tagged = serde_json::json!({
            "games": [{
                "players": [
                    { "name": "Houska, Jovanka", "fideId": 405094 },
                    { "name": "Example, Opponent", "fideId": 1 }
                ]
            }]
        });
        assert_eq!(
            lichess_tour_player_keys(&tagged, &identity),
            vec!["405094".to_string(), "Houska%2C%20Jovanka".to_string()]
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
        assert!(four_ncl_archive_is_growing(
            "https://www.4ncl.co.uk/pgn/2526/otb/4NCLotb2526all.pgn",
            "2526"
        ));
        assert!(!four_ncl_archive_is_growing(
            "https://www.4ncl.co.uk/pgn/2425/congress/easter25/easter25all.pgn",
            "2526"
        ));
        assert_eq!(four_ncl_season_for_date(2026, 1), "2526");
        assert_eq!(four_ncl_season_for_date(2026, 10), "2627");
        assert_eq!(
            four_ncl_season_from_url("https://www.4ncl.co.uk/pgn/2627/otb/4NCLotb2627all.pgn")
                .as_deref(),
            Some("2627")
        );
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
        assert_eq!(
            extract_chessscope_game_date("<p>September 3, 2026 abcde—multibyte tail</p>"),
            Some("2026-09-03".to_string())
        );
        let mut complete_months = (1..=12).map(|month| (2022, month)).collect::<HashSet<_>>();
        complete_months.extend([(2024, 1), (2024, 3)]);
        let coverage = LichessCorpusCoverage::from_complete_months(2022, complete_months);
        assert!(coverage.covers_year(2022));
        assert!(!coverage.covers_year(2024));
        assert!(coverage.covers_date("2024-03-10"));
        assert!(!coverage.covers_date("2024-02-10"));
        let january = year_start_millis(2024);
        let march = january + 60 * 24 * 60 * 60 * 1_000;
        assert!(!coverage.covers_timestamp_range(january, march));
        let first_quarter = LichessCorpusCoverage::from_complete_months(
            2024,
            HashSet::from([(2024, 1), (2024, 2), (2024, 3)]),
        );
        assert!(first_quarter.covers_timestamp_range(january, march));

        let latest_only =
            LichessCorpusCoverage::from_complete_months(2024, HashSet::from([(2026, 8)]));
        assert!(!latest_only.covers_year(2025));
    }

    #[tokio::test]
    async fn lichess_fide_tour_pipeline_recovers_every_round_by_encoded_name_and_dedupes_cards() {
        let _lane = LICHESS_TEST_LANE.lock().await;
        reset_lichess_test_state();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("mock Lichess listener");
        let address = listener.local_addr().expect("mock address");
        let temp = tempfile::tempdir().expect("temporary cache");
        let request = test_request(temp.path());
        let origin = format!("http://{address}");
        let first_card = "/broadcast/test/a-card/Last0001";
        let cached_later_card = "/broadcast/test/z-card/Dupl0001";
        let cached_metadata_url = format!("{origin}{cached_later_card}");
        std::fs::write(
            temp.path()
                .join(cache_file_name("lichess-round-page", &cached_metadata_url)),
            lichess_round_page(
                "Tour0001",
                [1767225600000i64, 1769904000000i64],
                &[("Early001", true), ("Last0001", true), ("Dupl0001", true)],
                serde_json::json!([{
                    "players": [
                        { "name": "Lapidus, Alexey M." },
                        { "name": "Example, Opponent" }
                    ]
                }]),
            ),
        )
        .expect("cached later-card page");
        let server = tokio::spawn(async move {
            let mut paths = Vec::new();
            for _ in 0..5 {
                let (mut socket, _) = listener.accept().await.expect("mock accept");
                let request = read_mock_request(&mut socket).await;
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .expect("request path")
                    .to_string();
                if path.contains("/players/") {
                    assert!(
                        request
                            .to_ascii_lowercase()
                            .contains("accept: application/json"),
                        "player lookup must request JSON"
                    );
                }
                let (status, body) = if path == first_card {
                    (
                        "200 OK",
                        lichess_round_page(
                            "Tour0001",
                            [1767225600000i64, 1769904000000i64],
                            &[("Early001", true), ("Last0001", true)],
                            serde_json::json!([{
                                "players": [
                                    { "name": "Lapidus, Alexey M.", "fideId": 24276111 },
                                    { "name": "Example, Opponent", "fideId": 1 }
                                ]
                            }]),
                        ),
                    )
                } else if path == "/broadcast/Tour0001/players/24276111" {
                    ("404 Not Found", String::new())
                } else if path == "/broadcast/Tour0001/players/Lapidus%2C%20Alexey%20M." {
                    (
                        "200 OK",
                        serde_json::json!({
                            "games": [
                                { "round": "Early001", "id": "Chap0001" },
                                { "round": "Last0001", "id": "Chap0002" }
                            ]
                        })
                        .to_string(),
                    )
                } else if path.starts_with("/api/study/Early001/Chap0001.pgn?") {
                    (
                        "200 OK",
                        "[Event \"Early round\"]\n[Site \"London ENG\"]\n[Date \"2026.01.01\"]\n[Round \"1\"]\n[White \"Lapidus, Alexey M.\"]\n[Black \"Example, Opponent\"]\n[Result \"1-0\"]\n[WhiteFideId \"24276111\"]\n\n1. e4 e5 {early annotation} 2. Nf3 Nc6 1-0\n".to_string(),
                    )
                } else if path.starts_with("/api/study/Last0001/Chap0002.pgn?") {
                    (
                        "200 OK",
                        "[Event \"Last round\"]\n[Site \"London ENG\"]\n[Date \"2026.02.01\"]\n[Round \"9\"]\n[White \"Example, Opponent\"]\n[Black \"Lapidus, Alexey M.\"]\n[Result \"0-1\"]\n[BlackFideId \"24276111\"]\n\n1. d4 d5 2. c4 e6 0-1\n".to_string(),
                    )
                } else {
                    panic!("unexpected mock request {path}");
                };
                paths.push(path);
                write_mock_response(&mut socket, status, &body).await;
            }
            paths
        });

        let identity = Arc::new(identity());
        let collection = Mutex::new(Collection::default());
        let progress = |_progress: OtbImportProgress| {};
        let mut report = OtbImportSourceReport::new("Lichess live FIDE broadcasts");
        let round_paths = vec![cached_later_card.to_string(), first_card.to_string()];

        tokio::time::timeout(
            Duration::from_secs(5),
            scan_lichess_rounds_pipelined(
                &Client::new(),
                &request,
                &identity,
                &collection,
                &progress,
                "Lichess live FIDE broadcasts",
                &mut report,
                round_paths,
                &LichessCorpusCoverage::empty(2020),
                &origin,
                Some(GROWING_ARCHIVE_CACHE_MAX_AGE),
            ),
        )
        .await
        .expect("pipelined tour scan should not stall");
        let paths = server.await.expect("mock server task");
        let player_requests = paths
            .iter()
            .filter(|path| path.contains("/players/"))
            .collect::<Vec<_>>();
        assert_eq!(
            player_requests.first().map(|path| path.as_str()),
            Some("/broadcast/Tour0001/players/24276111"),
            "the lexically first card must deterministically choose the tagged FIDE key even when the duplicate card resolves from cache first: {paths:?}"
        );
        assert_eq!(
            paths
                .iter()
                .filter(|path| path.contains("/players/24276111"))
                .count(),
            1,
            "duplicate cards must resolve the tour player only once: {paths:?}"
        );
        assert!(paths
            .iter()
            .any(|path| path.ends_with("Lapidus%2C%20Alexey%20M.")));
        assert!(paths
            .iter()
            .any(|path| path.contains("/Early001/Chap0001.pgn")));
        assert!(paths
            .iter()
            .any(|path| path.contains("/Last0001/Chap0002.pgn")));
        assert!(
            paths
                .iter()
                .all(|path| !path.starts_with("/api/broadcast/test/")),
            "valid public page metadata must avoid the rate-limited round API: {paths:?}"
        );
        assert_eq!(report.archives_checked, 2);
        assert_eq!(report.matched_games, 2);
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        let collection = lock_collection(&collection);
        assert_eq!(
            collection
                .games
                .iter()
                .map(|game| game.event.as_str())
                .collect::<Vec<_>>(),
            vec!["Early round", "Last round"]
        );
        reset_lichess_test_state();
    }

    #[tokio::test]
    async fn ongoing_lichess_tour_refreshes_a_cached_roster_before_scanning() {
        let _lane = LICHESS_TEST_LANE.lock().await;
        reset_lichess_test_state();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("mock Lichess listener");
        let address = listener.local_addr().expect("mock address");
        let temp = tempfile::tempdir().expect("temporary cache");
        let request = test_request(temp.path());
        let origin = format!("http://{address}");
        let player_url = format!("{origin}/broadcast/TourLive/players/24276111");
        let player_cache = temp
            .path()
            .join(cache_file_name("lichess-fide-tour-player", &player_url));
        std::fs::write(
            &player_cache,
            serde_json::to_vec(&serde_json::json!({
                "games": [{ "round": "OldR0001", "id": "Chap0001" }]
            }))
            .expect("stale roster JSON"),
        )
        .expect("stale ongoing roster cache");

        let server = tokio::spawn(async move {
            let mut paths = Vec::new();
            for _ in 0..4 {
                let (mut socket, _) = listener.accept().await.expect("mock accept");
                let request = read_mock_request(&mut socket).await;
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .expect("request path")
                    .to_string();
                let body = if path == "/broadcast/test/live/Live0001" {
                    lichess_round_page(
                        "TourLive",
                        [1767225600000i64, 1769904000000i64],
                        &[("Live0001", false)],
                        serde_json::json!([{
                            "players": [
                                { "name": "Lapidus, Alexey M.", "fideId": 24276111 },
                                { "name": "Example, Opponent", "fideId": 1 }
                            ]
                        }]),
                    )
                } else if path == "/broadcast/TourLive/players/24276111" {
                    serde_json::json!({
                        "games": [
                            { "round": "OldR0001", "id": "Chap0001" },
                            { "round": "NewR0002", "id": "Chap0002" }
                        ]
                    })
                    .to_string()
                } else if path.starts_with("/api/study/OldR0001/Chap0001.pgn?") {
                    "[Event \"Existing live round\"]\n[Date \"2026.01.01\"]\n[White \"Lapidus, Alexey M.\"]\n[Black \"Example, Opponent\"]\n[Result \"1-0\"]\n[WhiteFideId \"24276111\"]\n\n1. e4 e5 1-0\n".to_string()
                } else if path.starts_with("/api/study/NewR0002/Chap0002.pgn?") {
                    "[Event \"New live round\"]\n[Date \"2026.02.01\"]\n[White \"Example, Opponent\"]\n[Black \"Lapidus, Alexey M.\"]\n[Result \"0-1\"]\n[BlackFideId \"24276111\"]\n\n1. d4 d5 0-1\n".to_string()
                } else {
                    panic!("unexpected mock request {path}");
                };
                paths.push(path);
                write_mock_response(&mut socket, "200 OK", &body).await;
            }
            paths
        });

        let identity = Arc::new(identity());
        let collection = Mutex::new(Collection::default());
        let progress = |_progress: OtbImportProgress| {};
        let mut report = OtbImportSourceReport::new("Lichess live FIDE broadcasts");
        tokio::time::timeout(
            Duration::from_secs(5),
            scan_lichess_rounds_pipelined(
                &Client::new(),
                &request,
                &identity,
                &collection,
                &progress,
                "Lichess live FIDE broadcasts",
                &mut report,
                vec!["/broadcast/test/live/Live0001".to_string()],
                &LichessCorpusCoverage::empty(2020),
                &origin,
                Some(GROWING_ARCHIVE_CACHE_MAX_AGE),
            ),
        )
        .await
        .expect("ongoing tour scan should not stall");
        let paths = tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .expect("ongoing roster must be fetched live")
            .expect("mock server task");

        assert!(paths
            .iter()
            .any(|path| path == "/broadcast/TourLive/players/24276111"));
        assert!(paths
            .iter()
            .any(|path| path.starts_with("/api/study/NewR0002/Chap0002.pgn?")));
        assert_eq!(report.archives_checked, 2);
        assert_eq!(report.matched_games, 2);
        let refreshed = serde_json::from_slice::<serde_json::Value>(
            &std::fs::read(player_cache).expect("refreshed roster cache"),
        )
        .expect("refreshed roster JSON");
        assert_eq!(
            refreshed
                .get("games")
                .and_then(serde_json::Value::as_array)
                .map(Vec::len),
            Some(2)
        );
        reset_lichess_test_state();
    }

    #[tokio::test]
    async fn lichess_fide_tour_falls_back_to_annotated_full_tour_pgn() {
        let _lane = LICHESS_TEST_LANE.lock().await;
        reset_lichess_test_state();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("mock Lichess listener");
        let address = listener.local_addr().expect("mock address");
        let server = tokio::spawn(async move {
            let mut paths = Vec::new();
            for _ in 0..4 {
                let (mut socket, _) = listener.accept().await.expect("mock accept");
                let request = read_mock_request(&mut socket).await;
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .expect("request path")
                    .to_string();
                let body = if path == "/broadcast/test/last/Last0002" {
                    lichess_round_page(
                        "Tour0002",
                        [1767225600000i64, 1769904000000i64],
                        &[("Prev0002", true), ("Last0002", true)],
                        serde_json::json!([]),
                    )
                } else if path.ends_with("/players/24276111") {
                    serde_json::json!({ "games": [] }).to_string()
                } else if path.contains("/players/Lapidus%2C%20Alexey%20M.") {
                    serde_json::json!({ "name": "Lapidus, Alexey M." }).to_string()
                } else if path == "/api/broadcast/Tour0002.pgn" {
                    r#"[Event "Full tour target"]
[Site "London ENG"]
[Date "2026.01.10"]
[Round "2"]
[White "Lapidus, Alexey M."]
[Black "Example, Opponent"]
[Result "1-0"]
[WhiteFideId "24276111"]

1. e4 {full-tour annotation} e5 (1... c5 2. Nf3) 2. Nf3 Nc6 1-0

[Event "Unrelated board"]
[Site "London ENG"]
[Date "2026.01.10"]
[Round "2"]
[White "Other, One"]
[Black "Other, Two"]
[Result "*"]

*
"#
                    .to_string()
                } else {
                    panic!("unexpected mock request {path}");
                };
                paths.push(path);
                write_mock_response(&mut socket, "200 OK", &body).await;
            }
            paths
        });

        let temp = tempfile::tempdir().expect("temporary cache");
        let request = test_request(temp.path());
        let identity = Arc::new(identity());
        let collection = Mutex::new(Collection::default());
        let progress = |_progress: OtbImportProgress| {};
        let mut report = OtbImportSourceReport::new("Lichess live FIDE broadcasts");
        let origin = format!("http://{address}");
        scan_lichess_rounds_pipelined(
            &Client::new(),
            &request,
            &identity,
            &collection,
            &progress,
            "Lichess live FIDE broadcasts",
            &mut report,
            vec!["/broadcast/test/last/Last0002".to_string()],
            &LichessCorpusCoverage::empty(2020),
            &origin,
            Some(GROWING_ARCHIVE_CACHE_MAX_AGE),
        )
        .await;
        let paths = server.await.expect("mock server task");

        assert!(paths
            .iter()
            .any(|path| path == "/api/broadcast/Tour0002.pgn"));
        assert_eq!(report.archives_checked, 1);
        assert_eq!(report.matched_games, 1);
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        let collection = lock_collection(&collection);
        assert_eq!(collection.games.len(), 1);
        assert!(collection.games[0].pgn.contains("{full-tour annotation}"));
        assert!(collection.games[0].pgn.contains("(1... c5 2. Nf3)"));
        reset_lichess_test_state();
    }

    #[tokio::test]
    async fn lichess_fide_tour_skips_only_when_its_complete_date_span_is_covered() {
        let _lane = LICHESS_TEST_LANE.lock().await;
        reset_lichess_test_state();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("mock Lichess listener");
        let address = listener.local_addr().expect("mock address");
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("mock accept");
            let request = read_mock_request(&mut socket).await;
            let path = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .expect("request path")
                .to_string();
            write_mock_response(
                &mut socket,
                "200 OK",
                &lichess_round_page(
                    "Tour0003",
                    [1767225600000i64, 1769904000000i64],
                    &[("Prev0003", true), ("Last0003", true)],
                    serde_json::json!([]),
                ),
            )
            .await;
            path
        });

        let temp = tempfile::tempdir().expect("temporary cache");
        let request = test_request(temp.path());
        let identity = Arc::new(identity());
        let collection = Mutex::new(Collection::default());
        let progress = |_progress: OtbImportProgress| {};
        let mut report = OtbImportSourceReport::new("Lichess live FIDE broadcasts");
        let coverage = LichessCorpusCoverage::from_complete_months(
            2020,
            HashSet::from([(2026, 1), (2026, 2)]),
        );
        scan_lichess_rounds_pipelined(
            &Client::new(),
            &request,
            &identity,
            &collection,
            &progress,
            "Lichess live FIDE broadcasts",
            &mut report,
            vec!["/broadcast/test/last/Last0003".to_string()],
            &coverage,
            &format!("http://{address}"),
            Some(GROWING_ARCHIVE_CACHE_MAX_AGE),
        )
        .await;
        let path = server.await.expect("mock server task");

        assert!(path.ends_with("/broadcast/test/last/Last0003"));
        assert_eq!(report.archives_checked, 0);
        assert_eq!(report.matched_games, 0);
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        reset_lichess_test_state();
    }

    #[tokio::test]
    async fn complete_lichess_tour_without_the_advertised_player_fails_coverage() {
        let temp = tempfile::tempdir().expect("temporary cache");
        let request = test_request(temp.path());
        let identity = Arc::new(identity());
        let collection = Mutex::new(Collection::default());
        let progress = |_progress: OtbImportProgress| {};
        let mut report = OtbImportSourceReport::new("Lichess live FIDE broadcasts");
        let url = "https://lichess.org/api/broadcast/TourMiss.pgn".to_string();
        let cache_path = temp
            .path()
            .join(cache_file_name("lichess-broadcast-tour", &url));
        std::fs::write(
            &cache_path,
            b"[Event \"Unrelated board\"]\n[White \"Other, One\"]\n[Black \"Other, Two\"]\n[Result \"*\"]\n\n*\n",
        )
        .expect("tour cache");

        scan_direct_lichess_pgn_archives(
            &Client::new(),
            &request,
            &identity,
            &collection,
            &progress,
            "Lichess live FIDE broadcasts",
            &mut report,
            vec![IndexedArchiveSpec::lichess_complete_tour(url, cache_path)],
            Some(GROWING_ARCHIVE_CACHE_MAX_AGE),
        )
        .await;

        assert_eq!(report.archives_checked, 1);
        assert_eq!(report.matched_games, 0);
        assert_eq!(report.errors.len(), 1);
        assert!(report.errors[0].contains("complete tournament export"));
    }

    #[tokio::test]
    async fn direct_lichess_merge_is_url_ordered_and_retains_lossless_fallback() {
        let temp = tempfile::tempdir().expect("temporary cache");
        let request = test_request(temp.path());
        let identity = Arc::new(identity());
        let collection = Mutex::new(Collection::default());
        let progress = |_progress: OtbImportProgress| {};
        let mut report = OtbImportSourceReport::new("Lichess live FIDE broadcasts");

        let fallback_url = lichess_study_round_url("https://lichess.org", "RoundA00");
        let fallback_cache = temp
            .path()
            .join(cache_file_name("lichess-broadcast", &fallback_url));
        std::fs::write(
            &fallback_cache,
            br#"[Event "A fallback"]
[Site "London ENG"]
[Date "2026.01.01"]
[Round "1"]
[White "Lapidus, Alexey M."]
[Black "Example, Opponent"]
[Result "1-0"]
[WhiteFideId "24276111"]

1. e4 {fallback comment} e5 (1... c5) 2. Nf3 Nc6 1-0
"#,
        )
        .expect("fallback cache");
        let a_url = lichess_study_chapter_url("https://lichess.org", "RoundA00", "ChapterA");
        let a_cache = temp
            .path()
            .join(cache_file_name("lichess-broadcast-game", &a_url));
        std::fs::write(
            &a_cache,
            b"[Event \"No target\"]\n[White \"Other, One\"]\n[Black \"Other, Two\"]\n[Result \"*\"]\n\n*\n",
        )
        .expect("primary mismatch cache");

        let z_url = lichess_study_chapter_url("https://lichess.org", "RoundZ00", "ChapterZ");
        let z_cache = temp
            .path()
            .join(cache_file_name("lichess-broadcast-game", &z_url));
        std::fs::write(
            &z_cache,
            br#"[Event "Z exact"]
[Site "London ENG"]
[Date "2026.01.02"]
[Round "2"]
[White "Example, Opponent"]
[Black "Lapidus, Alexey M."]
[Result "0-1"]
[BlackFideId "24276111"]

1. d4 d5 {exact comment} 2. c4 e6 0-1
"#,
        )
        .expect("exact cache");

        let specs = vec![
            IndexedArchiveSpec::lichess(z_url, z_cache),
            IndexedArchiveSpec::lichess_with_fallback(a_url, a_cache, fallback_url, fallback_cache),
        ];
        scan_direct_lichess_pgn_archives(
            &Client::new(),
            &request,
            &identity,
            &collection,
            &progress,
            "Lichess live FIDE broadcasts",
            &mut report,
            specs,
            Some(GROWING_ARCHIVE_CACHE_MAX_AGE),
        )
        .await;

        assert_eq!(report.archives_checked, 2);
        assert_eq!(report.cached_archives, 2);
        assert_eq!(report.matched_games, 2);
        assert_eq!(report.unique_games_added, 2);
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        let collection = lock_collection(&collection);
        assert_eq!(
            collection
                .games
                .iter()
                .map(|game| game.event.as_str())
                .collect::<Vec<_>>(),
            vec!["A fallback", "Z exact"]
        );
        assert!(collection.games[0].pgn.contains("{fallback comment}"));
        assert!(collection.games[0].pgn.contains("(1... c5)"));
        assert!(collection.games[1].pgn.contains("{exact comment}"));
    }

    #[tokio::test]
    async fn lichess_lane_serializes_complete_bodies_and_keeps_retry_after_cooldowns() {
        use tokio::io::AsyncWriteExt;

        let _lane = LICHESS_TEST_LANE.lock().await;
        reset_lichess_test_state();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("mock Lichess listener");
        let address = listener.local_addr().expect("mock address");
        let first_body_started = Arc::new(tokio::sync::Semaphore::new(0));
        let release_first_body = Arc::new(tokio::sync::Semaphore::new(0));
        let server = tokio::spawn({
            let first_body_started = Arc::clone(&first_body_started);
            let release_first_body = Arc::clone(&release_first_body);
            async move {
                let (mut first, _) = listener.accept().await.expect("first mock accept");
                let _ = read_mock_request(&mut first).await;
                first
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nf",
                    )
                    .await
                    .expect("partial first body");
                first_body_started.add_permits(1);

                assert!(
                    tokio::time::timeout(Duration::from_millis(150), listener.accept())
                        .await
                        .is_err(),
                    "a second Lichess request entered before the first body completed"
                );
                release_first_body
                    .acquire()
                    .await
                    .expect("body release permit")
                    .forget();
                first.write_all(b"irst").await.expect("complete first body");

                let (mut second, _) = listener.accept().await.expect("second mock accept");
                let _ = read_mock_request(&mut second).await;
                second
                    .write_all(
                        b"HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\nRetry-After: 60\r\nConnection: close\r\n\r\n",
                    )
                    .await
                    .expect("rate-limit response");
            }
        });

        let client = Client::new();
        let first_url = format!("http://{address}/first");
        let second_url = format!("http://{address}/second");
        let first = tokio::spawn({
            let client = client.clone();
            async move { get_lichess_with_backoff(&client, &first_url).await }
        });
        first_body_started
            .acquire()
            .await
            .expect("first body start")
            .forget();
        let second = tokio::spawn({
            let client = client.clone();
            async move { get_lichess_with_backoff(&client, &second_url).await }
        });
        tokio::time::sleep(Duration::from_millis(200)).await;
        release_first_body.add_permits(1);

        assert_eq!(first.await.expect("first request task").unwrap(), b"first");
        let second_error = second
            .await
            .expect("second request task")
            .expect_err("mock 429 should fail");
        assert!(second_error.contains("rate-limited"), "{second_error}");
        server.await.expect("mock server task");
        let cooldown_error = wait_for_lichess_lane()
            .await
            .expect_err("Retry-After should close the shared lane");
        assert!(cooldown_error.contains("cooling down"), "{cooldown_error}");
        reset_lichess_test_state();
    }

    #[tokio::test]
    async fn scans_growing_lichess_pgn_directly_from_the_fresh_byte_cache() {
        let temp = tempfile::tempdir().expect("temporary cache");
        let url = "https://lichess.org/api/broadcast/direct-cache-test.pgn".to_string();
        let cache_path = temp.path().join(cache_file_name("lichess-broadcast", &url));
        tokio::fs::write(
            &cache_path,
            br#"[Event "Direct cache test"]
[Site "London ENG"]
[Date "2024.01.01"]
[Round "1"]
[White "Lapidus, Alexey M."]
[Black "Example, Opponent"]
[Result "1-0"]
[WhiteFideId "24276111"]

1. e4 e5 2. Nf3 Nc6 1-0
"#,
        )
        .await
        .expect("cache write");
        let request = OtbImportRequest {
            job_id: "direct-cache-test".to_string(),
            player_name: "Lapidus, Alexey M.".to_string(),
            fide_id: Some("24276111".to_string()),
            from_year: 2020,
            include_lichess_broadcasts: true,
            include_lichess_broadcast_archives: true,
            include_lichess_community_broadcasts: true,
            include_chess_results: true,
            include_chessbase_news: true,
            include_official_pgn_indexes: true,
            include_twic: true,
            local_pgn_paths: Vec::new(),
            cache_dir: temp.path().to_path_buf(),
            output_path: temp.path().join("unused.pgn"),
        };
        let identity = Arc::new(identity());
        let collection = Mutex::new(Collection::default());
        let progress = |_progress: OtbImportProgress| {};
        let mut report = OtbImportSourceReport::new("Chessscope broadcast discovery");

        scan_direct_lichess_pgn_archives(
            &Client::new(),
            &request,
            &identity,
            &collection,
            &progress,
            "Chessscope broadcast discovery",
            &mut report,
            vec![IndexedArchiveSpec::lichess(url, cache_path)],
            Some(GROWING_ARCHIVE_CACHE_MAX_AGE),
        )
        .await;

        assert_eq!(report.archives_checked, 1);
        assert_eq!(report.cached_archives, 1);
        assert_eq!(report.matched_games, 1);
        assert_eq!(report.unique_games_added, 1);
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert_eq!(games_len(&collection), 1);
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
    fn repairs_the_bare_britbase_pgn_and_keeps_alias_keys_compatible() {
        let advertised = "https://www.saund.co.uk/britbase/201707countyfinal.pgn";
        let canonical = "https://www.saund.org.uk/britbase/pgn/201707countyfinal.pgn";
        assert_eq!(canonical_britbase_url(advertised), canonical);
        assert_eq!(
            britbase_equivalent_urls(advertised),
            vec![
                canonical.to_string(),
                "https://www.saund.co.uk/britbase/pgn/201707countyfinal.pgn".to_string(),
                "https://www.saund.org.uk/britbase/201707countyfinal.pgn".to_string(),
                advertised.to_string(),
            ]
        );
        assert_eq!(
            canonical_britbase_url("https://www.saund.co.uk/britbase/pg20034ncl2.zip"),
            "https://www.saund.org.uk/britbase/pg20034ncl2.zip"
        );
    }

    #[test]
    fn britbase_live_request_uses_its_decade_index_as_referer() {
        let cache = tempfile::tempdir().expect("temporary cache");
        let spec = BritBaseArchiveSpec::new(
            "https://www.saund.org.uk/britbase/pgn/202608lancaster.pgn".to_string(),
            "https://www.saund.org.uk/britbase/brit2020.htm".to_string(),
            cache.path(),
        );
        let request = britbase_request(&Client::new(), &spec, &spec.fetch_urls[0])
            .build()
            .expect("BritBase request");
        assert_eq!(request.url().as_str(), spec.url);
        assert_eq!(
            request
                .headers()
                .get(REFERER)
                .and_then(|value| value.to_str().ok()),
            Some(spec.referer.as_str())
        );
    }

    #[tokio::test]
    async fn reads_an_alias_named_britbase_cache_before_live_fetching() {
        let cache = tempfile::tempdir().expect("temporary cache");
        let spec = BritBaseArchiveSpec::new(
            "https://www.saund.co.uk/britbase/pgn/201807bcf.pgn".to_string(),
            "https://www.saund.org.uk/britbase/brit2010.htm".to_string(),
            cache.path(),
        );
        let alias_path = cache
            .path()
            .join(cache_file_name("britbase", &spec.index_keys[1]));
        std::fs::write(&alias_path, b"cached BritBase bytes").expect("alias cache write");
        assert_eq!(
            read_britbase_cache_entry(&spec).await,
            Some(b"cached BritBase bytes".to_vec())
        );
    }

    #[tokio::test]
    async fn britbase_404_falls_through_to_an_equivalent_moved_url() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("mock BritBase listener");
        let address = listener.local_addr().expect("mock address");
        let server = tokio::spawn(async move {
            for (status, body) in [
                ("404 Not Found", ""),
                ("200 OK", "[Event \"Recovered\"]\n\n*\n"),
            ] {
                let (mut socket, _) = listener.accept().await.expect("mock accept");
                let mut request = Vec::new();
                loop {
                    let mut chunk = [0u8; 1024];
                    let read = socket.read(&mut chunk).await.expect("mock request read");
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&chunk[..read]);
                    if request.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }
                let request = String::from_utf8_lossy(&request).to_ascii_lowercase();
                assert!(request.contains("referer: https://www.saund.org.uk/britbase/brit2010.htm"));
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket
                    .write_all(response.as_bytes())
                    .await
                    .expect("mock response write");
            }
        });

        let cache = tempfile::tempdir().expect("temporary cache");
        let mut spec = BritBaseArchiveSpec::new(
            "https://www.saund.org.uk/britbase/201707countyfinal.pgn".to_string(),
            "https://www.saund.org.uk/britbase/brit2010.htm".to_string(),
            cache.path(),
        );
        spec.fetch_urls = vec![
            format!("http://{address}/missing.pgn"),
            format!("http://{address}/moved.pgn"),
        ];
        match fetch_britbase_archive(&Client::new(), &spec).await {
            BritBaseLiveFetch::Downloaded(bytes) => {
                assert_eq!(bytes, b"[Event \"Recovered\"]\n\n*\n")
            }
            _ => panic!("equivalent moved URL should have been downloaded"),
        }
        server.await.expect("mock server task");
    }

    #[tokio::test]
    async fn britbase_cold_batch_fetches_and_caches_every_advertised_archive() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        assert_eq!(BRITBASE_CONCURRENCY, 16);
        *BRITBASE_LANE_GATE
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = None;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("mock BritBase listener");
        let address = listener.local_addr().expect("mock address");
        let all_requests_arrived = Arc::new(tokio::sync::Barrier::new(BRITBASE_CONCURRENCY));
        let server = tokio::spawn({
            let all_requests_arrived = Arc::clone(&all_requests_arrived);
            async move {
                let mut handlers = Vec::new();
                for index in 0..BRITBASE_CONCURRENCY {
                    let (mut socket, _) = listener.accept().await.expect("mock accept");
                    let all_requests_arrived = Arc::clone(&all_requests_arrived);
                    handlers.push(tokio::spawn(async move {
                        let mut request = Vec::new();
                        loop {
                            let mut chunk = [0u8; 1024];
                            let read = socket.read(&mut chunk).await.expect("mock request read");
                            if read == 0 {
                                break;
                            }
                            request.extend_from_slice(&chunk[..read]);
                            if request.windows(4).any(|window| window == b"\r\n\r\n") {
                                break;
                            }
                        }
                        let request = String::from_utf8_lossy(&request).to_ascii_lowercase();
                        assert!(request.contains("referer: https://www.saund.org.uk/britbase/brit40.htm"));

                        // No response is released until the whole production-size
                        // batch has reached the server. A serial or two-wide fetch
                        // therefore cannot make this test pass by accident.
                        all_requests_arrived.wait().await;
                        let body = format!("[Event \"Cold archive {index}\"]\n\n*\n");
                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                            body.len()
                        );
                        socket
                            .write_all(response.as_bytes())
                            .await
                            .expect("mock response write");
                        body.into_bytes()
                    }));
                }
                future::join_all(handlers)
                    .await
                    .into_iter()
                    .map(|result| result.expect("mock handler"))
                    .collect::<Vec<_>>()
            }
        });

        let cache = tempfile::tempdir().expect("temporary cache");
        let specs = (0..BRITBASE_CONCURRENCY)
            .map(|index| {
                let mut spec = BritBaseArchiveSpec::new(
                    format!("https://www.saund.org.uk/britbase/pgn/1940{index:02}fixture.pgn"),
                    "https://www.saund.org.uk/britbase/brit40.htm".to_string(),
                    cache.path(),
                );
                spec.fetch_urls = vec![format!("http://{address}/archive-{index}.pgn")];
                spec
            })
            .collect::<Vec<_>>();
        let results = fetch_britbase_batch(&Client::new(), &specs).await;
        let served_bodies = server.await.expect("mock server task");

        assert_eq!(results.len(), BRITBASE_CONCURRENCY);
        for ((spec, result), expected) in results.into_iter().zip(served_bodies) {
            match result {
                BritBaseLiveFetch::Downloaded(bytes) => assert_eq!(bytes, expected),
                _ => panic!("every advertised archive should be downloaded"),
            }
            assert_eq!(
                tokio::fs::read(&spec.cache_paths[0])
                    .await
                    .expect("cold archive cache"),
                expected
            );
        }
    }

    #[test]
    fn britbase_partial_coverage_counts_attempted_and_unattempted_files() {
        let coverage = BritBaseCoverage {
            advertised: 427,
            indexed: 2,
            live_attempted: 2,
            forbidden: 2,
            ..BritBaseCoverage::default()
        };
        assert!(!coverage.is_complete());
        assert_eq!(coverage.not_attempted(), 423);
        let message = coverage.incomplete_message();
        assert!(message.contains("2/427 advertised files"));
        assert!(message.contains("2 returned HTTP 403 Forbidden"));
        assert!(message.contains("423 advertised files were not attempted"));
        assert!(message.contains("file counts, not missing-game counts"));
    }

    #[test]
    fn all_equivalent_404s_account_for_an_absent_britbase_artifact() {
        let coverage = BritBaseCoverage {
            advertised: 1,
            live_attempted: 1,
            confirmed_absent: 1,
            not_found: 1,
            ..BritBaseCoverage::default()
        };
        assert!(coverage.is_complete());
        assert_eq!(coverage.accounted(), 1);
        assert_eq!(coverage.not_attempted(), 0);
    }

    #[test]
    fn empty_discovery_pages_cannot_claim_complete_coverage() {
        assert!(validate_discovery_count("TWIC", "https://example.test/index", 1).is_ok());
        let error = validate_discovery_count("TWIC", "https://example.test/index", 0)
            .expect_err("a structurally empty index must be rejected");
        assert!(error.contains("no usable archive links"));
        assert!(error.contains("challenge or changed index page"));
    }

    #[test]
    fn deterministic_collection_keeps_named_zero_move_otb_records() {
        let zero_move = r#"[Event "Forfeit"]
[Site "London ENG"]
[Date "2026.08.30"]
[Round "4"]
[White "Lapidus, Alexey M."]
[Black "Opponent, One"]
[Result "1-0"]

1-0
"#;
        let mut collection = Collection::capturing();
        add_game(&mut collection, zero_move.to_string(), "Archive", "White");
        add_game(
            &mut collection,
            "[Result \"1-0\"]\n\n1-0\n".to_string(),
            "Broken fragment",
            "White",
        );

        assert_eq!(collection.games.len(), 1);
        let rebuilt = collection.into_deterministic();
        assert_eq!(rebuilt.games.len(), 1);
        assert_eq!(rebuilt.games[0].event, "Forfeit");
        assert!(rebuilt.games[0].mainline_moves.is_empty());
    }

    #[test]
    fn rejects_torn_records_without_both_player_names() {
        let missing_black = r#"[White "Ding, Liren"]
[BlackFideId "4126025"] [ECO "A00"] [PlyCount
"0"] [EventDate "2023.09.13"] 0-1
"#;
        let missing_white = r#"[Black "Ding, Liren"]
[Result "1-0"]

1. e4 e5 1-0
"#;
        let mut collection = Collection::capturing();
        add_game(
            &mut collection,
            missing_black.to_string(),
            "Broken exporter tail",
            "White",
        );
        add_game(
            &mut collection,
            missing_white.to_string(),
            "Broken exporter tail",
            "Black",
        );

        assert!(collection.games.is_empty());
        assert!(collection.candidate_games.is_empty());
    }

    #[test]
    fn newest_game_dates_require_a_numeric_year() {
        assert!(pgn_date_has_numeric_year("2026.08.30"));
        assert!(pgn_date_has_numeric_year("2026.??.??"));
        assert!(!pgn_date_has_numeric_year("????.??.??"));
        assert!(!pgn_date_has_numeric_year("øøøø.øø.øø"));
        assert!(!pgn_date_has_numeric_year("202"));
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
    fn duplicate_quality_winner_is_independent_of_source_completion_order() {
        let plain = r#"[Event "Sinquefield Cup"]
[Date "2026.08.20"]
[White "Caruana, Fabiano"]
[Black "So, Wesley"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0
"#;
        // The opponent spelling intentionally differs so this exercises the
        // exact-move duplicate path rather than the identity-prefix path.
        let annotated = r#"[Event "Sinquefield Cup"]
[Date "2026.08.20"]
[White "Caruana, Fabiano"]
[Black "Wesley So"]
[Result "1-0"]

1. e4 {[%clk 1:59:58]} e5 {[%clk 1:59:54]} 2. Nf3 Nc6 3. Bb5 a6 1-0
"#;

        for rich_first in [false, true] {
            let mut collection = Collection::default();
            if rich_first {
                add_game(&mut collection, annotated.to_string(), "Rich", "White");
                add_game(&mut collection, plain.to_string(), "Plain", "White");
            } else {
                add_game(&mut collection, plain.to_string(), "Plain", "White");
                add_game(&mut collection, annotated.to_string(), "Rich", "White");
            }
            assert_eq!(collection.games.len(), 1);
            assert_eq!(collection.duplicates_removed, 1);
            assert_eq!(collection.games[0].pgn, annotated);
            assert_eq!(collection.games[0].source, "Rich");
        }
    }

    #[test]
    fn legal_archive_copy_beats_a_longer_but_illegal_duplicate() {
        let legal = r#"[Event "Test"]
[Date "2026.08.20"]
[White "Caruana, Fabiano"]
[Black "Opponent"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 1-0
"#;
        let illegal = legal.replace("7. Bb3 1-0", "7. Bb3 Ke7 {[%clk 1:20:00]} 1-0");
        assert!(pgn_has_legal_standard_mainline(legal));
        assert!(!pgn_has_legal_standard_mainline(&illegal));

        for illegal_first in [false, true] {
            let mut collection = Collection::default();
            if illegal_first {
                add_game(
                    &mut collection,
                    illegal.clone(),
                    "Rich but invalid",
                    "White",
                );
                add_game(
                    &mut collection,
                    legal.to_string(),
                    "Plain and valid",
                    "White",
                );
            } else {
                add_game(
                    &mut collection,
                    legal.to_string(),
                    "Plain and valid",
                    "White",
                );
                add_game(
                    &mut collection,
                    illegal.clone(),
                    "Rich but invalid",
                    "White",
                );
            }
            assert_eq!(collection.games.len(), 1);
            assert_eq!(collection.games[0].pgn, legal);
            assert_eq!(collection.games[0].source, "Plain and valid");
        }
    }

    #[test]
    fn deterministic_rebuild_ignores_candidate_arrival_order() {
        let plain = "[Event \"Test\"]\n[Date \"2026.08.20\"]\n[White \"Player\"]\n[Black \"Opponent\"]\n[Result \"1-0\"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 1-0\n";
        let rich = plain.replace("1. e4", "1. e4 {[%clk 1:59:58]}");
        let inputs = [
            (plain.to_string(), "Archive"),
            (rich.clone(), "Broadcast"),
            (plain.to_string(), "Mirror"),
        ];
        let rebuild = |reverse: bool| {
            let mut collection = Collection::capturing();
            let order = if reverse {
                inputs.iter().rev().collect::<Vec<_>>()
            } else {
                inputs.iter().collect::<Vec<_>>()
            };
            for (pgn, source) in order {
                add_game(&mut collection, pgn.clone(), source, "White");
            }
            collection.into_deterministic()
        };

        let forward = rebuild(false);
        let reverse = rebuild(true);
        assert_eq!(forward.games.len(), 1);
        assert_eq!(forward.games[0].pgn, rich);
        assert_eq!(forward.games[0].pgn, reverse.games[0].pgn);
        assert_eq!(forward.duplicates_removed, reverse.duplicates_removed);
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
