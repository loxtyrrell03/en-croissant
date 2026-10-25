use super::*;

const START: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

fn line(depth: u16, score: i32, moves: &str) -> String {
    serde_json::json!({"fen":START,"evals":[{"depth":depth,"knodes":17,"pvs":[{"cp":score,"line":moves}]}]}).to_string()+"\n"
}

fn options(parent: &Path, contents: &str) -> LocalEvalBuildOptions {
    let source = parent.join("tiny-source.zst");
    fs::write(&source, zstd::encode_all(contents.as_bytes(), 1).unwrap()).unwrap();
    LocalEvalBuildOptions {
        id: "bounded-fixture".into(),
        source: LocalEvalSource::File(source),
        output_dir: parent.join("new-output"),
        max_pvs: 5,
        shard_count: 16,
    }
}

#[test]
fn invalid_move_token_never_reconnects_the_continuation() {
    let record = parse_compact_record(&line(20, 10, "e2e4 invalid e7e5"), 5).unwrap();
    assert!(
        record.is_none(),
        "the later move cannot cross an invalid token"
    );
}

#[test]
fn ambiguous_score_is_not_published_as_an_ordinary_centipawn_score() {
    let source=serde_json::json!({"fen":START,"evals":[{"depth":20,"pvs":[{"cp":10,"mate":2,"line":"e2e4 e7e5"}]}]}).to_string();
    assert!(parse_compact_record(&source, 5).unwrap().is_none());
    assert_eq!(
        parse_compact_record(&line(20, 0, "e2e4 e7e5"), 5)
            .unwrap()
            .unwrap()
            .pvs[0]
            .score,
        0
    );
}

#[test]
fn duplicate_positions_keep_the_best_record_independent_of_source_order() {
    let entries = [
        line(12, 12, "d2d4 d7d5"),
        line(24, 24, "e2e4 e7e5"),
        line(18, 18, "c2c4 e7e5"),
    ];
    for indices in [[0, 1, 2], [2, 1, 0], [1, 2, 0]] {
        let dir = tempfile::tempdir().unwrap();
        let source = indices
            .iter()
            .map(|&i| entries[i].as_str())
            .collect::<String>();
        let request = options(dir.path(), &source);
        let output = request.output_dir.clone();
        let report = build_compact_eval_database(request, |_| {}).unwrap();
        assert_eq!(
            report.positions, 1,
            "manifest/report counts unique positions"
        );
        assert_eq!(report.duplicates, 2);
        let evaluation = lookup_eval(&output, START, 1).unwrap().unwrap();
        assert_eq!(evaluation.depth, 24);
        assert_eq!(evaluation.pvs[0].cp, Some(24));
        assert_eq!(evaluation.pvs[0].moves, "e2e4 e7e5");
    }
}

#[test]
fn an_oversized_source_line_is_rejected_before_the_next_record() {
    let dir = tempfile::tempdir().unwrap();
    let source = " ".repeat(1024 * 1024 + 1) + "\n" + &line(20, 12, "e2e4 e7e5");
    let request = options(dir.path(), &source);
    let output = request.output_dir.clone();
    let result = build_compact_eval_database(request, |_| {});
    assert!(
        result.is_err(),
        "even whitespace source lines have a byte bound"
    );
    assert!(!output.exists());
}

