use std::{env, path::PathBuf, time::Instant};

use en_croissant_fork::local_eval::{
    build_compact_eval_database, database_status, default_cli_store_dir, default_source_url,
    lookup_eval, LocalEvalBuildOptions, LocalEvalSource,
};

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = parse_args()?;
    let output_dir = args.output.clone().unwrap_or_else(default_cli_store_dir);
    if args.status {
        let status = database_status(&output_dir);
        println!(
            "available={} positions={} shards={} max_pvs={} size={} path={}",
            status.available,
            status.positions,
            status.shard_count,
            status.max_pvs,
            human_bytes(status.storage_bytes),
            status.path
        );
        if let Some(error) = status.error {
            println!("error={error}");
        }
        return Ok(());
    }
    if let Some(fen) = args.lookup_fen {
        let result = lookup_eval(&output_dir, &fen, args.max_pvs.unwrap_or(5))
            .map_err(|error| error.to_string())?;
        println!(
            "{}",
            serde_json::to_string_pretty(&result).map_err(|error| error.to_string())?
        );
        return Ok(());
    }

    let source = match (args.source, args.url) {
        (Some(source), _) => LocalEvalSource::File(source),
        (None, Some(url)) => LocalEvalSource::Url(url),
        _ => LocalEvalSource::Url(default_source_url().to_string()),
    };
    let options = LocalEvalBuildOptions {
        id: "lichess-eval-cli-build".to_string(),
        source,
        output_dir,
        max_pvs: args.max_pvs.unwrap_or(5),
        shard_count: args.shards.unwrap_or(2048),
    };

    println!("Building compact Lichess eval store...");
    println!("Output: {}", options.output_dir.display());
    println!("Source: {}", options.source.label());
    println!("Max PVs: {}", options.max_pvs);
    println!("Shards: {}", options.shard_count);

    let started = Instant::now();
    let report = build_compact_eval_database(options, |progress| {
        println!(
            "{:>6.2}% {:<10} positions={} skipped={} compressed={}/{}",
            progress.progress,
            progress.phase,
            progress.positions,
            progress.skipped,
            human_bytes(progress.compressed_bytes_read),
            progress
                .compressed_bytes_total
                .map(human_bytes)
                .unwrap_or_else(|| "?".to_string())
        );
    })
    .map_err(|error| error.to_string())?;

    println!(
        "Done in {:.1}s. Stored {} positions at {} ({}).",
        started.elapsed().as_secs_f32(),
        report.positions,
        report.output_dir,
        human_bytes(report.storage_bytes)
    );
    Ok(())
}

#[derive(Default)]
struct Args {
    source: Option<PathBuf>,
    url: Option<String>,
    output: Option<PathBuf>,
    max_pvs: Option<u8>,
    shards: Option<u16>,
    lookup_fen: Option<String>,
    status: bool,
}

fn parse_args() -> Result<Args, String> {
    let mut parsed = Args::default();
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--source" => parsed.source = Some(next_path(&mut args, "--source")?),
            "--url" => parsed.url = Some(next_value(&mut args, "--url")?),
            "--output" => parsed.output = Some(next_path(&mut args, "--output")?),
            "--max-pvs" => {
                parsed.max_pvs = Some(
                    next_value(&mut args, "--max-pvs")?
                        .parse()
                        .map_err(|_| "--max-pvs must be a number from 1 to 5".to_string())?,
                )
            }
            "--shards" => {
                parsed.shards = Some(
                    next_value(&mut args, "--shards")?
                        .parse()
                        .map_err(|_| "--shards must be a number".to_string())?,
                )
            }
            "--lookup-fen" => parsed.lookup_fen = Some(next_value(&mut args, "--lookup-fen")?),
            "--status" => parsed.status = true,
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            other => return Err(format!("Unknown argument: {other}\n\n{}", help_text())),
        }
    }

    if parsed.source.is_some() && parsed.url.is_some() {
        return Err("Use either --source or --url, not both.".to_string());
    }

    Ok(parsed)
}

fn next_value(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<String, String> {
    args.next()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{flag} needs a value"))
}

fn next_path(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<PathBuf, String> {
    Ok(PathBuf::from(next_value(args, flag)?))
}

fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit + 1 < UNITS.len() {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} {}", UNITS[unit])
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

fn print_help() {
    println!("{}", help_text());
}

fn help_text() -> String {
    format!(
        "Usage: cargo run --manifest-path src-tauri/Cargo.toml --bin build_lichess_eval_db -- [options]\n\
\n\
Options:\n\
  --source <path>   Build from a local lichess_db_eval.jsonl.zst file\n\
  --url <url>       Build from a URL instead of the official Lichess eval dump\n\
  --output <dir>    Output directory (default: app data lichess-cloud-evals)\n\
  --max-pvs <1-5>   Number of root moves/evals to store per position (default: 5)\n\
  --shards <n>      Number of binary shards (default: 2048)\n\
  --status          Print local store status and exit\n\
  --lookup-fen <fen> Look up one position in the local store and print JSON\n\
\n\
Default URL: {}",
        default_source_url()
    )
}
