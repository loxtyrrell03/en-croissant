//! Pinned Stockfish assets. Only an explicit install downloads files; discovery
//! and validation never launch an engine or modify existing installations.
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

const RECEIPT: &str = "en-croissant-stockfish.json";
const UPGRADE_RECEIPT: &str = "stockfish-default-upgrade-19.json";
const REQUIRED_SOURCE: &[&str] = &[
    "Copying.txt",
    "AUTHORS",
    "src/Makefile",
    "src/engine.cpp",
    "scripts/net.sh",
    "wiki/Compiling-from-source.md",
];
pub type Progress = Arc<dyn Fn(f32) + Send + Sync>;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub name: String,
    pub bytes: u64,
    pub sha256: String,
    pub executable_sha256: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Release {
    version: String,
    base_url: String,
    assets: BTreeMap<String, Asset>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Receipt {
    version: String,
    archive_sha256: String,
    executable_sha256: String,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InstalledStockfish {
    pub path: String,
    pub version: String,
}

pub fn asset_for_arch(arch: &str) -> Option<Asset> {
    release().assets.remove(arch)
}
pub fn current_asset() -> Option<Asset> {
    if !cfg!(windows) {
        return None;
    }
    asset_for_arch(match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        _ => return None,
    })
}

/// Separate from the profile array: deleting/reordering a profile after upgrade
/// is an owner choice and must not cause the next launch to repeat activation.
pub fn upgrade_is_complete(engines_dir: &Path) -> Result<bool, String> {
    let bytes = match fs::read(engines_dir.join(UPGRADE_RECEIPT)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.to_string()),
    };
    let receipt: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| {
        "Saved Stockfish upgrade state is unreadable; it was preserved.".to_string()
    })?;
    if receipt.get("version").and_then(|v| v.as_str()) != Some("19") {
        return Err("Saved Stockfish upgrade state is unknown; it was preserved.".into());
    }
    Ok(true)
}