#[test]
fn native_build_schema_and_cancel_metadata_match_the_transport_contract() {
    use specta::datatype::{DataType, FunctionResultVariant, PrimitiveType};
    let config = specta_typescript::Typescript::default()
        .bigint(specta_typescript::BigIntExportBehavior::BigInt);
    let generated = [
        specta_typescript::export::<LocalEvalBuildRequest>(&config).unwrap(),
        specta_typescript::export::<LocalEvalBuildReport>(&config).unwrap(),
        specta_typescript::export::<LocalEvalBuildJob>(&config).unwrap(),
    ];
    let actual = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../src/bindings/generated.ts"
    ));
    let normalize = |text: &str| {
        text.chars()
            .filter(|value| !value.is_whitespace())
            .collect::<String>()
    };
    for (name, expected) in [
        "LocalEvalBuildRequest",
        "LocalEvalBuildReport",
        "LocalEvalBuildJob",
    ]
    .into_iter()
    .zip(generated)
    {
        let prefix = format!("export type {name} =");
        let actual = actual
            .lines()
            .find(|line| line.starts_with(&prefix))
            .unwrap();
        assert_eq!(normalize(actual), normalize(&expected), "{name}");
    }
    let mut types = specta::TypeMap::default();
    let metadata =
        (specta::function::collect_functions![crate::local_eval::cancel_local_lichess_eval_db])(
            &mut types,
        );
    let method = &metadata[0];
    assert_eq!(method.name(), "cancel_local_lichess_eval_db");
    let args = method.args().collect::<Vec<_>>();
    assert_eq!(args.len(), 1);
    assert_eq!(args[0].0, "id");
    assert!(matches!(
        args[0].1,
        DataType::Primitive(PrimitiveType::String)
    ));
    assert!(matches!(
        method.result(),
        Some(FunctionResultVariant::Value(DataType::Primitive(
            PrimitiveType::bool
        )))
    ));
    let legacy: LocalEvalBuildRequest =
        serde_json::from_value(serde_json::json!({"id":"legacy"})).unwrap();
    assert!(legacy.disk_limit_gib.is_none());
    let limited: LocalEvalBuildRequest =
        serde_json::from_value(serde_json::json!({"diskLimitGib":32})).unwrap();
    assert_eq!(limited.disk_limit_gib, Some(32));
    let recovery = (specta::function::collect_functions![
        crate::local_eval::get_local_eval_build_job,
        crate::local_eval::discard_local_eval_build_job
    ])(&mut types);
    assert_eq!(recovery[0].name(), "get_local_eval_build_job");
    assert_eq!(
        recovery[0].args().count(),
        0,
        "AppHandle is not a transport argument"
    );
    assert_eq!(recovery[1].name(), "discard_local_eval_build_job");
    let args = recovery[1].args().collect::<Vec<_>>();
    assert_eq!(args.len(), 1);
    assert_eq!(args[0].0, "id");
    assert!(matches!(
        args[0].1,
        DataType::Primitive(PrimitiveType::String)
    ));
}

#[test]
fn corrupt_high_priority_candidates_do_not_hide_a_valid_evaluation() {
    let source = serde_json::json!({"fen":START,"evals":[
        {"depth":40,"pvs":[{"cp":9,"mate":2,"line":"e2e4"},{"cp":1,"line":"invalid"}]},
        {"depth":20,"pvs":[{"cp":0,"line":"e2e4 e7e5"}]}
    ]})
    .to_string();
    let record = parse_compact_record(&source, 5).unwrap().unwrap();
    assert_eq!(record.depth, 20);
    assert_eq!(record.pvs[0].score, 0);
}

#[test]
fn disk_quota_failure_removes_only_the_owned_output() {
    let dir = tempfile::tempdir().unwrap();
    let request = options(dir.path(), &line(20, 10, "e2e4 e7e5").repeat(64));
    let output = request.output_dir.clone();
    let mut control = LocalEvalBuildControl::default();
    control.disk_limit_bytes = 1024;
    let error = build_compact_eval_database_controlled(request, control, |_| {}).unwrap_err();
    assert!(error.to_string().contains("disk-space limit"), "{error}");
    assert!(!output.exists());
    assert!(dir.path().join("tiny-source.zst").exists());
}

