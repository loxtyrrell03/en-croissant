mod error {
    pub type Error = Box<dyn std::error::Error + Send + Sync + 'static>;
}

#[allow(dead_code)]
#[path = "../db/encoding.rs"]
mod encoding;
#[allow(dead_code)]
#[path = "../db/search_index.rs"]
mod search_index;

use encoding::{decode_move, iter_mainline_move_bytes};
use rayon::prelude::*;
use search_index::{GameResult, MmapSearchIndex, PositionIndexKey, SearchGameEntryRef};
use serde::Serialize;
use shakmaty::{
    fen::Fen,
    san::SanPlus,
    uci::UciMove,
    zobrist::{Zobrist128, ZobristHash},
    Board, ByColor, CastlingMode, Chess, EnPassantMode, FromSetup, Position, PositionError,
};
use std::{collections::BTreeMap, env, io, path::PathBuf};

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct PositionMoveBucket {
    #[serde(rename = "move")]
    san: String,
    uci: Option<String>,
    white: u64,
    draw: u64,
    black: u64,
    last_played: Option<String>,
}

fn main() -> Result<(), error::Error> {
    let (index_path, fen) = parse_args()?;
    let requested = chess_from_fen(&fen)?;
    let index = MmapSearchIndex::open(index_path)?;
    let moves = if index.has_board_turn_position_index() {
        query_position_occurrences(&index, &requested)?
    } else {
        scan_position(&index, &requested)
    };

    let mut output = moves.into_values().collect::<Vec<_>>();
    output.sort_by(|a, b| {
        let a_total = a.white + a.draw + a.black;
        let b_total = b.white + b.draw + b.black;
        b_total.cmp(&a_total).then_with(|| a.san.cmp(&b.san))
    });
    println!("{}", serde_json::to_string(&output)?);
    Ok(())
}

fn query_position_occurrences(
    index: &MmapSearchIndex,
    requested: &Chess,
) -> Result<BTreeMap<String, PositionMoveBucket>, error::Error> {
    let exact_key = position_index_key(requested);
    let lookup_key = if index.has_exact_position_index() {
        exact_key
    } else {
        legacy_position_index_key(requested)
    };
    let mut moves: BTreeMap<String, PositionMoveBucket> = BTreeMap::new();
    let mut last_game_index = None;

    for occurrence in index.position_occurrences(lookup_key) {
        if last_game_index == Some(occurrence.game_index) {
            continue;
        }
        last_game_index = Some(occurrence.game_index);

        let Some(next_byte) = occurrence.next_move else {
            continue;
        };
        let Some(entry) = index.get_entry_ref(occurrence.game_index) else {
            continue;
        };
        let position = position_at_ply(&entry, occurrence.ply)?;
        if position_index_key(&position) != exact_key {
            continue;
        }
        let Some(next_move) = decode_move(next_byte, &position) else {
            continue;
        };

        let san = SanPlus::from_move(position, &next_move).to_string();
        let uci = UciMove::from_move(&next_move, CastlingMode::Standard).to_string();
        let bucket = moves
            .entry(san.clone())
            .or_insert_with(|| PositionMoveBucket {
                san,
                uci: Some(uci),
                ..PositionMoveBucket::default()
            });
        add_result(bucket, entry.result, entry.date);
    }

    Ok(moves)
}

fn scan_position(
    index: &MmapSearchIndex,
    requested: &Chess,
) -> BTreeMap<String, PositionMoveBucket> {
    let exact_key = position_index_key(requested);
    let requested_pawn_home = get_pawn_home(requested.board());
    let requested_material = get_material_count(requested.board());
    index
        .par_iter()
        .filter(|entry| entry_can_reach(entry, requested_pawn_home, &requested_material))
        .filter_map(|entry| {
            move_after_position(&entry, exact_key, requested_pawn_home, &requested_material)
        })
        .fold(BTreeMap::new, |mut moves, found| {
            add_found_move(&mut moves, found);
            moves
        })
        .reduce(BTreeMap::new, merge_move_maps)
}

fn move_after_position(
    entry: &SearchGameEntryRef<'_>,
    exact_key: PositionIndexKey,
    requested_pawn_home: u16,
    requested_material: &ByColor<u8>,
) -> Option<(String, String, GameResult, Option<String>)> {
    let mut position = starting_position(entry.fen).ok()?;
    for byte in iter_mainline_move_bytes(entry.moves) {
        let next_move = decode_move(byte, &position)?;
        if position_index_key(&position) == exact_key {
            let san = SanPlus::from_move(position, &next_move).to_string();
            let uci = UciMove::from_move(&next_move, CastlingMode::Standard).to_string();
            return Some((san, uci, entry.result, entry.date.map(ToOwned::to_owned)));
        }
        position.play_unchecked(&next_move);
        if (next_move.is_capture()
            || next_move.role() == shakmaty::Role::Pawn
            || next_move.is_promotion())
            && !position_can_reach(&position, requested_pawn_home, requested_material)
        {
            return None;
        }
    }
    None
}

fn entry_can_reach(
    entry: &SearchGameEntryRef<'_>,
    requested_pawn_home: u16,
    requested_material: &ByColor<u8>,
) -> bool {
    let has_metadata =
        entry.pawn_home != 0 || entry.white_material < 39 || entry.black_material < 39;
    if !has_metadata {
        return true;
    }
    entry.pawn_home & !requested_pawn_home == 0
        && entry.white_material <= requested_material.white
        && entry.black_material <= requested_material.black
}

