use super::Record;
use std::{fs, io, io::Write, path::Path};

pub(super) fn plain(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    !metadata.file_type().is_symlink()
}

fn owned(path: &Path, identity: &[u8; 16]) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if !plain(&meta)
        || !meta.is_dir()
        || path.canonicalize().map_err(|error| error.to_string())? != path
    {
        return Err("The recorded output moved or contains a link. Files were kept.".into());
    }
    match fs::symlink_metadata(path.join("manifest.json")) {
        Ok(_) => {
            return Err("The output contains a published manifest. Its files were kept.".into())
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Could not check the published manifest: {error}. Files were kept."
            ))
        }
    }
    let marker = path.join(".encroissant-eval-build");
    let metadata = fs::symlink_metadata(&marker).map_err(|error| {
        format!("The ownership marker is unavailable: {error}. Files were kept.")
    })?;
    if !plain(&metadata)
        || !metadata.is_file()
        || metadata.len() != 16
        || fs::read(marker).map_err(|error| error.to_string())? != identity
    {
        return Err("The output ownership marker changed. Files were kept.".into());
    }
    Ok(())
}

pub(super) fn discard(record: &Record) -> Result<(), String> {
    let path = &record.path;
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
        _ => {}
    }
    owned(path, &record.identity)?;
    let mut files = Vec::new();
    let mut directories = Vec::new();
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let item = entry.path();
        let metadata = fs::symlink_metadata(&item).map_err(|error| error.to_string())?;
        if !plain(&metadata) {
            return Err("The output contains linked entries. Files were kept.".into());
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if metadata.is_file()
            && matches!(
                name.as_ref(),
                ".encroissant-eval-build" | "manifest.pending"
            )
        {
            if name != ".encroissant-eval-build" {
                files.push(item);
            }
        } else if metadata.is_dir() && matches!(name.as_ref(), "spool" | "shards") {
            for child in fs::read_dir(&item).map_err(|error| error.to_string())? {
                let child = child.map_err(|error| error.to_string())?;
                let meta = fs::symlink_metadata(child.path()).map_err(|error| error.to_string())?;
                let name = child.file_name();
                let name = name.to_string_lossy();
                let valid = name.strip_suffix(".bin.zst").is_some_and(|digits| {
                    digits.len() == 4
                        && digits.bytes().all(|value| value.is_ascii_digit())
                        && digits
                            .parse::<u16>()
                            .is_ok_and(|number| number < record.shard_count)
                });
                if !plain(&meta) || !meta.is_file() || !valid {
                    return Err("The output contains unrecognized files. Files were kept.".into());
                }
                files.push(child.path());
            }
            directories.push(item);
        } else {
            return Err("The output contains unrecognized files. Files were kept.".into());
        }
    }
    // Complete inventory first. Recheck root identity before each exact removal.
    for file in files {
        owned(path, &record.identity)?;
        let parent = file
            .parent()
            .ok_or("The output entry has no parent. Files were kept.")?;
        let parent_meta = fs::symlink_metadata(parent).map_err(|error| error.to_string())?;
        if !plain(&parent_meta)
            || !parent_meta.is_dir()
            || parent.canonicalize().map_err(|error| error.to_string())? != parent
        {
            return Err(
                "An output directory changed during cleanup. Remaining files were kept.".into(),
            );
        }
        let meta = fs::symlink_metadata(&file).map_err(|error| error.to_string())?;
        if !plain(&meta) || !meta.is_file() {
            return Err("An entry changed during cleanup. Remaining files were kept.".into());
        }
        fs::remove_file(file)
            .map_err(|error| format!("Cleanup failed: {error}. Remaining files were kept."))?;
    }
    for directory in directories {
        owned(path, &record.identity)?;
        fs::remove_dir(directory)
            .map_err(|error| format!("Cleanup failed: {error}. Remaining files were kept."))?;
    }
    owned(path, &record.identity)?;
    fs::remove_file(path.join(".encroissant-eval-build")).map_err(|error| error.to_string())?;
    if let Err(error) = fs::remove_dir(path) {
        // An open Windows directory handle can prevent only this final removal.
        // Restore our marker with create_new, never overwrite a concurrent file.
        let restored = (|| -> io::Result<()> {
            let meta = fs::symlink_metadata(path)?;
            if !plain(&meta) || !meta.is_dir() || path.canonicalize()? != *path {
                return Err(io::Error::other("output directory changed"));
            }
            let mut marker = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path.join(".encroissant-eval-build"))?;
            marker.write_all(&record.identity)?;
            marker.sync_all()
        })();
        return Err(match restored {
            Ok(()) => format!("The final empty folder could not be removed: {error}. Its ownership marker was restored; retry after releasing the folder."),
            Err(restore) => format!("The final empty folder could not be removed: {error}. Its ownership marker could not be restored: {restore}. Remaining files and the recovery record were kept; inspect the folder before retrying."),
        });
    }
    Ok(())
}
