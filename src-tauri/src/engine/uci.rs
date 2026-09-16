use shakmaty::{fen::Fen, uci::UciMove, CastlingMode, Chess, Position};

use crate::error::Error;

pub fn parse_fen_to_position(fen: &str) -> Result<Chess, Error> {
    let fen: Fen = fen.parse()?;
    let setup = fen.as_setup().clone();
    let castling_mode = CastlingMode::detect(&setup);
    match setup.position(castling_mode) {
        Ok(p) => Ok(p),
        Err(e) => Ok(e.ignore_too_much_material()?),
    }
}

pub fn apply_uci_moves(pos: &mut Chess, moves: &[String]) -> Result<(), Error> {
    for m in moves {
        let uci = UciMove::from_ascii(m.as_bytes())?;
        let mv = uci.to_move(pos)?;
        pos.play_unchecked(&mv);
    }
    Ok(())
}

pub fn parse_fen_and_apply_moves(fen: &str, moves: &[String]) -> Result<Chess, Error> {
    let mut pos = parse_fen_to_position(fen)?;
    apply_uci_moves(&mut pos, moves)?;
    Ok(pos)
}

pub fn normalize_uci_moves_for_fen(fen: &str, moves: &[String]) -> Result<Vec<String>, Error> {
    let fen: Fen = fen.parse()?;
    let setup = fen.as_setup().clone();
    let castling_mode = CastlingMode::detect(&setup);
    let mut pos = match setup.position(castling_mode) {
        Ok(p) => p,
        Err(e) => e.ignore_too_much_material()?,
    };

    let mut normalized_moves = Vec::with_capacity(moves.len());

    for m in moves {
        let uci = UciMove::from_ascii(m.as_bytes())?;
        let mv = uci.to_move(&pos)?;
        normalized_moves.push(UciMove::from_move(&mv, castling_mode).to_string());
        pos.play_unchecked(&mv);
    }

    Ok(normalized_moves)
}

/// Independent legal root choices, not a sequence of played moves. Reject an
/// empty/invalid list rather than letting an engine silently search everything.
pub fn normalize_uci_search_moves(
    fen: &str,
    moves: &[String],
    candidates: &[String],
) -> Result<Vec<String>, Error> {
    if candidates.is_empty() || candidates.len() > 8 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Expected 1 to 8 search moves",
        )
        .into());
    }
    let setup: Fen = fen.parse()?;
    let mode = CastlingMode::detect(setup.as_setup());
    let pos = parse_fen_and_apply_moves(fen, moves)?;
    let mut roots = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        let mv = UciMove::from_ascii(candidate.as_bytes())?.to_move(&pos)?;
        let normalized = UciMove::from_move(&mv, mode).to_string();
        if roots.contains(&normalized) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Duplicate search move",
            )
            .into());
        }
        roots.push(normalized);
    }
    Ok(roots)
}

#[cfg(test)]
mod tactical_search_move_tests {
    use super::*;
    fn strings(moves: &[&str]) -> Vec<String> {
        moves.iter().map(|m| (*m).to_owned()).collect()
    }
    const INITIAL: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    #[test]
    fn search_moves_are_independent_legal_roots() {
        assert_eq!(
            normalize_uci_search_moves(INITIAL, &[], &strings(&["e2e4", "d2d4"])).unwrap(),
            strings(&["e2e4", "d2d4"])
        );
        assert_eq!(
            normalize_uci_search_moves(INITIAL, &strings(&["e2e4"]), &strings(&["e7e5", "c7c5"]))
                .unwrap(),
            strings(&["e7e5", "c7c5"])
        );
    }
    #[test]
    fn search_moves_fail_closed_on_invalid_or_duplicate_lists() {
        for moves in [
            vec![],
            strings(&["e2e4", "e2e4"]),
            strings(&["e2e5"]),
            strings(&["e7e5"]),
            strings(&["e2e4\nquit"]),
            vec!["e2e4".to_owned(); 9],
        ] {
            assert!(normalize_uci_search_moves(INITIAL, &[], &moves).is_err());
        }
    }
    #[test]
    fn search_moves_normalize_castling_and_keep_promotions() {
        let castle = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
        assert_eq!(
            normalize_uci_search_moves(castle, &[], &strings(&["e1h1", "e1a1"])).unwrap(),
            strings(&["e1g1", "e1c1"])
        );
        assert!(normalize_uci_search_moves(castle, &[], &strings(&["e1h1", "e1g1"])).is_err());
        let promote = "7k/P7/8/8/8/8/8/7K w - - 0 1";
        assert_eq!(
            normalize_uci_search_moves(promote, &[], &strings(&["a7a8q", "a7a8n"])).unwrap(),
            strings(&["a7a8q", "a7a8n"])
        );
    }
}
