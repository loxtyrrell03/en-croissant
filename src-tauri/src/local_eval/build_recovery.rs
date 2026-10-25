//! Recorded build ownership. No restore starts a download or changes a lookup source.
use super::*;
use rusqlite::{Connection, OptionalExtension};
use std::{fs::OpenOptions, sync::atomic::Ordering as AtomicOrdering, time::Duration};

#[path = "recovery_cleanup.rs"]
mod cleanup;

const MAX_RECORD_BYTES: i64 = 64 * 1024;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalEvalBuildJob {
    pub id: String,
    pub output_dir: String,
    pub state: String,
    pub progress: Option<LocalEvalBuildProgress>,
    pub report: Option<LocalEvalBuildReport>,
    pub store: Option<LocalEvalDbStatus>,
    pub detail: Option<String>,
    pub active: bool,
    pub can_cancel: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Record {
    schema: u8,
    id: String,
    path: PathBuf,
    identity: [u8; 16],
    shard_count: u16,
    state: String,
    progress: Option<LocalEvalBuildProgress>,
    report: Option<LocalEvalBuildReport>,
    detail: Option<String>,
}

struct Journal {
    root: PathBuf,
    db: Connection,
}

impl Journal {
    fn open(root: &Path) -> Result<Self, String> {
        fs::create_dir_all(root).map_err(|error| error.to_string())?;
        let metadata = fs::symlink_metadata(root).map_err(|error| error.to_string())?;
        if !cleanup::plain(&metadata) || !metadata.is_dir() {
            return Err("The recovery folder contains a link. Its contents were kept.".into());
        }
        let root = root.canonicalize().map_err(|error| error.to_string())?;
        let path = root.join("jobs.sqlite3");
        match fs::symlink_metadata(&path) {
            Ok(meta) if !cleanup::plain(&meta) || !meta.is_file() => {
                return Err("The recovery database changed type. Its contents were kept.".into())
            }
            Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error.to_string()),
            _ => {}
        }
        let db = Connection::open(path)
            .map_err(|error| format!("Could not open recovery state: {error}"))?;
        db.busy_timeout(Duration::from_secs(2))
            .map_err(|error| error.to_string())?;
        let version: i64 = db
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|error| format!("Could not read recovery state: {error}"))?;
        let store = Self { root, db };
        if version == 0 {
            let _lease = store.lease()?;
            let latest: i64 = store
                .db
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .map_err(|error| error.to_string())?;
            if latest == 0 {
                let tables: i64 = store.db.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", [], |row| row.get(0)).map_err(|error| error.to_string())?;
                if tables != 0 {
                    return Err("Unrecognized recovery database. Its contents were kept.".into());
                }
                store.db.execute_batch("PRAGMA synchronous=FULL; BEGIN IMMEDIATE; CREATE TABLE job (singleton INTEGER PRIMARY KEY CHECK(singleton=1), record TEXT NOT NULL); PRAGMA user_version=1; COMMIT;").map_err(|error| error.to_string())?;
            } else if latest != 1 {
                return Err(
                    "Recovery state uses an unsupported version. Its contents were kept.".into(),
                );
            }
        } else if version != 1 {
            return Err(
                "Recovery state uses an unsupported version. Its contents were kept.".into(),
            );
        }
        store
            .db
            .execute_batch("PRAGMA synchronous=FULL")
            .map_err(|error| error.to_string())?;
        Ok(store)
    }

    fn lease(&self) -> Result<File, String> {
        self.try_lease()?.ok_or_else(|| "Another En Croissant process is managing this build. Check that process before starting or removing data.".into())
    }

    fn try_lease(&self) -> Result<Option<File>, String> {
        let path = self.root.join("job.lock");
        match fs::symlink_metadata(&path) {
            Ok(meta) if !cleanup::plain(&meta) || !meta.is_file() => {
                return Err("The recovery lease changed type. Files were kept.".into())
            }
            Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error.to_string()),
            _ => {}
        }
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path)
            .map_err(|error| error.to_string())?;
        match fs2::FileExt::try_lock_exclusive(&file) {
            Ok(()) => Ok(Some(file)),
            Err(error)
                if error.kind() == io::ErrorKind::WouldBlock
                    || error.raw_os_error() == Some(33) =>
            {
                Ok(None)
            }
            Err(error) => Err(format!("Could not acquire the recovery lease: {error}")),
        }
    }

    fn read(&self) -> Result<Option<Record>, String> {
        let size: Option<i64> = self
            .db
            .query_row(
                "SELECT length(CAST(record AS BLOB)) FROM job WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("Could not read recovery state: {error}"))?;
        let Some(size) = size else { return Ok(None) };
        if !(1..=MAX_RECORD_BYTES).contains(&size) {
            return Err("Recovery record has an invalid size. Files were kept.".into());
        }
        let raw: String = self
            .db
            .query_row("SELECT record FROM job WHERE singleton=1", [], |row| {
                row.get(0)
            })
            .map_err(|error| error.to_string())?;
        let record: Record = serde_json::from_str(&raw).map_err(|error| {
            format!("Recovery record could not be read: {error}. Files were kept.")
        })?;
        if record.schema != 1
            || record.id.is_empty()
            || record.id.len() > 256
            || !record.path.is_absolute()
            || !(16..=8192).contains(&record.shard_count)
            || !matches!(
                record.state.as_str(),
                "starting" | "running" | "ready" | "failed" | "cancelled"
            )
        {
            return Err("Recovery record is unrecognized. Files were kept.".into());
        }
        if record.report.as_ref().is_some_and(|report| {
            record.state != "ready"
                || Path::new(&report.output_dir) != record.path
                || report.shard_count != record.shard_count
                || report.positions == 0
        }) || record.progress.as_ref().is_some_and(|progress| {
            progress.id != record.id
                || !progress.progress.is_finite()
                || !(0.0..=100.0).contains(&progress.progress)
                || !matches!(
                    progress.phase.as_str(),
                    "opening" | "ingesting" | "sorting" | "ready"
                )
        }) {
            return Err("Recovery counters do not match the recorded job. Files were kept.".into());
        }
        Ok(Some(record))
    }

    fn save(&self, record: &Record) -> Result<(), String> {
        let value = serde_json::to_string(record).map_err(|error| error.to_string())?;
        if value.len() > MAX_RECORD_BYTES as usize {
            return Err("Recovery record is too large.".into());
        }
        self.db.execute("INSERT INTO job(singleton,record) VALUES(1,?1) ON CONFLICT(singleton) DO UPDATE SET record=excluded.record", [value]).map_err(|error| format!("Could not save recovery state: {error}"))?;
        Ok(())
    }
}

