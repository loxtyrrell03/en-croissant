use super::*;
use crate::transfer::download_with_size;
use reqwest::blocking::Client;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

/// This must come from a trusted catalog, never from a renderer-provided URL or
/// a checksum fetched alongside an untrusted manifest.
#[derive(Clone)]
pub struct Source {
    pub id: String,
    pub kind: Kind,
    pub manifest_sha256: String,
    pub base_url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: &'static str,
    pub completed_bytes: u64,
    pub total_bytes: u64,
}

fn cancelled(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        Err("Data pack download cancelled. Downloaded parts are kept for resume.".into())
    } else {
        Ok(())
    }
}

/// Retry only transient provider failures, keeping the transfer's verified parts
/// and Range resume behavior. Integrity, permission and disk errors stay visible.
pub(super) fn retry_part<T>(
    cancel: &AtomicBool,
    mut transfer: impl FnMut() -> Result<T, String>,
) -> Result<T, String> {
    for attempt in 0..4 {
        cancelled(cancel)?;
        match transfer() {
            Ok(value) => return Ok(value),
            Err(error) => {
                let status = error
                    .strip_prefix("Archive request returned HTTP ")
                    .and_then(|value| value.split_whitespace().next())
                    .and_then(|value| value.parse::<u16>().ok());
                if attempt == 3 || !matches!(status, Some(500 | 502 | 503 | 504)) {
                    return Err(error);
                }
                let started = Instant::now();
                while started.elapsed() < Duration::from_secs(1 << attempt) {
                    cancelled(cancel)?;
                    std::thread::sleep(Duration::from_millis(50));
                }
            }
        }
    }
    unreachable!()
}

fn io(error: std::io::Error) -> String {
    error.to_string()
}

pub(super) fn plain(path: &Path, directory: bool) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            #[cfg(windows)]
            let linked = {
                use std::os::windows::fs::MetadataExt;
                meta.file_attributes() & 0x400 != 0
            };
            #[cfg(not(windows))]
            let linked = meta.file_type().is_symlink();
            if linked
                || if directory {
                    !meta.is_dir()
                } else {
                    !meta.is_file()
                }
            {
                return Err("The data pack workspace contains a linked or unexpected file.".into());
            }
            Ok(true)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(io(e)),
    }
}

fn new_file(path: &Path, data: &[u8]) -> Result<(), String> {
    let pending = path.with_extension("pending");
    if plain(&pending, false)? {
        fs::remove_file(&pending).map_err(io)?;
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&pending)
        .map_err(io)?;
    file.write_all(data).map_err(io)?;
    file.sync_all().map_err(io)?;
    drop(file);
    fs::hard_link(&pending, path).map_err(io)?;
    fs::remove_file(pending).map_err(io)
}

pub(super) fn file_hash(path: &Path, cancel: &AtomicBool) -> Result<String, String> {
    let mut file = File::open(path).map_err(io)?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        cancelled(cancel)?;
        let n = file.read(&mut buffer).map_err(io)?;
        if n == 0 {
            return Ok(hex::encode(digest.finalize()));
        }
        digest.update(&buffer[..n]);
    }
}

pub(super) struct Workspace {
    pub(super) root: PathBuf,
    _lease: File,
}

impl Workspace {
    pub(super) fn inspect(parent: &Path, source: &Source) -> Result<bool, String> {
        check_parent(parent)?;
        let root = parent.join(&source.id);
        if !plain(&root, true)? {
            return Ok(false);
        }
        let owner = root.join("OWNER");
        let marker = format!(
            "novelty-data-pack-workspace-v1\n{}\n{}\n",
            source.id, source.manifest_sha256
        );
        if !plain(&owner, false)?
            || fs::metadata(&owner).map_err(io)?.len() > 256
            || fs::read(&owner).map_err(io)? != marker.as_bytes()
        {
            return Err("The existing data folder does not belong to this download.".into());
        }
        Ok(true)
    }
    pub(super) fn open(parent: &Path, source: &Source) -> Result<Self, String> {
        if !parent.is_absolute()
            || parent
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err("An absolute managed data directory is required.".into());
        }
        for path in parent.ancestors() {
            if !plain(path, true)? {
                return Err("The managed data directory does not exist.".into());
            }
        }
        let root = parent.join(&source.id);
        let marker = format!(
            "novelty-data-pack-workspace-v1\n{}\n{}\n",
            source.id, source.manifest_sha256
        );
        if !plain(&root, true)? {
            fs::create_dir(&root).map_err(io)?;
            new_file(&root.join("OWNER"), marker.as_bytes())?;
        }
        let owner = root.join("OWNER");
        if !plain(&owner, false)?
            || fs::metadata(&owner).map_err(io)?.len() > 256
            || fs::read(&owner).map_err(io)? != marker.as_bytes()
        {
            return Err("The existing data folder does not belong to this download.".into());
        }
        let lease_path = root.join("LOCK");
        plain(&lease_path, false)?;
        let lease = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lease_path)
            .map_err(io)?;
        fs2::FileExt::try_lock_exclusive(&lease)
            .map_err(|_| "This data pack is already being installed.".to_string())?;
        for name in ["parts", "data"] {
            let path = root.join(name);
            if !plain(&path, true)? {
                fs::create_dir(path).map_err(io)?;
            }
        }
        Ok(Self {
            root,
            _lease: lease,
        })
    }
}

