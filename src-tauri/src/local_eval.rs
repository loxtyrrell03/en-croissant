use std::{
    cmp::Ordering,
    collections::{HashMap, VecDeque},
    fs::{self, File, OpenOptions},
    io::{self, BufRead, BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering as AtomicOrdering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::Manager;
use tauri_specta::Event;

const FORMAT_VERSION: u16 = 2;
const ROOT_ONLY_FORMAT_VERSION: u16 = 1;
const DEFAULT_SHARD_COUNT: u16 = 2048;
const DEFAULT_MAX_PVS: u8 = 5;
const MAX_STORED_PVS: usize = 5;
const ROOT_ONLY_RECORD_SIZE: usize = 54;
const VARIABLE_RECORD_SIZE: usize = 0;
const V2_SHARD_MAGIC: &[u8; 4] = b"LEI2";
const SHARD_BUFFER_FLUSH_BYTES: usize = 256 * 1024;
const SHARD_CACHE_MAX_BYTES: usize = 256 * 1024 * 1024;
const MANIFEST_FILE: &str = "manifest.json";
const SHARDS_DIR: &str = "shards";
const SPOOL_DIR: &str = "spool";
const DEFAULT_SOURCE_URL: &str = "https://database.lichess.org/lichess_db_eval.jsonl.zst";

#[derive(Debug, thiserror::Error)]
pub enum LocalEvalError {
    #[error(transparent)]
    Io(#[from] io::Error),

    #[error(transparent)]
    Json(#[from] serde_json::Error),

    #[error(transparent)]
    Reqwest(#[from] reqwest::Error),

    #[error(transparent)]
    Tauri(#[from] tauri::Error),

    #[error("invalid Lichess eval build option: {0}")]
    InvalidOption(String),

    #[error("invalid local Lichess eval database: {0}")]
    InvalidDatabase(String),

    #[error("background build task failed: {0}")]
    Join(String),
}

impl From<LocalEvalError> for String {
    fn from(value: LocalEvalError) -> Self {
        value.to_string()
    }
}

#[derive(Debug, Clone)]
pub enum LocalEvalSource {
    File(PathBuf),
    Url(String),
}

impl LocalEvalSource {
    pub fn label(&self) -> String {
        match self {
            LocalEvalSource::File(path) => path.display().to_string(),
            LocalEvalSource::Url(url) => url.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct LocalEvalBuildOptions {
    pub id: String,
    pub source: LocalEvalSource,
    pub output_dir: PathBuf,
    pub max_pvs: u8,
    pub shard_count: u16,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalEvalBuildRequest {
    pub id: Option<String>,
    pub source: Option<String>,
    pub source_url: Option<String>,
    pub output_dir: Option<String>,
    pub max_pvs: Option<u8>,
    pub shard_count: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct LocalEvalBuildProgress {
    pub id: String,
    pub phase: String,
    pub progress: f32,
    pub positions: u64,
    pub skipped: u64,
    pub compressed_bytes_read: u64,
    pub compressed_bytes_total: Option<u64>,
    pub finished: bool,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalEvalBuildReport {
    pub output_dir: String,
    pub source: String,
    pub positions: u64,
    pub skipped: u64,
    pub shard_count: u16,
    pub max_pvs: u8,
    pub storage_bytes: u64,
    pub built_at: u64,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalLichessCloudEval {
    pub fen: String,
    pub knodes: u32,
    pub depth: u16,
    pub pvs: Vec<LocalLichessCloudPv>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalLichessCloudPv {
    pub moves: String,
    #[specta(optional)]
    pub cp: Option<i32>,
    #[specta(optional)]
    pub mate: Option<i16>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalEvalDbStatus {
    pub available: bool,
    pub path: String,
    pub positions: u64,
    pub shard_count: u16,
    pub max_pvs: u8,
    pub storage_bytes: u64,
    #[specta(optional)]
    pub built_at: Option<u64>,
    #[specta(optional)]
    pub source: Option<String>,
    #[specta(optional)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalEvalManifest {
    format: String,
    version: u16,
    record_size: usize,
    shard_count: u16,
    max_pvs: u8,
    positions: u64,
    skipped: u64,
    source: String,
    built_at: u64,
    complete: bool,
}

#[derive(Debug, Deserialize)]
struct SourcePosition {
    fen: String,
    evals: Vec<SourceEval>,
}

#[derive(Debug, Deserialize)]
struct SourceEval {
    #[serde(default)]
    knodes: u64,
    #[serde(default)]
    depth: u16,
    pvs: Vec<SourcePv>,
}

#[derive(Debug, Deserialize)]
struct SourcePv {
    #[serde(default)]
    cp: Option<i32>,
    #[serde(default)]
    mate: Option<i16>,
    line: String,
}

#[derive(Debug, Clone)]
struct CompactPv {
    score: i16,
    score_kind: u8,
    moves: Vec<u16>,
}

#[derive(Debug, Clone)]
struct CompactRecord {
    hash_hi: u64,
    hash_lo: u64,
    depth: u16,
    knodes: u32,
    pvs: Vec<CompactPv>,
}

struct CountingReader<R> {
    inner: R,
    bytes_read: Arc<AtomicU64>,
}

impl<R> CountingReader<R> {
    fn new(inner: R, bytes_read: Arc<AtomicU64>) -> Self {
        Self { inner, bytes_read }
    }
}

impl<R: Read> Read for CountingReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let read = self.inner.read(buf)?;
        self.bytes_read
            .fetch_add(read as u64, AtomicOrdering::Relaxed);
        Ok(read)
    }
}

#[derive(Default)]
struct ShardCache {
    entries: HashMap<PathBuf, Arc<Vec<u8>>>,
    order: VecDeque<PathBuf>,
    bytes: usize,
}

static SHARD_CACHE: Lazy<Mutex<ShardCache>> = Lazy::new(|| Mutex::new(ShardCache::default()));

#[tauri::command]
#[specta::specta]
pub fn lookup_local_lichess_cloud_eval(
    fen: String,
    multipv: Option<u8>,
    app: tauri::AppHandle,
) -> Result<Option<LocalLichessCloudEval>, String> {
    let dir = default_store_dir(&app).map_err(String::from)?;
    lookup_eval(&dir, &fen, multipv.unwrap_or(1)).map_err(String::from)
}

#[tauri::command]
#[specta::specta]
pub fn get_local_lichess_eval_db_status(
    app: tauri::AppHandle,
) -> Result<LocalEvalDbStatus, String> {
    let dir = default_store_dir(&app).map_err(String::from)?;
    Ok(database_status(&dir))
}

#[tauri::command]
#[specta::specta]
pub async fn build_local_lichess_eval_db(
    request: LocalEvalBuildRequest,
    app: tauri::AppHandle,
) -> Result<LocalEvalBuildReport, String> {
    let options = request_to_options(request, &app).map_err(String::from)?;
    let emit_app = app.clone();
    tokio::task::spawn_blocking(move || {
        build_compact_eval_database(options, |progress| {
            if let Err(error) = progress.emit(&emit_app) {
                log::warn!("Failed to emit local eval build progress: {error}");
            }
        })
    })
    .await
    .map_err(|error| LocalEvalError::Join(error.to_string()).to_string())?
    .map_err(String::from)
}

pub fn build_compact_eval_database<F>(
    options: LocalEvalBuildOptions,
    mut on_progress: F,
) -> Result<LocalEvalBuildReport, LocalEvalError>
where
    F: FnMut(LocalEvalBuildProgress),
{
    let max_pvs = validate_max_pvs(options.max_pvs)?;
    let shard_count = validate_shard_count(options.shard_count)?;
    let source_label = options.source.label();
    let built_at = unix_now();
    let build_dir = build_dir_for(&options.output_dir, built_at)?;
    let spool_dir = build_dir.join(SPOOL_DIR);
    let shards_dir = build_dir.join(SHARDS_DIR);

    fs::create_dir_all(&spool_dir)?;
    fs::create_dir_all(&shards_dir)?;

    let (source_reader, total_bytes) = open_source(&options.source)?;
    let compressed_bytes_read = Arc::new(AtomicU64::new(0));
    let counting_reader = CountingReader::new(source_reader, compressed_bytes_read.clone());
    let decoder = zstd::Decoder::new(counting_reader)?;
    let mut reader = BufReader::with_capacity(1024 * 1024, decoder);
    let mut spool = ShardSpool::new(&spool_dir, shard_count);

    let mut line = String::new();
    let mut lines = 0_u64;
    let mut positions = 0_u64;
    let mut skipped = 0_u64;

    emit_progress(
        &options.id,
        &mut on_progress,
        "ingesting",
        0.0,
        positions,
        skipped,
        compressed_bytes_read.load(AtomicOrdering::Relaxed),
        total_bytes,
        false,
    );

    loop {
        line.clear();
        let read = reader.read_line(&mut line)?;
        if read == 0 {
            break;
        }
        if line.trim().is_empty() {
            continue;
        }

        lines += 1;
        match parse_compact_record(&line, max_pvs) {
            Ok(Some(record)) => {
                let shard = shard_for_hash(record.hash_hi, record.hash_lo, shard_count);
                spool.push(shard, &pack_record(&record)?)?;
                positions += 1;
            }
            Ok(None) => skipped += 1,
            Err(error) => {
                return Err(LocalEvalError::InvalidDatabase(format!(
                    "could not parse source line {lines}: {error}"
                )));
            }
        }

        if lines % 100_000 == 0 {
            let read = compressed_bytes_read.load(AtomicOrdering::Relaxed);
            let progress = ingest_progress(read, total_bytes);
            emit_progress(
                &options.id,
                &mut on_progress,
                "ingesting",
                progress,
                positions,
                skipped,
                read,
                total_bytes,
                false,
            );
        }
    }

    spool.flush_all()?;

    emit_progress(
        &options.id,
        &mut on_progress,
        "sorting",
        92.0,
        positions,
        skipped,
        compressed_bytes_read.load(AtomicOrdering::Relaxed),
        total_bytes,
        false,
    );

    let mut sorted_positions = 0_u64;
    for shard in 0..shard_count {
        sorted_positions +=
            sort_and_compress_shard(&spool.path(shard), &shard_path(&shards_dir, shard))?;
        if shard % 32 == 0 || shard + 1 == shard_count {
            let progress = 92.0 + ((shard as f32 + 1.0) / shard_count as f32) * 7.0;
            emit_progress(
                &options.id,
                &mut on_progress,
                "sorting",
                progress,
                positions,
                skipped,
                compressed_bytes_read.load(AtomicOrdering::Relaxed),
                total_bytes,
                false,
            );
        }
    }

    if sorted_positions != positions {
        return Err(LocalEvalError::InvalidDatabase(format!(
            "sorted {sorted_positions} records but ingested {positions}"
        )));
    }

    if spool_dir.exists() {
        fs::remove_dir_all(&spool_dir)?;
    }

    let storage_bytes = directory_size(&build_dir)?;
    let manifest = LocalEvalManifest {
        format: "en-croissant-lichess-eval-compact".to_string(),
        version: FORMAT_VERSION,
        record_size: VARIABLE_RECORD_SIZE,
        shard_count,
        max_pvs,
        positions,
        skipped,
        source: source_label.clone(),
        built_at,
        complete: true,
    };
    write_manifest(&build_dir, &manifest)?;
    let final_storage_bytes = directory_size(&build_dir)?;

    install_build_dir(&build_dir, &options.output_dir)?;
    clear_shard_cache();

    emit_progress(
        &options.id,
        &mut on_progress,
        "ready",
        100.0,
        positions,
        skipped,
        compressed_bytes_read.load(AtomicOrdering::Relaxed),
        total_bytes,
        true,
    );

    Ok(LocalEvalBuildReport {
        output_dir: options.output_dir.display().to_string(),
        source: source_label,
        positions,
        skipped,
        shard_count,
        max_pvs,
        storage_bytes: final_storage_bytes.max(storage_bytes),
        built_at,
    })
}

pub fn lookup_eval(
    store_dir: &Path,
    fen: &str,
    requested_multipv: u8,
) -> Result<Option<LocalLichessCloudEval>, LocalEvalError> {
    let Some(manifest) = read_manifest(store_dir)? else {
        return Ok(None);
    };
    validate_manifest(&manifest)?;

    let Some(fen_key) = normalize_fen_key(fen) else {
        return Ok(None);
    };
    let (hash_hi, hash_lo) = hash_fen(&fen_key);
    let shard = shard_for_hash(hash_hi, hash_lo, manifest.shard_count);
    let path = shard_path(&store_dir.join(SHARDS_DIR), shard);
    if !path.exists() {
        return Ok(None);
    }

    if manifest.version == ROOT_ONLY_FORMAT_VERSION {
        return lookup_root_only_eval(
            &path,
            &fen_key,
            hash_hi,
            hash_lo,
            &manifest,
            requested_multipv,
        );
    }

    let bytes = load_shard(&path)?;

    let Some(record) = find_record(&bytes, hash_hi, hash_lo)? else {
        return Ok(None);
    };

    let pv_limit = requested_multipv
        .max(1)
        .min(manifest.max_pvs)
        .min(record.pvs.len() as u8) as usize;
    let pvs = record
        .pvs
        .iter()
        .take(pv_limit)
        .filter_map(decode_pv)
        .collect::<Vec<_>>();

    if pvs.is_empty() {
        return Ok(None);
    }

    Ok(Some(LocalLichessCloudEval {
        fen: fen_key,
        knodes: record.knodes,
        depth: record.depth,
        pvs,
    }))
}

pub fn database_status(store_dir: &Path) -> LocalEvalDbStatus {
    match read_manifest(store_dir) {
        Ok(Some(manifest)) => {
            let validation_error = validate_manifest(&manifest).err();
            LocalEvalDbStatus {
                available: validation_error.is_none(),
                path: store_dir.display().to_string(),
                positions: manifest.positions,
                shard_count: manifest.shard_count,
                max_pvs: manifest.max_pvs,
                storage_bytes: directory_size(store_dir).unwrap_or(0),
                built_at: Some(manifest.built_at),
                source: Some(manifest.source),
                error: validation_error.map(|error| error.to_string()),
            }
        }
        Ok(None) => LocalEvalDbStatus {
            available: false,
            path: store_dir.display().to_string(),
            positions: 0,
            shard_count: DEFAULT_SHARD_COUNT,
            max_pvs: DEFAULT_MAX_PVS,
            storage_bytes: 0,
            built_at: None,
            source: None,
            error: None,
        },
        Err(error) => LocalEvalDbStatus {
            available: false,
            path: store_dir.display().to_string(),
            positions: 0,
            shard_count: DEFAULT_SHARD_COUNT,
            max_pvs: DEFAULT_MAX_PVS,
            storage_bytes: 0,
            built_at: None,
            source: None,
            error: Some(error.to_string()),
        },
    }
}

fn lookup_root_only_eval(
    path: &Path,
    fen_key: &str,
    hash_hi: u64,
    hash_lo: u64,
    manifest: &LocalEvalManifest,
    requested_multipv: u8,
) -> Result<Option<LocalLichessCloudEval>, LocalEvalError> {
    let bytes = load_shard(path)?;
    if bytes.len() % ROOT_ONLY_RECORD_SIZE != 0 {
        return Err(LocalEvalError::InvalidDatabase(format!(
            "shard {} has invalid byte length {}",
            path.display(),
            bytes.len()
        )));
    }

    let Some(record) = find_root_only_record(&bytes, hash_hi, hash_lo) else {
        return Ok(None);
    };

    let pv_limit = requested_multipv
        .max(1)
        .min(manifest.max_pvs)
        .min(record.pvs.len() as u8) as usize;
    let pvs = record
        .pvs
        .iter()
        .take(pv_limit)
        .filter_map(decode_pv)
        .collect::<Vec<_>>();

    if pvs.is_empty() {
        return Ok(None);
    }

    Ok(Some(LocalLichessCloudEval {
        fen: fen_key.to_string(),
        knodes: record.knodes,
        depth: record.depth,
        pvs,
    }))
}

pub fn default_cli_store_dir() -> PathBuf {
    if cfg!(target_os = "windows") {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            return PathBuf::from(appdata)
                .join("org.encroissant.app")
                .join("lichess-cloud-evals");
        }
    }

    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("org.encroissant.app")
            .join("lichess-cloud-evals");
    }

    PathBuf::from("lichess-cloud-evals")
}

pub fn default_source_url() -> &'static str {
    DEFAULT_SOURCE_URL
}

fn request_to_options(
    request: LocalEvalBuildRequest,
    app: &tauri::AppHandle,
) -> Result<LocalEvalBuildOptions, LocalEvalError> {
    let output_dir = match request.output_dir {
        Some(path) => PathBuf::from(path),
        None => default_store_dir(app)?,
    };
    let source = match (request.source, request.source_url) {
        (Some(source), _) => LocalEvalSource::File(PathBuf::from(source)),
        (None, Some(url)) if !url.trim().is_empty() => LocalEvalSource::Url(url),
        _ => LocalEvalSource::Url(DEFAULT_SOURCE_URL.to_string()),
    };

    Ok(LocalEvalBuildOptions {
        id: request
            .id
            .filter(|id| !id.trim().is_empty())
            .unwrap_or_else(|| "lichess-local-eval-build".to_string()),
        source,
        output_dir,
        max_pvs: request.max_pvs.unwrap_or(DEFAULT_MAX_PVS),
        shard_count: request.shard_count.unwrap_or(DEFAULT_SHARD_COUNT),
    })
}

fn default_store_dir(app: &tauri::AppHandle) -> Result<PathBuf, LocalEvalError> {
    Ok(app.path().app_data_dir()?.join("lichess-cloud-evals"))
}

fn validate_max_pvs(max_pvs: u8) -> Result<u8, LocalEvalError> {
    if !(1..=MAX_STORED_PVS as u8).contains(&max_pvs) {
        return Err(LocalEvalError::InvalidOption(format!(
            "max_pvs must be between 1 and {MAX_STORED_PVS}"
        )));
    }
    Ok(max_pvs)
}

fn validate_shard_count(shard_count: u16) -> Result<u16, LocalEvalError> {
    if !(16..=8192).contains(&shard_count) {
        return Err(LocalEvalError::InvalidOption(
            "shard_count must be between 16 and 8192".to_string(),
        ));
    }
    Ok(shard_count)
}

fn validate_manifest(manifest: &LocalEvalManifest) -> Result<(), LocalEvalError> {
    if !manifest.complete {
        return Err(LocalEvalError::InvalidDatabase(
            "manifest says build is incomplete".to_string(),
        ));
    }
    if manifest.version != FORMAT_VERSION && manifest.version != ROOT_ONLY_FORMAT_VERSION {
        return Err(LocalEvalError::InvalidDatabase(format!(
            "unsupported format version {}",
            manifest.version
        )));
    }
    if manifest.version == ROOT_ONLY_FORMAT_VERSION && manifest.record_size != ROOT_ONLY_RECORD_SIZE
    {
        return Err(LocalEvalError::InvalidDatabase(format!(
            "record size mismatch: expected {ROOT_ONLY_RECORD_SIZE}, got {}",
            manifest.record_size
        )));
    }
    if manifest.version == FORMAT_VERSION && manifest.record_size != VARIABLE_RECORD_SIZE {
        return Err(LocalEvalError::InvalidDatabase(format!(
            "record size mismatch: expected variable-size marker {VARIABLE_RECORD_SIZE}, got {}",
            manifest.record_size
        )));
    }
    validate_max_pvs(manifest.max_pvs)?;
    validate_shard_count(manifest.shard_count)?;
    Ok(())
}

fn parse_compact_record(line: &str, max_pvs: u8) -> Result<Option<CompactRecord>, LocalEvalError> {
    let position: SourcePosition = serde_json::from_str(line)?;
    let Some(fen_key) = normalize_fen_key(&position.fen) else {
        return Ok(None);
    };
    let Some(eval) = select_source_eval(&position.evals, max_pvs) else {
        return Ok(None);
    };

    let mut pvs = Vec::with_capacity(max_pvs as usize);
    for pv in eval.pvs.iter().take(max_pvs as usize) {
        let moves = pv
            .line
            .split_whitespace()
            .filter_map(encode_uci_move)
            .collect::<Vec<_>>();
        if moves.is_empty() {
            continue;
        }
        let Some((score, score_kind)) = encode_score(pv) else {
            continue;
        };
        pvs.push(CompactPv {
            score,
            score_kind,
            moves,
        });
    }

    if pvs.is_empty() {
        return Ok(None);
    }

    let (hash_hi, hash_lo) = hash_fen(&fen_key);
    Ok(Some(CompactRecord {
        hash_hi,
        hash_lo,
        depth: eval.depth,
        knodes: eval.knodes.min(u32::MAX as u64) as u32,
        pvs,
    }))
}

fn select_source_eval<'a>(evals: &'a [SourceEval], max_pvs: u8) -> Option<&'a SourceEval> {
    evals
        .iter()
        .filter(|eval| !eval.pvs.is_empty())
        .max_by(|a, b| {
            let a_pvs = a.pvs.len().min(max_pvs as usize);
            let b_pvs = b.pvs.len().min(max_pvs as usize);
            a_pvs
                .cmp(&b_pvs)
                .then_with(|| a.depth.cmp(&b.depth))
                .then_with(|| a.knodes.cmp(&b.knodes))
        })
}

fn normalize_fen_key(fen: &str) -> Option<String> {
    let mut parts = fen.split_whitespace();
    let board = parts.next()?;
    let turn = parts.next()?;
    let castling = parts.next()?;
    let ep = parts.next()?;
    Some(format!("{board} {turn} {castling} {ep}"))
}

fn encode_score(pv: &SourcePv) -> Option<(i16, u8)> {
    if let Some(cp) = pv.cp {
        return Some((cp.clamp(i16::MIN as i32, i16::MAX as i32) as i16, 0));
    }
    pv.mate.map(|mate| (mate, 1))
}

fn decode_pv(pv: &CompactPv) -> Option<LocalLichessCloudPv> {
    let moves = pv
        .moves
        .iter()
        .map(|code| decode_uci_move(*code))
        .collect::<Option<Vec<_>>>()?
        .join(" ");
    if moves.is_empty() {
        return None;
    }
    match pv.score_kind {
        0 => Some(LocalLichessCloudPv {
            moves,
            cp: Some(pv.score as i32),
            mate: None,
        }),
        1 => Some(LocalLichessCloudPv {
            moves,
            cp: None,
            mate: Some(pv.score),
        }),
        _ => None,
    }
}

fn encode_uci_move(uci: &str) -> Option<u16> {
    let bytes = uci.as_bytes();
    if bytes.len() < 4 {
        return None;
    }
    let from = encode_square(bytes[0], bytes[1])?;
    let to = encode_square(bytes[2], bytes[3])?;
    let promotion = if bytes.len() >= 5 {
        match bytes[4].to_ascii_lowercase() {
            b'n' => 1,
            b'b' => 2,
            b'r' => 3,
            b'q' => 4,
            _ => return None,
        }
    } else {
        0
    };
    Some(from | (to << 6) | (promotion << 12))
}

fn decode_uci_move(code: u16) -> Option<String> {
    let from = code & 0b11_1111;
    let to = (code >> 6) & 0b11_1111;
    let promotion = (code >> 12) & 0b111;
    let mut uci = String::with_capacity(5);
    uci.push_str(&decode_square(from)?);
    uci.push_str(&decode_square(to)?);
    if promotion != 0 {
        uci.push(match promotion {
            1 => 'n',
            2 => 'b',
            3 => 'r',
            4 => 'q',
            _ => return None,
        });
    }
    Some(uci)
}

fn encode_square(file: u8, rank: u8) -> Option<u16> {
    let file = file.to_ascii_lowercase();
    if !(b'a'..=b'h').contains(&file) || !(b'1'..=b'8').contains(&rank) {
        return None;
    }
    Some(((rank - b'1') as u16) * 8 + (file - b'a') as u16)
}

fn decode_square(square: u16) -> Option<String> {
    if square >= 64 {
        return None;
    }
    let file = (b'a' + (square % 8) as u8) as char;
    let rank = (b'1' + (square / 8) as u8) as char;
    Some(format!("{file}{rank}"))
}

fn hash_fen(fen: &str) -> (u64, u64) {
    fn fnv1a(bytes: &[u8], offset: u64) -> u64 {
        let mut hash = offset;
        for byte in bytes {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        hash
    }

    let bytes = fen.as_bytes();
    (
        fnv1a(bytes, 0xcbf2_9ce4_8422_2325),
        fnv1a(bytes, 0x8422_2325_cbf2_9ce4),
    )
}

fn shard_for_hash(hash_hi: u64, hash_lo: u64, shard_count: u16) -> u16 {
    ((hash_hi ^ hash_lo) % shard_count as u64) as u16
}

fn pack_record(record: &CompactRecord) -> Result<Vec<u8>, LocalEvalError> {
    let mut out = vec![0_u8; 26];
    out[2..10].copy_from_slice(&record.hash_hi.to_le_bytes());
    out[10..18].copy_from_slice(&record.hash_lo.to_le_bytes());
    out[18..20].copy_from_slice(&record.depth.to_le_bytes());
    out[20] = record.pvs.len().min(MAX_STORED_PVS) as u8;
    out[21] = 0;
    out[22..26].copy_from_slice(&record.knodes.to_le_bytes());

    for pv in record.pvs.iter().take(MAX_STORED_PVS) {
        let move_count = pv.moves.len().min(u8::MAX as usize);
        if move_count == 0 {
            continue;
        }
        out.extend_from_slice(&pv.score.to_le_bytes());
        out.push(pv.score_kind);
        out.push(move_count as u8);
        for move_code in pv.moves.iter().take(move_count) {
            out.extend_from_slice(&move_code.to_le_bytes());
        }
    }

    let record_len = u16::try_from(out.len()).map_err(|_| {
        LocalEvalError::InvalidDatabase(format!("packed eval record is too large: {}", out.len()))
    })?;
    out[0..2].copy_from_slice(&record_len.to_le_bytes());
    Ok(out)
}

fn unpack_record(bytes: &[u8]) -> Result<CompactRecord, LocalEvalError> {
    if bytes.len() < 26 {
        return Err(LocalEvalError::InvalidDatabase(format!(
            "record too short: {} bytes",
            bytes.len()
        )));
    }
    let record_len = u16::from_le_bytes([bytes[0], bytes[1]]) as usize;
    if record_len != bytes.len() {
        return Err(LocalEvalError::InvalidDatabase(format!(
            "record length mismatch: expected {record_len}, got {}",
            bytes.len()
        )));
    }

    let pv_count = bytes[20].min(MAX_STORED_PVS as u8) as usize;
    let mut offset = 26;
    let mut pvs = Vec::with_capacity(pv_count);
    for _ in 0..pv_count {
        if offset + 4 > bytes.len() {
            return Err(LocalEvalError::InvalidDatabase(
                "record ended inside PV header".to_string(),
            ));
        }
        let score = i16::from_le_bytes([bytes[offset], bytes[offset + 1]]);
        let score_kind = bytes[offset + 2];
        let move_count = bytes[offset + 3] as usize;
        offset += 4;
        let move_bytes = move_count * 2;
        if offset + move_bytes > bytes.len() {
            return Err(LocalEvalError::InvalidDatabase(
                "record ended inside PV moves".to_string(),
            ));
        }
        let moves = bytes[offset..offset + move_bytes]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        offset += move_bytes;
        pvs.push(CompactPv {
            score,
            score_kind,
            moves,
        });
    }
    if offset != bytes.len() {
        return Err(LocalEvalError::InvalidDatabase(format!(
            "record has {} trailing bytes",
            bytes.len() - offset
        )));
    }

    Ok(CompactRecord {
        hash_hi: u64::from_le_bytes(bytes[2..10].try_into().unwrap()),
        hash_lo: u64::from_le_bytes(bytes[10..18].try_into().unwrap()),
        depth: u16::from_le_bytes(bytes[18..20].try_into().unwrap()),
        knodes: u32::from_le_bytes(bytes[22..26].try_into().unwrap()),
        pvs,
    })
}

fn unpack_root_only_record(bytes: &[u8]) -> CompactRecord {
    let pv_count = bytes[18].min(MAX_STORED_PVS as u8) as usize;
    let mut pvs = Vec::with_capacity(pv_count);
    let mut offset = 24;
    for _ in 0..MAX_STORED_PVS {
        let move_code = u16::from_le_bytes([bytes[offset], bytes[offset + 1]]);
        let score = i16::from_le_bytes([bytes[offset + 2], bytes[offset + 3]]);
        let score_kind = bytes[offset + 4];
        offset += 6;
        if pvs.len() < pv_count {
            pvs.push(CompactPv {
                score,
                score_kind,
                moves: vec![move_code],
            });
        }
    }

    CompactRecord {
        hash_hi: u64::from_le_bytes(bytes[0..8].try_into().unwrap()),
        hash_lo: u64::from_le_bytes(bytes[8..16].try_into().unwrap()),
        depth: u16::from_le_bytes(bytes[16..18].try_into().unwrap()),
        knodes: u32::from_le_bytes(bytes[20..24].try_into().unwrap()),
        pvs,
    }
}

fn root_only_record_hash_at(bytes: &[u8], index: usize) -> (u64, u64) {
    let offset = index * ROOT_ONLY_RECORD_SIZE;
    (
        u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap()),
        u64::from_le_bytes(bytes[offset + 8..offset + 16].try_into().unwrap()),
    )
}

fn find_root_only_record(bytes: &[u8], hash_hi: u64, hash_lo: u64) -> Option<CompactRecord> {
    let mut low = 0_usize;
    let mut high = bytes.len() / ROOT_ONLY_RECORD_SIZE;
    while low < high {
        let mid = low + (high - low) / 2;
        let hash = root_only_record_hash_at(bytes, mid);
        match hash.cmp(&(hash_hi, hash_lo)) {
            Ordering::Less => low = mid + 1,
            Ordering::Greater => high = mid,
            Ordering::Equal => {
                let offset = mid * ROOT_ONLY_RECORD_SIZE;
                return Some(unpack_root_only_record(
                    &bytes[offset..offset + ROOT_ONLY_RECORD_SIZE],
                ));
            }
        }
    }
    None
}

fn record_hash(record: &[u8]) -> Result<(u64, u64), LocalEvalError> {
    if record.len() < 18 {
        return Err(LocalEvalError::InvalidDatabase(format!(
            "record too short for hash: {} bytes",
            record.len()
        )));
    }
    Ok((
        u64::from_le_bytes(record[2..10].try_into().unwrap()),
        u64::from_le_bytes(record[10..18].try_into().unwrap()),
    ))
}

fn find_record(
    bytes: &[u8],
    hash_hi: u64,
    hash_lo: u64,
) -> Result<Option<CompactRecord>, LocalEvalError> {
    let index = read_shard_index(bytes)?;
    let mut low = 0_usize;
    let mut high = index.count as usize;
    while low < high {
        let mid = low + (high - low) / 2;
        let offset = read_index_offset(bytes, &index, mid)?;
        let record = record_at(bytes, index.records_end, offset)?;
        match record_hash(record)?.cmp(&(hash_hi, hash_lo)) {
            Ordering::Less => low = mid + 1,
            Ordering::Greater => high = mid,
            Ordering::Equal => return Ok(Some(unpack_record(record)?)),
        }
    }
    Ok(None)
}

struct ShardIndex {
    index_start: usize,
    records_end: usize,
    count: u32,
}

fn read_shard_index(bytes: &[u8]) -> Result<ShardIndex, LocalEvalError> {
    if bytes.len() < 8 {
        return Err(LocalEvalError::InvalidDatabase(format!(
            "v2 shard too short: {} bytes",
            bytes.len()
        )));
    }
    if &bytes[bytes.len() - 4..] != V2_SHARD_MAGIC {
        return Err(LocalEvalError::InvalidDatabase(
            "v2 shard is missing index magic".to_string(),
        ));
    }
    let count = u32::from_le_bytes(bytes[bytes.len() - 8..bytes.len() - 4].try_into().unwrap());
    let index_bytes = count as usize * 4;
    if bytes.len() < 8 + index_bytes {
        return Err(LocalEvalError::InvalidDatabase(format!(
            "v2 shard index is larger than shard: count={count}, bytes={}",
            bytes.len()
        )));
    }
    let index_start = bytes.len() - 8 - index_bytes;
    Ok(ShardIndex {
        index_start,
        records_end: index_start,
        count,
    })
}

fn read_index_offset(
    bytes: &[u8],
    index: &ShardIndex,
    position: usize,
) -> Result<usize, LocalEvalError> {
    if position >= index.count as usize {
        return Err(LocalEvalError::InvalidDatabase(format!(
            "v2 shard index position {position} is out of range"
        )));
    }
    let offset = index.index_start + position * 4;
    Ok(u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize)
}

fn record_at(bytes: &[u8], records_end: usize, offset: usize) -> Result<&[u8], LocalEvalError> {
    if offset + 2 > records_end {
        return Err(LocalEvalError::InvalidDatabase(format!(
            "v2 record offset {offset} is out of range"
        )));
    }
    let record_len = u16::from_le_bytes([bytes[offset], bytes[offset + 1]]) as usize;
    if record_len < 26 || offset + record_len > records_end {
        return Err(LocalEvalError::InvalidDatabase(format!(
            "v2 record at {offset} has invalid length {record_len}"
        )));
    }
    Ok(&bytes[offset..offset + record_len])
}

struct ShardSpool {
    dir: PathBuf,
    buffers: Vec<Vec<u8>>,
}

impl ShardSpool {
    fn new(dir: &Path, shard_count: u16) -> Self {
        Self {
            dir: dir.to_path_buf(),
            buffers: (0..shard_count).map(|_| Vec::new()).collect(),
        }
    }

    fn path(&self, shard: u16) -> PathBuf {
        shard_path(&self.dir, shard)
    }

    fn push(&mut self, shard: u16, record: &[u8]) -> Result<(), LocalEvalError> {
        let buffer = &mut self.buffers[shard as usize];
        buffer.extend_from_slice(record);
        if buffer.len() >= SHARD_BUFFER_FLUSH_BYTES {
            self.flush(shard)?;
        }
        Ok(())
    }

    fn flush(&mut self, shard: u16) -> Result<(), LocalEvalError> {
        let path = self.path(shard);
        let buffer = &mut self.buffers[shard as usize];
        if buffer.is_empty() {
            return Ok(());
        }
        let mut file = OpenOptions::new().create(true).append(true).open(path)?;
        file.write_all(buffer)?;
        buffer.clear();
        Ok(())
    }

    fn flush_all(&mut self) -> Result<(), LocalEvalError> {
        for shard in 0..self.buffers.len() as u16 {
            self.flush(shard)?;
        }
        Ok(())
    }
}

fn sort_and_compress_shard(input_path: &Path, output_path: &Path) -> Result<u64, LocalEvalError> {
    if !input_path.exists() {
        return Ok(0);
    }
    let bytes = fs::read(input_path)?;
    let mut records = unpack_spooled_records(&bytes, input_path)?;
    records.sort_unstable_by(|a, b| {
        let a_hash = record_hash(a).unwrap_or((0, 0));
        let b_hash = record_hash(b).unwrap_or((0, 0));
        a_hash.cmp(&b_hash)
    });

    let output = File::create(output_path)?;
    let writer = BufWriter::new(output);
    let mut encoder = zstd::Encoder::new(writer, 6)?;
    let mut offsets = Vec::with_capacity(records.len());
    let mut offset = 0_u32;
    for record in &records {
        offsets.push(offset);
        encoder.write_all(record)?;
        offset = offset.checked_add(record.len() as u32).ok_or_else(|| {
            LocalEvalError::InvalidDatabase("v2 shard offset overflow".to_string())
        })?;
    }
    for offset in offsets {
        encoder.write_all(&offset.to_le_bytes())?;
    }
    let count = u32::try_from(records.len()).map_err(|_| {
        LocalEvalError::InvalidDatabase(format!("too many records in shard: {}", records.len()))
    })?;
    encoder.write_all(&count.to_le_bytes())?;
    encoder.write_all(V2_SHARD_MAGIC)?;
    let mut writer = encoder.finish()?;
    writer.flush()?;

    Ok(records.len() as u64)
}

fn unpack_spooled_records(bytes: &[u8], input_path: &Path) -> Result<Vec<Vec<u8>>, LocalEvalError> {
    let mut records = Vec::new();
    let mut offset = 0_usize;
    while offset < bytes.len() {
        if offset + 2 > bytes.len() {
            return Err(LocalEvalError::InvalidDatabase(format!(
                "spool shard {} ended inside record length",
                input_path.display()
            )));
        }
        let record_len = u16::from_le_bytes([bytes[offset], bytes[offset + 1]]) as usize;
        if record_len < 26 || offset + record_len > bytes.len() {
            return Err(LocalEvalError::InvalidDatabase(format!(
                "spool shard {} has invalid record length {record_len} at byte {offset}",
                input_path.display()
            )));
        }
        let record = bytes[offset..offset + record_len].to_vec();
        record_hash(&record)?;
        records.push(record);
        offset += record_len;
    }
    Ok(records)
}

fn open_source(
    source: &LocalEvalSource,
) -> Result<(Box<dyn Read + Send>, Option<u64>), LocalEvalError> {
    match source {
        LocalEvalSource::File(path) => {
            let file = File::open(path)?;
            let size = file.metadata().ok().map(|metadata| metadata.len());
            Ok((Box::new(file), size))
        }
        LocalEvalSource::Url(url) => {
            let response = reqwest::blocking::get(url)?.error_for_status()?;
            let size = response.content_length();
            Ok((Box::new(response), size))
        }
    }
}

fn shard_path(dir: &Path, shard: u16) -> PathBuf {
    dir.join(format!("{shard:04}.bin.zst"))
}

fn read_manifest(dir: &Path) -> Result<Option<LocalEvalManifest>, LocalEvalError> {
    let path = dir.join(MANIFEST_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let data = fs::read_to_string(path)?;
    Ok(Some(serde_json::from_str(&data)?))
}

fn write_manifest(dir: &Path, manifest: &LocalEvalManifest) -> Result<(), LocalEvalError> {
    let data = serde_json::to_string_pretty(manifest)?;
    fs::write(dir.join(MANIFEST_FILE), data)?;
    Ok(())
}

fn build_dir_for(output_dir: &Path, built_at: u64) -> Result<PathBuf, LocalEvalError> {
    let parent = output_dir.parent().ok_or_else(|| {
        LocalEvalError::InvalidOption(format!(
            "output directory {} has no parent",
            output_dir.display()
        ))
    })?;
    fs::create_dir_all(parent)?;
    let name = output_dir
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("lichess-cloud-evals");
    Ok(parent.join(format!("{name}-building-{built_at}")))
}

fn install_build_dir(build_dir: &Path, output_dir: &Path) -> Result<(), LocalEvalError> {
    let parent = output_dir.parent().ok_or_else(|| {
        LocalEvalError::InvalidOption(format!(
            "output directory {} has no parent",
            output_dir.display()
        ))
    })?;
    fs::create_dir_all(parent)?;

    let backup_dir = parent.join(format!(
        "{}-backup-{}",
        output_dir
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("lichess-cloud-evals"),
        unix_now()
    ));

    if backup_dir.exists() {
        fs::remove_dir_all(&backup_dir)?;
    }
    if output_dir.exists() {
        fs::rename(output_dir, &backup_dir)?;
    }

    match fs::rename(build_dir, output_dir) {
        Ok(()) => {
            if backup_dir.exists() {
                fs::remove_dir_all(backup_dir)?;
            }
            Ok(())
        }
        Err(error) => {
            if backup_dir.exists() && !output_dir.exists() {
                let _ = fs::rename(&backup_dir, output_dir);
            }
            Err(error.into())
        }
    }
}

fn directory_size(dir: &Path) -> Result<u64, LocalEvalError> {
    if !dir.exists() {
        return Ok(0);
    }
    let mut total = 0_u64;
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            total += directory_size(&entry.path())?;
        } else {
            total += metadata.len();
        }
    }
    Ok(total)
}

fn load_shard(path: &Path) -> Result<Arc<Vec<u8>>, LocalEvalError> {
    if let Some(bytes) = SHARD_CACHE
        .lock()
        .expect("local eval shard cache poisoned")
        .entries
        .get(path)
        .cloned()
    {
        return Ok(bytes);
    }

    let file = File::open(path)?;
    let mut decoder = zstd::Decoder::new(BufReader::new(file))?;
    let mut bytes = Vec::new();
    decoder.read_to_end(&mut bytes)?;
    let bytes = Arc::new(bytes);

    let mut cache = SHARD_CACHE.lock().expect("local eval shard cache poisoned");
    if bytes.len() <= SHARD_CACHE_MAX_BYTES {
        cache.bytes += bytes.len();
        cache.order.push_back(path.to_path_buf());
        cache.entries.insert(path.to_path_buf(), bytes.clone());
        while cache.bytes > SHARD_CACHE_MAX_BYTES {
            let Some(oldest) = cache.order.pop_front() else {
                break;
            };
            if let Some(old) = cache.entries.remove(&oldest) {
                cache.bytes = cache.bytes.saturating_sub(old.len());
            }
        }
    }

    Ok(bytes)
}

fn clear_shard_cache() {
    let mut cache = SHARD_CACHE.lock().expect("local eval shard cache poisoned");
    cache.entries.clear();
    cache.order.clear();
    cache.bytes = 0;
}

fn ingest_progress(bytes_read: u64, total_bytes: Option<u64>) -> f32 {
    match total_bytes {
        Some(total) if total > 0 => ((bytes_read as f32 / total as f32) * 90.0).min(90.0),
        _ => 0.0,
    }
}

#[allow(clippy::too_many_arguments)]
fn emit_progress<F>(
    id: &str,
    on_progress: &mut F,
    phase: &str,
    progress: f32,
    positions: u64,
    skipped: u64,
    compressed_bytes_read: u64,
    compressed_bytes_total: Option<u64>,
    finished: bool,
) where
    F: FnMut(LocalEvalBuildProgress),
{
    on_progress(LocalEvalBuildProgress {
        id: id.to_string(),
        phase: phase.to_string(),
        progress,
        positions,
        skipped,
        compressed_bytes_read,
        compressed_bytes_total,
        finished,
    });
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn move_codec_round_trips_promotions() {
        for uci in ["e2e4", "e7e8q", "a1h8n", "h7h8r"] {
            let encoded = encode_uci_move(uci).unwrap();
            assert_eq!(decode_uci_move(encoded).unwrap(), uci);
        }
    }

    #[test]
    fn record_codec_round_trips() {
        let record = CompactRecord {
            hash_hi: 1,
            hash_lo: 2,
            depth: 36,
            knodes: 123_456,
            pvs: vec![
                CompactPv {
                    score: 20,
                    score_kind: 0,
                    moves: vec![
                        encode_uci_move("e2e4").unwrap(),
                        encode_uci_move("e7e5").unwrap(),
                    ],
                },
                CompactPv {
                    score: -3,
                    score_kind: 0,
                    moves: vec![
                        encode_uci_move("g1f3").unwrap(),
                        encode_uci_move("g8f6").unwrap(),
                    ],
                },
            ],
        };

        let packed = pack_record(&record).unwrap();
        let unpacked = unpack_record(&packed).unwrap();
        assert_eq!(unpacked.hash_hi, record.hash_hi);
        assert_eq!(unpacked.hash_lo, record.hash_lo);
        assert_eq!(unpacked.depth, record.depth);
        assert_eq!(unpacked.pvs.len(), record.pvs.len());
        assert_eq!(unpacked.knodes, record.knodes);
        assert_eq!(unpacked.pvs[0].moves, record.pvs[0].moves);
    }

    #[test]
    fn parses_top_moves_with_pv_tail() {
        let line = r#"{"fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -","evals":[{"pvs":[{"cp":20,"line":"e2e4 e7e5"},{"cp":18,"line":"d2d4 d7d5"}],"knodes":3000,"depth":36}]}"#;
        let record = parse_compact_record(line, 5).unwrap().unwrap();
        assert_eq!(record.depth, 36);
        assert_eq!(record.pvs.len(), 2);
        assert_eq!(decode_pv(&record.pvs[0]).unwrap().moves, "e2e4 e7e5");
        assert_eq!(decode_pv(&record.pvs[1]).unwrap().moves, "d2d4 d7d5");
    }
}
