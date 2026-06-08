use std::{
    collections::{HashMap, HashSet},
    env,
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};

use log::{info, warn};
use serde::{Deserialize, Serialize};
use serde_json::json;
use shakmaty::{
    fen::Fen,
    san::{San, SanPlus},
    uci::UciMove,
    Bitboard, CastlingMode, Chess, Color, EnPassantMode, Move, Piece, Position, Role, Square,
};
use specta::Type;
use tauri::Emitter;
use tempfile::tempdir;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
    time::{sleep, timeout},
};
use vampirc_uci::{
    parse_one,
    uci::{Score, ScoreValue},
    UciInfoAttribute, UciMessage,
};

use crate::{
    engine::{parse_fen_and_apply_moves, parse_fen_to_position, BaseEngine, GoMode},
    error::Error,
};

const DEFAULT_STOCKFISH_DEPTH: u32 = 17;
const DEFAULT_COACH_MODEL: &str = "gemini-3.1-pro-preview";
const DEFAULT_PLANNER_MODEL: &str = "gemini-3.5-flash";
const MAX_PLANNER_STOCKFISH_REQUESTS: usize = 6;
const MAX_CHESS_FACT_TOOL_CALLS: usize = 10;
const MAX_WHOLE_GAME_CRITICAL_REQUESTS: usize = 3;
const PLANNER_TIMEOUT_SECS: u64 = 25;
const MAX_PROMPT_PGN_CHARS: usize = 12_000;
const MAX_CHAT_MESSAGE_CHARS: usize = 2_000;
const MAX_REFERENCE_CONTEXT_ITEMS: usize = 120;
const MAX_GEMINI_ERROR_CHARS: usize = 1_200;
const OPENING_PHASE_MAX_PLY: u32 = 30;
const CONVERSION_PHASE_WINDOW_PLIES: u32 = 40;
const AI_COACH_PROGRESS_EVENT: &str = "ai-coach-progress";
const COACH_STYLE_GUIDE: &str = r#"Coaching voice:
- Treat the engine and board facts as a compass, not as the lesson. Start from the human chess idea, then use the concrete line to prove it.
- Explain cause and effect in the style of a serious annotated classical game: "this allows counterplay on d5/f5", "the defender is deflected", "the pawn break opens the file", "the knight outpost is more important than the pawn", "this kills counterplay", "this wins a tempo".
- Prefer instructive chains over verdict lists: move -> what it changes -> opponent resource -> why the line confirms it -> what to train next.
- Look for practical decision quality as well as objective evaluation: when to simplify, when to accept a messy engine line, when a safer move gives away too much, when a blunder-check or reset after a mistake matters.
- Use concrete chess language naturally: weak square, outpost, pawn break, counterplay, tempo, overloaded defender, deflection, pin, discovered attack, blockade, exchange-up conversion, king activity, back-rank problem, piece activity.
- Do not pad with generic maxims. Every lesson should point to a square, piece, pawn break, defender, line, or practical choice from this position or game."#;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CoachQuestionPhase {
    Opening,
    Middlegame,
    EndgameConversion,
}

impl CoachQuestionPhase {
    fn label(self) -> &'static str {
        match self {
            CoachQuestionPhase::Opening => "opening phase",
            CoachQuestionPhase::Middlegame => "middlegame phase",
            CoachQuestionPhase::EndgameConversion => "conversion/endgame phase",
        }
    }

    fn progress_label(self) -> &'static str {
        match self {
            CoachQuestionPhase::Opening => "opening-phase",
            CoachQuestionPhase::Middlegame => "middlegame-phase",
            CoachQuestionPhase::EndgameConversion => "conversion-phase",
        }
    }
}