#[test]
fn quota_covers_the_spool_and_compressed_shard_at_the_same_time() {
    let dir = tempfile::tempdir().unwrap();
    let mut source = String::new();
    for rank in 2..=5 {
        for file in 0..8 {
            // 31 one-move records fit ingestion, leaving too little room for
            // the compressed output while their spool is still present.
            if rank == 5 && file == 7 {
                continue;
            }
            let mut rows = vec!["8".to_string(); 8];
            rows[0] = "4k3".into();
            rows[7] = "4K3".into();
            rows[8 - rank] = format!(
                "{}P{}",
                if file == 0 {
                    String::new()
                } else {
                    file.to_string()
                },
                if file == 7 {
                    String::new()
                } else {
                    (7 - file).to_string()
                }
            );
            let letter = (b'a' + file as u8) as char;
            let moves = format!("{letter}{rank}{letter}{}", rank + 1);
            source+=&(serde_json::json!({"fen":format!("{} w - - 0 1",rows.join("/")),"evals":[{"depth":20,"pvs":[{"cp":12,"line":moves}]}]}).to_string()+"\n");
        }
    }
    let request = options(dir.path(), &source);
    let output = request.output_dir.clone();
    let mut control = LocalEvalBuildControl::default();
    control.disk_limit_bytes = 1024;
    let mut sorting = false;
    let error = build_compact_eval_database_controlled(request, control, |progress| {
        sorting |= progress.phase == "sorting";
    })
    .unwrap_err();
    assert!(
        sorting,
        "ingestion should fit; the peak includes both input and output"
    );
    assert!(error.to_string().contains("disk-space limit"), "{error}");
    assert!(!output.exists());
}

#[test]
fn shard_read_bound_is_enforced_before_sorting() {
    let dir = tempfile::tempdir().unwrap();
    let record = parse_compact_record(&line(20, 10, "e2e4 e7e5"), 5)
        .unwrap()
        .unwrap();
    let bytes = pack_record(&record).unwrap();
    let input = dir.path().join("tiny-spool");
    fs::write(&input, &bytes).unwrap();
    let mut control = LocalEvalBuildControl::default();
    control.max_shard_bytes = bytes.len() as u64 - 1;
    let mut budget = build_control::DiskBudget {
        used: bytes.len() as u64,
        limit: 4096,
    };
    let output = dir.path().join("should-not-exist");
    let error = build::sort_shard(&input, &output, &mut budget, &control).unwrap_err();
    assert!(error.to_string().contains("bounded sorting size"));
    assert!(!output.exists());
}

#[test]
fn cancellation_before_and_during_build_never_publishes_a_store() {
    use std::sync::atomic::Ordering;
    for phase in ["before", "opening", "ingesting", "sorting"] {
        let dir = tempfile::tempdir().unwrap();
        let request = options(dir.path(), &line(20, 10, "e2e4 e7e5"));
        let output = request.output_dir.clone();
        let control = LocalEvalBuildControl::default();
        let cancel = control.cancel.clone();
        if phase == "before" {
            cancel.store(true, Ordering::Relaxed);
        }
        let error = build_compact_eval_database_controlled(request, control, |progress| {
            if progress.phase == phase {
                cancel.store(true, Ordering::Relaxed);
            }
        })
        .unwrap_err();
        assert!(error.to_string().contains("cancelled"), "{phase}: {error}");
        assert!(!output.exists(), "{phase}");
    }
}

#[test]
fn cli_cancel_signal_is_read_without_removing_the_signal_or_source() {
    let dir = tempfile::tempdir().unwrap();
    let request = options(dir.path(), &line(20, 10, "e2e4 e7e5"));
    let output = request.output_dir.clone();
    let signal = dir.path().join("cancel-signal");
    let mut control = LocalEvalBuildControl::default();
    control.cancel_file = Some(signal.clone());
    let error = build_compact_eval_database_controlled(request, control, |progress| {
        if progress.phase == "ingesting" {
            fs::write(&signal, "cancel").unwrap();
        }
    })
    .unwrap_err();
    assert!(error.to_string().contains("cancelled"));
    assert!(!output.exists());
    assert_eq!(fs::read_to_string(signal).unwrap(), "cancel");
    assert!(dir.path().join("tiny-source.zst").exists());
}

