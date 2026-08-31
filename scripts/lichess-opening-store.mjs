import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dependencyRoot = process.env.EN_CROISSANT_REPO_ROOT || process.cwd();
const requireFromRepository = createRequire(join(dependencyRoot, "package.json"));
const { Chess } = requireFromRepository("chessops/chess");
const { makeFen, parseFen } = requireFromRepository("chessops/fen");
const { makeSan } = requireFromRepository("chessops/san");
const { parseUci } = requireFromRepository("chessops/util");

const DATABASE_VERSION = 1;
const DEFAULT_MAX_PLIES = 40;

export function createLocalLichessOpeningStore(path) {
  const status = () => readStatus(path);

  const query = (rawQuery) => {
    const current = status();
    if (!current.available) return unavailableResult(current.error);
    const request = normalizeQuery(rawQuery);
    const sourceAvailable =
      request.source === "lichess-masters"
        ? current.mastersMonths.length > 0
        : current.standardMonths.length > 0;
    if (!sourceAvailable) return unavailableResult(null);
    const database = openReadOnly(path);
    try {
      const keys = positionKeys(request.fen);
      const moves = request.player
        ? queryPlayerMoves(database, request, keys)
        : queryAggregateMoves(database, request, keys);
      return {
        available: true,
        ...totalsFromMoves(moves),
        moves,
        opening: null,
        topGames: [],
        recentGames: [],
        coverage: {
          source: request.source,
          standardMonths: current.standardMonths,
          mastersMonths: current.mastersMonths,
          maxPlies: current.maxPlies,
        },
        error: null,
      };
    } finally {
      database.close();
    }
  };

  return { status, query };
}

