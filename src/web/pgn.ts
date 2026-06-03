import { isNormal, makeUci, parseUci, type Move } from "chessops";
import { normalizeMove } from "chessops/chess";
import { INITIAL_FEN, makeFen } from "chessops/fen";
import { makePgn, parsePgn, startingPosition } from "chessops/pgn";
import { makeSan, parseSan } from "chessops/san";
import { positionFromFen } from "@/utils/chessops";
import type {
  WebColor,
  WebDatabase,
  WebGame,
  WebImportResult,
  WebMove,
  WebResult,
} from "./model";

const MAX_PLAYER_NAMES = 80;

export function normalizeWebFen(fen: string) {
  return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}

export function oppositeWebColor(color: WebColor): WebColor {
  return color === "white" ? "black" : "white";
}

export function getFenColor(fen: string): WebColor {
  return fen.trim().split(/\s+/)[1] === "b" ? "black" : "white";
}

export function getResultScore(result: WebResult, side: WebColor) {
  if (result === "1/2-1/2" || result === "*") return 0.5;
  if (result === "1-0") return side === "white" ? 1 : 0;
  return side === "black" ? 1 : 0;
}

export function formatWebDate(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/\?/g, "").replace(/\.$/, "");
}

export function parsePgnDatabase(name: string, pgn: string, importedAt = Date.now()): WebImportResult {
  const id = createDatabaseId(name, importedAt);
  const parsedGames = parsePgn(pgn);
  const warnings: string[] = [];
  const games: WebGame[] = [];
  const players = new Map<string, number>();
  let latestDate: string | null = null;

  parsedGames.forEach((game, index) => {
    let position;
    try {
      position = startingPosition(game.headers).unwrap();
    } catch {
      warnings.push(`Game ${index + 1}: could not read starting position.`);
      return;
    }

    const moves: WebMove[] = [];
    let ply = 0;

    for (const node of game.moves.mainline()) {
      const fenBefore = makeFen(position.toSetup());
      const move = parseSan(position, node.san);
      if (!move) {
        warnings.push(`Game ${index + 1}: stopped at illegal move ${node.san}.`);
        break;
      }

      const san = makeSan(position, move);
      const uci = makeMoveUci(position, move);
      position.play(move);
      ply += 1;

      moves.push({
        ply,
        color: ply % 2 === 1 ? "white" : "black",
        san,
        uci,
        fenBefore,
        fenAfter: makeFen(position.toSetup()),
      });
    }

    const result = normalizeResult(game.headers.get("Result"));
    const date = game.headers.get("Date") ?? game.headers.get("UTCDate") ?? "";
    latestDate = pickLatestDate(latestDate, date);

    const white = game.headers.get("White") ?? "?";
    const black = game.headers.get("Black") ?? "?";
    countPlayer(players, white);
    countPlayer(players, black);

    games.push({
      id: `${id}:${index + 1}`,
      databaseId: id,
      databaseName: name,
      index: index + 1,
      event: game.headers.get("Event") ?? "?",
      site: game.headers.get("Site") ?? "",
      date,
      white,
      black,
      whiteElo: parseRating(game.headers.get("WhiteElo")),
      blackElo: parseRating(game.headers.get("BlackElo")),
      result,
      pgn: makePgn(game),
      moves,
      importedAt,
    });
  });

  const database: WebDatabase = {
    id,
    name,
    importedAt,
    updatedAt: importedAt,
    gameCount: games.length,
    sizeBytes: new Blob([pgn]).size,
    latestDate,
    playerNames: Array.from(players.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { sensitivity: "base" }))
      .slice(0, MAX_PLAYER_NAMES)
      .map(([player]) => player),
  };

  return { database, games, warnings };
}

export function playSanMove(fen: string, san: string) {
  const [position] = positionFromFen(fen);
  if (!position) return null;

  const move = parseSan(position, san);
  if (!move) return null;

  const normalizedSan = makeSan(position, move);
  const uci = makeMoveUci(position, move);
  position.play(move);

  return {
    san: normalizedSan,
    uci,
    fenAfter: makeFen(position.toSetup()),
  };
}

export function playUciMove(fen: string, uci: string) {
  const [position] = positionFromFen(fen);
  if (!position) return null;

  const move = parseUci(uci);
  if (!move) return null;

  const san = makeSan(position, move);
  const normalizedUci = makeMoveUci(position, move);
  position.play(move);

  return {
    san,
    uci: normalizedUci,
    fenAfter: makeFen(position.toSetup()),
  };
}

export function currentWebFen(line: { fenAfter: string }[], startFen = INITIAL_FEN) {
  return line.at(-1)?.fenAfter ?? startFen;
}

function createDatabaseId(name: string, importedAt: number) {
  const slug = name
    .toLowerCase()
    .replace(/\.[^.]+$/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  return `${slug || "pgn"}-${importedAt.toString(36)}`;
}

function makeMoveUci(position: Parameters<typeof normalizeMove>[0], move: Move) {
  const normalized = normalizeMove(position, move);
  return isNormal(normalized) ? makeUci(normalized) : null;
}

function normalizeResult(value: string | null | undefined): WebResult {
  return value === "1-0" || value === "0-1" || value === "1/2-1/2" ? value : "*";
}

function parseRating(value: string | null | undefined) {
  if (!value || value === "-") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function countPlayer(players: Map<string, number>, name: string) {
  const normalized = name.trim();
  if (!normalized || normalized === "?") return;
  players.set(normalized, (players.get(normalized) ?? 0) + 1);
}

function pickLatestDate(current: string | null, candidate: string) {
  const candidateKey = sortableDate(candidate);
  if (!candidateKey) return current;
  const currentKey = sortableDate(current ?? "");
  return !currentKey || candidateKey > currentKey ? candidate : current;
}

function sortableDate(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? Number(digits.padEnd(8, "0")) : 0;
}
