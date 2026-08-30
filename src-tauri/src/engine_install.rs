//! Managed LCZero install for the desktop Engines page.
//!
//! The exact CUDA engine and BT4 network match the local ChessBot extension.
//! Nothing downloads or starts at application launch; the command runs only
//! after the user presses Install, streams both large files to disk, verifies
//! pinned SHA-256 digests, and returns paths for the normal UCI profile flow.

use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use specta::Type;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use crate::progress::update_progress;
use crate::AppState;

pub const LC0_VERSION: &str = "0.32.1";
pub const LC0_NETWORK: &str = "BT4-it332";
const RELEASE_URL: &str = "https://github.com/LeelaChessZero/lc0/releases/download/v0.32.1/lc0-v0.32.1-windows-gpu-nvidia-cuda12.zip";
const RELEASE_SHA256: &str = "8D0CE17676EB15E303BEA9E790742D31C94CE5D24107F6187ADC58E820F6D2F7";
const EXE_SHA256: &str = "E32164CEB85AB128E6FE5E02D34CF17608D638335AE7D519F82A58C372E9666B";
const NETWORK_URL: &str = "https://storage.lczero.org/files/networks-contrib/BT4-1024x15x32h-swa-6147500-policytune-332.pb.gz";
const NETWORK_SHA256: &str = "E6ADA9D6C4A769BFAB3AA0848D82CAEB809AA45F83E6C605FC58A31D21BDD618";
const INSTALL_DIR: &str = "lc0-0.32.1-bt4-it332";
const NETWORK_FILE: &str = "BT4-it332.pb.gz";

static INSTALLING: AtomicBool = AtomicBool::new(false);

struct InstallGuard;

impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::SeqCst);
    }
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ManagedLc0Install {
    pub path: String,
    pub weights_path: String,
    pub version: String,
    pub network: String,
}

fn sha256_matches(path: &Path, expected: &str) -> bool {
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let mut hasher = Sha256::new();
    if std::io::copy(&mut file, &mut hasher).is_err() {
        return false;
    }
    format!("{:X}", hasher.finalize()) == expected
}

fn emit_progress(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, AppState>,
    id: &str,
    progress: f32,
    finished: bool,
) -> Result<(), String> {
    update_progress(
        &state.progress_state,
        app,
        id.to_string(),
        progress.clamp(0.0, 100.0),
        finished,
    )
    .map_err(|error| error.to_string())
}

async fn download_verified(
    url: &str,
    dest: &Path,
    expected_sha256: &str,
    min_bytes: u64,
    max_bytes: u64,
    progress_start: f32,
    progress_end: f32,
    app: &tauri::AppHandle,
    state: &tauri::State<'_, AppState>,
    id: &str,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent(format!(
            "en-croissant/{} (managed engine install)",
            env!("CARGO_PKG_VERSION")
        ))
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(30 * 60))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Download failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Download failed: {error}"))?;
    let total = response.content_length();
    if total.unwrap_or(0) > max_bytes {
        return Err("Download rejected: response larger than expected.".to_string());
    }

    let mut file = fs::File::create(dest).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let mut stream = response.bytes_stream();
    emit_progress(app, state, id, progress_start, false)?;
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|error| format!("Download failed: {error}"))?;
        received += chunk.len() as u64;
        if received > max_bytes {
            return Err("Download rejected: response larger than expected.".to_string());
        }
        file.write_all(&chunk).map_err(|error| error.to_string())?;
        hasher.update(&chunk);
        if let Some(total) = total.filter(|total| *total > 0) {
            let fraction = (received as f32 / total as f32).min(1.0);
            emit_progress(
                app,
                state,
                id,
                progress_start + (progress_end - progress_start) * fraction,
                false,
            )?;
        }
    }
    file.flush().map_err(|error| error.to_string())?;
    if received < min_bytes {
        return Err("Download incomplete: the upstream file was not served.".to_string());
    }
    let actual = format!("{:X}", hasher.finalize());
    if actual != expected_sha256 {
        return Err(format!(
            "Download rejected: SHA-256 mismatch (expected {expected_sha256}, got {actual})."
        ));
    }
    emit_progress(app, state, id, progress_end, false)?;
    Ok(())
}

