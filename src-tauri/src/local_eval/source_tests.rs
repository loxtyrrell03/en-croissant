use super::*;
use rusqlite::Connection;
static SERIAL: Mutex<()> = Mutex::new(());
const START: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

fn fixture() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("en-eval-source-")
        .tempdir()
        .unwrap()
}
fn store(root: &Path, name: &str, score: i32) -> PathBuf {
    let source = root.join(format!("{name}.zst"));
    fs::write(&source,zstd::encode_all((serde_json::json!({"fen":START,"evals":[{"depth":30,"pvs":[{"cp":score,"line":"e2e4 e7e5"}]}]}).to_string()+"\n").as_bytes(),1).unwrap()).unwrap();
    let output = root.join(name);
    build_compact_eval_database(
        LocalEvalBuildOptions {
            id: format!("source-{name}"),
            source: LocalEvalSource::File(source),
            output_dir: output.clone(),
            max_pvs: 5,
            shard_count: 16,
        },
        |_| {},
    )
    .unwrap();
    output
}

#[test]
fn defaults_are_read_only_and_do_not_create_profile_or_settings() {
    let temp = fixture();
    let profile = temp.path().join("missing-profile");
    let selected = source_selection::read(&profile, None).unwrap();
    assert_eq!(selected.revision, "default");
    assert!(selected.path.ends_with("lichess-cloud-evals"));
    assert!(!profile.exists());
}

#[test]
fn discovered_defaults_use_the_existing_checked_choice_and_explicit_reset_contract() {
    let _serial = SERIAL.lock().unwrap();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let profile = root.join("profile");
    let shared = store(&root, "shared", 24);
    let auto = source_selection::read(&profile, Some(&shared)).unwrap();
    assert_eq!(auto.path, shared.display().to_string());
    let checked = validate(&profile, Some(&shared), Path::new(""), &auto.revision).unwrap();
    assert!(checked.store.available);
    assert_eq!(checked.store.path, shared.display().to_string());
    assert!(activate(&profile, Some(&root.join("other-root")), &checked.token).is_err());
    let reset = activate(&profile, Some(&shared), &checked.token).unwrap();
    assert_eq!(reset.path, shared.display().to_string());
    assert_eq!(
        source_selection::read(&profile, Some(&shared)).unwrap(),
        reset
    );
    assert!(!profile.join("lichess-cloud-evals").exists());

    let second_profile = root.join("second-profile");
    let incomplete = root.join("incomplete");
    fs::create_dir(&incomplete).unwrap();
    fs::write(incomplete.join("owner.txt"), "retained").unwrap();
    let failed = source_selection::read(&second_profile, Some(&incomplete)).unwrap();
    assert!(failed.discovery_error.is_some());
    let custom = store(&root, "custom", 31);
    let checked = validate(
        &second_profile,
        Some(&incomplete),
        &custom,
        &failed.revision,
    )
    .unwrap();
    let selected = activate(&second_profile, Some(&incomplete), &checked.token).unwrap();
    assert_eq!(
        source_selection::read(&second_profile, Some(&incomplete)).unwrap(),
        selected
    );
    assert!(selected.discovery_error.is_none());
    assert_eq!(
        fs::read_to_string(incomplete.join("owner.txt")).unwrap(),
        "retained"
    );
}

#[test]
fn a_new_default_path_cannot_replace_a_reviewed_reset_even_with_identical_data() {
    let _serial = SERIAL.lock().unwrap();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let profile = root.join("profile");
    let shared = store(&root, "shared", 24);
    let custom = store(&root, "custom", 31);
    let automatic = source_selection::read(&profile, Some(&shared)).unwrap();
    let checked = validate(&profile, Some(&shared), &custom, &automatic.revision).unwrap();
    let selected = activate(&profile, Some(&shared), &checked.token).unwrap();
    let reset = validate(&profile, Some(&shared), Path::new(""), &selected.revision).unwrap();
    assert_eq!(reset.store.path, shared.display().to_string());

    // Copy this one-position synthetic store, retaining shard metadata. The
    // reset must own the path, not just equal sample bytes and timestamps.
    let legacy = profile.join("lichess-cloud-evals");
    fs::create_dir_all(legacy.join(SHARDS_DIR)).unwrap();
    fs::copy(shared.join(MANIFEST_FILE), legacy.join(MANIFEST_FILE)).unwrap();
    for entry in fs::read_dir(shared.join(SHARDS_DIR)).unwrap() {
        let entry = entry.unwrap();
        let destination = legacy.join(SHARDS_DIR).join(entry.file_name());
        fs::copy(entry.path(), &destination).unwrap();
        File::options()
            .write(true)
            .open(destination)
            .unwrap()
            .set_times(
                fs::FileTimes::new().set_modified(entry.metadata().unwrap().modified().unwrap()),
            )
            .unwrap();
    }
    assert_eq!(inspect(&shared).unwrap().1, inspect(&legacy).unwrap().1);
    assert!(activate(&profile, Some(&shared), &reset.token)
        .unwrap_err()
        .contains("changed"));
    assert_eq!(
        source_selection::read(&profile, Some(&shared)).unwrap(),
        selected
    );
    let fresh = validate(&profile, Some(&shared), Path::new(""), &selected.revision).unwrap();
    assert_eq!(fresh.store.path, legacy.display().to_string());
    assert_eq!(
        activate(&profile, Some(&shared), &fresh.token)
            .unwrap()
            .path,
        legacy.display().to_string()
    );
}

