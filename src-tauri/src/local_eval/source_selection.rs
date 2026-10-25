//! A separate, transactional preference. No corpus, Library or engine file is written.
use super::*;
use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use std::time::Duration;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalEvalSourceSelection {
    pub path: String,
    pub revision: String,
}

fn plain(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.len() > 1024 * 1024 {
                return Err(
                    "Evaluation settings have an unexpected size. Their contents were kept.".into(),
                );
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_attributes() & 0x400 != 0 {
                    return Err(
                        "Evaluation settings contain a link. Their contents were kept.".into(),
                    );
                }
            }
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err("Evaluation settings changed type. Their contents were kept.".into());
            }
            Ok(true)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("Could not read evaluation settings: {error}")),
    }
}

fn settings_path(profile: &Path) -> Result<PathBuf, String> {
    let path = profile.join("evaluation-source.sqlite3");
    for name in [
        "evaluation-source.sqlite3-journal",
        "evaluation-source.sqlite3-wal",
        "evaluation-source.sqlite3-shm",
    ] {
        plain(&profile.join(name))?;
    }
    Ok(path)
}

fn schema(db: &Connection) -> Result<bool, String> {
    let version: i64 = db
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map_err(|error|error.to_string())?.query_map([],|row|row.get::<_,String>(0))
        .map_err(|error|error.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|error|error.to_string())?;
    // A failed first transaction may leave an empty SQLite file, not a preference.
    if version == 0 && tables.is_empty() {
        return Ok(false);
    }
    if version != 1 || tables != ["selection"] {
        return Err(
            "Evaluation settings use an unsupported format. Their contents were kept.".into(),
        );
    }
    let columns = db
        .prepare("PRAGMA table_info(selection)")
        .map_err(|error| error.to_string())?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if columns != ["singleton", "path", "revision"] {
        return Err(
            "Evaluation settings use an unrecognized schema. Their contents were kept.".into(),
        );
    }
    Ok(true)
}

fn row(db: &Connection, profile: &Path) -> Result<LocalEvalSourceSelection, String> {
    let count: i64 = db
        .query_row("SELECT count(*) FROM selection", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if count > 1 {
        return Err(
            "Evaluation settings contain conflicting selections. Their contents were kept.".into(),
        );
    }
    let selected = db
        .query_row(
            "SELECT path,revision FROM selection WHERE singleton=1",
            [],
            |row| {
                Ok(LocalEvalSourceSelection {
                    path: row.get(0)?,
                    revision: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if count == 1 && selected.is_none() {
        return Err("Evaluation settings contain an unrecognized selection.".into());
    }
    if let Some(value) = selected {
        if !Path::new(&value.path).is_absolute()
            || value.path.len() > 32768
            || value.revision.len() != 32
            || !value.revision.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(
                "The saved evaluation selection could not be read. Its contents were kept.".into(),
            );
        }
        Ok(value)
    } else {
        Ok(default_selection(profile))
    }
}

fn default_selection(profile: &Path) -> LocalEvalSourceSelection {
    LocalEvalSourceSelection {
        path: profile.join("lichess-cloud-evals").display().to_string(),
        revision: "default".into(),
    }
}

pub(super) fn read(profile: &Path) -> Result<LocalEvalSourceSelection, String> {
    let path = settings_path(profile)?;
    if !plain(&path)? {
        return Ok(default_selection(profile));
    }
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("Could not open evaluation settings: {error}"))?;
    db.busy_timeout(Duration::from_secs(2))
        .map_err(|error| error.to_string())?;
    if !schema(&db)? {
        return Ok(default_selection(profile));
    }
    row(&db, profile)
}

pub(super) fn save(
    profile: &Path,
    expected: &str,
    path: &Path,
) -> Result<LocalEvalSourceSelection, String> {
    let settings = settings_path(profile)?;
    plain(&settings)?;
    fs::create_dir_all(profile).map_err(|error| error.to_string())?;
    let mut db = Connection::open(settings)
        .map_err(|error| format!("Could not save evaluation settings: {error}"))?;
    db.busy_timeout(Duration::from_secs(2))
        .map_err(|error| error.to_string())?;
    db.execute_batch("PRAGMA synchronous=FULL")
        .map_err(|error| error.to_string())?;
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not save evaluation settings: {error}"))?;
    if !schema(&tx)? {
        tx.execute_batch("CREATE TABLE selection(singleton INTEGER PRIMARY KEY CHECK(singleton=1),path TEXT NOT NULL,revision TEXT NOT NULL); PRAGMA user_version=1;").map_err(|error|error.to_string())?;
    }
    if row(&tx, profile)?.revision != expected {
        return Err(
            "The current evaluation folder changed. Refresh it before choosing again.".into(),
        );
    }
    let value = LocalEvalSourceSelection {
        path: path.display().to_string(),
        revision: format!("{:032x}", rand::random::<u128>()),
    };
    tx.execute("INSERT INTO selection VALUES(1,?1,?2) ON CONFLICT(singleton) DO UPDATE SET path=excluded.path,revision=excluded.revision",[&value.path,&value.revision])
        .map_err(|error|format!("Could not save evaluation settings: {error}"))?;
    if row(&tx, profile)? != value {
        return Err(
            "The new evaluation selection could not be verified; no change was committed.".into(),
        );
    }
    tx.commit()
        .map_err(|error| format!("Could not commit evaluation settings: {error}"))?;
    Ok(value)
}
