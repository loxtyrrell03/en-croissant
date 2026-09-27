//! Long-lived JSON-lines broker. Its host controls root/cache and owns shutdown.
use encroissant_tournament_core::Service;
use serde_json::{json, Value};
use std::{
    io::{self, BufRead, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 3 {
        return Err("usage: encroissant-tournament-core <state-root> <otb-cache>".into());
    }
    let service = Service::open(PathBuf::from(&args[1]), PathBuf::from(&args[2]))
        .map_err(io::Error::other)?;
    let output = Arc::new(Mutex::new(io::stdout()));
    for line in io::stdin().lock().lines() {
        let line = line?;
        if line.len() > 34 * 1024 * 1024 {
            return Err("Tournament request exceeds the input limit".into());
        }
        let message: Value = serde_json::from_str(&line)?;
        let id = message.get("id").cloned().ok_or("Request ID is missing")?;
        let service = service.clone();
        let output = output.clone();
        tokio::spawn(async move {
            let reply = match service.request(message).await {
                Ok(value) => json!({"id":id,"result":value}),
                Err(error) => json!({"id":id,"error":error}),
            };
            if let Ok(mut writer) = output.lock() {
                let _ = writeln!(writer, "{reply}");
                let _ = writer.flush();
            }
        });
    }
    Ok(())
}
