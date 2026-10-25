use super::*;
use std::{
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const START: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

fn fixture() -> tempfile::TempDir {
    let directory = tempfile::Builder::new()
        .prefix("en-eval-recovery-")
        .tempdir()
        .unwrap();
    let path = directory.path().canonicalize().unwrap();
    assert_eq!(
        path.parent().unwrap(),
        std::env::temp_dir().canonicalize().unwrap()
    );
    assert!(path
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("en-eval-recovery-"));
    directory
}

fn options(root: &Path) -> LocalEvalBuildOptions {
    let source = root.join("source.zst");
    let value=serde_json::json!({"fen":START,"evals":[{"depth":20,"knodes":2,"pvs":[{"cp":0,"line":"e2e4 e7e5"}]}]}).to_string()+"\n";
    fs::write(&source, zstd::encode_all(value.as_bytes(), 1).unwrap()).unwrap();
    LocalEvalBuildOptions {
        id: "recovery-fixture".into(),
        source: LocalEvalSource::File(source),
        output_dir: root.join("output"),
        max_pvs: 5,
        shard_count: 16,
    }
}

fn orphan(root: &Path) -> (Journal, Record) {
    let journal = Journal::open(&root.join("journal")).unwrap();
    let record = Record {
        schema: 1,
        id: "owned-fixture".into(),
        path: root.join("output"),
        identity: [7; 16],
        shard_count: 8192,
        state: "running".into(),
        progress: None,
        report: None,
        detail: None,
    };
    let _lease = journal.lease().unwrap();
    journal.save(&record).unwrap();
    fs::create_dir(&record.path).unwrap();
    fs::write(record.path.join(".encroissant-eval-build"), record.identity).unwrap();
    fs::create_dir(record.path.join("spool")).unwrap();
    fs::write(record.path.join("spool/4095.bin.zst"), b"partial").unwrap();
    (journal, record)
}

#[test]
fn completed_build_has_durable_report_and_cleanup_cannot_remove_it() {
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let job = options(&root);
    let report = build_compact_eval_database_recoverable(
        job,
        LocalEvalBuildControl::default(),
        &root.join("journal"),
        |_| {},
    )
    .unwrap();
    let state = get_build_job(&root.join("journal")).unwrap().unwrap();
    assert!(!state.active);
    assert_eq!(state.state, "ready");
    assert_eq!(state.report.unwrap().duplicates, report.duplicates);
    assert_eq!(state.store.unwrap().positions, 1);
    assert!(discard_build_job(&root.join("journal"), &state.id)
        .unwrap_err()
        .contains("completed"));
    assert!(root.join("output/manifest.json").is_file());
    assert_eq!(
        lookup_eval(&root.join("output"), START, 1)
            .unwrap()
            .unwrap()
            .pvs[0]
            .cp,
        Some(0)
    );
}

#[test]
fn a_real_lease_prevents_other_starts_and_cleanup() {
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let (journal, record) = orphan(&root);
    let lease = journal.lease().unwrap();
    let current = get_build_job(&root.join("journal")).unwrap().unwrap();
    assert!(current.active);
    assert!(discard_build_job(&root.join("journal"), &record.id)
        .unwrap_err()
        .contains("Another"));
    let mut next = options(&root);
    next.output_dir = root.join("another-output");
    assert!(build_compact_eval_database_recoverable(
        next,
        LocalEvalBuildControl::default(),
        &root.join("journal"),
        |_| {}
    )
    .unwrap_err()
    .to_string()
    .contains("Another"));
    assert!(!root.join("another-output").exists());
    drop(lease);
    assert_eq!(
        get_build_job(&root.join("journal")).unwrap().unwrap().state,
        "interrupted"
    );
    discard_build_job(&root.join("journal"), &record.id).unwrap();
    assert!(!record.path.exists());
    assert!(get_build_job(&root.join("journal")).unwrap().is_none());
}

#[test]
fn interrupted_job_must_be_explicitly_removed_before_a_fresh_attempt() {
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let (_, record) = orphan(&root);
    let mut next = options(&root);
    next.output_dir = root.join("next");
    let error = build_compact_eval_database_recoverable(
        next,
        LocalEvalBuildControl::default(),
        &root.join("journal"),
        |_| {},
    )
    .unwrap_err();
    assert!(error.to_string().contains("explicit cleanup"));
    assert!(!root.join("next").exists());
    assert!(discard_build_job(&root.join("journal"), "stale-id").is_err());
    assert!(record.path.join("spool/4095.bin.zst").is_file());
}

#[test]
fn unknown_entries_and_changed_ownership_refuse_before_deleting_any_file() {
    for mode in ["unknown", "nested", "marker", "manifest"] {
        let temp = fixture();
        let root = temp.path().canonicalize().unwrap();
        let (_, record) = orphan(&root);
        match mode {
            "unknown" => fs::write(record.path.join("owner-note.txt"), b"keep").unwrap(),
            "nested" => fs::write(record.path.join("spool/owner-note.txt"), b"keep").unwrap(),
            "marker" => fs::write(record.path.join(".encroissant-eval-build"), [8; 16]).unwrap(),
            "manifest" => fs::write(
                record.path.join("manifest.json"),
                b"unreadable published bytes",
            )
            .unwrap(),
            _ => unreachable!(),
        }
        assert!(
            discard_build_job(&root.join("journal"), &record.id).is_err(),
            "{mode}"
        );
        assert_eq!(
            fs::read(record.path.join("spool/4095.bin.zst")).unwrap(),
            b"partial",
            "{mode}"
        );
        assert!(get_build_job(&root.join("journal")).unwrap().is_some());
    }
}

#[test]
fn shard_inventory_uses_the_recorded_en_limit_not_a_foreign_2048_limit() {
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let (journal, mut record) = orphan(&root);
    record.shard_count = 2048;
    journal.save(&record).unwrap();
    assert!(discard_build_job(&root.join("journal"), &record.id).is_err());
    assert!(record.path.join("spool/4095.bin.zst").exists());
    record.shard_count = 8192;
    journal.save(&record).unwrap();
    discard_build_job(&root.join("journal"), &record.id).unwrap();
    assert!(!record.path.exists());
}

#[test]
fn corrupt_newer_unknown_and_oversized_journals_preserve_their_data() {
    for mode in ["corrupt", "newer", "unknown", "oversized"] {
        let temp = fixture();
        let root = temp.path().canonicalize().unwrap();
        let journal_path = root.join("journal");
        fs::create_dir(&journal_path).unwrap();
        let db_path = journal_path.join("jobs.sqlite3");
        if mode == "corrupt" {
            fs::write(&db_path, b"not sqlite").unwrap();
        } else if mode == "newer" || mode == "unknown" {
            let db = Connection::open(&db_path).unwrap();
            db.execute_batch(
                "CREATE TABLE owner_data(value TEXT); INSERT INTO owner_data VALUES('keep');",
            )
            .unwrap();
            if mode == "newer" {
                db.execute_batch("PRAGMA user_version=99").unwrap();
            }
        } else {
            let journal = Journal::open(&journal_path).unwrap();
            journal
                .db
                .execute(
                    "INSERT INTO job VALUES(1,?1)",
                    ["x".repeat(MAX_RECORD_BYTES as usize + 1)],
                )
                .unwrap();
        }
        let before = fs::read(&db_path).unwrap();
        assert!(get_build_job(&journal_path).is_err(), "{mode}");
        assert_eq!(fs::read(&db_path).unwrap(), before, "{mode}");
    }
}

#[test]
fn failed_and_cancelled_outcomes_survive_reopening_without_restarting_work() {
    for cancel in [false, true] {
        let temp = fixture();
        let root = temp.path().canonicalize().unwrap();
        let mut request = options(&root);
        if !cancel {
            request.source = LocalEvalSource::File(root.join("missing.zst"));
        }
        let control = LocalEvalBuildControl::default();
        let flag = control.cancel.clone();
        let result = build_compact_eval_database_recoverable(
            request,
            control,
            &root.join("journal"),
            |event| {
                if cancel && event.phase == "opening" {
                    flag.store(true, AtomicOrdering::Relaxed);
                }
            },
        );
        assert!(result.is_err());
        assert!(!root.join("output").exists());
        let state = get_build_job(&root.join("journal")).unwrap().unwrap();
        assert_eq!(state.state, if cancel { "cancelled" } else { "failed" });
        assert!(state.detail.is_some());
        discard_build_job(&root.join("journal"), &state.id).unwrap();
        assert!(get_build_job(&root.join("journal")).unwrap().is_none());
    }
}

#[test]
fn local_native_cancellation_remains_visible_until_the_worker_settles() {
    use std::sync::mpsc;
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let mut request = options(&root);
    request.id = format!("native-recovery-{:032x}", rand::random::<u128>());
    let id = request.id.clone();
    let lease = build_control::BuildLease::start(&id).unwrap();
    let mut control = LocalEvalBuildControl::default();
    control.cancel = lease.cancel.clone();
    control.state = lease.state.clone();
    let (ready_tx, ready_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let journal = root.join("journal");
    let worker_root = journal.clone();
    let worker = thread::spawn(move || {
        let _lease = lease;
        build_compact_eval_database_recoverable(request, control, &worker_root, |event| {
            if event.phase == "opening" {
                ready_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            }
        })
    });
    ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let before = get_build_job(&journal).unwrap().unwrap();
    assert!(before.active && before.can_cancel);
    assert!(build_control::cancel_build(&id));
    let stopping = get_build_job(&journal).unwrap().unwrap();
    assert_eq!(stopping.state, "cancelling");
    assert!(stopping.active);
    release_tx.send(()).unwrap();
    assert!(worker.join().unwrap().is_err());
    let settled = get_build_job(&journal).unwrap().unwrap();
    assert_eq!(settled.state, "cancelled");
    assert!(!settled.active && !settled.can_cancel);
    assert!(!build_control::cancel_build(&id));
}

#[test]
fn newer_record_fields_and_mismatched_progress_are_not_overwritten() {
    for mode in [
        "new-field",
        "wrong-id",
        "unknown-phase",
        "new-progress-field",
    ] {
        let temp = fixture();
        let root = temp.path().canonicalize().unwrap();
        let (journal, record) = orphan(&root);
        let mut value = serde_json::to_value(&record).unwrap();
        if mode == "new-field" {
            value["newerOwnerField"] = serde_json::json!("keep");
        } else {
            value["progress"] = serde_json::json!({"id":if mode=="wrong-id" {"other"} else {&record.id},"phase":if mode=="unknown-phase" {"future-phase"} else {"opening"},"progress":0,"positions":0,"skipped":0,"compressedBytesRead":0,"compressedBytesTotal":null,"finished":false});
            if mode == "new-progress-field" {
                value["progress"]["newerOwnerCounter"] = serde_json::json!(3);
            }
        }
        let raw = value.to_string();
        journal
            .db
            .execute("UPDATE job SET record=?1", [&raw])
            .unwrap();
        assert!(get_build_job(&root.join("journal")).is_err(), "{mode}");
        assert!(
            discard_build_job(&root.join("journal"), &record.id).is_err(),
            "{mode}"
        );
        let after: String = journal
            .db
            .query_row("SELECT record FROM job", [], |row| row.get(0))
            .unwrap();
        assert_eq!(after, raw);
        assert!(record.path.join("spool/4095.bin.zst").exists());
    }
}

#[cfg(windows)]
#[test]
fn linked_output_and_nested_junctions_are_refused_without_touching_targets() {
    use std::os::windows::process::CommandExt;
    for nested in [false, true] {
        let temp = fixture();
        let root = temp.path().canonicalize().unwrap();
        let (_, record) = orphan(&root);
        let link = if nested {
            record.path.join("spool")
        } else {
            record.path.clone()
        };
        let target = root.join("retained-target");
        fs::rename(&link, &target).unwrap();
        let script = root.join("make-test-junction.ps1");
        fs::write(&script,"param([string]$Link,[string]$Target)\n$ErrorActionPreference='Stop'\nNew-Item -ItemType Junction -Path $Link -Target $Target | Out-Null\n").unwrap();
        let result = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(&script)
            .arg("-Link")
            .arg(
                link.to_str()
                    .unwrap()
                    .strip_prefix(r"\\?\")
                    .unwrap_or(link.to_str().unwrap()),
            )
            .arg("-Target")
            .arg(
                target
                    .to_str()
                    .unwrap()
                    .strip_prefix(r"\\?\")
                    .unwrap_or(target.to_str().unwrap()),
            )
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert!(discard_build_job(&root.join("journal"), &record.id).is_err());
        let retained = if nested {
            target.join("4095.bin.zst")
        } else {
            target.join("spool/4095.bin.zst")
        };
        assert_eq!(fs::read(retained).unwrap(), b"partial");
        assert_eq!(
            fs::read(if nested {
                link.join("4095.bin.zst")
            } else {
                link.join("spool/4095.bin.zst")
            })
            .unwrap(),
            b"partial"
        );
        assert!(get_build_job(&root.join("journal")).unwrap().is_some());
    }
}

#[cfg(windows)]
#[test]
fn a_locked_shard_keeps_the_marker_and_can_be_retried_after_release() {
    use std::os::windows::fs::OpenOptionsExt;
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let (_, record) = orphan(&root);
    let handle = OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(record.path.join("spool/4095.bin.zst"))
        .unwrap();
    assert!(discard_build_job(&root.join("journal"), &record.id).is_err());
    assert!(record.path.join(".encroissant-eval-build").exists());
    drop(handle);
    discard_build_job(&root.join("journal"), &record.id).unwrap();
    assert!(!record.path.exists());
}

#[cfg(windows)]
#[test]
fn a_locked_output_folder_restores_its_marker_for_retry() {
    use std::os::windows::fs::OpenOptionsExt;
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let (_, record) = orphan(&root);
    let handle = OpenOptions::new()
        .read(true)
        .share_mode(3)
        .custom_flags(0x02000000)
        .open(&record.path)
        .unwrap();
    let error = discard_build_job(&root.join("journal"), &record.id).unwrap_err();
    assert!(error.contains("marker was restored"), "{error}");
    assert_eq!(
        fs::read(record.path.join(".encroissant-eval-build")).unwrap(),
        record.identity
    );
    assert!(!record.path.join("spool").exists());
    assert!(get_build_job(&root.join("journal")).unwrap().is_some());
    drop(handle);
    discard_build_job(&root.join("journal"), &record.id).unwrap();
    assert!(!record.path.exists());
}

struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
        }
        let _ = self.0.wait();
    }
}

#[test]
fn actual_process_death_during_ingest_sort_and_after_publication_restores_safely() {
    for phase in ["ingesting", "sorting", "ready"] {
        let temp = fixture();
        let root = temp.path().canonicalize().unwrap();
        options(&root);
        let mut command = Command::new(std::env::current_exe().unwrap());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let child = command
            .args([
                "--ignored",
                "--exact",
                "local_eval::build_recovery::tests::recovery_fixture_child",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("EN_EVAL_RECOVERY_CHILD", &root)
            .env("EN_EVAL_RECOVERY_PHASE", phase)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut child = ChildGuard(child);
        let start = Instant::now();
        while !root.join("barrier").exists() {
            assert!(
                child.0.try_wait().unwrap().is_none(),
                "child exited before {phase}"
            );
            assert!(
                start.elapsed() < Duration::from_secs(15),
                "child barrier {phase}"
            );
            thread::sleep(Duration::from_millis(10));
        }
        let active = get_build_job(&root.join("journal")).unwrap().unwrap();
        assert!(active.active);
        assert!(discard_build_job(&root.join("journal"), &active.id).is_err());
        child.0.kill().unwrap();
        child.0.wait().unwrap();
        let restored = get_build_job(&root.join("journal")).unwrap().unwrap();
        assert!(!restored.active);
        if phase == "ready" {
            assert_eq!(restored.state, "ready");
            assert!(
                restored.report.is_none(),
                "unknown duplicate count must not be invented"
            );
            assert_eq!(restored.store.unwrap().positions, 1);
            assert!(discard_build_job(&root.join("journal"), &restored.id).is_err());
            assert!(root.join("output/manifest.json").exists());
        } else {
            assert_eq!(restored.state, "interrupted");
            discard_build_job(&root.join("journal"), &restored.id).unwrap();
            assert!(!root.join("output").exists());
        }
    }
}

#[test]
#[ignore = "private child helper; exercised by actual_process_death test"]
fn recovery_fixture_child() {
    let Some(path) = std::env::var_os("EN_EVAL_RECOVERY_CHILD") else {
        return;
    };
    let root = PathBuf::from(path);
    assert!(root
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("en-eval-recovery-"));
    let phase = std::env::var("EN_EVAL_RECOVERY_PHASE").unwrap();
    build_compact_eval_database_recoverable(
        options(&root),
        LocalEvalBuildControl::default(),
        &root.join("journal"),
        |event| {
            if event.phase == phase {
                fs::write(root.join("barrier"), phase.as_bytes()).unwrap();
                loop {
                    thread::sleep(Duration::from_millis(20));
                }
            }
        },
    )
    .unwrap();
}