#[test]
fn native_cancel_targets_the_registered_job_and_keeps_its_lease_until_finish() {
    use std::sync::atomic::Ordering;
    let id = format!("fixture-{:032x}", rand::random::<u128>());
    let lease = build_control::BuildLease::start(&id).unwrap();
    assert!(!cancel_local_lichess_eval_db(format!("{id}-other")));
    assert!(cancel_local_lichess_eval_db(id.clone()));
    assert!(lease.cancel.load(Ordering::Relaxed));
    assert!(build_control::BuildLease::start(&id).is_err());
    drop(lease);
    assert!(!cancel_local_lichess_eval_db(id.clone()));
    let next = build_control::BuildLease::start(&id).unwrap();
    assert!(!next.cancel.load(Ordering::Relaxed));
}

#[test]
fn cancellation_cannot_acknowledge_an_abort_after_publication_has_won() {
    let dir = tempfile::tempdir().unwrap();
    let mut request = options(dir.path(), &line(20, 10, "e2e4 e7e5"));
    let id = format!("commit-{:032x}", rand::random::<u128>());
    request.id = id.clone();
    let lease = build_control::BuildLease::start(&id).unwrap();
    let mut control = LocalEvalBuildControl::default();
    control.cancel = lease.cancel.clone();
    control.state = lease.state.clone();
    let mut late_cancel = None;
    let result = build_compact_eval_database_controlled(request, control, |progress| {
        if progress.finished {
            late_cancel = Some(cancel_local_lichess_eval_db(id.clone()));
        }
    })
    .unwrap();
    assert_eq!(late_cancel, Some(false));
    assert!(database_status(Path::new(&result.output_dir)).available);
    drop(lease);
}

fn serve_source(
    handler: impl FnOnce(std::net::TcpStream) + Send + 'static,
) -> (String, std::thread::JoinHandle<()>) {
    use std::{
        net::TcpListener,
        thread,
        time::{Duration, Instant},
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}/source.zst", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error)
                    if error.kind() == io::ErrorKind::WouldBlock && Instant::now() < deadline =>
                {
                    thread::sleep(Duration::from_millis(5))
                }
                Err(error) => panic!("source request not received: {error}"),
            }
        };
        stream.set_nonblocking(false).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut request = Vec::new();
        while !request.ends_with(b"\r\n\r\n") {
            assert!(request.len() < 8192);
            let mut byte = [0];
            stream.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        handler(stream);
    });
    (url, server)
}

fn url_options(parent: &Path, url: String) -> LocalEvalBuildOptions {
    LocalEvalBuildOptions {
        id: "local-http-fixture".into(),
        source: LocalEvalSource::Url(url),
        output_dir: parent.join("new-output"),
        max_pvs: 5,
        shard_count: 16,
    }
}

#[test]
fn manifest_bytes_are_inside_the_same_disk_quota() {
    use std::io::Write;
    let body = zstd::encode_all(line(20, 10, "e2e4 e7e5").as_bytes(), 1).unwrap();
    let (url, server) = serve_source(move |mut stream| {
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .unwrap();
        stream.write_all(&body).unwrap();
    });
    let dir = tempfile::tempdir().unwrap();
    let request = url_options(dir.path(), url + "?fixture=" + &"x".repeat(1100));
    let output = request.output_dir.clone();
    let mut control = LocalEvalBuildControl::default();
    control.disk_limit_bytes = 1024;
    let error = build_compact_eval_database_controlled(request, control, |_| {}).unwrap_err();
    server.join().unwrap();
    assert!(error.to_string().contains("disk-space limit"), "{error}");
    assert!(!output.exists());
}

