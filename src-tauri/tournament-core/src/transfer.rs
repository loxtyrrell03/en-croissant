//! Bounded-stall archive transfer. A long, progressing download has no total deadline.
use reqwest::{blocking::Client, header, StatusCode};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

pub(crate) fn client(read_stall: Duration) -> Result<Client, String> {
    // The blocking client's timeout applies to each Read call. Configuring the
    // async read_timeout instead would poll a Tokio timer outside its reactor.
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(read_stall)
        .user_agent("Outpost/0.1 local Lichess data")
        .build()
        .map_err(|error| error.to_string())
}

fn check_cancel(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        Err("Local Lichess data installation cancelled.".into())
    } else {
        Ok(())
    }
}

fn transfer_error(cancel: &AtomicBool, error: impl std::fmt::Display) -> String {
    check_cancel(cancel)
        .err()
        .unwrap_or_else(|| error.to_string())
}

pub(super) fn metadata(client: &Client, url: &str, cancel: &AtomicBool) -> Result<String, String> {
    const MAX_METADATA_BYTES: usize = 4 * 1024 * 1024;
    check_cancel(cancel)?;
    let started = Instant::now();
    let mut response = client
        .get(url)
        .timeout(Duration::from_secs(30))
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| transfer_error(cancel, error))?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_METADATA_BYTES as u64)
    {
        return Err("Lichess archive metadata exceeds the 4 MiB limit.".into());
    }
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 16 * 1024];
    loop {
        check_cancel(cancel)?;
        if started.elapsed() >= Duration::from_secs(30) {
            return Err("Lichess archive metadata took too long to arrive.".into());
        }
        let count = response
            .read(&mut chunk)
            .map_err(|error| transfer_error(cancel, error))?;
        if count == 0 {
            break;
        }
        if bytes.len() + count > MAX_METADATA_BYTES {
            return Err("Lichess archive metadata exceeds the 4 MiB limit.".into());
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
    check_cancel(cancel)?;
    String::from_utf8(bytes).map_err(|error| error.to_string())
}

fn hash_file(path: &Path, cancel: &AtomicBool) -> Result<String, String> {
    check_cancel(cancel)?;
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        check_cancel(cancel)?;
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    check_cancel(cancel)?;
    Ok(hex::encode(digest.finalize()))
}

fn expected_total(
    response: &reqwest::blocking::Response,
    offset: u64,
) -> Result<Option<u64>, String> {
    if response.status() == StatusCode::OK {
        return Ok(response.content_length());
    }
    if response.status() != StatusCode::PARTIAL_CONTENT {
        return Err(format!(
            "Archive request returned HTTP {}",
            response.status()
        ));
    }
    let range = response
        .headers()
        .get(header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("bytes "))
        .ok_or("Archive resume response has no valid Content-Range.")?;
    let (span, total) = range
        .split_once('/')
        .ok_or("Invalid archive resume range.")?;
    let (start, end) = span
        .split_once('-')
        .ok_or("Invalid archive resume range.")?;
    let start = start
        .parse::<u64>()
        .map_err(|_| "Invalid archive resume start.")?;
    let end = end
        .parse::<u64>()
        .map_err(|_| "Invalid archive resume end.")?;
    let total = total
        .parse::<u64>()
        .map_err(|_| "Invalid archive resume size.")?;
    if start != offset
        || end < start
        || end.checked_add(1) != Some(total)
        || response.content_length().is_some_and(|length| {
            Some(length) != end.checked_sub(start).and_then(|n| n.checked_add(1))
        })
    {
        return Err("Archive resume response does not match the requested byte range.".into());
    }
    Ok(Some(total))
}

#[cfg(test)]
pub(super) fn download(
    client: &Client,
    url: &str,
    sha256: &str,
    target: &Path,
    cancel: &AtomicBool,
    on_progress: impl Fn(u64, Option<u64>),
) -> Result<(), String> {
    download_with_size(client, url, sha256, target, None, cancel, on_progress)
}

pub(crate) fn download_with_size(
    client: &Client,
    url: &str,
    sha256: &str,
    target: &Path,
    reviewed_size: Option<u64>,
    cancel: &AtomicBool,
    on_progress: impl Fn(u64, Option<u64>),
) -> Result<(), String> {
    check_cancel(cancel)?;
    if target.exists() {
        if hash_file(target, cancel)? == sha256 {
            return Ok(());
        }
        fs::remove_file(target).map_err(|error| error.to_string())?;
    }
    let partial = target.with_extension("zst.part");
    let mut offset = match partial.metadata() {
        Ok(metadata) => metadata.len(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
        Err(error) => return Err(error.to_string()),
    };
    let mut request = client.get(url);
    if offset > 0 {
        request = request.header(header::RANGE, format!("bytes={offset}-"));
    }
    let mut response = request
        .send()
        .map_err(|error| transfer_error(cancel, error))?;
    check_cancel(cancel)?;
    if response.status() == StatusCode::RANGE_NOT_SATISFIABLE && offset > 0 {
        // A process may have stopped after the final byte, before checksum/rename.
        if hash_file(&partial, cancel)? == sha256 {
            check_cancel(cancel)?;
            fs::rename(&partial, target).map_err(|error| error.to_string())?;
            return Ok(());
        }
        // Discard a non-resumable response, but keep its local bytes until a full
        // replacement response has been accepted. Network errors preserve retry data.
        drop(response);
        response = client
            .get(url)
            .send()
            .map_err(|error| transfer_error(cancel, error))?;
        offset = 0;
    } else if response.status() == StatusCode::OK {
        // A server ignoring Range already supplied the full body: do not GET it twice.
        offset = 0;
    }
    check_cancel(cancel)?;
    let total = expected_total(&response, offset)?;
    if reviewed_size.is_some_and(|reviewed| total != Some(reviewed)) {
        return Err(
            "The archive size changed or is unavailable. Review the download again.".into(),
        );
    }
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(offset > 0)
        .truncate(offset == 0)
        .open(&partial)
        .map_err(|error| error.to_string())?;
    let mut buffer = vec![0_u8; 1024 * 1024];
    let mut downloaded = offset;
    let mut emitted = downloaded;
    on_progress(downloaded, total);
    loop {
        check_cancel(cancel)?;
        let count = response
            .read(&mut buffer)
            .map_err(|error| transfer_error(cancel, error))?;
        check_cancel(cancel)?;
        if count == 0 {
            break;
        }
        downloaded = downloaded
            .checked_add(count as u64)
            .ok_or("Archive size overflow.")?;
        if total.is_some_and(|expected| downloaded > expected) {
            return Err("Archive response exceeds its declared size.".into());
        }
        file.write_all(&buffer[..count])
            .map_err(|error| error.to_string())?;
        if downloaded.saturating_sub(emitted) >= 16 * 1024 * 1024 {
            emitted = downloaded;
            on_progress(downloaded, total);
        }
    }
    if total.is_some_and(|expected| downloaded != expected) {
        return Err("Archive download ended before its declared size.".into());
    }
    file.sync_all().map_err(|error| error.to_string())?;
    drop(file);
    check_cancel(cancel)?;
    if hash_file(&partial, cancel)? != sha256 {
        // A complete corrupt prefix cannot be resumed safely on another attempt.
        fs::remove_file(&partial).map_err(|error| error.to_string())?;
        return Err(format!("Checksum mismatch for {url}; the invalid partial archive was removed. Retry the download."));
    }
    check_cancel(cancel)?;
    fs::rename(&partial, target).map_err(|error| error.to_string())?;
    on_progress(downloaded, total);
    Ok(())
}

#[cfg(test)]
#[path = "transfer_tests.rs"]
mod tests;
