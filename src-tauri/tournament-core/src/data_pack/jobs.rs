//! Desktop job ownership and recovery. Merely reading status starts no network
//! request, changes no selected database and never resumes a job automatically.
use super::{install, Kind, Manifest, Progress, Source};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, LazyLock, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    pub id: String,
    pub kind: Kind,
    pub title: String,
    pub summary: String,
    pub detail: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub period_start: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub period_end: Option<String>,
    pub download_bytes: u64,
    pub installed_bytes: u64,
    pub manifest_sha256: String,
}
pub fn catalog() -> Result<Vec<Entry>, String> {
    let mut entries: Vec<Entry> =
        serde_json::from_str(include_str!("../../config/data-packs.json"))
            .map_err(|e| e.to_string())?;
    entries.retain(|entry| entry.kind == Kind::Otb);
    entries.extend(crate::otb_packs::extra_catalog()?);
    Ok(entries)
}
fn entry(id: &str) -> Result<Entry, String> {
    catalog()?
        .into_iter()
        .find(|e| e.id == id)
        .ok_or("That data pack is not in the download catalog.".into())
}
pub(super) fn source(entry: &Entry) -> Source {
    Source {
        id: entry.id.clone(),
        kind: entry.kind.clone(),
        manifest_sha256: entry.manifest_sha256.clone(),
        base_url: format!(
            "https://github.com/loxtyrrell03/novelty-downloads/releases/download/data-{}",
            entry.id
        ),
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Running,
    Cancelling,
    Interrupted,
    Cancelled,
    Failed,
    Ready,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Job {
    pub id: String,
    pub state: State,
    pub parent: String,
    pub path: String,
    pub phase: String,
    pub completed_bytes: u64,
    pub total_bytes: u64,
    pub error: Option<String>,
    pub manifest_sha256: String,
    #[serde(default)]
    pub retained_paths: Vec<String>,
}
impl Job {
    fn active(&self) -> bool {
        matches!(self.state, State::Running | State::Cancelling)
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub token: String,
    pub id: String,
    pub parent: String,
    pub path: String,
    pub download_bytes: u64,
    pub installed_bytes: u64,
    pub required_bytes: u64,
    pub available_bytes: u64,
    pub previous_path: Option<String>,
}
struct Reviewed {
    view: Review,
    manifest: Manifest,
    at: Instant,
    previous: Option<Job>,
    create_parent: Option<PathBuf>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheReview {
    pub token: String,
    pub id: String,
    pub cache_bytes: u64,
    pub file_count: usize,
}
struct ReviewedCache {
    view: CacheReview,
    parent: String,
    snapshot: super::cache::Snapshot,
    at: Instant,
}
struct Store {
    root: PathBuf,
    db: Connection,
}
impl Store {
    fn open(root: &Path) -> Result<Self, String> {
        for ancestor in root.ancestors() {
            if install::plain(ancestor, true)? {
                install::check_parent(ancestor)?;
                break;
            }
        }
        fs::create_dir_all(root).map_err(|e| e.to_string())?;
        install::check_parent(root)?;
        for name in [
            "jobs.sqlite3",
            "jobs.sqlite3-journal",
            "jobs.sqlite3-wal",
            "jobs.sqlite3-shm",
            "job.lock",
        ] {
            install::plain(&root.join(name), false)?;
        }
        let db = Connection::open(root.join("jobs.sqlite3")).map_err(|e| e.to_string())?;
        db.busy_timeout(Duration::from_secs(2))
            .map_err(|e| e.to_string())?;
        db.execute_batch("PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS pack_job(id TEXT PRIMARY KEY, record TEXT NOT NULL);").map_err(|e|e.to_string())?;
        let packs = root.join("packs");
        if !install::plain(&packs, true)? {
            fs::create_dir(&packs).map_err(|e| e.to_string())?;
        }
        Ok(Self {
            root: root.to_owned(),
            db,
        })
    }
    fn lease(&self) -> Result<File, String> {
        let path = self.root.join("job.lock");
        install::plain(&path, false)?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path)
            .map_err(|e| e.to_string())?;
        fs2::FileExt::try_lock_exclusive(&file).map_err(|_| {
            "Another Novelty window is managing data downloads. Check that window.".to_string()
        })?;
        Ok(file)
    }
    fn save(&self, job: &Job) -> Result<(), String> {
        let json = serde_json::to_string(job).map_err(|e| e.to_string())?;
        self.db.execute("INSERT INTO pack_job(id,record) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET record=excluded.record",rusqlite::params![job.id,json]).map_err(|e|e.to_string())?;
        Ok(())
    }
    fn load(&self) -> Result<HashMap<String, Job>, String> {
        let mut statement = self
            .db
            .prepare("SELECT record FROM pack_job")
            .map_err(|e| e.to_string())?;
        let records = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut jobs = HashMap::new();
        for record in records {
            let mut job: Job = serde_json::from_str(&record.map_err(|e| e.to_string())?)
                .map_err(|e| format!("Cannot read data download recovery: {e}"))?;
            let selected = entry(&job.id)?;
            if selected.manifest_sha256 != job.manifest_sha256
                || !Path::new(&job.parent).is_absolute()
                || Path::new(&job.parent).join(&job.id).join("data") != Path::new(&job.path)
            {
                return Err(
                    "A data download recovery record is invalid. Its files were preserved.".into(),
                );
            }
            if job.active() {
                job.state = State::Interrupted;
                job.error =
                    Some("Novelty closed before this download finished. Resume when ready.".into());
            }
            jobs.insert(job.id.clone(), job);
        }
        Ok(jobs)
    }
}
#[derive(Default)]
struct Manager {
    store: Option<Store>,
    jobs: HashMap<String, Job>,
    review: Option<Reviewed>,
    cache_review: Option<ReviewedCache>,
    lease: Option<File>,
    cancel: Option<Arc<AtomicBool>>,
}
impl Manager {
    fn idle(&self) -> Result<(), String> {
        if self.jobs.values().any(Job::active) {
            Err("Wait for the active data download to finish, or cancel it first.".into())
        } else {
            Ok(())
        }
    }
    fn store(&self) -> Result<&Store, String> {
        self.store
            .as_ref()
            .ok_or("Data downloads are not initialized.".into())
    }
    fn refresh(&mut self) -> Result<(), String> {
        if self.jobs.values().any(Job::active) {
            return Ok(());
        }
        let store = self.store()?;
        let _lease = store.lease()?;
        self.jobs = store.load()?;
        Ok(())
    }
    fn begin(&mut self, token: &str) -> Result<(Job, Arc<AtomicBool>), String> {
        self.idle()?;
        let reviewed = self
            .review
            .as_ref()
            .filter(|r| r.view.token == token && r.at.elapsed() < Duration::from_secs(15 * 60))
            .ok_or("Review this download again before starting.")?;
        let lease = self.store()?.lease()?;
        let selected = entry(&reviewed.view.id)?;
        let parent = Path::new(&reviewed.view.parent);
        let restored = self.store()?.load()?;
        if restored.get(&selected.id) != reviewed.previous.as_ref() {
            return Err("This download changed in another window. Review it again.".into());
        }
        let space_parent = reviewed.create_parent.as_deref().unwrap_or(parent);
        install::check_parent(space_parent)?;
        if reviewed.create_parent.is_some() {
            if parent.parent() != Some(space_parent) || install::plain(parent, true)? {
                return Err("The new download folder changed. Review restoration again.".into());
            }
        } else {
            install::Workspace::inspect(parent, &source(&selected))?;
        }
        let required = install::additional_space(&reviewed.manifest, &parent.join(&selected.id))?;
        if fs2::available_space(space_parent).map_err(|e| e.to_string())? < required {
            return Err("There is no longer enough free space. Review this download again.".into());
        }
        let mut retained_paths = reviewed
            .previous
            .as_ref()
            .map(|job| job.retained_paths.clone())
            .unwrap_or_default();
        if let Some(previous) = &reviewed.view.previous_path {
            if !retained_paths.contains(previous) {
                retained_paths.push(previous.clone());
            }
        }
        if reviewed.create_parent.is_some() {
            // Exclusive creation: a reviewed restoration never reuses or deletes
            // an existing destination, and cannot overwrite the selected copy.
            fs::create_dir(parent).map_err(|e| e.to_string())?;
        }
        let job = Job {
            id: selected.id.clone(),
            state: State::Running,
            parent: reviewed.view.parent.clone(),
            path: reviewed.view.path.clone(),
            phase: "checking".into(),
            completed_bytes: 0,
            total_bytes: selected.download_bytes,
            error: None,
            manifest_sha256: selected.manifest_sha256,
            retained_paths,
        };
        self.store()?.save(&job)?;
        let cancel = Arc::new(AtomicBool::new(false));
        self.jobs = restored;
        self.jobs.insert(job.id.clone(), job.clone());
        self.lease = Some(lease);
        self.cancel = Some(cancel.clone());
        self.review = None;
        self.cache_review = None;
        Ok((job, cancel))
    }
    fn finish(&mut self, id: &str, result: Result<PathBuf, String>, cancelled: bool) {
        if let Some(mut job) = self.jobs.get(id).cloned() {
            match result {
                Ok(path) => {
                    job.state = State::Ready;
                    job.path = path.display().to_string();
                    job.phase = "ready".into();
                    job.error = None;
                    job.completed_bytes = job.total_bytes;
                }
                Err(error) => {
                    job.state = if cancelled {
                        State::Cancelled
                    } else {
                        State::Failed
                    };
                    job.error = Some(error);
                }
            }
            if let Err(error) = self.store().and_then(|store| store.save(&job)) {
                job.state = State::Failed;
                job.error=Some(format!("Could not save download completion: {error}. Resume to verify the retained data."));
            }
            self.jobs.insert(id.into(), job);
        }
        self.lease = None;
        self.cancel = None;
    }
}
static MANAGER: LazyLock<Mutex<Manager>> = LazyLock::new(|| Mutex::new(Manager::default()));
pub fn configure(root: &Path) -> Result<(), String> {
    crate::otb_packs::configure(root)?;
    let mut manager = MANAGER.lock().map_err(|e| e.to_string())?;
    if let Some(store) = &manager.store {
        if store.root != root {
            return Err("Data download storage changed while Novelty was open.".into());
        }
    } else {
        manager.store = Some(Store::open(root)?);
    }
    manager.refresh()
}
pub struct UpdateGuard {
    _manager: std::sync::MutexGuard<'static, Manager>,
    _lease: Option<File>,
}

pub fn lock_for_app_update() -> Result<UpdateGuard, String> {
    let manager = MANAGER
        .try_lock()
        .map_err(|_| "Data downloads are busy. Retry the app update shortly.")?;
    manager.idle()?;
    let lease = manager.store.as_ref().map(Store::lease).transpose()?;
    Ok(UpdateGuard {
        _manager: manager,
        _lease: lease,
    })
}
pub fn status() -> Result<Vec<Job>, String> {
    let mut manager = MANAGER.lock().map_err(|e| e.to_string())?;
    manager.refresh()?;
    let mut jobs: Vec<_> = manager.jobs.values().cloned().collect();
    jobs.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(jobs)
}
pub fn selected_ids(
    jobs: &[Job],
    rated: &[PathBuf],
    broadcasts: &[PathBuf],
    evaluations: &Path,
) -> Result<Vec<String>, String> {
    let mut selected = Vec::new();
    for job in jobs.iter().filter(|job| job.state == State::Ready) {
        let path = Path::new(&job.path);
        let Ok(catalog_entry) = entry(&job.id) else {
            continue;
        };
        let matches = match catalog_entry.kind {
            Kind::Rated => rated.contains(&path.join("opening-rated.sqlite3")),
            Kind::Broadcasts => broadcasts.contains(&path.join("opening.sqlite3")),
            Kind::Evaluations => evaluations == path,
            Kind::Otb => false,
        };
        if matches {
            selected.push(job.id.clone());
        }
    }
    Ok(selected)
}

pub fn review_cache(id: &str) -> Result<CacheReview, String> {
    let mut manager = MANAGER.lock().map_err(|e| e.to_string())?;
    manager.refresh()?;
    manager.idle()?;
    let _lease = manager.store()?.lease()?;
    let job = manager
        .jobs
        .get(id)
        .filter(|job| job.state == State::Ready)
        .ok_or("Finish this download before removing its cache.")?;
    let parent = job.parent.clone();
    let snapshot = super::cache::review(&source(&entry(id)?), Path::new(&parent))?;
    let mut token = [0u8; 16];
    getrandom::fill(&mut token).map_err(|e| e.to_string())?;
    let view = CacheReview {
        token: hex::encode(token),
        id: id.into(),
        cache_bytes: snapshot.bytes(),
        file_count: snapshot.count(),
    };
    manager.cache_review = Some(ReviewedCache {
        view: view.clone(),
        parent,
        snapshot,
        at: Instant::now(),
    });
    Ok(view)
}
pub fn remove_cache(token: &str) -> Result<(), String> {
    let mut manager = MANAGER.lock().map_err(|e| e.to_string())?;
    manager.refresh()?;
    manager.idle()?;
    let _lease = manager.store()?.lease()?;
    let reviewed = manager
        .cache_review
        .take()
        .filter(|review| {
            review.view.token == token && review.at.elapsed() < Duration::from_secs(15 * 60)
        })
        .ok_or("Review the download cache again before removing it.")?;
    let job = manager
        .jobs
        .get(&reviewed.view.id)
        .filter(|job| job.state == State::Ready && job.parent == reviewed.parent)
        .ok_or("This download changed. Review its cache again.")?;
    super::cache::remove_reviewed(
        &source(&entry(&job.id)?),
        Path::new(&job.parent),
        &reviewed.snapshot,
    )
}
pub fn default_parent() -> Result<String, String> {
    Ok(MANAGER
        .lock()
        .map_err(|e| e.to_string())?
        .store()?
        .root
        .join("packs")
        .display()
        .to_string())
}
pub fn review(id: &str, parent: &str, new_copy: bool) -> Result<Review, String> {
    let selected = entry(id)?;
    let parent = PathBuf::from(parent);
    let (lease, previous) = {
        let mut manager = MANAGER.lock().map_err(|e| e.to_string())?;
        manager.refresh()?;
        manager.idle()?;
        if !new_copy
            && manager
                .jobs
                .get(id)
                .is_some_and(|job| Path::new(&job.parent) != parent)
        {
            return Err("Resume this pack in its original download folder.".into());
        }
        if new_copy && !manager.jobs.contains_key(id) {
            return Err(
                "There is no previous download to restore. Review a new download instead.".into(),
            );
        }
        (manager.store()?.lease()?, manager.jobs.get(id).cloned())
    };
    install::check_parent(&parent)?;
    let manifest = if new_copy {
        // Do not depend on readable old files; the owner may have removed the
        // folder or the manifest itself may be damaged.
        let bytes = install::fetch_manifest(&source(&selected), &AtomicBool::new(false))?;
        Manifest::parse(&bytes, &selected.manifest_sha256, id, &selected.kind)?
    } else {
        install::review_manifest(&source(&selected), &parent)?
    };
    if manifest.download_bytes != selected.download_bytes
        || manifest.unpacked_bytes != selected.installed_bytes
    {
        return Err(
            "The published data pack differs from its catalog. Update Novelty before downloading."
                .into(),
        );
    }
    let available = fs2::available_space(&parent).map_err(|e| e.to_string())?;
    let mut token = [0_u8; 16];
    getrandom::fill(&mut token).map_err(|e| e.to_string())?;
    let create_parent = new_copy.then(|| parent.clone());
    let parent = if new_copy {
        parent.join(format!("novelty-restore-{}", hex::encode(token)))
    } else {
        parent
    };
    if new_copy && install::plain(&parent, true)? {
        return Err("The restoration folder already exists. Review again.".into());
    }
    let required = install::additional_space(&manifest, &parent.join(id))?;
    let view = Review {
        token: hex::encode(token),
        id: id.into(),
        parent: parent.display().to_string(),
        path: parent.join(id).join("data").display().to_string(),
        download_bytes: manifest.download_bytes,
        installed_bytes: manifest.unpacked_bytes,
        required_bytes: required,
        available_bytes: available,
        previous_path: new_copy.then(|| previous.as_ref().unwrap().path.clone()),
    };
    let mut manager = MANAGER.lock().map_err(|e| e.to_string())?;
    manager.idle()?;
    manager.review = Some(Reviewed {
        view: view.clone(),
        manifest,
        at: Instant::now(),
        previous,
        create_parent,
    });
    drop(lease);
    Ok(view)
}
pub fn start(token: &str) -> Result<Job, String> {
    let (job, cancel) = MANAGER.lock().map_err(|e| e.to_string())?.begin(token)?;
    let id = job.id.clone();
    let parent = PathBuf::from(&job.parent);
    let selected = entry(&id)?;
    let spawned = std::thread::Builder::new()
        .name("novelty-data-pack".into())
        .spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                install::install(
                    &source(&selected),
                    &parent,
                    &cancel,
                    |progress: Progress| {
                        if let Ok(mut manager) = MANAGER.lock() {
                            if let Some(job) = manager.jobs.get_mut(&id) {
                                job.phase = progress.phase.into();
                                job.completed_bytes = progress.completed_bytes;
                                job.total_bytes = progress.total_bytes;
                            }
                        }
                    },
                )
            }))
            .unwrap_or_else(|_| {
                Err("The data download stopped unexpectedly. Its parts are kept for resume.".into())
            });
            if let Ok(mut manager) = MANAGER.lock() {
                manager.finish(&id, result, cancel.load(Ordering::Relaxed));
            }
        });
    if let Err(error) = spawned {
        let message = error.to_string();
        MANAGER
            .lock()
            .map_err(|e| e.to_string())?
            .finish(&job.id, Err(message.clone()), false);
        return Err(message);
    }
    Ok(job)
}
pub fn cancel(id: &str) -> Result<bool, String> {
    let mut manager = MANAGER.lock().map_err(|e| e.to_string())?;
    if !manager.jobs.get(id).is_some_and(Job::active) {
        return Ok(false);
    }
    if let Some(cancel) = &manager.cancel {
        cancel.store(true, Ordering::Relaxed);
    }
    manager.jobs.get_mut(id).unwrap().state = State::Cancelling;
    Ok(true)
}

