use std::{
    io,
    path::{Path, PathBuf},
    process,
    time::{SystemTime, UNIX_EPOCH},
};

use once_cell::sync::Lazy;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

const COACH_SIDECAR_SUFFIX: &str = ".coach.json";
const MAX_COACH_SIDECAR_BYTES: usize = 16 * 1024 * 1024;
static COACH_SIDECAR_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

pub(crate) fn ai_coach_sidecar_path_for_source(source: &Path) -> PathBuf {
    let mut path = source.as_os_str().to_os_string();
    path.push(COACH_SIDECAR_SUFFIX);
    PathBuf::from(path)
}

fn validated_sidecar_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("AI Coach sidecar path must be absolute".to_string());
    }
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "AI Coach sidecar path has no valid filename".to_string())?;
    if !filename
        .to_ascii_lowercase()
        .ends_with(COACH_SIDECAR_SUFFIX)
    {
        return Err(format!(
            "AI Coach sidecar filename must end with {COACH_SIDECAR_SUFFIX}"
        ));
    }
    if path.parent().is_none_or(|parent| !parent.is_dir()) {
        return Err("AI Coach sidecar parent directory does not exist".to_string());
    }
    Ok(path)
}

fn unique_temp_path(path: &Path, attempt: u32) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "AI Coach sidecar has no parent directory".to_string())?;
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "AI Coach sidecar path has no valid filename".to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    Ok(parent.join(format!(
        ".{filename}.{}.{}.{}.tmp",
        process::id(),
        nonce,
        attempt
    )))
}

