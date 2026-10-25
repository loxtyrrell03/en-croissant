//! Limits and request ownership for the optional evaluation builder.
use super::LocalEvalError;
use once_cell::sync::Lazy;
use std::{
    collections::HashMap,
    fs, io,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

pub const DEFAULT_BUILD_DISK_LIMIT_BYTES: u64 = 64 * 1024 * 1024 * 1024;
pub const MAX_BUILD_DISK_LIMIT_BYTES: u64 = 512 * 1024 * 1024 * 1024;
pub(super) const MAX_LINE_BYTES: u64 = 1024 * 1024;
pub(super) const MAX_SHARD_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone)]
pub struct LocalEvalBuildControl {
    pub disk_limit_bytes: u64,
    pub cancel: Arc<AtomicBool>,
    /// Optional CLI cancellation signal. The builder reads but never removes it.
    pub cancel_file: Option<PathBuf>,
    pub(super) state: Arc<AtomicU8>, // 0 running, 1 cancelled, 2 publication begun
    pub(super) max_line_bytes: u64,
    pub(super) max_shard_bytes: u64,
    pub(super) read_stall: Duration,
    pub(super) ownership: Option<[u8; 16]>,
}

impl Default for LocalEvalBuildControl {
    fn default() -> Self {
        Self {
            disk_limit_bytes: DEFAULT_BUILD_DISK_LIMIT_BYTES,
            cancel: Arc::new(AtomicBool::new(false)),
            cancel_file: None,
            state: Arc::new(AtomicU8::new(0)),
            max_line_bytes: MAX_LINE_BYTES,
            max_shard_bytes: MAX_SHARD_BYTES,
            read_stall: Duration::from_secs(30),
            ownership: None,
        }
    }
}

impl LocalEvalBuildControl {
    pub fn for_gib(limit_gib: u16) -> Result<Self, LocalEvalError> {
        if !(1..=512).contains(&limit_gib) {
            return Err(LocalEvalError::InvalidOption(
                "Disk-space limit must be from 1 to 512 GiB.".into(),
            ));
        }
        Ok(Self {
            disk_limit_bytes: u64::from(limit_gib) * 1024 * 1024 * 1024,
            ..Self::default()
        })
    }

    pub(super) fn check(&self) -> Result<(), LocalEvalError> {
        if let Some(path) = &self.cancel_file {
            match fs::metadata(path) {
                Ok(_) => self.cancel.store(true, Ordering::Relaxed),
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
        if self.cancel.load(Ordering::Relaxed) || self.state.load(Ordering::Acquire) == 1 {
            Err(LocalEvalError::Cancelled)
        } else if self.state.load(Ordering::Acquire) == 2 {
            Err(LocalEvalError::InvalidOption(
                "This build control has finished. Use a new control for each build.".into(),
            ))
        } else {
            Ok(())
        }
    }

    pub(super) fn check_io(&self) -> io::Result<()> {
        self.check()
            .map_err(|error| io::Error::other(error.to_string()))
    }

    pub(super) fn begin_publication(&self) -> Result<(), LocalEvalError> {
        self.check()?;
        self.state
            .compare_exchange(0, 2, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| ())
            .map_err(|_| LocalEvalError::Cancelled)
    }
}

pub(super) struct DiskBudget {
    pub used: u64,
    pub limit: u64,
}

impl DiskBudget {
    pub fn reserve(&mut self, bytes: u64) -> io::Result<()> {
        let next = self
            .used
            .checked_add(bytes)
            .ok_or_else(|| io::Error::other("Evaluation build size overflow."))?;
        if next > self.limit {
            return Err(io::Error::other("Evaluation build reached its disk-space limit. Choose a larger explicit limit or a smaller source."));
        }
        self.used = next;
        Ok(())
    }
    pub fn release(&mut self, bytes: u64) {
        self.used = self.used.saturating_sub(bytes);
    }
}

pub(super) struct BudgetWriter<'a, W> {
    pub inner: W,
    pub budget: &'a mut DiskBudget,
    pub control: &'a LocalEvalBuildControl,
}

impl<W: io::Write> io::Write for BudgetWriter<'_, W> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.control.check_io()?;
        self.budget.reserve(bytes.len() as u64)?;
        match self.inner.write(bytes) {
            Ok(count) => {
                self.budget.release((bytes.len() - count) as u64);
                Ok(count)
            }
            Err(error) => {
                self.budget.release(bytes.len() as u64);
                Err(error)
            }
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        self.control.check_io()?;
        self.inner.flush()
    }
}

static ACTIVE: Lazy<Mutex<HashMap<String, BuildState>>> = Lazy::new(|| Mutex::new(HashMap::new()));

struct BuildState {
    cancel: Arc<AtomicBool>,
    state: Arc<AtomicU8>,
}

pub(super) struct BuildLease {
    id: String,
    pub cancel: Arc<AtomicBool>,
    pub state: Arc<AtomicU8>,
}

impl BuildLease {
    pub fn start(id: &str) -> Result<Self, LocalEvalError> {
        if id.is_empty() || id.len() > 256 {
            return Err(LocalEvalError::InvalidOption(
                "Build ID must contain 1 to 256 bytes.".into(),
            ));
        }
        let mut active = ACTIVE.lock().map_err(|_| {
            LocalEvalError::InvalidOption("Evaluation build registry is unavailable.".into())
        })?;
        if active.contains_key(id) {
            return Err(LocalEvalError::InvalidOption(
                "An evaluation build with this ID is still running or cancelling.".into(),
            ));
        }
        let cancel = Arc::new(AtomicBool::new(false));
        let state = Arc::new(AtomicU8::new(0));
        active.insert(
            id.into(),
            BuildState {
                cancel: cancel.clone(),
                state: state.clone(),
            },
        );
        Ok(Self {
            id: id.into(),
            cancel,
            state,
        })
    }
}

pub(super) fn cancel_build(id: &str) -> bool {
    let Ok(active) = ACTIVE.lock() else {
        return false;
    };
    let Some(build) = active.get(id) else {
        return false;
    };
    match build
        .state
        .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
    {
        Ok(_) | Err(1) => {}
        Err(_) => return false,
    }
    build.cancel.store(true, Ordering::Relaxed);
    true
}

pub(super) fn local_state(id: &str) -> Option<u8> {
    ACTIVE
        .lock()
        .ok()?
        .get(id)
        .map(|build| build.state.load(Ordering::Acquire))
}

impl Drop for BuildLease {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE.lock() {
            if active
                .get(&self.id)
                .is_some_and(|build| Arc::ptr_eq(&build.cancel, &self.cancel))
            {
                active.remove(&self.id);
            }
        }
    }
}