fn existing_lines_are_lichess_cloud(request: &AiCoachRequest) -> bool {
    !request.existing_lines.is_empty()
        && matches!(
            request.existing_lines_source.trim(),
            "lichessCloud" | "lichess_cloud" | "lichess"
        )
}

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiCoachRequest {
    #[serde(default)]
    pub request_id: String,
    pub fen: String,
    pub side_to_move: String,
    pub move_history: Vec<String>,
    pub pgn: Option<String>,
    #[serde(default)]
    pub pgn_scope: String,
    #[serde(default)]
    pub current_line_pgn: Option<String>,
    #[serde(default)]
    pub whole_game_pgn: Option<String>,
    #[serde(default)]
    pub game_analysis: Vec<CoachGameAnalysisPoint>,
    pub selected_move: Option<String>,
    pub question: String,
    #[serde(default)]
    pub chat_history: Vec<CoachChatMessage>,
    #[serde(default)]
    pub reference_context: Vec<CoachReferenceContext>,
    pub existing_lines: Vec<CoachEngineLine>,
    #[serde(default)]
    pub existing_lines_source: String,
    #[serde(default)]
    pub prior_targeted_results: Vec<CoachTargetedResult>,
    pub opening_context: Option<CoachOpeningContext>,
    pub opening_context_error: Option<String>,
    pub engine_path: PathBuf,
    pub settings: AiCoachSettings,
}

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiCoachSettings {
    pub enabled: bool,
    pub gemini_command: String,
    pub gemini_model: String,
    #[serde(default)]
    pub planner_model: String,
    pub multipv: u8,
    pub timeout_secs: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct CoachEngineLine {
    pub multipv: u16,
    pub depth: u32,
    pub eval: String,
    pub uci_moves: Vec<String>,
    pub san_moves: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct CoachChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct CoachGameAnalysisPoint {
    pub ply: u32,
    #[serde(rename = "move")]
    pub mv: String,
    #[serde(default)]
    pub before_fen: Option<String>,
    pub fen: String,
    #[serde(default)]
    pub played_uci: Option<String>,
    #[serde(default)]
    pub played_side: Option<String>,
    pub eval: Option<String>,
    pub depth: Option<u32>,
    pub annotations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct CoachReferenceContext {
    pub label: String,
    pub fen: String,
    pub ply: u32,
    #[serde(default)]
    pub san_line: Vec<String>,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct CoachOpeningContext {
    pub source: String,
    pub fen: String,
    pub side: String,
    pub total_games: f64,
    pub filters: String,
    pub moves: Vec<CoachOpeningMove>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct CoachOpeningMove {
    pub san: String,
    pub uci: String,
    pub games: f64,
    pub white: f64,
    pub draw: f64,
    pub black: f64,
    pub usage_pct: f64,
    pub side_score_pct: f64,
    pub blended_strength: u16,
    pub blended_label: String,
    pub database_strength_pct: Option<f64>,
    pub engine_cp_loss: Option<i32>,
    pub engine_rank: Option<u16>,
    pub engine_score: Option<String>,
    pub notes: Vec<String>,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiCoachResponse {
    pub answer: String,
    pub model: String,
    pub used_existing_analysis: bool,
    pub stockfish_lines: Vec<CoachEngineLine>,
    pub targeted_results: Vec<CoachTargetedResult>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiCoachProgressEvent {
    pub request_id: String,
    pub stage: String,
    pub label: String,
    pub detail: String,
    pub progress: f32,
    pub finished: bool,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CoachTargetedResult {
    pub request_type: String,
    pub reason: String,
    pub fen: String,
    pub moves: Vec<String>,
    pub label: String,
    pub lines: Vec<CoachEngineLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
enum StockfishFollowUpRequest {
    AnalysePosition {
        fen: String,
        #[serde(default)]
        label: String,
        reason: String,
    },
    AnalyseMove {
        fen: String,
        #[serde(rename = "move")]
        mv: String,
        reason: String,
    },
    CompareMoves {
        fen: String,
        moves: Vec<String>,
        reason: String,
    },
    AnalyseLine {
        fen: String,
        line: String,
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "tool", rename_all = "snake_case")]
enum ChessFactToolCall {
    PositionFacts {
        fen: String,
        #[serde(default)]
        label: String,
        #[serde(default)]
        reason: String,
    },
    LegalMoves {
        fen: String,
        #[serde(default)]
        label: String,
        #[serde(default)]
        reason: String,
    },
    SquareFacts {
        fen: String,
        square: String,
        #[serde(default)]
        label: String,
        #[serde(default)]
        reason: String,
    },
    MoveFacts {
        fen: String,
        #[serde(rename = "move")]
        mv: String,
        #[serde(default)]
        label: String,
        #[serde(default)]
        reason: String,
    },
    LineFacts {
        fen: String,
        line: String,
        #[serde(default)]
        label: String,
        #[serde(default)]
        reason: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChessFactToolPlan {
    #[serde(default)]
    calls: Vec<ChessFactToolCall>,
    #[serde(default)]
    reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct CoachChessFactResult {
    tool: String,
    label: String,
    reason: String,
    fen: String,
    summary: String,
    facts: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoachPlannerResponse {
    #[serde(default, rename = "pgn_scope", alias = "pgnScope")]
    pgn_scope: String,
    #[serde(default)]
    requests: Vec<StockfishFollowUpRequest>,
    #[serde(default)]
    reason: String,
}

#[derive(Debug, thiserror::Error)]
pub enum CoachError {
    #[error("AI Coach is disabled in Settings")]
    Disabled,

    #[error("No Stockfish engine path was provided")]
    MissingEngine,

    #[error("AI CLI command not found: {0}")]
    GeminiMissing(String),

    #[error(
        "AI CLI appears unauthenticated. Run `agy --print \"Reply with only: ok\"` or `gemini` in a terminal, complete Google sign-in, then try again."
    )]
    GeminiUnauthenticated,

    #[error("AI CLI timed out after {0} seconds")]
    GeminiTimeout(u64),

    #[error("AI CLI exited with status {status}: {message}")]
    GeminiFailed { status: String, message: String },

    #[error("AI CLI returned an empty response")]
    GeminiEmpty,

    #[error("Gemini planner returned malformed JSON: {0}")]
    GeminiPlannerMalformed(String),

    #[error("Gemini chess fact tool planner returned malformed JSON: {0}")]
    GeminiChessFactMalformed(String),

    #[error("Gemini returned an unsupported engine line: {0}")]
    GeminiUnsupportedLine(String),

    #[error("Stockfish timed out while analysing {0}")]
    StockfishTimeout(String),

    #[error("Stockfish returned no usable analysis for {0}")]
    StockfishEmpty(String),

    #[error("Gemini requested malformed Stockfish JSON: {0}")]
    MalformedStockfishRequest(String),

    #[error("Gemini requested illegal Stockfish analysis: {0}")]
    IllegalStockfishRequest(String),

    #[error("Gemini requested illegal chess fact tool call: {0}")]
    IllegalChessFactToolCall(String),

    #[error(transparent)]
    App(#[from] Error),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl serde::Serialize for CoachError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl Type for CoachError {
    fn inline(
        _type_map: &mut specta::TypeMap,
        _generics: specta::Generics,
    ) -> specta::datatype::DataType {
        specta::datatype::DataType::Primitive(specta::datatype::PrimitiveType::String)
    }
}

#[derive(Clone, Copy)]
struct CoachProgressContext<'a> {
    app: &'a tauri::AppHandle,
    request_id: &'a str,
    started: Instant,
    base_progress: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CoachPgnScope {
    CurrentLine,
    WholeGame,
}

impl CoachPgnScope {
    fn as_str(self) -> &'static str {
        match self {
            Self::CurrentLine => "current_line",
            Self::WholeGame => "whole_game",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::CurrentLine => "current-line context",
            Self::WholeGame => "whole-game context",
        }
    }
}

fn parse_coach_pgn_scope(value: &str) -> Option<CoachPgnScope> {
    match value.trim().to_ascii_lowercase().as_str() {
        "current_line" | "current-line" | "current line" | "position" => {
            Some(CoachPgnScope::CurrentLine)
        }
        "whole_game" | "whole-game" | "whole game" | "game" => Some(CoachPgnScope::WholeGame),
        _ => None,
    }
}

fn apply_planner_pgn_scope(request: &mut AiCoachRequest, scope: CoachPgnScope) {
    request.pgn_scope = scope.as_str().to_string();
    request.pgn = match scope {
        CoachPgnScope::CurrentLine => request
            .current_line_pgn
            .clone()
            .or_else(|| request.pgn.clone()),
        CoachPgnScope::WholeGame => request
            .whole_game_pgn
            .clone()
            .or_else(|| request.pgn.clone()),
    };
}

fn deterministic_planner_fallback_scope(
    request: &AiCoachRequest,
    phase_review: bool,
    conversational_followup: bool,
) -> CoachPgnScope {
    if phase_review || question_explicitly_requests_whole_game(&request.question) {
        CoachPgnScope::WholeGame
    } else if conversational_followup {
        CoachPgnScope::CurrentLine
    } else {
        parse_coach_pgn_scope(&request.pgn_scope).unwrap_or(CoachPgnScope::CurrentLine)
    }
}

fn effective_request_id(request_id: &str) -> String {
    let request_id = request_id.trim();
    if request_id.is_empty() {
        "coach-request".to_string()
    } else {
        request_id.chars().take(80).collect()
    }
}

fn emit_coach_progress(
    app: &tauri::AppHandle,
    request_id: &str,
    started: Instant,
    stage: &str,
    label: impl Into<String>,
    detail: impl Into<String>,
    progress: f32,
    finished: bool,
) {
    let label = label.into();
    let detail = detail.into();
    let progress = progress.clamp(0.0, 100.0);
    let event = AiCoachProgressEvent {
        request_id: request_id.to_string(),
        stage: stage.to_string(),
        label: label.clone(),
        detail: detail.clone(),
        progress,
        finished,
        elapsed_ms: started.elapsed().as_millis() as u64,
    };

    if finished {
        info!(
            "ai_coach[{request_id}] {stage} finished at {progress:.1}% after {}ms: {label} - {detail}",
            event.elapsed_ms
        );
    } else {
        info!(
            "ai_coach[{request_id}] {stage} at {progress:.1}% after {}ms: {label} - {detail}",
            event.elapsed_ms
        );
    }

    if let Err(error) = app.emit(AI_COACH_PROGRESS_EVENT, event) {
        warn!("ai_coach[{request_id}] failed to emit progress event `{stage}`: {error}");
    }
}

#[tauri::command]
#[specta::specta]
pub async fn ask_ai_coach(
    app: tauri::AppHandle,
    request: AiCoachRequest,
) -> Result<AiCoachResponse, CoachError> {
    let request_id = effective_request_id(&request.request_id);
    let started = Instant::now();
    emit_coach_progress(
        &app,
        &request_id,
        started,
        "received",
        "Received coach question",
        "Validating settings and engine path.",
        2.0,
        false,
    );

    let result = ask_ai_coach_inner(&app, &request_id, started, request).await;
    match &result {
        Ok(response) => emit_coach_progress(
            &app,
            &request_id,
            started,
            "finished",
            "Coach answer ready",
            format!(
                "Returned {} characters with {} targeted Stockfish result(s).",
                response.answer.len(),
                response.targeted_results.len()
            ),
            100.0,
            true,
        ),
        Err(error) => emit_coach_progress(
            &app,
            &request_id,
            started,
            "failed",
            "Coach request failed",
            error.to_string(),
            100.0,
            true,
        ),
    }

    result
}

async fn ask_ai_coach_inner(
    app: &tauri::AppHandle,
    request_id: &str,
    started: Instant,
    mut request: AiCoachRequest,
) -> Result<AiCoachResponse, CoachError> {
    if !request.settings.enabled {
        return Err(CoachError::Disabled);
    }
    if request.engine_path.as_os_str().is_empty() {
        return Err(CoachError::MissingEngine);
    }

    let multipv = request.settings.multipv.clamp(3, 8);
    let timeout_secs = request.settings.timeout_secs.clamp(120, 240);
    let model = request.settings.gemini_model.trim().to_string();
    let model = if model.is_empty() {
        DEFAULT_COACH_MODEL.to_string()
    } else {
        model
    };
    let planner_model = request.settings.planner_model.trim().to_string();
    let planner_model = if planner_model.is_empty() {
        DEFAULT_PLANNER_MODEL.to_string()
    } else {
        planner_model
    };
    emit_coach_progress(
        app,
        request_id,
        started,
        "settings",
        "Settings ready",
        format!(
            "Planner {planner_model}; coach {model}; MultiPV {multipv}; Gemini timeout {timeout_secs}s."
        ),
        6.0,
        false,
    );

    let focus_phase = question_focus_phase(&request.question);
    let phase_review = focus_phase.is_some();
    let legal_moves = format_legal_root_moves(&request.fen)?;
    let reference_context = normalized_reference_context(&request);
    let conversational_followup = question_asks_for_conversational_follow_up(&request.question)
        && (!request.prior_targeted_results.is_empty()
            || !reference_context.is_empty()
            || !request.chat_history.is_empty());
    let mut targeted_results = filter_prior_targeted_results_for_question(&request);
    if !targeted_results.is_empty() {
        emit_coach_progress(
            app,
            request_id,
            started,
            "targeted_cached",
            "Reusing targeted Stockfish memory",
            format!(
                "Keeping {} earlier targeted result(s) from this coach session.",
                targeted_results.len()
            ),
            10.0,
            false,
        );
    } else if conversational_followup {
        emit_coach_progress(
            app,
            request_id,
            started,
            "targeted_cached_missing",
            "No targeted memory for follow-up",
            "The latest question refers to a prior line or sequence, but no reusable targeted Stockfish result was available.",
            10.0,
            false,
        );
    } else if !request.prior_targeted_results.is_empty() && phase_review {
        let stale_scope = focus_phase
            .map(CoachQuestionPhase::label)
            .unwrap_or("the requested game phase");
        emit_coach_progress(
            app,
            request_id,
            started,
            "targeted_cached_filtered",
            "Ignored stale targeted Stockfish memory",
            format!(
                "The latest question asks for {stale_scope}, so cached analysis from unrelated phases was omitted."
            ),
            10.0,
            false,
        );
    }

    emit_coach_progress(
        app,
        request_id,
        started,
        "planner_prompt",
        format!("Asking {planner_model} to plan Stockfish work"),
        "Choosing generous root moves and continuations before Pro sees the prompt.",
        12.0,
        false,
    );
    let planner_prompt = build_planner_prompt(
        &request,
        &legal_moves,
        &targeted_results,
        &reference_context,
    );
    let planner_result = match run_gemini_cli(
        &request.settings.gemini_command,
        &planner_model,
        &planner_prompt,
        PLANNER_TIMEOUT_SECS.min(timeout_secs.into()),
    )
    .await
    {
        Ok(answer) => parse_planner_response(&answer).and_then(|response| {
            let scope = parse_coach_pgn_scope(&response.pgn_scope).ok_or_else(|| {
                CoachError::GeminiPlannerMalformed(format!(
                    "missing or invalid pgn_scope `{}`; expected `current_line` or `whole_game`",
                    response.pgn_scope
                ))
            })?;
            Ok((response, scope))
        }),
        Err(error) => Err(error),
    };
    let (mut planned_requests, rejected_planner_requests) = match planner_result {
        Ok((planner_response, mut planner_scope)) => {
            if phase_review {
                planner_scope = CoachPgnScope::WholeGame;
            } else if conversational_followup
                && !question_explicitly_requests_whole_game(&request.question)
            {
                planner_scope = CoachPgnScope::CurrentLine;
            }
            apply_planner_pgn_scope(&mut request, planner_scope);
            emit_coach_progress(
                app,
                request_id,
                started,
                "planner_done",
                "Planner returned Stockfish requests",
                format!(
                    "Selected {}; {} request(s). {}",
                    planner_scope.label(),
                    planner_response.requests.len(),
                    trim_chat_text(&planner_response.reason)
                ),
                18.0,
                false,
            );
            sanitize_planner_requests(&request, &reference_context, planner_response.requests)
        }
        Err(error) => {
            warn!(
                "ai_coach[{request_id}] Stockfish planner unavailable; using deterministic fallback: {error}"
            );
            let planner_scope = deterministic_planner_fallback_scope(
                &request,
                phase_review,
                conversational_followup,
            );
            apply_planner_pgn_scope(&mut request, planner_scope);
            emit_coach_progress(
                app,
                request_id,
                started,
                "planner_fallback",
                "Using deterministic planner fallback",
                format!(
                    "The first AI planner did not finish cleanly ({error}); continuing with deterministic Stockfish and chess-fact checks."
                ),
                18.0,
                false,
            );
            (Vec::new(), Vec::new())
        }
    };
    if conversational_followup {
        let before_filter_count = planned_requests.len();
        planned_requests.retain(|stockfish_request| {
            stockfish_request_uses_current_or_reference_fen(
                &request,
                &reference_context,
                stockfish_request,
            )
        });
        let dropped_count = before_filter_count.saturating_sub(planned_requests.len());
        if dropped_count > 0 {
            emit_coach_progress(
                app,
                request_id,
                started,
                "planner_followup_filtered",
                "Dropped unrelated planner requests",
                format!(
                    "Ignored {dropped_count} planner request(s) that did not use the current FEN or a recent coach-discussion reference FEN."
                ),
                19.0,
                false,
            );
        }
    }
    for rejected in rejected_planner_requests {
        warn!("ai_coach[{request_id}] rejected planner request: {rejected}");
        emit_coach_progress(
            app,
            request_id,
            started,
            "planner_rejected",
            "Rejected planner Stockfish request",
            rejected,
            20.0,
            false,
        );
    }

    let forced_capture_reply_requests = if has_capture_reply_cue(&request.question) {
        infer_question_stockfish_requests(&request.fen, &request.question)?
    } else {
        Vec::new()
    };
    if !forced_capture_reply_requests.is_empty() {
        let reply_count = forced_capture_reply_requests.len();
        planned_requests = merge_prioritized_stockfish_requests(
            &request,
            &reference_context,
            forced_capture_reply_requests,
            planned_requests,
        )?;
        emit_coach_progress(
            app,
            request_id,
            started,
            "question_reply_line",
            "Adding requested reply evidence",
            format!(
                "Queued {reply_count} Stockfish check(s) for the capture/reply named in the question."
            ),
            20.3,
            false,
        );
    }

    let focused_game_requests = infer_question_referenced_game_stockfish_requests(&request);
    let has_focused_game_move = !focused_game_requests.is_empty();
    if !focused_game_requests.is_empty() {
        let focused_count = focused_game_requests.len();
        planned_requests = merge_prioritized_stockfish_requests(
            &request,
            &reference_context,
            focused_game_requests,
            planned_requests,
        )?;
        emit_coach_progress(
            app,
            request_id,
            started,
            "question_focus",
            "Adding named-move evidence",
            format!(
                "Queued {focused_count} Stockfish check(s) for the move named in the question."
            ),
            20.5,
            false,
        );
    }

    if let Some(phase) = focus_phase {
        let phase_requests = infer_phase_stockfish_requests(&request, phase);
        if !phase_requests.is_empty() {
            let phase_count = phase_requests.len();
            planned_requests = merge_prioritized_stockfish_requests(
                &request,
                &reference_context,
                phase_requests,
                planned_requests,
            )?;
            emit_coach_progress(
                app,
                request_id,
                started,
                "phase_focus",
                format!("Adding {} evidence", phase.label()),
                format!(
                    "Queued {phase_count} Stockfish check(s) for {} positions.",
                    phase.label()
                ),
                20.8,
                false,
            );
        } else {
            emit_coach_progress(
                app,
                request_id,
                started,
                "phase_focus_missing",
                format!("No {} anchors found", phase.label()),
                format!(
                    "The app did not receive {} FEN anchors, so only planner-requested evidence is available.",
                    phase.progress_label()
                ),
                20.8,
                false,
            );
        }
    }

    let critical_requests = if has_focused_game_move || phase_review || conversational_followup {
        Vec::new()
    } else {
        infer_whole_game_critical_stockfish_requests(&request)
    };
    if !critical_requests.is_empty() {
        let critical_count = critical_requests.len();
        planned_requests = merge_prioritized_stockfish_requests(
            &request,
            &reference_context,
            critical_requests,
            planned_requests,
        )?;
        emit_coach_progress(
            app,
            request_id,
            started,
            "whole_game_critical",
            "Adding critical game evidence",
            format!(
                "Queued {critical_count} refutation/best-move Stockfish check(s) for critical whole-game mistake positions."
            ),
            21.0,
            false,
        );
    }

    if planned_requests.is_empty() && conversational_followup && !targeted_results.is_empty() {
        emit_coach_progress(
            app,
            request_id,
            started,
            "targeted_followup_reuse",
            "Using prior line evidence",
            "The latest question is a follow-up, so the coach will explain the recent targeted Stockfish sequence instead of starting a fresh whole-game review.",
            22.0,
            false,
        );
    } else if planned_requests.is_empty() {
        planned_requests = infer_question_stockfish_requests(&request.fen, &request.question)?;
        if planned_requests.is_empty() {
            emit_coach_progress(
                app,
                request_id,
                started,
                "targeted_skip",
                "Planner did not need targeted Stockfish",
                "The coach will use root MultiPV, cached targeted results, and opening context.",
                22.0,
                false,
            );
        } else {
            emit_coach_progress(
                app,
                request_id,
                started,
                "planner_fallback",
                "Using deterministic targeted fallback",
                format!(
                    "Planner returned no legal requests; inferred {} request(s) from named moves.",
                    planned_requests.len()
                ),
                22.0,
                false,
            );
        }
    }
    planned_requests.truncate(MAX_PLANNER_STOCKFISH_REQUESTS);

    let whole_game_mode = request.pgn_scope.trim() == "whole_game";
    let use_cloud_existing_lines = existing_lines_are_lichess_cloud(&request);
    let stockfish_lines = if whole_game_mode {
        emit_coach_progress(
            app,
            request_id,
            started,
            "stockfish_root_skip",
            "Skipping current-position root lines",
            "Whole-game review will use PGN, game evals, and critical targeted Stockfish instead of starting-position/opening MultiPV.",
            36.0,
            false,
        );
        Vec::new()
    } else if use_cloud_existing_lines {
        emit_coach_progress(
            app,
            request_id,
            started,
            "cloud_root_cached",
            "Using Lichess Cloud lines",
            format!(
                "Using {} high-depth cloud line(s) already available for this position.",
                request.existing_lines.len().min(multipv as usize)
            ),
            26.0,
            false,
        );
        request
            .existing_lines
            .iter()
            .take(multipv as usize)
            .cloned()
            .collect()
    } else if request.existing_lines.len() >= multipv as usize {
        emit_coach_progress(
            app,
            request_id,
            started,
            "stockfish_cached",
            "Using current Stockfish lines",
            format!(
                "Reusing {} engine line(s) already available for this position.",
                request.existing_lines.len().min(multipv as usize)
            ),
            26.0,
            false,
        );
        request
            .existing_lines
            .iter()
            .take(multipv as usize)
            .cloned()
            .collect()
    } else {
        emit_coach_progress(
            app,
            request_id,
            started,
            "stockfish_root",
            "Running Stockfish MultiPV",
            format!("Analysing the current position at depth {DEFAULT_STOCKFISH_DEPTH}."),
            26.0,
            false,
        );
        run_stockfish_analysis(
            &request.engine_path,
            &request.fen,
            &[],
            multipv,
            DEFAULT_STOCKFISH_DEPTH,
            Duration::from_secs(20),
            "current position",
        )
        .await?
    };
    let used_existing_analysis = !whole_game_mode
        && (use_cloud_existing_lines || request.existing_lines.len() >= multipv as usize);
    emit_coach_progress(
        app,
        request_id,
        started,
        "stockfish_root_done",
        "Root Stockfish lines ready",
        format!(
            "Collected {} line(s) for the current position.",
            stockfish_lines.len()
        ),
        36.0,
        false,
    );

    for (index, stockfish_request) in planned_requests.into_iter().enumerate() {
        emit_coach_progress(
            app,
            request_id,
            started,
            "targeted_planned",
            format!("Running planned Stockfish check {}", index + 1),
            describe_stockfish_request(&stockfish_request),
            38.0 + index as f32 * 5.0,
            false,
        );
        let targeted = run_targeted_stockfish_request(
            &request.engine_path,
            &request,
            &reference_context,
            stockfish_request,
            multipv,
            Duration::from_secs(20),
            Some(CoachProgressContext {
                app,
                request_id,
                started,
                base_progress: 39.0 + index as f32 * 5.0,
            }),
        )
        .await?;
        emit_coach_progress(
            app,
            request_id,
            started,
            "targeted_planned_done",
            format!("Planned Stockfish check {} ready", index + 1),
            format!(
                "{} produced {} line(s).",
                targeted.label,
                targeted.lines.len()
            ),
            42.0 + index as f32 * 5.0,
            false,
        );
        targeted_results.push(targeted);
    }
    let mut chess_fact_calls = infer_default_chess_fact_tool_calls(&request, &reference_context);
    if should_plan_extra_chess_fact_calls(&request, &reference_context) {
        emit_coach_progress(
            app,
            request_id,
            started,
            "chess_fact_plan",
            format!("Asking {planner_model} for chess fact tool calls"),
            "Choosing extra board-state checks for a concrete tactical or legality question.",
            68.0,
            false,
        );
        let chess_fact_prompt = build_chess_fact_tool_prompt(
            &request,
            &stockfish_lines,
            &targeted_results,
            &reference_context,
            &legal_moves,
        );
        match run_gemini_cli(
            &request.settings.gemini_command,
            &planner_model,
            &chess_fact_prompt,
            PLANNER_TIMEOUT_SECS.min(timeout_secs.into()),
        )
        .await
        {
            Ok(answer) => match parse_chess_fact_tool_plan(&answer) {
                Ok(plan) => {
                    let planned_count = plan.calls.len();
                    let reason = trim_chat_text(&plan.reason);
                    chess_fact_calls.extend(plan.calls);
                    emit_coach_progress(
                        app,
                        request_id,
                        started,
                        "chess_fact_plan_done",
                        "Chess fact tool plan ready",
                        format!(
                            "Planner requested {planned_count} fact call(s). {}",
                            if reason.is_empty() {
                                "Using deterministic baseline calls too.".to_string()
                            } else {
                                reason
                            }
                        ),
                        70.0,
                        false,
                    );
                }
                Err(error) => {
                    warn!("ai_coach[{request_id}] chess fact planner malformed: {error}");
                    emit_coach_progress(
                        app,
                        request_id,
                        started,
                        "chess_fact_plan_fallback",
                        "Using deterministic chess facts",
                        format!(
                            "The chess fact planner returned malformed JSON, so the app will use baseline fact calls. {error}"
                        ),
                        70.0,
                        false,
                    );
                }
            },
            Err(error) => {
                warn!("ai_coach[{request_id}] chess fact planner failed: {error}");
                emit_coach_progress(
                    app,
                    request_id,
                    started,
                    "chess_fact_plan_fallback",
                    "Using deterministic chess facts",
                    format!(
                        "The chess fact planner failed, so the app will use baseline fact calls. {error}"
                    ),
                    70.0,
                    false,
                );
            }
        }
    } else {
        emit_coach_progress(
            app,
            request_id,
            started,
            "chess_fact_plan_skip",
            "Using deterministic chess facts",
            "Baseline facts plus explicitly mentioned moves/squares are enough for this conceptual coaching question.",
            70.0,
            false,
        );
    }
    let requested_fact_call_count = chess_fact_calls.len();
    let (chess_fact_results, rejected_chess_fact_calls) =
        execute_chess_fact_tool_calls(&request, &reference_context, chess_fact_calls);
    for rejected in rejected_chess_fact_calls {
        warn!("ai_coach[{request_id}] rejected chess fact tool call: {rejected}");
        emit_coach_progress(
            app,
            request_id,
            started,
            "chess_fact_rejected",
            "Rejected chess fact tool call",
            rejected,
            71.0,
            false,
        );
    }
    emit_coach_progress(
        app,
        request_id,
        started,
        "chess_fact_done",
        "Chess facts ready",
        format!(
            "Executed {} of {} requested deterministic fact call(s).",
            chess_fact_results.len(),
            requested_fact_call_count
        ),
        72.0,
        false,
    );
    emit_coach_progress(
        app,
        request_id,
        started,
        "prompt",
        "Building coach prompt",
        format!(
            "Packaging {} root line(s), {} targeted result(s), {} chess fact result(s), opening context, and chat history.",
            stockfish_lines.len(),
            targeted_results.len(),
            chess_fact_results.len()
        ),
        74.0,
        false,
    );
    let prompt = build_coach_prompt_with_facts(
        &request,
        &stockfish_lines,
        &targeted_results,
        &reference_context,
        &[],
        &chess_fact_results,
    );
    emit_coach_progress(
        app,
        request_id,
        started,
        "gemini_first",
        format!("Asking {model}"),
        format!(
            "Sending {} characters to the local Gemini CLI.",
            prompt.len()
        ),
        80.0,
        false,
    );
    let mut final_answer = run_gemini_cli(
        &request.settings.gemini_command,
        &model,
        &prompt,
        timeout_secs.into(),
    )
    .await?;
    emit_coach_progress(
        app,
        request_id,
        started,
        "gemini_first_done",
        "Gemini replied",
        format!("First response was {} characters.", final_answer.len()),
        90.0,
        false,
    );

    let mut correction_notes = Vec::new();
    if parse_stockfish_request(&final_answer)?.is_some() {
        return Err(CoachError::IllegalStockfishRequest(
            "Gemini Pro asked for extra Stockfish after the planner phase. Follow-up Stockfish calls are disabled; make the planner request the needed lines up front.".to_string(),
        ));
    }
    if let Err(error) = validate_answer_line_blocks(
        &request.fen,
        &final_answer,
        &stockfish_lines,
        &targeted_results,
    ) {
        if let Some(sanitized) = demote_non_current_supported_line_blocks(
            &request.fen,
            &final_answer,
            &stockfish_lines,
            &targeted_results,
        )? {
            emit_coach_progress(
                app,
                request_id,
                started,
                "answer_validation_demote",
                "Demoted non-current line block",
                "A supplied targeted Stockfish line was valid evidence but not clickable from the live board FEN, so the app kept it as plain text.",
                94.0,
                false,
            );
            final_answer = sanitized;
        } else {
            emit_coach_progress(
                app,
                request_id,
                started,
                "answer_validation_repair",
                "Repairing unsupported line in answer",
                error.to_string(),
                94.0,
                false,
            );
            correction_notes.push(format!(
            "Your previous final answer was rejected: {error}. Remove every unsupported <line> block, or replace it with an exact legal prefix of the supplied Stockfish data from the current FEN. If the moves came from a targeted Stockfish result whose FEN is not the current FEN, keep the moves as plain text without <line> tags. Do not include any game-start opening sequence unless it is legal from the current FEN."
        ));
            let repair_prompt = build_coach_prompt_with_facts(
                &request,
                &stockfish_lines,
                &targeted_results,
                &reference_context,
                &correction_notes,
                &chess_fact_results,
            );
            emit_coach_progress(
                app,
                request_id,
                started,
                "gemini_repair",
                format!("Asking {model} to repair the answer"),
                format!(
                    "Sending {} characters with validation feedback.",
                    repair_prompt.len()
                ),
                95.0,
                false,
            );
            final_answer = run_gemini_cli(
                &request.settings.gemini_command,
                &model,
                &repair_prompt,
                timeout_secs.into(),
            )
            .await?;
            if parse_stockfish_request(&final_answer)?.is_some() {
                return Err(CoachError::IllegalStockfishRequest(
                    "Gemini asked for more Stockfish data while repairing an unsupported line"
                        .to_string(),
                ));
            }
            if let Err(repair_error) = validate_answer_line_blocks(
                &request.fen,
                &final_answer,
                &stockfish_lines,
                &targeted_results,
            ) {
                if let Some(sanitized) = demote_non_current_supported_line_blocks(
                    &request.fen,
                    &final_answer,
                    &stockfish_lines,
                    &targeted_results,
                )? {
                    emit_coach_progress(
                        app,
                        request_id,
                        started,
                        "answer_validation_demote",
                        "Demoted non-current line block",
                        "Gemini repeated a non-current targeted line block during repair, so the app kept the moves as plain text.",
                        98.0,
                        false,
                    );
                    final_answer = sanitized;
                } else {
                    emit_coach_progress(
                        app,
                        request_id,
                        started,
                        "answer_flash_audit",
                        format!("Asking {planner_model} to audit answer lines"),
                        repair_error.to_string(),
                        98.0,
                        false,
                    );
                    let audit_prompt = build_answer_line_audit_prompt(
                        &request,
                        &stockfish_lines,
                        &targeted_results,
                        &reference_context,
                        &final_answer,
                        &repair_error.to_string(),
                    );
                    final_answer = run_gemini_cli(
                        &request.settings.gemini_command,
                        &planner_model,
                        &audit_prompt,
                        PLANNER_TIMEOUT_SECS.min(timeout_secs.into()),
                    )
                    .await?;
                }
            }
        }
    }
    if answer_needs_fact_audit(&final_answer, &chess_fact_results) {
        emit_coach_progress(
            app,
            request_id,
            started,
            "answer_fact_audit",
            format!("Auditing board facts with {planner_model}"),
            "Checking board-state claims against private board facts.",
            98.5,
            false,
        );
        let fact_audit_prompt = build_answer_fact_audit_prompt(
            &request,
            &stockfish_lines,
            &targeted_results,
            &chess_fact_results,
            &final_answer,
        );
        match run_gemini_cli(
            &request.settings.gemini_command,
            &planner_model,
            &fact_audit_prompt,
            PLANNER_TIMEOUT_SECS.min(timeout_secs.into()),
        )
        .await
        {
            Ok(audited) if !audited.trim().is_empty() => {
                final_answer = audited;
            }
            Ok(_) => {
                warn!("ai_coach[{request_id}] chess fact audit returned an empty answer");
            }
            Err(error) => {
                warn!("ai_coach[{request_id}] chess fact audit failed: {error}");
                emit_coach_progress(
                    app,
                    request_id,
                    started,
                    "answer_fact_audit_skip",
                    "Fact audit unavailable",
                    format!(
                        "The deterministic fact results remain in the final prompt, but the audit pass failed: {error}"
                    ),
                    98.5,
                    false,
                );
            }
        }
    }
    if parse_stockfish_request(&final_answer)?.is_some() {
        return Err(CoachError::IllegalStockfishRequest(
            "Gemini asked for more Stockfish data during the chess fact audit".to_string(),
        ));
    }
    final_answer = finalize_answer_line_safety(
        app,
        request_id,
        started,
        &request.fen,
        &final_answer,
        &stockfish_lines,
        &targeted_results,
    )?;

    Ok(AiCoachResponse {
        answer: final_answer,
        model,
        used_existing_analysis,
        stockfish_lines,
        targeted_results,
    })
}

fn build_coach_prompt(
    request: &AiCoachRequest,
    stockfish_lines: &[CoachEngineLine],
    targeted_results: &[CoachTargetedResult],
    reference_context: &[CoachReferenceContext],
    correction_notes: &[String],
) -> String {
    build_coach_prompt_with_facts(
        request,
        stockfish_lines,
        targeted_results,
        reference_context,
        correction_notes,
        &[],
    )
}

fn build_coach_prompt_with_facts(
    request: &AiCoachRequest,
    stockfish_lines: &[CoachEngineLine],
    targeted_results: &[CoachTargetedResult],
    reference_context: &[CoachReferenceContext],
    correction_notes: &[String],
    chess_fact_results: &[CoachChessFactResult],
) -> String {
    let pgn = request
        .pgn
        .as_deref()
        .map(trim_prompt_text)
        .unwrap_or_else(|| "Unavailable".to_string());
    let pgn_scope = match request.pgn_scope.trim() {
        "whole_game" => "whole game PGN selected by the Flash planner",
        _ => "current line PGN selected by the Flash planner",
    };
    let selected_move = request
        .selected_move
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Current node");
    let move_history = if request.move_history.is_empty() {
        "None".to_string()
    } else {
        request.move_history.join(" ")
    };
    let whole_game_mode = request.pgn_scope.trim() == "whole_game";
    let use_cloud_existing_lines = existing_lines_are_lichess_cloud(request);
    let engine_lines = if whole_game_mode {
        "Omitted for whole-game review. Do not use current-board/root opening MultiPV as whole-game evidence.".to_string()
    } else if use_cloud_existing_lines {
        format_engine_lines_from(
            stockfish_lines,
            "current FEN (Lichess Cloud)",
            Some(&request.fen),
        )
    } else {
        format_engine_lines_from(stockfish_lines, "current FEN", Some(&request.fen))
    };
    let targeted = if targeted_results.is_empty() {
        "None".to_string()
    } else {
        targeted_results
            .iter()
            .map(format_targeted_result)
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    let has_reference_context = !reference_context.is_empty();
    let chat_history = format_chat_history(&request.chat_history);
    let reference_context = format_reference_context(reference_context);
    let focus_phase = question_focus_phase(&request.question);
    let opening_phase = focus_phase == Some(CoachQuestionPhase::Opening);
    let middlegame_phase = focus_phase == Some(CoachQuestionPhase::Middlegame);
    let conversion_phase = focus_phase == Some(CoachQuestionPhase::EndgameConversion);
    let conversational_followup = question_asks_for_conversational_follow_up(&request.question)
        && (!targeted_results.is_empty() || has_reference_context);
    let opening_context = if whole_game_mode {
        "Omitted for whole-game review; current-FEN explorer stats are not opening-phase evidence."
            .to_string()
    } else {
        format_opening_context(
            request.opening_context.as_ref(),
            request.opening_context_error.as_deref(),
        )
    };
    let game_analysis = format_game_analysis_for_request(request);
    let question_focus = format_question_focus_and_intent(request);
    let salvage_question = question_asks_for_salvage(&request.question);
    let correction_notes = format_correction_notes(correction_notes);
    let chess_facts = format_chess_fact_results(chess_fact_results);
    let root_engine_label = if use_cloud_existing_lines {
        "Lichess Cloud root lines"
    } else {
        "local Stockfish root MultiPV"
    };
    let scope_rules = if opening_phase {
        "- This is an opening-phase review of the loaded game. Focus on the opening and early transition only, roughly moves 1-15 / plies 1-30.\n- Do not answer a previous chat topic, current endgame position, or later middlegame tactic unless the user explicitly asks to connect it to the opening.\n- Use the whole-game PGN only to identify the opening move order and phase boundary. Use opening-phase stored analysis and targeted opening Stockfish results as concrete evidence.\n- Do not include a Critical moments section about later blunders such as move 19 unless the latest question explicitly asks for later critical moments.".to_string()
    } else if middlegame_phase {
        "- This is a middlegame-phase review of the loaded game. Focus on the middlegame decisions, pawn breaks, piece coordination, king safety, and transition into the later phase.\n- Do not drift into opening move-order advice or endgame conversion technique except for one short sentence of causal context if needed.\n- Use the whole-game PGN only to identify the middlegame phase and what actually happened. Use middlegame stored analysis and targeted middlegame Stockfish results as concrete evidence.\n- Do not include generic Critical moments from unrelated phases unless the latest question explicitly asks for the whole game.".to_string()
    } else if conversion_phase {
        "- This is a conversion/endgame-technique review of the loaded game. Focus on the late phase where the advantaged side tried to convert.\n- Do not drift into opening or early middlegame mistakes except for one short sentence of causal context if needed.\n- Use the whole-game PGN only to identify where the conversion phase begins and what actually happened. Use conversion-phase stored analysis and targeted late-game Stockfish results as concrete evidence.\n- Answer the user's side-specific wording. If they ask about Black's conversion, evaluate Black's late decisions, technique, missed simplifications, king/pawn/rook activity, and whether Black kept or spoiled the advantage.\n- Do not include generic Critical moments from earlier in the game unless the latest question explicitly asks why the conversion phase was reached.".to_string()
    } else if salvage_question {
        "- This is a practical recovery/defensive-resource question. Use the PGN and stored analysis only to locate the named position and understand the game context.\n- Do not turn this into a broad whole-game review or a verdict report.\n- If the named move has already been played, prioritize targeted `After <move>` evidence for the best continuation from the bad position.\n- Use before-move analyse_position evidence only for a brief contrast unless the user explicitly asks what should have been played instead.".to_string()
    } else if conversational_followup {
        "- This is a conversational follow-up about a line, sequence, variation, or idea discussed earlier in the chat.\n- Do not restart as a whole-game review, do not list new critical moments, and do not change the topic to the opening/current board unless the latest question explicitly asks for that.\n- Use the Prior targeted Stockfish results, Conversation so far, and Position/reference context to identify the referenced sequence. Explain that sequence directly and concretely.\n- If the user asks to explain it better, give the human mechanism move-by-move: what is attacked, which defender is overloaded or deflected, why a piece is won/lost, and how the supplied engine line proves it.".to_string()
    } else if whole_game_mode {
        "- This is a whole-game review. Do not analyse the starting position/current board as the main topic.\n- Do not give a starting-position engine main line, opening recommendation, or generic move-1 advice unless the user explicitly asks about the opening.\n- Base the answer on the loaded game PGN, Stored whole-game Stockfish analysis, and critical targeted Stockfish results.\n- Prefer whole-game sections: **Direct answer**, **Critical moments**, **What to play instead**, **Training lesson**.\n- Do not include <line> blocks in whole-game answers. Refer to move numbers and SAN in prose; the UI makes those move references clickable.\n- For every critical move you mention, include concrete Stockfish evidence: the played-move refutation line when an `After <move>` targeted result is supplied, and the better line from the matching analyse_position result when supplied.\n- For each critical moment, explain it in this order: verdict, human chess mechanism, engine proof, lesson. The mechanism is mandatory: identify why the line works in chess terms, such as loose piece, overloaded defender, weak back rank, king exposure, bad coordination, trapped queen, open file, weak square, pawn break, tempo gain, or simplification into a better ending.".to_string()
    } else {
        format!(
            "- This is a current-position question. {root_engine_label} and targeted Stockfish results are the main evidence."
        )
    };
    let answer_shape = if opening_phase {
        "Natural answer menu: Direct answer; Opening diagnosis; Key opening moments; Better setup; Training lesson. Use only the sections that help the user's question. Do not discuss later tactical blunders unless they directly arise from the opening choices."
    } else if middlegame_phase {
        "Natural answer menu: Direct answer; Middlegame diagnosis; Key decisions; Better plan; Training lesson. Use only the sections that help the user's question. Do not include an opening or starting-position main line."
    } else if conversion_phase {
        "Natural answer menu: Direct answer; Conversion diagnosis; Key late decisions; Cleaner conversion method; Training lesson. Use only the sections that help the user's question. Do not include an opening or starting-position main line."
    } else if salvage_question {
        "Natural answer menu: Direct answer; Best defensive try; Why it helps; Practical plan from there; What to avoid. Use only the sections that help the user's question. Do not use a Critical moments section unless the user explicitly asked for a review."
    } else if conversational_followup {
        "Natural answer menu: Direct answer; Sequence explained; Why the tactic/plan works; Engine proof; Practical takeaway. Use only the sections that help the user's question. Do not use a Critical moments or whole-game review section."
    } else if whole_game_mode {
        "Natural answer menu: Direct answer; Critical moments; What to play instead; Training lesson. Use only the sections that help the user's question. Do not include a Main line section unless the user asked for one specific variation."
    } else {
        "Natural answer menu: Direct answer; Key reason; Main line or two; Human plan/lesson; Optional training takeaway. Use only the sections that help the user's question."
    };
    let stockfish_scope_rule = if opening_phase {
        "- Current-position root engine lines are irrelevant for this opening-phase review. Use only opening-phase stored analysis and targeted Stockfish results whose labels/FENs belong to the opening phase. Ignore stale targeted results from later moves in prior chat unless the latest question asks about them.".to_string()
    } else if middlegame_phase {
        "- Current-position root engine lines are irrelevant for this middlegame review. Use only middlegame stored analysis and targeted Stockfish results whose labels/FENs belong to the middlegame phase. Ignore stale targeted results from opening/endgame topics in prior chat unless the latest question asks about them.".to_string()
    } else if conversion_phase {
        "- Current-position root engine lines are irrelevant for this conversion/endgame review. Use only conversion-phase stored analysis and targeted Stockfish results whose labels/FENs belong to the late conversion phase. Ignore stale targeted results from opening/middlegame topics in prior chat unless the latest question asks about them.".to_string()
    } else if conversational_followup {
        "- This follow-up should be grounded primarily in the recent targeted Stockfish results and referenced coach-discussion FENs. Current-position root lines are secondary unless the referenced sequence starts from the current FEN. Do not use generic whole-game critical positions as evidence for this turn.".to_string()
    } else if whole_game_mode {
        "- Current-position root engine lines are intentionally omitted for this whole-game review. Use only Stored whole-game Stockfish analysis and targeted Stockfish results as concrete engine evidence.".to_string()
    } else if use_cloud_existing_lines {
        "- Root Lichess Cloud lines are from the current FEN and should be preferred over local Stockfish for this opening-stage evidence. Targeted Stockfish results list their own FEN; use each targeted result only for that listed position. Targeted \"After ...\" results already include the requested move or requested line before the continuation.".to_string()
    } else {
        "- Root Stockfish MultiPV is from the current FEN. Targeted results list their own FEN; use each targeted result only for that listed position. Targeted \"After ...\" results already include the requested move or requested line before the continuation.".to_string()
    };
    let section_label_rule = if opening_phase {
        "- When section labels help, use bold labels like **Direct answer**, **Opening diagnosis**, **Key opening moments**, **Better setup**, and **Training lesson**. For inline labels, use double-asterisk bold such as **Verdict:**, not single-asterisk italic labels like *Verdict*:. Do not use Markdown # headings."
    } else if middlegame_phase {
        "- When section labels help, use bold labels like **Direct answer**, **Middlegame diagnosis**, **Key decisions**, **Better plan**, and **Training lesson**. For inline labels, use double-asterisk bold such as **Verdict:**, not single-asterisk italic labels like *Verdict*:. Do not use Markdown # headings."
    } else if conversion_phase {
        "- When section labels help, use bold labels like **Direct answer**, **Conversion diagnosis**, **Key late decisions**, **Cleaner conversion method**, and **Training lesson**. For inline labels, use double-asterisk bold such as **Verdict:**, not single-asterisk italic labels like *Verdict*:. Do not use Markdown # headings."
    } else if salvage_question {
        "- When section labels help, use bold labels like **Direct answer**, **Best defensive try**, **Why it helps**, **Practical plan**, and **What to avoid**. For inline labels, use double-asterisk bold such as **Verdict:**, not single-asterisk italic labels like *Verdict*:. Do not use Markdown # headings."
    } else if conversational_followup {
        "- When section labels help, use bold labels like **Direct answer**, **Sequence explained**, **Engine proof**, and **Practical takeaway**. For inline labels, use double-asterisk bold such as **Verdict:**, not single-asterisk italic labels like *Verdict*:. Do not use Markdown # headings."
    } else if whole_game_mode {
        "- When section labels help, use bold labels like **Direct answer**, **Critical moments**, **What to play instead**, and **Training lesson**. For inline labels, use double-asterisk bold such as **Verdict:**, not single-asterisk italic labels like *Verdict*:. Do not use Markdown # headings."
    } else {
        "- When section labels help, use bold labels like **Direct answer**, **Key reason**, and **Main line**. For inline labels, use double-asterisk bold such as **Verdict:**, not single-asterisk italic labels like *Verdict*:. Do not use Markdown # headings."
    };

    format!(
        r#"Role: You are a concept-first chess coach explaining a position.

{style_guide}

Core rules:
- Supplied engine analysis is the source of truth for concrete evaluations and variations. Prefer Lichess Cloud root lines when they are supplied; otherwise use local Stockfish root MultiPV. Targeted follow-up results are local Stockfish.
- Private board-state facts are guardrails for board-state claims, not prose material. Use them silently. In the final answer, never refer to evidence-gathering machinery, private checks, structured details, or verification process.
- Your job is to teach the chess meaning of the evidence. Do not merely inventory facts, evals, or candidate moves. First name the strategic/tactical tension in human terms, then use the supplied line as proof.
- For the current position, do not claim a move is legal/illegal, a piece is attacked, defended, undefended, loose, hanging, pinned, trapped, overloaded, forked, skewered, mating, checking, or tactically threatened unless the private chess facts support that claim.
- Do not infer current-position facts from visual memory, blindfold calculation, opening memory, or the PGN alone. If the needed private fact is missing, avoid that claim or phrase it as an engine-line consequence rather than talking about missing facts.
- When explaining a tactic, use Stockfish for evaluation/PV and private chess facts for the concrete board mechanism, but write only normal coach prose: "the queen is overloaded", "Qxh7+ keeps White alive", "the bishop is defended", etc.
- Only mention board facts that answer the user's question. Do not list unrelated attacked, hanging, or undefended pieces just because they appear in the private fact data.
- A loose or undefended piece is not automatically the reason a move is bad. Mention it as causal only when a supplied Stockfish line or targeted reply actually attacks it, wins it, forces it to move, or overloads it. Otherwise leave it out.
- Never invent concrete tactics, evaluations, plans, or variations. Any concrete move line or plan you recommend must be backed by supplied root engine lines or targeted Stockfish results.
- PGN context is plain mainline movetext only. No PGN comments, NAGs, arrows, extra markups, or variations are supplied to you; do not infer from absent notes or annotations.
- Do not give a verdict such as bad, good, inaccurate, mistake, blunder, winning, losing, or refuted unless you also cite the supplied engine line that supports it. Name the relevant evaluation/depth when available.
- A Stockfish evaluation plus a PV is not an explanation. Before or immediately after each cited PV, explain the human reason the line works. Say what changed on the board: which piece became loose, which defender was overloaded, which square/file/diagonal was weakened, which tempo was won, which king-safety problem appeared, which pawn break opened the position, or why the resulting structure/endgame is better.
- Do not write bullets that only say "Stockfish evaluates this at..." or "the engine line is..." followed by moves. Every critical bullet needs at least one human chess sentence that interprets the line.
- When the engine's top line is messy or counterintuitive, explain the practical tradeoff: what counterplay is allowed, what counterplay is killed, what must be calculated, and whether a human should choose the clean conversion or the maximum engine continuation.
- For a targeted result with a non-empty `Moves:` fixed prefix, line 1 is the evaluation of that requested move or line under best play. Lines 2+ are alternative replies/continuations for the side to move after the fixed prefix. Never quote a line 2+ eval as the main evaluation of the requested move/line.
- For any bad move, show the concrete Stockfish continuation that punishes it. If a targeted result labelled `After <move>` exists, use one of its full lines as the refutation. If no such line exists, say the supplied data does not contain the refutation instead of hand-waving.
- For any recommended improvement, show the concrete Stockfish continuation from analyse_position/root lines that justifies the recommendation.
- Material summaries are guardrails, not the main explanation. Do not claim "wins the exchange", "wins a piece", "wins a pawn", or similar material verdicts unless the supplied material summary for the cited PV supports that exact claim. If the engine line only proves a positional/evaluation swing, describe the tactical or strategic mechanism instead.
- You may use general chess and opening knowledge for concepts, structures, plans, and naming, but only as explanation layered on top of engine-backed lines.
- Explain like a strong GM/coach: use proper chess terminology such as isolated queen's pawn, minority attack, deflection, trapped piece, blockade, weak square, exchange sacrifice, or domination when it genuinely fits.
- Treat Lichess All opening stats and blended strength as practical/popularity evidence only. Use it when relevant to opening choice, repertoire, popularity, or practical results; do not treat it as a tactical proof.
- Do not request tools, shell commands, files, network lookups, external resources, or the Stockfish request protocol in your final answer. Separate planners have already requested all allowed Stockfish analysis and private board-state checks up front.
- If the supplied engine data still does not fully answer the user's question, say that limitation briefly and answer only from the supplied evidence. Do not output <stockfish_request>.
- Use the conversation history to answer follow-up questions naturally.
- Answer the user's actual requested task directly in the first paragraph. First identify whether they are asking for a verdict, a defensive resource, a practical plan, a comparison, why a move works/fails, a phase review, or what to play instead. Do not substitute a nearby topic just because the engine data contains it.
- For "what is the plan" questions, give a real plan, not just a best move: ideal piece placement, pawn break, opponent counterplay to stop, and the tactical reason the plan is currently possible.
- If the user asks whether a tempting capture/reply works after a move, answer that exact reply first. Show the Stockfish continuation after the capture/reply if targeted evidence is supplied, then explain the human reason it succeeds or fails. Do not answer only with the engine's best alternative reply.
- If targeted Stockfish results are supplied for the latest question focus, use those results as the spine of the answer before discussing any other evidence. Do not say the data is unavailable unless no focused targeted results and no focused stored analysis are supplied.
- Obey the Question focus and intent section. When the user asks about a named move, answer around that move first. Mention other game moments only when they are direct alternatives from the same position, direct continuations/refutations after that move, or necessary causal context for that move.
- When the requested task is a defensive resource or practical recovery question, answer from the difficult position the user names. Do not merely state that the user is worse or losing. You may acknowledge the eval once, then spend the answer on the best practical try, the concrete continuation, the human defensive idea, and what the user should aim for next. Keep earlier alternatives to one short note unless the user asks for them.
- Use the Position/reference context to resolve explicit references such as "after 19.Nexd4", "that line", or "the line we discussed". If a referenced FEN is supplied there, use only Stockfish results from that FEN or current-FEN lines that legally reach it; do not reinterpret the reference from a different position.
- For whole-game review questions, do more than list mistakes: when critical-position Stockfish results are supplied, tell the user what should have been played instead and why Stockfish prefers that move over the move played. It is fine to cover only the critical mistakes.
- If you cannot identify a clear human mechanism from a supplied line, say that the engine line proves a concrete problem but the supplied data does not show a simple motif, then still give the best practical lesson you can support. Do not pretend to see a tactic that is not there.
{scope_rules}
{stockfish_scope_rule}
{section_label_rule}
- When you give a concrete playable variation from the current FEN in your final answer, wrap only the moves in <line>...</line>. Do not wrap prose. Only include a <line> block when that exact line is a full legal sequence from the current FEN and is a prefix of current-FEN Stockfish data supplied here.
- Do not wrap whole-game critical-position alternatives in <line> unless that targeted result's FEN is exactly the current FEN.
- A <line> block must start at the current FEN, not at the start of the game. Never include earlier PGN/game moves just to reach the variation. For a non-current whole-game improvement, write the moves as plain text instead of a <line> block.
- If you discuss a move that happens after another move first, the <line> block must include the earlier move(s) too. For example, use <line>Bh6 e4 ...</line>, not <line>e4 ...</line>, when e4 is only meaningful after Bh6.
- Do not give an engine-looking line unless it appears in the supplied root engine lines or targeted Stockfish result.
- Do not wrap move names in backticks. Write move references as normal SAN with move numbers when possible, such as 19.Nexd4 or 22.Bxh6?.
- Prefer short but concrete line evidence over vague strategic labels. A sentence like "21.h4? is bad because 21...Rc8 22.Kg1 Qxh4 wins" is better than "21.h4 weakens the king" unless both are included.
- Keep answers concise unless the user asks for depth, but do not be shallow: one well-explained mechanism is better than several unexplained engine facts.
- {answer_shape}

Position:
FEN: {fen}
Side to move: {side_to_move}
Selected move/current node: {selected_move}
Move history in UCI: {move_history}

PGN context ({pgn_scope}):
{pgn}

Stored whole-game Stockfish analysis:
{game_analysis}

Private board-state facts (internal guardrails; do not mention this section):
{chess_facts}

Root engine lines:
{engine_lines}

Targeted Stockfish result:
{targeted}

Lichess All opening context:
{opening_context}

Conversation so far:
{chat_history}

Question focus and intent:
{question_focus}

Position/reference context:
{reference_context}

Correction from the app:
{correction_notes}

User question:
{question}
"#,
        fen = request.fen,
        side_to_move = request.side_to_move,
        selected_move = selected_move,
        move_history = move_history,
        pgn_scope = pgn_scope,
        pgn = pgn,
        game_analysis = game_analysis,
        chess_facts = chess_facts,
        engine_lines = engine_lines,
        targeted = targeted,
        opening_context = opening_context,
        chat_history = chat_history,
        question_focus = question_focus,
        reference_context = reference_context,
        correction_notes = correction_notes,
        style_guide = COACH_STYLE_GUIDE,
        scope_rules = scope_rules,
        answer_shape = answer_shape,
        stockfish_scope_rule = stockfish_scope_rule,
        section_label_rule = section_label_rule,
        question = request.question.as_str(),
    )
}

fn build_planner_prompt(
    request: &AiCoachRequest,
    legal_moves: &str,
    targeted_results: &[CoachTargetedResult],
    reference_context: &[CoachReferenceContext],
) -> String {
    let selected_move = request
        .selected_move
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Current node");
    let move_history = if request.move_history.is_empty() {
        "None".to_string()
    } else {
        request.move_history.join(" ")
    };
    let current_line_pgn = request
        .current_line_pgn
        .as_deref()
        .or_else(|| request.pgn.as_deref())
        .map(trim_prompt_text)
        .unwrap_or_else(|| "Unavailable".to_string());
    let whole_game_pgn = request
        .whole_game_pgn
        .as_deref()
        .or_else(|| request.pgn.as_deref())
        .map(trim_prompt_text)
        .unwrap_or_else(|| "Unavailable".to_string());
    let game_analysis = format_game_analysis_for_request(request);
    let critical_positions = format_critical_game_positions(request);
    let chat_history = format_chat_history(&request.chat_history);
    let reference_context = format_reference_context(reference_context);
    let question_focus = format_question_focus_and_intent(request);
    let existing_engine_lines = format_engine_lines(&request.existing_lines);
    let targeted = if targeted_results.is_empty() {
        "None".to_string()
    } else {
        targeted_results
            .iter()
            .map(format_targeted_result)
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    let opening_context = format_opening_context(
        request.opening_context.as_ref(),
        request.opening_context_error.as_deref(),
    );

    format!(
        r#"You are a fast chess-analysis planner. Your only job is to decide which local Stockfish analyses are needed before a stronger coach model answers the user.

Rules:
- Output only one JSON object. No markdown, no prose outside JSON.
- Do not analyse chess yourself and do not answer the user's question.
- First choose pgn_scope. Use "whole_game" when the user asks to analyse, review, annotate, recap, go through, or find what went wrong in the loaded game. Use "current_line" for questions about the current board position, opening choice, a candidate move, or a concrete line.
- If the user asks to examine a specific phase of the loaded game, choose "whole_game" and plan only Stockfish checks from that phase. Opening/opening phase uses opening positions; middlegame/middle-game phase uses middlegame positions; conversion/endgame technique/closing out uses late conversion positions. Do not request unrelated phase mistakes unless the user explicitly asks for the cause of that phase.
- If the latest question uses conversational references such as "that line", "that sequence", "that variation", "explain that better", "where I can win a piece", or "the thing we discussed", treat it as a follow-up to the most recent relevant coach discussion and prior targeted Stockfish results. Choose "current_line" unless the latest question explicitly asks for the whole game. Do not restart a whole-game review and do not inspect Critical whole-game positions for that turn.
- Plan Stockfish work for the user's actual requested task, not just for a generic verdict. If they ask how to defend, hold, recover, compare, understand why, or choose a plan, request evidence that answers that task directly.
- If the user names a concrete move from the loaded game, keep the plan anchored to that move. Do not turn a named-move question into a broad critical-moments review unless the user explicitly asks for the whole game.
- The stronger coach model will only receive the PGN scope you choose, so do not choose "current_line" for whole-game review wording like "analyse this game".
- Stockfish is the source of truth. Be generous: it is better to request too many relevant Stockfish lines than too few.
- analyse_move, compare_moves, and analyse_line requests must start from the exact current FEN. Do not invent later FENs.
- Exception: if the user explicitly refers to a supplied Position/reference context item, requests may use that item's exact FEN. Treat those FENs as vetted anchors, not invented positions.
- For whole-game review questions, inspect the Critical whole-game positions list. For each important blunder/mistake you plan to mention, request BOTH analyse_move for the played bad move and analyse_position from the same before-move FEN. The coach needs the played-move refutation line and the better Stockfish line. Use the listed before-move FEN exactly.
- For a named loaded-game move listed under Critical whole-game positions, request BOTH analyse_move for that named move and analyse_position from the same before-move FEN. Do not request unrelated later critical moments unless they directly explain the named move.
- If the user asks why a game move was bad, inaccurate, or a blunder, request analyse_move for that exact played move from its before-move FEN so the final answer can show the concrete refutation.
- analyse_position is only allowed for the exact current FEN, an exact before-move FEN listed in Critical whole-game positions, or an exact FEN from Position/reference context.
- For a move from the current position, use analyse_move.
- For references like "after 19.Nexd4" or "the line we discussed after 19.Nexd4", first match the reference against Position/reference context, then request analyse_position or analyse_move from that exact referenced FEN.
- For conversational follow-ups about a previously discussed sequence, first inspect Prior targeted Stockfish already available and Position/reference context. If that evidence already contains the line, request no new Stockfish and let Pro explain it. If a small extension is needed, use analyse_line from the exact referenced FEN with the sequence prefix.
- For alternatives like "why is e4 better than Nxg6", use compare_moves and include every named legal candidate plus any obvious relevant candidate from the current root lines/opening stats.
- For "what if ... then ..." or a move that happens after another move, use analyse_line with the full sequence from the current FEN.
- If the question asks about plans and no specific move is named, request analyse_move for 2-4 important candidate moves from existing engine lines/opening context when available.
- If the question asks about a likely opponent reply or defensive resource, include analyse_line requests that start with the user-side move and the opponent reply when the line is legal.
- Avoid duplicate requests. Maximum {max_requests} requests.
- Legal root moves are listed below as SAN (UCI). Use SAN or UCI in requests.

Required JSON shape:
{{
  "pgn_scope": "current_line",
  "reason": "brief planner reason",
  "requests": [
    {{"type":"analyse_position","fen":"{fen}","label":"Critical position before the mistake","reason":"Find the best move that should have been played."}},
    {{"type":"compare_moves","fen":"{fen}","moves":["e4","Nxg6"],"reason":"Compare the named candidate moves."}},
    {{"type":"analyse_move","fen":"{fen}","move":"e4","reason":"Check the main candidate move."}},
    {{"type":"analyse_line","fen":"{fen}","line":"Bh6 O-O","reason":"Check the user's what-if line from the current FEN."}}
  ]
}}

Current position:
FEN: {fen}
Side to move: {side_to_move}
Selected move/current node: {selected_move}
Move history in UCI: {move_history}

Current-line PGN up to selected position:
{current_line_pgn}

Whole-game PGN:
{whole_game_pgn}

Stored whole-game Stockfish analysis:
{game_analysis}

Critical whole-game positions:
{critical_positions}

Legal root moves:
{legal_moves}

Existing root engine lines, if any:
{existing_engine_lines}

Prior targeted Stockfish already available:
{targeted}

Lichess All opening context, if available:
{opening_context}

Conversation so far:
{chat_history}

Question focus and intent:
{question_focus}

Position/reference context:
{reference_context}

User question:
{question}
"#,
        max_requests = MAX_PLANNER_STOCKFISH_REQUESTS,
        fen = request.fen,
        side_to_move = request.side_to_move,
        selected_move = selected_move,
        move_history = move_history,
        current_line_pgn = current_line_pgn,
        whole_game_pgn = whole_game_pgn,
        game_analysis = game_analysis,
        critical_positions = critical_positions,
        legal_moves = legal_moves,
        existing_engine_lines = existing_engine_lines,
        targeted = targeted,
        opening_context = opening_context,
        chat_history = chat_history,
        question_focus = question_focus,
        reference_context = reference_context,
        question = request.question
    )
}

fn build_chess_fact_tool_prompt(
    request: &AiCoachRequest,
    stockfish_lines: &[CoachEngineLine],
    targeted_results: &[CoachTargetedResult],
    reference_context: &[CoachReferenceContext],
    legal_moves: &str,
) -> String {
    let selected_move = request
        .selected_move
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Current node");
    let move_history = if request.move_history.is_empty() {
        "None".to_string()
    } else {
        request.move_history.join(" ")
    };
    let current_line_pgn = request
        .current_line_pgn
        .as_deref()
        .or_else(|| request.pgn.as_deref())
        .map(trim_prompt_text)
        .unwrap_or_else(|| "Unavailable".to_string());
    let whole_game_pgn = request
        .whole_game_pgn
        .as_deref()
        .or_else(|| request.pgn.as_deref())
        .map(trim_prompt_text)
        .unwrap_or_else(|| "Unavailable".to_string());
    let chat_history = format_chat_history(&request.chat_history);
    let reference_context = format_reference_context(reference_context);
    let targeted = if targeted_results.is_empty() {
        "None".to_string()
    } else {
        targeted_results
            .iter()
            .map(format_targeted_result)
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    let root_lines = format_engine_lines_from(stockfish_lines, "current FEN", Some(&request.fen));
    let question_focus = format_question_focus_and_intent(request);

    format!(
        r#"You are the chess fact tool planner for a local chess coach.

Task:
- Decide which deterministic chess fact tool calls must run before the coach writes the final answer.
- Output only one JSON object. No markdown, no prose outside JSON.
- Do not answer the user's question.

Hard rule:
- Any factual claim about the current position must be grounded in a chess fact tool result before the final coach model may say it. This includes legal/illegal moves, attacked pieces, defended pieces, undefended pieces, hanging pieces, threats, checks, mates, pins, forks, skewers, discovered attacks, overloaded defenders, trapped pieces, x-rays, and tactical motifs.
- If the coach may need to mention a square, piece, move, or line to explain the answer, request a tool call for it. Prefer extra cheap fact calls over letting the final model infer from visual memory.
- Use Stockfish only for evaluation strength. Use these chess fact tools for board-state truth.
- Use only the current FEN, an exact Position/reference context FEN, or an exact FEN already supplied in the stored/targeted evidence. Do not invent FENs.
- Maximum {max_calls} calls. The app will add a current-position baseline even if you omit it.

Available tools:
- position_facts: side to move, legal moves, check/mate/stalemate status, checkers, and legal captures. This is a baseline, not a tactical explanation.
- legal_moves: full legal move list from a FEN.
- square_facts: piece on a square, all attackers, all defenders, and whether the occupied piece is undefended.
- move_facts: whether a move is legal, its SAN/UCI, capture/check/mate status, resulting FEN, and what the moved piece attacks after the move.
- line_facts: legal move-by-move board states and final FEN for a concrete line.

Required JSON shape:
{{
  "reason": "brief reason for these fact checks",
  "calls": [
    {{"tool":"position_facts","fen":"{fen}","reason":"Baseline board facts before explaining the current position."}},
    {{"tool":"square_facts","fen":"{fen}","square":"c1","reason":"Verify whether the c1 piece is defended or attacked."}},
    {{"tool":"move_facts","fen":"{fen}","move":"Rc4","reason":"Verify what the candidate move attacks and whether it creates a concrete threat."}},
    {{"tool":"line_facts","fen":"{fen}","line":"Rc4 Rxc4","reason":"Verify a concrete tactical sequence."}},
    {{"tool":"legal_moves","fen":"{fen}","reason":"Verify all legal current-position moves before discussing legality."}}
  ]
}}

Current position:
FEN: {fen}
Side to move: {side_to_move}
Selected move/current node: {selected_move}
Move history in UCI: {move_history}

Legal root moves:
{legal_moves}

Current-line PGN:
{current_line_pgn}

Whole-game PGN:
{whole_game_pgn}

Current-FEN engine lines:
{root_lines}

Targeted Stockfish results:
{targeted}

Conversation so far:
{chat_history}

Question focus and intent:
{question_focus}

Position/reference context:
{reference_context}

User question:
{question}
"#,
        max_calls = MAX_CHESS_FACT_TOOL_CALLS,
        fen = request.fen,
        side_to_move = request.side_to_move,
        selected_move = selected_move,
        move_history = move_history,
        legal_moves = legal_moves,
        current_line_pgn = current_line_pgn,
        whole_game_pgn = whole_game_pgn,
        root_lines = root_lines,
        targeted = targeted,
        chat_history = chat_history,
        question_focus = question_focus,
        reference_context = reference_context,
        question = request.question
    )
}

fn build_answer_line_audit_prompt(
    request: &AiCoachRequest,
    stockfish_lines: &[CoachEngineLine],
    targeted_results: &[CoachTargetedResult],
    reference_context: &[CoachReferenceContext],
    answer: &str,
    validation_error: &str,
) -> String {
    let root_lines = if stockfish_lines.is_empty() {
        "None".to_string()
    } else {
        format_engine_lines_from(stockfish_lines, "current FEN", Some(&request.fen))
    };
    let targeted = if targeted_results.is_empty() {
        "None".to_string()
    } else {
        targeted_results
            .iter()
            .map(format_targeted_result)
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    let reference_context = format_reference_context(reference_context);

    format!(
        r#"You are an answer safety auditor for a local chess coach.

Task:
Rewrite the draft answer so it is safe to display.

Hard rules:
- Return only the revised final answer. No JSON. No code fence. No explanation of the audit.
- Stockfish is the source of truth.
- Do not invent engine lines, tactics, evaluations, or variations.
- Remove every unsupported <line>...</line> block.
- Use <line>...</line> only when that exact move sequence is legal from the current FEN and is a prefix of the supplied current-FEN root Stockfish lines.
- If a line comes from a targeted Stockfish result whose FEN is not the current FEN, keep the moves as plain text, not inside <line>.
- If you cannot verify a concrete move sequence against the supplied data, remove that line from the answer.
- Preserve the useful explanation and the direct answer to the user. If removing a line makes a claim unsupported, soften or remove the claim too.
- Do not output <stockfish_request>.

Validation error:
{validation_error}

Current FEN:
{fen}

User question:
{question}

Current-FEN root Stockfish lines:
{root_lines}

Targeted Stockfish results:
{targeted}

Position/reference context:
{reference_context}

Draft answer:
{answer}
"#,
        validation_error = validation_error,
        fen = request.fen.as_str(),
        question = request.question.as_str(),
        root_lines = root_lines,
        targeted = targeted,
        reference_context = reference_context,
        answer = answer
    )
}

fn build_answer_fact_audit_prompt(
    request: &AiCoachRequest,
    stockfish_lines: &[CoachEngineLine],
    targeted_results: &[CoachTargetedResult],
    chess_fact_results: &[CoachChessFactResult],
    answer: &str,
) -> String {
    let root_lines = if stockfish_lines.is_empty() {
        "None".to_string()
    } else {
        format_engine_lines_from(stockfish_lines, "current FEN", Some(&request.fen))
    };
    let targeted = if targeted_results.is_empty() {
        "None".to_string()
    } else {
        targeted_results
            .iter()
            .map(format_targeted_result)
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    let chess_facts = format_chess_fact_results(chess_fact_results);

    format!(
        r#"You are a factual safety auditor for a local chess coach.

Task:
Rewrite the draft answer so every current-position board-state claim is supported by the private board-state facts.

Hard rules:
- Return only the revised final answer. No JSON. No code fence. No explanation of the audit.
- Preserve the useful coaching and the user's requested answer.
- Stockfish supports evaluations and PVs. Private board-state facts support board facts.
- Never refer to the evidence-gathering process in the final answer. Rewrite implementation-flavored language into normal coach prose.
- For the current position, remove or soften claims about legal moves, illegal moves, attacked pieces, defended pieces, undefended pieces, loose pieces, hanging pieces, threats, checks, mates, pins, forks, skewers, trapped pieces, overloaded defenders, x-rays, and tactics unless the private board-state facts explicitly support the claim.
- In particular, do not say a piece is "undefended", "loose", or "hanging" unless square, move, or line-specific facts directly about that piece support it.
- Do not infer facts from board vision, memory, PGN context, or general chess knowledge. If a factual mechanism is not verified by the private board-state facts, remove that mechanism or describe only the engine line consequence.
- Keep only the board facts that answer the user's question. Remove unrelated lists of attacked, hanging, or undefended pieces.
- A loose or undefended piece is not automatically causal. Remove it unless a supplied Stockfish line or targeted reply actually exploits that piece.
- If the user asked whether a tempting capture/reply works after a move, lead with that exact reply and the Stockfish continuation after it when supplied.
- Keep <line>...</line> blocks only if they are already present and still necessary; do not invent new line blocks.
- Do not output <stockfish_request>.

Current FEN:
{fen}

User question:
{question}

Current-FEN root Stockfish lines:
{root_lines}

Targeted Stockfish results:
{targeted}

Private board-state facts (internal guardrails; do not mention this section):
{chess_facts}

Draft answer:
{answer}
"#,
        fen = request.fen.as_str(),
        question = request.question.as_str(),
        root_lines = root_lines,
        targeted = targeted,
        chess_facts = chess_facts,
        answer = answer
    )
}

fn answer_contains_evidence_leakage(answer: &str) -> bool {
    let answer = answer.to_ascii_lowercase();
    [
        "tool result",
        "tool call",
        "supplied fact",
        "supplied facts",
        "fact tool",
        "facts json",
        "deterministic fact",
        "private check",
        "structured detail",
        "verification machinery",
        "private board-state facts",
    ]
    .iter()
    .any(|term| answer.contains(term))
}

fn answer_contains_high_risk_board_claim(answer: &str) -> bool {
    let answer = answer.to_ascii_lowercase();
    [
        "legal",
        "illegal",
        "undefended",
        "unprotected",
        "loose",
        "hanging",
        "pinned",
        " pin",
        "fork",
        "skewer",
        "x-ray",
        "xray",
        "trapped",
        "overloaded",
        "checkmate",
        " mate",
        "wins a piece",
        "wins the exchange",
        "wins a pawn",
        "wins material",
        "winning material",
    ]
    .iter()
    .any(|term| answer.contains(term))
}

fn answer_needs_fact_audit(answer: &str, chess_fact_results: &[CoachChessFactResult]) -> bool {
    answer_contains_evidence_leakage(answer)
        || (answer_contains_high_risk_board_claim(answer) && chess_fact_results.len() <= 1)
}

fn parse_planner_response(output: &str) -> Result<CoachPlannerResponse, CoachError> {
    let json = extract_first_json_object(output).ok_or_else(|| {
        CoachError::GeminiPlannerMalformed("no JSON object was found".to_string())
    })?;
    serde_json::from_str(&json).map_err(|error| {
        CoachError::GeminiPlannerMalformed(format!("{} in `{}`", error, trim_error_text(output)))
    })
}

fn parse_chess_fact_tool_plan(output: &str) -> Result<ChessFactToolPlan, CoachError> {
    let json = extract_first_json_object(output).ok_or_else(|| {
        CoachError::GeminiChessFactMalformed("no JSON object was found".to_string())
    })?;
    serde_json::from_str(&json).map_err(|error| {
        CoachError::GeminiChessFactMalformed(format!("{} in `{}`", error, trim_error_text(output)))
    })
}

fn extract_first_json_object(output: &str) -> Option<String> {
    let mut start = None;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (index, ch) in output.char_indices() {
        if start.is_none() {
            if ch == '{' {
                start = Some(index);
                depth = 1;
            }
            continue;
        }

        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    let start = start?;
                    return Some(output[start..=index].to_string());
                }
            }
            _ => {}
        }
    }

    None
}

fn sanitize_planner_requests(
    coach_request: &AiCoachRequest,
    reference_context: &[CoachReferenceContext],
    requests: Vec<StockfishFollowUpRequest>,
) -> (Vec<StockfishFollowUpRequest>, Vec<String>) {
    let mut accepted = Vec::new();
    let mut rejected = Vec::new();
    let mut seen = HashSet::new();

    for request in requests {
        let detail = describe_stockfish_request(&request);
        match stockfish_request_key(coach_request, reference_context, &request) {
            Ok(key) => {
                if seen.insert(key) {
                    accepted.push(request);
                } else {
                    rejected.push(format!("duplicate request: {detail}"));
                }
            }
            Err(error) => rejected.push(format!("{detail} ({error})")),
        }

        if accepted.len() >= MAX_PLANNER_STOCKFISH_REQUESTS {
            break;
        }
    }

    (accepted, rejected)
}

fn stockfish_request_key(
    coach_request: &AiCoachRequest,
    reference_context: &[CoachReferenceContext],
    request: &StockfishFollowUpRequest,
) -> Result<String, CoachError> {
    match request {
        StockfishFollowUpRequest::AnalysePosition { fen, .. } => {
            validate_stockfish_anchor_fen(coach_request, reference_context, fen)?;
            Ok(format!("analyse_position:{}", fen.trim()))
        }
        StockfishFollowUpRequest::AnalyseMove { fen, mv, .. } => {
            validate_stockfish_anchor_fen(coach_request, reference_context, fen)?;
            let (uci, _) = parse_single_move(fen, mv)?;
            Ok(format!("analyse_move:{}:{uci}", fen.trim()))
        }
        StockfishFollowUpRequest::CompareMoves { fen, moves, .. } => {
            validate_stockfish_anchor_fen(coach_request, reference_context, fen)?;
            if moves.is_empty() || moves.len() > 5 {
                return Err(CoachError::IllegalStockfishRequest(
                    "compare_moves requires 1 to 5 moves".to_string(),
                ));
            }
            let mut seen = HashSet::new();
            let mut normalized = Vec::new();
            for mv in moves {
                let (uci, _) = parse_single_move(fen, mv)?;
                if seen.insert(uci.clone()) {
                    normalized.push(uci);
                }
            }
            if normalized.is_empty() {
                return Err(CoachError::IllegalStockfishRequest(
                    "compare_moves contained no legal moves".to_string(),
                ));
            }
            Ok(format!(
                "compare_moves:{}:{}",
                fen.trim(),
                normalized.join(",")
            ))
        }
        StockfishFollowUpRequest::AnalyseLine { fen, line, .. } => {
            validate_stockfish_anchor_fen(coach_request, reference_context, fen)?;
            let moves = parse_line_moves(fen, line)?;
            if moves.is_empty() {
                return Err(CoachError::IllegalStockfishRequest(
                    "analyse_line requires at least one legal move".to_string(),
                ));
            }
            Ok(format!("analyse_line:{}:{}", fen.trim(), moves.join(",")))
        }
    }
}

fn stockfish_request_uses_current_or_reference_fen(
    coach_request: &AiCoachRequest,
    reference_context: &[CoachReferenceContext],
    request: &StockfishFollowUpRequest,
) -> bool {
    let fen = match request {
        StockfishFollowUpRequest::AnalysePosition { fen, .. }
        | StockfishFollowUpRequest::AnalyseMove { fen, .. }
        | StockfishFollowUpRequest::CompareMoves { fen, .. }
        | StockfishFollowUpRequest::AnalyseLine { fen, .. } => fen.trim(),
    };

    fen == coach_request.fen.trim() || is_reference_fen(reference_context, fen)
}

fn validate_stockfish_anchor_fen(
    coach_request: &AiCoachRequest,
    reference_context: &[CoachReferenceContext],
    requested_fen: &str,
) -> Result<(), CoachError> {
    let requested_fen = requested_fen.trim();
    if requested_fen.is_empty() {
        return Err(CoachError::IllegalStockfishRequest(
            "analyse_position requires a FEN".to_string(),
        ));
    }
    let _ = parse_fen_to_position(requested_fen)?;

    if requested_fen == coach_request.fen.trim() {
        return Ok(());
    }

    if is_reference_fen(reference_context, requested_fen) {
        return Ok(());
    }

    if is_allowed_game_analysis_before_fen(coach_request, requested_fen) {
        return Ok(());
    }

    Err(CoachError::IllegalStockfishRequest(
        "Stockfish requests must use the current FEN, an exact supplied reference FEN, or an exact focused before-move FEN from loaded game analysis; use analyse_line to inspect an unlisted later position"
            .to_string(),
    ))
}

fn is_allowed_game_analysis_before_fen(
    coach_request: &AiCoachRequest,
    requested_fen: &str,
) -> bool {
    select_critical_game_moments_any_scope(coach_request)
        .into_iter()
        .chain(select_question_referenced_game_moments(coach_request))
        .chain(select_whole_game_evidence_moments(coach_request))
        .chain(
            question_focus_phase(&coach_request.question)
                .map(|phase| select_phase_game_moments(coach_request, phase))
                .unwrap_or_default(),
        )
        .filter_map(|point| point.before_fen.as_deref())
        .any(|fen| fen.trim() == requested_fen)
}

fn format_legal_root_moves(fen: &str) -> Result<String, CoachError> {
    let position = parse_fen_to_position(fen)?;
    let castling_mode = detect_castling_mode(&position);
    let mut moves = position
        .legal_moves()
        .iter()
        .map(|mv| {
            let san = SanPlus::from_move(position.clone(), mv).to_string();
            let uci = UciMove::from_move(mv, castling_mode).to_string();
            format!("{san} ({uci})")
        })
        .collect::<Vec<_>>();
    moves.sort();

    if moves.is_empty() {
        Ok("No legal moves".to_string())
    } else {
        Ok(moves.join(", "))
    }
}

fn infer_default_chess_fact_tool_calls(
    request: &AiCoachRequest,
    reference_context: &[CoachReferenceContext],
) -> Vec<ChessFactToolCall> {
    let mut calls = vec![ChessFactToolCall::PositionFacts {
        fen: request.fen.clone(),
        label: "Current position baseline".to_string(),
        reason: "Required baseline before making factual claims about the current position."
            .to_string(),
    }];

    let mut fact_text = request.question.clone();
    for message in request.chat_history.iter().rev().take(3) {
        fact_text.push('\n');
        fact_text.push_str(&message.content);
    }
    for item in reference_context.iter().rev().take(8) {
        fact_text.push('\n');
        fact_text.push_str(&item.label);
        fact_text.push('\n');
        fact_text.push_str(&item.detail);
    }

    for square in extract_square_mentions(&fact_text).into_iter().take(6) {
        calls.push(ChessFactToolCall::SquareFacts {
            fen: request.fen.clone(),
            square: square.clone(),
            label: format!("Current square {square}"),
            reason: format!(
                "The latest coach context mentions {square}; verify occupancy, attackers, and defenders before any factual claim."
            ),
        });
    }

    if let Ok(legal_mentions) =
        legal_root_move_mentions(&request.fen, &extract_move_candidates(&request.question))
    {
        for (_, san) in legal_mentions.into_iter().take(3) {
            calls.push(ChessFactToolCall::MoveFacts {
                fen: request.fen.clone(),
                mv: san.clone(),
                label: format!("Current move {san}"),
                reason: format!(
                    "The user mentions {san}; verify legality, resulting board state, and threats before explaining it."
                ),
            });
        }
    }

    calls
}

fn should_plan_extra_chess_fact_calls(
    request: &AiCoachRequest,
    reference_context: &[CoachReferenceContext],
) -> bool {
    let question = request.question.to_ascii_lowercase();
    let asks_for_whole_game_or_phase = request.pgn_scope.trim() == "whole_game"
        || question_focus_phase(&request.question).is_some();
    let has_concrete_reference = !extract_square_mentions(&request.question).is_empty()
        || !extract_move_candidates(&request.question).is_empty()
        || !reference_context.is_empty();
    let asks_for_tactical_truth = [
        "legal",
        "illegal",
        "can i",
        "can't",
        "cannot",
        "take",
        "takes",
        "capture",
        "recapture",
        "sac",
        "sacrifice",
        "defended",
        "undefended",
        "loose",
        "hanging",
        "attacked",
        "attacker",
        "threat",
        "pin",
        "pinned",
        "fork",
        "skewer",
        "x-ray",
        "xray",
        "trapped",
        "overloaded",
        "checkmate",
        "mate",
        "tactic",
        "tactical",
        "what if",
        "work",
        "fails",
        "refute",
    ]
    .iter()
    .any(|term| question.contains(term));

    if asks_for_whole_game_or_phase && !has_concrete_reference {
        return false;
    }

    asks_for_tactical_truth
        || (has_concrete_reference && question_asks_for_conversational_follow_up(&request.question))
}

fn execute_chess_fact_tool_calls(
    coach_request: &AiCoachRequest,
    reference_context: &[CoachReferenceContext],
    calls: Vec<ChessFactToolCall>,
) -> (Vec<CoachChessFactResult>, Vec<String>) {
    let mut results = Vec::new();
    let mut rejected = Vec::new();
    let mut seen = HashSet::new();

    for call in calls {
        if results.len() >= MAX_CHESS_FACT_TOOL_CALLS {
            rejected.push(format!(
                "skipped {} because the chess fact tool limit was reached",
                call.describe()
            ));
            continue;
        }

        match chess_fact_tool_call_key(coach_request, reference_context, &call) {
            Ok(key) => {
                if !seen.insert(key) {
                    continue;
                }
            }
            Err(error) => {
                rejected.push(format!("{} ({error})", call.describe()));
                continue;
            }
        }

        match execute_chess_fact_tool_call(&call) {
            Ok(result) => results.push(result),
            Err(error) => rejected.push(format!("{} ({error})", call.describe())),
        }
    }

    (results, rejected)
}

fn chess_fact_tool_call_key(
    coach_request: &AiCoachRequest,
    reference_context: &[CoachReferenceContext],
    call: &ChessFactToolCall,
) -> Result<String, CoachError> {
    match call {
        ChessFactToolCall::PositionFacts { fen, .. } => {
            validate_chess_fact_anchor_fen(coach_request, reference_context, fen)?;
            Ok(format!("position_facts:{}", fen.trim()))
        }
        ChessFactToolCall::LegalMoves { fen, .. } => {
            validate_chess_fact_anchor_fen(coach_request, reference_context, fen)?;
            Ok(format!("legal_moves:{}", fen.trim()))
        }
        ChessFactToolCall::SquareFacts { fen, square, .. } => {
            validate_chess_fact_anchor_fen(coach_request, reference_context, fen)?;
            let square = parse_square_name(square)?;
            Ok(format!("square_facts:{}:{square}", fen.trim()))
        }
        ChessFactToolCall::MoveFacts { fen, mv, .. } => {
            validate_chess_fact_anchor_fen(coach_request, reference_context, fen)?;
            let (uci, _) = parse_single_move(fen, mv)?;
            Ok(format!("move_facts:{}:{uci}", fen.trim()))
        }
        ChessFactToolCall::LineFacts { fen, line, .. } => {
            validate_chess_fact_anchor_fen(coach_request, reference_context, fen)?;
            let moves = parse_line_moves(fen, line)?;
            Ok(format!("line_facts:{}:{}", fen.trim(), moves.join(",")))
        }
    }
}

fn validate_chess_fact_anchor_fen(
    coach_request: &AiCoachRequest,
    reference_context: &[CoachReferenceContext],
    requested_fen: &str,
) -> Result<(), CoachError> {
    let requested_fen = requested_fen.trim();
    if requested_fen.is_empty() {
        return Err(CoachError::IllegalChessFactToolCall(
            "fact tools require a FEN".to_string(),
        ));
    }
    let _ = parse_fen_to_position(requested_fen)?;

    if requested_fen == coach_request.fen.trim()
        || is_reference_fen(reference_context, requested_fen)
        || is_allowed_chess_fact_fen(coach_request, requested_fen)
    {
        return Ok(());
    }

    Err(CoachError::IllegalChessFactToolCall(
        "chess fact calls must use the current FEN, an exact supplied reference FEN, or an exact FEN already supplied in game/engine evidence"
            .to_string(),
    ))
}

fn is_allowed_chess_fact_fen(coach_request: &AiCoachRequest, requested_fen: &str) -> bool {
    coach_request.game_analysis.iter().any(|point| {
        point.fen.trim() == requested_fen
            || point
                .before_fen
                .as_deref()
                .map(str::trim)
                .is_some_and(|fen| fen == requested_fen)
    }) || coach_request.prior_targeted_results.iter().any(|result| {
        result.fen.trim() == requested_fen
            || fen_after_uci_moves(&result.fen, &result.moves)
                .as_deref()
                .map(str::trim)
                .is_some_and(|fen| fen == requested_fen)
    })
}

fn execute_chess_fact_tool_call(
    call: &ChessFactToolCall,
) -> Result<CoachChessFactResult, CoachError> {
    match call {
        ChessFactToolCall::PositionFacts { fen, label, reason } => {
            let position = parse_fen_to_position(fen)?;
            let summary = summarize_position_facts(&position);
            Ok(CoachChessFactResult {
                tool: "position_facts".to_string(),
                label: fact_label(label, "Current position facts"),
                reason: reason.clone(),
                fen: fen.trim().to_string(),
                summary,
                facts: position_facts_json(&position),
            })
        }
        ChessFactToolCall::LegalMoves { fen, label, reason } => {
            let position = parse_fen_to_position(fen)?;
            let moves = legal_move_labels(&position);
            let summary = if moves.is_empty() {
                "No legal moves.".to_string()
            } else {
                format!("{} legal move(s): {}", moves.len(), moves.join(", "))
            };
            Ok(CoachChessFactResult {
                tool: "legal_moves".to_string(),
                label: fact_label(label, "Legal moves"),
                reason: reason.clone(),
                fen: fen.trim().to_string(),
                summary,
                facts: json!({
                    "sideToMove": color_label(position.turn()),
                    "legalMoves": moves,
                }),
            })
        }
        ChessFactToolCall::SquareFacts {
            fen,
            square,
            label,
            reason,
        } => {
            let position = parse_fen_to_position(fen)?;
            let square = parse_square_name(square)?;
            let (summary, facts) = square_fact_payload(&position, square);
            Ok(CoachChessFactResult {
                tool: "square_facts".to_string(),
                label: fact_label(label, &format!("Square {square}")),
                reason: reason.clone(),
                fen: fen.trim().to_string(),
                summary,
                facts,
            })
        }
        ChessFactToolCall::MoveFacts {
            fen,
            mv,
            label,
            reason,
        } => {
            let position = parse_fen_to_position(fen)?;
            let (summary, facts) = move_fact_payload(&position, fen, mv)?;
            Ok(CoachChessFactResult {
                tool: "move_facts".to_string(),
                label: fact_label(label, &format!("Move {mv}")),
                reason: reason.clone(),
                fen: fen.trim().to_string(),
                summary,
                facts,
            })
        }
        ChessFactToolCall::LineFacts {
            fen,
            line,
            label,
            reason,
        } => {
            let (summary, facts) = line_fact_payload(fen, line)?;
            Ok(CoachChessFactResult {
                tool: "line_facts".to_string(),
                label: fact_label(label, "Concrete line"),
                reason: reason.clone(),
                fen: fen.trim().to_string(),
                summary,
                facts,
            })
        }
    }
}

fn summarize_position_facts(position: &Chess) -> String {
    let captures = legal_capture_labels(position);
    let checkers = bitboard_piece_entries(position, position.checkers());
    let status = if position.is_checkmate() {
        "checkmate"
    } else if position.is_stalemate() {
        "stalemate"
    } else if position.is_check() {
        "check"
    } else {
        "not check"
    };

    format!(
        "Side to move: {}. Status: {status}. Legal moves: {}. Checkers: {}. Legal captures for side to move: {}.",
        color_label(position.turn()),
        position.legal_moves().len(),
        list_or_none(&checkers),
        list_or_none(&captures)
    )
}

fn position_facts_json(position: &Chess) -> serde_json::Value {
    json!({
        "sideToMove": color_label(position.turn()),
        "status": {
            "check": position.is_check(),
            "checkmate": position.is_checkmate(),
            "stalemate": position.is_stalemate(),
            "checkers": bitboard_piece_entries(position, position.checkers()),
        },
        "legalMoveCount": position.legal_moves().len(),
        "legalMoves": legal_move_labels(position),
        "legalCaptures": legal_capture_labels(position),
    })
}

fn square_fact_payload(position: &Chess, square: Square) -> (String, serde_json::Value) {
    let piece = position.board().piece_at(square);
    let white_attackers = attack_square_entries(position, square, Color::White);
    let black_attackers = attack_square_entries(position, square, Color::Black);
    let (defenders, enemy_attackers, is_undefended) = if let Some(piece) = piece {
        let defenders = attack_square_entries(position, square, piece.color);
        let enemy_attackers = attack_square_entries(position, square, !piece.color);
        let is_undefended = piece.role != Role::King && defenders.is_empty();
        (defenders, enemy_attackers, Some(is_undefended))
    } else {
        (Vec::new(), Vec::new(), None)
    };
    let piece_label = piece.map(piece_label);

    let summary = if let Some(piece_label) = &piece_label {
        format!(
            "{square}: {piece_label}. Defenders: {}. Enemy attackers: {}. Attacked by White: {}. Attacked by Black: {}. Undefended: {}.",
            list_or_none(&defenders),
            list_or_none(&enemy_attackers),
            list_or_none(&white_attackers),
            list_or_none(&black_attackers),
            is_undefended.unwrap_or(false)
        )
    } else {
        format!(
            "{square}: empty. Attacked by White: {}. Attacked by Black: {}.",
            list_or_none(&white_attackers),
            list_or_none(&black_attackers)
        )
    };

    (
        summary,
        json!({
            "square": square.to_string(),
            "piece": piece_label,
            "attackedByWhite": white_attackers,
            "attackedByBlack": black_attackers,
            "defenders": defenders,
            "enemyAttackers": enemy_attackers,
            "isUndefended": is_undefended,
            "note": "Defenders are geometric board defenders; use move_facts or line_facts for legal tactic sequences."
        }),
    )
}

fn move_fact_payload(
    position: &Chess,
    fen: &str,
    requested_move: &str,
) -> Result<(String, serde_json::Value), CoachError> {
    let (mv, uci, san) = parse_move_without_play(position, requested_move)?;
    let side = position.turn();
    let moved_piece = Piece {
        color: side,
        role: mv.role(),
    };
    let from = mv.from().map(|square| square.to_string());
    let to = move_target_label(&mv);
    let capture = mv.capture().map(role_label).map(|role| role.to_string());
    let promotion = mv.promotion().map(role_label).map(|role| role.to_string());
    let mut after = position.clone();
    after.play_unchecked(&mv);
    let fen_after = Fen::from_position(after.clone(), EnPassantMode::Legal).to_string();
    let arrival_squares = move_arrival_squares(&mv);
    let attacked_after = arrival_squares
        .iter()
        .flat_map(|square| moved_piece_attack_targets(&after, *square, side))
        .collect::<Vec<_>>();
    let checked_king = bitboard_piece_entries(&after, after.checkers());

    let summary = format!(
        "{san} ({uci}) is legal for {} from this FEN. Moved piece: {}. From: {}. To: {to}. Capture: {}. Promotion: {}. Resulting FEN: {fen_after}. Opponent in check: {}. Checkmate: {}. Moved piece attacks after move: {}.",
        color_label(side),
        piece_label(moved_piece),
        from.as_deref().unwrap_or("drop/no origin"),
        capture.as_deref().unwrap_or("none"),
        promotion.as_deref().unwrap_or("none"),
        after.is_check(),
        after.is_checkmate(),
        list_or_none(&attacked_after)
    );

    Ok((
        summary,
        json!({
            "requestedMove": requested_move,
            "san": san,
            "uci": uci,
            "legal": true,
            "side": color_label(side),
            "movedPiece": piece_label(moved_piece),
            "from": from,
            "to": to,
            "capture": capture,
            "promotion": promotion,
            "isCastle": mv.is_castle(),
            "isEnPassant": mv.is_en_passant(),
            "fenBefore": fen.trim(),
            "fenAfter": fen_after,
            "afterStatus": {
                "check": after.is_check(),
                "checkmate": after.is_checkmate(),
                "stalemate": after.is_stalemate(),
                "checkers": checked_king,
            },
            "movedPieceAttacksAfterMove": attacked_after,
        }),
    ))
}

fn line_fact_payload(fen: &str, line: &str) -> Result<(String, serde_json::Value), CoachError> {
    let mut position = parse_fen_to_position(fen)?;
    let mut steps = Vec::new();
    let mut san_line = Vec::new();
    let mut uci_line = Vec::new();

    for token in tokenize_move_line(line) {
        let fen_before = Fen::from_position(position.clone(), EnPassantMode::Legal).to_string();
        let (mv, uci, san) = parse_move_without_play(&position, &token)?;
        let side = position.turn();
        position.play_unchecked(&mv);
        let fen_after = Fen::from_position(position.clone(), EnPassantMode::Legal).to_string();
        san_line.push(san.clone());
        uci_line.push(uci.clone());
        steps.push(json!({
            "requestedToken": token,
            "san": san,
            "uci": uci,
            "side": color_label(side),
            "fenBefore": fen_before,
            "fenAfter": fen_after,
            "check": position.is_check(),
            "checkmate": position.is_checkmate(),
            "stalemate": position.is_stalemate(),
        }));
    }

    if steps.is_empty() {
        return Err(CoachError::IllegalChessFactToolCall(
            "line_facts requires at least one legal move".to_string(),
        ));
    }

    let final_fen = Fen::from_position(position.clone(), EnPassantMode::Legal).to_string();
    let summary = format!(
        "Legal line of {} ply: {}. UCI: {}. Final FEN: {}. Final status: check {}, checkmate {}, stalemate {}.",
        steps.len(),
        san_line.join(" "),
        uci_line.join(" "),
        final_fen,
        position.is_check(),
        position.is_checkmate(),
        position.is_stalemate()
    );

    Ok((
        summary,
        json!({
            "requestedLine": line,
            "sanLine": san_line,
            "uciLine": uci_line,
            "initialFen": fen.trim(),
            "finalFen": final_fen,
            "finalStatus": {
                "check": position.is_check(),
                "checkmate": position.is_checkmate(),
                "stalemate": position.is_stalemate(),
            },
            "steps": steps,
        }),
    ))
}

fn format_chess_fact_results(results: &[CoachChessFactResult]) -> String {
    if results.is_empty() {
        return "None. The final answer must avoid unverified factual board-state claims."
            .to_string();
    }

    results
        .iter()
        .enumerate()
        .map(|(index, result)| {
            let facts = serde_json::to_string(&result.facts).unwrap_or_else(|_| "{}".to_string());
            format!(
                "Board fact {}: {}\nReason: {}\nFEN: {}\nSummary: {}\nStructured details: {}",
                index + 1,
                result.label,
                result.reason,
                result.fen,
                result.summary,
                facts
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn extract_square_mentions(text: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    text.split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter_map(|token| {
            let token = token.trim().to_ascii_lowercase();
            if token.len() != 2 {
                return None;
            }
            let bytes = token.as_bytes();
            if matches!(bytes[0], b'a'..=b'h') && matches!(bytes[1], b'1'..=b'8') {
                Some(token)
            } else {
                None
            }
        })
        .filter(|square| seen.insert(square.clone()))
        .collect()
}

fn parse_square_name(square: &str) -> Result<Square, CoachError> {
    let normalized = square.trim().to_ascii_lowercase();
    Square::from_ascii(normalized.as_bytes())
        .map_err(|_| CoachError::IllegalChessFactToolCall(format!("invalid square `{square}`")))
}

fn legal_move_labels(position: &Chess) -> Vec<String> {
    let castling_mode = detect_castling_mode(position);
    let mut moves = position
        .legal_moves()
        .iter()
        .map(|mv| {
            let san = SanPlus::from_move(position.clone(), mv).to_string();
            let uci = UciMove::from_move(mv, castling_mode).to_string();
            format!("{san} ({uci})")
        })
        .collect::<Vec<_>>();
    moves.sort();
    moves
}

fn legal_capture_labels(position: &Chess) -> Vec<String> {
    let castling_mode = detect_castling_mode(position);
    let mut captures = position
        .legal_moves()
        .iter()
        .filter(|mv| mv.is_capture())
        .map(|mv| {
            let san = SanPlus::from_move(position.clone(), mv).to_string();
            let uci = UciMove::from_move(mv, castling_mode).to_string();
            format!("{san} ({uci})")
        })
        .collect::<Vec<_>>();
    captures.sort();
    captures
}

fn piece_entries(position: &Chess) -> Vec<String> {
    bitboard_piece_entries(position, position.board().occupied())
}

fn bitboard_piece_entries(position: &Chess, bitboard: Bitboard) -> Vec<String> {
    let mut entries = bitboard
        .into_iter()
        .filter_map(|square| {
            position
                .board()
                .piece_at(square)
                .map(|piece| piece_square_label(square, piece))
        })
        .collect::<Vec<_>>();
    entries.sort();
    entries
}

fn attack_square_entries(position: &Chess, square: Square, color: Color) -> Vec<String> {
    let mut entries = position
        .board()
        .attacks_to(square, color, position.board().occupied())
        .into_iter()
        .filter_map(|from| {
            position
                .board()
                .piece_at(from)
                .map(|piece| piece_square_label(from, piece))
        })
        .collect::<Vec<_>>();
    entries.sort();
    entries
}

fn undefended_piece_entries(position: &Chess, color: Color) -> Vec<String> {
    let mut entries = position
        .board()
        .by_color(color)
        .into_iter()
        .filter_map(|square| {
            let piece = position.board().piece_at(square)?;
            if piece.role == Role::King {
                return None;
            }
            let defenders = attack_square_entries(position, square, color);
            defenders
                .is_empty()
                .then(|| piece_square_label(square, piece))
        })
        .collect::<Vec<_>>();
    entries.sort();
    entries
}

fn attacked_piece_entries(position: &Chess, color: Color) -> Vec<String> {
    let mut entries = position
        .board()
        .by_color(color)
        .into_iter()
        .filter_map(|square| {
            let piece = position.board().piece_at(square)?;
            if piece.role == Role::King {
                return None;
            }
            let attackers = attack_square_entries(position, square, !color);
            if attackers.is_empty() {
                return None;
            }
            let defenders = attack_square_entries(position, square, color);
            Some(format!(
                "{} attacked by {}; defenders: {}",
                piece_square_label(square, piece),
                attackers.join(", "),
                list_or_none(&defenders)
            ))
        })
        .collect::<Vec<_>>();
    entries.sort();
    entries
}

fn hanging_piece_entries(position: &Chess, color: Color) -> Vec<String> {
    let mut entries = position
        .board()
        .by_color(color)
        .into_iter()
        .filter_map(|square| {
            let piece = position.board().piece_at(square)?;
            if piece.role == Role::King {
                return None;
            }
            let attackers = attack_square_entries(position, square, !color);
            if attackers.is_empty() {
                return None;
            }
            let defenders = attack_square_entries(position, square, color);
            defenders.is_empty().then(|| {
                format!(
                    "{} attacked by {} with no listed defenders",
                    piece_square_label(square, piece),
                    attackers.join(", ")
                )
            })
        })
        .collect::<Vec<_>>();
    entries.sort();
    entries
}

fn moved_piece_attack_targets(position: &Chess, from: Square, moving_color: Color) -> Vec<String> {
    let mut entries = (position.board().attacks_from(from)
        & position.board().by_color(!moving_color))
    .into_iter()
    .filter_map(|target| {
        let piece = position.board().piece_at(target)?;
        let defenders = attack_square_entries(position, target, piece.color);
        Some(format!(
            "{} (defenders: {})",
            piece_square_label(target, piece),
            list_or_none(&defenders)
        ))
    })
    .collect::<Vec<_>>();
    entries.sort();
    entries
}

fn parse_move_without_play(
    position: &Chess,
    requested_move: &str,
) -> Result<(Move, String, String), CoachError> {
    let cleaned_move = clean_requested_move_for_parse(requested_move);
    let requested_move = cleaned_move.trim();
    if requested_move.is_empty() {
        return Err(CoachError::IllegalChessFactToolCall(
            "empty move requested".to_string(),
        ));
    }

    let mv = if let Ok(uci) = UciMove::from_ascii(requested_move.as_bytes()) {
        uci.to_move(position).map_err(|_| {
            CoachError::IllegalChessFactToolCall(format!("illegal move `{requested_move}`"))
        })?
    } else {
        let san: San = requested_move.parse().map_err(|_| {
            CoachError::IllegalChessFactToolCall(format!("could not parse move `{requested_move}`"))
        })?;
        san.to_move(position).map_err(|_| {
            CoachError::IllegalChessFactToolCall(format!("illegal move `{requested_move}`"))
        })?
    };

    let castling_mode = detect_castling_mode(position);
    let uci = UciMove::from_move(&mv, castling_mode).to_string();
    let san = SanPlus::from_move(position.clone(), &mv).to_string();
    Ok((mv, uci, san))
}

fn move_target_label(mv: &Move) -> String {
    match mv {
        Move::Castle { king, rook } => {
            if king < rook {
                "king-side castle".to_string()
            } else {
                "queen-side castle".to_string()
            }
        }
        _ => mv.to().to_string(),
    }
}

fn move_arrival_squares(mv: &Move) -> Vec<Square> {
    match mv {
        Move::Normal { to, .. } | Move::EnPassant { to, .. } | Move::Put { to, .. } => {
            vec![*to]
        }
        Move::Castle { .. } => Vec::new(),
    }
}

fn piece_square_label(square: Square, piece: Piece) -> String {
    format!("{square} {}", piece_label(piece))
}

fn piece_label(piece: Piece) -> String {
    format!("{} {}", color_label(piece.color), role_label(piece.role))
}

fn color_label(color: Color) -> &'static str {
    match color {
        Color::White => "white",
        Color::Black => "black",
    }
}

fn role_label(role: Role) -> &'static str {
    match role {
        Role::Pawn => "pawn",
        Role::Knight => "knight",
        Role::Bishop => "bishop",
        Role::Rook => "rook",
        Role::Queen => "queen",
        Role::King => "king",
    }
}

fn fact_label(label: &str, fallback: &str) -> String {
    let label = label.trim();
    if label.is_empty() {
        fallback.to_string()
    } else {
        label.to_string()
    }
}

fn list_or_none(values: &[String]) -> String {
    if values.is_empty() {
        "none".to_string()
    } else {
        values.join(", ")
    }
}

impl ChessFactToolCall {
    fn describe(&self) -> String {
        match self {
            ChessFactToolCall::PositionFacts { fen, .. } => {
                format!("position_facts for FEN {}", fen.trim())
            }
            ChessFactToolCall::LegalMoves { fen, .. } => {
                format!("legal_moves for FEN {}", fen.trim())
            }
            ChessFactToolCall::SquareFacts { fen, square, .. } => {
                format!("square_facts {square} for FEN {}", fen.trim())
            }
            ChessFactToolCall::MoveFacts { fen, mv, .. } => {
                format!("move_facts {mv} for FEN {}", fen.trim())
            }
            ChessFactToolCall::LineFacts { fen, line, .. } => {
                format!("line_facts {line} for FEN {}", fen.trim())
            }
        }
    }
}

fn format_correction_notes(notes: &[String]) -> String {
    if notes.is_empty() {
        return "None".to_string();
    }

    notes
        .iter()
        .enumerate()
        .map(|(index, note)| format!("{}. {}", index + 1, note))
        .collect::<Vec<_>>()
        .join("\n")
}

fn trim_prompt_text(value: &str) -> String {
    if value.len() <= MAX_PROMPT_PGN_CHARS {
        value.to_string()
    } else {
        let trimmed = value.chars().take(MAX_PROMPT_PGN_CHARS).collect::<String>();
        format!("{}\n...[PGN truncated for prompt size]...", trimmed)
    }
}

fn format_engine_lines(lines: &[CoachEngineLine]) -> String {
    format_engine_lines_from(lines, "current FEN", None)
}

fn format_engine_lines_from(
    lines: &[CoachEngineLine],
    origin: &str,
    start_fen: Option<&str>,
) -> String {
    if lines.is_empty() {
        return "None".to_string();
    }

    lines
        .iter()
        .map(|line| {
            let pv = if line.san_moves.is_empty() {
                line.uci_moves.join(" ")
            } else {
                line.san_moves.join(" ")
            };
            let material = start_fen
                .and_then(|fen| material_context_for_line(fen, &line.uci_moves))
                .map(|summary| format!(" Material: {summary}"))
                .unwrap_or_default();
            format!(
                "{}. eval {}, depth {}, full line from {}: {}{}",
                line.multipv, line.eval, line.depth, origin, pv, material
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_targeted_result(result: &CoachTargetedResult) -> String {
    let prefix_note = format_targeted_prefix_note(result);
    format!(
        "{} ({})\nFEN: {}\nMoves: {}\n{}\n{}",
        result.label,
        result.reason,
        result.fen,
        if result.moves.is_empty() {
            "None".to_string()
        } else {
            result.moves.join(" ")
        },
        prefix_note,
        format_engine_lines_from(&result.lines, "this result FEN", Some(&result.fen))
    )
}

fn format_targeted_prefix_note(result: &CoachTargetedResult) -> String {
    if result.moves.is_empty() {
        return "Evaluation note: no fixed prefix was supplied; each MultiPV line is a candidate from this FEN.".to_string();
    }

    let prefix_len = result.moves.len();
    let san_prefix = result
        .lines
        .first()
        .map(|line| {
            line.san_moves
                .iter()
                .take(prefix_len)
                .cloned()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| result.moves.join(" "));
    let verdict = result
        .lines
        .first()
        .map(|line| {
            format!(
                " Candidate verdict under best engine reply: eval {}, depth {}.",
                line.eval, line.depth
            )
        })
        .unwrap_or_default();

    format!(
        "Evaluation note: the fixed prefix is `{san_prefix}`.{verdict} Use line 1 as the evaluation of that requested move/line under best play. Lines 2+ are alternative continuations for the side to move after the prefix; do not quote their evals as the main evaluation of `{san_prefix}`."
    )
}

#[derive(Clone, Copy, Default)]
struct MaterialCount {
    queens: i32,
    rooks: i32,
    bishops: i32,
    knights: i32,
    pawns: i32,
}

impl MaterialCount {
    fn value(self) -> i32 {
        self.queens * 9 + self.rooks * 5 + self.bishops * 3 + self.knights * 3 + self.pawns
    }
}

fn material_context_for_line(start_fen: &str, uci_moves: &[String]) -> Option<String> {
    let start = material_summary_from_fen(start_fen)?;
    if uci_moves.is_empty() {
        return Some(format!("start/end {start}"));
    }

    let final_position = parse_fen_and_apply_moves(start_fen, uci_moves).ok()?;
    let final_fen = Fen::from_position(final_position, EnPassantMode::Legal).to_string();
    let end = material_summary_from_fen(&final_fen)?;
    Some(format!("start {start}; after PV {end}"))
}

fn material_summary_from_fen(fen: &str) -> Option<String> {
    let (white, black) = material_counts_from_fen(fen)?;
    Some(format!(
        "{} vs {}; {}",
        material_count_label("White", white),
        material_count_label("Black", black),
        material_balance_label(white, black)
    ))
}

fn material_counts_from_fen(fen: &str) -> Option<(MaterialCount, MaterialCount)> {
    let board = fen.split_whitespace().next()?;
    let mut white = MaterialCount::default();
    let mut black = MaterialCount::default();

    for piece in board.chars().filter(|piece| piece.is_ascii_alphabetic()) {
        let target = if piece.is_ascii_uppercase() {
            &mut white
        } else {
            &mut black
        };
        match piece.to_ascii_lowercase() {
            'q' => target.queens += 1,
            'r' => target.rooks += 1,
            'b' => target.bishops += 1,
            'n' => target.knights += 1,
            'p' => target.pawns += 1,
            'k' => {}
            _ => return None,
        }
    }

    Some((white, black))
}

fn material_count_label(side: &str, material: MaterialCount) -> String {
    format!(
        "{side} Q{} R{} B{} N{} P{}",
        material.queens, material.rooks, material.bishops, material.knights, material.pawns
    )
}

fn material_balance_label(white: MaterialCount, black: MaterialCount) -> String {
    let diff = white.value() - black.value();
    if diff == 0 {
        "material value equal".to_string()
    } else if diff > 0 {
        format!("White +{diff} by material value")
    } else {
        format!("Black +{} by material value", diff.abs())
    }
}

fn normalized_reference_context(request: &AiCoachRequest) -> Vec<CoachReferenceContext> {
    let mut seen = HashSet::new();
    request
        .reference_context
        .iter()
        .filter_map(|item| {
            let fen = item.fen.trim();
            if fen.is_empty() || parse_fen_to_position(fen).is_err() {
                return None;
            }
            let label = item.label.trim();
            let key = format!("{}:{fen}", item.ply);
            if !seen.insert(key) {
                return None;
            }
            Some(CoachReferenceContext {
                label: if label.is_empty() {
                    format!("Ply {}", item.ply)
                } else {
                    label.to_string()
                },
                fen: fen.to_string(),
                ply: item.ply,
                san_line: item
                    .san_line
                    .iter()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .take(80)
                    .collect(),
                source: item.source.trim().to_string(),
                detail: trim_chat_text(&item.detail),
            })
        })
        .take(MAX_REFERENCE_CONTEXT_ITEMS)
        .collect()
}

fn is_reference_fen(reference_context: &[CoachReferenceContext], requested_fen: &str) -> bool {
    let requested_fen = requested_fen.trim();
    reference_context
        .iter()
        .any(|item| item.fen.trim() == requested_fen)
}

fn format_reference_context(items: &[CoachReferenceContext]) -> String {
    if items.is_empty() {
        return "None".to_string();
    }

    items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let line = if item.san_line.is_empty() {
                "SAN line unavailable".to_string()
            } else {
                item.san_line.join(" ")
            };
            let source = item
                .source
                .trim()
                .is_empty()
                .then_some("reference")
                .unwrap_or_else(|| item.source.trim());
            let detail = item
                .detail
                .trim()
                .is_empty()
                .then(String::new)
                .unwrap_or_else(|| format!("\n  Detail: {}", item.detail.trim()));
            format!(
                "{}. {} ({source}, ply {})\n  FEN: {}\n  SAN up to reference: {}{}",
                index + 1,
                item.label,
                item.ply,
                item.fen,
                line,
                detail
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_chat_history(messages: &[CoachChatMessage]) -> String {
    if messages.is_empty() {
        return "None".to_string();
    }

    messages
        .iter()
        .rev()
        .take(10)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .filter_map(|message| {
            let role = match message.role.trim().to_ascii_lowercase().as_str() {
                "user" => "User",
                "assistant" => "Coach",
                _ => return None,
            };
            let content = trim_chat_text(&message.content);
            if content.is_empty() {
                None
            } else {
                Some(format!("{role}: {content}"))
            }
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn format_game_analysis(points: &[CoachGameAnalysisPoint]) -> String {
    if points.is_empty() {
        return "Unavailable or not requested for this question.".to_string();
    }

    format_game_analysis_points(points.iter().take(240))
}

fn format_game_analysis_for_request(request: &AiCoachRequest) -> String {
    let focused = select_question_referenced_game_moments(request);
    if focused.is_empty() {
        if let Some(phase) = question_focus_phase(&request.question) {
            let phase_points = select_phase_context_points(request, phase);
            if phase_points.is_empty() {
                return format!(
                    "{} review requested, but no stored analysis rows were available for that phase.",
                    phase.label()
                );
            }
            return format!(
                "Filtered to {} only for this question.\n{}",
                phase.label(),
                format_game_analysis_points(phase_points.into_iter())
            );
        }
        return format_game_analysis(&request.game_analysis);
    }

    let focus_plies = focused
        .iter()
        .map(|point| point.ply)
        .collect::<HashSet<_>>();
    let context_points = request
        .game_analysis
        .iter()
        .filter(|point| focus_plies.iter().any(|ply| point.ply.abs_diff(*ply) <= 2))
        .collect::<Vec<_>>();
    if context_points.is_empty() {
        return "Question names a game move, but no focused stored analysis rows were available."
            .to_string();
    }

    format!(
        "Filtered to the named move and immediate +/-2 ply context for this specific question.\n{}",
        format_game_analysis_points(context_points.into_iter())
    )
}

fn format_game_analysis_points<'a>(
    points: impl IntoIterator<Item = &'a CoachGameAnalysisPoint>,
) -> String {
    points
        .into_iter()
        .map(|point| {
            let eval = point.eval.as_deref().unwrap_or("no eval");
            let depth = point
                .depth
                .map(|value| format!("depth {value}"))
                .unwrap_or_else(|| "depth unknown".to_string());
            let played = point
                .played_uci
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!(", played UCI {value}"))
                .unwrap_or_default();
            let side = point
                .played_side
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!(", {value} to move before the move"))
                .unwrap_or_default();
            let before_fen = point
                .before_fen
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!(", before FEN {value}"))
                .unwrap_or_default();
            format!(
                "Ply {ply}: {mv}, {eval}, {depth}{played}{side}{before_fen}",
                ply = point.ply,
                mv = point.mv,
                eval = eval,
                depth = depth,
                played = played,
                side = side,
                before_fen = before_fen
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_critical_game_positions(request: &AiCoachRequest) -> String {
    let focused_moments = select_question_referenced_game_moments(request);
    let has_focus = !focused_moments.is_empty();
    if !has_focus {
        if let Some(phase) = question_focus_phase(&request.question) {
            return format_phase_game_positions(request, phase);
        }
    }
    let moments = if has_focus {
        focused_moments
    } else {
        select_whole_game_evidence_moments(request)
    };
    if moments.is_empty() {
        return "None selected.".to_string();
    }

    let rows = moments
        .into_iter()
        .map(|point| {
            let before_fen = point.before_fen.as_deref().unwrap_or("unknown");
            let played_uci = point
                .played_uci
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!(" ({value})"))
                .unwrap_or_default();
            let side = point
                .played_side
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("side to move");
            let eval = point.eval.as_deref().unwrap_or("no played-move eval");
            let evidence_kind = if critical_annotation_rank(&point.annotations).is_some() {
                "critical"
            } else {
                "representative"
            };
            format!(
                "Ply {ply}: {evidence_kind} evidence; {side} played {mv}{played_uci}, played-move eval {eval}. analyse_position FEN: {before_fen}",
                ply = point.ply,
                evidence_kind = evidence_kind,
                side = side,
                mv = point.mv,
                played_uci = played_uci,
                eval = eval,
                before_fen = before_fen
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    if has_focus {
        format!(
            "Question-referenced game position(s) matching the named move. Use these before unrelated critical moments.\n{rows}"
        )
    } else {
        rows
    }
}

fn format_phase_game_positions(request: &AiCoachRequest, phase: CoachQuestionPhase) -> String {
    let moments = select_phase_game_moments(request, phase);
    if moments.is_empty() {
        return format!(
            "{} review requested, but no before-move FEN anchors were available for that phase.",
            phase.label()
        );
    }

    let rows = moments
        .into_iter()
        .map(|point| {
            let before_fen = point.before_fen.as_deref().unwrap_or("unknown");
            let played_uci = point
                .played_uci
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!(" ({value})"))
                .unwrap_or_default();
            let side = point
                .played_side
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("side to move");
            let eval = point.eval.as_deref().unwrap_or("no played-move eval");
            format!(
                "Ply {ply}: {phase} candidate; {side} played {mv}{played_uci}, played-move eval {eval}. analyse_position FEN: {before_fen}",
                ply = point.ply,
                phase = phase.progress_label(),
                side = side,
                mv = point.mv,
                played_uci = played_uci,
                eval = eval,
                before_fen = before_fen
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "{} candidate positions for the latest question. Use these before-move FENs instead of unrelated phase mistakes.\n{rows}",
        phase.label()
    )
}

fn infer_whole_game_critical_stockfish_requests(
    request: &AiCoachRequest,
) -> Vec<StockfishFollowUpRequest> {
    if request.pgn_scope.trim() != "whole_game" {
        return Vec::new();
    }

    select_whole_game_evidence_moments(request)
        .into_iter()
        .flat_map(|point| {
            let before_fen = match point.before_fen.as_deref().map(str::trim) {
                Some(fen) if !fen.is_empty() => fen,
                _ => return Vec::new(),
            };
            let played_move = point
                .played_uci
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(point.mv.as_str())
                .trim();
            if before_fen.is_empty() {
                return Vec::new();
            }
            let side = point
                .played_side
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("the side to move");
            let critical = critical_annotation_rank(&point.annotations).is_some();
            let mut requests = Vec::new();
            if !played_move.is_empty() {
                requests.push(StockfishFollowUpRequest::AnalyseMove {
                    fen: before_fen.to_string(),
                    mv: played_move.to_string(),
                    reason: if critical {
                        format!(
                            "Whole-game review should show the concrete Stockfish refutation after {side} played {} at ply {}; include the forcing line that proves why the move was bad.",
                            point.mv, point.ply
                        )
                    } else {
                        format!(
                            "Whole-game review needs concrete engine evidence at representative ply {}; check how {side}'s actual move {} affected the position.",
                            point.ply, point.mv
                        )
                    },
                });
            }
            requests.push(StockfishFollowUpRequest::AnalysePosition {
                fen: before_fen.to_string(),
                label: if critical {
                    format!("Critical ply {} before {}", point.ply, point.mv)
                } else {
                    format!("Representative ply {} before {}", point.ply, point.mv)
                },
                reason: if critical {
                    format!(
                        "Whole-game review should explain what {side} should have played instead of {} at ply {}; ask Stockfish for the best move from the pre-move position, not just for the move that was played.",
                        point.mv, point.ply
                    )
                } else {
                    format!(
                        "Whole-game review needs a concrete best line at representative ply {} before {}; use it only if it helps answer the latest question.",
                        point.ply, point.mv
                    )
                },
            });
            requests
        })
        .collect()
}

fn infer_phase_stockfish_requests(
    request: &AiCoachRequest,
    phase: CoachQuestionPhase,
) -> Vec<StockfishFollowUpRequest> {
    if request.pgn_scope.trim() != "whole_game" && question_focus_phase(&request.question).is_none()
    {
        return Vec::new();
    }

    select_phase_game_moments(request, phase)
        .into_iter()
        .flat_map(|point| {
            let before_fen = match point.before_fen.as_deref().map(str::trim) {
                Some(fen) if !fen.is_empty() => fen,
                _ => return Vec::new(),
            };
            let played_move = point
                .played_uci
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(point.mv.as_str())
                .trim();
            let side = point
                .played_side
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("the side to move");
            let mut requests = Vec::new();
            if !played_move.is_empty() {
                requests.push(StockfishFollowUpRequest::AnalyseMove {
                    fen: before_fen.to_string(),
                    mv: played_move.to_string(),
                    reason: format!(
                        "The user asked about the {}. Check the move {} by {side} at ply {} and show how it affects the requested phase.",
                        phase.label(),
                        point.mv,
                        point.ply
                    ),
                });
            }
            requests.push(StockfishFollowUpRequest::AnalysePosition {
                fen: before_fen.to_string(),
                label: format!(
                    "{} ply {} before {}",
                    phase.label(),
                    point.ply,
                    point.mv
                ),
                reason: format!(
                    "The user asked about the {}. Find Stockfish's best continuation for {side} at ply {} before {}.",
                    phase.label(),
                    point.ply,
                    point.mv
                ),
            });
            requests
        })
        .collect()
}

fn infer_question_referenced_game_stockfish_requests(
    request: &AiCoachRequest,
) -> Vec<StockfishFollowUpRequest> {
    select_question_referenced_game_moments(request)
        .into_iter()
        .take(MAX_WHOLE_GAME_CRITICAL_REQUESTS)
        .flat_map(|point| {
            let before_fen = match point.before_fen.as_deref().map(str::trim) {
                Some(fen) if !fen.is_empty() => fen,
                _ => return Vec::new(),
            };
            let played_move = point
                .played_uci
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(point.mv.as_str())
                .trim();
            let side = point
                .played_side
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("the side to move");
            let mut requests = Vec::new();
            if !played_move.is_empty() {
                requests.push(StockfishFollowUpRequest::AnalyseMove {
                    fen: before_fen.to_string(),
                    mv: played_move.to_string(),
                    reason: format!(
                        "The user asked specifically about {} at ply {}; show the concrete Stockfish continuation after {side} played that move.",
                        point.mv, point.ply
                    ),
                });
            }
            requests.push(StockfishFollowUpRequest::AnalysePosition {
                fen: before_fen.to_string(),
                label: format!("Question focus before {}", point.mv),
                reason: format!(
                    "The user asked specifically about {} at ply {}; find what {side} should have played from the same pre-move position.",
                    point.mv, point.ply
                ),
            });
            requests
        })
        .collect()
}

fn merge_prioritized_stockfish_requests(
    coach_request: &AiCoachRequest,
    reference_context: &[CoachReferenceContext],
    prioritized: Vec<StockfishFollowUpRequest>,
    existing: Vec<StockfishFollowUpRequest>,
) -> Result<Vec<StockfishFollowUpRequest>, CoachError> {
    let mut merged = Vec::new();
    let mut seen = HashSet::new();

    for request in prioritized.into_iter().chain(existing) {
        let key = stockfish_request_key(coach_request, reference_context, &request)?;
        if seen.insert(key) {
            merged.push(request);
        }
    }

    Ok(merged)
}

fn filter_prior_targeted_results_for_question(
    request: &AiCoachRequest,
) -> Vec<CoachTargetedResult> {
    if question_asks_for_conversational_follow_up(&request.question) {
        let mut recent = request
            .prior_targeted_results
            .iter()
            .rev()
            .take(8)
            .cloned()
            .collect::<Vec<_>>();
        recent.reverse();
        return recent;
    }

    if let Some(phase) = question_focus_phase(&request.question) {
        return request
            .prior_targeted_results
            .iter()
            .filter(|result| targeted_result_matches_phase(request, *result, phase))
            .cloned()
            .collect();
    }

    request.prior_targeted_results.clone()
}

fn targeted_result_matches_phase(
    request: &AiCoachRequest,
    result: &CoachTargetedResult,
    phase: CoachQuestionPhase,
) -> bool {
    let label_reason = format!("{} {}", result.label, result.reason).to_ascii_lowercase();
    if phase_label_matches(&label_reason, phase_words(phase)) {
        return true;
    }

    select_phase_context_points(request, phase)
        .into_iter()
        .any(|point| {
            point
                .before_fen
                .as_deref()
                .map(|fen| fen.trim() == result.fen.trim())
                .unwrap_or(false)
                || point.fen.trim() == result.fen.trim()
        })
}

fn phase_words(phase: CoachQuestionPhase) -> Vec<&'static str> {
    match phase {
        CoachQuestionPhase::Opening => vec!["opening", "early"],
        CoachQuestionPhase::Middlegame => vec!["middlegame", "middle-game", "middle game"],
        CoachQuestionPhase::EndgameConversion => {
            vec![
                "conversion",
                "endgame",
                "technique",
                "late-game",
                "late game",
            ]
        }
    }
}

fn phase_label_matches(label_reason: &str, words: Vec<&str>) -> bool {
    words.into_iter().any(|word| label_reason.contains(word))
}

fn select_phase_context_points(
    request: &AiCoachRequest,
    phase: CoachQuestionPhase,
) -> Vec<&CoachGameAnalysisPoint> {
    request
        .game_analysis
        .iter()
        .filter(|point| point_belongs_to_phase(request, point, phase))
        .collect()
}

fn point_belongs_to_phase(
    request: &AiCoachRequest,
    point: &CoachGameAnalysisPoint,
    phase: CoachQuestionPhase,
) -> bool {
    match phase {
        CoachQuestionPhase::Opening => point.ply <= OPENING_PHASE_MAX_PLY,
        CoachQuestionPhase::Middlegame => {
            point.ply > OPENING_PHASE_MAX_PLY && point.ply < conversion_phase_start_ply(request)
        }
        CoachQuestionPhase::EndgameConversion => point.ply >= conversion_phase_start_ply(request),
    }
}

fn conversion_phase_start_ply(request: &AiCoachRequest) -> u32 {
    let max_ply = request
        .game_analysis
        .iter()
        .map(|point| point.ply)
        .max()
        .unwrap_or(0);
    if max_ply == 0 {
        return OPENING_PHASE_MAX_PLY + 1;
    }

    let late_window_start = max_ply.saturating_sub(CONVERSION_PHASE_WINDOW_PLIES).max(1);
    late_window_start.max(OPENING_PHASE_MAX_PLY + 1)
}

fn select_phase_game_moments(
    request: &AiCoachRequest,
    phase: CoachQuestionPhase,
) -> Vec<&CoachGameAnalysisPoint> {
    let requested_side = requested_side_from_question(&request.question);
    let mut phase_points = request
        .game_analysis
        .iter()
        .filter(|point| point_belongs_to_phase(request, point, phase))
        .filter(|point| {
            point
                .before_fen
                .as_deref()
                .map(|fen| !fen.trim().is_empty())
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    phase_points.sort_by_key(|point| point.ply);

    if let Some(side) = requested_side {
        let side_points = phase_points
            .iter()
            .copied()
            .filter(|point| {
                point
                    .played_side
                    .as_deref()
                    .map(|played_side| played_side.eq_ignore_ascii_case(side))
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        if !side_points.is_empty() {
            return pick_representative_moments(side_points);
        }
    }

    pick_representative_moments(phase_points)
}

fn pick_representative_moments(
    points: Vec<&CoachGameAnalysisPoint>,
) -> Vec<&CoachGameAnalysisPoint> {
    match points.len() {
        0..=3 => points,
        len => vec![points[0], points[len / 2], points[len - 1]],
    }
}

fn requested_side_from_question(question: &str) -> Option<&'static str> {
    let lower = question.to_ascii_lowercase();
    if lower.contains("black") {
        Some("black")
    } else if lower.contains("white") {
        Some("white")
    } else {
        None
    }
}

fn select_critical_game_moments_any_scope(
    request: &AiCoachRequest,
) -> Vec<&CoachGameAnalysisPoint> {
    let mut moments = request
        .game_analysis
        .iter()
        .filter(|point| {
            point
                .before_fen
                .as_deref()
                .map(|fen| !fen.trim().is_empty())
                .unwrap_or(false)
        })
        .filter_map(|point| critical_annotation_rank(&point.annotations).map(|rank| (rank, point)))
        .collect::<Vec<_>>();

    moments.sort_by(|(left_rank, left), (right_rank, right)| {
        left_rank
            .cmp(right_rank)
            .then_with(|| left.ply.cmp(&right.ply))
    });

    moments
        .into_iter()
        .take(MAX_WHOLE_GAME_CRITICAL_REQUESTS)
        .map(|(_, point)| point)
        .collect()
}

fn select_whole_game_evidence_moments(request: &AiCoachRequest) -> Vec<&CoachGameAnalysisPoint> {
    let critical = select_critical_game_moments_any_scope(request);
    if !critical.is_empty() {
        return critical;
    }

    let mut moments = request
        .game_analysis
        .iter()
        .filter(|point| {
            point
                .before_fen
                .as_deref()
                .map(|fen| !fen.trim().is_empty())
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    moments.sort_by_key(|point| point.ply);
    pick_representative_moments(moments)
}

fn select_question_referenced_game_moments(
    request: &AiCoachRequest,
) -> Vec<&CoachGameAnalysisPoint> {
    let candidates = extract_move_candidates(&request.question)
        .into_iter()
        .map(|candidate| normalize_move_reference(&candidate))
        .collect::<HashSet<_>>();
    if candidates.is_empty() {
        return Vec::new();
    }

    let mut moments = request
        .game_analysis
        .iter()
        .filter(|point| {
            point
                .before_fen
                .as_deref()
                .map(|fen| !fen.trim().is_empty())
                .unwrap_or(false)
        })
        .filter(|point| game_analysis_point_matches_move_candidates(point, &candidates))
        .collect::<Vec<_>>();
    moments.sort_by_key(|point| point.ply);
    moments
}

fn game_analysis_point_matches_move_candidates(
    point: &CoachGameAnalysisPoint,
    candidates: &HashSet<String>,
) -> bool {
    let san = normalize_move_reference(&point.mv);
    if !san.is_empty() && candidates.contains(&san) {
        return true;
    }

    point
        .played_uci
        .as_deref()
        .map(normalize_move_reference)
        .map(|uci| !uci.is_empty() && candidates.contains(&uci))
        .unwrap_or(false)
}

fn format_question_focus_and_intent(request: &AiCoachRequest) -> String {
    let intent = infer_question_intent(&request.question);
    if let Some(phase) = question_focus_phase(&request.question) {
        let phase_points = select_phase_context_points(request, phase);
        let first_ply = phase_points.first().map(|point| point.ply).unwrap_or(0);
        let last_ply = phase_points.last().map(|point| point.ply).unwrap_or(0);
        let side = requested_side_from_question(&request.question)
            .map(|side| format!("{side}'s "))
            .unwrap_or_default();
        return format!(
            "Inferred intent: {intent}. This is a {side}{} review of the loaded game. Focus on the concrete game decisions in this phase{} and use focused Stockfish for those positions before any unrelated evidence. Treat other phases as background only unless the latest question explicitly asks to connect them.",
            phase.label(),
            if first_ply > 0 {
                format!(" (available plies {first_ply}-{last_ply})")
            } else {
                String::new()
            }
        );
    }

    if question_asks_for_conversational_follow_up(&request.question) {
        let recent_targeted = request.prior_targeted_results.len().min(8);
        return format!(
            "Inferred intent: {intent}. This is a conversational follow-up to a previously discussed line/sequence. Use the most recent targeted Stockfish results and coach-discussion reference FENs before any PGN-wide evidence. Recent targeted results available: {recent_targeted}. Do not restart a whole-game review, do not list fresh critical moments, and answer the referenced sequence directly."
        );
    }

    let candidates = extract_move_candidates(&request.question);
    if candidates.is_empty() {
        return format!(
            "Inferred intent: {intent}. No explicit named move focus detected. Answer the requested task directly instead of drifting into a generic review."
        );
    }

    let named_moves = candidates.join(", ");
    let matched = select_question_referenced_game_moments(request)
        .into_iter()
        .map(|point| {
            let side = point
                .played_side
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("side to move");
            let eval = point.eval.as_deref().unwrap_or("no stored eval");
            format!(
                "ply {ply}: {side} played {mv}, stored eval {eval}",
                ply = point.ply,
                side = side,
                mv = point.mv,
                eval = eval
            )
        })
        .collect::<Vec<_>>();
    let matched_text = if matched.is_empty() {
        "No matching loaded-game move was found; treat the named move(s) as current-position candidates or conversation references if legal."
            .to_string()
    } else {
        format!("Matched loaded-game move(s): {}.", matched.join("; "))
    };

    format!(
        "Inferred intent: {intent}. The user named: {named_moves}. {matched_text} Answer this specific question first. Do not give a broad critical-moments review. Discuss other moves only when they are direct alternatives from the same position, direct continuations/refutations after the named move, or necessary causal context for that named move."
    )
}

fn infer_question_intent(question: &str) -> &'static str {
    if let Some(phase) = question_focus_phase(question) {
        return match phase {
            CoachQuestionPhase::Opening => "examine the opening phase of the loaded game",
            CoachQuestionPhase::Middlegame => "examine the middlegame phase of the loaded game",
            CoachQuestionPhase::EndgameConversion => {
                "examine the conversion phase and endgame technique of the loaded game"
            }
        };
    }

    if question_asks_for_conversational_follow_up(question) {
        return "explain the previously discussed line or sequence more clearly";
    }

    if question_asks_for_salvage(question) {
        return "find the best practical defensive resource or recovery plan from a difficult position";
    }

    let lower = question.to_ascii_lowercase();
    if has_compare_cue(question) {
        "compare the named choices and explain the practical difference"
    } else if lower.contains("why") {
        "explain why the named move, line, or plan works or fails"
    } else if lower.contains("what should")
        || lower.contains("what to play")
        || lower.contains("instead")
        || lower.contains("best move")
        || lower.contains("best")
    {
        "recommend what to play and justify it with concrete evidence"
    } else if lower.contains("plan")
        || lower.contains("idea")
        || lower.contains("aim")
        || lower.contains("strategy")
    {
        "explain the practical plan and priorities"
    } else {
        "answer the chess question directly from the supplied evidence"
    }
}

fn question_asks_for_opening_phase(question: &str) -> bool {
    question_focus_phase(question) == Some(CoachQuestionPhase::Opening)
}

fn question_asks_for_conversion_phase(question: &str) -> bool {
    question_focus_phase(question) == Some(CoachQuestionPhase::EndgameConversion)
}

fn question_focus_phase(question: &str) -> Option<CoachQuestionPhase> {
    let lower = question.to_ascii_lowercase();
    if (lower.contains("opening phase")
        || lower.contains("opening stage")
        || lower.contains("early opening")
        || lower.contains("opening of the game")
        || lower.contains("opening in this game")
        || lower.contains("opening from this game"))
        || (lower.contains("opening")
            && (lower.contains("examine")
                || lower.contains("analyse")
                || lower.contains("analyze")
                || lower.contains("review")
                || lower.contains("phase")
                || lower.contains("game")))
    {
        return Some(CoachQuestionPhase::Opening);
    }

    if lower.contains("middlegame")
        || lower.contains("middle game")
        || lower.contains("middle-game")
        || lower.contains("middlegame phase")
        || lower.contains("middle phase")
    {
        return Some(CoachQuestionPhase::Middlegame);
    }

    if lower.contains("conversion")
        || lower.contains("convert")
        || lower.contains("converted")
        || lower.contains("converting")
        || lower.contains("endgame phase")
        || lower.contains("endgame technique")
        || lower.contains("winning technique")
        || lower.contains("towards the end")
        || lower.contains("toward the end")
        || lower.contains("end of the game")
        || ((lower.contains("technique")
            || lower.contains("clean up")
            || lower.contains("finish the game")
            || lower.contains("closed it out")
            || lower.contains("close it out"))
            && (lower.contains("endgame")
                || lower.contains("winning")
                || lower.contains("advantage")
                || lower.contains("black")
                || lower.contains("white")))
    {
        return Some(CoachQuestionPhase::EndgameConversion);
    }

    None
}

fn question_asks_for_salvage(question: &str) -> bool {
    let lower = question.to_ascii_lowercase();
    lower.contains("hold")
        || lower.contains("held")
        || lower.contains("save")
        || lower.contains("survive")
        || lower.contains("recover")
        || lower.contains("defend")
        || lower.contains("defensive")
        || lower.contains("make the most")
        || lower.contains("bad situation")
        || lower.contains("after i played")
        || lower.contains("after playing")
}

fn question_explicitly_requests_whole_game(question: &str) -> bool {
    let lower = question.to_ascii_lowercase();
    lower.contains("whole game")
        || lower.contains("entire game")
        || lower.contains("full game")
        || (lower.contains("the game") || lower.contains("this game"))
            && (lower.contains("analyse")
                || lower.contains("analyze")
                || lower.contains("review")
                || lower.contains("annotate")
                || lower.contains("recap")
                || lower.contains("why did")
                || lower.contains("what went wrong"))
}

fn question_asks_for_conversational_follow_up(question: &str) -> bool {
    let lower = question.to_ascii_lowercase();
    if question_explicitly_requests_whole_game(question)
        || question_focus_phase(question).is_some()
        || has_compare_cue(question)
    {
        return false;
    }

    let has_deictic_reference = lower.contains("that ")
        || lower.contains("the line")
        || lower.contains("that line")
        || lower.contains("this line")
        || lower.contains("the sequence")
        || lower.contains("that sequence")
        || lower.contains("this sequence")
        || lower.contains("the variation")
        || lower.contains("that variation")
        || lower.contains("the continuation")
        || lower.contains("that continuation")
        || lower.contains("the thing")
        || lower.contains("we discussed")
        || lower.contains("you mentioned")
        || lower.contains("above")
        || lower.contains("earlier");

    let asks_for_more_explanation = lower.contains("explain")
        || lower.contains("better")
        || lower.contains("why")
        || lower.contains("how")
        || lower.contains("walk me through")
        || lower.contains("show me")
        || lower.contains("where i can")
        || lower.contains("where can i")
        || lower.contains("win a piece")
        || lower.contains("win a minor")
        || lower.contains("minor piece")
        || lower.contains("tactic")
        || lower.contains("sequence");

    has_deictic_reference && asks_for_more_explanation
}

fn normalize_move_reference(value: &str) -> String {
    let mut token = value.trim();
    while let Some(ch) = token.chars().next() {
        if ch.is_ascii_digit() || ch == '.' {
            token = &token[ch.len_utf8()..];
        } else {
            break;
        }
    }

    token
        .trim()
        .trim_matches(|ch: char| {
            ch == '"'
                || ch == '\''
                || ch == '`'
                || ch == '('
                || ch == ')'
                || ch == '['
                || ch == ']'
                || ch == '{'
                || ch == '}'
                || ch == ','
                || ch == ';'
                || ch == ':'
        })
        .trim_end_matches(|ch: char| ch == '?' || ch == '!' || ch == '+' || ch == '#')
        .replace('0', "O")
        .to_ascii_lowercase()
}

fn critical_annotation_rank(annotations: &[String]) -> Option<u8> {
    let mut best_rank = None;
    for annotation in annotations {
        let trimmed = annotation.trim();
        let lower = trimmed.to_ascii_lowercase();
        let rank = if trimmed == "??" || lower.contains("blunder") {
            Some(0)
        } else if trimmed == "?" || lower.contains("mistake") {
            Some(1)
        } else if trimmed == "?!" || lower.contains("dubious") || lower.contains("inaccuracy") {
            Some(2)
        } else {
            None
        };

        if let Some(rank) = rank {
            best_rank = Some(best_rank.map_or(rank, |current: u8| current.min(rank)));
        }
    }

    best_rank
}

fn trim_chat_text(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() <= MAX_CHAT_MESSAGE_CHARS {
        trimmed.to_string()
    } else {
        let text = trimmed
            .chars()
            .take(MAX_CHAT_MESSAGE_CHARS)
            .collect::<String>();
        format!("{text}\n...[message truncated]...")
    }
}

fn format_opening_context(context: Option<&CoachOpeningContext>, error: Option<&str>) -> String {
    let Some(context) = context else {
        return match error.map(str::trim).filter(|value| !value.is_empty()) {
            Some(error) => format!("Unavailable ({})", trim_chat_text(error)),
            None => "Unavailable".to_string(),
        };
    };

    if context.moves.is_empty() {
        return format!(
            "{} for FEN {}\nSide: {}\nFilters: {}\nTotal games: {}\nNo legal opening moves returned.",
            context.source, context.fen, context.side, context.filters, context.total_games
        );
    }

    let moves = context
        .moves
        .iter()
        .map(|line| {
            let engine = match (&line.engine_score, line.engine_cp_loss, line.engine_rank) {
                (Some(score), Some(loss), Some(rank)) => {
                    format!(", engine {score}, cp loss {loss}, engine rank {rank}")
                }
                (Some(score), None, Some(rank)) => {
                    format!(", engine {score}, engine rank {rank}")
                }
                (Some(score), _, None) => format!(", engine {score}"),
                _ => String::new(),
            };
            let database_strength = line
                .database_strength_pct
                .map(|value| format!(", practical score {:.1}%", value))
                .unwrap_or_default();
            let notes = if line.notes.is_empty() {
                String::new()
            } else {
                format!(", notes: {}", line.notes.join("; "))
            };
            format!(
                "- {san} ({uci}): {games} games, usage {usage:.1}%, W/D/L {white}/{draw}/{black}, {side_score:.1}% score for {side}, blended {blend}/100 ({label}){database_strength}{engine}{notes}",
                san = line.san,
                uci = line.uci,
                games = line.games,
                usage = line.usage_pct,
                white = line.white,
                draw = line.draw,
                black = line.black,
                side_score = line.side_score_pct,
                side = context.side,
                blend = line.blended_strength,
                label = line.blended_label,
                database_strength = database_strength,
                engine = engine,
                notes = notes
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "{} for FEN {}\nSide: {}\nFilters: {}\nTotal games: {}\nMoves:\n{}",
        context.source, context.fen, context.side, context.filters, context.total_games, moves
    )
}

fn parse_stockfish_request(answer: &str) -> Result<Option<StockfishFollowUpRequest>, CoachError> {
    let start_tag = "<stockfish_request>";
    let end_tag = "</stockfish_request>";
    let Some(start) = answer.find(start_tag) else {
        return Ok(None);
    };
    let after_start = start + start_tag.len();
    let Some(relative_end) = answer[after_start..].find(end_tag) else {
        return Err(CoachError::MalformedStockfishRequest(
            "missing </stockfish_request> closing tag".to_string(),
        ));
    };
    let json = answer[after_start..after_start + relative_end].trim();
    let after_end = after_start + relative_end + end_tag.len();
    if !answer[..start].trim().is_empty() || !answer[after_end..].trim().is_empty() {
        return Err(CoachError::MalformedStockfishRequest(
            "stockfish_request must be the only output when requesting more engine data"
                .to_string(),
        ));
    }
    let request = serde_json::from_str(json)
        .map_err(|error| CoachError::MalformedStockfishRequest(error.to_string()))?;
    Ok(Some(request))
}

fn validate_answer_line_blocks(
    current_fen: &str,
    answer: &str,
    stockfish_lines: &[CoachEngineLine],
    targeted_results: &[CoachTargetedResult],
) -> Result<(), CoachError> {
    let line_blocks = extract_answer_line_blocks(answer)?;
    if line_blocks.is_empty() {
        return Ok(());
    }

    let supported_lines =
        collect_supported_engine_lines(current_fen, stockfish_lines, targeted_results);
    if supported_lines.is_empty() {
        return Err(CoachError::GeminiUnsupportedLine(
            "answer included a <line> block but no Stockfish lines were supplied".to_string(),
        ));
    }

    for line in line_blocks {
        let requested_moves = parse_line_moves(current_fen, &line).map_err(|error| {
            CoachError::GeminiUnsupportedLine(format!(
                "`{line}` is not a legal full line from the current FEN ({error})"
            ))
        })?;
        let supported = supported_lines
            .iter()
            .any(|stockfish_line| is_move_prefix(&requested_moves, stockfish_line));
        if !supported {
            return Err(CoachError::GeminiUnsupportedLine(format!(
                "`{line}` was not supplied by Stockfish for the current FEN"
            )));
        }
    }

    Ok(())
}

fn finalize_answer_line_safety(
    app: &tauri::AppHandle,
    request_id: &str,
    started: Instant,
    current_fen: &str,
    answer: &str,
    stockfish_lines: &[CoachEngineLine],
    targeted_results: &[CoachTargetedResult],
) -> Result<String, CoachError> {
    let mut safe_answer = remove_stockfish_request_blocks(answer);
    if safe_answer.trim().is_empty() {
        safe_answer =
            "I could not produce a safe engine-backed answer for that question.".to_string();
    }

    if validate_answer_line_blocks(current_fen, &safe_answer, stockfish_lines, targeted_results)
        .is_ok()
    {
        return Ok(safe_answer);
    }

    if let Some(demoted) = demote_non_current_supported_line_blocks(
        current_fen,
        &safe_answer,
        stockfish_lines,
        targeted_results,
    )
    .ok()
    .flatten()
    {
        if validate_answer_line_blocks(current_fen, &demoted, stockfish_lines, targeted_results)
            .is_ok()
        {
            emit_coach_progress(
                app,
                request_id,
                started,
                "answer_final_demote",
                "Sanitized answer line wrappers",
                "Final validation demoted targeted Stockfish lines that are not clickable from the current FEN.",
                99.0,
                false,
            );
            return Ok(demoted);
        }
        safe_answer = demoted;
    }

    let stripped =
        strip_unsupported_line_blocks(current_fen, &safe_answer, stockfish_lines, targeted_results);
    if stripped != safe_answer {
        emit_coach_progress(
            app,
            request_id,
            started,
            "answer_final_strip",
            "Removed unsupported engine line",
            "A final answer still contained a line not backed by supplied current-FEN or targeted Stockfish data, so the app removed the unsafe line instead of showing an error.",
            99.0,
            false,
        );
    }

    validate_answer_line_blocks(current_fen, &stripped, stockfish_lines, targeted_results)?;
    Ok(stripped)
}

fn remove_stockfish_request_blocks(answer: &str) -> String {
    let start_tag = "<stockfish_request>";
    let end_tag = "</stockfish_request>";
    let mut output = String::with_capacity(answer.len());
    let mut cursor = 0;

    while let Some(relative_start) = answer[cursor..].find(start_tag) {
        let absolute_start = cursor + relative_start;
        output.push_str(&answer[cursor..absolute_start]);
        let block_start = absolute_start + start_tag.len();
        let Some(relative_end) = answer[block_start..].find(end_tag) else {
            cursor = answer.len();
            break;
        };
        cursor = block_start + relative_end + end_tag.len();
    }

    output.push_str(&answer[cursor..]);
    output
}

fn strip_unsupported_line_blocks(
    current_fen: &str,
    answer: &str,
    stockfish_lines: &[CoachEngineLine],
    targeted_results: &[CoachTargetedResult],
) -> String {
    let start_tag = "<line>";
    let end_tag = "</line>";
    let current_supported_lines =
        collect_supported_engine_lines(current_fen, stockfish_lines, targeted_results);
    let mut output = String::with_capacity(answer.len());
    let mut cursor = 0;

    while let Some(relative_start) = answer[cursor..].find(start_tag) {
        let absolute_start = cursor + relative_start;
        let block_start = absolute_start + start_tag.len();
        output.push_str(&answer[cursor..absolute_start]);

        let Some(relative_end) = answer[block_start..].find(end_tag) else {
            output.push_str("[unsupported engine line removed]");
            cursor = answer.len();
            break;
        };

        let block_end = block_start + relative_end;
        let after_end = block_end + end_tag.len();
        let block = answer[block_start..block_end].trim();

        if current_line_block_is_supported(current_fen, block, &current_supported_lines) {
            output.push_str(&answer[absolute_start..after_end]);
        } else if targeted_line_block_is_supported(block, targeted_results) {
            output.push_str(block);
        } else {
            output.push_str("[unsupported engine line removed]");
        }
        cursor = after_end;
    }

    output.push_str(&answer[cursor..]);
    output
}

fn demote_non_current_supported_line_blocks(
    current_fen: &str,
    answer: &str,
    stockfish_lines: &[CoachEngineLine],
    targeted_results: &[CoachTargetedResult],
) -> Result<Option<String>, CoachError> {
    let start_tag = "<line>";
    let end_tag = "</line>";
    let current_supported_lines =
        collect_supported_engine_lines(current_fen, stockfish_lines, targeted_results);
    let mut output = String::with_capacity(answer.len());
    let mut cursor = 0;
    let mut changed = false;

    while let Some(relative_start) = answer[cursor..].find(start_tag) {
        let absolute_start = cursor + relative_start;
        let block_start = absolute_start + start_tag.len();
        let Some(relative_end) = answer[block_start..].find(end_tag) else {
            return Err(CoachError::GeminiUnsupportedLine(
                "answer included <line> without a closing </line>".to_string(),
            ));
        };
        let block_end = block_start + relative_end;
        let after_end = block_end + end_tag.len();
        let block = answer[block_start..block_end].trim();

        output.push_str(&answer[cursor..absolute_start]);
        if current_line_block_is_supported(current_fen, block, &current_supported_lines) {
            output.push_str(&answer[absolute_start..after_end]);
        } else if targeted_line_block_is_supported(block, targeted_results) {
            output.push_str(block);
            changed = true;
        } else {
            validate_current_line_block(current_fen, block, &current_supported_lines)?;
        }
        cursor = after_end;
    }

    if !changed {
        return Ok(None);
    }

    output.push_str(&answer[cursor..]);
    Ok(Some(output))
}

fn current_line_block_is_supported(
    current_fen: &str,
    line: &str,
    supported_lines: &[Vec<String>],
) -> bool {
    validate_current_line_block(current_fen, line, supported_lines).is_ok()
}

fn validate_current_line_block(
    current_fen: &str,
    line: &str,
    supported_lines: &[Vec<String>],
) -> Result<(), CoachError> {
    if supported_lines.is_empty() {
        return Err(CoachError::GeminiUnsupportedLine(
            "answer included a <line> block but no Stockfish lines were supplied".to_string(),
        ));
    }

    let requested_moves = parse_line_moves(current_fen, line).map_err(|error| {
        CoachError::GeminiUnsupportedLine(format!(
            "`{line}` is not a legal full line from the current FEN ({error})"
        ))
    })?;
    let supported = supported_lines
        .iter()
        .any(|stockfish_line| is_move_prefix(&requested_moves, stockfish_line));
    if !supported {
        return Err(CoachError::GeminiUnsupportedLine(format!(
            "`{line}` was not supplied by Stockfish for the current FEN"
        )));
    }

    Ok(())
}

fn targeted_line_block_is_supported(line: &str, targeted_results: &[CoachTargetedResult]) -> bool {
    targeted_results
        .iter()
        .any(|result| targeted_result_supports_line_block(line, result))
}

fn targeted_result_supports_line_block(line: &str, result: &CoachTargetedResult) -> bool {
    if let Ok(requested_moves) = parse_line_moves(&result.fen, line) {
        if result
            .lines
            .iter()
            .any(|stockfish_line| is_move_prefix(&requested_moves, &stockfish_line.uci_moves))
        {
            return true;
        }
    }

    if result.moves.is_empty() {
        return false;
    }

    let Some(after_prefix_fen) = fen_after_uci_moves(&result.fen, &result.moves) else {
        return false;
    };
    let Ok(mut continuation) = parse_line_moves(&after_prefix_fen, line) else {
        return false;
    };
    let mut requested_moves = result.moves.clone();
    requested_moves.append(&mut continuation);

    result
        .lines
        .iter()
        .any(|stockfish_line| is_move_prefix(&requested_moves, &stockfish_line.uci_moves))
}

fn fen_after_uci_moves(fen: &str, moves: &[String]) -> Option<String> {
    let position = parse_fen_and_apply_moves(fen, moves).ok()?;
    Some(Fen::from_position(position, EnPassantMode::Legal).to_string())
}

fn extract_answer_line_blocks(answer: &str) -> Result<Vec<String>, CoachError> {
    let start_tag = "<line>";
    let end_tag = "</line>";
    let mut blocks = Vec::new();
    let mut cursor = 0;

    while let Some(relative_start) = answer[cursor..].find(start_tag) {
        let start = cursor + relative_start + start_tag.len();
        let Some(relative_end) = answer[start..].find(end_tag) else {
            return Err(CoachError::GeminiUnsupportedLine(
                "answer included <line> without a closing </line>".to_string(),
            ));
        };
        let end = start + relative_end;
        let block = answer[start..end].trim();
        if !block.is_empty() {
            blocks.push(block.to_string());
        }
        cursor = end + end_tag.len();
    }

    Ok(blocks)
}

fn collect_supported_engine_lines(
    current_fen: &str,
    stockfish_lines: &[CoachEngineLine],
    targeted_results: &[CoachTargetedResult],
) -> Vec<Vec<String>> {
    stockfish_lines
        .iter()
        .chain(
            targeted_results
                .iter()
                .filter(|result| result.fen.trim() == current_fen.trim())
                .flat_map(|result| result.lines.iter()),
        )
        .filter_map(|line| {
            if line.uci_moves.is_empty() {
                None
            } else {
                Some(line.uci_moves.clone())
            }
        })
        .collect()
}

fn is_move_prefix(candidate: &[String], stockfish_line: &[String]) -> bool {
    !candidate.is_empty()
        && candidate.len() <= stockfish_line.len()
        && candidate
            .iter()
            .zip(stockfish_line)
            .all(|(candidate_move, stockfish_move)| candidate_move == stockfish_move)
}

fn infer_question_stockfish_requests(
    fen: &str,
    question: &str,
) -> Result<Vec<StockfishFollowUpRequest>, CoachError> {
    let candidates = extract_move_candidates(question);
    let capture_reply_requests = infer_natural_capture_reply_requests(fen, question, &candidates)?;
    if !capture_reply_requests.is_empty() {
        return Ok(capture_reply_requests);
    }

    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let mut requests = Vec::new();
    let legal_root_moves = legal_root_move_mentions(fen, &candidates)?;
    if has_compare_cue(question) && legal_root_moves.len() >= 2 {
        requests.push(StockfishFollowUpRequest::CompareMoves {
            fen: fen.to_string(),
            moves: legal_root_moves
                .iter()
                .take(5)
                .map(|(_, san)| san.clone())
                .collect(),
            reason: "The user compared named candidate moves, so the coach needs Stockfish lines for each move before explaining the difference.".to_string(),
        });
        return Ok(requests);
    }

    if has_what_if_cue(question) {
        if let Some((_, san)) = legal_root_moves.first() {
            requests.push(StockfishFollowUpRequest::AnalyseMove {
                fen: fen.to_string(),
                mv: san.clone(),
                reason: "The user asked about a specific move, so the coach needs Stockfish's answer after that move.".to_string(),
            });
            return Ok(requests);
        }

        if candidates.len() >= 2 && parse_line_moves(fen, &candidates.join(" ")).is_ok() {
            requests.push(StockfishFollowUpRequest::AnalyseLine {
                fen: fen.to_string(),
                line: candidates.join(" "),
                reason: "The user asked about a concrete line, so the coach needs Stockfish's answer after that sequence.".to_string(),
            });
        }
    }

    Ok(requests)
}

fn infer_natural_capture_reply_requests(
    fen: &str,
    question: &str,
    candidates: &[String],
) -> Result<Vec<StockfishFollowUpRequest>, CoachError> {
    if !has_capture_reply_cue(question) {
        return Ok(Vec::new());
    }

    let root_position = parse_fen_to_position(fen)?;
    if let Some(reply_san) = matching_natural_capture_sans(&root_position, question)
        .into_iter()
        .next()
    {
        return Ok(vec![StockfishFollowUpRequest::AnalyseMove {
            fen: fen.to_string(),
            mv: reply_san,
            reason: "The user asked whether this natural capture works, so the coach needs Stockfish's continuation after the capture, not only the best alternative reply.".to_string(),
        }]);
    }

    for (_, first_san) in legal_root_move_mentions(fen, candidates)?
        .into_iter()
        .take(3)
    {
        let mut after_first = parse_fen_to_position(fen)?;
        let (_, first_san) = parse_move_in_position(&mut after_first, &first_san)?;
        if let Some(reply_san) = matching_natural_capture_sans(&after_first, question)
            .into_iter()
            .next()
        {
            return Ok(vec![StockfishFollowUpRequest::AnalyseLine {
                fen: fen.to_string(),
                line: format!("{first_san} {reply_san}"),
                reason: "The user asked whether the natural capture after the named move works, so the coach needs Stockfish's continuation after that exact reply, not only the best alternative reply.".to_string(),
            }]);
        }
    }

    Ok(Vec::new())
}

fn matching_natural_capture_sans(position: &Chess, question: &str) -> Vec<String> {
    let source_role = mentioned_capture_source_role(question);
    let target_role = mentioned_capture_target_role(question, source_role);
    let castling_mode = detect_castling_mode(position);
    let mut captures = position
        .legal_moves()
        .iter()
        .filter(|mv| mv.is_capture())
        .filter(|mv| source_role.map_or(true, |role| mv.role() == role))
        .filter(|mv| {
            target_role.map_or(true, |role| {
                mv.capture().is_some_and(|capture| capture == role)
            })
        })
        .map(|mv| {
            let san = SanPlus::from_move(position.clone(), mv).to_string();
            let uci = UciMove::from_move(mv, castling_mode).to_string();
            (san, uci)
        })
        .collect::<Vec<_>>();

    captures.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    captures.into_iter().map(|(san, _)| san).collect()
}

fn mentioned_capture_source_role(question: &str) -> Option<Role> {
    let roles = mentioned_roles_in_order(question);
    if roles.len() >= 2 {
        roles.first().map(|(_, role)| *role)
    } else {
        None
    }
}

fn mentioned_capture_target_role(question: &str, source_role: Option<Role>) -> Option<Role> {
    let roles = mentioned_roles_in_order(question);
    roles
        .iter()
        .rev()
        .map(|(_, role)| *role)
        .find(|role| Some(*role) != source_role)
        .or_else(|| {
            roles
                .first()
                .map(|(_, role)| *role)
                .filter(|_| source_role.is_none())
        })
}

fn mentioned_roles_in_order(text: &str) -> Vec<(usize, Role)> {
    text.split(|ch: char| !ch.is_ascii_alphabetic())
        .enumerate()
        .filter_map(|(index, token)| {
            let role = match token.to_ascii_lowercase().as_str() {
                "queen" | "queens" => Role::Queen,
                "rook" | "rooks" => Role::Rook,
                "bishop" | "bishops" => Role::Bishop,
                "knight" | "knights" => Role::Knight,
                "pawn" | "pawns" => Role::Pawn,
                "king" | "kings" => Role::King,
                _ => return None,
            };
            Some((index, role))
        })
        .collect()
}

fn legal_root_move_mentions(
    fen: &str,
    candidates: &[String],
) -> Result<Vec<(String, String)>, CoachError> {
    let _ = parse_fen_to_position(fen)?;
    let mut seen = HashSet::new();
    let mut legal_moves = Vec::new();

    for candidate in candidates {
        if let Ok((uci, san)) = parse_single_move(fen, candidate) {
            if seen.insert(uci.clone()) {
                legal_moves.push((uci, san));
            }
        }
    }

    Ok(legal_moves)
}

fn extract_move_candidates(question: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    question
        .split_whitespace()
        .filter_map(normalize_move_candidate)
        .filter(|candidate| seen.insert(candidate.clone()))
        .collect()
}

fn normalize_move_candidate(token: &str) -> Option<String> {
    let mut token = token
        .trim()
        .trim_matches(|ch: char| {
            ch == '"'
                || ch == '\''
                || ch == '`'
                || ch == '('
                || ch == ')'
                || ch == '['
                || ch == ']'
                || ch == '{'
                || ch == '}'
                || ch == ','
                || ch == ';'
                || ch == ':'
        })
        .trim_end_matches(|ch: char| ch == '?' || ch == '!' || ch == '.' || ch == ',')
        .to_string();

    if token.is_empty() {
        return None;
    }

    token = token.replace('0', "O");
    if token.eq_ignore_ascii_case("O-O") {
        return Some("O-O".to_string());
    }
    if token.eq_ignore_ascii_case("O-O-O") {
        return Some("O-O-O".to_string());
    }

    if !looks_like_move_candidate(&token) {
        return None;
    }

    Some(canonicalize_move_candidate_case(&token))
}

fn canonicalize_move_candidate_case(token: &str) -> String {
    let lower = token.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    if matches!(bytes.len(), 4 | 5)
        && matches!(bytes[0], b'a'..=b'h')
        && matches!(bytes[1], b'1'..=b'8')
        && matches!(bytes[2], b'a'..=b'h')
        && matches!(bytes[3], b'1'..=b'8')
    {
        return lower;
    }

    let mut previous = '\0';
    token
        .chars()
        .enumerate()
        .map(|(index, ch)| {
            let normalized = if index == 0
                && matches!(
                    ch,
                    'k' | 'q' | 'r' | 'b' | 'n' | 'K' | 'Q' | 'R' | 'B' | 'N'
                ) {
                ch.to_ascii_uppercase()
            } else if previous == '=' && matches!(ch, 'q' | 'r' | 'b' | 'n' | 'Q' | 'R' | 'B' | 'N')
            {
                ch.to_ascii_uppercase()
            } else if ch.is_ascii_alphabetic() {
                ch.to_ascii_lowercase()
            } else {
                ch
            };
            previous = normalized;
            normalized
        })
        .collect()
}

fn looks_like_move_candidate(token: &str) -> bool {
    let lower = token.to_ascii_lowercase();
    if lower == "o-o" || lower == "o-o-o" {
        return true;
    }

    let has_file = lower.chars().any(|ch| matches!(ch, 'a'..='h'));
    let has_rank = lower.chars().any(|ch| matches!(ch, '1'..='8'));
    if !has_file || !has_rank {
        return false;
    }

    if lower.len() == 2 {
        return matches!(lower.as_bytes()[0], b'a'..=b'h')
            && matches!(lower.as_bytes()[1], b'1'..=b'8');
    }

    matches!(
        lower.chars().next(),
        Some('a'..='h') | Some('k' | 'q' | 'r' | 'n')
    )
}

fn has_compare_cue(question: &str) -> bool {
    let question = question.to_ascii_lowercase();
    question.contains(" better ")
        || question.contains(" worse ")
        || question.contains(" than ")
        || question.contains(" instead")
        || question.contains(" vs ")
        || question.contains(" versus ")
        || question.contains(" compare")
}

fn has_what_if_cue(question: &str) -> bool {
    let question = question.to_ascii_lowercase();
    question.contains("what if")
        || question.contains("why")
        || question.contains("doesn't")
        || question.contains("doesnt")
        || question.contains("work")
        || question.contains("after")
        || question.contains("goes")
        || question.contains("play")
        || question.contains("can't")
        || question.contains("cannot")
        || question.contains("instead")
}

fn has_capture_reply_cue(question: &str) -> bool {
    let question = question.to_ascii_lowercase();
    (question.contains("take")
        || question.contains("takes")
        || question.contains("capture")
        || question.contains("captures")
        || question.contains("capturing")
        || question.contains("grab")
        || question.contains("grabs")
        || question.contains("win the")
        || question.contains("wins the"))
        && (question.contains("can't")
            || question.contains("cannot")
            || question.contains("can ")
            || question.contains("could")
            || question.contains("why")
            || question.contains("after")
            || question.contains("what if"))
}

fn describe_stockfish_request(request: &StockfishFollowUpRequest) -> String {
    match request {
        StockfishFollowUpRequest::AnalysePosition { label, reason, .. } => {
            let label = if label.trim().is_empty() {
                "position".to_string()
            } else {
                label.to_string()
            };
            format!("Analysing {label}. Reason: {reason}")
        }
        StockfishFollowUpRequest::AnalyseMove { mv, reason, .. } => {
            format!("Analysing move {mv}. Reason: {reason}")
        }
        StockfishFollowUpRequest::CompareMoves { moves, reason, .. } => {
            format!("Comparing moves {}. Reason: {reason}", moves.join(", "))
        }
        StockfishFollowUpRequest::AnalyseLine { line, reason, .. } => {
            format!("Analysing line {line}. Reason: {reason}")
        }
    }
}

async fn run_targeted_stockfish_request(
    engine_path: &Path,
    coach_request: &AiCoachRequest,
    reference_context: &[CoachReferenceContext],
    request: StockfishFollowUpRequest,
    multipv: u8,
    timeout_duration: Duration,
    progress: Option<CoachProgressContext<'_>>,
) -> Result<CoachTargetedResult, CoachError> {
    match request {
        StockfishFollowUpRequest::AnalysePosition { fen, label, reason } => {
            validate_stockfish_anchor_fen(coach_request, reference_context, &fen)?;
            let label = if label.trim().is_empty() {
                "Position analysis".to_string()
            } else {
                label
            };
            if let Some(progress) = progress {
                emit_coach_progress(
                    progress.app,
                    progress.request_id,
                    progress.started,
                    "targeted_analyse_position",
                    format!("Stockfish: {label}"),
                    "Searching the best moves from the listed position.",
                    progress.base_progress,
                    false,
                );
            }
            let lines = run_stockfish_analysis(
                engine_path,
                &fen,
                &[],
                multipv,
                DEFAULT_STOCKFISH_DEPTH,
                timeout_duration,
                &label,
            )
            .await?;
            Ok(CoachTargetedResult {
                request_type: "analyse_position".to_string(),
                reason,
                fen,
                moves: Vec::new(),
                label,
                lines,
            })
        }
        StockfishFollowUpRequest::AnalyseMove { fen, mv, reason } => {
            validate_stockfish_anchor_fen(coach_request, reference_context, &fen)?;
            let (uci, san) = parse_single_move(&fen, &mv)?;
            if let Some(progress) = progress {
                emit_coach_progress(
                    progress.app,
                    progress.request_id,
                    progress.started,
                    "targeted_analyse_move",
                    format!("Stockfish: {san}"),
                    format!("Searching best replies after {san}."),
                    progress.base_progress,
                    false,
                );
            }
            let lines = run_stockfish_analysis(
                engine_path,
                &fen,
                std::slice::from_ref(&uci),
                multipv,
                DEFAULT_STOCKFISH_DEPTH,
                timeout_duration,
                &format!("move {san}"),
            )
            .await?;
            let lines = prefix_engine_lines(
                lines,
                std::slice::from_ref(&uci),
                std::slice::from_ref(&san),
            );
            Ok(CoachTargetedResult {
                request_type: "analyse_move".to_string(),
                reason,
                fen,
                moves: vec![uci],
                label: format!("After {san}"),
                lines,
            })
        }
        StockfishFollowUpRequest::CompareMoves { fen, moves, reason } => {
            validate_stockfish_anchor_fen(coach_request, reference_context, &fen)?;
            if moves.is_empty() || moves.len() > 5 {
                return Err(CoachError::IllegalStockfishRequest(
                    "compare_moves requires 1 to 5 moves".to_string(),
                ));
            }
            let mut combined = Vec::new();
            let mut labels = Vec::new();
            let per_move_multipv = multipv.min(5);
            let move_count = moves.len().max(1);
            for (index, requested_move) in moves.into_iter().enumerate() {
                let (uci, san) = parse_single_move(&fen, &requested_move)?;
                if let Some(progress) = progress {
                    let step_progress =
                        progress.base_progress + (index as f32 / move_count as f32) * 10.0;
                    emit_coach_progress(
                        progress.app,
                        progress.request_id,
                        progress.started,
                        "targeted_compare_move",
                        format!("Stockfish compare: {san}"),
                        format!(
                            "Analysing candidate {} of {} with MultiPV {}.",
                            index + 1,
                            move_count,
                            per_move_multipv
                        ),
                        step_progress,
                        false,
                    );
                }
                let lines = run_stockfish_analysis(
                    engine_path,
                    &fen,
                    std::slice::from_ref(&uci),
                    per_move_multipv,
                    DEFAULT_STOCKFISH_DEPTH,
                    timeout_duration,
                    &format!("move {san}"),
                )
                .await?;
                let lines = prefix_engine_lines(
                    lines,
                    std::slice::from_ref(&uci),
                    std::slice::from_ref(&san),
                );
                labels.push(format!("{san} ({uci})"));
                combined.push(CoachTargetedResult {
                    request_type: "compare_moves".to_string(),
                    reason: reason.clone(),
                    fen: fen.clone(),
                    moves: vec![uci],
                    label: format!("After {san}"),
                    lines,
                });
            }
            let summary_lines = combined
                .iter()
                .flat_map(|result| {
                    result.lines.iter().map(|line| CoachEngineLine {
                        multipv: line.multipv,
                        depth: line.depth,
                        eval: format!("{}: {}", result.label, line.eval),
                        uci_moves: line.uci_moves.clone(),
                        san_moves: line.san_moves.clone(),
                    })
                })
                .collect();
            Ok(CoachTargetedResult {
                request_type: "compare_moves".to_string(),
                reason,
                fen,
                moves: labels,
                label: "Move comparison".to_string(),
                lines: summary_lines,
            })
        }
        StockfishFollowUpRequest::AnalyseLine { fen, line, reason } => {
            validate_stockfish_anchor_fen(coach_request, reference_context, &fen)?;
            let moves = parse_line_moves(&fen, &line)?;
            let san_moves = san_for_uci_line(&fen, &moves)?;
            if let Some(progress) = progress {
                emit_coach_progress(
                    progress.app,
                    progress.request_id,
                    progress.started,
                    "targeted_analyse_line",
                    "Stockfish: requested line",
                    format!("Searching best replies after {}.", san_moves.join(" ")),
                    progress.base_progress,
                    false,
                );
            }
            let lines = run_stockfish_analysis(
                engine_path,
                &fen,
                &moves,
                multipv,
                DEFAULT_STOCKFISH_DEPTH,
                timeout_duration,
                "requested line",
            )
            .await?;
            let lines = prefix_engine_lines(lines, &moves, &san_moves);
            let label = if san_moves.is_empty() {
                "After requested line".to_string()
            } else {
                format!("After {}", san_moves.join(" "))
            };
            Ok(CoachTargetedResult {
                request_type: "analyse_line".to_string(),
                reason,
                fen,
                moves,
                label,
                lines,
            })
        }
    }
}

fn prefix_engine_lines(
    lines: Vec<CoachEngineLine>,
    prefix_uci: &[String],
    prefix_san: &[String],
) -> Vec<CoachEngineLine> {
    lines
        .into_iter()
        .map(|line| {
            let CoachEngineLine {
                multipv,
                depth,
                eval,
                uci_moves: line_uci_moves,
                san_moves: line_san_moves,
            } = line;
            let mut uci_moves = prefix_uci.to_vec();
            uci_moves.extend(line_uci_moves);

            let mut san_moves = prefix_san.to_vec();
            san_moves.extend(line_san_moves);

            CoachEngineLine {
                multipv,
                depth,
                eval,
                uci_moves,
                san_moves,
            }
        })
        .collect()
}

fn validate_follow_up_fen(
    current_fen: &str,
    reference_context: &[CoachReferenceContext],
    requested_fen: &str,
) -> Result<(), CoachError> {
    if requested_fen.trim() == current_fen.trim() {
        return Ok(());
    }

    if is_reference_fen(reference_context, requested_fen) {
        return Ok(());
    }

    Err(CoachError::IllegalStockfishRequest(
        "Stockfish requests must use the current FEN or an exact supplied reference FEN; use analyse_line to inspect a later position"
            .to_string(),
    ))
}

fn parse_single_move(fen: &str, requested_move: &str) -> Result<(String, String), CoachError> {
    let mut position = parse_fen_to_position(fen)?;
    parse_move_in_position(&mut position, requested_move)
}

fn parse_line_moves(fen: &str, line: &str) -> Result<Vec<String>, CoachError> {
    let mut position = parse_fen_to_position(fen)?;
    let mut moves = Vec::new();
    for token in tokenize_move_line(line) {
        let (uci, _) = parse_move_in_position(&mut position, &token)?;
        moves.push(uci);
    }
    if moves.is_empty() {
        return Err(CoachError::IllegalStockfishRequest(
            "analyse_line did not contain any moves".to_string(),
        ));
    }
    Ok(moves)
}

fn san_for_uci_line(fen: &str, moves: &[String]) -> Result<Vec<String>, CoachError> {
    let mut position = parse_fen_to_position(fen)?;
    let mut san_moves = Vec::new();

    for uci in moves {
        let uci_move = UciMove::from_ascii(uci.as_bytes()).map_err(|_| {
            CoachError::IllegalStockfishRequest(format!("could not parse move `{uci}`"))
        })?;
        let mv = uci_move
            .to_move(&position)
            .map_err(|_| CoachError::IllegalStockfishRequest(format!("illegal move `{uci}`")))?;
        let san = SanPlus::from_move_and_play_unchecked(&mut position, &mv);
        san_moves.push(san.to_string());
    }

    Ok(san_moves)
}

fn tokenize_move_line(line: &str) -> Vec<String> {
    line.split_whitespace()
        .filter_map(|token| {
            let token = token
                .trim()
                .trim_matches(|ch: char| ch == '{' || ch == '}' || ch == '(' || ch == ')');
            if token.is_empty()
                || token == "*"
                || token == "1-0"
                || token == "0-1"
                || token == "1/2-1/2"
                || token.ends_with('.')
            {
                return None;
            }
            let token = token
                .trim_start_matches(|ch: char| ch.is_ascii_digit() || ch == '.')
                .trim();
            if token.is_empty() {
                None
            } else {
                Some(token.to_string())
            }
        })
        .collect()
}

fn parse_move_in_position(
    position: &mut shakmaty::Chess,
    requested_move: &str,
) -> Result<(String, String), CoachError> {
    let cleaned_move = clean_requested_move_for_parse(requested_move);
    let requested_move = cleaned_move.trim();
    if requested_move.is_empty() {
        return Err(CoachError::IllegalStockfishRequest(
            "empty move requested".to_string(),
        ));
    }

    let mv = if let Ok(uci) = UciMove::from_ascii(requested_move.as_bytes()) {
        uci.to_move(position).map_err(|_| {
            CoachError::IllegalStockfishRequest(format!("illegal move `{requested_move}`"))
        })?
    } else {
        let san: San = requested_move.parse().map_err(|_| {
            CoachError::IllegalStockfishRequest(format!("could not parse move `{requested_move}`"))
        })?;
        san.to_move(position).map_err(|_| {
            CoachError::IllegalStockfishRequest(format!("illegal move `{requested_move}`"))
        })?
    };

    let castling_mode = detect_castling_mode(position);
    let uci = UciMove::from_move(&mv, castling_mode).to_string();
    let san = SanPlus::from_move(position.clone(), &mv).to_string();
    position.play_unchecked(&mv);
    Ok((uci, san))
}

fn clean_requested_move_for_parse(requested_move: &str) -> String {
    let mut value = requested_move
        .trim()
        .trim_matches('`')
        .trim_matches(|ch: char| ch == ',' || ch == ';' || ch == ':' || ch == '(' || ch == ')')
        .to_string();

    while value
        .chars()
        .last()
        .map(|ch| ch == '?' || ch == '!')
        .unwrap_or(false)
    {
        value.pop();
    }

    value = value
        .trim_start_matches(|ch: char| ch.is_ascii_digit() || ch == '.')
        .trim()
        .to_string();

    value
}

fn detect_castling_mode(position: &shakmaty::Chess) -> CastlingMode {
    CastlingMode::detect(&position.clone().into_setup(EnPassantMode::Legal))
}

async fn run_stockfish_analysis(
    engine_path: &Path,
    fen: &str,
    moves: &[String],
    multipv: u8,
    depth: u32,
    timeout_duration: Duration,
    label: &str,
) -> Result<Vec<CoachEngineLine>, CoachError> {
    let _ = parse_fen_and_apply_moves(fen, moves)?;
    let multipv = multipv.clamp(1, 8);
    let mut engine = BaseEngine::spawn(engine_path.to_path_buf()).await?;
    engine.init_uci().await?;
    engine.set_option("MultiPV", multipv).await?;
    engine.set_position(fen, moves).await?;
    engine.go(&GoMode::Depth(depth)).await?;

    let lines = timeout(timeout_duration, async {
        let mut latest: HashMap<u16, CoachEngineLine> = HashMap::new();
        loop {
            let line = {
                let reader = engine.reader_mut().ok_or(Error::EngineDisconnected)?;
                reader.next_line().await?
            };
            let Some(line) = line else {
                return Err(CoachError::StockfishEmpty(label.to_string()));
            };
            engine.log_engine(&line);
            match parse_one(&line) {
                UciMessage::Info(attrs) => {
                    if let Ok(parsed) = parse_coach_uci_attrs(attrs, fen, moves) {
                        latest.insert(parsed.multipv, parsed);
                    }
                }
                UciMessage::BestMove { .. } => {
                    let mut result = latest.into_values().collect::<Vec<_>>();
                    result.sort_by_key(|line| line.multipv);
                    result.truncate(multipv as usize);
                    if result.is_empty() {
                        return Err(CoachError::StockfishEmpty(label.to_string()));
                    }
                    return Ok(result);
                }
                _ => {}
            }
        }
    })
    .await
    .map_err(|_| CoachError::StockfishTimeout(label.to_string()))??;

    let _ = engine.quit().await;
    Ok(lines)
}

fn parse_coach_uci_attrs(
    attrs: Vec<UciInfoAttribute>,
    fen: &str,
    moves: &[String],
) -> Result<CoachEngineLine, Error> {
    let mut pos = parse_fen_and_apply_moves(fen, moves)?;
    let turn = pos.turn();
    let mut depth = 0;
    let mut multipv = 1;
    let mut score = None;
    let mut san_moves = Vec::new();
    let mut uci_moves = Vec::new();

    for attr in attrs {
        match attr {
            UciInfoAttribute::Pv(pv) => {
                for mv in pv {
                    let uci: UciMove = mv.to_string().parse()?;
                    let m = uci.to_move(&pos)?;
                    let san = SanPlus::from_move_and_play_unchecked(&mut pos, &m);
                    san_moves.push(san.to_string());
                    uci_moves.push(uci.to_string());
                }
            }
            UciInfoAttribute::Depth(value) => depth = value,
            UciInfoAttribute::MultiPv(value) => multipv = value,
            UciInfoAttribute::Score(value) => score = Some(value),
            _ => {}
        }
    }

    if san_moves.is_empty() {
        return Err(Error::NoMovesFound);
    }

    let mut score = score.ok_or(Error::NoMovesFound)?;
    if score.lower_bound == Some(true) || score.upper_bound == Some(true) {
        return Err(Error::NoMovesFound);
    }
    if turn == Color::Black {
        score = invert_score(score);
    }

    Ok(CoachEngineLine {
        multipv,
        depth,
        eval: format_score(&score),
        uci_moves,
        san_moves,
    })
}

fn invert_score(score: Score) -> Score {
    let value = match score.value {
        ScoreValue::Cp(cp) => ScoreValue::Cp(-cp),
        ScoreValue::Mate(mate) => ScoreValue::Mate(-mate),
    };
    let wdl = score.wdl.map(|(w, d, l)| (l, d, w));
    Score {
        value,
        wdl,
        ..score
    }
}

fn format_score(score: &Score) -> String {
    match score.value {
        ScoreValue::Cp(cp) => {
            let pawns = (cp as f32 / 100.0).abs();
            if cp > 0 {
                format!("+{pawns:.2}")
            } else if cp < 0 {
                format!("-{pawns:.2}")
            } else {
                "0.00".to_string()
            }
        }
        ScoreValue::Mate(mate) => {
            if mate > 0 {
                format!("+M{mate}")
            } else if mate < 0 {
                format!("-M{}", mate.abs())
            } else {
                "M0".to_string()
            }
        }
    }
}

async fn run_gemini_cli(
    command: &str,
    model: &str,
    prompt: &str,
    timeout_secs: u64,
) -> Result<String, CoachError> {
    // Local personal-use bridge only: this assumes the user has authenticated
    // Gemini CLI on their own machine. Do not expose this command from a
    // public/server deployment or pass credentials through the app.
    let command = command.trim();
    if command.is_empty() {
        return Err(CoachError::GeminiMissing("empty command".to_string()));
    }

    let resolved_command = resolve_cli_command(command);

    let temp_dir = tempdir()?;
    let agy_log_path = temp_dir.path().join("agy.log");
    let is_agy = is_agy_command(command, &resolved_command);
    let mut command_builder = Command::new(&resolved_command);
    command_builder.current_dir(temp_dir.path());
    if is_agy {
        command_builder
            .arg("--log-file")
            .arg(&agy_log_path)
            .arg("--model")
            .arg(model)
            .arg("--print-timeout")
            .arg(format!("{timeout_secs}s"))
            .arg("--print")
            .arg("-");
    } else {
        command_builder
            .arg("--skip-trust")
            .arg("--approval-mode")
            .arg("plan")
            .arg("--output-format")
            .arg("text")
            .arg("--model")
            .arg(model)
            .arg("--prompt")
            .arg("Use the complete chess coaching request supplied on stdin.");
    }

    let mut child = command_builder
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                CoachError::GeminiMissing(format!(
                    "{} (resolved to {})",
                    command,
                    resolved_command.display()
                ))
            } else {
                CoachError::Io(error)
            }
        })?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes()).await?;
    }

    let mut stdout = child.stdout.take().ok_or(Error::NoStdout)?;
    let mut stderr = child.stderr.take().ok_or(Error::NoStdout)?;
    let stdout_task = tokio::spawn(async move {
        let mut output = String::new();
        stdout.read_to_string(&mut output).await.map(|_| output)
    });
    let stderr_task = tokio::spawn(async move {
        let mut output = String::new();
        stderr.read_to_string(&mut output).await.map(|_| output)
    });

    let status = tokio::select! {
        status = child.wait() => status?,
        _ = sleep(Duration::from_secs(timeout_secs)) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            return Err(CoachError::GeminiTimeout(timeout_secs));
        }
    };

    let stdout = stdout_task.await.map_err(|error| {
        CoachError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            error.to_string(),
        ))
    })??;
    let stderr = stderr_task.await.map_err(|error| {
        CoachError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            error.to_string(),
        ))
    })??;
    let aux_log = if is_agy {
        tokio::fs::read_to_string(&agy_log_path)
            .await
            .unwrap_or_default()
    } else {
        String::new()
    };
    let combined = format!("{stdout}\n{stderr}\n{aux_log}");
    if looks_unauthenticated(&combined) && !looks_authenticated(&combined) {
        return Err(CoachError::GeminiUnauthenticated);
    }
    if !status.success() {
        return Err(CoachError::GeminiFailed {
            status: status.to_string(),
            message: trim_error_text(&combined),
        });
    }

    let mut cleaned = clean_gemini_output(&stdout);
    if cleaned.trim().is_empty() && is_agy {
        if let Some(transcript_output) = read_agy_transcript_response(&aux_log).await {
            cleaned = transcript_output;
        }
    }
    if cleaned.trim().is_empty() {
        let diagnostic = trim_error_text(&combined);
        if !diagnostic.trim().is_empty() {
            return Err(CoachError::GeminiFailed {
                status: "empty response".to_string(),
                message: diagnostic,
            });
        }
        return Err(CoachError::GeminiEmpty);
    }
    Ok(cleaned)
}

async fn read_agy_transcript_response(log: &str) -> Option<String> {
    let conversation_id = agy_conversation_id_from_log(log)?;
    let app_data_dir = agy_app_data_dir_from_log(log).or_else(default_agy_app_data_dir)?;
    let transcript_dir = app_data_dir
        .join("brain")
        .join(conversation_id)
        .join(".system_generated")
        .join("logs");
    let candidates = [
        transcript_dir.join("transcript_full.jsonl"),
        transcript_dir.join("transcript.jsonl"),
    ];

    for candidate in candidates {
        let Ok(content) = tokio::fs::read_to_string(candidate).await else {
            continue;
        };
        if let Some(output) = last_agy_model_content(&content) {
            return Some(output);
        }
    }
    None
}

fn agy_conversation_id_from_log(log: &str) -> Option<String> {
    for line in log.lines().rev() {
        if let Some(rest) = line.split("conversation=").nth(1) {
            let id = rest
                .split([',', ')', ' '])
                .next()
                .unwrap_or_default()
                .trim();
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
        if let Some(rest) = line.split("conversation update stream for ").nth(1) {
            let id = rest.split_whitespace().next().unwrap_or_default().trim();
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }
    None
}

fn agy_app_data_dir_from_log(log: &str) -> Option<PathBuf> {
    for line in log.lines().rev() {
        if let Some(rest) = line.split("CLI app data directory: ").nth(1) {
            let path = rest.trim();
            if !path.is_empty() {
                return Some(PathBuf::from(path));
            }
        }
    }
    None
}

fn default_agy_app_data_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE").map(|profile| {
        PathBuf::from(profile)
            .join(".gemini")
            .join("antigravity-cli")
    })
}

fn last_agy_model_content(transcript_jsonl: &str) -> Option<String> {
    transcript_jsonl
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|value| value.get("source").and_then(|source| source.as_str()) == Some("MODEL"))
        .filter(|value| value.get("status").and_then(|status| status.as_str()) == Some("DONE"))
        .filter_map(|value| {
            value
                .get("content")
                .and_then(|content| content.as_str())
                .map(str::trim)
                .filter(|content| !content.is_empty())
                .map(ToString::to_string)
        })
        .last()
}

fn resolve_cli_command(command: &str) -> PathBuf {
    let command_path = PathBuf::from(command);
    if command_has_path_separator(command) || command_path.extension().is_some() {
        return command_path;
    }

    #[cfg(target_os = "windows")]
    {
        let dirs = command_search_dirs();
        let extensions = [".exe", ".cmd", ".bat", ""];
        if let Some(path) = resolve_command_from_dirs(command, &dirs, &extensions) {
            return path;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let dirs = command_search_dirs();
        let extensions = [""];
        if let Some(path) = resolve_command_from_dirs(command, &dirs, &extensions) {
            return path;
        }
    }

    command_path
}

fn is_agy_command(command: &str, resolved_command: &Path) -> bool {
    let command_name = Path::new(command)
        .file_stem()
        .or_else(|| Path::new(command).file_name())
        .and_then(|value| value.to_str());
    let resolved_name = resolved_command
        .file_stem()
        .and_then(|value| value.to_str());
    command_name
        .or(resolved_name)
        .is_some_and(|name| name.eq_ignore_ascii_case("agy"))
}

fn command_has_path_separator(command: &str) -> bool {
    command.contains('/') || command.contains('\\')
}

fn command_search_dirs() -> Vec<PathBuf> {
    let mut dirs = env::var_os("PATH")
        .map(|path| env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default();

    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = env::var_os("APPDATA") {
            dirs.push(PathBuf::from(appdata).join("npm"));
        }
        if let Some(localappdata) = env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(localappdata).join("agy").join("bin"));
        }
        if let Some(userprofile) = env::var_os("USERPROFILE") {
            dirs.push(
                PathBuf::from(userprofile)
                    .join("AppData")
                    .join("Roaming")
                    .join("npm"),
            );
        }
    }

    dirs
}

fn resolve_command_from_dirs(
    command: &str,
    dirs: &[PathBuf],
    extensions: &[&str],
) -> Option<PathBuf> {
    for dir in dirs {
        for extension in extensions {
            let candidate = dir.join(format!("{command}{extension}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn looks_unauthenticated(output: &str) -> bool {
    let output = output.to_lowercase();
    output.contains("please set an auth method")
        || output.contains("unauthenticated")
        || output.contains("you are not logged into antigravity")
        || output.contains("auth timed out")
        || output.contains("failed to get oauth token")
        || output.contains("error getting token source")
        || (output.contains("gemini_api_key") && output.contains("auth"))
}

fn looks_authenticated(output: &str) -> bool {
    let output = output.to_lowercase();
    output.contains("auth done received")
        || output.contains("streamgeneratecontent")
        || output.contains("text_drip.go")
}

fn clean_gemini_output(output: &str) -> String {
    output
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            !trimmed.starts_with("Warning: 256-color support")
                && trimmed != "Ripgrep is not available. Falling back to GrepTool."
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn trim_error_text(output: &str) -> String {
    let output = clean_gemini_output(output);
    if output.len() <= MAX_GEMINI_ERROR_CHARS {
        output
    } else {
        format!("{}...", &output[..MAX_GEMINI_ERROR_CHARS])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_request() -> AiCoachRequest {
        AiCoachRequest {
            request_id: "test-coach-request".to_string(),
            fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".to_string(),
            side_to_move: "white".to_string(),
            move_history: Vec::new(),
            pgn: Some("[Event \"?\"]\n\n*".to_string()),
            pgn_scope: "current_line".to_string(),
            current_line_pgn: Some("[Event \"?\"]\n\n*".to_string()),
            whole_game_pgn: Some("[Event \"?\"]\n\n*".to_string()),
            game_analysis: Vec::new(),
            selected_move: Some("Current node".to_string()),
            question: "What is the plan here?".to_string(),
            chat_history: Vec::new(),
            reference_context: Vec::new(),
            existing_lines: Vec::new(),
            existing_lines_source: String::new(),
            prior_targeted_results: Vec::new(),
            opening_context: None,
            opening_context_error: None,
            engine_path: PathBuf::from("stockfish"),
            settings: AiCoachSettings {
                enabled: true,
                gemini_command: "gemini".to_string(),
                gemini_model: "gemini-3.1-pro-preview".to_string(),
                planner_model: "gemini-3.5-flash".to_string(),
                multipv: 3,
                timeout_secs: 60,
            },
        }
    }

    #[test]
    fn prompt_builder_includes_stockfish_grounding_and_protocol() {
        let prompt = build_coach_prompt(
            &sample_request(),
            &[CoachEngineLine {
                multipv: 1,
                depth: 12,
                eval: "+0.20".to_string(),
                uci_moves: vec!["e2e4".to_string()],
                san_moves: vec!["e4".to_string()],
            }],
            &[],
            &[],
            &[],
        );

        assert!(prompt.contains("Supplied engine analysis is the source of truth"));
        assert!(prompt.contains("Do not output <stockfish_request>"));
        assert!(prompt.contains("What is the plan here?"));
        assert!(prompt.contains("full legal sequence from the current FEN"));
        assert!(prompt.contains("1. eval +0.20, depth 12, full line from current FEN: e4"));
    }

    #[test]
    fn prompt_builder_uses_concept_first_coaching_voice() {
        let prompt = build_coach_prompt(
            &sample_request(),
            &[CoachEngineLine {
                multipv: 1,
                depth: 17,
                eval: "+0.35".to_string(),
                uci_moves: vec!["c2c4".to_string(), "g8f6".to_string()],
                san_moves: vec!["c4".to_string(), "Nf6".to_string()],
            }],
            &[],
            &[],
            &[],
        );

        assert!(prompt.contains("concept-first chess coach"));
        assert!(prompt.contains("engine and board facts as a compass"));
        assert!(prompt.contains("counterplay"));
        assert!(prompt.contains("what it changes"));
        assert!(prompt.contains("For \"what is the plan\" questions, give a real plan"));
        assert!(prompt.contains("Natural answer menu"));
        assert!(!prompt.contains("Prefer this final answer shape"));
    }

    #[test]
    fn prompt_builder_requires_chess_fact_tool_grounding_for_board_claims() {
        let request = sample_request();
        let fact = execute_chess_fact_tool_call(&ChessFactToolCall::SquareFacts {
            fen: "4k3/8/8/8/2r5/8/8/1KB5 b - - 0 1".to_string(),
            square: "c1".to_string(),
            label: "Square c1".to_string(),
            reason: "Verify the c1 bishop before calling it undefended.".to_string(),
        })
        .unwrap();

        let prompt = build_coach_prompt_with_facts(
            &request,
            &[],
            &[],
            &[],
            &[],
            std::slice::from_ref(&fact),
        );

        assert!(prompt.contains("Private board-state facts"));
        assert!(prompt.contains("Use them silently"));
        assert!(prompt.contains("normal coach prose"));
        assert!(prompt.contains("do not claim a move is legal/illegal"));
        assert!(prompt.contains("Do not infer current-position facts from visual memory"));
        assert!(prompt.contains("c1: white bishop"));
        assert!(prompt.contains("Undefended: false"));
    }

    #[test]
    fn square_facts_report_attacked_bishop_as_defended_when_defender_exists() {
        let result = execute_chess_fact_tool_call(&ChessFactToolCall::SquareFacts {
            fen: "4k3/8/8/8/2r5/8/8/1KB5 b - - 0 1".to_string(),
            square: "C1".to_string(),
            label: "Square c1".to_string(),
            reason: "Check whether the bishop is defended.".to_string(),
        })
        .unwrap();

        assert!(result.summary.contains("c1: white bishop"));
        assert!(result.summary.contains("Defenders: b1 white king"));
        assert!(result.summary.contains("Enemy attackers: c4 black rook"));
        assert!(result.summary.contains("Undefended: false"));
        assert_eq!(result.facts["isUndefended"].as_bool(), Some(false));
    }

    #[test]
    fn position_facts_do_not_expose_global_loose_piece_inventory() {
        let result = execute_chess_fact_tool_call(&ChessFactToolCall::PositionFacts {
            fen: "8/p4k1p/1p3p2/2n1p3/2r2P1Q/P2q4/3B2PP/5RK1 b - - 1 32".to_string(),
            label: "Current position baseline".to_string(),
            reason: "Required baseline.".to_string(),
        })
        .unwrap();
        let formatted = format_chess_fact_results(std::slice::from_ref(&result));

        assert!(!result.facts.get("undefendedPieces").is_some());
        assert!(!result.facts.get("hangingPieces").is_some());
        assert!(!result.facts.get("attackedPieces").is_some());
        assert!(!formatted.contains("h4 white queen"));
        assert!(!formatted.contains("Undefended white pieces"));
    }

    #[test]
    fn move_facts_show_what_a_rook_move_attacks_and_who_defends_it() {
        let position = parse_fen_to_position("2r1k3/8/8/8/8/8/8/1KB5 b - - 0 1").unwrap();
        let (summary, facts) =
            move_fact_payload(&position, "2r1k3/8/8/8/8/8/8/1KB5 b - - 0 1", "Rc4").unwrap();

        assert!(summary.contains("Rc4"));
        assert!(summary.contains("c1 white bishop (defenders: b1 white king)"));
        let attacks = facts["movedPieceAttacksAfterMove"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|value| value.as_str())
            .collect::<Vec<_>>();
        assert!(attacks
            .iter()
            .any(|value| *value == "c1 white bishop (defenders: b1 white king)"));
    }

    #[test]
    fn default_chess_fact_calls_include_mentioned_squares_from_current_context() {
        let mut request = sample_request();
        request.question = "Was the bishop on C1 actually defended?".to_string();
        let calls = infer_default_chess_fact_tool_calls(&request, &[]);

        assert!(calls.iter().any(|call| matches!(
            call,
            ChessFactToolCall::SquareFacts { square, .. } if square == "c1"
        )));
    }

    #[test]
    fn broad_plan_questions_skip_extra_chess_fact_planner() {
        let request = sample_request();

        assert!(!should_plan_extra_chess_fact_calls(&request, &[]));
    }

    #[test]
    fn concrete_tactical_questions_use_extra_chess_fact_planner() {
        let mut request = sample_request();
        request.question = "Can't the queen take the bishop on c1?".to_string();

        assert!(should_plan_extra_chess_fact_calls(&request, &[]));
    }

    #[test]
    fn whole_game_reviews_skip_extra_chess_fact_planner_without_concrete_reference() {
        let mut request = sample_request();
        request.pgn_scope = "whole_game".to_string();
        request.question = "Can you review this whole game?".to_string();

        assert!(!should_plan_extra_chess_fact_calls(&request, &[]));
    }

    #[test]
    fn fact_audit_is_reserved_for_leaks_or_high_risk_ungrounded_claims() {
        assert!(!answer_needs_fact_audit(
            "White should use the c-file pressure and stop Black's counterplay.",
            &[]
        ));
        assert!(answer_needs_fact_audit(
            "The private board-state facts show the bishop is loose.",
            &[]
        ));
        assert!(answer_needs_fact_audit(
            "The bishop is undefended, so Qxd2 wins a piece.",
            &[]
        ));
        let specific_fact = CoachChessFactResult {
            tool: "square_facts".to_string(),
            label: "Current square d2".to_string(),
            reason: "test".to_string(),
            fen: sample_request().fen,
            summary: "d2: white bishop. Undefended: true".to_string(),
            facts: json!({"isUndefended": true}),
        };
        assert!(!answer_needs_fact_audit(
            "The bishop is undefended, so Qxd2 wins a piece.",
            &[specific_fact]
        ));
    }

    #[test]
    fn parses_chess_fact_tool_plan_json() {
        let parsed = parse_chess_fact_tool_plan(
            r#"```json
{"reason":"verify the c1 bishop","calls":[{"tool":"square_facts","fen":"start","square":"c1","reason":"check defenders"}]}
```"#,
        )
        .unwrap();

        assert_eq!(parsed.reason, "verify the c1 bishop");
        assert!(matches!(
            parsed.calls.first(),
            Some(ChessFactToolCall::SquareFacts { square, .. }) if square == "c1"
        ));
    }

    #[test]
    fn prompt_builder_includes_chat_and_lichess_all_context() {
        let mut request = sample_request();
        request.chat_history = vec![
            CoachChatMessage {
                role: "user".to_string(),
                content: "Should I play c4?".to_string(),
            },
            CoachChatMessage {
                role: "assistant".to_string(),
                content: "c4 is playable if Stockfish supports it.".to_string(),
            },
        ];
        request.opening_context = Some(CoachOpeningContext {
            source: "Lichess All".to_string(),
            fen: request.fen.clone(),
            side: "white".to_string(),
            total_games: 1000.0,
            filters: "ratings 1800+".to_string(),
            moves: vec![CoachOpeningMove {
                san: "e4".to_string(),
                uci: "e2e4".to_string(),
                games: 500.0,
                white: 220.0,
                draw: 120.0,
                black: 160.0,
                usage_pct: 50.0,
                side_score_pct: 56.0,
                blended_strength: 82,
                blended_label: "82".to_string(),
                database_strength_pct: Some(54.2),
                engine_cp_loss: Some(0),
                engine_rank: Some(1),
                engine_score: Some("+0.20".to_string()),
                notes: vec!["Matches Lichess cloud choice #1".to_string()],
            }],
        });

        let prompt = build_coach_prompt(&request, &[], &[], &[], &[]);

        assert!(prompt.contains("Conversation so far"));
        assert!(prompt.contains("User: Should I play c4?"));
        assert!(prompt.contains("Lichess All opening context"));
        assert!(prompt.contains("e4 (e2e4): 500 games"));
        assert!(prompt.contains("blended 82/100"));
    }

    #[test]
    fn prompt_builder_includes_whole_game_analysis_context() {
        let mut request = sample_request();
        request.pgn_scope = "whole_game".to_string();
        request.game_analysis = vec![CoachGameAnalysisPoint {
            ply: 12,
            mv: "Nf3".to_string(),
            before_fen: Some(request.fen.clone()),
            fen: request.fen.clone(),
            played_uci: Some("g1f3".to_string()),
            played_side: Some("white".to_string()),
            eval: Some("+0.35".to_string()),
            depth: Some(14),
            annotations: vec!["?!".to_string()],
        }];

        let prompt = build_coach_prompt(&request, &[], &[], &[], &[]);

        assert!(prompt.contains("whole game PGN selected by the Flash planner"));
        assert!(prompt.contains("Ply 12: Nf3, +0.35, depth 14"));
        assert!(!prompt.contains("annotations ?!"));
    }

    #[test]
    fn prompt_builder_anchors_specific_named_move_questions() {
        let mut request = sample_request();
        request.pgn_scope = "whole_game".to_string();
        request.question = "How could I have held the position after Qxb5?".to_string();
        request.game_analysis = vec![
            CoachGameAnalysisPoint {
                ply: 19,
                mv: "Qxb5+".to_string(),
                before_fen: Some("4k3/8/8/1p6/8/3Q4/8/4K3 w - - 0 1".to_string()),
                fen: "4k3/8/8/1Q6/8/8/8/4K3 b - - 0 1".to_string(),
                played_uci: Some("d3b5".to_string()),
                played_side: Some("white".to_string()),
                eval: Some("-0.80".to_string()),
                depth: Some(17),
                annotations: vec!["?".to_string()],
            },
            CoachGameAnalysisPoint {
                ply: 31,
                mv: "h4".to_string(),
                before_fen: Some(
                    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".to_string(),
                ),
                fen: request.fen.clone(),
                played_uci: Some("h2h4".to_string()),
                played_side: Some("white".to_string()),
                eval: Some("-2.10".to_string()),
                depth: Some(17),
                annotations: vec!["??".to_string()],
            },
        ];

        let prompt = build_coach_prompt(&request, &[], &[], &[], &[]);

        assert!(prompt.contains("Question focus and intent"));
        assert!(prompt.contains(
            "Inferred intent: find the best practical defensive resource or recovery plan"
        ));
        assert!(prompt.contains("The user named: Qxb5"));
        assert!(prompt.contains("ply 19: white played Qxb5+"));
        assert!(prompt.contains("Do not give a broad critical-moments review"));
        assert!(prompt.contains("Best defensive try"));
        assert!(prompt.contains("Do not merely state that the user is worse or losing"));
        assert!(prompt.contains("Do not turn this into a broad whole-game review"));
        assert!(!prompt.contains("Prefer whole-game sections"));
        assert!(!prompt.contains("Ply 31: h4"));
    }

    #[test]
    fn question_intent_classifies_common_coach_tasks() {
        assert!(infer_question_intent("How could I have held after Qxb5?")
            .contains("defensive resource"));
        assert!(infer_question_intent("Why is Qxb5 bad?").contains("explain why"));
        assert!(
            infer_question_intent("Is Qxb5 better than Qa4?").contains("compare the named choices")
        );
        assert!(infer_question_intent("What is the plan here?").contains("practical plan"));
    }

    #[test]
    fn whole_game_critical_requests_analyse_played_move_and_best_position() {
        let mut request = sample_request();
        request.pgn_scope = "whole_game".to_string();
        request.game_analysis = vec![CoachGameAnalysisPoint {
            ply: 19,
            mv: "Bxf4".to_string(),
            before_fen: Some(request.fen.clone()),
            fen: "rnbqkbnr/pppppppp/8/8/5B2/8/PPPPPPPP/RN1QKBNR b KQkq - 0 1".to_string(),
            played_uci: Some("c1f4".to_string()),
            played_side: Some("white".to_string()),
            eval: Some("-1.40".to_string()),
            depth: Some(16),
            annotations: vec!["??".to_string()],
        }];

        let requests = infer_whole_game_critical_stockfish_requests(&request);

        assert_eq!(requests.len(), 2);
        assert!(matches!(
            &requests[0],
            StockfishFollowUpRequest::AnalyseMove { fen, mv, reason }
                if fen == &request.fen
                    && mv == "c1f4"
                    && reason.contains("concrete Stockfish refutation after white played Bxf4")
        ));
        assert!(matches!(
            &requests[1],
            StockfishFollowUpRequest::AnalysePosition { fen, reason, .. }
                if fen == &request.fen
                    && reason.contains("what white should have played instead of Bxf4")
                    && reason.contains("pre-move position")
        ));
    }

    #[test]
    fn planner_prompt_includes_whole_game_critical_position_instructions() {
        let mut request = sample_request();
        request.pgn_scope = "whole_game".to_string();
        request.game_analysis = vec![CoachGameAnalysisPoint {
            ply: 19,
            mv: "Bxf4".to_string(),
            before_fen: Some(request.fen.clone()),
            fen: request.fen.clone(),
            played_uci: Some("c1f4".to_string()),
            played_side: Some("white".to_string()),
            eval: Some("-1.40".to_string()),
            depth: Some(16),
            annotations: vec!["??".to_string()],
        }];

        let prompt = build_planner_prompt(&request, "e4 (e2e4), d4 (d2d4)", &[], &[]);

        assert!(prompt.contains("analyse_position"));
        assert!(prompt.contains("Critical whole-game positions"));
        assert!(prompt.contains("Ply 19: white played Bxf4"));
        assert!(prompt.contains("what should have been played instead"));
    }

    #[test]
    fn planner_prompt_limits_critical_positions_to_named_game_move() {
        let mut request = sample_request();
        request.question = "How could I have held the position after Qxb5?".to_string();
        request.game_analysis = vec![
            CoachGameAnalysisPoint {
                ply: 19,
                mv: "Qxb5+".to_string(),
                before_fen: Some("4k3/8/8/1p6/8/3Q4/8/4K3 w - - 0 1".to_string()),
                fen: "4k3/8/8/1Q6/8/8/8/4K3 b - - 0 1".to_string(),
                played_uci: Some("d3b5".to_string()),
                played_side: Some("white".to_string()),
                eval: Some("-0.80".to_string()),
                depth: Some(17),
                annotations: vec!["?".to_string()],
            },
            CoachGameAnalysisPoint {
                ply: 31,
                mv: "h4".to_string(),
                before_fen: Some(
                    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".to_string(),
                ),
                fen: request.fen.clone(),
                played_uci: Some("h2h4".to_string()),
                played_side: Some("white".to_string()),
                eval: Some("-2.10".to_string()),
                depth: Some(17),
                annotations: vec!["??".to_string()],
            },
        ];

        let prompt = build_planner_prompt(&request, "Kd2 (e1d2)", &[], &[]);

        assert!(prompt.contains("Question-referenced game position"));
        assert!(prompt.contains("Ply 19: white played Qxb5+"));
        assert!(!prompt.contains("Ply 31: h4"));
        assert!(!prompt.contains("Ply 31: white played h4"));
        assert!(prompt
            .contains("Do not turn a named-move question into a broad critical-moments review"));
    }

    #[test]
    fn named_game_move_requests_are_prioritized_over_later_critical_moments() {
        let mut request = sample_request();
        request.question = "How could I have held the position after Qxb5?".to_string();
        request.game_analysis = vec![
            CoachGameAnalysisPoint {
                ply: 19,
                mv: "Qxb5+".to_string(),
                before_fen: Some("4k3/8/8/1p6/8/3Q4/8/4K3 w - - 0 1".to_string()),
                fen: "4k3/8/8/1Q6/8/8/8/4K3 b - - 0 1".to_string(),
                played_uci: Some("d3b5".to_string()),
                played_side: Some("white".to_string()),
                eval: Some("-0.80".to_string()),
                depth: Some(17),
                annotations: vec!["?".to_string()],
            },
            CoachGameAnalysisPoint {
                ply: 31,
                mv: "h4".to_string(),
                before_fen: Some(
                    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".to_string(),
                ),
                fen: request.fen.clone(),
                played_uci: Some("h2h4".to_string()),
                played_side: Some("white".to_string()),
                eval: Some("-2.10".to_string()),
                depth: Some(17),
                annotations: vec!["??".to_string()],
            },
        ];

        let requests = infer_question_referenced_game_stockfish_requests(&request);

        assert_eq!(requests.len(), 2);
        assert!(matches!(
            &requests[0],
            StockfishFollowUpRequest::AnalyseMove { fen, mv, reason }
                if fen == "4k3/8/8/1p6/8/3Q4/8/4K3 w - - 0 1"
                    && mv == "d3b5"
                    && reason.contains("Qxb5+")
        ));
        assert!(matches!(
            &requests[1],
            StockfishFollowUpRequest::AnalysePosition { fen, label, reason }
                if fen == "4k3/8/8/1p6/8/3Q4/8/4K3 w - - 0 1"
                    && label.contains("Qxb5+")
                    && reason.contains("same pre-move position")
        ));
    }

    #[test]
    fn planner_prompt_includes_legal_moves_and_json_schema() {
        let prompt = build_planner_prompt(&sample_request(), "e4 (e2e4), d4 (d2d4)", &[], &[]);

        assert!(prompt.contains("fast chess-analysis planner"));
        assert!(prompt.contains("\"requests\""));
        assert!(prompt.contains("e4 (e2e4), d4 (d2d4)"));
        assert!(prompt.contains("Be generous"));
    }

    #[test]
    fn parses_planner_json_from_plain_or_fenced_output() {
        let parsed = parse_planner_response(
            r#"```json
{"pgn_scope":"current_line","reason":"compare named moves","requests":[{"type":"compare_moves","fen":"start","moves":["e4","d4"],"reason":"named alternatives"}]}
```"#,
        )
        .unwrap();

        assert_eq!(parsed.pgn_scope, "current_line");
        assert_eq!(parsed.reason, "compare named moves");
        assert!(matches!(
            parsed.requests.first(),
            Some(StockfishFollowUpRequest::CompareMoves { moves, .. })
                if moves == &vec!["e4".to_string(), "d4".to_string()]
        ));
    }

    #[test]
    fn rejects_malformed_planner_output() {
        let error = parse_planner_response("I would analyse e4.").unwrap_err();
        assert!(error.to_string().contains("malformed JSON"));
    }

    #[test]
    fn deterministic_planner_fallback_keeps_current_line_for_generic_question() {
        let mut request = sample_request();
        request.pgn_scope = "current_line".to_string();
        request.question = "why is this bad?".to_string();

        let scope = deterministic_planner_fallback_scope(&request, false, false);

        assert_eq!(scope, CoachPgnScope::CurrentLine);
    }

    #[test]
    fn deterministic_planner_fallback_uses_whole_game_for_game_review() {
        let mut request = sample_request();
        request.pgn_scope = "current_line".to_string();
        request.question = "analyse this whole game".to_string();

        let scope = deterministic_planner_fallback_scope(&request, false, false);

        assert_eq!(scope, CoachPgnScope::WholeGame);
    }

    #[test]
    fn infers_compare_request_from_named_legal_moves() {
        let requests = infer_question_stockfish_requests(
            "rnbqkbnr/pppppp1p/6p1/4N3/8/8/PPPPPPPP/RNBQKB1R w KQkq - 0 1",
            "why is e4 better than nxg6?",
        )
        .unwrap();

        assert!(matches!(
            requests.first(),
            Some(StockfishFollowUpRequest::CompareMoves { moves, .. })
                if moves == &vec!["e4".to_string(), "Nxg6".to_string()]
        ));
    }

    #[test]
    fn infers_lowercase_what_if_move() {
        let requests = infer_question_stockfish_requests(
            "rnbqkbnr/pppppp1p/6p1/4N3/8/8/PPPPPPPP/RNBQKB1R w KQkq - 0 1",
            "what if I play nxg6 and it doesn't work?",
        )
        .unwrap();

        assert!(matches!(
            requests.first(),
            Some(StockfishFollowUpRequest::AnalyseMove { mv, .. }) if mv == "Nxg6"
        ));
    }

    #[test]
    fn infers_natural_capture_reply_from_current_position() {
        let requests = infer_question_stockfish_requests(
            "8/p4k1p/1p3p2/2n1p3/2r2P1Q/P2q4/3B2PP/5RK1 b - - 1 32",
            "can't the queen just take the bishop after BD2?",
        )
        .unwrap();

        assert!(matches!(
            requests.first(),
            Some(StockfishFollowUpRequest::AnalyseMove { mv, reason, .. })
                if mv == "Qxd2" && reason.contains("natural capture")
        ));
    }

    #[test]
    fn infers_natural_capture_reply_after_named_setup_move() {
        let requests = infer_question_stockfish_requests(
            "8/p4k1p/1p3p2/2n1p3/2r2P1Q/P2q4/2B3PP/5RK1 w - - 0 32",
            "can't the queen just take the bishop after BD2?",
        )
        .unwrap();

        assert!(matches!(
            requests.first(),
            Some(StockfishFollowUpRequest::AnalyseLine { line, reason, .. })
                if line == "Bd2 Qxd2" && reason.contains("after the named move")
        ));
    }

    #[test]
    fn normalizes_uppercase_san_move_candidates() {
        assert_eq!(
            extract_move_candidates("what about BD2 and QXD2?"),
            vec!["Bd2".to_string(), "Qxd2".to_string()]
        );
    }

    #[test]
    fn prefixes_targeted_engine_lines_with_requested_line() {
        let lines = prefix_engine_lines(
            vec![CoachEngineLine {
                multipv: 1,
                depth: 12,
                eval: "+0.30".to_string(),
                uci_moves: vec!["g8f6".to_string(), "b1c3".to_string()],
                san_moves: vec!["Nf6".to_string(), "Nc3".to_string()],
            }],
            &["e2e4".to_string(), "e7e5".to_string()],
            &["e4".to_string(), "e5".to_string()],
        );

        assert_eq!(
            lines[0].uci_moves,
            vec![
                "e2e4".to_string(),
                "e7e5".to_string(),
                "g8f6".to_string(),
                "b1c3".to_string()
            ]
        );
        assert_eq!(
            lines[0].san_moves,
            vec![
                "e4".to_string(),
                "e5".to_string(),
                "Nf6".to_string(),
                "Nc3".to_string()
            ]
        );
    }

    #[test]
    fn accepts_answer_line_block_backed_by_stockfish_prefix() {
        let result = validate_answer_line_blocks(
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            "Play <line>e4 e5</line> and develop.",
            &[CoachEngineLine {
                multipv: 1,
                depth: 12,
                eval: "+0.20".to_string(),
                uci_moves: vec!["e2e4".to_string(), "e7e5".to_string(), "g1f3".to_string()],
                san_moves: vec!["e4".to_string(), "e5".to_string(), "Nf3".to_string()],
            }],
            &[],
        );

        assert!(result.is_ok());
    }

    #[test]
    fn rejects_answer_line_block_not_backed_by_stockfish() {
        let result = validate_answer_line_blocks(
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            "Try <line>d4 d5</line>.",
            &[CoachEngineLine {
                multipv: 1,
                depth: 12,
                eval: "+0.20".to_string(),
                uci_moves: vec!["e2e4".to_string(), "e7e5".to_string()],
                san_moves: vec!["e4".to_string(), "e5".to_string()],
            }],
            &[],
        )
        .unwrap_err();

        assert!(result.to_string().contains("not supplied by Stockfish"));
    }

    #[test]
    fn rejects_line_block_backed_only_by_non_current_whole_game_result() {
        let result = validate_answer_line_blocks(
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            "The earlier critical alternative was <line>d4</line>.",
            &[CoachEngineLine {
                multipv: 1,
                depth: 12,
                eval: "+0.20".to_string(),
                uci_moves: vec!["e2e4".to_string()],
                san_moves: vec!["e4".to_string()],
            }],
            &[CoachTargetedResult {
                request_type: "analyse_position".to_string(),
                reason: "Critical game moment".to_string(),
                fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1".to_string(),
                moves: Vec::new(),
                label: "Critical ply 4".to_string(),
                lines: vec![CoachEngineLine {
                    multipv: 1,
                    depth: 12,
                    eval: "+0.40".to_string(),
                    uci_moves: vec!["d2d4".to_string()],
                    san_moves: vec!["d4".to_string()],
                }],
            }],
        )
        .unwrap_err();

        assert!(result.to_string().contains("not supplied by Stockfish"));
    }

    #[test]
    fn rejects_game_start_line_from_later_fen() {
        let result = validate_answer_line_blocks(
            "rnbqkbnr/pppppp1p/6p1/4N3/8/8/PPPPPPPP/RNBQKB1R w KQkq - 0 1",
            "The line is <line>e4 g6 d4 Bg7</line>.",
            &[CoachEngineLine {
                multipv: 1,
                depth: 12,
                eval: "+0.20".to_string(),
                uci_moves: vec!["e5g6".to_string()],
                san_moves: vec!["Nxg6".to_string()],
            }],
            &[],
        )
        .unwrap_err();

        assert!(result.to_string().contains("not a legal full line"));
        assert!(result.to_string().contains("illegal move `e4`"));
    }

    #[test]
    fn prompt_builder_includes_correction_notes() {
        let prompt = build_coach_prompt(
            &sample_request(),
            &[],
            &[],
            &[],
            &["Your previous final answer was rejected.".to_string()],
        );

        assert!(prompt.contains("Correction from the app"));
        assert!(prompt.contains("1. Your previous final answer was rejected."));
    }

    #[test]
    fn parses_stockfish_request_block() {
        let parsed = parse_stockfish_request(
            r#"<stockfish_request>
{"type":"analyse_move","fen":"start","move":"Bxd4","reason":"needs checking"}
</stockfish_request>"#,
        )
        .unwrap();

        assert_eq!(
            parsed,
            Some(StockfishFollowUpRequest::AnalyseMove {
                fen: "start".to_string(),
                mv: "Bxd4".to_string(),
                reason: "needs checking".to_string()
            })
        );
    }

    #[test]
    fn rejects_malformed_stockfish_request_block() {
        let parsed = parse_stockfish_request(
            r#"<stockfish_request>{"type":"analyse_move"</stockfish_request>"#,
        );
        assert!(parsed.is_err());
    }

    #[test]
    fn rejects_stockfish_request_with_extra_text() {
        let parsed = parse_stockfish_request(
            r#"I need more data.
<stockfish_request>
{"type":"analyse_move","fen":"start","move":"Bxd4","reason":"needs checking"}
</stockfish_request>"#,
        );
        assert!(parsed.is_err());
    }

    #[test]
    fn rejects_foreign_follow_up_fen() {
        let error = validate_follow_up_fen(
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            &[],
            "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
        )
        .unwrap_err();

        assert!(error.to_string().contains("current FEN"));
    }

    #[test]
    fn allows_stockfish_requests_from_reference_fen() {
        let reference_fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
        let reference_context = vec![CoachReferenceContext {
            label: "After 1.e4".to_string(),
            fen: reference_fen.to_string(),
            ply: 1,
            san_line: vec!["e4".to_string()],
            source: "current line".to_string(),
            detail: "Use this exact FEN for phrases like after 1.e4.".to_string(),
        }];

        validate_follow_up_fen(
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            &reference_context,
            reference_fen,
        )
        .unwrap();
    }

    #[test]
    fn rejects_illegal_requested_move() {
        let error = parse_single_move(
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            "e5",
        )
        .unwrap_err();
        assert!(error.to_string().contains("illegal move"));
    }

    #[test]
    fn cleans_cli_warning_lines() {
        assert_eq!(
            clean_gemini_output(
                "Answer\nWarning: 256-color support not detected. Using a terminal with at least 256-color support is recommended for a better visual experience.\nRipgrep is not available. Falling back to GrepTool.\n"
            ),
            "Answer"
        );
    }

    #[test]
    fn detects_agy_auth_timeout_log_as_unauthenticated() {
        let output = "E0606 printmode.go:235] Print mode: auth timed out\n\
            error getting token source: You are not logged into Antigravity.";

        assert!(looks_unauthenticated(output));
        assert!(!looks_authenticated(output));
    }

    #[test]
    fn detects_agy_success_after_initial_auth_noise() {
        let output = "error getting token source: You are not logged into Antigravity.\n\
            input_loop.go:510] Auth done received, triggering experiment refresh\n\
            http_helpers.go:183] URL: https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";

        assert!(looks_unauthenticated(output));
        assert!(looks_authenticated(output));
    }

    #[test]
    fn extracts_agy_model_content_from_transcript() {
        let transcript = r#"{"source":"USER_EXPLICIT","status":"DONE","content":"Question"}
{"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","content":"{\"requests\":[]}"}
"#;

        assert_eq!(
            last_agy_model_content(transcript).as_deref(),
            Some("{\"requests\":[]}")
        );
    }

    #[test]
    fn parses_agy_log_locations() {
        let log = "I common.go:154] CLI app data directory: C:\\Users\\loxty\\.gemini\\antigravity-cli\n\
            I printmode.go:82] Print mode: starting\n\
            I printmode.go:147] Print mode: conversation=8c47d29b-aa92-43f8-a1d9-9dbebaa6453f, sending message";

        assert_eq!(
            agy_conversation_id_from_log(log).as_deref(),
            Some("8c47d29b-aa92-43f8-a1d9-9dbebaa6453f")
        );
        assert_eq!(
            agy_app_data_dir_from_log(log).as_deref(),
            Some(Path::new("C:\\Users\\loxty\\.gemini\\antigravity-cli"))
        );
    }

    #[test]
    fn resolves_command_from_cmd_shim() {
        let temp = tempdir().unwrap();
        std::fs::write(temp.path().join("gemini"), "").unwrap();
        let shim = temp.path().join("gemini.cmd");
        std::fs::write(&shim, "").unwrap();

        assert_eq!(
            resolve_command_from_dirs(
                "gemini",
                &[temp.path().to_path_buf()],
                &[".exe", ".cmd", ".bat", ""]
            ),
            Some(shim)
        );
    }
}