pub(super) fn check_parent(parent: &Path) -> Result<(), String> {
    if !parent.is_absolute()
        || parent
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Choose an existing absolute download folder.".into());
    }
    for path in parent.ancestors() {
        if !plain(path, true)? {
            return Err("The download folder does not exist.".into());
        }
    }
    Ok(())
}

pub(super) fn fetch_manifest(source: &Source, cancel: &AtomicBool) -> Result<Vec<u8>, String> {
    let client = client(source)?;
    let started = Instant::now();
    let mut response = client
        .get(format!(
            "{}/manifest.json",
            source.base_url.trim_end_matches('/')
        ))
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    let mut chunk = [0; 16 * 1024];
    loop {
        cancelled(cancel)?;
        if started.elapsed() >= Duration::from_secs(30) {
            return Err("The data pack manifest took too long to arrive.".into());
        }
        let count = response.read(&mut chunk).map_err(io)?;
        if count == 0 {
            break;
        }
        if bytes.len() + count > MANIFEST_BYTES as usize {
            return Err("Data pack manifest is too large.".into());
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
    Manifest::parse(&bytes, &source.manifest_sha256, &source.id, &source.kind)?;
    Ok(bytes)
}

pub(super) fn review_manifest(source: &Source, parent: &Path) -> Result<Manifest, String> {
    let exists = Workspace::inspect(parent, source)?;
    let path = parent.join(&source.id).join("pack.json");
    let bytes = if exists && plain(&path, false)? {
        if fs::metadata(&path).map_err(io)?.len() > MANIFEST_BYTES {
            return Err("Data pack manifest is too large.".into());
        }
        fs::read(path).map_err(io)?
    } else {
        fetch_manifest(source, &AtomicBool::new(false))?
    };
    Manifest::parse(&bytes, &source.manifest_sha256, &source.id, &source.kind)
}

/// Space retained under the exact owned filenames can be reused even when a
/// checksum later requires re-downloading: deleting that file frees its bytes.
pub(super) fn additional_space(pack: &Manifest, root: &Path) -> Result<u64, String> {
    let mut required = 2 * 1024 * 1024 * 1024;
    for directory in [
        root.join("parts"),
        root.join("data"),
        root.join("data/shards"),
    ] {
        plain(&directory, true)?;
    }
    let mut remaining = |paths: [PathBuf; 2], expected: u64| -> Result<(), String> {
        let mut retained = 0;
        for path in paths {
            if plain(&path, false)? {
                let length = fs::metadata(path).map_err(io)?.len();
                if length > expected {
                    return Err("A retained data file is larger than its reviewed size.".into());
                }
                retained = retained.max(length);
            }
        }
        required += expected - retained;
        Ok(())
    };
    for part in &pack.parts {
        let path = root.join("parts").join(&part.name);
        remaining([path.clone(), path.with_extension("zst.part")], part.bytes)?;
    }
    for file in &pack.files {
        remaining(
            [
                root.join("data").join(&file.path),
                root.join("data").join(format!("{}.partial", file.path)),
            ],
            file.bytes,
        )?;
    }
    Ok(required)
}

fn client(source: &Source) -> Result<Client, String> {
    let url = reqwest::Url::parse(&source.base_url).map_err(|e| e.to_string())?;
    let path: Vec<_> = url.path().trim_matches('/').split('/').collect();
    let production = url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && path.len() == 5
        && path[2] == "releases"
        && path[3] == "download"
        && path[4] == format!("data-{}", source.id)
        && path[0] == "loxtyrrell03"
        && path[1] == "novelty-downloads";
    #[cfg(test)]
    let production = production || (url.scheme() == "http" && url.host_str() == Some("127.0.0.1"));
    if !production {
        return Err("The data pack host is not an approved release location.".into());
    }
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .user_agent("Novelty data downloads")
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let next = attempt.url();
            if attempt.previous().len() >= 5
                || next.scheme() != "https"
                || !matches!(
                    next.host_str(),
                    Some(
                        "github.com"
                            | "release-assets.githubusercontent.com"
                            | "objects.githubusercontent.com"
                    )
                )
                || !next.username().is_empty()
                || next.password().is_some()
                || next.port().is_some()
            {
                attempt.error("Unapproved data pack redirect")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

/// Downloads at most four parts concurrently, validates every byte, and returns
/// a new completed data directory. Existing selections are never modified.
/// The caller owns the app-wide job/update guard and catalog authorization.
pub fn install(
    source: &Source,
    parent: &Path,
    cancel: &AtomicBool,
    progress: impl Fn(Progress) + Sync,
) -> Result<PathBuf, String> {
    if !valid_id(&source.id) || !sha(&source.manifest_sha256) {
        return Err("Invalid data pack selection.".into());
    }
    cancelled(cancel)?;
    let client = client(source)?;
    let workspace = Workspace::open(parent, source)?;
    let manifest_path = workspace.root.join("pack.json");
    let bytes = if plain(&manifest_path, false)? {
        if fs::metadata(&manifest_path).map_err(io)?.len() > MANIFEST_BYTES {
            return Err("Data pack manifest is too large.".into());
        }
        fs::read(&manifest_path).map_err(io)?
    } else {
        progress(Progress {
            phase: "checking",
            completed_bytes: 0,
            total_bytes: 0,
        });
        let bytes = fetch_manifest(source, cancel)?;
        new_file(&manifest_path, &bytes)?;
        bytes
    };
    let pack = Manifest::parse(&bytes, &source.manifest_sha256, &source.id, &source.kind)?;
    cancelled(cancel)?;
    let parts = workspace.root.join("parts");
    let output = workspace.root.join("data");
    if matches!(pack.kind, super::Kind::Broadcasts | super::Kind::Otb) {
        let attribution = if pack.kind == super::Kind::Otb {
            super::OTB_ATTRIBUTION
        } else {
            super::BROADCAST_ATTRIBUTION
        };
        let notice = output.join("LICENSE.txt");
        if plain(&notice, false)? {
            if fs::read(&notice).map_err(io)? != attribution.as_bytes() {
                return Err(
                    "The broadcast data license notice changed. Choose a new download folder."
                        .into(),
                );
            }
        } else {
            new_file(&notice, attribution.as_bytes())?;
        }
    }
    let ready = workspace.root.join("READY");
    if plain(&ready, false)? {
        if fs::metadata(&ready).map_err(io)?.len() != 64
            || fs::read(&ready).map_err(io)? != source.manifest_sha256.as_bytes()
        {
            return Err("The completed data pack marker is invalid.".into());
        }
        verify_files(&pack, &output, cancel)?;
        progress(Progress {
            phase: "ready",
            completed_bytes: pack.unpacked_bytes,
            total_bytes: pack.unpacked_bytes,
        });
        return Ok(output);
    }
    let required = additional_space(&pack, &workspace.root)?;
    if fs2::available_space(&workspace.root).map_err(io)? < required {
        return Err(format!("Not enough free space to install this data pack. At least {required} bytes are required, including temporary files."));
    }
    let next = AtomicUsize::new(0);
    let error = Mutex::new(None::<String>);
    let counts = Mutex::new(vec![0_u64; pack.parts.len()]);
    std::thread::scope(|scope| {
        for _ in 0..4.min(pack.parts.len()) {
            scope.spawn(|| loop {
                if error.lock().unwrap().is_some() || cancel.load(Ordering::Relaxed) {
                    break;
                }
                let index = next.fetch_add(1, Ordering::Relaxed);
                let Some(part) = pack.parts.get(index) else {
                    break;
                };
                let result = retry_part(cancel, || {
                    download_with_size(
                        &client,
                        &format!("{}/{}", source.base_url.trim_end_matches('/'), part.name),
                        &part.sha256,
                        &parts.join(&part.name),
                        Some(part.bytes),
                        cancel,
                        |done, _| {
                            let mut counts = counts.lock().unwrap();
                            counts[index] = done;
                            progress(Progress {
                                phase: "downloading",
                                completed_bytes: counts.iter().sum(),
                                total_bytes: pack.download_bytes,
                            });
                        },
                    )
                });
                if let Err(message) = result {
                    error.lock().unwrap().get_or_insert(message);
                    break;
                }
                let mut counts = counts.lock().unwrap();
                counts[index] = part.bytes;
                progress(Progress {
                    phase: "downloading",
                    completed_bytes: counts.iter().sum(),
                    total_bytes: pack.download_bytes,
                });
            });
        }
    });
    cancelled(cancel)?;
    if let Some(error) = error.into_inner().unwrap() {
        return Err(error);
    }
    reconstruct(&pack, &parts, &output, cancel, &progress)?;
    cancelled(cancel)?;
    new_file(&ready, source.manifest_sha256.as_bytes())?;
    progress(Progress {
        phase: "ready",
        completed_bytes: pack.unpacked_bytes,
        total_bytes: pack.unpacked_bytes,
    });
    Ok(output)
}

fn verify_files(pack: &Manifest, output: &Path, cancel: &AtomicBool) -> Result<(), String> {
    for file in &pack.files {
        let path = output.join(&file.path);
        if file.path.starts_with("shards/") && !plain(&output.join("shards"), true)? {
            return Err("Missing evaluation shards.".into());
        }
        if !plain(&path, false)?
            || fs::metadata(&path).map_err(io)?.len() != file.bytes
            || file_hash(&path, cancel)? != file.sha256
        {
            return Err(format!(
                "The installed data file failed its integrity check: {}",
                file.path
            ));
        }
    }
    Ok(())
}

pub(super) fn reconstruct(
    pack: &Manifest,
    parts: &Path,
    output: &Path,
    cancel: &AtomicBool,
    progress: &impl Fn(Progress),
) -> Result<(), String> {
    let shards = output.join("shards");
    if pack.kind == Kind::Evaluations && !plain(&shards, true)? {
        fs::create_dir(&shards).map_err(io)?;
    }
    let mut completed_files = Vec::new();
    let mut digests = vec![Sha256::new(); pack.files.len()];
    for file in &pack.files {
        let target = output.join(&file.path);
        let exists = plain(&target, false)?;
        if exists
            && (fs::metadata(&target).map_err(io)?.len() != file.bytes
                || file_hash(&target, cancel)? != file.sha256)
        {
            return Err(
                "An existing data file differs from this pack; it was left unchanged.".into(),
            );
        }
        completed_files.push(exists);
        plain(&output.join(format!("{}.partial", file.path)), false)?;
    }
    let mut done = 0;
    for part in &pack.parts {
        cancelled(cancel)?;
        let path = parts.join(&part.name);
        if !plain(&path, false)? || fs::metadata(&path).map_err(io)?.len() != part.bytes {
            return Err("Invalid downloaded data part.".into());
        }
        let encoded = fs::read(&path).map_err(io)?;
        if hash(&encoded) != part.sha256 {
            return Err("Data part checksum mismatch.".into());
        }
        let decoded = match part.encoding {
            Encoding::Identity => encoded,
            Encoding::Zstd => {
                let mut decoder =
                    zstd::stream::read::Decoder::new(encoded.as_slice()).map_err(io)?;
                decoder.window_log_max(27).map_err(io)?;
                let mut decoded = Vec::new();
                decoder
                    .take(part.decoded_bytes + 1)
                    .read_to_end(&mut decoded)
                    .map_err(io)?;
                decoded
            }
        };
        if decoded.len() as u64 != part.decoded_bytes || hash(&decoded) != part.decoded_sha256 {
            return Err("Decoded data part checksum mismatch.".into());
        }
        let mut cursor = 0;
        for segment in &part.segments {
            cancelled(cancel)?;
            let end = cursor + segment.length as usize;
            let bytes = &decoded[cursor..end];
            cursor = end;
            digests[segment.file].update(bytes);
            if !completed_files[segment.file] {
                let path = output.join(format!("{}.partial", pack.files[segment.file].path));
                // Unlink the old owned partial before rebuilding it. Never
                // truncate a retained file that might also have another name.
                if segment.offset == 0 && plain(&path, false)? {
                    fs::remove_file(&path).map_err(io)?;
                }
                let mut file = OpenOptions::new()
                    .write(true)
                    .create_new(segment.offset == 0)
                    .open(path)
                    .map_err(io)?;
                file.seek(SeekFrom::Start(segment.offset)).map_err(io)?;
                for chunk in bytes.chunks(1024 * 1024) {
                    cancelled(cancel)?;
                    file.write_all(chunk).map_err(io)?;
                }
                file.sync_all().map_err(io)?;
            }
        }
        done += part.decoded_bytes;
        progress(Progress {
            phase: "preparing",
            completed_bytes: done,
            total_bytes: pack.unpacked_bytes,
        });
    }
    for (digest, file) in digests.into_iter().zip(&pack.files) {
        if hex::encode(digest.finalize()) != file.sha256 {
            return Err("Reconstructed data file checksum mismatch.".into());
        }
    }
    // Publish without clobbering. Manifest last, so evaluation readers cannot
    // mistake a partially published directory for a usable dataset.
    let mut order: Vec<_> = (0..pack.files.len()).collect();
    order.sort_by_key(|index| pack.files[*index].path == "manifest.json");
    for index in order {
        cancelled(cancel)?;
        if completed_files[index] {
            continue;
        }
        let target = output.join(&pack.files[index].path);
        let partial = output.join(format!("{}.partial", pack.files[index].path));
        fs::hard_link(&partial, &target).map_err(io)?;
        fs::remove_file(partial).map_err(io)?;
    }
    Ok(())
}
