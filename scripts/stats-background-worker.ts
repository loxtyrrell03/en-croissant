import { parseComment, parsePgn, type ChildNode, type PgnNodeData } from "chessops/pgn";
import { INITIAL_FEN } from "chessops/fen";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { fetchStatsGames, type StatsGame, type StatsSource, type StatsTimeClass } from "../src/web/statsRating";
import {
  buildGameQualityStats,
  replayGamePositions,
  type AnalyzedGameEntry,
  type EvalScore,
} from "../src/web/statsStrength";

type WorkerConfig = {
  accounts?: Partial<Record<StatsSource, string>>;
  historyDays?: number;
  depth?: number;
  nodesPerPosition?: number;
};

type StoredGames = { v: 1; updatedAt: number; games: StatsGame[] };
type BatchAnalysisMetadata = {
  targetDepth: number;
  nodeLimit: number | null;
  cloudHits: number;
  firstCloudMissPly: number | null;
  pcPositions: number;
  pcNodes: number;
  policy: "lichess-local-until-first-miss-then-pc";
};

type BatchAnalyzedGameEntry = AnalyzedGameEntry & {
  batchAnalysis?: BatchAnalysisMetadata;
};

type StoredEntries = { v: 1; updatedAt: number; entries: BatchAnalyzedGameEntry[] };

const args = parseArgs(process.argv.slice(2));
const configPath = requiredArg("config");
const gamesPath = requiredArg("games");
const entriesPath = requiredArg("entries");
const statusPath = requiredArg("status");
const backend = new URL(args.get("backend") || "http://127.0.0.1:38419");
const config = normalizeConfig(await readJson<WorkerConfig>(configPath));
const existing = await readJson<StoredEntries>(entriesPath);
const entriesByKey = new Map(
  (Array.isArray(existing?.entries) ? existing.entries : []).map((entry) => [entry.key, entry]),
);
let totalCloudHits = 0;
let totalPcPositions = 0;
let totalPcNodes = 0;
let gamesWithCloudCoverage = 0;

await writeStatus({
  state: "fetching",
  startedAt: Date.now(),
  depth: config.depth,
  nodesPerPosition: config.nodesPerPosition || null,
  cloudPolicy: "lichess-local-until-first-miss-then-pc",
});

try {
  const cloudStore = await requireLocalCloudStore();
  await writeStatus({
    state: "fetching",
    depth: config.depth,
    cloudStore,
  });
  const games = await fetchAllGames(config);
  await atomicJson(gamesPath, { v: 1, updatedAt: Date.now(), games } satisfies StoredGames);

  const candidates = games
    .filter((game) => {
      const entry = entriesByKey.get(gameKey(game));
      return !(
        entry?.advanced &&
        entry.opponentQuality?.advanced &&
        (entry.batchAnalysis?.targetDepth || 0) >= config.depth &&
        (entry.batchAnalysis.nodeLimit === null ||
          (entry.batchAnalysis.nodeLimit || 0) >= config.nodesPerPosition) &&
        entry.batchAnalysis.policy === "lichess-local-until-first-miss-then-pc"
      );
    })
    .sort((a, b) => b.end - a.end);

  let completed = 0;
  let failed = 0;
  for (const game of candidates) {
    await writeStatus({
      state: "analyzing",
      startedAt: Number((await readJson<Record<string, unknown>>(statusPath))?.startedAt) || Date.now(),
      depth: config.depth,
      totalGames: games.length,
      queuedGames: candidates.length,
      completedGames: completed,
      failedGames: failed,
      analysis: analysisProgress(),
      current: { key: gameKey(game), opponent: game.oppName, end: game.end },
    });

    try {
      const entry = await analyzeGame(game, config.depth, config.nodesPerPosition);
      if (entry) {
        entriesByKey.set(entry.key, entry);
        await saveEntries();
      } else {
        failed += 1;
      }
    } catch (error) {
      failed += 1;
      await writeStatus({
        state: "analyzing",
        depth: config.depth,
        totalGames: games.length,
        queuedGames: candidates.length,
        completedGames: completed,
        failedGames: failed,
        analysis: analysisProgress(),
        lastError: publicError(error),
      });
    }
    completed += 1;
  }

  await saveEntries();
  await writeStatus({
    state: "idle",
    finishedAt: Date.now(),
    depth: config.depth,
    totalGames: games.length,
    analyzedGames: entriesByKey.size,
    queuedGames: 0,
    completedGames: completed,
    failedGames: failed,
    analysis: analysisProgress(),
  });
} catch (error) {
  await writeStatus({ state: "error", finishedAt: Date.now(), error: publicError(error) });
  throw error;
}

