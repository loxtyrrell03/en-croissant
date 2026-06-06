use std::{
    collections::HashMap,
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
const MAX_GEMINI_FOLLOW_UPS: usize = 1;
const MAX_PROMPT_PGN_CHARS: usize = 12_000;
const MAX_GEMINI_ERROR_CHARS: usize = 1_200;

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiCoachRequest {
    pub fen: String,
    pub side_to_move: String,
    pub move_history: Vec<String>,
    pub pgn: Option<String>,
    pub selected_move: Option<String>,
    pub question: String,
    pub existing_lines: Vec<CoachEngineLine>,
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
    pub timeout_secs: u64,
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

    let multipv = request.settings.multipv.clamp(3, 5);
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

    let prompt = build_coach_prompt(&request, &stockfish_lines, &[]);
    let first_answer = run_gemini_cli(
        &request.settings.gemini_command,
        &model,
        &prompt,
        timeout_secs,
    )
    .await?;

    let mut targeted_results = Vec::new();
    let mut final_answer = first_answer;
    for _ in 0..MAX_GEMINI_FOLLOW_UPS {
        let Some(stockfish_request) = parse_stockfish_request(&final_answer)? else {
            break;
        };
        let targeted = run_targeted_stockfish_request(
            &request.engine_path,
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
            timeout_secs,
        )
        .await?;
    }

    if parse_stockfish_request(&final_answer)?.is_some() {
        return Err(CoachError::IllegalStockfishRequest(
            "Gemini asked for more Stockfish data after the follow-up limit".to_string(),
        ));
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
) -> String {
    let pgn = request
        .pgn
        .as_deref()
        .map(trim_prompt_text)
        .unwrap_or_else(|| "Unavailable".to_string());
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

    format!(
        r#"Role: You are a chess coach explaining a position.

Core rules:
- Stockfish is the source of truth.
- Do not invent tactics, evaluations, or variations not supported by supplied engine data.
- Do not use tools, shell commands, files, network lookups, or external resources. If you need more chess data, use only the Stockfish request protocol below.
- If the supplied lines do not answer the user's question, request targeted Stockfish analysis using exactly one XML/JSON block and no other text:
<stockfish_request>
{{"type":"analyse_move","fen":"...","move":"Bxd4","reason":"The user asked why Bxd4 does not work, but it was not covered by the initial MultiPV."}}
</stockfish_request>
- Supported Stockfish request types are analyse_move, compare_moves, and analyse_line.
- For compare_moves, use {{"type":"compare_moves","fen":"...","moves":["Nf3","c4"],"reason":"..."}}.
- For analyse_line, use {{"type":"analyse_line","fen":"...","line":"Nf3 d5 c4","reason":"..."}}.
- Keep answers concise unless the user asks for depth.
- Prefer this final answer shape: Direct answer; Key reason; Main line or two; Human plan/lesson; Optional training takeaway.

Position:
FEN: {fen}
Side to move: {side_to_move}
Selected move/current node: {selected_move}
Move history in UCI: {move_history}

PGN context:
{pgn}

Stockfish MultiPV:
{engine_lines}

Targeted Stockfish result:
{targeted}

User question:
{question}
"#,
        fen = request.fen,
        side_to_move = request.side_to_move,
        selected_move = selected_move,
        move_history = move_history,
        pgn = pgn,
        engine_lines = engine_lines,
        targeted = targeted,
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
                "{}. eval {}, depth {}, PV: {}",
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

async fn run_targeted_stockfish_request(
    engine_path: &Path,
    request: StockfishFollowUpRequest,
    multipv: u8,
    timeout_duration: Duration,
) -> Result<CoachTargetedResult, CoachError> {
    match request {
        StockfishFollowUpRequest::AnalyseMove { fen, mv, reason } => {
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
            if moves.is_empty() || moves.len() > 5 {
                return Err(CoachError::IllegalStockfishRequest(
                    "compare_moves requires 1 to 5 moves".to_string(),
                ));
            }
            let mut combined = Vec::new();
            let mut labels = Vec::new();
            let per_move_multipv = multipv.min(3);
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
            let moves = parse_line_moves(&fen, &line)?;
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
    let multipv = multipv.clamp(1, 5);
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

    let temp_dir = tempdir()?;
    let mut child = Command::new(command)
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
                CoachError::GeminiMissing(command.to_string())
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
            selected_move: Some("Current node".to_string()),
            question: "What is the plan here?".to_string(),
            existing_lines: Vec::new(),
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
        assert!(prompt.contains("1. eval +0.20, depth 12, PV: e4"));
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
}
