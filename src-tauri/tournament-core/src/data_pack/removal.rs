//! Explicit, reviewed removal of downloaded data. Never recursively delete a folder.
use super::{install, jobs, otb_library, Kind, Manifest};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
    time::{Duration, Instant, SystemTime},
};

#[derive(Clone, Debug, PartialEq, Eq)]
struct FileState {
    path: PathBuf,
    bytes: u64,
    modified: SystemTime,
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct Snapshot {
    id: String,
    kind: Kind,
    stores: Vec<PathBuf>,
    files: Vec<FileState>,
    jobs: Vec<String>,
    shared: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub token: String,
    pub id: String,
    pub bytes: u64,
    pub paths: Vec<String>,
    pub shared: bool,
}
struct Pending {
    token: String,
    snapshot: Snapshot,
    at: Instant,
}
static PENDING: LazyLock<Mutex<Option<Pending>>> = LazyLock::new(|| Mutex::new(None));

/// Paths are resolved by native settings/catalog code, never accepted from the renderer.
pub struct Existing {
    pub kind: Kind,
    pub stores: Vec<PathBuf>,
}
struct Plan {
    snapshot: Snapshot,
    _workspaces: Vec<install::Workspace>,
}

fn add(files: &mut Vec<FileState>, path: PathBuf) -> Result<(), String> {
    for parent in path.parent().ok_or("Invalid data path")?.ancestors() {
        if !install::plain(parent, true)? {
            return Ok(());
        }
    }
    if install::plain(&path, false)? {
        let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
        files.push(FileState {
            path,
            bytes: meta.len(),
            modified: meta.modified().map_err(|e| e.to_string())?,
        });
    }
    Ok(())
}
fn database(files: &mut Vec<FileState>, path: &Path, kind: &Kind) -> Result<(), String> {
    if *kind == Kind::Evaluations {
        // Fixed format names only. Unknown files, backups and source exports stay untouched.
        let shards = path.join("shards");
        if install::plain(&shards, true)? {
            for entry in fs::read_dir(&shards).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let name = entry.file_name();
                let Some(name) = name.to_str() else {
                    continue;
                };
                if name.strip_suffix(".bin.zst").is_some_and(|n| {
                    n.len() == 4
                        && n.bytes().all(|b| b.is_ascii_digit())
                        && n.parse::<u16>().is_ok_and(|n| n < 8192)
                }) {
                    add(files, shards.join(name))?;
                }
            }
        }
        add(files, path.join("manifest.json"))?;
    } else {
        for suffix in ["-wal", "-shm", "-journal", ""] {
            add(files, PathBuf::from(format!("{}{suffix}", path.display())))?;
        }
    }
    Ok(())
}
fn plan(
    root: &Path,
    jobs: &[jobs::Job],
    id: &str,
    existing: Option<Existing>,
) -> Result<Plan, String> {
    let catalog = jobs::catalog()?;
    let kind = if id == "otb-library" {
        Kind::Otb
    } else {
        existing
            .as_ref()
            .map(|e| e.kind.clone())
            .or_else(|| catalog.iter().find(|e| e.id == id).map(|e| e.kind.clone()))
            .ok_or("Unknown downloaded database.")?
    };
    if kind == Kind::Otb && id != "otb-library" {
        return Err("Remove OTB games from the OTB importer downloads area.".into());
    }
    let mut snapshot = Snapshot {
        id: id.into(),
        kind: kind.clone(),
        stores: vec![],
        files: vec![],
        jobs: vec![],
        shared: existing.is_some(),
    };
    if let Some(existing) = existing {
        for path in existing.stores {
            database(&mut snapshot.files, &path, &kind)?;
            snapshot.stores.push(path);
        }
    }
    let mut workspaces = vec![];
    for job in jobs.iter().filter(|j| {
        j.id == id
            || (kind == Kind::Otb && catalog.iter().any(|e| e.id == j.id && e.kind == Kind::Otb))
    }) {
        let entry = catalog
            .iter()
            .find(|e| e.id == job.id)
            .ok_or("Unknown download record.")?;
        for path in std::iter::once(&job.path).chain(job.retained_paths.iter()) {
            let data = PathBuf::from(path);
            let parent = data
                .parent()
                .and_then(Path::parent)
                .ok_or("Invalid download path.")?;
            if data != parent.join(&job.id).join("data") {
                return Err("The saved download path changed. Files were kept.".into());
            }
            let source = jobs::source(entry);
            if !install::Workspace::inspect(parent, &source)? {
                continue;
            }
            let workspace = install::Workspace::open(parent, &source)?;
            let manifest = workspace.root.join("pack.json");
            if install::plain(&manifest, false)? {
                if fs::metadata(&manifest).map_err(|e| e.to_string())?.len() > super::MANIFEST_BYTES
                {
                    return Err("Download manifest is too large. Files were kept.".into());
                }
                let pack = Manifest::parse(
                    &fs::read(&manifest).map_err(|e| e.to_string())?,
                    &entry.manifest_sha256,
                    &entry.id,
                    &kind,
                )?;
                for file in pack.files {
                    add(&mut snapshot.files, data.join(&file.path))?;
                    add(
                        &mut snapshot.files,
                        data.join(format!("{}.partial", file.path)),
                    )?;
                }
                for part in pack.parts {
                    let p = workspace.root.join("parts").join(part.name);
                    add(&mut snapshot.files, p.with_extension("zst.part"))?;
                    add(&mut snapshot.files, p)?;
                }
            }
            let store = match kind {
                Kind::Rated => data.join("otb-archive-index-v2.sqlite3"),
                Kind::Broadcasts => data.join("opening.sqlite3"),
                Kind::Otb => data.join("otb-archive-index-v2.sqlite3"),
                Kind::Evaluations => data.clone(),
            };
            database(&mut snapshot.files, &store, &kind)?;
            snapshot.stores.push(store);
            add(&mut snapshot.files, workspace.root.join("READY"))?;
            // OWNER, LOCK and the immutable manifest remain as tiny recovery metadata.
            workspaces.push(workspace);
        }
        snapshot.jobs.push(job.id.clone());
    }
    if kind == Kind::Otb {
        if let Some((db, config)) = otb_library::removal_paths(root)? {
            database(&mut snapshot.files, &db, &kind)?;
            snapshot.stores.push(db);
            add(&mut snapshot.files, config)?;
        }
    }
    if snapshot.stores.is_empty() {
        return Err("This download is no longer available. Refresh the downloads list.".into());
    }
    snapshot.stores.sort();
    snapshot.stores.dedup();
    snapshot.files.sort_by(|a, b| a.path.cmp(&b.path));
    snapshot.files.dedup_by(|a, b| a.path == b.path);
    snapshot.jobs.sort();
    Ok(Plan {
        snapshot,
        _workspaces: workspaces,
    })
}

