//! Fetch snapshots online, or assemble explicitly supplied decoded pages offline.
//! Offline mode creates no runtime/client and never falls back to a URL fetch.
use encroissant_tournament_core::tournament::{assemble_tournament_snapshot_from_pages, fetch_tournament_snapshot, TournamentOfflinePages};
use std::{env, fs, io::{Read, Write}, path::{Path, PathBuf}, process::exit};
const MAX_OFFLINE_INPUT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_OFFLINE_OUTPUT_BYTES: usize = 256 * 1024 * 1024;
#[derive(Debug, PartialEq)]
struct Arguments { output: Option<PathBuf>, offline: Option<PathBuf>, urls: Vec<String> }
fn arguments(args: impl IntoIterator<Item=String>) -> Result<Arguments,String> {
    let mut args=args.into_iter();let mut parsed=Arguments {output:None,offline:None,urls:Vec::new()};
    while let Some(arg)=args.next() {
        match arg.as_str() {
            "--output" => {if parsed.output.is_some() {return Err("Duplicate --output".into());} parsed.output=Some(args.next().ok_or("Missing output path")?.into());},
            "--offline-pages" => {if parsed.offline.is_some() {return Err("Duplicate --offline-pages".into());} parsed.offline=Some(args.next().ok_or("Missing retained input path")?.into());},
            _ if arg.starts_with('-') => return Err(format!("Unknown option: {arg}")),
            _ => parsed.urls.push(arg),
        }
    }
    if parsed.offline.is_some() && !parsed.urls.is_empty() {return Err("Offline pages and network URLs are mutually exclusive".into());}
    if parsed.offline.is_none() && parsed.urls.is_empty() {return Err("Supply offline pages or tournament URLs".into());}
    Ok(parsed)
}
fn offline_envelope(bytes: &[u8]) -> (serde_json::Value,bool) {
    let result=serde_json::from_slice::<TournamentOfflinePages>(bytes).map_err(|error|error.to_string())
        .and_then(|pages|assemble_tournament_snapshot_from_pages(&pages));
    match result {
        Ok(assembly) => (serde_json::json!({"schema":1,"kind":"tournament-offline-assembly","status":"complete","assembly":assembly}),true),
        Err(error) => (offline_failure(error),false),
    }
}
fn offline_failure(error: String) -> serde_json::Value {
    serde_json::json!({"schema":1,"kind":"tournament-offline-assembly","status":"failed","error":error,
        "networkRequests":0,"transportVerified":false,"decoderVerified":false,"returnedBodyTournamentIdentityVerified":false})
}
fn read_offline_input(path: &Path) -> Result<Vec<u8>,String> {
    let file=fs::File::open(path).map_err(|error|format!("Cannot read retained input: {error}"))?;
    let mut bytes=Vec::new();file.take(MAX_OFFLINE_INPUT_BYTES+1).read_to_end(&mut bytes).map_err(|error|error.to_string())?;
    if bytes.len() as u64 > MAX_OFFLINE_INPUT_BYTES {return Err("Retained input exceeds the 256 MiB bound".into());}
    Ok(bytes)
}
fn encode_offline_output(value: &serde_json::Value, limit: usize) -> Result<Vec<u8>,String> {
    struct Bounded { bytes:Vec<u8>, limit:usize }
    impl Write for Bounded {
        fn write(&mut self, bytes:&[u8]) -> std::io::Result<usize> {
            if bytes.len()>self.limit.saturating_sub(self.bytes.len()) {return Err(std::io::Error::new(std::io::ErrorKind::Other,"Offline output size bound exceeded"));}
            self.bytes.extend_from_slice(bytes);Ok(bytes.len())
        }
        fn flush(&mut self)->std::io::Result<()> {Ok(())}
    }
    let mut output=Bounded {bytes:Vec::new(),limit};
    serde_json::to_writer_pretty(&mut output,value).map_err(|error|error.to_string())?;
    output.write_all(b"\n").map_err(|error|error.to_string())?;Ok(output.bytes)
}
fn write_offline_output(path: Option<&Path>, value: &serde_json::Value) -> Result<bool,String> {
    let (bytes,original)=match encode_offline_output(value,MAX_OFFLINE_OUTPUT_BYTES) {
        Ok(bytes)=>(bytes,true),
        Err(_)=>(encode_offline_output(&offline_failure("Retained output exceeds the 256 MiB bound or could not be serialized".into()),MAX_OFFLINE_OUTPUT_BYTES)?,false),
    };
    if let Some(path)=path {
        // A partial publication is retained on failure; never retry over it.
        let mut file=fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|error|error.to_string())?;
        file.write_all(&bytes).and_then(|_|file.sync_all()).map(|_|original).map_err(|error|error.to_string())
    } else {std::io::stdout().lock().write_all(&bytes).map(|_|original).map_err(|error|error.to_string())}
}
fn main() {
    let parsed=arguments(env::args().skip(1)).unwrap_or_else(|error| {
        eprintln!("{error}\nusage: tournament_snapshot_cli [--output PATH] URL...\n       tournament_snapshot_cli --offline-pages INPUT [--output NEW_OUTPUT]");exit(2);
    });
    // This branch returns before constructing the online runtime or client.
    if let Some(path)=parsed.offline.as_deref() {
        let (value,ok)=match read_offline_input(path) {Ok(bytes)=>offline_envelope(&bytes),Err(error)=>(offline_failure(error),false)};
        let original=write_offline_output(parsed.output.as_deref(),&value).unwrap_or_else(|error|{eprintln!("Offline output failed: {error}");exit(1)});
        if !ok || !original {exit(1);}return;
    }
    let runtime=tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap_or_else(|error|{eprintln!("Runtime failed: {error}");exit(1)});
    let mut snapshots=Vec::with_capacity(parsed.urls.len());
    for url in parsed.urls {
        eprintln!("fetching {url}");
        match runtime.block_on(fetch_tournament_snapshot(url)) {Ok(snapshot)=>snapshots.push(snapshot),Err(error)=>{eprintln!("Tournament fetch failed: {error}");exit(1)}}
    }
    let json=serde_json::to_string_pretty(&snapshots).unwrap_or_else(|error|{eprintln!("Snapshot serialization failed: {error}");exit(1)});
    if let Some(path)=parsed.output {fs::write(&path,format!("{json}\n")).unwrap_or_else(|error|{eprintln!("Output failed: {error}");exit(1)});} else {println!("{json}");}
}
#[cfg(test)]
mod cli_tests {
    use super::*;
    #[test]
    fn offline_arguments_cannot_fall_through_to_network() {
        let parse=|args:&[&str]|arguments(args.iter().map(|arg|arg.to_string()));
        assert!(parse(&["--offline-pages","x.json"]).unwrap().urls.is_empty());
        for bad in [vec!["--offline-pages","x.json","https://chess-results.com/tnr42.aspx"],vec!["--offline-pages"],vec!["--offline-pages","x","--offline-pages","y"],vec!["--offline-pages","x","--output","y","--output","z"]] {assert!(parse(&bad).is_err());}
    }
    #[test]
    fn offline_failure_is_structured_and_has_no_consumption_or_proof_claim() {
        let (value,ok)=offline_envelope(b"not JSON");assert!(!ok);assert_eq!(value["status"],"failed");assert_eq!(value["networkRequests"],0);
        for key in ["transportVerified","decoderVerified","returnedBodyTournamentIdentityVerified"] {assert_eq!(value[key],false);}
        assert!(value.get("consumedPageIds").is_none());assert!(value.get("assembly").is_none());
    }
    #[test]
    fn offline_output_is_exclusive_and_keeps_existing_bytes() {
        let path=env::temp_dir().join(format!("pairing-offline-cli-{}-{}.json",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let value=offline_failure("invented".into());write_offline_output(Some(&path),&value).unwrap();let before=fs::read(&path).unwrap();
        assert!(write_offline_output(Some(&path),&serde_json::json!({"replace":true})).is_err());assert_eq!(before,fs::read(&path).unwrap());fs::remove_file(path).unwrap();
    }
    #[test]
    fn offline_output_bound_includes_pretty_json_and_final_newline() {
        let value=serde_json::json!({"data":"invented"});let bytes=encode_offline_output(&value,100).unwrap();
        assert_eq!(bytes.last(),Some(&b'\n'));assert!(encode_offline_output(&value,bytes.len()-1).is_err());
        assert_eq!(encode_offline_output(&value,bytes.len()).unwrap(),bytes);
        assert!(encode_offline_output(&value,0).is_err());
    }

}
