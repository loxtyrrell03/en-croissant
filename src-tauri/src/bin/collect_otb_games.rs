#[path = "../otb_import.rs"]
mod otb_import;

use std::{
    env,
    io::{self, Write},
    path::PathBuf,
    time::Duration,
};

use otb_import::{collect_otb_games_with_progress, OtbImportRequest};

type Error = Box<dyn std::error::Error + Send + Sync + 'static>;

struct Args {
    job_id: String,
    player_name: String,
    fide_id: Option<String>,
    from_year: u16,
    cache_dir: PathBuf,
    output_path: PathBuf,
    local_pgn_paths: Vec<PathBuf>,
    include_lichess_broadcasts: bool,
    include_lichess_broadcast_archives: bool,
    include_lichess_community_broadcasts: bool,
    include_chess_results: bool,
    include_chessbase_news: bool,
    include_official_pgn_indexes: bool,
    include_twic: bool,
}

fn main() -> Result<(), Error> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let result = runtime.block_on(run());
    // Futures dropped after a host circuit opens can still own non-cancellable
    // spawn_blocking work. The result and PGN are already durable at this point,
    // so do not keep the phone job running while irrelevant workers wind down.
    runtime.shutdown_timeout(Duration::from_millis(250));
    if result.is_ok() {
        // This is a single-shot helper. Successful collection has already
        // flushed its machine-readable result and output file; terminate any
        // detached workers with the process instead of delaying phone status.
        std::process::exit(0);
    }
    result
}

async fn run() -> Result<(), Error> {
    let args = parse_args()?;
    let request = OtbImportRequest {
        job_id: args.job_id,
        player_name: args.player_name,
        fide_id: args.fide_id,
        from_year: args.from_year,
        include_lichess_broadcasts: args.include_lichess_broadcasts,
        include_lichess_broadcast_archives: args.include_lichess_broadcast_archives,
        include_lichess_community_broadcasts: args.include_lichess_community_broadcasts,
        include_chess_results: args.include_chess_results,
        include_chessbase_news: args.include_chessbase_news,
        include_official_pgn_indexes: args.include_official_pgn_indexes,
        include_twic: args.include_twic,
        local_pgn_paths: args.local_pgn_paths,
        cache_dir: args.cache_dir,
        output_path: args.output_path,
    };

    let progress = |event| {
        println!(
            "PROGRESS\t{}",
            serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string())
        );
    };
    let report = collect_otb_games_with_progress(request, &progress)
        .await
        .map_err(invalid_input)?;
    println!("RESULT\t{}", serde_json::to_string(&report)?);
    io::stdout().flush()?;
    Ok(())
}

fn parse_args() -> Result<Args, Error> {
    let mut job_id = "headless-otb-collector".to_string();
    let mut player_name = None;
    let mut fide_id = None;
    let mut from_year = 1900;
    let mut cache_dir = None;
    let mut output_path = None;
    let mut local_pgn_paths = Vec::new();
    let mut include_lichess_broadcasts = true;
    let mut include_lichess_broadcast_archives = false;
    let mut include_lichess_community_broadcasts = false;
    let mut include_chess_results = true;
    let mut include_chessbase_news = true;
    let mut include_official_pgn_indexes = true;
    let mut include_twic = true;
    let mut args = env::args().skip(1);

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--job-id" => {
                job_id = args
                    .next()
                    .ok_or_else(|| invalid_input("--job-id needs a value"))?;
            }
            "--player" => player_name = args.next(),
            "--fide-id" => fide_id = args.next(),
            "--from-year" => {
                from_year = args
                    .next()
                    .ok_or_else(|| invalid_input("--from-year needs a value"))?
                    .parse()?;
            }
            "--cache-dir" => cache_dir = args.next().map(PathBuf::from),
            "--output" => output_path = args.next().map(PathBuf::from),
            "--local-pgn" => {
                local_pgn_paths.push(PathBuf::from(
                    args.next()
                        .ok_or_else(|| invalid_input("--local-pgn needs a value"))?,
                ));
            }
            "--no-lichess-broadcasts" => include_lichess_broadcasts = false,
            "--lichess-broadcast-archives" => include_lichess_broadcast_archives = true,
            "--lichess-community-broadcasts" => include_lichess_community_broadcasts = true,
            "--no-chess-results" => include_chess_results = false,
            "--no-chessbase-news" => include_chessbase_news = false,
            "--no-official-pgn-indexes" => include_official_pgn_indexes = false,
            "--no-twic" => include_twic = false,
            "--help" | "-h" => {
                println!(
                    "Usage: collect_otb_games --player <name> [--fide-id <id>] --cache-dir <folder> --output <games.pgn> [--job-id <id>] [--from-year 1900] [--lichess-broadcast-archives] [--lichess-community-broadcasts] [--local-pgn <file>]... [--no-twic]"
                );
                std::process::exit(0);
            }
            _ => return Err(invalid_input(format!("Unknown argument: {arg}"))),
        }
    }

    Ok(Args {
        job_id,
        player_name: player_name.ok_or_else(|| invalid_input("--player is required"))?,
        fide_id,
        from_year,
        cache_dir: cache_dir.ok_or_else(|| invalid_input("--cache-dir is required"))?,
        output_path: output_path.ok_or_else(|| invalid_input("--output is required"))?,
        local_pgn_paths,
        include_lichess_broadcasts,
        include_lichess_broadcast_archives,
        include_lichess_community_broadcasts,
        include_chess_results,
        include_chessbase_news,
        include_official_pgn_indexes,
        include_twic,
    })
}

fn invalid_input(message: impl Into<String>) -> Error {
    Box::new(io::Error::new(io::ErrorKind::InvalidInput, message.into()))
}
