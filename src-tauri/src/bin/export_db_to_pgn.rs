mod error {
    pub type Error = Box<dyn std::error::Error + Send + Sync + 'static>;
}

#[allow(dead_code)]
#[path = "../db/encoding.rs"]
mod encoding;

use encoding::{decode_game_to_movetext, decode_move, iter_mainline_move_bytes};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use shakmaty::{
    fen::Fen,
    san::SanPlus,
    uci::UciMove,
    CastlingMode, Chess, EnPassantMode, FromSetup, Position, PositionError,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    env,
    fs::{create_dir_all, File},
    io::{self, BufWriter, Write},
    path::PathBuf,
};

const DEFAULT_CHUNK_BYTES: u64 = 25 * 1024 * 1024;
const DEFAULT_INDEX_MAX_PLY: usize = 80;
const POSITION_INDEX_VERSION: u32 = 1;
const POSITION_INDEX_DIR: &str = "position-index";
const POSITION_INDEX_SHARDS_DIR: &str = "shards";

struct Args {
    source: PathBuf,
    dest_dir: PathBuf,
    chunk_bytes: u64,
    index_max_ply: usize,
}

struct ExportGame {
    event: Option<String>,
    site: Option<String>,
    date: Option<String>,
    round: Option<String>,
    white: Option<String>,
    black: Option<String>,
    result: Option<String>,
    time_control: Option<String>,
    eco: Option<String>,
    white_elo: Option<i64>,
    black_elo: Option<i64>,
    ply_count: Option<i64>,
    fen: Option<String>,
    moves: Vec<u8>,
}

struct ChunkWriter {
    dest_dir: PathBuf,
    chunk_bytes: u64,
    index: u32,
    current_bytes: u64,
    writer: Option<BufWriter<File>>,
}

#[derive(Default)]
struct PositionIndexBuilder {
    max_ply: usize,
    game_count: usize,
    positions: BTreeMap<String, BTreeMap<String, PositionMoveBucket>>,
}

#[derive(Clone, Default, Serialize)]
struct PositionMoveBucket {
    #[serde(rename = "move")]
    san: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    uci: Option<String>,
    white: u32,
    draw: u32,
    black: u32,
    #[serde(rename = "lastPlayed", skip_serializing_if = "Option::is_none")]
    last_played: Option<String>,
}

#[derive(Serialize)]
struct PositionIndexManifest {
    version: u32,
    #[serde(rename = "maxPly")]
    max_ply: usize,
    #[serde(rename = "gameCount")]
    game_count: usize,
    #[serde(rename = "positionCount")]
    position_count: usize,
    #[serde(rename = "latestDate")]
    latest_date: Option<String>,
    shards: Vec<String>,
}

#[derive(Serialize)]
struct PositionIndexShard<'a> {
    version: u32,
    positions: &'a BTreeMap<String, BTreeMap<String, PositionMoveBucket>>,
}

fn main() -> Result<(), error::Error> {
    let args = parse_args()?;
    let exported = export_database(&args)?;
    println!(
        "Exported {exported} game{} from {} to {}",
        if exported == 1 { "" } else { "s" },
        args.source.display(),
        args.dest_dir.display()
    );
    Ok(())
}