pub fn complete_upgrade(engines_dir: &Path, expected_profile_sha256: &str) -> Result<(), String> {
    if !engines_dir.is_absolute() {
        return Err("Choose an absolute engines directory.".into());
    }
    if upgrade_is_complete(engines_dir)? {
        return Ok(());
    }
    let profiles = engines_dir.join("engines.json");
    let bytes = fs::read(&profiles).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| {
        "Saved engine profiles are unreadable; upgrade was not acknowledged.".to_string()
    })?;
    if !value.is_array() || format!("{:x}", Sha256::digest(&bytes)) != expected_profile_sha256 {
        return Err("Saved engine profiles changed; upgrade was not acknowledged.".into());
    }
    let mut receipt = tempfile::Builder::new()
        .prefix(".stockfish-upgrade-")
        .tempfile_in(engines_dir)
        .map_err(|e| e.to_string())?;
    receipt
        .write_all(b"{\"version\":\"19\"}\n")
        .map_err(|e| e.to_string())?;
    receipt.as_file().sync_all().map_err(|e| e.to_string())?;
    if fs::read(&profiles).map_err(|e| e.to_string())? != bytes {
        return Err("Saved engine profiles changed; upgrade was not acknowledged.".into());
    }
    // This version's completion record is immutable. A concurrent/unknown file
    // is never overwritten, and a later manual engine reversion stays intact.
    match receipt.persist_noclobber(engines_dir.join(UPGRADE_RECEIPT)) {
        Ok(_) => Ok(()),
        Err(_) if upgrade_is_complete(engines_dir)? => Ok(()),
        Err(error) => Err(format!(
            "Stockfish upgrade acknowledgement could not be saved: {error}"
        )),
    }
}
fn release() -> Release {
    serde_json::from_str(include_str!("../../config/stockfish-release.json"))
        .expect("checked-in Stockfish release manifest")
}
fn check_cancel(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) {
        Err("Stockfish installation cancelled.".into())
    } else {
        Ok(())
    }
}
fn digest(path: &Path, cancel: &AtomicBool) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        check_cancel(cancel)?;
        let size = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if size == 0 {
            break;
        }
        hash.update(&buffer[..size]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn executable(asset: &Asset) -> String {
    asset.name.replace(".zip", ".exe")
}
fn validate_tree(root: &Path, asset: &Asset, cancel: &AtomicBool) -> Result<String, String> {
    for file in REQUIRED_SOURCE {
        if !root.join(file).is_file() {
            return Err(format!("Stockfish source/notices are missing: {file}"));
        }
    }
    let hash = digest(&root.join(executable(asset)), cancel)?;
    if asset
        .executable_sha256
        .as_ref()
        .is_some_and(|pinned| *pinned != hash)
    {
        return Err("Stockfish executable failed its pinned SHA-256 check.".into());
    }
    Ok(hash)
}
/// A receipt is created only after authenticating the entire upstream archive.
/// Its executable digest detects a changed installed/bundled leaf thereafter.
pub fn verified_install(root: &Path, asset: &Asset) -> Result<Option<InstalledStockfish>, String> {
    let receipt_file = root.join(RECEIPT);
    if !receipt_file.try_exists().map_err(|e| e.to_string())? {
        if root.try_exists().map_err(|e| e.to_string())? {
            return Err(
                "Stockfish installation receipt is missing; existing files were preserved.".into(),
            );
        }
        return Ok(None);
    }
    let receipt: Receipt =
        serde_json::from_slice(&fs::read(receipt_file).map_err(|e| e.to_string())?)
            .map_err(|_| "Stockfish installation receipt is unreadable.".to_string())?;
    if receipt.version != release().version || receipt.archive_sha256 != asset.sha256 {
        return Err("Stockfish installation receipt does not match the pinned release.".into());
    }
    let actual = validate_tree(root, asset, &AtomicBool::new(false))?;
    if actual != receipt.executable_sha256 {
        return Err("Installed Stockfish files have changed.".into());
    }
    Ok(Some(InstalledStockfish {
        path: root.join(executable(asset)).to_string_lossy().into_owned(),
        version: receipt.version,
    }))
}

/// Prefer an already-registered copy of the exact pinned executable, including
/// a renamed user install. This reads bytes only and never launches the file.
pub fn verified_existing_executable(
    path: &Path,
    asset: &Asset,
) -> Result<Option<InstalledStockfish>, String> {
    if !path.is_absolute() || !path.try_exists().map_err(|e| e.to_string())? {
        return Ok(None);
    }
    let Some(expected) = asset.executable_sha256.as_ref() else {
        return verified_install(path.parent().ok_or("Missing engine parent.")?, asset)
            .map(|result| result.filter(|engine| Path::new(&engine.path) == path));
    };
    if !path.is_file() || fs::metadata(path).map_err(|e| e.to_string())?.len() > 256 * 1024 * 1024 {
        return Ok(None);
    }
    if digest(path, &AtomicBool::new(false))? != *expected {
        return Ok(None);
    }
    Ok(Some(InstalledStockfish {
        path: path.to_string_lossy().into_owned(),
        version: release().version,
    }))
}

pub fn discover(
    engines_dir: &Path,
    resource_dir: &Path,
    asset: &Asset,
) -> Result<Option<InstalledStockfish>, String> {
    // Packaged resources are immutable inputs. Missing Dev resources leave the
    // default migration pending; discovery never fetches or starts a process.
    if let Some(engine) = verified_install(&resource_dir.join("engines/stockfish-19"), asset)? {
        return Ok(Some(engine));
    }
    if !engines_dir.try_exists().map_err(|e| e.to_string())? {
        return Ok(None);
    }
    let mut roots = fs::read_dir(engines_dir)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    roots.sort_by_key(|entry| entry.file_name());
    for entry in roots {
        if !entry
            .file_name()
            .to_string_lossy()
            .starts_with("stockfish-19-")
            || !entry.file_type().map_err(|e| e.to_string())?.is_dir()
        {
            continue;
        }
        // Preserve changed installs; one must not mask another intact copy.
        if let Ok(Some(engine)) = verified_install(&entry.path(), asset) {
            return Ok(Some(engine));
        }
    }
    Ok(None)
}

pub fn install_archive(
    archive: &Path,
    engines_dir: &Path,
    asset: &Asset,
    cancel: &AtomicBool,
    progress: &dyn Fn(f32),
) -> Result<InstalledStockfish, String> {
    check_cancel(cancel)?;
    if !engines_dir.is_absolute() {
        return Err("Choose an absolute engines directory.".into());
    }
    if fs::metadata(archive).map_err(|e| e.to_string())?.len() != asset.bytes
        || digest(archive, cancel)? != asset.sha256
    {
        return Err("Stockfish archive failed its pinned size/SHA-256 check.".into());
    }
    fs::create_dir_all(engines_dir).map_err(|e| e.to_string())?;
    let stage = tempfile::Builder::new()
        .prefix(".stockfish-stage-")
        .tempdir_in(engines_dir)
        .map_err(|e| e.to_string())?;
    let expanded = stage.path().join("expanded");
    let mut zip = zip::ZipArchive::new(fs::File::open(archive).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if zip.len() > 4096 {
        return Err("Stockfish archive has too many entries.".into());
    }
    let entries = zip.len();
    let mut unpacked = 0u64;
    for index in 0..entries {
        check_cancel(cancel)?;
        let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
        // Check the original name before the ZIP/path libraries normalize
        // separators or collapse a parent component inside the staging root.
        if entry.name().contains([':', '\\']) || entry.name().split('/').any(|part| part == "..") {
            return Err("Unsafe path/link in Stockfish archive.".into());
        }
        let relative = entry
            .enclosed_name()
            .ok_or("Unsafe path in Stockfish archive.")?;
        if relative.components().any(|component| {
            component
                .as_os_str()
                .to_string_lossy()
                .contains([':', '\\'])
        }) || entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("Unsafe path/link in Stockfish archive.".into());
        }
        unpacked = unpacked
            .checked_add(entry.size())
            .ok_or("Stockfish archive is too large.")?;
        if unpacked > 256 * 1024 * 1024 {
            return Err("Stockfish archive is too large.".into());
        }
        let output = expanded.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(output).map_err(|e| e.to_string())?;
        } else {
            fs::create_dir_all(output.parent().ok_or("Missing archive parent.")?)
                .map_err(|e| e.to_string())?;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(output)
                .map_err(|e| e.to_string())?;
            let mut buffer = [0; 64 * 1024];
            loop {
                check_cancel(cancel)?;
                let size = entry.read(&mut buffer).map_err(|e| e.to_string())?;
                if size == 0 {
                    break;
                }
                file.write_all(&buffer[..size]).map_err(|e| e.to_string())?;
            }
            file.sync_all().map_err(|e| e.to_string())?;
        }
        progress(65.0 + 25.0 * (index + 1) as f32 / entries.max(1) as f32);
    }
    let tree = expanded.join("stockfish");
    let receipt = Receipt {
        version: release().version,
        archive_sha256: asset.sha256.clone(),
        executable_sha256: validate_tree(&tree, asset, cancel)?,
    };
    let receipt_bytes = serde_json::to_vec_pretty(&receipt).map_err(|e| e.to_string())?;
    let mut receipt_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(tree.join(RECEIPT))
        .map_err(|e| e.to_string())?;
    receipt_file
        .write_all(&receipt_bytes)
        .map_err(|e| e.to_string())?;
    receipt_file.sync_all().map_err(|e| e.to_string())?;
    drop(receipt_file);
    check_cancel(cancel)?;
    let stable = engines_dir.join(format!("stockfish-19-{}", &asset.sha256[..12]));
    if let Ok(Some(existing)) = verified_install(&stable, asset) {
        return Ok(existing);
    }
    // Never replace an owner's changed directory or follow its links.
    let destination = if stable.try_exists().map_err(|e| e.to_string())? {
        engines_dir.join(format!(
            "stockfish-19-{}-{}",
            &asset.sha256[..12],
            stage.path().file_name().unwrap().to_string_lossy()
        ))
    } else {
        stable
    };
    fs::rename(&tree, &destination)
        .map_err(|e| format!("Stockfish could not be published: {e}"))?;
    progress(95.0);
    Ok(InstalledStockfish {
        path: destination
            .join(executable(asset))
            .to_string_lossy()
            .into_owned(),
        version: receipt.version,
    })
}