async function fetchAllGames(workerConfig: Required<WorkerConfig>) {
  const collected: StatsGame[] = [];
  for (const source of ["chesscom", "lichess"] as const) {
    const username = workerConfig.accounts[source]?.trim();
    if (!username) continue;
    const timeClasses: StatsTimeClass[] =
      source === "chesscom"
        ? ["bullet", "blitz", "rapid", "daily"]
        : ["bullet", "blitz", "rapid", "classical", "daily"];
    for (const timeClass of timeClasses) {
      const games = await fetchStatsGames({
        source,
        username,
        timeClass,
        ratedFilter: "both",
        maxGames: 5000,
        maxDays: workerConfig.historyDays,
        monthsCap: Math.ceil(workerConfig.historyDays / 28) + 1,
      });
      collected.push(...games);
    }
  }
  const unique = new Map<string, StatsGame>();
  for (const game of collected) unique.set(gameKey(game), game);
  return Array.from(unique.values()).sort((a, b) => a.end - b.end);
}

async function requireLocalCloudStore() {
  const response = await fetch(new URL("/v1/health", backend), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Stockfish health check returned HTTP ${response.status}.`);
  const data = (await response.json()) as {
    localEvals?: { available?: boolean; positions?: number; builtAt?: number; error?: string | null };
  };
  if (!data.localEvals?.available) {
    throw new Error(
      data.localEvals?.error || "The complete local Lichess cloud-eval store is not ready yet.",
    );
  }
  return {
    available: true,
    positions: Math.max(0, Number(data.localEvals.positions) || 0),
    builtAt: Number(data.localEvals.builtAt) || null,
  };
}

async function analyzeGame(
  game: StatsGame,
  depth: number,
  nodesPerPosition: number,
): Promise<BatchAnalyzedGameEntry | null> {
  if (!game.pgn) return null;
  const { sans, clocks } = extractPgnMoves(game.pgn);
  if (!sans.length) return null;
  const evaluated = await evaluatePositions(sans, depth, nodesPerPosition);
  if (!evaluated) return null;
  const { evals, bestMoves, analysisDepth } = evaluated;
  totalCloudHits += evaluated.cloudHits;
  totalPcPositions += evaluated.pcPositions;
  totalPcNodes += evaluated.pcNodes;
  if (evaluated.cloudHits > 0) gamesWithCloudCoverage += 1;
  const quality = await buildGameQualityStats({
    sans,
    evals,
    bestMoves,
    color: game.color,
    timeControl: game.timeControl,
    clocks,
    analysisDepth,
    result: game.result,
  });
  const opponentQuality = await buildGameQualityStats({
    sans,
    evals,
    bestMoves,
    color: game.color === "w" ? "b" : "w",
    timeControl: game.timeControl,
    clocks,
    analysisDepth,
    result: game.result === "win" ? "loss" : game.result === "loss" ? "win" : "draw",
  });
  if (!quality || !opponentQuality) return null;
  return {
    v: 2,
    ts: Date.now(),
    key: gameKey(game),
    end: game.end,
    source: game.source,
    url: game.url,
    timeControl: game.timeControl,
    color: game.color,
    opponent: game.oppName,
    opp: game.opp,
    result: game.result,
    plies: quality.plies,
    eco: game.eco,
    openingName: game.openingName,
    stats: quality.stats,
    phases: quality.phases,
    counts: quality.counts,
    phaseBlunders: quality.phaseBlunders,
    advanced: quality.advanced,
    batchAnalysis: {
      targetDepth: depth,
      nodeLimit: nodesPerPosition || null,
      cloudHits: evaluated.cloudHits,
      firstCloudMissPly: evaluated.firstCloudMissPly,
      pcPositions: evaluated.pcPositions,
      pcNodes: evaluated.pcNodes,
      policy: "lichess-local-until-first-miss-then-pc",
    },
    opponentQuality: {
      stats: opponentQuality.stats,
      phases: opponentQuality.phases,
      counts: opponentQuality.counts,
      phaseBlunders: opponentQuality.phaseBlunders,
      advanced: opponentQuality.advanced,
    },
  };
}

async function evaluatePositions(sans: string[], depth: number, nodesPerPosition: number) {
  const replay = replayGamePositions(sans);
  if (!replay) return null;
  const fens = replay.fens.length === sans.length + 1 ? replay.fens : [INITIAL_FEN, ...replay.fens];
  if (fens.length !== sans.length + 1) return null;
  const evals: (EvalScore | null)[] = new Array(fens.length).fill(null);
  const bestMoves: (string | null)[] = new Array(fens.length).fill(null);
  let minimumDepth = Number.POSITIVE_INFINITY;
  let useCloud = true;
  let cloudHits = 0;
  let firstCloudMissPly: number | null = null;
  let pcPositions = 0;
  let pcNodes = 0;
  for (let index = 0; index < fens.length; index += 1) {
    if (useCloud) {
      const cloud = await lookupStoredCloudPosition(fens[index]);
      if (cloud) {
        evals[index] = cloud.score;
        bestMoves[index] = cloud.bestMove;
        minimumDepth = Math.min(minimumDepth, cloud.depth);
        cloudHits += 1;
        continue;
      }
      useCloud = false;
      firstCloudMissPly = index;
    }
    const line = await analyzePosition(fens[index], depth, nodesPerPosition);
    if (!line) continue;
    evals[index] = line.score;
    bestMoves[index] = line.bestMove;
    minimumDepth = Math.min(minimumDepth, line.depth);
    pcPositions += 1;
    pcNodes += line.nodes;
  }
  if (!Number.isFinite(minimumDepth)) return null;
  return {
    evals,
    bestMoves,
    analysisDepth: minimumDepth,
    cloudHits,
    firstCloudMissPly,
    pcPositions,
    pcNodes,
  };
}

async function lookupStoredCloudPosition(fen: string) {
  const url = new URL("/v1/cloud-eval", backend);
  url.searchParams.set("fen", fen);
  url.searchParams.set("multipv", "1");
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Stored Lichess cloud eval returned HTTP ${response.status}.`);
  }
  const data = (await response.json()) as {
    depth?: number;
    knodes?: number;
    pvs?: ({ moves?: string; cp?: number; mate?: number })[];
  };
  const pv = data.pvs?.[0];
  const depth = Math.max(0, Math.round(Number(data.depth) || 0));
  const bestMove = String(pv?.moves || "")
    .trim()
    .split(/\s+/)[0] || null;
  const score: EvalScore | null = Number.isFinite(pv?.cp)
    ? { cp: Number(pv?.cp) }
    : Number.isFinite(pv?.mate)
      ? { mate: Number(pv?.mate) }
      : null;
  if (!score || !bestMove || depth < 1) return null;
  return { score, bestMove, depth, nodes: Math.max(0, Number(data.knodes) || 0) * 1000 };
}

