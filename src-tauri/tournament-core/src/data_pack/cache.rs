//! Only exact encoded-part names in an owned, completed pack may be removed.
use super::{install, Manifest, Source};
use std::{
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

#[derive(Clone, Debug, PartialEq, Eq)]
struct FileState {
    path: PathBuf,
    bytes: u64,
    modified: SystemTime,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Snapshot {
    files: Vec<FileState>,
}
impl Snapshot {
    pub(super) fn bytes(&self) -> u64 {
        self.files.iter().map(|file| file.bytes).sum()
    }
    pub(super) fn count(&self) -> usize {
        self.files.len()
    }
}

fn inspect(workspace: &install::Workspace, source: &Source) -> Result<Snapshot, String> {
    let marker = workspace.root.join("READY");
    let manifest = workspace.root.join("pack.json");
    if !install::plain(&marker, false)?
        || fs::metadata(&marker).map_err(|e| e.to_string())?.len() != 64
        || fs::read(marker).map_err(|e| e.to_string())? != source.manifest_sha256.as_bytes()
    {
        return Err("Finish this download before removing its cache.".into());
    }
    if !install::plain(&manifest, false)?
        || fs::metadata(&manifest).map_err(|e| e.to_string())?.len() > 2 * 1024 * 1024
    {
        return Err(
            "The completed pack manifest is missing or invalid. Its cache was kept.".into(),
        );
    }
    let pack = Manifest::parse(
        &fs::read(manifest).map_err(|e| e.to_string())?,
        &source.manifest_sha256,
        &source.id,
        &source.kind,
    )?;
    // Preserve recovery material if a completed file is visibly missing or truncated.
    // Full integrity is checked during installation, not implied by this size check.
    for file in &pack.files {
        let path = workspace.root.join("data").join(&file.path);
        for parent in path
            .parent()
            .unwrap()
            .ancestors()
            .take_while(|path| *path != workspace.root)
        {
            if !install::plain(parent, true)? {
                return Err(
                    "The installed copy is incomplete. Its download cache was kept.".into(),
                );
            }
        }
        if !install::plain(&path, false)?
            || fs::metadata(&path).map_err(|e| e.to_string())?.len() != file.bytes
        {
            return Err("The installed copy is incomplete. Its download cache was kept.".into());
        }
    }
    let mut files = Vec::new();
    for part in &pack.parts {
        let path = workspace.root.join("parts").join(&part.name);
        for path in [path.clone(), path.with_extension("zst.part")] {
            if install::plain(&path, false)? {
                let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
                if metadata.len() > part.bytes {
                    return Err(
                        "A cached file has changed unexpectedly. Its files were kept.".into(),
                    );
                }
                files.push(FileState {
                    path,
                    bytes: metadata.len(),
                    modified: metadata.modified().map_err(|e| e.to_string())?,
                });
            }
        }
    }
    Ok(Snapshot { files })
}

fn workspace(source: &Source, parent: &Path) -> Result<install::Workspace, String> {
    if !install::Workspace::inspect(parent, source)? {
        return Err("The downloaded pack folder is missing.".into());
    }
    install::Workspace::open(parent, source)
}
pub(super) fn review(source: &Source, parent: &Path) -> Result<Snapshot, String> {
    inspect(&workspace(source, parent)?, source)
}
pub(super) fn remove_reviewed(
    source: &Source,
    parent: &Path,
    reviewed: &Snapshot,
) -> Result<(), String> {
    let workspace = workspace(source, parent)?;
    let current = inspect(&workspace, source)?;
    if &current != reviewed {
        return Err("The download cache changed. Review it again before removing files.".into());
    }
    // No recursive removal, database deletion, or unknown filename enumeration.
    // A partial filesystem failure remains visible; a fresh review sees what remains.
    for file in current.files {
        fs::remove_file(file.path).map_err(|e| {
            format!("Some cached files could not be removed. Review the remaining cache: {e}")
        })?;
    }
    Ok(())
}
