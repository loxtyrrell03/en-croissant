use std::{
    collections::HashMap,
    fmt::Display,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use derivative::Derivative;
use governor::{Quota, RateLimiter};
use log::{info, warn};
use nonzero_ext::*;
use serde::{Deserialize, Serialize};
use shakmaty::{
    fen::Fen, san::SanPlus, uci::UciMove, ByColor, CastlingMode, Chess, Color, EnPassantMode,
    FromSetup, Position, PositionError, Role,
};
use specta::Type;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;
use tokio::sync::Mutex;
use vampirc_uci::{
    parse_one,
    uci::{Score, ScoreValue},
    UciInfoAttribute, UciMessage, UciOptionConfig,
};

use crate::{
    db::{
        encoding::{
            decode_move, COMMENT_MARKER, NAG_MARKER, VARIATION_END_MARKER, VARIATION_START_MARKER,
        },
        is_position_in_db, load_mistake_review_games, load_mistake_review_games_by_ids,
        upsert_mistake_review_move_evals, GameQuery, MistakeReviewGameRow,
        MistakeReviewMoveEvalEntry, PositionQueryJs,
    },
    engine::{
        parse_fen_and_apply_moves, BaseEngine, EngineLog, EngineOption, EngineReader, GoMode,
    },
    error::Error,
    progress::update_progress,
    AppState,
};

const MISTAKE_REVIEW_EVAL_CACHE_BATCH_SIZE: usize = 200;
const ENGINE_IDLE_SHUTDOWN_AFTER: Duration = Duration::from_secs(20);

pub struct EngineProcess {
    base: BaseEngine,
    last_depth: u32,
    best_moves: Vec<BestMoves>,
    last_best_moves: Vec<BestMoves>,
    last_progress: f32,
    options: EngineOptions,
    go_mode: GoMode,
    running: bool,
    idle_generation: u64,
    real_multipv: u16,
    start: Instant,
}

impl EngineProcess {
    async fn new(path: PathBuf) -> Result<(Self, EngineReader), Error> {
        let mut base = BaseEngine::spawn(path).await?;
        base.init_uci().await?;
        let reader = base.take_reader().ok_or(Error::EngineDisconnected)?;

        Ok((
            Self {
                base,
                last_depth: 0,
                best_moves: Vec::new(),
                last_best_moves: Vec::new(),
                last_progress: 0.0,
                options: EngineOptions::default(),
                real_multipv: 0,
                go_mode: GoMode::Infinite,
                running: false,
                idle_generation: 0,
                start: Instant::now(),
            },
            reader,
        ))
    }

    async fn set_option<T>(&mut self, name: &str, value: T) -> Result<(), Error>
    where
        T: Display,
    {
        self.base.set_option(name, value).await
    }

    async fn set_options(&mut self, options: EngineOptions) -> Result<(), Error> {
        let fen_changed = options.fen != self.options.fen;
        let fen: Fen = options.fen.parse()?;
        let setup = fen.as_setup();
        let castling_mode = CastlingMode::detect(setup);
        let pos = parse_fen_and_apply_moves(&options.fen, &options.moves)?;

        if fen_changed {
            if castling_mode.is_chess960() {
                self.set_option("UCI_Chess960", "true").await?;
            } else {
                self.set_option("UCI_Chess960", "false").await?;
            }
        }

        let multipv = options
            .extra_options
            .iter()
            .find(|x| x.name == "MultiPV")
            .map(|x| x.value.parse().unwrap_or(1))
            .unwrap_or(1);

        self.real_multipv = multipv.min(pos.legal_moves().len() as u16);

        for option in &options.extra_options {
            if !self.options.extra_options.contains(option) && option.name != "UCI_Chess960" {
                self.set_option(&option.name, &option.value).await?;
            }
        }

        if fen_changed || options.moves != self.options.moves {
            self.set_position(&options.fen, &options.moves).await?;
        }
        self.last_depth = 0;
        self.options = options.clone();
        self.best_moves.clear();
        self.last_best_moves.clear();
        Ok(())
    }

    async fn set_position(&mut self, fen: &str, moves: &[String]) -> Result<(), Error> {
        self.base.set_position(fen, moves).await?;
        self.options.fen = fen.to_string();
        self.options.moves = moves.to_owned();
        Ok(())
    }

    async fn go(&mut self, mode: &GoMode) -> Result<(), Error> {
        self.go_mode = mode.clone();
        self.base.go(mode).await?;
        self.running = true;
        self.idle_generation = self.idle_generation.wrapping_add(1);
        self.start = Instant::now();
        Ok(())
    }

    async fn stop(&mut self) -> Result<u64, Error> {
        if self.running {
            self.base.stop().await?;
        }
        self.running = false;
        self.idle_generation = self.idle_generation.wrapping_add(1);
        Ok(self.idle_generation)
    }

    fn mark_finished(&mut self) -> u64 {
        self.running = false;
        self.idle_generation = self.idle_generation.wrapping_add(1);
        self.idle_generation
    }

    async fn kill(&mut self) -> Result<(), Error> {
        self.base.quit().await?;
        self.running = false;
        self.idle_generation = self.idle_generation.wrapping_add(1);
        Ok(())
    }

    pub fn kill_sync(&mut self) {
        self.base.kill_sync();
    }
}

#[derive(Clone, Serialize, Debug, Derivative, Type)]
#[derivative(Default)]
pub struct BestMoves {
    nodes: u32,
    depth: u32,
    score: Score,
    #[serde(rename = "uciMoves")]
    uci_moves: Vec<String>,
    #[serde(rename = "sanMoves")]
    san_moves: Vec<String>,
    #[derivative(Default(value = "1"))]
    multipv: u16,
    nps: u32,
}

#[derive(Serialize, Debug, Clone, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct BestMovesPayload {
    pub best_lines: Vec<BestMoves>,
    pub engine: String,
    pub tab: String,
    pub fen: String,
    pub moves: Vec<String>,
    pub progress: f64,
}

fn invert_score(score: Score) -> Score {
    let new_value = match score.value {
        ScoreValue::Cp(x) => ScoreValue::Cp(-x),
        ScoreValue::Mate(x) => ScoreValue::Mate(-x),
    };
    let new_wdl = score.wdl.map(|(w, d, l)| (l, d, w));
    Score {
        value: new_value,
        wdl: new_wdl,
        ..score
    }
}

fn parse_uci_attrs(
    attrs: Vec<UciInfoAttribute>,
    fen: &Fen,
    moves: &[String],
) -> Result<BestMoves, Error> {
    let mut best_moves = BestMoves::default();

    let mut pos = parse_fen_and_apply_moves(&fen.to_string(), moves)?;
    let turn = pos.turn();

    for a in attrs {
        match a {
            UciInfoAttribute::Pv(m) => {
                for mv in m {
                    let uci: UciMove = mv.to_string().parse()?;
                    let m = uci.to_move(&pos)?;
                    let san = SanPlus::from_move_and_play_unchecked(&mut pos, &m);
                    best_moves.san_moves.push(san.to_string());
                    best_moves.uci_moves.push(uci.to_string());
                }
            }
            UciInfoAttribute::Nps(nps) => {
                best_moves.nps = nps as u32;
            }
            UciInfoAttribute::Nodes(nodes) => {
                best_moves.nodes = nodes as u32;
            }
            UciInfoAttribute::Depth(depth) => {
                best_moves.depth = depth;
            }
            UciInfoAttribute::MultiPv(multipv) => {
                best_moves.multipv = multipv;
            }
            UciInfoAttribute::Score(score) => {
                best_moves.score = score;
            }
            _ => (),
        }
    }

    if best_moves.san_moves.is_empty() {
        return Err(Error::NoMovesFound);
    }

    if turn == Color::Black {
        best_moves.score = invert_score(best_moves.score);
    }

    Ok(best_moves)
}

#[derive(Deserialize, Debug, Clone, Type, Derivative, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
#[derivative(Default)]
pub struct EngineOptions {
    pub fen: String,
    pub moves: Vec<String>,
    pub extra_options: Vec<EngineOption>,
}