#[test]
fn validates_then_commits_a_separate_preference_without_changing_corpus() {
    let _serial = SERIAL.lock().unwrap();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let profile = root.join("profile");
    let path = store(&root, "store", 24);
    let manifest = fs::read(path.join(MANIFEST_FILE)).unwrap();
    let candidate = validate(&profile, None, &path, "default").unwrap();
    assert!(!profile.exists());
    assert_eq!(candidate.store.positions, 1);
    let selected = activate(&profile, None, &candidate.token).unwrap();
    assert_eq!(selected.path, path.display().to_string());
    assert_ne!(selected.revision, "default");
    assert_eq!(source_selection::read(&profile, None).unwrap(), selected);
    assert_eq!(fs::read(path.join(MANIFEST_FILE)).unwrap(), manifest);
    assert_eq!(
        lookup_eval(Path::new(&selected.path), START, 1)
            .unwrap()
            .unwrap()
            .pvs[0]
            .cp,
        Some(24)
    );
    assert!(activate(&profile, None, &candidate.token).is_err());
}

#[test]
fn explicit_reset_checks_then_selects_only_a_confirmed_absent_or_empty_default() {
    let _serial = SERIAL.lock().unwrap();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let profile = root.join("profile");
    let custom = store(&root, "custom", 24);
    let checked = validate(&profile, None, &custom, "default").unwrap();
    let mut selected = activate(&profile, None, &checked.token).unwrap();
    let default = profile.join("lichess-cloud-evals");
    for empty_directory in [false, true] {
        if empty_directory {
            fs::create_dir(&default).unwrap();
        }
        let before = fs::read(profile.join("evaluation-source.sqlite3")).unwrap();
        let reset = validate(&profile, None, Path::new(""), &selected.revision).unwrap();
        assert!(!reset.store.available);
        assert!(reset.store.error.is_none());
        assert_eq!(reset.store.path, default.display().to_string());
        assert_eq!(
            fs::read(profile.join("evaluation-source.sqlite3")).unwrap(),
            before
        );
        assert_eq!(default.exists(), empty_directory);
        selected = activate(&profile, None, &reset.token).unwrap();
        assert_eq!(source_selection::read(&profile, None).unwrap(), selected);
        assert!(!status(&profile, None).unwrap().available);
        assert_eq!(default.exists(), empty_directory);
        assert_eq!(
            lookup_eval(&custom, START, 1).unwrap().unwrap().pvs[0].cp,
            Some(24)
        );
    }
}

#[test]
fn explicit_reset_validates_an_existing_default_and_preserves_invalid_data() {
    let _serial = SERIAL.lock().unwrap();
    let temp = fixture();
    let profile = temp.path().canonicalize().unwrap();
    let default = store(&profile, "lichess-cloud-evals", 31);
    let candidate = validate(&profile, None, Path::new(""), "default").unwrap();
    assert!(candidate.store.available);
    assert_eq!(candidate.store.path, default.display().to_string());
    assert!(!profile.join("evaluation-source.sqlite3").exists());
    let selected = activate(&profile, None, &candidate.token).unwrap();
    for contents in [b"{corrupt".as_slice(), br#"{"complete":false}"#.as_slice()] {
        fs::write(default.join(MANIFEST_FILE), contents).unwrap();
        assert!(validate(&profile, None, Path::new(""), &selected.revision).is_err());
        assert_eq!(fs::read(default.join(MANIFEST_FILE)).unwrap(), contents);
        assert_eq!(source_selection::read(&profile, None).unwrap(), selected);
    }
    fs::remove_file(default.join(MANIFEST_FILE)).unwrap();
    assert!(validate(&profile, None, Path::new(""), &selected.revision).is_err());
    assert!(default.join(SHARDS_DIR).exists());
    assert_eq!(source_selection::read(&profile, None).unwrap(), selected);
}

