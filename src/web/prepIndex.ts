import { INITIAL_FEN } from "chessops/fen";
import {
  getPrepMoveStrengthMap,
  normalizePrepBuilderSettings,
  type PrepBuilderSettings,
  type PrepMoveStrength,
} from "@/utils/opponentPrep";
import type { Opening } from "@/utils/db";
import type { WebColor, WebGame, WebPrepLineMove, WebPrepWorkspace, WebResult } from "./model";
import { getFenColor, getResultScore, normalizeWebFen, oppositeWebColor } from "./pgn";

export type WebPrepMoveStat = Opening & {
  key: string;
  uci: string | null;
  total: number;
  share: number;
  scoreForUser: number;
  sourceLabel: string;
  examples: WebGame[];
  strength: PrepMoveStrength | null;
};

export type WebPrepBranchMove = {
  ply: number;
  move: WebPrepLineMove;
  key: string;
};

export type WebPrepBranchStart = {
  branchPly: number;
  activeBranch: WebPrepBranchMove | null;
};

export type WebDatabasePerspective = {
  playerName: string;
  color: WebColor;
};

export function collectGamesForSources(gamesByDatabase: Record<string, WebGame[]>, sourceIds: string[]) {
  const selected = sourceIds.length > 0 ? sourceIds : Object.keys(gamesByDatabase);
  return selected.flatMap((id) => gamesByDatabase[id] ?? []);
}

export function getGamesForWebPrepSource({
  gamesByDatabase,
  prep,
}: {
  gamesByDatabase: Record<string, WebGame[]>;
  prep: Pick<WebPrepWorkspace, "source" | "sourceIds" | "temporarySource"> | null;
}) {
  if (!prep) return [];
  if (prep.source === "temporary") return prep.temporarySource?.games ?? [];
  if (prep.source === "local" || !prep.source) return collectGamesForSources(gamesByDatabase, prep.sourceIds);
  return [];
}

export function getFirstOpenPrepStat<T extends { key: string }>(
  stats: T[],
  preparedMoves: Record<string, number>,
) {
  return stats.find((stat) => !preparedMoves[stat.key]) ?? stats[0] ?? null;
}

export function getNextOpenPrepStat<T extends { key: string }>(
  stats: T[],
  preparedMoves: Record<string, number>,
  currentKey: string | null,
) {
  if (stats.length === 0) return null;
  const startIndex = currentKey ? stats.findIndex((stat) => stat.key === currentKey) : -1;
  const ordered = startIndex >= 0 ? [...stats.slice(startIndex + 1), ...stats.slice(0, startIndex)] : stats;
  return ordered.find((stat) => !preparedMoves[stat.key]) ?? null;
}

export function getWebPrepMoveKey(fen: string, move: string) {
  return `${normalizeWebFen(fen)}:${move}`;
}

export function findWebPrepBranchStart({
  line,
  rootPly,
  rootFen,
  userColor,
}: {
  line: WebPrepLineMove[];
  rootPly: number;
  rootFen: string;
  userColor: WebColor;
}): WebPrepBranchStart | null {
  const safeRootPly = Math.max(0, Math.min(rootPly, line.length));
  const opponentColor = oppositeWebColor(userColor);

  if (getFenColor(rootFen) === opponentColor) {
    return {
      branchPly: safeRootPly,
      activeBranch: null,
    };
  }

  const activeBranch = findLastWebPrepOpponentBranch(line, safeRootPly, userColor);
  if (!activeBranch) return null;

  return {
    branchPly: activeBranch.ply,
    activeBranch,
  };
}

export function findFirstWebPrepOpponentBranch(
  line: WebPrepLineMove[],
  fromPly: number,
  userColor: WebColor,
): WebPrepBranchMove | null {
  const opponentColor = oppositeWebColor(userColor);
  const start = Math.max(0, Math.min(fromPly, line.length));
  for (let index = start; index < line.length; index += 1) {
    const move = line[index];
    if (getFenColor(move.fenBefore) !== opponentColor) continue;
    return {
      ply: index,
      move,
      key: getWebPrepMoveKey(move.fenBefore, move.san),
    };
  }
  return null;
}

function findLastWebPrepOpponentBranch(
  line: WebPrepLineMove[],
  toPly: number,
  userColor: WebColor,
): WebPrepBranchMove | null {
  const opponentColor = oppositeWebColor(userColor);
  const end = Math.max(0, Math.min(toPly, line.length));
  for (let index = end - 1; index >= 0; index -= 1) {
    const move = line[index];
    if (getFenColor(move.fenBefore) !== opponentColor) continue;
    return {
      ply: index,
      move,
      key: getWebPrepMoveKey(move.fenBefore, move.san),
    };
  }
  return null;
}

