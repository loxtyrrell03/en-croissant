use std::{
    collections::{HashMap, HashSet},
    env,
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};

use log::{info, warn};
use serde::{Deserialize, Serialize};
use shakmaty::{
    san::{San, SanPlus},
    uci::UciMove,
    CastlingMode, Color, EnPassantMode, Position,
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

const DEFAULT_STOCKFISH_DEPTH: u32 = 12;
const DEFAULT_COACH_MODEL: &str = "gemini-3.1-pro-preview";
const DEFAULT_PLANNER_MODEL: &str = "gemini-3.5-flash";
const MAX_PLANNER_STOCKFISH_REQUESTS: usize = 6;
const MAX_WHOLE_GAME_CRITICAL_REQUESTS: usize = 3;
const PLANNER_TIMEOUT_SECS: u64 = 60;
const MAX_PROMPT_PGN_CHARS: usize = 12_000;
const MAX_CHAT_MESSAGE_CHARS: usize = 2_000;
const MAX_REFERENCE_CONTEXT_ITEMS: usize = 120;
const MAX_GEMINI_ERROR_CHARS: usize = 1_200;
const AI_COACH_PROGRESS_EVENT: &str = "ai-coach-progress";

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

    let legal_moves = format_legal_root_moves(&request.fen)?;
    let reference_context = normalized_reference_context(&request);
    let mut targeted_results = request.prior_targeted_results.clone();
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
    let planner_answer = run_gemini_cli(
        &request.settings.gemini_command,
        &planner_model,
        &planner_prompt,
        PLANNER_TIMEOUT_SECS.min(timeout_secs.into()),
    )
    .await?;
    let planner_response = parse_planner_response(&planner_answer)?;
    let planner_scope = parse_coach_pgn_scope(&planner_response.pgn_scope).ok_or_else(|| {
        CoachError::GeminiPlannerMalformed(format!(
            "missing or invalid pgn_scope `{}`; expected `current_line` or `whole_game`",
            planner_response.pgn_scope
        ))
    })?;
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
    let (mut planned_requests, rejected_planner_requests) =
        sanitize_planner_requests(&request, &reference_context, planner_response.requests);
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

    let critical_requests = infer_whole_game_critical_stockfish_requests(&request);
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
            "Adding critical game alternatives",
            format!(
                "Queued {critical_count} best-move Stockfish check(s) for critical whole-game mistake positions."
            ),
            21.0,
            false,
        );
    }

    if planned_requests.is_empty() {
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

    let stockfish_lines = if request.existing_lines.len() >= multipv as usize {
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
    let used_existing_analysis = request.existing_lines.len() >= multipv as usize;
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
            &request.fen,
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
    emit_coach_progress(
        app,
        request_id,
        started,
        "prompt",
        "Building coach prompt",
        format!(
            "Packaging {} root line(s), {} targeted result(s), opening context, and chat history.",
            stockfish_lines.len(),
            targeted_results.len()
        ),
        72.0,
        false,
    );
    let prompt = build_coach_prompt(
        &request,
        &stockfish_lines,
        &targeted_results,
        &reference_context,
        &[],
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
        78.0,
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
            "Your previous final answer was rejected: {error}. Remove every unsupported <line> block, or replace it with an exact legal prefix of the supplied Stockfish data from the current FEN. Do not include any game-start opening sequence unless it is legal from the current FEN."
        ));
        let repair_prompt = build_coach_prompt(
            &request,
            &stockfish_lines,
            &targeted_results,
            &reference_context,
            &correction_notes,
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
        validate_answer_line_blocks(
            &request.fen,
            &final_answer,
            &stockfish_lines,
            &targeted_results,
        )?;
    }

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
    let engine_lines = format_engine_lines(stockfish_lines);
    let targeted = if targeted_results.is_empty() {
        "None".to_string()
    } else {
        targeted_results
            .iter()
            .map(format_targeted_result)
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    let chat_history = format_chat_history(&request.chat_history);
    let reference_context = format_reference_context(reference_context);
    let opening_context = format_opening_context(
        request.opening_context.as_ref(),
        request.opening_context_error.as_deref(),
    );
    let game_analysis = format_game_analysis(&request.game_analysis);
    let correction_notes = format_correction_notes(correction_notes);

    format!(
        r#"Role: You are a chess coach explaining a position.

Core rules:
- Stockfish is the source of truth.
- Never invent concrete tactics, evaluations, plans, or variations. Any concrete move line or plan you recommend must be backed by supplied Stockfish MultiPV or targeted Stockfish results.
- You may use general chess and opening knowledge for concepts, structures, plans, and naming, but only as explanation layered on top of Stockfish-backed lines.
- Explain like a strong GM/coach: use proper chess terminology such as isolated queen's pawn, minority attack, deflection, trapped piece, blockade, weak square, exchange sacrifice, or domination when it genuinely fits.
- Treat Lichess All opening stats and blended strength as practical/popularity evidence only. Use it when relevant to opening choice, repertoire, popularity, or practical results; do not treat it as a tactical proof.
- Do not use tools, shell commands, files, network lookups, external resources, or the Stockfish request protocol. A separate planner has already requested all allowed targeted Stockfish analysis up front.
- If the supplied Stockfish data still does not fully answer the user's question, say that limitation briefly and answer only from the supplied evidence. Do not output <stockfish_request>.
- Use the conversation history to answer follow-up questions naturally.
- Use the Position/reference context to resolve explicit references such as "after 19.Nexd4", "that line", or "the line we discussed". If a referenced FEN is supplied there, use only Stockfish results from that FEN or current-FEN lines that legally reach it; do not reinterpret the reference from a different position.
- For whole-game review questions, do more than list mistakes: when critical-position Stockfish results are supplied, tell the user what should have been played instead and why Stockfish prefers that move over the move played. It is fine to cover only the critical mistakes.
- Root Stockfish MultiPV is from the current FEN. Targeted results list their own FEN; use each targeted result only for that listed position. Targeted "After ..." results already include the requested move or requested line before the continuation.
- Use bold section labels like **Direct answer**, **Key reason**, and **Main line**. Do not use Markdown # headings.
- When you give a concrete playable variation from the current FEN in your final answer, wrap only the moves in <line>...</line>. Do not wrap prose. Only include a <line> block when that exact line is a full legal sequence from the current FEN and is a prefix of current-FEN Stockfish data supplied here.
- Do not wrap whole-game critical-position alternatives in <line> unless that targeted result's FEN is exactly the current FEN.
- A <line> block must start at the current FEN, not at the start of the game. Never include earlier PGN/game moves just to reach the variation. For a non-current whole-game improvement, write the moves as plain text instead of a <line> block.
- If you discuss a move that happens after another move first, the <line> block must include the earlier move(s) too. For example, use <line>Bh6 e4 ...</line>, not <line>e4 ...</line>, when e4 is only meaningful after Bh6.
- Do not give an engine-looking line unless it appears in Stockfish MultiPV or targeted Stockfish result.
- Keep answers concise unless the user asks for depth.
- Prefer this final answer shape: Direct answer; Key reason; Main line or two; Human plan/lesson; Optional training takeaway.

Position:
FEN: {fen}
Side to move: {side_to_move}
Selected move/current node: {selected_move}
Move history in UCI: {move_history}

PGN context ({pgn_scope}):
{pgn}

Stored whole-game Stockfish analysis:
{game_analysis}

Stockfish MultiPV:
{engine_lines}

Targeted Stockfish result:
{targeted}

Lichess All opening context:
{opening_context}

Conversation so far:
{chat_history}

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
        engine_lines = engine_lines,
        targeted = targeted,
        opening_context = opening_context,
        chat_history = chat_history,
        reference_context = reference_context,
        correction_notes = correction_notes,
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
    let game_analysis = format_game_analysis(&request.game_analysis);
    let critical_positions = format_critical_game_positions(request);
    let chat_history = format_chat_history(&request.chat_history);
    let reference_context = format_reference_context(reference_context);
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
- The stronger coach model will only receive the PGN scope you choose, so do not choose "current_line" for whole-game review wording like "analyse this game".
- Stockfish is the source of truth. Be generous: it is better to request too many relevant Stockfish lines than too few.
- analyse_move, compare_moves, and analyse_line requests must start from the exact current FEN. Do not invent later FENs.
- Exception: if the user explicitly refers to a supplied Position/reference context item, requests may use that item's exact FEN. Treat those FENs as vetted anchors, not invented positions.
- For whole-game review questions, inspect the Critical whole-game positions list. Request analyse_position for the most important blunders/mistakes so the coach can explain what should have been played instead of only what went wrong. Use the listed before-move FEN exactly.
- analyse_position is only allowed for the exact current FEN, an exact before-move FEN listed in Critical whole-game positions, or an exact FEN from Position/reference context.
- For a move from the current position, use analyse_move.
- For references like "after 19.Nexd4" or "the line we discussed after 19.Nexd4", first match the reference against Position/reference context, then request analyse_position or analyse_move from that exact referenced FEN.
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
        reference_context = reference_context,
        question = request.question
    )
}

fn parse_planner_response(output: &str) -> Result<CoachPlannerResponse, CoachError> {
    let json = extract_first_json_object(output).ok_or_else(|| {
        CoachError::GeminiPlannerMalformed("no JSON object was found".to_string())
    })?;
    serde_json::from_str(&json).map_err(|error| {
        CoachError::GeminiPlannerMalformed(format!("{} in `{}`", error, trim_error_text(output)))
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
            validate_analyse_position_fen(coach_request, reference_context, fen)?;
            Ok(format!("analyse_position:{}", fen.trim()))
        }
        StockfishFollowUpRequest::AnalyseMove { fen, mv, .. } => {
            validate_follow_up_fen(&coach_request.fen, reference_context, fen)?;
            let (uci, _) = parse_single_move(fen, mv)?;
            Ok(format!("analyse_move:{uci}"))
        }
        StockfishFollowUpRequest::CompareMoves { fen, moves, .. } => {
            validate_follow_up_fen(&coach_request.fen, reference_context, fen)?;
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
            Ok(format!("compare_moves:{}", normalized.join(",")))
        }
        StockfishFollowUpRequest::AnalyseLine { fen, line, .. } => {
            validate_follow_up_fen(&coach_request.fen, reference_context, fen)?;
            let moves = parse_line_moves(fen, line)?;
            if moves.is_empty() {
                return Err(CoachError::IllegalStockfishRequest(
                    "analyse_line requires at least one legal move".to_string(),
                ));
            }
            Ok(format!("analyse_line:{}", moves.join(",")))
        }
    }
}

fn validate_analyse_position_fen(
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

    let allowed = select_critical_game_moments(coach_request)
        .into_iter()
        .filter_map(|point| point.before_fen.as_deref())
        .any(|fen| fen.trim() == requested_fen);
    if allowed {
        return Ok(());
    }

    Err(CoachError::IllegalStockfishRequest(
        "analyse_position may only use the current FEN or a listed critical before-move FEN"
            .to_string(),
    ))
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
    format_engine_lines_from(lines, "current FEN")
}

fn format_engine_lines_from(lines: &[CoachEngineLine], origin: &str) -> String {
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
            format!(
                "{}. eval {}, depth {}, full line from {}: {}",
                line.multipv, line.eval, line.depth, origin, pv
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_targeted_result(result: &CoachTargetedResult) -> String {
    format!(
        "{} ({})\nFEN: {}\nMoves: {}\n{}",
        result.label,
        result.reason,
        result.fen,
        if result.moves.is_empty() {
            "None".to_string()
        } else {
            result.moves.join(" ")
        },
        format_engine_lines_from(&result.lines, "this result FEN")
    )
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

    points
        .iter()
        .take(240)
        .map(|point| {
            let eval = point.eval.as_deref().unwrap_or("no eval");
            let depth = point
                .depth
                .map(|value| format!("depth {value}"))
                .unwrap_or_else(|| "depth unknown".to_string());
            let annotations = if point.annotations.is_empty() {
                String::new()
            } else {
                format!(", annotations {}", point.annotations.join(" "))
            };
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
                "Ply {ply}: {mv}, {eval}, {depth}{annotations}{played}{side}{before_fen}",
                ply = point.ply,
                mv = point.mv,
                eval = eval,
                depth = depth,
                annotations = annotations,
                played = played,
                side = side,
                before_fen = before_fen
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_critical_game_positions(request: &AiCoachRequest) -> String {
    let moments = select_critical_game_moments_any_scope(request);
    if moments.is_empty() {
        return "None selected.".to_string();
    }

    moments
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
            let annotation = if point.annotations.is_empty() {
                "no annotation".to_string()
            } else {
                point.annotations.join(" ")
            };
            let eval = point.eval.as_deref().unwrap_or("no played-move eval");
            format!(
                "Ply {ply}: {side} played {mv}{played_uci}, annotation {annotation}, played-move eval {eval}. analyse_position FEN: {before_fen}",
                ply = point.ply,
                side = side,
                mv = point.mv,
                played_uci = played_uci,
                annotation = annotation,
                eval = eval,
                before_fen = before_fen
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn infer_whole_game_critical_stockfish_requests(
    request: &AiCoachRequest,
) -> Vec<StockfishFollowUpRequest> {
    if request.pgn_scope.trim() != "whole_game" {
        return Vec::new();
    }

    select_critical_game_moments(request)
        .into_iter()
        .filter_map(|point| {
            let before_fen = point.before_fen.as_deref()?.trim();
            if before_fen.is_empty() {
                return None;
            }
            let side = point
                .played_side
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("the side to move");
            let annotation = if point.annotations.is_empty() {
                "critical move".to_string()
            } else {
                point.annotations.join(" ")
            };
            Some(StockfishFollowUpRequest::AnalysePosition {
                fen: before_fen.to_string(),
                label: format!("Critical ply {} before {}", point.ply, point.mv),
                reason: format!(
                    "Whole-game review should explain what {side} should have played instead of {} at ply {} ({annotation}); ask Stockfish for the best move from the pre-move position, not just for the move that was played.",
                    point.mv, point.ply
                ),
            })
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

fn select_critical_game_moments(request: &AiCoachRequest) -> Vec<&CoachGameAnalysisPoint> {
    if request.pgn_scope.trim() != "whole_game" {
        return Vec::new();
    }

    select_critical_game_moments_any_scope(request)
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

    if let Some(first) = token.chars().next() {
        if matches!(first, 'k' | 'q' | 'r' | 'b' | 'n') {
            token.replace_range(0..first.len_utf8(), &first.to_ascii_uppercase().to_string());
        }
    }

    Some(token)
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
    current_fen: &str,
    reference_context: &[CoachReferenceContext],
    request: StockfishFollowUpRequest,
    multipv: u8,
    timeout_duration: Duration,
    progress: Option<CoachProgressContext<'_>>,
) -> Result<CoachTargetedResult, CoachError> {
    match request {
        StockfishFollowUpRequest::AnalysePosition { fen, label, reason } => {
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
            validate_follow_up_fen(current_fen, reference_context, &fen)?;
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
            validate_follow_up_fen(current_fen, reference_context, &fen)?;
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
            validate_follow_up_fen(current_fen, reference_context, &fen)?;
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
            Ok(CoachTargetedResult {
                request_type: "analyse_line".to_string(),
                reason,
                fen,
                moves,
                label: "After requested line".to_string(),
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
    let requested_move = requested_move.trim();
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

        assert!(prompt.contains("Stockfish is the source of truth"));
        assert!(prompt.contains("Do not output <stockfish_request>"));
        assert!(prompt.contains("What is the plan here?"));
        assert!(prompt.contains("full legal sequence from the current FEN"));
        assert!(prompt.contains("1. eval +0.20, depth 12, full line from current FEN: e4"));
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
        assert!(prompt.contains("Ply 12: Nf3, +0.35, depth 14, annotations ?!"));
    }

    #[test]
    fn whole_game_critical_requests_analyse_best_move_position() {
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

        assert_eq!(requests.len(), 1);
        assert!(matches!(
            &requests[0],
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
