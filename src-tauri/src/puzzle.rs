use std::{
    collections::VecDeque,
    fs::{copy, create_dir_all, remove_file},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use chrono::{DateTime, Duration, Utc};
use once_cell::sync::Lazy;
use rusqlite::{params, Connection as RusqliteConnection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::Manager;

use crate::{db::Puzzle, error::Error};

const DEFAULT_PUZZLE_ELO: f64 = 1500.0;
const DEFAULT_THEME_SKILL: f64 = 1500.0;
const DEFAULT_EASE: f64 = 2.5;
const MIN_EASE: f64 = 1.3;
const FIRST_ATTEMPT_K: f64 = 36.0;
const REVIEW_ATTEMPT_K: f64 = 12.0;
const THEME_FIRST_ATTEMPT_K: f64 = 24.0;
const THEME_REVIEW_ATTEMPT_K: f64 = 8.0;
const DAY_MS: i64 = 24 * 60 * 60 * 1000;
const MINUTE_MS: i64 = 60 * 1000;
const SLOW_SOLVE_MS: i64 = 180_000;
const WEAK_THEME_THRESHOLD: f64 = 100.0;

#[derive(Debug)]
struct PuzzleCache {
    cache: VecDeque<Puzzle>,
    counter: usize,
    file: String,
    min_rating: u16,
    max_rating: u16,
    theme: Option<String>,
}

impl PuzzleCache {
    fn new() -> Self {
        Self {
            cache: VecDeque::new(),
            counter: 0,
            file: String::new(),
            min_rating: 0,
            max_rating: 0,
            theme: None,
        }
    }

    fn get_puzzles(
        &mut self,
        file: &str,
        min_rating: u16,
        max_rating: u16,
        theme: &Option<String>,
    ) -> Result<(), Error> {
        if self.cache.is_empty()
            || self.file != file
            || self.min_rating != min_rating
            || self.max_rating != max_rating
            || self.theme != *theme
            || self.counter >= 20
        {
            self.cache.clear();
            self.counter = 0;

            let db = open_puzzle_database(file)?;
            let new_puzzles =
                load_random_puzzles(&db, min_rating, max_rating, theme.as_deref(), 20)?;

            self.cache = new_puzzles.into_iter().collect();
            self.file = file.to_string();
            self.min_rating = min_rating;
            self.max_rating = max_rating;
            self.theme = theme.clone();
        }

        Ok(())
    }

    fn get_next_puzzle(&mut self) -> Option<Puzzle> {
        if let Some(puzzle) = self.cache.get(self.counter) {
            self.counter += 1;
            Some(puzzle.clone())
        } else {
            None
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn get_puzzle(
    file: String,
    min_rating: u16,
    max_rating: u16,
    theme: Option<String>,
) -> Result<Puzzle, Error> {
    static PUZZLE_CACHE: Lazy<Mutex<PuzzleCache>> = Lazy::new(|| Mutex::new(PuzzleCache::new()));

    let mut cache = PUZZLE_CACHE.lock().unwrap();
    cache.get_puzzles(&file, min_rating, max_rating, &theme)?;
    cache.get_next_puzzle().ok_or(Error::NoPuzzles)
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleDatabaseInfo {
    title: String,
    description: String,
    puzzle_count: i32,
    storage_size: u64,
    path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PuzzleTrainingMode {
    Coach,
    SrsReview,
    ThemeFocus,
    RatingLadder,
    Random,
}

impl PuzzleTrainingMode {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Coach => "coach",
            Self::SrsReview => "srsReview",
            Self::ThemeFocus => "themeFocus",
            Self::RatingLadder => "ratingLadder",
            Self::Random => "random",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PuzzleAttemptOutcome {
    Correct,
    Incorrect,
}

impl PuzzleAttemptOutcome {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Correct => "correct",
            Self::Incorrect => "incorrect",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PuzzleAttemptQuality {
    Failed,
    Assisted,
    Hard,
    Solid,
    Fluent,
}

impl PuzzleAttemptQuality {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Failed => "failed",
            Self::Assisted => "assisted",
            Self::Hard => "hard",
            Self::Solid => "solid",
            Self::Fluent => "fluent",
        }
    }

    fn from_str(value: &str) -> Self {
        match value {
            "assisted" => Self::Assisted,
            "hard" => Self::Hard,
            "solid" => Self::Solid,
            "fluent" => Self::Fluent,
            _ => Self::Failed,
        }
    }

    fn is_clean_success(&self) -> bool {
        matches!(self, Self::Hard | Self::Solid | Self::Fluent)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PuzzleSrsState {
    New,
    Learning,
    Relearning,
    Review,
    Mastered,
}

impl PuzzleSrsState {
    fn as_str(&self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Learning => "learning",
            Self::Relearning => "relearning",
            Self::Review => "review",
            Self::Mastered => "mastered",
        }
    }

    fn from_str(value: &str) -> Self {
        match value {
            "learning" => Self::Learning,
            "relearning" => Self::Relearning,
            "review" => Self::Review,
            "mastered" => Self::Mastered,
            _ => Self::New,
        }
    }
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleProgressSummary {
    db_key: String,
    puzzle_elo: f64,
    total_attempts: i64,
    correct_attempts: i64,
    accuracy: f64,
    due: i64,
    learning: i64,
    review: i64,
    mastered: i64,
    themes_tracked: i64,
    updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleCardProgress {
    puzzle_id: i32,
    due_at: i64,
    state: PuzzleSrsState,
    reps: i64,
    lapses: i64,
    interval_days: f64,
    ease: f64,
    last_attempt_at: Option<i64>,
    total_attempts: i64,
    correct_attempts: i64,
    last_quality: PuzzleAttemptQuality,
    mastered: bool,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleTrainingCandidate {
    puzzle: Puzzle,
    themes: Vec<String>,
    mode: PuzzleTrainingMode,
    reason: String,
    db_key: String,
    progress: Option<PuzzleCardProgress>,
}

#[derive(Clone, Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleAttemptInput {
    puzzle_id: i32,
    mode: PuzzleTrainingMode,
    outcome: PuzzleAttemptOutcome,
    time_spent_ms: i64,
    used_hint: bool,
    viewed_solution: bool,
    wrong_moves: i64,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleThemeDelta {
    theme: String,
    skill_before: f64,
    skill_after: f64,
    skill_delta: f64,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleAttemptResult {
    summary: PuzzleProgressSummary,
    card: PuzzleCardProgress,
    themes: Vec<String>,
    elo_before: f64,
    elo_after: f64,
    elo_delta: f64,
    attempt_quality: PuzzleAttemptQuality,
    theme_deltas: Vec<PuzzleThemeDelta>,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleThemeStatsRow {
    theme: String,
    attempts: i64,
    correct: i64,
    accuracy: f64,
    average_time_ms: f64,
    skill: f64,
    weakness_score: f64,
    recent_attempts: i64,
    recent_accuracy: f64,
    due: i64,
    mastered: i64,
    last_attempt_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleTrendPoint {
    date_key: String,
    puzzle_elo: f64,
    attempts: i64,
    accuracy: f64,
    solved: i64,
    due: i64,
    mastered: i64,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleSrsQueueRow {
    puzzle_id: i32,
    rating: i32,
    themes: Vec<String>,
    due_at: i64,
    state: PuzzleSrsState,
    reps: i64,
    lapses: i64,
    interval_days: f64,
    total_attempts: i64,
    correct_attempts: i64,
    last_quality: PuzzleAttemptQuality,
    mastered: bool,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleSrsCounts {
    learning: i64,
    relearning: i64,
    review: i64,
    mastered: i64,
    due: i64,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleDashboard {
    summary: PuzzleProgressSummary,
    themes: Vec<PuzzleThemeStatsRow>,
    trends: Vec<PuzzleTrendPoint>,
    srs_counts: PuzzleSrsCounts,
    due_cards: Vec<PuzzleSrsQueueRow>,
}

#[tauri::command]
#[specta::specta]
pub async fn get_puzzle_db_info(file: PathBuf) -> Result<PuzzleDatabaseInfo, Error> {
    let path = file;

    let conn = open_puzzle_database_path(&path)?;
    let puzzle_count = puzzle_count_from_conn(&conn)? as i32;

    let storage_size = path.metadata()?.len();
    let filename = path.file_name().expect("get filename").to_string_lossy();

    Ok(PuzzleDatabaseInfo {
        title: filename.to_string(),
        description: "".to_string(),
        puzzle_count,
        storage_size,
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
#[specta::specta]
pub fn delete_puzzle_database(file: String) -> Result<(), Error> {
    remove_file(&file)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_puzzle_themes(file: String) -> Result<Vec<String>, Error> {
    let conn = open_puzzle_database(&file)?;
    let mut stmt = match conn.prepare("SELECT name FROM themes ORDER BY name ASC") {
        Ok(stmt) => stmt,
        Err(error) if is_missing_sqlite_table(&error) => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let themes = stmt
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<String>, _>>()?;
    Ok(themes)
}

#[tauri::command]
#[specta::specta]
pub fn get_themes_for_puzzle(file: String, puzzle_id: i32) -> Result<Vec<String>, Error> {
    let conn = open_puzzle_database(&file)?;
    get_themes_for_puzzle_rusqlite(&conn, puzzle_id)
}

#[tauri::command]
#[specta::specta]
pub fn get_puzzle_progress(
    file: String,
    app: tauri::AppHandle,
) -> Result<PuzzleProgressSummary, Error> {
    let db_key = puzzle_db_key(&file)?;
    let conn = open_progress_connection(&app)?;
    ensure_profile(&conn, &db_key)?;
    get_progress_summary(&conn, &db_key)
}

#[tauri::command]
#[specta::specta]
pub fn get_training_puzzle(
    file: String,
    mode: PuzzleTrainingMode,
    min_rating: u16,
    max_rating: u16,
    theme: Option<String>,
    app: tauri::AppHandle,
) -> Result<PuzzleTrainingCandidate, Error> {
    let db_key = puzzle_db_key(&file)?;
    let progress_conn = open_progress_connection(&app)?;
    ensure_profile(&progress_conn, &db_key)?;
    let puzzle_conn = open_puzzle_database(&file)?;
    let elo = get_profile_elo(&progress_conn, &db_key)?;

    let mut candidate = match mode {
        PuzzleTrainingMode::Coach => choose_coach_puzzle(
            &progress_conn,
            &puzzle_conn,
            &db_key,
            elo,
            min_rating,
            max_rating,
        )?,
        PuzzleTrainingMode::SrsReview => {
            if let Some(candidate) = choose_due_puzzle(
                &progress_conn,
                &puzzle_conn,
                &db_key,
                false,
                PuzzleTrainingMode::SrsReview,
                "Due review".to_string(),
            )? {
                Some(candidate)
            } else {
                random_candidate(
                    &progress_conn,
                    &puzzle_conn,
                    &db_key,
                    min_rating,
                    max_rating,
                    theme.as_deref(),
                    PuzzleTrainingMode::SrsReview,
                    "No due reviews; serving a fresh puzzle".to_string(),
                )?
            }
        }
        PuzzleTrainingMode::ThemeFocus => random_candidate(
            &progress_conn,
            &puzzle_conn,
            &db_key,
            min_rating,
            max_rating,
            theme.as_deref(),
            PuzzleTrainingMode::ThemeFocus,
            theme
                .as_ref()
                .map(|theme| format!("Theme focus: {theme}"))
                .unwrap_or_else(|| "Theme focus".to_string()),
        )?,
        PuzzleTrainingMode::RatingLadder => {
            let (low, high) = elo_rating_window(elo, -50, 175);
            random_candidate(
                &progress_conn,
                &puzzle_conn,
                &db_key,
                low,
                high,
                theme.as_deref(),
                PuzzleTrainingMode::RatingLadder,
                "Rating ladder".to_string(),
            )?
        }
        PuzzleTrainingMode::Random => random_candidate(
            &progress_conn,
            &puzzle_conn,
            &db_key,
            min_rating,
            max_rating,
            theme.as_deref(),
            PuzzleTrainingMode::Random,
            "Random puzzle".to_string(),
        )?,
    };

    if candidate.is_none() {
        candidate = fallback_training_candidate(
            &progress_conn,
            &puzzle_conn,
            &db_key,
            min_rating,
            max_rating,
            theme.as_deref(),
            mode,
        )?;
    }

    candidate.ok_or(Error::NoPuzzles)
}

#[tauri::command]
#[specta::specta]
pub fn record_puzzle_attempt(
    file: String,
    input: PuzzleAttemptInput,
    app: tauri::AppHandle,
) -> Result<PuzzleAttemptResult, Error> {
    let db_key = puzzle_db_key(&file)?;
    let mut progress_conn = open_progress_connection(&app)?;
    ensure_profile(&progress_conn, &db_key)?;
    let puzzle_conn = open_puzzle_database(&file)?;
    let puzzle = load_puzzle_by_id(&puzzle_conn, input.puzzle_id)?.ok_or(Error::NoPuzzles)?;
    let themes = get_themes_for_puzzle_rusqlite(&puzzle_conn, input.puzzle_id)?;
    let now = now_ms();
    let tx = progress_conn.transaction()?;
    let before_card = get_card_progress(&tx, &db_key, input.puzzle_id)?;
    let elo_before = get_profile_elo(&tx, &db_key)?;
    let attempt_quality =
        classify_puzzle_attempt(&tx, &db_key, &input, puzzle.rating, elo_before, &themes)?;
    let success = attempt_quality.is_clean_success();
    let first_rated_attempt = before_card
        .as_ref()
        .map(|card| card.total_attempts == 0)
        .unwrap_or(true);
    let k = if first_rated_attempt {
        FIRST_ATTEMPT_K
    } else {
        REVIEW_ATTEMPT_K
    };
    let elo_delta = calculate_elo_delta(elo_before, puzzle.rating as f64, success, k);
    let elo_after = (elo_before + elo_delta).max(100.0);
    let card = schedule_puzzle_card(before_card, input.puzzle_id, &attempt_quality, now);
    let themes_json = serde_json::to_string(&themes).unwrap_or_else(|_| "[]".to_string());

    tx.execute(
        "INSERT INTO puzzle_attempts
            (db_key, puzzle_id, attempted_at, mode, outcome, puzzle_rating, elo_before,
             elo_after, elo_delta, time_spent_ms, used_hint, viewed_solution, wrong_moves,
             attempt_quality, themes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            db_key,
            input.puzzle_id,
            now,
            input.mode.as_str(),
            input.outcome.as_str(),
            puzzle.rating,
            elo_before,
            elo_after,
            elo_delta,
            input.time_spent_ms.max(0),
            input.used_hint,
            input.viewed_solution,
            input.wrong_moves.max(0),
            attempt_quality.as_str(),
            themes_json,
        ],
    )?;
    tx.execute(
        "INSERT INTO puzzle_cards
            (db_key, puzzle_id, due_at, state, reps, lapses, interval_days, ease,
             last_attempt_at, total_attempts, correct_attempts, last_quality, mastered)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(db_key, puzzle_id) DO UPDATE SET
            due_at = excluded.due_at,
            state = excluded.state,
            reps = excluded.reps,
            lapses = excluded.lapses,
            interval_days = excluded.interval_days,
            ease = excluded.ease,
            last_attempt_at = excluded.last_attempt_at,
            total_attempts = excluded.total_attempts,
            correct_attempts = excluded.correct_attempts,
            last_quality = excluded.last_quality,
            mastered = excluded.mastered",
        params![
            db_key,
            card.puzzle_id,
            card.due_at,
            card.state.as_str(),
            card.reps,
            card.lapses,
            card.interval_days,
            card.ease,
            card.last_attempt_at,
            card.total_attempts,
            card.correct_attempts,
            card.last_quality.as_str(),
            card.mastered,
        ],
    )?;

    let mut theme_deltas = Vec::new();
    for theme in themes.iter().filter(|theme| is_training_theme(theme)) {
        let delta = update_theme_stats(
            &tx,
            &db_key,
            theme,
            success,
            first_rated_attempt,
            puzzle.rating,
            input.time_spent_ms.max(0),
            now,
            elo_after,
        )?;
        theme_deltas.push(delta);
    }

    tx.execute(
        "UPDATE puzzle_profiles SET puzzle_elo = ?2, updated_at = ?3 WHERE db_key = ?1",
        params![db_key, elo_after, now],
    )?;
    refresh_daily_snapshot(&tx, &db_key, now, elo_after)?;
    tx.commit()?;

    let summary = get_progress_summary(&progress_conn, &db_key)?;
    Ok(PuzzleAttemptResult {
        summary,
        card,
        themes,
        elo_before,
        elo_after,
        elo_delta,
        attempt_quality,
        theme_deltas,
    })
}

#[tauri::command]
#[specta::specta]
pub fn get_puzzle_dashboard(
    file: String,
    days: Option<u16>,
    app: tauri::AppHandle,
) -> Result<PuzzleDashboard, Error> {
    let db_key = puzzle_db_key(&file)?;
    let conn = open_progress_connection(&app)?;
    ensure_profile(&conn, &db_key)?;
    let puzzle_conn = open_puzzle_database(&file)?;
    let summary = get_progress_summary(&conn, &db_key)?;
    let themes = get_theme_rows(&conn, &db_key)?;
    let trends = get_trend_points(&conn, &db_key, days.unwrap_or(90))?;
    let srs_counts = get_srs_counts(&conn, &db_key)?;
    let due_cards = get_due_queue(&conn, &puzzle_conn, &db_key, 30)?;

    Ok(PuzzleDashboard {
        summary,
        themes,
        trends,
        srs_counts,
        due_cards,
    })
}

#[tauri::command]
#[specta::specta]
pub fn reset_puzzle_progress(
    file: String,
    app: tauri::AppHandle,
) -> Result<PuzzleProgressSummary, Error> {
    let db_key = puzzle_db_key(&file)?;
    let mut conn = open_progress_connection(&app)?;
    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM puzzle_attempts WHERE db_key = ?1",
        params![db_key],
    )?;
    tx.execute(
        "DELETE FROM puzzle_cards WHERE db_key = ?1",
        params![db_key],
    )?;
    tx.execute(
        "DELETE FROM puzzle_theme_stats WHERE db_key = ?1",
        params![db_key],
    )?;
    tx.execute(
        "DELETE FROM puzzle_daily_snapshots WHERE db_key = ?1",
        params![db_key],
    )?;
    tx.execute(
        "DELETE FROM puzzle_profiles WHERE db_key = ?1",
        params![db_key],
    )?;
    tx.commit()?;
    ensure_profile(&conn, &db_key)?;
    get_progress_summary(&conn, &db_key)
}

#[tauri::command]
#[specta::specta]
pub fn export_puzzle_progress(
    file: String,
    target_file: String,
    app: tauri::AppHandle,
) -> Result<(), Error> {
    let db_key = puzzle_db_key(&file)?;
    let conn = open_progress_connection(&app)?;
    ensure_profile(&conn, &db_key)?;
    let summary = get_progress_summary(&conn, &db_key)?;
    let themes = get_theme_rows(&conn, &db_key)?;
    let trends = get_trend_points(&conn, &db_key, 3650)?;
    let value = serde_json::json!({
        "version": 1,
        "dbKey": db_key,
        "exportedAt": now_ms(),
        "summary": summary,
        "themes": themes,
        "trends": trends,
    });
    std::fs::write(target_file, serde_json::to_string_pretty(&value).unwrap())?;
    Ok(())
}

fn progress_db_path(app: &tauri::AppHandle) -> Result<PathBuf, Error> {
    let app_data_dir = app.path().app_data_dir()?;
    let dir = app_data_dir.join("progress");
    create_dir_all(&dir)?;
    let path = dir.join("puzzle-progress.db3");
    let old_path = app_data_dir.join("puzzles").join("puzzle-progress.db3");
    if !path.is_file() && old_path.is_file() {
        let _ = copy(old_path, &path);
    }
    Ok(path)
}

fn open_progress_connection(app: &tauri::AppHandle) -> Result<RusqliteConnection, Error> {
    let app_data_dir = app.path().app_data_dir()?;
    let path = progress_db_path(app)?;
    let conn = RusqliteConnection::open(&path)?;
    init_progress_schema(&conn)?;
    let old_path = app_data_dir.join("puzzles").join("puzzle-progress.db3");
    merge_legacy_progress_database(&conn, &path, &old_path)?;
    Ok(conn)
}

fn merge_legacy_progress_database(
    conn: &RusqliteConnection,
    current_path: &Path,
    old_path: &Path,
) -> Result<(), Error> {
    if !old_path.is_file() || same_file_path(current_path, old_path) {
        return Ok(());
    }

    let legacy_conn = RusqliteConnection::open(old_path)?;
    init_progress_schema(&legacy_conn)?;
    drop(legacy_conn);

    let old_path_string = old_path.to_string_lossy().to_string();
    conn.execute(
        "ATTACH DATABASE ?1 AS legacy_progress",
        params![old_path_string],
    )?;
    let result = merge_attached_legacy_progress(conn);
    let detach_result = conn.execute("DETACH DATABASE legacy_progress", []);

    result?;
    detach_result?;
    Ok(())
}

fn same_file_path(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn merge_attached_legacy_progress(conn: &RusqliteConnection) -> Result<(), Error> {
    conn.execute_batch(
        "
        INSERT INTO puzzle_profiles (db_key, puzzle_elo, created_at, updated_at)
        SELECT db_key, puzzle_elo, created_at, updated_at
        FROM legacy_progress.puzzle_profiles legacy
        WHERE NOT EXISTS (
            SELECT 1 FROM puzzle_profiles current WHERE current.db_key = legacy.db_key
        );

        UPDATE puzzle_profiles
        SET
            puzzle_elo = (
                SELECT legacy.puzzle_elo
                FROM legacy_progress.puzzle_profiles legacy
                WHERE legacy.db_key = puzzle_profiles.db_key
            ),
            updated_at = (
                SELECT legacy.updated_at
                FROM legacy_progress.puzzle_profiles legacy
                WHERE legacy.db_key = puzzle_profiles.db_key
            )
        WHERE EXISTS (
            SELECT 1
            FROM legacy_progress.puzzle_profiles legacy
            WHERE legacy.db_key = puzzle_profiles.db_key
              AND legacy.updated_at > puzzle_profiles.updated_at
        );

        INSERT INTO puzzle_attempts
            (db_key, puzzle_id, attempted_at, mode, outcome, puzzle_rating, elo_before,
             elo_after, elo_delta, time_spent_ms, used_hint, viewed_solution, wrong_moves,
             attempt_quality, themes)
        SELECT legacy.db_key, legacy.puzzle_id, legacy.attempted_at, legacy.mode, legacy.outcome,
               legacy.puzzle_rating, legacy.elo_before, legacy.elo_after, legacy.elo_delta,
               legacy.time_spent_ms, legacy.used_hint, legacy.viewed_solution, legacy.wrong_moves,
               legacy.attempt_quality, legacy.themes
        FROM legacy_progress.puzzle_attempts legacy
        WHERE NOT EXISTS (
            SELECT 1
            FROM puzzle_attempts current
            WHERE current.db_key = legacy.db_key
              AND current.puzzle_id = legacy.puzzle_id
              AND current.attempted_at = legacy.attempted_at
              AND current.mode = legacy.mode
              AND current.outcome = legacy.outcome
              AND current.elo_after = legacy.elo_after
        );

        INSERT INTO puzzle_cards
            (db_key, puzzle_id, due_at, state, reps, lapses, interval_days, ease,
             last_attempt_at, total_attempts, correct_attempts, last_quality, mastered)
        SELECT db_key, puzzle_id, due_at, state, reps, lapses, interval_days, ease,
               last_attempt_at, total_attempts, correct_attempts, last_quality, mastered
        FROM legacy_progress.puzzle_cards
        WHERE true
        ON CONFLICT(db_key, puzzle_id) DO UPDATE SET
            due_at = excluded.due_at,
            state = excluded.state,
            reps = excluded.reps,
            lapses = excluded.lapses,
            interval_days = excluded.interval_days,
            ease = excluded.ease,
            last_attempt_at = excluded.last_attempt_at,
            total_attempts = excluded.total_attempts,
            correct_attempts = excluded.correct_attempts,
            last_quality = excluded.last_quality,
            mastered = excluded.mastered
        WHERE COALESCE(excluded.last_attempt_at, 0) > COALESCE(puzzle_cards.last_attempt_at, 0);

        INSERT INTO puzzle_theme_stats
            (db_key, theme, attempts, correct, total_time_ms, skill, lapses,
             weakness_score, last_attempt_at)
        SELECT db_key, theme, attempts, correct, total_time_ms, skill, lapses,
               weakness_score, last_attempt_at
        FROM legacy_progress.puzzle_theme_stats
        WHERE true
        ON CONFLICT(db_key, theme) DO UPDATE SET
            attempts = excluded.attempts,
            correct = excluded.correct,
            total_time_ms = excluded.total_time_ms,
            skill = excluded.skill,
            lapses = excluded.lapses,
            weakness_score = excluded.weakness_score,
            last_attempt_at = excluded.last_attempt_at
        WHERE COALESCE(excluded.last_attempt_at, 0) > COALESCE(puzzle_theme_stats.last_attempt_at, 0);

        INSERT INTO puzzle_daily_snapshots
            (db_key, date_key, puzzle_elo, attempts, correct, solved, due, mastered, updated_at)
        SELECT db_key, date_key, puzzle_elo, attempts, correct, solved, due, mastered, updated_at
        FROM legacy_progress.puzzle_daily_snapshots
        WHERE true
        ON CONFLICT(db_key, date_key) DO UPDATE SET
            puzzle_elo = excluded.puzzle_elo,
            attempts = excluded.attempts,
            correct = excluded.correct,
            solved = excluded.solved,
            due = excluded.due,
            mastered = excluded.mastered,
            updated_at = excluded.updated_at
        WHERE excluded.updated_at > puzzle_daily_snapshots.updated_at;
        ",
    )?;
    Ok(())
}

fn open_puzzle_database(file: &str) -> Result<RusqliteConnection, Error> {
    open_puzzle_database_path(Path::new(file))
}

fn open_puzzle_database_path(path: &Path) -> Result<RusqliteConnection, Error> {
    if !path.is_file() {
        return Err(Error::InvalidPuzzleDatabase(
            "The selected puzzle database file no longer exists.".to_string(),
        ));
    }

    let conn = RusqliteConnection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(map_rusqlite_puzzle_error)?;
    validate_puzzle_database(&conn)?;
    Ok(conn)
}

fn validate_puzzle_database(conn: &RusqliteConnection) -> Result<(), Error> {
    puzzle_count_from_conn(conn).map(|_| ())
}

fn puzzle_count_from_conn(conn: &RusqliteConnection) -> Result<i64, Error> {
    conn.query_row("SELECT COUNT(*) FROM puzzles", [], |row| row.get(0))
        .map_err(map_rusqlite_puzzle_error)
}

fn map_rusqlite_puzzle_error(error: rusqlite::Error) -> Error {
    if is_missing_sqlite_table(&error) {
        Error::InvalidPuzzleDatabase(
            "This file is not a usable puzzle database. Reinstall or select a Lichess puzzle database."
                .to_string(),
        )
    } else {
        error.into()
    }
}

fn is_missing_sqlite_table(error: &rusqlite::Error) -> bool {
    match error {
        rusqlite::Error::SqliteFailure(_, Some(message)) => message.contains("no such table"),
        _ => error.to_string().contains("no such table"),
    }
}

fn init_progress_schema(conn: &RusqliteConnection) -> Result<(), Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS puzzle_profiles (
            db_key TEXT PRIMARY KEY,
            puzzle_elo REAL NOT NULL DEFAULT 1500,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS puzzle_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            db_key TEXT NOT NULL,
            puzzle_id INTEGER NOT NULL,
            attempted_at INTEGER NOT NULL,
            mode TEXT NOT NULL,
            outcome TEXT NOT NULL,
            puzzle_rating INTEGER NOT NULL,
            elo_before REAL NOT NULL,
            elo_after REAL NOT NULL,
            elo_delta REAL NOT NULL,
            time_spent_ms INTEGER NOT NULL DEFAULT 0,
            used_hint INTEGER NOT NULL DEFAULT 0,
            viewed_solution INTEGER NOT NULL DEFAULT 0,
            wrong_moves INTEGER NOT NULL DEFAULT 0,
            attempt_quality TEXT NOT NULL DEFAULT 'failed',
            themes TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS idx_puzzle_attempts_db_time
            ON puzzle_attempts(db_key, attempted_at);
        CREATE INDEX IF NOT EXISTS idx_puzzle_attempts_db_puzzle
            ON puzzle_attempts(db_key, puzzle_id);
        CREATE TABLE IF NOT EXISTS puzzle_cards (
            db_key TEXT NOT NULL,
            puzzle_id INTEGER NOT NULL,
            due_at INTEGER NOT NULL,
            state TEXT NOT NULL,
            reps INTEGER NOT NULL DEFAULT 0,
            lapses INTEGER NOT NULL DEFAULT 0,
            interval_days REAL NOT NULL DEFAULT 0,
            ease REAL NOT NULL DEFAULT 2.5,
            last_attempt_at INTEGER,
            total_attempts INTEGER NOT NULL DEFAULT 0,
            correct_attempts INTEGER NOT NULL DEFAULT 0,
            last_quality TEXT NOT NULL DEFAULT 'failed',
            mastered INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(db_key, puzzle_id)
        );
        CREATE INDEX IF NOT EXISTS idx_puzzle_cards_db_due
            ON puzzle_cards(db_key, mastered, due_at);
        CREATE TABLE IF NOT EXISTS puzzle_theme_stats (
            db_key TEXT NOT NULL,
            theme TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            correct INTEGER NOT NULL DEFAULT 0,
            total_time_ms INTEGER NOT NULL DEFAULT 0,
            skill REAL NOT NULL DEFAULT 1500,
            lapses INTEGER NOT NULL DEFAULT 0,
            weakness_score REAL NOT NULL DEFAULT 0,
            last_attempt_at INTEGER,
            PRIMARY KEY(db_key, theme)
        );
        CREATE INDEX IF NOT EXISTS idx_puzzle_theme_stats_db_weakness
            ON puzzle_theme_stats(db_key, weakness_score DESC);
        CREATE TABLE IF NOT EXISTS puzzle_daily_snapshots (
            db_key TEXT NOT NULL,
            date_key TEXT NOT NULL,
            puzzle_elo REAL NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            correct INTEGER NOT NULL DEFAULT 0,
            solved INTEGER NOT NULL DEFAULT 0,
            due INTEGER NOT NULL DEFAULT 0,
            mastered INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(db_key, date_key)
        );
        ",
    )?;
    add_column_if_missing(
        conn,
        "puzzle_attempts",
        "wrong_moves",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(
        conn,
        "puzzle_attempts",
        "attempt_quality",
        "TEXT NOT NULL DEFAULT 'failed'",
    )?;
    add_column_if_missing(
        conn,
        "puzzle_cards",
        "last_quality",
        "TEXT NOT NULL DEFAULT 'failed'",
    )?;
    conn.execute(
        "UPDATE puzzle_attempts
         SET attempt_quality = 'solid'
         WHERE attempt_quality = 'failed'
           AND outcome = 'correct'
           AND used_hint = 0
           AND viewed_solution = 0",
        [],
    )?;
    Ok(())
}

fn add_column_if_missing(
    conn: &RusqliteConnection,
    table_name: &str,
    column_name: &str,
    column_definition: &str,
) -> Result<(), Error> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table_name})"))?;
    let exists = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?
        .iter()
        .any(|name| name == column_name);
    if !exists {
        conn.execute(
            &format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}"),
            [],
        )?;
    }
    Ok(())
}

fn ensure_profile(conn: &RusqliteConnection, db_key: &str) -> Result<(), Error> {
    let now = now_ms();
    conn.execute(
        "INSERT OR IGNORE INTO puzzle_profiles (db_key, puzzle_elo, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)",
        params![db_key, DEFAULT_PUZZLE_ELO, now],
    )?;
    refresh_daily_snapshot(conn, db_key, now, get_profile_elo(conn, db_key)?)?;
    Ok(())
}

fn puzzle_db_key(file: &str) -> Result<String, Error> {
    let path = Path::new(file);
    let metadata = path.metadata()?;
    let puzzle_count = puzzle_count_rusqlite(file)?;
    let filename = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| file.to_string());
    Ok(format!(
        "{}:{}:{}",
        filename.replace(':', "_"),
        metadata.len(),
        puzzle_count
    ))
}

fn puzzle_count_rusqlite(file: &str) -> Result<i64, Error> {
    let conn = open_puzzle_database(file)?;
    puzzle_count_from_conn(&conn)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn date_key_from_ms(ms: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(ms)
        .unwrap_or_else(Utc::now)
        .format("%Y-%m-%d")
        .to_string()
}

fn get_profile_elo(conn: &RusqliteConnection, db_key: &str) -> Result<f64, Error> {
    Ok(conn.query_row(
        "SELECT puzzle_elo FROM puzzle_profiles WHERE db_key = ?1",
        params![db_key],
        |row| row.get(0),
    )?)
}

fn get_progress_summary(
    conn: &RusqliteConnection,
    db_key: &str,
) -> Result<PuzzleProgressSummary, Error> {
    let (puzzle_elo, updated_at): (f64, i64) = conn.query_row(
        "SELECT puzzle_elo, updated_at FROM puzzle_profiles WHERE db_key = ?1",
        params![db_key],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let (total_attempts, correct_attempts): (i64, i64) = conn.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(CASE WHEN attempt_quality IN ('hard', 'solid', 'fluent')
                                  THEN 1 ELSE 0 END), 0)
         FROM puzzle_attempts WHERE db_key = ?1",
        params![db_key],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let now = now_ms();
    let due: i64 = conn.query_row(
        "SELECT COUNT(*) FROM puzzle_cards WHERE db_key = ?1 AND mastered = 0 AND due_at <= ?2",
        params![db_key, now],
        |row| row.get(0),
    )?;
    let learning: i64 = conn.query_row(
        "SELECT COUNT(*) FROM puzzle_cards
         WHERE db_key = ?1 AND state IN ('learning', 'relearning') AND mastered = 0",
        params![db_key],
        |row| row.get(0),
    )?;
    let review: i64 = conn.query_row(
        "SELECT COUNT(*) FROM puzzle_cards
         WHERE db_key = ?1 AND state = 'review' AND mastered = 0",
        params![db_key],
        |row| row.get(0),
    )?;
    let mastered: i64 = conn.query_row(
        "SELECT COUNT(*) FROM puzzle_cards WHERE db_key = ?1 AND mastered = 1",
        params![db_key],
        |row| row.get(0),
    )?;
    let themes_tracked: i64 = conn.query_row(
        "SELECT COUNT(*) FROM puzzle_theme_stats WHERE db_key = ?1",
        params![db_key],
        |row| row.get(0),
    )?;
    let accuracy = if total_attempts > 0 {
        correct_attempts as f64 / total_attempts as f64
    } else {
        0.0
    };

    Ok(PuzzleProgressSummary {
        db_key: db_key.to_string(),
        puzzle_elo,
        total_attempts,
        correct_attempts,
        accuracy,
        due,
        learning,
        review,
        mastered,
        themes_tracked,
        updated_at,
    })
}

fn get_card_progress(
    conn: &RusqliteConnection,
    db_key: &str,
    puzzle_id: i32,
) -> Result<Option<PuzzleCardProgress>, Error> {
    conn.query_row(
        "SELECT puzzle_id, due_at, state, reps, lapses, interval_days, ease,
                last_attempt_at, total_attempts, correct_attempts, last_quality, mastered
         FROM puzzle_cards WHERE db_key = ?1 AND puzzle_id = ?2",
        params![db_key, puzzle_id],
        row_to_card_progress,
    )
    .optional()
    .map_err(map_rusqlite_puzzle_error)
}

fn row_to_card_progress(row: &rusqlite::Row) -> rusqlite::Result<PuzzleCardProgress> {
    let state: String = row.get(2)?;
    let last_quality: String = row.get(10)?;
    let mastered: i64 = row.get(11)?;
    Ok(PuzzleCardProgress {
        puzzle_id: row.get(0)?,
        due_at: row.get(1)?,
        state: PuzzleSrsState::from_str(&state),
        reps: row.get(3)?,
        lapses: row.get(4)?,
        interval_days: row.get(5)?,
        ease: row.get(6)?,
        last_attempt_at: row.get(7)?,
        total_attempts: row.get(8)?,
        correct_attempts: row.get(9)?,
        last_quality: PuzzleAttemptQuality::from_str(&last_quality),
        mastered: mastered != 0,
    })
}

fn schedule_puzzle_card(
    previous: Option<PuzzleCardProgress>,
    puzzle_id: i32,
    quality: &PuzzleAttemptQuality,
    now: i64,
) -> PuzzleCardProgress {
    let mut card = previous.unwrap_or(PuzzleCardProgress {
        puzzle_id,
        due_at: now,
        state: PuzzleSrsState::New,
        reps: 0,
        lapses: 0,
        interval_days: 0.0,
        ease: DEFAULT_EASE,
        last_attempt_at: None,
        total_attempts: 0,
        correct_attempts: 0,
        last_quality: PuzzleAttemptQuality::Failed,
        mastered: false,
    });

    card.total_attempts += 1;
    card.last_attempt_at = Some(now);
    card.last_quality = quality.clone();

    match quality {
        PuzzleAttemptQuality::Failed => {
            card.lapses += 1;
            card.reps = 0;
            card.ease = (card.ease - 0.2).max(MIN_EASE);
            card.interval_days = 10.0 / (24.0 * 60.0);
            card.mastered = false;
            card.state = if card.total_attempts > 1 {
                PuzzleSrsState::Relearning
            } else {
                PuzzleSrsState::Learning
            };
            card.due_at = now + 10 * MINUTE_MS;
        }
        PuzzleAttemptQuality::Assisted => {
            card.lapses += 1;
            card.reps = 0;
            card.ease = (card.ease - 0.1).max(MIN_EASE);
            card.interval_days = 1.0;
            card.mastered = false;
            card.state = if card.total_attempts > 1 {
                PuzzleSrsState::Relearning
            } else {
                PuzzleSrsState::Learning
            };
            card.due_at = now + DAY_MS;
        }
        PuzzleAttemptQuality::Hard => {
            card.correct_attempts += 1;
            card.reps += 1;
            card.interval_days = if card.reps <= 1 {
                1.0
            } else if card.reps == 2 {
                3.0
            } else {
                (card.interval_days.max(1.0) * (card.ease * 0.65).max(MIN_EASE))
                    .round()
                    .max(1.0)
            };
            card.mastered = card.reps >= 5 && card.interval_days >= 21.0;
            card.state = if card.mastered {
                PuzzleSrsState::Mastered
            } else {
                PuzzleSrsState::Review
            };
            card.due_at = now + (card.interval_days * DAY_MS as f64).round() as i64;
        }
        PuzzleAttemptQuality::Solid => {
            card.correct_attempts += 1;
            card.reps += 1;
            card.ease = (card.ease + 0.05).max(MIN_EASE);
            card.interval_days = if card.reps <= 1 {
                3.0
            } else if card.reps == 2 {
                8.0
            } else {
                (card.interval_days.max(1.0) * card.ease).round().max(1.0)
            };
            card.mastered = card.reps >= 4 && card.interval_days >= 21.0;
            card.state = if card.mastered {
                PuzzleSrsState::Mastered
            } else {
                PuzzleSrsState::Review
            };
            card.due_at = now + (card.interval_days * DAY_MS as f64).round() as i64;
        }
        PuzzleAttemptQuality::Fluent => {
            card.correct_attempts += 1;
            card.ease = (card.ease + 0.1).max(MIN_EASE);
            if card.lapses == 0 && card.total_attempts == 1 {
                card.reps = card.reps.max(5);
                card.interval_days = 0.0;
                card.mastered = true;
                card.state = PuzzleSrsState::Mastered;
                card.due_at = now;
            } else {
                card.reps += 1;
                card.interval_days = if card.reps <= 1 {
                    7.0
                } else if card.reps == 2 {
                    21.0
                } else {
                    (card.interval_days.max(7.0) * (card.ease * 1.2)).round()
                };
                card.mastered = card.reps >= 3 && card.interval_days >= 21.0;
                card.state = if card.mastered {
                    PuzzleSrsState::Mastered
                } else {
                    PuzzleSrsState::Review
                };
                card.due_at = now + (card.interval_days * DAY_MS as f64).round() as i64;
            }
        }
    }

    card
}

fn classify_puzzle_attempt(
    conn: &RusqliteConnection,
    db_key: &str,
    input: &PuzzleAttemptInput,
    puzzle_rating: i32,
    puzzle_elo: f64,
    themes: &[String],
) -> Result<PuzzleAttemptQuality, Error> {
    if input.viewed_solution {
        return Ok(PuzzleAttemptQuality::Failed);
    }

    if input.used_hint {
        return Ok(PuzzleAttemptQuality::Assisted);
    }

    if input.outcome == PuzzleAttemptOutcome::Incorrect {
        return Ok(PuzzleAttemptQuality::Failed);
    }

    if input.wrong_moves > 0 {
        return Ok(PuzzleAttemptQuality::Assisted);
    }

    let time_spent_ms = input.time_spent_ms.max(0);
    if time_spent_ms == 0 {
        return Ok(PuzzleAttemptQuality::Solid);
    }

    let expected_ms = expected_solve_time_ms(puzzle_rating, puzzle_elo);
    let time_ratio = time_spent_ms as f64 / expected_ms as f64;
    let weak_theme = has_weak_attempt_theme(conn, db_key, themes)?;

    if time_spent_ms <= 20_000 && time_ratio <= 0.65 && !weak_theme {
        return Ok(PuzzleAttemptQuality::Fluent);
    }

    if time_spent_ms >= SLOW_SOLVE_MS || time_ratio >= 2.25 || (weak_theme && time_ratio >= 1.25) {
        return Ok(PuzzleAttemptQuality::Hard);
    }

    Ok(PuzzleAttemptQuality::Solid)
}

fn expected_solve_time_ms(puzzle_rating: i32, puzzle_elo: f64) -> i64 {
    let rating_component = 45_000.0 + (puzzle_rating as f64 - 1500.0) * 40.0;
    let rating_gap = puzzle_rating as f64 - puzzle_elo;
    let gap_component = if rating_gap >= 0.0 {
        (rating_gap / 400.0).min(1.0) * 45_000.0
    } else {
        (rating_gap / 400.0).max(-1.0) * 20_000.0
    };
    (rating_component + gap_component).clamp(15_000.0, 180_000.0) as i64
}

fn has_weak_attempt_theme(
    conn: &RusqliteConnection,
    db_key: &str,
    themes: &[String],
) -> Result<bool, Error> {
    for theme in themes.iter().filter(|theme| is_training_theme(theme)) {
        let weakness = conn
            .query_row(
                "SELECT weakness_score FROM puzzle_theme_stats
                 WHERE db_key = ?1 AND theme = ?2 AND attempts >= 3",
                params![db_key, theme],
                |row| row.get::<_, f64>(0),
            )
            .optional()?;
        if weakness.unwrap_or(0.0) >= WEAK_THEME_THRESHOLD {
            return Ok(true);
        }
    }
    Ok(false)
}

fn calculate_elo_delta(player_elo: f64, puzzle_rating: f64, success: bool, k: f64) -> f64 {
    let expected = 1.0 / (1.0 + 10_f64.powf((puzzle_rating - player_elo) / 400.0));
    let score = if success { 1.0 } else { 0.0 };
    let delta = k * (score - expected);
    (delta * 10.0).round() / 10.0
}

fn update_theme_stats(
    conn: &RusqliteConnection,
    db_key: &str,
    theme: &str,
    success: bool,
    first_rated_attempt: bool,
    puzzle_rating: i32,
    time_spent_ms: i64,
    now: i64,
    global_elo: f64,
) -> Result<PuzzleThemeDelta, Error> {
    let previous: Option<(i64, i64, i64, f64, i64)> = conn
        .query_row(
            "SELECT attempts, correct, total_time_ms, skill, lapses
             FROM puzzle_theme_stats WHERE db_key = ?1 AND theme = ?2",
            params![db_key, theme],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()?;

    let (attempts, correct, total_time, skill, lapses) =
        previous.unwrap_or((0, 0, 0, DEFAULT_THEME_SKILL, 0));
    let k = if first_rated_attempt {
        THEME_FIRST_ATTEMPT_K
    } else {
        THEME_REVIEW_ATTEMPT_K
    };
    let skill_delta = calculate_elo_delta(skill, puzzle_rating as f64, success, k);
    let next_skill = (skill + skill_delta).max(100.0);
    let next_attempts = attempts + 1;
    let next_correct = correct + i64::from(success);
    let next_total_time = total_time + time_spent_ms.max(0);
    let next_lapses = lapses + i64::from(!success);
    let weakness_score = calculate_theme_weakness(
        next_attempts,
        next_correct,
        next_lapses,
        next_skill,
        global_elo,
    );

    conn.execute(
        "INSERT INTO puzzle_theme_stats
            (db_key, theme, attempts, correct, total_time_ms, skill, lapses,
             weakness_score, last_attempt_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(db_key, theme) DO UPDATE SET
            attempts = excluded.attempts,
            correct = excluded.correct,
            total_time_ms = excluded.total_time_ms,
            skill = excluded.skill,
            lapses = excluded.lapses,
            weakness_score = excluded.weakness_score,
            last_attempt_at = excluded.last_attempt_at",
        params![
            db_key,
            theme,
            next_attempts,
            next_correct,
            next_total_time,
            next_skill,
            next_lapses,
            weakness_score,
            now,
        ],
    )?;

    Ok(PuzzleThemeDelta {
        theme: theme.to_string(),
        skill_before: skill,
        skill_after: next_skill,
        skill_delta,
    })
}

fn calculate_theme_weakness(
    attempts: i64,
    correct: i64,
    lapses: i64,
    theme_skill: f64,
    global_elo: f64,
) -> f64 {
    if attempts <= 0 {
        return 0.0;
    }
    let smoothed_accuracy = (correct as f64 + 2.0) / (attempts as f64 + 4.0);
    let sample_weight = (attempts as f64 / 20.0).min(1.0);
    let skill_gap = (global_elo - theme_skill).max(0.0);
    let lapse_rate = lapses as f64 / attempts as f64;
    sample_weight * ((1.0 - smoothed_accuracy) * 500.0 + skill_gap * 0.6 + lapse_rate * 200.0)
}

fn refresh_daily_snapshot(
    conn: &RusqliteConnection,
    db_key: &str,
    now: i64,
    puzzle_elo: f64,
) -> Result<(), Error> {
    let date_key = date_key_from_ms(now);
    let start = DateTime::<Utc>::from_timestamp_millis(now)
        .unwrap_or_else(Utc::now)
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis();
    let end = start + DAY_MS;
    let (attempts, correct): (i64, i64) = conn.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(CASE WHEN attempt_quality IN ('hard', 'solid', 'fluent')
                                  THEN 1 ELSE 0 END), 0)
         FROM puzzle_attempts WHERE db_key = ?1 AND attempted_at >= ?2 AND attempted_at < ?3",
        params![db_key, start, end],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let due: i64 = conn.query_row(
        "SELECT COUNT(*) FROM puzzle_cards WHERE db_key = ?1 AND mastered = 0 AND due_at <= ?2",
        params![db_key, now],
        |row| row.get(0),
    )?;
    let mastered: i64 = conn.query_row(
        "SELECT COUNT(*) FROM puzzle_cards WHERE db_key = ?1 AND mastered = 1",
        params![db_key],
        |row| row.get(0),
    )?;

    conn.execute(
        "INSERT INTO puzzle_daily_snapshots
            (db_key, date_key, puzzle_elo, attempts, correct, solved, due, mastered, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8)
         ON CONFLICT(db_key, date_key) DO UPDATE SET
            puzzle_elo = excluded.puzzle_elo,
            attempts = excluded.attempts,
            correct = excluded.correct,
            solved = excluded.solved,
            due = excluded.due,
            mastered = excluded.mastered,
            updated_at = excluded.updated_at",
        params![db_key, date_key, puzzle_elo, attempts, correct, due, mastered, now],
    )?;
    Ok(())
}

fn choose_coach_puzzle(
    progress_conn: &RusqliteConnection,
    puzzle_conn: &RusqliteConnection,
    db_key: &str,
    elo: f64,
    min_rating: u16,
    max_rating: u16,
) -> Result<Option<PuzzleTrainingCandidate>, Error> {
    if let Some(candidate) = choose_due_puzzle(
        progress_conn,
        puzzle_conn,
        db_key,
        true,
        PuzzleTrainingMode::Coach,
        "Urgent SRS review".to_string(),
    )? {
        return Ok(Some(candidate));
    }
    if let Some(candidate) = choose_due_puzzle(
        progress_conn,
        puzzle_conn,
        db_key,
        false,
        PuzzleTrainingMode::Coach,
        "Due SRS review".to_string(),
    )? {
        return Ok(Some(candidate));
    }

    if let Some(theme) = strongest_weak_theme(progress_conn, db_key)? {
        let (low, high) = elo_rating_window(elo, -150, 200);
        if let Some(candidate) = random_candidate(
            progress_conn,
            puzzle_conn,
            db_key,
            low,
            high,
            Some(&theme),
            PuzzleTrainingMode::Coach,
            format!("Weak theme: {theme}"),
        )? {
            return Ok(Some(candidate));
        }
    }

    let (low, high) = elo_rating_window(elo, -100, 100);
    if let Some(candidate) = random_candidate(
        progress_conn,
        puzzle_conn,
        db_key,
        low,
        high,
        None,
        PuzzleTrainingMode::Coach,
        "Rating calibration".to_string(),
    )? {
        return Ok(Some(candidate));
    }

    random_candidate(
        progress_conn,
        puzzle_conn,
        db_key,
        min_rating,
        max_rating,
        None,
        PuzzleTrainingMode::Coach,
        "Coach fallback".to_string(),
    )
}

fn choose_due_puzzle(
    progress_conn: &RusqliteConnection,
    puzzle_conn: &RusqliteConnection,
    db_key: &str,
    urgent_only: bool,
    mode: PuzzleTrainingMode,
    reason: String,
) -> Result<Option<PuzzleTrainingCandidate>, Error> {
    let now = now_ms();
    let sql = if urgent_only {
        "SELECT puzzle_id FROM puzzle_cards
         WHERE db_key = ?1 AND mastered = 0 AND due_at <= ?2
           AND state IN ('learning', 'relearning')
         ORDER BY due_at ASC, lapses DESC LIMIT 1"
    } else {
        "SELECT puzzle_id FROM puzzle_cards
         WHERE db_key = ?1 AND mastered = 0 AND due_at <= ?2
         ORDER BY CASE WHEN state IN ('learning', 'relearning') THEN 0 ELSE 1 END,
                  due_at ASC, lapses DESC LIMIT 1"
    };
    let puzzle_id: Option<i32> = progress_conn
        .query_row(sql, params![db_key, now], |row| row.get(0))
        .optional()?;
    let Some(puzzle_id) = puzzle_id else {
        return Ok(None);
    };
    build_candidate_by_id(progress_conn, puzzle_conn, db_key, puzzle_id, mode, reason)
}

fn build_candidate_by_id(
    progress_conn: &RusqliteConnection,
    puzzle_conn: &RusqliteConnection,
    db_key: &str,
    puzzle_id: i32,
    mode: PuzzleTrainingMode,
    reason: String,
) -> Result<Option<PuzzleTrainingCandidate>, Error> {
    let Some(puzzle) = load_puzzle_by_id(puzzle_conn, puzzle_id)? else {
        return Ok(None);
    };
    let themes = get_themes_for_puzzle_rusqlite(puzzle_conn, puzzle_id)?;
    let progress = get_card_progress(progress_conn, db_key, puzzle_id)?;
    Ok(Some(PuzzleTrainingCandidate {
        puzzle,
        themes,
        mode,
        reason,
        db_key: db_key.to_string(),
        progress,
    }))
}

fn random_candidate(
    progress_conn: &RusqliteConnection,
    puzzle_conn: &RusqliteConnection,
    db_key: &str,
    min_rating: u16,
    max_rating: u16,
    theme: Option<&str>,
    mode: PuzzleTrainingMode,
    reason: String,
) -> Result<Option<PuzzleTrainingCandidate>, Error> {
    for _ in 0..8 {
        let Some(puzzle) = load_random_puzzle(puzzle_conn, min_rating, max_rating, theme)? else {
            return Ok(None);
        };
        let progress = get_card_progress(progress_conn, db_key, puzzle.id)?;
        if progress.as_ref().map(|card| card.mastered).unwrap_or(false) {
            continue;
        }
        let themes = get_themes_for_puzzle_rusqlite(puzzle_conn, puzzle.id)?;
        return Ok(Some(PuzzleTrainingCandidate {
            puzzle,
            themes,
            mode,
            reason,
            db_key: db_key.to_string(),
            progress,
        }));
    }
    let puzzle = load_random_puzzle(puzzle_conn, min_rating, max_rating, theme)?;
    if let Some(puzzle) = puzzle {
        let themes = get_themes_for_puzzle_rusqlite(puzzle_conn, puzzle.id)?;
        let progress = get_card_progress(progress_conn, db_key, puzzle.id)?;
        Ok(Some(PuzzleTrainingCandidate {
            puzzle,
            themes,
            mode,
            reason,
            db_key: db_key.to_string(),
            progress,
        }))
    } else {
        Ok(None)
    }
}

fn fallback_training_candidate(
    progress_conn: &RusqliteConnection,
    puzzle_conn: &RusqliteConnection,
    db_key: &str,
    min_rating: u16,
    max_rating: u16,
    theme: Option<&str>,
    mode: PuzzleTrainingMode,
) -> Result<Option<PuzzleTrainingCandidate>, Error> {
    if theme.is_some() {
        if let Some(candidate) = random_candidate(
            progress_conn,
            puzzle_conn,
            db_key,
            min_rating,
            max_rating,
            None,
            mode.clone(),
            "No puzzle matched that theme and range; using the rating range".to_string(),
        )? {
            return Ok(Some(candidate));
        }

        if let Some(candidate) = random_candidate(
            progress_conn,
            puzzle_conn,
            db_key,
            600,
            3000,
            theme,
            mode.clone(),
            "No puzzle matched that rating range; broadening the theme search".to_string(),
        )? {
            return Ok(Some(candidate));
        }
    }

    random_candidate(
        progress_conn,
        puzzle_conn,
        db_key,
        600,
        3000,
        None,
        mode,
        "No puzzle matched the selected filters; using any available puzzle".to_string(),
    )
}

fn load_random_puzzle(
    conn: &RusqliteConnection,
    min_rating: u16,
    max_rating: u16,
    theme: Option<&str>,
) -> Result<Option<Puzzle>, Error> {
    let low = min_rating.min(max_rating) as i64;
    let high = min_rating.max(max_rating) as i64;
    if let Some(theme) = theme {
        let count = conn
            .query_row(
                "SELECT COUNT(*)
                 FROM puzzles p
                 INNER JOIN puzzle_themes pt ON pt.puzzle_id = p.id
                 INNER JOIN themes t ON t.id = pt.theme_id
                 WHERE t.name = ?1 AND p.rating >= ?2 AND p.rating <= ?3",
                params![theme, low, high],
                |row| row.get::<_, i64>(0),
            )
            .optional();
        let count = match count {
            Ok(Some(count)) => count,
            Ok(None) => 0,
            Err(error) if is_missing_sqlite_table(&error) => return Ok(None),
            Err(error) => return Err(map_rusqlite_puzzle_error(error)),
        };
        if count <= 0 {
            return Ok(None);
        }

        let offset = random_offset(count);
        conn.query_row(
            "SELECT p.id, p.fen, p.moves, p.rating, p.rating_deviation, p.popularity, p.nb_plays
             FROM puzzles p
             INNER JOIN puzzle_themes pt ON pt.puzzle_id = p.id
             INNER JOIN themes t ON t.id = pt.theme_id
             WHERE t.name = ?1 AND p.rating >= ?2 AND p.rating <= ?3
             ORDER BY p.id LIMIT 1 OFFSET ?4",
            params![theme, low, high, offset],
            row_to_puzzle,
        )
        .optional()
        .map_err(map_rusqlite_puzzle_error)
    } else {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM puzzles WHERE rating >= ?1 AND rating <= ?2",
                params![low, high],
                |row| row.get(0),
            )
            .map_err(map_rusqlite_puzzle_error)?;
        if count <= 0 {
            return Ok(None);
        }

        let offset = random_offset(count);
        conn.query_row(
            "SELECT id, fen, moves, rating, rating_deviation, popularity, nb_plays
             FROM puzzles WHERE rating >= ?1 AND rating <= ?2
             ORDER BY id LIMIT 1 OFFSET ?3",
            params![low, high, offset],
            row_to_puzzle,
        )
        .optional()
        .map_err(map_rusqlite_puzzle_error)
    }
}

fn load_random_puzzles(
    conn: &RusqliteConnection,
    min_rating: u16,
    max_rating: u16,
    theme: Option<&str>,
    limit: i64,
) -> Result<Vec<Puzzle>, Error> {
    let low = min_rating.min(max_rating) as i64;
    let high = min_rating.max(max_rating) as i64;
    let count = count_matching_puzzles(conn, low, high, theme)?;
    if count <= 0 || limit <= 0 {
        return Ok(Vec::new());
    }

    let limit = limit.min(count);
    let offset = random_offset(count);
    let mut puzzles = load_puzzle_page(conn, low, high, theme, limit, offset)?;
    if puzzles.len() < limit as usize && offset > 0 {
        let remaining = limit - puzzles.len() as i64;
        puzzles.extend(load_puzzle_page(conn, low, high, theme, remaining, 0)?);
    }
    Ok(puzzles)
}

fn count_matching_puzzles(
    conn: &RusqliteConnection,
    low: i64,
    high: i64,
    theme: Option<&str>,
) -> Result<i64, Error> {
    if let Some(theme) = theme {
        let result = conn.query_row(
            "SELECT COUNT(*)
             FROM puzzles p
             INNER JOIN puzzle_themes pt ON pt.puzzle_id = p.id
             INNER JOIN themes t ON t.id = pt.theme_id
             WHERE t.name = ?1 AND p.rating >= ?2 AND p.rating <= ?3",
            params![theme, low, high],
            |row| row.get(0),
        );
        match result {
            Ok(count) => Ok(count),
            Err(error) if is_missing_sqlite_table(&error) => Ok(0),
            Err(error) => Err(map_rusqlite_puzzle_error(error)),
        }
    } else {
        conn.query_row(
            "SELECT COUNT(*) FROM puzzles WHERE rating >= ?1 AND rating <= ?2",
            params![low, high],
            |row| row.get(0),
        )
        .map_err(map_rusqlite_puzzle_error)
    }
}

fn load_puzzle_page(
    conn: &RusqliteConnection,
    low: i64,
    high: i64,
    theme: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<Puzzle>, Error> {
    if let Some(theme) = theme {
        let mut stmt = match conn.prepare(
            "SELECT p.id, p.fen, p.moves, p.rating, p.rating_deviation, p.popularity, p.nb_plays
             FROM puzzles p
             INNER JOIN puzzle_themes pt ON pt.puzzle_id = p.id
             INNER JOIN themes t ON t.id = pt.theme_id
             WHERE t.name = ?1 AND p.rating >= ?2 AND p.rating <= ?3
             ORDER BY p.id LIMIT ?4 OFFSET ?5",
        ) {
            Ok(stmt) => stmt,
            Err(error) if is_missing_sqlite_table(&error) => return Ok(Vec::new()),
            Err(error) => return Err(map_rusqlite_puzzle_error(error)),
        };
        return stmt
            .query_map(params![theme, low, high, limit, offset], row_to_puzzle)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(map_rusqlite_puzzle_error);
    }

    let mut stmt = conn
        .prepare(
            "SELECT id, fen, moves, rating, rating_deviation, popularity, nb_plays
             FROM puzzles WHERE rating >= ?1 AND rating <= ?2
             ORDER BY id LIMIT ?3 OFFSET ?4",
        )
        .map_err(map_rusqlite_puzzle_error)?;
    stmt.query_map(params![low, high, limit, offset], row_to_puzzle)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_rusqlite_puzzle_error)
}

fn random_offset(count: i64) -> i64 {
    if count <= 1 {
        return 0;
    }
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as i64)
        .unwrap_or_else(|_| now_ms());
    nanos.rem_euclid(count)
}

fn load_puzzle_by_id(conn: &RusqliteConnection, puzzle_id: i32) -> Result<Option<Puzzle>, Error> {
    conn.query_row(
        "SELECT id, fen, moves, rating, rating_deviation, popularity, nb_plays
         FROM puzzles WHERE id = ?1",
        params![puzzle_id],
        row_to_puzzle,
    )
    .optional()
    .map_err(map_rusqlite_puzzle_error)
}

fn row_to_puzzle(row: &rusqlite::Row) -> rusqlite::Result<Puzzle> {
    Ok(Puzzle {
        id: row.get(0)?,
        fen: row.get(1)?,
        moves: row.get(2)?,
        rating: row.get(3)?,
        rating_deviation: row.get(4)?,
        popularity: row.get(5)?,
        nb_plays: row.get(6)?,
    })
}

fn get_themes_for_puzzle_rusqlite(
    conn: &RusqliteConnection,
    puzzle_id: i32,
) -> Result<Vec<String>, Error> {
    let mut stmt = match conn.prepare(
        "SELECT t.name
         FROM themes t
         INNER JOIN puzzle_themes pt ON pt.theme_id = t.id
         WHERE pt.puzzle_id = ?1
         ORDER BY t.name ASC",
    ) {
        Ok(stmt) => stmt,
        Err(error) if is_missing_sqlite_table(&error) => return Ok(Vec::new()),
        Err(error) => return Err(map_rusqlite_puzzle_error(error)),
    };
    let themes = stmt
        .query_map(params![puzzle_id], |row| row.get(0))?
        .collect::<Result<Vec<String>, _>>()?;
    Ok(themes)
}

fn strongest_weak_theme(conn: &RusqliteConnection, db_key: &str) -> Result<Option<String>, Error> {
    let mut stmt = conn.prepare(
        "SELECT theme FROM puzzle_theme_stats
         WHERE db_key = ?1 AND attempts >= 3 AND weakness_score > 0
         ORDER BY weakness_score DESC LIMIT 8",
    )?;
    let themes = stmt
        .query_map(params![db_key], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(themes.into_iter().find(|theme| is_training_theme(theme)))
}

fn is_training_theme(theme: &str) -> bool {
    !matches!(theme, "short" | "long" | "veryLong")
}

fn elo_rating_window(elo: f64, low_offset: i32, high_offset: i32) -> (u16, u16) {
    let low = (elo.round() as i32 + low_offset).clamp(600, 3000) as u16;
    let high = (elo.round() as i32 + high_offset).clamp(600, 3000) as u16;
    (low.min(high), low.max(high))
}

fn get_theme_rows(
    conn: &RusqliteConnection,
    db_key: &str,
) -> Result<Vec<PuzzleThemeStatsRow>, Error> {
    let since = now_ms()
        - Duration::try_days(30)
            .unwrap_or_default()
            .num_milliseconds();
    let mut stmt = conn.prepare(
        "SELECT theme, attempts, correct, total_time_ms, skill, weakness_score, last_attempt_at
         FROM puzzle_theme_stats WHERE db_key = ?1
         ORDER BY weakness_score DESC, attempts DESC, theme ASC",
    )?;
    let rows = stmt
        .query_map(params![db_key], |row| {
            let theme: String = row.get(0)?;
            let attempts: i64 = row.get(1)?;
            let correct: i64 = row.get(2)?;
            let total_time_ms: i64 = row.get(3)?;
            let skill: f64 = row.get(4)?;
            let weakness_score: f64 = row.get(5)?;
            let last_attempt_at: Option<i64> = row.get(6)?;
            Ok((
                theme,
                attempts,
                correct,
                total_time_ms,
                skill,
                weakness_score,
                last_attempt_at,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut result = Vec::new();
    for (theme, attempts, correct, total_time_ms, skill, weakness_score, last_attempt_at) in rows {
        let (recent_attempts, recent_correct): (i64, i64) = conn.query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(CASE WHEN attempt_quality IN ('hard', 'solid', 'fluent')
                                      THEN 1 ELSE 0 END), 0)
             FROM puzzle_attempts
             WHERE db_key = ?1 AND attempted_at >= ?2 AND themes LIKE ?3",
            params![db_key, since, format!("%\"{theme}\"%")],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let (due, mastered): (i64, i64) = conn.query_row(
            "SELECT
                COUNT(DISTINCT CASE WHEN c.mastered = 0 AND c.due_at <= ?2 THEN c.puzzle_id END),
                COUNT(DISTINCT CASE WHEN c.mastered = 1 THEN c.puzzle_id END)
             FROM puzzle_cards c
             INNER JOIN puzzle_attempts a
                ON a.db_key = c.db_key AND a.puzzle_id = c.puzzle_id
             WHERE c.db_key = ?1 AND a.themes LIKE ?3",
            params![db_key, now_ms(), format!("%\"{theme}\"%")],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        result.push(PuzzleThemeStatsRow {
            theme,
            attempts,
            correct,
            accuracy: if attempts > 0 {
                correct as f64 / attempts as f64
            } else {
                0.0
            },
            average_time_ms: if attempts > 0 {
                total_time_ms as f64 / attempts as f64
            } else {
                0.0
            },
            skill,
            weakness_score,
            recent_attempts,
            recent_accuracy: if recent_attempts > 0 {
                recent_correct as f64 / recent_attempts as f64
            } else {
                0.0
            },
            due,
            mastered,
            last_attempt_at,
        });
    }
    Ok(result)
}

fn get_trend_points(
    conn: &RusqliteConnection,
    db_key: &str,
    days: u16,
) -> Result<Vec<PuzzleTrendPoint>, Error> {
    let start_key = (Utc::now() - Duration::try_days(days as i64).unwrap_or_default())
        .format("%Y-%m-%d")
        .to_string();
    let mut stmt = conn.prepare(
        "SELECT date_key, puzzle_elo, attempts, correct, solved, due, mastered
         FROM puzzle_daily_snapshots
         WHERE db_key = ?1 AND date_key >= ?2
         ORDER BY date_key ASC",
    )?;
    let points = stmt
        .query_map(params![db_key, start_key], |row| {
            let attempts: i64 = row.get(2)?;
            let correct: i64 = row.get(3)?;
            Ok(PuzzleTrendPoint {
                date_key: row.get(0)?,
                puzzle_elo: row.get(1)?,
                attempts,
                accuracy: if attempts > 0 {
                    correct as f64 / attempts as f64
                } else {
                    0.0
                },
                solved: row.get(4)?,
                due: row.get(5)?,
                mastered: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(points)
}

fn get_srs_counts(conn: &RusqliteConnection, db_key: &str) -> Result<PuzzleSrsCounts, Error> {
    let now = now_ms();
    let learning: i64 = conn.query_row(
        "SELECT COUNT(*) FROM puzzle_cards
         WHERE db_key = ?1 AND state = 'learning' AND mastered = 0",
        params![db_key],
        |row| row.get(0),
    )?;
    let relearning: i64 = conn.query_row(
        "SELECT COUNT(*) FROM puzzle_cards
         WHERE db_key = ?1 AND state = 'relearning' AND mastered = 0",
        params![db_key],
        |row| row.get(0),
    )?;
    let review: i64 = conn.query_row(
        "SELECT COUNT(*) FROM puzzle_cards
         WHERE db_key = ?1 AND state = 'review' AND mastered = 0",
        params![db_key],
        |row| row.get(0),
    )?;
    let mastered: i64 = conn.query_row(
        "SELECT COUNT(*) FROM puzzle_cards WHERE db_key = ?1 AND mastered = 1",
        params![db_key],
        |row| row.get(0),
    )?;
    let due: i64 = conn.query_row(
        "SELECT COUNT(*) FROM puzzle_cards WHERE db_key = ?1 AND mastered = 0 AND due_at <= ?2",
        params![db_key, now],
        |row| row.get(0),
    )?;
    Ok(PuzzleSrsCounts {
        learning,
        relearning,
        review,
        mastered,
        due,
    })
}

fn get_due_queue(
    progress_conn: &RusqliteConnection,
    puzzle_conn: &RusqliteConnection,
    db_key: &str,
    limit: usize,
) -> Result<Vec<PuzzleSrsQueueRow>, Error> {
    let now = now_ms();
    let mut stmt = progress_conn.prepare(
        "SELECT puzzle_id, due_at, state, reps, lapses, interval_days,
                total_attempts, correct_attempts, last_quality, mastered
         FROM puzzle_cards
         WHERE db_key = ?1 AND mastered = 0
         ORDER BY CASE WHEN due_at <= ?2 THEN 0 ELSE 1 END,
                  due_at ASC, lapses DESC
         LIMIT ?3",
    )?;
    let cards = stmt
        .query_map(params![db_key, now, limit as i64], |row| {
            let state: String = row.get(2)?;
            let last_quality: String = row.get(8)?;
            let mastered: i64 = row.get(9)?;
            Ok((
                row.get::<_, i32>(0)?,
                row.get::<_, i64>(1)?,
                PuzzleSrsState::from_str(&state),
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, f64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, i64>(7)?,
                PuzzleAttemptQuality::from_str(&last_quality),
                mastered != 0,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut rows = Vec::new();
    for (
        puzzle_id,
        due_at,
        state,
        reps,
        lapses,
        interval_days,
        total_attempts,
        correct_attempts,
        last_quality,
        mastered,
    ) in cards
    {
        if let Some(puzzle) = load_puzzle_by_id(puzzle_conn, puzzle_id)? {
            rows.push(PuzzleSrsQueueRow {
                puzzle_id,
                rating: puzzle.rating,
                themes: get_themes_for_puzzle_rusqlite(puzzle_conn, puzzle_id)?,
                due_at,
                state,
                reps,
                lapses,
                interval_days,
                total_attempts,
                correct_attempts,
                last_quality,
                mastered,
            });
        }
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn harder_puzzle_gives_larger_elo_gain() {
        let easy = calculate_elo_delta(1500.0, 1300.0, true, FIRST_ATTEMPT_K);
        let hard = calculate_elo_delta(1500.0, 1900.0, true, FIRST_ATTEMPT_K);
        assert!(hard > easy);
        assert!(hard > 0.0);
    }

    #[test]
    fn repeated_attempt_uses_smaller_rating_k() {
        let first = calculate_elo_delta(1500.0, 1700.0, true, FIRST_ATTEMPT_K);
        let review = calculate_elo_delta(1500.0, 1700.0, true, REVIEW_ATTEMPT_K);
        assert!(first > review);
    }

    #[test]
    fn failed_card_returns_quickly_until_relearned() {
        let now = 1_700_000_000_000;
        let card = schedule_puzzle_card(None, 42, &PuzzleAttemptQuality::Failed, now);
        assert_eq!(card.state, PuzzleSrsState::Learning);
        assert_eq!(card.lapses, 1);
        assert!(card.due_at - now <= 10 * MINUTE_MS);

        let card = schedule_puzzle_card(Some(card), 42, &PuzzleAttemptQuality::Failed, now + 1);
        assert_eq!(card.state, PuzzleSrsState::Relearning);
        assert_eq!(card.reps, 0);
        assert_eq!(card.lapses, 2);
    }

    #[test]
    fn hard_reviews_grow_interval_and_can_master() {
        let mut card = None;
        let mut now = 1_700_000_000_000;
        for _ in 0..5 {
            let next = schedule_puzzle_card(card, 12, &PuzzleAttemptQuality::Hard, now);
            now = next.due_at;
            card = Some(next);
        }
        let card = card.unwrap();
        assert!(card.reps >= 5);
        assert!(card.interval_days >= 21.0);
        assert!(card.mastered);
        assert_eq!(card.state, PuzzleSrsState::Mastered);
    }

    #[test]
    fn fluent_first_solve_graduates_without_due_review() {
        let now = 1_700_000_000_000;
        let card = schedule_puzzle_card(None, 42, &PuzzleAttemptQuality::Fluent, now);

        assert_eq!(card.state, PuzzleSrsState::Mastered);
        assert!(card.mastered);
        assert_eq!(card.due_at, now);
        assert_eq!(card.last_quality, PuzzleAttemptQuality::Fluent);
    }

    #[test]
    fn assisted_card_returns_tomorrow_without_clean_rep_credit() {
        let now = 1_700_000_000_000;
        let card = schedule_puzzle_card(None, 42, &PuzzleAttemptQuality::Assisted, now);

        assert_eq!(card.state, PuzzleSrsState::Learning);
        assert_eq!(card.reps, 0);
        assert_eq!(card.correct_attempts, 0);
        assert_eq!(card.interval_days, 1.0);
        assert_eq!(card.due_at, now + DAY_MS);
    }

    #[test]
    fn weakness_waits_for_enough_sample() {
        let low_sample = calculate_theme_weakness(1, 0, 1, 1300.0, 1600.0);
        let enough_sample = calculate_theme_weakness(20, 8, 8, 1300.0, 1600.0);
        assert!(enough_sample > low_sample);
    }

    #[test]
    fn fallback_broadens_empty_theme_rating_search() {
        let progress_conn = RusqliteConnection::open_in_memory().unwrap();
        init_progress_schema(&progress_conn).unwrap();
        ensure_profile(&progress_conn, "test-db").unwrap();

        let puzzle_conn = RusqliteConnection::open_in_memory().unwrap();
        puzzle_conn
            .execute_batch(
                "
                CREATE TABLE puzzles (
                    id INTEGER PRIMARY KEY,
                    fen TEXT NOT NULL,
                    moves TEXT NOT NULL,
                    rating INTEGER NOT NULL,
                    rating_deviation INTEGER NOT NULL,
                    popularity INTEGER NOT NULL,
                    nb_plays INTEGER NOT NULL
                );
                CREATE TABLE themes (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
                CREATE TABLE puzzle_themes (puzzle_id INTEGER NOT NULL, theme_id INTEGER NOT NULL);
                INSERT INTO puzzles
                    (id, fen, moves, rating, rating_deviation, popularity, nb_plays)
                VALUES
                    (1, '8/8/8/8/8/8/8/8 w - - 0 1', 'a2a3', 1000, 75, 90, 10);
                INSERT INTO themes (id, name) VALUES (1, 'fork');
                INSERT INTO puzzle_themes (puzzle_id, theme_id) VALUES (1, 1);
                ",
            )
            .unwrap();

        let candidate = fallback_training_candidate(
            &progress_conn,
            &puzzle_conn,
            "test-db",
            2200,
            2300,
            Some("fork"),
            PuzzleTrainingMode::ThemeFocus,
        )
        .unwrap()
        .unwrap();

        assert_eq!(candidate.puzzle.id, 1);
        assert_eq!(
            candidate.reason,
            "No puzzle matched that rating range; broadening the theme search"
        );
    }

    #[test]
    fn empty_file_is_reported_as_invalid_puzzle_database() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let error = open_puzzle_database_path(file.path()).unwrap_err();

        assert!(matches!(error, Error::InvalidPuzzleDatabase(_)));
        assert!(!error.to_string().contains("no such table"));
    }

    #[test]
    fn missing_file_is_not_created_when_opening_puzzle_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing.db3");
        let error = open_puzzle_database_path(&path).unwrap_err();

        assert!(matches!(error, Error::InvalidPuzzleDatabase(_)));
        assert!(!path.exists());
    }

    #[test]
    fn legacy_progress_merge_preserves_saved_puzzle_elo() {
        let now = 1_700_000_000_000;
        let target = RusqliteConnection::open_in_memory().unwrap();
        init_progress_schema(&target).unwrap();
        ensure_profile(&target, "Lichess Puzzles.db3:123:10").unwrap();
        target
            .execute(
                "UPDATE puzzle_profiles
                 SET puzzle_elo = 1500, updated_at = ?2
                 WHERE db_key = ?1",
                params!["Lichess Puzzles.db3:123:10", now],
            )
            .unwrap();

        let legacy_file = tempfile::NamedTempFile::new().unwrap();
        let legacy = RusqliteConnection::open(legacy_file.path()).unwrap();
        init_progress_schema(&legacy).unwrap();
        legacy
            .execute(
                "INSERT INTO puzzle_profiles (db_key, puzzle_elo, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params!["Lichess Puzzles.db3:123:10", 1515.2, now, now + 1_000],
            )
            .unwrap();
        legacy
            .execute(
                "INSERT INTO puzzle_attempts
                    (db_key, puzzle_id, attempted_at, mode, outcome, puzzle_rating, elo_before,
                     elo_after, elo_delta, time_spent_ms, used_hint, viewed_solution, wrong_moves,
                     attempt_quality, themes)
                 VALUES (?1, ?2, ?3, 'coach', 'correct', 1600, 1500, 1515.2, 15.2,
                         12000, 0, 0, 0, 'solid', '[]')",
                params!["Lichess Puzzles.db3:123:10", 42, now + 500],
            )
            .unwrap();
        drop(legacy);

        let legacy_path = legacy_file.path().to_string_lossy().to_string();
        target
            .execute(
                "ATTACH DATABASE ?1 AS legacy_progress",
                params![legacy_path],
            )
            .unwrap();
        merge_attached_legacy_progress(&target).unwrap();
        target
            .execute("DETACH DATABASE legacy_progress", [])
            .unwrap();

        let summary = get_progress_summary(&target, "Lichess Puzzles.db3:123:10").unwrap();
        assert_eq!(summary.puzzle_elo, 1515.2);
        assert_eq!(summary.total_attempts, 1);

        let legacy_path = legacy_file.path().to_string_lossy().to_string();
        target
            .execute(
                "ATTACH DATABASE ?1 AS legacy_progress",
                params![legacy_path],
            )
            .unwrap();
        merge_attached_legacy_progress(&target).unwrap();
        target
            .execute("DETACH DATABASE legacy_progress", [])
            .unwrap();

        let attempts: i64 = target
            .query_row(
                "SELECT COUNT(*) FROM puzzle_attempts WHERE db_key = ?1",
                params!["Lichess Puzzles.db3:123:10"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(attempts, 1);
    }
}