export function getWebPrepMoveStats({
  games,
  prep,
  fen,
  maxExamples = 4,
}: {
  games: WebGame[];
  prep: Pick<WebPrepWorkspace, "mode" | "opponent" | "userColor" | "sourceIds" | "builder"> | null;
  fen: string;
  maxExamples?: number;
}): WebPrepMoveStat[] {
  const key = normalizeWebFen(fen || INITIAL_FEN);
  const userColor = prep?.userColor ?? getFenColor(fen || INITIAL_FEN);
  const opponentColor = oppositeWebColor(userColor);
  const prepMode = prep?.mode ?? "player";
  const opponent = prep?.opponent.trim().toLowerCase() ?? "";
  const bucket = new Map<string, MoveBucket>();
  let totalOccurrences = 0;

  for (const game of games) {
    if (prepMode === "player" && !gameMatchesOpponent(game, opponent, opponentColor)) continue;

    for (const move of game.moves) {
      if (normalizeWebFen(move.fenBefore) !== key) continue;

      const entry = bucket.get(move.san) ?? createMoveBucket(move.san);
      entry.uci ??= move.uci;
      entry.total += 1;
      entry.white += scoreResultCount(game.result, "white");
      entry.draw += scoreDrawCount(game.result);
      entry.black += scoreResultCount(game.result, "black");
      entry.scoreForUser += getResultScore(game.result, userColor);
      entry.lastPlayed = pickLatest(entry.lastPlayed, game.date);
      if (entry.examples.length < maxExamples) {
        entry.examples.push(game);
      }
      bucket.set(move.san, entry);
      totalOccurrences += 1;
    }
  }

  const openings: Opening[] = Array.from(bucket.values()).map((entry) => ({
    move: entry.move,
    white: entry.white,
    draw: entry.draw,
    black: entry.black,
    lastPlayed: entry.lastPlayed,
  }));
  const strengthMap = getPrepMoveStrengthMap({
    openings,
    side: userColor,
    settings: getWebPrepStrengthSettings(prep?.builder),
  });

  return Array.from(bucket.values())
    .map<WebPrepMoveStat>((entry) => ({
      move: entry.move,
      white: entry.white,
      draw: entry.draw,
      black: entry.black,
      lastPlayed: entry.lastPlayed,
      key: `${key}:${entry.move}`,
      uci: entry.uci,
      total: entry.total,
      share: totalOccurrences > 0 ? entry.total / totalOccurrences : 0,
      scoreForUser: entry.total > 0 ? entry.scoreForUser / entry.total : 0.5,
      sourceLabel: getFenColor(fen) === opponentColor ? "opponent move" : "reply faced",
      examples: entry.examples,
      strength: strengthMap.get(normalizeSan(entry.move)) ?? null,
    }))
    .sort(
      (a, b) =>
        b.total - a.total ||
        b.scoreForUser - a.scoreForUser ||
        a.move.localeCompare(b.move, undefined, { sensitivity: "base" }),
    );
}

export function getWebDatabaseMoveStats({
  games,
  fen,
  perspective = null,
  maxExamples = 4,
}: {
  games: WebGame[];
  fen: string;
  perspective?: WebDatabasePerspective | null;
  maxExamples?: number;
}): WebPrepMoveStat[] {
  const key = normalizeWebFen(fen || INITIAL_FEN);
  const resultPerspective = perspective?.color ?? getFenColor(fen || INITIAL_FEN);
  const playerName = perspective?.playerName.trim() ?? "";
  const bucket = new Map<string, MoveBucket>();
  let totalOccurrences = 0;

  for (const game of games) {
    if (playerName && !gameMatchesPlayerColor(game, playerName, resultPerspective)) continue;

    for (const move of game.moves) {
      if (normalizeWebFen(move.fenBefore) !== key) continue;

      const entry = bucket.get(move.san) ?? createMoveBucket(move.san);
      entry.uci ??= move.uci;
      entry.total += 1;
      entry.white += scoreResultCount(game.result, "white");
      entry.draw += scoreDrawCount(game.result);
      entry.black += scoreResultCount(game.result, "black");
      entry.scoreForUser += getResultScore(game.result, resultPerspective);
      entry.lastPlayed = pickLatest(entry.lastPlayed, game.date);
      if (entry.examples.length < maxExamples) {
        entry.examples.push(game);
      }
      bucket.set(move.san, entry);
      totalOccurrences += 1;
    }
  }

  const sourceLabel = playerName
    ? `${playerName} as ${resultPerspective}`
    : "database move";

  return Array.from(bucket.values())
    .map<WebPrepMoveStat>((entry) => ({
      move: entry.move,
      white: entry.white,
      draw: entry.draw,
      black: entry.black,
      lastPlayed: entry.lastPlayed,
      key: `${key}:${entry.move}`,
      uci: entry.uci,
      total: entry.total,
      share: totalOccurrences > 0 ? entry.total / totalOccurrences : 0,
      scoreForUser: entry.total > 0 ? entry.scoreForUser / entry.total : 0.5,
      sourceLabel,
      examples: entry.examples,
      strength: null,
    }))
    .sort(
      (a, b) =>
        b.total - a.total ||
        b.scoreForUser - a.scoreForUser ||
        a.move.localeCompare(b.move, undefined, { sensitivity: "base" }),
    );
}

