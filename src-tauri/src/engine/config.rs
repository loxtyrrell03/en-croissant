//! Explicit, bounded UCI identity/configuration probes. A cancelled request
//! cannot cancel another request, and owns its process until shutdown completes.
use super::BaseEngine;
use crate::{chess::EngineConfig, error::Error};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, LazyLock, Mutex,
    },
};
use tokio::time::{timeout, Duration};
use vampirc_uci::{parse_one, UciMessage};

static REQUESTS: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
struct Request {
    id: String,
    cancel: Arc<AtomicBool>,
}
impl Request {
    fn new(id: String) -> Result<Self, Error> {
        if id.is_empty() || id.len() > 80 {
            return Err(Error::InvalidEngineValidation(
                "Invalid engine check request.".into(),
            ));
        }
        let mut requests = REQUESTS
            .lock()
            .map_err(|_| Error::InvalidEngineValidation("Engine checks are unavailable.".into()))?;
        if requests.contains_key(&id) {
            return Err(Error::InvalidEngineValidation(
                "That engine check is already running.".into(),
            ));
        }
        let cancel = Arc::new(AtomicBool::new(false));
        requests.insert(id.clone(), cancel.clone());
        Ok(Self { id, cancel })
    }
}
impl Drop for Request {
    fn drop(&mut self) {
        if let Ok(mut requests) = REQUESTS.lock() {
            if requests
                .get(&self.id)
                .is_some_and(|value| Arc::ptr_eq(value, &self.cancel))
            {
                requests.remove(&self.id);
            }
        }
    }
}
pub fn cancel(id: &str) -> Result<bool, Error> {
    let requests = REQUESTS
        .lock()
        .map_err(|_| Error::InvalidEngineValidation("Engine checks are unavailable.".into()))?;
    if let Some(cancel) = requests.get(id) {
        cancel.store(true, Ordering::SeqCst);
        return Ok(true);
    }
    Ok(false)
}
pub async fn validate(id: String, path: PathBuf) -> Result<EngineConfig, Error> {
    let request = Request::new(id)?;
    read(path, Some(&request.cancel), Duration::from_secs(15)).await
}
pub async fn read(
    path: PathBuf,
    cancel: Option<&AtomicBool>,
    limit: Duration,
) -> Result<EngineConfig, Error> {
    if cancel.is_some_and(|value| value.load(Ordering::SeqCst)) {
        return Err(Error::EngineValidationCancelled);
    }
    let mut base = BaseEngine::spawn(path).await?;
    let result = {
        let probe = async {
            base.send("uci").await?;
            let reader = base.reader_mut().ok_or(Error::EngineDisconnected)?;
            let mut config = EngineConfig::default();
            let mut lines = 0;
            loop {
                let line = reader.next_line().await?.ok_or(Error::EngineDisconnected)?;
                match parse_one(&line) {
                    UciMessage::Id {
                        name: Some(name), ..
                    } => config.name = name,
                    UciMessage::Option(option) => config.options.push(option),
                    UciMessage::UciOk => break,
                    _ => {}
                }
                lines += 1;
                if lines % 64 == 0 {
                    tokio::task::yield_now().await;
                }
            }
            base.quit().await?;
            Ok(config)
        };
        let cancelled = async {
            if let Some(cancel) = cancel {
                while !cancel.load(Ordering::SeqCst) {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            } else {
                std::future::pending::<()>().await;
            }
        };
        tokio::select! {
            biased;
            _ = cancelled => Err(Error::EngineValidationCancelled),
            value = timeout(limit, probe) => match value {
                Ok(result) => result,
                Err(_) => Err(Error::EngineStartupTimedOut("uciok".into())),
            },
        }
    };
    let cleanup = timeout(Duration::from_secs(2), base.kill_and_wait())
        .await
        .map_err(|_| Error::EngineStartupTimedOut("engine check shutdown".into()))?;
    match result {
        Err(error) => Err(error),
        Ok(config) => {
            cleanup?;
            Ok(config)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;
    use sysinfo::{Pid, PidExt, System, SystemExt};

    fn fixture(mode: &str) -> (tempfile::TempDir, PathBuf) {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(format!("config-{mode}.exe"));
        std::fs::copy(
            std::env::var("EN_CROISSANT_CONFIG_TEST_ENGINE").unwrap(),
            &path,
        )
        .unwrap();
        (directory, path)
    }
    async fn assert_stopped(path: &std::path::Path) {
        let pid: u32 = std::fs::read_to_string(path.with_extension("pid"))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        // Windows process-list removal can trail the awaited process exit.
        // Yield to the runtime/reaper while checking a short real-time bound.
        for _ in 0..50 {
            if !System::new().refresh_process(Pid::from_u32(pid)) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("owned probe process must be reaped");
    }
    #[test]
    fn request_identity_rejects_duplicates_and_cancels_only_its_owner() {
        let id = format!("identity-{}", std::process::id());
        let request = Request::new(id.clone()).unwrap();
        assert!(Request::new(id.clone()).is_err());
        assert!(!cancel("a-different-check").unwrap());
        assert!(!request.cancel.load(Ordering::SeqCst));
        assert!(cancel(&id).unwrap());
        assert!(request.cancel.load(Ordering::SeqCst));
        drop(request);
        assert!(!cancel(&id).unwrap());
    }
    #[tokio::test]
    #[ignore = "requires the deterministic config protocol peer"]
    async fn validates_identity_options_and_reaps_a_program_that_ignores_quit() {
        let (_directory, path) = fixture("ignore-quit");
        let config = read(path.clone(), None, Duration::from_secs(2))
            .await
            .unwrap();
        assert_eq!(config.name, "Config Fixture");
        assert_eq!(config.options.len(), 3);
        assert_stopped(&path).await;
    }

    #[tokio::test]
    #[ignore = "requires an explicitly selected verified Stockfish 19 executable"]
    async fn reads_real_stockfish_19_identity_and_options_without_searching() {
        let path = PathBuf::from(std::env::var("EN_CROISSANT_CONFIG_REAL_ENGINE").unwrap());
        let config = validate("real-stockfish-19-config".into(), path).await.unwrap();
        assert_eq!(config.name, "Stockfish 19");
        assert_eq!(config.options.len(), 19);
    }
    #[tokio::test]
    #[ignore = "requires the deterministic config protocol peer"]
    async fn rejects_eof_before_uciok_instead_of_accepting_partial_configuration() {
        let (_directory, path) = fixture("eof");
        assert!(matches!(
            read(path.clone(), None, Duration::from_secs(2)).await,
            Err(Error::EngineDisconnected)
        ));
        assert_stopped(&path).await;
    }
    #[tokio::test]
    #[ignore = "requires the deterministic config protocol peer"]
    async fn total_deadline_bounds_both_silent_and_continuously_talking_programs() {
        for mode in ["silent", "flood"] {
            let (_directory, path) = fixture(mode);
            let start = Instant::now();
            assert!(matches!(
                read(path.clone(), None, Duration::from_millis(80)).await,
                Err(Error::EngineStartupTimedOut(_))
            ));
            assert!(start.elapsed() < Duration::from_secs(2));
            assert_stopped(&path).await;
        }
    }
    #[tokio::test]
    #[ignore = "requires the deterministic config protocol peer"]
    async fn cancellation_stops_and_reaps_only_the_requested_stalled_program() {
        let (_directory, path) = fixture("silent");
        let id = "config-cancel-fixture".to_string();
        let trigger = id.clone();
        let pid_file = path.with_extension("pid");
        let task = tokio::spawn(async move {
            for _ in 0..100 {
                if pid_file.exists() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            assert!(cancel(&trigger).unwrap());
        });
        let start = Instant::now();
        assert!(matches!(
            validate(id.clone(), path.clone()).await,
            Err(Error::EngineValidationCancelled)
        ));
        assert!(start.elapsed() < Duration::from_secs(2));
        task.await.unwrap();
        assert_stopped(&path).await;
        assert!(!cancel(&id).unwrap());
    }
}
