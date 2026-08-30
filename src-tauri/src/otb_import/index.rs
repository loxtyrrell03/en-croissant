use std::{
    collections::{HashMap, HashSet},
    io::{BufRead, BufReader, Cursor, Read},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OpenFlags, OptionalExtension, Statement, Transaction};
use tokio::sync::Notify;

use super::{
    add_provenance_headers, canonicalize_target_name, date_before_year, header,
    is_suspected_online_game, match_player_side, name_matches_without_identity,
    normalized_fide_header, normalized_name, parse_headers, read_next_game, PendingGame,
    PgnStreamState, PlayerIdentity, ScanOutcome,
};

const INDEX_FILE_NAME: &str = "otb-archive-index-v2.sqlite3";
const INDEX_SCHEMA_VERSION: i64 = 2;
/// Every query uses connection-local temporary lookup tables and `open_index`
/// also verifies the schema. Letting all source lanes do that concurrently can
/// put nominally read-only searches behind SQLite's 60-second busy timeout.
/// The actual indexed lookups are short, so one process-local gate is faster
/// and deterministic while archive decompression still happens in parallel.
static INDEX_CONNECTION_GATE: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct MatchingIdentitySignature {
    canonical_name: String,
    fide_id: Option<String>,
    surname_tokens: Vec<String>,
    name_tokens: Vec<String>,
}

impl MatchingIdentitySignature {
    fn new(identity: &PlayerIdentity) -> Self {
        Self {
            canonical_name: normalized_name(&identity.canonical_name),
            fide_id: identity.fide_id.clone(),
            surname_tokens: identity.surname_tokens.clone(),
            name_tokens: identity.name_tokens.clone(),
        }
    }
}

type MatchingNameCache = HashMap<(PathBuf, MatchingIdentitySignature, i64), Arc<Vec<i64>>>;
static MATCHING_NAME_CACHE: OnceLock<Mutex<MatchingNameCache>> = OnceLock::new();
static INDEX_WORKERS: OnceLock<Mutex<HashMap<String, Arc<IndexWorkerState>>>> = OnceLock::new();

#[derive(Clone)]
pub(super) struct IndexRun {
    job_id: String,
    cancelled: Arc<AtomicBool>,
    #[cfg(test)]
    before_store: Option<Arc<TestStoreBarrier>>,
}

impl IndexRun {
    pub(super) fn new(job_id: impl Into<String>, cancelled: Arc<AtomicBool>) -> Self {
        Self {
            job_id: job_id.into(),
            cancelled,
            #[cfg(test)]
            before_store: None,
        }
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    fn check_cancelled(&self) -> Result<(), String> {
        if self.is_cancelled() {
            Err("OTB archive indexing was cancelled".to_string())
        } else {
            Ok(())
        }
    }

    #[cfg(test)]
    fn with_store_barrier(mut self, barrier: Arc<TestStoreBarrier>) -> Self {
        self.before_store = Some(barrier);
        self
    }

    #[cfg(test)]
    fn wait_before_store(&self) {
        if let Some(barrier) = &self.before_store {
            barrier.reached.wait();
            barrier.release.wait();
        }
    }
}

#[derive(Default)]
struct IndexWorkerState {
    active: AtomicUsize,
    idle: Notify,
}

struct IndexWorkerGuard {
    state: Arc<IndexWorkerState>,
}

impl Drop for IndexWorkerGuard {
    fn drop(&mut self) {
        if self.state.active.fetch_sub(1, Ordering::AcqRel) == 1 {
            self.state.idle.notify_waiters();
        }
    }
}

fn index_workers() -> &'static Mutex<HashMap<String, Arc<IndexWorkerState>>> {
    INDEX_WORKERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_index_workers() -> std::sync::MutexGuard<'static, HashMap<String, Arc<IndexWorkerState>>> {
    index_workers()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn register_index_worker(job_id: &str) -> IndexWorkerGuard {
    let state = lock_index_workers()
        .entry(job_id.to_string())
        .or_default()
        .clone();
    state.active.fetch_add(1, Ordering::AcqRel);
    IndexWorkerGuard { state }
}

fn spawn_tracked_blocking<T, F>(run: IndexRun, work: F) -> tokio::task::JoinHandle<T>
where
    T: Send + 'static,
    F: FnOnce(IndexRun) -> T + Send + 'static,
{
    let worker = register_index_worker(&run.job_id);
    tokio::task::spawn_blocking(move || {
        let _worker = worker;
        work(run)
    })
}

async fn wait_until_idle(state: &IndexWorkerState) {
    loop {
        let notified = state.idle.notified();
        if state.active.load(Ordering::Acquire) == 0 {
            return;
        }
        notified.await;
    }
}

/// Drains blocking index work that survived cancellation of its async lane.
/// `spawn_blocking` cannot be aborted once running, so every worker owns a guard
/// and cooperatively observes the same per-import cancellation flag.
pub(super) async fn wait_for_workers(job_id: &str) {
    let state = lock_index_workers().get(job_id).cloned();
    let Some(state) = state else {
        return;
    };
    wait_until_idle(&state).await;
    let mut workers = lock_index_workers();
    if workers
        .get(job_id)
        .is_some_and(|current| Arc::ptr_eq(current, &state))
        && state.active.load(Ordering::Acquire) == 0
    {
        workers.remove(job_id);
    }
}

#[cfg(test)]
struct TestStoreBarrier {
    reached: std::sync::Barrier,
    release: std::sync::Barrier,
}

#[cfg(test)]
impl TestStoreBarrier {
    fn new() -> Self {
        Self {
            reached: std::sync::Barrier::new(2),
            release: std::sync::Barrier::new(2),
        }
    }
}

fn lock_index_connection() -> std::sync::MutexGuard<'static, ()> {
    INDEX_CONNECTION_GATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Clone, Copy, Debug)]
