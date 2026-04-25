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
    cmp::{Ordering as CmpOrdering, Reverse},
    collections::{BinaryHeap, HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::Emitter;

use crate::{
    db::{
        encoding::{decode_move, iter_mainline_move_bytes},
        get_db_or_create, get_material_count, get_pawn_home, legacy_position_index_key,
        models::*,
        normalize_games, position_index_key, position_index_key_from_fen_key,
        schema::*,
        search_index::{
            get_index_path, GameResult, MmapSearchIndex, PositionIndexKey, SearchGameEntryRef,
        },
        ConnectionOptions, MaterialCount,
    },
    error::Error,
    AppState,
};

use super::{GameQuery, Sides};

const DB_CACHE_LIMIT: usize = 4;
const PLAN_EXPLORER_INDEXED_SAMPLES: usize = 5_000;
const PLAN_EXPLORER_FALLBACK_FULL_SAMPLE_MAX_GAMES: usize = 100_000;
const MASTER_GAME_FAST_CANDIDATE_LIMIT: usize = 30_000;
const OPENING_HEALTH_SCORE_GAP: f64 = 0.15;
const OPENING_HEALTH_POOR_SCORE: f64 = 0.45;
const OPENING_HEALTH_PROGRESS_EVENT: &str = "opening_health_progress";
const OPENING_HEALTH_MAX_REFERENCE_CANDIDATES: usize = 3_000;
const OPENING_HEALTH_MAX_PLAYER_EXPORT_POSITIONS: usize = 3_000;
const OPENING_HEALTH_MAX_REPORT_ROWS: usize = 600;
const OPENING_HEALTH_REFERENCE_SAMPLE_GAMES: usize = 750_000;
const OPENING_HEALTH_REFERENCE_OCCURRENCE_SAMPLE_LIMIT: usize = 5_000;
const OPENING_HEALTH_MAX_REFERENCE_WORKERS: usize = 6;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpeningHealthProgress {
    id: String,
    progress: f32,
    games_scanned: i32,
    positions_processed: i32,
    phase: String,
    finished: bool,
}

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
    pub player_id: Option<i32>,
    pub color: String,
    pub max_plies: i32,
    pub min_player_games: i32,
    pub min_reference_games: i32,
    pub top_reference_moves: i32,
    pub request_id: String,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpeningHealthPlayerPositionsRequest {
    pub player_db: PathBuf,
    pub player_id: Option<i32>,
    pub color: String,
    pub max_plies: i32,
    pub request_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpeningHealthPlayerPositionsReport {
    pub player_games: i32,
    pub candidate_positions: i32,
    pub positions: Vec<OpeningHealthPlayerPosition>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpeningHealthPlayerPosition {
    pub fen: String,
    pub normalized_fen: String,
    pub ply: i32,
    pub side_to_move: String,
    pub move_sequence: String,
    pub player_move_san: String,
    pub player_move_uci: String,
    pub player_games: i32,
    pub player_position_games: i32,
    pub player_white: i32,
    pub player_draw: i32,
    pub player_black: i32,
    pub player_score: f64,
    pub last_played: Option<String>,
    pub sample_game_ids: Vec<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct RepertoireGapReport {
    pub player_games: i32,
    pub candidate_positions: i32,
    pub reference_positions: i32,
    pub gaps: Vec<RepertoireGap>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RepertoireGapClassification {
    RepertoireGap,
    PreparedUnderperforming,
    LowConfidence,
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct RepertoireGap {
    pub fen: String,
    pub normalized_fen: String,
    pub ply: i32,
    pub side_to_move: String,
    pub move_sequence: String,
    pub player_move_san: String,
    pub player_move_uci: String,
    pub player_games: i32,
    pub player_position_games: i32,
    pub player_white: i32,
    pub player_draw: i32,
    pub player_black: i32,
    pub player_score: f64,
    pub last_played: Option<String>,
    pub reference_games: i32,
    pub reference_move_rank: Option<i32>,
    pub reference_move_share: f64,
    pub reference_score: Option<f64>,
    pub top_reference_move_score: Option<f64>,
    pub classification: RepertoireGapClassification,
    pub popularity_gap: f64,
    pub score_gap: f64,
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
    last_played: Option<String>,
    sample_game_ids: Vec<i32>,
}

impl PlayerMoveBucket {
    fn new(san: String, uci: String, result: GameResult, game_id: i32, date: Option<&str>) -> Self {
        let (white, draw, black) = result_counts(result);
        Self {
            san,
            uci,
            games: 1,
            white,
            draw,
            black,
            last_played: date.map(ToOwned::to_owned),
            sample_game_ids: vec![game_id],
        }
    }

    fn add_result(&mut self, result: GameResult, game_id: i32, date: Option<&str>) {
        let (white, draw, black) = result_counts(result);
        self.games += 1;
        self.white += white;
        self.draw += draw;
        self.black += black;
        if let Some(date) = date {
            if self
                .last_played
                .as_deref()
                .map(|last_played| date > last_played)
                .unwrap_or(true)
            {
                self.last_played = Some(date.to_string());
            }
        }
        if self.sample_game_ids.len() < 12 && !self.sample_game_ids.contains(&game_id) {
            self.sample_game_ids.push(game_id);
        }
    }
}

#[derive(Debug, Clone)]
struct PlayerPositionBucket {
    fen: String,
    normalized_fen: String,
    ply: i32,
    side_to_move: Color,
    move_sequence: String,
    moves: HashMap<String, PlayerMoveBucket>,
}

impl PlayerPositionBucket {
    fn add_move(
        &mut self,
        san: String,
        uci: String,
        result: GameResult,
        game_id: i32,
        date: Option<&str>,
    ) {
        self.moves
            .entry(uci.clone())
            .and_modify(|bucket| bucket.add_result(result, game_id, date))
            .or_insert_with(|| PlayerMoveBucket::new(san, uci, result, game_id, date));
    }

    fn total_games(&self) -> i32 {
        self.moves.values().map(|bucket| bucket.games).sum()
    }
}

fn is_opening_health_candidate(bucket: &PlayerPositionBucket, min_player_games: i32) -> bool {
    bucket.total_games() >= min_player_games
        && top_player_move(bucket)
            .map(|player_move| player_move.san != "*")
            .unwrap_or(false)
}

fn opening_health_candidate_score(bucket: &PlayerPositionBucket) -> f64 {
    top_player_move(bucket)
        .map(|player_move| {
            score_for_side(
                player_move.white,
                player_move.draw,
                player_move.black,
                bucket.side_to_move,
            )
        })
        .unwrap_or(1.0)
}

fn compare_opening_health_candidates(
    a: &PlayerPositionBucket,
    b: &PlayerPositionBucket,
) -> CmpOrdering {
    b.total_games()
        .cmp(&a.total_games())
        .then_with(|| {
            opening_health_candidate_score(a).total_cmp(&opening_health_candidate_score(b))
        })
        .then_with(|| a.ply.cmp(&b.ply))
        .then_with(|| a.move_sequence.cmp(&b.move_sequence))
}

fn prioritize_opening_health_positions(
    positions: HashMap<String, PlayerPositionBucket>,
    min_player_games: i32,
    limit: usize,
) -> (HashMap<String, PlayerPositionBucket>, usize) {
    let collected_positions = positions.len();
    let mut candidates = positions
        .into_iter()
        .filter(|(_, bucket)| is_opening_health_candidate(bucket, min_player_games))
        .collect::<Vec<_>>();

    candidates.sort_by(|(_, a), (_, b)| compare_opening_health_candidates(a, b));
    candidates.truncate(limit);

    (candidates.into_iter().collect(), collected_positions)
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

fn chess_from_fen_key(key: &str) -> Result<Chess, Error> {
    let fen = format!("{key} 0 1");
    let fen = Fen::from_ascii(fen.as_bytes())?;
    let setup = fen.into_setup();
    let castling_mode = CastlingMode::detect(&setup);
    Ok(Chess::from_setup(setup, castling_mode).or_else(PositionError::ignore_too_much_material)?)
}

fn legacy_position_index_key_from_fen_key(key: &str) -> Option<PositionIndexKey> {
    let mut parts = key.split_whitespace();
    let board = parts.next()?;
    let turn = parts.next()?;
    Some(PositionIndexKey::from_text(&format!("{board} {turn}")))
}

fn uci_for_move(m: &Move) -> String {
    UciMove::from_move(m, CastlingMode::Standard).to_string()
}

fn indexed_position_key(index: &MmapSearchIndex, position: &Chess) -> PositionIndexKey {
    if index.has_exact_position_index() {
        position_index_key(position)
    } else {
        legacy_position_index_key(position)
    }
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
    if !entry_players_match_query(entry, query) {
        return false;
    }

    if !entry_elos_match_query(entry, query) {
        return false;
    }

    if let Some(wanted) = wanted_result.or_else(|| {
        query
            .outcome
            .as_deref()
            .and_then(search_result_filter_from_str)
    }) {
        if entry.result != wanted {
            return false;
        }
    }

    if let Some(outcome) = &query.outcome {
        if outcome == "*" && !matches!(entry.result, GameResult::Other | GameResult::None) {
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

fn search_result_filter_from_str(value: &str) -> Option<GameResult> {
    match value {
        "1-0" | "whitewon" => Some(GameResult::WhiteWin),
        "0-1" | "blackwon" => Some(GameResult::BlackWin),
        "1/2-1/2" | "draw" => Some(GameResult::Draw),
        _ => None,
    }
}

fn entry_players_match_query(entry: &SearchGameEntryRef<'_>, query: &GameQuery) -> bool {
    match query.sides {
        Some(Sides::WhiteBlack) => {
            query.player1.map_or(true, |player| player == entry.white_id)
                && query.player2.map_or(true, |player| player == entry.black_id)
        }
        Some(Sides::BlackWhite) => {
            query.player1.map_or(true, |player| player == entry.black_id)
                && query.player2.map_or(true, |player| player == entry.white_id)
        }
        Some(Sides::Any) => {
            query
                .player1
                .map_or(true, |player| player == entry.white_id || player == entry.black_id)
                && query
                    .player2
                    .map_or(true, |player| player == entry.white_id || player == entry.black_id)
        }
        None => {
            query.player1.map_or(true, |player| player == entry.white_id)
                && query.player2.map_or(true, |player| player == entry.black_id)
        }
    }
}

fn entry_elos_match_query(entry: &SearchGameEntryRef<'_>, query: &GameQuery) -> bool {
    match query.sides {
        Some(Sides::WhiteBlack) => {
            query
                .range1
                .map_or(true, |range| elo_in_range(entry.white_elo, range))
                && query
                    .range2
                    .map_or(true, |range| elo_in_range(entry.black_elo, range))
        }
        Some(Sides::BlackWhite) => {
            query
                .range1
                .map_or(true, |range| elo_in_range(entry.black_elo, range))
                && query
                    .range2
                    .map_or(true, |range| elo_in_range(entry.white_elo, range))
        }
        Some(Sides::Any) => ranges_match_any_player(entry, query.range1, query.range2),
        None => {
            query.range1.map_or(true, |range| {
                elo_in_range(entry.white_elo, range) || elo_in_range(entry.black_elo, range)
            }) && query.range2.map_or(true, |range| {
                elo_in_range(entry.white_elo, range) || elo_in_range(entry.black_elo, range)
            })
        }
    }
}

fn ranges_match_any_player(
    entry: &SearchGameEntryRef<'_>,
    range1: Option<(i32, i32)>,
    range2: Option<(i32, i32)>,
) -> bool {
    match (range1, range2) {
        (Some(r1), Some(r2)) => {
            elo_in_range(entry.white_elo, r1)
                || elo_in_range(entry.black_elo, r1)
                || elo_in_range(entry.white_elo, r2)
                || elo_in_range(entry.black_elo, r2)
        }
        (Some(range), None) | (None, Some(range)) => {
            elo_in_range(entry.white_elo, range) || elo_in_range(entry.black_elo, range)
        }
        (None, None) => true,
    }
}

fn elo_in_range(elo: i16, range: (i32, i32)) -> bool {
    let elo = i32::from(elo);
    elo >= range.0 && elo <= range.1
}

fn master_game_elo_key(entry: &SearchGameEntryRef<'_>) -> i32 {
    i32::from(entry.white_elo.max(0)) + i32::from(entry.black_elo.max(0))
}

fn push_top_master_game(
    heap: &mut BinaryHeap<Reverse<(i32, i32)>>,
    entry: &SearchGameEntryRef<'_>,
    limit: usize,
) {
    let elo_key = master_game_elo_key(entry);
    if heap.len() < limit {
        heap.push(Reverse((elo_key, entry.id)));
    } else if let Some(&Reverse((min_elo, _))) = heap.peek() {
        if elo_key > min_elo {
            heap.pop();
            heap.push(Reverse((elo_key, entry.id)));
        }
    }
}

fn push_top_master_game_candidate(
    heap: &mut BinaryHeap<Reverse<(i32, usize)>>,
    entry: &SearchGameEntryRef<'_>,
    index: usize,
    limit: usize,
) {
    let elo_key = master_game_elo_key(entry);
    if heap.len() < limit {
        heap.push(Reverse((elo_key, index)));
    } else if let Some(&Reverse((min_elo, _))) = heap.peek() {
        if elo_key > min_elo {
            heap.pop();
            heap.push(Reverse((elo_key, index)));
        }
    }
}

fn sort_master_games(games: &mut [NormalizedGame]) {
    games.sort_by(|a, b| {
        let a_white = a.white_elo.unwrap_or(0);
        let a_black = a.black_elo.unwrap_or(0);
        let b_white = b.white_elo.unwrap_or(0);
        let b_black = b.black_elo.unwrap_or(0);
        let a_sum = a_white + a_black;
        let b_sum = b_white + b_black;
        let a_max = a_white.max(a_black);
        let b_max = b_white.max(b_black);

        b_sum
            .cmp(&a_sum)
            .then_with(|| b_max.cmp(&a_max))
            .then_with(|| b.date.cmp(&a.date))
            .then_with(|| a.white.cmp(&b.white))
            .then_with(|| a.black.cmp(&b.black))
    });
}

fn search_master_games_from_index_candidates(
    index: &MmapSearchIndex,
    query: &GameQuery,
    position_query: &PositionQuery,
    wanted_result: Option<GameResult>,
    cancel_flag: &AtomicBool,
    max_samples: usize,
) -> Result<Vec<i32>, Error> {
    let candidate_limit = MASTER_GAME_FAST_CANDIDATE_LIMIT.max(max_samples);
    let mut candidates = BinaryHeap::with_capacity(candidate_limit + 1);

    for (game_index, entry) in index.iter().enumerate() {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err(Error::SearchStopped);
        }

        if !entry_matches_query(&entry, query, wanted_result) {
            continue;
        }

        let end_material: MaterialCount = ByColor {
            white: entry.white_material,
            black: entry.black_material,
        };
        if !position_query.can_reach(&end_material, entry.pawn_home) {
            continue;
        }

        push_top_master_game_candidate(&mut candidates, &entry, game_index, candidate_limit);
    }

    let mut candidates = candidates
        .into_iter()
        .map(|Reverse(candidate)| candidate)
        .collect::<Vec<_>>();
    candidates.sort_by(|a, b| b.0.cmp(&a.0));

    let mut ids = Vec::with_capacity(max_samples);
    for (_, game_index) in candidates {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err(Error::SearchStopped);
        }

        let Some(entry) = index.get_entry_ref(game_index) else {
            continue;
        };
        if get_move_after_match(entry.moves, &entry.fen, position_query)?.is_some() {
            ids.push(entry.id);
            if ids.len() >= max_samples {
                break;
            }
        }
    }

    Ok(ids)
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

fn emit_opening_health_progress(
    app: &tauri::AppHandle,
    request_id: &str,
    progress: f32,
    games_scanned: i32,
    positions_processed: i32,
    phase: &str,
    finished: bool,
) -> Result<(), Error> {
    app.emit(
        OPENING_HEALTH_PROGRESS_EVENT,
        OpeningHealthProgress {
            id: request_id.to_string(),
            progress,
            games_scanned,
            positions_processed,
            phase: phase.to_string(),
            finished,
        },
    )?;

    Ok(())
}

fn opening_health_reference_worker_count() -> usize {
    std::thread::available_parallelism()
        .map(|workers| {
            workers
                .get()
                .saturating_sub(1)
                .clamp(1, OPENING_HEALTH_MAX_REFERENCE_WORKERS)
        })
        .unwrap_or(2)
}

fn collect_player_positions(
    index: &MmapSearchIndex,
    player_id: Option<i32>,
    color_filter: &str,
    max_plies: usize,
    cancel_flag: &AtomicBool,
    app: &tauri::AppHandle,
    state: &tauri::State<'_, AppState>,
    request_id: &str,
) -> Result<(HashMap<String, PlayerPositionBucket>, i32), Error> {
    let mut positions: HashMap<String, PlayerPositionBucket> = HashMap::new();
    let mut player_games = 0;
    let total_games = index.len().max(1);

    for (entry_index, entry) in index.iter().enumerate() {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err(Error::SearchStopped);
        }
        wait_if_database_search_paused(state, request_id, cancel_flag)?;

        if entry_index % 512 == 0 {
            let progress = ((entry_index as f32 / total_games as f32) * 45.0).min(45.0);
            emit_opening_health_progress(
                app,
                request_id,
                progress,
                player_games,
                positions.len() as i32,
                "Scanning personal games",
                false,
            )?;
        }

        let player_color = player_id.and_then(|id| player_color_for_entry(&entry, id));
        if player_id.is_some() && player_color.is_none() {
            continue;
        }

        if let Some(player_color) = player_color {
            if !color_matches_filter(player_color, color_filter) {
                continue;
            }
        }

        player_games += 1;
        let mut chess = starting_position(&entry.fen)?;
        let mut mainline = iter_mainline_move_bytes(entry.moves);
        let mut seen_in_game: HashSet<(String, String)> = HashSet::new();
        let mut move_sequence: Vec<String> = Vec::new();

        for ply in 0..max_plies {
            let Some(byte) = mainline.next() else {
                break;
            };
            let Some(m) = decode_move(byte, &chess) else {
                break;
            };
            let san = SanPlus::from_move(chess.clone(), &m).to_string();

            let include_move = if let Some(player_color) = player_color {
                chess.turn() == player_color
            } else {
                color_matches_filter(chess.turn(), color_filter)
            };

            if include_move {
                let key = fen_key(&chess);
                let uci = uci_for_move(&m);

                if seen_in_game.insert((key.clone(), uci.clone())) {
                    let output_fen = fen_for_output(&chess);
                    let sequence = move_sequence.join(" ");
                    positions
                        .entry(key.clone())
                        .and_modify(|bucket| {
                            bucket.add_move(
                                san.clone(),
                                uci.clone(),
                                entry.result,
                                entry.id,
                                entry.date,
                            )
                        })
                        .or_insert_with(|| {
                            let mut bucket = PlayerPositionBucket {
                                fen: output_fen,
                                normalized_fen: key.clone(),
                                ply: ply as i32,
                                side_to_move: chess.turn(),
                                move_sequence: sequence,
                                moves: HashMap::new(),
                            };
                            bucket.add_move(san.clone(), uci, entry.result, entry.id, entry.date);
                            bucket
                        });
                }
            }

            move_sequence.push(san);
            chess.play_unchecked(&m);
        }
    }

    emit_opening_health_progress(
        app,
        request_id,
        45.0,
        player_games,
        positions.len() as i32,
        "Scanning personal games",
        false,
    )?;

    Ok((positions, player_games))
}

fn collect_reference_positions(
    index: &MmapSearchIndex,
    candidate_keys: &HashSet<String>,
    max_plies: usize,
    cancel_flag: &AtomicBool,
    app: &tauri::AppHandle,
    state: &tauri::State<'_, AppState>,
    request_id: &str,
    games_scanned_offset: i32,
) -> Result<HashMap<String, ReferencePositionBucket>, Error> {
    let mut positions: HashMap<String, ReferencePositionBucket> = HashMap::new();

    if candidate_keys.is_empty() {
        return Ok(positions);
    }

    if !index.has_position_index() {
        let candidate_by_key = candidate_keys
            .iter()
            .filter_map(|key| {
                position_index_key_from_fen_key(key).map(|position_key| (position_key, key.clone()))
            })
            .collect::<HashMap<_, _>>();
        let matched_positions: DashMap<String, ReferencePositionBucket> = DashMap::new();
        let move_name_cache: DashMap<(PositionIndexKey, u8), (String, String)> = DashMap::new();
        let total_games = index.len().max(1);
        let sample_games = total_games.min(OPENING_HEALTH_REFERENCE_SAMPLE_GAMES);
        let reference_phase = if sample_games < total_games {
            "Sampling strong games"
        } else {
            "Checking strong games"
        };
        let processed = AtomicUsize::new(0);

        let scan_sample = || {
            (0..sample_games).into_par_iter().for_each(|sample_index| {
                if cancel_flag.load(Ordering::Relaxed) {
                    return;
                }

                let raw_entry_index = if sample_games == total_games {
                    sample_index
                } else {
                    sample_index * total_games / sample_games
                };
                let Some(entry) = index.get_entry_ref(raw_entry_index) else {
                    return;
                };

                let scanned_games = processed.fetch_add(1, Ordering::Relaxed) + 1;
                if scanned_games % 8192 == 0 {
                    if wait_if_database_search_paused(state, request_id, cancel_flag).is_err() {
                        return;
                    }
                    let progress =
                        45.0 + ((scanned_games as f32 / sample_games as f32) * 45.0).min(45.0);
                    let _ = emit_opening_health_progress(
                        app,
                        request_id,
                        progress,
                        games_scanned_offset + scanned_games as i32,
                        matched_positions.len() as i32,
                        reference_phase,
                        false,
                    );
                }

                let Ok(mut chess) = starting_position(&entry.fen) else {
                    return;
                };
                let mut mainline = iter_mainline_move_bytes(entry.moves);

                for _ in 0..max_plies {
                    if cancel_flag.load(Ordering::Relaxed) {
                        return;
                    }

                    let Some(byte) = mainline.next() else {
                        break;
                    };
                    let Some(m) = decode_move(byte, &chess) else {
                        break;
                    };

                    let position_key = position_index_key(&chess);
                    if let Some(key) = candidate_by_key.get(&position_key) {
                        let (san, uci) =
                            if let Some(cached) = move_name_cache.get(&(position_key, byte)) {
                                cached.value().clone()
                            } else {
                                let decoded = (
                                    SanPlus::from_move(chess.clone(), &m).to_string(),
                                    uci_for_move(&m),
                                );
                                move_name_cache.insert((position_key, byte), decoded.clone());
                                decoded
                            };
                        matched_positions.entry(key.clone()).or_default().add_move(
                            san,
                            uci,
                            entry.result,
                        );
                    }

                    chess.play_unchecked(&m);
                }
            });
        };

        match rayon::ThreadPoolBuilder::new()
            .num_threads(opening_health_reference_worker_count())
            .build()
        {
            Ok(pool) => pool.install(scan_sample),
            Err(_) => scan_sample(),
        };

        if cancel_flag.load(Ordering::Relaxed) {
            return Err(Error::SearchStopped);
        }

        positions = matched_positions.into_iter().collect();

        emit_opening_health_progress(
            app,
            request_id,
            90.0,
            games_scanned_offset + sample_games as i32,
            positions.len() as i32,
            reference_phase,
            false,
        )?;

        return Ok(positions);
    }

    if index.has_exact_position_index() {
        let position_keys = candidate_keys
            .iter()
            .filter_map(|key| {
                let chess = chess_from_fen_key(key).ok()?;
                Some((position_index_key(&chess), key.clone(), chess))
            })
            .collect::<Vec<_>>();
        let total_positions = position_keys.len().max(1);

        for (index_position, (position_key, key, chess)) in position_keys.into_iter().enumerate() {
            if cancel_flag.load(Ordering::Relaxed) {
                return Err(Error::SearchStopped);
            }
            wait_if_database_search_paused(state, request_id, cancel_flag)?;

            if index_position % 64 == 0 {
                let progress =
                    45.0 + ((index_position as f32 / total_positions as f32) * 45.0).min(45.0);
                emit_opening_health_progress(
                    app,
                    request_id,
                    progress,
                    games_scanned_offset,
                    index_position as i32,
                    "Checking strong games",
                    false,
                )?;
            }

            let mut move_name_cache: HashMap<u8, (String, String)> = HashMap::new();
            let (_, occurrences) = index.sampled_position_occurrences(
                position_key,
                OPENING_HEALTH_REFERENCE_OCCURRENCE_SAMPLE_LIMIT,
            );
            for occurrence in occurrences {
                if occurrence.ply as usize >= max_plies {
                    continue;
                }

                let Some(next_byte) = occurrence.next_move else {
                    continue;
                };

                let Some(entry) = index.get_entry_ref(occurrence.game_index) else {
                    continue;
                };

                let (san, uci) = if let Some(cached) = move_name_cache.get(&next_byte) {
                    cached.clone()
                } else {
                    let Some(m) = decode_move(next_byte, &chess) else {
                        continue;
                    };
                    let decoded = (
                        SanPlus::from_move(chess.clone(), &m).to_string(),
                        uci_for_move(&m),
                    );
                    move_name_cache.insert(next_byte, decoded.clone());
                    decoded
                };
                positions
                    .entry(key.clone())
                    .or_default()
                    .add_move(san, uci, entry.result);
            }
        }

        emit_opening_health_progress(
            app,
            request_id,
            90.0,
            games_scanned_offset,
            total_positions as i32,
            "Checking strong games",
            false,
        )?;

        return Ok(positions);
    }

    if !index.has_board_turn_position_index() {
        return Ok(positions);
    }

    let position_keys = candidate_keys
        .iter()
        .filter_map(|key| legacy_position_index_key_from_fen_key(key))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let total_positions = position_keys.len().max(1);

    for (index_position, position_key) in position_keys.into_iter().enumerate() {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err(Error::SearchStopped);
        }
        wait_if_database_search_paused(state, request_id, cancel_flag)?;

        if index_position % 64 == 0 {
            let progress =
                45.0 + ((index_position as f32 / total_positions as f32) * 45.0).min(45.0);
            emit_opening_health_progress(
                app,
                request_id,
                progress,
                games_scanned_offset,
                index_position as i32,
                "Checking strong games",
                false,
            )?;
        }

        let (_, occurrences) = index.sampled_position_occurrences(
            position_key,
            OPENING_HEALTH_REFERENCE_OCCURRENCE_SAMPLE_LIMIT,
        );
        for occurrence in occurrences {
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

    emit_opening_health_progress(
        app,
        request_id,
        90.0,
        games_scanned_offset,
        total_positions as i32,
        "Checking strong games",
        false,
    )?;

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

fn top_player_move(bucket: &PlayerPositionBucket) -> Option<&PlayerMoveBucket> {
    bucket.moves.values().max_by(|a, b| {
        let a_score = score_for_side(a.white, a.draw, a.black, bucket.side_to_move);
        let b_score = score_for_side(b.white, b.draw, b.black, bucket.side_to_move);

        a.games
            .cmp(&b.games)
            .then_with(|| b_score.total_cmp(&a_score))
            .then_with(|| b.san.cmp(&a.san))
    })
}

fn classify_opening_health(
    player_position_games: i32,
    reference_games: i32,
    reference_move_rank: Option<i32>,
    player_score: f64,
    reference_score: Option<f64>,
    min_player_games: i32,
    min_reference_games: i32,
    top_reference_moves: i32,
) -> Option<RepertoireGapClassification> {
    if player_position_games < min_player_games || reference_games < min_reference_games {
        return Some(RepertoireGapClassification::LowConfidence);
    }

    let in_top_reference_moves = reference_move_rank
        .map(|rank| rank <= top_reference_moves)
        .unwrap_or(false);

    if !in_top_reference_moves {
        return Some(RepertoireGapClassification::RepertoireGap);
    }

    let score_gap = reference_score
        .map(|reference_score| reference_score - player_score)
        .unwrap_or(0.0);

    if score_gap >= OPENING_HEALTH_SCORE_GAP && player_score <= OPENING_HEALTH_POOR_SCORE {
        return Some(RepertoireGapClassification::PreparedUnderperforming);
    }

    None
}

fn opening_health_severity(
    classification: RepertoireGapClassification,
    player_position_games: i32,
    popularity_gap: f64,
    score_gap: f64,
) -> f64 {
    let sample_weight = (player_position_games as f64).ln_1p() * 4.0;
    match classification {
        RepertoireGapClassification::RepertoireGap => {
            (45.0 + popularity_gap * 45.0 + sample_weight).clamp(0.0, 100.0)
        }
        RepertoireGapClassification::PreparedUnderperforming => {
            (40.0 + score_gap.max(0.0) * 120.0 + sample_weight).clamp(0.0, 100.0)
        }
        RepertoireGapClassification::LowConfidence => (10.0 + sample_weight).clamp(0.0, 35.0),
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

fn fen_ply(fen: &str) -> usize {
    let mut parts = fen.split_whitespace();
    let _board = parts.next();
    let turn = parts.next().unwrap_or("w");
    let _castling = parts.next();
    let _en_passant = parts.next();
    let _halfmove = parts.next();
    let fullmove = parts
        .next()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1);

    fullmove.saturating_sub(1) * 2 + usize::from(turn == "b")
}

fn plan_explorer_sample_limit(fen: &str, uses_occurrence_index: bool, index_len: usize) -> usize {
    if uses_occurrence_index || index_len <= PLAN_EXPLORER_FALLBACK_FULL_SAMPLE_MAX_GAMES {
        return PLAN_EXPLORER_INDEXED_SAMPLES;
    }

    match fen_ply(fen) {
        0..=4 => PLAN_EXPLORER_INDEXED_SAMPLES,
        5..=8 => 3_000,
        9..=12 => 1_500,
        _ => 800,
    }
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
    state.db_pause_flags.remove(request_id);

    let flag = Arc::new(AtomicBool::new(false));
    state
        .db_cancel_flags
        .insert(request_id.to_string(), flag.clone());
    state
        .db_pause_flags
        .insert(request_id.to_string(), Arc::new(AtomicBool::new(false)));
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
        state.db_pause_flags.remove(request_id);
    }
}

#[tauri::command]
#[specta::specta]
pub fn cancel_database_search(id: String, state: tauri::State<'_, AppState>) {
    if let Some((_, flag)) = state.db_cancel_flags.remove(&id) {
        flag.store(true, Ordering::Relaxed);
    }
    state.db_pause_flags.remove(&id);
}

#[tauri::command]
#[specta::specta]
pub fn set_database_search_paused(id: String, paused: bool, state: tauri::State<'_, AppState>) {
    if let Some(flag) = state.db_pause_flags.get(&id) {
        flag.store(paused, Ordering::Relaxed);
    }
}

fn wait_if_database_search_paused(
    state: &tauri::State<'_, AppState>,
    request_id: &str,
    cancel_flag: &AtomicBool,
) -> Result<(), Error> {
    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err(Error::SearchStopped);
        }

        let paused = state
            .db_pause_flags
            .get(request_id)
            .is_some_and(|flag| flag.load(Ordering::Relaxed));
        if !paused {
            return Ok(());
        }

        thread::sleep(Duration::from_millis(150));
    }
}

fn search_position_from_occurrences(
    index: &MmapSearchIndex,
    query: &GameQuery,
    exact: &ExactData,
    wanted_result: Option<GameResult>,
    cancel_flag: &AtomicBool,
    include_openings: bool,
    include_games: bool,
    max_samples: usize,
) -> Result<(Vec<PositionStats>, Vec<i32>), Error> {
    let occurrences = index.position_occurrences(indexed_position_key(index, &exact.position));
    let mut openings: HashMap<String, PositionStats> = HashMap::new();
    let mut top_games = BinaryHeap::with_capacity(max_samples + 1);
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

        if include_games {
            push_top_master_game(&mut top_games, &entry, max_samples);
        }

        if include_openings {
            let san = if let Some(next_byte) = occurrence.next_move {
                let Some(next_move) = decode_move(next_byte, &position) else {
                    continue;
                };
                SanPlus::from_move(position, &next_move).to_string()
            } else {
                "*".to_string()
            };
            add_opening_result(&mut openings, san, entry.result);
        }
    }

    let openings = if include_openings {
        openings
            .into_iter()
            .map(|(move_, mut stats)| {
                stats.move_ = move_;
                stats
            })
            .collect()
    } else {
        Vec::new()
    };
    let ids = if include_games {
        top_games.into_iter().map(|Reverse((_, id))| id).collect()
    } else {
        Vec::new()
    };

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
    let occurrences = index.position_occurrences(indexed_position_key(index, &exact.position));
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
pub async fn get_opening_health_player_positions(
    request: OpeningHealthPlayerPositionsRequest,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<OpeningHealthPlayerPositionsReport, Error> {
    let max_plies = request.max_plies.clamp(1, 80) as usize;
    let color_filter = request.color.to_ascii_lowercase();
    let request_id = if request.request_id.is_empty() {
        "opening-health".to_string()
    } else {
        request.request_id.clone()
    };
    let cancel_flag = begin_cancelable_db_request(&state, &request_id);

    info!(
        "Collecting opening health player rows for player {:?} using {:?}",
        request.player_id, request.player_db
    );

    emit_opening_health_progress(
        &app,
        &request_id,
        0.0,
        0,
        0,
        "Waiting for database worker",
        false,
    )?;

    let permit = state.new_request.acquire().await.unwrap();

    let result = (|| -> Result<OpeningHealthPlayerPositionsReport, Error> {
        emit_opening_health_progress(&app, &request_id, 1.0, 0, 0, "Opening databases", false)?;

        if !MmapSearchIndex::is_valid(get_index_path(&request.player_db)) {
            emit_opening_health_progress(
                &app,
                &request_id,
                1.0,
                0,
                0,
                "Building personal search index",
                false,
            )?;
        }

        let player_index = open_mmap_search_index(&request.player_db, &state)?;
        let (player_positions, player_games) = collect_player_positions(
            &player_index,
            request.player_id,
            &color_filter,
            max_plies,
            &cancel_flag,
            &app,
            &state,
            &request_id,
        )?;

        emit_opening_health_progress(
            &app,
            &request_id,
            46.0,
            player_games,
            player_positions.len() as i32,
            "Preparing player positions",
            false,
        )?;

        let mut positions = Vec::with_capacity(player_positions.len());

        for player_bucket in player_positions.into_values() {
            if cancel_flag.load(Ordering::Relaxed) {
                return Err(Error::SearchStopped);
            }
            wait_if_database_search_paused(&state, &request_id, &cancel_flag)?;

            let player_position_games = player_bucket.total_games();
            let Some(player_move) = top_player_move(&player_bucket) else {
                continue;
            };

            if player_move.san == "*" {
                continue;
            }

            positions.push(OpeningHealthPlayerPosition {
                fen: player_bucket.fen.clone(),
                normalized_fen: player_bucket.normalized_fen.clone(),
                ply: player_bucket.ply,
                side_to_move: color_name(player_bucket.side_to_move).to_string(),
                move_sequence: player_bucket.move_sequence.clone(),
                player_move_san: player_move.san.clone(),
                player_move_uci: player_move.uci.clone(),
                player_games: player_move.games,
                player_position_games,
                player_white: player_move.white,
                player_draw: player_move.draw,
                player_black: player_move.black,
                player_score: score_for_side(
                    player_move.white,
                    player_move.draw,
                    player_move.black,
                    player_bucket.side_to_move,
                ),
                last_played: player_move.last_played.clone(),
                sample_game_ids: player_move.sample_game_ids.clone(),
            });
        }

        positions.sort_by(|a, b| {
            b.player_position_games
                .cmp(&a.player_position_games)
                .then_with(|| a.player_score.total_cmp(&b.player_score))
                .then_with(|| a.ply.cmp(&b.ply))
                .then_with(|| a.player_move_san.cmp(&b.player_move_san))
        });
        positions.truncate(OPENING_HEALTH_MAX_PLAYER_EXPORT_POSITIONS);

        Ok(OpeningHealthPlayerPositionsReport {
            player_games,
            candidate_positions: positions.len() as i32,
            positions,
        })
    })();

    drop(permit);
    finish_cancelable_db_request(&state, &request_id, &cancel_flag);

    match result {
        Ok(report) => {
            emit_opening_health_progress(
                &app,
                &request_id,
                50.0,
                report.player_games,
                report.candidate_positions,
                "Player positions ready",
                false,
            )?;
            Ok(report)
        }
        Err(error) => {
            let phase = match &error {
                Error::SearchStopped => "Cancelled",
                _ => "Error",
            };
            let _ = emit_opening_health_progress(&app, &request_id, 100.0, 0, 0, phase, true);
            Err(error)
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn find_repertoire_gaps(
    request: RepertoireGapRequest,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<RepertoireGapReport, Error> {
    let start = Instant::now();
    let max_plies = request.max_plies.clamp(1, 80) as usize;
    let min_player_games = request.min_player_games.max(1);
    let min_reference_games = request.min_reference_games.max(1);
    let top_reference_moves = request.top_reference_moves.max(1) as usize;
    let top_reference_moves_i32 = top_reference_moves as i32;
    let color_filter = request.color.to_ascii_lowercase();
    let request_id = if request.request_id.is_empty() {
        "opening-health".to_string()
    } else {
        request.request_id.clone()
    };
    let cancel_flag = begin_cancelable_db_request(&state, &request_id);

    info!(
        "Finding opening health rows for player {:?} using {:?} against {:?}",
        request.player_id, request.player_db, request.reference_db
    );

    emit_opening_health_progress(
        &app,
        &request_id,
        0.0,
        0,
        0,
        "Waiting for database worker",
        false,
    )?;

    let permit = state.new_request.acquire().await.unwrap();

    let result = (|| -> Result<RepertoireGapReport, Error> {
        emit_opening_health_progress(&app, &request_id, 1.0, 0, 0, "Opening databases", false)?;

        if !MmapSearchIndex::is_valid(get_index_path(&request.player_db)) {
            emit_opening_health_progress(
                &app,
                &request_id,
                1.0,
                0,
                0,
                "Building personal search index",
                false,
            )?;
        }

        let player_index = open_mmap_search_index(&request.player_db, &state)?;

        if !MmapSearchIndex::is_valid(get_index_path(&request.reference_db)) {
            emit_opening_health_progress(
                &app,
                &request_id,
                1.0,
                0,
                0,
                "Building strong-games index",
                false,
            )?;
        }

        let reference_index = open_mmap_search_index(&request.reference_db, &state)?;

        let (player_positions, player_games) = collect_player_positions(
            &player_index,
            request.player_id,
            &color_filter,
            max_plies,
            &cancel_flag,
            &app,
            &state,
            &request_id,
        )?;

        let (player_positions, collected_player_positions) = prioritize_opening_health_positions(
            player_positions,
            min_player_games,
            OPENING_HEALTH_MAX_REFERENCE_CANDIDATES,
        );
        let candidate_keys = player_positions.keys().cloned().collect::<HashSet<_>>();

        info!(
            "Opening health selected {} candidate positions from {} personal positions",
            candidate_keys.len(),
            collected_player_positions
        );

        let reference_positions = collect_reference_positions(
            &reference_index,
            &candidate_keys,
            max_plies,
            &cancel_flag,
            &app,
            &state,
            &request_id,
            player_games,
        )?;

        emit_opening_health_progress(
            &app,
            &request_id,
            92.0,
            player_games,
            candidate_keys.len() as i32,
            "Classifying positions",
            false,
        )?;

        let mut gaps = Vec::new();

        for (key, player_bucket) in player_positions {
            if cancel_flag.load(Ordering::Relaxed) {
                return Err(Error::SearchStopped);
            }
            wait_if_database_search_paused(&state, &request_id, &cancel_flag)?;

            let player_position_games = player_bucket.total_games();
            let Some(player_move) = top_player_move(&player_bucket) else {
                continue;
            };

            if player_move.san == "*" {
                continue;
            }

            let reference_moves = reference_positions
                .get(&key)
                .map(|bucket| sorted_reference_moves(bucket, player_bucket.side_to_move))
                .unwrap_or_default();
            let reference_games = reference_positions
                .get(&key)
                .map(ReferencePositionBucket::total_games)
                .unwrap_or(0);
            let reference_move_index = reference_moves
                .iter()
                .position(|mv| mv.uci == player_move.uci);
            let reference_move_rank = reference_move_index.map(|index| index as i32 + 1);
            let reference_move_share = reference_move_index
                .and_then(|index| reference_moves.get(index))
                .map(|mv| mv.share)
                .unwrap_or(0.0);
            let top_reference_move_score = reference_moves.first().map(|mv| mv.score_for_side);
            let reference_score = reference_move_index
                .and_then(|index| reference_moves.get(index))
                .map(|mv| mv.score_for_side)
                .or(top_reference_move_score);
            let player_score = score_for_side(
                player_move.white,
                player_move.draw,
                player_move.black,
                player_bucket.side_to_move,
            );

            let Some(classification) = classify_opening_health(
                player_position_games,
                reference_games,
                reference_move_rank,
                player_score,
                reference_score,
                min_player_games,
                min_reference_games,
                top_reference_moves_i32,
            ) else {
                continue;
            };

            if classification == RepertoireGapClassification::LowConfidence {
                continue;
            }

            let best_reference_share = reference_moves.first().map(|mv| mv.share).unwrap_or(0.0);
            let popularity_gap = (best_reference_share - reference_move_share).max(0.0);
            let score_gap = reference_score
                .map(|reference_score| (reference_score - player_score).max(0.0))
                .unwrap_or(0.0);
            let severity = opening_health_severity(
                classification,
                player_position_games,
                popularity_gap,
                score_gap,
            );

            gaps.push(RepertoireGap {
                fen: player_bucket.fen.clone(),
                normalized_fen: player_bucket.normalized_fen.clone(),
                ply: player_bucket.ply,
                side_to_move: color_name(player_bucket.side_to_move).to_string(),
                move_sequence: player_bucket.move_sequence.clone(),
                player_move_san: player_move.san.clone(),
                player_move_uci: player_move.uci.clone(),
                player_games: player_move.games,
                player_position_games,
                player_white: player_move.white,
                player_draw: player_move.draw,
                player_black: player_move.black,
                player_score,
                last_played: player_move.last_played.clone(),
                reference_games,
                reference_move_rank,
                reference_move_share,
                reference_score,
                top_reference_move_score,
                classification,
                popularity_gap,
                score_gap,
                severity,
                sample_game_ids: player_move.sample_game_ids.clone(),
                top_reference_moves: reference_moves
                    .iter()
                    .take(top_reference_moves.max(5))
                    .cloned()
                    .collect(),
            });
        }

        gaps.sort_by(|a, b| {
            b.severity
                .total_cmp(&a.severity)
                .then_with(|| b.player_position_games.cmp(&a.player_position_games))
                .then_with(|| a.ply.cmp(&b.ply))
        });
        gaps.truncate(OPENING_HEALTH_MAX_REPORT_ROWS);

        info!(
            "Finished opening health scan with {} rows from {} candidate positions in {:?}",
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
    })();

    drop(permit);
    finish_cancelable_db_request(&state, &request_id, &cancel_flag);

    match result {
        Ok(report) => {
            emit_opening_health_progress(
                &app,
                &request_id,
                99.0,
                report.player_games,
                report.candidate_positions,
                "Finalizing report",
                false,
            )?;
            Ok(report)
        }
        Err(error) => {
            let phase = match &error {
                Error::SearchStopped => "Cancelled",
                _ => "Error",
            };
            let _ = emit_opening_health_progress(&app, &request_id, 100.0, 0, 0, phase, true);
            Err(error)
        }
    }
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

    let query_options = query.options.as_ref();
    let include_openings = query_options.map_or(true, |options| !options.skip_count);
    let include_games = query_options
        .and_then(|options| options.page_size)
        .map_or(true, |page_size| page_size != 0);
    let max_samples = query_options
        .and_then(|options| options.page_size)
        .filter(|page_size| *page_size > 0)
        .map(|page_size| page_size as usize)
        .unwrap_or(500)
        .clamp(1, 500);

    if !include_openings && !include_games {
        finish_cancelable_db_request(&state, &tab_id, &cancel_flag);
        return Ok((Vec::new(), Vec::new()));
    }

    let openings: DashMap<String, PositionStats> = DashMap::new();
    // Min-heap of (elo_key, game_id) to track top-rated sample games.
    // Using Reverse so peek() returns the entry with the lowest ELO,
    // which we can evict when a higher-rated game is found.
    let top_games: Mutex<BinaryHeap<Reverse<(i32, i32)>>> =
        Mutex::new(BinaryHeap::with_capacity(max_samples + 1));

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
                include_openings,
                include_games,
                max_samples,
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
            let mut normalized_games = normalize_games(games);
            sort_master_games(&mut normalized_games);
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

    if include_games && !include_openings {
        if let Some(position_query) = &parsed_position_query {
            info!("start fast master-game candidate search on {tab_id}");
            let ids = search_master_games_from_index_candidates(
                &mmap_index,
                &query,
                position_query,
                wanted_result,
                &cancel_flag,
                max_samples,
            )?;

            {
                let (white_players, black_players) =
                    diesel::alias!(players as white, players as black);
                let games: Vec<(Game, Player, Player, Event, Site)> = if ids.is_empty() {
                    Vec::new()
                } else {
                    games::table
                        .inner_join(
                            white_players.on(games::white_id.eq(white_players.field(players::id))),
                        )
                        .inner_join(
                            black_players.on(games::black_id.eq(black_players.field(players::id))),
                        )
                        .inner_join(events::table.on(games::event_id.eq(events::id)))
                        .inner_join(sites::table.on(games::site_id.eq(sites::id)))
                        .filter(games::id.eq_any(ids))
                        .load(db)?
                };
                let mut normalized_games = normalize_games(games);
                sort_master_games(&mut normalized_games);
                let file_path = file.clone();

                state.line_cache.insert(
                    (query.clone(), file.clone()),
                    (Vec::new(), normalized_games.clone()),
                );
                state.search_collisions.remove(&(query, file_path));

                drop(permit);
                finish_cancelable_db_request(&state, &tab_id, &cancel_flag);
                info!(
                    "finished fast master-game candidate search in {:?}",
                    start.elapsed()
                );

                return Ok((Vec::new(), normalized_games));
            }
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

        if !entry_matches_query(&entry, &query, wanted_result) {
            return;
        }

        if let Some(position_query) = &parsed_position_query {
            let end_material: MaterialCount = ByColor {
                white: entry.white_material,
                black: entry.black_material,
            };
            if position_query.can_reach(&end_material, entry.pawn_home) {
                if let Ok(Some(m)) = get_move_after_match(entry.moves, &entry.fen, position_query) {
                    let mut heap = top_games.lock().unwrap();
                    if include_games {
                        push_top_master_game(&mut heap, &entry, max_samples);
                    }
                    drop(heap);

                    if include_openings {
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
        }
    };

    mmap_index.par_iter().for_each(process_entry);

    if cancel_flag.load(Ordering::Relaxed) {
        state.search_collisions.remove(&(query, file));
        drop(permit);
        finish_cancelable_db_request(&state, &tab_id, &cancel_flag);
        return Err(Error::SearchStopped);
    }

    let openings: Vec<PositionStats> = if include_openings {
        openings
            .into_iter()
            .map(|(k, mut v)| {
                v.move_ = k;
                v
            })
            .collect()
    } else {
        Vec::new()
    };
    let ids: Vec<i32> = if include_games {
        top_games
            .into_inner()
            .unwrap()
            .into_iter()
            .map(|Reverse((_, id))| id)
            .collect()
    } else {
        Vec::new()
    };

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
    let mut normalized_games = normalize_games(games);
    sort_master_games(&mut normalized_games);
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
    let cancel_flag = begin_cancelable_db_request(&state, &request_id);
    let cache_key = (query.clone(), file.clone(), max_plies);

    if let Some(cached) = state.plan_explorer_cache.get(&cache_key) {
        finish_cancelable_db_request(&state, &request_id, &cancel_flag);
        return Ok(cached.clone());
    }

    let parsed_position_query = convert_position_query(position_query_js.clone())?;
    let wanted_result = query.wanted_result.as_ref().and_then(|r| match r.as_str() {
        "whitewon" => Some(GameResult::WhiteWin),
        "blackwon" => Some(GameResult::BlackWin),
        "draw" => Some(GameResult::Draw),
        _ => None,
    });

    let permit = state.new_request.acquire().await.unwrap();

    let mmap_index = open_mmap_search_index(&file, &state)?;
    let has_position_index = mmap_index.has_position_index();
    let uses_occurrence_index =
        has_position_index && matches!(&parsed_position_query, PositionQuery::Exact(_));
    let max_plan_samples = plan_explorer_sample_limit(
        &position_query_js.fen,
        uses_occurrence_index,
        mmap_index.len(),
    );
    let stop_after_sample_limit =
        !uses_occurrence_index && mmap_index.len() > PLAN_EXPLORER_FALLBACK_FULL_SAMPLE_MAX_GAMES;

    if let PositionQuery::Exact(exact) = &parsed_position_query {
        if !has_position_index {
            info!(
                "position occurrence index unavailable; using sampled plan explorer scan capped at {} games",
                max_plan_samples
            );
        } else {
            let indexed_result = plan_explorer_from_occurrences(
                &mmap_index,
                &query,
                exact,
                max_plies as usize,
                max_plan_samples,
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

            let data = PlanExplorerData {
                fen: position_query_js.fen.clone(),
                total_games,
                sampled_games,
                max_plies,
                pieces,
            };
            state.plan_explorer_cache.insert(cache_key, data.clone());
            return Ok(data);
        }
    }

    let total_games = AtomicUsize::new(0);
    let sampled_games = AtomicUsize::new(0);
    let lines: DashMap<PlanLineKey, LineStats> = DashMap::new();

    let process_entry = |entry: SearchGameEntryRef<'_>| {
        if cancel_flag.load(Ordering::Relaxed) {
            return;
        }

        if stop_after_sample_limit && sampled_games.load(Ordering::Relaxed) >= max_plan_samples {
            return;
        }

        if !entry_matches_query(&entry, &query, wanted_result) {
            return;
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
            max_plan_samples,
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

    if stop_after_sample_limit {
        let _ = mmap_index.par_iter().try_for_each(|entry| {
            if cancel_flag.load(Ordering::Relaxed)
                || sampled_games.load(Ordering::Relaxed) >= max_plan_samples
            {
                return Err(());
            }

            process_entry(entry);

            if cancel_flag.load(Ordering::Relaxed)
                || sampled_games.load(Ordering::Relaxed) >= max_plan_samples
            {
                Err(())
            } else {
                Ok(())
            }
        });
    } else {
        mmap_index.par_iter().for_each(process_entry);
    }

    if cancel_flag.load(Ordering::Relaxed) {
        drop(permit);
        finish_cancelable_db_request(&state, &request_id, &cancel_flag);
        return Err(Error::SearchStopped);
    }

    let pieces = plan_pieces_from_lines(lines);

    drop(permit);
    finish_cancelable_db_request(&state, &request_id, &cancel_flag);

    info!("finished plan explorer in {:?}", start.elapsed());

    let data = PlanExplorerData {
        fen: position_query_js.fen.clone(),
        total_games: total_games.load(Ordering::Relaxed) as i32,
        sampled_games: sampled_games.load(Ordering::Relaxed) as i32,
        max_plies,
        pieces,
    };
    state.plan_explorer_cache.insert(cache_key, data.clone());
    Ok(data)
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

    fn test_entry() -> SearchGameEntryRef<'static> {
        SearchGameEntryRef {
            id: 1,
            white_id: 10,
            black_id: 20,
            date: Some("2024.01.01"),
            result: GameResult::WhiteWin,
            pawn_home: 0,
            white_material: 0,
            black_material: 0,
            white_elo: 2750,
            black_elo: 2690,
            fen: None,
            moves: &[],
        }
    }

    #[test]
    fn entry_query_filters_player_side_and_elo_ranges() {
        let entry = test_entry();

        let white_query = GameQuery {
            player1: Some(10),
            sides: Some(Sides::WhiteBlack),
            range1: Some((2700, 2800)),
            ..Default::default()
        };
        assert!(entry_matches_query(&entry, &white_query, None));

        let black_query = GameQuery {
            player1: Some(20),
            sides: Some(Sides::BlackWhite),
            range1: Some((2600, 2700)),
            ..Default::default()
        };
        assert!(entry_matches_query(&entry, &black_query, None));

        let too_high = GameQuery {
            range1: Some((2800, 3000)),
            ..Default::default()
        };
        assert!(!entry_matches_query(&entry, &too_high, None));
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
    fn fen_ply_reads_fullmove_and_side_to_move() {
        assert_eq!(
            fen_ply("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"),
            0
        );
        assert_eq!(
            fen_ply("rnbqkbnr/pppppppp/8/8/5N2/8/PPPPPPPP/RNBQKB1R b KQkq - 1 1"),
            1
        );
        assert_eq!(
            fen_ply("rnbqkbnr/ppp1pppp/8/3p4/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 2"),
            2
        );
    }

    #[test]
    fn opening_health_fen_key_ignores_clocks_and_preserves_turn() {
        let white_to_move = starting_position(&Some(
            "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
        ))
        .unwrap();
        let same_without_clocks = starting_position(&Some(
            "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 7 44",
        ))
        .unwrap();
        let black_to_move = starting_position(&Some(
            "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2",
        ))
        .unwrap();

        assert_eq!(fen_key(&white_to_move), fen_key(&same_without_clocks));
        assert_ne!(fen_key(&white_to_move), fen_key(&black_to_move));
    }

    #[test]
    fn opening_health_reference_moves_aggregate_and_sort_by_popularity() {
        let mut bucket = ReferencePositionBucket::default();
        bucket.add_move("e4".to_string(), "e2e4".to_string(), GameResult::WhiteWin);
        bucket.add_move("d4".to_string(), "d2d4".to_string(), GameResult::BlackWin);
        bucket.add_move("e4".to_string(), "e2e4".to_string(), GameResult::Draw);

        let moves = sorted_reference_moves(&bucket, Color::White);

        assert_eq!(moves[0].uci, "e2e4");
        assert_eq!(moves[0].games, 2);
        assert!((moves[0].share - 2.0 / 3.0).abs() < f64::EPSILON);
        assert!((moves[0].score_for_side - 0.75).abs() < f64::EPSILON);
    }

    #[test]
    fn opening_health_personal_moves_aggregate_counts_and_score() {
        let mut bucket = PlayerPositionBucket {
            fen: "start".to_string(),
            normalized_fen: "start w".to_string(),
            ply: 0,
            side_to_move: Color::White,
            move_sequence: String::new(),
            moves: HashMap::new(),
        };

        bucket.add_move(
            "e4".to_string(),
            "e2e4".to_string(),
            GameResult::WhiteWin,
            1,
            Some("2024.01.01"),
        );
        bucket.add_move(
            "e4".to_string(),
            "e2e4".to_string(),
            GameResult::Draw,
            2,
            Some("2024.02.01"),
        );
        bucket.add_move(
            "d4".to_string(),
            "d2d4".to_string(),
            GameResult::BlackWin,
            3,
            None,
        );

        let top_move = top_player_move(&bucket).unwrap();
        let top_score = score_for_side(top_move.white, top_move.draw, top_move.black, Color::White);

        assert_eq!(bucket.total_games(), 3);
        assert_eq!(top_move.uci, "e2e4");
        assert_eq!(top_move.games, 2);
        assert_eq!(top_move.last_played.as_deref(), Some("2024.02.01"));
        assert!((top_score - 0.75).abs() < f64::EPSILON);
    }

    #[test]
    fn opening_health_classifies_repertoire_gap() {
        let classification = classify_opening_health(5, 40, Some(4), 0.55, Some(0.55), 3, 20, 3);

        assert_eq!(
            classification,
            Some(RepertoireGapClassification::RepertoireGap)
        );
    }

    #[test]
    fn opening_health_classifies_prepared_underperforming() {
        let classification = classify_opening_health(5, 40, Some(2), 0.30, Some(0.55), 3, 20, 3);

        assert_eq!(
            classification,
            Some(RepertoireGapClassification::PreparedUnderperforming)
        );
    }

    #[test]
    fn opening_health_classifies_low_confidence() {
        assert_eq!(
            classify_opening_health(2, 40, Some(1), 0.80, Some(0.55), 3, 20, 3),
            Some(RepertoireGapClassification::LowConfidence)
        );
        assert_eq!(
            classify_opening_health(5, 12, Some(1), 0.80, Some(0.55), 3, 20, 3),
            Some(RepertoireGapClassification::LowConfidence)
        );
    }

    #[test]
    fn plan_explorer_sample_limit_stays_full_for_indexed_or_small_databases() {
        let fen = "rnbqkbnr/ppp1pppp/8/3p4/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 2";
        assert_eq!(
            plan_explorer_sample_limit(fen, true, 5_000_000),
            PLAN_EXPLORER_INDEXED_SAMPLES
        );
        assert_eq!(
            plan_explorer_sample_limit(fen, false, PLAN_EXPLORER_FALLBACK_FULL_SAMPLE_MAX_GAMES),
            PLAN_EXPLORER_INDEXED_SAMPLES
        );
    }

    #[test]
    fn plan_explorer_sample_limit_tapers_for_deeper_mega_fallbacks() {
        assert_eq!(
            plan_explorer_sample_limit(
                "rnbqkbnr/ppp1pppp/8/3p4/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 2",
                false,
                5_000_000,
            ),
            PLAN_EXPLORER_INDEXED_SAMPLES
        );
        assert_eq!(
            plan_explorer_sample_limit(
                "r1bqkbnr/pppppppp/2n5/8/8/2N2N2/PPPPPPPP/R1BQKB1R b KQkq - 3 3",
                false,
                5_000_000,
            ),
            3_000
        );
        assert_eq!(
            plan_explorer_sample_limit(
                "r1bqkb1r/pppppppp/2n2n2/8/8/2N2N2/PPPPPPPP/R1BQKB1R b KQkq - 4 5",
                false,
                5_000_000,
            ),
            1_500
        );
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