#[tauri::command]
#[specta::specta]
pub async fn kill_engines(tab: String, state: tauri::State<'_, AppState>) -> Result<(), Error> {
    let keys: Vec<_> = state
        .engine_processes
        .iter()
        .map(|x| x.key().clone())
        .collect();
    for key in keys.clone() {
        if key.0.starts_with(&tab) {
            {
                let process = state.engine_processes.get_mut(&key).unwrap();
                let mut process = process.lock().await;
                process.kill().await?;
            }
            state.engine_processes.remove(&key);
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn kill_engine(
    engine: String,
    tab: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    let key = (tab.clone(), engine.clone());
    if let Some(process_entry) = state.engine_processes.get(&key) {
        let process = process_entry.value().clone();
        drop(process_entry);
        let mut process = process.lock().await;
        process.kill().await?;
    }
    state.engine_processes.remove(&key);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn stop_engine(
    engine: String,
    tab: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    let key = (tab.clone(), engine.clone());
    if let Some(process_entry) = state.engine_processes.get(&key) {
        let process = process_entry.value().clone();
        drop(process_entry);
        let mut process = process.lock().await;
        let generation = process.stop().await?;
        schedule_idle_engine_shutdown(&app, key, generation);
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn stop_matching_engine(
    engine: String,
    tab: String,
    go_mode: GoMode,
    options: EngineOptions,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    let key = (tab.clone(), engine.clone());
    if let Some(process_entry) = state.engine_processes.get(&key) {
        let process = process_entry.value().clone();
        drop(process_entry);
        let mut process = process.lock().await;
        if process.go_mode == go_mode && process.options == options {
            let generation = process.stop().await?;
            schedule_idle_engine_shutdown(&app, key, generation);
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_engine_logs(
    engine: String,
    tab: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<EngineLog>, Error> {
    let key = (tab, engine);
    if let Some(process) = state.engine_processes.get(&key) {
        let process = process.lock().await;
        Ok(process.base.get_logs())
    } else {
        Ok(Vec::new())
    }
}

#[tauri::command]
#[specta::specta]
pub async fn get_best_moves(
    id: String,
    engine: String,
    tab: String,
    go_mode: GoMode,
    options: EngineOptions,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<(f32, Vec<BestMoves>)>, Error> {
    let path = PathBuf::from(&engine);

    let key = (tab.clone(), id.clone());

    if state.engine_processes.contains_key(&key) {
        let mut wait_for_stop = false;
        {
            let process = state.engine_processes.get_mut(&key).unwrap();
            let mut process = process.lock().await;
            if options == process.options && go_mode == process.go_mode && process.running {
                return Ok(Some((
                    process.last_progress,
                    process.last_best_moves.clone(),
                )));
            }
            if process.running {
                process.stop().await?;
                wait_for_stop = true;
            }
        }
        if wait_for_stop {
            // Give the reader task time to consume the engine's bestmove before reusing it.
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        {
            let process = state.engine_processes.get_mut(&key).unwrap();
            let mut process = process.lock().await;
            process.set_options(options.clone()).await?;
            process.go(&go_mode).await?;
        }
        return Ok(None);
    }

    let (mut process, mut reader) = EngineProcess::new(path).await?;
    process.set_options(options.clone()).await?;
    process.go(&go_mode).await?;

    let process = Arc::new(Mutex::new(process));

    state.engine_processes.insert(key.clone(), process.clone());

    let lim = RateLimiter::direct(Quota::per_second(nonzero!(2u32)));

    while let Some(line) = reader.next_line().await? {
        let mut idle_generation = None;
        let mut proc = process.lock().await;
        match parse_one(&line) {
            UciMessage::Info(attrs) => {
                match parse_uci_attrs(attrs, &proc.options.fen.parse()?, &proc.options.moves) {
                    Ok(best_moves) => {
                        if best_moves.score.lower_bound == Some(true)
                            || best_moves.score.upper_bound == Some(true)
                        {
                            continue;
                        }
                        let multipv = best_moves.multipv;
                        let cur_depth = best_moves.depth;
                        let cur_nodes = best_moves.nodes;
                        if multipv as usize == proc.best_moves.len() + 1 {
                            proc.best_moves.push(best_moves);
                            if multipv == proc.real_multipv {
                                if proc.best_moves.iter().all(|x| x.depth == cur_depth)
                                    && cur_depth >= proc.last_depth
                                    && lim.check().is_ok()
                                {
                                    let progress = match proc.go_mode {
                                        GoMode::Depth(depth) => {
                                            (cur_depth as f64 / depth as f64) * 100.0
                                        }
                                        GoMode::Time(time) => {
                                            (proc.start.elapsed().as_millis() as f64 / time as f64)
                                                * 100.0
                                        }
                                        GoMode::Nodes(nodes) => {
                                            (cur_nodes as f64 / nodes as f64) * 100.0
                                        }
                                        GoMode::PlayersTime(_) => 99.99,
                                        GoMode::Infinite => 99.99,
                                    };
                                    BestMovesPayload {
                                        best_lines: proc.best_moves.clone(),
                                        engine: id.clone(),
                                        tab: tab.clone(),
                                        fen: proc.options.fen.clone(),
                                        moves: proc.options.moves.clone(),
                                        progress,
                                    }
                                    .emit(&app)?;
                                    proc.last_depth = cur_depth;
                                    proc.last_best_moves = proc.best_moves.clone();
                                    proc.last_progress = progress as f32;
                                }
                                proc.best_moves.clear();
                            }
                        }
                    }
                    Err(e) => match e {
                        Error::NoMovesFound => {}
                        _ => {
                            warn!("Failed to parse info line: {}, error: {:?}", line, e);
                        }
                    },
                }
            }
            UciMessage::BestMove { .. } => {
                BestMovesPayload {
                    best_lines: proc.last_best_moves.clone(),
                    engine: id.clone(),
                    tab: tab.clone(),
                    fen: proc.options.fen.clone(),
                    moves: proc.options.moves.clone(),
                    progress: 100.0,
                }
                .emit(&app)?;
                proc.last_progress = 100.0;
                idle_generation = Some(proc.mark_finished());
            }
            _ => {}
        }
        proc.base.log_engine(&line);
        drop(proc);

        if let Some(generation) = idle_generation {
            schedule_idle_engine_shutdown(&app, key.clone(), generation);
        }
    }
    info!("Engine process finished: tab: {}, engine: {}", tab, engine);
    state.engine_processes.remove(&key);
    Ok(None)
}

#[derive(Serialize, Debug, Default, Type)]
pub struct MoveAnalysis {
    best: Vec<BestMoves>,
    novelty: bool,
    is_sacrifice: bool,
}

#[derive(Deserialize, Debug, Default, Type)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisOptions {
    pub fen: String,
    pub moves: Vec<String>,
    pub annotate_novelties: bool,
    pub reference_db: Option<PathBuf>,
    pub reversed: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_analysis(id: String, state: tauri::State<'_, AppState>) -> Result<(), Error> {
    if let Some(flag) = state.analysis_cancel_flags.get(&id) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_mistake_review_scan_paused(
    id: String,
    paused: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    if let Some(flag) = state.analysis_pause_flags.get(&id) {
        flag.store(paused, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn analyze_game(
    id: String,
    engine: String,
    go_mode: GoMode,
    options: AnalysisOptions,
    uci_options: Vec<EngineOption>,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<Vec<MoveAnalysis>, Error> {
    let cancel_flag = Arc::new(AtomicBool::new(false));
    state
        .analysis_cancel_flags
        .insert(id.clone(), cancel_flag.clone());

    let path = PathBuf::from(&engine);
    let mut analysis: Vec<MoveAnalysis> = Vec::new();

    let (mut proc, mut reader) = EngineProcess::new(path).await?;

    let fen = Fen::from_ascii(options.fen.as_bytes())?;
    let setup = fen.as_setup().clone();
    let castling_mode = CastlingMode::detect(&setup);

    let mut chess: Chess = setup.position(castling_mode)?;
    let mut fens: Vec<(Fen, Vec<String>, bool)> = vec![(fen, vec![], false)];

    options
        .moves
        .iter()
        .enumerate()
        .try_for_each(|(i, m)| -> Result<(), Error> {
            let uci = UciMove::from_ascii(m.as_bytes())?;
            let m = uci.to_move(&chess)?;
            let previous_pos = chess.clone();
            chess.play_unchecked(&m);
            let current_pos = chess.clone();
            if !chess.is_game_over() {
                let prev_eval = naive_eval(&previous_pos);
                let cur_eval = -naive_eval(&current_pos);
                fens.push((
                    Fen::from_position(current_pos, EnPassantMode::Legal),
                    options.moves.clone().into_iter().take(i + 1).collect(),
                    prev_eval > cur_eval + 100,
                ));
            }
            Ok(())
        })?;

    if options.reversed {
        fens.reverse();
    }

    let mut novelty_found = false;

    for (i, (_, moves, _)) in fens.iter().enumerate() {
        if cancel_flag.load(Ordering::SeqCst) {
            proc.kill().await?;
            state.analysis_cancel_flags.remove(&id);
            return Err(Error::AnalysisCancelled);
        }

        update_progress(
            &state.progress_state,
            &app,
            id.clone(),
            (i as f32 / fens.len() as f32) * 100.0,
            false,
        )?;

        let mut extra_options = uci_options.clone();
        if !extra_options.iter().any(|x| x.name == "MultiPV") {
            extra_options.push(EngineOption {
                name: "MultiPV".to_string(),
                value: "2".to_string(),
            });
        } else {
            extra_options.iter_mut().for_each(|x| {
                if x.name == "MultiPV" {
                    x.value = "2".to_string();
                }
            });
        }

        proc.set_options(EngineOptions {
            fen: options.fen.clone(),
            moves: moves.clone(),
            extra_options,
        })
        .await?;

        proc.go(&go_mode).await?;

        let mut current_analysis = MoveAnalysis::default();
        while let Ok(Some(line)) = reader.next_line().await {
            match parse_one(&line) {
                UciMessage::Info(attrs) => {
                    if let Ok(best_moves) =
                        parse_uci_attrs(attrs, &proc.options.fen.parse()?, moves)
                    {
                        let multipv = best_moves.multipv;
                        let cur_depth = best_moves.depth;
                        if multipv as usize == proc.best_moves.len() + 1 {
                            proc.best_moves.push(best_moves);
                            if multipv == proc.real_multipv {
                                if proc.best_moves.iter().all(|x| x.depth == cur_depth)
                                    && cur_depth >= proc.last_depth
                                {
                                    current_analysis.best = proc.best_moves.clone();
                                    proc.last_depth = cur_depth;
                                }
                                assert_eq!(proc.best_moves.len(), proc.real_multipv as usize);
                                proc.best_moves.clear();
                            }
                        }
                    }
                }
                UciMessage::BestMove { .. } => {
                    break;
                }
                _ => {}
            }
        }
        analysis.push(current_analysis);
    }

    if options.reversed {
        analysis.reverse();
        fens.reverse();
    }

    for (i, analysis) in analysis.iter_mut().enumerate() {
        let fen = &fens[i].0;
        // let query = PositionQuery::exact_from_fen(&fen.to_string())?;
        let query = PositionQueryJs {
            fen: fen.to_string(),
            type_: "exact".to_string(),
        };

        analysis.is_sacrifice = fens[i].2;
        if options.annotate_novelties && !novelty_found {
            if let Some(reference) = options.reference_db.clone() {
                analysis.novelty = !is_position_in_db(
                    reference,
                    GameQuery::new().position(query.clone()).clone(),
                    state.clone(),
                )
                .await?;
                if analysis.novelty {
                    novelty_found = true;
                }
            } else {
                return Err(Error::MissingReferenceDatabase);
            }
        }
    }
    update_progress(&state.progress_state, &app, id.clone(), 100.0, true)?;
    state.analysis_cancel_flags.remove(&id);
    Ok(analysis)
}

#[derive(Clone, Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MistakeReviewThresholds {
    pub inaccuracy: i32,
    pub mistake: i32,
    pub blunder: i32,
}

impl Default for MistakeReviewThresholds {
    fn default() -> Self {
        Self {
            inaccuracy: 50,
            mistake: 100,
            blunder: 200,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MistakeReviewSeverityFilter {
    pub inaccuracy: bool,
    pub mistake: bool,
    pub blunder: bool,
}

impl Default for MistakeReviewSeverityFilter {
    fn default() -> Self {
        Self {
            inaccuracy: true,
            mistake: true,
            blunder: true,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MistakeReviewAnalysisMode {
    Single,
    Layered,
}

impl Default for MistakeReviewAnalysisMode {
    fn default() -> Self {
        Self::Single
    }
}

#[derive(Clone, Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MistakeReviewScanRequest {
    pub request_id: Option<String>,
    pub player_db: PathBuf,
    pub player_id: i32,
    pub player_name: Option<String>,
    pub engine_path: String,
    pub engine_name: Option<String>,
    pub analysis_mode: Option<MistakeReviewAnalysisMode>,
    pub fast_depth: Option<u32>,
    pub deep_depth: Option<u32>,
    pub multi_pv: Option<u16>,
    pub thresholds: Option<MistakeReviewThresholds>,
    pub include_severities: Option<MistakeReviewSeverityFilter>,
    pub min_win_probability_drop: Option<f64>,
    pub time_management: Option<MistakeReviewTimeManagementSettings>,
    pub time_controls: Option<Vec<String>>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub since_game_id: Option<i32>,
    pub max_games: Option<i32>,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MistakeReviewTimeManagementSettings {
    pub enabled: bool,
    pub min_move_seconds: f64,
}

impl Default for MistakeReviewTimeManagementSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            min_move_seconds: 20.0,
        }
    }
}

#[derive(Clone, Debug, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MistakeReviewSeverity {
    Inaccuracy,
    Mistake,
    Blunder,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MistakeReviewScanResult {
    pub review_key: String,
    pub fen: String,
    pub normalized_fen: String,
    pub side_to_move: String,
    pub player_color: String,
    pub played_move_san: String,
    pub played_move_uci: String,
    pub best_move_san: String,
    pub best_move_uci: String,
    pub pv_san: Vec<String>,
    pub pv_uci: Vec<String>,
    pub refutation_san: Vec<String>,
    pub refutation_uci: Vec<String>,
    pub severity: MistakeReviewSeverity,
    pub cp_loss: i32,
    pub win_probability_drop: f64,
    pub cp_before: i32,
    pub cp_after: i32,
    pub requested_depth: u32,
    pub reached_depth: u32,
    pub analysis_mode: MistakeReviewAnalysisMode,
    pub fast_depth: u32,
    pub multi_pv: u16,
    pub engine_name: String,
    pub game_id: i32,
    pub last_game_id: i32,
    pub ply: u32,
    pub move_number: u32,
    pub date: Option<String>,
    pub time: Option<String>,
    pub opening_name: Option<String>,
    pub opponent: String,
    pub time_control: Option<String>,
    pub white_name: String,
    pub black_name: String,
    pub white_elo: Option<i32>,
    pub black_elo: Option<i32>,
    pub game_result: Option<String>,
    pub move_time_seconds: Option<f64>,
    pub clock_before_seconds: Option<f64>,
    pub clock_after_seconds: Option<f64>,
    pub long_think_threshold_seconds: Option<f64>,
    pub occurrence_count: u32,
    pub game_ids: Vec<i32>,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MistakeReviewScanReport {
    pub games_scanned: u32,
    pub candidate_moves: u32,
    pub positions_analyzed: u32,
    pub last_analyzed_game_id: Option<i32>,
    pub stopped: bool,
    pub mistakes: Vec<MistakeReviewScanResult>,
}

#[derive(Clone, Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MistakeReviewClockTimingRequest {
    pub review_key: String,
    pub fen: String,
    pub played_move_uci: String,
    pub game_ids: Vec<i32>,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MistakeReviewClockTiming {
    pub review_key: String,
    pub game_id: i32,
    pub ply: u32,
    pub move_time_seconds: Option<f64>,
    pub clock_before_seconds: Option<f64>,
    pub clock_after_seconds: Option<f64>,
    pub date: Option<String>,
    pub time: Option<String>,
    pub time_control: Option<String>,
}

#[derive(Clone, Debug, Serialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct MistakeReviewScanProgress {
    pub id: String,
    pub progress: f32,
    pub games_analyzed: u32,
    pub games_total: u32,
    pub positions_analyzed: u32,
    pub candidate_moves: u32,
    pub mistakes_found: u32,
    pub phase: String,
    pub paused: bool,
    pub finished: bool,
}

#[derive(Clone, Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MistakeReviewMoveScoreRequest {
    pub fen: String,
    pub played_move_uci: String,
    pub engine_path: String,
    pub engine_name: Option<String>,
    pub depth: Option<u32>,
    pub multi_pv: Option<u16>,
    pub thresholds: Option<MistakeReviewThresholds>,
}

#[derive(Clone, Debug, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MistakeReviewAttemptLabel {
    Best,
    Good,
    Okay,
    Inaccuracy,
    Mistake,
    Blunder,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MistakeReviewMoveScore {
    pub label: MistakeReviewAttemptLabel,
    pub passed: bool,
    pub best_move_san: String,
    pub best_move_uci: String,
    pub played_move_san: String,
    pub played_move_uci: String,
    pub cp_loss: i32,
    pub win_probability_drop: f64,
    pub cp_before: i32,
    pub cp_after: i32,
    pub requested_depth: u32,
    pub reached_depth: u32,
    pub engine_name: String,
}

#[derive(Clone, Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MistakeReviewSampleLineRequest {
    pub fen: String,
    pub first_move_uci: String,
    pub engine_path: String,
    pub engine_name: Option<String>,
    pub depth: Option<u32>,
    pub max_plies: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MistakeReviewSampleLine {
    pub moves: Vec<String>,
    pub requested_depth: u32,
    pub reached_depth: u32,
    pub engine_name: String,
}

#[tauri::command]
#[specta::specta]
pub async fn scan_mistake_review(
    request: MistakeReviewScanRequest,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<MistakeReviewScanReport, Error> {
    let request_id = request.request_id.clone().unwrap_or_else(|| {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default();
        format!("mistake-review-{millis}")
    });
    let cancel_flag = Arc::new(AtomicBool::new(false));
    let pause_flag = Arc::new(AtomicBool::new(false));
    state
        .analysis_cancel_flags
        .insert(request_id.clone(), cancel_flag.clone());
    state
        .analysis_pause_flags
        .insert(request_id.clone(), pause_flag.clone());

    let loaded_games = load_mistake_review_games(
        request.player_db.clone(),
        request.player_id,
        request.start_date.clone(),
        request.end_date.clone(),
        request.since_game_id,
        request.max_games,
        &state,
    )?;

    let thresholds = request.thresholds.unwrap_or_default();
    let include_severities = request.include_severities.unwrap_or_default();
    let _selected_player_name = request.player_name.as_deref();
    let analysis_mode = request.analysis_mode.clone().unwrap_or_default();
    let fast_depth = request.fast_depth.unwrap_or(12).max(1);
    let requested_deep_depth = request.deep_depth.unwrap_or(17).max(1);
    let deep_depth = if analysis_mode == MistakeReviewAnalysisMode::Layered {
        requested_deep_depth.max(fast_depth)
    } else {
        requested_deep_depth
    };
    let multi_pv = request.multi_pv.unwrap_or(3).max(1);
    let min_win_probability_drop = request.min_win_probability_drop.unwrap_or(5.0);
    let time_management = request.time_management.unwrap_or_default();
    let long_think_threshold = time_management.min_move_seconds.max(0.0);
    let time_controls = request
        .time_controls
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.to_lowercase())
        .collect::<Vec<_>>();
    let engine_path = PathBuf::from(&request.engine_path);
    let engine_name = request.engine_name.clone().unwrap_or_else(|| {
        engine_path
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("Stockfish")
            .to_string()
    });

    let last_loaded_game_id = loaded_games.last().map(|game| game.id);
    let games = loaded_games
        .into_iter()
        .filter(|game| {
            mistake_review_game_matches_time_filters(
                &game.time_control,
                &time_controls,
                time_management.enabled,
            )
        })
        .collect::<Vec<_>>();
    let games_total = games.len() as u32;
    let mut mistakes_by_key: HashMap<String, MistakeReviewScanResult> = HashMap::new();
    let mut candidate_moves = 0u32;
    let mut positions_analyzed = 0u32;
    let mut games_analyzed = 0u32;
    let mut last_analyzed_game_id = last_loaded_game_id;
    let mut stopped = false;
    let mut move_eval_entries: Vec<MistakeReviewMoveEvalEntry> = Vec::new();
    emit_mistake_review_progress(
        &app,
        &request_id,
        0,
        games_total,
        positions_analyzed,
        candidate_moves,
        mistakes_by_key.len() as u32,
        "Preparing",
        false,
        false,
    )?;

    if games_total == 0 {
        update_progress(&state.progress_state, &app, request_id.clone(), 100.0, true)?;
        emit_mistake_review_progress(
            &app,
            &request_id,
            games_analyzed,
            games_total,
            positions_analyzed,
            candidate_moves,
            mistakes_by_key.len() as u32,
            "Done",
            false,
            true,
        )?;
        state.analysis_cancel_flags.remove(&request_id);
        state.analysis_pause_flags.remove(&request_id);

        return Ok(MistakeReviewScanReport {
            games_scanned: games_analyzed,
            candidate_moves,
            positions_analyzed,
            last_analyzed_game_id,
            stopped,
            mistakes: Vec::new(),
        });
    }

    let (mut proc, mut reader) = EngineProcess::new(engine_path).await?;

    'games: for (game_index, game) in games.iter().enumerate() {
        if let Err(error) = wait_for_mistake_review_resume(
            &app,
            &request_id,
            &cancel_flag,
            &pause_flag,
            games_analyzed,
            games_total,
            positions_analyzed,
            candidate_moves,
            mistakes_by_key.len() as u32,
        )
        .await
        {
            if matches!(error, Error::AnalysisCancelled) {
                stopped = true;
                break;
            }
            proc.kill().await?;
            state.analysis_cancel_flags.remove(&request_id);
            state.analysis_pause_flags.remove(&request_id);
            return Err(error);
        }

        if cancel_flag.load(Ordering::SeqCst) {
            stopped = true;
            break;
        }

        let player_color = if game.white_id == request.player_id {
            Color::White
        } else if game.black_id == request.player_id {
            Color::Black
        } else {
            continue;
        };
        let opponent = if player_color == Color::White {
            game.black_name.clone()
        } else {
            game.white_name.clone()
        };

        let mut chess = mistake_review_starting_position(game.fen.as_deref())?;
        let mut clock_tracker = MistakeReviewClockTracker::new(game.time_control.as_deref());
        let move_entries = collect_mainline_move_entries(&game.moves);
        let mut ply = 0u32;

        for entry in move_entries {
            let Some(mv) = decode_move(entry.byte, &chess) else {
                break;
            };

            let side_to_move = chess.turn();
            let move_timing = clock_tracker.record_move(side_to_move, &entry.comments);
            let fen_before = Fen::from_position(chess.clone(), EnPassantMode::Legal).to_string();
            let played_move_uci = UciMove::from_move(&mv, CastlingMode::Standard).to_string();
            let played_move_san = SanPlus::from_move(chess.clone(), &mv).to_string();
            let mut after = chess.clone();
            after.play_unchecked(&mv);
            let fen_after = Fen::from_position(after.clone(), EnPassantMode::Legal).to_string();

            if side_to_move == player_color && !after.is_game_over() {
                if time_management.enabled
                    && move_timing
                        .move_time_seconds
                        .map(|seconds| seconds < long_think_threshold)
                        .unwrap_or(true)
                {
                    chess = after;
                    ply += 1;
                    continue;
                }

                if let Err(error) = wait_for_mistake_review_resume(
                    &app,
                    &request_id,
                    &cancel_flag,
                    &pause_flag,
                    games_analyzed,
                    games_total,
                    positions_analyzed,
                    candidate_moves,
                    mistakes_by_key.len() as u32,
                )
                .await
                {
                    if matches!(error, Error::AnalysisCancelled) {
                        stopped = true;
                        break 'games;
                    }
                    proc.kill().await?;
                    state.analysis_cancel_flags.remove(&request_id);
                    state.analysis_pause_flags.remove(&request_id);
                    return Err(error);
                }

                if cancel_flag.load(Ordering::SeqCst) {
                    stopped = true;
                    break 'games;
                }

                let should_run_deep = match &analysis_mode {
                    MistakeReviewAnalysisMode::Single => true,
                    MistakeReviewAnalysisMode::Layered => {
                        let fast_before = analyze_mistake_review_position(
                            &mut proc,
                            &mut reader,
                            &fen_before,
                            fast_depth,
                            multi_pv,
                        )
                        .await?;
                        let Some(fast_best) = fast_before.first() else {
                            chess = after;
                            ply += 1;
                            continue;
                        };
                        let fast_best_uci =
                            fast_best.uci_moves.first().cloned().unwrap_or_default();

                        if fast_best_uci == played_move_uci {
                            move_eval_entries.push(mistake_review_move_eval_entry(
                                game,
                                request.player_id,
                                side_to_move,
                                player_color,
                                ply,
                                &fen_before,
                                &fen_after,
                                &played_move_uci,
                                &played_move_san,
                                fast_best,
                                None,
                                fast_depth,
                                &analysis_mode,
                                "fast",
                                fast_depth,
                                multi_pv,
                                &engine_name,
                                &move_timing,
                                Some(0),
                                Some(0.0),
                            ));
                            flush_mistake_review_move_eval_entries_if_needed(
                                &request.player_db,
                                &state,
                                &mut move_eval_entries,
                            )?;
                            false
                        } else {
                            let fast_after = analyze_mistake_review_position(
                                &mut proc,
                                &mut reader,
                                &fen_after,
                                fast_depth,
                                1,
                            )
                            .await?;
                            let Some(fast_after_best) = fast_after.first() else {
                                chess = after;
                                ply += 1;
                                continue;
                            };
                            let fast_loss = cp_loss_for_player(
                                score_to_white_cp(&fast_best.score),
                                score_to_white_cp(&fast_after_best.score),
                                player_color,
                            );
                            let fast_win_probability_drop = win_probability_drop_for_player(
                                score_to_white_cp(&fast_best.score),
                                score_to_white_cp(&fast_after_best.score),
                                player_color,
                            );
                            move_eval_entries.push(mistake_review_move_eval_entry(
                                game,
                                request.player_id,
                                side_to_move,
                                player_color,
                                ply,
                                &fen_before,
                                &fen_after,
                                &played_move_uci,
                                &played_move_san,
                                fast_best,
                                Some(fast_after_best),
                                fast_depth,
                                &analysis_mode,
                                "fast",
                                fast_depth,
                                multi_pv,
                                &engine_name,
                                &move_timing,
                                Some(fast_loss),
                                Some(fast_win_probability_drop),
                            ));
                            flush_mistake_review_move_eval_entries_if_needed(
                                &request.player_db,
                                &state,
                                &mut move_eval_entries,
                            )?;
                            fast_loss >= thresholds.inaccuracy
                        }
                    }
                };

                if should_run_deep {
                    candidate_moves += 1;
                    emit_mistake_review_progress(
                        &app,
                        &request_id,
                        games_analyzed,
                        games_total,
                        positions_analyzed,
                        candidate_moves,
                        mistakes_by_key.len() as u32,
                        "Analyzing positions",
                        false,
                        false,
                    )?;

                    let deep_before = analyze_mistake_review_position(
                        &mut proc,
                        &mut reader,
                        &fen_before,
                        deep_depth,
                        multi_pv,
                    )
                    .await?;
                    let deep_after = analyze_mistake_review_position(
                        &mut proc,
                        &mut reader,
                        &fen_after,
                        deep_depth,
                        1,
                    )
                    .await?;
                    positions_analyzed += 1;
                    emit_mistake_review_progress(
                        &app,
                        &request_id,
                        games_analyzed,
                        games_total,
                        positions_analyzed,
                        candidate_moves,
                        mistakes_by_key.len() as u32,
                        "Analyzing positions",
                        false,
                        false,
                    )?;

                    let Some(deep_best) = deep_before.first() else {
                        chess = after;
                        ply += 1;
                        continue;
                    };
                    let Some(deep_after_best) = deep_after.first() else {
                        chess = after;
                        ply += 1;
                        continue;
                    };

                    let best_move_uci = deep_best.uci_moves.first().cloned().unwrap_or_default();
                    let cp_before = score_to_white_cp(&deep_best.score);
                    let cp_after = score_to_white_cp(&deep_after_best.score);
                    let cp_loss = cp_loss_for_player(cp_before, cp_after, player_color);
                    let win_probability_drop =
                        win_probability_drop_for_player(cp_before, cp_after, player_color);
                    let reached_depth = deep_best.depth.min(deep_after_best.depth);
                    move_eval_entries.push(mistake_review_move_eval_entry(
                        game,
                        request.player_id,
                        side_to_move,
                        player_color,
                        ply,
                        &fen_before,
                        &fen_after,
                        &played_move_uci,
                        &played_move_san,
                        deep_best,
                        Some(deep_after_best),
                        deep_depth,
                        &analysis_mode,
                        "deep",
                        if analysis_mode == MistakeReviewAnalysisMode::Layered {
                            fast_depth
                        } else {
                            0
                        },
                        multi_pv,
                        &engine_name,
                        &move_timing,
                        Some(cp_loss),
                        Some(win_probability_drop),
                    ));
                    flush_mistake_review_move_eval_entries_if_needed(
                        &request.player_db,
                        &state,
                        &mut move_eval_entries,
                    )?;

                    if best_move_uci == played_move_uci {
                        chess = after;
                        ply += 1;
                        continue;
                    }

                    let Some(severity) = mistake_review_severity(cp_loss, &thresholds) else {
                        chess = after;
                        ply += 1;
                        continue;
                    };
                    if !mistake_review_includes_severity(&severity, &include_severities)
                        || win_probability_drop < min_win_probability_drop
                    {
                        chess = after;
                        ply += 1;
                        continue;
                    }

                    let normalized_fen = normalize_mistake_review_fen(&fen_before);
                    let review_key = format!("{normalized_fen}|{played_move_uci}");
                    let result = MistakeReviewScanResult {
                        review_key,
                        fen: fen_before.clone(),
                        normalized_fen,
                        side_to_move: color_name(side_to_move).to_string(),
                        player_color: color_name(player_color).to_string(),
                        played_move_san,
                        played_move_uci,
                        best_move_san: deep_best
                            .san_moves
                            .first()
                            .cloned()
                            .unwrap_or_else(|| best_move_uci.clone()),
                        best_move_uci,
                        pv_san: deep_best.san_moves.clone(),
                        pv_uci: deep_best.uci_moves.clone(),
                        refutation_san: deep_after_best.san_moves.clone(),
                        refutation_uci: deep_after_best.uci_moves.clone(),
                        severity,
                        cp_loss,
                        win_probability_drop,
                        cp_before,
                        cp_after,
                        requested_depth: deep_depth,
                        reached_depth,
                        analysis_mode: analysis_mode.clone(),
                        fast_depth: if analysis_mode == MistakeReviewAnalysisMode::Layered {
                            fast_depth
                        } else {
                            0
                        },
                        multi_pv,
                        engine_name: engine_name.clone(),
                        game_id: game.id,
                        last_game_id: game.id,
                        ply,
                        move_number: (ply / 2) + 1,
                        date: game.date.clone(),
                        time: game.time.clone(),
                        opening_name: game.opening_name.clone(),
                        opponent: opponent.clone(),
                        time_control: game.time_control.clone(),
                        white_name: game.white_name.clone(),
                        black_name: game.black_name.clone(),
                        white_elo: game.white_elo,
                        black_elo: game.black_elo,
                        game_result: game.result.clone(),
                        move_time_seconds: move_timing.move_time_seconds,
                        clock_before_seconds: move_timing.clock_before_seconds,
                        clock_after_seconds: move_timing.clock_after_seconds,
                        long_think_threshold_seconds: if time_management.enabled {
                            Some(long_think_threshold)
                        } else {
                            None
                        },
                        occurrence_count: 1,
                        game_ids: vec![game.id],
                    };
                    insert_mistake_review_result(&mut mistakes_by_key, result);
                    emit_mistake_review_progress(
                        &app,
                        &request_id,
                        games_analyzed,
                        games_total,
                        positions_analyzed,
                        candidate_moves,
                        mistakes_by_key.len() as u32,
                        "Analyzing positions",
                        false,
                        false,
                    )?;
                }
            }

            chess = after;
            ply += 1;
        }

        last_analyzed_game_id = Some(game.id);
        games_analyzed = (game_index + 1) as u32;
        update_progress(
            &state.progress_state,
            &app,
            request_id.clone(),
            if games.is_empty() {
                100.0
            } else {
                ((game_index + 1) as f32 / games.len() as f32) * 100.0
            },
            false,
        )?;
        emit_mistake_review_progress(
            &app,
            &request_id,
            games_analyzed,
            games_total,
            positions_analyzed,
            candidate_moves,
            mistakes_by_key.len() as u32,
            "Analyzing games",
            false,
            false,
        )?;
    }

    let eval_flush_result =
        flush_mistake_review_move_eval_entries(&request.player_db, &state, &mut move_eval_entries);
    proc.kill().await?;
    eval_flush_result?;
    let final_progress = if games_total == 0 {
        100.0
    } else {
        (games_analyzed as f32 / games_total as f32) * 100.0
    };
    update_progress(
        &state.progress_state,
        &app,
        request_id.clone(),
        if stopped { final_progress } else { 100.0 },
        true,
    )?;
    emit_mistake_review_progress(
        &app,
        &request_id,
        games_analyzed,
        games_total,
        positions_analyzed,
        candidate_moves,
        mistakes_by_key.len() as u32,
        if stopped { "Stopped" } else { "Done" },
        false,
        true,
    )?;
    state.analysis_cancel_flags.remove(&request_id);
    state.analysis_pause_flags.remove(&request_id);

    let mut mistakes: Vec<_> = mistakes_by_key.into_values().collect();
    mistakes.sort_by(|a, b| {
        b.cp_loss
            .cmp(&a.cp_loss)
            .then_with(|| b.occurrence_count.cmp(&a.occurrence_count))
            .then_with(|| b.last_game_id.cmp(&a.last_game_id))
    });

    Ok(MistakeReviewScanReport {
        games_scanned: games_analyzed,
        candidate_moves,
        positions_analyzed,
        last_analyzed_game_id,
        stopped,
        mistakes,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn get_mistake_review_clock_timings(
    file: PathBuf,
    requests: Vec<MistakeReviewClockTimingRequest>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<MistakeReviewClockTiming>, Error> {
    if requests.is_empty() {
        return Ok(Vec::new());
    }

    let mut game_ids = requests
        .iter()
        .flat_map(|request| request.game_ids.iter().copied())
        .collect::<Vec<_>>();
    game_ids.sort_unstable();
    game_ids.dedup();

    let games = load_mistake_review_games_by_ids(file, &game_ids, &state)?;
    let games_by_id = games
        .into_iter()
        .map(|game| (game.id, game))
        .collect::<HashMap<_, _>>();
    let mut timings = Vec::new();

    for request in requests {
        let mut request_game_ids = request.game_ids.clone();
        request_game_ids.sort_unstable();
        request_game_ids.dedup();

        for game_id in request_game_ids {
            let Some(game) = games_by_id.get(&game_id) else {
                continue;
            };
            let Some(timing) = find_mistake_review_clock_timing(game, &request)? else {
                continue;
            };
            timings.push(timing);
            break;
        }
    }

    Ok(timings)
}

fn emit_mistake_review_progress(
    app: &tauri::AppHandle,
    id: &str,
    games_analyzed: u32,
    games_total: u32,
    positions_analyzed: u32,
    candidate_moves: u32,
    mistakes_found: u32,
    phase: &str,
    paused: bool,
    finished: bool,
) -> Result<(), Error> {
    MistakeReviewScanProgress {
        id: id.to_string(),
        progress: if games_total == 0 {
            if finished {
                100.0
            } else {
                0.0
            }
        } else {
            (games_analyzed as f32 / games_total as f32) * 100.0
        },
        games_analyzed,
        games_total,
        positions_analyzed,
        candidate_moves,
        mistakes_found,
        phase: phase.to_string(),
        paused,
        finished,
    }
    .emit(app)?;
    Ok(())
}

async fn wait_for_mistake_review_resume(
    app: &tauri::AppHandle,
    id: &str,
    cancel_flag: &Arc<AtomicBool>,
    pause_flag: &Arc<AtomicBool>,
    games_analyzed: u32,
    games_total: u32,
    positions_analyzed: u32,
    candidate_moves: u32,
    mistakes_found: u32,
) -> Result<(), Error> {
    let mut emitted_pause = false;
    while pause_flag.load(Ordering::SeqCst) {
        if cancel_flag.load(Ordering::SeqCst) {
            return Err(Error::AnalysisCancelled);
        }
        if !emitted_pause {
            emit_mistake_review_progress(
                app,
                id,
                games_analyzed,
                games_total,
                positions_analyzed,
                candidate_moves,
                mistakes_found,
                "Paused",
                true,
                false,
            )?;
            emitted_pause = true;
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }

    if emitted_pause {
        emit_mistake_review_progress(
            app,
            id,
            games_analyzed,
            games_total,
            positions_analyzed,
            candidate_moves,
            mistakes_found,
            "Analyzing games",
            false,
            false,
        )?;
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn score_mistake_review_move(
    request: MistakeReviewMoveScoreRequest,
) -> Result<MistakeReviewMoveScore, Error> {
    let thresholds = request.thresholds.unwrap_or_default();
    let depth = request.depth.unwrap_or(17).max(1);
    let multi_pv = request.multi_pv.unwrap_or(3).max(1);
    let engine_path = PathBuf::from(&request.engine_path);
    let engine_name = request.engine_name.clone().unwrap_or_else(|| {
        engine_path
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("Stockfish")
            .to_string()
    });

    let mut position = mistake_review_starting_position(Some(&request.fen))?;
    let player_color = position.turn();
    let played_uci = UciMove::from_ascii(request.played_move_uci.as_bytes())?;
    let played_move = played_uci.to_move(&position)?;
    let played_move_san = SanPlus::from_move(position.clone(), &played_move).to_string();
    position.play_unchecked(&played_move);
    let fen_after = Fen::from_position(position, EnPassantMode::Legal).to_string();

    let (mut proc, mut reader) = EngineProcess::new(engine_path).await?;
    let before =
        analyze_mistake_review_position(&mut proc, &mut reader, &request.fen, depth, multi_pv)
            .await?;
    let after =
        analyze_mistake_review_position(&mut proc, &mut reader, &fen_after, depth, 1).await?;
    proc.kill().await?;

    let best = before.first().ok_or(Error::NoMovesFound)?;
    let after_best = after.first().ok_or(Error::NoMovesFound)?;
    let best_move_uci = best.uci_moves.first().cloned().unwrap_or_default();
    let best_move_san = best
        .san_moves
        .first()
        .cloned()
        .unwrap_or_else(|| best_move_uci.clone());
    let cp_before = score_to_white_cp(&best.score);
    let cp_after = score_to_white_cp(&after_best.score);
    let cp_loss = cp_loss_for_player(cp_before, cp_after, player_color);
    let win_probability_drop = win_probability_drop_for_player(cp_before, cp_after, player_color);
    let exact_best = best_move_uci == request.played_move_uci;
    let label = mistake_review_attempt_label(cp_loss, exact_best, &thresholds);

    Ok(MistakeReviewMoveScore {
        passed: mistake_review_attempt_passed(&label),
        label,
        best_move_san,
        best_move_uci,
        played_move_san,
        played_move_uci: request.played_move_uci,
        cp_loss,
        win_probability_drop,
        cp_before,
        cp_after,
        requested_depth: depth,
        reached_depth: best.depth.min(after_best.depth),
        engine_name,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn get_mistake_review_sample_line(
    request: MistakeReviewSampleLineRequest,
) -> Result<MistakeReviewSampleLine, Error> {
    let max_plies = request.max_plies.unwrap_or(6).min(20) as usize;
    let depth = request.depth.unwrap_or(12).max(1);
    let engine_path = PathBuf::from(&request.engine_path);
    let engine_name = request.engine_name.clone().unwrap_or_else(|| {
        engine_path
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("Stockfish")
            .to_string()
    });

    if max_plies == 0 {
        return Ok(MistakeReviewSampleLine {
            moves: Vec::new(),
            requested_depth: depth,
            reached_depth: 0,
            engine_name,
        });
    }

    let first_move_uci = request.first_move_uci.trim().to_string();
    let mut position = mistake_review_starting_position(Some(&request.fen))?;
    let first_uci = UciMove::from_ascii(first_move_uci.as_bytes())?;
    let first_move = first_uci.to_move(&position)?;
    position.play_unchecked(&first_move);
    let fen_after_first = Fen::from_position(position, EnPassantMode::Legal).to_string();

    let (mut proc, mut reader) = EngineProcess::new(engine_path).await?;
    let continuation =
        analyze_mistake_review_position(&mut proc, &mut reader, &fen_after_first, depth, 1).await?;
    proc.kill().await?;

    let continuation_best = continuation.first();
    let mut moves = vec![first_move_uci];
    if let Some(best) = continuation_best {
        moves.extend(best.uci_moves.clone());
    }
    moves.truncate(max_plies);

    Ok(MistakeReviewSampleLine {
        moves,
        requested_depth: depth,
        reached_depth: continuation_best.map(|best| best.depth).unwrap_or(0),
        engine_name,
    })
}

async fn analyze_mistake_review_position(
    proc: &mut EngineProcess,
    reader: &mut EngineReader,
    fen: &str,
    depth: u32,
    multi_pv: u16,
) -> Result<Vec<BestMoves>, Error> {
    proc.set_options(EngineOptions {
        fen: fen.to_string(),
        moves: Vec::new(),
        extra_options: vec![EngineOption {
            name: "MultiPV".to_string(),
            value: multi_pv.to_string(),
        }],
    })
    .await?;
    proc.go(&GoMode::Depth(depth)).await?;

    let fen = fen.parse()?;
    while let Some(line) = reader.next_line().await? {
        match parse_one(&line) {
            UciMessage::Info(attrs) => match parse_uci_attrs(attrs, &fen, &[]) {
                Ok(best_moves) => {
                    if best_moves.score.lower_bound == Some(true)
                        || best_moves.score.upper_bound == Some(true)
                    {
                        proc.base.log_engine(&line);
                        continue;
                    }

                    let multipv = best_moves.multipv;
                    let cur_depth = best_moves.depth;
                    if multipv as usize == proc.best_moves.len() + 1 {
                        proc.best_moves.push(best_moves);
                        if multipv == proc.real_multipv {
                            if proc.best_moves.iter().all(|x| x.depth == cur_depth)
                                && cur_depth >= proc.last_depth
                            {
                                proc.last_depth = cur_depth;
                                proc.last_best_moves = proc.best_moves.clone();
                            }
                            proc.best_moves.clear();
                        }
                    }
                }
                Err(Error::NoMovesFound) => {}
                Err(e) => warn!(
                    "Failed to parse mistake-review info line: {}, error: {:?}",
                    line, e
                ),
            },
            UciMessage::BestMove { .. } => {
                proc.running = false;
                proc.base.log_engine(&line);
                break;
            }
            _ => {}
        }
        proc.base.log_engine(&line);
    }

    Ok(proc.last_best_moves.clone())
}

fn mistake_review_starting_position(fen: Option<&str>) -> Result<Chess, Error> {
    let fen = match fen {
        Some(fen) if !fen.trim().is_empty() => Fen::from_ascii(fen.as_bytes())?,
        _ => Fen::default(),
    };
    let setup = fen.into_setup();
    let castling_mode = CastlingMode::detect(&setup);
    Ok(Chess::from_setup(setup, castling_mode).or_else(PositionError::ignore_too_much_material)?)
}

fn score_to_white_cp(score: &Score) -> i32 {
    match score.value {
        ScoreValue::Cp(cp) => cp,
        ScoreValue::Mate(mate) if mate > 0 => 10_000 - (mate as i32).abs().min(1_000),
        ScoreValue::Mate(mate) => -10_000 + (mate as i32).abs().min(1_000),
    }
}

fn cp_loss_for_player(before_white_cp: i32, after_white_cp: i32, player_color: Color) -> i32 {
    let loss = if player_color == Color::White {
        before_white_cp - after_white_cp
    } else {
        after_white_cp - before_white_cp
    };
    loss.max(0)
}

fn win_probability_drop_for_player(
    before_white_cp: i32,
    after_white_cp: i32,
    player_color: Color,
) -> f64 {
    let before_white = centipawn_to_win_probability(before_white_cp);
    let after_white = centipawn_to_win_probability(after_white_cp);
    let before_player = if player_color == Color::White {
        before_white
    } else {
        100.0 - before_white
    };
    let after_player = if player_color == Color::White {
        after_white
    } else {
        100.0 - after_white
    };
    (before_player - after_player).max(0.0)
}

fn centipawn_to_win_probability(cp: i32) -> f64 {
    50.0 + 50.0 * (2.0 / (1.0 + (-0.003_682_08 * cp as f64).exp()) - 1.0)
}

fn mistake_review_move_eval_entry(
    game: &MistakeReviewGameRow,
    player_id: i32,
    side_to_move: Color,
    player_color: Color,
    ply: u32,
    fen: &str,
    fen_after: &str,
    played_uci: &str,
    played_san: &str,
    best: &BestMoves,
    after_best: Option<&BestMoves>,
    requested_depth: u32,
    analysis_mode: &MistakeReviewAnalysisMode,
    analysis_stage: &str,
    fast_depth: u32,
    multi_pv: u16,
    engine_name: &str,
    move_timing: &MistakeReviewMoveTiming,
    cp_loss: Option<i32>,
    win_probability_drop: Option<f64>,
) -> MistakeReviewMoveEvalEntry {
    let cp_before = score_to_white_cp(&best.score);
    let cp_after = after_best.map(|line| score_to_white_cp(&line.score));
    let reached_depth = after_best
        .map(|line| best.depth.min(line.depth))
        .unwrap_or(best.depth);

    MistakeReviewMoveEvalEntry {
        game_id: game.id,
        ply: ply as i32,
        move_number: ((ply / 2) + 1) as i32,
        player_id,
        player_color: color_name(player_color).to_string(),
        side_to_move: color_name(side_to_move).to_string(),
        fen: fen.to_string(),
        normalized_fen: normalize_mistake_review_fen(fen),
        fen_after: fen_after.to_string(),
        played_uci: played_uci.to_string(),
        played_san: played_san.to_string(),
        best_uci: best.uci_moves.first().cloned(),
        best_san: best.san_moves.first().cloned(),
        pv_uci: best.uci_moves.join(" "),
        pv_san: best.san_moves.join(" "),
        cp_before,
        cp_after,
        cp_loss,
        win_probability_drop,
        requested_depth: requested_depth as i32,
        reached_depth: reached_depth as i32,
        analysis_mode: mistake_review_analysis_mode_name(analysis_mode).to_string(),
        analysis_stage: analysis_stage.to_string(),
        fast_depth: fast_depth as i32,
        multi_pv: multi_pv as i32,
        engine_name: engine_name.to_string(),
        move_time_seconds: move_timing.move_time_seconds,
        clock_before_seconds: move_timing.clock_before_seconds,
        clock_after_seconds: move_timing.clock_after_seconds,
    }
}

fn mistake_review_analysis_mode_name(analysis_mode: &MistakeReviewAnalysisMode) -> &'static str {
    match analysis_mode {
        MistakeReviewAnalysisMode::Single => "single",
        MistakeReviewAnalysisMode::Layered => "layered",
    }
}

fn flush_mistake_review_move_eval_entries_if_needed(
    file: &PathBuf,
    state: &tauri::State<'_, AppState>,
    entries: &mut Vec<MistakeReviewMoveEvalEntry>,
) -> Result<(), Error> {
    if entries.len() >= MISTAKE_REVIEW_EVAL_CACHE_BATCH_SIZE {
        flush_mistake_review_move_eval_entries(file, state, entries)?;
    }

    Ok(())
}

fn flush_mistake_review_move_eval_entries(
    file: &PathBuf,
    state: &tauri::State<'_, AppState>,
    entries: &mut Vec<MistakeReviewMoveEvalEntry>,
) -> Result<(), Error> {
    if entries.is_empty() {
        return Ok(());
    }

    upsert_mistake_review_move_evals(file, entries, state)?;
    entries.clear();
    Ok(())
}

#[derive(Debug, Clone)]
struct MainlineMoveEntry {
    byte: u8,
    comments: String,
}

fn collect_mainline_move_entries(bytes: &[u8]) -> Vec<MainlineMoveEntry> {
    let mut entries: Vec<MainlineMoveEntry> = Vec::new();
    let mut cursor = 0usize;
    let mut variation_depth = 0usize;
    let mut last_mainline_move: Option<usize> = None;

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
            COMMENT_MARKER | NAG_MARKER => {
                if cursor + 2 > bytes.len() {
                    break;
                }
                let len = u16::from_le_bytes([bytes[cursor], bytes[cursor + 1]]) as usize;
                cursor += 2;
                if cursor + len > bytes.len() {
                    break;
                }

                if byte == COMMENT_MARKER && variation_depth == 0 {
                    if let Some(index) = last_mainline_move {
                        let comment = String::from_utf8_lossy(&bytes[cursor..cursor + len]);
                        if !entries[index].comments.is_empty() {
                            entries[index].comments.push(' ');
                        }
                        entries[index].comments.push_str(&comment);
                    }
                }
                cursor += len;
            }
            move_byte if variation_depth == 0 => {
                entries.push(MainlineMoveEntry {
                    byte: move_byte,
                    comments: String::new(),
                });
                last_mainline_move = entries.len().checked_sub(1);
            }
            _ => {}
        }
    }

    entries
}

fn find_mistake_review_clock_timing(
    game: &MistakeReviewGameRow,
    request: &MistakeReviewClockTimingRequest,
) -> Result<Option<MistakeReviewClockTiming>, Error> {
    let target_fen = normalize_mistake_review_fen(&request.fen);
    let target_uci = request.played_move_uci.trim();
    if target_fen.is_empty() || target_uci.is_empty() {
        return Ok(None);
    }

    let mut chess = mistake_review_starting_position(game.fen.as_deref())?;
    let mut clock_tracker = MistakeReviewClockTracker::new(game.time_control.as_deref());

    for (ply, entry) in collect_mainline_move_entries(&game.moves)
        .into_iter()
        .enumerate()
    {
        let Some(mv) = decode_move(entry.byte, &chess) else {
            break;
        };

        let side_to_move = chess.turn();
        let move_timing = clock_tracker.record_move(side_to_move, &entry.comments);
        let fen_before = Fen::from_position(chess.clone(), EnPassantMode::Legal).to_string();
        let played_move_uci = UciMove::from_move(&mv, CastlingMode::Standard).to_string();

        if normalize_mistake_review_fen(&fen_before) == target_fen && played_move_uci == target_uci
        {
            if move_timing.move_time_seconds.is_none()
                && move_timing.clock_before_seconds.is_none()
                && move_timing.clock_after_seconds.is_none()
            {
                return Ok(None);
            }

            return Ok(Some(MistakeReviewClockTiming {
                review_key: request.review_key.clone(),
                game_id: game.id,
                ply: ply as u32,
                move_time_seconds: move_timing.move_time_seconds,
                clock_before_seconds: move_timing.clock_before_seconds,
                clock_after_seconds: move_timing.clock_after_seconds,
                date: game.date.clone(),
                time: game.time.clone(),
                time_control: game.time_control.clone(),
            }));
        }

        chess.play_unchecked(&mv);
    }

    Ok(None)
}

#[derive(Default, Debug, Clone, Copy)]
struct MistakeReviewMoveTiming {
    move_time_seconds: Option<f64>,
    clock_before_seconds: Option<f64>,
    clock_after_seconds: Option<f64>,
}

#[derive(Debug, Clone)]
struct MistakeReviewClockTracker {
    initial_seconds: Option<f64>,
    increment_seconds: f64,
    white_clock_seconds: Option<f64>,
    black_clock_seconds: Option<f64>,
}

impl MistakeReviewClockTracker {
    fn new(time_control: Option<&str>) -> Self {
        let parsed = parse_mistake_review_time_control(time_control);
        Self {
            initial_seconds: parsed.map(|(initial, _)| initial),
            increment_seconds: parsed.map(|(_, increment)| increment).unwrap_or(0.0),
            white_clock_seconds: None,
            black_clock_seconds: None,
        }
    }

    fn record_move(&mut self, color: Color, comment: &str) -> MistakeReviewMoveTiming {
        let clock_after = parse_pgn_clock_seconds(comment);
        let elapsed = parse_pgn_elapsed_move_seconds(comment);
        let previous_clock = match color {
            Color::White => self.white_clock_seconds.or(self.initial_seconds),
            Color::Black => self.black_clock_seconds.or(self.initial_seconds),
        };

        let move_time = elapsed.or_else(|| {
            let before = previous_clock?;
            let after = clock_after?;
            let spent = before + self.increment_seconds - after;
            Some(spent.max(0.0))
        });

        let clock_before = if let (Some(after), Some(spent)) = (clock_after, move_time) {
            Some((after + spent - self.increment_seconds).max(0.0))
        } else {
            previous_clock
        };

        if let Some(after) = clock_after {
            match color {
                Color::White => self.white_clock_seconds = Some(after),
                Color::Black => self.black_clock_seconds = Some(after),
            }
        }

        MistakeReviewMoveTiming {
            move_time_seconds: move_time,
            clock_before_seconds: clock_before,
            clock_after_seconds: clock_after,
        }
    }
}

fn parse_mistake_review_time_control(time_control: Option<&str>) -> Option<(f64, f64)> {
    let trimmed = time_control?.trim();
    if trimmed.is_empty() || trimmed == "-" || trimmed.contains('/') {
        return None;
    }

    let (initial, increment) = match trimmed.split_once('+') {
        Some((initial, increment)) => (initial, increment),
        None => (trimmed, "0"),
    };
    let initial = initial.parse::<f64>().ok()?;
    let increment = increment
        .split_whitespace()
        .next()
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0);

    if initial <= 0.0 {
        None
    } else {
        Some((initial, increment.max(0.0)))
    }
}

fn parse_pgn_clock_seconds(comment: &str) -> Option<f64> {
    parse_pgn_time_markup(comment, "[%clk").and_then(parse_pgn_time_value)
}

fn parse_pgn_elapsed_move_seconds(comment: &str) -> Option<f64> {
    parse_pgn_time_markup(comment, "[%emt").and_then(parse_pgn_time_value)
}

fn parse_pgn_time_markup<'a>(comment: &'a str, marker: &str) -> Option<&'a str> {
    let start = comment.find(marker)?;
    let value_start = start + marker.len();
    let value = comment[value_start..].trim_start();
    let value_end = value
        .find(|ch: char| ch == ']' || ch.is_whitespace())
        .unwrap_or(value.len());
    let value = value[..value_end].trim();

    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn parse_pgn_time_value(value: &str) -> Option<f64> {
    let parts = value.split(':').collect::<Vec<_>>();
    match parts.as_slice() {
        [seconds] => seconds.parse::<f64>().ok(),
        [minutes, seconds] => {
            let minutes = minutes.parse::<f64>().ok()?;
            let seconds = seconds.parse::<f64>().ok()?;
            Some(minutes * 60.0 + seconds)
        }
        [hours, minutes, seconds] => {
            let hours = hours.parse::<f64>().ok()?;
            let minutes = minutes.parse::<f64>().ok()?;
            let seconds = seconds.parse::<f64>().ok()?;
            Some(hours * 3600.0 + minutes * 60.0 + seconds)
        }
        _ => None,
    }
}

fn mistake_review_time_control_bucket(time_control: &Option<String>) -> String {
    let Some(time_control) = time_control.as_deref() else {
        return "unknown".to_string();
    };
    let trimmed = time_control.trim();
    if trimmed.is_empty() || trimmed == "?" {
        return "unknown".to_string();
    }
    if trimmed == "-"
        || trimmed.eq_ignore_ascii_case("correspondence")
        || trimmed.eq_ignore_ascii_case("daily")
        || trimmed.contains('/')
    {
        return "correspondence".to_string();
    }

    let initial_seconds = trimmed
        .split(['+', '-'])
        .next()
        .and_then(|value| value.parse::<i32>().ok())
        .unwrap_or_default();

    if initial_seconds <= 0 {
        "unknown".to_string()
    } else if initial_seconds < 180 {
        "bullet".to_string()
    } else if initial_seconds < 600 {
        "blitz".to_string()
    } else if initial_seconds < 1800 {
        "rapid".to_string()
    } else {
        "classical".to_string()
    }
}

fn schedule_idle_engine_shutdown(app: &AppHandle, key: (String, String), generation: u64) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(ENGINE_IDLE_SHUTDOWN_AFTER).await;

        let state = app.state::<AppState>();
        let Some(process_entry) = state.engine_processes.get(&key) else {
            return;
        };
        let process = process_entry.value().clone();
        drop(process_entry);

        let mut process = process.lock().await;
        if process.running || process.idle_generation != generation {
            return;
        }

        if let Err(error) = process.kill().await {
            warn!(
                "Failed to shut down idle engine process for tab: {}, engine: {}: {:?}",
                key.0, key.1, error
            );
            return;
        }
        state.engine_processes.remove(&key);
    });
}

fn mistake_review_game_matches_time_filters(
    time_control: &Option<String>,
    time_controls: &[String],
    exclude_correspondence: bool,
) -> bool {
    let bucket = mistake_review_time_control_bucket(time_control);
    if exclude_correspondence && bucket == "correspondence" {
        return false;
    }

    time_controls.is_empty() || time_controls.contains(&bucket)
}

fn mistake_review_severity(
    cp_loss: i32,
    thresholds: &MistakeReviewThresholds,
) -> Option<MistakeReviewSeverity> {
    if cp_loss >= thresholds.blunder {
        Some(MistakeReviewSeverity::Blunder)
    } else if cp_loss >= thresholds.mistake {
        Some(MistakeReviewSeverity::Mistake)
    } else if cp_loss >= thresholds.inaccuracy {
        Some(MistakeReviewSeverity::Inaccuracy)
    } else {
        None
    }
}

fn mistake_review_includes_severity(
    severity: &MistakeReviewSeverity,
    include: &MistakeReviewSeverityFilter,
) -> bool {
    match severity {
        MistakeReviewSeverity::Inaccuracy => include.inaccuracy,
        MistakeReviewSeverity::Mistake => include.mistake,
        MistakeReviewSeverity::Blunder => include.blunder,
    }
}

fn mistake_review_attempt_label(
    cp_loss: i32,
    exact_best: bool,
    thresholds: &MistakeReviewThresholds,
) -> MistakeReviewAttemptLabel {
    if exact_best || cp_loss <= 20 {
        MistakeReviewAttemptLabel::Best
    } else if cp_loss < 35 {
        MistakeReviewAttemptLabel::Good
    } else if cp_loss < thresholds.inaccuracy {
        MistakeReviewAttemptLabel::Okay
    } else if cp_loss >= thresholds.blunder {
        MistakeReviewAttemptLabel::Blunder
    } else if cp_loss >= thresholds.mistake {
        MistakeReviewAttemptLabel::Mistake
    } else {
        MistakeReviewAttemptLabel::Inaccuracy
    }
}

fn mistake_review_attempt_passed(label: &MistakeReviewAttemptLabel) -> bool {
    matches!(
        label,
        MistakeReviewAttemptLabel::Best | MistakeReviewAttemptLabel::Good
    )
}

fn normalize_mistake_review_fen(fen: &str) -> String {
    fen.split_whitespace().take(4).collect::<Vec<_>>().join(" ")
}

fn color_name(color: Color) -> &'static str {
    match color {
        Color::White => "white",
        Color::Black => "black",
    }
}

fn insert_mistake_review_result(
    mistakes: &mut HashMap<String, MistakeReviewScanResult>,
    result: MistakeReviewScanResult,
) {
    let Some(existing) = mistakes.get_mut(&result.review_key) else {
        mistakes.insert(result.review_key.clone(), result);
        return;
    };

    let mut game_ids = existing.game_ids.clone();
    if !game_ids.contains(&result.game_id) {
        game_ids.push(result.game_id);
    }
    let occurrence_count = existing.occurrence_count.saturating_add(1);
    let latest = if result.game_id >= existing.last_game_id {
        (
            result.last_game_id,
            result.date.clone(),
            result.time.clone(),
            result.opening_name.clone(),
            result.opponent.clone(),
            result.time_control.clone(),
            result.white_name.clone(),
            result.black_name.clone(),
            result.white_elo,
            result.black_elo,
            result.game_result.clone(),
        )
    } else {
        (
            existing.last_game_id,
            existing.date.clone(),
            existing.time.clone(),
            existing.opening_name.clone(),
            existing.opponent.clone(),
            existing.time_control.clone(),
            existing.white_name.clone(),
            existing.black_name.clone(),
            existing.white_elo,
            existing.black_elo,
            existing.game_result.clone(),
        )
    };

    if result.cp_loss > existing.cp_loss
        || (result.cp_loss == existing.cp_loss && result.game_id > existing.game_id)
    {
        *existing = result;
    }

    existing.occurrence_count = occurrence_count;
    existing.game_ids = game_ids;
    existing.last_game_id = latest.0;
    existing.date = latest.1;
    existing.time = latest.2;
    existing.opening_name = latest.3;
    existing.opponent = latest.4;
    existing.time_control = latest.5;
    existing.white_name = latest.6;
    existing.black_name = latest.7;
    existing.white_elo = latest.8;
    existing.black_elo = latest.9;
    existing.game_result = latest.10;
}

#[cfg(test)]
mod mistake_review_tests {
    use super::*;
    use crate::db::encoding::encode_comment;

    fn scan_result(review_key: &str, cp_loss: i32, game_id: i32) -> MistakeReviewScanResult {
        MistakeReviewScanResult {
            review_key: review_key.to_string(),
            fen: "8/8/8/8/8/8/8/8 w - - 0 1".to_string(),
            normalized_fen: "8/8/8/8/8/8/8/8 w - -".to_string(),
            side_to_move: "white".to_string(),
            player_color: "white".to_string(),
            played_move_san: "a4".to_string(),
            played_move_uci: "a2a4".to_string(),
            best_move_san: "Nf3".to_string(),
            best_move_uci: "g1f3".to_string(),
            pv_san: vec!["Nf3".to_string()],
            pv_uci: vec!["g1f3".to_string()],
            refutation_san: vec!["Nf6".to_string()],
            refutation_uci: vec!["g8f6".to_string()],
            severity: MistakeReviewSeverity::Mistake,
            cp_loss,
            win_probability_drop: 8.0,
            cp_before: 50,
            cp_after: -70,
            requested_depth: 17,
            reached_depth: 17,
            analysis_mode: MistakeReviewAnalysisMode::Single,
            fast_depth: 12,
            multi_pv: 3,
            engine_name: "Stockfish".to_string(),
            game_id,
            last_game_id: game_id,
            ply: 10,
            move_number: 6,
            date: Some(format!("2026.04.{game_id:02}")),
            time: Some("12:00:00".to_string()),
            opening_name: Some("Test Opening".to_string()),
            opponent: format!("Opponent {game_id}"),
            time_control: Some("600+0".to_string()),
            white_name: "Tyrell Lox".to_string(),
            black_name: format!("Opponent {game_id}"),
            white_elo: Some(1900 + game_id),
            black_elo: Some(1800 + game_id),
            game_result: Some("0-1".to_string()),
            move_time_seconds: Some(42.0),
            clock_before_seconds: Some(420.0),
            clock_after_seconds: Some(378.0),
            long_think_threshold_seconds: Some(20.0),
            occurrence_count: 1,
            game_ids: vec![game_id],
        }
    }

    #[test]
    fn cp_loss_is_oriented_to_the_selected_side() {
        assert_eq!(cp_loss_for_player(80, -20, Color::White), 100);
        assert_eq!(cp_loss_for_player(-80, 20, Color::Black), 100);
        assert_eq!(cp_loss_for_player(-20, 80, Color::White), 0);
    }

    #[test]
    fn severity_uses_configured_thresholds() {
        let thresholds = MistakeReviewThresholds {
            inaccuracy: 50,
            mistake: 100,
            blunder: 200,
        };

        assert_eq!(mistake_review_severity(49, &thresholds), None);
        assert_eq!(
            mistake_review_severity(50, &thresholds),
            Some(MistakeReviewSeverity::Inaccuracy)
        );
        assert_eq!(
            mistake_review_severity(120, &thresholds),
            Some(MistakeReviewSeverity::Mistake)
        );
        assert_eq!(
            mistake_review_severity(220, &thresholds),
            Some(MistakeReviewSeverity::Blunder)
        );
    }

    #[test]
    fn attempt_labels_keep_srs_binary() {
        let thresholds = MistakeReviewThresholds {
            inaccuracy: 50,
            mistake: 100,
            blunder: 200,
        };

        assert_eq!(
            mistake_review_attempt_label(0, true, &thresholds),
            MistakeReviewAttemptLabel::Best
        );
        assert_eq!(
            mistake_review_attempt_label(30, false, &thresholds),
            MistakeReviewAttemptLabel::Good
        );
        assert_eq!(
            mistake_review_attempt_label(45, false, &thresholds),
            MistakeReviewAttemptLabel::Okay
        );
        assert!(mistake_review_attempt_passed(
            &MistakeReviewAttemptLabel::Best
        ));
        assert!(mistake_review_attempt_passed(
            &MistakeReviewAttemptLabel::Good
        ));
        assert!(!mistake_review_attempt_passed(
            &MistakeReviewAttemptLabel::Okay
        ));
    }

    #[test]
    fn time_control_filters_bucket_common_game_speeds() {
        assert_eq!(
            mistake_review_time_control_bucket(&Some("60+0".to_string())),
            "bullet"
        );
        assert_eq!(
            mistake_review_time_control_bucket(&Some("300+3".to_string())),
            "blitz"
        );
        assert_eq!(
            mistake_review_time_control_bucket(&Some("900+10".to_string())),
            "rapid"
        );
        assert_eq!(
            mistake_review_time_control_bucket(&Some("3600+0".to_string())),
            "classical"
        );
        assert_eq!(
            mistake_review_time_control_bucket(&Some("1/3".to_string())),
            "correspondence"
        );
        assert_eq!(
            mistake_review_time_control_bucket(&Some("1/259200".to_string())),
            "correspondence"
        );
        assert_eq!(
            mistake_review_time_control_bucket(&Some("daily".to_string())),
            "correspondence"
        );
        assert_eq!(
            mistake_review_time_control_bucket(&Some("-".to_string())),
            "correspondence"
        );
    }

    #[test]
    fn time_management_filters_out_correspondence_games() {
        let daily = Some("1/259200".to_string());
        let blitz = Some("300+3".to_string());
        let correspondence = vec!["correspondence".to_string()];

        assert!(!mistake_review_game_matches_time_filters(&daily, &[], true));
        assert!(!mistake_review_game_matches_time_filters(
            &daily,
            &correspondence,
            true
        ));
        assert!(mistake_review_game_matches_time_filters(
            &daily,
            &correspondence,
            false
        ));
        assert!(mistake_review_game_matches_time_filters(&blitz, &[], true));
    }

    #[test]
    fn clock_parser_reads_clk_and_emt_comments() {
        assert_eq!(parse_pgn_clock_seconds("[%clk 0:09:58.5]").unwrap(), 598.5);
        assert_eq!(
            parse_pgn_clock_seconds("x [%clk 1:01:27] y").unwrap(),
            3687.0
        );
        assert_eq!(
            parse_pgn_elapsed_move_seconds("[%emt 12.25]").unwrap(),
            12.25
        );
    }

    #[test]
    fn clock_tracker_calculates_spent_time_with_increment() {
        let mut tracker = MistakeReviewClockTracker::new(Some("300+3"));

        let first = tracker.record_move(Color::White, "[%clk 0:04:52]");
        assert_eq!(first.clock_before_seconds, Some(300.0));
        assert_eq!(first.clock_after_seconds, Some(292.0));
        assert_eq!(first.move_time_seconds, Some(11.0));

        let second = tracker.record_move(Color::White, "[%clk 0:04:10]");
        assert_eq!(second.clock_before_seconds, Some(292.0));
        assert_eq!(second.clock_after_seconds, Some(250.0));
        assert_eq!(second.move_time_seconds, Some(45.0));
    }

    #[test]
    fn mainline_entry_collector_attaches_comments_after_moves() {
        let mut bytes = vec![0];
        encode_comment("[%clk 0:09:58]", &mut bytes);
        bytes.push(VARIATION_START_MARKER);
        bytes.push(1);
        encode_comment("ignored", &mut bytes);
        bytes.push(VARIATION_END_MARKER);
        bytes.push(2);
        encode_comment("[%emt 3.5]", &mut bytes);

        let entries = collect_mainline_move_entries(&bytes);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].byte, 0);
        assert_eq!(entries[0].comments, "[%clk 0:09:58]");
        assert_eq!(entries[1].byte, 2);
        assert_eq!(entries[1].comments, "[%emt 3.5]");
    }

    #[test]
    fn duplicate_positions_merge_evidence_without_losing_worst_analysis() {
        let mut mistakes = HashMap::new();

        insert_mistake_review_result(&mut mistakes, scan_result("fen|a2a4", 120, 1));
        insert_mistake_review_result(&mut mistakes, scan_result("fen|a2a4", 180, 2));

        let merged = mistakes.get("fen|a2a4").unwrap();
        assert_eq!(merged.cp_loss, 180);
        assert_eq!(merged.occurrence_count, 2);
        assert_eq!(merged.game_ids, vec![1, 2]);
        assert_eq!(merged.last_game_id, 2);
        assert_eq!(merged.opponent, "Opponent 2");
    }

    #[test]
    fn fen_key_matches_the_website_style_position_plus_played_move_key() {
        assert_eq!(
            normalize_mistake_review_fen(
                "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
            ),
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
        );
    }
}

fn count_material(position: &Chess) -> i32 {
    if position.is_checkmate() {
        return -10000;
    }
    let material: ByColor<i32> = position.board().material().map(|p| {
        p.pawn as i32 * piece_value(Role::Pawn)
            + p.knight as i32 * piece_value(Role::Knight)
            + p.bishop as i32 * piece_value(Role::Bishop)
            + p.rook as i32 * piece_value(Role::Rook)
            + p.queen as i32 * piece_value(Role::Queen)
    });
    if position.turn() == Color::White {
        material.white - material.black
    } else {
        material.black - material.white
    }
}

fn piece_value(role: Role) -> i32 {
    match role {
        Role::Pawn => 90,
        Role::Knight => 300,
        Role::Bishop => 300,
        Role::Rook => 500,
        Role::Queen => 1000,
        _ => 0,
    }
}

fn qsearch(position: &Chess, mut alpha: i32, beta: i32) -> i32 {
    let stand_pat = count_material(position);

    if stand_pat >= beta {
        return beta;
    }
    if alpha < stand_pat {
        alpha = stand_pat;
    }
    let legal_moves = position.legal_moves();
    let mut captures: Vec<_> = legal_moves.iter().filter(|m| m.is_capture()).collect();

    captures.sort_by(|a, b| {
        let a_value = piece_value(a.capture().unwrap());
        let b_value = piece_value(b.capture().unwrap());
        b_value.cmp(&a_value)
    });

    for capture in captures {
        let mut new_position = position.clone();
        new_position.play_unchecked(capture);
        let score = -qsearch(&new_position, -beta, -alpha);
        if score >= beta {
            return beta;
        }
        if score > alpha {
            alpha = score;
        }
    }

    alpha
}

fn naive_eval(pos: &Chess) -> i32 {
    pos.legal_moves()
        .iter()
        .map(|mv| {
            let mut new_position = pos.clone();
            new_position.play_unchecked(mv);
            -qsearch(&new_position, i32::MIN, i32::MAX)
        })
        .max()
        .unwrap_or(i32::MIN)
}

#[cfg(test)]
mod tests {
    use shakmaty::FromSetup;

    use super::*;

    fn pos(fen: &str) -> Chess {
        let fen: Fen = fen.parse().unwrap();
        Chess::from_setup(fen.into_setup(), CastlingMode::Chess960).unwrap()
    }

    #[test]
    fn eval_start_pos() {
        assert_eq!(naive_eval(&Chess::default()), 0);
    }

    #[test]
    fn eval_scandi() {
        let position = pos("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2");
        assert_eq!(naive_eval(&position), 0);
    }

    #[test]
    fn eval_hanging_pawn() {
        let position = pos("r1bqkbnr/ppp1pppp/2n5/1B1p4/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3");
        assert_eq!(naive_eval(&position), 100);
    }

    #[test]
    fn eval_complex_center() {
        let position = pos("r1bqkbnr/ppp2ppp/2n5/1B1pp3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4");
        assert_eq!(naive_eval(&position), 100);
    }

    #[test]
    fn eval_in_check() {
        let position = pos("r1bqkbnr/ppp2ppp/2B5/3pp3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 4");
        assert_eq!(naive_eval(&position), -100);
    }

    #[test]
    fn eval_rook_stack() {
        let position = pos("rnrq4/8/8/1R6/1R6/1R5K/1Q6/7k w - - 0 1");
        assert_eq!(naive_eval(&position), 500);
    }

    #[test]
    fn eval_rook_stack2() {
        let position = pos("rnrq4/8/8/1R6/1Q6/1R5K/1R6/7k w - - 0 1");
        assert_eq!(naive_eval(&position), 200);
    }

    #[test]
    fn eval_opera_game1() {
        let position = pos("4kb1r/p2rqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2K4R w k - 0 14");
        assert_eq!(naive_eval(&position), -100);
    }

    #[test]
    fn eval_opera_game2() {
        let position = pos("4kb1r/p2rqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR4 b k - 1 14");
        assert_eq!(naive_eval(&position), 0);
    }
}

#[derive(Type, Default, Serialize, Debug)]
pub struct EngineConfig {
    pub name: String,
    pub options: Vec<UciOptionConfig>,
}

#[tauri::command]
#[specta::specta]
pub async fn get_engine_config(path: PathBuf) -> Result<EngineConfig, Error> {
    let mut base = BaseEngine::spawn(path).await?;

    base.send("uci").await?;

    let mut config = EngineConfig::default();

    let reader = base.reader_mut().ok_or(Error::EngineDisconnected)?;
    while let Some(line) = reader.next_line().await? {
        if let UciMessage::Id {
            name: Some(name),
            author: _,
        } = parse_one(&line)
        {
            config.name = name;
        }
        if let UciMessage::Option(opt) = parse_one(&line) {
            config.options.push(opt);
        }
        if let UciMessage::UciOk = parse_one(&line) {
            break;
        }
    }
    println!("{:?}", config);
    base.quit().await?;
    Ok(config)
}
