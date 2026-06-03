use std::{
    fs::{create_dir_all, File, OpenOptions},
    io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::PathBuf,
    time::Instant,
};

use crate::{error::Error, AppState};
use serde::Serialize;
use specta::Type;
use tauri::Emitter;

const GAME_OFFSET_FREQ: usize = 100;

struct PgnParser {
    reader: BufReader<File>,
    line: String,
    game: String,
    start: u64,
}

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

impl PgnParser {
    fn new(file: File) -> Self {
        let mut reader = BufReader::new(file);
        let start = ignore_bom(&mut reader).unwrap_or(0);
        Self {
            reader,
            line: String::new(),
            game: String::new(),
            start,
        }
    }

    fn position(&mut self) -> io::Result<u64> {
        self.reader.stream_position()
    }

    fn offset_by_index(&mut self, n: usize, state: &AppState, file: &String) -> io::Result<()> {
        let offset_index = n / GAME_OFFSET_FREQ;
        let n_left = n % GAME_OFFSET_FREQ;
        let wrapped_pgn_offsets = state.pgn_offsets.get(file);
        if wrapped_pgn_offsets.is_none() {
            self.reader.seek(SeekFrom::Start(self.start))?;
            self.skip_games(n)?;
            return Ok(());
        }
        let pgn_offsets = wrapped_pgn_offsets.unwrap();

        if offset_index == 0 || offset_index < pgn_offsets.len() {
            let offset = match offset_index {
                0 => self.start,
                _ => pgn_offsets[offset_index - 1],
            };

            self.reader.seek(SeekFrom::Start(offset))?;

            self.skip_games(n_left)?;
        } else {
            self.reader.seek(SeekFrom::Start(self.start))?;
            self.skip_games(n)?;
        }

        Ok(())
    }

    /// Skip n games, and return the number of bytes read
    fn skip_games(&mut self, n: usize) -> io::Result<usize> {
        let mut new_game = false;
        let mut skipped = 0;
        let mut count = 0;
        let mut in_comment = false;

        if n == 0 {
            return Ok(0);
        }

        let mut line = String::new();
        loop {
            let res = self.reader.read_line(&mut line);
            if res.is_err() {
                continue;
            }
            let bytes = res.unwrap();
            skipped += bytes;
            if bytes == 0 {
                break;
            }
            let is_header = !in_comment && line.starts_with('[');
            for c in line.chars() {
                match c {
                    '{' => in_comment = true,
                    '}' => in_comment = false,
                    _ => {}
                }
            }
            if is_header {
                if new_game {
                    count += 1;
                    if count == n {
                        self.reader.seek(SeekFrom::Current(-(bytes as i64)))?;
                        break;
                    }
                    new_game = false;
                }
            } else {
                new_game = true;
            }
            line.clear();
        }
        Ok(skipped)
    }

    fn read_game(&mut self) -> io::Result<String> {
        let mut new_game = false;
        let mut in_comment = false;
        self.game.clear();
        loop {
            let res = self.reader.read_line(&mut self.line);
            if res.is_err() {
                continue;
            }
            let bytes = res.unwrap();
            if bytes == 0 {
                break;
            }
            let is_header = !in_comment && self.line.starts_with('[');
            for c in self.line.chars() {
                match c {
                    '{' => in_comment = true,
                    '}' => in_comment = false,
                    _ => {}
                }
            }
            if is_header {
                if new_game {
                    break;
                }
            } else {
                new_game = true;
            }
            self.game.push_str(&self.line);
            self.line.clear();
        }
        Ok(self.game.clone())
    }
}

fn ignore_bom(reader: &mut BufReader<File>) -> io::Result<u64> {
    let mut bom = [0; 3];
    reader.read_exact(&mut bom)?;
    if bom != [0xEF, 0xBB, 0xBF] {
        reader.seek(SeekFrom::Start(0))?;
        return Ok(0);
    }
    Ok(3)
}

