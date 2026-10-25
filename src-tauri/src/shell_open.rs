use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Validate shell requests without reading or changing the file. Relative paths
/// belong to the launching process's working directory, not the running app's.
pub fn normalize_open_path(raw: &str, cwd: Option<&Path>) -> Option<String> {
    let raw = raw
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(raw);
    if raw.is_empty() {
        return None;
    }
    let path = PathBuf::from(raw);
    let path = if path.is_absolute() {
        path
    } else {
        cwd?.join(path)
    };
    if !path.extension()?.to_str()?.eq_ignore_ascii_case("pgn") || !path.is_file() {
        return None;
    }
    Some(path.to_string_lossy().into_owned())
}

pub fn open_paths_from_args(args: &[String], cwd: Option<&Path>) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter_map(|arg| normalize_open_path(arg, cwd))
        .collect()
}

/// Notifications are hints. Requests remain here until a subscribed renderer
/// takes them; the renderer then owns its serial, cancellable opening queue.
#[derive(Default)]
pub struct PendingShellOpenPaths(Mutex<Vec<String>>);

impl PendingShellOpenPaths {
    pub fn from_args(args: &[String], cwd: Option<&Path>) -> Self {
        let queue = Self::default();
        queue
            .enqueue(open_paths_from_args(args, cwd))
            .expect("fresh shell queue");
        queue
    }

    pub fn enqueue(&self, paths: Vec<String>) -> Result<(), String> {
        let mut pending = self.0.lock().map_err(|error| error.to_string())?;
        for path in paths {
            if !pending.contains(&path) {
                pending.push(path);
            }
        }
        Ok(())
    }

    pub fn take(&self) -> Result<Vec<String>, String> {
        Ok(std::mem::take(
            &mut *self.0.lock().map_err(|error| error.to_string())?,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_all_existing_pgn_arguments_relative_to_the_sender() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("first.pgn");
        let second = dir.path().join("second.PGN");
        std::fs::write(&first, "1. e4 *").unwrap();
        std::fs::write(&second, "1. d4 *").unwrap();
        let args = vec![
            "app.exe".into(),
            "first.pgn".into(),
            second.to_string_lossy().into_owned(),
        ];
        assert_eq!(
            open_paths_from_args(&args, Some(dir.path())),
            vec![first.to_string_lossy(), second.to_string_lossy()]
        );
        assert_eq!(
            open_paths_from_args(&args, None),
            vec![second.to_string_lossy()]
        );
    }

    #[test]
    fn quotes_and_real_filename_spaces_are_preserved() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(" spaced game.PgN");
        std::fs::write(&path, "*").unwrap();
        assert_eq!(
            normalize_open_path("\" spaced game.PgN\"", Some(dir.path())),
            Some(path.to_string_lossy().into_owned())
        );
    }

    #[test]
    fn missing_files_directories_other_formats_and_remote_urls_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("notes.txt"), "notes").unwrap();
        std::fs::create_dir(dir.path().join("folder.pgn")).unwrap();
        for value in [
            "",
            "missing.pgn",
            "notes.txt",
            "folder.pgn",
            "https://example.com/game.pgn",
        ] {
            assert_eq!(
                normalize_open_path(value, Some(dir.path())),
                None,
                "{value}"
            );
        }
    }

    #[test]
    fn requests_wait_without_a_renderer_and_duplicates_do_not_lose_order() {
        let queue = PendingShellOpenPaths::default();
        queue
            .enqueue(vec!["first.pgn".into(), "second.pgn".into()])
            .unwrap();
        queue
            .enqueue(vec!["first.pgn".into(), "third.pgn".into()])
            .unwrap();
        assert_eq!(
            queue.take().unwrap(),
            vec!["first.pgn", "second.pgn", "third.pgn"]
        );
        assert!(queue.take().unwrap().is_empty());
        // A later explicit request can reopen the same file.
        queue.enqueue(vec!["first.pgn".into()]).unwrap();
        assert_eq!(queue.take().unwrap(), vec!["first.pgn"]);
    }

    #[test]
    fn initial_arguments_use_the_same_retained_queue() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("game.pgn"), "*").unwrap();
        let args = vec!["app.exe".into(), "game.pgn".into(), "game.pgn".into()];
        let queue = PendingShellOpenPaths::from_args(&args, Some(dir.path()));
        assert_eq!(
            queue.take().unwrap(),
            vec![dir.path().join("game.pgn").to_string_lossy()]
        );
        assert!(queue.take().unwrap().is_empty());
    }
}