async function analyzePosition(fen: string, depth: number, nodesPerPosition: number) {
  const response = await fetch(new URL("/v1/analyze", backend), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/x-ndjson" },
    body: JSON.stringify({
      fen,
      multipv: 1,
      depth,
      ...(nodesPerPosition > 0 ? { nodes: nodesPerPosition } : {}),
    }),
  });
  if (!response.ok) throw new Error(`Stockfish returned HTTP ${response.status}.`);
  let result: { score: EvalScore; bestMove: string | null; depth: number; nodes: number } | null =
    null;
  for (const raw of (await response.text()).split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let event: { type?: string; line?: string };
    try {
      event = JSON.parse(raw) as { type?: string; line?: string };
    } catch {
      continue;
    }
    if (event.type !== "uci" || !event.line?.startsWith("info ")) continue;
    const tokens = event.line.trim().split(/\s+/);
    const scoreAt = tokens.indexOf("score");
    const pvAt = tokens.indexOf("pv");
    if (scoreAt < 0 || pvAt < 0) continue;
    const value = Number.parseInt(tokens[scoreAt + 2] || "", 10);
    const lineDepth = Number.parseInt(tokens[tokens.indexOf("depth") + 1] || "0", 10);
    const lineNodes = Number.parseInt(tokens[tokens.indexOf("nodes") + 1] || "0", 10);
    if (!Number.isFinite(value) || !Number.isFinite(lineDepth)) continue;
    const whiteToMove = fen.split(/\s+/)[1] !== "b";
    const normalized = whiteToMove ? value : -value;
    const score = tokens[scoreAt + 1] === "mate" ? { mate: normalized } : { cp: normalized };
    result = {
      score,
      bestMove: tokens[pvAt + 1] || null,
      depth: lineDepth,
      nodes: Number.isFinite(lineNodes) ? lineNodes : 0,
    };
  }
  return result;
}