function getWebPrepStrengthSettings(settings?: Partial<PrepBuilderSettings> | null) {
  return normalizePrepBuilderSettings({
    ...settings,
    mode: settings?.mode ?? "practical",
    useCloudEngine: false,
    useLichessAll: false,
  });
}

export function getKnownPlayers(gamesByDatabase: Record<string, WebGame[]>) {
  const players = new Map<string, number>();
  for (const games of Object.values(gamesByDatabase)) {
    for (const game of games) {
      countPlayer(players, game.white);
      countPlayer(players, game.black);
    }
  }
  return Array.from(players.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { sensitivity: "base" }))
    .map(([player]) => player);
}

export function getDatabasePlayerCounts(games: WebGame[]) {
  const players = new Map<string, { name: string; games: number; score: number }>();
  for (const game of games) {
    addPlayerResult(players, game.white, "white", game.result);
    addPlayerResult(players, game.black, "black", game.result);
  }
  return Array.from(players.values()).sort(
    (a, b) => b.games - a.games || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

type MoveBucket = {
  move: string;
  uci: string | null;
  total: number;
  white: number;
  draw: number;
  black: number;
  scoreForUser: number;
  lastPlayed: string | null;
  examples: WebGame[];
};

function createMoveBucket(move: string): MoveBucket {
  return {
    move,
    uci: null,
    total: 0,
    white: 0,
    draw: 0,
    black: 0,
    scoreForUser: 0,
    lastPlayed: null,
    examples: [],
  };
}

function gameMatchesOpponent(game: WebGame, opponent: string, opponentColor: WebColor) {
  if (!opponent) return true;
  const player = opponentColor === "white" ? game.white : game.black;
  return player.toLowerCase() === opponent || player.toLowerCase().includes(opponent);
}

function gameMatchesPlayerColor(game: WebGame, playerName: string, color: WebColor) {
  const player = color === "white" ? game.white : game.black;
  return normalizedPlayerName(player).includes(normalizedPlayerName(playerName));
}

function normalizedPlayerName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreResultCount(result: WebResult, side: WebColor) {
  if (result === "*") return 0;
  if (result === "1-0" && side === "white") return 1;
  if (result === "0-1" && side === "black") return 1;
  return 0;
}

function scoreDrawCount(result: WebResult) {
  return result === "1/2-1/2" || result === "*" ? 1 : 0;
}

function addPlayerResult(
  players: Map<string, { name: string; games: number; score: number }>,
  name: string,
  side: WebColor,
  result: WebResult,
) {
  if (!name || name === "?") return;
  const current = players.get(name) ?? { name, games: 0, score: 0 };
  current.games += 1;
  current.score += getResultScore(result, side);
  players.set(name, current);
}

function countPlayer(players: Map<string, number>, name: string) {
  if (!name || name === "?") return;
  players.set(name, (players.get(name) ?? 0) + 1);
}

function pickLatest(current: string | null, candidate: string) {
  const candidateKey = sortableDate(candidate);
  if (!candidateKey) return current;
  const currentKey = sortableDate(current ?? "");
  return !currentKey || candidateKey > currentKey ? candidate : current;
}

function sortableDate(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? Number(digits.padEnd(8, "0")) : 0;
}

function normalizeSan(value: string) {
  return value
    .trim()
    .replace(/^0-0-0/, "O-O-O")
    .replace(/^0-0/, "O-O")
    .replace(/[+#?!]+$/g, "");
}
