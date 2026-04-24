use dashmap::DashMap;
use diesel::prelude::*;
use log::info;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use shakmaty::{
    fen::Fen, san::SanPlus, uci::UciMove, Bitboard, ByColor, CastlingMode, Chess, Color,
    EnPassantMode, FromSetup, Move, Position, PositionError, Role, Setup, Square,
};
use specta::Type;
use std::{
    cmp::Reverse,
    collections::{BinaryHeap, HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
use tauri::Emitter;

use crate::{
    db::{
        encoding::{decode_move, iter_mainline_move_bytes},
        get_db_or_create, get_material_count, get_pawn_home,
        models::*,
        normalize_games, position_index_key,
        schema::*,
        search_index::{
            get_index_path, GameResult, MmapSearchIndex, PositionIndexKey, SearchGameEntryRef,
        },
        ConnectionOptions, MaterialCount,
    },
    error::Error,
    AppState,
};

use super::GameQuery;

const DB_CACHE_LIMIT: usize = 4;

#[derive(Debug, Hash, PartialEq, Eq, Clone)]
pub struct ExactData {
    pawn_home: u16,
    material: MaterialCount,
    position: Chess,
}

#[derive(Debug, Hash, PartialEq, Eq, Clone)]
pub struct PartialData {
    // piece_counts: Vec<(Piece, u8)>,
    piece_positions: Setup,
    material: MaterialCount,
}

#[derive(Debug, Hash, PartialEq, Eq, Clone)]
pub enum PositionQuery {
    Exact(ExactData),
    Partial(PartialData),
}

impl PositionQuery {
    pub fn exact_from_fen(fen: &str) -> Result<PositionQuery, Error> {
        let fen = Fen::from_ascii(fen.as_bytes())?;
        let setup = fen.into_setup();
        let castling_mode = CastlingMode::detect(&setup);
        let position = Chess::from_setup(setup, castling_mode)
            .or_else(PositionError::ignore_too_much_material)?;
        let pawn_home = get_pawn_home(position.board());
        let material = get_material_count(position.board());
        Ok(PositionQuery::Exact(ExactData {
            pawn_home,
            material,
            position,
        }))
    }

    pub fn partial_from_fen(fen: &str) -> Result<PositionQuery, Error> {
        let fen = Fen::from_ascii(fen.as_bytes())?;
        let setup = fen.into_setup();
        let material = get_material_count(&setup.board);
        Ok(PositionQuery::Partial(PartialData {
            piece_positions: setup,
            material,
        }))
    }
}

#[derive(Debug, Clone, Deserialize, Type, PartialEq, Eq, Hash)]
pub struct PositionQueryJs {
    pub fen: String,
    pub type_: String,
}

fn convert_position_query(query: PositionQueryJs) -> Result<PositionQuery, Error> {
    match query.type_.as_str() {
        "exact" => PositionQuery::exact_from_fen(&query.fen),
        "partial" => PositionQuery::partial_from_fen(&query.fen),
        _ => unreachable!(),
    }
}

impl PositionQuery {
    fn matches(&self, position: &Chess) -> bool {
        match self {
            PositionQuery::Exact(ref data) => {
                data.position.turn() == position.turn() && data.position.board() == position.board()
            }
            PositionQuery::Partial(ref data) => {
                let query_board = &data.piece_positions.board;
                let tested_board = position.board();

                is_contained(tested_board.white(), query_board.white())
                    && is_contained(tested_board.black(), query_board.black())
                    && is_contained(tested_board.pawns(), query_board.pawns())
                    && is_contained(tested_board.knights(), query_board.knights())
                    && is_contained(tested_board.bishops(), query_board.bishops())
                    && is_contained(tested_board.rooks(), query_board.rooks())
                    && is_contained(tested_board.queens(), query_board.queens())
                    && is_contained(tested_board.kings(), query_board.kings())
            }
        }
    }

    fn is_reachable_by(&self, material: &MaterialCount, pawn_home: u16) -> bool {
        match self {
            PositionQuery::Exact(ref data) => {
                is_end_reachable(data.pawn_home, pawn_home)
                    && is_material_reachable(&data.material, material)
            }
            PositionQuery::Partial(ref data) => is_material_reachable(&data.material, material),
        }
    }

    fn can_reach(&self, material: &MaterialCount, pawn_home: u16) -> bool {
        match self {
            PositionQuery::Exact(ref data) => {
                is_end_reachable(pawn_home, data.pawn_home)
                    && is_material_reachable(material, &data.material)
            }
            PositionQuery::Partial(_) => true,
        }
    }
}

/// Returns true if the end pawn structure is reachable
fn is_end_reachable(end: u16, pos: u16) -> bool {
    end & !pos == 0
}

/// Returns true if the end material is reachable
fn is_material_reachable(end: &MaterialCount, pos: &MaterialCount) -> bool {
    end.white <= pos.white && end.black <= pos.black
}

/// Returns true if the subset is contained in the container
fn is_contained(container: Bitboard, subset: Bitboard) -> bool {
    container & subset == subset
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct PositionStats {
    #[serde(rename = "move")]
    pub move_: String,
    pub white: i32,
    pub draw: i32,
    pub black: i32,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RepertoireGapRequest {
    pub player_db: PathBuf,
    pub reference_db: PathBuf,
    pub player_id: i32,
    pub color: String,
    pub max_plies: i32,
    pub min_player_games: i32,
    pub min_reference_games: i32,
    pub top_reference_moves: i32,
    pub max_player_score: f64,
    pub min_reference_move_share: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct RepertoireGapReport {
    pub player_games: i32,
    pub candidate_positions: i32,
    pub reference_positions: i32,
    pub gaps: Vec<RepertoireGap>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct RepertoireGap {
    pub fen: String,
    pub ply: i32,
    pub side_to_move: String,
    pub player_move_san: String,
    pub player_move_uci: String,
    pub player_games: i32,
    pub player_white: i32,
    pub player_draw: i32,
    pub player_black: i32,
    pub player_score: f64,
    pub reference_games: i32,
    pub reference_move_rank: Option<i32>,
    pub reference_move_share: f64,
    pub severity: f64,
    pub sample_game_ids: Vec<i32>,
    pub top_reference_moves: Vec<RepertoireGapReferenceMove>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct RepertoireGapReferenceMove {
    pub san: String,
    pub uci: String,
    pub games: i32,
    pub white: i32,
    pub draw: i32,
    pub black: i32,
    pub share: f64,
    pub score_for_side: f64,
}

#[derive(Debug, Clone)]
struct PlayerMoveBucket {
    san: String,
    uci: String,
    games: i32,
    white: i32,
    draw: i32,
    black: i32,
    sample_game_ids: Vec<i32>,
}

impl PlayerMoveBucket {
    fn new(san: String, uci: String, result: GameResult, game_id: i32) -> Self {
        let (white, draw, black) = result_counts(result);
        Self {
            san,
            uci,
            games: 1,
            white,
            draw,
            black,
            sample_game_ids: vec![game_id],
        }
    }

    fn add_result(&mut self, result: GameResult, game_id: i32) {
        let (white, draw, black) = result_counts(result);
        self.games += 1;
        self.white += white;
        self.draw += draw;
        self.black += black;
        if self.sample_game_ids.len() < 12 && !self.sample_game_ids.contains(&game_id) {
            self.sample_game_ids.push(game_id);
        }
    }
}

#[derive(Debug, Clone)]
struct PlayerPositionBucket {
    fen: String,
    ply: i32,
    side_to_move: Color,
    moves: HashMap<String, PlayerMoveBucket>,
}

impl PlayerPositionBucket {
    fn add_move(&mut self, san: String, uci: String, result: GameResult, game_id: i32) {
        self.moves
            .entry(uci.clone())
            .and_modify(|bucket| bucket.add_result(result, game_id))
            .or_insert_with(|| PlayerMoveBucket::new(san, uci, result, game_id));
    }

    fn total_games(&self) -> i32 {
        self.moves.values().map(|bucket| bucket.games).sum()
    }
}

#[derive(Debug, Clone)]
struct ReferenceMoveBucket {
    san: String,
    uci: String,
    games: i32,
    white: i32,
    draw: i32,
    black: i32,
}

impl ReferenceMoveBucket {
    fn new(san: String, uci: String, result: GameResult) -> Self {
        let (white, draw, black) = result_counts(result);
        Self {
            san,
            uci,
            games: 1,
            white,
            draw,
            black,
        }
    }

    fn add_result(&mut self, result: GameResult) {
        let (white, draw, black) = result_counts(result);
        self.games += 1;
        self.white += white;
        self.draw += draw;
        self.black += black;
    }
}

#[derive(Debug, Clone, Default)]
struct ReferencePositionBucket {
    moves: HashMap<String, ReferenceMoveBucket>,
}

impl ReferencePositionBucket {
    fn add_move(&mut self, san: String, uci: String, result: GameResult) {
        self.moves
            .entry(uci.clone())
            .and_modify(|bucket| bucket.add_result(result))
            .or_insert_with(|| ReferenceMoveBucket::new(san, uci, result));
    }

    fn total_games(&self) -> i32 {
        self.moves.values().map(|bucket| bucket.games).sum()
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct PlanExplorerData {
    pub fen: String,
    pub total_games: i32,
    pub sampled_games: i32,
    pub max_plies: i32,
    pub pieces: Vec<PlanExplorerPiece>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct PlanExplorerPiece {
    pub color: String,
    pub role: String,
    pub from: String,
    pub total: i32,
    pub lines: Vec<PlanExplorerLine>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct PlanExplorerLine {
    pub squares: Vec<String>,
    pub san: Vec<String>,
    pub uci: Vec<String>,
    pub games: i32,
    pub white: i32,
    pub draw: i32,
    pub black: i32,
}

#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq)]
struct PieceKey {
    color: Color,
    role: Role,
    from: Square,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct PlanLineKey {
    piece: PieceKey,
    squares: Vec<Square>,
}

#[derive(Debug, Clone)]
struct ObservedPiecePath {
    piece: PieceKey,
    squares: Vec<Square>,
    san: Vec<String>,
    uci: Vec<String>,
}

#[derive(Debug, Clone)]
struct LineStats {
    san: Vec<String>,
    uci: Vec<String>,
    games: i32,
    white: i32,
    draw: i32,
    black: i32,
}

impl LineStats {
    fn new(path: &ObservedPiecePath, result: GameResult) -> Self {
        let (white, draw, black) = result_counts(result);
        Self {
            san: path.san.clone(),
            uci: path.uci.clone(),
            games: 1,
            white,
            draw,
            black,
        }
    }

    fn add_result(&mut self, result: GameResult) {
        let (white, draw, black) = result_counts(result);
        self.games += 1;
        self.white += white;
        self.draw += draw;
        self.black += black;
    }
}

fn result_counts(result: GameResult) -> (i32, i32, i32) {
    match result {
        GameResult::WhiteWin => (1, 0, 0),
        GameResult::BlackWin => (0, 0, 1),
        GameResult::Draw | GameResult::Other | GameResult::None => (0, 1, 0),
    }
}

fn role_name(role: Role) -> &'static str {
    match role {
        Role::Pawn => "pawn",
        Role::Knight => "knight",
        Role::Bishop => "bishop",
        Role::Rook => "rook",
        Role::Queen => "queen",
        Role::King => "king",
    }
}

fn color_name(color: Color) -> &'static str {
    match color {
        Color::White => "white",
        Color::Black => "black",
    }
}

fn open_mmap_search_index(
    file: &Path,
    state: &tauri::State<'_, AppState>,
) -> Result<MmapSearchIndex, Error> {
    {
        let cache = state.db_cache.lock().unwrap();
        if let Some((_, cached_index)) = cache
            .iter()
            .find(|(cached_file, _)| cached_file.as_path() == file)
        {
            return Ok(cached_index.clone());
        }
    }

    let index_path = get_index_path(file);

    if !MmapSearchIndex::is_valid(&index_path) {
        info!(
            "Search index not found for {:?}, generating automatically...",
            file
        );
        super::generate_search_index(file, state)?;
    }

    info!("Loading mmap search index for {:?}", file);
    let index = MmapSearchIndex::open(&index_path)?;
    {
        let mut cache = state.db_cache.lock().unwrap();
        cache.retain(|(cached_file, _)| cached_file.as_path() != file);
        cache.push((file.to_path_buf(), index.clone()));
        if cache.len() > DB_CACHE_LIMIT {
            cache.remove(0);
        }
    }

    Ok(index)
}

fn fen_for_output(position: &Chess) -> String {
    Fen::from_position(position.clone(), EnPassantMode::Legal).to_string()
}

fn fen_key(position: &Chess) -> String {
    fen_for_output(position)
        .split_whitespace()
        .take(4)
        .collect::<Vec<_>>()
        .join(" ")
}

fn position_index_key_from_fen_key(key: &str) -> Option<PositionIndexKey> {
    let mut parts = key.split_whitespace();
    let board = parts.next()?;
    let turn = parts.next()?;
    Some(PositionIndexKey::from_text(&format!("{board} {turn}")))
}

fn uci_for_move(m: &Move) -> String {
    UciMove::from_move(m, CastlingMode::Standard).to_string()
}

fn score_for_side(white: i32, draw: i32, black: i32, side: Color) -> f64 {
    let total = white + draw + black;
    if total <= 0 {
        return 0.0;
    }

    let score = match side {
        Color::White => white as f64 + draw as f64 * 0.5,
        Color::Black => black as f64 + draw as f64 * 0.5,
    };
    score / total as f64
}

fn player_color_for_entry(entry: &SearchGameEntryRef<'_>, player_id: i32) -> Option<Color> {
    if entry.white_id == player_id {
        Some(Color::White)
    } else if entry.black_id == player_id {
        Some(Color::Black)
    } else {
        None
    }
}

fn color_matches_filter(color: Color, filter: &str) -> bool {
    match filter {
        "white" => color == Color::White,
        "black" => color == Color::Black,
        _ => true,
    }
}

fn entry_matches_query(
    entry: &SearchGameEntryRef<'_>,
    query: &GameQuery,
    wanted_result: Option<GameResult>,
) -> bool {
    if let Some(white) = query.player1 {
        if white != entry.white_id {
            return false;
        }
    }

    if let Some(black) = query.player2 {
        if black != entry.black_id {
            return false;
        }
    }

    if let Some(wanted) = wanted_result {
        if entry.result != wanted {
            return false;
        }
    }

    if let Some(start_date) = &query.start_date {
        if let Some(date) = entry.date {
            if date < start_date.as_str() {
                return false;
            }
        }
    }

    if let Some(end_date) = &query.end_date {
        if let Some(date) = entry.date {
            if date > end_date.as_str() {
                return false;
            }
        }
    }

    true
}

fn position_at_ply(entry: &SearchGameEntryRef<'_>, ply: u16) -> Result<Chess, Error> {
    let mut chess = starting_position(&entry.fen)?;

    for byte in iter_mainline_move_bytes(entry.moves).take(ply as usize) {
        let Some(m) = decode_move(byte, &chess) else {
            break;
        };
        chess.play_unchecked(&m);
    }

    Ok(chess)
}

fn add_opening_result(
    openings: &mut HashMap<String, PositionStats>,
    san: String,
    result: GameResult,
) {
    openings
        .entry(san)
        .and_modify(|opening| match result {
            GameResult::WhiteWin => opening.white += 1,
            GameResult::BlackWin => opening.black += 1,
            GameResult::Draw => opening.draw += 1,
            GameResult::Other | GameResult::None => opening.draw += 1,
        })
        .or_insert_with(|| PositionStats {
            black: i32::from(result == GameResult::BlackWin),
            white: i32::from(result == GameResult::WhiteWin),
            draw: i32::from(
                result == GameResult::Draw
                    || result == GameResult::Other
                    || result == GameResult::None,
            ),
            move_: String::new(),
        });
}

fn collect_player_positions(
    index: &MmapSearchIndex,
    player_id: i32,
    color_filter: &str,
    max_plies: usize,
) -> Result<(HashMap<String, PlayerPositionBucket>, i32), Error> {
    let mut positions: HashMap<String, PlayerPositionBucket> = HashMap::new();
    let mut player_games = 0;

    for entry in index.iter() {
        let Some(player_color) = player_color_for_entry(&entry, player_id) else {
            continue;
        };

        if !color_matches_filter(player_color, color_filter) {
            continue;
        }

        player_games += 1;
        let mut chess = starting_position(&entry.fen)?;
        let mut mainline = iter_mainline_move_bytes(entry.moves);
        let mut seen_in_game: HashSet<(String, String)> = HashSet::new();

        for ply in 0..max_plies {
            let Some(byte) = mainline.next() else {
                break;
            };
            let Some(m) = decode_move(byte, &chess) else {
                break;
            };

            if chess.turn() == player_color {
                let key = fen_key(&chess);
                let uci = uci_for_move(&m);

                if seen_in_game.insert((key.clone(), uci.clone())) {
                    let san = SanPlus::from_move(chess.clone(), &m).to_string();
                    let output_fen = fen_for_output(&chess);
                    positions
                        .entry(key)
                        .and_modify(|bucket| {
                            bucket.add_move(san.clone(), uci.clone(), entry.result, entry.id)
                        })
                        .or_insert_with(|| {
                            let mut bucket = PlayerPositionBucket {
                                fen: output_fen,
                                ply: ply as i32,
                                side_to_move: chess.turn(),
                                moves: HashMap::new(),
                            };
                            bucket.add_move(san, uci, entry.result, entry.id);
                            bucket
                        });
                }
            }

            chess.play_unchecked(&m);
        }
    }

    Ok((positions, player_games))
}

fn collect_reference_positions(
    index: &MmapSearchIndex,
    candidate_keys: &HashSet<String>,
    max_plies: usize,
) -> Result<HashMap<String, ReferencePositionBucket>, Error> {
    let mut positions: HashMap<String, ReferencePositionBucket> = HashMap::new();

    if candidate_keys.is_empty() {
        return Ok(positions);
    }

    if !index.has_position_index() {
        for entry in index.iter() {
            let mut chess = starting_position(&entry.fen)?;
            let mut mainline = iter_mainline_move_bytes(entry.moves);

            for _ in 0..max_plies {
                let Some(byte) = mainline.next() else {
                    break;
                };
                let Some(m) = decode_move(byte, &chess) else {
                    break;
                };

                let key = fen_key(&chess);
                if candidate_keys.contains(&key) {
                    let san = SanPlus::from_move(chess.clone(), &m).to_string();
                    let uci = uci_for_move(&m);
                    positions
                        .entry(key)
                        .or_default()
                        .add_move(san, uci, entry.result);
                }

                chess.play_unchecked(&m);
            }
        }

        return Ok(positions);
    }

    let position_keys = candidate_keys
        .iter()
        .filter_map(|key| position_index_key_from_fen_key(key))
        .collect::<HashSet<_>>();

    for position_key in position_keys {
        for occurrence in index.position_occurrences(position_key) {
            if occurrence.ply as usize >= max_plies {
                continue;
            }

            let Some(next_byte) = occurrence.next_move else {
                continue;
            };

            let Some(entry) = index.get_entry_ref(occurrence.game_index) else {
                continue;
            };

            let chess = position_at_ply(&entry, occurrence.ply)?;
            let key = fen_key(&chess);
            if candidate_keys.contains(&key) {
                let Some(m) = decode_move(next_byte, &chess) else {
                    continue;
                };
                let san = SanPlus::from_move(chess.clone(), &m).to_string();
                let uci = uci_for_move(&m);
                positions
                    .entry(key)
                    .or_default()
                    .add_move(san, uci, entry.result);
            }
        }
    }

    Ok(positions)
}

fn sorted_reference_moves(
    bucket: &ReferencePositionBucket,
    side: Color,
) -> Vec<RepertoireGapReferenceMove> {
    let total = bucket.total_games();
    let mut moves = bucket
        .moves
        .values()
        .map(|mv| RepertoireGapReferenceMove {
            san: mv.san.clone(),
            uci: mv.uci.clone(),
            games: mv.games,
            white: mv.white,
            draw: mv.draw,
            black: mv.black,
            share: if total > 0 {
                mv.games as f64 / total as f64
            } else {
                0.0
            },
            score_for_side: score_for_side(mv.white, mv.draw, mv.black, side),
        })
        .collect::<Vec<_>>();

    moves.sort_by(|a, b| {
        b.games
            .cmp(&a.games)
            .then_with(|| b.score_for_side.total_cmp(&a.score_for_side))
            .then_with(|| a.san.cmp(&b.san))
    });

    moves
}

fn normalized_ratio(value: f64) -> f64 {
    if value > 1.0 {
        (value / 100.0).clamp(0.0, 1.0)
    } else {
        value.clamp(0.0, 1.0)
    }
}

fn get_move_after_match(
    move_blob: &[u8],
    fen: &Option<&str>,
    query: &PositionQuery,
) -> Result<Option<String>, Error> {
    let mut chess = starting_position(fen)?;

    if query.matches(&chess) {
        let mut mainline = iter_mainline_move_bytes(move_blob).peekable();
        if mainline.peek().is_none() {
            return Ok(Some("*".to_string()));
        }
        let Some(next_byte) = mainline.peek().copied() else {
            return Ok(Some("*".to_string()));
        };
        let Some(next_move) = decode_move(next_byte, &chess) else {
            return Ok(None);
        };
        let san = SanPlus::from_move(chess, &next_move);
        return Ok(Some(san.to_string()));
    }

    let mut mainline = iter_mainline_move_bytes(move_blob).peekable();

    while let Some(byte) = mainline.next() {
        let Some(m) = decode_move(byte, &chess) else {
            return Ok(None);
        };
        chess.play_unchecked(&m);

        let is_irreversible =
            m.is_capture() || m.role() == shakmaty::Role::Pawn || m.is_promotion();

        if is_irreversible {
            let board = chess.board();
            if !query.is_reachable_by(&get_material_count(board), get_pawn_home(board)) {
                return Ok(None);
            }
        }
        if query.matches(&chess) {
            if mainline.peek().is_none() {
                return Ok(Some("*".to_string()));
            }
            let Some(next_byte) = mainline.peek().copied() else {
                return Ok(Some("*".to_string()));
            };
            let Some(next_move) = decode_move(next_byte, &chess) else {
                return Ok(None);
            };
            let san = SanPlus::from_move(chess, &next_move);
            return Ok(Some(san.to_string()));
        }
    }
    Ok(None)
}

fn starting_position(fen: &Option<&str>) -> Result<Chess, Error> {
    if let Some(fen) = fen {
        let fen = Fen::from_ascii(fen.as_bytes())?;
        let setup = fen.into_setup();
        let castling_mode = CastlingMode::detect(&setup);
        Ok(Chess::from_setup(setup, castling_mode)
            .or_else(PositionError::ignore_too_much_material)?)
    } else {
        Ok(Chess::default())
    }
}

fn reserve_plan_sample(sampled_games: &AtomicUsize, max_samples: usize) -> bool {
    sampled_games
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
            (current < max_samples).then_some(current + 1)
        })
        .is_ok()
}

fn collect_piece_plans(
    chess: &Chess,
    mainline: &mut impl Iterator<Item = u8>,
    max_plies: usize,
) -> Vec<ObservedPiecePath> {
    let mut position = chess.clone();
    let mut locations: HashMap<Square, PieceKey> = HashMap::new();
    let mut paths: HashMap<PieceKey, ObservedPiecePath> = HashMap::new();

    for square in position.board().occupied() {
        if let Some(piece) = position.board().piece_at(square) {
            let key = PieceKey {
                color: piece.color,
                role: piece.role,
                from: square,
            };
            locations.insert(square, key);
            paths.insert(
                key,
                ObservedPiecePath {
                    piece: key,
                    squares: vec![square],
                    san: Vec::new(),
                    uci: Vec::new(),
                },
            );
        }
    }

    for _ in 0..max_plies {
        let Some(byte) = mainline.next() else {
            break;
        };
        let Some(m) = decode_move(byte, &position) else {
            break;
        };
        record_piece_move(&position, &m, &mut locations, &mut paths);
        position.play_unchecked(&m);
    }

    paths
        .into_values()
        .filter(|path| path.squares.len() > 1)
        .collect()
}

fn record_piece_move(
    position: &Chess,
    m: &Move,
    locations: &mut HashMap<Square, PieceKey>,
    paths: &mut HashMap<PieceKey, ObservedPiecePath>,
) {
    let san = SanPlus::from_move(position.clone(), m).to_string();
    let uci = UciMove::from_move(m, CastlingMode::Standard).to_string();

    match *m {
        Move::Normal { from, to, .. } => {
            locations.remove(&to);
            move_tracked_piece(from, to, &san, &uci, locations, paths);
        }
        Move::EnPassant { from, to } => {
            locations.remove(&Square::from_coords(to.file(), from.rank()));
            move_tracked_piece(from, to, &san, &uci, locations, paths);
        }
        Move::Castle { king, rook } => {
            let color = position.turn();
            let Some(side) = m.castling_side() else {
                return;
            };
            let king_to = side.king_to(color);
            let rook_to = side.rook_to(color);
            let king_key = locations.remove(&king);
            let rook_key = locations.remove(&rook);

            if let Some(key) = king_key {
                append_piece_square(key, king_to, &san, &uci, paths);
                locations.insert(king_to, key);
            }

            if let Some(key) = rook_key {
                append_piece_square(key, rook_to, &san, &uci, paths);
                locations.insert(rook_to, key);
            }
        }
        Move::Put { .. } => {}
    }
}

fn move_tracked_piece(
    from: Square,
    to: Square,
    san: &str,
    uci: &str,
    locations: &mut HashMap<Square, PieceKey>,
    paths: &mut HashMap<PieceKey, ObservedPiecePath>,
) {
    if let Some(key) = locations.remove(&from) {
        append_piece_square(key, to, san, uci, paths);
        locations.insert(to, key);
    }
}

fn append_piece_square(
    key: PieceKey,
    to: Square,
    san: &str,
    uci: &str,
    paths: &mut HashMap<PieceKey, ObservedPiecePath>,
) {
    if let Some(path) = paths.get_mut(&key) {
        path.squares.push(to);
        path.san.push(san.to_string());
        path.uci.push(uci.to_string());
    }
}

fn get_piece_plans_after_match(
    move_blob: &[u8],
    fen: &Option<&str>,
    query: &PositionQuery,
    max_plies: usize,
    sampled_games: &AtomicUsize,
    max_samples: usize,
) -> Result<Option<Vec<ObservedPiecePath>>, Error> {
    let mut chess = starting_position(fen)?;
    let mut mainline = iter_mainline_move_bytes(move_blob).peekable();

    if query.matches(&chess) {
        return Ok(Some(if reserve_plan_sample(sampled_games, max_samples) {
            collect_piece_plans(&chess, &mut mainline, max_plies)
        } else {
            Vec::new()
        }));
    }

    while let Some(byte) = mainline.next() {
        let Some(m) = decode_move(byte, &chess) else {
            return Ok(None);
        };
        chess.play_unchecked(&m);

        let is_irreversible =
            m.is_capture() || m.role() == shakmaty::Role::Pawn || m.is_promotion();

        if is_irreversible {
            let board = chess.board();
            if !query.is_reachable_by(&get_material_count(board), get_pawn_home(board)) {
                return Ok(None);
            }
        }

        if query.matches(&chess) {
            return Ok(Some(if reserve_plan_sample(sampled_games, max_samples) {
                collect_piece_plans(&chess, &mut mainline, max_plies)
            } else {
                Vec::new()
            }));
        }
    }

    Ok(None)
}

#[derive(Clone, serde::Serialize)]
pub struct ProgressPayload {
    pub progress: f64,
    pub id: String,
    pub finished: bool,
}

fn begin_cancelable_db_request(
    state: &tauri::State<'_, AppState>,
    request_id: &str,
) -> Arc<AtomicBool> {
    if let Some((_, old_flag)) = state.db_cancel_flags.remove(request_id) {
        old_flag.store(true, Ordering::Relaxed);
    }

    let flag = Arc::new(AtomicBool::new(false));
    state
        .db_cancel_flags
        .insert(request_id.to_string(), flag.clone());
    flag
}

fn finish_cancelable_db_request(
    state: &tauri::State<'_, AppState>,
    request_id: &str,
    flag: &Arc<AtomicBool>,
) {
    let should_remove = state
        .db_cancel_flags
        .get(request_id)
        .is_some_and(|current| Arc::ptr_eq(current.value(), flag));

    if should_remove {
        state.db_cancel_flags.remove(request_id);
    }
}

#[tauri::command]
#[specta::specta]
pub fn cancel_database_search(id: String, state: tauri::State<'_, AppState>) {
    if let Some((_, flag)) = state.db_cancel_flags.remove(&id) {
        flag.store(true, Ordering::Relaxed);
    }
}

fn search_position_from_occurrences(
    index: &MmapSearchIndex,
    query: &GameQuery,
    exact: &ExactData,
    wanted_result: Option<GameResult>,
    cancel_flag: &AtomicBool,
) -> Result<(Vec<PositionStats>, Vec<i32>), Error> {
    const MAX_SAMPLES: usize = 500;

    let occurrences = index.position_occurrences(position_index_key(&exact.position));
    let mut openings: HashMap<String, PositionStats> = HashMap::new();
    let mut top_games = BinaryHeap::with_capacity(MAX_SAMPLES + 1);
    let mut seen_games = HashSet::new();

    for occurrence in occurrences {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err(Error::SearchStopped);
        }

        if !seen_games.insert(occurrence.game_index) {
            continue;
        }

        let Some(entry) = index.get_entry_ref(occurrence.game_index) else {
            continue;
        };

        if !entry_matches_query(&entry, query, wanted_result) {
            continue;
        }

        let position = position_at_ply(&entry, occurrence.ply)?;
        if exact.position.turn() != position.turn() || exact.position.board() != position.board() {
            continue;
        }

        let san = if let Some(next_byte) = occurrence.next_move {
            let Some(next_move) = decode_move(next_byte, &position) else {
                continue;
            };
            SanPlus::from_move(position, &next_move).to_string()
        } else {
            "*".to_string()
        };

        let elo_key = entry.white_elo.max(entry.black_elo);
        if top_games.len() < MAX_SAMPLES {
            top_games.push(Reverse((elo_key, entry.id)));
        } else if let Some(&Reverse((min_elo, _))) = top_games.peek() {
            if elo_key > min_elo {
                top_games.pop();
                top_games.push(Reverse((elo_key, entry.id)));
            }
        }

        add_opening_result(&mut openings, san, entry.result);
    }

    let openings = openings
        .into_iter()
        .map(|(move_, mut stats)| {
            stats.move_ = move_;
            stats
        })
        .collect();
    let ids = top_games.into_iter().map(|Reverse((_, id))| id).collect();

    Ok((openings, ids))
}

fn plan_pieces_from_lines<I>(lines: I) -> Vec<PlanExplorerPiece>
where
    I: IntoIterator<Item = (PlanLineKey, LineStats)>,
{
    let mut grouped: HashMap<PieceKey, Vec<(Vec<Square>, LineStats)>> = HashMap::new();
    for (key, stats) in lines {
        grouped
            .entry(key.piece)
            .or_default()
            .push((key.squares, stats));
    }

    let mut pieces = grouped
        .into_iter()
        .map(|(piece, mut lines)| {
            lines.sort_by(|a, b| b.1.games.cmp(&a.1.games));
            let total = lines.iter().map(|(_, stats)| stats.games).sum();
            PlanExplorerPiece {
                color: color_name(piece.color).to_string(),
                role: role_name(piece.role).to_string(),
                from: piece.from.to_string(),
                total,
                lines: lines
                    .into_iter()
                    .take(8)
                    .map(|(squares, stats)| PlanExplorerLine {
                        squares: squares
                            .into_iter()
                            .map(|square| square.to_string())
                            .collect(),
                        san: stats.san,
                        uci: stats.uci,
                        games: stats.games,
                        white: stats.white,
                        draw: stats.draw,
                        black: stats.black,
                    })
                    .collect(),
            }
        })
        .collect::<Vec<_>>();

    pieces.sort_by(|a, b| {
        b.total
            .cmp(&a.total)
            .then_with(|| a.color.cmp(&b.color))
            .then_with(|| a.role.cmp(&b.role))
            .then_with(|| a.from.cmp(&b.from))
    });

    pieces
}

fn plan_explorer_from_occurrences(
    index: &MmapSearchIndex,
    query: &GameQuery,
    exact: &ExactData,
    max_plies: usize,
    max_samples: usize,
    wanted_result: Option<GameResult>,
    cancel_flag: &AtomicBool,
) -> Result<(i32, i32, Vec<PlanExplorerPiece>), Error> {
    let occurrences = index.position_occurrences(position_index_key(&exact.position));
    let mut lines: HashMap<PlanLineKey, LineStats> = HashMap::new();
    let mut seen_games = HashSet::new();
    let mut total_games = 0i32;
    let mut sampled_games = 0i32;

    for occurrence in occurrences {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err(Error::SearchStopped);
        }

        if !seen_games.insert(occurrence.game_index) {
            continue;
        }

        let Some(entry) = index.get_entry_ref(occurrence.game_index) else {
            continue;
        };

        if !entry_matches_query(&entry, query, wanted_result) {
            continue;
        }

        total_games += 1;

        if sampled_games as usize >= max_samples {
            continue;
        }

        let position = position_at_ply(&entry, occurrence.ply)?;
        if exact.position.turn() != position.turn() || exact.position.board() != position.board() {
            continue;
        }

        sampled_games += 1;
        let mut mainline = iter_mainline_move_bytes(entry.moves).skip(occurrence.ply as usize);
        for path in collect_piece_plans(&position, &mut mainline, max_plies) {
            let key = PlanLineKey {
                piece: path.piece,
                squares: path.squares.clone(),
            };
            lines
                .entry(key)
                .and_modify(|stats| stats.add_result(entry.result))
                .or_insert_with(|| LineStats::new(&path, entry.result));
        }
    }

    Ok((total_games, sampled_games, plan_pieces_from_lines(lines)))
}

#[tauri::command]
#[specta::specta]
pub async fn find_repertoire_gaps(
    request: RepertoireGapRequest,
    state: tauri::State<'_, AppState>,
) -> Result<RepertoireGapReport, Error> {
    let start = Instant::now();
    let max_plies = request.max_plies.clamp(1, 80) as usize;
    let min_player_games = request.min_player_games.max(1);
    let min_reference_games = request.min_reference_games.max(1);
    let top_reference_moves = request.top_reference_moves.max(1) as usize;
    let max_player_score = normalized_ratio(request.max_player_score);
    let min_reference_move_share = normalized_ratio(request.min_reference_move_share);
    let color_filter = request.color.to_ascii_lowercase();

    info!(
        "Finding repertoire gaps for player {} using {:?} against {:?}",
        request.player_id, request.player_db, request.reference_db
    );

    let player_index = open_mmap_search_index(&request.player_db, &state)?;
    let reference_index = open_mmap_search_index(&request.reference_db, &state)?;

    let (player_positions, player_games) =
        collect_player_positions(&player_index, request.player_id, &color_filter, max_plies)?;

    let candidate_keys = player_positions
        .iter()
        .filter_map(|(key, bucket)| {
            let has_candidate_move = bucket.moves.values().any(|mv| mv.games >= min_player_games);
            (bucket.total_games() >= min_player_games && has_candidate_move).then(|| key.clone())
        })
        .collect::<HashSet<_>>();

    let reference_positions =
        collect_reference_positions(&reference_index, &candidate_keys, max_plies)?;

    let mut gaps = Vec::new();

    for (key, player_bucket) in player_positions {
        if !candidate_keys.contains(&key) {
            continue;
        }

        let Some(reference_bucket) = reference_positions.get(&key) else {
            continue;
        };

        let reference_games = reference_bucket.total_games();
        if reference_games < min_reference_games {
            continue;
        }

        let reference_moves = sorted_reference_moves(reference_bucket, player_bucket.side_to_move);
        if reference_moves.is_empty() || reference_moves[0].share < min_reference_move_share {
            continue;
        }

        for player_move in player_bucket.moves.values() {
            if player_move.games < min_player_games || player_move.san == "*" {
                continue;
            }

            let player_score = score_for_side(
                player_move.white,
                player_move.draw,
                player_move.black,
                player_bucket.side_to_move,
            );
            if player_score > max_player_score {
                continue;
            }

            let reference_move_index = reference_moves
                .iter()
                .position(|mv| mv.uci == player_move.uci);
            let deviates_from_reference = reference_move_index
                .map(|index| index >= top_reference_moves)
                .unwrap_or(true);

            if !deviates_from_reference {
                continue;
            }

            let reference_move_share = reference_move_index
                .and_then(|index| reference_moves.get(index))
                .map(|mv| mv.share)
                .unwrap_or(0.0);
            let best_reference_share = reference_moves[0].share;
            let popularity_gap = (best_reference_share - reference_move_share).max(0.0);
            let result_gap = (max_player_score - player_score).max(0.0);
            let sample_weight = (player_move.games as f64).ln_1p() * 4.0;
            let severity =
                ((result_gap * 100.0) + (popularity_gap * 55.0) + sample_weight).clamp(0.0, 100.0);

            gaps.push(RepertoireGap {
                fen: player_bucket.fen.clone(),
                ply: player_bucket.ply,
                side_to_move: color_name(player_bucket.side_to_move).to_string(),
                player_move_san: player_move.san.clone(),
                player_move_uci: player_move.uci.clone(),
                player_games: player_move.games,
                player_white: player_move.white,
                player_draw: player_move.draw,
                player_black: player_move.black,
                player_score,
                reference_games,
                reference_move_rank: reference_move_index.map(|index| index as i32 + 1),
                reference_move_share,
                severity,
                sample_game_ids: player_move.sample_game_ids.clone(),
                top_reference_moves: reference_moves
                    .iter()
                    .take(top_reference_moves.max(5))
                    .cloned()
                    .collect(),
            });
        }
    }

    gaps.sort_by(|a, b| {
        b.severity
            .total_cmp(&a.severity)
            .then_with(|| b.player_games.cmp(&a.player_games))
            .then_with(|| a.ply.cmp(&b.ply))
    });

    info!(
        "Finished finding {} repertoire gaps from {} candidate positions in {:?}",
        gaps.len(),
        candidate_keys.len(),
        start.elapsed()
    );

    Ok(RepertoireGapReport {
        player_games,
        candidate_positions: candidate_keys.len() as i32,
        reference_positions: reference_positions.len() as i32,
        gaps,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn search_position(
    file: PathBuf,
    query: GameQuery,
    app: tauri::AppHandle,
    tab_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(Vec<PositionStats>, Vec<NormalizedGame>), Error> {
    let db = &mut get_db_or_create(&state, file.to_str().unwrap(), ConnectionOptions::default())?;
    let cancel_flag = begin_cancelable_db_request(&state, &tab_id);

    let collision_lock = {
        let entry = state
            .search_collisions
            .entry((query.clone(), file.clone()))
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())));
        entry.value().clone()
    };

    let _guard = collision_lock.lock().await;

    if let Some(pos) = state.line_cache.get(&(query.clone(), file.clone())) {
        finish_cancelable_db_request(&state, &tab_id, &cancel_flag);
        return Ok(pos.clone());
    }

    if cancel_flag.load(Ordering::Relaxed) {
        finish_cancelable_db_request(&state, &tab_id, &cancel_flag);
        return Err(Error::SearchStopped);
    }

    let start = Instant::now();
    info!("start loading games");

    let permit = state.new_request.acquire().await.unwrap();

    let mmap_index = open_mmap_search_index(&file, &state)?;

    let game_count = mmap_index.len();

    info!(
        "Ready to search {} games: {:?}",
        game_count,
        start.elapsed()
    );

    let openings: DashMap<String, PositionStats> = DashMap::new();
    const MAX_SAMPLES: usize = 500;
    // Min-heap of (elo_key, game_id) to track top-rated sample games.
    // Using Reverse so peek() returns the entry with the lowest ELO,
    // which we can evict when a higher-rated game is found.
    let top_games: Mutex<BinaryHeap<Reverse<(i16, i32)>>> =
        Mutex::new(BinaryHeap::with_capacity(MAX_SAMPLES + 1));

    let processed = AtomicUsize::new(0);

    let parsed_position_query: Option<PositionQuery> = if let Some(pq) = &query.position {
        Some(convert_position_query(pq.clone())?)
    } else {
        None
    };

    let wanted_result = query.wanted_result.as_ref().and_then(|r| match r.as_str() {
        "whitewon" => Some(GameResult::WhiteWin),
        "blackwon" => Some(GameResult::BlackWin),
        "draw" => Some(GameResult::Draw),
        _ => None,
    });

    if let Some(PositionQuery::Exact(exact)) = &parsed_position_query {
        if !mmap_index.has_position_index() {
            info!("position occurrence index unavailable; using full scan on {tab_id}");
        } else {
            info!("start occurrence-index search on {tab_id}");
            let (openings, ids) = search_position_from_occurrences(
                &mmap_index,
                &query,
                exact,
                wanted_result,
                &cancel_flag,
            )?;

            let (white_players, black_players) = diesel::alias!(players as white, players as black);
            let games: Vec<(Game, Player, Player, Event, Site)> = games::table
                .inner_join(white_players.on(games::white_id.eq(white_players.field(players::id))))
                .inner_join(black_players.on(games::black_id.eq(black_players.field(players::id))))
                .inner_join(events::table.on(games::event_id.eq(events::id)))
                .inner_join(sites::table.on(games::site_id.eq(sites::id)))
                .filter(games::id.eq_any(ids))
                .order((games::white_elo.desc(), games::black_elo.desc()))
                .load(db)?;
            let normalized_games = normalize_games(games);
            let file_path = file.clone();

            state.line_cache.insert(
                (query.clone(), file.clone()),
                (openings.clone(), normalized_games.clone()),
            );
            state.search_collisions.remove(&(query, file_path));

            drop(permit);
            finish_cancelable_db_request(&state, &tab_id, &cancel_flag);
            info!("finished occurrence-index search in {:?}", start.elapsed());

            return Ok((openings, normalized_games));
        }
    }

    info!("start search on {tab_id}");

    let process_entry = |entry: SearchGameEntryRef<'_>| {
        if cancel_flag.load(Ordering::Relaxed) {
            return;
        }

        let index = processed.fetch_add(1, Ordering::Relaxed) + 1;
        if index.is_multiple_of(50000) {
            let _ = app.emit(
                "search_progress",
                ProgressPayload {
                    progress: (index as f64 / game_count as f64) * 100.0,
                    id: tab_id.clone(),
                    finished: false,
                },
            );
        }

        if let Some(white) = query.player1 {
            if white != entry.white_id {
                return;
            }
        }

        if let Some(black) = query.player2 {
            if black != entry.black_id {
                return;
            }
        }

        if let Some(wanted) = wanted_result {
            if entry.result != wanted {
                return;
            }
        }

        if let Some(start_date) = &query.start_date {
            if let Some(date) = entry.date {
                if date < start_date.as_str() {
                    return;
                }
            }
        }

        if let Some(end_date) = &query.end_date {
            if let Some(date) = entry.date {
                if date > end_date.as_str() {
                    return;
                }
            }
        }

        if let Some(position_query) = &parsed_position_query {
            let end_material: MaterialCount = ByColor {
                white: entry.white_material,
                black: entry.black_material,
            };
            if position_query.can_reach(&end_material, entry.pawn_home) {
                if let Ok(Some(m)) = get_move_after_match(entry.moves, &entry.fen, position_query) {
                    let elo_key = entry.white_elo.max(entry.black_elo);
                    let mut heap = top_games.lock().unwrap();
                    if heap.len() < MAX_SAMPLES {
                        heap.push(Reverse((elo_key, entry.id)));
                    } else if let Some(&Reverse((min_elo, _))) = heap.peek() {
                        if elo_key > min_elo {
                            heap.pop();
                            heap.push(Reverse((elo_key, entry.id)));
                        }
                    }
                    drop(heap);

                    openings
                        .entry(m)
                        .and_modify(|opening| match entry.result {
                            GameResult::WhiteWin => opening.white += 1,
                            GameResult::BlackWin => opening.black += 1,
                            GameResult::Draw => opening.draw += 1,
                            GameResult::Other | GameResult::None => opening.draw += 1,
                        })
                        .or_insert_with(|| PositionStats {
                            black: i32::from(entry.result == GameResult::BlackWin),
                            white: i32::from(entry.result == GameResult::WhiteWin),
                            draw: i32::from(
                                entry.result == GameResult::Draw
                                    || entry.result == GameResult::Other
                                    || entry.result == GameResult::None,
                            ),
                            move_: String::new(),
                        });
                }
            }
        }
    };

    mmap_index.par_iter().for_each(process_entry);

    if cancel_flag.load(Ordering::Relaxed) {
        state.search_collisions.remove(&(query, file));
        drop(permit);
        finish_cancelable_db_request(&state, &tab_id, &cancel_flag);
        return Err(Error::SearchStopped);
    }

    let openings: Vec<PositionStats> = openings
        .into_iter()
        .map(|(k, mut v)| {
            v.move_ = k;
            v
        })
        .collect();
    let ids: Vec<i32> = top_games
        .into_inner()
        .unwrap()
        .into_iter()
        .map(|Reverse((_, id))| id)
        .collect();

    info!("finished search in {:?}", start.elapsed());

    let (white_players, black_players) = diesel::alias!(players as white, players as black);
    let games: Vec<(Game, Player, Player, Event, Site)> = games::table
        .inner_join(white_players.on(games::white_id.eq(white_players.field(players::id))))
        .inner_join(black_players.on(games::black_id.eq(black_players.field(players::id))))
        .inner_join(events::table.on(games::event_id.eq(events::id)))
        .inner_join(sites::table.on(games::site_id.eq(sites::id)))
        .filter(games::id.eq_any(ids))
        .order((games::white_elo.desc(), games::black_elo.desc()))
        .load(db)?;
    let normalized_games = normalize_games(games);
    let file_path = file.clone();

    state.line_cache.insert(
        (query.clone(), file),
        (openings.clone(), normalized_games.clone()),
    );

    state.search_collisions.remove(&(query, file_path));

    drop(permit);
    finish_cancelable_db_request(&state, &tab_id, &cancel_flag);

    Ok((openings, normalized_games))
}

#[tauri::command]
#[specta::specta]
pub async fn get_plan_explorer(
    file: PathBuf,
    query: GameQuery,
    max_plies: i32,
    request_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<PlanExplorerData, Error> {
    let Some(position_query_js) = &query.position else {
        return Ok(PlanExplorerData {
            fen: String::new(),
            total_games: 0,
            sampled_games: 0,
            max_plies,
            pieces: Vec::new(),
        });
    };

    let start = Instant::now();
    let max_plies = max_plies.clamp(1, 30);
    const MAX_PLAN_SAMPLES: usize = 5000;
    let cancel_flag = begin_cancelable_db_request(&state, &request_id);

    let parsed_position_query = convert_position_query(position_query_js.clone())?;
    let wanted_result = query.wanted_result.as_ref().and_then(|r| match r.as_str() {
        "whitewon" => Some(GameResult::WhiteWin),
        "blackwon" => Some(GameResult::BlackWin),
        "draw" => Some(GameResult::Draw),
        _ => None,
    });

    let permit = state.new_request.acquire().await.unwrap();

    let mmap_index = open_mmap_search_index(&file, &state)?;

    if let PositionQuery::Exact(exact) = &parsed_position_query {
        if !mmap_index.has_position_index() {
            info!("position occurrence index unavailable; using full plan explorer scan");
        } else {
            let indexed_result = plan_explorer_from_occurrences(
                &mmap_index,
                &query,
                exact,
                max_plies as usize,
                MAX_PLAN_SAMPLES,
                wanted_result,
                &cancel_flag,
            );

            drop(permit);
            finish_cancelable_db_request(&state, &request_id, &cancel_flag);

            let (total_games, sampled_games, pieces) = indexed_result?;

            info!(
                "finished occurrence-index plan explorer in {:?}",
                start.elapsed()
            );

            return Ok(PlanExplorerData {
                fen: position_query_js.fen.clone(),
                total_games,
                sampled_games,
                max_plies,
                pieces,
            });
        }
    }

    let total_games = AtomicUsize::new(0);
    let sampled_games = AtomicUsize::new(0);
    let lines: DashMap<PlanLineKey, LineStats> = DashMap::new();

    let process_entry = |entry: SearchGameEntryRef<'_>| {
        if cancel_flag.load(Ordering::Relaxed) {
            return;
        }

        if let Some(white) = query.player1 {
            if white != entry.white_id {
                return;
            }
        }

        if let Some(black) = query.player2 {
            if black != entry.black_id {
                return;
            }
        }

        if let Some(wanted) = wanted_result {
            if entry.result != wanted {
                return;
            }
        }

        if let Some(start_date) = &query.start_date {
            if let Some(date) = entry.date {
                if date < start_date.as_str() {
                    return;
                }
            }
        }

        if let Some(end_date) = &query.end_date {
            if let Some(date) = entry.date {
                if date > end_date.as_str() {
                    return;
                }
            }
        }

        let end_material: MaterialCount = ByColor {
            white: entry.white_material,
            black: entry.black_material,
        };

        if !parsed_position_query.can_reach(&end_material, entry.pawn_home) {
            return;
        }

        let Ok(Some(paths)) = get_piece_plans_after_match(
            entry.moves,
            &entry.fen,
            &parsed_position_query,
            max_plies as usize,
            &sampled_games,
            MAX_PLAN_SAMPLES,
        ) else {
            return;
        };

        total_games.fetch_add(1, Ordering::Relaxed);

        for path in paths {
            let key = PlanLineKey {
                piece: path.piece,
                squares: path.squares.clone(),
            };
            lines
                .entry(key)
                .and_modify(|stats| stats.add_result(entry.result))
                .or_insert_with(|| LineStats::new(&path, entry.result));
        }
    };

    mmap_index.par_iter().for_each(process_entry);

    if cancel_flag.load(Ordering::Relaxed) {
        drop(permit);
        finish_cancelable_db_request(&state, &request_id, &cancel_flag);
        return Err(Error::SearchStopped);
    }

    let pieces = plan_pieces_from_lines(lines);

    drop(permit);
    finish_cancelable_db_request(&state, &request_id, &cancel_flag);

    info!("finished plan explorer in {:?}", start.elapsed());

    Ok(PlanExplorerData {
        fen: position_query_js.fen.clone(),
        total_games: total_games.load(Ordering::Relaxed) as i32,
        sampled_games: sampled_games.load(Ordering::Relaxed) as i32,
        max_plies,
        pieces,
    })
}

pub async fn is_position_in_db(
    file: PathBuf,
    query: GameQuery,
    state: tauri::State<'_, AppState>,
) -> Result<bool, Error> {
    let collision_lock = {
        let entry = state
            .search_collisions
            .entry((query.clone(), file.clone()))
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())));
        entry.value().clone()
    };

    let _guard = collision_lock.lock().await;

    if let Some(pos) = state.line_cache.get(&(query.clone(), file.clone())) {
        return Ok(!pos.0.is_empty());
    }

    let parsed_position_query: Option<PositionQuery> = if let Some(pq) = &query.position {
        Some(convert_position_query(pq.clone())?)
    } else {
        None
    };

    let start = Instant::now();
    info!("start loading games for is_position_in_db");

    let permit = state.new_request.acquire().await.unwrap();

    let mmap_index = open_mmap_search_index(&file, &state)?;

    let check_entry = |entry: SearchGameEntryRef<'_>| -> bool {
        let end_material: MaterialCount = ByColor {
            white: entry.white_material,
            black: entry.black_material,
        };
        if let Some(position_query) = &parsed_position_query {
            position_query.can_reach(&end_material, entry.pawn_home)
                && get_move_after_match(entry.moves, &entry.fen, position_query)
                    .unwrap_or(None)
                    .is_some()
        } else {
            false
        }
    };

    let exists = mmap_index.par_iter().any(check_entry);

    info!("finished search in {:?}", start.elapsed());

    if !exists {
        state
            .line_cache
            .insert((query.clone(), file.clone()), (vec![], vec![]));
    }

    state.search_collisions.remove(&(query, file));

    drop(permit);

    Ok(exists)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_partial_match(fen1: &str, fen2: &str) {
        let query = PositionQuery::partial_from_fen(fen1).unwrap();
        let fen = Fen::from_ascii(fen2.as_bytes()).unwrap();
        let chess = Chess::from_setup(fen.into_setup(), shakmaty::CastlingMode::Chess960).unwrap();
        assert!(query.matches(&chess));
    }

    #[test]
    fn exact_matches() {
        let query = PositionQuery::exact_from_fen(
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        )
        .unwrap();
        let chess = Chess::default();
        assert!(query.matches(&chess));
    }

    #[test]
    fn exact_query_ignores_too_much_material_validation() {
        let query = PositionQuery::exact_from_fen("4k3/8/8/8/8/8/8/QQ2K3 w - - 0 1").unwrap();
        let fen = Fen::from_ascii("4k3/8/8/8/8/8/8/QQ2K3 w - - 0 1".as_bytes()).unwrap();
        let setup = fen.into_setup();
        let chess = Chess::from_setup(setup, CastlingMode::Standard)
            .or_else(PositionError::ignore_too_much_material)
            .unwrap();

        assert!(query.matches(&chess));
    }

    #[test]
    fn empty_matches_anything() {
        assert_partial_match(
            "8/8/8/8/8/8/8/8 w - - 0 1",
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        );
    }

    #[test]
    fn correct_partial_match() {
        assert_partial_match(
            "8/8/8/8/8/8/8/6N1 w - - 0 1",
            "3k4/8/8/8/8/4P3/3PKP2/6N1 w - - 0 1",
        );
    }

    #[test]
    #[should_panic]
    fn fail_partial_match() {
        assert_partial_match(
            "8/8/8/8/8/8/8/6N1 w - - 0 1",
            "3k4/8/8/8/8/4P3/3PKP2/7N w - - 0 1",
        );
        assert_partial_match(
            "8/8/8/8/8/8/8/6N1 w - - 0 1",
            "3k4/8/8/8/8/4P3/3PKP2/6n1 w - - 0 1",
        );
    }

    #[test]
    fn correct_exact_is_reachable() {
        let query =
            PositionQuery::exact_from_fen("rnbqkb1r/pppp1ppp/5n2/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR")
                .unwrap();
        let chess = Chess::default();
        assert!(query.is_reachable_by(
            &get_material_count(chess.board()),
            get_pawn_home(chess.board())
        ));
    }

    #[test]
    fn correct_partial_is_reachable() {
        let query = PositionQuery::partial_from_fen("8/8/8/8/8/8/8/8").unwrap();
        let chess = Chess::default();
        assert!(query.is_reachable_by(
            &get_material_count(chess.board()),
            get_pawn_home(chess.board())
        ));
    }

    #[test]
    fn correct_partial_can_reach() {
        let query = PositionQuery::partial_from_fen("8/8/8/8/8/8/8/8").unwrap();
        let chess = Chess::default();
        assert!(query.can_reach(
            &get_material_count(chess.board()),
            get_pawn_home(chess.board())
        ));
    }

    #[test]
    fn get_move_after_exact_match_test() {
        let game = vec![12, 12]; // 1. e4 e5

        let query =
            PositionQuery::exact_from_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR").unwrap();
        let result = get_move_after_match(&game, &None, &query).unwrap();
        assert_eq!(result, Some("e4".to_string()));

        let query =
            PositionQuery::exact_from_fen("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR").unwrap();
        let result = get_move_after_match(&game, &None, &query).unwrap();
        assert_eq!(result, Some("e5".to_string()));

        let query =
            PositionQuery::exact_from_fen("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR")
                .unwrap();
        let result = get_move_after_match(&game, &None, &query).unwrap();
        assert_eq!(result, Some("*".to_string()));
    }

    #[test]
    fn get_move_after_partial_match_test() {
        let game = vec![12, 12]; // 1. e4 e5

        let query = PositionQuery::partial_from_fen("8/pppppppp/8/8/8/8/PPPPPPPP/8").unwrap();
        let result = get_move_after_match(&game, &None, &query).unwrap();
        assert_eq!(result, Some("e4".to_string()));
    }
}
