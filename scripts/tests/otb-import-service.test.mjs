import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  OtbImportService,
  buildOtbImporterArgs,
  getOtbPrepDatabaseName,
  mergeOtbProgress,
  normalizeOtbImportPayload,
  parseOtbCollectorLine,
  parseOtbPgnGames,
} from "../otb-import-service.mjs";

test("serializes overlapping job saves and preserves the newest snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-croissant-otb-persist-"));
  try {
    const service = new OtbImportService({ root, binaryPath: join(root, "unused") });
    await service.initialize();
    const job = { id: "otb-concurrent", status: "running", progress: { current: 0 } };
    const saves = [];
    for (let current = 0; current < 25; current += 1) {
      job.progress = { current };
      saves.push(service.persist(job));
    }

    await Promise.all(saves);
    const saved = JSON.parse(await readFile(join(root, "jobs", "otb-concurrent.json"), "utf8"));
    assert.equal(saved.progress.current, 24);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("normalizes a phone request with fast PC defaults", () => {
  const request = normalizeOtbImportPayload({
    playerName: "  Kodukula,   Sameera ",
    fideId: "FIDE 343413994",
    fromYear: 2024,
  });

  assert.deepEqual(request, {
    playerName: "Kodukula, Sameera",
    fideId: "343413994",
    fromYear: 2024,
    sources: {
      lichessBroadcasts: true,
      broadcastArchives: false,
      communityBroadcasts: false,
      chessResults: true,
      chessbaseNews: true,
      officialPgnIndexes: true,
      twic: true,
    },
  });
});

test("builds native collector arguments on the PC", () => {
  const request = normalizeOtbImportPayload({
    playerName: "Player, Example",
    fideId: "12345678",
    fromYear: 2025,
    sources: { broadcastArchives: true, communityBroadcasts: true, twic: false },
  });
  const args = buildOtbImporterArgs({ id: "otb-test", request }, "C:/cache", "C:/out.pgn");

  assert.ok(args.includes("--lichess-broadcast-archives"));
  assert.ok(args.includes("--lichess-community-broadcasts"));
  assert.ok(args.includes("--no-twic"));
  assert.equal(args[args.indexOf("--player") + 1], "Player, Example");
});

test("parses collector events and keeps result counts monotonic", () => {
  const first = parseOtbCollectorLine('PROGRESS\t{"jobId":"x","source":"TWIC","gamesFound":14}');
  assert.equal(first.type, "progress");
  assert.equal(
    mergeOtbProgress(first.value, { ...first.value, source: "ChessBase", gamesFound: 2 })
      .gamesFound,
    14,
  );
  assert.equal(parseOtbCollectorLine("diagnostic output"), null);
});

test("splits and summarizes verified PGNs on the PC", () => {
  const games = parseOtbPgnGames(
    `[Event "Congress"]\n[Date "2026.08.01"]\n[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n\n[Event "Open"]\n[Date "2026.08.02"]\n[White "B"]\n[Black "C"]\n[Result "1/2-1/2"]\n\n1. d4 d5 1/2-1/2`,
    "job",
  );

  assert.equal(games.length, 2);
  assert.deepEqual(
    games.map(({ id, event, white, black, result }) => ({ id, event, white, black, result })),
    [
      { id: "job:1", event: "Congress", white: "A", black: "B", result: "1-0" },
      { id: "job:2", event: "Open", white: "B", black: "C", result: "1/2-1/2" },
    ],
  );
});

test("builds a phone-ready prep database on the PC", () => {
  const pgn = `[Event "Congress"]\n[Date "2026.08.01"]\n[White "Target, Player"]\n[Black "Opponent"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0`;
  const service = new OtbImportService({ root: "C:/unused", binaryPath: "C:/unused.exe" });
  const job = {
    id: "otb-prep",
    status: "completed",
    request: { playerName: "Target, Player", fromYear: 2024 },
    report: { playerName: "Player, Target Canonical" },
    games: parseOtbPgnGames(pgn, "otb-prep"),
    createdAt: "2026-08-17T12:00:00.000Z",
    completedAt: "2026-08-17T12:05:00.000Z",
    prepDatabase: null,
  };

  assert.equal(service.ensurePrepDatabase(job), true);
  assert.equal(
    job.prepDatabase.database.name,
    getOtbPrepDatabaseName({ ...job.request, playerName: job.report.playerName }),
  );
  assert.equal(job.prepDatabase.database.sourceKind, "source");
  assert.equal(job.prepDatabase.games.length, 1);
  assert.deepEqual(
    job.prepDatabase.games[0].moves.map((move) => move.san),
    ["e4", "e5", "Nf3", "Nc6"],
  );
  assert.equal(service.ensurePrepDatabase(job), false);
});