#[cfg(windows)]
fn replace_file_atomically(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let moved = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file_atomically(source: &Path, destination: &Path) -> io::Result<()> {
    std::fs::rename(source, destination)?;
    if let Some(parent) = destination.parent() {
        std::fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}

async fn write_sidecar_atomically(path: &Path, contents: &[u8]) -> Result<(), String> {
    let mut last_collision = None;
    for attempt in 0..8 {
        let temp_path = unique_temp_path(path, attempt)?;
        let mut file = match tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .await
        {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                last_collision = Some(error);
                continue;
            }
            Err(error) => return Err(error.to_string()),
        };

        let result = async {
            file.write_all(contents).await?;
            file.flush().await?;
            file.sync_all().await?;
            drop(file);
            replace_file_atomically(&temp_path, path)
        }
        .await;
        if let Err(error) = result {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(error.to_string());
        }
        return Ok(());
    }

    Err(last_collision
        .map(|error| error.to_string())
        .unwrap_or_else(|| "could not reserve an AI Coach sidecar temp file".to_string()))
}

async fn read_sidecar_text(path: &Path) -> Result<Option<String>, String> {
    let metadata = match tokio::fs::metadata(path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if metadata.len() > MAX_COACH_SIDECAR_BYTES as u64 {
        return Err(format!(
            "AI Coach sidecar exceeds the {} MiB safety limit",
            MAX_COACH_SIDECAR_BYTES / (1024 * 1024)
        ));
    }
    tokio::fs::read_to_string(path)
        .await
        .map(Some)
        .map_err(|error| error.to_string())
}

async fn read_sidecar_value(path: &Path) -> Result<Value, String> {
    let Some(contents) = read_sidecar_text(path).await? else {
        return Ok(json!({"version": 1, "records": {}}));
    };
    let value = serde_json::from_str::<Value>(&contents)
        .map_err(|error| format!("AI Coach sidecar JSON is invalid: {error}"))?;
    if value.get("version").and_then(Value::as_u64) != Some(1)
        || !value.get("records").is_some_and(Value::is_object)
    {
        return Err("AI Coach sidecar has an unsupported format".to_string());
    }
    Ok(value)
}

fn validated_record_key(record_key: &str) -> Result<&str, String> {
    let record_key = record_key.trim();
    if record_key.is_empty() || record_key.len() > 160 {
        return Err("AI Coach sidecar record key is invalid".to_string());
    }
    Ok(record_key)
}

async fn write_sidecar_value(path: &Path, value: &Value) -> Result<(), String> {
    let contents = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    if contents.len() > MAX_COACH_SIDECAR_BYTES {
        return Err(format!(
            "AI Coach sidecar exceeds the {} MiB safety limit",
            MAX_COACH_SIDECAR_BYTES / (1024 * 1024)
        ));
    }
    write_sidecar_atomically(path, &contents).await
}

#[tauri::command]
#[specta::specta]
pub async fn read_ai_coach_sidecar(path: String) -> Result<Option<String>, String> {
    let path = validated_sidecar_path(&path)?;
    let _guard = COACH_SIDECAR_LOCK.lock().await;
    read_sidecar_text(&path).await
}

#[tauri::command]
#[specta::specta]
pub async fn upsert_ai_coach_sidecar_record(
    path: String,
    record_key: String,
    record_json: String,
) -> Result<(), String> {
    let path = validated_sidecar_path(&path)?;
    let record_key = validated_record_key(&record_key)?.to_string();
    let record = serde_json::from_str::<Value>(&record_json)
        .map_err(|error| format!("AI Coach sidecar record JSON is invalid: {error}"))?;
    if !record.is_object() {
        return Err("AI Coach sidecar record must be a JSON object".to_string());
    }
    let _guard = COACH_SIDECAR_LOCK.lock().await;
    let mut sidecar = read_sidecar_value(&path).await?;
    sidecar
        .get_mut("records")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "AI Coach sidecar records object is missing".to_string())?
        .insert(record_key, record);
    write_sidecar_value(&path, &sidecar).await
}

#[tauri::command]
#[specta::specta]
pub async fn remove_ai_coach_sidecar_record(
    path: String,
    record_key: String,
) -> Result<(), String> {
    let path = validated_sidecar_path(&path)?;
    let record_key = validated_record_key(&record_key)?.to_string();
    let _guard = COACH_SIDECAR_LOCK.lock().await;
    if read_sidecar_text(&path).await?.is_none() {
        return Ok(());
    }
    let mut sidecar = read_sidecar_value(&path).await?;
    sidecar
        .get_mut("records")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "AI Coach sidecar records object is missing".to_string())?
        .remove(&record_key);
    write_sidecar_value(&path, &sidecar).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_path_is_absolute_and_dedicated() {
        let directory = tempfile::tempdir().unwrap();
        let valid = directory.path().join("game.pgn.coach.json");
        assert_eq!(
            validated_sidecar_path(valid.to_string_lossy().as_ref()).unwrap(),
            valid
        );
        assert!(validated_sidecar_path("game.pgn.coach.json").is_err());
        assert!(validated_sidecar_path(
            directory.path().join("game.pgn").to_string_lossy().as_ref()
        )
        .is_err());
    }

    #[tokio::test]
    async fn atomic_sidecar_write_replaces_without_temp_debris() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("game.pgn.coach.json");

        upsert_ai_coach_sidecar_record(
            path.to_string_lossy().into_owned(),
            "pgn:0".into(),
            json!({"answer": "first"}).to_string(),
        )
        .await
        .unwrap();
        upsert_ai_coach_sidecar_record(
            path.to_string_lossy().into_owned(),
            "pgn:0".into(),
            json!({"answer": "second"}).to_string(),
        )
        .await
        .unwrap();

        let sidecar: Value =
            serde_json::from_str(&tokio::fs::read_to_string(&path).await.unwrap()).unwrap();
        assert_eq!(sidecar["records"]["pgn:0"]["answer"], "second");
        assert_eq!(sidecar["records"].as_object().unwrap().len(), 1);
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[tokio::test]
    async fn invalid_existing_json_is_never_overwritten() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("game.pgn.coach.json");
        tokio::fs::write(&path, "{").await.unwrap();

        assert!(upsert_ai_coach_sidecar_record(
            path.to_string_lossy().into_owned(),
            "pgn:0".into(),
            json!({"answer": "new"}).to_string(),
        )
        .await
        .is_err());
        assert_eq!(tokio::fs::read_to_string(path).await.unwrap(), "{");
    }

    #[tokio::test]
    async fn invalid_rerun_record_keeps_the_last_successful_review() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("game.pgn.coach.json");
        upsert_ai_coach_sidecar_record(
            path.to_string_lossy().into_owned(),
            "pgn:0".into(),
            json!({"answer": "last successful review"}).to_string(),
        )
        .await
        .unwrap();

        assert!(upsert_ai_coach_sidecar_record(
            path.to_string_lossy().into_owned(),
            "pgn:0".into(),
            "{".into(),
        )
        .await
        .is_err());

        let sidecar: Value = serde_json::from_str(
            &read_ai_coach_sidecar(path.to_string_lossy().into_owned())
                .await
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            sidecar["records"]["pgn:0"]["answer"],
            "last successful review"
        );
    }

    #[tokio::test]
    async fn keyed_upsert_and_remove_preserve_other_games() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("games.pgn");
        let path = ai_coach_sidecar_path_for_source(&source);

        upsert_ai_coach_sidecar_record(
            path.to_string_lossy().into_owned(),
            "pgn:0".into(),
            json!({"answer": "first game"}).to_string(),
        )
        .await
        .unwrap();
        upsert_ai_coach_sidecar_record(
            path.to_string_lossy().into_owned(),
            "pgn:1".into(),
            json!({"answer": "second game"}).to_string(),
        )
        .await
        .unwrap();
        remove_ai_coach_sidecar_record(path.to_string_lossy().into_owned(), "pgn:0".into())
            .await
            .unwrap();

        let sidecar: Value = serde_json::from_str(
            &read_ai_coach_sidecar(path.to_string_lossy().into_owned())
                .await
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        assert!(sidecar["records"].get("pgn:0").is_none());
        assert_eq!(sidecar["records"]["pgn:1"]["answer"], "second game");
        assert_eq!(sidecar["records"].as_object().unwrap().len(), 1);
    }
}
