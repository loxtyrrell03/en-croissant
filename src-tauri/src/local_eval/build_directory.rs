//! An optional build owns one newly created output, never an installed corpus.
use super::LocalEvalError;
use std::{
    fs,
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
};

const MARKER: &str = ".encroissant-eval-build";

pub(super) struct BuildDirectory {
    pub path: PathBuf,
    identity: [u8; 16],
    published: bool,
}

impl BuildDirectory {
    pub fn create(output: &Path) -> Result<Self, LocalEvalError> {
        let name = output.file_name().ok_or_else(|| {
            LocalEvalError::InvalidOption("Choose a new evaluation output directory.".into())
        })?;
        let parent = output
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent)?;
        let parent = parent.canonicalize()?;
        let path = parent.join(name);
        // Atomic acquisition also refuses empty directories and dangling links.
        fs::create_dir(&path).map_err(|error| {
            if error.kind()==std::io::ErrorKind::AlreadyExists {
                LocalEvalError::InvalidOption(format!(
                    "Evaluation output {} already exists. Choose a new directory; existing data will not be replaced.",path.display()))
            } else { error.into() }
        })?;
        let identity = rand::random::<[u8; 16]>();
        let marker_result = (|| {
            let mut marker = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path.join(MARKER))?;
            marker.write_all(&identity)?;
            marker.sync_all()
        })();
        if let Err(error) = marker_result {
            // No recursive cleanup until an ownership marker has been written.
            let _ = fs::remove_dir(&path);
            return Err(error.into());
        }
        Ok(Self {
            path,
            identity,
            published: false,
        })
    }

    pub fn ensure_owned(&self) -> Result<(), LocalEvalError> {
        if self.is_owned() {
            Ok(())
        } else {
            Err(LocalEvalError::InvalidOption(
                "The evaluation build directory changed ownership. Its contents were kept.".into(),
            ))
        }
    }

    pub fn finish(&mut self) {
        // The completed manifest is already published. A failed marker cleanup
        // must never remove a valid store or make the caller retry its build.
        self.published = true;
        if !self.is_owned() {
            log::warn!("Completed evaluation build ownership changed; marker kept.");
            return;
        }
        if let Err(error) = fs::remove_file(self.path.join(MARKER)) {
            log::warn!("Could not remove completed evaluation build marker: {error}");
        }
    }

    fn is_owned(&self) -> bool {
        fs::symlink_metadata(&self.path).is_ok_and(|metadata| {
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return false;
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                // Junctions and other reparse points must not redirect cleanup.
                if metadata.file_attributes() & 0x400 != 0 {
                    return false;
                }
            }
            true
        }) && self.path.canonicalize().is_ok_and(|path| path == self.path)
            && fs::read(self.path.join(MARKER)).is_ok_and(|bytes| bytes == self.identity)
    }
}

impl Drop for BuildDirectory {
    fn drop(&mut self) {
        if !self.published && self.is_owned() {
            if let Err(error) = fs::remove_dir_all(&self.path) {
                log::warn!("Could not remove owned incomplete evaluation build: {error}");
            }
        }
    }
}
