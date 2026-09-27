use rusqlite::{Connection, OpenFlags, OptionalExtension};
use sha2::{Digest, Sha256};
use std::{
    fmt::Display,
    fs::{self, File},
    io::{self, Read},
    path::Path,
};

#[derive(Debug, thiserror::Error)]
pub enum SaveError {
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Database(#[from] rusqlite::Error),
    #[error("{0}")]
    Refused(String),
}

fn fingerprint(source: &Path, title: &str, description: &str) -> Result<String, SaveError> {
    let mut digest = Sha256::new();
    for part in [title, description] {
        digest.update((part.len() as u64).to_le_bytes());
        digest.update(part.as_bytes());
    }
    let mut source = File::open(source)?;
    let mut buffer = [0; 64 * 1024];
    loop {
        let size = source.read(&mut buffer)?;
        if size == 0 {
            break;
        }
        digest.update(&buffer[..size]);
    }
    Ok(hex::encode(digest.finalize()))
}

fn existing_save(path: &Path, job_id: &str, fingerprint: &str) -> Result<Option<u32>, SaveError> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
        Ok(metadata) if !metadata.file_type().is_file() => {
            return Err(SaveError::Refused(
                "The database destination already exists and is not a regular file.".into(),
            ));
        }
        Ok(_) => {}
    }
    // Never let a recovery read create, migrate or write an existing database.
    let database = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let read_marker = |name| -> Result<Option<String>, rusqlite::Error> {
        database
            .query_row("SELECT Value FROM Info WHERE Name = ?1", [name], |row| {
                row.get(0)
            })
            .optional()
    };
    if read_marker("OtbSaveJobId")?.as_deref() != Some(job_id)
        || read_marker("OtbSaveFingerprint")?.as_deref() != Some(fingerprint)
    {
        return Err(SaveError::Refused(
            "The database destination belongs to another import. Choose a new destination.".into(),
        ));
    }
    // Count current games: a completed import may subsequently have been edited.
    Ok(Some(database.query_row(
        "SELECT COUNT(*) FROM Games",
        [],
        |row| row.get(0),
    )?))
}

