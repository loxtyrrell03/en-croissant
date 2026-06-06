use std::{
    collections::{HashMap, HashSet},
    env,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use shakmaty::{
    san::{San, SanPlus},
    uci::UciMove,
    CastlingMode, Color, EnPassantMode, Position,
};
use specta::Type;
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
const MAX_GEMINI_FOLLOW_UPS: usize = 2;
const MAX_PROACTIVE_STOCKFISH_REQUESTS: usize = 2;
const MAX_PROMPT_PGN_CHARS: usize = 12_000;
const MAX_CHAT_MESSAGE_CHARS: usize = 2_000;
const MAX_GEMINI_ERROR_CHARS: usize = 1_200;

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiCoachRequest {
    pub fen: String,
    pub side_to_move: String,
    pub move_history: Vec<String>,
    pub pgn: Option<String>,
    #[serde(default)]
    pub pgn_scope: String,
    #[serde(default)]
    pub game_analysis: Vec<CoachGameAnalysisPoint>,
    pub selected_move: Option<String>,
    pub question: String,
    #[serde(default)]
    pub chat_history: Vec<CoachChatMessage>,
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
    pub fen: String,
    pub eval: Option<String>,
    pub depth: Option<u32>,
    pub annotations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct CoachOpeningContext {
    pub source: String,
    pub fen: String,
    pub side: String,
    pub total_games: u32,
    pub filters: String,
    pub moves: Vec<CoachOpeningMove>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct CoachOpeningMove {
    pub san: String,
    pub uci: String,
    pub games: u32,
    pub white: u32,
    pub draw: u32,
    pub black: u32,
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

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
enum StockfishFollowUpRequest {
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

#[derive(Debug, thiserror::Error)]
pub enum CoachError {
    #[error("AI Coach is disabled in Settings")]
    Disabled,

    #[error("No Stockfish engine path was provided")]
    MissingEngine,

    #[error("Gemini CLI command not found: {0}")]
    GeminiMissing(String),

    #[error("Gemini CLI appears unauthenticated. Run `gemini` in a terminal and choose Sign in with Google, then try again.")]
    GeminiUnauthenticated,

    #[error("Gemini CLI timed out after {0} seconds")]
    GeminiTimeout(u64),

    #[error("Gemini CLI exited with status {status}: {message}")]
    GeminiFailed { status: String, message: String },

    #[error("Gemini CLI returned an empty response")]
    GeminiEmpty,

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

#[tauri::command]
#[specta::specta]
pub async fn ask_ai_coach(request: AiCoachRequest) -> Result<AiCoachResponse, CoachError> {
    if !request.settings.enabled {
        return Err(CoachError::Disabled);
    }
    if request.engine_path.as_os_str().is_empty() {
        return Err(CoachError::MissingEngine);
    }

    let multipv = request.settings.multipv.clamp(3, 8);
    let timeout_secs = request.settings.timeout_secs.clamp(15, 90);
    let model = request.settings.gemini_model.trim().to_string();
    let model = if model.is_empty() {
        "gemini-3.1-pro-preview".to_string()
    } else {
        model
    };

    let stockfish_lines = if request.existing_lines.len() >= multipv as usize {
        request
            .existing_lines
            .iter()
            .take(multipv as usize)
            .cloned()
            .collect()
    } else {
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

    let mut targeted_results = request.prior_targeted_results.clone();
    for stockfish_request in infer_question_stockfish_requests(&request.fen, &request.question)?
        .into_iter()
        .take(MAX_PROACTIVE_STOCKFISH_REQUESTS)
    {
        let targeted = run_targeted_stockfish_request(
            &request.engine_path,
            &request.fen,
            stockfish_request,
            multipv,
            Duration::from_secs(20),
        )
        .await?;
        targeted_results.push(targeted);
    }
    let prompt = build_coach_prompt(&request, &stockfish_lines, &targeted_results);
    let first_answer = run_gemini_cli(
        &request.settings.gemini_command,
        &model,
        &prompt,
        timeout_secs.into(),
    )
    .await?;

    let mut final_answer = first_answer;
    for _ in 0..MAX_GEMINI_FOLLOW_UPS {
        let Some(stockfish_request) = parse_stockfish_request(&final_answer)? else {
            break;
        };
        let targeted = run_targeted_stockfish_request(
            &request.engine_path,
            &request.fen,
            stockfish_request,
            multipv,
            Duration::from_secs(20),
        )
        .await?;
        targeted_results.push(targeted);
        let follow_up_prompt = build_coach_prompt(&request, &stockfish_lines, &targeted_results);
        final_answer = run_gemini_cli(
            &request.settings.gemini_command,
            &model,
            &follow_up_prompt,
            timeout_secs.into(),
        )
        .await?;
    }

    if parse_stockfish_request(&final_answer)?.is_some() {
        return Err(CoachError::IllegalStockfishRequest(
            "Gemini asked for more Stockfish data after the follow-up limit".to_string(),
        ));
    }
    validate_answer_line_blocks(
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
) -> String {
    let pgn = request
        .pgn
        .as_deref()
        .map(trim_prompt_text)
        .unwrap_or_else(|| "Unavailable".to_string());
    let pgn_scope = match request.pgn_scope.trim() {
        "whole_game" => "whole game PGN",
        _ => "current line PGN up to this position",
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
    let opening_context = format_opening_context(
        request.opening_context.as_ref(),
        request.opening_context_error.as_deref(),
    );
    let game_analysis = format_game_analysis(&request.game_analysis);

    format!(
        r#"Role: You are a chess coach explaining a position.

Core rules:
- Stockfish is the source of truth.
- Never invent concrete tactics, evaluations, plans, or variations. Any concrete move line or plan you recommend must be backed by supplied Stockfish MultiPV or targeted Stockfish results.
- You may use general chess and opening knowledge for concepts, structures, plans, and naming, but only as explanation layered on top of Stockfish-backed lines.
- Explain like a strong GM/coach: use proper chess terminology such as isolated queen's pawn, minority attack, deflection, trapped piece, blockade, weak square, exchange sacrifice, or domination when it genuinely fits.
- Treat Lichess All opening stats and blended strength as practical/popularity evidence only. Use it when relevant to opening choice, repertoire, popularity, or practical results; do not treat it as a tactical proof.
- Do not use tools, shell commands, files, network lookups, or external resources. If you need more chess data, use only the Stockfish request protocol below.
- If the user asks "what if", "why not", "why is X better than Y", "what happens after ...", or names a move/line that is not covered by the supplied engine data, request targeted Stockfish analysis before answering. It is better to ask for more Stockfish data than to guess.
- If the supplied lines do not answer the user's question, request targeted Stockfish analysis using exactly one XML/JSON block and no other text:
<stockfish_request>
{{"type":"analyse_move","fen":"...","move":"Bxd4","reason":"The user asked why Bxd4 does not work, but it was not covered by the initial MultiPV."}}
</stockfish_request>
- Supported Stockfish request types are analyse_move, compare_moves, and analyse_line.
- For compare_moves, use {{"type":"compare_moves","fen":"...","moves":["Nf3","c4"],"reason":"..."}}.
- For analyse_line, use {{"type":"analyse_line","fen":"...","line":"Nf3 d5 c4","reason":"..."}}.
- The fen inside a Stockfish request must be exactly the current FEN below. To analyse a later position, use analyse_line from the current FEN.
- Use the conversation history to answer follow-up questions naturally.
- All Stockfish PVs supplied below are full sequences from the current FEN. Targeted "After ..." results already include the requested move or requested line before the continuation.
- When you give a concrete playable variation in your final answer, wrap only the moves in <line>...</line>. Do not wrap prose. Only include a <line> block when that exact line is a full legal sequence from the current FEN and is a prefix of Stockfish data supplied here.
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
        question = request.question.as_str(),
    )
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
                "{}. eval {}, depth {}, full line from current FEN: {}",
                line.multipv, line.eval, line.depth, pv
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
        format_engine_lines(&result.lines)
    )
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
            format!(
                "Ply {ply}: {mv}, {eval}, {depth}{annotations}",
                ply = point.ply,
                mv = point.mv,
                eval = eval,
                depth = depth,
                annotations = annotations
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
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

    let supported_lines = collect_supported_engine_lines(stockfish_lines, targeted_results);
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
    stockfish_lines: &[CoachEngineLine],
    targeted_results: &[CoachTargetedResult],
) -> Vec<Vec<String>> {
    stockfish_lines
        .iter()
        .chain(
            targeted_results
                .iter()
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

async fn run_targeted_stockfish_request(
    engine_path: &Path,
    current_fen: &str,
    request: StockfishFollowUpRequest,
    multipv: u8,
    timeout_duration: Duration,
) -> Result<CoachTargetedResult, CoachError> {
    match request {
        StockfishFollowUpRequest::AnalyseMove { fen, mv, reason } => {
            validate_follow_up_fen(current_fen, &fen)?;
            let (uci, san) = parse_single_move(&fen, &mv)?;
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
            validate_follow_up_fen(current_fen, &fen)?;
            if moves.is_empty() || moves.len() > 5 {
                return Err(CoachError::IllegalStockfishRequest(
                    "compare_moves requires 1 to 5 moves".to_string(),
                ));
            }
            let mut combined = Vec::new();
            let mut labels = Vec::new();
            let per_move_multipv = multipv.min(5);
            for requested_move in moves {
                let (uci, san) = parse_single_move(&fen, &requested_move)?;
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
            validate_follow_up_fen(current_fen, &fen)?;
            let moves = parse_line_moves(&fen, &line)?;
            let san_moves = san_for_uci_line(&fen, &moves)?;
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

fn validate_follow_up_fen(current_fen: &str, requested_fen: &str) -> Result<(), CoachError> {
    if requested_fen.trim() == current_fen.trim() {
        return Ok(());
    }

    Err(CoachError::IllegalStockfishRequest(
        "Stockfish requests must use the current FEN; use analyse_line to inspect a later position"
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
    let mut child = Command::new(&resolved_command)
        .current_dir(temp_dir.path())
        .arg("--skip-trust")
        .arg("--approval-mode")
        .arg("plan")
        .arg("--output-format")
        .arg("text")
        .arg("--model")
        .arg(model)
        .arg("--prompt")
        .arg("Use the complete chess coaching request supplied on stdin.")
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
    let combined = format!("{stdout}\n{stderr}");
    if looks_unauthenticated(&combined) {
        return Err(CoachError::GeminiUnauthenticated);
    }
    if !status.success() {
        return Err(CoachError::GeminiFailed {
            status: status.to_string(),
            message: trim_error_text(&combined),
        });
    }

    let cleaned = clean_gemini_output(&stdout);
    if cleaned.trim().is_empty() {
        return Err(CoachError::GeminiEmpty);
    }
    Ok(cleaned)
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
        || (output.contains("gemini_api_key") && output.contains("auth"))
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
            fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".to_string(),
            side_to_move: "white".to_string(),
            move_history: Vec::new(),
            pgn: Some("[Event \"?\"]\n\n*".to_string()),
            pgn_scope: "current_line".to_string(),
            game_analysis: Vec::new(),
            selected_move: Some("Current node".to_string()),
            question: "What is the plan here?".to_string(),
            chat_history: Vec::new(),
            existing_lines: Vec::new(),
            prior_targeted_results: Vec::new(),
            opening_context: None,
            opening_context_error: None,
            engine_path: PathBuf::from("stockfish"),
            settings: AiCoachSettings {
                enabled: true,
                gemini_command: "gemini".to_string(),
                gemini_model: "gemini-3.1-pro-preview".to_string(),
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
        );

        assert!(prompt.contains("Stockfish is the source of truth"));
        assert!(prompt.contains("<stockfish_request>"));
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
            total_games: 1000,
            filters: "ratings 1800+".to_string(),
            moves: vec![CoachOpeningMove {
                san: "e4".to_string(),
                uci: "e2e4".to_string(),
                games: 500,
                white: 220,
                draw: 120,
                black: 160,
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

        let prompt = build_coach_prompt(&request, &[], &[]);

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
            fen: request.fen.clone(),
            eval: Some("+0.35".to_string()),
            depth: Some(14),
            annotations: vec!["?!".to_string()],
        }];

        let prompt = build_coach_prompt(&request, &[], &[]);

        assert!(prompt.contains("PGN context (whole game PGN)"));
        assert!(prompt.contains("Ply 12: Nf3, +0.35, depth 14, annotations ?!"));
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
            "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
        )
        .unwrap_err();

        assert!(error.to_string().contains("current FEN"));
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