fn timeout_in_chain(error: &(dyn std::error::Error + 'static)) -> bool {
    if let Some(value) = error.downcast_ref::<reqwest::Error>() {
        if value.is_timeout() {
            return true;
        }
    }
    if let Some(value) = error.downcast_ref::<io::Error>() {
        if value.kind() == io::ErrorKind::TimedOut {
            return true;
        }
    }
    error.to_string().contains("timed out") || error.source().is_some_and(timeout_in_chain)
}

#[test]
fn header_and_body_stalls_settle_within_the_configured_read_bound() {
    use std::{io::Write, thread, time::Duration};
    for headers in [false, true] {
        let (url, server) = serve_source(move |mut stream| {
            if headers {
                stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n\x28\xb5\x2f\xfd").unwrap();
                stream.flush().unwrap();
            }
            thread::sleep(Duration::from_millis(250));
        });
        let dir = tempfile::tempdir().unwrap();
        let request = url_options(dir.path(), url);
        let output = request.output_dir.clone();
        let mut control = LocalEvalBuildControl::default();
        control.read_stall = Duration::from_millis(50);
        let error = build_compact_eval_database_controlled(request, control, |_| {}).unwrap_err();
        server.join().unwrap();
        assert!(timeout_in_chain(&error), "headers {headers}: {error:?}");
        assert!(!output.exists());
    }
}

#[test]
fn a_progressing_download_outlives_its_individual_read_deadline() {
    use std::{
        io::Write,
        thread,
        time::{Duration, Instant},
    };
    let body = zstd::encode_all(line(20, 10, "e2e4 e7e5").as_bytes(), 1).unwrap();
    let (url, server) = serve_source(move |mut stream| {
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .unwrap();
        for chunk in body.chunks(4) {
            stream.write_all(chunk).unwrap();
            stream.flush().unwrap();
            thread::sleep(Duration::from_millis(20));
        }
    });
    let dir = tempfile::tempdir().unwrap();
    let request = url_options(dir.path(), url);
    let output = request.output_dir.clone();
    let mut control = LocalEvalBuildControl::default();
    control.read_stall = Duration::from_millis(200);
    let start = Instant::now();
    let result = build_compact_eval_database_controlled(request, control, |_| {});
    server.join().unwrap();
    assert_eq!(result.unwrap().positions, 1);
    assert!(start.elapsed() > Duration::from_millis(200));
    assert!(lookup_eval(&output, START, 1).unwrap().is_some());
}

#[test]
fn cancellation_during_a_stalled_read_keeps_a_clear_cancel_result() {
    use std::{io::Write, sync::atomic::Ordering, thread, time::Duration};
    let mut control = LocalEvalBuildControl::default();
    control.read_stall = Duration::from_millis(75);
    let cancel = control.cancel.clone();
    let (url, server) = serve_source(move |mut stream| {
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n\x28\xb5\x2f\xfd").unwrap();
        stream.flush().unwrap();
        thread::sleep(Duration::from_millis(20));
        cancel.store(true, Ordering::Relaxed);
        thread::sleep(Duration::from_millis(250));
    });
    let dir = tempfile::tempdir().unwrap();
    let request = url_options(dir.path(), url);
    let output = request.output_dir.clone();
    let error = build_compact_eval_database_controlled(request, control, |_| {}).unwrap_err();
    server.join().unwrap();
    assert!(error.to_string().contains("cancelled"), "{error}");
    assert!(!output.exists());
}

#[test]
fn invalid_budgets_and_an_internal_cancel_signal_are_refused_before_reading() {
    for limit in [0, 1023, 513 * 1024 * 1024 * 1024] {
        let dir = tempfile::tempdir().unwrap();
        let request = options(dir.path(), &line(20, 10, "e2e4 e7e5"));
        let output = request.output_dir.clone();
        let mut control = LocalEvalBuildControl::default();
        control.disk_limit_bytes = limit;
        assert!(build_compact_eval_database_controlled(request, control, |_| {}).is_err());
        assert!(!output.exists());
    }
    let dir = tempfile::tempdir().unwrap();
    let request = options(dir.path(), &line(20, 10, "e2e4 e7e5"));
    let output = request.output_dir.clone();
    let mut control = LocalEvalBuildControl::default();
    control.cancel_file = Some(output.join("cancel"));
    assert!(
        build_compact_eval_database_controlled(request, control, |_| {})
            .unwrap_err()
            .to_string()
            .contains("outside")
    );
    assert!(!output.exists());
}
