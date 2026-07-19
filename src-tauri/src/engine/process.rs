use std::{
    env,
    fmt::Display,
    path::{Path, PathBuf},
    process::Stdio,
};

use log::{error, info};
use serde::Serialize;
use specta::Type;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    time::{timeout, Duration},
};
use vampirc_uci::UciMessage;

use crate::error::Error;

use super::{normalize_uci_moves_for_fen, types::GoMode};

#[cfg(target_os = "windows")]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(target_os = "windows")]
pub const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x00004000;

const ENGINE_STARTUP_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_ENGINE_LOGS: usize = 1000;
const REMOTE_COMPUTE_HOST_ENV: &str = "EN_CROISSANT_REMOTE_COMPUTE_HOST";
const REMOTE_ENGINE_PATH_ENV: &str = "EN_CROISSANT_REMOTE_ENGINE_PATH";

fn is_stockfish_executable(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.to_ascii_lowercase().starts_with("stockfish"))
}

fn is_safe_ssh_host(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '@'))
}

fn is_safe_remote_engine_path(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|ch| {
            ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':' | '/' | '\\')
        })
}

fn remote_stockfish_target(path: &Path) -> Option<(String, String)> {
    if !is_stockfish_executable(path) {
        return None;
    }

    let host = env::var(REMOTE_COMPUTE_HOST_ENV).ok()?;
    let remote_path = env::var(REMOTE_ENGINE_PATH_ENV).ok()?;
    if !is_safe_ssh_host(&host) || !is_safe_remote_engine_path(&remote_path) {
        return None;
    }

    Some((host, remote_path))
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum EngineLog {
    Gui(String),
    Engine(String),
}

pub type EngineReader = Lines<BufReader<ChildStdout>>;

pub struct BaseEngine {
    pub stdin: ChildStdin,
    pub reader: Option<EngineReader>,
    #[allow(dead_code)]
    child: Child,
    logs: Vec<EngineLog>,
}

impl BaseEngine {
    pub async fn spawn(path: PathBuf) -> Result<Self, Error> {
        let mut command = if let Some((host, remote_path)) = remote_stockfish_target(&path) {
            info!("Offloading Stockfish engine work to SSH host {host}");
            let mut remote = Command::new("ssh.exe");
            // This SSH session intentionally keeps stdin open: it is the UCI
            // transport between En Croissant and Stockfish on the gaming PC.
            remote
                .arg("-T")
                .arg("-o")
                .arg("BatchMode=yes")
                .arg("-o")
                .arg("ConnectTimeout=4")
                .arg(host)
                .arg(remote_path);
            remote
        } else {
            Command::new(&path)
        };
        command.current_dir(path.parent().unwrap_or(&path));
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);

        let mut child = command.spawn()?;

        let stdin = child.stdin.take().ok_or(Error::NoStdin)?;
        let stdout = child.stdout.take().ok_or(Error::NoStdout)?;
        let reader = BufReader::new(stdout).lines();

        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut stderr_reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = stderr_reader.next_line().await {
                    error!("Engine stderr: {}", line);
                }
            });
        }

        Ok(Self {
            stdin,
            reader: Some(reader),
            child,
            logs: Vec::new(),
        })
    }

    pub fn take_reader(&mut self) -> Option<EngineReader> {
        self.reader.take()
    }

    pub fn reader_mut(&mut self) -> Option<&mut EngineReader> {
        self.reader.as_mut()
    }

    pub fn get_logs(&self) -> Vec<EngineLog> {
        self.logs.clone()
    }

    fn push_log(&mut self, log: EngineLog) {
        if self.logs.len() >= MAX_ENGINE_LOGS {
            self.logs.remove(0);
        }
        self.logs.push(log);
    }

    fn log_gui(&mut self, cmd: &str) {
        self.push_log(EngineLog::Gui(format!("{}\n", cmd)));
    }

    pub fn log_engine(&mut self, line: &str) {
        self.push_log(EngineLog::Engine(line.to_string()));
    }

    pub async fn init_uci(&mut self) -> Result<(), Error> {
        self.send("uci").await?;
        self.wait_for("uciok").await?;
        self.send("isready").await?;
        self.wait_for("readyok").await?;
        Ok(())
    }

    pub async fn send(&mut self, cmd: &str) -> Result<(), Error> {
        self.log_gui(cmd);
        let msg = format!("{}\n", cmd);
        self.stdin.write_all(msg.as_bytes()).await?;
        Ok(())
    }

    pub async fn wait_for(&mut self, expected: &str) -> Result<(), Error> {
        loop {
            let line = {
                let reader = self.reader.as_mut().ok_or(Error::EngineDisconnected)?;
                timeout(ENGINE_STARTUP_TIMEOUT, reader.next_line())
                    .await
                    .map_err(|_| Error::EngineStartupTimedOut(expected.to_string()))??
            };
            let Some(line) = line else {
                return Err(Error::EngineDisconnected);
            };
            self.log_engine(&line);
            if line.starts_with(expected) {
                return Ok(());
            }
        }
    }

    pub async fn set_option<T>(&mut self, name: &str, value: T) -> Result<(), Error>
    where
        T: Display,
    {
        let cmd = format!("setoption name {} value {}", name, value);
        self.send(&cmd).await
    }

    pub async fn set_position(&mut self, fen: &str, moves: &[String]) -> Result<(), Error> {
        let normalized_moves = normalize_uci_moves_for_fen(fen, moves)?;
        let cmd = if moves.is_empty() {
            format!("position fen {}", fen)
        } else {
            format!("position fen {} moves {}", fen, normalized_moves.join(" "))
        };
        self.send(&cmd).await
    }

    pub async fn go(&mut self, mode: &GoMode) -> Result<(), Error> {
        let cmd = mode.to_uci_string();
        self.send(&cmd).await
    }

    pub async fn stop(&mut self) -> Result<(), Error> {
        self.send("stop").await
    }

    pub async fn quit(&mut self) -> Result<(), Error> {
        self.send("quit").await
    }

    pub async fn wait_for_bestmove(&mut self) -> Result<String, Error> {
        loop {
            let line = {
                let reader = self.reader.as_mut().ok_or(Error::EngineDisconnected)?;
                reader.next_line().await?
            };
            let Some(line) = line else {
                return Err(Error::EngineDisconnected);
            };
            self.log_engine(&line);
            if let UciMessage::BestMove { best_move, .. } = vampirc_uci::parse_one(&line) {
                return Ok(best_move.to_string());
            }
        }
    }

    pub fn kill_sync(&mut self) {
        let _ = self.child.start_kill();
    }
}

impl Drop for BaseEngine {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

#[cfg(test)]
mod tests {
    use super::{is_safe_remote_engine_path, is_safe_ssh_host, is_stockfish_executable};
    use std::path::Path;

    #[test]
    fn remote_compute_only_substitutes_stockfish() {
        assert!(is_stockfish_executable(Path::new(
            r"C:\engines\stockfish-windows-x86-64-avx2.exe"
        )));
        assert!(!is_stockfish_executable(Path::new(r"C:\engines\lc0.exe")));
    }

    #[test]
    fn remote_compute_rejects_shell_metacharacters() {
        assert!(is_safe_ssh_host("gaming-pc-compute"));
        assert!(!is_safe_ssh_host("gaming-pc-compute & whoami"));
        assert!(is_safe_remote_engine_path(
            "C:/Users/loxty/AppData/Local/EnCroissantRemoteCompute/stockfish.exe"
        ));
        assert!(!is_safe_remote_engine_path("stockfish.exe & whoami"));
    }
}