fn view(record: &Record, active: bool) -> Result<LocalEvalBuildJob, String> {
    let mut state = record.state.clone();
    let mut report = record.report.clone();
    let mut detail = record.detail.clone();
    let mut store = None;
    let local_state = build_control::local_state(&record.id);
    if active && local_state == Some(1) {
        state = "cancelling".into();
    }
    if !active {
        let changed_output = match fs::symlink_metadata(&record.path) {
            Ok(metadata) => {
                !cleanup::plain(&metadata)
                    || !metadata.is_dir()
                    || record
                        .path
                        .canonicalize()
                        .map_err(|error| error.to_string())?
                        != record.path
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => false,
            Err(error) => {
                return Err(format!(
                    "Could not check the recorded output: {error}. Files were kept."
                ))
            }
        };
        if changed_output {
            state = "interrupted".into();
            detail =
                Some("The recorded output moved or contains a link. Its files were kept.".into());
        } else {
            match fs::symlink_metadata(record.path.join(MANIFEST_FILE)) {
                Ok(metadata) => {
                    if !cleanup::plain(&metadata) || !metadata.is_file() {
                        state = "interrupted".into();
                        detail = Some(
                            "The output contains a changed manifest. Its files were kept.".into(),
                        );
                    } else {
                        let status = database_status(&record.path);
                        if status.available {
                            state = "ready".into();
                            store = Some(status);
                            detail = None;
                        } else {
                            state = "interrupted".into();
                            detail = Some(status.error.unwrap_or_else(|| {
                                "The published output could not be validated. Its files were kept."
                                    .into()
                            }));
                        }
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    let output_exists = match fs::symlink_metadata(&record.path) {
                        Ok(_) => true,
                        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
                        Err(error) => {
                            return Err(format!("Could not check the recorded output: {error}"))
                        }
                    };
                    if output_exists || matches!(state.as_str(), "starting" | "running" | "ready") {
                        state = "interrupted".into();
                        detail = Some("This build did not finish. Remove its recorded incomplete output before reviewing a fresh download. The current store is unchanged.".into());
                    }
                }
                Err(error) => {
                    return Err(format!(
                        "Could not check the recorded manifest: {error}. Files were kept."
                    ))
                }
            }
        }
        if state != "ready" {
            report = None;
        }
    }
    Ok(LocalEvalBuildJob {
        id: record.id.clone(),
        output_dir: record.path.display().to_string(),
        state,
        progress: record.progress.clone(),
        report,
        store,
        detail,
        active,
        can_cancel: active && local_state.is_some_and(|state| state < 2),
    })
}

pub fn get_build_job(root: &Path) -> Result<Option<LocalEvalBuildJob>, String> {
    let journal = Journal::open(root)?;
    let lease = journal.try_lease()?;
    journal
        .read()?
        .map(|record| view(&record, lease.is_none()))
        .transpose()
}

pub fn discard_build_job(root: &Path, id: &str) -> Result<(), String> {
    let journal = Journal::open(root)?;
    let _lease = journal.lease()?;
    let record = journal.read()?.ok_or("No recorded build is available.")?;
    if record.id != id {
        return Err(
            "The recorded build changed. Refresh its status before removing anything.".into(),
        );
    }
    if view(&record, false)?.state == "ready" {
        return Err("This build contains a completed store. Its files were kept.".into());
    }
    cleanup::discard(&record)?;
    journal
        .db
        .execute("DELETE FROM job WHERE singleton=1", [])
        .map_err(|error| {
            format!("Files were removed but the recovery record could not be cleared: {error}")
        })?;
    Ok(())
}

pub fn build_compact_eval_database_recoverable<F>(
    options: LocalEvalBuildOptions,
    control: LocalEvalBuildControl,
    root: &Path,
    progress: F,
) -> Result<LocalEvalBuildReport, LocalEvalError>
where
    F: FnMut(LocalEvalBuildProgress),
{
    build_recoverable_with(
        options,
        control,
        root,
        progress,
        |options, control, progress| {
            build_compact_eval_database_controlled(options, control, progress)
        },
    )
}

pub(super) fn build_recoverable_with<F, B>(
    mut options: LocalEvalBuildOptions,
    mut control: LocalEvalBuildControl,
    root: &Path,
    mut progress: F,
    build: B,
) -> Result<LocalEvalBuildReport, LocalEvalError>
where
    F: FnMut(LocalEvalBuildProgress),
    B: FnOnce(
        LocalEvalBuildOptions,
        LocalEvalBuildControl,
        &mut dyn FnMut(LocalEvalBuildProgress),
    ) -> Result<LocalEvalBuildReport, LocalEvalError>,
{
    let failure = |detail: String| LocalEvalError::InvalidOption(detail);
    control.check()?;
    validate_max_pvs(options.max_pvs)?;
    validate_shard_count(options.shard_count)?;
    if options.id.is_empty() || options.id.len() > 256 {
        return Err(failure("Build ID must contain 1 to 256 bytes.".into()));
    }
    let name = options
        .output_dir
        .file_name()
        .ok_or_else(|| failure("Choose a new output directory.".into()))?
        .to_owned();
    let parent = options
        .output_dir
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    options.output_dir = parent.canonicalize()?.join(name);
    match fs::symlink_metadata(&options.output_dir) {
        Ok(_) => {
            return Err(failure(
                "Evaluation output already exists. Existing data will not be replaced.".into(),
            ))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let journal = Journal::open(root).map_err(failure)?;
    if journal.root.starts_with(&options.output_dir)
        || options.output_dir.starts_with(&journal.root)
    {
        return Err(failure(
            "Keep the recovery journal outside the build output.".into(),
        ));
    }
    let _lease = journal.lease().map_err(failure)?;
    if let Some(previous) = journal.read().map_err(failure)? {
        if view(&previous, false).map_err(failure)?.state == "interrupted" {
            return Err(failure("A recorded interrupted build needs explicit cleanup before another build can start.".into()));
        }
    }
    let mut record = Record {
        schema: 1,
        id: options.id.clone(),
        path: options.output_dir.clone(),
        identity: rand::random(),
        shard_count: options.shard_count,
        state: "starting".into(),
        progress: None,
        report: None,
        detail: None,
    };
    journal.save(&record).map_err(failure)?;
    control.ownership = Some(record.identity);
    let cancel = control.cancel.clone();
    let mut persistence_error = None;
    let result = build(options, control, &mut |event| {
        record.state = "running".into();
        record.progress = Some(event.clone());
        if persistence_error.is_none() {
            if let Err(error) = journal.save(&record) {
                persistence_error = Some(error);
                cancel.store(true, AtomicOrdering::Relaxed);
            }
        }
        progress(event);
    });
    match &result {
        Ok(report) => {
            record.state = "ready".into();
            record.report = Some(report.clone());
            record.detail = None;
        }
        Err(error) => {
            record.state = if persistence_error.is_some() {
                "failed"
            } else if cancel.load(AtomicOrdering::Relaxed) {
                "cancelled"
            } else {
                "failed"
            }
            .into();
            record.detail = Some(
                persistence_error
                    .clone()
                    .unwrap_or_else(|| error.to_string()),
            );
        }
    }
    journal.save(&record).map_err(failure)?;
    if let Some(error) = persistence_error {
        return Err(failure(format!(
            "Build recovery could not be saved: {error}. Any completed store was kept."
        )));
    }
    result
}

#[cfg(test)]
#[path = "recovery_tests.rs"]
mod tests;
