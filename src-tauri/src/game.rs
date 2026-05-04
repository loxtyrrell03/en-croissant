use std::{
    collections::HashMap,
    fs::File,
    io::{BufRead, BufReader, Cursor, Read, Write},
    path::PathBuf,
    sync::Arc,
    time::Instant,
};

use dashmap::DashMap;
use log::{error, info};
use pgn_reader::{BufferedReader, RawHeader, Skip, Visitor};
use polyglot_book_rs::PolyglotBook;
use rand::{seq::IteratorRandom, Rng};
use serde::{Deserialize, Serialize};
use shakmaty::{
    fen::Fen, san::SanPlus, uci::UciMove, CastlingMode, Chess, Color, EnPassantMode, Move,
    Position, Square,
};
use specta::Type;
use tauri::AppHandle;
use tauri_specta::Event;
use tokio::{
    sync::{watch, Mutex, RwLock},
    time::{interval, Duration},
};

use crate::{
    engine::{parse_fen_to_position, BaseEngine, EngineLog, EngineOption, GoMode, PlayersTime},
    error::Error,
};

pub type GameId = String;

const PATRICIA_MIN_FIDE_ELO: u32 = 800;
const PATRICIA_MAX_FIDE_ELO: u32 = 3000;
const PATRICIA_SKILL_LEVELS: [u32; 20] = [
    500, 800, 1000, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300, 2400,
    2500, 2650, 2800, 3000,
];
// Rating-equivalent move-quality handicap; keep in sync with src/utils/practiceBot.ts.
const TRAINER_QUALITY_PENALTY_POINTS: [(f64, f64); 5] = [
    (1.5, 700.0),
    (3.0, 460.0),
    (7.0, 225.0),
    (20.0, 60.0),
    (45.0, 0.0),
];

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PlayerConfig {
    Human {
        name: String,
    },
    Engine {
        name: String,
        path: String,
        #[serde(default)]
        options: Vec<EngineOption>,
        go: Option<GoMode>,
        #[serde(
            default = "default_use_clock_time_management",
            rename = "useClockTimeManagement"
        )]
        use_clock_time_management: bool,
        #[serde(default, rename = "moveDelay")]
        move_delay: Option<EngineMoveDelay>,
    },
}

fn default_use_clock_time_management() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EngineMoveDelay {
    pub min_ms: u32,
    pub max_ms: u32,
    #[serde(default)]
    pub fide_elo: Option<u32>,
    #[serde(default)]
    pub strength_elo: Option<u32>,
    #[serde(default)]
    pub initial_time_ms: Option<u32>,
    #[serde(default)]
    pub increment_ms: Option<u32>,
    #[serde(default)]
    pub use_as_move_time: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TimeControl {
    pub initial_time: u64,
    pub increment: u64,
}

#[derive(Clone, Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GameConfig {
    pub white: PlayerConfig,
    pub black: PlayerConfig,
    pub white_time_control: Option<TimeControl>,
    pub black_time_control: Option<TimeControl>,
    pub initial_fen: Option<String>,
    #[serde(default)]
    pub initial_moves: Vec<String>,
    pub opening_book: Option<OpeningBookConfig>,
}

#[derive(Clone, Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpeningBookConfig {
    pub path: String,
    #[serde(default = "default_opening_book_max_ply")]
    pub max_ply: usize,
}

fn default_opening_book_max_ply() -> usize {
    40
}

