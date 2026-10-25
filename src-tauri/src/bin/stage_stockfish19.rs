//! Build-only staging. Generated assets/config stay below an explicit directory;
//! this tool never reads or changes engine profiles, sessions or hosting.
use en_croissant_fork::stockfish_install;
use std::{
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc},
};

#[tokio::main]
async fn main() -> Result<(), String> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let option = |key: &str| -> Result<Option<String>, String> {
        let Some(index) = args.iter().position(|arg| arg == key) else {
            return Ok(None);
        };
        args.get(index + 1)
            .filter(|arg| !arg.starts_with("--"))
            .cloned()
            .map(Some)
            .ok_or(format!("Missing {key}"))
    };
    if args
        .iter()
        .step_by(2)
        .any(|arg| !["--stage-root", "--arch", "--archive"].contains(&arg.as_str()))
    {
        return Err("Use --stage-root ABSOLUTE_DIRECTORY [--arch x64|arm64] [--archive VERIFIED_RELEASE_ZIP]".into());
    }
    let root =
        PathBuf::from(option("--stage-root")?.ok_or("An explicit --stage-root is required.")?);
    if !root.is_absolute() {
        return Err("Stage root must be absolute.".into());
    }
    let architecture = option("--arch")?.unwrap_or_else(|| {
        if cfg!(target_arch = "aarch64") {
            "arm64"
        } else {
            "x64"
        }
        .into()
    });
    let asset = stockfish_install::asset_for_arch(&architecture)
        .ok_or("Unsupported Stockfish build architecture.")?;
    let cancel = Arc::new(AtomicBool::new(false));
    let installed = if let Some(archive) = option("--archive")? {
        stockfish_install::install_archive(Path::new(&archive), &root, &asset, &cancel, &|_| {})?
    } else {
        stockfish_install::install(root.clone(), asset, cancel, Arc::new(|_| {})).await?
    };
    let engine_root = Path::new(&installed.path)
        .parent()
        .ok_or("Missing engine parent.")?;
    let manifest_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let base: serde_json::Value = serde_json::from_slice(
        &std::fs::read(manifest_root.join("tauri.conf.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let mut resources = base["bundle"]["resources"]
        .as_object()
        .ok_or("Expected a resource map.")?
        .clone();
    resources.insert(
        format!("{}/", engine_root.to_string_lossy().replace('\\', "/")),
        "engines/stockfish-19/".into(),
    );
    let config = serde_json::json!({"bundle":{"resources":resources}});
    let config_path = root.join("tauri.stockfish.conf.json");
    std::fs::write(
        &config_path,
        serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    println!(
        "{}",
        serde_json::json!({"path":installed.path,"version":installed.version,"architecture":architecture,"config":config_path})
    );
    Ok(())
}