#[test]
fn reset_rechecks_a_default_that_changes_after_review_and_rejects_stale_windows() {
    let _serial = SERIAL.lock().unwrap();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let profile = root.join("profile");
    let custom = store(&root, "custom", 24);
    let checked = validate(&profile, None, &custom, "default").unwrap();
    let selected = activate(&profile, None, &checked.token).unwrap();
    let reset = validate(&profile, None, Path::new(""), &selected.revision).unwrap();
    let default = profile.join("lichess-cloud-evals");
    fs::create_dir(&default).unwrap();
    assert!(activate(&profile, None, &reset.token).is_err());
    assert_eq!(source_selection::read(&profile, None).unwrap(), selected);
    let reset = validate(&profile, None, Path::new(""), &selected.revision).unwrap();
    let other = source_selection::save(&profile, None, &selected.revision, &custom).unwrap();
    assert!(activate(&profile, None, &reset.token).is_err());
    assert_eq!(source_selection::read(&profile, None).unwrap(), other);
    assert!(validate(&profile, None, Path::new(""), &selected.revision).is_err());
}

#[test]
fn missing_invalid_empty_foreign_and_incomplete_choices_never_write_preferences() {
    let _serial = SERIAL.lock().unwrap();
    for mode in [
        "missing",
        "corrupt",
        "empty",
        "foreign",
        "incomplete",
        "shards",
        "sample",
    ] {
        let temp = fixture();
        let root = temp.path().canonicalize().unwrap();
        let profile = root.join("profile");
        let path = store(&root, "store", 24);
        if mode == "missing" {
            assert!(validate(&profile, None, &root.join("absent"), "default").is_err());
            continue;
        }
        if mode == "corrupt" {
            fs::write(path.join(MANIFEST_FILE), b"{ corrupt").unwrap();
        } else if mode == "sample" {
            let file = fs::read_dir(path.join(SHARDS_DIR))
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .path();
            fs::write(file, b"bad zstd").unwrap();
        } else if mode == "shards" {
            fs::rename(path.join(SHARDS_DIR), path.join("retained-shards")).unwrap();
        } else {
            let mut manifest: serde_json::Value =
                serde_json::from_slice(&fs::read(path.join(MANIFEST_FILE)).unwrap()).unwrap();
            if mode == "empty" {
                manifest["positions"] = 0.into();
            }
            if mode == "foreign" {
                manifest["format"] = "another-product".into();
            }
            if mode == "incomplete" {
                manifest["complete"] = false.into();
            }
            fs::write(
                path.join(MANIFEST_FILE),
                serde_json::to_vec(&manifest).unwrap(),
            )
            .unwrap();
        }
        assert!(
            validate(&profile, None, &path, "default").is_err(),
            "{mode}"
        );
        assert!(!profile.exists());
        assert_eq!(
            source_selection::read(&profile, None).unwrap().revision,
            "default"
        );
    }
}

