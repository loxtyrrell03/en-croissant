use super::*;
static SERIAL: Mutex<()> = Mutex::new(());
const START: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

fn serial() -> std::sync::MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|error| error.into_inner())
}
fn fixture() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("en-eval-discovery-")
        .tempdir()
        .unwrap()
}
fn store(root: &Path, name: &str, score: i32) -> PathBuf {
    let source = root.join(format!("{name}.zst"));
    fs::write(&source, zstd::encode_all((serde_json::json!({"fen":START,"evals":[{"depth":30,"pvs":[{"cp":score,"line":"e2e4 e7e5"}]}]}).to_string()+"\n").as_bytes(),1).unwrap()).unwrap();
    let output = root.join(name);
    build_compact_eval_database(
        LocalEvalBuildOptions {
            id: format!("discovery-{name}"),
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
fn read(profile: &Path, shared: &Path) -> LocalEvalSourceSelection {
    source_selection::read(profile, Some(shared)).unwrap()
}
fn score(selected: &LocalEvalSourceSelection) -> i32 {
    assert!(
        selected.discovery_error.is_none(),
        "{:?}",
        selected.discovery_error
    );
    lookup_eval(Path::new(&selected.path), START, 1)
        .unwrap()
        .unwrap()
        .pvs[0]
        .cp
        .unwrap()
}

#[test]
fn discovery_reads_existing_shared_store_without_creating_profile() {
    let _serial = serial();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let profile = root.join("missing-profile");
    let shared = store(&root, "shared", 24);
    let original = fs::read(shared.join(MANIFEST_FILE)).unwrap();
    let selected = read(&profile, &shared);
    assert_eq!(selected.path, shared.display().to_string());
    assert_eq!(score(&selected), 24);
    assert!(selected.revision.starts_with("auto:"));
    assert!(
        super::super::source::status(&profile, Some(&shared))
            .unwrap()
            .available
    );
    assert!(!profile.exists());
    assert_eq!(fs::read(shared.join(MANIFEST_FILE)).unwrap(), original);
}

#[test]
fn discovery_does_not_create_missing_stores_or_treat_empty_roots_as_ready() {
    let _serial = serial();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let profile = root.join("profile");
    let shared = root.join("shared");
    for make_empty in [false, true] {
        if make_empty {
            fs::create_dir_all(profile.join("lichess-cloud-evals")).unwrap();
            fs::create_dir(&shared).unwrap();
        }
        let selected = read(&profile, &shared);
        assert_eq!(selected.revision, "default");
        assert_eq!(
            selected.path,
            profile.join("lichess-cloud-evals").display().to_string()
        );
        assert!(
            !super::super::source::status(&profile, Some(&shared))
                .unwrap()
                .available
        );
        assert!(!profile.join("evaluation-source.sqlite3").exists());
    }
}

#[test]
fn discovery_reuses_shared_data_when_the_legacy_folder_is_confirmed_empty() {
    let _serial = serial();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let profile = root.join("profile");
    fs::create_dir_all(profile.join("lichess-cloud-evals")).unwrap();
    let shared = store(&root, "shared", 24);
    assert_eq!(score(&read(&profile, &shared)), 24);
    assert_eq!(
        fs::read_dir(profile.join("lichess-cloud-evals"))
            .unwrap()
            .count(),
        0
    );
    assert!(!profile.join("evaluation-source.sqlite3").exists());
}

#[test]
fn discovery_preserves_existing_legacy_data_in_preference_to_another_shared_store() {
    let _serial = serial();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let profile = root.join("profile");
    fs::create_dir(&profile).unwrap();
    let legacy = store(&profile, "lichess-cloud-evals", 31);
    let shared = store(&root, "shared", 24);
    let selected = read(&profile, &shared);
    assert_eq!(selected.path, legacy.display().to_string());
    assert_eq!(score(&selected), 31);
    assert!(!profile.join("evaluation-source.sqlite3").exists());
}

#[test]
fn discovery_reports_incomplete_legacy_data_instead_of_silently_falling_through() {
    let _serial = serial();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let shared = store(&root, "shared", 24);
    for kind in ["file", "foreign", "manifest"] {
        let profile = root.join(kind);
        let legacy = profile.join("lichess-cloud-evals");
        fs::create_dir_all(&profile).unwrap();
        if kind == "file" {
            fs::write(&legacy, "retained fixture").unwrap();
        } else {
            fs::create_dir(&legacy).unwrap();
            fs::write(
                legacy.join(if kind == "manifest" {
                    MANIFEST_FILE
                } else {
                    "owner.txt"
                }),
                "retained fixture",
            )
            .unwrap();
        }
        let selected = read(&profile, &shared);
        assert_eq!(selected.path, legacy.display().to_string());
        assert!(selected.discovery_error.is_some());
        let status = super::super::source::status(&profile, Some(&shared)).unwrap();
        assert!(!status.available);
        assert!(status.error.is_some());
        assert!(!profile.join("evaluation-source.sqlite3").exists());
    }
}

#[test]
fn discovery_refuses_foreign_incomplete_and_bad_sample_shared_data() {
    let _serial = serial();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    for kind in ["foreign", "incomplete", "sample", "oversized"] {
        let shared = store(&root, kind, 24);
        let manifest = shared.join(MANIFEST_FILE);
        match kind {
            "foreign" => fs::write(&manifest, b"{}").unwrap(),
            "incomplete" => {
                let mut data: serde_json::Value =
                    serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
                data["complete"] = false.into();
                fs::write(&manifest, serde_json::to_vec(&data).unwrap()).unwrap();
            }
            "oversized" => fs::write(&manifest, vec![b' '; 1024 * 1024 + 1]).unwrap(),
            _ => {
                let shard = fs::read_dir(shared.join(SHARDS_DIR))
                    .unwrap()
                    .next()
                    .unwrap()
                    .unwrap()
                    .path();
                fs::write(shard, "invalid compressed fixture").unwrap();
            }
        }
        let profile = root.join(format!("profile-{kind}"));
        let selected = read(&profile, &shared);
        assert!(selected.discovery_error.is_some(), "{kind}");
        assert!(!profile.exists());
        assert!(super::super::source::status(&profile, Some(&shared))
            .unwrap()
            .error
            .is_some());
    }
}

#[test]
fn discovery_errors_allow_a_checked_manual_choice_to_replace_the_unusable_default() {
    let _serial = serial();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let shared = root.join("bad-shared");
    fs::create_dir(&shared).unwrap();
    fs::write(shared.join("owner.txt"), "kept").unwrap();
    let profile = root.join("profile");
    let invalid = read(&profile, &shared);
    assert!(invalid.discovery_error.is_some());
    let custom = store(&root, "custom", 43);
    let saved =
        source_selection::save(&profile, Some(&shared), &invalid.revision, &custom).unwrap();
    assert_eq!(read(&profile, &shared), saved);
    assert_eq!(score(&saved), 43);
    assert_eq!(
        fs::read_to_string(shared.join("owner.txt")).unwrap(),
        "kept"
    );
}

#[test]
fn discovery_never_overrides_saved_custom_or_explicit_default_reset_choices() {
    let _serial = serial();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let shared = store(&root, "shared", 24);
    for reset in [false, true] {
        let profile = root.join(if reset {
            "reset-profile"
        } else {
            "custom-profile"
        });
        let before = read(&profile, &shared);
        let destination = if reset {
            profile.join("lichess-cloud-evals")
        } else {
            store(&root, "custom", 43)
        };
        let pinned =
            source_selection::save(&profile, Some(&shared), &before.revision, &destination)
                .unwrap();
        let bytes = fs::read(profile.join("evaluation-source.sqlite3")).unwrap();
        assert_eq!(read(&profile, &shared), pinned);
        assert!(pinned.discovery_error.is_none());
        assert_eq!(
            fs::read(profile.join("evaluation-source.sqlite3")).unwrap(),
            bytes
        );
        if reset {
            assert!(!destination.exists());
        } else {
            assert_eq!(score(&pinned), 43);
        }
    }
}

#[test]
fn discovery_rechecks_manifest_content_even_if_size_and_modified_time_are_restored() {
    let _serial = serial();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let shared = store(&root, "shared", 24);
    let profile = root.join("profile");
    let first = read(&profile, &shared);
    let manifest = shared.join(MANIFEST_FILE);
    let before = fs::metadata(&manifest).unwrap();
    let mut data = fs::read(&manifest).unwrap();
    let needle = b"\"positions\": 1";
    let at = data
        .windows(needle.len())
        .position(|p| p == needle)
        .unwrap();
    data[at + needle.len() - 1] = b'2';
    fs::write(&manifest, data).unwrap();
    File::options()
        .write(true)
        .open(&manifest)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(before.modified().unwrap()))
        .unwrap();
    assert_eq!(fs::metadata(&manifest).unwrap().len(), before.len());
    let second = read(&profile, &shared);
    assert_ne!(first.revision, second.revision);
    let target = store(&root, "custom", 43);
    assert!(source_selection::save(&profile, Some(&shared), &first.revision, &target).is_err());
    assert_eq!(read(&profile, &shared), second);
}

#[test]
fn discovery_periodically_revalidates_the_bounded_sample_and_rejects_a_bad_replacement() {
    let _serial = serial();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let shared = store(&root, "shared", 24);
    let profile = root.join("profile");
    let first = read(&profile, &shared);
    assert!(first.discovery_error.is_none());
    let shard = fs::read_dir(shared.join(SHARDS_DIR))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let original = fs::read(&shard).unwrap();
    fs::write(&shard, "bad compressed fixture").unwrap();
    CHECKED.lock().unwrap().as_mut().unwrap().at = Instant::now() - Duration::from_secs(31);
    let after = read(&profile, &shared);
    assert!(after.discovery_error.is_some());
    assert_ne!(after.revision, first.revision);
    fs::write(&shard, original).unwrap();
    assert!(
        read(&profile, &shared).discovery_error.is_none(),
        "A failed sample check must be immediately retryable after repair"
    );
}

#[test]
fn discovery_preserves_unreadable_preferences_instead_of_replacing_them_with_a_default() {
    let _serial = serial();
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let shared = store(&root, "shared", 24);
    let profile = root.join("profile");
    fs::create_dir(&profile).unwrap();
    let settings = profile.join("evaluation-source.sqlite3");
    fs::write(&settings, "owner corrupt settings").unwrap();
    assert!(source_selection::read(&profile, Some(&shared)).is_err());
    assert_eq!(
        fs::read_to_string(settings).unwrap(),
        "owner corrupt settings"
    );
}

#[test]
fn discovery_rejects_invalid_path_checks_instead_of_claiming_that_no_data_exists() {
    let _serial = serial();
    let temp = fixture();
    let profile = temp.path().join("profile");
    let selected = read(&profile, Path::new("invalid\0shared"));
    assert!(selected.discovery_error.is_some());
    assert!(!profile.exists());
}

#[test]
fn discovery_platform_roots_and_optional_error_wire_contract_are_stable() {
    let base = Path::new("base");
    for platform in ["windows", "macos"] {
        assert_eq!(
            shared_at(base, platform).unwrap(),
            base.join("ChessData/lichess/evaluations")
        );
    }
    assert_eq!(
        shared_at(base, "linux").unwrap(),
        base.join("chess-data/lichess/evaluations")
    );
    assert!(shared_at(base, "other").is_none());
    let default = source_selection::default_selection(base);
    assert!(serde_json::to_value(default)
        .unwrap()
        .get("discoveryError")
        .is_none());
    let invalid = error(base, "Unavailable fixture".into());
    assert_eq!(
        serde_json::to_value(invalid).unwrap()["discoveryError"],
        "Unavailable fixture"
    );
}

#[test]
#[ignore = "explicit retained-store read-only default discovery acceptance"]
fn retained_shared_default_readonly() {
    let shared = PathBuf::from(
        std::env::var_os("EN_EVAL_SOURCE_READONLY_PATH").expect("explicit read-only source"),
    );
    let receipt = PathBuf::from(
        std::env::var_os("EN_EVAL_SOURCE_READONLY_RECEIPT").expect("explicit external receipt"),
    );
    let shared = shared.canonicalize().unwrap();
    assert!(!receipt
        .parent()
        .unwrap()
        .canonicalize()
        .unwrap()
        .starts_with(&shared));
    let before = fs::read(shared.join(MANIFEST_FILE)).unwrap();
    let temp = fixture();
    let profile = temp.path().join("never-created-profile");
    let started = Instant::now();
    let selected = read(&profile, &shared);
    let recognition_ms = started.elapsed().as_millis();
    assert!(selected.discovery_error.is_none());
    let started = Instant::now();
    for _ in 0..100 {
        assert_eq!(read(&profile, &shared), selected);
    }
    let cached_reads_ms = started.elapsed().as_millis();
    let status = super::super::source::status(&profile, Some(&shared)).unwrap();
    let hit = lookup_eval(Path::new(&selected.path), START, 1)
        .unwrap()
        .unwrap();
    assert!(!profile.exists());
    assert_eq!(fs::read(shared.join(MANIFEST_FILE)).unwrap(), before);
    fs::write(receipt, serde_json::to_vec_pretty(&serde_json::json!({"selection":selected,"status":status,"recognitionMs":recognition_ms,"cachedReads":100,"cachedReadsMs":cached_reads_ms,"startingPositionDepth":hit.depth,"startingPositionPvs":hit.pvs,"readOnly":true,"preferenceWritten":false,"corpusCopied":false})).unwrap()).unwrap();
}