/// Hold process and OS download ownership while consolidating managed OTB packs.
pub(super) fn with_idle_otb<T>(
    run: impl FnOnce(&Path, &[Job]) -> Result<T, String>,
) -> Result<T, String> {
    let mut manager = MANAGER.lock().map_err(|e| e.to_string())?;
    manager.refresh()?;
    manager.idle()?;
    let store = manager.store()?;
    let _lease = store.lease()?;
    let jobs: Vec<_> = manager.jobs.values().cloned().collect();
    run(&store.root, &jobs)
}

/// Removal shares the install/selection lease; forget jobs only after file removal succeeds.
pub(super) fn with_removal<T>(
    run: impl FnOnce(&Path, &[Job]) -> Result<(T, Vec<String>), String>,
) -> Result<T, String> {
    let mut manager = MANAGER.lock().map_err(|e| e.to_string())?;
    manager.refresh()?;
    manager.idle()?;
    let store = manager.store()?;
    let _lease = store.lease()?;
    let jobs: Vec<_> = manager.jobs.values().cloned().collect();
    let (result, removed) = run(&store.root, &jobs)?;
    for id in removed {
        manager
            .store()?
            .db
            .execute("DELETE FROM pack_job WHERE id=?1", [&id])
            .map_err(|e| e.to_string())?;
        manager.jobs.remove(&id);
    }
    manager.review = None;
    manager.cache_review = None;
    Ok(result)
}
