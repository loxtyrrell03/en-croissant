//! Tournament and OTB download services shared by the desktop and phone host.
//! Paths belong to the host. RPC callers cannot select a settings file or invoke
//! general filesystem operations. Novelty's profile is never opened here.
pub mod data_pack;
pub mod otb_packs;
pub mod tournament;
mod transfer;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub struct Service {
    cache: PathBuf,
    db: Arc<Mutex<Connection>>,
    download_settings: Arc<Mutex<Connection>>,
}

impl Service {
    pub fn open(root: PathBuf, cache: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
        let db = Connection::open(root.join("tournaments.sqlite3")).map_err(|e| e.to_string())?;
        db.busy_timeout(std::time::Duration::from_secs(10))
            .map_err(|e| e.to_string())?;
        db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS collections (id INTEGER PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, folder TEXT, description TEXT, game_count INTEGER NOT NULL DEFAULT 0, metadata TEXT NOT NULL DEFAULT '{}');").map_err(|e|e.to_string())?;
        let shared = Connection::open(cache.join("otb-download-settings.sqlite3"))
            .map_err(|e| e.to_string())?;
        shared
            .busy_timeout(std::time::Duration::from_secs(10))
            .map_err(|e| e.to_string())?;
        shared.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);").map_err(|e|e.to_string())?;
        Ok(Self {
            cache,
            db: Arc::new(Mutex::new(db)),
            download_settings: Arc::new(Mutex::new(shared)),
        })
    }

    fn downloads(&self) -> Result<(), String> {
        data_pack::jobs::configure(&self.cache.join("download-manager"))
    }

    pub fn cache(&self) -> &Path {
        &self.cache
    }

    pub async fn request(&self, request: Value) -> Result<Value, String> {
        let method = string(&request, "method")?;
        let p = request.get("params").cloned().unwrap_or_else(|| json!({}));
        match method.as_str() {
            "fetchTournamentSnapshot" => {
                to_json(tournament::fetch_tournament_snapshot(string(&p, "url")?).await?)
            }
            "searchTournaments" => {
                to_json(tournament::search_tournaments(string(&p, "query")?).await?)
            }
            "discoverTournaments" => to_json(
                tournament::discovery::discover_tournaments(
                    serde_json::from_value(p).map_err(|e| e.to_string())?,
                )
                .await?,
            ),
            "tournamentEventMetadata" => {
                to_json(tournament::discovery::tournament_event_metadata(string(&p, "url")?).await?)
            }
            // Blocking SQLite and download operations never run on the reactor.
            _ => {
                let service = self.clone();
                tokio::task::spawn_blocking(move || service.local(&method, &p))
                    .await
                    .map_err(|e| e.to_string())?
            }
        }
    }

    fn local(&self, method: &str, p: &Value) -> Result<Value, String> {
        match method {
            "settingsGet" => {
                let key = setting_key(p)?;
                let db = (if key.starts_with("otb.download.") {
                    &self.download_settings
                } else {
                    &self.db
                })
                .lock()
                .map_err(|e| e.to_string())?;
                to_json(
                    db.query_row("SELECT value FROM settings WHERE key=?", [key], |row| {
                        row.get::<_, String>(0)
                    })
                    .optional()
                    .map_err(|e| e.to_string())?,
                )
            }
            "settingsSet" => {
                let key = setting_key(p)?;
                let value = string(p, "value")?;
                if value.len() > 32 * 1024 * 1024 {
                    return Err("Tournament settings are too large.".into());
                }
                let db = (if key.starts_with("otb.download.") {
                    &self.download_settings
                } else {
                    &self.db
                })
                .lock()
                .map_err(|e| e.to_string())?;
                db.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value]).map_err(|e|e.to_string())?;
                Ok(Value::Null)
            }
            "collectionList" | "collectionGet" => {
                let db = self.db.lock().map_err(|e| e.to_string())?;
                let mut statement=db.prepare("SELECT id,name,folder,description,game_count,metadata FROM collections ORDER BY id").map_err(|e|e.to_string())?;
                let rows=statement.query_map([],|row| Ok(json!({"id":row.get::<_,i64>(0)?,"name":row.get::<_,String>(1)?,"folder":row.get::<_,Option<String>>(2)?,"description":row.get::<_,Option<String>>(3)?,"game_count":row.get::<_,u32>(4)?,"metadata":serde_json::from_str::<Value>(&row.get::<_,String>(5)?).unwrap_or(Value::Null)}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
                if method == "collectionGet" {
                    let id = id(p)?;
                    rows.into_iter()
                        .find(|row| row["id"].as_i64() == Some(id))
                        .ok_or("That imported opponent is no longer available.".into())
                } else {
                    Ok(json!(rows))
                }
            }
            "collectionCreate" => {
                let key = string(p, "requestKey")?;
                let name = string(p, "name")?;
                if key.len() > 120 || name.is_empty() || name.len() > 500 {
                    return Err("Invalid opponent database identity.".into());
                }
                let db = self.db.lock().map_err(|e| e.to_string())?;
                db.execute("INSERT INTO collections(request_key,name) VALUES(?1,?2) ON CONFLICT(request_key) DO NOTHING",params![key,name]).map_err(|e|e.to_string())?;
                to_json(
                    db.query_row(
                        "SELECT id FROM collections WHERE request_key=?",
                        [key],
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(|e| e.to_string())?,
                )
            }
            "collectionSetFolder" | "collectionSetDescription" | "collectionUpdate" => {
                let id = id(p)?;
                let db = self.db.lock().map_err(|e| e.to_string())?;
                let changed = match method {
                    "collectionSetFolder" => db.execute(
                        "UPDATE collections SET folder=?1 WHERE id=?2",
                        params![string(p, "folder")?, id],
                    ),
                    "collectionSetDescription" => db.execute(
                        "UPDATE collections SET description=?1 WHERE id=?2",
                        params![string(p, "description")?, id],
                    ),
                    _ => {
                        let count = p["gameCount"]
                            .as_u64()
                            .filter(|n| *n <= u32::MAX as u64)
                            .ok_or("Invalid saved game count.")?;
                        let metadata = p
                            .get("metadata")
                            .filter(|v| v.is_object())
                            .ok_or("Invalid import checkpoint.")?;
                        if metadata.to_string().len() > 1024 * 1024 {
                            return Err("Import checkpoint is too large.".into());
                        }
                        db.execute(
                            "UPDATE collections SET game_count=?1,metadata=?2 WHERE id=?3",
                            params![count, metadata.to_string(), id],
                        )
                    }
                }
                .map_err(|e| e.to_string())?;
                if changed != 1 {
                    return Err("That opponent database was removed.".into());
                }
                Ok(Value::Null)
            }
            // The host first removes its own imported database/workspace; this
            // forgets the registry entry only. It never deletes an arbitrary path.
            "collectionForget" => {
                self.db
                    .lock()
                    .map_err(|e| e.to_string())?
                    .execute("DELETE FROM collections WHERE id=?", [id(p)?])
                    .map_err(|e| e.to_string())?;
                Ok(Value::Null)
            }
            "dataPackStatus" => {
                self.downloads()?;
                let jobs = data_pack::jobs::status()?;
                let selected = otb_packs::selected(&self.cache)?;
                let selected_ids: Vec<_> = jobs
                    .iter()
                    .filter(|job| {
                        selected.contains(
                            &PathBuf::from(&job.path).join("otb-archive-index-v2.sqlite3"),
                        )
                    })
                    .map(|j| j.id.clone())
                    .collect();
                Ok(
                    json!({"catalog":data_pack::jobs::catalog()?,"jobs":jobs,"defaultParent":self.cache.join("downloaded-games"),"openingPackSelected":false,"sharedOpeningsAvailable":false,"selectedIds":selected_ids,"existingIds":[]}),
                )
            }
            "otbLibraryStatus" => {
                self.downloads()?;
                to_json(data_pack::otb_library::status(
                    &self.cache.join("download-manager"),
                    &self.cache,
                    &data_pack::jobs::status()?,
                )?)
            }
            "checkOtbPackUpdates" => {
                self.downloads()?;
                to_json(otb_packs::check_updates()?)
            }
            "reviewDataPack" => {
                self.downloads()?;
                to_json(data_pack::jobs::review(
                    &string(p, "id")?,
                    &string(p, "parent")?,
                    false,
                )?)
            }
            "startDataPack" => {
                self.downloads()?;
                to_json(data_pack::jobs::start(&string(p, "token")?)?)
            }
            "cancelDataPack" => {
                self.downloads()?;
                to_json(data_pack::jobs::cancel(&string(p, "id")?)?)
            }
            "maintainOtbLibrary" => {
                self.downloads()?;
                data_pack::otb_library::maintain(&self.cache, None)?;
                Ok(Value::Null)
            }
            "setOtbLibraryPreferences" => {
                self.downloads()?;
                let years = if p["keepYears"].is_null() {
                    None
                } else {
                    Some(
                        p["keepYears"]
                            .as_u64()
                            .and_then(|n| u16::try_from(n).ok())
                            .ok_or("Invalid local games date range.")?,
                    )
                };
                let enabled = p["enabled"]
                    .as_bool()
                    .ok_or("Invalid enabled preference.")?;
                let parent = PathBuf::from(string(p, "parent")?);
                std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
                data_pack::otb_library::maintain(&self.cache, Some((years, enabled, parent)))?;
                Ok(Value::Null)
            }
            "reviewDownloadRemoval" => {
                self.downloads()?;
                if string(p, "id")? != "otb-library" {
                    return Err("Only this app's OTB downloads may be removed.".into());
                }
                to_json(data_pack::removal::review(
                    "otb-library",
                    &self.cache,
                    || Ok(None),
                )?)
            }
            "removeDownloadedData" => {
                self.downloads()?;
                data_pack::removal::remove(
                    &string(p, "token")?,
                    &self.cache,
                    |_| Ok(None),
                    |_, _| Ok(()),
                )?;
                Ok(Value::Null)
            }
            _ => Err(format!("Unknown tournament operation: {method}")),
        }
    }
}
fn to_json(value: impl serde::Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}
fn string(p: &Value, key: &str) -> Result<String, String> {
    p[key]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("Missing {key}"))
}
fn id(p: &Value) -> Result<i64, String> {
    p["id"]
        .as_i64()
        .filter(|n| *n > 0)
        .ok_or("Invalid opponent database ID.".into())
}
fn setting_key(p: &Value) -> Result<String, String> {
    let key = string(p, "key")?;
    if key.starts_with("encroissant.tournament") || key.starts_with("otb.download.") {
        Ok(key)
    } else {
        Err("This setting does not belong to tournament tracking.".into())
    }
}

