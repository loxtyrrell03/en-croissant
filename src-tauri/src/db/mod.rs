pub(crate) mod encoding;
mod models;
mod ops;
mod schema;
mod search;
mod search_index;

use crate::{
    db::{
        encoding::{decode_game_to_movetext, decode_move, iter_mainline_move_bytes},
        models::*,
        ops::*,
        schema::*,
    },
    error::Error,
    opening::get_opening_from_setup,
    AppState,
};
use chrono::{NaiveDate, NaiveTime};
use dashmap::DashMap;
use diesel::{
    connection::{DefaultLoadingMode, SimpleConnection},
    insert_into,
    prelude::*,
    r2d2::{ConnectionManager, Pool},
    sql_query,
    sql_types::{BigInt, Double, Integer, Nullable, Text},
};
use pgn_reader::{BufferedReader, Nag, RawHeader, SanPlus, Skip, Visitor};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use shakmaty::{
    fen::Fen,
    zobrist::{Zobrist128, ZobristHash},
    Board, ByColor, CastlingMode, Chess, EnPassantMode, FromSetup, Piece, Position, PositionError,
};
use specta::Type;
use std::{
    collections::HashMap,
    fs::{create_dir_all, remove_file, rename, File, OpenOptions},
    path::{Path, PathBuf},
    sync::atomic::{AtomicUsize, Ordering},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use std::{
    io::{self, BufWriter, Write},
    str::FromStr,
};
use tauri::{Emitter, State};

use log::{info, warn};
use tauri_specta::Event as _;

use self::encoding::{
    encode_comment, encode_move, encode_nag, VARIATION_END_MARKER, VARIATION_START_MARKER,
};
pub use self::search_index::{
    get_index_path, MmapSearchIndex, PositionIndexKey, PositionOccurrence, SearchGameEntry,
    SearchIndex,
};

pub use self::models::NormalizedGame;
pub use self::models::Puzzle;
pub use self::schema::puzzle_themes;
pub use self::schema::puzzles;
pub use self::schema::themes;
pub use self::search::{
    cancel_database_search, find_repertoire_gaps, get_opening_health_player_positions,
    get_plan_explorer, is_position_in_db, search_position, set_database_search_paused,
    PlanExplorerData, PositionQueryJs, PositionStats,
};

const DATABASE_VERSION: &str = "1.0.0";

const INDEXES_SQL: &str = include_str!("indexes.sql");

const DELETE_INDEXES_SQL: &str = include_str!("delete_indexes.sql");

const CREATE_TABLES_SQL: &str = include_str!("create.sql");
const DB_CACHE_LIMIT: usize = 4;
const POSITION_INDEX_MAX_GAMES: usize = 100_000;
const POSITION_INDEX_MAX_MOVE_BYTES: usize = 4_000_000;

const WHITE_PAWN: Piece = Piece {
    color: shakmaty::Color::White,
    role: shakmaty::Role::Pawn,
};

const BLACK_PAWN: Piece = Piece {
    color: shakmaty::Color::Black,
    role: shakmaty::Role::Pawn,
};

type MaterialCount = ByColor<u8>;

fn get_material_count(board: &Board) -> MaterialCount {
    board.material().map(|material| {
        material.pawn
            + material.knight * 3
            + material.bishop * 3
            + material.rook * 5
            + material.queen * 9
    })
}

/// Returns the bit representation of the pawns on the second and seventh rank
/// of the given board.
fn get_pawn_home(board: &Board) -> u16 {
    let white_pawns = board.by_piece(WHITE_PAWN);
    let black_pawns = board.by_piece(BLACK_PAWN);
    let second_rank_pawns = (white_pawns.0 >> 8) as u8;
    let seventh_rank_pawns = (black_pawns.0 >> 48) as u8;
    (second_rank_pawns as u16) | ((seventh_rank_pawns as u16) << 8)
}

pub(crate) fn position_index_key(position: &Chess) -> PositionIndexKey {
    let key: Zobrist128 = position.zobrist_hash(EnPassantMode::Legal);
    PositionIndexKey {
        hi: (key.0 >> 64) as u64,
        lo: key.0 as u64,
    }
}

pub(crate) fn legacy_position_index_key(position: &Chess) -> PositionIndexKey {
    let fen = Fen::from_position(position.clone(), EnPassantMode::Legal).to_string();
    let mut parts = fen.split_whitespace();
    let board = parts.next().unwrap_or_default();
    let turn = parts.next().unwrap_or_default();
    PositionIndexKey::from_text(&format!("{board} {turn}"))
}

pub(crate) fn position_index_key_from_fen_key(key: &str) -> Option<PositionIndexKey> {
    let fen = format!("{key} 0 1");
    let fen = Fen::from_ascii(fen.as_bytes()).ok()?;
    let setup = fen.into_setup();
    let castling_mode = CastlingMode::detect(&setup);
    let position = Chess::from_setup(setup, castling_mode)
        .or_else(PositionError::ignore_too_much_material)
        .ok()?;
    Some(position_index_key(&position))
}

pub(crate) fn clear_database_search_caches(state: &AppState, file: &Path) {
    state.line_cache.retain(|key, _| key.1.as_path() != file);
    state
        .plan_explorer_cache
        .retain(|key, _| key.1.as_path() != file);

    let mut cache = state.db_cache.lock().unwrap();
    cache.retain(|(cached_file, _)| cached_file.as_path() != file);
}

fn clear_all_database_search_caches(state: &AppState) {
    state.line_cache.clear();
    state.plan_explorer_cache.clear();

    let mut cache = state.db_cache.lock().unwrap();
    cache.clear();
}

fn invalidate_database_search_index(state: &AppState, file: &Path) {
    clear_database_search_caches(state, file);

    match remove_file(get_index_path(file)) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            warn!(
                "Could not remove stale search index for {:?}; it will be refreshed by mtime checks: {}",
                file, error
            );
        }
    }
}

pub(crate) fn ensure_search_index_current(
    file: &Path,
    state: &State<'_, AppState>,
) -> Result<(), Error> {
    if MmapSearchIndex::is_up_to_date(file) {
        return Ok(());
    }

    clear_database_search_caches(state, file);
    info!(
        "Search index missing or older than {:?}, generating automatically...",
        file
    );
    generate_search_index(file, state)
}

fn starting_position_from_fen(fen: Option<&str>) -> Result<Chess, Error> {
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

fn collect_position_occurrences_for_entry(
    game_index: u32,
    entry: &SearchGameEntry,
) -> Result<Vec<PositionOccurrence>, Error> {
    let mut position = starting_position_from_fen(entry.fen.as_deref())?;
    let mut ply = 0u16;
    let mut occurrences = Vec::new();

    for byte in iter_mainline_move_bytes(&entry.moves) {
        let Some(m) = decode_move(byte, &position) else {
            break;
        };

        push_position_occurrences(&mut occurrences, &position, game_index, ply, Some(byte));
        position.play_unchecked(&m);
        ply = ply.saturating_add(1);
    }

    push_position_occurrences(&mut occurrences, &position, game_index, ply, None);

    Ok(occurrences)
}

fn push_position_occurrences(
    occurrences: &mut Vec<PositionOccurrence>,
    position: &Chess,
    game_index: u32,
    ply: u16,
    next_move: Option<u8>,
) {
    let exact_key = position_index_key(position);
    let board_turn_key = legacy_position_index_key(position);

    occurrences.push(PositionOccurrence::new(
        exact_key, game_index, ply, next_move,
    ));
    if board_turn_key != exact_key {
        occurrences.push(PositionOccurrence::new(
            board_turn_key,
            game_index,
            ply,
            next_move,
        ));
    }
}

#[derive(Debug)]
pub enum JournalMode {
    Delete,
    Off,
}

#[derive(Debug)]
pub struct ConnectionOptions {
    pub journal_mode: JournalMode,
    pub enable_foreign_keys: bool,
    pub busy_timeout: Option<Duration>,
}

impl Default for ConnectionOptions {
    fn default() -> Self {
        Self {
            journal_mode: JournalMode::Delete,
            enable_foreign_keys: true,
            busy_timeout: Some(Duration::from_secs(30)),
        }
    }
}

impl diesel::r2d2::CustomizeConnection<SqliteConnection, diesel::r2d2::Error>
    for ConnectionOptions
{
    fn on_acquire(&self, conn: &mut SqliteConnection) -> Result<(), diesel::r2d2::Error> {
        (|| {
            match self.journal_mode {
                JournalMode::Delete => conn.batch_execute("PRAGMA journal_mode = DELETE;")?,
                JournalMode::Off => conn.batch_execute("PRAGMA journal_mode = OFF;")?,
            }
            if self.enable_foreign_keys {
                conn.batch_execute("PRAGMA foreign_keys = ON;")?;
            }
            if let Some(d) = self.busy_timeout {
                conn.batch_execute(&format!("PRAGMA busy_timeout = {};", d.as_millis()))?;
            }
            Ok(())
        })()
        .map_err(diesel::r2d2::Error::QueryError)
    }
}

fn get_db_or_create(
    state: &State<AppState>,
    db_path: &str,
    options: ConnectionOptions,
) -> Result<
    diesel::r2d2::PooledConnection<diesel::r2d2::ConnectionManager<diesel::SqliteConnection>>,
    Error,
> {
    let pool = match state.connection_pool.get(db_path) {
        Some(pool) => pool.clone(),
        None => {
            let pool = Pool::builder()
                .max_size(16)
                .connection_customizer(Box::new(options))
                .build(ConnectionManager::<SqliteConnection>::new(db_path))?;
            state
                .connection_pool
                .insert(db_path.to_string(), pool.clone());
            pool
        }
    };

    Ok(pool.get()?)
}

fn update_info_count(
    db: &mut SqliteConnection,
    name: &str,
    value: i64,
) -> Result<(), diesel::result::Error> {
    diesel::insert_into(info::table)
        .values((info::name.eq(name), info::value.eq(value.to_string())))
        .on_conflict(info::name)
        .do_update()
        .set(info::value.eq(value.to_string()))
        .execute(db)?;
    Ok(())
}

fn database_table_exists(db: &mut SqliteConnection, table_name: &str) -> Result<bool, Error> {
    #[derive(QueryableByName)]
    struct TableExists {
        #[diesel(sql_type = BigInt, column_name = "count")]
        count: i64,
    }

    let result: TableExists =
        sql_query("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?")
            .bind::<Text, _>(table_name)
            .get_result(db)?;

    Ok(result.count > 0)
}

fn insert_database_metadata(
    db: &mut SqliteConnection,
    title: &str,
    description: &str,
) -> Result<(), Error> {
    for (name, value) in [
        ("Version", DATABASE_VERSION),
        ("Title", title),
        ("Description", description),
    ] {
        diesel::insert_into(info::table)
            .values((info::name.eq(name), info::value.eq(value)))
            .on_conflict(info::name)
            .do_update()
            .set(info::value.eq(value))
            .execute(db)?;
    }

    Ok(())
}

fn ensure_database_schema_for_import(
    db: &mut SqliteConnection,
    title: &str,
    description: &str,
) -> Result<bool, Error> {
    if database_table_exists(db, "Info")? {
        return Ok(false);
    }

    let has_games = database_table_exists(db, "Games")?;
    let has_players = database_table_exists(db, "Players")?;

    if !has_games && !has_players {
        db.batch_execute(CREATE_TABLES_SQL)?;
        insert_database_metadata(db, title, description)?;
        return Ok(true);
    }

    db.batch_execute(
        "CREATE TABLE IF NOT EXISTS Info (
            Name TEXT UNIQUE NOT NULL,
            Value TEXT
        );",
    )?;
    insert_database_metadata(db, title, description)?;
    Ok(false)
}

#[derive(Debug)]
pub struct MaterialColor {
    white: u8,
    black: u8,
}

impl Default for MaterialColor {
    fn default() -> Self {
        Self {
            white: 39,
            black: 39,
        }
    }
}

#[derive(Default, Debug)]
pub struct TempGame {
    pub event_name: Option<String>,
    pub site_name: Option<String>,
    pub study_name: Option<String>,
    pub chapter_name: Option<String>,
    pub date: Option<String>,
    pub time: Option<String>,
    pub round: Option<String>,
    pub white_name: Option<String>,
    pub white_elo: Option<i32>,
    pub black_name: Option<String>,
    pub black_elo: Option<i32>,
    pub result: Option<String>,
    pub time_control: Option<String>,
    pub eco: Option<String>,
    pub fen: Option<String>,
    pub moves: Vec<u8>,
    pub position: Chess,
    pub material_count: MaterialColor,
}

impl TempGame {
    fn apply_study_title_to_event(&mut self) {
        let study_name = clean_import_header(self.study_name.as_deref());
        let chapter_name = clean_import_header(self.chapter_name.as_deref());

        let Some(study_name) = study_name else {
            return;
        };

        let study_event = match chapter_name {
            Some(chapter_name) if !same_text(&chapter_name, &study_name) => {
                format!("{study_name} - {chapter_name}")
            }
            _ => study_name,
        };

        self.event_name = Some(study_event);
    }

