//! Read-only client for the shared Outpost / En Croissant Lichess opening
//! snapshot. The archive importer lives in Outpost, while this module keeps
//! the on-disk format and query semantics independent of either UI.

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use shakmaty::{
    fen::Fen, san::SanPlus, uci::UciMove, CastlingMode, Chess, EnPassantMode, FromSetup, Position,
    PositionError,
};
use specta::Type;
use std::path::{Path, PathBuf};

const DB_VERSION: i64 = 1;
const DB_FILE: &str = "opening.sqlite3";
const DEFAULT_MAX_PLIES: u8 = 40;
const MAX_INDEX_PLIES: u8 = 80;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalLichessOpeningStatus {
    pub available: bool,
    pub path: String,
    pub game_count: u64,
    pub move_rows: u64,
    pub standard_months: Vec<String>,
    pub masters_months: Vec<String>,
    pub max_plies: u8,
    pub storage_bytes: u64,
    pub built_at: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalLichessOpeningQuery {
    pub source: String,
    pub fen: String,
    #[serde(default)]
    pub speeds: Vec<String>,
    #[serde(default)]
    pub ratings: Vec<u16>,
    pub player: Option<String>,
    pub color: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub top_games: Option<u8>,
    pub recent_games: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalLichessOpeningMove {
    pub san: String,
    pub uci: String,
    pub white: u64,
    pub draws: u64,
    pub black: u64,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalLichessOpening {
    pub eco: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalLichessOpeningPlayer {
    pub name: String,
    pub rating: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalLichessOpeningGame {
    pub id: String,
    pub winner: Option<String>,
    pub white: LocalLichessOpeningPlayer,
    pub black: LocalLichessOpeningPlayer,
    pub year: Option<u16>,
    pub month: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalLichessCoverage {
    pub source: String,
    pub standard_months: Vec<String>,
    pub masters_months: Vec<String>,
    pub max_plies: u8,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalLichessOpeningResult {
    pub available: bool,
    pub white: u64,
    pub draws: u64,
    pub black: u64,
    pub moves: Vec<LocalLichessOpeningMove>,
    pub opening: Option<LocalLichessOpening>,
    pub top_games: Vec<LocalLichessOpeningGame>,
    pub recent_games: Vec<LocalLichessOpeningGame>,
    pub coverage: Option<LocalLichessCoverage>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, Default)]
struct Counts {
    white: u64,
    draws: u64,
    black: u64,
}

#[derive(Debug, Clone)]
struct QueryMove {
    san: String,
    uci: String,
    counts: Counts,
}

pub fn shared_lichess_data_root() -> PathBuf {
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        return PathBuf::from(local).join("ChessData").join("lichess");
    }
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("chess-data")
            .join("lichess");
    }
    PathBuf::from("lichess-data")
}

pub fn shared_eval_store_dir() -> PathBuf {
    shared_lichess_data_root().join("evaluations")
}

fn opening_db_path() -> PathBuf {
    shared_lichess_data_root().join("opening").join(DB_FILE)
}

pub fn opening_status() -> LocalLichessOpeningStatus {
    status_at_path(&opening_db_path())
}

fn status_at_path(path: &Path) -> LocalLichessOpeningStatus {
    if !path.exists() {
        return empty_status(path, None);
    }
    match read_status(path) {
        Ok(status) => status,
        Err(error) => empty_status(path, Some(error)),
    }
}

fn empty_status(path: &Path, error: Option<String>) -> LocalLichessOpeningStatus {
    LocalLichessOpeningStatus {
        available: false,
        path: path.display().to_string(),
        game_count: 0,
        move_rows: 0,
        standard_months: Vec::new(),
        masters_months: Vec::new(),
        max_plies: DEFAULT_MAX_PLIES,
        storage_bytes: 0,
        built_at: None,
        error,
    }
}

fn read_status(path: &Path) -> Result<LocalLichessOpeningStatus, String> {
    let connection = open_read_only(path)?;
    let version = metadata_i64(&connection, "version")?.unwrap_or(0);
    if version != DB_VERSION {
        return Err(format!(
            "unsupported local Lichess opening database version {version}"
        ));
    }
    if metadata_i64(&connection, "complete")?.unwrap_or(0) != 1 {
        return Err("local Lichess opening database is incomplete".to_string());
    }
    Ok(LocalLichessOpeningStatus {
        available: true,
        path: path.display().to_string(),
        game_count: metadata_i64(&connection, "game_count")?.unwrap_or(0).max(0) as u64,
        move_rows: metadata_i64(&connection, "move_rows")?.unwrap_or(0).max(0) as u64,
        standard_months: metadata_list(&connection, "standard_months")?,
        masters_months: metadata_list(&connection, "masters_months")?,
        max_plies: metadata_i64(&connection, "max_plies")?
            .unwrap_or(DEFAULT_MAX_PLIES as i64)
            .clamp(1, MAX_INDEX_PLIES as i64) as u8,
        storage_bytes: path.metadata().map(|item| item.len()).unwrap_or(0),
        built_at: metadata_i64(&connection, "built_at")?.map(|value| value.max(0) as u64),
        error: None,
    })
}

fn metadata_i64(connection: &Connection, key: &str) -> Result<Option<i64>, String> {
    connection
        .query_row(
            "SELECT value FROM metadata WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .map(|raw| raw.parse::<i64>().map_err(|error| error.to_string()))
        .transpose()
}

fn metadata_list(connection: &Connection, key: &str) -> Result<Vec<String>, String> {
    let value = connection
        .query_row(
            "SELECT value FROM metadata WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or_default();
    Ok(value
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect())
}

fn open_read_only(path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| error.to_string())
}

pub fn query_opening(query: LocalLichessOpeningQuery) -> Result<LocalLichessOpeningResult, String> {
    query_opening_at_path(query, &opening_db_path())
}

fn query_opening_at_path(
    query: LocalLichessOpeningQuery,
    path: &Path,
) -> Result<LocalLichessOpeningResult, String> {
    let status = status_at_path(path);
    if !status.available {
        return Ok(unavailable_result(status.error));
    }
    let source = normalize_source(&query.source)?;
    if !source_has_coverage(&status, source) {
        return Ok(unavailable_result(None));
    }

    let position = parse_position(&query.fen)?;
    let normalized = position_key(&position);
    let (hash_hi, hash_lo) = hash_position(&normalized);
    let connection = open_read_only(path)?;
    let moves = if query
        .player
        .as_deref()
        .is_some_and(|player| !player.trim().is_empty())
    {
        query_player_moves(&connection, &query, &normalized, hash_hi, hash_lo)?
    } else {
        query_aggregate_moves(&connection, &query, hash_hi, hash_lo)?
    };
    let mut white = 0u64;
    let mut draws = 0u64;
    let mut black = 0u64;
    let mut output = moves
        .into_values()
        .map(|item| {
            white += item.counts.white;
            draws += item.counts.draws;
            black += item.counts.black;
            LocalLichessOpeningMove {
                san: item.san,
                uci: item.uci,
                white: item.counts.white,
                draws: item.counts.draws,
                black: item.counts.black,
            }
        })
        .collect::<Vec<_>>();
    output.sort_by_key(|item| std::cmp::Reverse(item.white + item.draws + item.black));
    Ok(LocalLichessOpeningResult {
        available: true,
        white,
        draws,
        black,
        moves: output,
        opening: None,
        top_games: Vec::new(),
        recent_games: Vec::new(),
        coverage: Some(LocalLichessCoverage {
            source: query.source,
            standard_months: status.standard_months,
            masters_months: status.masters_months,
            max_plies: status.max_plies,
        }),
        error: None,
    })
}

fn source_has_coverage(status: &LocalLichessOpeningStatus, source: &str) -> bool {
    if source == "lichess-masters" {
        !status.masters_months.is_empty()
    } else {
        !status.standard_months.is_empty()
    }
}

fn unavailable_result(error: Option<String>) -> LocalLichessOpeningResult {
    LocalLichessOpeningResult {
        available: false,
        white: 0,
        draws: 0,
        black: 0,
        moves: Vec::new(),
        opening: None,
        top_games: Vec::new(),
        recent_games: Vec::new(),
        coverage: None,
        error,
    }
}

fn query_aggregate_moves(
    connection: &Connection,
    query: &LocalLichessOpeningQuery,
    hash_hi: i64,
    hash_lo: i64,
) -> Result<std::collections::HashMap<String, QueryMove>, String> {
    let source = normalize_source(&query.source)?;
    let mut statement = connection
        .prepare(
            "SELECT month, speed, rating_group, uci, san, white, draws, black
             FROM move_stats
             WHERE source = ?1 AND hash_hi = ?2 AND hash_lo = ?3",
        )
        .map_err(|error| error.to_string())?;
    let mut rows = statement
        .query(params![source, hash_hi, hash_lo])
        .map_err(|error| error.to_string())?;
    let mut output = std::collections::HashMap::<String, QueryMove>::new();
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let month = row.get::<_, i32>(0).map_err(|error| error.to_string())?;
        let speed = row.get::<_, u8>(1).map_err(|error| error.to_string())?;
        let rating = row.get::<_, u16>(2).map_err(|error| error.to_string())?;
        if !query_accepts(query, source, month, speed, rating) {
            continue;
        }
        let uci = row.get::<_, String>(3).map_err(|error| error.to_string())?;
        let san = row.get::<_, String>(4).map_err(|error| error.to_string())?;
        let entry = output.entry(uci.clone()).or_insert_with(|| QueryMove {
            san,
            uci,
            counts: Counts::default(),
        });
        entry.counts.white += row.get::<_, u64>(5).map_err(|error| error.to_string())?;
        entry.counts.draws += row.get::<_, u64>(6).map_err(|error| error.to_string())?;
        entry.counts.black += row.get::<_, u64>(7).map_err(|error| error.to_string())?;
    }
    Ok(output)
}

fn query_player_moves(
    connection: &Connection,
    query: &LocalLichessOpeningQuery,
    normalized_target: &str,
    hash_hi: i64,
    hash_lo: i64,
) -> Result<std::collections::HashMap<String, QueryMove>, String> {
    let player = query
        .player
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let sql = match query.color.as_deref().unwrap_or("white") {
        "white" => {
            "SELECT month, speed, rating_group, result, moves FROM game_lines WHERE white_key = ?1"
        }
        "black" => {
            "SELECT month, speed, rating_group, result, moves FROM game_lines WHERE black_key = ?1"
        }
        _ => return Err("player explorer color must be white or black".to_string()),
    };
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    let mut rows = statement
        .query(params![player])
        .map_err(|error| error.to_string())?;
    let mut output = std::collections::HashMap::<String, QueryMove>::new();
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let month = row.get::<_, i32>(0).map_err(|error| error.to_string())?;
        let speed = row.get::<_, u8>(1).map_err(|error| error.to_string())?;
        let rating = row.get::<_, u16>(2).map_err(|error| error.to_string())?;
        if !query_accepts(query, "lichess-all", month, speed, rating) {
            continue;
        }
        let result = row.get::<_, u8>(3).map_err(|error| error.to_string())?;
        let encoded = row
            .get::<_, Vec<u8>>(4)
            .map_err(|error| error.to_string())?;
        let mut position = Chess::default();
        for code in encoded.chunks_exact(2) {
            let current_key = position_key(&position);
            let current_hash = hash_position(&current_key);
            let uci = decode_uci_move(u16::from_le_bytes([code[0], code[1]]))
                .ok_or_else(|| "local player line contains an invalid move".to_string())?;
            let played = parse_uci_move(&position, &uci)?;
            if current_hash == (hash_hi, hash_lo) && current_key == normalized_target {
                let san = SanPlus::from_move(position.clone(), &played).to_string();
                let entry = output.entry(uci.clone()).or_insert_with(|| QueryMove {
                    san,
                    uci,
                    counts: Counts::default(),
                });
                add_result(&mut entry.counts, result);
                break;
            }
            position.play_unchecked(&played);
        }
    }
    Ok(output)
}

fn normalize_source(source: &str) -> Result<&'static str, String> {
    match source {
        "lichess-all" | "lichess-player" => Ok("lichess-all"),
        "lichess-masters" => Ok("lichess-masters"),
        other => Err(format!("unsupported local Lichess source: {other}")),
    }
}

fn query_accepts(
    query: &LocalLichessOpeningQuery,
    source: &str,
    month: i32,
    speed: u8,
    rating: u16,
) -> bool {
    if !within_date_range(
        month,
        query.since.as_deref(),
        query.until.as_deref(),
        source,
    ) {
        return false;
    }
    if source == "lichess-masters" {
        return true;
    }
    (query.speeds.is_empty()
        || query
            .speeds
            .iter()
            .any(|item| speed_code(item) == Some(speed)))
        && (query.ratings.is_empty() || query.ratings.contains(&rating))
}

fn within_date_range(month: i32, since: Option<&str>, until: Option<&str>, source: &str) -> bool {
    let parse = |value: &str| -> Option<i32> {
        if source == "lichess-masters" && value.len() == 4 {
            return value.parse::<i32>().ok().map(|year| year * 100);
        }
        parse_month(value)
    };
    if since.and_then(parse).is_some_and(|lower| month < lower) {
        return false;
    }
    if let Some(mut upper) = until.and_then(parse) {
        if source == "lichess-masters" && until.is_some_and(|value| value.len() == 4) {
            upper += 11;
        }
        if month > upper {
            return false;
        }
    }
    true
}

fn parse_month(value: &str) -> Option<i32> {
    let (year, month) = value.split_once('-')?;
    let year = year.parse::<i32>().ok()?;
    let month = month.parse::<i32>().ok()?;
    (1..=12).contains(&month).then_some(year * 100 + month)
}

fn speed_code(value: &str) -> Option<u8> {
    match value {
        "ultraBullet" => Some(1),
        "bullet" => Some(2),
        "blitz" => Some(3),
        "rapid" => Some(4),
        "classical" => Some(5),
        "correspondence" => Some(6),
        _ => None,
    }
}

fn parse_position(fen: &str) -> Result<Chess, String> {
    let parsed = Fen::from_ascii(fen.as_bytes()).map_err(|error| error.to_string())?;
    let setup = parsed.into_setup();
    Chess::from_setup(setup, CastlingMode::Standard)
        .or_else(PositionError::ignore_too_much_material)
        .map_err(|error| format!("invalid explorer FEN: {error}"))
}

fn position_key(position: &Chess) -> String {
    Fen::from_position(position.clone(), EnPassantMode::Legal)
        .to_string()
        .split_whitespace()
        .take(4)
        .collect::<Vec<_>>()
        .join(" ")
}

fn hash_position(position: &str) -> (i64, i64) {
    fn fnv1a(bytes: &[u8], offset: u64) -> u64 {
        let mut hash = offset;
        for byte in bytes {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        hash
    }
    let bytes = position.as_bytes();
    (
        fnv1a(bytes, 0xcbf2_9ce4_8422_2325) as i64,
        fnv1a(bytes, 0x8422_2325_cbf2_9ce4) as i64,
    )
}

fn parse_uci_move(position: &Chess, uci: &str) -> Result<shakmaty::Move, String> {
    let parsed = uci
        .parse::<UciMove>()
        .map_err(|error| format!("invalid local UCI move {uci}: {error}"))?;
    parsed
        .to_move(position)
        .map_err(|error| format!("illegal local UCI move {uci}: {error}"))
}

fn decode_uci_move(code: u16) -> Option<String> {
    let square = |value: u16| -> Option<String> {
        (value < 64).then(|| {
            format!(
                "{}{}",
                (b'a' + (value % 8) as u8) as char,
                (b'1' + (value / 8) as u8) as char
            )
        })
    };
    let mut output = format!(
        "{}{}",
        square(code & 0b11_1111)?,
        square((code >> 6) & 0b11_1111)?
    );
    match (code >> 12) & 0b111 {
        0 => {}
        1 => output.push('n'),
        2 => output.push('b'),
        3 => output.push('r'),
        4 => output.push('q'),
        _ => return None,
    }
    Some(output)
}

fn add_result(counts: &mut Counts, result: u8) {
    match result {
        1 => counts.white += 1,
        2 => counts.draws += 1,
        3 => counts.black += 1,
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn fixture(path: &Path) {
        let db = Connection::open(path).unwrap();
        db.execute_batch(
            "CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE move_stats(
               source TEXT, hash_hi INTEGER, hash_lo INTEGER, month INTEGER,
               speed INTEGER, rating_group INTEGER, uci TEXT, san TEXT,
               white INTEGER, draws INTEGER, black INTEGER
             );
             CREATE TABLE game_lines(
               month INTEGER, speed INTEGER, rating_group INTEGER,
               white_key TEXT, black_key TEXT, white_name TEXT, black_name TEXT,
               white_rating INTEGER, black_rating INTEGER, result INTEGER, moves BLOB
             );",
        )
        .unwrap();
        for (key, value) in [
            ("version", "1"),
            ("complete", "1"),
            ("game_count", "1"),
            ("move_rows", "1"),
            ("standard_months", "2026-07"),
            ("masters_months", "2026-07"),
            ("max_plies", "40"),
            ("built_at", "1"),
        ] {
            db.execute("INSERT INTO metadata VALUES (?1, ?2)", params![key, value])
                .unwrap();
        }
        let root = position_key(&Chess::default());
        let (hi, lo) = hash_position(&root);
        db.execute(
            "INSERT INTO move_stats VALUES ('lichess-all', ?1, ?2, 202607, 3, 2000, 'e2e4', 'e4', 1, 0, 0)",
            params![hi, lo],
        )
        .unwrap();
        let e4 = 12u16 | (28u16 << 6);
        db.execute(
            "INSERT INTO game_lines VALUES (202607, 3, 2000, 'alice', 'bob', 'Alice', 'Bob', 2000, 2000, 1, ?1)",
            params![e4.to_le_bytes().to_vec()],
        )
        .unwrap();
    }

    fn query(player: Option<&str>) -> LocalLichessOpeningQuery {
        LocalLichessOpeningQuery {
            source: "lichess-all".to_string(),
            fen: Fen::default().to_string(),
            speeds: vec!["blitz".to_string()],
            ratings: vec![2000],
            player: player.map(str::to_string),
            color: Some("white".to_string()),
            since: None,
            until: None,
            top_games: None,
            recent_games: None,
        }
    }

    #[test]
    fn reads_the_outpost_aggregate_format() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(DB_FILE);
        fixture(&path);
        let result = query_opening_at_path(query(None), &path).unwrap();
        assert!(result.available);
        assert_eq!(result.white, 1);
        assert_eq!(result.moves[0].uci, "e2e4");
    }

    #[test]
    fn replays_compact_player_lines() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(DB_FILE);
        fixture(&path);
        let result = query_opening_at_path(query(Some("Alice")), &path).unwrap();
        assert_eq!(result.white, 1);
        assert_eq!(result.moves[0].san, "e4");
    }

    #[test]
    fn source_availability_does_not_mask_an_uninstalled_family() {
        let status = LocalLichessOpeningStatus {
            available: true,
            path: "fixture".to_string(),
            game_count: 1,
            move_rows: 1,
            standard_months: Vec::new(),
            masters_months: vec!["2026-07".to_string()],
            max_plies: 40,
            storage_bytes: 1,
            built_at: Some(1),
            error: None,
        };
        assert!(!source_has_coverage(&status, "lichess-all"));
        assert!(source_has_coverage(&status, "lichess-masters"));
    }
}
