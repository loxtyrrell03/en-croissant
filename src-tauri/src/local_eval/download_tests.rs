use super::*;
use std::{fs::OpenOptions, io::Write, net::TcpListener, sync::atomic::AtomicBool, thread};

const START: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

fn fixture() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("en-eval-download-")
        .tempdir()
        .unwrap()
}

fn source() -> Vec<u8> {
    zstd::encode_all((serde_json::json!({"fen":START,"evals":[{"depth":30,"pvs":[{"cp":24,"line":"e2e4 e7e5"}]}]}).to_string()+"\n").as_bytes(),1).unwrap()
}

struct Server {
    url: String,
    requests: Arc<Mutex<Vec<String>>>,
    stop: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}

impl Server {
    fn new(mode: &'static str) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/archive.zst", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::<String>::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let observed = requests.clone();
        let stopped = stop.clone();
        let worker = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            while !stopped.load(Ordering::Relaxed) && Instant::now() < deadline {
                let (mut socket, _) = match listener.accept() {
                    Ok(socket) => socket,
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    Err(error) => panic!("fixture accept: {error}"),
                };
                socket.set_nonblocking(false).unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(1)))
                    .unwrap();
                let mut input = Vec::new();
                let mut byte = [0];
                while !input.ends_with(b"\r\n\r\n") && input.len() < 65536 {
                    if socket.read(&mut byte).unwrap_or(0) == 0 {
                        break;
                    }
                    input.push(byte[0]);
                }
                let request = String::from_utf8(input).unwrap();
                let head = request.starts_with("HEAD ");
                if !head && !request.starts_with("GET ") {
                    continue;
                }
                observed.lock().unwrap().push(request);
                let body = if mode == "malformed" {
                    zstd::encode_all(b"not a source row\n".as_slice(), 1).unwrap()
                } else {
                    source()
                };
                let length = if mode == "zero" {
                    0
                } else {
                    body.len() + usize::from(mode == "truncated") * 32
                };
                let code = if mode == "redirect" {
                    "302 Found"
                } else if mode == "partial" || (mode == "partial-get" && !head) {
                    "206 Partial Content"
                } else {
                    "200 OK"
                };
                let mut headers = format!("HTTP/1.1 {code}\r\nConnection: close\r\n");
                if mode == "redirect" {
                    headers += "Location: http://127.0.0.1:9/must-not-fetch\r\n";
                }
                if mode != "unknown-size" && !(mode == "unknown-get-size" && !head) {
                    headers += &format!("Content-Length: {length}\r\n");
                }
                if mode != "no-version" {
                    let version = if !head && mode == "changed" {
                        "changed"
                    } else {
                        "fixture"
                    };
                    headers += &format!(
                        "ETag: \"{version}\"\r\nLast-Modified: Wed, 21 Oct 2026 07:28:00 GMT\r\n"
                    );
                }
                headers += "\r\n";
                let _ = socket.write_all(headers.as_bytes());
                if !head {
                    if mode == "stall" {
                        thread::sleep(Duration::from_millis(400));
                    } else if mode == "progress" {
                        for part in body.chunks((body.len() / 8).max(1)) {
                            let _ = socket.write_all(part);
                            let _ = socket.flush();
                            thread::sleep(Duration::from_millis(60));
                        }
                    } else {
                        let _ = socket.write_all(&body);
                    }
                }
            }
        });
        Self {
            url,
            requests,
            stop,
            worker: Some(worker),
        }
    }
    fn http(&self) -> Client {
        Client::builder()
            .no_proxy()
            .read_timeout(Duration::from_secs(2))
            .build()
            .unwrap()
    }
    fn requests(&self) -> Vec<String> {
        self.requests.lock().unwrap().clone()
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        self.worker.take().unwrap().join().unwrap();
    }
}

