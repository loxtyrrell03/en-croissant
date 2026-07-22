use std::env;
use std::fs;
use std::io::{self, Write};
use std::net::{Shutdown, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

#[derive(Default)]
struct Config {
    endpoint: String,
    connect_timeout_ms: u64,
    fallback_engine: Option<PathBuf>,
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

    match connect(&config.endpoint, config.connect_timeout_ms) {
        Ok(stream) => relay(stream).map_err(|error| error.to_string()),
        Err(remote_error) => {
            let Some(fallback) = config.fallback_engine else {
                return Err(format!(
                    "could not connect to {} ({remote_error}) and no fallback engine is configured",
                    config.endpoint
                ));
            };
            eprintln!(
                "Stockfish remote client: Gaming PC unavailable ({remote_error}); using {}",
                fallback.display()
            );
            run_fallback(&fallback)
        }
    }
}

fn read_config(path: &Path) -> Result<Config, String> {
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?;
    let mut config = Config {
        connect_timeout_ms: 1_500,
        ..Config::default()
    };

    for raw_line in contents.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        let Some((raw_key, raw_value)) = line.split_once('=') else {
            continue;
        };
        let key = raw_key.trim().to_ascii_lowercase();
        let value = raw_value.trim();
        match key.as_str() {
            "endpoint" => config.endpoint = value.to_owned(),
            "connecttimeoutms" => {
                config.connect_timeout_ms = value.parse().unwrap_or(1_500).clamp(100, 60_000)
            }
            "fallbackengine" if !value.is_empty() => {
                config.fallback_engine = Some(PathBuf::from(value))
            }
            _ => {}
        }
    }

    if config.endpoint.is_empty() {
        return Err(format!("{} does not contain an Endpoint", path.display()));
    }
    Ok(config)
}

fn connect(endpoint: &str, timeout_ms: u64) -> io::Result<TcpStream> {
    let addresses = endpoint.to_socket_addrs()?;
    let timeout = Duration::from_millis(timeout_ms);
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
    Err(last_error.unwrap_or_else(|| {
        io::Error::new(io::ErrorKind::AddrNotAvailable, "endpoint resolved to no addresses")
    }))
}

fn relay(mut stream: TcpStream) -> io::Result<()> {
    let mut reader = stream.try_clone()?;
    let _input_thread = thread::spawn(move || {
        let mut input = io::stdin();
        let result = io::copy(&mut input, &mut stream);
        let _ = stream.shutdown(Shutdown::Write);
        result
    });

    let mut output = io::stdout();
    io::copy(&mut reader, &mut output)?;
    output.flush()?;

    Ok(())
}

fn run_fallback(path: &Path) -> Result<(), String> {
    let status = Command::new(path)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|error| format!("could not start fallback {}: {error}", path.display()))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("fallback {} exited with {status}", path.display()))
    }
}