#[derive(Clone, Debug, Serialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum GameStatus {
    Playing,
    Finished { result: GameResult },
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GameResult {
    WhiteWins { reason: GameEndReason },
    BlackWins { reason: GameEndReason },
    Draw { reason: DrawReason },
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum GameEndReason {
    Checkmate,
    Timeout,
    Resignation,
    Abandonment,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DrawReason {
    Stalemate,
    InsufficientMaterial,
    ThreefoldRepetition,
    FiftyMoveRule,
    Agreement,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GameMove {
    pub uci: String,
    pub san: String,
    pub fen_after: String,
    pub clock: Option<u64>,
    pub white_time: Option<u64>,
    pub black_time: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GameState {
    pub game_id: GameId,
    pub status: GameStatus,
    pub initial_fen: String,
    pub moves: Vec<GameMove>,
    pub current_fen: String,
    pub ply: u32,
    pub turn: String,
    pub white_time: Option<u64>,
    pub black_time: Option<u64>,
    pub white_player: String,
    pub black_player: String,
}

#[derive(Clone, Debug, Serialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct GameMoveEvent {
    pub game_id: GameId,
    pub moves: Vec<GameMove>,
    pub fen: String,
    pub white_time: Option<u64>,
    pub black_time: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct ClockUpdateEvent {
    pub game_id: GameId,
    pub white_time: Option<u64>,
    pub black_time: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct GameOverEvent {
    pub game_id: GameId,
    pub result: GameResult,
    pub moves: Vec<GameMove>,
}

struct ClockState {
    white_time: Option<u64>,
    black_time: Option<u64>,
    white_increment: u64,
    black_increment: u64,
    last_tick: Instant,
}

struct GameController {
    game_id: GameId,
    config: GameConfig,
    initial_fen: String,
    moves: Vec<GameMove>,
    position: Chess,
    position_history: HashMap<String, u32>,
    status: GameStatus,
    clock: Option<ClockState>,
    white_engine: Option<Arc<Mutex<BaseEngine>>>,
    black_engine: Option<Arc<Mutex<BaseEngine>>>,
    shutdown_tx: Option<watch::Sender<bool>>,
    move_notify_tx: Option<tokio::sync::mpsc::Sender<()>>,
    engine_thinking: bool,
    polyglot_book: Option<PolyglotBook>,
    polyglot_max_ply: usize,
}

impl GameController {
    fn new(game_id: GameId, config: GameConfig) -> Result<Self, Error> {
        let initial_fen = config.initial_fen.clone().unwrap_or_else(|| {
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".to_string()
        });

        let position = parse_fen_to_position(&initial_fen)?;

        let clock = if config.white_time_control.is_some() || config.black_time_control.is_some() {
            Some(ClockState {
                white_time: config.white_time_control.as_ref().map(|tc| tc.initial_time),
                black_time: config.black_time_control.as_ref().map(|tc| tc.initial_time),
                white_increment: config
                    .white_time_control
                    .as_ref()
                    .map(|tc| tc.increment)
                    .unwrap_or(0),
                black_increment: config
                    .black_time_control
                    .as_ref()
                    .map(|tc| tc.increment)
                    .unwrap_or(0),
                last_tick: Instant::now(),
            })
        } else {
            None
        };

        let mut position_history = HashMap::new();
        let initial_key = Self::position_key(&position);
        position_history.insert(initial_key, 1);

        let initial_moves = config.initial_moves.clone();

        let mut controller = Self {
            game_id,
            config,
            initial_fen,
            moves: Vec::new(),
            position,
            position_history,
            status: GameStatus::Playing,
            clock,
            white_engine: None,
            black_engine: None,
            shutdown_tx: None,
            move_notify_tx: None,
            engine_thinking: false,
            polyglot_book: None,
            polyglot_max_ply: 0,
        };

        for uci_str in &initial_moves {
            controller.apply_move_no_clock(uci_str)?;
        }

        Ok(controller)
    }

    fn get_state(&self) -> GameState {
        let turn = if self.position.turn() == Color::White {
            "white"
        } else {
            "black"
        };

        let (white_time, black_time) = self.get_current_times();

        let white_player = match &self.config.white {
            PlayerConfig::Human { name } => name.clone(),
            PlayerConfig::Engine { name, .. } => name.clone(),
        };

        let black_player = match &self.config.black {
            PlayerConfig::Human { name } => name.clone(),
            PlayerConfig::Engine { name, .. } => name.clone(),
        };

        GameState {
            game_id: self.game_id.clone(),
            status: self.status.clone(),
            initial_fen: self.initial_fen.clone(),
            moves: self.moves.clone(),
            current_fen: Fen::from_position(self.position.clone(), EnPassantMode::Legal)
                .to_string(),
            ply: self.moves.len() as u32,
            turn: turn.to_string(),
            white_time,
            black_time,
            white_player,
            black_player,
        }
    }

    fn position_key(position: &Chess) -> String {
        let fen = Fen::from_position(position.clone(), EnPassantMode::Legal).to_string();
        fen.split_whitespace().take(4).collect::<Vec<_>>().join(" ")
    }

    fn current_turn_player(&self) -> &PlayerConfig {
        if self.position.turn() == Color::White {
            &self.config.white
        } else {
            &self.config.black
        }
    }

    fn is_engine_turn(&self) -> bool {
        matches!(self.current_turn_player(), PlayerConfig::Engine { .. })
    }

    fn apply_move(&mut self, uci_str: &str) -> Result<GameMove, Error> {
        if self.status != GameStatus::Playing {
            return Err(Error::GameNotInProgress);
        }

        let uci = UciMove::from_ascii(uci_str.as_bytes())?;
        let mv = uci.to_move(&self.position)?;

        let san = SanPlus::from_move_and_play_unchecked(&mut self.position.clone(), &mv);

        let clock = self.clock.as_ref().and_then(|c| {
            if self.position.turn() == Color::White {
                c.white_time
            } else {
                c.black_time
            }
        });

        self.position.play_unchecked(&mv);

        let pos_key = Self::position_key(&self.position);
        *self.position_history.entry(pos_key).or_insert(0) += 1;

        if let Some(ref mut clock_state) = self.clock {
            let elapsed = clock_state.last_tick.elapsed().as_millis() as u64;

            if self.position.turn() == Color::Black {
                if let Some(ref mut wt) = clock_state.white_time {
                    *wt = wt.saturating_sub(elapsed);
                    *wt += clock_state.white_increment;
                }
            } else if let Some(ref mut bt) = clock_state.black_time {
                *bt = bt.saturating_sub(elapsed);
                *bt += clock_state.black_increment;
            }

            clock_state.last_tick = Instant::now();
        }

        let (white_time, black_time) = self
            .clock
            .as_ref()
            .map(|c| (c.white_time, c.black_time))
            .unwrap_or((None, None));

        let fen_after = Fen::from_position(self.position.clone(), EnPassantMode::Legal).to_string();

        let game_move = GameMove {
            uci: uci_str.to_string(),
            san: san.to_string(),
            fen_after,
            clock,
            white_time,
            black_time,
        };

        self.moves.push(game_move.clone());
        self.check_game_end();

        Ok(game_move)
    }

    fn apply_move_no_clock(&mut self, uci_str: &str) -> Result<GameMove, Error> {
        let uci = UciMove::from_ascii(uci_str.as_bytes())?;
        let mv = uci.to_move(&self.position)?;

        let san = SanPlus::from_move_and_play_unchecked(&mut self.position.clone(), &mv);

        self.position.play_unchecked(&mv);

        let pos_key = Self::position_key(&self.position);
        *self.position_history.entry(pos_key).or_insert(0) += 1;

        let (white_time, black_time) = self
            .clock
            .as_ref()
            .map(|c| (c.white_time, c.black_time))
            .unwrap_or((None, None));

        let fen_after = Fen::from_position(self.position.clone(), EnPassantMode::Legal).to_string();

        let game_move = GameMove {
            uci: uci_str.to_string(),
            san: san.to_string(),
            fen_after,
            clock: None,
            white_time,
            black_time,
        };

        self.moves.push(game_move.clone());
        self.check_game_end();

        Ok(game_move)
    }

    fn rebuild_position_from_moves(&mut self) -> Result<(), Error> {
        self.position = parse_fen_to_position(&self.initial_fen)?;

        self.position_history.clear();
        let initial_key = Self::position_key(&self.position);
        self.position_history.insert(initial_key, 1);

        for m in &self.moves {
            let uci = UciMove::from_ascii(m.uci.as_bytes())?;
            let mv = uci.to_move(&self.position)?;
            self.position.play_unchecked(&mv);
            let pos_key = Self::position_key(&self.position);
            *self.position_history.entry(pos_key).or_insert(0) += 1;
        }

        if let Some(ref mut clock) = self.clock {
            clock.white_time = self
                .config
                .white_time_control
                .as_ref()
                .map(|tc| tc.initial_time);
            clock.black_time = self
                .config
                .black_time_control
                .as_ref()
                .map(|tc| tc.initial_time);

            if let Some(last_move) = self.moves.last() {
                if last_move.white_time.is_some() || last_move.black_time.is_some() {
                    clock.white_time = last_move.white_time;
                    clock.black_time = last_move.black_time;
                }
            }

            clock.last_tick = Instant::now();
        }

        Ok(())
    }

    fn check_game_end(&mut self) {
        if self.position.is_checkmate() {
            let result = if self.position.turn() == Color::White {
                GameResult::BlackWins {
                    reason: GameEndReason::Checkmate,
                }
            } else {
                GameResult::WhiteWins {
                    reason: GameEndReason::Checkmate,
                }
            };
            self.status = GameStatus::Finished { result };
            return;
        }

        if self.position.is_stalemate() {
            self.status = GameStatus::Finished {
                result: GameResult::Draw {
                    reason: DrawReason::Stalemate,
                },
            };
            return;
        }

        if self.position.is_insufficient_material() {
            self.status = GameStatus::Finished {
                result: GameResult::Draw {
                    reason: DrawReason::InsufficientMaterial,
                },
            };
            return;
        }

        if self.position.halfmoves() >= 100 {
            self.status = GameStatus::Finished {
                result: GameResult::Draw {
                    reason: DrawReason::FiftyMoveRule,
                },
            };
            return;
        }

        let pos_key = Self::position_key(&self.position);
        if let Some(&count) = self.position_history.get(&pos_key) {
            if count >= 3 {
                self.status = GameStatus::Finished {
                    result: GameResult::Draw {
                        reason: DrawReason::ThreefoldRepetition,
                    },
                };
            }
        }
    }

    fn check_timeout(&mut self) -> Option<GameResult> {
        if let Some(ref clock) = self.clock {
            let elapsed = clock.last_tick.elapsed().as_millis() as u64;

            if self.position.turn() == Color::White {
                if let Some(wt) = clock.white_time {
                    if wt.saturating_sub(elapsed) == 0 {
                        return Some(GameResult::BlackWins {
                            reason: GameEndReason::Timeout,
                        });
                    }
                }
            } else if let Some(bt) = clock.black_time {
                if bt.saturating_sub(elapsed) == 0 {
                    return Some(GameResult::WhiteWins {
                        reason: GameEndReason::Timeout,
                    });
                }
            }
        }
        None
    }

    fn get_current_times(&self) -> (Option<u64>, Option<u64>) {
        if let Some(ref clock) = self.clock {
            let elapsed = clock.last_tick.elapsed().as_millis() as u64;

            let white_time = if self.position.turn() == Color::White {
                clock.white_time.map(|t| t.saturating_sub(elapsed))
            } else {
                clock.white_time
            };

            let black_time = if self.position.turn() == Color::Black {
                clock.black_time.map(|t| t.saturating_sub(elapsed))
            } else {
                clock.black_time
            };

            (white_time, black_time)
        } else {
            (None, None)
        }
    }

    fn end_game(&mut self, result: GameResult) {
        self.status = GameStatus::Finished { result };
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(true);
        }
    }

    fn reset_clock(&mut self) {
        if let Some(ref mut clock) = self.clock {
            clock.last_tick = Instant::now();
        }
    }
}

pub struct GameManager {
    games: DashMap<GameId, Arc<RwLock<GameController>>>,
}

impl GameManager {
    pub fn new() -> Self {
        Self {
            games: DashMap::new(),
        }
    }

    pub async fn start_game(
        &self,
        game_id: GameId,
        config: GameConfig,
        app: AppHandle,
    ) -> Result<GameState, Error> {
        if let Some((_, old_game)) = self.games.remove(&game_id) {
            let mut game = old_game.write().await;
            if let Some(tx) = game.shutdown_tx.take() {
                let _ = tx.send(true);
            }
        }

        let OpeningBookResult {
            config,
            polyglot_book,
            polyglot_max_ply,
        } = apply_opening_book(config)?;
        let castling_mode = CastlingMode::detect(
            config
                .clone()
                .initial_fen
                .unwrap_or_default()
                .parse::<Fen>()
                .unwrap_or_default()
                .as_setup(),
        );

        let mut controller = GameController::new(game_id.clone(), config.clone())?;
        controller.polyglot_book = polyglot_book;
        controller.polyglot_max_ply = polyglot_max_ply;

        if let PlayerConfig::Engine { path, options, .. } = &config.white {
            let mut engine = BaseEngine::spawn(PathBuf::from(path)).await?;
            engine.init_uci().await?;
            for opt in options {
                if opt.name == "UCI_Chess960" {
                    continue;
                }
                engine.set_option(&opt.name, &opt.value).await?;
            }
            if castling_mode.is_chess960() {
                engine.set_option("UCI_Chess960", "true").await?;
            } else {
                engine.set_option("UCI_Chess960", "false").await?;
            }
            controller.white_engine = Some(Arc::new(Mutex::new(engine)));
        }

        if let PlayerConfig::Engine { path, options, .. } = &config.black {
            let mut engine = BaseEngine::spawn(PathBuf::from(path)).await?;
            engine.init_uci().await?;
            for opt in options {
                if opt.name == "UCI_Chess960" {
                    continue;
                }
                engine.set_option(&opt.name, &opt.value).await?;
            }
            if castling_mode.is_chess960() {
                engine.set_option("UCI_Chess960", "true").await?;
            } else {
                engine.set_option("UCI_Chess960", "false").await?;
            }
            controller.black_engine = Some(Arc::new(Mutex::new(engine)));
        }

        controller.reset_clock();

        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        controller.shutdown_tx = Some(shutdown_tx);

        let (move_notify_tx, move_notify_rx) = tokio::sync::mpsc::channel(1);
        controller.move_notify_tx = Some(move_notify_tx);

        let state = controller.get_state();
        let controller = Arc::new(RwLock::new(controller));
        self.games.insert(game_id.clone(), controller.clone());

        tokio::spawn(game_loop(
            game_id,
            controller,
            shutdown_rx,
            move_notify_rx,
            app,
        ));

        Ok(state)
    }

    pub async fn get_game_state(&self, game_id: &str) -> Result<GameState, Error> {
        let game = self
            .games
            .get(game_id)
            .ok_or_else(|| Error::GameNotFound(game_id.to_string()))?;
        let controller = game.read().await;
        Ok(controller.get_state())
    }

    pub async fn make_move(
        &self,
        game_id: &str,
        uci: &str,
        app: &AppHandle,
    ) -> Result<GameState, Error> {
        let game = self
            .games
            .get(game_id)
            .ok_or_else(|| Error::GameNotFound(game_id.to_string()))?;

        let mut controller = game.write().await;

        if controller.is_engine_turn() {
            return Err(Error::NotHumanTurn);
        }

        let game_move = controller.apply_move(uci)?;
        let (white_time, black_time) = controller.get_current_times();

        GameMoveEvent {
            game_id: game_id.to_string(),
            moves: controller.moves.clone(),
            fen: game_move.fen_after,
            white_time,
            black_time,
        }
        .emit(app)?;

        if let GameStatus::Finished { result } = &controller.status {
            GameOverEvent {
                game_id: game_id.to_string(),
                result: result.clone(),
                moves: controller.moves.clone(),
            }
            .emit(app)?;
        } else if let Some(tx) = &controller.move_notify_tx {
            let _ = tx.try_send(());
        }

        Ok(controller.get_state())
    }

    pub async fn take_back_move(&self, game_id: &str, app: &AppHandle) -> Result<GameState, Error> {
        let game = self
            .games
            .get(game_id)
            .ok_or_else(|| Error::GameNotFound(game_id.to_string()))?;

        let mut controller = game.write().await;

        if controller.moves.is_empty() {
            return Err(Error::NoMovesFound);
        }

        let human_color = match (&controller.config.white, &controller.config.black) {
            (PlayerConfig::Human { .. }, PlayerConfig::Engine { .. }) => Some(Color::White),
            (PlayerConfig::Engine { .. }, PlayerConfig::Human { .. }) => Some(Color::Black),
            _ => None,
        };

        let should_pop_two = human_color
            .map(|c| controller.position.turn() == c)
            .unwrap_or(false);

        controller.moves.pop();
        if should_pop_two {
            controller.moves.pop();
        }
        controller.status = GameStatus::Playing;
        controller.engine_thinking = false;

        controller.rebuild_position_from_moves()?;
        controller.check_game_end();

        let (white_time, black_time) = controller.get_current_times();
        let fen = Fen::from_position(controller.position.clone(), EnPassantMode::Legal).to_string();

        GameMoveEvent {
            game_id: game_id.to_string(),
            moves: controller.moves.clone(),
            fen,
            white_time,
            black_time,
        }
        .emit(app)?;

        if let GameStatus::Finished { result } = &controller.status {
            GameOverEvent {
                game_id: game_id.to_string(),
                result: result.clone(),
                moves: controller.moves.clone(),
            }
            .emit(app)?;
        } else if controller.is_engine_turn() {
            if let Some(tx) = &controller.move_notify_tx {
                let _ = tx.try_send(());
            }
        }

        Ok(controller.get_state())
    }

    pub async fn resign(
        &self,
        game_id: &str,
        color: &str,
        app: &AppHandle,
    ) -> Result<GameState, Error> {
        let game = self
            .games
            .get(game_id)
            .ok_or_else(|| Error::GameNotFound(game_id.to_string()))?;

        let mut controller = game.write().await;

        let result = match color {
            "white" => GameResult::BlackWins {
                reason: GameEndReason::Resignation,
            },
            "black" => GameResult::WhiteWins {
                reason: GameEndReason::Resignation,
            },
            _ => return Err(Error::InvalidColor(color.to_string())),
        };

        controller.end_game(result.clone());

        GameOverEvent {
            game_id: game_id.to_string(),
            result,
            moves: controller.moves.clone(),
        }
        .emit(app)?;

        Ok(controller.get_state())
    }

    pub async fn abort_game(&self, game_id: &str) -> Result<(), Error> {
        if let Some((_, game)) = self.games.remove(game_id) {
            let mut controller = game.write().await;
            if let Some(tx) = controller.shutdown_tx.take() {
                let _ = tx.send(true);
            }

            if let Some(engine) = &controller.white_engine {
                let mut proc = engine.lock().await;
                let _ = proc.quit().await;
            }
            if let Some(engine) = &controller.black_engine {
                let mut proc = engine.lock().await;
                let _ = proc.quit().await;
            }
        }
        Ok(())
    }

    pub async fn get_engine_logs(
        &self,
        game_id: &str,
        color: &str,
    ) -> Result<Vec<EngineLog>, Error> {
        let game = self
            .games
            .get(game_id)
            .ok_or_else(|| Error::GameNotFound(game_id.to_string()))?;

        let controller = game.read().await;

        let engine = match color {
            "white" => &controller.white_engine,
            "black" => &controller.black_engine,
            _ => return Err(Error::InvalidColor(color.to_string())),
        };

        if let Some(engine_arc) = engine {
            let engine = engine_arc.lock().await;
            Ok(engine.get_logs())
        } else {
            Ok(Vec::new())
        }
    }
}

impl Default for GameManager {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug)]
struct OpeningBookSelection {
    initial_fen: String,
    initial_moves: Vec<String>,
}

struct OpeningBookResult {
    config: GameConfig,
    polyglot_book: Option<PolyglotBook>,
    polyglot_max_ply: usize,
}

fn select_random_epd_entry(reader: impl BufRead) -> Result<OpeningBookSelection, Error> {
    let mut rng = rand::thread_rng();

    let selected_line = reader
        .lines()
        .map_while(Result::ok)
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .choose(&mut rng)
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Opening book EPD has no entries",
            )
        })?;

    Ok(OpeningBookSelection {
        initial_fen: selected_line,
        initial_moves: Vec::new(),
    })
}