/// Only explicit installation uses the network. Output is streamed into a
/// private temporary file; cancellation, stall/error and checksum failure leave
/// prior engines intact and drop only this operation's temporary output.
pub async fn install(
    engines_dir: PathBuf,
    asset: Asset,
    cancel: Arc<AtomicBool>,
    progress: Progress,
) -> Result<InstalledStockfish, String> {
    if !engines_dir.is_absolute() {
        return Err("Choose an absolute engines directory.".into());
    }
    check_cancel(&cancel)?;
    let stable = engines_dir.join(format!("stockfish-19-{}", &asset.sha256[..12]));
    if let Ok(Some(existing)) = verified_install(&stable, &asset) {
        return Ok(existing);
    }
    fs::create_dir_all(&engines_dir).map_err(|e| e.to_string())?;
    let mut downloaded = tempfile::Builder::new()
        .prefix(".stockfish-download-")
        .tempfile_in(&engines_dir)
        .map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let cancelled = async {
        while !cancel.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        Err::<(), String>("Stockfish installation cancelled.".into())
    };
    tokio::pin!(cancelled);
    let response = tokio::select! {
        result = tokio::time::timeout(Duration::from_secs(15), client.get(format!("{}/{}", release().base_url, asset.name)).send()) => result.map_err(|_| "Stockfish server did not respond.".to_string())?.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?,
        result = &mut cancelled => { result?; return Err("Stockfish installation cancelled.".into()); }
    };
    if response
        .content_length()
        .is_some_and(|length| length != asset.bytes)
    {
        return Err("Stockfish download size does not match the pinned release.".into());
    }
    let mut stream = response.bytes_stream();
    let mut received = 0u64;
    loop {
        let next = tokio::select! {
            result = tokio::time::timeout(Duration::from_secs(15), stream.next()) => result.map_err(|_| "Stockfish download stalled.".to_string())?,
            result = &mut cancelled => { result?; return Err("Stockfish installation cancelled.".into()); }
        };
        let Some(next) = next else {
            break;
        };
        let chunk = next.map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        if received > asset.bytes {
            return Err("Stockfish download exceeds its pinned size.".into());
        }
        downloaded.write_all(&chunk).map_err(|e| e.to_string())?;
        progress(65.0 * received as f32 / asset.bytes as f32);
    }
    downloaded.as_file().sync_all().map_err(|e| e.to_string())?;
    let archive = downloaded.path().to_owned();
    let install_cancel = cancel.clone();
    let result = tokio::task::spawn_blocking(move || {
        install_archive(
            &archive,
            &engines_dir,
            &asset,
            &install_cancel,
            progress.as_ref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?;
    drop(downloaded);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;

    fn fixture(root: &Path, missing_source: bool, extra: Option<&str>) -> (PathBuf, Asset) {
        let archive = root.join("synthetic.zip");
        let mut zip = zip::ZipWriter::new(fs::File::create(&archive).unwrap());
        let executable = "stockfish-windows-x86-64-universal.exe";
        for file in std::iter::once(executable).chain(REQUIRED_SOURCE.iter().copied()) {
            if missing_source && file == "src/engine.cpp" {
                continue;
            }
            zip.start_file(format!("stockfish/{file}"), SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"synthetic Stockfish fixture").unwrap();
        }
        if let Some(extra) = extra {
            zip.start_file(extra, SimpleFileOptions::default()).unwrap();
            zip.write_all(b"must not escape").unwrap();
        }
        zip.finish().unwrap();
        let cancel = AtomicBool::new(false);
        let exe_hash = format!("{:x}", Sha256::digest(b"synthetic Stockfish fixture"));
        let asset = Asset {
            name: executable.replace(".exe", ".zip"),
            bytes: fs::metadata(&archive).unwrap().len(),
            sha256: digest(&archive, &cancel).unwrap(),
            executable_sha256: Some(exe_hash),
        };
        (archive, asset)
    }
    fn entries(root: &Path) -> Vec<String> {
        let mut names = fs::read_dir(root)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        names.sort();
        names
    }
    #[test]
    fn pinned_release_and_architecture_do_not_depend_on_cpu_instruction_guesses() {
        let x64 = asset_for_arch("x64").unwrap();
        assert_eq!(release().version, "19");
        assert!(x64.name.ends_with("universal.zip"));
        assert_eq!(x64.bytes, 81_431_614);
        assert_eq!(
            x64.sha256,
            "3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7"
        );
        assert!(asset_for_arch("arm64").unwrap().name.contains("arm64"));
        assert!(asset_for_arch("unsupported").is_none());
    }
    #[test]
    fn an_existing_renamed_current_executable_is_verified_without_repointing_or_running_it() {
        let root = tempfile::tempdir().unwrap();
        let (_, asset) = fixture(root.path(), false, None);
        let renamed = root.path().join("owner-name.exe");
        fs::write(&renamed, b"synthetic Stockfish fixture").unwrap();
        assert_eq!(
            verified_existing_executable(&renamed, &asset)
                .unwrap()
                .unwrap()
                .path,
            renamed.to_string_lossy()
        );
        fs::write(&renamed, b"different owner executable").unwrap();
        assert!(verified_existing_executable(&renamed, &asset)
            .unwrap()
            .is_none());
        assert_eq!(fs::read(&renamed).unwrap(), b"different owner executable");
    }
    #[test]
    fn completion_requires_saved_profile_identity_and_survives_manual_reversion() {
        let root = tempfile::tempdir().unwrap();
        assert!(!upgrade_is_complete(root.path()).unwrap());
        assert!(complete_upgrade(root.path(), "missing").is_err());
        fs::write(root.path().join("engines.json"), b"[]").unwrap();
        assert!(complete_upgrade(root.path(), &"0".repeat(64)).is_err());
        assert!(!upgrade_is_complete(root.path()).unwrap());
        let hash = format!("{:x}", Sha256::digest(b"[]"));
        complete_upgrade(root.path(), &hash).unwrap();
        let receipt = fs::read(root.path().join(UPGRADE_RECEIPT)).unwrap();
        fs::write(
            root.path().join("engines.json"),
            b"[{\"name\":\"Owner reversion\"}]",
        )
        .unwrap();
        complete_upgrade(root.path(), "previous identity").unwrap();
        assert!(upgrade_is_complete(root.path()).unwrap());
        assert_eq!(
            fs::read(root.path().join(UPGRADE_RECEIPT)).unwrap(),
            receipt
        );
        assert_eq!(entries(root.path()), ["engines.json", UPGRADE_RECEIPT]);
    }
    #[test]
    fn unreadable_or_unknown_completion_state_is_preserved() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("engines.json"), b"[]").unwrap();
        let hash = format!("{:x}", Sha256::digest(b"[]"));
        for bytes in [b"not-json".as_slice(), b"{\"version\":\"20\"}"] {
            fs::write(root.path().join(UPGRADE_RECEIPT), bytes).unwrap();
            assert!(upgrade_is_complete(root.path()).is_err());
            assert!(complete_upgrade(root.path(), &hash).is_err());
            assert_eq!(fs::read(root.path().join(UPGRADE_RECEIPT)).unwrap(), bytes);
            assert_eq!(entries(root.path()), ["engines.json", UPGRADE_RECEIPT]);
        }
    }
    #[test]
    fn malformed_profile_bytes_cannot_be_acknowledged_even_with_their_own_hash() {
        let root = tempfile::tempdir().unwrap();
        for bytes in [b"not-json".as_slice(), b"{\"profiles\":[]}"] {
            fs::write(root.path().join("engines.json"), bytes).unwrap();
            let hash = format!("{:x}", Sha256::digest(bytes));
            assert!(complete_upgrade(root.path(), &hash).is_err());
            assert!(!upgrade_is_complete(root.path()).unwrap());
            assert_eq!(fs::read(root.path().join("engines.json")).unwrap(), bytes);
        }
    }
    #[test]
    fn authenticated_complete_install_is_reused_and_changed_files_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let (archive, asset) = fixture(root.path(), false, None);
        let engines = root.path().join("engines");
        let cancel = AtomicBool::new(false);
        let first = install_archive(&archive, &engines, &asset, &cancel, &|_| {}).unwrap();
        let installed = Path::new(&first.path).parent().unwrap();
        for source in REQUIRED_SOURCE {
            assert!(installed.join(source).is_file());
        }
        assert_eq!(
            discover(&engines, &root.path().join("absent-resources"), &asset)
                .unwrap()
                .unwrap()
                .path,
            first.path
        );
        assert_eq!(
            install_archive(&archive, &engines, &asset, &cancel, &|_| {})
                .unwrap()
                .path,
            first.path
        );
        assert_eq!(entries(&engines).len(), 1);
        fs::write(&first.path, b"changed owner bytes").unwrap();
        assert!(verified_install(installed, &asset).is_err());
        let repaired = install_archive(&archive, &engines, &asset, &cancel, &|_| {}).unwrap();
        assert_ne!(repaired.path, first.path);
        assert_eq!(fs::read(&first.path).unwrap(), b"changed owner bytes");
        assert_eq!(entries(&engines).len(), 2);
    }
    #[test]
    fn checksum_and_source_failures_never_publish_or_replace_owner_data() {
        let root = tempfile::tempdir().unwrap();
        let (archive, mut asset) = fixture(root.path(), false, None);
        let engines = root.path().join("engines");
        fs::create_dir(&engines).unwrap();
        fs::write(engines.join("owner-engine.exe"), b"owner bytes").unwrap();
        let cancel = AtomicBool::new(false);
        asset.sha256 = "0".repeat(64);
        assert!(
            install_archive(&archive, &engines, &asset, &cancel, &|_| {})
                .unwrap_err()
                .contains("SHA-256")
        );
        let (archive, asset) = fixture(root.path(), true, None);
        assert!(
            install_archive(&archive, &engines, &asset, &cancel, &|_| {})
                .unwrap_err()
                .contains("source/notices")
        );
        assert_eq!(entries(&engines), ["owner-engine.exe"]);
        assert_eq!(
            fs::read(engines.join("owner-engine.exe")).unwrap(),
            b"owner bytes"
        );
    }
    #[test]
    fn cancellation_before_and_during_extraction_removes_only_private_output() {
        let root = tempfile::tempdir().unwrap();
        let (archive, asset) = fixture(root.path(), false, None);
        let engines = root.path().join("engines");
        fs::create_dir(&engines).unwrap();
        fs::write(engines.join("engines.json"), b"owner preferences").unwrap();
        let cancel = AtomicBool::new(true);
        assert!(
            install_archive(&archive, &engines, &asset, &cancel, &|_| {})
                .unwrap_err()
                .contains("cancelled")
        );
        cancel.store(false, Ordering::SeqCst);
        let during_extraction = install_archive(&archive, &engines, &asset, &cancel, &|_| {
            cancel.store(true, Ordering::SeqCst);
        });
        assert!(during_extraction.unwrap_err().contains("cancelled"));
        assert_eq!(entries(&engines), ["engines.json"]);
        assert_eq!(
            fs::read(engines.join("engines.json")).unwrap(),
            b"owner preferences"
        );
    }
    #[test]
    fn traversal_and_windows_drive_paths_are_not_rewritten_into_an_install() {
        for unsafe_name in [
            "../escaped.txt",
            "stockfish/C:/escaped.txt",
            "stockfish/..\\escaped.txt",
        ] {
            let root = tempfile::tempdir().unwrap();
            let (archive, asset) = fixture(root.path(), false, Some(unsafe_name));
            let engines = root.path().join("engines");
            assert!(
                install_archive(&archive, &engines, &asset, &AtomicBool::new(false), &|_| {})
                    .is_err(),
                "{unsafe_name}"
            );
            assert!(entries(&engines).is_empty());
            assert!(!root.path().join("escaped.txt").exists());
        }
    }
    #[test]
    fn missing_bundle_stays_missing_and_a_changed_bundle_is_not_accepted() {
        let root = tempfile::tempdir().unwrap();
        let (archive, asset) = fixture(root.path(), false, None);
        let engines = root.path().join("engines");
        let resources = root.path().join("resources");
        assert!(discover(&engines, &resources, &asset).unwrap().is_none());
        assert!(!engines.exists());
        let missing_receipt = resources.join("engines/stockfish-19");
        fs::create_dir_all(&missing_receipt).unwrap();
        assert!(discover(&engines, &resources, &asset).is_err());
        fs::remove_dir(&missing_receipt).unwrap(); // Exact empty fixture directory.
        let result =
            install_archive(&archive, &engines, &asset, &AtomicBool::new(false), &|_| {}).unwrap();
        let bundle = resources.join("engines/stockfish-19");
        fs::create_dir_all(bundle.parent().unwrap()).unwrap();
        fs::rename(Path::new(&result.path).parent().unwrap(), &bundle).unwrap();
        assert!(discover(&engines, &resources, &asset).unwrap().is_some());
        fs::write(bundle.join(executable(&asset)), b"changed bundle").unwrap();
        assert!(discover(&engines, &resources, &asset).is_err());
    }
}