    pub fn insert_to_db(&self, db: &mut SqliteConnection) -> Result<(), diesel::result::Error> {
        let pawn_home = get_pawn_home(self.position.board());

        let white_id = if let Some(name) = &self.white_name {
            create_player(db, name)?.id
        } else {
            0
        };
        let black_id = if let Some(name) = &self.black_name {
            create_player(db, name)?.id
        } else {
            0
        };

        let event_id = if let Some(name) = &self.event_name {
            create_event(db, name)?.id
        } else {
            0
        };

        let site_id = if let Some(name) = &self.site_name {
            create_site(db, name)?.id
        } else {
            0
        };

        let ply_count = iter_mainline_move_bytes(&self.moves).count() as i32;
        let final_material = get_material_count(self.position.board());
        let minimal_white_material = self.material_count.white.min(final_material.white) as i32;
        let minimal_black_material = self.material_count.black.min(final_material.black) as i32;

        let new_game = NewGame {
            white_id,
            black_id,
            ply_count,
            eco: self.eco.as_deref(),
            round: self.round.as_deref(),
            white_elo: self.white_elo,
            black_elo: self.black_elo,
            white_material: minimal_white_material,
            black_material: minimal_black_material,
            // max_rating: self.game.white.rating.max(self.game.black.rating),
            date: self.date.as_deref(),
            time: self.time.as_deref(),
            time_control: self.time_control.as_deref(),
            site_id,
            event_id,
            fen: self.fen.as_deref(),
            result: self.result.as_deref(),
            moves: self.moves.as_slice(),
            pawn_home: pawn_home as i32,
        };

        create_game(db, new_game)?;
        Ok(())
    }
}

fn clean_import_header(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() || value == "?" || value == "-" {
        None
    } else {
        Some(value.to_string())
    }
}

fn same_text(left: &str, right: &str) -> bool {
    left.trim().eq_ignore_ascii_case(right.trim())
}

struct Importer {
    game: TempGame,
    timestamp: Option<i64>,
    skip: bool,
    frames: Vec<ImportFrame>,
}

struct ImportFrame {
    position: Chess,
    pre_move_positions: Vec<Chess>,
}

impl ImportFrame {
    fn new(position: Chess) -> Self {
        Self {
            position,
            pre_move_positions: Vec::new(),
        }
    }
}

impl Importer {
    fn new(timestamp: Option<i64>) -> Importer {
        Importer {
            game: TempGame::default(),
            timestamp,
            skip: false,
            frames: Vec::new(),
        }
    }
}

impl Visitor for Importer {
    type Result = Option<TempGame>;

    fn begin_game(&mut self) {
        self.game = TempGame::default();
        self.skip = false;
        self.frames.clear();
    }

    fn header(&mut self, key: &[u8], value: RawHeader<'_>) {
        if key == b"White" {
            self.game.white_name = Some(value.decode_utf8_lossy().into_owned());
        } else if key == b"Black" {
            self.game.black_name = Some(value.decode_utf8_lossy().into_owned());
        } else if key == b"WhiteElo" {
            if value.as_bytes() == b"-" {
                self.game.white_elo = Some(0);
            } else {
                self.game.white_elo = btoi::btoi(value.as_bytes()).ok();
            }
        } else if key == b"BlackElo" {
            if value.as_bytes() == b"-" {
                self.game.black_elo = Some(0);
            } else {
                self.game.black_elo = btoi::btoi(value.as_bytes()).ok();
            }
        } else if key == b"TimeControl" {
            self.game.time_control = Some(value.decode_utf8_lossy().into_owned());
        } else if key == b"ECO" {
            self.game.eco = Some(value.decode_utf8_lossy().into_owned());
        } else if key == b"Round" {
            self.game.round = Some(value.decode_utf8_lossy().into_owned());
        } else if key == b"Date" || key == b"UTCDate" {
            self.game.date = Some(String::from_utf8_lossy(value.as_bytes()).to_string());
        } else if key == b"UTCTime" {
            self.game.time = Some(String::from_utf8_lossy(value.as_bytes()).to_string());
        } else if key == b"Site" {
            self.game.site_name = Some(String::from_utf8_lossy(value.as_bytes()).to_string());
        } else if key == b"Event" {
            self.game.event_name = Some(String::from_utf8_lossy(value.as_bytes()).to_string());
        } else if key == b"StudyName" {
            self.game.study_name = Some(String::from_utf8_lossy(value.as_bytes()).to_string());
        } else if key == b"ChapterName" {
            self.game.chapter_name = Some(String::from_utf8_lossy(value.as_bytes()).to_string());
        } else if key == b"Result" {
            self.game.result = Some(String::from_utf8_lossy(value.as_bytes()).to_string());
        } else if key == b"FEN" {
            if value.as_bytes() == b"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" {
                self.game.fen = None;
            } else {
                let fen = Fen::from_ascii(value.as_bytes());
                if let Ok(fen) = fen {
                    self.game.fen = Some(value.decode_utf8_lossy().into_owned());
                    let setup = fen.into_setup();
                    let castling_mode = CastlingMode::detect(&setup);
                    if let Ok(setup) = Chess::from_setup(setup, castling_mode)
                        .or_else(PositionError::ignore_too_much_material)
                    {
                        self.game.position = setup;
                    } else {
                        self.skip = true;
                    }
                } else {
                    self.skip = true;
                }
            }
        }
    }

    fn end_headers(&mut self) -> Skip {
        self.game.apply_study_title_to_event();

        // Skip games with timestamp before
        let cur_timestamp = self.game.date.as_ref().and_then(|date| {
            let date = NaiveDate::parse_from_str(date, "%Y.%m.%d").ok()?;
            let time = self
                .game
                .time
                .as_ref()
                .and_then(|time| NaiveTime::parse_from_str(time, "%H:%M:%S").ok())?;
            Some(date.and_time(time).and_utc().timestamp())
        });

        if let (Some(cur_timestamp), Some(timestamp)) = (cur_timestamp, self.timestamp) {
            if cur_timestamp <= timestamp {
                self.skip = true;
            }
        }

        // Skip games without ELO
        // self.skip |= self.current.white_elo.is_none() || self.current.black_elo.is_none();

        self.frames.clear();
        self.frames
            .push(ImportFrame::new(self.game.position.clone()));

        Skip(self.skip)
    }

    fn san(&mut self, san: SanPlus) {
        if self.frames.is_empty() {
            self.frames
                .push(ImportFrame::new(self.game.position.clone()));
        }

        let is_mainline = self.frames.len() == 1;
        let frame = self.frames.last_mut().unwrap();
        let pre_move_position = frame.position.clone();

        let m = san.san.to_move(&frame.position).ok();
        if let Some(m) = m {
            if is_mainline && m.is_promotion() {
                let cur_material = get_material_count(frame.position.board());
                if cur_material.white < self.game.material_count.white {
                    self.game.material_count.white = cur_material.white;
                }
                if cur_material.black < self.game.material_count.black {
                    self.game.material_count.black = cur_material.black;
                }
            }
            self.game
                .moves
                .push(encode_move(&m, &frame.position).unwrap());
            frame.pre_move_positions.push(pre_move_position);
            frame.position.play_unchecked(&m);

            if is_mainline {
                self.game.position = frame.position.clone();
            }
        } else {
            self.skip = true;
        }
    }

    fn begin_variation(&mut self) -> Skip {
        if self.frames.is_empty() {
            self.frames
                .push(ImportFrame::new(self.game.position.clone()));
        }

        let parent = self.frames.last().unwrap();
        let variation_start = parent
            .pre_move_positions
            .last()
            .cloned()
            .unwrap_or_else(|| parent.position.clone());

        self.game.moves.push(VARIATION_START_MARKER);
        self.frames.push(ImportFrame::new(variation_start));
        Skip(false)
    }

    fn end_variation(&mut self) {
        self.game.moves.push(VARIATION_END_MARKER);
        if self.frames.len() > 1 {
            self.frames.pop();
        } else {
            self.skip = true;
        }

        if let Some(root) = self.frames.first() {
            self.game.position = root.position.clone();
        }
    }

    fn comment(&mut self, comment: pgn_reader::RawComment<'_>) {
        let comment = String::from_utf8_lossy(comment.as_bytes());
        encode_comment(comment.as_ref(), &mut self.game.moves);
    }

    fn nag(&mut self, nag: Nag) {
        encode_nag(&nag.to_string(), &mut self.game.moves);
    }