/// Build outside the library's .db3 discovery, then publish without replacing a
/// destination. Repeated completed requests read the existing database unchanged.
pub fn save_otb_database<E: Display>(
    source: &Path,
    destination: &Path,
    job_id: &str,
    title: &str,
    description: &str,
    build: impl FnOnce(&Path) -> Result<(), E>,
) -> Result<u32, SaveError> {
    if job_id.is_empty()
        || job_id.len() > 128
        || !job_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(SaveError::Refused("The import job ID is invalid.".into()));
    }
    let expected = fingerprint(source, title, description)?;
    if let Some(count) = existing_save(destination, job_id, &expected)? {
        return Ok(count);
    }
    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| SaveError::Refused("The database destination needs a directory.".into()))?;
    let pending = tempfile::Builder::new()
        .prefix(".otb-save-")
        .suffix(".pending")
        .tempfile_in(parent)?
        .into_temp_path();
    build(&pending).map_err(|error| SaveError::Refused(error.to_string()))?;
    if fingerprint(source, title, description)? != expected {
        return Err(SaveError::Refused(
            "The source PGN changed while saving. Retry with the retained source.".into(),
        ));
    }
    let count = {
        let mut database =
            Connection::open_with_flags(&pending, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
        let integrity: String = database.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
        if integrity != "ok" {
            return Err(SaveError::Refused(format!(
                "The new database failed its integrity check: {integrity}"
            )));
        }
        let count: u32 = database.query_row("SELECT COUNT(*) FROM Games", [], |row| row.get(0))?;
        if count == 0 {
            return Err(SaveError::Refused(
                "The source contained no usable games.".into(),
            ));
        }
        let transaction = database.transaction()?;
        for (name, value) in [
            ("OtbSaveJobId", job_id),
            ("OtbSaveFingerprint", expected.as_str()),
        ] {
            transaction.execute("INSERT INTO Info (Name, Value) VALUES (?1, ?2) ON CONFLICT(Name) DO UPDATE SET Value = excluded.Value", [name, value])?;
        }
        transaction.commit()?;
        count
    };
    File::options()
        .read(true)
        .write(true)
        .open(&pending)?
        .sync_all()?;
    match pending.persist_noclobber(destination) {
        Ok(()) => Ok(count),
        Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => {
            // Another completed request may have won publication. Its identity
            // must match; an unrelated file is never replaced or removed.
            existing_save(destination, job_id, &expected)?.ok_or_else(|| {
                SaveError::Refused("The destination changed while saving. Retry the save.".into())
            })
        }
        Err(error) => Err(error.error.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build(path: &Path) -> Result<(), rusqlite::Error> {
        Connection::open(path)?.execute_batch(
            "CREATE TABLE Games (ID INTEGER PRIMARY KEY, Comment TEXT);
             INSERT INTO Games VALUES (1, 'original');
             CREATE TABLE Info (Name TEXT PRIMARY KEY, Value TEXT);",
        )
    }

    fn fixture() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source.pgn");
        fs::write(&source, "fixture source").unwrap();
        let destination = directory.path().join("import.db3");
        (directory, source, destination)
    }

    fn assert_no_pending(directory: &Path) {
        assert!(fs::read_dir(directory).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".pending")
        }));
    }

    #[test]
    fn otb_save_replay_preserves_edits_and_counts_current_games() {
        let (_directory, source, destination) = fixture();
        assert_eq!(
            save_otb_database(&source, &destination, "job-1", "Title", "", build).unwrap(),
            1
        );
        let database = Connection::open(&destination).unwrap();
        database
            .execute_batch(
                "UPDATE Games SET Comment = 'edited'; INSERT INTO Games VALUES (2, 'added');",
            )
            .unwrap();
        drop(database);
        assert_eq!(
            save_otb_database(
                &source,
                &destination,
                "job-1",
                "Title",
                "",
                |_| -> Result<(), String> { panic!("replay must not rebuild") }
            )
            .unwrap(),
            2
        );
        assert_eq!(
            Connection::open(&destination)
                .unwrap()
                .query_row("SELECT Comment FROM Games WHERE ID = 1", [], |row| row
                    .get::<_, String>(
                    0
                ))
                .unwrap(),
            "edited"
        );
        assert_no_pending(destination.parent().unwrap());
    }

    #[test]
    fn otb_save_failed_prefix_stays_outside_library_and_retry_starts_fresh() {
        let (directory, source, destination) = fixture();
        let source_before = fs::read(&source).unwrap();
        let error = save_otb_database(&source, &destination, "job-1", "Title", "", |path| {
            assert_eq!(path.extension().unwrap(), "pending");
            build(path).unwrap();
            Err::<(), _>("source parsing stopped after a valid prefix")
        })
        .unwrap_err();
        assert!(error.to_string().contains("valid prefix"));
        assert!(!destination.exists());
        assert_eq!(fs::read(&source).unwrap(), source_before);
        assert_no_pending(directory.path());
        assert_eq!(
            save_otb_database(&source, &destination, "job-1", "Title", "", build).unwrap(),
            1
        );
    }

    #[test]
    fn otb_save_refuses_existing_unrelated_or_invalid_destinations() {
        for valid_database in [false, true] {
            let (_directory, source, destination) = fixture();
            if valid_database {
                build(&destination).unwrap();
            } else {
                fs::write(&destination, "keep this file").unwrap();
            }
            let before = fs::read(&destination).unwrap();
            assert!(save_otb_database(
                &source,
                &destination,
                "job-1",
                "Title",
                "",
                |_| -> Result<(), String> { panic!("existing file must be checked first") }
            )
            .is_err());
            assert_eq!(fs::read(&destination).unwrap(), before);
        }
    }

    #[test]
    fn otb_save_refuses_changed_source_metadata_and_job() {
        let (_directory, source, destination) = fixture();
        save_otb_database(&source, &destination, "job-1", "Title", "", build).unwrap();
        let before = fs::read(&destination).unwrap();
        for (job, title, description) in [
            ("job-2", "Title", ""),
            ("job-1", "Changed", ""),
            ("job-1", "Title", "Changed"),
        ] {
            assert!(
                save_otb_database(&source, &destination, job, title, description, build).is_err()
            );
        }
        fs::write(&source, "different source").unwrap();
        assert!(save_otb_database(&source, &destination, "job-1", "Title", "", build).is_err());
        assert_eq!(fs::read(&destination).unwrap(), before);
    }

    #[test]
    fn otb_save_refuses_source_changes_during_build() {
        let (directory, source, destination) = fixture();
        assert!(
            save_otb_database(&source, &destination, "job-1", "Title", "", |path| {
                build(path)?;
                fs::write(&source, "changed during conversion").unwrap();
                Ok::<_, rusqlite::Error>(())
            })
            .is_err()
        );
        assert!(!destination.exists());
        assert_no_pending(directory.path());
    }

    #[test]
    fn otb_save_publication_race_preserves_the_other_file() {
        let (directory, source, destination) = fixture();
        assert!(
            save_otb_database(&source, &destination, "job-1", "Title", "", |path| {
                build(path)?;
                fs::write(&destination, "another writer won").unwrap();
                Ok::<_, rusqlite::Error>(())
            })
            .is_err()
        );
        assert_eq!(
            fs::read_to_string(&destination).unwrap(),
            "another writer won"
        );
        assert_no_pending(directory.path());
    }

    #[test]
    fn otb_save_same_job_publication_race_reuses_the_completed_save() {
        let (directory, source, destination) = fixture();
        let count = save_otb_database(
            &source,
            &destination,
            "job-1",
            "Title",
            "",
            |path| -> Result<(), SaveError> {
                build(path)?;
                save_otb_database(&source, &destination, "job-1", "Title", "", build)?;
                Connection::open(&destination)?
                    .execute("INSERT INTO Games VALUES (2, 'added after saving')", [])?;
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(count, 2);
        assert_no_pending(directory.path());
    }

    #[test]
    fn otb_save_rejects_empty_or_corrupt_output_and_retains_source() {
        for empty in [false, true] {
            let (directory, source, destination) = fixture();
            assert!(
                save_otb_database(&source, &destination, "job-1", "Title", "", |path| {
                    if empty {
                        build(path)?;
                        Connection::open(path)?.execute("DELETE FROM Games", [])?;
                    } else {
                        fs::write(path, "not a database").unwrap();
                    }
                    Ok::<_, rusqlite::Error>(())
                })
                .is_err()
            );
            assert!(!destination.exists());
            assert_eq!(fs::read_to_string(&source).unwrap(), "fixture source");
            assert_no_pending(directory.path());
        }
    }

    #[test]
    fn otb_save_rejects_invalid_job_ids_before_building() {
        let (_directory, source, destination) = fixture();
        for job in ["", "../job", "job with spaces"] {
            assert!(save_otb_database(&source, &destination, job, "Title", "", build).is_err());
        }
        assert!(!destination.exists());
    }
}
