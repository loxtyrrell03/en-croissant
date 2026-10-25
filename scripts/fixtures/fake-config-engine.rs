//! Tiny deterministic native setup peer. No network, datasets or search.
use std::{
    io::{self, BufRead, Write},
    path::PathBuf,
    time::Duration,
};
fn main() {
    let path = PathBuf::from(std::env::args_os().next().unwrap());
    let mode = path.file_stem().unwrap().to_string_lossy();
    std::fs::write(path.with_extension("pid"), std::process::id().to_string()).unwrap();
    for line in io::stdin().lock().lines() {
        let line = line.unwrap();
        if line == "uci" {
            if mode.contains("silent") {
                loop {
                    std::thread::sleep(Duration::from_secs(1));
                }
            }
            if mode.contains("flood") {
                loop {
                    println!("info string still starting");
                    io::stdout().flush().unwrap();
                    std::thread::sleep(Duration::from_millis(1));
                }
            }
            println!("id name Config Fixture");
            if mode.contains("eof") {
                return;
            }
            println!("option name Threads type spin default 1 min 1 max 16");
            println!("option name Hash type spin default 16 min 1 max 1024");
            println!("option name MultiPV type spin default 1 min 1 max 8");
            println!("uciok");
            io::stdout().flush().unwrap();
        } else if line == "quit" && !mode.contains("ignore-quit") {
            break;
        }
    }
}
