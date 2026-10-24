use std::{
    fs::{create_dir_all, File, OpenOptions},
    io::{self, BufRead, BufReader, Read, Write},
    path::PathBuf,
    time::Instant,
};

use crate::error::Error;
use en_croissant_fork::pgn_files::{
    self, PgnGameBatch, PgnGameSnapshot, PgnSourceRef, PgnWriteResult,
};
use serde::Serialize;
use specta::Type;
use tauri::Emitter;

struct PgnStreamReader<R: BufRead> {
    reader: R,
    pending_line: Option<String>,
    first_line: bool,
}

impl<R: BufRead> PgnStreamReader<R> {
    fn new(reader: R) -> Self {
        Self {
            reader,
            pending_line: None,
            first_line: true,
        }
    }

    fn read_game(&mut self) -> io::Result<Option<String>> {
        let mut game = String::new();
        let mut line = String::new();
        let mut in_comment = false;
        let mut saw_movetext = false;

        loop {
            line.clear();
            if let Some(pending_line) = self.pending_line.take() {
                line.push_str(&pending_line);
            } else {
                let bytes = self.reader.read_line(&mut line)?;
                if bytes == 0 {
                    break;
                }
            }

            if self.first_line {
                self.first_line = false;
                if line.starts_with('\u{feff}') {
                    line = line.trim_start_matches('\u{feff}').to_string();
                }
            }

            let trimmed = line.trim();
            let is_header = !in_comment && trimmed.starts_with('[');

            if is_header && saw_movetext {
                self.pending_line = Some(line.clone());
                break;
            }

            if !is_header && !trimmed.is_empty() {
                saw_movetext = true;
            }

            game.push_str(&line);

            for c in line.chars() {
                match c {
                    '{' => in_comment = true,
                    '}' => in_comment = false,
                    _ => {}
                }
            }
        }

        if game.trim().is_empty() {
            Ok(None)
        } else {
            if !game.ends_with('\n') {
                game.push('\n');
            }
            Ok(Some(game))
        }
    }
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PgnSplitReport {
    pub created: u32,
    pub target_dir: String,
}

async fn pgn_task<T: Send + 'static>(
    work: impl FnOnce() -> io::Result<T> + Send + 'static,
) -> Result<T, Error> {
    Ok(tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| io::Error::other(error.to_string()))??)
}

fn game_index(n: i32) -> io::Result<u32> {
    u32::try_from(n)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "Invalid PGN game index"))
}

