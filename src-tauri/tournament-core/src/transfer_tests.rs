use super::*;
use std::{
    net::{TcpListener, TcpStream},
    sync::Arc,
    thread,
    time::Instant,
};

fn serve(handler: impl FnOnce(TcpListener) + Send + 'static) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/archive.zst", listener.local_addr().unwrap());
    (url, thread::spawn(move || handler(listener)))
}

fn request(listener: &TcpListener) -> (TcpStream, String) {
    let (mut stream, _) = listener.accept().unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let mut bytes = Vec::new();
    while !bytes.ends_with(b"\r\n\r\n") {
        let mut byte = [0];
        stream.read_exact(&mut byte).unwrap();
        bytes.push(byte[0]);
    }
    (stream, String::from_utf8(bytes).unwrap())
}

fn hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
fn normal_client() -> Client {
    client(Duration::from_secs(2)).unwrap()
}

#[test]
fn changed_reviewed_size_preserves_partial_before_writing_response() {
    for resume in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("archive.zst");
        let partial = target.with_extension("zst.part");
        fs::write(&partial, b"abc").unwrap();
        let (url, server) = serve(move |listener| {
            let (mut stream, _) = request(&listener);
            let response = if resume {
                "HTTP/1.1 206 Partial Content\r\nContent-Length: 3\r\nContent-Range: bytes 3-5/6\r\nConnection: close\r\n\r\ndef"
            } else {
                "HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabcdef"
            };
            stream.write_all(response.as_bytes()).unwrap();
        });
        assert!(download_with_size(
            &normal_client(),
            &url,
            &hash(b"abcdef"),
            &target,
            Some(5),
            &AtomicBool::new(false),
            |_, _| {}
        )
        .unwrap_err()
        .contains("archive size changed"));
        server.join().unwrap();
        assert_eq!(fs::read(&partial).unwrap(), b"abc");
        assert!(!target.exists());
    }
}

#[test]
fn resumed_download_validates_range_and_publishes_exact_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("archive.zst");
    fs::write(target.with_extension("zst.part"), b"abc").unwrap();
    let (url, server) = serve(|listener| {
        let (mut stream, headers) = request(&listener);
        assert!(headers.to_lowercase().contains("range: bytes=3-"));
        stream.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 3\r\nContent-Range: bytes 3-5/6\r\nConnection: close\r\n\r\ndef").unwrap();
    });
    download(
        &normal_client(),
        &url,
        &hash(b"abcdef"),
        &target,
        &AtomicBool::new(false),
        |_, _| {},
    )
    .unwrap();
    server.join().unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"abcdef");
    assert!(!target.with_extension("zst.part").exists());
}

#[test]
fn mismatched_resume_range_preserves_existing_partial() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("archive.zst");
    let partial = target.with_extension("zst.part");
    fs::write(&partial, b"abc").unwrap();
    let (url, server) = serve(|listener| {
        let (mut stream, _) = request(&listener);
        stream.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 3\r\nContent-Range: bytes 0-2/3\r\nConnection: close\r\n\r\ndef").unwrap();
    });
    assert!(download(
        &normal_client(),
        &url,
        &hash(b"abcdef"),
        &target,
        &AtomicBool::new(false),
        |_, _| {}
    )
    .unwrap_err()
    .contains("requested byte range"));
    server.join().unwrap();
    assert_eq!(fs::read(&partial).unwrap(), b"abc");
    assert!(!target.exists());
}

#[test]
fn ignored_range_uses_the_existing_full_response_without_second_request() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("archive.zst");
    fs::write(target.with_extension("zst.part"), b"bad-prefix").unwrap();
    let (url, server) = serve(|listener| {
        let (mut stream, _) = request(&listener);
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabcdef")
            .unwrap();
        // Dropping the listener makes an accidental second request fail.
    });
    download(
        &normal_client(),
        &url,
        &hash(b"abcdef"),
        &target,
        &AtomicBool::new(false),
        |_, _| {},
    )
    .unwrap();
    server.join().unwrap();
    assert_eq!(fs::read(target).unwrap(), b"abcdef");
}

