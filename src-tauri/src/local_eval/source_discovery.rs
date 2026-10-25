//! Read-only default discovery. A saved selection always bypasses this module.
use super::*;
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};

struct Checked {
    stamp: String,
    at: Instant,
    selection: LocalEvalSourceSelection,
}
static CHECKED: Lazy<Mutex<Option<Checked>>> = Lazy::new(|| Mutex::new(None));
const RECHECK: Duration = Duration::from_secs(30);

pub(super) fn shared_at(base: &Path, platform: &str) -> Option<PathBuf> {
    let family = match platform {
        "windows" | "macos" => "ChessData",
        "linux" => "chess-data",
        _ => return None,
    };
    Some(base.join(family).join("lichess/evaluations"))
}

// Only confirmed absence/emptiness allows falling through to another root.
fn empty(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(true),
        Err(error) => return Err(format!("Could not check evaluation data: {error}")),
        Ok(_) => {}
    }
    let metadata =
        fs::metadata(path).map_err(|error| format!("Could not open evaluation data: {error}"))?;
    if !metadata.is_dir() {
        return Err("The evaluation folder path is occupied by another kind of file.".into());
    }
    Ok(fs::read_dir(path)
        .map_err(|error| format!("Could not read the evaluation folder: {error}"))?
        .next()
        .transpose()
        .map_err(|error| format!("Could not check the evaluation folder: {error}"))?
        .is_none())
}

fn error(path: &Path, detail: String) -> LocalEvalSourceSelection {
    let revision = format!(
        "auto:{:x}",
        Sha256::digest(format!("{}\0{detail}", path.display()))
    );
    LocalEvalSourceSelection {
        path: path.display().to_string(),
        revision,
        discovery_error: Some(detail),
    }
}

// This cheap identity check runs on every read. Full bounded compatibility
// validation is coalesced and rechecked periodically, not for every position.
fn stamp(path: &Path) -> Result<(PathBuf, String), String> {
    let root = path.canonicalize().map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    digest.update(root.to_string_lossy().as_bytes());
    for (relative, directory) in [("", true), (MANIFEST_FILE, false), (SHARDS_DIR, true)] {
        let metadata = super::source::plain(&root.join(relative), directory)?;
        digest.update(format!(
            "{relative}:{:?}:{:?}:{}",
            metadata.modified(),
            metadata.created(),
            metadata.len()
        ));
    }
    let mut manifest = Vec::new();
    File::open(root.join(MANIFEST_FILE))
        .map_err(|error| error.to_string())?
        .take(1024 * 1024 + 1)
        .read_to_end(&mut manifest)
        .map_err(|error| error.to_string())?;
    if manifest.len() > 1024 * 1024 {
        return Err("The evaluation manifest is too large.".into());
    }
    digest.update(manifest);
    Ok((root, format!("{:x}", digest.finalize())))
}

fn checked(path: &Path) -> LocalEvalSourceSelection {
    let (root, identity) = match stamp(path) {
        Ok(value) => value,
        Err(detail) => return error(path, detail),
    };
    let mut cache = match CHECKED.lock() {
        Ok(cache) => cache,
        Err(_) => {
            return error(
                path,
                "Evaluation discovery is temporarily unavailable.".into(),
            )
        }
    };
    if let Some(previous) = cache.as_ref() {
        if previous.stamp == identity
            && previous.selection.discovery_error.is_none()
            && previous.at.elapsed() < RECHECK
        {
            return previous.selection.clone();
        }
    }
    let selected = match super::source::inspect(&root) {
        Ok((_, fingerprint)) => match stamp(path) {
            Ok((again, after)) if again == root && after == identity => LocalEvalSourceSelection {
                path: root.display().to_string(),
                revision: format!(
                    "auto:{:x}",
                    Sha256::digest(format!("{identity}:{fingerprint}"))
                ),
                discovery_error: None,
            },
            _ => error(
                path,
                "The evaluation store changed while it was recognized. Retry the check.".into(),
            ),
        },
        Err(detail) => error(&root, detail),
    };
    if cache
        .as_ref()
        .is_some_and(|previous| previous.selection != selected)
    {
        clear_shard_cache();
    }
    *cache = Some(Checked {
        stamp: identity,
        at: Instant::now(),
        selection: selected.clone(),
    });
    selected
}

pub(super) fn select(profile: &Path, shared: &Path) -> LocalEvalSourceSelection {
    let legacy = profile.join("lichess-cloud-evals");
    match empty(&legacy) {
        Ok(false) => return checked(&legacy),
        Err(detail) => return error(&legacy, detail),
        Ok(true) => {}
    }
    match empty(shared) {
        Ok(false) => checked(shared),
        Err(detail) => error(shared, detail),
        Ok(true) => source_selection::default_selection(profile),
    }
}

#[cfg(test)]
#[path = "discovery_tests.rs"]
mod tests;