#[tauri::command]
#[specta::specta]
pub async fn count_pgn_games(
    file: PathBuf,
    state: tauri::State<'_, AppState>,
) -> Result<i32, Error> {
    let files_string = file.to_string_lossy().to_string();

    let file = File::open(&file)?;

    let mut parser = PgnParser::new(file.try_clone()?);

    let mut offsets = Vec::new();

    let mut count = 0;

    while let Ok(skipped) = parser.skip_games(1) {
        if skipped == 0 {
            break;
        }
        count += 1;
        if count % GAME_OFFSET_FREQ as i32 == 0 {
            let cur_pos = parser.position()?;
            offsets.push(cur_pos);
        }
    }

    state.pgn_offsets.insert(files_string, offsets);
    Ok(count)
}

#[tauri::command]
#[specta::specta]
pub async fn read_games(
    file: PathBuf,
    start: i32,
    end: i32,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, Error> {
    let file_r = File::open(&file)?;

    let mut parser = PgnParser::new(file_r.try_clone()?);

    parser.offset_by_index(start as usize, &state, &file.to_string_lossy().to_string())?;

    let mut games: Vec<String> = Vec::with_capacity((end - start) as usize);

    for _ in start..=end {
        let game = parser.read_game()?;
        if game.is_empty() {
            break;
        }
        games.push(game);
    }
    Ok(games)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_game(
    file: PathBuf,
    n: i32,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    let file_r = File::open(&file)?;

    let mut parser = PgnParser::new(file_r.try_clone()?);

    parser.offset_by_index(n as usize, &state, &file.to_string_lossy().to_string())?;

    let starting_bytes = parser.position()?;

    parser.skip_games(1)?;

    let mut file_w = OpenOptions::new().write(true).open(file)?;

    file_w.seek(SeekFrom::Start(starting_bytes))?;

    write_to_end(&mut parser.reader, &mut file_w)?;
    Ok(())
}

fn write_to_end<R: Read>(reader: &mut R, writer: &mut File) -> io::Result<()> {
    io::copy(reader, writer)?;
    let end = writer.stream_position()?;
    writer.set_len(end)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn write_game(
    file_path: String,
    n: i32,
    pgn: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    let file = PathBuf::from(file_path);
    if !file.exists() {
        File::create(&file)?;
    }

    let mut file_r = File::open(&file)?;
    let mut file_w = OpenOptions::new().write(true).open(&file)?;

    let mut tmpf = tempfile::tempfile()?;
    io::copy(&mut file_r.try_clone()?, &mut tmpf)?;

    file_r.seek(SeekFrom::Start(0))?;
    let mut parser = PgnParser::new(file_r.try_clone()?);

    parser.offset_by_index(n as usize, &state, &file.to_string_lossy().to_string())?;

    tmpf.seek(SeekFrom::Start(parser.position()?))?;
    tmpf.write_all(pgn.as_bytes())?;

    parser.skip_games(1)?;

    write_to_end(&mut parser.reader, &mut tmpf)?;

    tmpf.seek(SeekFrom::Start(0))?;

    write_to_end(&mut tmpf, &mut file_w)?;

    Ok(())
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

    if let Some(study_label) = study_label {
        parts.push(study_label);
    } else if let Some(event) = event
        .as_ref()
        .filter(|_| players_are_generic(&white, &black))
    {
        parts.push(event.clone());
    }

    match (white, black) {
        (Some(white), Some(black)) => parts.push(format!("{white} - {black}")),
        (Some(white), None) => parts.push(white),
        (None, Some(black)) => parts.push(black),
        (None, None) => {
            if let Some(event) = event {
                parts.push(event);
            }
        }
    }

    if let Some(round) = round {
        parts.push(format!("Round {round}"));
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
        "unknown" | "anonymous" | "?"
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
            "2026.02.28 My classical games - Model game 7 Unknown - Unknown"
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
            "0007 2026.02.28 My classical games - Model game 7 Unknown - Unknown"
        );
    }
}
