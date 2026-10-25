//! Read-only compatibility validation, then an explicit versioned preference change.
use super::*;
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalEvalSourceCandidate {
    pub token: String,
    pub store: LocalEvalDbStatus,
}

struct Candidate {
    view: LocalEvalSourceCandidate,
    profile: PathBuf,
    revision: String,
    fingerprint: String,
    at: Instant,
}
#[derive(Default)]
struct Choice {
    generation: u128,
    candidate: Option<Candidate>,
}
static CHOICE: Lazy<Mutex<Choice>> = Lazy::new(|| Mutex::new(Choice::default()));

fn plain(path: &Path, dir: bool) -> Result<fs::Metadata, String> {
    let meta = fs::symlink_metadata(path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("The evaluation folder contains a linked data entry. Choose the actual completed store.".into());
        }
    }
    if meta.file_type().is_symlink() || (dir && !meta.is_dir()) || (!dir && !meta.is_file()) {
        return Err("The evaluation folder contains an unexpected data entry.".into());
    }
    Ok(meta)
}

fn recognize(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("Choose an absolute path to an evaluation folder.".into());
    }
    let root = path
        .canonicalize()
        .map_err(|error| format!("Could not open that folder: {error}"))?;
    plain(&root, true)?;
    match fs::symlink_metadata(root.join(MANIFEST_FILE)) {
        Ok(_) => return Ok(root),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    let mut matches = Vec::new();
    for child in ["evaluations", "lichess-cloud-evals", "lichess/evaluations"] {
        match fs::symlink_metadata(root.join(child).join(MANIFEST_FILE)) {
            Ok(_) => matches.push(
                root.join(child)
                    .canonicalize()
                    .map_err(|error| error.to_string())?,
            ),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    matches.sort();
    matches.dedup();
    match matches.len() {
        1=>Ok(matches.remove(0)),
        0=>Err("Choose a completed evaluation store containing manifest.json and its shards folder. Your current selection was kept.".into()),
        _=>Err("This folder contains more than one evaluation store. Choose the exact store you want to use.".into()),
    }
}

fn inventory(
    path: &Path,
) -> Result<
    (
        LocalEvalDbStatus,
        String,
        LocalEvalManifest,
        Vec<(u16, PathBuf)>,
    ),
    String,
> {
    plain(path, true)?;
    let manifest_meta = plain(&path.join(MANIFEST_FILE), false)?;
    if manifest_meta.len() > 1024 * 1024 {
        return Err("The evaluation manifest is too large.".into());
    }
    let mut manifest_bytes = Vec::new();
    File::open(path.join(MANIFEST_FILE))
        .map_err(|error| error.to_string())?
        .take(1024 * 1024 + 1)
        .read_to_end(&mut manifest_bytes)
        .map_err(|error| error.to_string())?;
    if manifest_bytes.len() > 1024 * 1024 {
        return Err("The evaluation manifest is too large.".into());
    }
    let manifest: LocalEvalManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("The evaluation manifest could not be read: {error}"))?;
    validate_manifest(&manifest).map_err(String::from)?;
    if manifest.positions == 0 {
        return Err(
            "This evaluation store contains no positions. Your current selection was kept.".into(),
        );
    }
    let shards = path.join(SHARDS_DIR);
    plain(&shards, true)?;
    let mut files = Vec::new();
    let mut facts = Vec::new();
    let mut bytes = manifest_meta.len();
    for item in fs::read_dir(&shards).map_err(|error| error.to_string())? {
        let item = item.map_err(|error| error.to_string())?;
        let name = item.file_name();
        let name = name
            .to_str()
            .ok_or("The shard folder contains an unrecognized filename.")?;
        let number = name
            .strip_suffix(".bin.zst")
            .filter(|value| value.len() == 4 && value.bytes().all(|byte| byte.is_ascii_digit()))
            .and_then(|value| value.parse::<u16>().ok())
            .filter(|value| *value < manifest.shard_count)
            .ok_or("The shard folder contains unrecognized or incomplete files.")?;
        let meta = plain(&item.path(), false)?;
        if meta.len() == 0 {
            return Err("The shard folder contains an empty data file.".into());
        }
        bytes = bytes
            .checked_add(meta.len())
            .ok_or("Evaluation size overflow.")?;
        let modified = meta
            .modified()
            .map_err(|error| error.to_string())?
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?;
        facts.push((number, meta.len(), modified.as_nanos()));
        files.push((number, item.path()));
        if files.len() > manifest.shard_count as usize {
            return Err("The evaluation store contains too many shards.".into());
        }
    }
    if files.is_empty() {
        return Err(
            "This evaluation store has no data shards. Your current selection was kept.".into(),
        );
    }
    files.sort();
    facts.sort();
    let mut digest = Sha256::new();
    digest.update(&manifest_bytes);
    digest.update(serde_json::to_vec(&facts).map_err(|error| error.to_string())?);
    let fingerprint = format!("{:x}", digest.finalize());
    let status = LocalEvalDbStatus {
        available: true,
        path: path.display().to_string(),
        positions: manifest.positions,
        shard_count: manifest.shard_count,
        max_pvs: manifest.max_pvs,
        storage_bytes: bytes,
        built_at: (manifest.built_at > 0).then_some(manifest.built_at),
        source: (!manifest.source.is_empty()).then_some(manifest.source.clone()),
        error: None,
    };
    Ok((status, fingerprint, manifest, files))
}

fn sample(path: &Path, number: u16, manifest: &LocalEvalManifest) -> Result<String, String> {
    // Bound this explicit compatibility check; never scan/copy the full corpus.
    let bytes = read_shard_bytes(path, build_control::MAX_SHARD_BYTES).map_err(String::from)?;
    let valid = |record: &CompactRecord| -> Result<(), String> {
        if record.pvs.is_empty()
            || record.pvs.len() > manifest.max_pvs as usize
            || record.pvs.iter().any(|pv| decode_pv(pv).is_none())
            || shard_for_hash(record.hash_hi, record.hash_lo, manifest.shard_count) != number
        {
            return Err("The sample shard is incompatible with this evaluation store.".into());
        }
        Ok(())
    };
    let mut previous = None;
    if manifest.version == ROOT_ONLY_FORMAT_VERSION {
        if bytes.is_empty() || bytes.len() % ROOT_ONLY_RECORD_SIZE != 0 {
            return Err("The sample root-only shard has an invalid length.".into());
        }
        for raw in bytes.chunks_exact(ROOT_ONLY_RECORD_SIZE) {
            if raw[18] == 0 || raw[18] > MAX_STORED_PVS as u8 {
                return Err("The sample shard contains an invalid variation count.".into());
            }
            let record = unpack_root_only_record(raw);
            valid(&record)?;
            let key = (record.hash_hi, record.hash_lo);
            if previous.is_some_and(|old| old > key) {
                return Err("The sample shard is not sorted.".into());
            }
            previous = Some(key);
        }
    } else {
        let index = read_shard_index(&bytes).map_err(String::from)?;
        if index.count == 0 {
            return Err("The sample shard contains no positions.".into());
        }
        let mut end = 0;
        for position in 0..index.count as usize {
            let offset = read_index_offset(&bytes, &index, position).map_err(String::from)?;
            if offset != end {
                return Err("The sample shard has an inconsistent record index.".into());
            }
            let raw = record_at(&bytes, index.records_end, offset).map_err(String::from)?;
            let record = unpack_record(raw).map_err(String::from)?;
            valid(&record)?;
            end = offset + raw.len();
            let key = (record.hash_hi, record.hash_lo);
            if previous.is_some_and(|old| old > key) {
                return Err("The sample shard is not sorted.".into());
            }
            previous = Some(key);
        }
        if end != index.records_end {
            return Err("The sample shard has unindexed data.".into());
        }
    }
    Ok(format!("{:x}", Sha256::digest(&bytes)))
}

fn inspect(path: &Path) -> Result<(LocalEvalDbStatus, String), String> {
    let path = recognize(path)?;
    let (status, metadata, manifest, files) = inventory(&path)?;
    let sample = sample(&files[0].1, files[0].0, &manifest)?;
    // Recheck metadata after reading the sample, so a concurrent update is visible.
    if inventory(&path)?.1 != metadata {
        return Err("The evaluation folder changed while it was checked. Choose it again.".into());
    }
    Ok((status, format!("{metadata}:{sample}")))
}

pub(super) fn status(profile: &Path) -> Result<LocalEvalDbStatus, String> {
    let selection = source_selection::read(profile)?;
    let path = Path::new(&selection.path);
    let checked = (|| -> Result<Option<LocalEvalDbStatus>, String> {
        if read_manifest(path).map_err(String::from)?.is_none() {
            return Ok(None);
        }
        let canonical = path.canonicalize().map_err(|error| error.to_string())?;
        let (mut status, _, _, _) = inventory(&canonical)?;
        status.path = selection.path.clone();
        Ok(Some(status))
    })();
    match checked {
        Ok(Some(status)) => Ok(status),
        other => Ok(LocalEvalDbStatus {
            available: false,
            path: selection.path,
            positions: 0,
            shard_count: DEFAULT_SHARD_COUNT,
            max_pvs: DEFAULT_MAX_PVS,
            storage_bytes: 0,
            built_at: None,
            source: None,
            error: other.err(),
        }),
    }
}

pub(super) fn validate(
    profile: &Path,
    path: &Path,
    expected: &str,
) -> Result<LocalEvalSourceCandidate, String> {
    let generation = rand::random();
    {
        let mut choice = CHOICE
            .lock()
            .map_err(|_| "Folder selection is unavailable.")?;
        choice.generation = generation;
        choice.candidate = None;
    }
    if source_selection::read(profile)?.revision != expected {
        return Err(
            "The current evaluation folder changed. Refresh it before choosing again.".into(),
        );
    }
    let (store, fingerprint) = inspect(path)?;
    let view = LocalEvalSourceCandidate {
        token: format!("{:032x}", rand::random::<u128>()),
        store,
    };
    let mut choice = CHOICE
        .lock()
        .map_err(|_| "Folder selection is unavailable.")?;
    if choice.generation != generation {
        return Err("A newer folder choice replaced this check. Choose the folder again.".into());
    }
    choice.candidate = Some(Candidate {
        view: view.clone(),
        profile: profile.into(),
        revision: expected.into(),
        fingerprint,
        at: Instant::now(),
    });
    Ok(view)
}

pub(super) fn activate(profile: &Path, token: &str) -> Result<LocalEvalSourceSelection, String> {
    let (path, fingerprint, revision) = {
        let choice = CHOICE
            .lock()
            .map_err(|_| "Folder selection is unavailable.")?;
        let candidate = choice
            .candidate
            .as_ref()
            .filter(|value| {
                value.view.token == token
                    && value.profile == profile
                    && value.at.elapsed() < Duration::from_secs(900)
            })
            .ok_or("This folder check expired or changed. Choose the folder again.")?;
        (
            PathBuf::from(&candidate.view.store.path),
            candidate.fingerprint.clone(),
            candidate.revision.clone(),
        )
    };
    if inspect(&path)?.1 != fingerprint {
        return Err("The checked evaluation store changed. Choose the folder again; your current selection was kept.".into());
    }
    let mut choice = CHOICE
        .lock()
        .map_err(|_| "Folder selection is unavailable.")?;
    if !choice.candidate.as_ref().is_some_and(|value| {
        value.view.token == token && value.at.elapsed() < Duration::from_secs(900)
    }) {
        return Err("A newer folder choice replaced this check. Choose the folder again.".into());
    }
    let selected = source_selection::save(profile, &revision, &path)?;
    choice.candidate = None;
    clear_shard_cache();
    Ok(selected)
}

#[cfg(test)]
#[path = "source_tests.rs"]
mod tests;