function readStatus(path) {
  if (!existsSync(path)) {
    return {
      available: false,
      path,
      gameCount: 0,
      moveRows: 0,
      standardMonths: [],
      mastersMonths: [],
      maxPlies: DEFAULT_MAX_PLIES,
      storageBytes: 0,
      builtAt: null,
      error: null,
    };
  }

  const database = openReadOnly(path);
  try {
    const metadata = new Map(
      database
        .prepare("SELECT key, value FROM metadata")
        .all()
        .map((row) => [String(row.key), String(row.value)]),
    );
    const version = metadataNumber(metadata, "version", 0);
    if (version !== DATABASE_VERSION) {
      throw new Error(`unsupported local Lichess opening database version ${version}`);
    }
    if (metadataNumber(metadata, "complete", 0) !== 1) {
      throw new Error("local Lichess opening database is incomplete");
    }
    return {
      available: true,
      path,
      gameCount: metadataNumber(metadata, "game_count", 0),
      moveRows: metadataNumber(metadata, "move_rows", 0),
      standardMonths: metadataList(metadata, "standard_months"),
      mastersMonths: metadataList(metadata, "masters_months"),
      maxPlies: metadataNumber(metadata, "max_plies", DEFAULT_MAX_PLIES),
      storageBytes: statSync(path).size,
      builtAt: metadata.has("built_at") ? metadataNumber(metadata, "built_at", 0) : null,
      error: null,
    };
  } catch (error) {
    throw new Error(
      `The local Lichess snapshot at ${path} could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    database.close();
  }
}

function openReadOnly(path) {
  return new DatabaseSync(path, { readOnly: true });
}

function normalizeQuery(value) {
  const query = value && typeof value === "object" ? value : {};
  const source = String(query.source || "");
  if (!["lichess-all", "lichess-masters", "lichess-player"].includes(source)) {
    throw new Error(`unsupported local Lichess source: ${source || "missing"}`);
  }
  const fen = String(query.fen || "").trim();
  if (!fen) throw new Error("local Lichess query requires a FEN");
  const player =
    String(query.player || "")
      .trim()
      .toLowerCase() || null;
  const color = query.color === "black" ? "black" : query.color === "white" ? "white" : null;
  if (player && !color) throw new Error("player explorer color must be white or black");
  return {
    source,
    fen,
    speeds: Array.isArray(query.speeds) ? query.speeds.map(String) : [],
    ratings: Array.isArray(query.ratings) ? query.ratings.map(Number).filter(Number.isFinite) : [],
    player,
    color,
    since: typeof query.since === "string" ? query.since : null,
    until: typeof query.until === "string" ? query.until : null,
    topGames: Number.isFinite(query.topGames) ? Number(query.topGames) : null,
    recentGames: Number.isFinite(query.recentGames) ? Number(query.recentGames) : null,
  };
}

function queryAggregateMoves(database, query, keys) {
  const source = query.source === "lichess-masters" ? "lichess-masters" : "lichess-all";
  const statement = database.prepare(
    `SELECT month, speed, rating_group, uci, san, white, draws, black
     FROM move_stats
     WHERE source = ? AND hash_hi = ? AND hash_lo = ?`,
  );
  statement.setReadBigInts(true);
  for (const key of keys) {
    const [hashHi, hashLo] = hashPosition(key);
    const totals = new Map();
    for (const row of statement.iterate(source, hashHi, hashLo)) {
      if (
        !queryAccepts(query, source, Number(row.month), Number(row.speed), Number(row.rating_group))
      ) {
        continue;
      }
      addMove(
        totals,
        String(row.uci),
        String(row.san),
        Number(row.white),
        Number(row.draws),
        Number(row.black),
      );
    }
    if (totals.size > 0) return sortedMoves(totals);
  }
  return [];
}

function queryPlayerMoves(database, query, targetKeys) {
  const column = query.color === "black" ? "black_key" : "white_key";
  const statement = database.prepare(
    `SELECT month, speed, rating_group, result, moves FROM game_lines WHERE ${column} = ?`,
  );
  statement.setReadBigInts(true);
  const totals = new Map();
  for (const row of statement.iterate(query.player)) {
    if (
      !queryAccepts(
        query,
        "lichess-all",
        Number(row.month),
        Number(row.speed),
        Number(row.rating_group),
      )
    ) {
      continue;
    }
    const encoded = row.moves;
    const position = Chess.default();
    for (let offset = 0; offset + 1 < encoded.length; offset += 2) {
      const uci = decodeUciMove(encoded[offset] | (encoded[offset + 1] << 8));
      if (!uci) throw new Error("local player line contains an invalid move");
      const keys = positionKeysFromPosition(position);
      const move = parseUci(uci);
      if (!move || !position.isLegal(move)) break;
      if (keys.some((key) => targetKeys.includes(key))) {
        const san = makeSan(position, move);
        const result = Number(row.result);
        addMove(totals, uci, san, result === 1 ? 1 : 0, result === 2 ? 1 : 0, result === 3 ? 1 : 0);
        break;
      }
      position.play(move);
    }
  }
  return sortedMoves(totals);
}

function positionKeys(fen) {
  const setup = parseFen(fen).unwrap();
  return positionKeysFromPosition(Chess.fromSetup(setup).unwrap());
}

function positionKeysFromPosition(position) {
  const epd = makeFen(position.toSetup(), { epd: true });
  const parts = epd.split(" ");
  if (parts.length !== 4 || parts[3] === "-") return [epd];
  return [epd, [parts[0], parts[1], parts[2], "-"].join(" ")];
}

function hashPosition(position) {
  const bytes = new TextEncoder().encode(position);
  const fnv1a = (offset) => {
    let hash = offset;
    for (const byte of bytes) {
      hash ^= BigInt(byte);
      hash = BigInt.asUintN(64, hash * 0x00000100000001b3n);
    }
    return BigInt.asIntN(64, hash);
  };
  return [fnv1a(0xcbf29ce484222325n), fnv1a(0x84222325cbf29ce4n)];
}

function queryAccepts(query, source, month, speed, rating) {
  if (!withinDateRange(month, query.since, query.until, source)) return false;
  if (source === "lichess-masters") return true;
  const speeds = query.speeds.map(speedCode).filter(Boolean);
  return (
    (speeds.length === 0 || speeds.includes(speed)) &&
    (query.ratings.length === 0 || query.ratings.includes(rating))
  );
}

function withinDateRange(month, since, until, source) {
  const parse = (value, upper = false) => {
    if (!value) return null;
    if (source === "lichess-masters" && /^\d{4}$/.test(value)) {
      return Number(value) * 100 + (upper ? 12 : 0);
    }
    const match = value.match(/^(\d{4})-(\d{1,2})$/);
    return match ? Number(match[1]) * 100 + Number(match[2]) : null;
  };
  const lower = parse(since);
  const upper = parse(until, true);
  return (lower === null || month >= lower) && (upper === null || month <= upper);
}

function speedCode(value) {
  return {
    ultrabullet: 1,
    bullet: 2,
    blitz: 3,
    rapid: 4,
    classical: 5,
    correspondence: 6,
  }[String(value).toLowerCase()];
}

function decodeUciMove(code) {
  const square = (value) => `${"abcdefgh"[value % 8]}${Math.floor(value / 8) + 1}`;
  const from = code & 0b111111;
  const to = (code >> 6) & 0b111111;
  if (from >= 64 || to >= 64) return null;
  const promotion = (code >> 12) & 0b111;
  const suffix = promotion === 0 ? "" : { 1: "n", 2: "b", 3: "r", 4: "q" }[promotion];
  return suffix === undefined ? null : `${square(from)}${square(to)}${suffix}`;
}

function addMove(map, uci, san, white, draws, black) {
  const current = map.get(uci) ?? { san, uci, white: 0, draws: 0, black: 0 };
  current.white += white;
  current.draws += draws;
  current.black += black;
  map.set(uci, current);
}

function sortedMoves(map) {
  return [...map.values()].sort(
    (left, right) =>
      right.white + right.draws + right.black - (left.white + left.draws + left.black),
  );
}

function totalsFromMoves(moves) {
  return moves.reduce(
    (total, move) => ({
      white: total.white + move.white,
      draws: total.draws + move.draws,
      black: total.black + move.black,
    }),
    { white: 0, draws: 0, black: 0 },
  );
}

function unavailableResult(error) {
  return {
    available: false,
    white: 0,
    draws: 0,
    black: 0,
    moves: [],
    opening: null,
    topGames: [],
    recentGames: [],
    coverage: null,
    error: error ?? null,
  };
}

function metadataNumber(metadata, key, fallback) {
  const value = Number(metadata.get(key));
  return Number.isFinite(value) ? value : fallback;
}

function metadataList(metadata, key) {
  return String(metadata.get(key) || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