struct OpeningBookPgnVisitor {
    selected: Option<OpeningBookSelection>,
    seen: usize,
    current_position: Chess,
    initial_position: Chess,
    castling_mode: CastlingMode,
    initial_fen: Option<String>,
    moves: Vec<String>,
    skip: bool,
}

impl OpeningBookPgnVisitor {
    fn new() -> Self {
        let start = Chess::default();
        Self {
            selected: None,
            seen: 0,
            current_position: start.clone(),
            initial_position: start,
            castling_mode: CastlingMode::Standard,
            initial_fen: None,
            moves: Vec::new(),
            skip: false,
        }
    }
}

impl Visitor for OpeningBookPgnVisitor {
    type Result = Option<OpeningBookSelection>;

    fn begin_game(&mut self) {
        let start = Chess::default();
        self.current_position = start.clone();
        self.initial_position = start;
        self.castling_mode = CastlingMode::Standard;
        self.initial_fen = None;
        self.moves.clear();
        self.skip = false;
    }

    fn header(&mut self, key: &[u8], value: RawHeader<'_>) {
        if key == b"FEN" {
            let fen_text = value.decode_utf8_lossy().into_owned();
            match parse_fen_to_position(&fen_text) {
                Ok(position) => {
                    let parsed_fen: Fen = match fen_text.parse() {
                        Ok(fen) => fen,
                        Err(_) => {
                            self.skip = true;
                            return;
                        }
                    };
                    self.current_position = position.clone();
                    self.initial_position = position;
                    self.castling_mode = CastlingMode::detect(parsed_fen.as_setup());
                    self.initial_fen = Some(fen_text);
                }
                Err(_) => {
                    self.skip = true;
                }
            }
        }
    }