fn parse_args() -> Result<Args, error::Error> {
    let mut source = None;
    let mut dest_dir = None;
    let mut chunk_bytes = DEFAULT_CHUNK_BYTES;
    let mut index_max_ply = DEFAULT_INDEX_MAX_PLY;
    let mut args = env::args().skip(1);

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--source" => source = args.next().map(PathBuf::from),
            "--dest-dir" => dest_dir = args.next().map(PathBuf::from),
            "--chunk-mb" => {
                let value = args.next().ok_or_else(|| invalid_input("--chunk-mb needs a value"))?;
                let mb = value.parse::<u64>()?;
                chunk_bytes = mb.max(1) * 1024 * 1024;
            }
            "--index-max-ply" => {
                let value = args
                    .next()
                    .ok_or_else(|| invalid_input("--index-max-ply needs a value"))?;
                index_max_ply = value.parse::<usize>()?.max(1);
            }
            "--help" | "-h" => {
                println!(
                    "Usage: export_db_to_pgn --source <database.db3> --dest-dir <folder> [--chunk-mb 25] [--index-max-ply 80]"
                );
                std::process::exit(0);
            }
            _ => return Err(invalid_input(format!("Unknown argument: {arg}"))),
        }
    }

    Ok(Args {
        source: source.ok_or_else(|| invalid_input("--source is required"))?,
        dest_dir: dest_dir.ok_or_else(|| invalid_input("--dest-dir is required"))?,
        chunk_bytes,
        index_max_ply,
    })
}

