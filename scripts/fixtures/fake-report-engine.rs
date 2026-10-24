//! Tiny deterministic UCI peer for the game-report protocol acceptance checks.
use std::{
    io::{self, BufRead, Write},
    thread,
    time::Duration,
};

fn main() {
    let hang_startup = std::env::current_exe()
        .unwrap()
        .file_name()
        .unwrap()
        .to_string_lossy()
        .contains("hang-report-startup");
    let mut mode = String::from("latest");
    let mut depth = 8u32;
    let mut budget = 50u32;
    let mut searches = 0;
    for input in io::stdin().lock().lines() {
        let input = input.unwrap();
        if input == "uci" {
            if !hang_startup {
                println!("id name En Croissant protocol fixture\nuciok");
            }
        } else if input == "isready" {
            println!("readyok");
        } else if let Some(value) = input.strip_prefix("setoption name ReportTestMode value ") {
            mode = value.into();
        } else if let Some(value) = input.strip_prefix("setoption name ReportTestDepth value ") {
            depth = value.parse().unwrap();
        } else if let Some(value) = input.strip_prefix("setoption name ReportTestTime value ") {
            budget = value.parse().unwrap();
        } else if input.starts_with("go ") {
            searches += 1;
            if searches == 1 {
                assert_eq!(
                    input,
                    format!("go depth {depth} movetime {}", budget * 4 / 5)
                );
                match mode.as_str() {
                    "latest" => println!("info depth 8 score cp 100 pv d2d4\ninfo depth 6 score cp 23 pv e2e4\ninfo depth 5 score cp 17 pv e2e4\nbestmove e2e4"),
                    "castle" => println!("info depth 8 score cp 12 pv e1h1\nbestmove e1g1"),
                    "bounds" => println!("info depth 8 score cp 99 lowerbound pv e2e4\ninfo depth 8 pv e2e4\nbestmove e2e4"),
                    "spent" => { thread::sleep(Duration::from_millis(u64::from(budget) + 30)); println!("info depth 8 score cp 80 pv d2d4\nbestmove e2e4"); },
                    "hang" => {},
                    _ => println!("info depth 8 score cp 80 pv d2d4\nbestmove e2e4"),
                }
            } else {
                assert_eq!(searches, 2, "only one recovery is allowed");
                assert_ne!(mode, "spent", "recovery may not exceed the shared budget");
                let fields: Vec<_> = input.split_whitespace().collect();
                assert_eq!(fields[0..3], ["go", "depth", &depth.min(12).to_string()]);
                assert_eq!(fields[3], "movetime");
                let remaining: u32 = fields[4].parse().unwrap();
                assert!(remaining > 0 && remaining <= budget);
                assert_eq!(fields[5..], ["searchmoves", "e2e4"]);
                match mode.as_str() {
                    "bounds" => {
                        println!("info depth 7 score cp 99 upperbound pv e2e4\nbestmove e2e4")
                    }
                    "foreign" => println!("info depth 7 score cp 22 pv d2d4\nbestmove d2d4"),
                    _ => println!("info depth 7 score cp 22 pv e2e4\nbestmove e2e4"),
                }
            }
        } else if input == "quit" {
            break;
        }
        io::stdout().flush().unwrap();
    }
}
