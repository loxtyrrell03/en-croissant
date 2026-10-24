//! Byte-preserving PGN reads and source-checked, staged writes.
//!
//! Writes serialize inside this process and recheck the complete source after
//! staging. This is not a filesystem CAS against uncooperative external editors.
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::SystemTime,
};

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;

const STRIDE: u32 = 100;
const MAX_GAME_BYTES: u64 = 8 * 1024 * 1024;
const MAX_RANGE_BYTES: usize = 32 * 1024 * 1024;
static WRITES: Mutex<()> = Mutex::new(());
static INDEXING: Mutex<()> = Mutex::new(());
static INDEXES: Lazy<Mutex<HashMap<PathBuf, Arc<Index>>>> = Lazy::new(Default::default);

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PgnSourceRef {
    pub file: String,
    pub index: u32,
    pub identity: String,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PgnGameSnapshot {
    pub pgn: String,
    pub index: u32,
    pub identity: String,
    pub game_count: u32,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PgnGameBatch {
    pub games: Vec<PgnGameSnapshot>,
    pub game_count: u32,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PgnWriteResult {
    pub file: String,
    pub index: u32,
    pub identity: String,
    pub game_count: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Signature {
    len: u64,
    modified: SystemTime,
    created: Option<SystemTime>,
}

fn signature(file: &File) -> io::Result<Signature> {
    let meta = file.metadata()?;
    Ok(Signature {
        len: meta.len(),
        modified: meta.modified()?,
        created: meta.created().ok(),
    })
}

fn problem(message: &str) -> io::Error {
    io::Error::other(message)
}
fn changed() -> io::Error {
    problem("The original PGN changed while preparing this write. It was not overwritten. Retry or save a separate copy.")
}

#[derive(Clone, Copy, Debug)]
struct Span {
    start: u64,
    end: u64,
}

/// Delimit games without decoding or rewriting neighbouring bytes. Tags and
/// comments have their own lexical states; a result inside either is not a
/// boundary. Headerless games and results on a single line are supported.
#[derive(Default)]
struct Lexer {
    tag: bool,
    quoted: bool,
    escaped: bool,
    comment: bool,
    line_comment: bool,
    line_space: bool,
    depth: usize,
    ended: bool,
    moves: bool,
    content: bool,
    token: Vec<u8>,
}
impl Lexer {
    fn token_end(&mut self) {
        if self.depth == 0 && matches!(self.token.as_slice(), b"1-0" | b"0-1" | b"1/2-1/2" | b"*") {
            self.ended = true;
        }
        self.token.clear();
    }
    fn byte(&mut self, byte: u8) -> bool {
        let line_space = self.line_space;
        self.line_space = if byte == b'\n' || byte == b'\r' {
            true
        } else {
            self.line_space && byte.is_ascii_whitespace()
        };
        if self.line_comment {
            if byte == b'\n' || byte == b'\r' {
                self.line_comment = false;
            }
            return false;
        }
        if self.comment {
            if byte == b'}' {
                self.comment = false;
            }
            return false;
        }
        if self.tag {
            if self.escaped {
                self.escaped = false;
            } else if self.quoted && byte == b'\\' {
                self.escaped = true;
            } else if byte == b'"' {
                self.quoted = !self.quoted;
            } else if !self.quoted && byte == b']' {
                self.tag = false;
            }
            return false;
        }
        if byte.is_ascii_whitespace() {
            self.token_end();
            return false;
        }
        if byte == b';' || (byte == b'%' && line_space) {
            self.token_end();
            self.line_comment = true;
            return false;
        }
        if byte == b'{' {
            self.token_end();
            self.comment = true;
            self.content = true;
            return false;
        }
        if byte == b'[' && self.depth == 0 {
            self.token_end();
            let boundary = self.moves || self.ended;
            if boundary {
                *self = Self::default();
            }
            self.tag = true;
            self.content = true;
            return boundary;
        }
        if byte == b'(' {
            self.token_end();
            self.depth += 1;
            self.content = true;
            return false;
        }
        if byte == b')' {
            self.token_end();
            self.depth = self.depth.saturating_sub(1);
            return false;
        }
        let boundary = self.ended && self.depth == 0;
        if boundary {
            *self = Self::default();
        }
        self.moves = true;
        self.content = true;
        if byte == b'*' {
            self.token_end();
            self.ended = self.depth == 0;
        } else if self.token.len() < 16 {
            self.token.push(byte);
        }
        boundary
    }
}

fn prelude(file: &mut File) -> io::Result<u64> {
    file.seek(SeekFrom::Start(0))?;
    let mut bytes = [0; 3];
    let n = file.read(&mut bytes)?;
    Ok(if n == 3 && bytes == [0xef, 0xbb, 0xbf] {
        3
    } else {
        0
    })
}

/// Return the number of complete spans visited. A false callback stops before
/// the next game; cached ranged reads therefore scan at most one sparse block.
fn scan<R: Read + Seek>(
    file: &mut R,
    start: u64,
    mut visit: impl FnMut(u32, Span) -> io::Result<bool>,
) -> io::Result<u32> {
    file.seek(SeekFrom::Start(start))?;
    let mut lexer = Lexer {
        line_space: true,
        ..Default::default()
    };
    let mut offset = start;
    let mut game_start = start;
    let mut count = 0u32;
    let mut bytes = [0; 64 * 1024];
    loop {
        let n = file.read(&mut bytes)?;
        if n == 0 {
            break;
        }
        for byte in &bytes[..n] {
            if lexer.byte(*byte) {
                if !visit(
                    count,
                    Span {
                        start: game_start,
                        end: offset,
                    },
                )? {
                    return Ok(count + 1);
                }
                count = count
                    .checked_add(1)
                    .ok_or_else(|| problem("Too many PGN games"))?;
                game_start = offset;
            }
            offset += 1;
        }
    }
    if lexer.content {
        visit(
            count,
            Span {
                start: game_start,
                end: offset,
            },
        )?;
        count = count
            .checked_add(1)
            .ok_or_else(|| problem("Too many PGN games"))?;
    }
    Ok(count)
}

struct Index {
    signature: Signature,
    checkpoints: Vec<u64>,
    count: u32,
}

fn index(path: &Path, source: &mut File) -> io::Result<Arc<Index>> {
    let before = signature(source)?;
    if let Some(cached) = INDEXES
        .lock()
        .map_err(|_| problem("PGN index is unavailable"))?
        .get(path)
    {
        if cached.signature == before {
            return Ok(cached.clone());
        }
    }
    // A cold preview and its visible header ranges can arrive together. Recheck
    // after acquiring the builder lock so they share one full-file scan.
    let _building = INDEXING
        .lock()
        .map_err(|_| problem("PGN indexing is unavailable"))?;
    if let Some(cached) = INDEXES
        .lock()
        .map_err(|_| problem("PGN index is unavailable"))?
        .get(path)
    {
        if cached.signature == before {
            return Ok(cached.clone());
        }
    }
    let start = prelude(source)?;
    let mut checkpoints = Vec::new();
    let count = scan(source, start, |n, span| {
        if n % STRIDE == 0 {
            checkpoints.push(span.start);
        }
        Ok(true)
    })?;
    if signature(source)? != before {
        return Err(changed());
    }
    let value = Arc::new(Index {
        signature: before,
        checkpoints,
        count,
    });
    let mut cache = INDEXES
        .lock()
        .map_err(|_| problem("PGN index is unavailable"))?;
    if cache.len() >= 16 {
        cache.clear();
    }
    cache.insert(path.to_path_buf(), value.clone());
    Ok(value)
}
fn invalidate(path: &Path) {
    if let Ok(mut cache) = INDEXES.lock() {
        cache.remove(path);
    }
}

fn read_span(source: &mut File, span: Span) -> io::Result<String> {
    let len = span.end - span.start;
    if len > MAX_GAME_BYTES {
        return Err(problem("This PGN game exceeds the 8 MiB read limit."));
    }
    source.seek(SeekFrom::Start(span.start))?;
    let mut bytes = Vec::with_capacity(len as usize);
    source.take(len).read_to_end(&mut bytes)?;
    String::from_utf8(bytes)
        .map_err(|_| problem("This PGN game is not valid UTF-8. The file was not changed."))
}
fn identity(pgn: &str) -> String {
    // Preserve all semantic text, including comments and tags. Only line-ending
    // and outer separator differences are insignificant to source identity.
    hex::encode(Sha256::digest(
        pgn.trim_start_matches('\u{feff}')
            .trim()
            .replace("\r\n", "\n")
            .as_bytes(),
    ))
}
fn digest(source: &mut File) -> io::Result<Vec<u8>> {
    source.seek(SeekFrom::Start(0))?;
    let mut hash = Sha256::new();
    let mut bytes = [0; 64 * 1024];
    loop {
        let n = source.read(&mut bytes)?;
        if n == 0 {
            break;
        }
        hash.update(&bytes[..n]);
    }
    Ok(hash.finalize().to_vec())
}

pub fn count_games(path: &Path) -> io::Result<u32> {
    let path = fs::canonicalize(path)?;
    let value = index(&path, &mut File::open(&path)?)?;
    if signature(&File::open(&path)?)? != value.signature {
        return Err(changed());
    }
    Ok(value.count)
}

fn read_range(path: &Path, start: u32, end: u32) -> io::Result<(Vec<String>, u32)> {
    if end < start || end.saturating_sub(start) > 1000 {
        return Err(problem("Invalid PGN game range."));
    }
    let path = fs::canonicalize(path)?;
    let mut source = File::open(&path)?;
    let cached = index(&path, &mut source)?;
    if start >= cached.count {
        return Ok((Vec::new(), cached.count));
    }
    let block = start / STRIDE;
    let mut reader = File::open(&path)?;
    let mut games = Vec::new();
    let mut range_bytes = 0usize;
    scan(
        &mut source,
        cached.checkpoints[block as usize],
        |n, span| {
            let n = n + block * STRIDE;
            if n >= start {
                let game = read_span(&mut reader, span)?;
                range_bytes += game.len();
                if range_bytes > MAX_RANGE_BYTES {
                    return Err(problem("These games exceed the 32 MiB ranged-read limit. Read fewer games together."));
                }
                games.push(game);
            }
            Ok(n < end)
        },
    )?;
    if signature(&source)? != cached.signature
        || signature(&File::open(&path)?)? != cached.signature
    {
        return Err(changed());
    }
    Ok((games, cached.count))
}

pub fn read_games(path: &Path, start: u32, end: u32) -> io::Result<Vec<String>> {
    read_range(path, start, end).map(|value| value.0)
}
pub fn read_game(path: &Path, n: u32) -> io::Result<PgnGameSnapshot> {
    read_snapshots(path, n, n)?
        .games
        .into_iter()
        .next()
        .ok_or_else(|| problem("That game is no longer in the PGN file. Refresh the game list."))
}
pub fn read_snapshots(path: &Path, start: u32, end: u32) -> io::Result<PgnGameBatch> {
    let (games, game_count) = read_range(path, start, end)?;
    Ok(PgnGameBatch {
        game_count,
        games: games
            .into_iter()
            .enumerate()
            .map(|(offset, pgn)| PgnGameSnapshot {
                identity: identity(&pgn),
                pgn,
                index: start + offset as u32,
                game_count,
            })
            .collect(),
    })
}

fn payload(pgn: &str) -> io::Result<String> {
    let pgn = pgn.trim_start_matches('\u{feff}');
    if pgn.len() as u64 > MAX_GAME_BYTES {
        return Err(problem("This PGN game exceeds the 8 MiB write limit."));
    }
    if pgn.trim().is_empty() {
        return Err(problem("The PGN game is empty."));
    }
    let count = scan(&mut io::Cursor::new(pgn.as_bytes()), 0, |_, _| Ok(true))?;
    if count != 1 {
        return Err(problem("A save must contain exactly one PGN game."));
    }
    Ok(format!("{}\n\n", pgn.trim()))
}

#[derive(Clone, Copy)]
enum Edit<'a> {
    Replace(u32, &'a str),
    Delete(u32, &'a str),
    Append,
}
struct Prepared {
    path: PathBuf,
    signature: Signature,
    original: Vec<u8>,
    pending: tempfile::NamedTempFile,
    index: u32,
    count: u32,
    identity: String,
}
impl Prepared {
    fn check(&self) -> io::Result<()> {
        let mut current = File::open(&self.path)?;
        if signature(&current)? != self.signature || digest(&mut current)? != self.original {
            return Err(changed());
        }
        Ok(())
    }
}

fn prepare(
    path: &Path,
    edit: Edit<'_>,
    pgn: Option<&str>,
    directory: &Path,
) -> io::Result<Prepared> {
    let path = fs::canonicalize(path)?;
    let mut source = File::open(&path)?;
    let before = signature(&source)?;
    let original = digest(&mut source)?;
    let start = prelude(&mut source)?;
    let mut requested = None;
    let wanted = match edit {
        Edit::Replace(n, _) | Edit::Delete(n, _) => Some(n),
        Edit::Append => None,
    };
    let count = scan(&mut source, start, |n, span| {
        if wanted == Some(n) {
            requested = Some(span);
        }
        Ok(true)
    })?;
    let (target, actual_index) = match edit {
        Edit::Append => (
            Span {
                start: before.len,
                end: before.len,
            },
            count,
        ),
        Edit::Replace(n, expected) | Edit::Delete(n, expected) => {
            if expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err(problem(
                    "Original game identity is missing. Reopen the source or save a separate copy.",
                ));
            }
            if let Some(span) = requested.filter(|span| {
                read_span(&mut source, *span).is_ok_and(|pgn| identity(&pgn) == expected)
            }) {
                (span, n)
            } else {
                let mut matches = Vec::new();
                let mut reader = File::open(&path)?;
                scan(&mut source, start, |index, span| {
                    if identity(&read_span(&mut reader, span)?) == expected {
                        matches.push((span, index));
                    }
                    Ok(matches.len() < 2)
                })?;
                match matches.as_slice() {
                    [found] => *found,
                    [] => return Err(problem("This game changed or is no longer in its original file. It was not overwritten; save a separate copy.")),
                    _ => return Err(problem("The original game now has more than one matching location. Nothing was overwritten; save a separate copy.")),
                }
            }
        }
    };
    if signature(&source)? != before {
        return Err(changed());
    }
    let text = pgn.map(payload).transpose()?;
    let mut pending = tempfile::Builder::new()
        .prefix(".encroissant-pgn-")
        .tempfile_in(directory)?;
    source.seek(SeekFrom::Start(0))?;
    io::copy(&mut (&mut source).take(target.start), pending.as_file_mut())?;
    if matches!(edit, Edit::Append) && before.len > start {
        pending.write_all(b"\n\n")?;
    }
    if let Some(text) = &text {
        pending.write_all(text.as_bytes())?;
    }
    source.seek(SeekFrom::Start(target.end))?;
    io::copy(&mut source, pending.as_file_mut())?;
    pending.as_file().sync_all()?;
    let result_count = if matches!(edit, Edit::Append) {
        count + 1
    } else if matches!(edit, Edit::Delete(_, _)) {
        count - 1
    } else {
        count
    };
    Ok(Prepared {
        path,
        signature: before,
        original,
        pending,
        index: actual_index,
        count: result_count,
        identity: text.as_deref().map(identity).unwrap_or_default(),
    })
}

fn metadata_bytes(metadata: &str) -> io::Result<&[u8]> {
    if metadata.len() > 16 * 1024
        || !serde_json::from_str::<serde_json::Value>(metadata).is_ok_and(|value| value.is_object())
    {
        return Err(problem("Invalid PGN file metadata."));
    }
    Ok(metadata.as_bytes())
}
fn occupied(path: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}
fn stage_metadata(directory: &Path, bytes: &[u8]) -> io::Result<tempfile::NamedTempFile> {
    let mut pending = tempfile::Builder::new()
        .prefix(".encroissant-info-")
        .tempfile_in(directory)?;
    pending.write_all(bytes)?;
    pending.as_file().sync_all()?;
    Ok(pending)
}
fn discard_reserved_info(path: &Path, expected: &[u8]) {
    // An owner edit after reservation is no longer our disposable metadata.
    if fs::read(path).is_ok_and(|bytes| bytes == expected) {
        let _ = fs::remove_file(path);
    }
}
fn ensure_info(path: &Path, metadata: &str) -> io::Result<()> {
    let bytes = metadata_bytes(metadata)?;
    let info = path.with_extension("info");
    if occupied(&info)? {
        return Ok(());
    }
    match stage_metadata(path.parent().unwrap(), bytes)?.persist_noclobber(&info) {
        Ok(_) => Ok(()),
        Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error.error),
    }
}

fn publish_replacement(pending: tempfile::NamedTempFile, path: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;
        let recovery = tempfile::Builder::new()
            .prefix(".encroissant-recovery-")
            .tempdir_in(path.parent().unwrap())?;
        let backup = recovery.path().join("original.pgn");
        let staged = pending.into_temp_path();
        let wide = |value: &Path| {
            value
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>()
        };
        let target_w = wide(path);
        let staged_w = wide(&staged);
        let backup_w = wide(&backup);
        let ok = unsafe {
            ReplaceFileW(
                target_w.as_ptr(),
                staged_w.as_ptr(),
                backup_w.as_ptr(),
                0,
                std::ptr::null(),
                std::ptr::null(),
            )
        };
        if ok == 0 {
            let error = io::Error::last_os_error();
            if backup.exists() {
                let _retained = recovery.keep();
                return Err(problem(&format!(
                    "PGN replacement failed: {error}. The original is retained at {}",
                    backup.display()
                )));
            }
            return Err(error);
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        pending.persist(path).map_err(|error| error.error)?;
        File::open(path.parent().unwrap())?.sync_all()
    }
}

fn replace_inner(
    path: &Path,
    edit: Edit<'_>,
    pgn: Option<&str>,
    metadata: &str,
    before_publish: impl FnOnce(),
) -> io::Result<PgnWriteResult> {
    let permissions = fs::metadata(path)?.permissions();
    if permissions.readonly() {
        return Err(problem(
            "The PGN file is read-only. Nothing was overwritten.",
        ));
    }
    let parent = fs::canonicalize(path)?.parent().unwrap().to_path_buf();
    let prepared = prepare(path, edit, pgn, &parent)?;
    prepared.pending.as_file().set_permissions(permissions)?;
    ensure_info(&prepared.path, metadata)?;
    before_publish();
    prepared.check()?;
    let result = PgnWriteResult {
        file: prepared.path.to_string_lossy().into_owned(),
        index: prepared.index,
        identity: prepared.identity,
        game_count: prepared.count,
    };
    publish_replacement(prepared.pending, &prepared.path)?;
    invalidate(&prepared.path);
    Ok(result)
}

pub fn write_game(
    path: &Path,
    n: u32,
    expected: &str,
    pgn: &str,
    metadata: &str,
) -> io::Result<PgnWriteResult> {
    let _guard = WRITES
        .lock()
        .map_err(|_| problem("PGN writer is unavailable"))?;
    replace_inner(path, Edit::Replace(n, expected), Some(pgn), metadata, || {})
}
pub fn delete_game(path: &Path, n: u32, expected: &str) -> io::Result<PgnWriteResult> {
    let _guard = WRITES
        .lock()
        .map_err(|_| problem("PGN writer is unavailable"))?;
    replace_inner(
        path,
        Edit::Delete(n, expected),
        None,
        "{\"type\":\"game\",\"tags\":[]}",
        || {},
    )
}
pub fn append_game(path: &Path, pgn: &str, metadata: &str) -> io::Result<PgnWriteResult> {
    let _guard = WRITES
        .lock()
        .map_err(|_| problem("PGN writer is unavailable"))?;
    replace_inner(path, Edit::Append, Some(pgn), metadata, || {})
}

/// Publish a complete new file without clobbering a PGN or its metadata. Optional
/// temporary-file promotion preserves every other game in the captured source.
pub fn create_game(
    path: &Path,
    pgn: &str,
    metadata: &str,
    source: Option<&PgnSourceRef>,
) -> io::Result<PgnWriteResult> {
    let _guard = WRITES
        .lock()
        .map_err(|_| problem("PGN writer is unavailable"))?;
    let parent = fs::canonicalize(
        path.parent()
            .ok_or_else(|| problem("Missing PGN directory"))?,
    )?;
    let filename = path
        .file_name()
        .ok_or_else(|| problem("Missing PGN filename"))?;
    let proposed = parent.join(filename);
    let mut from_source = source
        .map(|source| {
            prepare(
                Path::new(&source.file),
                Edit::Replace(source.index, &source.identity),
                Some(pgn),
                &parent,
            )
        })
        .transpose()?;
    let mut pending = if let Some(prepared) = from_source.as_mut() {
        // Move the staged handle out while retaining the source check below.
        std::mem::replace(
            &mut prepared.pending,
            tempfile::Builder::new()
                .prefix(".encroissant-pgn-")
                .tempfile_in(&parent)?,
        )
    } else {
        let mut file = tempfile::Builder::new()
            .prefix(".encroissant-pgn-")
            .tempfile_in(&parent)?;
        file.write_all(payload(pgn)?.as_bytes())?;
        file.as_file().sync_all()?;
        file
    };
    let bytes = metadata_bytes(metadata)?;
    for attempt in 0..10_000u32 {
        let candidate = if attempt == 0 {
            proposed.clone()
        } else {
            let stem = proposed.file_stem().unwrap().to_string_lossy();
            let extension = proposed
                .extension()
                .map(|value| format!(".{}", value.to_string_lossy()))
                .unwrap_or_default();
            parent.join(format!("{stem} ({}){extension}", attempt + 1))
        };
        let mut coach_path = candidate.as_os_str().to_os_string();
        coach_path.push(".coach.json");
        if occupied(&candidate)? || occupied(Path::new(&coach_path))? {
            continue;
        }
        let info = candidate.with_extension("info");
        match stage_metadata(&parent, bytes)?.persist_noclobber(&info) {
            Ok(_) => {}
            Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.error),
        }
        if let Some(prepared) = &from_source {
            if let Err(error) = prepared.check() {
                discard_reserved_info(&info, bytes);
                return Err(error);
            }
        }
        match pending.persist_noclobber(&candidate) {
            Ok(_) => {
                return Ok(PgnWriteResult {
                    file: candidate.to_string_lossy().into_owned(),
                    index: from_source.as_ref().map(|value| value.index).unwrap_or(0),
                    game_count: from_source.as_ref().map(|value| value.count).unwrap_or(1),
                    identity: identity(pgn),
                })
            }
            Err(error) => {
                discard_reserved_info(&info, bytes);
                if error.error.kind() != io::ErrorKind::AlreadyExists {
                    return Err(error.error);
                }
                pending = error.file;
            }
        }
    }
    Err(problem("Could not choose a free PGN filename."))
}

#[cfg(test)]
#[path = "pgn_files_tests.rs"]
mod tests;
