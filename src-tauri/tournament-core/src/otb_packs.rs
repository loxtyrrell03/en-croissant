//! OTB-only prepared data. Trust monthly updates through the fixed publisher's
//! immutable GitHub release and GitHub-provided asset digest, never renderer URLs.
use crate::data_pack::{jobs::Entry, Kind, Manifest};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
static ROOT: Mutex<Option<PathBuf>> = Mutex::new(None);
static SELECTION: Mutex<()> = Mutex::new(());
const NAME: &str = "otb-archive-index-v2.sqlite3";
const REPOSITORY: &str = "loxtyrrell03/novelty-downloads";

pub fn configure(root: &Path) -> Result<(), String> {
    let mut saved = ROOT.lock().map_err(|e| e.to_string())?;
    if saved.as_ref().is_some_and(|p| p != root) {
        return Err("OTB catalog location changed.".into());
    }
    *saved = Some(root.to_path_buf());
    Ok(())
}
fn root() -> Result<PathBuf, String> {
    ROOT.lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("Download storage is not configured.".into())
}
pub fn extra_catalog() -> Result<Vec<Entry>, String> {
    let Some(root) = ROOT.lock().map_err(|e| e.to_string())?.clone() else {
        return Ok(vec![]);
    };
    let file = root.join("otb-catalog.json");
    if !file.exists() {
        return Ok(vec![]);
    }
    let bytes = fs::read(file).map_err(|e| e.to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err("OTB catalog is too large.".into());
    }
    let entries: Vec<Entry> = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if entries.len() > 120
        || entries
            .iter()
            .any(|e| e.kind != Kind::Otb || !valid_month_entry(e))
    {
        return Err("Invalid OTB update catalog.".into());
    }
    Ok(entries)
}
fn valid_month(month: &str) -> bool {
    let b = month.as_bytes();
    b.len() == 7
        && &b[..2] == b"20"
        && b[2..4].iter().all(u8::is_ascii_digit)
        && b[4] == b'-'
        && b[5..].iter().all(u8::is_ascii_digit)
        && ("01"..="12").contains(&&month[5..])
}
fn valid_month_entry(e: &Entry) -> bool {
    e.period_start.as_deref().is_some_and(|m| {
        valid_month(m) && e.period_end.as_deref() == Some(m) && e.id == format!("otb-{m}-v1")
    }) && e.manifest_sha256.len() == 64
        && e.manifest_sha256.bytes().all(|b| b.is_ascii_hexdigit())
        && e.download_bytes > 0
        && e.installed_bytes > 0
}
pub fn validate_database(path: &Path) -> Result<(), String> {
    let c = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    let version: i64 = c
        .query_row(
            "SELECT value FROM index_meta WHERE key='schema_version'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if version != 2 {
        return Err("Unsupported OTB search database.".into());
    }
    for query in [
        "SELECT archive_id,ordinal,pgn_zstd,pgn_size,white_name_id,black_name_id,white_fide_id,black_fide_id FROM indexed_game LIMIT 0",
        "SELECT id,normalized_name FROM player_name LIMIT 0",
        "SELECT id,archive_url,indexed_at,complete,game_count FROM archive_state LIMIT 0",
        "SELECT white_name_id FROM indexed_game INDEXED BY indexed_game_white_name LIMIT 0",
        "SELECT black_name_id FROM indexed_game INDEXED BY indexed_game_black_name LIMIT 0",
        "SELECT white_fide_id FROM indexed_game INDEXED BY indexed_game_white_fide WHERE white_fide_id IS NOT NULL LIMIT 0",
        "SELECT black_fide_id FROM indexed_game INDEXED BY indexed_game_black_fide WHERE black_fide_id IS NOT NULL LIMIT 0",
    ] { c.prepare(query).map_err(|e|format!("OTB search database schema: {e}"))?; }
    let mut stmt = c
        .prepare("SELECT archive_url,complete FROM archive_state")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut count = 0;
    for row in rows {
        let (url, complete) = row.map_err(|e| e.to_string())?;
        if complete != 1 || archive_month(&url).is_none() {
            return Err("The OTB pack contains an unsupported or incomplete archive.".into());
        }
        count += 1;
    }
    if count == 0 {
        return Err("The OTB search database is empty.".into());
    }
    Ok(())
}
pub(crate) fn archive_month(url: &str) -> Option<&str> {
    let m = url
        .strip_prefix("https://database.lichess.org/broadcast/lichess_db_broadcast_")?
        .strip_suffix(".pgn.zst")?;
    valid_month(m).then_some(m)
}
pub fn selected(cache: &Path) -> Result<Vec<PathBuf>, String> {
    let file = cache.join("otb-prepared.json");
    if !file.exists() {
        return Ok(vec![]);
    }
    let bytes = fs::read(file).map_err(|e| e.to_string())?;
    if bytes.len() > 128 * 1024 {
        return Err("OTB selection is too large.".into());
    }
    let paths: Vec<PathBuf> = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if paths.len() > 120 || paths.iter().any(|p| !p.is_absolute()) {
        return Err("Invalid OTB selection.".into());
    }
    Ok(paths)
}
pub fn activate(cache: &Path, folder: &Path) -> Result<(), String> {
    let _selection = SELECTION.lock().map_err(|e| e.to_string())?;
    let path = folder.join(NAME);
    validate_database(&path)?;
    let mut paths = selected(cache)?;
    if !paths.contains(&path) {
        paths.push(path);
    }
    if paths.len() > 120 {
        return Err("This OTB archive needs a newer consolidated snapshot.".into());
    }
    fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    atomic_json(&cache.join("otb-prepared.json"), &paths)
}
/// Disabling a prepared corpus never removes it or changes an in-flight import.
pub fn deactivate(cache: &Path, folder: &Path) -> Result<(), String> {
    let _selection = SELECTION.lock().map_err(|e| e.to_string())?;
    let path = folder.join(NAME);
    let mut paths = selected(cache)?;
    paths.retain(|selected| selected != &path);
    fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    atomic_json(&cache.join("otb-prepared.json"), &paths)
}
pub(crate) fn atomic_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let temp = path.with_extension(format!(
        "{}.tmp",
        format!(
            "{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        )
    ));
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| e.to_string())?;
    f.write_all(&serde_json::to_vec(value).map_err(|e| e.to_string())?)
        .and_then(|_| f.sync_all())
        .map_err(|e| e.to_string())?;
    drop(f);
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let wide = |p: &Path| {
            p.as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>()
        };
        if unsafe {
            MoveFileExW(
                wide(&temp).as_ptr(),
                wide(path).as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    #[cfg(not(windows))]
    fs::rename(&temp, path).map_err(|e| e.to_string())?;
    Ok(())
}
/// Selection changes are atomic and preserve every independently supplied cache.
pub(crate) fn select_collection(
    cache: &Path,
    managed: &[PathBuf],
    collection: &Path,
    enabled: bool,
) -> Result<(), String> {
    let _selection = SELECTION.lock().map_err(|e| e.to_string())?;
    let mut paths = selected(cache)?;
    paths.retain(|path| path != collection && !managed.contains(path));
    if enabled {
        validate_database(collection)?;
        paths.push(collection.to_owned());
    }
    fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    atomic_json(&cache.join("otb-prepared.json"), &paths)
}
/// Cross-process reader lease: maintenance must never remove files from an active import.
pub fn import_lease(cache: &Path, exclusive: bool) -> Result<fs::File, String> {
    fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(cache.join("otb-download-use.lock"))
        .map_err(|e| e.to_string())?;
    let locked = if exclusive {
        fs2::FileExt::try_lock_exclusive(&file)
    } else {
        fs2::FileExt::try_lock_shared(&file)
    };
    locked.map_err(|_| {
        if exclusive {
            "Wait for the current OTB import to finish before updating downloaded games."
        } else {
            "Downloaded games are being updated. Try this import again shortly."
        }
        .to_string()
    })?;
    Ok(file)
}
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    #[serde(default)]
    immutable: bool,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    size: u64,
    digest: Option<String>,
    browser_download_url: String,
}
fn read_limited(mut response: reqwest::blocking::Response, max: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > max {
        return Err("OTB update response is too large.".into());
    }
    Ok(bytes)
}
fn verified_entry(release: Release, month: &str, bytes: &[u8]) -> Result<Entry, String> {
    let id = format!("otb-{month}-v1");
    let tag = format!("data-{id}");
    if !valid_month(month)
        || release.tag_name != tag
        || release.draft
        || release.prerelease
        || !release.immutable
    {
        return Err("OTB update is not a published immutable snapshot.".into());
    }
    let expected = format!("https://github.com/{REPOSITORY}/releases/download/{tag}/manifest.json");
    let asset = release
        .assets
        .iter()
        .find(|a| a.name == "manifest.json" && a.browser_download_url == expected)
        .ok_or("OTB update manifest is missing.")?;
    let digest = asset
        .digest
        .as_deref()
        .and_then(|d| d.strip_prefix("sha256:"))
        .ok_or("OTB update has no publisher-verified digest.")?;
    if bytes.len() as u64 != asset.size {
        return Err("OTB update manifest size changed.".into());
    }
    let pack = Manifest::parse(bytes, digest, &id, &Kind::Otb)?;
    if pack.coverage["periodStart"] != month
        || pack.coverage["periodEnd"] != month
        || pack.coverage["schemaVersion"] != 2
    {
        return Err("OTB update coverage does not match its month.".into());
    }
    let sources = pack.coverage["sources"]
        .as_array()
        .ok_or("Missing OTB archive provenance.")?;
    if sources.len() != 1 || sources[0]["url"].as_str().and_then(archive_month) != Some(month) {
        return Err("Unexpected OTB archive provenance.".into());
    }
    Ok(Entry{id,kind:Kind::Otb,title:"OTB search database".into(),summary:format!("Lichess broadcasts · {month}"),detail:"Speeds up OTB imports for this archive month. New and other sources are still searched.".into(),size_label:None,period_start:Some(month.into()),period_end:Some(month.into()),download_bytes:pack.download_bytes,installed_bytes:pack.unpacked_bytes,manifest_sha256:digest.into()})
}
/// Small bounded check; a 404 means a snapshot is not published yet. Never
/// rewrites a known digest or interprets transport/rate-limit failures as no update.
pub fn check_updates() -> Result<usize, String> {
    let mut extra = extra_catalog()?;
    let mut entries: Vec<Entry> = serde_json::from_str(include_str!("../config/data-packs.json"))
        .map_err(|e| e.to_string())?;
    entries.extend(extra.clone());
    let end = entries
        .iter()
        .filter(|e| e.kind == Kind::Otb)
        .filter_map(|e| e.period_end.as_deref())
        .max()
        .ok_or("No OTB base snapshot is available.")?;
    if !valid_month(end) {
        return Err("Invalid OTB snapshot date.".into());
    }
    let mut year: u32 = end[..4].parse::<u32>().map_err(|e| e.to_string())?;
    let mut month: u32 = end[5..].parse::<u32>().map_err(|e| e.to_string())?;
    let client = reqwest::blocking::Client::builder()
        .user_agent("Novelty OTB data updates")
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;
    let current = chrono::Utc::now().format("%Y-%m").to_string();
    let mut added = 0;
    for _ in 0..12 {
        month += 1;
        if month == 13 {
            month = 1;
            year += 1;
        }
        let period = format!("{year:04}-{month:02}");
        if period >= current {
            break;
        }
        let tag = format!("data-otb-{period}-v1");
        let response = client
            .get(format!(
                "https://api.github.com/repos/{REPOSITORY}/releases/tags/{tag}"
            ))
            .send()
            .map_err(|e| e.to_string())?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            break;
        }
        let release: Release = serde_json::from_slice(&read_limited(
            response.error_for_status().map_err(|e| e.to_string())?,
            1024 * 1024,
        )?)
        .map_err(|e| e.to_string())?;
        // Construct the fixed URL ourselves, then verify GitHub returned that exact asset.
        let bytes = read_limited(
            client
                .get(format!(
                    "https://github.com/{REPOSITORY}/releases/download/{tag}/manifest.json"
                ))
                .send()
                .and_then(|r| r.error_for_status())
                .map_err(|e| e.to_string())?,
            crate::data_pack::MANIFEST_BYTES,
        )?;
        extra.push(verified_entry(release, &period, &bytes)?);
        added += 1;
        atomic_json(&root()?.join("otb-catalog.json"), &extra)?;
    }
    Ok(added)
}
#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    fn fixture() -> (Release, Vec<u8>) {
        let digest = hex::encode(Sha256::digest(b"data"));
        let bytes=serde_json::to_vec(&serde_json::json!({"format":"novelty-data-pack","version":1,"id":"otb-2026-08-v1","kind":"otb","license":"CC-BY-SA-4.0","attribution":crate::data_pack::OTB_ATTRIBUTION,"coverage":{"schemaVersion":2,"periodStart":"2026-08","periodEnd":"2026-08","sources":[{"url":"https://database.lichess.org/broadcast/lichess_db_broadcast_2026-08.pgn.zst","games":1}]},"unpackedBytes":4,"downloadBytes":4,"files":[{"path":NAME,"bytes":4,"sha256":digest}],"parts":[{"name":"otb-2026-08-v1-0000.part","encoding":"identity","bytes":4,"sha256":digest,"decodedBytes":4,"decodedSha256":digest,"segments":[{"file":0,"offset":0,"length":4}]}]})).unwrap();
        let release=Release{tag_name:"data-otb-2026-08-v1".into(),draft:false,prerelease:false,immutable:true,assets:vec![Asset{name:"manifest.json".into(),size:bytes.len() as u64,digest:Some(format!("sha256:{}",hex::encode(Sha256::digest(&bytes)))),browser_download_url:format!("https://github.com/{REPOSITORY}/releases/download/data-otb-2026-08-v1/manifest.json")}]};
        (release, bytes)
    }
    #[test]
    #[ignore = "Real factory artifact protocol acceptance; requires NOVELTY_OTB_FACTORY"]
    fn prepared_factory_manifest_and_database_match_native() {
        let root = PathBuf::from(std::env::var("NOVELTY_OTB_FACTORY").unwrap());
        let bytes = fs::read(root.join("manifest.json")).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let digest = hex::encode(Sha256::digest(&bytes));
        let pack =
            Manifest::parse(&bytes, &digest, value["id"].as_str().unwrap(), &Kind::Otb).unwrap();
        assert_eq!(
            pack.attribution.as_deref(),
            Some(crate::data_pack::OTB_ATTRIBUTION)
        );
        let db = PathBuf::from(std::env::var("NOVELTY_OTB_FACTORY_DB").unwrap());
        validate_database(&db).unwrap();
    }

    #[test]
    #[ignore = "Live publisher discovery, monthly download and activation in isolated temporary storage"]
    fn prepared_hosted_month_is_discovered_installed_and_activated() {
        let storage = tempfile::tempdir().unwrap();
        configure(storage.path()).unwrap();
        assert!(check_updates().unwrap() > 0);
        let entry = extra_catalog()
            .unwrap()
            .into_iter()
            .find(|e| e.id == "otb-2026-08-v1")
            .unwrap();
        assert_eq!(
            entry.manifest_sha256,
            "6603f75144782a69cde5b90283a882b5af2932c013df41cc3db78ac4a829afdf"
        );
        let parent = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let source = crate::data_pack::Source {
            id: entry.id.clone(),
            kind: entry.kind,
            manifest_sha256: entry.manifest_sha256,
            base_url: format!(
                "https://github.com/{REPOSITORY}/releases/download/data-{}",
                entry.id
            ),
        };
        let output = crate::data_pack::install(
            &source,
            parent.path(),
            &std::sync::atomic::AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        validate_database(&output.join(NAME)).unwrap();
        activate(cache.path(), &output).unwrap();
        assert_eq!(selected(cache.path()).unwrap(), vec![output.join(NAME)]);
        assert_eq!(
            fs::read_to_string(output.join("LICENSE.txt")).unwrap(),
            crate::data_pack::OTB_ATTRIBUTION
        );
        assert_eq!(check_updates().unwrap(), 0);
    }

    #[test]
    fn prepared_monthly_update_requires_immutable_publisher_digest_and_exact_month() {
        let (release, bytes) = fixture();
        assert_eq!(
            verified_entry(release, "2026-08", &bytes).unwrap().kind,
            Kind::Otb
        );
        let (mut release, bytes) = fixture();
        release.immutable = false;
        assert!(verified_entry(release, "2026-08", &bytes).is_err());
        let (mut release, bytes) = fixture();
        release.assets[0].digest = None;
        assert!(verified_entry(release, "2026-08", &bytes).is_err());
        let (mut release, bytes) = fixture();
        release.assets[0].browser_download_url = "https://example.com/manifest.json".into();
        assert!(verified_entry(release, "2026-08", &bytes).is_err());
        let (release, mut bytes) = fixture();
        bytes[10] ^= 1;
        assert!(verified_entry(release, "2026-08", &bytes).is_err());
        let (release, bytes) = fixture();
        assert!(verified_entry(release, "2026-09", &bytes).is_err());
    }
    #[test]
    fn prepared_months_reject_ambiguous_urls_and_dates() {
        for value in [
            "2026-00",
            "2026-13",
            "2026-1",
            "2026-😀",
            "../../x",
            "1900-01",
        ] {
            assert!(!valid_month(value));
        }
        assert_eq!(
            archive_month(
                "https://database.lichess.org/broadcast/lichess_db_broadcast_2026-08.pgn.zst"
            ),
            Some("2026-08")
        );
        assert!(archive_month(
            "https://database.lichess.org.evil.test/broadcast/lichess_db_broadcast_2026-08.pgn.zst"
        )
        .is_none());
    }
    #[test]
    fn prepared_selection_atomically_preserves_previous_paths() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("otb-prepared.json");
        let one = temp.path().join("one.sqlite3");
        let two = temp.path().join("two.sqlite3");
        atomic_json(&file, &vec![&one]).unwrap();
        atomic_json(&file, &vec![&one, &two]).unwrap();
        assert_eq!(selected(temp.path()).unwrap(), vec![one, two]);
    }
    #[test]
    fn disabling_preserves_files_and_other_selected_archives() {
        let temp = tempfile::tempdir().unwrap();
        let one = temp.path().join("one");
        let two = temp.path().join("two");
        for folder in [&one, &two] {
            fs::create_dir_all(folder).unwrap();
            fs::write(folder.join(NAME), b"retained archive").unwrap();
        }
        atomic_json(
            &temp.path().join("otb-prepared.json"),
            &vec![one.join(NAME), two.join(NAME)],
        )
        .unwrap();
        deactivate(temp.path(), &one).unwrap();
        assert_eq!(selected(temp.path()).unwrap(), vec![two.join(NAME)]);
        deactivate(temp.path(), &one).unwrap();
        deactivate(temp.path(), &two).unwrap();
        assert!(selected(temp.path()).unwrap().is_empty());
        for folder in [&one, &two] {
            assert_eq!(fs::read(folder.join(NAME)).unwrap(), b"retained archive");
        }
    }
}
