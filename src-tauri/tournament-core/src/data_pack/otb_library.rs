//! One mutable, app-owned collection of immutable public downloads. Transactions
//! commit retained games before any transport files are removed. Library PGNs and
//! the importer's independently populated cache are never touched.
use super::{
    install,
    jobs::{self, Entry, Job, State},
    Kind, Manifest, Source,
};
use crate::otb_packs;
use chrono::{Datelike, Utc};
use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

const DB: &str = "otb-archive-index-v2.sqlite3";
const OWNER: &[u8] = b"novelty-otb-rolling-library-v1\n";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Config {
    parent: PathBuf,
    keep_years: Option<u16>,
    enabled: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub managed: bool,
    pub downloaded: bool,
    pub enabled: bool,
    pub partially_enabled: bool,
    pub keep_years: Option<u16>,
    pub months: Vec<String>,
    pub bytes: u64,
    pub parent: String,
    pub imported_ids: Vec<String>,
    pub pending_ids: Vec<String>,
    pub maintenance_needed: bool,
}
fn config(root: &Path) -> Result<Option<Config>, String> {
    let path = root.join("otb-library.json");
    if !install::plain(&path, false)? {
        return Ok(None);
    }
    let value: Config = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    validate_years(value.keep_years)?;
    install::check_parent(&value.parent)?;
    Ok(Some(value))
}
fn validate_years(years: Option<u16>) -> Result<(), String> {
    if years.is_some_and(|n| ![1, 3, 5, 10].contains(&n)) {
        return Err("Choose 1, 3, 5, 10 years or all available games.".into());
    }
    Ok(())
}
pub fn cutoff(years: Option<u16>, year: i32, month: u32) -> String {
    years
        .map(|n| format!("{:04}-{:02}", year - i32::from(n), month))
        .unwrap_or_else(|| "2020-01".into())
}
fn current_cutoff(years: Option<u16>) -> String {
    let now = Utc::now();
    cutoff(years, now.year(), now.month())
}
fn location(config: &Config, create: bool) -> Result<PathBuf, String> {
    install::check_parent(&config.parent)?;
    let folder = config.parent.join("novelty-otb-library");
    if !install::plain(&folder, true)? {
        if !create {
            return Err("The downloaded games folder is missing.".into());
        }
        fs::create_dir(&folder).map_err(|e| e.to_string())?;
        fs::write(folder.join("OWNER"), OWNER).map_err(|e| e.to_string())?;
    }
    let owner = folder.join("OWNER");
    if !install::plain(&owner, false)? || fs::read(owner).map_err(|e| e.to_string())? != OWNER {
        return Err(
            "This folder does not belong to the OTB downloads. Its files were kept.".into(),
        );
    }
    for suffix in ["", "-journal", "-wal", "-shm"] {
        install::plain(&folder.join(format!("{DB}{suffix}")), false)?;
    }
    Ok(folder)
}