#[test]
fn legacy_optional_metadata_and_root_only_shards_are_recognized_without_conversion() {
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let path = store(&root, "store", 18);
    let mut manifest = read_manifest(&path).unwrap().unwrap();
    manifest.version = 1;
    manifest.record_size = ROOT_ONLY_RECORD_SIZE;
    let parsed = parse_compact_record(
        &(serde_json::json!({"fen":START,"evals":[{"depth":20,"pvs":[{"cp":18,"line":"e2e4"}]}]})
            .to_string()),
        5,
    )
    .unwrap()
    .unwrap();
    let mut raw = vec![0; ROOT_ONLY_RECORD_SIZE];
    raw[0..8].copy_from_slice(&parsed.hash_hi.to_le_bytes());
    raw[8..16].copy_from_slice(&parsed.hash_lo.to_le_bytes());
    raw[16..18].copy_from_slice(&20u16.to_le_bytes());
    raw[18] = 1;
    raw[24..26].copy_from_slice(&parsed.pvs[0].moves[0].to_le_bytes());
    raw[26..28].copy_from_slice(&18i16.to_le_bytes());
    let shard = shard_for_hash(parsed.hash_hi, parsed.hash_lo, 16);
    fs::write(
        shard_path(&path.join(SHARDS_DIR), shard),
        zstd::encode_all(raw.as_slice(), 1).unwrap(),
    )
    .unwrap();
    let mut value = serde_json::to_value(manifest).unwrap();
    for key in ["source", "skipped", "builtAt"] {
        value.as_object_mut().unwrap().remove(key);
    }
    fs::write(
        path.join(MANIFEST_FILE),
        serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
    let (status, _) = inspect(&path).unwrap();
    assert_eq!(status.positions, 1);
    assert_eq!(status.source, None);
    assert_eq!(status.built_at, None);
    clear_shard_cache();
    assert_eq!(
        lookup_eval(&path, START, 1).unwrap().unwrap().pvs[0].cp,
        Some(18)
    );
}

#[test]
fn recognizes_known_parent_layouts_but_refuses_ambiguous_folders() {
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let one = store(&root, "evaluations", 24);
    assert_eq!(recognize(&root).unwrap(), one);
    store(&root, "lichess-cloud-evals", 18);
    assert!(recognize(&root).unwrap_err().contains("more than one"));
}

#[test]
fn changed_candidate_and_newer_choice_cannot_change_current_preference() {
    let _serial = SERIAL.lock().unwrap();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let profile = root.join("profile");
    let a = store(&root, "a", 24);
    let b = store(&root, "b", 18);
    let first = validate(&profile, None, &a, "default").unwrap();
    let second = validate(&profile, None, &b, "default").unwrap();
    assert!(activate(&profile, None, &first.token).is_err());
    assert!(!profile.exists());
    let manifest = fs::read(b.join(MANIFEST_FILE)).unwrap();
    let mut changed = manifest.clone();
    changed.push(b' ');
    fs::write(b.join(MANIFEST_FILE), changed).unwrap();
    assert!(activate(&profile, None, &second.token).is_err());
    assert!(!profile.exists());
}

#[test]
fn stale_other_window_selection_and_save_failures_preserve_the_saved_source() {
    let _serial = SERIAL.lock().unwrap();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let profile = root.join("profile");
    let a = store(&root, "a", 24);
    let b = store(&root, "b", 18);
    let first = validate(&profile, None, &a, "default").unwrap();
    let selected = activate(&profile, None, &first.token).unwrap();
    let candidate = validate(&profile, None, &b, &selected.revision).unwrap();
    let other = source_selection::save(&profile, None, &selected.revision, &a).unwrap();
    assert!(activate(&profile, None, &candidate.token).is_err());
    assert_eq!(source_selection::read(&profile, None).unwrap(), other);
    let candidate = validate(&profile, None, &b, &other.revision).unwrap();
    let db = Connection::open(profile.join("evaluation-source.sqlite3")).unwrap();
    db.execute_batch("BEGIN IMMEDIATE").unwrap();
    assert!(activate(&profile, None, &candidate.token).is_err());
    assert_eq!(source_selection::read(&profile, None).unwrap(), other);
    db.execute_batch("ROLLBACK").unwrap();
    drop(db);
    assert_eq!(
        activate(&profile, None, &candidate.token).unwrap().path,
        b.display().to_string()
    );
}

#[test]
fn unknown_or_corrupt_selection_settings_are_preserved_and_never_fall_back() {
    for mode in ["corrupt", "newer", "unknown"] {
        let temp = fixture();
        let root = temp.path();
        let path = root.join("evaluation-source.sqlite3");
        if mode == "corrupt" {
            fs::write(&path, b"not a database").unwrap();
        } else {
            let db = Connection::open(&path).unwrap();
            db.execute_batch(
                "CREATE TABLE owner_data(value TEXT); INSERT INTO owner_data VALUES('keep');",
            )
            .unwrap();
            if mode == "newer" {
                db.execute_batch("PRAGMA user_version=99").unwrap();
            }
        }
        let before = fs::read(&path).unwrap();
        assert!(source_selection::read(root, None).is_err());
        assert!(source_selection::save(root, None, "default", root).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
    }
}

#[test]
fn oversized_manifest_and_unsupported_shard_inventory_are_refused() {
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let path = store(&root, "store", 24);
    fs::write(path.join("shards/9999.bin.zst"), b"keep").unwrap();
    assert!(inspect(&path).is_err());
    fs::remove_file(path.join("shards/9999.bin.zst")).unwrap();
    fs::write(path.join(MANIFEST_FILE), vec![b' '; 1024 * 1024 + 1]).unwrap();
    assert!(inspect(&path).is_err());
    assert!(read_manifest(&path).is_err());
}

#[test]
fn shard_reads_are_bounded_without_allocating_an_oversized_fixture() {
    let temp = fixture();
    let path = temp.path().join("compressed.zst");
    fs::write(
        &path,
        zstd::encode_all(vec![0u8; 65].as_slice(), 1).unwrap(),
    )
    .unwrap();
    assert!(read_shard_bytes(&path, 64)
        .unwrap_err()
        .to_string()
        .contains("read bound"));
    assert_eq!(read_shard_bytes(&path, 65).unwrap().len(), 65);
}

#[test]
fn changed_sample_is_rejected_even_when_size_and_timestamp_are_restored() {
    let _serial = SERIAL.lock().unwrap();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let profile = root.join("profile");
    let a = store(&root, "a", 24);
    let b = store(&root, "b", 18);
    let candidate = validate(&profile, None, &a, "default").unwrap();
    let first = fs::read_dir(a.join(SHARDS_DIR))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let second = b.join(SHARDS_DIR).join(first.file_name().unwrap());
    let metadata = fs::metadata(&first).unwrap();
    let replacement = fs::read(second).unwrap();
    assert_eq!(
        replacement.len() as u64,
        metadata.len(),
        "equal-size fixture"
    );
    let old_metadata = inventory(&a).unwrap().1;
    fs::write(&first, replacement).unwrap();
    File::options()
        .write(true)
        .open(&first)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(metadata.modified().unwrap()))
        .unwrap();
    assert_eq!(inventory(&a).unwrap().1, old_metadata);
    assert!(activate(&profile, None, &candidate.token)
        .unwrap_err()
        .contains("changed"));
    assert!(!profile.exists());
    let refreshed = validate(&profile, None, &a, "default").unwrap();
    activate(&profile, None, &refreshed.token).unwrap();
    assert_eq!(
        lookup_eval(&a, START, 1).unwrap().unwrap().pvs[0].cp,
        Some(18)
    );
}

#[test]
#[ignore = "explicit read-only retained-store acceptance; no preference/corpus writes"]
fn retained_store_readonly_compatibility() {
    let Some(path) = std::env::var_os("EN_EVAL_SOURCE_READONLY_PATH") else {
        return;
    };
    let receipt = PathBuf::from(
        std::env::var_os("EN_EVAL_SOURCE_READONLY_RECEIPT").expect("explicit receipt"),
    );
    let (status, _) = inspect(Path::new(&path)).unwrap();
    let hit = lookup_eval(Path::new(&status.path), START, 1)
        .unwrap()
        .expect("retained starting-position score");
    let result = serde_json::json!({"status":status,"startingPositionDepth":hit.depth,"startingPositionPvs":hit.pvs,"readonly":true,"preferenceWritten":false,"corpusCopied":false,"sampleLimitBytes":build_control::MAX_SHARD_BYTES});
    fs::write(receipt, serde_json::to_vec_pretty(&result).unwrap()).unwrap();
}

#[cfg(windows)]
#[test]
fn root_aliases_are_read_only_choices_and_nested_data_links_are_refused() {
    use std::os::windows::process::CommandExt;
    let _serial = SERIAL.lock().unwrap();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let target = store(&root, "retained", 24);
    let alias = root.join("alias");
    let profile = root.join("profile");
    let make_link = |link: &Path, target: &Path| {
        let script = root.join("test-junction.ps1");
        fs::write(&script,"param([string]$Link,[string]$Target)\n$ErrorActionPreference='Stop'\nNew-Item -ItemType Junction -Path $Link -Target $Target | Out-Null\n").unwrap();
        let ordinary = |path: &Path| {
            path.to_str()
                .unwrap()
                .strip_prefix(r"\\?\")
                .unwrap_or(path.to_str().unwrap())
                .to_owned()
        };
        let result = std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(&script)
            .arg("-Link")
            .arg(ordinary(link))
            .arg("-Target")
            .arg(ordinary(target))
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    };
    make_link(&alias, &target);
    let manifest = fs::read(target.join(MANIFEST_FILE)).unwrap();
    let checked = validate(&profile, None, &alias, "default").unwrap();
    assert_eq!(checked.store.path, target.display().to_string());
    let selected = activate(&profile, None, &checked.token).unwrap();
    assert_eq!(fs::read(target.join(MANIFEST_FILE)).unwrap(), manifest);
    fs::rename(target.join(SHARDS_DIR), root.join("retained-shards")).unwrap();
    make_link(&target.join(SHARDS_DIR), &root.join("retained-shards"));
    assert!(validate(&profile, None, &target, &selected.revision).is_err());
    assert_eq!(source_selection::read(&profile, None).unwrap(), selected);
}
