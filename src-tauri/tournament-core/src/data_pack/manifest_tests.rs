use super::*;
use std::{net::TcpListener, thread};

fn serve(headers: String, body: Vec<u8>, digest: String) -> (Source, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let source = Source {
        id: "fixture-otb".into(),
        kind: Kind::Otb,
        manifest_sha256: digest,
        base_url: format!("http://{}", listener.local_addr().unwrap()),
    };
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut request = Vec::new();
        while !request.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            stream.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        assert!(request.starts_with(b"GET /manifest.json HTTP/1.1\r\n"));
        write!(
            stream,
            "HTTP/1.1 200 OK\r\n{headers}Connection: close\r\n\r\n"
        )
        .unwrap();
        let _ = stream.write_all(&body);
    });
    (source, server)
}

fn manifest() -> Vec<u8> {
    let digest = hash(b"x");
    serde_json::to_vec(&serde_json::json!({
        "format":"novelty-data-pack", "version":1, "id":"fixture-otb", "kind":"otb",
        "license":"CC-BY-SA-4.0", "attribution":OTB_ATTRIBUTION, "coverage":{},
        "unpackedBytes":1, "downloadBytes":1,
        "files":[{"path":"otb-archive-index-v2.sqlite3", "bytes":1, "sha256":digest}],
        "parts":[{"name":"fixture-otb-0000.part", "encoding":"identity", "bytes":1,
            "sha256":digest, "decodedBytes":1, "decodedSha256":digest,
            "segments":[{"file":0,"offset":0,"length":1}]}]
    }))
    .unwrap()
}

#[test]
fn active_manifest_reader_rejects_an_oversized_header_without_a_body() {
    let (source, server) = serve(
        format!("Content-Length: {}\r\n", MANIFEST_BYTES + 1),
        Vec::new(),
        "0".repeat(64),
    );
    let result = fetch_manifest(&source, &AtomicBool::new(false));
    server.join().unwrap();
    assert_eq!(result.unwrap_err(), "Data pack manifest is too large.");
}

#[test]
fn active_manifest_reader_accepts_pinned_bounded_bodies_with_or_without_a_length() {
    let bytes = manifest();
    for headers in [
        format!("Content-Length: {}\r\n", bytes.len()),
        String::new(),
    ] {
        let (source, server) = serve(headers, bytes.clone(), hash(&bytes));
        let result = fetch_manifest(&source, &AtomicBool::new(false));
        server.join().unwrap();
        assert_eq!(result.unwrap(), bytes);
    }
}

#[test]
fn active_manifest_reader_retains_the_stream_limit_without_a_length() {
    let (source, server) = serve(
        String::new(),
        vec![b'x'; MANIFEST_BYTES as usize + 1],
        "0".repeat(64),
    );
    let result = fetch_manifest(&source, &AtomicBool::new(false));
    server.join().unwrap();
    assert_eq!(result.unwrap_err(), "Data pack manifest is too large.");
}