#[tauri::command]
#[specta::specta]
pub async fn count_pgn_games(file: PathBuf) -> Result<i32, Error> {
    pgn_task(move || {
        i32::try_from(pgn_files::count_games(&file)?)
            .map_err(|_| io::Error::other("Too many PGN games"))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn read_games(file: PathBuf, start: i32, end: i32) -> Result<Vec<String>, Error> {
    pgn_task(move || pgn_files::read_games(&file, game_index(start)?, game_index(end)?)).await
}

#[tauri::command]
#[specta::specta]
pub async fn read_pgn_game(file_path: String, index: u32) -> Result<PgnGameSnapshot, Error> {
    pgn_task(move || pgn_files::read_game(&PathBuf::from(file_path), index)).await
}

#[tauri::command]
#[specta::specta]
pub async fn read_pgn_games(
    file_path: String,
    start: u32,
    end: u32,
) -> Result<PgnGameBatch, Error> {
    pgn_task(move || pgn_files::read_snapshots(&PathBuf::from(file_path), start, end)).await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_game(
    file: PathBuf,
    n: i32,
    expected_identity: Option<String>,
) -> Result<PgnWriteResult, Error> {
    pgn_task(move || {
        pgn_files::delete_game(
            &file,
            game_index(n)?,
            expected_identity.as_deref().unwrap_or(""),
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn write_game(
    file_path: String,
    n: i32,
    pgn: String,
    expected_identity: Option<String>,
    metadata: Option<String>,
) -> Result<PgnWriteResult, Error> {
    pgn_task(move || {
        pgn_files::write_game(
            &PathBuf::from(file_path),
            game_index(n)?,
            expected_identity.as_deref().unwrap_or(""),
            &pgn,
            metadata
                .as_deref()
                .unwrap_or(r#"{"type":"game","tags":[]}"#),
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn append_pgn_game(
    file_path: String,
    pgn: String,
    metadata: String,
) -> Result<PgnWriteResult, Error> {
    pgn_task(move || pgn_files::append_game(&PathBuf::from(file_path), &pgn, &metadata)).await
}

#[tauri::command]
#[specta::specta]
pub async fn create_pgn_game(
    file_path: String,
    pgn: String,
    metadata: String,
    source: Option<PgnSourceRef>,
) -> Result<PgnWriteResult, Error> {
    pgn_task(move || {
        pgn_files::create_game(&PathBuf::from(file_path), &pgn, &metadata, source.as_ref())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn split_pgn_to_files(
    file: PathBuf,
    target_dir: PathBuf,
    file_type: String,
    app: tauri::AppHandle,
) -> Result<PgnSplitReport, Error> {
    create_dir_all(&target_dir)?;

    let metadata_type = normalize_file_type(&file_type);
    let metadata = format!("{{\"type\":\"{metadata_type}\",\"tags\":[]}}");
    let mut reader = PgnStreamReader::new(open_pgn_source(&file)?);
    let start = Instant::now();
    let mut created = 0usize;

    while let Some(game) = reader.read_game()? {
        let ordered_filenames = file_type == "ordered-game";
        let stem = game_file_stem(&game, created + 1, ordered_filenames);
        let game_path = unique_pgn_path(&target_dir, &stem);
        let mut game_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&game_path)?;
        game_file.write_all(game.trim_end().as_bytes())?;
        game_file.write_all(b"\n")?;

        let info_path = game_path.with_extension("info");
        let mut info_file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(info_path)?;
        info_file.write_all(metadata.as_bytes())?;

        created += 1;
        if created % 100 == 0 {
            app.emit(
                "split_pgn_progress",
                (created, start.elapsed().as_millis() as u32),
            )?;
        }
    }

    app.emit(
        "split_pgn_progress",
        (created, start.elapsed().as_millis() as u32),
    )?;

    Ok(PgnSplitReport {
        created: created.min(u32::MAX as usize) as u32,
        target_dir: target_dir.to_string_lossy().into_owned(),
    })
}

fn open_pgn_source(file: &PathBuf) -> Result<Box<dyn BufRead>, Error> {
    let source = File::open(file)?;
    let extension = file
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase());

    let reader: Box<dyn Read> = match extension.as_deref() {
        Some("bz2") => Box::new(bzip2::read::MultiBzDecoder::new(source)),
        Some("zst") => Box::new(zstd::Decoder::new(source)?),
        _ => Box::new(source),
    };

    Ok(Box::new(BufReader::new(reader)))
}

fn normalize_file_type(file_type: &str) -> &'static str {
    match file_type {
        "repertoire" => "repertoire",
        "tournament" => "tournament",
        "puzzle" => "puzzle",
        "other" => "other",
        _ => "game",
    }
}

fn game_file_stem(game: &str, index: usize, ordered_filename: bool) -> String {
    let headers = parse_pgn_headers(game);
    let date = clean_header(header_value(&headers, "Date"));
    let white = clean_header(header_value(&headers, "White"));
    let black = clean_header(header_value(&headers, "Black"));
    let event = clean_header(header_value(&headers, "Event"));
    let study_name = clean_header(header_value(&headers, "StudyName"));
    let chapter_name = clean_header(header_value(&headers, "ChapterName"));
    let round = clean_header(header_value(&headers, "Round"));
    let study_label = study_file_label(study_name.as_deref(), chapter_name.as_deref());

    let mut parts = Vec::new();
    if let Some(date) = date {
        parts.push(date);
    }

    // A study chapter's name is the label the user gave the game, so it beats
    // player tags, which studies often leave as placeholders like "Me". Ordered
    // filenames are only produced for study-linked folders, where the database
    // was imported from a study and the Event tag carries "Study - Chapter".
    let no_players = white.is_none() && black.is_none();
    let study_style_label = study_label.or_else(|| {
        event
            .clone()
            .filter(|_| ordered_filename || players_are_generic(&white, &black) || no_players)
    });

    if let Some(study_style_label) = study_style_label {
        parts.push(study_style_label);
    } else {
        match (white, black) {
            (Some(white), Some(black)) => parts.push(format!("{white} - {black}")),
            (Some(white), None) => parts.push(white),
            (None, Some(black)) => parts.push(black),
            (None, None) => {}
        }

        if let Some(round) = round {
            parts.push(format!("Round {round}"));
        }
    }

    let label = if parts.is_empty() {
        format!("Game {index}")
    } else {
        parts.join(" ")
    };

    let label = if ordered_filename {
        format!("{index:04} {label}")
    } else {
        label
    };

    sanitize_file_stem(&label)
}

fn study_file_label(study_name: Option<&str>, chapter_name: Option<&str>) -> Option<String> {
    let study_name = study_name?;
    match chapter_name {
        Some(chapter_name) if !chapter_name.eq_ignore_ascii_case(study_name) => {
            Some(format!("{study_name} - {chapter_name}"))
        }
        _ => Some(study_name.to_string()),
    }
}

fn players_are_generic(white: &Option<String>, black: &Option<String>) -> bool {
    let players = [white.as_deref(), black.as_deref()];
    players.iter().any(|player| player.is_some())
        && players.into_iter().flatten().all(is_generic_player_name)
}

fn is_generic_player_name(name: &str) -> bool {
    matches!(
        name.trim().to_ascii_lowercase().as_str(),
        "unknown" | "anonymous" | "me" | "?"
    )
}

fn parse_pgn_headers(game: &str) -> Vec<(String, String)> {
    let mut headers = Vec::new();

    for line in game.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if !line.starts_with('[') {
            break;
        }

        let Some(space_index) = line.find(' ') else {
            continue;
        };
        let key = line[1..space_index].to_string();
        let value = decode_pgn_header_value(line[space_index + 1..].trim());
        if let Some(value) = value {
            headers.push((key, value));
        }
    }

    headers
}

fn decode_pgn_header_value(raw: &str) -> Option<String> {
    let raw = raw.strip_prefix('"')?;
    let mut value = String::new();
    let mut escaped = false;

    for c in raw.chars() {
        if escaped {
            value.push(c);
            escaped = false;
            continue;
        }

        match c {
            '\\' => escaped = true,
            '"' => return Some(value),
            _ => value.push(c),
        }
    }

    None
}

fn header_value<'a>(headers: &'a [(String, String)], key: &str) -> Option<&'a str> {
    headers
        .iter()
        .find_map(|(header_key, value)| (header_key == key).then_some(value.as_str()))
}

fn clean_header(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() || value == "?" || value == "-" {
        None
    } else {
        Some(value.to_string())
    }
}

fn sanitize_file_stem(input: &str) -> String {
    let mut sanitized = String::new();
    let mut previous_was_space = false;

    for c in input.chars() {
        let replacement = if c.is_control()
            || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
        {
            ' '
        } else {
            c
        };

        if replacement.is_whitespace() {
            if !previous_was_space {
                sanitized.push(' ');
                previous_was_space = true;
            }
        } else {
            sanitized.push(replacement);
            previous_was_space = false;
        }
    }

    let mut sanitized = sanitized
        .trim_matches(|c| c == ' ' || c == '.')
        .chars()
        .take(120)
        .collect::<String>();
    sanitized = sanitized.trim_matches(|c| c == ' ' || c == '.').to_string();

    if sanitized.is_empty() {
        "Game".to_string()
    } else {
        sanitized
    }
}

fn unique_pgn_path(target_dir: &PathBuf, stem: &str) -> PathBuf {
    let first = target_dir.join(format!("{stem}.pgn"));
    if !first.exists() {
        return first;
    }

    for suffix in 2..10_000 {
        let candidate = target_dir.join(format!("{stem} {suffix}.pgn"));
        if !candidate.exists() {
            return candidate;
        }
    }

    target_dir.join(format!(
        "{stem} {}.pgn",
        chrono::Utc::now().timestamp_millis()
    ))
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    #[test]
    fn pgn_stream_reader_splits_multiple_games_without_dropping_headers() {
        let pgn = r#"[Event "First"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 1-0

[Event "Second"]
[White "Carol"]
[Black "Dan"]
[Result "0-1"]

1. d4 d5 0-1
"#;

        let mut reader = PgnStreamReader::new(Cursor::new(pgn.as_bytes()));
        let first = reader.read_game().unwrap().unwrap();
        let second = reader.read_game().unwrap().unwrap();

        assert!(first.contains("[Event \"First\"]"));
        assert!(!first.contains("[Event \"Second\"]"));
        assert!(second.contains("[Event \"Second\"]"));
        assert!(reader.read_game().unwrap().is_none());
    }

    #[test]
    fn game_file_stem_uses_game_headers_and_windows_safe_characters() {
        let pgn = r#"[Event "Online/Blitz"]
[Date "2026.05.15"]
[Round "3:4"]
[White "Alice*"]
[Black "Bob?"]
[Result "1-0"]

1. e4 e5 1-0
"#;

        assert_eq!(
            game_file_stem(pgn, 1, false),
            "2026.05.15 Alice - Bob Round 3 4"
        );
    }

    #[test]
    fn game_file_stem_includes_lichess_study_titles() {
        let pgn = r#"[Event "?"]
[StudyName "My classical games"]
[ChapterName "Model game 7"]
[Date "2026.02.28"]
[White "Unknown"]
[Black "Unknown"]
[Result "*"]

1. e4 e5 *
"#;

        assert_eq!(
            game_file_stem(pgn, 1, false),
            "2026.02.28 My classical games - Model game 7"
        );
    }

    #[test]
    fn game_file_stem_can_prefix_source_order() {
        let pgn = r#"[Event "?"]
[StudyName "My classical games"]
[ChapterName "Model game 7"]
[Date "2026.02.28"]
[White "Unknown"]
[Black "Unknown"]
[Result "*"]

1. e4 e5 *
"#;

        assert_eq!(
            game_file_stem(pgn, 7, true),
            "0007 2026.02.28 My classical games - Model game 7"
        );
    }

    #[test]
    fn game_file_stem_keeps_chapter_name_for_study_exports_with_placeholder_players() {
        // A study database re-exported to PGN loses StudyName/ChapterName and
        // carries the chapter label in Event, with placeholder player tags.
        let pgn = r#"[Event "My classical games - Lachlan vs Mike gale 1-0"]
[Site "https://lichess.org/ihWj0d3o"]
[Date "2026.04.20"]
[Round "-"]
[White "Me"]
[Black "Me"]
[Result "*"]

1. Nf3 d5 *
"#;

        assert_eq!(
            game_file_stem(pgn, 29, true),
            "0029 2026.04.20 My classical games - Lachlan vs Mike gale 1-0"
        );
        assert_eq!(
            game_file_stem(pgn, 29, false),
            "2026.04.20 My classical games - Lachlan vs Mike gale 1-0"
        );
    }

    #[test]
    fn game_file_stem_prefers_event_over_real_players_for_ordered_study_exports() {
        let pgn = r#"[Event "My classical games - Binx, Michael - Tyrrell, Lachlan 1-0"]
[Date "2026.03.08"]
[Round "-"]
[White "Binx, Michael"]
[Black "Tyrrell, Lachlan"]
[Result "1-0"]

1. d4 Nf6 1-0
"#;

        assert_eq!(
            game_file_stem(pgn, 16, true),
            "0016 2026.03.08 My classical games - Binx, Michael - Tyrrell, Lachlan 1-0"
        );
        // Outside ordered study syncs, real player names keep naming the file.
        assert_eq!(
            game_file_stem(pgn, 16, false),
            "2026.03.08 Binx, Michael - Tyrrell, Lachlan"
        );
    }
}