fn export_database(args: &Args) -> Result<usize, error::Error> {
    create_dir_all(&args.dest_dir)?;

    let conn = Connection::open_with_flags(
        &args.source,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;

    let mut statement = conn.prepare(
        r#"
        SELECT
            Events.Name,
            Sites.Name,
            Games.Date,
            CAST(Games.Round AS TEXT),
            WhitePlayers.Name,
            BlackPlayers.Name,
            Games.Result,
            Games.TimeControl,
            Games.ECO,
            Games.WhiteElo,
            Games.BlackElo,
            Games.PlyCount,
            Games.FEN,
            Games.Moves
        FROM Games
        LEFT JOIN Events ON Games.EventID = Events.ID
        LEFT JOIN Sites ON Games.SiteID = Sites.ID
        LEFT JOIN Players AS WhitePlayers ON Games.WhiteID = WhitePlayers.ID
        LEFT JOIN Players AS BlackPlayers ON Games.BlackID = BlackPlayers.ID
        ORDER BY Games.ID ASC
        "#,
    )?;

    let mut rows = statement.query([])?;
    let mut writer = ChunkWriter::new(args.dest_dir.clone(), args.chunk_bytes);
    let mut position_index = PositionIndexBuilder::new(args.index_max_ply);
    let mut exported = 0usize;

    while let Some(row) = rows.next()? {
        let game = ExportGame {
            event: row.get(0)?,
            site: row.get(1)?,
            date: row.get(2)?,
            round: row.get(3)?,
            white: row.get(4)?,
            black: row.get(5)?,
            result: row.get(6)?,
            time_control: row.get(7)?,
            eco: row.get(8)?,
            white_elo: row.get(9)?,
            black_elo: row.get(10)?,
            ply_count: row.get(11)?,
            fen: row.get(12)?,
            moves: row.get(13)?,
        };
        position_index.index_game(&game)?;
        let pgn = render_pgn_game(&game)?;
        writer.write_game(pgn.as_bytes())?;
        exported += 1;
    }

    writer.flush()?;
    position_index.write_to(&args.dest_dir)?;
    Ok(exported)
}

impl ChunkWriter {
    fn new(dest_dir: PathBuf, chunk_bytes: u64) -> Self {
        Self {
            dest_dir,
            chunk_bytes,
            index: 0,
            current_bytes: 0,
            writer: None,
        }
    }

    fn write_game(&mut self, bytes: &[u8]) -> Result<(), error::Error> {
        let next_size = bytes.len() as u64;
        if self.writer.is_none()
            || (self.current_bytes > 0 && self.current_bytes + next_size > self.chunk_bytes)
        {
            self.start_chunk()?;
        }

        if let Some(writer) = self.writer.as_mut() {
            writer.write_all(bytes)?;
        }
        self.current_bytes += next_size;
        Ok(())
    }

    fn start_chunk(&mut self) -> Result<(), error::Error> {
        self.flush()?;
        self.index += 1;
        self.current_bytes = 0;
        let path = self.dest_dir.join(format!("chunk-{:03}.pgn", self.index));
        self.writer = Some(BufWriter::new(File::create(path)?));
        Ok(())
    }

    fn flush(&mut self) -> Result<(), error::Error> {
        if let Some(writer) = self.writer.as_mut() {
            writer.flush()?;
        }
        self.writer = None;
        Ok(())
    }
}

impl PositionIndexBuilder {
    fn new(max_ply: usize) -> Self {
        Self {
            max_ply,
            ..Self::default()
        }
    }

    fn index_game(&mut self, game: &ExportGame) -> Result<(), error::Error> {
        self.game_count += 1;
        let mut position = starting_position_from_fen(game.fen.as_deref())?;

        for (ply, byte) in iter_mainline_move_bytes(&game.moves).enumerate() {
            if ply >= self.max_ply {
                break;
            }

            let Some(m) = decode_move(byte, &position) else {
                break;
            };

            let position_key = position_index_key(&position);
            let san = SanPlus::from_move(position.clone(), &m).to_string();
            let uci = UciMove::from_move(&m, CastlingMode::Standard).to_string();
            let moves = self.positions.entry(position_key).or_default();
            let bucket = moves
                .entry(san.clone())
                .or_insert_with(|| PositionMoveBucket::new(san.clone(), Some(uci.clone())));
            bucket.uci.get_or_insert(uci);
            bucket.add_result(game.result.as_deref(), game.date.as_deref());

            position.play_unchecked(&m);
        }

        Ok(())
    }

    fn write_to(&self, dest_dir: &PathBuf) -> Result<(), error::Error> {
        let index_dir = dest_dir.join(POSITION_INDEX_DIR);
        let shards_dir = index_dir.join(POSITION_INDEX_SHARDS_DIR);
        create_dir_all(&shards_dir)?;

        let mut shards: BTreeMap<String, BTreeMap<String, BTreeMap<String, PositionMoveBucket>>> =
            BTreeMap::new();
        for (fen, moves) in &self.positions {
            shards
                .entry(position_index_shard_for_fen(fen))
                .or_default()
                .insert(fen.clone(), moves.clone());
        }

        let mut shard_names = BTreeSet::new();
        for (shard, positions) in &shards {
            let filename = format!("{shard}.json");
            let path = shards_dir.join(&filename);
            let writer = BufWriter::new(File::create(path)?);
            serde_json::to_writer(
                writer,
                &PositionIndexShard {
                    version: POSITION_INDEX_VERSION,
                    positions,
                },
            )?;
            shard_names.insert(filename);
        }

        let manifest = PositionIndexManifest {
            version: POSITION_INDEX_VERSION,
            max_ply: self.max_ply,
            game_count: self.game_count,
            position_count: self.positions.len(),
            latest_date: self.latest_date(),
            shards: shard_names.into_iter().collect(),
        };
        let writer = BufWriter::new(File::create(index_dir.join("index.json"))?);
        serde_json::to_writer_pretty(writer, &manifest)?;

        Ok(())
    }

    fn latest_date(&self) -> Option<String> {
        self.positions
            .values()
            .flat_map(|moves| moves.values())
            .filter_map(|bucket| bucket.last_played.as_ref())
            .max()
            .cloned()
    }
}

impl PositionMoveBucket {
    fn new(san: String, uci: Option<String>) -> Self {
        Self {
            san,
            uci,
            white: 0,
            draw: 0,
            black: 0,
            last_played: None,
        }
    }

    fn add_result(&mut self, result: Option<&str>, date: Option<&str>) {
        match normalized_result(result) {
            "1-0" => self.white = self.white.saturating_add(1),
            "0-1" => self.black = self.black.saturating_add(1),
            _ => self.draw = self.draw.saturating_add(1),
        }

        if let Some(date) = non_empty(date) {
            if self
                .last_played
                .as_ref()
                .map_or(true, |current| date > current.as_str())
            {
                self.last_played = Some(date.to_string());
            }
        }
    }
}

fn starting_position_from_fen(fen: Option<&str>) -> Result<Chess, error::Error> {
    if let Some(fen) = non_empty(fen) {
        let fen = Fen::from_ascii(fen.as_bytes())?;
        let setup = fen.into_setup();
        let castling_mode = CastlingMode::detect(&setup);
        Ok(Chess::from_setup(setup, castling_mode)
            .or_else(PositionError::ignore_too_much_material)?)
    } else {
        Ok(Chess::default())
    }
}

fn position_index_key(position: &Chess) -> String {
    Fen::from_position(position.clone(), EnPassantMode::Legal)
        .to_string()
        .split_whitespace()
        .take(4)
        .collect::<Vec<_>>()
        .join(" ")
}

fn position_index_shard_for_fen(fen: &str) -> String {
    let mut hash = 0x811c9dc5u32;
    for byte in fen.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{:02x}", hash & 0xff)
}

fn render_pgn_game(game: &ExportGame) -> Result<String, error::Error> {
    let initial_fen = game
        .fen
        .as_deref()
        .and_then(|fen| fen.parse::<Fen>().ok())
        .unwrap_or_default();
    let moves = decode_game_to_movetext(&game.moves, initial_fen).unwrap_or_default();
    let mut output = Vec::new();

    write_tag(&mut output, "Event", game.event.as_deref().unwrap_or(""))?;
    write_tag(&mut output, "Site", game.site.as_deref().unwrap_or(""))?;
    write_tag(&mut output, "Date", game.date.as_deref().unwrap_or(""))?;
    write_tag(&mut output, "Round", game.round.as_deref().unwrap_or(""))?;
    write_tag(&mut output, "White", game.white.as_deref().unwrap_or(""))?;
    write_tag(&mut output, "Black", game.black.as_deref().unwrap_or(""))?;
    write_tag(&mut output, "Result", normalized_result(game.result.as_deref()))?;

    if let Some(time_control) = non_empty(game.time_control.as_deref()) {
        write_tag(&mut output, "TimeControl", time_control)?;
    }
    if let Some(eco) = non_empty(game.eco.as_deref()) {
        write_tag(&mut output, "ECO", eco)?;
    }
    if let Some(white_elo) = game.white_elo {
        let value = if white_elo == 0 {
            "-".to_string()
        } else {
            white_elo.to_string()
        };
        write_tag(&mut output, "WhiteElo", &value)?;
    }
    if let Some(black_elo) = game.black_elo {
        let value = if black_elo == 0 {
            "-".to_string()
        } else {
            black_elo.to_string()
        };
        write_tag(&mut output, "BlackElo", &value)?;
    }
    if let Some(ply_count) = game.ply_count {
        write_tag(&mut output, "PlyCount", &ply_count.to_string())?;
    }
    if let Some(fen) = non_empty(game.fen.as_deref()) {
        write_tag(&mut output, "SetUp", "1")?;
        write_tag(&mut output, "FEN", fen)?;
    }

    writeln!(&mut output)?;
    if !moves.is_empty() {
        write!(&mut output, "{} ", moves)?;
    }
    writeln!(&mut output, "{}", normalized_result(game.result.as_deref()))?;
    writeln!(&mut output)?;

    Ok(String::from_utf8(output)?)
}

fn write_tag(writer: &mut impl Write, name: &str, value: &str) -> Result<(), error::Error> {
    writeln!(writer, "[{} \"{}\"]", name, escape_tag_value(value))?;
    Ok(())
}

fn escape_tag_value(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn normalized_result(result: Option<&str>) -> &'static str {
    match result {
        Some("1-0") => "1-0",
        Some("0-1") => "0-1",
        Some("1/2-1/2") => "1/2-1/2",
        _ => "*",
    }
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.and_then(|text| {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn invalid_input(message: impl Into<String>) -> error::Error {
    Box::new(io::Error::new(io::ErrorKind::InvalidInput, message.into()))
}
