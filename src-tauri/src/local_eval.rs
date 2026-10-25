use std::{
    cmp::Ordering,
    collections::{HashMap, VecDeque},
    fs::{self, File},
    io::{self, BufReader, Read},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::Manager;

mod build;
mod build_control;
mod build_directory;
mod build_recovery;
mod download;
mod source;
mod source_discovery;
mod source_selection;
pub use build::build_compact_eval_database_controlled;
pub use build_control::{LocalEvalBuildControl, DEFAULT_BUILD_DISK_LIMIT_BYTES};
pub use build_recovery::{
    build_compact_eval_database_recoverable, discard_build_job, get_build_job, LocalEvalBuildJob,
};
pub use download::LocalEvalDownloadReview;
pub use source::LocalEvalSourceCandidate;
pub use source_selection::LocalEvalSourceSelection;
use tauri_specta::Event;

const FORMAT_VERSION: u16 = 2;
const FORMAT_NAME: &str = "en-croissant-lichess-eval-compact";
const ROOT_ONLY_FORMAT_VERSION: u16 = 1;
const DEFAULT_SHARD_COUNT: u16 = 2048;
const DEFAULT_MAX_PVS: u8 = 5;
const MAX_STORED_PVS: usize = 5;
const ROOT_ONLY_RECORD_SIZE: usize = 54;
const VARIABLE_RECORD_SIZE: usize = 0;
const V2_SHARD_MAGIC: &[u8; 4] = b"LEI2";
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

    #[error("Evaluation build cancelled. Existing databases were kept.")]
    Cancelled,
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
    #[specta(optional)]
    pub disk_limit_gib: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalEvalBuildReport {
    pub output_dir: String,
    pub source: String,
    pub positions: u64,
    pub skipped: u64,
    pub duplicates: u64,
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
    #[serde(default)]
    skipped: u64,
    #[serde(default)]
    source: String,
    #[serde(default)]
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

#[derive(Default)]
struct ShardCache {
    generation: u64,
    entries: HashMap<PathBuf, Arc<Vec<u8>>>,
    order: VecDeque<PathBuf>,
    bytes: usize,
}

static SHARD_CACHE: Lazy<Mutex<ShardCache>> = Lazy::new(|| Mutex::new(ShardCache::default()));

#[tauri::command]
#[specta::specta]
pub async fn lookup_local_lichess_cloud_eval(
    fen: String,
    multipv: Option<u8>,
    app: tauri::AppHandle,
) -> Result<Option<LocalLichessCloudEval>, String> {
    let profile = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let shared = app
        .path()
        .local_data_dir()
        .ok()
        .and_then(|base| source_discovery::shared_at(&base, std::env::consts::OS));
    tokio::task::spawn_blocking(move || {
        let selected = source_selection::read(&profile, shared.as_deref())?;
        if let Some(error) = selected.discovery_error.as_ref() {
            return Err(error.clone());
        }
        let result = lookup_eval(Path::new(&selected.path), &fen, multipv.unwrap_or(1))
            .map_err(String::from)?;
        if source_selection::read(&profile, shared.as_deref())? != selected {
            return Err("The evaluation source changed during this lookup. Try again.".into());
        }
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn get_local_lichess_eval_db_status(
    app: tauri::AppHandle,
) -> Result<LocalEvalDbStatus, String> {
    let profile = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let shared = app
        .path()
        .local_data_dir()
        .ok()
        .and_then(|base| source_discovery::shared_at(&base, std::env::consts::OS));
    tokio::task::spawn_blocking(move || source::status(&profile, shared.as_deref()))
        .await
        .map_err(|error| error.to_string())?
}

#[derive(Debug, Clone, Serialize, Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct LocalEvalSourceChanged {
    pub selection: LocalEvalSourceSelection,
}

#[tauri::command]
#[specta::specta]
pub async fn get_local_eval_source_selection(
    app: tauri::AppHandle,
) -> Result<LocalEvalSourceSelection, String> {
    let profile = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let shared = app
        .path()
        .local_data_dir()
        .ok()
        .and_then(|base| source_discovery::shared_at(&base, std::env::consts::OS));
    tokio::task::spawn_blocking(move || source_selection::read(&profile, shared.as_deref()))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn validate_local_eval_source(
    path: String,
    expected_revision: String,
    app: tauri::AppHandle,
) -> Result<LocalEvalSourceCandidate, String> {
    let profile = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let shared = app
        .path()
        .local_data_dir()
        .ok()
        .and_then(|base| source_discovery::shared_at(&base, std::env::consts::OS));
    tokio::task::spawn_blocking(move || {
        source::validate(
            &profile,
            shared.as_deref(),
            Path::new(&path),
            &expected_revision,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn activate_local_eval_source(
    token: String,
    app: tauri::AppHandle,
) -> Result<LocalEvalSourceSelection, String> {
    let profile = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let shared = app
        .path()
        .local_data_dir()
        .ok()
        .and_then(|base| source_discovery::shared_at(&base, std::env::consts::OS));
    let selection =
        tokio::task::spawn_blocking(move || source::activate(&profile, shared.as_deref(), &token))
            .await
            .map_err(|error| error.to_string())??;
    if let Err(error) = (LocalEvalSourceChanged {
        selection: selection.clone(),
    })
    .emit(&app)
    {
        log::warn!("Could not broadcast evaluation source change: {error}");
    }
    Ok(selection)
}

#[tauri::command]
#[specta::specta]
pub async fn build_local_lichess_eval_db(
    request: LocalEvalBuildRequest,
    app: tauri::AppHandle,
) -> Result<LocalEvalBuildReport, String> {
    let mut control = LocalEvalBuildControl::for_gib(request.disk_limit_gib.unwrap_or(64))
        .map_err(String::from)?;
    let options = request_to_options(request, &app).map_err(String::from)?;
    let journal_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("evaluation-download");
    let lease = build_control::BuildLease::start(&options.id).map_err(String::from)?;
    control.cancel = lease.cancel.clone();
    control.state = lease.state.clone();
    let emit_app = app.clone();
    tokio::task::spawn_blocking(move || {
        let _lease = lease;
        build_compact_eval_database_recoverable(options, control, &journal_dir, |progress| {
            if let Err(error) = progress.emit(&emit_app) {
                log::warn!("Failed to emit local eval build progress: {error}");
            }
        })
    })
    .await
    .map_err(|error| LocalEvalError::Join(error.to_string()).to_string())?
    .map_err(String::from)
}

#[tauri::command]
#[specta::specta]
pub fn cancel_local_lichess_eval_db(id: String) -> bool {
    build_control::cancel_build(&id)
}

#[tauri::command]
#[specta::specta]
pub async fn get_local_eval_build_job(
    app: tauri::AppHandle,
) -> Result<Option<LocalEvalBuildJob>, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("evaluation-download");
    tokio::task::spawn_blocking(move || get_build_job(&root))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn discard_local_eval_build_job(id: String, app: tauri::AppHandle) -> Result<(), String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("evaluation-download");
    tokio::task::spawn_blocking(move || discard_build_job(&root, &id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn review_local_eval_download(
    output_dir: String,
    disk_limit_gib: u16,
    app: tauri::AppHandle,
) -> Result<LocalEvalDownloadReview, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("evaluation-download");
    download::review(root, PathBuf::from(output_dir), disk_limit_gib).await
}

#[tauri::command]
#[specta::specta]
pub async fn start_local_eval_download(
    token: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("evaluation-download");
    download::start(root, token, move |progress| {
        if let Err(error) = progress.emit(&app) {
            log::warn!("Could not emit reviewed evaluation progress: {error}");
        }
    })
    .await
}

pub fn build_compact_eval_database<F>(
    options: LocalEvalBuildOptions,
    on_progress: F,
) -> Result<LocalEvalBuildReport, LocalEvalError>
where
    F: FnMut(LocalEvalBuildProgress),
{
    build_compact_eval_database_controlled(options, LocalEvalBuildControl::default(), on_progress)
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
    let shards_dir = store_dir.join(SHARDS_DIR);
    if !directory_present(&shards_dir)? {
        return Ok(None);
    }
    let path = shard_path(&shards_dir, shard);
    if !path.try_exists()? {
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
            .unwrap_or_else(|| format!("eval-build-{:032x}", rand::random::<u128>())),
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
    if manifest.format != FORMAT_NAME {
        return Err(LocalEvalError::InvalidDatabase(
            "unsupported evaluation format".into(),
        ));
    }
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
    let (hash_hi, hash_lo) = hash_fen(&fen_key);
    let records = position.evals.iter().filter_map(|eval| {
        let pvs = eval
            .pvs
            .iter()
            .take(max_pvs as usize)
            .filter_map(|pv| {
                let moves = pv
                    .line
                    .split_whitespace()
                    .take(u8::MAX as usize)
                    .map(encode_uci_move)
                    .collect::<Option<Vec<_>>>()?;
                if moves.is_empty() {
                    return None;
                }
                let (score, score_kind) = encode_score(pv)?;
                Some(CompactPv {
                    score,
                    score_kind,
                    moves,
                })
            })
            .collect::<Vec<_>>();
        if pvs.is_empty() {
            return None;
        }
        Some(CompactRecord {
            hash_hi,
            hash_lo,
            depth: eval.depth,
            knodes: eval.knodes.min(u32::MAX as u64) as u32,
            pvs,
        })
    });
    // Invalid candidates cannot out-rank a usable evaluation by raw PV count.
    Ok(records.max_by_key(|record| (record.pvs.len(), record.depth, record.knodes)))
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
    match (pv.cp, pv.mate) {
        (Some(cp), None) => Some((cp.clamp(i16::MIN as i32, i16::MAX as i32) as i16, 0)),
        (None, Some(mate)) => Some((mate, 1)),
        _ => None,
    }
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

fn shard_path(dir: &Path, shard: u16) -> PathBuf {
    dir.join(format!("{shard:04}.bin.zst"))
}

fn read_manifest(dir: &Path) -> Result<Option<LocalEvalManifest>, LocalEvalError> {
    if !directory_present(dir)? {
        return Ok(None);
    }
    let path = dir.join(MANIFEST_FILE);
    if !path.try_exists()? {
        return Ok(None);
    }
    let mut data = String::new();
    File::open(path)?
        .take(1024 * 1024 + 1)
        .read_to_string(&mut data)?;
    if data.len() > 1024 * 1024 {
        return Err(LocalEvalError::InvalidDatabase(
            "evaluation manifest exceeds 1 MiB".into(),
        ));
    }
    Ok(Some(serde_json::from_str(&data)?))
}

// Only confirmed absence is a missing installation. Never conceal a failed
// metadata check or a file occupying a corpus directory as an ordinary miss.
fn directory_present(path: &Path) -> Result<bool, LocalEvalError> {
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => Ok(true),
        Ok(_) => Err(LocalEvalError::InvalidDatabase(format!(
            "{} is not a directory",
            path.display()
        ))),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

#[cfg(test)]
fn write_manifest(dir: &Path, manifest: &LocalEvalManifest) -> Result<(), LocalEvalError> {
    let data = serde_json::to_string_pretty(manifest)?;
    fs::write(dir.join(MANIFEST_FILE), data)?;
    Ok(())
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
    let generation = {
        let cache = SHARD_CACHE.lock().expect("local eval shard cache poisoned");
        if let Some(bytes) = cache.entries.get(path) {
            return Ok(bytes.clone());
        }
        cache.generation
    };

    let bytes = Arc::new(read_shard_bytes(path, build_control::MAX_SHARD_BYTES)?);

    let mut cache = SHARD_CACHE.lock().expect("local eval shard cache poisoned");
    if cache.generation != generation {
        return Ok(bytes);
    }
    if let Some(current) = cache.entries.get(path) {
        return Ok(current.clone());
    }
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

fn read_shard_bytes(path: &Path, limit: u64) -> Result<Vec<u8>, LocalEvalError> {
    let decoder = zstd::Decoder::new(BufReader::new(File::open(path)?))?;
    let mut bytes = Vec::new();
    decoder
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(LocalEvalError::InvalidDatabase(format!(
            "evaluation shard exceeds its {limit} byte read bound"
        )));
    }
    Ok(bytes)
}

fn clear_shard_cache() {
    let mut cache = SHARD_CACHE.lock().expect("local eval shard cache poisoned");
    cache.entries.clear();
    cache.order.clear();
    cache.bytes = 0;
    cache.generation = cache.generation.wrapping_add(1);
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
#[path = "local_eval/build_safety_tests.rs"]
mod build_safety_tests;

#[cfg(test)]
#[path = "local_eval/build_limits_tests.rs"]
mod build_limits_tests;

#[cfg(test)]
mod tests {
    use super::*;

    const START_FEN: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    #[test]
    fn status_and_lookup_distinguish_missing_store_from_failed_access_check() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing");
        let absent = database_status(&missing);
        assert!(!absent.available);
        assert!(absent.error.is_none());
        assert!(lookup_eval(&missing, START_FEN, 1).unwrap().is_none());

        let invalid = dir.path().join("invalid\0store");
        let failed = database_status(&invalid);
        assert!(!failed.available);
        assert!(
            failed.error.is_some(),
            "a filesystem error is not an absent installation"
        );
        assert!(lookup_eval(&invalid, START_FEN, 1).is_err());
    }

    #[test]
    fn a_regular_file_is_not_a_missing_evaluation_folder() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("owner-fixture.txt");
        fs::write(&file, "synthetic source must survive").unwrap();
        let status = database_status(&file);
        assert!(!status.available);
        assert!(
            status.error.is_some(),
            "a file at the store path is not a missing folder"
        );
        assert!(lookup_eval(&file, START_FEN, 1).is_err());
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            "synthetic source must survive"
        );
    }

    #[test]
    fn valid_misses_stay_distinct_from_manifest_and_shard_read_errors() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("store");
        fs::create_dir(&store).unwrap();
        let manifest = LocalEvalManifest {
            format: "en-croissant-lichess-eval-compact".into(),
            version: FORMAT_VERSION,
            record_size: VARIABLE_RECORD_SIZE,
            shard_count: 16,
            max_pvs: 5,
            positions: 0,
            skipped: 0,
            source: "tiny synthetic fixture".into(),
            built_at: 1,
            complete: true,
        };
        write_manifest(&store, &manifest).unwrap();
        assert!(database_status(&store).available);
        assert!(lookup_eval(&store, START_FEN, 1).unwrap().is_none());

        let shards = store.join(SHARDS_DIR);
        fs::write(&shards, "synthetic blocker").unwrap();
        assert!(lookup_eval(&store, START_FEN, 1).is_err());
        assert_eq!(fs::read_to_string(&shards).unwrap(), "synthetic blocker");
        fs::remove_file(&shards).unwrap();
        fs::create_dir(&shards).unwrap();
        let fen_key = normalize_fen_key(START_FEN).unwrap();
        let (hash_hi, hash_lo) = hash_fen(&fen_key);
        let shard = shard_path(
            &shards,
            shard_for_hash(hash_hi, hash_lo, manifest.shard_count),
        );
        let mut empty_index = vec![0; 4];
        empty_index.extend_from_slice(V2_SHARD_MAGIC);
        fs::write(&shard, zstd::encode_all(empty_index.as_slice(), 1).unwrap()).unwrap();
        assert!(lookup_eval(&store, START_FEN, 1).unwrap().is_none());
        clear_shard_cache();
        fs::write(&shard, "not a compressed shard").unwrap();
        assert!(lookup_eval(&store, START_FEN, 1).is_err());

        fs::write(store.join(MANIFEST_FILE), "{").unwrap();
        assert!(database_status(&store).error.is_some());
        assert!(lookup_eval(&store, START_FEN, 1).is_err());
    }

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