function extractPgnMoves(pgn: string) {
  const sans: string[] = [];
  const clocks: (number | null)[] = [];
  for (const node of mainlineNodes(pgn)) {
    sans.push(node.data.san);
    let clock: number | null = null;
    for (const comment of node.data.comments || []) {
      const parsed = parseComment(comment).clock;
      if (typeof parsed === "number" && Number.isFinite(parsed)) clock = parsed;
    }
    clocks.push(clock);
  }
  return { sans, clocks };
}

function mainlineNodes(pgn: string): ChildNode<PgnNodeData>[] {
  const parsed = parsePgn(pgn)[0];
  if (!parsed) return [];
  const nodes: ChildNode<PgnNodeData>[] = [];
  let node: ChildNode<PgnNodeData> | undefined = parsed.moves.children[0];
  while (node) {
    nodes.push(node);
    node = node.children[0];
  }
  return nodes;
}

async function saveEntries() {
  const entries = Array.from(entriesByKey.values()).sort((a, b) => b.end - a.end);
  await atomicJson(entriesPath, { v: 1, updatedAt: Date.now(), entries } satisfies StoredEntries);
}

async function writeStatus(value: Record<string, unknown>) {
  const current = (await readJson<Record<string, unknown>>(statusPath)) || {};
  await atomicJson(statusPath, { ...current, ...value, pid: process.pid, updatedAt: Date.now() });
}

function analysisProgress() {
  return {
    targetDepth: config.depth,
    nodeLimit: config.nodesPerPosition || null,
    cloudPolicy: "lichess-local-until-first-miss-then-pc",
    cloudHits: totalCloudHits,
    gamesWithCloudCoverage,
    pcPositions: totalPcPositions,
    pcNodes: totalPcNodes,
  };
}

async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, "utf8");
  await rename(temporary, path).catch(async () => {
    await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
  });
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function normalizeConfig(value: WorkerConfig | null): Required<WorkerConfig> {
  return {
    accounts: {
      chesscom: String(value?.accounts?.chesscom || "").trim(),
      lichess: String(value?.accounts?.lichess || "").trim(),
    },
    historyDays: Math.max(1, Math.min(3650, Math.round(value?.historyDays || 365))),
    depth: Math.max(8, Math.min(30, Math.round(value?.depth || 16))),
    nodesPerPosition: Math.max(
      0,
      Math.min(2_000_000_000, Math.round(value?.nodesPerPosition ?? 1_000_000)),
    ),
  };
}

function gameKey(game: Pick<StatsGame, "source" | "id">) {
  return `${game.source}|${game.id}`;
}

function parseArgs(values: string[]) {
  const parsed = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, "");
    if (key) parsed.set(key, values[index + 1] || "");
  }
  return parsed;
}

function requiredArg(name: string) {
  const value = args.get(name);
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

function publicError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