pub fn review(
    id: &str,
    cache: &Path,
    resolve: impl FnOnce() -> Result<Option<Existing>, String>,
) -> Result<Review, String> {
    jobs::with_removal(|root, jobs| {
        let _import = crate::otb_packs::import_lease(cache, true)?;
        let plan = plan(root, jobs, id, resolve()?)?;
        let mut token = [0u8; 16];
        getrandom::fill(&mut token).map_err(|e| e.to_string())?;
        let token = hex::encode(token);
        let view = Review {
            token: token.clone(),
            id: id.into(),
            bytes: plan.snapshot.files.iter().map(|f| f.bytes).sum(),
            paths: plan
                .snapshot
                .stores
                .iter()
                .map(|p| p.display().to_string())
                .collect(),
            shared: plan.snapshot.shared,
        };
        *PENDING.lock().map_err(|e| e.to_string())? = Some(Pending {
            token,
            snapshot: plan.snapshot,
            at: Instant::now(),
        });
        Ok((view, vec![]))
    })
}

pub fn remove(
    token: &str,
    cache: &Path,
    resolve: impl FnOnce(&str) -> Result<Option<Existing>, String>,
    deselect: impl FnOnce(&Kind, &[PathBuf]) -> Result<(), String>,
) -> Result<(), String> {
    let pending = PENDING
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .filter(|p| p.token == token && p.at.elapsed() < Duration::from_secs(15 * 60))
        .ok_or("Review this removal again before deleting files.")?;
    jobs::with_removal(|root, jobs| {
        let _import = crate::otb_packs::import_lease(cache, true)?;
        let current = plan(
            root,
            jobs,
            &pending.snapshot.id,
            resolve(&pending.snapshot.id)?,
        )?;
        if current.snapshot != pending.snapshot {
            return Err("The downloaded files changed. Review their removal again.".into());
        }
        // Stop referencing the files before deletion. Never implicitly select another store or web lookup.
        deselect(&current.snapshot.kind, &current.snapshot.stores)?;
        if current.snapshot.kind == Kind::Otb {
            otb_library::disable_for_removal(root)?;
            crate::otb_packs::select_collection(
                cache,
                &current.snapshot.stores,
                &root.join("unused-collection"),
                false,
            )?;
        }
        // Keep the rolling-library configuration until its database is gone so
        // a failed deletion remains discoverable and reviewable.
        let mut files: Vec<_> = current.snapshot.files.iter().collect();
        files.sort_by_key(|f| match f.path.file_name().and_then(|n| n.to_str()) {
            Some("otb-library.json" | "manifest.json") => 2,
            Some("READY") => 1,
            _ => 0,
        });
        for file in files {
            fs::remove_file(&file.path).map_err(|e| format!("Some downloaded files could not be removed. Review and retry the remaining files: {e}"))?;
        }
        Ok(((), current.snapshot.jobs))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reviewed_removal_rechecks_files_guards_imports_and_preserves_unrelated_data() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("downloads");
        let cache = temp.path().join("import-cache");
        jobs::configure(&root).unwrap();
        let db = temp.path().join("opening.sqlite3");
        let private = temp.path().join("library.sqlite3");
        fs::write(&db, b"download").unwrap();
        fs::write(&private, b"private games").unwrap();
        let resolve = || {
            Ok(Some(Existing {
                kind: Kind::Broadcasts,
                stores: vec![db.clone()],
            }))
        };
        let first = review("existing-broadcasts", &cache, resolve).unwrap();
        assert_eq!(first.bytes, 8);
        fs::write(&db, b"changed download").unwrap();
        let stale = remove(
            &first.token,
            &cache,
            |_| resolve(),
            |_, _| panic!("A stale review must not change selection"),
        );
        assert!(stale.unwrap_err().contains("changed"));
        assert!(db.exists());
        let reader = crate::otb_packs::import_lease(&cache, false).unwrap();
        assert!(review("existing-broadcasts", &cache, resolve)
            .unwrap_err()
            .contains("current OTB import"));
        drop(reader);
        let lease = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(root.join("job.lock"))
            .unwrap();
        fs2::FileExt::try_lock_exclusive(&lease).unwrap();
        assert!(review("existing-broadcasts", &cache, resolve)
            .unwrap_err()
            .contains("Another Novelty window"));
        drop(lease);
        let fresh = review("existing-broadcasts", &cache, resolve).unwrap();
        let refused = remove(
            &fresh.token,
            &cache,
            |_| resolve(),
            |_, _| Err("Cannot save selection".into()),
        );
        assert_eq!(refused.unwrap_err(), "Cannot save selection");
        assert!(db.exists());
        let fresh = review("existing-broadcasts", &cache, resolve).unwrap();
        remove(
            &fresh.token,
            &cache,
            |_| resolve(),
            |_, paths| {
                assert_eq!(paths, &[db.clone()]);
                assert!(db.exists());
                Ok(())
            },
        )
        .unwrap();
        assert!(!db.exists());
        assert_eq!(fs::read(&private).unwrap(), b"private games");
        assert!(remove(&fresh.token, &cache, |_| resolve(), |_, _| Ok(())).is_err());

        // The rolling OTB collection is independently owned; preserve the import
        // cache and already imported Library games while clearing its registration.
        let parent = root.join("packs");
        let folder = parent.join("novelty-otb-library");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("OWNER"), b"novelty-otb-rolling-library-v1\n").unwrap();
        let otb = folder.join("otb-archive-index-v2.sqlite3");
        fs::write(&otb, b"downloaded broadcast games").unwrap();
        fs::write(cache.join("independent-cache.sqlite3"), b"keep").unwrap();
        crate::otb_packs::atomic_json(
            &root.join("otb-library.json"),
            &serde_json::json!({"parent":parent,"keepYears":null,"enabled":true}),
        )
        .unwrap();
        crate::otb_packs::atomic_json(&cache.join("otb-prepared.json"), &vec![otb.clone()])
            .unwrap();
        let checked = review("otb-library", &cache, || Ok(None)).unwrap();
        remove(
            &checked.token,
            &cache,
            |_| Ok(None),
            |kind, _| {
                assert_eq!(*kind, Kind::Otb);
                Ok(())
            },
        )
        .unwrap();
        assert!(!otb.exists());
        assert!(!root.join("otb-library.json").exists());
        assert!(crate::otb_packs::selected(&cache).unwrap().is_empty());
        assert!(cache.join("independent-cache.sqlite3").exists());
        assert!(private.exists());

        let entry = jobs::catalog()
            .unwrap()
            .into_iter()
            .find(|e| e.kind == Kind::Otb)
            .unwrap();
        let previous_parent = temp.path().join("previous");
        fs::create_dir(&previous_parent).unwrap();
        let mut stores = vec![];
        for parent in [&parent, &previous_parent] {
            let workspace = install::Workspace::open(parent, &jobs::source(&entry)).unwrap();
            let data = workspace.root.join("data");
            fs::write(data.join("otb-archive-index-v2.sqlite3"), b"owned download").unwrap();
            fs::write(data.join("notes.txt"), b"keep").unwrap();
            stores.push(data);
        }
        let job = jobs::Job {
            id: entry.id.clone(),
            state: jobs::State::Ready,
            parent: parent.display().to_string(),
            path: stores[0].display().to_string(),
            phase: "ready".into(),
            completed_bytes: 0,
            total_bytes: 0,
            error: None,
            manifest_sha256: entry.manifest_sha256,
            retained_paths: vec![stores[1].display().to_string()],
        };
        let ledger = rusqlite::Connection::open(root.join("jobs.sqlite3")).unwrap();
        ledger
            .execute(
                "INSERT INTO pack_job(id,record) VALUES(?1,?2)",
                rusqlite::params![job.id, serde_json::to_string(&job).unwrap()],
            )
            .unwrap();
        let checked = review("otb-library", &cache, || Ok(None)).unwrap();
        assert_eq!(checked.paths.len(), 2);
        remove(&checked.token, &cache, |_| Ok(None), |_, _| Ok(())).unwrap();
        for data in stores {
            assert!(!data.join("otb-archive-index-v2.sqlite3").exists());
            assert!(data.join("notes.txt").exists());
        }
        assert!(jobs::status().unwrap().is_empty());
    }
    #[test]
    fn exact_database_files_preserve_other_files_and_detect_changes() {
        let temp = tempfile::tempdir().unwrap();
        let db = temp.path().join("opening.sqlite3");
        fs::write(&db, b"download").unwrap();
        fs::write(temp.path().join("private.pgn"), b"keep").unwrap();
        fs::write(temp.path().join("opening.sqlite3-wal"), b"wal").unwrap();
        let mut files = vec![];
        database(&mut files, &db, &Kind::Broadcasts).unwrap();
        assert_eq!(files.len(), 2);
        assert!(!files.iter().any(|f| f.path.ends_with("private.pgn")));
        fs::write(&db, b"changed download").unwrap();
        let mut changed = vec![];
        database(&mut changed, &db, &Kind::Broadcasts).unwrap();
        assert_ne!(files, changed);
    }
    #[test]
    fn evaluations_include_only_format_files() {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir(temp.path().join("shards")).unwrap();
        for (name, data) in [
            ("manifest.json", b"manifest".as_slice()),
            ("shards/0000.bin.zst", b"shard"),
            ("shards/8191.bin.zst", b"last shard"),
            ("shards/notes.txt", b"private"),
            ("backup.pgn", b"keep"),
        ] {
            fs::write(temp.path().join(name), data).unwrap();
        }
        let mut files = vec![];
        database(&mut files, temp.path(), &Kind::Evaluations).unwrap();
        assert_eq!(files.len(), 3);
        for f in files {
            fs::remove_file(f.path).unwrap();
        }
        assert!(temp.path().join("shards/notes.txt").exists());
        assert!(temp.path().join("backup.pgn").exists());
    }
    #[test]
    fn unexpected_file_types_are_refused() {
        let temp = tempfile::tempdir().unwrap();
        let db = temp.path().join("opening.sqlite3");
        fs::create_dir(&db).unwrap();
        assert!(database(&mut vec![], &db, &Kind::Broadcasts)
            .unwrap_err()
            .contains("unexpected file"));
    }
    #[test]
    fn unowned_pack_folders_are_preserved() {
        let temp = tempfile::tempdir().unwrap();
        let entry = jobs::catalog().unwrap().remove(0);
        let folder = temp.path().join(&entry.id);
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("OWNER"), b"someone else's files").unwrap();
        let job = jobs::Job {
            id: entry.id.clone(),
            state: jobs::State::Ready,
            parent: temp.path().display().to_string(),
            path: folder.join("data").display().to_string(),
            phase: "ready".into(),
            completed_bytes: 0,
            total_bytes: 0,
            error: None,
            manifest_sha256: entry.manifest_sha256,
            retained_paths: vec![],
        };
        assert!(plan(temp.path(), &[job], "otb-library", None)
            .err()
            .unwrap()
            .contains("does not belong"));
        assert!(folder.join("OWNER").exists());
    }
}