fn position_can_reach(
    position: &Chess,
    requested_pawn_home: u16,
    requested_material: &ByColor<u8>,
) -> bool {
    let current_pawn_home = get_pawn_home(position.board());
    let current_material = get_material_count(position.board());
    requested_pawn_home & !current_pawn_home == 0
        && requested_material.white <= current_material.white
        && requested_material.black <= current_material.black
}

fn get_pawn_home(board: &Board) -> u16 {
    let white_pawns = board.pawns() & board.white();
    let black_pawns = board.pawns() & board.black();
    let second_rank_pawns = (white_pawns.0 >> 8) as u8;
    let seventh_rank_pawns = (black_pawns.0 >> 48) as u8;
    (second_rank_pawns as u16) | ((seventh_rank_pawns as u16) << 8)
}

fn get_material_count(board: &Board) -> ByColor<u8> {
    board.material().map(|material| {
        material.pawn
            + material.knight * 3
            + material.bishop * 3
            + material.rook * 5
            + material.queen * 9
    })
}

fn add_found_move(
    moves: &mut BTreeMap<String, PositionMoveBucket>,
    (san, uci, result, date): (String, String, GameResult, Option<String>),
) {
    let bucket = moves
        .entry(san.clone())
        .or_insert_with(|| PositionMoveBucket {
            san,
            uci: Some(uci),
            ..PositionMoveBucket::default()
        });
    add_result(bucket, result, date.as_deref());
}

fn merge_move_maps(
    mut left: BTreeMap<String, PositionMoveBucket>,
    right: BTreeMap<String, PositionMoveBucket>,
) -> BTreeMap<String, PositionMoveBucket> {
    for (san, incoming) in right {
        let bucket = left.entry(san).or_insert_with(|| PositionMoveBucket {
            san: incoming.san.clone(),
            uci: incoming.uci.clone(),
            ..PositionMoveBucket::default()
        });
        bucket.white += incoming.white;
        bucket.draw += incoming.draw;
        bucket.black += incoming.black;
        if incoming.last_played > bucket.last_played {
            bucket.last_played = incoming.last_played;
        }
    }
    left
}

fn parse_args() -> Result<(PathBuf, String), error::Error> {
    let mut index_path = None;
    let mut fen = None;
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--index" => index_path = args.next().map(PathBuf::from),
            "--fen" => fen = args.next(),
            "--help" | "-h" => {
                println!("Usage: query_db_position --index <database.ecsi> --fen <fen>");
                std::process::exit(0);
            }
            _ => return Err(invalid_input(format!("Unknown argument: {arg}"))),
        }
    }
    Ok((
        index_path.ok_or_else(|| invalid_input("--index is required"))?,
        fen.ok_or_else(|| invalid_input("--fen is required"))?,
    ))
}

fn chess_from_fen(value: &str) -> Result<Chess, error::Error> {
    let field_count = value.split_whitespace().count();
    let complete = if field_count >= 6 {
        value.to_string()
    } else {
        format!("{value} 0 1")
    };
    let fen = Fen::from_ascii(complete.as_bytes())?;
    let setup = fen.into_setup();
    let castling_mode = CastlingMode::detect(&setup);
    Ok(Chess::from_setup(setup, castling_mode).or_else(PositionError::ignore_too_much_material)?)
}

fn starting_position(fen: Option<&str>) -> Result<Chess, error::Error> {
    match fen.filter(|value| !value.trim().is_empty()) {
        Some(value) => chess_from_fen(value),
        None => Ok(Chess::default()),
    }
}

fn position_at_ply(entry: &SearchGameEntryRef<'_>, ply: u16) -> Result<Chess, error::Error> {
    let mut position = starting_position(entry.fen)?;
    for byte in iter_mainline_move_bytes(entry.moves).take(ply as usize) {
        let Some(next_move) = decode_move(byte, &position) else {
            break;
        };
        position.play_unchecked(&next_move);
    }
    Ok(position)
}

fn position_index_key(position: &Chess) -> PositionIndexKey {
    let key: Zobrist128 = position.zobrist_hash(EnPassantMode::Legal);
    PositionIndexKey {
        hi: (key.0 >> 64) as u64,
        lo: key.0 as u64,
    }
}

fn legacy_position_index_key(position: &Chess) -> PositionIndexKey {
    let fen = Fen::from_position(position.clone(), EnPassantMode::Legal).to_string();
    let mut parts = fen.split_whitespace();
    let board = parts.next().unwrap_or_default();
    let turn = parts.next().unwrap_or_default();
    PositionIndexKey::from_text(&format!("{board} {turn}"))
}

fn add_result(bucket: &mut PositionMoveBucket, result: GameResult, date: Option<&str>) {
    match result {
        GameResult::WhiteWin => bucket.white += 1,
        GameResult::BlackWin => bucket.black += 1,
        _ => bucket.draw += 1,
    }
    if let Some(date) = date.filter(|value| !value.trim().is_empty()) {
        if bucket
            .last_played
            .as_deref()
            .map_or(true, |current| date > current)
        {
            bucket.last_played = Some(date.to_string());
        }
    }
}

fn invalid_input(message: impl Into<String>) -> error::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.into()).into()
}