    fn end_headers(&mut self) -> Skip {
        Skip(self.skip)
    }

    fn san(&mut self, san: SanPlus) {
        if self.skip {
            return;
        }

        let mv = match san.san.to_move(&self.current_position) {
            Ok(mv) => mv,
            Err(_) => {
                self.skip = true;
                return;
            }
        };

        let uci = UciMove::from_move(&mv, self.castling_mode).to_string();
        self.moves.push(uci);
        self.current_position.play_unchecked(&mv);
    }

    fn end_game(&mut self) -> Self::Result {
        if self.skip || self.moves.is_empty() {
            return None;
        }

        let initial_fen = self.initial_fen.clone().unwrap_or_else(|| {
            Fen::from_position(self.initial_position.clone(), EnPassantMode::Legal).to_string()
        });

        let candidate = OpeningBookSelection {
            initial_fen,
            initial_moves: self.moves.clone(),
        };

        self.seen += 1;
        let mut rng = rand::thread_rng();
        if rng.gen_range(0..self.seen) == 0 {
            self.selected = Some(candidate.clone());
        }

        Some(candidate)
    }
}

fn select_random_pgn_entry(input: impl Read) -> Result<OpeningBookSelection, Error> {
    let mut reader = BufferedReader::new(input);
    let mut visitor = OpeningBookPgnVisitor::new();

    while reader.read_game(&mut visitor)?.is_some() {}

    visitor.selected.ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Opening book PGN has no valid games",
        )
        .into()
    })
}

fn read_zip_inner(path: &str) -> Result<(String, Vec<u8>), Error> {
    let file = File::open(path)?;
    let mut archive = zip::ZipArchive::new(BufReader::new(file))?;
    if archive.len() != 1 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Opening book zip must contain exactly one file",
        )
        .into());
    }
    let mut inner = archive.by_index(0)?;
    let name = inner.name().to_string();
    let mut buf = Vec::new();
    inner.read_to_end(&mut buf)?;
    Ok((name, buf))
}

fn opening_book_ext(name: &str) -> Option<&str> {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".epd") {
        Some("epd")
    } else if lower.ends_with(".pgn") {
        Some("pgn")
    } else if lower.ends_with(".bin") {
        Some("bin")
    } else {
        None
    }
}

fn normalize_polyglot_uci(uci: &str) -> String {
    match uci {
        "e1h1" => "e1g1".to_string(),
        "e1a1" => "e1c1".to_string(),
        "e8h8" => "e8g8".to_string(),
        "e8a8" => "e8c8".to_string(),
        _ => uci.to_string(),
    }
}

fn choose_weighted_index(weights: &[u16], rng: &mut impl Rng) -> usize {
    let total: u64 = weights.iter().map(|w| *w as u64).sum();
    if total == 0 {
        return rng.gen_range(0..weights.len());
    }

    let mut target = rng.gen_range(0..total);
    for (index, weight) in weights.iter().enumerate() {
        let weight = *weight as u64;
        if target < weight {
            return index;
        }
        target -= weight;
    }

    weights.len().saturating_sub(1)
}

fn apply_opening_book(config: GameConfig) -> Result<OpeningBookResult, Error> {
    let Some(opening_book) = &config.opening_book else {
        return Ok(OpeningBookResult {
            config,
            polyglot_book: None,
            polyglot_max_ply: 0,
        });
    };

    let path = &opening_book.path;
    let max_ply = opening_book.max_ply.max(1);
    let ext = PathBuf::from(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());

    let is_human_vs_human = matches!(
        (&config.white, &config.black),
        (PlayerConfig::Human { .. }, PlayerConfig::Human { .. })
    );

    enum BookAction {
        Selection(OpeningBookSelection),
        Polyglot(PolyglotBook),
        Skip,
    }

    let action = match ext.as_deref() {
        Some("epd") => {
            BookAction::Selection(select_random_epd_entry(BufReader::new(File::open(path)?))?)
        }
        Some("pgn") => BookAction::Selection(select_random_pgn_entry(File::open(path)?)?),
        Some("bin") => {
            if is_human_vs_human {
                BookAction::Skip
            } else {
                BookAction::Polyglot(PolyglotBook::load(path)?)
            }
        }
        Some("zip") => {
            let (inner_name, data) = read_zip_inner(path)?;
            match opening_book_ext(&inner_name) {
                Some("epd") => BookAction::Selection(select_random_epd_entry(BufReader::new(
                    Cursor::new(data),
                ))?),
                Some("pgn") => BookAction::Selection(select_random_pgn_entry(Cursor::new(data))?),
                Some("bin") => {
                    if is_human_vs_human {
                        BookAction::Skip
                    } else {
                        let mut temp = tempfile::NamedTempFile::new()?;
                        temp.write_all(&data)?;
                        temp.flush()?;
                        let temp_path = temp.path().to_str().ok_or_else(|| {
                            std::io::Error::new(
                                std::io::ErrorKind::InvalidData,
                                "Temporary Polyglot book path is not valid UTF-8",
                            )
                        })?;
                        BookAction::Polyglot(PolyglotBook::load(temp_path)?)
                    }
                }
                _ => {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "Zip must contain a .pgn, .epd, or .bin file",
                    )
                    .into())
                }
            }
        }
        _ => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Unsupported opening book format. Use .pgn, .epd, .bin, or .zip",
            )
            .into())
        }
    };

    match action {
        BookAction::Selection(selection) => {
            let mut next = config;
            next.initial_fen = Some(selection.initial_fen);
            next.initial_moves = selection.initial_moves;
            Ok(OpeningBookResult {
                config: next,
                polyglot_book: None,
                polyglot_max_ply: 0,
            })
        }
        BookAction::Polyglot(book) => Ok(OpeningBookResult {
            config,
            polyglot_book: Some(book),
            polyglot_max_ply: max_ply,
        }),
        BookAction::Skip => Ok(OpeningBookResult {
            config,
            polyglot_book: None,
            polyglot_max_ply: 0,
        }),
    }
}

fn spawn_engine_task(
    game_id: &GameId,
    controller: &Arc<RwLock<GameController>>,
    app: &AppHandle,
) -> tokio::task::JoinHandle<Result<(), Error>> {
    let game_id_clone = game_id.clone();
    let controller_clone = controller.clone();
    let app_clone = app.clone();
    tokio::spawn(
        async move { request_engine_move(&game_id_clone, &controller_clone, &app_clone).await },
    )
}

async fn maybe_start_engine(
    controller: &Arc<RwLock<GameController>>,
    engine_task: &Option<tokio::task::JoinHandle<Result<(), Error>>>,
) -> bool {
    let mut ctrl = controller.write().await;
    if ctrl.status == GameStatus::Playing
        && ctrl.is_engine_turn()
        && !ctrl.engine_thinking
        && engine_task.is_none()
    {
        ctrl.engine_thinking = true;
        true
    } else {
        false
    }
}

