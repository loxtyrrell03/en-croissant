//! Build-only staging. Generated assets/config stay below an explicit directory;
//! this tool never reads or changes engine profiles, sessions or hosting.
use en_croissant_fork::stockfish_install;
use std::{
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc},
};

// Tauri's Windows resource iterator strips drive prefixes before computing the
// destination of a directory mapping. Use a relative source so its child files
// cannot become absolute copy targets (or be copied onto themselves).
fn resource_directory(source: &Path, manifest: &Path) -> Result<String, String> {
    let source = source.canonicalize().map_err(|e| e.to_string())?;
    let manifest = manifest.canonicalize().map_err(|e| e.to_string())?;
    let source = source.components().collect::<Vec<_>>();
    let manifest = manifest.components().collect::<Vec<_>>();
    let common = source
        .iter()
        .zip(&manifest)
        .take_while(|(a, b)| a == b)
        .count();
    if common == 0 {
        return Err("Stage Stockfish on the same filesystem as the desktop project.".into());
    }
    let mut relative = PathBuf::new();
    for _ in common..manifest.len() {
        relative.push("..");
    }
    for component in &source[common..] {
        relative.push(component.as_os_str());
    }
    if relative.as_os_str().is_empty() {
        return Err("The engine stage must be a separate directory.".into());
    }
    Ok(format!(
        "{}/",
        relative.to_string_lossy().replace('\\', "/")
    ))
}

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
        resource_directory(engine_root, manifest_root)?,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tauri_maps_nested_resource_files_below_the_bundle_even_with_an_external_stage() {
        let temporary = tempfile::tempdir().unwrap();
        let manifest = temporary.path().join("project/src-tauri");
        let source = temporary.path().join("shared stage/stockfish/src");
        std::fs::create_dir_all(&manifest).unwrap();
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("engine.cpp"), "source fixture").unwrap();
        let engine_root = source.parent().unwrap();
        let relative = resource_directory(engine_root, &manifest).unwrap();
        assert!(!Path::new(&relative).is_absolute());
        // Rebase to the process cwd for the real parser without changing cwd
        // in a parallel test; its mapping must retain the source subtree.
        let cwd = std::env::current_dir().unwrap();
        let path = resource_directory(engine_root, &cwd).unwrap();
        let map = std::collections::HashMap::from([(path, "engines/stockfish-19/".into())]);
        let resources = tauri::utils::resources::ResourcePaths::from_map(&map, true)
            .iter()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(resources.len(), 1);
        assert_eq!(
            resources[0].target(),
            Path::new("engines/stockfish-19/src/engine.cpp")
        );
        assert!(!resources[0].target().is_absolute());
        assert_eq!(
            std::fs::read_to_string(resources[0].path()).unwrap(),
            "source fixture"
        );
    }
}