#[test]
fn complete_partial_recovers_after_unsatisfiable_range() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("archive.zst");
    fs::write(target.with_extension("zst.part"), b"abcdef").unwrap();
    let (url, server) = serve(|listener| {
        let (mut stream, _) = request(&listener);
        stream.write_all(b"HTTP/1.1 416 Range Not Satisfiable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
    });
    download(
        &normal_client(),
        &url,
        &hash(b"abcdef"),
        &target,
        &AtomicBool::new(false),
        |_, _| {},
    )
    .unwrap();
    server.join().unwrap();
    assert_eq!(fs::read(target).unwrap(), b"abcdef");
}

#[test]
fn invalid_complete_partial_restarts_from_zero() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("archive.zst");
    fs::write(target.with_extension("zst.part"), b"broken-prefix").unwrap();
    let (url, server) = serve(|listener| {
        let (mut stream, _) = request(&listener);
        stream.write_all(b"HTTP/1.1 416 Range Not Satisfiable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        drop(stream);
        let (mut stream, headers) = request(&listener);
        assert!(!headers.to_lowercase().contains("range:"));
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabcdef")
            .unwrap();
    });
    download(
        &normal_client(),
        &url,
        &hash(b"abcdef"),
        &target,
        &AtomicBool::new(false),
        |_, _| {},
    )
    .unwrap();
    server.join().unwrap();
    assert_eq!(fs::read(target).unwrap(), b"abcdef");
}

#[test]
fn truncated_transfer_preserves_retry_bytes_and_never_publishes() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("archive.zst");
    let (url, server) = serve(|listener| {
        let (mut stream, _) = request(&listener);
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabc")
            .unwrap();
    });
    assert!(download(
        &normal_client(),
        &url,
        &hash(b"abcdef"),
        &target,
        &AtomicBool::new(false),
        |_, _| {}
    )
    .is_err());
    server.join().unwrap();
    assert!(!target.exists());
    assert_eq!(fs::read(target.with_extension("zst.part")).unwrap(), b"abc");
}

#[test]
fn checksum_failure_removes_nonresumable_corruption() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("archive.zst");
    let (url, server) = serve(|listener| {
        let (mut stream, _) = request(&listener);
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\ngarble")
            .unwrap();
    });
    assert!(download(
        &normal_client(),
        &url,
        &hash(b"abcdef"),
        &target,
        &AtomicBool::new(false),
        |_, _| {}
    )
    .unwrap_err()
    .contains("Checksum mismatch"));
    server.join().unwrap();
    assert!(!target.exists());
    assert!(!target.with_extension("zst.part").exists());
}

#[test]
fn cancellation_during_stalled_body_settles_within_the_read_bound() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("archive.zst");
    let cancel = Arc::new(AtomicBool::new(false));
    let server_cancel = cancel.clone();
    let (url, server) = serve(move |listener| {
        let (mut stream, _) = request(&listener);
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabc")
            .unwrap();
        thread::sleep(Duration::from_millis(30));
        server_cancel.store(true, Ordering::Relaxed);
        thread::sleep(Duration::from_millis(700));
    });
    let started = Instant::now();
    let result = download(
        &client(Duration::from_millis(150)).unwrap(),
        &url,
        &hash(b"abcdef"),
        &target,
        &cancel,
        |_, _| {},
    );
    assert!(result.unwrap_err().to_lowercase().contains("cancelled"));
    assert!(started.elapsed() < Duration::from_millis(650));
    server.join().unwrap();
    assert!(!target.exists());
}

