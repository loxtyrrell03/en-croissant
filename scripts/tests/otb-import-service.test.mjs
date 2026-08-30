import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildWebOtbPrepDatabase } from "../generated/otb-prep-database.js";
import {
  OtbImportService,
  buildOtbImporterArgs,
  compactOtbImportJob,
  extractOtbImportArtifact,
  getOtbPrepDatabaseName,
  mergeOtbProgress,
  normalizeOtbImportPayload,
  parseOtbCollectorLine,
  parseOtbPgnGames,
  terminateCollectorProcessTree,
} from "../otb-import-service.mjs";
import { buildWebOtbPrepDatabaseParallel } from "../otb-prep-parallel.mjs";

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

test("normalizes a phone request with every PC source enabled", () => {
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
      broadcastArchives: true,
      communityBroadcasts: true,
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

test("keeps overall source progress when a lane emits a local progress update", () => {
  const overall = {
    jobId: "x",
    source: "All sources",
    gamesFound: 7,
    overallCurrent: 6,
    overallTotal: 10,
  };
  const merged = mergeOtbProgress(overall, {
    jobId: "x",
    source: "Chessscope",
    current: 1,
    total: 1,
    gamesFound: 3,
  });
  assert.equal(merged.gamesFound, 7);
  assert.equal(merged.overallCurrent, 6);
  assert.equal(merged.overallTotal, 10);
});

test("cancels a running phone job and unlocks it durably", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-croissant-otb-cancel-"));
  try {
    const service = new OtbImportService({ root, binaryPath: join(root, "unused") });
    await service.initialize();
    const job = {
      id: "otb-stop",
      status: "running",
      progress: { jobId: "otb-stop", gamesFound: 7 },
      updatedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    };
    let killed = false;
    service.jobs.set(job.id, job);
    service.processes.set(job.id, {
      killed: false,
      kill() {
        killed = true;
      },
    });

    const stopped = await service.cancelJob(job.id);
    assert.equal(killed, true);
    assert.equal(stopped.status, "failed");
    assert.equal(stopped.error, "The PC OTB import failed. Search stopped.");
    assert.equal(service.processes.has(job.id), false);
    const saved = JSON.parse(await readFile(join(root, "jobs", `${job.id}.json`), "utf8"));
    assert.equal(saved.status, "failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cancellation terminates the exact collector process tree before unlocking", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-croissant-otb-tree-cancel-"));
  try {
    const terminations = [];
    const service = new OtbImportService({
      root,
      binaryPath: join(root, "collect_otb_games.exe"),
      terminateProcessTree: async (request) => terminations.push(request),
    });
    await service.initialize();
    const job = {
      id: "otb-tree-stop",
      status: "running",
      progress: null,
      collectorProcess: {
        pid: 4321,
        jobId: "otb-tree-stop",
        startedAt: "2026-08-30T12:00:00.000Z",
      },
      updatedAt: "2026-08-30T12:00:00.000Z",
      completedAt: null,
      error: null,
    };
    const child = { pid: 4321, killed: false };
    service.jobs.set(job.id, job);
    service.processes.set(job.id, child);

    const stopped = await service.cancelJob(job.id);

    assert.equal(terminations.length, 1);
    assert.equal(terminations[0].child, child);
    assert.equal(terminations[0].pid, 4321);
    assert.equal(terminations[0].jobId, job.id);
    assert.equal(terminations[0].binaryPath, service.binaryPath);
    assert.equal(stopped.status, "failed");
    assert.equal(stopped.error, "The PC OTB import failed. Search stopped.");
    const saved = JSON.parse(await readFile(join(root, "jobs", `${job.id}.json`), "utf8"));
    assert.equal(saved.collectorProcess, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup recovery terminates a persisted job-bound collector tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-croissant-otb-stale-tree-"));
  try {
    await mkdir(join(root, "jobs"), { recursive: true });
    await writeFile(
      join(root, "jobs", "otb-stale.json"),
      JSON.stringify({
        id: "otb-stale",
        status: "running",
        request: { playerName: "Stale, Player", fromYear: 2020 },
        collectorProcess: {
          pid: 7654,
          jobId: "otb-stale",
          startedAt: "2026-08-30T11:00:00.000Z",
        },
        gameCount: 0,
        createdAt: "2026-08-30T11:00:00.000Z",
        updatedAt: "2026-08-30T11:00:00.000Z",
      }),
    );
    const terminations = [];
    const service = new OtbImportService({
      root,
      binaryPath: join(root, "collect_otb_games.exe"),
      terminateProcessTree: async (request) => terminations.push(request),
    });

    await service.initialize();

    assert.deepEqual(terminations, [
      {
        pid: 7654,
        jobId: "otb-stale",
        startedAt: "2026-08-30T11:00:00.000Z",
        binaryPath: service.binaryPath,
      },
    ]);
    assert.equal(service.getJob("otb-stale").status, "failed");
    const saved = JSON.parse(await readFile(join(root, "jobs", "otb-stale.json"), "utf8"));
    assert.equal(saved.collectorProcess, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup refuses to unlock a stale job when its exact collector tree cannot be stopped", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-croissant-otb-stale-failure-"));
  try {
    await mkdir(join(root, "jobs"), { recursive: true });
    await writeFile(
      join(root, "jobs", "otb-stuck.json"),
      JSON.stringify({
        id: "otb-stuck",
        status: "running",
        collectorProcess: { pid: 8765, jobId: "otb-stuck" },
      }),
    );
    const service = new OtbImportService({
      root,
      binaryPath: join(root, "collect_otb_games.exe"),
      terminateProcessTree: async () => {
        throw new Error("synthetic taskkill failure");
      },
    });

    await assert.rejects(service.initialize(), (error) => {
      assert.equal(error.code, "OTB_STALE_CLEANUP_FAILED");
      assert.match(error.message, /Could not stop stale OTB collector 8765/);
      return true;
    });
    assert.equal(service.getJob("otb-stuck"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows tree termination passes only an exact PID, executable, and job identity", async () => {
  const calls = [];
  await terminateCollectorProcessTree({
    pid: 2468,
    jobId: "otb-exact-job",
    binaryPath: "C:\\runtime\\collect_otb_games.exe",
    platform: "win32",
    runFile: async (...args) => calls.push(args),
  });

  assert.equal(calls.length, 1);
  const [command, args, options] = calls[0];
  assert.equal(command, "powershell.exe");
  assert.deepEqual(args.slice(-6), [
    "-TargetProcessId",
    "2468",
    "-ExpectedExecutable",
    "C:\\runtime\\collect_otb_games.exe",
    "-ExpectedJobId",
    "otb-exact-job",
  ]);
  assert.equal(options.windowsHide, true);
  assert.equal(options.timeout, 15_000);
});

test("restart recovery treats a reused Windows PID as non-matching instead of killing it", async () => {
  const identityMismatch = new Error("not the collector");
  identityMismatch.code = 20;
  const stopped = await terminateCollectorProcessTree({
    pid: 2468,
    jobId: "otb-old-job",
    binaryPath: "C:\\runtime\\collect_otb_games.exe",
    platform: "win32",
    runFile: async () => {
      throw identityMismatch;
    },
  });

  assert.equal(stopped, false);
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

test("migrates an inline completed job to compact status without changing its artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-croissant-otb-artifact-migration-"));
  try {
    const jobRoot = join(root, "jobs");
    await mkdir(jobRoot, { recursive: true });
    const games = parseOtbPgnGames(
      `[Event "Congress"]\n[Date "2026.08.01"]\n[White "Target, Player"]\n[Black "Opponent"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0`,
      "otb-legacy",
    );
    const prepDatabase = {
      database: { id: "legacy-db", name: "Target prep", sourceKind: "source" },
      games: [{ id: "legacy-game", moves: [{ san: "e4" }, { san: "e5" }] }],
    };
    const legacyJob = {
      id: "otb-legacy",
      status: "completed",
      request: { playerName: "Target, Player", fideId: "12345678", fromYear: 2020 },
      progress: { jobId: "otb-legacy", gamesFound: games.length },
      report: { playerName: "Player, Target", gamesFound: games.length },
      games,
      prepDatabase,
      createdAt: "2026-08-29T10:00:00.000Z",
      updatedAt: "2026-08-29T10:01:00.000Z",
      completedAt: "2026-08-29T10:01:00.000Z",
      error: null,
    };
    await writeFile(join(jobRoot, `${legacyJob.id}.json`), JSON.stringify(legacyJob));

    const service = new OtbImportService({ root, binaryPath: join(root, "unused") });
    await service.initialize();
    const status = service.getJob(legacyJob.id);
    assert.equal(status.status, "completed");
    assert.equal(status.gameCount, games.length);
    assert.equal(status.artifactAvailable, true);
    assert.equal("games" in status, false);
    assert.equal("prepDatabase" in status, false);

    const descriptor = await service.getJobArtifact(legacyJob.id);
    const artifact = JSON.parse(await readFile(descriptor.path, "utf8"));
    assert.deepEqual(artifact, { jobId: legacyJob.id, games, prepDatabase });
    const persistedStatus = JSON.parse(
      await readFile(join(jobRoot, `${legacyJob.id}.json`), "utf8"),
    );
    assert.equal("games" in persistedStatus, false);
    assert.equal("prepDatabase" in persistedStatus, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sets completedAt only after the complete artifact is durably written", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-croissant-otb-artifact-order-"));
  try {
    const service = new OtbImportService({ root, binaryPath: join(root, "unused") });
    await service.initialize();
    const job = {
      id: "otb-order",
      status: "running",
      request: { playerName: "Target, Player", fideId: "12345678", fromYear: 2020 },
      progress: null,
      report: null,
      gameCount: 0,
      artifactAvailable: false,
      artifactBytes: null,
      createdAt: "2026-08-29T10:00:00.000Z",
      updatedAt: "2026-08-29T10:00:00.000Z",
      completedAt: null,
      error: null,
    };
    service.jobs.set(job.id, job);
    const outputPath = join(service.outputRoot, `${job.id}.pgn`);
    const pgn = `[Event "Congress"]\n[Date "2026.08.01"]\n[White "Target, Player"]\n[Black "Opponent"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0`;
    await writeFile(outputPath, pgn);
    const persistArtifact = service.persistArtifact.bind(service);
    let completedAtDuringArtifactWrite = "not-called";
    service.persistArtifact = async (...args) => {
      completedAtDuringArtifactWrite = job.completedAt;
      return persistArtifact(...args);
    };

    await service.finishCompleted(
      job,
      { playerName: "Player, Target", gamesFound: 1, duplicatesRemoved: 0 },
      outputPath,
    );

    assert.equal(completedAtDuringArtifactWrite, null);
    assert.equal(job.status, "completed");
    assert.ok(Date.parse(job.completedAt) > 0);
    const descriptor = await service.getJobArtifact(job.id);
    const artifact = JSON.parse(await readFile(descriptor.path, "utf8"));
    assert.deepEqual(
      artifact.games.map((game) => game.pgn),
      [pgn],
    );
    assert.deepEqual(
      artifact.prepDatabase.games[0].moves.map((move) => move.san),
      ["e4", "e5", "Nf3", "Nc6"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compact polling transfers one artifact instead of repeating the full result", () => {
  const repeatedPgn = '[Event "Open"]\n\n1. e4 e5 1-0\n'.repeat(200);
  const games = Array.from({ length: 1_000 }, (_, index) => ({
    id: `otb-large:${index + 1}`,
    pgn: repeatedPgn,
  }));
  const prepDatabase = {
    database: { id: "large-db", name: "Large prep" },
    games: games.map((game) => ({ id: game.id, moves: [{ san: "e4" }, { san: "e5" }] })),
  };
  const legacyJob = {
    id: "otb-large",
    status: "completed",
    request: { playerName: "Large, Player", fromYear: 1900 },
    report: { gamesFound: games.length },
    games,
    prepDatabase,
    completedAt: "2026-08-29T10:01:00.000Z",
  };
  const artifact = extractOtbImportArtifact(legacyJob);
  const artifactBytes = Buffer.byteLength(JSON.stringify(artifact));
  const status = compactOtbImportJob({
    ...legacyJob,
    artifactAvailable: true,
    artifactBytes,
  });
  const fullBytes = Buffer.byteLength(JSON.stringify(legacyJob));
  const statusBytes = Buffer.byteLength(JSON.stringify(status));
  const polls = 20;
  const legacyTransferBytes = fullBytes * polls;
  const compactTransferBytes = statusBytes * polls + artifactBytes;

  assert.deepEqual(artifact.games, games);
  assert.deepEqual(artifact.prepDatabase, prepDatabase);
  assert.ok(statusBytes < fullBytes / 1_000);
  assert.ok(compactTransferBytes < legacyTransferBytes / 10);
});

test("parallel prep construction preserves deterministic games, warnings, and metadata", async () => {
  const pgnGames = Array.from({ length: 132 }, (_, index) => {
    const day = String((index % 28) + 1).padStart(2, "0");
    const moves =
      index % 17 === 0
        ? "1. e4 e5 2. Ke4 *"
        : index % 13 === 0
          ? "1. d4 d5 (1... Nf6 { Indian }) 2. c4 e6 1/2-1/2"
          : "1. e4 e5 2. Nf3 Nc6 1-0";
    const result = index % 17 === 0 ? "*" : index % 13 === 0 ? "1/2-1/2" : "1-0";
    return `[Event "Open ${index + 1}"]\n[Date "2026.08.${day}"]\n[White "Target, Player"]\n[Black "Opponent ${index % 9}"]\n[Result "${result}"]\n\n${moves}`;
  });
  // A service-side PGN slice can contain more than one parser game when the
  // second game has no Event header. This protects global warning/index offsets
  // across worker boundaries, including the shape found in the 4,681-game job.
  pgnGames[63] +=
    '\n\n[Site "Extra board"]\n[Date "2026.08.30"]\n[White "Target, Player"]\n[Black "Extra Opponent"]\n[Result "*"]\n\n1. e4 e5 2. Ke4 *';
  pgnGames[70] =
    '[Event "Broken setup"]\n[SetUp "1"]\n[FEN "not a FEN"]\n[White "Target, Player"]\n[Black "Broken Opponent"]\n[Result "*"]\n\n*';

  const input = {
    name: "Target Player OTB games 2020-2026.pgn",
    importedAt: 1_777_777_777_777,
  };
  const sequential = buildWebOtbPrepDatabase({
    ...input,
    pgn: pgnGames.join("\n\n"),
  });
  const parallel = await buildWebOtbPrepDatabaseParallel({
    ...input,
    pgnGames,
    workerCount: 3,
  });

  assert.deepEqual(parallel, sequential);
  assert.ok(parallel.warnings.some((warning) => warning.includes("illegal move Ke4")));
  assert.ok(
    parallel.warnings.some((warning) => warning.includes("could not read starting position")),
  );
  assert.ok(
    parallel.games.some(
      (game, index) => index > 0 && game.index > parallel.games[index - 1].index + 1,
    ),
  );
  assert.deepEqual(
    parallel.games.map((game) => game.index),
    sequential.games.map((game) => game.index),
  );
});

test("a synchronous worker creation failure terminates already-created siblings", async () => {
  const pgnGames = Array.from(
    { length: 128 },
    (_, index) =>
      `[Event "Open ${index + 1}"]\n[Date "2026.08.30"]\n[White "Target, Player"]\n[Black "Opponent"]\n[Result "1-0"]\n\n1. e4 e5 1-0`,
  );
  const expected = buildWebOtbPrepDatabase({
    name: "Worker failure fallback.pgn",
    pgn: pgnGames.join("\n\n"),
    importedAt: 1_777_777_777_777,
  });
  let creationCount = 0;
  let terminationCount = 0;
  const fallbackMessages = [];

  const actual = await buildWebOtbPrepDatabaseParallel({
    name: "Worker failure fallback.pgn",
    pgnGames,
    importedAt: 1_777_777_777_777,
    workerCount: 2,
    workerFactory: () => {
      creationCount += 1;
      if (creationCount === 2) throw new Error("synthetic Worker constructor failure");
      return {
        once() {
          return this;
        },
        async terminate() {
          terminationCount += 1;
        },
      };
    },
    onFallback: (message) => fallbackMessages.push(message),
  });

  assert.equal(creationCount, 2);
  assert.equal(terminationCount, 1);
  assert.deepEqual(fallbackMessages, ["synthetic Worker constructor failure"]);
  assert.deepEqual(actual, expected);
});

test("the managed home-server runtime includes the parallel prep worker modules", async () => {
  const launcher = await readFile(new URL("../start-home-server.ps1", import.meta.url), "utf8");
  for (const fileName of [
    "otb-prep-parallel.mjs",
    "otb-prep-worker.mjs",
    "terminate-collector-process-tree.ps1",
  ]) {
    assert.match(launcher, new RegExp(`'${fileName.replaceAll(".", "\\.")}'`));
  }
  assert.match(launcher, /Join-Path \$runtimeRoot \$fileName/);
});