fn extract_zip(archive_path: &Path, target_dir: &Path) -> Result<(), String> {
    let file = fs::File::open(archive_path).map_err(|error| error.to_string())?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|error| format!("Could not open archive: {error}"))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Could not read archive: {error}"))?;
        let Some(relative) = entry.enclosed_name() else {
            continue;
        };
        let dest = target_dir.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&dest).map_err(|error| error.to_string())?;
        } else {
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let mut output = fs::File::create(&dest).map_err(|error| error.to_string())?;
            std::io::copy(&mut entry, &mut output)
                .map_err(|error| format!("Could not extract {}: {error}", entry.name()))?;
        }
    }
    Ok(())
}

fn installed_result(exe: &Path, weights: &Path) -> ManagedLc0Install {
    ManagedLc0Install {
        path: exe.to_string_lossy().into_owned(),
        weights_path: weights.to_string_lossy().into_owned(),
        version: LC0_VERSION.to_string(),
        network: LC0_NETWORK.to_string(),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn install_chessbot_lc0(
    id: String,
    engines_dir: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<ManagedLc0Install, String> {
    if !cfg!(all(windows, target_arch = "x86_64")) {
        return Err("The managed LCZero CUDA install requires 64-bit Windows.".to_string());
    }
    let engines_dir = PathBuf::from(engines_dir);
    if !engines_dir.is_absolute() {
        return Err("The engines directory must be an absolute path.".to_string());
    }
    let target_dir = engines_dir.join(INSTALL_DIR);
    let exe = target_dir.join("lc0.exe");
    let weights = target_dir.join(NETWORK_FILE);
    if sha256_matches(&exe, EXE_SHA256) && sha256_matches(&weights, NETWORK_SHA256) {
        emit_progress(&app, &state, &id, 100.0, true)?;
        return Ok(installed_result(&exe, &weights));
    }

    if INSTALLING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("An engine install is already running.".to_string());
    }
    let _guard = InstallGuard;
    fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;

    if !sha256_matches(&exe, EXE_SHA256) {
        let archive = engines_dir.join("lc0-v0.32.1-cuda12.zip.part");
        let result = download_verified(
            RELEASE_URL,
            &archive,
            RELEASE_SHA256,
            500 * 1024 * 1024,
            700 * 1024 * 1024,
            0.0,
            60.0,
            &app,
            &state,
            &id,
        )
        .await;
        if let Err(error) = result {
            let _ = fs::remove_file(&archive);
            return Err(error);
        }
        let archive_for_extract = archive.clone();
        let target_for_extract = target_dir.clone();
        emit_progress(&app, &state, &id, 60.0, false)?;
        let extract_result = tauri::async_runtime::spawn_blocking(move || {
            extract_zip(&archive_for_extract, &target_for_extract)
        })
        .await
        .map_err(|error| format!("Extraction task failed: {error}"))?;
        let _ = fs::remove_file(&archive);
        extract_result?;
        emit_progress(&app, &state, &id, 70.0, false)?;
        if !sha256_matches(&exe, EXE_SHA256) {
            return Err("The archive did not contain the pinned LCZero executable.".to_string());
        }
    } else {
        emit_progress(&app, &state, &id, 70.0, false)?;
    }

    if !sha256_matches(&weights, NETWORK_SHA256) {
        let weights_part = target_dir.join(format!("{NETWORK_FILE}.part"));
        let result = download_verified(
            NETWORK_URL,
            &weights_part,
            NETWORK_SHA256,
            350 * 1024 * 1024,
            450 * 1024 * 1024,
            70.0,
            99.0,
            &app,
            &state,
            &id,
        )
        .await;
        if let Err(error) = result {
            let _ = fs::remove_file(&weights_part);
            return Err(error);
        }
        if weights.exists() {
            fs::remove_file(&weights).map_err(|error| error.to_string())?;
        }
        fs::rename(&weights_part, &weights).map_err(|error| error.to_string())?;
    }

    emit_progress(&app, &state, &id, 100.0, true)?;
    Ok(installed_result(&exe, &weights))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pinned_sha256_verification_rejects_changed_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("abc.bin");
        fs::write(&file, b"abc").unwrap();
        assert!(sha256_matches(
            &file,
            "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD"
        ));
        fs::write(&file, b"abd").unwrap();
        assert!(!sha256_matches(
            &file,
            "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD"
        ));
    }
}