#[test]
fn progressing_transfer_outlives_its_individual_read_deadline() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("archive.zst");
    let (url, server) = serve(|listener| {
        let (mut stream, _) = request(&listener);
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\n")
            .unwrap();
        for byte in b"0123456789" {
            stream.write_all(&[*byte]).unwrap();
            thread::sleep(Duration::from_millis(40));
        }
    });
    let started = Instant::now();
    download(
        &client(Duration::from_millis(200)).unwrap(),
        &url,
        &hash(b"0123456789"),
        &target,
        &AtomicBool::new(false),
        |_, _| {},
    )
    .unwrap();
    server.join().unwrap();
    assert!(started.elapsed() > Duration::from_millis(300));
    assert_eq!(fs::read(target).unwrap(), b"0123456789");
}

#[test]
fn cancellation_also_covers_metadata_and_cached_hashing() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("archive.zst");
    fs::write(&target, b"valid-data").unwrap();
    let cancelled = AtomicBool::new(true);
    assert!(download(
        &normal_client(),
        "http://127.0.0.1:1",
        &hash(b"valid-data"),
        &target,
        &cancelled,
        |_, _| {}
    )
    .unwrap_err()
    .contains("cancelled"));
    assert!(metadata(&normal_client(), "http://127.0.0.1:1", &cancelled)
        .unwrap_err()
        .contains("cancelled"));
    assert_eq!(fs::read(target).unwrap(), b"valid-data");
}

#[test]
fn metadata_rejects_unbounded_lists() {
    let (url, server) = serve(|listener| {
        let (mut stream, _) = request(&listener);
        let _ = stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4194305\r\nConnection: close\r\n\r\n");
        // The advertised size alone must reject the response, even if the
        // provider never sends a body. Do not waste bandwidth downloading it.
    });
    let error = metadata(&normal_client(), &url, &AtomicBool::new(false)).unwrap_err();
    assert!(
        error.contains("4 MiB"),
        "Unexpected metadata error: {error}"
    );
    server.join().unwrap();
}

#[test]
fn metadata_accepts_a_bounded_list_with_or_without_content_length() {
    for length in ["Content-Length: 5\r\n", ""] {
        let (url, server) = serve(move |listener| {
            let (mut stream, _) = request(&listener);
            write!(
                stream,
                "HTTP/1.1 200 OK\r\n{length}Connection: close\r\n\r\nhello"
            )
            .unwrap();
        });
        assert_eq!(
            metadata(&normal_client(), &url, &AtomicBool::new(false)).unwrap(),
            "hello"
        );
        server.join().unwrap();
    }
}

#[test]
fn failed_resume_request_keeps_existing_partial_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("archive.zst");
    let partial = target.with_extension("zst.part");
    fs::write(&partial, b"abc").unwrap();
    let (url, server) = serve(|listener| {
        let (mut stream, _) = request(&listener);
        stream.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
    });
    assert!(download(
        &normal_client(),
        &url,
        &hash(b"abcdef"),
        &target,
        &AtomicBool::new(false),
        |_, _| {}
    )
    .unwrap_err()
    .contains("503"));
    server.join().unwrap();
    assert_eq!(fs::read(partial).unwrap(), b"abc");
    assert!(!target.exists());
}

#[test]
fn cancellation_while_waiting_for_headers_is_bounded() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("archive.zst");
    let cancel = Arc::new(AtomicBool::new(false));
    let server_cancel = cancel.clone();
    let (url, server) = serve(move |listener| {
        let (_stream, _) = request(&listener);
        thread::sleep(Duration::from_millis(30));
        server_cancel.store(true, Ordering::Relaxed);
        thread::sleep(Duration::from_millis(700));
    });
    let started = Instant::now();
    let result = download(
        &client(Duration::from_millis(150)).unwrap(),
        &url,
        &hash(b"abcdef"),
        &target,
        &cancel,
        |_, _| {},
    );
    assert!(result.unwrap_err().to_lowercase().contains("cancelled"));
    assert!(started.elapsed() < Duration::from_millis(650));
    server.join().unwrap();
    assert!(!target.exists());
    assert!(!target.with_extension("zst.part").exists());
}