pub(super) enum ArchiveFormat {
    Pgn,
    Zip,
    Zstd,
}

pub(super) struct IndexAndScanResult {
    pub outcome: ScanOutcome,
    pub indexed_games: usize,
    pub index_error: Option<String>,
}

impl IndexAndScanResult {
    fn cancelled() -> Self {
        Self {
            outcome: ScanOutcome::default(),
            indexed_games: 0,
            index_error: None,
        }
    }
}

#[derive(Debug)]
struct IndexedGame {
    ordinal: i64,
    pgn: String,
    white_normalized: String,
    black_normalized: String,
    white_fide_id: Option<String>,
    black_fide_id: Option<String>,
}

#[derive(Debug, Default)]
struct ParsedArchive {
    games: Vec<IndexedGame>,
    error: Option<String>,
    cancelled: bool,
}

pub(super) fn archive_index_path(cache_dir: &Path) -> PathBuf {
    cache_dir.join(INDEX_FILE_NAME)
}

pub(super) async fn initialize(index_path: &Path) -> Result<(), String> {
    let index_path = index_path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let _gate = lock_index_connection();
        open_index(&index_path).map(|_| ())
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(super) async fn checkpoint(index_path: &Path, truncate: bool) -> Result<(), String> {
    let index_path = index_path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let _gate = lock_index_connection();
        if !index_path.exists() {
            return Ok(());
        }
        let connection = Connection::open_with_flags(
            &index_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|error| error.to_string())?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| error.to_string())?;
        connection
            .execute_batch(if truncate {
                "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA optimize;"
            } else {
                "PRAGMA wal_checkpoint(PASSIVE);"
            })
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(super) async fn indexed_urls(
    index_path: &Path,
    urls: &[String],
    max_age: Option<Duration>,
    run: IndexRun,
) -> Result<HashSet<String>, String> {
    if urls.is_empty() {
        return Ok(HashSet::new());
    }
    let index_path = index_path.to_path_buf();
    let urls = urls.to_vec();
    spawn_tracked_blocking(run, move |run| {
        run.check_cancelled()?;
        let mut connection = open_query_index(&index_path)?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        populate_selected_archives(&transaction, &urls)?;
        let minimum_indexed_at = max_age
            .map(|age| unix_timestamp().saturating_sub(age.as_secs().min(i64::MAX as u64) as i64))
            .unwrap_or(i64::MIN);
        let mut statement = transaction
            .prepare(
                "SELECT archive_url
                 FROM archive_state
                 WHERE complete = 1
                   AND indexed_at >= ?1
                   AND archive_url IN (SELECT archive_url FROM selected_archives)",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![minimum_indexed_at], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        let mut indexed = HashSet::new();
        for row in rows {
            run.check_cancelled()?;
            indexed.insert(row.map_err(|error| error.to_string())?);
        }
        run.check_cancelled()?;
        Ok(indexed)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(super) async fn index_and_scan(
    index_path: &Path,
    archive_url: String,
    bytes: Vec<u8>,
    format: ArchiveFormat,
    identity: Arc<PlayerIdentity>,
    source: &'static str,
    from_year: u16,
    run: IndexRun,
) -> IndexAndScanResult {
    let index_path = index_path.to_path_buf();
    spawn_tracked_blocking(run, move |run| {
        let parsed = parse_archive(bytes, format, &run);
        if parsed.cancelled || run.is_cancelled() {
            return IndexAndScanResult::cancelled();
        }
        let outcome =
            scan_parsed_archive(&parsed, &identity, source, &archive_url, from_year, &run);
        if run.is_cancelled() {
            return IndexAndScanResult::cancelled();
        }
        let indexed_games = parsed.games.len();
        let index_error = store_archive(&index_path, &archive_url, &parsed, &run).err();
        IndexAndScanResult {
            outcome,
            indexed_games,
            index_error,
        }
    })
    .await
    .unwrap_or_else(|error| IndexAndScanResult {
        outcome: ScanOutcome::failed(error.to_string()),
        indexed_games: 0,
        index_error: Some(error.to_string()),
    })
}

pub(super) async fn query_indexed(
    index_path: &Path,
    archive_urls: &[String],
    identity: Arc<PlayerIdentity>,
    source: &'static str,
    from_year: u16,
    run: IndexRun,
) -> Result<HashMap<String, ScanOutcome>, String> {
    if archive_urls.is_empty() {
        return Ok(HashMap::new());
    }
    let index_path = index_path.to_path_buf();
    let archive_urls = archive_urls.to_vec();
    spawn_tracked_blocking(run, move |run| {
        run.check_cancelled()?;
        let mut connection = open_query_index(&index_path)?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        populate_selected_archives(&transaction, &archive_urls)?;
        populate_matching_names(&transaction, &index_path, &identity)?;

        let target_fide_id = identity.fide_id.as_deref().unwrap_or_default();
        let mut statement = transaction
            .prepare(
                "SELECT archive_url, pgn_zstd, pgn_size
                 FROM (
                   SELECT archive.archive_url, game.ordinal, game.pgn_zstd, game.pgn_size
                   FROM indexed_game AS game INDEXED BY indexed_game_white_fide
                   JOIN archive_state AS archive ON archive.id = game.archive_id
                   JOIN selected_archives AS selected ON selected.archive_url = archive.archive_url
                   WHERE ?1 <> '' AND game.white_fide_id = ?1
                   UNION
                   SELECT archive.archive_url, game.ordinal, game.pgn_zstd, game.pgn_size
                   FROM indexed_game AS game INDEXED BY indexed_game_black_fide
                   JOIN archive_state AS archive ON archive.id = game.archive_id
                   JOIN selected_archives AS selected ON selected.archive_url = archive.archive_url
                   WHERE ?1 <> '' AND game.black_fide_id = ?1
                   UNION
                   SELECT archive.archive_url, game.ordinal, game.pgn_zstd, game.pgn_size
                   FROM matching_names AS matched
                   CROSS JOIN indexed_game AS game INDEXED BY indexed_game_white_name
                   CROSS JOIN archive_state AS archive
                   CROSS JOIN selected_archives AS selected
                   WHERE game.white_name_id = matched.name_id
                     AND archive.id = game.archive_id
                     AND selected.archive_url = archive.archive_url
                   UNION
                   SELECT archive.archive_url, game.ordinal, game.pgn_zstd, game.pgn_size
                   FROM matching_names AS matched
                   CROSS JOIN indexed_game AS game INDEXED BY indexed_game_black_name
                   CROSS JOIN archive_state AS archive
                   CROSS JOIN selected_archives AS selected
                   WHERE game.black_name_id = matched.name_id
                     AND archive.id = game.archive_id
                     AND selected.archive_url = archive.archive_url
                 ) AS matches
                 ORDER BY archive_url, ordinal",
            )
            .map_err(|error| error.to_string())?;
        let mut rows = statement
            .query(params![target_fide_id])
            .map_err(|error| error.to_string())?;
        let mut outcomes = archive_urls
            .iter()
            .cloned()
            .map(|url| (url, ScanOutcome::default()))
            .collect::<HashMap<_, _>>();
        while let Some(row) = rows.next().map_err(|error| error.to_string())? {
            run.check_cancelled()?;
            let archive_url = row.get::<_, String>(0).map_err(|error| error.to_string())?;
            let pgn_zstd = row
                .get::<_, Vec<u8>>(1)
                .map_err(|error| error.to_string())?;
            let pgn_size = row.get::<_, i64>(2).map_err(|error| error.to_string())?;
            let pgn_bytes = zstd::bulk::decompress(&pgn_zstd, pgn_size.max(0) as usize)
                .map_err(|error| error.to_string())?;
            let pgn = String::from_utf8(pgn_bytes).map_err(|error| error.to_string())?;
            if let Some(outcome) = outcomes.get_mut(&archive_url) {
                filter_game(&pgn, &identity, source, &archive_url, from_year, outcome);
            }
        }
        run.check_cancelled()?;
        Ok(outcomes)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn open_index(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .busy_timeout(Duration::from_secs(60))
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "synchronous", "NORMAL")
        .map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS index_meta (
                 key TEXT PRIMARY KEY,
                 value INTEGER NOT NULL
             ) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS archive_state (
                 id INTEGER PRIMARY KEY,
                 archive_url TEXT NOT NULL UNIQUE,
                 indexed_at INTEGER NOT NULL,
                 complete INTEGER NOT NULL,
                 game_count INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS player_name (
                 id INTEGER PRIMARY KEY,
                 normalized_name TEXT NOT NULL UNIQUE
             );
             CREATE TABLE IF NOT EXISTS indexed_game (
                 archive_id INTEGER NOT NULL,
                 ordinal INTEGER NOT NULL,
                 pgn_zstd BLOB NOT NULL,
                 pgn_size INTEGER NOT NULL,
                 white_name_id INTEGER,
                 black_name_id INTEGER,
                 white_fide_id TEXT,
                 black_fide_id TEXT,
                 PRIMARY KEY (archive_id, ordinal),
                 FOREIGN KEY (archive_id) REFERENCES archive_state(id) ON DELETE CASCADE,
                 FOREIGN KEY (white_name_id) REFERENCES player_name(id),
                 FOREIGN KEY (black_name_id) REFERENCES player_name(id)
             ) WITHOUT ROWID;
             CREATE INDEX IF NOT EXISTS indexed_game_white_name
                 ON indexed_game(white_name_id, archive_id);
             CREATE INDEX IF NOT EXISTS indexed_game_black_name
                 ON indexed_game(black_name_id, archive_id);
             CREATE INDEX IF NOT EXISTS indexed_game_white_fide
                 ON indexed_game(white_fide_id, archive_id)
                 WHERE white_fide_id IS NOT NULL;
             CREATE INDEX IF NOT EXISTS indexed_game_black_fide
                 ON indexed_game(black_fide_id, archive_id)
                 WHERE black_fide_id IS NOT NULL;
             INSERT OR IGNORE INTO index_meta(key, value) VALUES ('schema_version', 2);",
        )
        .map_err(|error| error.to_string())?;
    let schema_version = connection
        .query_row(
            "SELECT value FROM index_meta WHERE key = 'schema_version'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or_default();
    if schema_version != INDEX_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported OTB archive index schema {schema_version}; expected {INDEX_SCHEMA_VERSION}."
        ));
    }
    Ok(connection)
}

fn open_query_index(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| error.to_string())?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

fn populate_selected_archives(
    transaction: &Transaction<'_>,
    urls: &[String],
) -> Result<(), String> {
    transaction
        .execute_batch(
            "DROP TABLE IF EXISTS temp.selected_archives;
             CREATE TEMP TABLE selected_archives (
                 archive_url TEXT PRIMARY KEY
             ) WITHOUT ROWID;",
        )
        .map_err(|error| error.to_string())?;
    let mut statement = transaction
        .prepare("INSERT OR IGNORE INTO selected_archives(archive_url) VALUES (?1)")
        .map_err(|error| error.to_string())?;
    for url in urls {
        statement
            .execute(params![url])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn populate_matching_names(
    transaction: &Transaction<'_>,
    index_path: &Path,
    identity: &PlayerIdentity,
) -> Result<(), String> {
    transaction
        .execute_batch(
            "DROP TABLE IF EXISTS temp.matching_names;
             CREATE TEMP TABLE matching_names (
                 name_id INTEGER PRIMARY KEY
             ) WITHOUT ROWID;",
        )
        .map_err(|error| error.to_string())?;
    let maximum_name_id = transaction
        .query_row("SELECT COALESCE(MAX(id), 0) FROM player_name", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| error.to_string())?;
    let cache_key = (
        index_path.to_path_buf(),
        MatchingIdentitySignature::new(identity),
        maximum_name_id,
    );
    let cache = MATCHING_NAME_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    // Every source lane asks the same question at roughly the same time. Keep
    // the cache lock through the first lookup so ten lanes do not each scan the
    // multi-million-row name table and thrash the same database pages.
    let matching = {
        let mut cache = cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match cache.get(&cache_key).cloned() {
            Some(matching) => matching,
            None => {
                let patterns = matching_name_patterns(identity);
                let predicates = std::iter::repeat_n("normalized_name LIKE ?", patterns.len())
                    .collect::<Vec<_>>()
                    .join(" OR ");
                let mut read = transaction
                    .prepare(&format!(
                        "SELECT id, normalized_name FROM player_name WHERE {predicates}"
                    ))
                    .map_err(|error| error.to_string())?;
                let rows = read
                    .query_map(rusqlite::params_from_iter(patterns.iter()), |row| {
                        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                    })
                    .map_err(|error| error.to_string())?;
                let matching = Arc::new(
                    rows.filter_map(Result::ok)
                        .filter(|(_, candidate)| identity.name_matches(candidate))
                        .map(|(id, _)| id)
                        .collect::<Vec<_>>(),
                );
                drop(read);
                if cache.len() >= 32 {
                    cache.clear();
                }
                cache.insert(cache_key, Arc::clone(&matching));
                matching
            }
        }
    };
    let mut write = transaction
        .prepare("INSERT OR IGNORE INTO matching_names(name_id) VALUES (?1)")
        .map_err(|error| error.to_string())?;
    for name_id in matching.iter() {
        write
            .execute(params![name_id])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn matching_name_patterns(identity: &PlayerIdentity) -> Vec<String> {
    let mut patterns = HashSet::new();
    for surname in &identity.surname_tokens {
        let characters = surname.chars().collect::<Vec<_>>();
        if identity.fide_id.is_some() && characters.len() >= 5 {
            let split = characters.len() / 2;
            let prefix = characters[..split].iter().collect::<String>();
            let suffix = characters[split..].iter().collect::<String>();
            patterns.insert(format!("%{prefix}%"));
            patterns.insert(format!("%{suffix}%"));
        } else {
            patterns.insert(format!("%{surname}%"));
        }
    }
    let mut patterns = patterns.into_iter().collect::<Vec<_>>();
    patterns.sort();
    patterns
}

fn store_archive(
    path: &Path,
    archive_url: &str,
    parsed: &ParsedArchive,
    run: &IndexRun,
) -> Result<(), String> {
    let mut encoded_games = Vec::with_capacity(parsed.games.len());
    for game in &parsed.games {
        run.check_cancelled()?;
        let compressed =
            zstd::bulk::compress(game.pgn.as_bytes(), 1).map_err(|error| error.to_string())?;
        encoded_games.push((game, compressed));
    }
    #[cfg(test)]
    run.wait_before_store();
    // Acquiring the process-wide writer gate can itself take time. Recheck on
    // both sides so a cancelled import never starts a queued transaction.
    run.check_cancelled()?;
    let _gate = lock_index_connection();
    run.check_cancelled()?;
    let mut connection = open_index(path)?;
    run.check_cancelled()?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO archive_state(archive_url, indexed_at, complete, game_count)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(archive_url) DO UPDATE SET
                 indexed_at = excluded.indexed_at,
                 complete = excluded.complete,
                 game_count = excluded.game_count",
            params![
                archive_url,
                unix_timestamp(),
                i64::from(parsed.error.is_none()),
                parsed.games.len().min(i64::MAX as usize) as i64,
            ],
        )
        .map_err(|error| error.to_string())?;
    let archive_id = transaction
        .query_row(
            "SELECT id FROM archive_state WHERE archive_url = ?1",
            params![archive_url],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM indexed_game WHERE archive_id = ?1",
            params![archive_id],
        )
        .map_err(|error| error.to_string())?;

    {
        let mut insert_name = transaction
            .prepare("INSERT OR IGNORE INTO player_name(normalized_name) VALUES (?1)")
            .map_err(|error| error.to_string())?;
        let mut select_name = transaction
            .prepare("SELECT id FROM player_name WHERE normalized_name = ?1")
            .map_err(|error| error.to_string())?;
        let mut insert_game = transaction
            .prepare(
                "INSERT INTO indexed_game(
                     archive_id, ordinal, pgn_zstd, pgn_size, white_name_id, black_name_id,
                     white_fide_id, black_fide_id
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )
            .map_err(|error| error.to_string())?;
        let mut name_ids = HashMap::new();
        for (game, compressed) in encoded_games {
            run.check_cancelled()?;
            let white_name_id = resolve_name_id(
                &mut insert_name,
                &mut select_name,
                &mut name_ids,
                &game.white_normalized,
            )?;
            let black_name_id = resolve_name_id(
                &mut insert_name,
                &mut select_name,
                &mut name_ids,
                &game.black_normalized,
            )?;
            insert_game
                .execute(params![
                    archive_id,
                    game.ordinal,
                    compressed,
                    game.pgn.len().min(i64::MAX as usize) as i64,
                    white_name_id,
                    black_name_id,
                    game.white_fide_id,
                    game.black_fide_id,
                ])
                .map_err(|error| error.to_string())?;
        }
    }
    run.check_cancelled()?;
    transaction.commit().map_err(|error| error.to_string())
}

fn resolve_name_id(
    insert: &mut Statement<'_>,
    select: &mut Statement<'_>,
    cache: &mut HashMap<String, i64>,
    normalized: &str,
) -> Result<Option<i64>, String> {
    if normalized.is_empty() {
        return Ok(None);
    }
    if let Some(id) = cache.get(normalized) {
        return Ok(Some(*id));
    }
    insert
        .execute(params![normalized])
        .map_err(|error| error.to_string())?;
    let id = select
        .query_row(params![normalized], |row| row.get::<_, i64>(0))
        .map_err(|error| error.to_string())?;
    cache.insert(normalized.to_string(), id);
    Ok(Some(id))
}

fn parse_archive(bytes: Vec<u8>, format: ArchiveFormat, run: &IndexRun) -> ParsedArchive {
    if run.is_cancelled() {
        return ParsedArchive {
            cancelled: true,
            ..ParsedArchive::default()
        };
    }
    match format {
        ArchiveFormat::Pgn => parse_reader(BufReader::new(Cursor::new(bytes)), 0, run),
        ArchiveFormat::Zstd => match zstd::stream::read::Decoder::new(Cursor::new(bytes)) {
            Ok(decoder) => parse_reader(BufReader::new(decoder), 0, run),
            Err(error) => ParsedArchive {
                error: Some(error.to_string()),
                ..ParsedArchive::default()
            },
        },
        ArchiveFormat::Zip => parse_zip(bytes, run),
    }
}

fn parse_zip(bytes: Vec<u8>, run: &IndexRun) -> ParsedArchive {
    let mut archive = match zip::ZipArchive::new(Cursor::new(bytes)) {
        Ok(archive) => archive,
        Err(error) => {
            return ParsedArchive {
                error: Some(error.to_string()),
                ..ParsedArchive::default()
            };
        }
    };
    let mut parsed = ParsedArchive::default();
    for index in 0..archive.len() {
        if run.is_cancelled() {
            parsed.cancelled = true;
            break;
        }
        let mut file = match archive.by_index(index) {
            Ok(file) => file,
            Err(error) => {
                parsed.error = Some(error.to_string());
                break;
            }
        };
        if !file.name().to_ascii_lowercase().ends_with(".pgn") {
            continue;
        }
        let mut entry = Vec::new();
        if let Err(error) = file.read_to_end(&mut entry) {
            parsed.error = Some(error.to_string());
            break;
        }
        let next_ordinal = parsed.games.len() as i64;
        let next = parse_reader(BufReader::new(Cursor::new(entry)), next_ordinal, run);
        parsed.games.extend(next.games);
        if next.cancelled {
            parsed.cancelled = true;
            break;
        }
        if next.error.is_some() {
            parsed.error = next.error;
            break;
        }
    }
    parsed
}

fn parse_reader<R: BufRead>(mut reader: R, first_ordinal: i64, run: &IndexRun) -> ParsedArchive {
    let mut state = PgnStreamState::new();
    let mut parsed = ParsedArchive::default();
    loop {
        if run.is_cancelled() {
            parsed.cancelled = true;
            break;
        }
        let game = match read_next_game(&mut reader, &mut state) {
            Ok(game) => game,
            Err(error) => {
                parsed.error = Some(error.to_string());
                break;
            }
        };
        let Some(pgn) = game else {
            break;
        };
        let headers = parse_headers(&pgn);
        let white_name = header(&headers, "White").unwrap_or_default().to_string();
        let black_name = header(&headers, "Black").unwrap_or_default().to_string();
        parsed.games.push(IndexedGame {
            ordinal: first_ordinal.saturating_add(parsed.games.len() as i64),
            white_normalized: normalized_name(&white_name),
            black_normalized: normalized_name(&black_name),
            white_fide_id: normalized_fide_header(header(&headers, "WhiteFideId")),
            black_fide_id: normalized_fide_header(header(&headers, "BlackFideId")),
            pgn,
        });
    }
    parsed
}

fn scan_parsed_archive(
    parsed: &ParsedArchive,
    identity: &PlayerIdentity,
    source: &str,
    archive_url: &str,
    from_year: u16,
    run: &IndexRun,
) -> ScanOutcome {
    let mut outcome = ScanOutcome::default();
    for game in &parsed.games {
        if run.is_cancelled() {
            return ScanOutcome::default();
        }
        filter_game(
            &game.pgn,
            identity,
            source,
            archive_url,
            from_year,
            &mut outcome,
        );
    }
    outcome.error = parsed.error.clone();
    outcome
}

fn filter_game(
    game: &str,
    identity: &PlayerIdentity,
    source: &str,
    archive_url: &str,
    from_year: u16,
    outcome: &mut ScanOutcome,
) {
    let headers = parse_headers(game);
    let Some(side) = match_player_side(&headers, identity) else {
        if name_matches_without_identity(&headers, identity) {
            outcome.identity_mismatches_excluded =
                outcome.identity_mismatches_excluded.saturating_add(1);
        }
        return;
    };
    outcome.matched = outcome.matched.saturating_add(1);
    if is_suspected_online_game(&headers) {
        outcome.suspected_online_games_excluded =
            outcome.suspected_online_games_excluded.saturating_add(1);
        return;
    }
    if header(&headers, "Date").is_some_and(|date| date_before_year(date, from_year)) {
        return;
    }
    let canonical = canonicalize_target_name(game, side, &identity.canonical_name);
    outcome.games.push(PendingGame {
        pgn: add_provenance_headers(&canonical, source, archive_url),
        side: side.to_string(),
    });
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .min(i64::MAX as u64) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_run(job_id: &str) -> IndexRun {
        IndexRun::new(job_id, Arc::new(AtomicBool::new(false)))
    }

    fn sample_pgn() -> String {
        r#"[Event "OTB Test"]
[Site "London"]
[Date "2026.08.20"]
[Round "1"]
[White "Tyrrell, Lachlan"]
[Black "Opponent, One"]
[WhiteFideId "6003788"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0

[Event "Online"]
[Site "https://lichess.org/abc"]
[Date "2026.08.21"]
[Round "1"]
[White "Opponent, Two"]
[Black "Tyrrell, Lachlan"]
[BlackFideId "6003788"]
[Result "0-1"]

1. d4 d5 2. c4 e6 0-1
"#
        .to_string()
    }

    #[tokio::test]
    async fn indexed_query_preserves_identity_and_online_filters() {
        let temp = tempfile::tempdir().unwrap();
        let path = archive_index_path(temp.path());
        initialize(&path).await.unwrap();
        let identity =
            Arc::new(PlayerIdentity::new("Tyrrell, Lachlan Baly Hughes", Some("6003788")).unwrap());
        let run = test_run("indexed-query-filter-test");
        let indexed = index_and_scan(
            &path,
            "https://example.test/games.pgn".to_string(),
            sample_pgn().into_bytes(),
            ArchiveFormat::Pgn,
            Arc::clone(&identity),
            "Fixture",
            1900,
            run.clone(),
        )
        .await;
        assert_eq!(indexed.indexed_games, 2);
        assert_eq!(indexed.outcome.matched, 2);
        assert_eq!(indexed.outcome.suspected_online_games_excluded, 1);
        assert_eq!(indexed.outcome.games.len(), 1);

        let queried = query_indexed(
            &path,
            &["https://example.test/games.pgn".to_string()],
            identity,
            "Fixture",
            1900,
            run,
        )
        .await
        .unwrap();
        let outcome = queried.get("https://example.test/games.pgn").unwrap();
        assert_eq!(outcome.matched, indexed.outcome.matched);
        assert_eq!(
            outcome.suspected_online_games_excluded,
            indexed.outcome.suspected_online_games_excluded
        );
        assert_eq!(outcome.games.len(), indexed.outcome.games.len());
        assert_eq!(outcome.games[0].pgn, indexed.outcome.games[0].pgn);
    }

    #[tokio::test]
    async fn name_only_cache_cannot_hide_fuzzy_matches_from_fide_pinned_query() {
        let temp = tempfile::tempdir().unwrap();
        let path = archive_index_path(temp.path());
        initialize(&path).await.unwrap();
        let archive_url = "https://example.test/typo-name.pgn".to_string();
        let pgn = r#"[Event "OTB Typo Test"]
[Site "London"]
[Date "2026.08.22"]
[Round "1"]
[White "Tyrell, Lachlan"]
[Black "Opponent, One"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0
"#;
        let pinned_identity =
            Arc::new(PlayerIdentity::new("Tyrrell, Lachlan", Some("6003788")).unwrap());
        let run = test_run("identity-cache-index-test");
        let indexed = index_and_scan(
            &path,
            archive_url.clone(),
            pgn.as_bytes().to_vec(),
            ArchiveFormat::Pgn,
            Arc::clone(&pinned_identity),
            "Fixture",
            1900,
            run.clone(),
        )
        .await;
        assert_eq!(indexed.indexed_games, 1);
        assert_eq!(indexed.outcome.games.len(), 1);

        let archive_urls = vec![archive_url.clone()];
        let name_only = query_indexed(
            &path,
            &archive_urls,
            Arc::new(PlayerIdentity::new("Tyrrell, Lachlan", None).unwrap()),
            "Fixture",
            1900,
            run.clone(),
        )
        .await
        .unwrap();
        assert!(name_only[&archive_url].games.is_empty());

        let pinned = query_indexed(&path, &archive_urls, pinned_identity, "Fixture", 1900, run)
            .await
            .unwrap();
        assert_eq!(pinned[&archive_url].games.len(), 1);
        assert!(pinned[&archive_url].games[0]
            .pgn
            .contains("[White \"Tyrrell, Lachlan\"]"));
    }

    #[tokio::test]
    async fn only_complete_fresh_archives_are_reused() {
        let temp = tempfile::tempdir().unwrap();
        let path = archive_index_path(temp.path());
        let identity = Arc::new(PlayerIdentity::new("Tyrrell, Lachlan", Some("6003788")).unwrap());
        let run = test_run("fresh-archive-test");
        index_and_scan(
            &path,
            "https://example.test/games.pgn".to_string(),
            sample_pgn().into_bytes(),
            ArchiveFormat::Pgn,
            identity,
            "Fixture",
            1900,
            run.clone(),
        )
        .await;
        let urls = vec!["https://example.test/games.pgn".to_string()];
        assert_eq!(
            indexed_urls(&path, &urls, None, run.clone())
                .await
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            indexed_urls(&path, &urls, Some(Duration::from_secs(0)), run.clone(),)
                .await
                .unwrap()
                .len(),
            1
        );
        wait_for_workers(&run.job_id).await;
    }

    #[tokio::test]
    async fn cancelled_detached_writer_is_drained_without_committing() {
        let temp = tempfile::tempdir().unwrap();
        let path = archive_index_path(temp.path());
        initialize(&path).await.unwrap();
        let identity = Arc::new(PlayerIdentity::new("Tyrrell, Lachlan", Some("6003788")).unwrap());
        let cancellation = Arc::new(AtomicBool::new(false));
        let barrier = Arc::new(TestStoreBarrier::new());
        let run = IndexRun::new("detached-cancel-test", Arc::clone(&cancellation))
            .with_store_barrier(Arc::clone(&barrier));
        let worker_path = path.clone();
        let worker_run = run.clone();
        let task = tokio::spawn(async move {
            index_and_scan(
                &worker_path,
                "https://example.test/cancelled.pgn".to_string(),
                sample_pgn().into_bytes(),
                ArchiveFormat::Pgn,
                identity,
                "Fixture",
                1900,
                worker_run,
            )
            .await
        });

        let reached = Arc::clone(&barrier);
        tokio::task::spawn_blocking(move || reached.reached.wait())
            .await
            .unwrap();
        task.abort();
        match task.await {
            Err(error) => assert!(error.is_cancelled()),
            Ok(_) => panic!("the async owner should have been aborted"),
        }
        cancellation.store(true, Ordering::Release);

        let job_id = run.job_id.clone();
        let drain = tokio::spawn(async move { wait_for_workers(&job_id).await });
        tokio::task::yield_now().await;
        assert!(
            !drain.is_finished(),
            "the drain must wait for a detached blocking worker"
        );

        let release = Arc::clone(&barrier);
        tokio::task::spawn_blocking(move || release.release.wait())
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(2), drain)
            .await
            .expect("detached writer drained")
            .expect("drain task completed");

        let inspect_run = test_run("detached-cancel-inspection");
        let urls = vec!["https://example.test/cancelled.pgn".to_string()];
        assert!(
            indexed_urls(&path, &urls, None, inspect_run.clone())
                .await
                .unwrap()
                .is_empty(),
            "a cancellation observed before the transaction must not mark the archive complete"
        );
        wait_for_workers(&inspect_run.job_id).await;
    }
}