#[cfg(test)]
mod service_tests {
    use super::*;
    #[tokio::test]
    async fn hosts_share_download_preferences_but_keep_tournament_records_separate() {
        let dir = tempfile::tempdir().unwrap();
        let desktop = Service::open(dir.path().join("desktop"), dir.path().join("cache")).unwrap();
        let phone = Service::open(dir.path().join("phone"), dir.path().join("cache")).unwrap();
        desktop.request(json!({"method":"settingsSet","params":{"key":"otb.download.enabled","value":"true"}})).await.unwrap();
        assert_eq!(phone.request(json!({"method":"settingsGet","params":{"key":"otb.download.enabled"}})).await.unwrap(), json!("true"));
        desktop.request(json!({"method":"settingsSet","params":{"key":"encroissant.tournamentPrep","value":"private"}})).await.unwrap();
        assert_eq!(phone.request(json!({"method":"settingsGet","params":{"key":"encroissant.tournamentPrep"}})).await.unwrap(), Value::Null);
    }
    #[tokio::test]
    async fn registry_creation_is_idempotent_and_settings_are_scoped() {
        let dir = tempfile::tempdir().unwrap();
        let s = Service::open(dir.path().join("records"), dir.path().join("cache")).unwrap();
        let request = json!({"method":"collectionCreate","params":{"name":"Example","requestKey":"fixed-key"}});
        assert_eq!(
            s.request(request.clone()).await.unwrap(),
            s.request(request).await.unwrap()
        );
        assert_eq!(
            s.request(json!({"method":"collectionList"}))
                .await
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(s
            .request(json!({"method":"settingsSet","params":{"key":"novelty.owner","value":"x"}}))
            .await
            .is_err());
        s.request(json!({"method":"settingsSet","params":{"key":"encroissant.tournamentPrep","value":"{}"}})).await.unwrap();
        assert_eq!(
            s.request(
                json!({"method":"settingsGet","params":{"key":"encroissant.tournamentPrep"}})
            )
            .await
            .unwrap(),
            json!("{}")
        );
    }
}