async fn game_loop(
    game_id: GameId,
    controller: Arc<RwLock<GameController>>,
    mut shutdown_rx: watch::Receiver<bool>,
    mut move_notify_rx: tokio::sync::mpsc::Receiver<()>,
    app: AppHandle,
) {
    let mut clock_interval = interval(Duration::from_millis(100));
    let mut engine_task: Option<tokio::task::JoinHandle<Result<(), Error>>> = None;

    if maybe_start_engine(&controller, &engine_task).await {
        engine_task = Some(spawn_engine_task(&game_id, &controller, &app));
    }

    loop {
        tokio::select! {
            biased;

            _ = shutdown_rx.changed() => {
                if *shutdown_rx.borrow() {
                    info!("Game {} shutting down", game_id);
                    if let Some(task) = engine_task.take() {
                        task.abort();
                    }
                    break;
                }
            }

            result = async {
                if let Some(ref mut task) = engine_task {
                    Some(task.await)
                } else {
                    std::future::pending::<Option<Result<Result<(), Error>, tokio::task::JoinError>>>().await
                }
            } => {
                engine_task = None;

                match result {
                    Some(Ok(Ok(()))) => {
                        if maybe_start_engine(&controller, &engine_task).await {
                            engine_task = Some(spawn_engine_task(&game_id, &controller, &app));
                        }
                    }
                    Some(Ok(Err(e))) => {
                        error!("Engine move error: {:?}", e);
                        let mut ctrl = controller.write().await;
                        ctrl.engine_thinking = false;
                        let result = if ctrl.position.turn() == Color::White {
                            GameResult::BlackWins { reason: GameEndReason::Abandonment }
                        } else {
                            GameResult::WhiteWins { reason: GameEndReason::Abandonment }
                        };
                        ctrl.end_game(result.clone());
                        let _ = GameOverEvent { game_id: game_id.clone(), result, moves: ctrl.moves.clone() }.emit(&app);
                        break;
                    }
                    Some(Err(_join_error)) => {
                        let mut ctrl = controller.write().await;
                        ctrl.engine_thinking = false;
                        let result = if ctrl.position.turn() == Color::White {
                            GameResult::BlackWins { reason: GameEndReason::Abandonment }
                        } else {
                            GameResult::WhiteWins { reason: GameEndReason::Abandonment }
                        };
                        ctrl.end_game(result.clone());
                        let _ = GameOverEvent { game_id: game_id.clone(), result, moves: ctrl.moves.clone() }.emit(&app);
                        break;
                    }
                    None => unreachable!(),
                }
            }

            _ = move_notify_rx.recv() => {
                if engine_task.is_none() && maybe_start_engine(&controller, &engine_task).await {
                    engine_task = Some(spawn_engine_task(&game_id, &controller, &app));
                }
            }

            _ = clock_interval.tick() => {
                let is_finished;

                {
                    let mut ctrl = controller.write().await;

                    if ctrl.status != GameStatus::Playing {
                        break;
                    }

                    if let Some(result) = ctrl.check_timeout() {
                        ctrl.end_game(result.clone());
                        let _ = GameOverEvent { game_id: game_id.clone(), result, moves: ctrl.moves.clone() }.emit(&app);
                        break;
                    }

                    let (white_time, black_time) = ctrl.get_current_times();
                    let _ = ClockUpdateEvent {
                        game_id: game_id.clone(),
                        white_time,
                        black_time,
                    }.emit(&app);

                    is_finished = ctrl.status != GameStatus::Playing;
                }

                if is_finished {
                    break;
                }
            }
        }
    }

    if let Some(task) = engine_task.take() {
        task.abort();
    }

    {
        let ctrl = controller.read().await;
        if let Some(engine) = &ctrl.white_engine {
            let mut proc = engine.lock().await;
            let _ = proc.quit().await;
        }
        if let Some(engine) = &ctrl.black_engine {
            let mut proc = engine.lock().await;
            let _ = proc.quit().await;
        }
    }

    info!("Game loop ended for {}", game_id);
}

fn try_polyglot_book_move(controller: &GameController) -> Option<String> {
    let book = controller.polyglot_book.as_ref()?;

    if controller.moves.len() >= controller.polyglot_max_ply {
        return None;
    }

    let fen = Fen::from_position(controller.position.clone(), EnPassantMode::Legal).to_string();
    let entries = book.get_all_moves_from_fen(&fen);

    if entries.is_empty() {
        return None;
    }

    let mut rng = rand::thread_rng();
    let legal_moves = entries
        .into_iter()
        .filter_map(|entry| {
            let uci = normalize_polyglot_uci(&entry.move_string);
            let parsed = UciMove::from_ascii(uci.as_bytes()).ok()?;
            parsed.to_move(&controller.position).ok()?;
            Some((uci, entry.weight))
        })
        .collect::<Vec<_>>();

    if legal_moves.is_empty() {
        return None;
    }

    let weights = legal_moves.iter().map(|(_, w)| *w).collect::<Vec<_>>();
    let selected = choose_weighted_index(&weights, &mut rng);
    Some(legal_moves[selected].0.clone())
}