    fn end_game(&mut self) -> Self::Result {
        self.frames.clear();
        if self.skip {
            self.game = TempGame::default();
            None
        } else {
            Some(std::mem::take(&mut self.game))
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn convert_pgn(
    file: PathBuf,
    db_path: PathBuf,
    timestamp: Option<f64>,
    app: tauri::AppHandle,
    title: String,
    description: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    convert_pgn_inner(&file, &db_path, timestamp, &app, title, description, &state)
}

struct ActiveConversionGuard<'a> {
    conversions: &'a DashMap<String, ()>,
    key: String,
}

impl Drop for ActiveConversionGuard<'_> {
    fn drop(&mut self) {
        self.conversions.remove(&self.key);
    }
}

fn convert_pgn_inner(
    file: &Path,
    db_path: &Path,
    timestamp: Option<f64>,
    app: &tauri::AppHandle,
    title: String,
    description: Option<String>,
    state: &tauri::State<'_, AppState>,
) -> Result<(), Error> {
    // Imports run with the rollback journal disabled, so two conversions
    // writing the same database (e.g. an auto-update starting while a convert
    // orphaned by a webview reload is still running) can corrupt it.
    let conversion_key = db_path.to_string_lossy().to_string();
    let _conversion_guard = match state.active_conversions.entry(conversion_key.clone()) {
        dashmap::mapref::entry::Entry::Occupied(_) => {
            return Err(Error::ConversionInProgress(conversion_key));
        }
        dashmap::mapref::entry::Entry::Vacant(entry) => {
            entry.insert(());
            ActiveConversionGuard {
                conversions: &state.active_conversions,
                key: conversion_key,
            }
        }
    };

    let description = description.unwrap_or_default();
    let extension = file.extension();

    // create the database file
    let db = &mut get_db_or_create(
        &state,
        db_path.to_str().unwrap(),
        ConnectionOptions {
            enable_foreign_keys: false,
            busy_timeout: None,
            journal_mode: JournalMode::Off,
        },
    )?;

    let schema_created = ensure_database_schema_for_import(db, &title, &description)?;

    let file = File::open(&file)?;

    let uncompressed: Box<dyn std::io::Read + Send> = if extension == Some("bz2".as_ref()) {
        Box::new(bzip2::read::MultiBzDecoder::new(file))
    } else if extension == Some("zst".as_ref()) {
        Box::new(zstd::Decoder::new(file)?)
    } else {
        Box::new(file)
    };

    // start counting time
    let start = Instant::now();

    let mut importer = Importer::new(timestamp.map(|t| t.floor() as i64));
    db.transaction::<_, diesel::result::Error, _>(|db| {
        for (i, game) in BufferedReader::new(uncompressed)
            .into_iter(&mut importer)
            .flatten()
            .flatten()
            .enumerate()
        {
            if i % 1000 == 0 {
                let elapsed = start.elapsed().as_millis() as u32;
                // A failed emit (e.g. webview mid-reload) must not panic: the
                // panic would drop the invoke responder and leave the frontend
                // awaiting this command forever.
                let _ = app.emit("convert_progress", (i, elapsed));
            }
            game.insert_to_db(db)?;
        }
        Ok(())
    })?;

    if schema_created {
        // Create all the necessary indexes
        db.batch_execute(INDEXES_SQL)?;
    }

    // get game, player, event and site counts and to the info table
    let game_count: i64 = games::table.count().get_result(db)?;
    let player_count: i64 = players::table.count().get_result(db)?;
    let event_count: i64 = events::table.count().get_result(db)?;
    let site_count: i64 = sites::table.count().get_result(db)?;

    let counts = [
        ("GameCount", game_count),
        ("PlayerCount", player_count),
        ("EventCount", event_count),
        ("SiteCount", site_count),
    ];

    for c in counts.iter() {
        insert_into(info::table)
            .values((info::name.eq(c.0), info::value.eq(c.1.to_string())))
            .on_conflict(info::name)
            .do_update()
            .set(info::value.eq(c.1.to_string()))
            .execute(db)?;
    }

    invalidate_database_search_index(state, db_path);

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn replace_database_from_pgn(
    file: PathBuf,
    db_path: PathBuf,
    app: tauri::AppHandle,
    title: String,
    description: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    let temp_db_path = replacement_temp_database_path(&db_path);
    remove_file_if_exists(&temp_db_path)?;
    remove_file_if_exists(get_index_path(&temp_db_path))?;

    if let Err(error) =
        convert_pgn_inner(&file, &temp_db_path, None, &app, title, description, &state)
    {
        let _ = remove_file_if_exists(&temp_db_path);
        let _ = remove_file_if_exists(get_index_path(&temp_db_path));
        return Err(error);
    }

    if let Some(temp_path) = temp_db_path.to_str() {
        state.connection_pool.remove(temp_path);
    }
    if let Some(path) = db_path.to_str() {
        state.connection_pool.remove(path);
    }
    clear_database_search_caches(&state, &db_path);

    remove_file_if_exists(get_index_path(&db_path))?;
    remove_file_if_exists(&db_path)?;
    rename(&temp_db_path, &db_path)?;
    remove_file_if_exists(get_index_path(&temp_db_path))?;
    invalidate_database_search_index(&state, &db_path);

    Ok(())
}

fn replacement_temp_database_path(db_path: &Path) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let filename = db_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("database.db3");
    db_path.with_file_name(format!(".{filename}.{suffix}.tmp.db3"))
}

fn remove_file_if_exists(path: impl AsRef<Path>) -> Result<(), Error> {
    match remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

pub fn generate_search_index(
    db_path: &Path,
    state: &tauri::State<'_, AppState>,
) -> Result<(), Error> {
    let db = &mut get_db_or_create(
        state,
        db_path.to_str().unwrap(),
        ConnectionOptions::default(),
    )?;
    let index_path = get_index_path(db_path);

    info!("Generating search index at {:?}", index_path);
    let start = Instant::now();

    let games: Vec<(
        i32,
        i32,
        i32,
        Option<String>,
        Option<String>,
        Vec<u8>,
        Option<String>,
        i32,
        i32,
        i32,
        Option<i32>,
        Option<i32>,
    )> = games::table
        .select((
            games::id,
            games::white_id,
            games::black_id,
            games::date,
            games::result,
            games::moves,
            games::fen,
            games::pawn_home,
            games::white_material,
            games::black_material,
            games::white_elo,
            games::black_elo,
        ))
        .load(db)?;

    let include_position_index = games.len() <= POSITION_INDEX_MAX_GAMES
        && games
            .iter()
            .map(|(_, _, _, _, _, moves, _, _, _, _, _, _)| moves.len())
            .sum::<usize>()
            <= POSITION_INDEX_MAX_MOVE_BYTES;

    if !include_position_index {
        info!(
            "Skipping position occurrence index for {:?}: {} games is too large for synchronous indexing",
            db_path,
            games.len()
        );
    }

    let mut writer = SearchIndex::with_capacity(games.len());
    for (
        id,
        white_id,
        black_id,
        date,
        result,
        moves,
        fen,
        pawn_home,
        white_material,
        black_material,
        white_elo,
        black_elo,
    ) in games
    {
        let game_index = writer.entries.len() as u32;
        let entry = SearchGameEntry::from_game_data(
            id,
            white_id,
            black_id,
            date,
            result,
            moves,
            fen,
            pawn_home,
            white_material,
            black_material,
            white_elo,
            black_elo,
        );
        if include_position_index {
            for occurrence in collect_position_occurrences_for_entry(game_index, &entry)? {
                writer.push_occurrence(occurrence);
            }
        }
        writer.push(entry);
    }
    writer.write_to(&index_path)?;

    info!("Search index generated in {:?}", start.elapsed());
    Ok(())
}

#[derive(Serialize, Type)]
pub struct DatabaseInfo {
    title: String,
    description: String,
    player_count: i32,
    event_count: i32,
    game_count: i32,
    storage_size: u64,
    filename: String,
    indexed: bool,
}

#[derive(QueryableByName, Debug, Serialize)]
struct IndexInfo {
    #[diesel(sql_type = Text, column_name = "name")]
    _name: String,
}

fn check_index_exists(conn: &mut SqliteConnection) -> Result<bool, Error> {
    let query = sql_query("SELECT name FROM pragma_index_list('Games');");
    let indexes: Vec<IndexInfo> = query.load(conn)?;
    Ok(!indexes.is_empty())
}

#[tauri::command]
#[specta::specta]
pub async fn get_db_info(
    file: PathBuf,
    state: tauri::State<'_, AppState>,
) -> Result<DatabaseInfo, Error> {
    info!("get_db_info {:?}", file);

    let path = file;

    let db = &mut get_db_or_create(&state, path.to_str().unwrap(), ConnectionOptions::default())?;

    let info_records: Vec<Info> = info::table.load(db)?;

    let get_info_value = |key: &str| -> Option<String> {
        info_records
            .iter()
            .find(|i| i.name == key)
            .and_then(|i| i.value.clone())
    };

    let title = get_info_value("Title").unwrap_or_else(|| "Untitled".to_string());
    let description = get_info_value("Description").unwrap_or_default();
    let player_count = get_info_value("PlayerCount")
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(0);
    let game_count = get_info_value("GameCount")
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(0);
    let event_count = get_info_value("EventCount")
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(0);

    let storage_size = path.metadata()?.len();
    let filename = path.file_name().expect("get filename").to_string_lossy();

    let is_indexed = check_index_exists(db)?;
    Ok(DatabaseInfo {
        title,
        description,
        player_count,
        game_count,
        event_count,
        storage_size,
        filename: filename.to_string(),
        indexed: is_indexed,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn create_indexes(file: PathBuf, state: tauri::State<'_, AppState>) -> Result<(), Error> {
    let db = &mut get_db_or_create(&state, file.to_str().unwrap(), ConnectionOptions::default())?;

    ensure_mistake_review_move_evals_schema(db)?;
    db.batch_execute(INDEXES_SQL)?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_indexes(file: PathBuf, state: tauri::State<'_, AppState>) -> Result<(), Error> {
    let db = &mut get_db_or_create(&state, file.to_str().unwrap(), ConnectionOptions::default())?;

    db.batch_execute(DELETE_INDEXES_SQL)?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn edit_db_info(
    file: PathBuf,
    title: Option<String>,
    description: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    let db = &mut get_db_or_create(&state, file.to_str().unwrap(), ConnectionOptions::default())?;

    if let Some(title) = title {
        diesel::insert_into(info::table)
            .values((info::name.eq("Title"), info::value.eq(title.clone())))
            .on_conflict(info::name)
            .do_update()
            .set(info::value.eq(title))
            .execute(db)?;
    }

    if let Some(description) = description {
        diesel::insert_into(info::table)
            .values((
                info::name.eq("Description"),
                info::value.eq(description.clone()),
            ))
            .on_conflict(info::name)
            .do_update()
            .set(info::value.eq(description))
            .execute(db)?;
    }

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, Type)]
pub enum Sides {
    BlackWhite,
    WhiteBlack,
    Any,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, Type)]
pub enum GameSort {
    #[default]
    #[serde(rename = "id")]
    Id,
    #[serde(rename = "date")]
    Date,
    #[serde(rename = "whiteElo")]
    WhiteElo,
    #[serde(rename = "blackElo")]
    BlackElo,
    #[serde(rename = "ply_count")]
    PlyCount,
}

#[derive(Default, Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, Type)]
pub enum SortDirection {
    #[serde(rename = "asc")]
    Asc,
    #[default]
    #[serde(rename = "desc")]
    Desc,
}

#[derive(Default, Debug, Clone, Deserialize, PartialEq, Eq, Hash, Type)]
#[serde(rename_all = "camelCase")]
pub struct QueryOptions<SortT> {
    pub skip_count: bool,
    #[specta(optional)]
    pub page: Option<i32>,
    #[specta(optional)]
    pub page_size: Option<i32>,
    pub sort: SortT,
    pub direction: SortDirection,
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq, Hash, Type)]
pub struct GameQuery {
    #[specta(optional)]
    pub options: Option<QueryOptions<GameSort>>,
    #[specta(optional)]
    pub player1: Option<i32>,
    #[specta(optional)]
    pub player2: Option<i32>,
    #[specta(optional)]
    pub tournament_id: Option<i32>,
    #[specta(optional)]
    pub start_date: Option<String>,
    #[specta(optional)]
    pub end_date: Option<String>,
    #[specta(optional)]
    pub range1: Option<(i32, i32)>,
    #[specta(optional)]
    pub range2: Option<(i32, i32)>,
    #[specta(optional)]
    pub sides: Option<Sides>,
    #[specta(optional)]
    pub outcome: Option<String>,
    #[specta(optional)]
    pub position: Option<PositionQueryJs>,
    #[specta(optional)]
    pub wanted_result: Option<String>,
}

impl GameQuery {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn position(mut self, position: PositionQueryJs) -> Self {
        self.position = Some(position);
        self
    }
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct QueryResponse<T> {
    pub data: T,
    pub count: Option<i32>,
}

#[tauri::command]
#[specta::specta]
pub async fn get_games(
    file: PathBuf,
    query: GameQuery,
    state: tauri::State<'_, AppState>,
) -> Result<QueryResponse<Vec<NormalizedGame>>, Error> {
    let db = &mut get_db_or_create(&state, file.to_str().unwrap(), ConnectionOptions::default())?;

    let mut count: Option<i64> = None;
    let query_options = query.options.unwrap_or_default();

    let (white_players, black_players) = diesel::alias!(players as white, players as black);
    let mut sql_query = games::table
        .inner_join(white_players.on(games::white_id.eq(white_players.field(players::id))))
        .inner_join(black_players.on(games::black_id.eq(black_players.field(players::id))))
        .inner_join(events::table.on(games::event_id.eq(events::id)))
        .inner_join(sites::table.on(games::site_id.eq(sites::id)))
        .into_boxed();
    let mut count_query = games::table.into_boxed();

    // if let Some(speed) = query.speed {
    //     sql_query = sql_query.filter(games::speed.eq(speed as i32));
    //     count_query = count_query.filter(games::speed.eq(speed as i32));
    // }

    if let Some(outcome) = query.outcome {
        sql_query = sql_query.filter(games::result.eq(outcome.clone()));
        count_query = count_query.filter(games::result.eq(outcome));
    }

    if let Some(start_date) = query.start_date {
        sql_query = sql_query.filter(games::date.ge(start_date.clone()));
        count_query = count_query.filter(games::date.ge(start_date));
    }

    if let Some(end_date) = query.end_date {
        sql_query = sql_query.filter(games::date.le(end_date.clone()));
        count_query = count_query.filter(games::date.le(end_date));
    }

    if let Some(tournament_id) = query.tournament_id {
        sql_query = sql_query.filter(games::event_id.eq(tournament_id));
        count_query = count_query.filter(games::event_id.eq(tournament_id));
    }

    if let Some(limit) = query_options.page_size {
        sql_query = sql_query.limit(limit as i64);
    }

    if let Some(page) = query_options.page {
        sql_query = sql_query.offset(((page - 1) * query_options.page_size.unwrap_or(10)) as i64);
    }

    match query.sides {
        Some(Sides::BlackWhite) => {
            if let Some(player1) = query.player1 {
                sql_query = sql_query.filter(games::black_id.eq(player1));
                count_query = count_query.filter(games::black_id.eq(player1));
            }
            if let Some(player2) = query.player2 {
                sql_query = sql_query.filter(games::white_id.eq(player2));
                count_query = count_query.filter(games::white_id.eq(player2));
            }

            if let Some(range1) = query.range1 {
                sql_query = sql_query.filter(games::black_elo.between(range1.0, range1.1));
                count_query = count_query.filter(games::black_elo.between(range1.0, range1.1));
            }

            if let Some(range2) = query.range2 {
                sql_query = sql_query.filter(games::white_elo.between(range2.0, range2.1));
                count_query = count_query.filter(games::white_elo.between(range2.0, range2.1));
            }
        }
        Some(Sides::WhiteBlack) => {
            if let Some(player1) = query.player1 {
                sql_query = sql_query.filter(games::white_id.eq(player1));
                count_query = count_query.filter(games::white_id.eq(player1));
            }
            if let Some(player2) = query.player2 {
                sql_query = sql_query.filter(games::black_id.eq(player2));
                count_query = count_query.filter(games::black_id.eq(player2));
            }

            if let Some(range1) = query.range1 {
                sql_query = sql_query.filter(games::white_elo.between(range1.0, range1.1));
                count_query = count_query.filter(games::white_elo.between(range1.0, range1.1));
            }

            if let Some(range2) = query.range2 {
                sql_query = sql_query.filter(games::black_elo.between(range2.0, range2.1));
                count_query = count_query.filter(games::black_elo.between(range2.0, range2.1));
            }
        }
        Some(Sides::Any) => {
            if let Some(player1) = query.player1 {
                sql_query =
                    sql_query.filter(games::white_id.eq(player1).or(games::black_id.eq(player1)));
                count_query =
                    count_query.filter(games::white_id.eq(player1).or(games::black_id.eq(player1)));
            }
            if let Some(player2) = query.player2 {
                sql_query =
                    sql_query.filter(games::white_id.eq(player2).or(games::black_id.eq(player2)));
                count_query =
                    count_query.filter(games::white_id.eq(player2).or(games::black_id.eq(player2)));
            }

            if let (Some(range1), Some(range2)) = (query.range1, query.range2) {
                sql_query = sql_query.filter(
                    games::white_elo
                        .between(range1.0, range1.1)
                        .or(games::black_elo.between(range1.0, range1.1))
                        .or(games::white_elo
                            .between(range2.0, range2.1)
                            .or(games::black_elo.between(range2.0, range2.1))),
                );
                count_query = count_query.filter(
                    games::white_elo
                        .between(range1.0, range1.1)
                        .or(games::black_elo.between(range1.0, range1.1))
                        .or(games::white_elo
                            .between(range2.0, range2.1)
                            .or(games::black_elo.between(range2.0, range2.1))),
                );
            } else {
                if let Some(range1) = query.range1 {
                    sql_query = sql_query.filter(
                        games::white_elo
                            .between(range1.0, range1.1)
                            .or(games::black_elo.between(range1.0, range1.1)),
                    );
                    count_query = count_query.filter(
                        games::white_elo
                            .between(range1.0, range1.1)
                            .or(games::black_elo.between(range1.0, range1.1)),
                    );
                }

                if let Some(range2) = query.range2 {
                    sql_query = sql_query.filter(
                        games::white_elo
                            .between(range2.0, range2.1)
                            .or(games::black_elo.between(range2.0, range2.1)),
                    );
                    count_query = count_query.filter(
                        games::white_elo
                            .between(range2.0, range2.1)
                            .or(games::black_elo.between(range2.0, range2.1)),
                    );
                }
            }
        }
        None => {}
    }

    sql_query = match query_options.sort {
        GameSort::Id => match query_options.direction {
            SortDirection::Asc => sql_query.order(games::id.asc()),
            SortDirection::Desc => sql_query.order(games::id.desc()),
        },
        GameSort::Date => match query_options.direction {
            SortDirection::Asc => sql_query.order((games::date.asc(), games::time.asc())),
            SortDirection::Desc => sql_query.order((games::date.desc(), games::time.desc())),
        },
        GameSort::WhiteElo => match query_options.direction {
            SortDirection::Asc => sql_query.order(games::white_elo.asc()),
            SortDirection::Desc => sql_query.order(games::white_elo.desc()),
        },
        GameSort::BlackElo => match query_options.direction {
            SortDirection::Asc => sql_query.order(games::black_elo.asc()),
            SortDirection::Desc => sql_query.order(games::black_elo.desc()),
        },
        GameSort::PlyCount => match query_options.direction {
            SortDirection::Asc => sql_query.order(games::ply_count.asc()),
            SortDirection::Desc => sql_query.order(games::ply_count.desc()),
        },
    };

    if !query_options.skip_count {
        count = Some(
            count_query
                .select(diesel::dsl::count(games::id))
                .first(db)?,
        );
    }

    // println!(
    //     "{:?}\n",
    //     diesel::debug_query::<diesel::sqlite::Sqlite, _>(&sql_query)
    // );

    let games: Vec<(Game, Player, Player, Event, Site)> = sql_query.load(db)?;
    let normalized_games = normalize_games(games);

    Ok(QueryResponse {
        data: normalized_games,
        count: count.map(|c| c as i32),
    })
}

fn normalize_games(games: Vec<(Game, Player, Player, Event, Site)>) -> Vec<NormalizedGame> {
    games
        .into_iter()
        .map(|(game, white, black, event, site)| {
            let fen: Fen = game
                .fen
                .map(|f| Fen::from_ascii(f.as_bytes()).unwrap())
                .unwrap_or_default();
            let game_result = game.result.clone().unwrap_or_default();
            let result_token = if game_result.is_empty() {
                "*".to_string()
            } else {
                game_result.clone()
            };

            NormalizedGame {
                id: game.id,
                event: event.name.unwrap_or_default(),
                event_id: event.id,
                site: site.name.unwrap_or_default(),
                site_id: site.id,
                date: game.date,
                time: game.time,
                round: game.round,
                white: white.name.unwrap_or_default(),
                white_id: game.white_id,
                white_elo: game.white_elo,
                black: black.name.unwrap_or_default(),
                black_id: game.black_id,
                black_elo: game.black_elo,
                result: Outcome::from_str(&game_result).unwrap_or_default(),
                time_control: game.time_control,
                eco: game.eco,
                ply_count: game.ply_count,
                fen: fen.to_string(),
                moves: {
                    let movetext = decode_game_to_movetext(&game.moves, fen).unwrap_or_default();
                    if movetext.is_empty() {
                        result_token
                    } else {
                        format!("{} {}", movetext, result_token)
                    }
                },
            }
        })
        .collect()
}

#[derive(Debug, Clone)]
pub(crate) struct MistakeReviewGameRow {
    pub id: i32,
    pub date: Option<String>,
    pub time: Option<String>,
    pub opening_name: Option<String>,
    pub white_id: i32,
    pub black_id: i32,
    pub white_name: String,
    pub white_elo: Option<i32>,
    pub black_name: String,
    pub black_elo: Option<i32>,
    pub result: Option<String>,
    pub time_control: Option<String>,
    pub fen: Option<String>,
    pub moves: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MistakeReviewGameMetadata {
    pub game_id: i32,
    pub date: Option<String>,
    pub time: Option<String>,
    pub opening_name: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn get_mistake_review_game_metadata(
    file: PathBuf,
    game_ids: Vec<i32>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<MistakeReviewGameMetadata>, Error> {
    if game_ids.is_empty() {
        return Ok(Vec::new());
    }

    let db = &mut get_db_or_create(&state, file.to_str().unwrap(), ConnectionOptions::default())?;
    let mut metadata = Vec::new();

    for chunk in game_ids.chunks(500) {
        let games: Vec<Game> = games::table.filter(games::id.eq_any(chunk)).load(db)?;
        metadata.extend(games.into_iter().map(|game| {
            let opening_name = mistake_review_game_opening_name(game.fen.as_deref(), &game.moves);
            MistakeReviewGameMetadata {
                game_id: game.id,
                date: game.date,
                time: game.time,
                opening_name,
            }
        }));
    }

    Ok(metadata)
}

pub(crate) fn load_mistake_review_games(
    file: PathBuf,
    player_id: i32,
    start_date: Option<String>,
    end_date: Option<String>,
    since_game_id: Option<i32>,
    max_games: Option<i32>,
    state: &tauri::State<'_, AppState>,
) -> Result<Vec<MistakeReviewGameRow>, Error> {
    let db = &mut get_db_or_create(state, file.to_str().unwrap(), ConnectionOptions::default())?;

    let (white_players, black_players) = diesel::alias!(players as white, players as black);
    let mut query = games::table
        .inner_join(white_players.on(games::white_id.eq(white_players.field(players::id))))
        .inner_join(black_players.on(games::black_id.eq(black_players.field(players::id))))
        .filter(
            games::white_id
                .eq(player_id)
                .or(games::black_id.eq(player_id)),
        )
        .into_boxed();

    if let Some(since_game_id) = since_game_id {
        query = query.filter(games::id.gt(since_game_id));
    }

    if let Some(start_date) = start_date {
        query = query.filter(games::date.ge(start_date));
    }

    if let Some(end_date) = end_date {
        query = query.filter(games::date.le(end_date));
    }

    query = query.order(games::id.asc());

    if let Some(max_games) = max_games {
        query = query.limit(max_games as i64);
    }

    let games: Vec<(Game, Player, Player)> = query.load(db)?;

    Ok(games.into_iter().map(mistake_review_game_row).collect())
}

pub(crate) fn load_mistake_review_games_by_ids(
    file: PathBuf,
    game_ids: &[i32],
    state: &tauri::State<'_, AppState>,
) -> Result<Vec<MistakeReviewGameRow>, Error> {
    if game_ids.is_empty() {
        return Ok(Vec::new());
    }

    let db = &mut get_db_or_create(state, file.to_str().unwrap(), ConnectionOptions::default())?;
    let (white_players, black_players) = diesel::alias!(players as white, players as black);
    let mut rows = Vec::new();

    for chunk in game_ids.chunks(500) {
        let games: Vec<(Game, Player, Player)> = games::table
            .inner_join(white_players.on(games::white_id.eq(white_players.field(players::id))))
            .inner_join(black_players.on(games::black_id.eq(black_players.field(players::id))))
            .filter(games::id.eq_any(chunk))
            .order(games::id.asc())
            .load(db)?;
        rows.extend(games.into_iter().map(mistake_review_game_row));
    }

    Ok(rows)
}

fn mistake_review_game_row((game, white, black): (Game, Player, Player)) -> MistakeReviewGameRow {
    MistakeReviewGameRow {
        opening_name: mistake_review_game_opening_name(game.fen.as_deref(), &game.moves),
        id: game.id,
        date: game.date,
        time: game.time,
        white_id: game.white_id,
        black_id: game.black_id,
        white_name: white.name.unwrap_or_default(),
        white_elo: game.white_elo,
        black_name: black.name.unwrap_or_default(),
        black_elo: game.black_elo,
        result: game.result,
        time_control: game.time_control,
        fen: game.fen,
        moves: game.moves,
    }
}

#[derive(Debug, Clone)]
pub(crate) struct MistakeReviewMoveEvalEntry {
    pub game_id: i32,
    pub ply: i32,
    pub move_number: i32,
    pub player_id: i32,
    pub player_color: String,
    pub side_to_move: String,
    pub fen: String,
    pub normalized_fen: String,
    pub fen_after: String,
    pub played_uci: String,
    pub played_san: String,
    pub best_uci: Option<String>,
    pub best_san: Option<String>,
    pub pv_uci: String,
    pub pv_san: String,
    pub cp_before: i32,
    pub cp_after: Option<i32>,
    pub cp_loss: Option<i32>,
    pub win_probability_drop: Option<f64>,
    pub requested_depth: i32,
    pub reached_depth: i32,
    pub analysis_mode: String,
    pub analysis_stage: String,
    pub fast_depth: i32,
    pub multi_pv: i32,
    pub engine_name: String,
    pub move_time_seconds: Option<f64>,
    pub clock_before_seconds: Option<f64>,
    pub clock_after_seconds: Option<f64>,
}

pub(crate) fn upsert_mistake_review_move_evals(
    file: &Path,
    entries: &[MistakeReviewMoveEvalEntry],
    state: &tauri::State<'_, AppState>,
) -> Result<usize, Error> {
    if entries.is_empty() {
        return Ok(0);
    }

    let db = &mut get_db_or_create(state, file.to_str().unwrap(), ConnectionOptions::default())?;
    Ok(upsert_mistake_review_move_evals_in_db(db, entries)?)
}

fn ensure_mistake_review_move_evals_schema(
    db: &mut SqliteConnection,
) -> Result<(), diesel::result::Error> {
    db.batch_execute(
        r#"
        CREATE TABLE IF NOT EXISTS MistakeReviewMoveEvals (
            ID INTEGER PRIMARY KEY AUTOINCREMENT,
            GameID INTEGER NOT NULL,
            Ply INTEGER NOT NULL,
            MoveNumber INTEGER NOT NULL,
            PlayerID INTEGER NOT NULL,
            PlayerColor TEXT NOT NULL,
            SideToMove TEXT NOT NULL,
            FEN TEXT NOT NULL,
            NormalizedFEN TEXT NOT NULL,
            FENAfter TEXT NOT NULL,
            PlayedUCI TEXT NOT NULL,
            PlayedSAN TEXT NOT NULL,
            BestUCI TEXT,
            BestSAN TEXT,
            PVUCI TEXT NOT NULL DEFAULT '',
            PVSAN TEXT NOT NULL DEFAULT '',
            CpBefore INTEGER NOT NULL,
            CpAfter INTEGER,
            CpLoss INTEGER,
            WinProbabilityDrop REAL,
            RequestedDepth INTEGER NOT NULL,
            ReachedDepth INTEGER NOT NULL,
            AnalysisMode TEXT NOT NULL,
            AnalysisStage TEXT NOT NULL,
            FastDepth INTEGER NOT NULL DEFAULT 0,
            MultiPV INTEGER NOT NULL DEFAULT 1,
            EngineName TEXT NOT NULL,
            MoveTimeSeconds REAL,
            ClockBeforeSeconds REAL,
            ClockAfterSeconds REAL,
            CreatedAt INTEGER NOT NULL,
            UpdatedAt INTEGER NOT NULL,
            UNIQUE(GameID, Ply, PlayerID, AnalysisMode, AnalysisStage, RequestedDepth, EngineName),
            FOREIGN KEY(GameID) REFERENCES Games(ID) ON DELETE CASCADE,
            FOREIGN KEY(PlayerID) REFERENCES Players(ID) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS mistake_review_move_evals_game_idx
            ON MistakeReviewMoveEvals(GameID);
        CREATE INDEX IF NOT EXISTS mistake_review_move_evals_player_idx
            ON MistakeReviewMoveEvals(PlayerID);
        CREATE INDEX IF NOT EXISTS mistake_review_move_evals_fen_idx
            ON MistakeReviewMoveEvals(NormalizedFEN);
        CREATE INDEX IF NOT EXISTS mistake_review_move_evals_updated_idx
            ON MistakeReviewMoveEvals(UpdatedAt);
        "#,
    )?;

    Ok(())
}

fn upsert_mistake_review_move_evals_in_db(
    db: &mut SqliteConnection,
    entries: &[MistakeReviewMoveEvalEntry],
) -> Result<usize, diesel::result::Error> {
    if entries.is_empty() {
        return Ok(0);
    }

    let now = current_timestamp_millis();
    db.transaction(|db| {
        ensure_mistake_review_move_evals_schema(db)?;

        let mut affected = 0usize;
        for entry in entries {
            affected += sql_query(
                r#"
                INSERT INTO MistakeReviewMoveEvals (
                    GameID,
                    Ply,
                    MoveNumber,
                    PlayerID,
                    PlayerColor,
                    SideToMove,
                    FEN,
                    NormalizedFEN,
                    FENAfter,
                    PlayedUCI,
                    PlayedSAN,
                    BestUCI,
                    BestSAN,
                    PVUCI,
                    PVSAN,
                    CpBefore,
                    CpAfter,
                    CpLoss,
                    WinProbabilityDrop,
                    RequestedDepth,
                    ReachedDepth,
                    AnalysisMode,
                    AnalysisStage,
                    FastDepth,
                    MultiPV,
                    EngineName,
                    MoveTimeSeconds,
                    ClockBeforeSeconds,
                    ClockAfterSeconds,
                    CreatedAt,
                    UpdatedAt
                )
                VALUES (
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?
                )
                ON CONFLICT(GameID, Ply, PlayerID, AnalysisMode, AnalysisStage, RequestedDepth, EngineName)
                DO UPDATE SET
                    MoveNumber = excluded.MoveNumber,
                    PlayerColor = excluded.PlayerColor,
                    SideToMove = excluded.SideToMove,
                    FEN = excluded.FEN,
                    NormalizedFEN = excluded.NormalizedFEN,
                    FENAfter = excluded.FENAfter,
                    PlayedUCI = excluded.PlayedUCI,
                    PlayedSAN = excluded.PlayedSAN,
                    BestUCI = excluded.BestUCI,
                    BestSAN = excluded.BestSAN,
                    PVUCI = excluded.PVUCI,
                    PVSAN = excluded.PVSAN,
                    CpBefore = excluded.CpBefore,
                    CpAfter = excluded.CpAfter,
                    CpLoss = excluded.CpLoss,
                    WinProbabilityDrop = excluded.WinProbabilityDrop,
                    ReachedDepth = excluded.ReachedDepth,
                    FastDepth = excluded.FastDepth,
                    MultiPV = excluded.MultiPV,
                    MoveTimeSeconds = excluded.MoveTimeSeconds,
                    ClockBeforeSeconds = excluded.ClockBeforeSeconds,
                    ClockAfterSeconds = excluded.ClockAfterSeconds,
                    UpdatedAt = excluded.UpdatedAt
                "#,
            )
            .bind::<Integer, _>(entry.game_id)
            .bind::<Integer, _>(entry.ply)
            .bind::<Integer, _>(entry.move_number)
            .bind::<Integer, _>(entry.player_id)
            .bind::<Text, _>(&entry.player_color)
            .bind::<Text, _>(&entry.side_to_move)
            .bind::<Text, _>(&entry.fen)
            .bind::<Text, _>(&entry.normalized_fen)
            .bind::<Text, _>(&entry.fen_after)
            .bind::<Text, _>(&entry.played_uci)
            .bind::<Text, _>(&entry.played_san)
            .bind::<Nullable<Text>, _>(entry.best_uci.clone())
            .bind::<Nullable<Text>, _>(entry.best_san.clone())
            .bind::<Text, _>(&entry.pv_uci)
            .bind::<Text, _>(&entry.pv_san)
            .bind::<Integer, _>(entry.cp_before)
            .bind::<Nullable<Integer>, _>(entry.cp_after)
            .bind::<Nullable<Integer>, _>(entry.cp_loss)
            .bind::<Nullable<Double>, _>(entry.win_probability_drop)
            .bind::<Integer, _>(entry.requested_depth)
            .bind::<Integer, _>(entry.reached_depth)
            .bind::<Text, _>(&entry.analysis_mode)
            .bind::<Text, _>(&entry.analysis_stage)
            .bind::<Integer, _>(entry.fast_depth)
            .bind::<Integer, _>(entry.multi_pv)
            .bind::<Text, _>(&entry.engine_name)
            .bind::<Nullable<Double>, _>(entry.move_time_seconds)
            .bind::<Nullable<Double>, _>(entry.clock_before_seconds)
            .bind::<Nullable<Double>, _>(entry.clock_after_seconds)
            .bind::<BigInt, _>(now)
            .bind::<BigInt, _>(now)
            .execute(db)?;
        }

        Ok(affected)
    })
}

fn current_timestamp_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn mistake_review_game_opening_name(fen: Option<&str>, moves: &[u8]) -> Option<String> {
    let mut chess = starting_position_from_fen(fen).ok()?;
    let mut setups = Vec::new();

    for (index, byte) in iter_mainline_move_bytes(moves).enumerate() {
        if index > 54 {
            break;
        }
        let Some(mv) = decode_move(byte, &chess) else {
            break;
        };
        chess.play_unchecked(&mv);
        setups.push(chess.clone().into_setup(EnPassantMode::Legal));
    }

    setups.reverse();
    setups
        .into_iter()
        .find_map(|setup| get_opening_from_setup(setup).ok())
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct PlayerQuery {
    pub options: QueryOptions<PlayerSort>,
    #[specta(optional)]
    pub name: Option<String>,
    #[specta(optional)]
    pub range: Option<(i32, i32)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub enum PlayerSort {
    #[serde(rename = "id")]
    Id,
    #[serde(rename = "name")]
    Name,
    #[serde(rename = "elo")]
    Elo,
}

#[tauri::command]
#[specta::specta]
pub async fn get_player(
    file: PathBuf,
    id: i32,
    state: tauri::State<'_, AppState>,
) -> Result<Option<Player>, Error> {
    let db = &mut get_db_or_create(&state, file.to_str().unwrap(), ConnectionOptions::default())?;
    let player = players::table
        .filter(players::id.eq(id))
        .first::<Player>(db)
        .optional()?;
    Ok(player)
}

#[derive(Debug, QueryableByName)]
struct CommonPlayerRow {
    #[diesel(sql_type = Integer)]
    id: i32,
    #[diesel(sql_type = Nullable<Text>)]
    name: Option<String>,
    #[diesel(sql_type = Nullable<Integer>)]
    elo: Option<i32>,
}

#[tauri::command]
#[specta::specta]
pub async fn get_most_common_player(
    file: PathBuf,
    state: tauri::State<'_, AppState>,
) -> Result<Option<Player>, Error> {
    let db = &mut get_db_or_create(&state, file.to_str().unwrap(), ConnectionOptions::default())?;

    let row = sql_query(
        r#"
        SELECT Players.ID AS id, Players.Name AS name, Players.Elo AS elo
        FROM Players
        INNER JOIN (
            SELECT PlayerID, SUM(GameCount) AS GameCount
            FROM (
                SELECT WhiteID AS PlayerID, COUNT(*) AS GameCount
                FROM Games
                GROUP BY WhiteID
                UNION ALL
                SELECT BlackID AS PlayerID, COUNT(*) AS GameCount
                FROM Games
                GROUP BY BlackID
            )
            GROUP BY PlayerID
        ) AS PlayerCounts ON PlayerCounts.PlayerID = Players.ID
        WHERE Players.Name IS NOT NULL AND Players.Name != 'Unknown'
        ORDER BY PlayerCounts.GameCount DESC, Players.Name ASC
        LIMIT 1
        "#,
    )
    .load::<CommonPlayerRow>(db)?
    .into_iter()
    .next();

    Ok(row.map(|row| Player {
        id: row.id,
        name: row.name,
        elo: row.elo,
    }))
}

#[tauri::command]
#[specta::specta]
pub async fn get_players(
    file: PathBuf,
    query: PlayerQuery,
    state: tauri::State<'_, AppState>,
) -> Result<QueryResponse<Vec<Player>>, Error> {
    let db = &mut get_db_or_create(&state, file.to_str().unwrap(), ConnectionOptions::default())?;
    let mut count: Option<i64> = None;

    let mut sql_query = players::table.into_boxed();
    let mut count_query = players::table.into_boxed();
    sql_query = sql_query.filter(players::name.is_not("Unknown"));
    count_query = count_query.filter(players::name.is_not("Unknown"));

    if let Some(name) = query.name {
        sql_query = sql_query.filter(players::name.like(format!("%{}%", name)));
        count_query = count_query.filter(players::name.like(format!("%{}%", name)));
    }

    if let Some(range) = query.range {
        sql_query = sql_query.filter(players::elo.between(range.0, range.1));
        count_query = count_query.filter(players::elo.between(range.0, range.1));
    }

    if !query.options.skip_count {
        count = Some(count_query.count().get_result(db)?);
    }

    if let Some(limit) = query.options.page_size {
        sql_query = sql_query.limit(limit as i64);
    }

    if let Some(page) = query.options.page {
        sql_query = sql_query.offset(((page - 1) * query.options.page_size.unwrap_or(10)) as i64);
    }

    sql_query = match query.options.sort {
        PlayerSort::Id => match query.options.direction {
            SortDirection::Asc => sql_query.order(players::id.asc()),
            SortDirection::Desc => sql_query.order(players::id.desc()),
        },
        PlayerSort::Name => match query.options.direction {
            SortDirection::Asc => sql_query.order(players::name.asc()),
            SortDirection::Desc => sql_query.order(players::name.desc()),
        },
        PlayerSort::Elo => match query.options.direction {
            SortDirection::Asc => sql_query.order(players::elo.asc()),
            SortDirection::Desc => sql_query.order(players::elo.desc()),
        },
    };

    let players = sql_query.load::<Player>(db)?;

    Ok(QueryResponse {
        data: players,
        count: count.map(|c| c as i32),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub enum TournamentSort {
    #[serde(rename = "id")]
    Id,
    #[serde(rename = "name")]
    Name,
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct TournamentQuery {
    pub options: QueryOptions<TournamentSort>,
    pub name: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn get_tournaments(
    file: PathBuf,
    query: TournamentQuery,
    state: tauri::State<'_, AppState>,
) -> Result<QueryResponse<Vec<Event>>, Error> {
    let db = &mut get_db_or_create(&state, file.to_str().unwrap(), ConnectionOptions::default())?;
    let mut count: Option<i64> = None;

    let mut sql_query = events::table.into_boxed();
    let mut count_query = events::table.into_boxed();
    sql_query = sql_query.filter(events::name.is_not("Unknown").and(events::name.is_not("")));
    count_query = count_query.filter(events::name.is_not("Unknown").and(events::name.is_not("")));

    if let Some(name) = query.name {
        sql_query = sql_query.filter(events::name.like(format!("%{}%", name)));
        count_query = count_query.filter(events::name.like(format!("%{}%", name)));
    }

    if !query.options.skip_count {
        count = Some(count_query.count().get_result(db)?);
    }

    if let Some(limit) = query.options.page_size {
        sql_query = sql_query.limit(limit as i64);
    }

    if let Some(page) = query.options.page {
        sql_query = sql_query.offset(((page - 1) * query.options.page_size.unwrap_or(10)) as i64);
    }

    sql_query = match query.options.sort {
        TournamentSort::Id => match query.options.direction {
            SortDirection::Asc => sql_query.order(events::id.asc()),
            SortDirection::Desc => sql_query.order(events::id.desc()),
        },
        TournamentSort::Name => match query.options.direction {
            SortDirection::Asc => sql_query.order(events::name.asc()),
            SortDirection::Desc => sql_query.order(events::name.desc()),
        },
    };

    let events = sql_query.load::<Event>(db)?;

    Ok(QueryResponse {
        data: events,
        count: count.map(|c| c as i32),
    })
}

#[derive(Debug, Clone, Serialize, Type, Default)]
pub struct PlayerGameInfo {
    pub site_stats_data: Vec<SiteStatsData>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, Type)]
#[repr(u8)] // Ensure minimal memory usage (as u8)
pub enum GameOutcome {
    #[default]
    Won = 0,
    Drawn = 1,
    Lost = 2,
}

impl GameOutcome {
    pub fn from_str(result_str: &str, is_white: bool) -> Option<Self> {
        match result_str {
            "1-0" => Some(if is_white {
                GameOutcome::Won
            } else {
                GameOutcome::Lost
            }),
            "1/2-1/2" => Some(GameOutcome::Drawn),
            "0-1" => Some(if is_white {
                GameOutcome::Lost
            } else {
                GameOutcome::Won
            }),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Type, Default)]
pub struct SiteStatsData {
    pub site: String,
    pub player: String,
    pub data: Vec<StatsData>,
}

#[derive(Debug, Clone, Serialize, Type, Default)]
pub struct StatsData {
    pub date: String,
    pub is_player_white: bool,
    pub player_elo: i32,
    pub result: GameOutcome,
    pub time_control: String,
    pub opening: String,
}

#[derive(Serialize, Debug, Clone, Type, tauri_specta::Event)]
pub struct DatabaseProgress {
    pub id: String,
    pub progress: f64,
}

#[tauri::command]
#[specta::specta]
pub async fn get_players_game_info(
    file: PathBuf,
    id: i32,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<PlayerGameInfo, Error> {
    let db = &mut get_db_or_create(&state, file.to_str().unwrap(), ConnectionOptions::default())?;
    let timer = Instant::now();

    let sql_query = games::table
        .inner_join(sites::table.on(games::site_id.eq(sites::id)))
        .inner_join(players::table.on(players::id.eq(id)))
        .select((
            games::white_id,
            games::black_id,
            games::result,
            games::date,
            games::moves,
            games::white_elo,
            games::black_elo,
            games::time_control,
            sites::name,
            players::name,
        ))
        .filter(games::white_id.eq(id).or(games::black_id.eq(id)))
        .filter(games::fen.is_null());

    type GameInfo = (
        i32,
        i32,
        Option<String>,
        Option<String>,
        Vec<u8>,
        Option<i32>,
        Option<i32>,
        Option<String>,
        Option<String>,
        Option<String>,
    );
    let info: Vec<GameInfo> = sql_query.load(db)?;

    let mut game_info = PlayerGameInfo::default();
    let progress = AtomicUsize::new(0);
    game_info.site_stats_data = info
        .par_iter()
        .filter_map(
            |(
                white_id,
                black_id,
                outcome,
                date,
                moves,
                white_elo,
                black_elo,
                time_control,
                site,
                player,
            )| {
                let is_white = *white_id == id;
                let is_black = *black_id == id;
                let result = GameOutcome::from_str(outcome.as_deref()?, is_white);

                if !is_white && !is_black
                    || is_white && white_elo.is_none()
                    || is_black && black_elo.is_none()
                    || result.is_none()
                    || date.is_none()
                    || site.is_none()
                    || player.is_none()
                {
                    return None;
                }

                let site = site.as_deref().map(|s| {
                    if s.starts_with("https://lichess.org/") {
                        "Lichess".to_string()
                    } else {
                        s.to_string()
                    }
                })?;

                let mut setups = vec![];
                let mut chess = Chess::default();
                for (i, byte) in iter_mainline_move_bytes(moves).enumerate() {
                    if i > 54 {
                        // max length of opening in data
                        break;
                    }
                    let Some(m) = decode_move(byte, &chess) else {
                        break;
                    };
                    chess.play_unchecked(&m);
                    setups.push(chess.clone().into_setup(EnPassantMode::Legal));
                }

                setups.reverse();
                let opening = setups
                    .iter()
                    .find_map(|setup| get_opening_from_setup(setup.clone()).ok())
                    .unwrap_or_default();

                let p = progress.fetch_add(1, Ordering::Relaxed);
                if p.is_multiple_of(1000) || p == info.len() - 1 {
                    let _ = DatabaseProgress {
                        id: id.to_string(),
                        progress: (p as f64 / info.len() as f64) * 100_f64,
                    }
                    .emit(&app);
                }

                Some(SiteStatsData {
                    site: site.clone(),
                    player: player.clone().unwrap(),
                    data: vec![StatsData {
                        date: date.clone().unwrap(),
                        is_player_white: is_white,
                        player_elo: if is_white {
                            white_elo.unwrap()
                        } else {
                            black_elo.unwrap()
                        },
                        result: result.unwrap(),
                        time_control: time_control.clone().unwrap_or_default(),
                        opening,
                    }],
                })
            },
        )
        .fold(DashMap::new, |acc, data| {
            acc.entry((data.site.clone(), data.player.clone()))
                .or_insert_with(Vec::new)
                .extend(data.data);
            acc
        })
        .reduce(DashMap::new, |acc1, acc2| {
            for ((site, player), data) in acc2 {
                acc1.entry((site, player))
                    .or_insert_with(Vec::new)
                    .extend(data);
            }
            acc1
        })
        .into_iter()
        .map(|((site, player), data)| SiteStatsData { site, player, data })
        .collect();

    println!("get_players_game_info {:?}: {:?}", file, timer.elapsed());

    Ok(game_info)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_database(
    file: PathBuf,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    let pool = &state.connection_pool;
    let path_str = file.to_str().unwrap();
    pool.remove(path_str);
    clear_database_search_caches(&state, &file);

    // delete file
    remove_file(path_str)?;
    remove_file(get_index_path(&PathBuf::from(path_str)))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn move_database(
    file: PathBuf,
    new_file: PathBuf,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    if file == new_file {
        return Ok(());
    }

    if new_file.exists() {
        return Err(Error::from(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!("Database already exists at {}", new_file.display()),
        )));
    }

    if let Some(parent) = new_file.parent() {
        create_dir_all(parent)?;
    }

    let pool = &state.connection_pool;
    if let Some(path) = file.to_str() {
        pool.remove(path);
    }
    if let Some(path) = new_file.to_str() {
        pool.remove(path);
    }
    clear_database_search_caches(&state, &file);
    clear_database_search_caches(&state, &new_file);

    rename(&file, &new_file)?;

    let old_index = get_index_path(&file);
    if old_index.exists() {
        let new_index = get_index_path(&new_file);
        if new_index.exists() {
            remove_file(&new_index)?;
        }
        rename(old_index, new_index)?;
    }

    Ok(())
}

fn delete_orphaned_data(db: &mut SqliteConnection) -> Result<(), Error> {
    db.batch_execute(
        "
        DELETE FROM Players WHERE ID != 0 AND ID NOT IN (
            SELECT WhiteID FROM Games UNION SELECT BlackID FROM Games
        );
        DELETE FROM Events WHERE ID != 0 AND ID NOT IN (
            SELECT EventID FROM Games
        );
        DELETE FROM Sites WHERE ID != 0 AND ID NOT IN (
            SELECT SiteID FROM Games
        );
        ",
    )?;

    let player_count: i64 = players::table.count().get_result(db)?;
    update_info_count(db, "PlayerCount", player_count)?;

    let event_count: i64 = events::table.count().get_result(db)?;
    update_info_count(db, "EventCount", event_count)?;

    let site_count: i64 = sites::table.count().get_result(db)?;
    update_info_count(db, "SiteCount", site_count)?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_duplicated_games(
    file: PathBuf,
    state: tauri::State<'_, AppState>,
) -> Result<DuplicateGameCleanupReport, Error> {
    let db = &mut get_db_or_create(&state, file.to_str().unwrap(), ConnectionOptions::default())?;
    let report = delete_duplicated_games_in_db(db)?;

    let game_count: i64 = games::table.count().get_result(db)?;
    update_info_count(db, "GameCount", game_count)?;
    delete_orphaned_data(db)?;
    invalidate_database_search_index(&state, &file);

    Ok(report)
}

#[derive(Debug, Clone, Default, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGameCleanupReport {
    pub deleted_games: u32,
    pub enriched_games: u32,
}

#[derive(Debug, Clone, Default, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseClockCoverage {
    pub game_count: u32,
    pub games_with_timing: u32,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct DuplicateGameKey {
    event_id: i32,
    site_id: i32,
    date: Option<String>,
    time: Option<String>,
    round: Option<String>,
    white_id: i32,
    black_id: i32,
    result: Option<String>,
    fen: Option<String>,
    mainline: Vec<u8>,
}

#[derive(Clone, Debug)]
struct DuplicateGameCandidate {
    id: i32,
    moves: Vec<u8>,
    timing_comments: usize,
}

type DuplicateGameRow = (
    i32,
    i32,
    i32,
    Option<String>,
    Option<String>,
    Option<String>,
    i32,
    i32,
    Option<String>,
    Option<String>,
    Vec<u8>,
);

fn delete_duplicated_games_in_db(
    db: &mut SqliteConnection,
) -> Result<DuplicateGameCleanupReport, Error> {
    let rows: Vec<DuplicateGameRow> = games::table
        .select((
            games::id,
            games::event_id,
            games::site_id,
            games::date,
            games::time,
            games::round,
            games::white_id,
            games::black_id,
            games::result,
            games::fen,
            games::moves,
        ))
        .load(db)?;

    let mut groups: HashMap<DuplicateGameKey, Vec<DuplicateGameCandidate>> = HashMap::new();
    for (id, event_id, site_id, date, time, round, white_id, black_id, result, fen, moves) in rows {
        let key = DuplicateGameKey {
            event_id,
            site_id,
            date,
            time,
            round,
            white_id,
            black_id,
            result,
            fen,
            mainline: iter_mainline_move_bytes(&moves).collect(),
        };
        let timing_comments = mainline_timing_comment_count(&moves);
        groups.entry(key).or_default().push(DuplicateGameCandidate {
            id,
            moves,
            timing_comments,
        });
    }

    let mut updates: Vec<(i32, Vec<u8>, bool)> = Vec::new();
    let mut delete_ids = Vec::new();

    for candidates in groups.values_mut() {
        if candidates.len() <= 1 {
            continue;
        }

        candidates.sort_by_key(|candidate| candidate.id);
        let survivor = candidates[0].clone();
        let best = candidates
            .iter()
            .max_by(|left, right| {
                left.timing_comments
                    .cmp(&right.timing_comments)
                    .then_with(|| left.moves.len().cmp(&right.moves.len()))
                    .then_with(|| right.id.cmp(&left.id))
            })
            .cloned()
            .unwrap_or_else(|| survivor.clone());

        if best.moves != survivor.moves {
            updates.push((
                survivor.id,
                best.moves,
                best.timing_comments > survivor.timing_comments,
            ));
        }

        delete_ids.extend(candidates.iter().skip(1).map(|candidate| candidate.id));
    }

    db.transaction::<_, diesel::result::Error, _>(|db| {
        for (id, moves, _) in &updates {
            diesel::update(games::table.filter(games::id.eq(*id)))
                .set(games::moves.eq(moves))
                .execute(db)?;
        }

        for chunk in delete_ids.chunks(500) {
            diesel::delete(games::table.filter(games::id.eq_any(chunk))).execute(db)?;
        }

        Ok(())
    })?;

    Ok(DuplicateGameCleanupReport {
        deleted_games: delete_ids.len() as u32,
        enriched_games: updates
            .iter()
            .filter(|(_, _, improved_timing)| *improved_timing)
            .count() as u32,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn get_database_clock_coverage(
    file: PathBuf,
    state: tauri::State<'_, AppState>,
) -> Result<DatabaseClockCoverage, Error> {
    let db = &mut get_db_or_create(&state, file.to_str().unwrap(), ConnectionOptions::default())?;
    let moves: Vec<Vec<u8>> = games::table.select(games::moves).load(db)?;
    Ok(DatabaseClockCoverage {
        game_count: moves.len() as u32,
        games_with_timing: moves
            .iter()
            .filter(|moves| mainline_timing_comment_count(moves) > 0)
            .count() as u32,
    })
}

fn mainline_timing_comment_count(bytes: &[u8]) -> usize {
    let mut cursor = 0usize;
    let mut variation_depth = 0usize;
    let mut count = 0usize;

    while cursor < bytes.len() {
        let byte = bytes[cursor];
        cursor += 1;

        match byte {
            VARIATION_START_MARKER => {
                variation_depth = variation_depth.saturating_add(1);
            }
            VARIATION_END_MARKER => {
                variation_depth = variation_depth.saturating_sub(1);
            }
            self::encoding::COMMENT_MARKER | self::encoding::NAG_MARKER => {
                if cursor + 2 > bytes.len() {
                    break;
                }
                let len = u16::from_le_bytes([bytes[cursor], bytes[cursor + 1]]) as usize;
                cursor += 2;
                if cursor + len > bytes.len() {
                    break;
                }

                if byte == self::encoding::COMMENT_MARKER
                    && variation_depth == 0
                    && comment_has_timing_marker(&bytes[cursor..cursor + len])
                {
                    count += 1;
                }
                cursor += len;
            }
            _ => {}
        }
    }

    count
}

fn comment_has_timing_marker(comment: &[u8]) -> bool {
    let lower = comment.to_ascii_lowercase();
    lower.windows(5).any(|window| window == b"[%clk")
        || lower.windows(5).any(|window| window == b"[%emt")
}

#[tauri::command]
#[specta::specta]
pub async fn delete_empty_games(
    file: PathBuf,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    let db = &mut get_db_or_create(&state, file.to_str().unwrap(), ConnectionOptions::default())?;

    diesel::delete(games::table.filter(games::ply_count.eq(0))).execute(db)?;

    let game_count: i64 = games::table.count().get_result(db)?;
    update_info_count(db, "GameCount", game_count)?;
    delete_orphaned_data(db)?;
    invalidate_database_search_index(&state, &file);

    Ok(())
}

struct PgnGame {
    event: Option<String>,
    site: Option<String>,
    date: Option<String>,
    round: Option<String>,
    white: Option<String>,
    black: Option<String>,
    result: Option<String>,
    time_control: Option<String>,
    eco: Option<String>,
    white_elo: Option<String>,
    black_elo: Option<String>,
    ply_count: Option<String>,
    fen: Option<String>,
    moves: Option<String>,
}

impl PgnGame {
    fn write(&self, writer: &mut impl Write) -> Result<(), Error> {
        writeln!(
            writer,
            "[Event \"{}\"]",
            self.event.as_deref().unwrap_or("")
        )?;
        writeln!(writer, "[Site \"{}\"]", self.site.as_deref().unwrap_or(""))?;
        writeln!(writer, "[Date \"{}\"]", self.date.as_deref().unwrap_or(""))?;
        writeln!(
            writer,
            "[Round \"{}\"]",
            self.round.as_deref().unwrap_or("")
        )?;
        writeln!(
            writer,
            "[White \"{}\"]",
            self.white.as_deref().unwrap_or("")
        )?;
        writeln!(
            writer,
            "[Black \"{}\"]",
            self.black.as_deref().unwrap_or("")
        )?;
        writeln!(
            writer,
            "[Result \"{}\"]",
            self.result.as_deref().unwrap_or("*")
        )?;
        if let Some(time_control) = self.time_control.as_deref() {
            writeln!(writer, "[TimeControl \"{}\"]", time_control)?;
        }
        if let Some(eco) = self.eco.as_deref() {
            writeln!(writer, "[ECO \"{}\"]", eco)?;
        }
        if let Some(white_elo) = self.white_elo.as_deref() {
            if white_elo == "0" {
                writeln!(writer, "[WhiteElo \"-\"]")?;
            } else {
                writeln!(writer, "[WhiteElo \"{}\"]", white_elo)?;
            }
        }
        if let Some(black_elo) = self.black_elo.as_deref() {
            if black_elo == "0" {
                writeln!(writer, "[BlackElo \"-\"]")?;
            } else {
                writeln!(writer, "[BlackElo \"{}\"]", black_elo)?;
            }
        }
        if let Some(ply_count) = self.ply_count.as_deref() {
            writeln!(writer, "[PlyCount \"{}\"]", ply_count)?;
        }
        if let Some(fen) = self.fen.as_deref() {
            writeln!(writer, "[SetUp \"1\"]")?;
            writeln!(writer, "[FEN \"{}\"]", fen)?;
        }
        writeln!(writer)?;
        if let Some(moves) = self.moves.as_deref() {
            if !moves.is_empty() {
                write!(writer, "{} ", moves)?;
            }
        }
        match self.result.as_deref() {
            Some("1-0") => writeln!(writer, "1-0"),
            Some("0-1") => writeln!(writer, "0-1"),
            Some("1/2-1/2") => writeln!(writer, "1/2-1/2"),
            _ => writeln!(writer, "*"),
        }?;
        writeln!(writer)?;
        Ok(())
    }
}

#[tauri::command]
#[specta::specta]
pub async fn export_to_pgn(
    file: PathBuf,
    dest_file: PathBuf,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    let db = &mut get_db_or_create(&state, file.to_str().unwrap(), ConnectionOptions::default())?;

    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(dest_file)?;

    let mut writer = BufWriter::new(file);

    let (white_players, black_players) = diesel::alias!(players as white, players as black);
    games::table
        .inner_join(white_players.on(games::white_id.eq(white_players.field(players::id))))
        .inner_join(black_players.on(games::black_id.eq(black_players.field(players::id))))
        .inner_join(events::table.on(games::event_id.eq(events::id)))
        .inner_join(sites::table.on(games::site_id.eq(sites::id)))
        .order(games::id.asc())
        .load_iter::<(Game, Player, Player, Event, Site), DefaultLoadingMode>(db)?
        .flatten()
        .map(|(game, white, black, event, site)| {
            let pgn = PgnGame {
                event: event.name,
                site: site.name,
                date: game.date,
                round: game.round,
                white: white.name,
                black: black.name,
                result: game.result,
                time_control: game.time_control,
                eco: game.eco,
                white_elo: game.white_elo.map(|e| e.to_string()),
                black_elo: game.black_elo.map(|e| e.to_string()),
                ply_count: game.ply_count.map(|e| e.to_string()),
                fen: game.fen.clone(),
                moves: decode_game_to_movetext(
                    &game.moves,
                    if let Some(fen) = game.fen {
                        Fen::from_ascii(fen.as_bytes()).unwrap_or_default()
                    } else {
                        Fen::default()
                    },
                )
                .ok(),
            };

            pgn.write(&mut writer)?;

            Ok(())
        })
        .collect::<Result<Vec<_>, Error>>()?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_db_game(
    file: PathBuf,
    game_id: i32,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    let db = &mut get_db_or_create(&state, file.to_str().unwrap(), ConnectionOptions::default())?;

    diesel::delete(games::table.filter(games::id.eq(game_id))).execute(db)?;

    let game_count: i64 = games::table.count().get_result(db)?;
    update_info_count(db, "GameCount", game_count)?;
    delete_orphaned_data(db)?;
    invalidate_database_search_index(&state, &file);

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn write_db_game(
    file: PathBuf,
    game_id: i32,
    pgn: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    let db = &mut get_db_or_create(&state, file.to_str().unwrap(), ConnectionOptions::default())?;

    let mut importer = Importer::new(None);
    let mut parsed = BufferedReader::new(pgn.as_bytes())
        .into_iter(&mut importer)
        .flatten()
        .flatten();
    let temp_game = parsed.next().ok_or(Error::NoMovesFound)?;

    let white_id = if let Some(name) = temp_game.white_name.as_deref() {
        create_player(db, name)?.id
    } else {
        0
    };
    let black_id = if let Some(name) = temp_game.black_name.as_deref() {
        create_player(db, name)?.id
    } else {
        0
    };
    let event_id = if let Some(name) = temp_game.event_name.as_deref() {
        create_event(db, name)?.id
    } else {
        0
    };
    let site_id = if let Some(name) = temp_game.site_name.as_deref() {
        create_site(db, name)?.id
    } else {
        0
    };

    let final_material = get_material_count(temp_game.position.board());
    let minimal_white_material = temp_game.material_count.white.min(final_material.white) as i32;
    let minimal_black_material = temp_game.material_count.black.min(final_material.black) as i32;
    let pawn_home = get_pawn_home(temp_game.position.board()) as i32;
    let ply_count = iter_mainline_move_bytes(&temp_game.moves).count() as i32;

    let updated_rows = diesel::update(games::table.filter(games::id.eq(game_id)))
        .set((
            games::event_id.eq(event_id),
            games::site_id.eq(site_id),
            games::date.eq(temp_game.date),
            games::time.eq(temp_game.time),
            games::round.eq(temp_game.round),
            games::white_id.eq(white_id),
            games::white_elo.eq(temp_game.white_elo),
            games::black_id.eq(black_id),
            games::black_elo.eq(temp_game.black_elo),
            games::white_material.eq(minimal_white_material),
            games::black_material.eq(minimal_black_material),
            games::result.eq(temp_game.result),
            games::time_control.eq(temp_game.time_control),
            games::eco.eq(temp_game.eco),
            games::ply_count.eq(ply_count),
            games::fen.eq(temp_game.fen),
            games::moves.eq(temp_game.moves),
            games::pawn_home.eq(pawn_home),
        ))
        .execute(db)?;

    if updated_rows == 0 {
        return Err(Error::GameNotFound(game_id.to_string()));
    }

    invalidate_database_search_index(&state, &file);

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn merge_players(
    file: PathBuf,
    player1: i32,
    player2: i32,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    let db = &mut get_db_or_create(&state, file.to_str().unwrap(), ConnectionOptions::default())?;

    // Check if the players never played against each other
    let count: i64 = games::table
        .filter(games::white_id.eq(player1).and(games::black_id.eq(player2)))
        .or_filter(games::white_id.eq(player2).and(games::black_id.eq(player1)))
        .limit(1)
        .count()
        .get_result(db)?;

    if count > 0 {
        return Err(Error::NotDistinctPlayers);
    }

    diesel::update(games::table.filter(games::white_id.eq(player1)))
        .set(games::white_id.eq(player2))
        .execute(db)?;
    diesel::update(games::table.filter(games::black_id.eq(player1)))
        .set(games::black_id.eq(player2))
        .execute(db)?;

    diesel::delete(players::table.filter(players::id.eq(player1))).execute(db)?;

    let player_count: i64 = players::table.count().get_result(db)?;
    update_info_count(db, "PlayerCount", player_count)?;
    invalidate_database_search_index(&state, &file);

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn clear_games(state: tauri::State<'_, AppState>) {
    clear_all_database_search_caches(&state);
}

#[tauri::command]
#[specta::specta]
pub async fn preload_reference_db(
    file: PathBuf,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    ensure_search_index_current(&file, &state)?;
    let index_path = get_index_path(&file);

    let mut cache = state.db_cache.lock().unwrap();
    if cache.iter().any(|(cached_file, _)| cached_file == &file) {
        return Ok(());
    }

    info!("Preloading reference database from {:?}", index_path);
    match MmapSearchIndex::open(&index_path) {
        Ok(index) => {
            info!("Preloaded reference database with {} games", index.len());
            cache.push((file, index));
            if cache.len() > DB_CACHE_LIMIT {
                cache.remove(0);
            }
        }
        Err(e) => {
            return Err(Error::from(e));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use pgn_reader::BufferedReader;
    use shakmaty::{Move, Role, Square};

    #[test]
    fn home_row() {
        use shakmaty::Board;

        let pawn_home = get_pawn_home(&Board::default());
        assert_eq!(pawn_home, 0b1111111111111111);

        let pawn_home = get_pawn_home(
            &Board::from_ascii_board_fen(b"8/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/8").unwrap(),
        );
        assert_eq!(pawn_home, 0b1110111111101111);

        let pawn_home = get_pawn_home(&Board::from_ascii_board_fen(b"8/8/8/8/8/8/8/8").unwrap());
        assert_eq!(pawn_home, 0b0000000000000000);
    }

    #[test]
    fn occurrence_collection_includes_board_turn_lookup_key() {
        let fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1";
        let position = starting_position_from_fen(Some(fen)).unwrap();
        let next_move = Move::Normal {
            role: Role::Pawn,
            from: Square::E7,
            to: Square::E5,
            capture: None,
            promotion: None,
        };
        let next_byte = encode_move(&next_move, &position).unwrap();
        let material = get_material_count(position.board());
        let entry = SearchGameEntry::from_game_data(
            1,
            10,
            20,
            None,
            Some("*".to_string()),
            vec![next_byte],
            Some(fen.to_string()),
            get_pawn_home(position.board()) as i32,
            material.white as i32,
            material.black as i32,
            Some(2500),
            Some(2500),
        );

        let occurrences = collect_position_occurrences_for_entry(0, &entry).unwrap();
        let exact_key = position_index_key(&position);
        let board_turn_key = legacy_position_index_key(&position);

        assert_ne!(exact_key, board_turn_key);
        assert!(occurrences.iter().any(|occurrence| {
            occurrence.key_hi == exact_key.hi
                && occurrence.key_lo == exact_key.lo
                && occurrence.next_move == u16::from(next_byte)
        }));
        assert!(occurrences.iter().any(|occurrence| {
            occurrence.key_hi == board_turn_key.hi
                && occurrence.key_lo == board_turn_key.lo
                && occurrence.next_move == u16::from(next_byte)
        }));
    }

    #[test]
    fn importer_handles_nested_variations() {
        let pgn = r#"[Event "T"]
[Site "S"]
[Date "2026.02.27"]
[UTCTime "12:00:00"]
[White "W"]
[Black "B"]
[Result "*"]

1. e4 (1. d4 d5 (1... Nf6) {inner}) e5 *
"#;

        let mut importer = Importer::new(None);
        let games: Vec<TempGame> = BufferedReader::new(pgn.as_bytes())
            .into_iter(&mut importer)
            .flatten()
            .flatten()
            .collect();

        assert_eq!(games.len(), 1);
        let movetext = decode_game_to_movetext(&games[0].moves, Fen::default()).unwrap();

        assert_eq!(movetext, "1. e4 (1. d4 d5 (1... Nf6) {inner}) 1... e5");
    }

    #[test]
    fn importer_handles_symbolic_and_numeric_nags() {
        let pgn = r#"[Event "T"]
[Site "S"]
[Date "2026.02.27"]
[UTCTime "12:00:00"]
[White "W"]
[Black "B"]
[Result "*"]

1. e4! (1. d4 $2) e5 $1 *
"#;

        let mut importer = Importer::new(None);
        let games: Vec<TempGame> = BufferedReader::new(pgn.as_bytes())
            .into_iter(&mut importer)
            .flatten()
            .flatten()
            .collect();

        assert_eq!(games.len(), 1);
        let movetext = decode_game_to_movetext(&games[0].moves, Fen::default()).unwrap();
        assert_eq!(movetext, "1. e4! (1. d4?) 1... e5!");
    }

    #[test]
    fn importer_uses_lichess_study_title_as_event() {
        let game = import_single_game(
            r#"[Event "?"]
[StudyName "My classical games"]
[ChapterName "Model game 7"]
[Site "https://lichess.org/study/abcdefgh/ijklmnop"]
[Date "2026.02.28"]
[White "Unknown"]
[Black "Unknown"]
[Result "*"]

1. e4 e5 *
"#,
        );

        assert_eq!(
            game.event_name.as_deref(),
            Some("My classical games - Model game 7")
        );
    }

    #[test]
    fn duplicate_cleanup_enriches_earliest_game_with_clocked_movetext() {
        let db = &mut setup_test_db();
        let plain = import_single_game(
            r#"[Event "Online"]
[Site "https://lichess.org/testgame"]
[Date "2026.02.27"]
[UTCTime "12:00:00"]
[White "W"]
[Black "B"]
[Result "*"]
[TimeControl "300+0"]

1. e4 e5 *
"#,
        );
        let clocked = import_single_game(
            r#"[Event "Online"]
[Site "https://lichess.org/testgame"]
[Date "2026.02.27"]
[UTCTime "12:00:00"]
[White "W"]
[Black "B"]
[Result "*"]
[TimeControl "300+0"]

1. e4 {[%clk 0:04:55]} e5 {[%clk 0:04:56]} *
"#,
        );

        plain.insert_to_db(db).unwrap();
        clocked.insert_to_db(db).unwrap();

        let original_ids: Vec<i32> = games::table
            .select(games::id)
            .order(games::id.asc())
            .load(db)
            .unwrap();
        let report = delete_duplicated_games_in_db(db).unwrap();
        let remaining: Vec<Game> = games::table.order(games::id.asc()).load(db).unwrap();

        assert_eq!(report.deleted_games, 1);
        assert_eq!(report.enriched_games, 1);
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, original_ids[0]);
        assert_eq!(mainline_timing_comment_count(&remaining[0].moves), 2);
    }

    #[derive(QueryableByName)]
    struct EvalCacheCount {
        #[diesel(sql_type = BigInt, column_name = "row_count")]
        row_count: i64,
    }

    #[derive(QueryableByName)]
    struct EvalCacheProbe {
        #[diesel(sql_type = Integer, column_name = "CpBefore")]
        cp_before: i32,
        #[diesel(sql_type = Nullable<Integer>, column_name = "CpLoss")]
        cp_loss: Option<i32>,
        #[diesel(sql_type = Nullable<Double>, column_name = "MoveTimeSeconds")]
        move_time_seconds: Option<f64>,
        #[diesel(sql_type = Text, column_name = "PVUCI")]
        pv_uci: String,
    }

    #[test]
    fn mistake_review_move_eval_upsert_creates_and_updates_cache_rows() {
        let db = &mut setup_test_db();
        let white = create_player(db, "White").unwrap();
        let black = create_player(db, "Black").unwrap();
        let event = create_event(db, "Cache Test").unwrap();
        let site = create_site(db, "Local").unwrap();
        let game = create_game(
            db,
            NewGame {
                event_id: event.id,
                site_id: site.id,
                white_id: white.id,
                black_id: black.id,
                white_elo: None,
                black_elo: None,
                white_material: 0,
                black_material: 0,
                date: Some("2026.05.04"),
                time: Some("12:00:00"),
                round: None,
                result: None,
                time_control: Some("300+0"),
                eco: None,
                ply_count: 2,
                fen: None,
                moves: &[],
                pawn_home: 0,
            },
        )
        .unwrap();

        let mut entry = MistakeReviewMoveEvalEntry {
            game_id: game.id,
            ply: 0,
            move_number: 1,
            player_id: white.id,
            player_color: "white".to_string(),
            side_to_move: "white".to_string(),
            fen: Fen::default().to_string(),
            normalized_fen: "startpos w KQkq -".to_string(),
            fen_after: "after".to_string(),
            played_uci: "e2e4".to_string(),
            played_san: "e4".to_string(),
            best_uci: Some("d2d4".to_string()),
            best_san: Some("d4".to_string()),
            pv_uci: "d2d4 d7d5".to_string(),
            pv_san: "d4 d5".to_string(),
            cp_before: 32,
            cp_after: Some(-18),
            cp_loss: Some(50),
            win_probability_drop: Some(4.2),
            requested_depth: 12,
            reached_depth: 12,
            analysis_mode: "single".to_string(),
            analysis_stage: "deep".to_string(),
            fast_depth: 0,
            multi_pv: 3,
            engine_name: "Stockfish".to_string(),
            move_time_seconds: Some(8.0),
            clock_before_seconds: Some(300.0),
            clock_after_seconds: Some(292.0),
        };

        upsert_mistake_review_move_evals_in_db(db, &[entry.clone()]).unwrap();
        entry.cp_before = 40;
        entry.cp_loss = Some(58);
        entry.move_time_seconds = Some(9.0);
        entry.pv_uci = "d2d4 g8f6".to_string();
        upsert_mistake_review_move_evals_in_db(db, &[entry]).unwrap();

        let count: EvalCacheCount =
            sql_query("SELECT COUNT(*) AS row_count FROM MistakeReviewMoveEvals")
                .get_result(db)
                .unwrap();
        assert_eq!(count.row_count, 1);

        let row: EvalCacheProbe = sql_query(
            "SELECT CpBefore, CpLoss, MoveTimeSeconds, PVUCI FROM MistakeReviewMoveEvals",
        )
        .get_result(db)
        .unwrap();
        assert_eq!(row.cp_before, 40);
        assert_eq!(row.cp_loss, Some(58));
        assert_eq!(row.move_time_seconds, Some(9.0));
        assert_eq!(row.pv_uci, "d2d4 g8f6");
    }

    fn setup_test_db() -> SqliteConnection {
        let mut conn = SqliteConnection::establish(":memory:").unwrap();
        conn.batch_execute("PRAGMA foreign_keys = ON;").unwrap();
        conn.batch_execute(CREATE_TABLES_SQL).unwrap();
        conn
    }

    #[test]
    fn import_schema_initializes_empty_database_files() {
        let db = &mut SqliteConnection::establish(":memory:").unwrap();

        let schema_created =
            ensure_database_schema_for_import(db, "Prep import", "Generated from PGN").unwrap();

        assert!(schema_created);
        assert!(database_table_exists(db, "Info").unwrap());
        assert!(database_table_exists(db, "Games").unwrap());

        let title: Option<String> = info::table
            .filter(info::name.eq("Title"))
            .select(info::value)
            .first(db)
            .unwrap();
        assert_eq!(title.as_deref(), Some("Prep import"));
    }

    fn import_single_game(pgn: &str) -> TempGame {
        let mut importer = Importer::new(None);
        BufferedReader::new(pgn.as_bytes())
            .into_iter(&mut importer)
            .flatten()
            .flatten()
            .next()
            .unwrap()
    }

    #[test]
    fn delete_orphaned_data_removes_unreferenced_players_events_sites() {
        let db = &mut setup_test_db();

        // Create players, events, sites
        let player1 = create_player(db, "Magnus").unwrap();
        let player2 = create_player(db, "Hikaru").unwrap();
        let event = create_event(db, "World Championship").unwrap();
        let site = create_site(db, "Reykjavik").unwrap();

        // Insert a game referencing them
        let game = create_game(
            db,
            NewGame {
                event_id: event.id,
                site_id: site.id,
                white_id: player1.id,
                black_id: player2.id,
                white_elo: None,
                black_elo: None,
                white_material: 0,
                black_material: 0,
                date: None,
                time: None,
                round: None,
                result: None,
                time_control: None,
                eco: None,
                ply_count: 10,
                fen: None,
                moves: &[],
                pawn_home: 0,
            },
        )
        .unwrap();

        // Verify everything exists: 3 players (Unknown + 2), 2 events, 2 sites
        let player_count: i64 = players::table.count().get_result(db).unwrap();
        assert_eq!(player_count, 3);
        let event_count: i64 = events::table.count().get_result(db).unwrap();
        assert_eq!(event_count, 2);
        let site_count: i64 = sites::table.count().get_result(db).unwrap();
        assert_eq!(site_count, 2);

        // Delete the game
        diesel::delete(games::table.filter(games::id.eq(game.id)))
            .execute(db)
            .unwrap();

        // Before fix: orphans would remain. Call our cleanup function.
        delete_orphaned_data(db).unwrap();

        // Players: only the sentinel "Unknown" (ID=0) should remain
        let player_count: i64 = players::table.count().get_result(db).unwrap();
        assert_eq!(player_count, 1, "Orphaned players should be deleted");

        let remaining_player: Player = players::table.first(db).unwrap();
        assert_eq!(
            remaining_player.id, 0,
            "Only the Unknown player should remain"
        );

        // Events: only the sentinel should remain
        let event_count: i64 = events::table.count().get_result(db).unwrap();
        assert_eq!(event_count, 1, "Orphaned events should be deleted");

        // Sites: only the sentinel should remain
        let site_count: i64 = sites::table.count().get_result(db).unwrap();
        assert_eq!(site_count, 1, "Orphaned sites should be deleted");

        // Info table counts should be updated
        let pc: String = info::table
            .filter(info::name.eq("PlayerCount"))
            .select(info::value)
            .first::<Option<String>>(db)
            .unwrap()
            .unwrap();
        assert_eq!(pc, "1");

        let ec: String = info::table
            .filter(info::name.eq("EventCount"))
            .select(info::value)
            .first::<Option<String>>(db)
            .unwrap()
            .unwrap();
        assert_eq!(ec, "1");

        let sc: String = info::table
            .filter(info::name.eq("SiteCount"))
            .select(info::value)
            .first::<Option<String>>(db)
            .unwrap()
            .unwrap();
        assert_eq!(sc, "1");
    }

    #[test]
    fn delete_orphaned_data_preserves_referenced_records() {
        let db = &mut setup_test_db();

        // Create players, events, sites for two games
        let magnus = create_player(db, "Magnus").unwrap();
        let hikaru = create_player(db, "Hikaru").unwrap();
        let fabiano = create_player(db, "Fabiano").unwrap();
        let event1 = create_event(db, "World Championship").unwrap();
        let event2 = create_event(db, "Candidates").unwrap();
        let site1 = create_site(db, "Reykjavik").unwrap();
        let site2 = create_site(db, "Toronto").unwrap();

        let make_game = |db: &mut SqliteConnection, w: i32, b: i32, e: i32, s: i32| {
            create_game(
                db,
                NewGame {
                    event_id: e,
                    site_id: s,
                    white_id: w,
                    black_id: b,
                    white_elo: None,
                    black_elo: None,
                    white_material: 0,
                    black_material: 0,
                    date: None,
                    time: None,
                    round: None,
                    result: None,
                    time_control: None,
                    eco: None,
                    ply_count: 10,
                    fen: None,
                    moves: &[],
                    pawn_home: 0,
                },
            )
            .unwrap()
        };

        // Game 1: Magnus vs Hikaru at World Championship in Reykjavik
        let game1 = make_game(db, magnus.id, hikaru.id, event1.id, site1.id);
        // Game 2: Fabiano vs Hikaru at Candidates in Toronto
        let game2 = make_game(db, fabiano.id, hikaru.id, event2.id, site2.id);

        // Delete only game 1
        diesel::delete(games::table.filter(games::id.eq(game1.id)))
            .execute(db)
            .unwrap();
        delete_orphaned_data(db).unwrap();

        // Magnus should be gone (only in game 1), but Hikaru and Fabiano should remain
        let player_count: i64 = players::table.count().get_result(db).unwrap();
        assert_eq!(player_count, 3, "Unknown + Hikaru + Fabiano should remain");

        let magnus_exists: i64 = players::table
            .filter(players::name.eq("Magnus"))
            .count()
            .get_result(db)
            .unwrap();
        assert_eq!(magnus_exists, 0, "Magnus should be deleted (orphaned)");

        // Event1 and Site1 should be gone, Event2 and Site2 should remain
        let event_count: i64 = events::table.count().get_result(db).unwrap();
        assert_eq!(event_count, 2, "Unknown + Candidates should remain");

        let site_count: i64 = sites::table.count().get_result(db).unwrap();
        assert_eq!(site_count, 2, "Unknown + Toronto should remain");

        // Delete game 2 — now everything should be orphaned
        diesel::delete(games::table.filter(games::id.eq(game2.id)))
            .execute(db)
            .unwrap();
        delete_orphaned_data(db).unwrap();

        let player_count: i64 = players::table.count().get_result(db).unwrap();
        assert_eq!(player_count, 1, "Only Unknown should remain");
        let event_count: i64 = events::table.count().get_result(db).unwrap();
        assert_eq!(event_count, 1, "Only Unknown should remain");
        let site_count: i64 = sites::table.count().get_result(db).unwrap();
        assert_eq!(site_count, 1, "Only Unknown should remain");
    }
}