/// Only the owner-marked rolling collection belongs to download management.
pub(super) fn removal_paths(root: &Path) -> Result<Option<(PathBuf, PathBuf)>, String> {
    config(root)?
        .map(|c| location(&c, false).map(|folder| (folder.join(DB), root.join("otb-library.json"))))
        .transpose()
}
pub(super) fn disable_for_removal(root: &Path) -> Result<(), String> {
    if let Some(mut c) = config(root)? {
        c.enabled = false;
        otb_packs::atomic_json(&root.join("otb-library.json"), &c)?;
    }
    Ok(())
}
fn months(connection: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = connection
        .prepare("SELECT archive_url FROM archive_state ORDER BY archive_url")
        .map_err(|e| e.to_string())?;
    let urls = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    urls.map(|url| {
        let url = url.map_err(|e| e.to_string())?;
        otb_packs::archive_month(&url)
            .map(String::from)
            .ok_or("Unrecognized downloaded archive.".into())
    })
    .collect()
}
fn open_read(path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())
}
fn ids(connection: &Connection) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare("SELECT id FROM managed_pack ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}
fn legacy_entries(jobs: &[Job]) -> Result<Vec<(Entry, Job)>, String> {
    let catalog = jobs::catalog()?;
    Ok(jobs
        .iter()
        .filter_map(|job| {
            catalog
                .iter()
                .find(|e| e.id == job.id && e.kind == Kind::Otb)
                .map(|e| (e.clone(), job.clone()))
        })
        .collect())
}
pub fn status(root: &Path, cache: &Path, jobs: &[Job]) -> Result<Status, String> {
    let config = config(root)?;
    let selected = otb_packs::selected(cache)?;
    let entries = legacy_entries(jobs)?;
    let parent = config
        .as_ref()
        .map(|c| c.parent.clone())
        .or_else(|| entries.first().map(|(_, j)| PathBuf::from(&j.parent)))
        .unwrap_or(root.join("packs"));
    let mut view = Status {
        managed: config.is_some(),
        downloaded: false,
        enabled: false,
        partially_enabled: false,
        keep_years: config.as_ref().and_then(|c| c.keep_years),
        months: vec![],
        bytes: 0,
        parent: parent.display().to_string(),
        imported_ids: vec![],
        pending_ids: vec![],
        maintenance_needed: false,
    };
    if let Some(c) = config.as_ref() {
        let folder = location(c, false)?;
        let path = folder.join(DB);
        if !install::plain(&path, false)? {
            return Err("The saved OTB database is missing. Reconnect its drive or restore its files; your download settings were kept.".into());
        }
        {
            let db = open_read(&path)?;
            view.months = months(&db)?;
            if !view.months.is_empty() {
                otb_packs::validate_database(&path)?;
            }
            view.imported_ids = ids(&db)?;
            view.bytes = fs::metadata(&path).map_err(|e| e.to_string())?.len();
            // Report the importer registry, not merely the desired preference.
            view.enabled = !view.months.is_empty() && selected.contains(&path);
            let pruned: String = db
                .query_row(
                    "SELECT value FROM managed_meta WHERE key='cutoff'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or_default();
            view.maintenance_needed = pruned != current_cutoff(c.keep_years)
                || (!view.months.is_empty() && c.enabled != view.enabled);
        }
    }
    for (_, job) in &entries {
        let path = Path::new(&job.path).join(DB);
        if job.state == State::Ready && install::plain(&path, false)? {
            // Treat missing/unreadable files as unavailable, never as a checked download.
            let db = open_read(&path)?;
            let stored = months(&db)?;
            view.bytes += fs::metadata(&path).map_err(|e| e.to_string())?.len();
            if !view.managed {
                view.months.extend(stored);
                view.enabled |= selected.contains(&path);
            }
            view.pending_ids.push(job.id.clone());
        }
    }
    // A crash may have removed the source file but left encoded parts to clean up.
    {
        for (entry, job) in &entries {
            {
                let workspace = Path::new(&job.parent).join(&job.id);
                let manifest = workspace.join("pack.json");
                if install::plain(&manifest, false)?
                    && fs::metadata(&manifest).map_err(|e| e.to_string())?.len()
                        <= super::MANIFEST_BYTES
                {
                    let pack = Manifest::parse(
                        &fs::read(manifest).map_err(|e| e.to_string())?,
                        &entry.manifest_sha256,
                        &entry.id,
                        &Kind::Otb,
                    )?;
                    let mut pending = install::plain(&workspace.join("READY"), false)?;
                    for part in pack.parts {
                        let path = workspace.join("parts").join(part.name);
                        for path in [path.clone(), path.with_extension("zst.part")] {
                            if install::plain(&path, false)? {
                                pending = true;
                                view.bytes += fs::metadata(&path).map_err(|e| e.to_string())?.len();
                            }
                        }
                    }
                    if pending
                        && view.managed
                        && view.imported_ids.contains(&entry.id)
                        && !view.pending_ids.contains(&entry.id)
                    {
                        view.pending_ids.push(entry.id.clone());
                    }
                }
            }
        }
    }
    view.months.sort();
    if !view.managed && view.enabled {
        view.partially_enabled = entries.iter().any(|(_, job)| {
            job.state == State::Ready
                && Path::new(&job.path).join(DB).is_file()
                && !selected.contains(&Path::new(&job.path).join(DB))
        });
    }
    view.months.dedup();
    view.downloaded = !view.months.is_empty();
    view.maintenance_needed |= view.managed && !view.pending_ids.is_empty();
    Ok(view)
}
const SCHEMA: &str = "
PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
CREATE TABLE IF NOT EXISTS index_meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL) WITHOUT ROWID;
INSERT OR IGNORE INTO index_meta VALUES('schema_version',2);
CREATE TABLE IF NOT EXISTS archive_state(id INTEGER PRIMARY KEY,archive_url TEXT NOT NULL UNIQUE,indexed_at INTEGER NOT NULL,complete INTEGER NOT NULL,game_count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS player_name(id INTEGER PRIMARY KEY,normalized_name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS indexed_game(archive_id INTEGER NOT NULL,ordinal INTEGER NOT NULL,pgn_zstd BLOB NOT NULL,pgn_size INTEGER NOT NULL,white_name_id INTEGER,black_name_id INTEGER,white_fide_id TEXT,black_fide_id TEXT,PRIMARY KEY(archive_id,ordinal)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS indexed_game_white_name ON indexed_game(white_name_id,archive_id);
CREATE INDEX IF NOT EXISTS indexed_game_black_name ON indexed_game(black_name_id,archive_id);
CREATE INDEX IF NOT EXISTS indexed_game_white_fide ON indexed_game(white_fide_id,archive_id) WHERE white_fide_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS indexed_game_black_fide ON indexed_game(black_fide_id,archive_id) WHERE black_fide_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS managed_pack(id TEXT PRIMARY KEY,digest TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS managed_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) WITHOUT ROWID;";

fn merge(
    connection: &mut Connection,
    source: &Path,
    entry: &Entry,
    from: &str,
) -> Result<(), String> {
    otb_packs::validate_database(source)?;
    connection
        .execute(
            "ATTACH DATABASE ?1 AS incoming",
            [source.to_string_lossy().as_ref()],
        )
        .map_err(|e| e.to_string())?;
    let result = (|| {
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        let url =
            format!("https://database.lichess.org/broadcast/lichess_db_broadcast_{from}.pgn.zst");
        tx.execute("INSERT OR IGNORE INTO player_name(normalized_name) SELECT normalized_name FROM incoming.player_name",[]).map_err(|e|e.to_string())?;
        tx.execute("INSERT OR IGNORE INTO archive_state(archive_url,indexed_at,complete,game_count) SELECT archive_url,indexed_at,complete,game_count FROM incoming.archive_state WHERE archive_url>=?1",[&url]).map_err(|e|e.to_string())?;
        tx.execute("INSERT OR IGNORE INTO indexed_game SELECT a.id,g.ordinal,g.pgn_zstd,g.pgn_size,w.id,b.id,g.white_fide_id,g.black_fide_id FROM incoming.indexed_game g JOIN incoming.archive_state s ON s.id=g.archive_id JOIN archive_state a ON a.archive_url=s.archive_url LEFT JOIN incoming.player_name sw ON sw.id=g.white_name_id LEFT JOIN incoming.player_name sb ON sb.id=g.black_name_id LEFT JOIN player_name w ON w.normalized_name=sw.normalized_name LEFT JOIN player_name b ON b.normalized_name=sb.normalized_name WHERE s.archive_url>=?1",[&url]).map_err(|e|e.to_string())?;
        tx.execute("INSERT INTO managed_pack VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET digest=excluded.digest",params![entry.id,entry.manifest_sha256]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    })();
    connection
        .execute("DETACH DATABASE incoming", [])
        .map_err(|e| e.to_string())?;
    result
}
fn prune(connection: &mut Connection, from: &str) -> Result<(), String> {
    let tx = connection.transaction().map_err(|e| e.to_string())?;
    let url = format!("https://database.lichess.org/broadcast/lichess_db_broadcast_{from}.pgn.zst");
    tx.execute("DELETE FROM indexed_game WHERE archive_id IN (SELECT id FROM archive_state WHERE archive_url<?1)",[&url]).map_err(|e|e.to_string())?;
    tx.execute("DELETE FROM archive_state WHERE archive_url<?1", [&url])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM player_name WHERE id NOT IN (SELECT white_name_id FROM indexed_game WHERE white_name_id IS NOT NULL UNION SELECT black_name_id FROM indexed_game WHERE black_name_id IS NOT NULL)",[]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    // Reclaim physical pages; a failed vacuum is retried before recording this cutoff.
    connection
        .execute_batch("VACUUM")
        .map_err(|e| format!("Games were updated, but space could not yet be reclaimed: {e}"))?;
    connection.execute("INSERT INTO managed_meta VALUES('cutoff',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[from]).map_err(|e|e.to_string())?;
    Ok(())
}
fn source(entry: &Entry) -> Source {
    Source {
        id: entry.id.clone(),
        kind: Kind::Otb,
        manifest_sha256: entry.manifest_sha256.clone(),
        base_url: String::new(),
    }
}
fn verified_manifest(workspace: &install::Workspace, entry: &Entry) -> Result<Manifest, String> {
    let manifest_path = workspace.root.join("pack.json");
    if !install::plain(&manifest_path, false)?
        || fs::metadata(&manifest_path)
            .map_err(|e| e.to_string())?
            .len()
            > super::MANIFEST_BYTES
    {
        return Err(
            "The downloaded archive manifest is missing or invalid. Files were kept.".into(),
        );
    }
    Manifest::parse(
        &fs::read(manifest_path).map_err(|e| e.to_string())?,
        &entry.manifest_sha256,
        &entry.id,
        &Kind::Otb,
    )
}
fn verify_source(workspace: &install::Workspace, entry: &Entry) -> Result<(), String> {
    let pack = verified_manifest(workspace, entry)?;
    let file = pack.files.first().ok_or("Missing OTB archive file.")?;
    let path = workspace.root.join("data").join(DB);
    if !install::plain(&path, false)?
        || fs::metadata(&path).map_err(|e| e.to_string())?.len() != file.bytes
        || install::file_hash(&path, &std::sync::atomic::AtomicBool::new(false))? != file.sha256
    {
        return Err("The downloaded games changed. Their files were kept; restore this download before updating.".into());
    }
    Ok(())
}
/// Exact allowlist only. Never recurse or delete an owner's source/library folder.
fn cleanup(workspace: &install::Workspace, entry: &Entry) -> Result<(), String> {
    let pack = verified_manifest(workspace, entry)?;
    if install::plain(&workspace.root.join("data").join(DB), false)? {
        verify_source(workspace, entry)?;
    }
    let mut paths = vec![
        workspace.root.join("READY"),
        workspace.root.join("data").join(DB),
    ];
    for part in pack.parts {
        let path = workspace.root.join("parts").join(part.name);
        paths.push(path.with_extension("zst.part"));
        paths.push(path);
    }
    for path in &paths {
        install::plain(path, false)?;
    }
    for path in paths {
        if install::plain(&path, false)? {
            fs::remove_file(path).map_err(|e| {
                format!(
                    "Games are saved, but some temporary download files could not be removed: {e}"
                )
            })?;
        }
    }
    Ok(())
}
pub fn maintain(
    cache: &Path,
    preferences: Option<(Option<u16>, bool, PathBuf)>,
) -> Result<(), String> {
    jobs::with_idle_otb(|root, jobs| {
        let _import = otb_packs::import_lease(cache, true)?;
        let old = config(root)?;
        let c = match preferences {
            Some((keep_years, enabled, parent)) => Config {
                parent: old.as_ref().map(|c| c.parent.clone()).unwrap_or(parent),
                keep_years,
                enabled,
            },
            None => match old {
                Some(c) => c,
                None => return Ok(()),
            },
        };
        run_collection(root, cache, &c, legacy_entries(jobs)?)
    })
}
fn run_collection(
    root: &Path,
    cache: &Path,
    c: &Config,
    entries: Vec<(Entry, Job)>,
) -> Result<(), String> {
    validate_years(c.keep_years)?;
    // A saved configuration owns existing data. Never replace an unavailable
    // drive or deleted database with an empty collection during maintenance.
    if let Some(previous) = config(root)? {
        let folder = location(&previous, false)?;
        if !install::plain(&folder.join(DB), false)? {
            return Err("The saved OTB database is missing. Reconnect its drive or restore its files; your download settings were kept.".into());
        }
    }
    let folder = location(&c, true)?;
    let path = folder.join(DB);
    let mut db = Connection::open(&path).map_err(|e| e.to_string())?;
    db.busy_timeout(Duration::from_secs(2))
        .map_err(|e| e.to_string())?;
    db.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    let from = current_cutoff(c.keep_years);
    let mut changed = db
        .query_row(
            "SELECT value FROM managed_meta WHERE key='cutoff'",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap_or_default()
        != from;
    let mut workspaces = Vec::new();
    for (entry, job) in &entries {
        if job.state != State::Ready {
            continue;
        }
        let source_path = Path::new(&job.path).join(DB);
        if !install::Workspace::inspect(Path::new(&job.parent), &source(entry))? {
            continue;
        }
        let workspace = install::Workspace::open(Path::new(&job.parent), &source(entry))?;
        if Path::new(&job.path) != workspace.root.join("data") {
            return Err("The archive path does not match its owned download folder.".into());
        }
        let imported: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM managed_pack WHERE id=?1 AND digest=?2)",
                params![entry.id, entry.manifest_sha256],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if install::plain(&source_path, false)? {
            verify_source(&workspace, entry)?;
            let ready = workspace.root.join("READY");
            // A previously committed pack can finish cleanup after a crash removed READY.
            if !imported || install::plain(&ready, false)? {
                if !install::plain(&ready, false)?
                    || fs::read(&ready).map_err(|e| e.to_string())?
                        != entry.manifest_sha256.as_bytes()
                {
                    return Err("Finish verifying this archive before adding its games.".into());
                }
                if fs2::available_space(&folder).map_err(|e| e.to_string())?
                    < entry.installed_bytes.saturating_mul(2)
                        + fs::metadata(&path).map_err(|e| e.to_string())?.len()
                        + 256 * 1024 * 1024
                {
                    return Err("Not enough free space to prepare the downloaded games. Free some space and retry.".into());
                }
                merge(&mut db, &source_path, entry, &from)?;
                changed = true;
            }
            workspaces.push((entry, workspace));
        } else if imported {
            workspaces.push((entry, workspace));
        }
    }
    // Persist the requested policy before pruning. It remains visible and retryable on failure.
    otb_packs::atomic_json(&root.join("otb-library.json"), &c)?;
    if changed {
        prune(&mut db, &from)?;
        let invalid:i64=db.query_row("SELECT count(*) FROM archive_state a WHERE a.game_count!=(SELECT count(*) FROM indexed_game g WHERE g.archive_id=a.id)",[],|r|r.get(0)).map_err(|e|e.to_string())?;
        if invalid != 0 {
            return Err(
                "The saved game count could not be verified. Download files were kept.".into(),
            );
        }
    }
    let available = !months(&db)?.is_empty();
    let managed: Vec<_> = entries
        .iter()
        .map(|(_, j)| Path::new(&j.path).join(DB))
        .collect();
    otb_packs::select_collection(cache, &managed, &path, c.enabled && available)?;
    drop(db);
    for (entry, workspace) in workspaces {
        cleanup(&workspace, entry)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn downloaded_fixture(root: &Path) -> (Entry, Job, Config) {
        let parent = root.join("packs");
        fs::create_dir(&parent).unwrap();
        let seed = root.join("seed.sqlite3");
        let db = Connection::open(&seed).unwrap();
        db.execute_batch(SCHEMA).unwrap();
        db.execute("INSERT INTO player_name VALUES(1,'player')", [])
            .unwrap();
        for (id, m) in [(1, "2020-01"), (2, "2026-08")] {
            db.execute(
                "INSERT INTO archive_state VALUES(?1,?2,1,1,1)",
                params![
                    id,
                    format!(
                        "https://database.lichess.org/broadcast/lichess_db_broadcast_{m}.pgn.zst"
                    )
                ],
            )
            .unwrap();
            db.execute(
                "INSERT INTO indexed_game VALUES(?1,0,?2,4,1,1,'123','456')",
                params![id, vec![id as u8; 1024]],
            )
            .unwrap();
        }
        drop(db);
        let bytes = fs::read(&seed).unwrap();
        let digest = super::super::hash(&bytes);
        let id = "otb-2026-07-v1";
        let manifest=serde_json::to_vec(&serde_json::json!({"format":"novelty-data-pack","version":1,"id":id,"kind":"otb","license":"CC-BY-SA-4.0","attribution":super::super::OTB_ATTRIBUTION,"coverage":{"schemaVersion":2},"unpackedBytes":bytes.len(),"downloadBytes":bytes.len(),"files":[{"path":DB,"bytes":bytes.len(),"sha256":digest}],"parts":[{"name":format!("{id}-0000.part"),"encoding":"identity","bytes":bytes.len(),"sha256":digest,"decodedBytes":bytes.len(),"decodedSha256":digest,"segments":[{"file":0,"offset":0,"length":bytes.len()}]}]})).unwrap();
        let entry = Entry {
            id: id.into(),
            kind: Kind::Otb,
            title: String::new(),
            summary: String::new(),
            detail: String::new(),
            size_label: None,
            period_start: Some("2020-01".into()),
            period_end: Some("2026-08".into()),
            download_bytes: bytes.len() as u64,
            installed_bytes: bytes.len() as u64,
            manifest_sha256: super::super::hash(&manifest),
        };
        let workspace = install::Workspace::open(&parent, &source(&entry)).unwrap();
        fs::write(workspace.root.join("pack.json"), manifest).unwrap();
        fs::write(
            workspace.root.join("READY"),
            entry.manifest_sha256.as_bytes(),
        )
        .unwrap();
        fs::write(workspace.root.join("data").join(DB), &bytes).unwrap();
        fs::write(
            workspace.root.join("parts").join(format!("{id}-0000.part")),
            &bytes,
        )
        .unwrap();
        fs::write(
            workspace.root.join("parts").join("personal-notes.txt"),
            b"keep",
        )
        .unwrap();
        let job = Job {
            id: id.into(),
            state: State::Ready,
            parent: parent.display().to_string(),
            path: workspace.root.join("data").display().to_string(),
            phase: "ready".into(),
            completed_bytes: bytes.len() as u64,
            total_bytes: bytes.len() as u64,
            error: None,
            manifest_sha256: entry.manifest_sha256.clone(),
            retained_paths: vec![],
        };
        (
            entry,
            job,
            Config {
                parent,
                keep_years: Some(5),
                enabled: true,
            },
        )
    }
    #[test]
    fn collection_commits_before_cleanup_and_preserves_unmanaged_files_and_selection() {
        let tmp = tempfile::tempdir().unwrap();
        let (entry, job, mut c) = downloaded_fixture(tmp.path());
        let cache = tmp.path().join("cache");
        fs::create_dir(&cache).unwrap();
        let unrelated = cache.join("user-games.sqlite3");
        fs::write(&unrelated, b"user data").unwrap();
        otb_packs::atomic_json(
            &cache.join("otb-prepared.json"),
            &vec![unrelated.clone(), Path::new(&job.path).join(DB)],
        )
        .unwrap();
        run_collection(tmp.path(), &cache, &c, vec![(entry.clone(), job.clone())]).unwrap();
        let target = c.parent.join("novelty-otb-library").join(DB);
        let db = open_read(&target).unwrap();
        assert_eq!(months(&db).unwrap(), vec!["2026-08"]);
        assert_eq!(ids(&db).unwrap(), vec![entry.id.clone()]);
        drop(db);
        assert_eq!(
            otb_packs::selected(&cache).unwrap(),
            vec![unrelated.clone(), target.clone()]
        );
        assert!(!Path::new(&job.path).join(DB).exists());
        assert!(!c
            .parent
            .join(&job.id)
            .join("parts")
            .join(format!("{}-0000.part", job.id))
            .exists());
        assert_eq!(
            fs::read(c.parent.join(&job.id).join("parts/personal-notes.txt")).unwrap(),
            b"keep"
        );
        assert_eq!(fs::read(&unrelated).unwrap(), b"user data");
        let unchanged = fs::read(&target).unwrap();
        c.enabled = false;
        run_collection(tmp.path(), &cache, &c, vec![(entry, job)]).unwrap();
        assert_eq!(fs::read(target).unwrap(), unchanged);
        assert_eq!(otb_packs::selected(&cache).unwrap(), vec![unrelated]);
    }
    #[test]
    fn cleanup_recovers_after_committed_merge_loses_ready_marker() {
        let tmp = tempfile::tempdir().unwrap();
        let (entry, job, c) = downloaded_fixture(tmp.path());
        let cache = tmp.path().join("cache");
        let folder = location(&c, true).unwrap();
        let mut db = Connection::open(folder.join(DB)).unwrap();
        db.execute_batch(SCHEMA).unwrap();
        merge(
            &mut db,
            &Path::new(&job.path).join(DB),
            &entry,
            &current_cutoff(c.keep_years),
        )
        .unwrap();
        drop(db);
        fs::remove_file(c.parent.join(&job.id).join("READY")).unwrap();
        run_collection(tmp.path(), &cache, &c, vec![(entry, job.clone())]).unwrap();
        assert!(!Path::new(&job.path).join(DB).exists());
        assert_eq!(otb_packs::selected(&cache).unwrap(), vec![folder.join(DB)]);
    }
    #[test]
    fn changed_source_is_kept_and_never_selected_as_a_verified_collection() {
        let tmp = tempfile::tempdir().unwrap();
        let (entry, job, c) = downloaded_fixture(tmp.path());
        let cache = tmp.path().join("cache");
        let file = Path::new(&job.path).join(DB);
        fs::write(&file, b"changed user file").unwrap();
        assert!(run_collection(tmp.path(), &cache, &c, vec![(entry, job)]).is_err());
        assert_eq!(fs::read(file).unwrap(), b"changed user file");
        assert!(otb_packs::selected(&cache).unwrap().is_empty());
    }
    #[test]
    fn missing_managed_database_is_an_error_and_is_never_recreated() {
        let tmp = tempfile::tempdir().unwrap();
        let (entry, job, c) = downloaded_fixture(tmp.path());
        let cache = tmp.path().join("cache");
        run_collection(tmp.path(), &cache, &c, vec![(entry, job)]).unwrap();
        let target = c.parent.join("novelty-otb-library").join(DB);
        fs::rename(&target, target.with_extension("retained")).unwrap();
        let before = fs::read(tmp.path().join("otb-library.json")).unwrap();
        assert!(status(tmp.path(), &cache, &[])
            .err()
            .unwrap()
            .contains("missing"));
        assert!(run_collection(tmp.path(), &cache, &c, vec![])
            .err()
            .unwrap()
            .contains("missing"));
        assert!(!target.exists());
        assert_eq!(
            fs::read(tmp.path().join("otb-library.json")).unwrap(),
            before
        );
    }
    #[test]
    fn interrupted_selection_is_repairable_without_redownloading_or_enabling_an_opt_out() {
        let tmp = tempfile::tempdir().unwrap();
        let (entry, job, mut c) = downloaded_fixture(tmp.path());
        let cache = tmp.path().join("cache");
        run_collection(tmp.path(), &cache, &c, vec![(entry, job)]).unwrap();
        let target = c.parent.join("novelty-otb-library").join(DB);
        otb_packs::deactivate(&cache, target.parent().unwrap()).unwrap();
        let view = status(tmp.path(), &cache, &[]).unwrap();
        assert!(view.downloaded && !view.enabled && view.maintenance_needed);
        run_collection(tmp.path(), &cache, &c, vec![]).unwrap();
        assert!(status(tmp.path(), &cache, &[]).unwrap().enabled);
        c.enabled = false;
        run_collection(tmp.path(), &cache, &c, vec![]).unwrap();
        let view = status(tmp.path(), &cache, &[]).unwrap();
        assert!(view.downloaded && !view.enabled && !view.maintenance_needed);
    }
    #[test]
    fn rolling_years_use_calendar_month_and_validate_choices() {
        assert_eq!(cutoff(Some(5), 2026, 9), "2021-09");
        assert_eq!(cutoff(Some(1), 2027, 1), "2026-01");
        assert_eq!(cutoff(None, 2026, 9), "2020-01");
        assert!(validate_years(Some(0)).is_err());
    }
    #[test]
    fn merge_preserves_game_bytes_and_prune_physically_reclaims_old_months() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("source.sqlite3");
        let target = tmp.path().join("target.sqlite3");
        let db = Connection::open(&src).unwrap();
        db.execute_batch(SCHEMA).unwrap();
        db.execute("INSERT INTO player_name VALUES(1,'old'),(2,'kept')", [])
            .unwrap();
        for (id, month) in [(1, "2021-08"), (2, "2021-09"), (3, "2026-08")] {
            db.execute("INSERT INTO archive_state VALUES(?1,?2,1,1,1)",params![id,format!("https://database.lichess.org/broadcast/lichess_db_broadcast_{month}.pgn.zst")]).unwrap();
            db.execute(
                "INSERT INTO indexed_game VALUES(?1,0,?2,10,?3,2,'123',NULL)",
                params![id, vec![id as u8; 512 * 1024], if id == 1 { 1 } else { 2 }],
            )
            .unwrap();
        }
        drop(db);
        let before = fs::read(&src).unwrap();
        let mut out = Connection::open(&target).unwrap();
        out.execute_batch(SCHEMA).unwrap();
        let entry = Entry {
            id: "test".into(),
            kind: Kind::Otb,
            title: String::new(),
            summary: String::new(),
            detail: String::new(),
            size_label: None,
            period_start: None,
            period_end: None,
            download_bytes: 1,
            installed_bytes: 1,
            manifest_sha256: "a".repeat(64),
        };
        merge(&mut out, &src, &entry, "2020-01").unwrap();
        merge(&mut out, &src, &entry, "2020-01").unwrap();
        assert_eq!(
            out.query_row("SELECT count(*) FROM indexed_game", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            3
        );
        let large = fs::metadata(&target).unwrap().len();
        prune(&mut out, "2021-09").unwrap();
        assert_eq!(months(&out).unwrap(), vec!["2021-09", "2026-08"]);
        assert!(fs::metadata(&target).unwrap().len() < large);
        assert_eq!(
            out.query_row(
                "SELECT pgn_zstd FROM indexed_game WHERE archive_id=2",
                [],
                |r| r.get::<_, Vec<u8>>(0)
            )
            .unwrap(),
            vec![2; 512 * 1024]
        );
        assert_eq!(
            out.query_row(
                "SELECT count(*) FROM player_name WHERE normalized_name='old'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(fs::read(src).unwrap(), before);
        prune(&mut out, "2027-01").unwrap();
        assert!(months(&out).unwrap().is_empty());
    }
    #[test]
    fn ownership_and_import_leases_fail_closed() {
        let tmp = tempfile::tempdir().unwrap();
        let c = Config {
            parent: tmp.path().into(),
            keep_years: Some(5),
            enabled: true,
        };
        fs::create_dir(tmp.path().join("novelty-otb-library")).unwrap();
        assert!(location(&c, true).is_err());
        let reader = otb_packs::import_lease(tmp.path(), false).unwrap();
        assert!(otb_packs::import_lease(tmp.path(), true).is_err());
        drop(reader);
        let writer = otb_packs::import_lease(tmp.path(), true).unwrap();
        assert!(otb_packs::import_lease(tmp.path(), false).is_err());
        drop(writer);
    }
}