fn clamp_f64(value: f64, min: f64, max: f64) -> f64 {
    value.min(max).max(min)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MoveTempo {
    Book,
    Opening,
    Forced,
    Recapture,
    CheckEvasion,
    Normal,
}

impl MoveTempo {
    fn is_automatic(self) -> bool {
        matches!(
            self,
            MoveTempo::Book | MoveTempo::Opening | MoveTempo::Forced | MoveTempo::Recapture
        )
    }

    fn is_opening_like(self) -> bool {
        matches!(self, MoveTempo::Book | MoveTempo::Opening)
    }
}

#[derive(Clone, Copy)]
struct ClockShape {
    expected_moves: f64,
    reserve_fraction: f64,
    quick_floor_ms: f64,
    opening_cap_ms: f64,
    recapture_cap_ms: f64,
    forced_cap_ms: f64,
    check_cap_ms: f64,
    opening_weight: f64,
    early_weight: f64,
    middle_weight: f64,
    late_weight: f64,
    endgame_weight: f64,
    opening_fast_moves: u32,
}

fn clock_shape(initial_time_ms: u64, increment_ms: u64) -> ClockShape {
    let estimated_total_ms = initial_time_ms + increment_ms.saturating_mul(40);

    match estimated_total_ms {
        0..=120_000 => ClockShape {
            expected_moves: 34.0,
            reserve_fraction: 0.035,
            quick_floor_ms: 45.0,
            opening_cap_ms: 450.0,
            recapture_cap_ms: 300.0,
            forced_cap_ms: 180.0,
            check_cap_ms: 700.0,
            opening_weight: 0.07,
            early_weight: 0.18,
            middle_weight: 0.68,
            late_weight: 0.55,
            endgame_weight: 0.42,
            opening_fast_moves: 8,
        },
        120_001..=480_000 => ClockShape {
            expected_moves: 40.0,
            reserve_fraction: 0.045,
            quick_floor_ms: 115.0,
            opening_cap_ms: 1_800.0,
            recapture_cap_ms: 650.0,
            forced_cap_ms: 350.0,
            check_cap_ms: 1_100.0,
            opening_weight: 0.13,
            early_weight: 0.25,
            middle_weight: 0.82,
            late_weight: 0.70,
            endgame_weight: 0.55,
            opening_fast_moves: 10,
        },
        480_001..=1_500_000 => ClockShape {
            expected_moves: 44.0,
            reserve_fraction: 0.055,
            quick_floor_ms: 180.0,
            opening_cap_ms: 2_500.0,
            recapture_cap_ms: 1_300.0,
            forced_cap_ms: 700.0,
            check_cap_ms: 2_200.0,
            opening_weight: 0.16,
            early_weight: 0.42,
            middle_weight: 1.0,
            late_weight: 0.82,
            endgame_weight: 0.68,
            opening_fast_moves: 9,
        },
        _ => ClockShape {
            expected_moves: 50.0,
            reserve_fraction: 0.065,
            quick_floor_ms: 300.0,
            opening_cap_ms: 6_500.0,
            recapture_cap_ms: 3_000.0,
            forced_cap_ms: 1_200.0,
            check_cap_ms: 4_500.0,
            opening_weight: 0.22,
            early_weight: 0.55,
            middle_weight: 1.12,
            late_weight: 0.92,
            endgame_weight: 0.76,
            opening_fast_moves: 8,
        },
    }
}

fn time_control_reserve(initial_time_ms: u64, shape: ClockShape) -> f64 {
    let reserve = initial_time_ms as f64 * shape.reserve_fraction;
    clamp_f64(reserve, shape.quick_floor_ms * 5.0, 45_000.0)
}

fn phase_time_multiplier(move_number: u32, shape: ClockShape) -> f64 {
    match move_number {
        1..=8 => shape.opening_weight,
        9..=14 => shape.early_weight,
        15..=32 => shape.middle_weight,
        33..=50 => shape.late_weight,
        _ => shape.endgame_weight,
    }
}

fn rating_time_multiplier(fide_elo: u32, tempo: MoveTempo) -> f64 {
    let normalized = (fide_elo.saturating_sub(800) as f64 / 2200.0).min(1.0);
    if tempo.is_automatic() {
        1.15 - normalized * 0.42
    } else {
        0.78 + normalized * 0.48
    }
}

fn pressure_time_multiplier(current_time: u64, initial_time_ms: u64, increment_ms: u64) -> f64 {
    let soft_floor = (12_000 + increment_ms.saturating_mul(8)).max(initial_time_ms / 35);
    if current_time <= 2_500 {
        0.12
    } else if current_time <= soft_floor / 2 {
        0.24
    } else if current_time <= soft_floor {
        0.42
    } else if current_time <= initial_time_ms / 5 {
        0.72
    } else {
        1.0
    }
}

fn trainer_estimated_seconds_per_move(initial_time_ms: u64, increment_ms: u64) -> f64 {
    (initial_time_ms as f64 + increment_ms as f64 * 40.0) / 40_000.0
}

fn trainer_rating_quality_penalty_scale(fide_elo: u32) -> f64 {
    let clamped = fide_elo.clamp(PATRICIA_MIN_FIDE_ELO, PATRICIA_MAX_FIDE_ELO);
    if clamped <= 2200 {
        0.72 + ((clamped - PATRICIA_MIN_FIDE_ELO) as f64 / 1400.0) * 0.28
    } else {
        1.0 + ((clamped - 2200) as f64 / 800.0) * 0.12
    }
}

fn trainer_quality_penalty_for_seconds_per_move(seconds_per_move: f64, fide_elo: u32) -> u32 {
    let seconds = seconds_per_move.max(0.1);
    let mut raw_penalty = TRAINER_QUALITY_PENALTY_POINTS
        .last()
        .map(|(_, penalty)| *penalty)
        .unwrap_or(0.0);

    if seconds <= TRAINER_QUALITY_PENALTY_POINTS[0].0 {
        raw_penalty = TRAINER_QUALITY_PENALTY_POINTS[0].1
            + (TRAINER_QUALITY_PENALTY_POINTS[0].0 - seconds) * 90.0;
    } else {
        for pair in TRAINER_QUALITY_PENALTY_POINTS.windows(2) {
            let (previous_seconds, previous_penalty) = pair[0];
            let (next_seconds, next_penalty) = pair[1];
            if seconds <= next_seconds {
                let t = (seconds - previous_seconds) / (next_seconds - previous_seconds);
                raw_penalty = previous_penalty + (next_penalty - previous_penalty) * t;
                break;
            }
        }
    }

    clamp_f64(
        raw_penalty * trainer_rating_quality_penalty_scale(fide_elo),
        0.0,
        850.0,
    )
    .round() as u32
}

fn trainer_time_control_quality_penalty(
    fide_elo: u32,
    initial_time_ms: u64,
    increment_ms: u64,
) -> u32 {
    trainer_quality_penalty_for_seconds_per_move(
        trainer_estimated_seconds_per_move(initial_time_ms, increment_ms),
        fide_elo,
    )
}

fn trainer_time_control_strength_elo(
    fide_elo: u32,
    initial_time_ms: u64,
    increment_ms: u64,
) -> u32 {
    fide_elo
        .saturating_sub(trainer_time_control_quality_penalty(
            fide_elo,
            initial_time_ms,
            increment_ms,
        ))
        .clamp(PATRICIA_MIN_FIDE_ELO, PATRICIA_MAX_FIDE_ELO)
}

fn patricia_skill_level_from_elo(target_elo: u32) -> u32 {
    let target = target_elo.clamp(PATRICIA_MIN_FIDE_ELO, PATRICIA_MAX_FIDE_ELO);
    let mut best_index = 0;
    let mut best_distance = u32::MAX;
    for (index, elo) in PATRICIA_SKILL_LEVELS.iter().enumerate() {
        let distance = elo.abs_diff(target);
        if distance < best_distance {
            best_index = index;
            best_distance = distance;
        }
    }
    (best_index + 1) as u32
}

fn trainer_pressure_adjusted_strength_elo(
    delay: &EngineMoveDelay,
    current_time: Option<u64>,
    ply: usize,
) -> Option<u32> {
    let fide_elo = delay.fide_elo?;
    let initial_time_ms = delay
        .initial_time_ms
        .map(|time| time as u64)
        .or(current_time)
        .unwrap_or(180_000)
        .max(1);
    let increment_ms = delay.increment_ms.unwrap_or(0) as u64;
    let base_strength = delay.strength_elo.unwrap_or_else(|| {
        trainer_time_control_strength_elo(fide_elo, initial_time_ms, increment_ms)
    });
    let current_time = current_time?;
    let shape = clock_shape(initial_time_ms, increment_ms);
    let move_number = (ply / 2 + 1) as f64;
    let remaining_moves = (shape.expected_moves - move_number).max(8.0);
    let current_seconds_per_move =
        (current_time as f64 + increment_ms as f64 * remaining_moves) / 1000.0 / remaining_moves;
    let initial_penalty =
        trainer_time_control_quality_penalty(fide_elo, initial_time_ms, increment_ms);
    let current_penalty =
        trainer_quality_penalty_for_seconds_per_move(current_seconds_per_move, fide_elo);
    let scramble_penalty = current_penalty.saturating_sub(initial_penalty)
        + if current_time <= 2_500 {
            180
        } else if current_time <= 5_000 {
            100
        } else if current_seconds_per_move <= 2.0 {
            70
        } else {
            0
        };

    Some(
        base_strength
            .saturating_sub(scramble_penalty)
            .clamp(PATRICIA_MIN_FIDE_ELO, PATRICIA_MAX_FIDE_ELO),
    )
}

fn complexity_time_multiplier(position: &Chess, tempo: MoveTempo) -> f64 {
    if tempo.is_automatic() {
        return 1.0;
    }

    let legal_moves = position.legal_moves().len() as f64;
    let legal_factor = clamp_f64(0.72 + (legal_moves / 34.0), 0.7, 1.55);
    let check_factor = if position.is_check() { 1.35 } else { 1.0 };
    legal_factor * check_factor
}

fn move_to_square(mv: &Move) -> Option<Square> {
    match mv {
        Move::Normal { to, .. } | Move::EnPassant { to, .. } | Move::Put { to, .. } => Some(*to),
        Move::Castle { .. } => None,
    }
}

fn last_move_to_square(last_uci: Option<&str>) -> Option<Square> {
    let last_uci = last_uci?;
    let bytes = last_uci.as_bytes();
    if bytes.len() < 4 {
        return None;
    }
    Square::from_ascii(&bytes[2..4]).ok()
}

fn is_obvious_recapture(position: &Chess, last_uci: Option<&str>) -> bool {
    let Some(target) = last_move_to_square(last_uci) else {
        return false;
    };

    let recaptures = position
        .legal_moves()
        .iter()
        .filter(|mv| mv.is_capture() && move_to_square(mv) == Some(target))
        .count();

    recaptures == 1
}

fn classify_move_tempo(
    position: &Chess,
    ply: usize,
    last_uci: Option<&str>,
    book_move: bool,
    shape: ClockShape,
) -> MoveTempo {
    let legal_moves = position.legal_moves().len();
    let move_number = (ply / 2 + 1) as u32;

    if legal_moves <= 1 {
        return MoveTempo::Forced;
    }
    if is_obvious_recapture(position, last_uci) {
        return MoveTempo::Recapture;
    }
    if position.is_check() && legal_moves <= 5 {
        return MoveTempo::CheckEvasion;
    }
    if book_move {
        return MoveTempo::Book;
    }
    if move_number <= shape.opening_fast_moves {
        return MoveTempo::Opening;
    }

    MoveTempo::Normal
}

fn tempo_cap_ms(tempo: MoveTempo, shape: ClockShape) -> Option<f64> {
    match tempo {
        MoveTempo::Book | MoveTempo::Opening => Some(shape.opening_cap_ms),
        MoveTempo::Forced => Some(shape.forced_cap_ms),
        MoveTempo::Recapture => Some(shape.recapture_cap_ms),
        MoveTempo::CheckEvasion => Some(shape.check_cap_ms),
        MoveTempo::Normal => None,
    }
}

fn opening_floor_ms(shape: ClockShape) -> f64 {
    clamp_f64(
        shape.quick_floor_ms * 2.8,
        shape.quick_floor_ms,
        shape.opening_cap_ms * 0.55,
    )
}

fn opening_cadence_multiplier(move_number: u32, rng: &mut impl Rng) -> f64 {
    let stage = match move_number {
        1..=2 => 0.88,
        3..=6 => 1.0,
        _ => 1.12,
    };
    let roll = rng.gen_range(0.0..1.0_f64);
    let cadence = if roll < 0.14 {
        rng.gen_range(1.75..=3.25)
    } else if roll < 0.58 {
        rng.gen_range(0.85..=1.55)
    } else {
        rng.gen_range(0.48..=0.9)
    };
    stage * cadence
}

fn choose_engine_move_delay(
    delay: &EngineMoveDelay,
    current_time: Option<u64>,
    ply: usize,
    position: &Chess,
    last_uci: Option<&str>,
    book_move: bool,
) -> Duration {
    let min_ms = delay.min_ms.min(delay.max_ms);
    let max_ms = delay.max_ms.max(delay.min_ms);

    if let Some(fide_elo) = delay.fide_elo {
        let initial_time_ms = delay
            .initial_time_ms
            .map(|time| time as u64)
            .or(current_time)
            .unwrap_or(180_000)
            .max(1);
        let increment_ms = delay.increment_ms.unwrap_or(0) as u64;
        let current_time = current_time.unwrap_or(initial_time_ms);
        let shape = clock_shape(initial_time_ms, increment_ms);
        let tempo = classify_move_tempo(position, ply, last_uci, book_move, shape);

        if current_time <= 450 {
            return Duration::from_millis(0);
        }

        let expected_moves = shape.expected_moves;
        let move_number = (ply / 2 + 1) as u32;
        let remaining_moves = (expected_moves - move_number as f64).max(8.0);
        let reserve = time_control_reserve(initial_time_ms, shape);
        let usable_time = (current_time as f64 - reserve).max(0.0);
        let sustainable = usable_time / remaining_moves + increment_ms as f64 * 0.62;
        let average_budget =
            (initial_time_ms as f64 + increment_ms as f64 * expected_moves) / expected_moves;
        let mut rng = rand::thread_rng();

        let mut target = average_budget * 0.25 + sustainable * 0.75;
        target *= phase_time_multiplier(move_number, shape);
        target *= complexity_time_multiplier(position, tempo);
        target *= rating_time_multiplier(fide_elo.clamp(800, 3000), tempo);
        target *= pressure_time_multiplier(current_time, initial_time_ms, increment_ms);

        if tempo.is_opening_like() {
            target *= opening_cadence_multiplier(move_number, &mut rng);
        } else if tempo.is_automatic() {
            target *= 0.72;
        } else if tempo == MoveTempo::CheckEvasion {
            target *= 0.86;
        }

        let sigma = 0.78 - ((fide_elo.saturating_sub(800) as f64 / 2200.0).min(1.0) * 0.32);
        let noise = (rng.gen_range(-1.0..=1.0_f64) * sigma).exp();
        target *= noise;

        let complexity = complexity_time_multiplier(position, tempo);
        let long_think_probability = clamp_f64((complexity - 0.85) * 0.12, 0.02, 0.16);
        if tempo == MoveTempo::Normal
            && move_number > shape.opening_fast_moves
            && current_time > initial_time_ms / 8
            && rng.gen_bool(long_think_probability)
        {
            target *= rng.gen_range(1.8..=3.8);
        }

        let safety_margin = if current_time < 5_000 {
            350
        } else if initial_time_ms <= 180_000 {
            900
        } else if initial_time_ms <= 600_000 {
            2_000
        } else {
            5_000
        };
        let clock_cap = current_time.saturating_sub(safety_margin) as f64;
        let sustainable_cap = (sustainable * 4.5 + increment_ms as f64 * 0.8).max(min_ms as f64);
        let tempo_cap = tempo_cap_ms(tempo, shape).unwrap_or(max_ms as f64);
        let max_spend = clock_cap
            .min(max_ms as f64)
            .min(sustainable_cap)
            .min(tempo_cap)
            .max(0.0);
        let min_spend = if tempo.is_opening_like() {
            opening_floor_ms(shape) * rng.gen_range(0.82..=1.28)
        } else if tempo.is_automatic() {
            shape.quick_floor_ms * rng.gen_range(0.82..=1.22)
        } else {
            min_ms as f64
        }
        .min(max_spend);
        let selected_ms = clamp_f64(target, min_spend, max_spend).round() as u64;

        return Duration::from_millis(selected_ms);
    }

    let mut rng = rand::thread_rng();
    let selected = if min_ms == max_ms {
        min_ms
    } else {
        rng.gen_range(min_ms..=max_ms)
    };

    let selected_ms = selected as u64;
    let clamped = current_time
        .map(|time| {
            if time <= 750 {
                0
            } else {
                selected_ms.min(time.saturating_sub(750))
            }
        })
        .unwrap_or(selected_ms);

    Duration::from_millis(clamped)
}

async fn request_engine_move(
    game_id: &str,
    controller: &Arc<RwLock<GameController>>,
    app: &AppHandle,
) -> Result<(), Error> {
    // Try polyglot book move first (only for engine turns with a loaded book)
    {
        let ctrl = controller.read().await;
        let book_move = try_polyglot_book_move(&ctrl);
        let turn = ctrl.position.turn();
        let player_config = ctrl.current_turn_player().clone();
        let (white_time, black_time) = ctrl.get_current_times();
        let current_time = if turn == Color::White {
            white_time
        } else {
            black_time
        };
        let move_delay = match player_config {
            PlayerConfig::Engine { move_delay, .. } => move_delay.as_ref().map(|delay| {
                choose_engine_move_delay(
                    delay,
                    current_time,
                    ctrl.moves.len(),
                    &ctrl.position,
                    ctrl.moves.last().map(|mv| mv.uci.as_str()),
                    book_move.is_some(),
                )
            }),
            _ => None,
        };
        drop(ctrl);

        if let Some(book_uci) = book_move {
            if let Some(delay) = move_delay {
                if !delay.is_zero() {
                    tokio::time::sleep(delay).await;
                }
            }

            let mut ctrl = controller.write().await;
            ctrl.engine_thinking = false;

            if ctrl.status != GameStatus::Playing || ctrl.position.turn() != turn {
                return Ok(());
            }

            let game_move = ctrl.apply_move(&book_uci)?;
            let (white_time, black_time) = ctrl.get_current_times();

            GameMoveEvent {
                game_id: game_id.to_string(),
                moves: ctrl.moves.clone(),
                fen: game_move.fen_after,
                white_time,
                black_time,
            }
            .emit(app)?;

            if let GameStatus::Finished { result } = &ctrl.status {
                GameOverEvent {
                    game_id: game_id.to_string(),
                    result: result.clone(),
                    moves: ctrl.moves.clone(),
                }
                .emit(app)?;
            }

            return Ok(());
        }
    }

    let (engine_arc, go_mode, move_delay, dynamic_strength_elo, initial_fen, moves, turn) = {
        let ctrl = controller.read().await;

        if ctrl.status != GameStatus::Playing {
            return Ok(());
        }

        let turn = ctrl.position.turn();
        let (engine_arc, player_config) = if turn == Color::White {
            (ctrl.white_engine.clone(), ctrl.config.white.clone())
        } else {
            (ctrl.black_engine.clone(), ctrl.config.black.clone())
        };

        let engine = match engine_arc {
            Some(e) => e,
            None => return Err(Error::EngineNotInitialized),
        };

        let (go, use_clock_time_management, delay) = match player_config {
            PlayerConfig::Engine {
                go,
                use_clock_time_management,
                move_delay,
                ..
            } => (go, use_clock_time_management, move_delay),
            _ => return Err(Error::NotEngineTurn),
        };

        let initial_fen = ctrl.initial_fen.clone();
        let moves: Vec<String> = ctrl.moves.iter().map(|m| m.uci.clone()).collect();
        let (white_time, black_time) = ctrl.get_current_times();

        let current_time = if turn == Color::White {
            white_time
        } else {
            black_time
        };

        let selected_delay = delay.as_ref().map(|delay| {
            choose_engine_move_delay(
                delay,
                current_time,
                moves.len(),
                &ctrl.position,
                moves.last().map(|mv| mv.as_str()),
                false,
            )
        });
        let use_delay_as_move_time = delay
            .as_ref()
            .map(|delay| delay.use_as_move_time)
            .unwrap_or(false);
        let dynamic_strength_elo = delay.as_ref().and_then(|delay| {
            trainer_pressure_adjusted_strength_elo(delay, current_time, moves.len())
        });

        let go_mode = if use_delay_as_move_time {
            let move_time = selected_delay
                .map(|delay| delay.as_millis().clamp(1, u32::MAX as u128) as u32)
                .unwrap_or(1);
            GoMode::Time(move_time)
        } else if current_time.is_some() && use_clock_time_management {
            let (winc, binc) = ctrl
                .clock
                .as_ref()
                .map(|c| (c.white_increment as u32, c.black_increment as u32))
                .unwrap_or((0, 0));

            let wt = white_time.unwrap_or(u64::MAX) as u32;
            let bt = black_time.unwrap_or(u64::MAX) as u32;
            GoMode::PlayersTime(PlayersTime::new(wt, bt, winc, binc))
        } else {
            go.unwrap_or(GoMode::Depth(20))
        };

        let move_delay = if use_delay_as_move_time {
            None
        } else {
            selected_delay
        };

        (
            engine,
            go_mode,
            move_delay,
            dynamic_strength_elo,
            initial_fen,
            moves,
            turn,
        )
    };

    if let Some(delay) = move_delay {
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
    }

    let best_move = {
        let mut engine = engine_arc.lock().await;
        if let Some(strength_elo) = dynamic_strength_elo {
            engine.set_option("UCI_LimitStrength", "true").await?;
            engine
                .set_option("UCI_Elo", &strength_elo.to_string())
                .await?;
            engine
                .set_option(
                    "Skill_Level",
                    &patricia_skill_level_from_elo(strength_elo).to_string(),
                )
                .await?;
        }
        engine.set_position(&initial_fen, &moves).await?;
        engine.go(&go_mode).await?;
        engine.wait_for_bestmove().await?
    };

    let mut ctrl = controller.write().await;
    ctrl.engine_thinking = false;

    if ctrl.status != GameStatus::Playing {
        return Ok(());
    }

    if ctrl.position.turn() != turn {
        return Ok(());
    }

    let game_move = ctrl.apply_move(&best_move)?;
    let (white_time, black_time) = ctrl.get_current_times();

    GameMoveEvent {
        game_id: game_id.to_string(),
        moves: ctrl.moves.clone(),
        fen: game_move.fen_after,
        white_time,
        black_time,
    }
    .emit(app)?;

    if let GameStatus::Finished { result } = &ctrl.status {
        GameOverEvent {
            game_id: game_id.to_string(),
            result: result.clone(),
            moves: ctrl.moves.clone(),
        }
        .emit(app)?;
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn start_game(
    game_id: String,
    config: GameConfig,
    app: AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<GameState, Error> {
    info!("Starting game with ID {}", game_id);
    state.game_manager.start_game(game_id, config, app).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_game_state(
    game_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<GameState, Error> {
    state.game_manager.get_game_state(&game_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn make_game_move(
    game_id: String,
    uci: String,
    app: AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<GameState, Error> {
    state.game_manager.make_move(&game_id, &uci, &app).await
}

#[tauri::command]
#[specta::specta]
pub async fn take_back_game_move(
    game_id: String,
    app: AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<GameState, Error> {
    state.game_manager.take_back_move(&game_id, &app).await
}

#[tauri::command]
#[specta::specta]
pub async fn resign_game(
    game_id: String,
    color: String,
    app: AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<GameState, Error> {
    state.game_manager.resign(&game_id, &color, &app).await
}

#[tauri::command]
#[specta::specta]
pub async fn abort_game(
    game_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), Error> {
    state.game_manager.abort_game(&game_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_game_engine_logs(
    game_id: String,
    color: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<EngineLog>, Error> {
    state.game_manager.get_engine_logs(&game_id, &color).await
}

#[cfg(test)]
mod timing_tests {
    use super::*;

    fn pos(fen: &str) -> Chess {
        parse_fen_to_position(fen).unwrap()
    }

    #[test]
    fn classifies_early_known_positions_as_opening_tempo() {
        let shape = clock_shape(180_000, 2_000);
        let position = pos("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");

        assert_eq!(
            classify_move_tempo(&position, 0, None, false, shape),
            MoveTempo::Opening
        );
    }

    #[test]
    fn classifies_single_reply_capture_as_recapture_tempo() {
        let shape = clock_shape(180_000, 2_000);
        let position = pos("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2");

        assert_eq!(
            classify_move_tempo(&position, 2, Some("d7d5"), false, shape),
            MoveTempo::Recapture
        );
    }

    #[test]
    fn blitz_opening_delay_stays_under_opening_cap() {
        let delay = EngineMoveDelay {
            min_ms: 90,
            max_ms: 9_900,
            fide_elo: Some(1600),
            strength_elo: Some(1398),
            initial_time_ms: Some(180_000),
            increment_ms: Some(2_000),
            use_as_move_time: false,
        };
        let position = pos("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");

        let selected = choose_engine_move_delay(&delay, Some(180_000), 0, &position, None, false);

        assert!(selected.as_millis() <= 1_800);
        assert!(selected.as_millis() >= 240);
    }

    #[test]
    fn three_zero_uses_blitz_opening_pacing() {
        let shape = clock_shape(180_000, 0);

        assert_eq!(shape.opening_cap_ms, 1_800.0);
        assert_eq!(shape.quick_floor_ms, 115.0);
    }

    #[test]
    fn bullet_opening_delay_is_quick_but_not_instant() {
        let delay = EngineMoveDelay {
            min_ms: 42,
            max_ms: 4_800,
            fide_elo: Some(1800),
            strength_elo: Some(1559),
            initial_time_ms: Some(60_000),
            increment_ms: Some(0),
            use_as_move_time: true,
        };
        let position = pos("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");

        let selected = choose_engine_move_delay(&delay, Some(60_000), 0, &position, None, false);

        assert!(selected.as_millis() <= 450);
        assert!(selected.as_millis() >= 90);
    }

    #[test]
    fn trainer_strength_uses_time_control_quality_handicap() {
        let blitz = trainer_time_control_strength_elo(2200, 180_000, 2_000);
        let rapid = trainer_time_control_strength_elo(2200, 900_000, 10_000);
        let classical = trainer_time_control_strength_elo(2200, 1_800_000, 20_000);

        assert!(blitz < rapid);
        assert!(rapid < classical);
        assert_eq!(classical, 2200);
        assert!((1940..=1985).contains(&blitz));
    }

    #[test]
    fn trainer_strength_drops_again_in_time_scrambles() {
        let delay = EngineMoveDelay {
            min_ms: 90,
            max_ms: 9_900,
            fide_elo: Some(2200),
            strength_elo: Some(trainer_time_control_strength_elo(2200, 180_000, 2_000)),
            initial_time_ms: Some(180_000),
            increment_ms: Some(2_000),
            use_as_move_time: true,
        };

        let normal = trainer_pressure_adjusted_strength_elo(&delay, Some(120_000), 20).unwrap();
        let scramble = trainer_pressure_adjusted_strength_elo(&delay, Some(8_000), 50).unwrap();
        let panic = trainer_pressure_adjusted_strength_elo(&delay, Some(2_000), 50).unwrap();

        assert!(normal >= delay.strength_elo.unwrap() - 25);
        assert!(scramble < normal);
        assert!(panic < scramble);
    }
}
