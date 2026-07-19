use std::env;
use std::fs;
use std::io::{self, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

#[derive(Default)]
struct Config {
    endpoints: Vec<String>,
    fallback_engine: Option<PathBuf>,
    connect_timeout_ms: u64,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Stockfish remote client: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let executable = env::current_exe().map_err(|error| error.to_string())?;
    let config_path = executable.with_extension("conf");
    let config = read_config(&config_path)?;

    for endpoint in &config.endpoints {
        match connect(endpoint, config.connect_timeout_ms) {
            Ok(stream) => return relay(stream),
            Err(error) => eprintln!("Stockfish remote client: {endpoint}: {error}"),
        }
    }

    if let Some(fallback_engine) = config.fallback_engine {
        return run_fallback(&fallback_engine);
    }

    Err("the Gaming PC is unreachable and no fallback engine is configured".to_string())
}

fn read_config(path: &Path) -> Result<Config, String> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?;
    let mut config = Config {
        connect_timeout_ms: 1_500,
        ..Config::default()
    };

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        match key.trim().to_ascii_lowercase().as_str() {
            "endpoint" => config.endpoints.push(value.trim().to_string()),
            "fallbackengine" => config.fallback_engine = Some(PathBuf::from(value.trim())),
            "connecttimeoutms" => {
                config.connect_timeout_ms = value.trim().parse().unwrap_or(1_500)
            }
            _ => {}
        }
    }

    if config.endpoints.is_empty() {
        return Err(format!("{} does not contain an Endpoint", path.display()));
    }
    Ok(config)
}

fn connect(endpoint: &str, timeout_ms: u64) -> io::Result<TcpStream> {
    let timeout = Duration::from_millis(timeout_ms.max(100));
    let addresses: Vec<SocketAddr> = endpoint.to_socket_addrs()?.collect();
    let mut last_error = None;
    for address in addresses {
        match TcpStream::connect_timeout(&address, timeout) {
            Ok(stream) => {
                stream.set_nodelay(true)?;
                return Ok(stream);
            }
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no endpoint address")))
}

fn relay(stream: TcpStream) -> Result<(), String> {
    let mut to_engine = stream.try_clone().map_err(|error| error.to_string())?;
    let _input_thread = thread::spawn(move || -> io::Result<()> {
        let mut input = io::stdin().lock();
        io::copy(&mut input, &mut to_engine)?;
        Ok(())
    });

    let mut from_engine = stream;
    let mut output = io::stdout().lock();
    io::copy(&mut from_engine, &mut output).map_err(|error| error.to_string())?;
    output.flush().map_err(|error| error.to_string())?;
    Ok(())
}

fn run_fallback(path: &Path) -> Result<(), String> {
    let status = Command::new(path)
        .current_dir(path.parent().unwrap_or_else(|| Path::new(".")))
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|error| format!("could not start fallback {}: {error}", path.display()))?;
    std::process::exit(status.code().unwrap_or(1));
}
