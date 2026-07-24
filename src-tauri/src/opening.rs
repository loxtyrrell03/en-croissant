use std::num::NonZeroU32;

use log::info;
use serde::{Deserialize, Serialize};
use shakmaty::{fen::Fen, san::San, Chess, EnPassantMode, Position, Setup};

use lazy_static::lazy_static;
use specta::Type;
use strsim::{jaro_winkler, sorensen_dice};

use crate::error::Error;

#[derive(Debug, Clone)]
struct Opening {
    _eco: String,
    name: String,
    setup: Setup,
    // Position identity used for matching. Openings are defined by the
    // position, not by the move-counter history, so a transposition whose
    // capture/pawn clocks differ from the reference line must still match.
    comparable: Setup,
    pgn: Option<String>,
}

fn comparable_setup(mut setup: Setup) -> Setup {
    setup.halfmoves = 0;
    setup.fullmoves = NonZeroU32::MIN;
    setup
}

#[derive(Debug, Clone, Type, Serialize)]
pub struct OutOpening {
    name: String,
    fen: String,
}

#[derive(Deserialize)]
struct OpeningRecord {
    eco: String,
    name: String,
    pgn: String,
}

const TSV_DATA: [&[u8]; 5] = [
    include_bytes!("../data/a.tsv"),
    include_bytes!("../data/b.tsv"),
    include_bytes!("../data/c.tsv"),
    include_bytes!("../data/d.tsv"),
    include_bytes!("../data/e.tsv"),
];

const FISCHER_RANDOM_DATA: &[u8] = include_bytes!("../data/frc.tsv");

#[derive(Deserialize)]
struct FischerRandomRecord {
    name: String,
    fen: String,
}

#[tauri::command]
#[specta::specta]
pub fn get_opening_from_fen(fen: &str) -> Result<String, Error> {
    let fen: Fen = fen.parse()?;
    get_opening_from_setup(fen.into_setup())
}

#[tauri::command]
#[specta::specta]
pub fn get_opening_from_name(name: &str) -> Result<String, Error> {
    OPENINGS
        .iter()
        .find(|o| o.name == name)
        .map(|o| o.pgn.clone().expect("opening without pgn"))
        .ok_or_else(|| Error::NoOpeningFound)
}

#[tauri::command]
#[specta::specta]
pub fn get_opening_from_fens(fens: Vec<String>) -> Result<String, Error> {
    for fen in fens.into_iter().rev() {
        if let Ok(opening) = get_opening_from_fen(&fen) {
            return Ok(opening);
        }
    }
    Err(Error::NoOpeningFound)
}

pub fn get_opening_from_setup(setup: Setup) -> Result<String, Error> {
    let query = comparable_setup(setup);
    OPENINGS
        .iter()
        .find(|o| o.comparable == query)
        .map(|o| o.name.clone())
        .ok_or_else(|| Error::NoOpeningFound)
}

// Non-panicking lookup for internal callers: pseudo entries such as the
// starting position and Fischer-random setups have no movetext.
pub fn get_opening_movetext(name: &str) -> Option<String> {
    OPENINGS
        .iter()
        .find(|o| o.name == name)
        .and_then(|o| o.pgn.clone())
}

#[tauri::command]
#[specta::specta]
pub async fn search_opening_name(query: String) -> Result<Vec<OutOpening>, Error> {
    let lower_query = query.to_lowercase();
    let scores = OPENINGS
        .iter()
        .map(|opening| {
            let lower_name = opening.name.to_lowercase();
            let sorenson_score = sorensen_dice(&lower_query, &lower_name);
            let jaro_score = jaro_winkler(&lower_query, &lower_name);
            let score = sorenson_score.max(jaro_score);
            (opening.clone(), score)
        })
        .collect::<Vec<_>>();
    let mut best_matches = scores
        .into_iter()
        .filter(|(_, score)| *score > 0.8)
        .collect::<Vec<_>>();

    best_matches.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

    let best_matches_names = best_matches
        .iter()
        .map(|(o, _)| o.clone())
        .take(15)
        .map(|o| OutOpening {
            name: o.name,
            fen: Fen::from_setup(o.setup.clone()).to_string(),
        })
        .collect();
    Ok(best_matches_names)
}

lazy_static! {
    static ref OPENINGS: Vec<Opening> = {
        info!("Initializing openings table...");

        let mut positions = vec![
            Opening {
                _eco: "Extra".to_string(),
                name: "Starting Position".to_string(),
                setup: Setup::default(),
                comparable: comparable_setup(Setup::default()),
                pgn: None,
            },
            Opening {
                _eco: "Extra".to_string(),
                name: "Empty Board".to_string(),
                setup: Setup::empty(),
                comparable: comparable_setup(Setup::empty()),
                pgn: None,
            },
        ];

        for tsv in TSV_DATA {
            let mut rdr = csv::ReaderBuilder::new().delimiter(b'\t').from_reader(tsv);
            for result in rdr.deserialize() {
                let record: OpeningRecord = result.expect("Failed to deserialize opening");
                let mut pos = Chess::default();
                for token in record.pgn.split_whitespace() {
                    if let Ok(san) = token.parse::<San>() {
                        pos.play_unchecked(&san.to_move(&pos).expect("legal move"));
                    }
                }
                let setup = pos.into_setup(EnPassantMode::Legal);
                positions.push(Opening {
                    _eco: record.eco,
                    name: record.name,
                    comparable: comparable_setup(setup.clone()),
                    setup,
                    pgn: Some(record.pgn),
                });
            }
        }
        let mut rdr = csv::ReaderBuilder::new()
            .delimiter(b'\t')
            .from_reader(FISCHER_RANDOM_DATA);
        for result in rdr.deserialize() {
            let record: FischerRandomRecord = result.expect("Failed to deserialize opening");
            let fen: Fen = record.fen.parse().expect("Failed to parse fen");
            let setup = fen.into_setup();
            positions.push(Opening {
                _eco: "FRC".to_string(),
                name: record.name,
                comparable: comparable_setup(setup.clone()),
                setup,
                pgn: None,
            });
        }
        positions
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_opening() {
        let opening =
            get_opening_from_fen("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPPKPPP/RNBQ1BNR b kq - 1 2")
                .unwrap();
        assert_eq!(opening, "Bongcloud Attack");
    }

    #[test]
    fn transposed_position_with_different_move_clocks_still_matches() {
        // 1. Nf3 d5 2. d4 reaches the Zukertort Queen's Pawn position with a
        // halfmove clock of 0, while the reference line 1. d4 d5 2. Nf3 ends
        // with a halfmove clock of 1. Opening identity is positional, so the
        // transposition must still be named.
        let opening =
            get_opening_from_fen("rnbqkbnr/ppp1pppp/8/3p4/3P4/5N2/PPP1PPPP/RNBQKB1R b KQkq - 0 2")
                .unwrap();
        assert_eq!(opening, "Queen's Pawn Game: Zukertort Variation");
    }

    #[test]
    fn movetext_lookup_is_none_for_pseudo_entries() {
        assert_eq!(get_opening_movetext("Starting Position"), None);
        assert!(get_opening_movetext("Queen's Pawn Game: Zukertort Variation").is_some());
    }
}