async fn reviewed(root: &Path, server: &Server) -> Reviewed {
    review_source(
        root.join("journal"),
        root.join("output"),
        1024 * 1024,
        &server.url,
        &server.http(),
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn review_is_head_only_and_start_streams_a_queryable_durable_store() {
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let server = Server::new("good");
    let review = reviewed(&root, &server).await;
    assert!(!root.join("output").exists());
    assert_eq!(server.requests().len(), 1);
    assert!(server.requests()[0].starts_with("HEAD "));
    assert_eq!(review.view.download_bytes, source().len() as u64);
    assert_eq!(review.view.reserve_bytes, RESERVE_BYTES);
    assert!(review.view.available_bytes >= review.view.disk_limit_bytes + RESERVE_BYTES);
    let report = transfer(review, server.http(), None, 16, |_| {})
        .await
        .unwrap();
    assert_eq!(report.positions, 1);
    assert_eq!(
        lookup_eval(&root.join("output"), START, 1)
            .unwrap()
            .unwrap()
            .depth,
        30
    );
    let restored = get_build_job(&root.join("journal")).unwrap().unwrap();
    assert_eq!(restored.state, "ready");
    assert!(!restored.active);
    assert_eq!(restored.report.unwrap().positions, 1);
    let requests = server.requests();
    assert_eq!(requests.len(), 2);
    assert!(requests[1]
        .to_ascii_lowercase()
        .contains("if-match: \"fixture\""));
    assert!(requests[1]
        .to_ascii_lowercase()
        .contains("if-unmodified-since: wed, 21 oct 2026 07:28:00 gmt"));
}

#[tokio::test]
async fn invalid_review_metadata_cannot_start_or_create_output() {
    for mode in ["zero", "unknown-size", "no-version", "partial"] {
        let temp = fixture();
        let root = temp.path().canonicalize().unwrap();
        let server = Server::new(mode);
        assert!(
            review_source(
                root.join("journal"),
                root.join("output"),
                1024 * 1024,
                &server.url,
                &server.http()
            )
            .await
            .is_err(),
            "{mode}"
        );
        assert_eq!(server.requests().len(), 1, "{mode}");
        assert!(!root.join("output").exists());
        assert!(get_build_job(&root.join("journal")).unwrap().is_none());
    }
}

#[tokio::test]
async fn changed_and_truncated_archives_fail_without_publishing_or_changing_existing_data() {
    for mode in [
        "changed",
        "truncated",
        "malformed",
        "partial-get",
        "unknown-get-size",
        "location",
    ] {
        let temp = fixture();
        let root = temp.path().canonicalize().unwrap();
        let server = Server::new(mode);
        let owner = root.join("retained-owner.txt");
        fs::write(&owner, b"keep").unwrap();
        let mut review = reviewed(&root, &server).await;
        if mode == "location" {
            review.final_url.push_str("/changed-destination");
        }
        let error = transfer(review, server.http(), None, 16, |_| {})
            .await
            .unwrap_err();
        if mode == "changed" {
            assert!(error.contains("changed"), "{error}");
        }
        if mode == "malformed" {
            assert!(error.contains("source line"), "{error}");
        }
        assert!(!root.join("output").exists(), "{mode}");
        assert_eq!(fs::read(&owner).unwrap(), b"keep");
        let status = get_build_job(&root.join("journal")).unwrap().unwrap();
        assert_eq!(status.state, "failed", "{mode}");
        assert!(!status.active);
        assert!(status.detail.is_some());
    }
}

#[tokio::test]
async fn production_policy_refuses_non_https_redirects() {
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let server = Server::new("redirect");
    let http = client_builder().no_proxy().build().unwrap();
    let error = review_source(
        root.join("journal"),
        root.join("output"),
        1024 * 1024,
        &server.url,
        &http,
    )
    .await
    .err()
    .unwrap();
    assert!(error.contains("redirect"), "{error}");
    assert_eq!(server.requests().len(), 1);
    assert!(!root.join("output").exists());
}

#[tokio::test]
async fn invalid_destination_refuses_before_any_archive_request() {
    for nested_journal in [false, true] {
        let temp = fixture();
        let root = temp.path().canonicalize().unwrap();
        let server = Server::new("good");
        let output = if nested_journal {
            root.join("journal/output")
        } else {
            root.clone()
        };
        assert!(review_source(
            root.join("journal"),
            output,
            1024 * 1024,
            &server.url,
            &server.http()
        )
        .await
        .is_err());
        assert!(server.requests().is_empty());
        assert!(!root.join("journal/output").exists());
    }
}

#[tokio::test]
async fn lease_failure_happens_before_get_and_is_returned_to_the_start_caller() {
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let server = Server::new("good");
    let review = reviewed(&root, &server).await;
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .open(root.join("journal/job.lock"))
        .unwrap();
    fs2::FileExt::try_lock_exclusive(&lock).unwrap();
    let (sender, started) = oneshot::channel();
    let error = transfer(review, server.http(), Some(sender), 16, |_| {})
        .await
        .unwrap_err();
    assert!(error.contains("Another"), "{error}");
    assert!(started.await.unwrap().is_err());
    assert_eq!(server.requests().len(), 1);
    assert!(!root.join("output").exists());
}

#[tokio::test]
async fn start_rechecks_expiry_path_and_capacity_before_get() {
    for mode in ["expired", "exists", "space"] {
        let temp = fixture();
        let root = temp.path().canonicalize().unwrap();
        let server = Server::new("good");
        let mut review = reviewed(&root, &server).await;
        match mode {
            "expired" => review.at = Instant::now() - REVIEW_TTL - Duration::from_secs(1),
            "exists" => {
                fs::create_dir(root.join("output")).unwrap();
            }
            "space" => review.view.disk_limit_bytes = u64::MAX,
            _ => unreachable!(),
        }
        let error = transfer(review, server.http(), None, 16, |_| {})
            .await
            .unwrap_err();
        assert!(!error.is_empty());
        assert_eq!(server.requests().len(), 1, "{mode}");
        if mode == "exists" {
            assert_eq!(fs::read_dir(root.join("output")).unwrap().count(), 0);
        } else {
            assert!(!root.join("output").exists());
        }
        assert!(get_build_job(&root.join("journal")).unwrap().is_none());
    }
}

#[tokio::test]
async fn native_cancellation_interrupts_stalled_http_and_waits_for_owned_cleanup() {
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let server = Server::new("stall");
    let review = reviewed(&root, &server).await;
    let id = review.view.token.clone();
    let http = Client::builder()
        .no_proxy()
        .read_timeout(Duration::from_secs(10))
        .build()
        .unwrap();
    let (sender, started) = oneshot::channel();
    let worker = tokio::spawn(transfer(review, http, Some(sender), 16, |_| {}));
    assert_eq!(started.await.unwrap().unwrap(), id);
    let before = Instant::now();
    while server.requests().len() < 2 {
        assert!(before.elapsed() < Duration::from_secs(2));
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    let active = get_build_job(&root.join("journal")).unwrap().unwrap();
    assert!(active.active && active.can_cancel);
    assert_eq!(
        active.progress.unwrap().compressed_bytes_total,
        Some(source().len() as u64)
    );
    assert!(!build_control::cancel_build("not-this-job"));
    let cancelled_at = Instant::now();
    assert!(build_control::cancel_build(&id));
    let error = tokio::time::timeout(Duration::from_secs(2), worker)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err();
    assert!(cancelled_at.elapsed() < Duration::from_secs(1));
    assert!(error.contains("cancelled"), "{error}");
    assert!(!root.join("output").exists());
    let settled = get_build_job(&root.join("journal")).unwrap().unwrap();
    assert_eq!(settled.state, "cancelled");
    assert!(!settled.active && !settled.can_cancel);
    assert!(!build_control::cancel_build(&id));
}

#[tokio::test]
async fn stalled_http_fails_with_a_visible_settled_job() {
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let server = Server::new("stall");
    let review = reviewed(&root, &server).await;
    let http = Client::builder()
        .no_proxy()
        .read_timeout(Duration::from_millis(80))
        .build()
        .unwrap();
    let started = Instant::now();
    assert!(transfer(review, http, None, 16, |_| {}).await.is_err());
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(!root.join("output").exists());
    assert_eq!(
        get_build_job(&root.join("journal")).unwrap().unwrap().state,
        "failed"
    );
}

#[tokio::test]
async fn progressing_stream_can_outlive_its_individual_read_timeout() {
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let server = Server::new("progress");
    let review = reviewed(&root, &server).await;
    let timeout = Duration::from_millis(180);
    let http = Client::builder()
        .no_proxy()
        .read_timeout(timeout)
        .build()
        .unwrap();
    let started = Instant::now();
    let report = transfer(review, http, None, 16, |_| {}).await.unwrap();
    assert!(started.elapsed() > timeout);
    assert_eq!(report.positions, 1);
    assert_eq!(
        get_build_job(&root.join("journal")).unwrap().unwrap().state,
        "ready"
    );
}

#[tokio::test]
async fn background_start_returns_durable_identity_and_work_outlives_its_caller() {
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let server = Server::new("progress");
    let review = reviewed(&root, &server).await;
    let id = review.view.token.clone();
    assert_eq!(launch(review, server.http(), |_| {}).await.unwrap(), id);
    let current = get_build_job(&root.join("journal")).unwrap().unwrap();
    assert_eq!(current.id, id);
    assert!(current.active);
    // The launch future is gone; status observes the independently owned worker.
    // This tests worker lifetime, not disk speed. The real 2048-shard path
    // durably commits progress and can contend with other filesystem fixtures.
    let settled = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let job = get_build_job(&root.join("journal")).unwrap().unwrap();
            assert_eq!(job.id, id);
            if !job.active {
                break job;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await;
    let final_job = match settled {
        Ok(job) => job,
        Err(error) => {
            build_control::cancel_build(&id);
            let last = get_build_job(&root.join("journal"));
            // An observation timeout is not proof that the worker stopped.
            // Preserve this exact fixture instead of deleting its active files.
            std::mem::forget(temp);
            panic!("Background worker did not settle: {error}; last={last:?}; fixture kept at {root:?}");
        }
    };
    assert_eq!(final_job.state, "ready");
    assert_eq!(final_job.report.unwrap().positions, 1);
}

#[tokio::test]
async fn review_tokens_are_owned_single_use_and_newer_review_wins() {
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let server = Server::new("good");
    let review = reviewed(&root, &server).await;
    let mut slot = ReviewSlot::default();
    let old = slot.begin();
    let newest = slot.begin();
    assert!(slot.finish(old, review.clone()).is_err());
    let view = slot.finish(newest, review.clone()).unwrap();
    assert!(slot.take("stale-token", &review.root).is_err());
    assert_eq!(
        slot.take(&view.token, &review.root).unwrap().view.token,
        view.token
    );
    assert!(slot.take(&view.token, &review.root).is_err());
    let next = slot.begin();
    let mut expired = review.clone();
    expired.at = Instant::now() - REVIEW_TTL;
    slot.finish(next, expired).unwrap();
    assert!(slot.take(&view.token, &review.root).is_err());
    let next = slot.begin();
    slot.finish(next, review.clone()).unwrap();
    assert!(slot
        .take(&view.token, &root.join("another-profile"))
        .is_err());
    assert_eq!(server.requests().len(), 1);
}

#[test]
fn destination_and_space_checks_are_read_only_and_keep_invalid_existing_paths() {
    let temp = fixture();
    let root = temp.path().canonicalize().unwrap();
    let path = root.join("missing/new");
    assert!(space(&path, u64::MAX).is_err());
    assert!(!root.join("missing").exists());
    assert!(destination(&root).is_err());
    assert!(destination(Path::new("relative")).is_err());
    // PathBuf::join normalizes '..' in a Windows verbatim root before our API.
    // Construct the actual raw user input to exercise rejection instead.
    let mut unnormalized = root.clone().into_os_string();
    unnormalized.push(format!(
        "{}..{}new",
        std::path::MAIN_SEPARATOR,
        std::path::MAIN_SEPARATOR
    ));
    assert!(destination(Path::new(&unnormalized)).is_err());
    fs::write(root.join("owner-file"), b"keep").unwrap();
    assert!(destination(&root.join("owner-file/child")).is_err());
    assert_eq!(fs::read(root.join("owner-file")).unwrap(), b"keep");
}
