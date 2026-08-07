import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  assertNoNumberedBookPlaceholders,
  buildCoachMoveAnalysis,
  buildCoachPositionRecords,
  buildAgyCoachInvocation,
  buildAgyPromptSchema,
  buildCodexCoachInvocation,
  buildChessBookSearchTerms,
  buildCriticalMoments,
  buildLibraryPlannerPrompt,
  buildPcCoachAnalysisResult,
  buildPhoneCoachPrompt,
  buildStructuredPhoneCoachPrompt,
  codexExitIndicatesSignedOut,
  codexUsageLimitFromOutput,
  collectPcCoachPositionEvaluations,
  findExactOpeningBookMatches,
  findPawnStructureBookMatches,
  formatStatsAggregateDigest,
  getChessBookLibraryInventory,
  normalizeCloudCoachEvaluation,
  normalizeChessCoachRequestPayload,
  normalizeCoachModelSelection,
  normalizeLibraryPlan,
  normalizeSavedWebCoachReview,
  normalizeStructuredCoachReview,
  normalizeWebCoachReviewStore,
  parseStockfishCoachInfo,
  parseAgyCoachOutput,
  pawnStructureKey,
  preserveConfirmedCodexAuthentication,
  probeCodexAuthentication,
  publicChessCoachFailure,
  retrievePlannedBookPassages,
  searchChessBookCorpus,
  writeProcessStdinSafely,
} from "../chess-coach-service.mjs";

test("stats digest includes opponent bands, transparent quality comparisons, and position outcomes", () => {
  const digest = formatStatsAggregateDigest({
    record: { games: 4, wins: 2, draws: 1, losses: 1, scorePct: 62.5 },
    opponents: {
      gamesWithOpponentRating: 4,
      opponentRatingCoveragePct: 100,
      avgOpponentRating: 1544,
      medianOpponentRating: 1538,
      minOpponentRating: 1460,
      maxOpponentRating: 1630,
      avgRatingGap: 44,
      scorePct: 62.5,
      expectedScorePct: 43.2,
      scoreDeltaPct: 19.3,
      bands: [
        {
          label: "1400-1599",
          containsCurrentRating: true,
          games: 3,
          avgOpponentRating: 1515,
          scorePct: 66.7,
          expectedScorePct: 48,
          scoreDeltaPct: 18.7,
          analysisCoveragePct: 66.7,
          mistakesPerAnalyzedGame: 1.2,
          opponentMistakesPerAnalyzedGame: 1.6,
          blundersPerAnalyzedGame: 0.5,
          opponentBlundersPerAnalyzedGame: 0.8,
        },
      ],
    },
    mistakes: {
      analyzedGames: 3,
      pairedGames: 2,
      analysisCoveragePct: 75,
      avgAccuracy: 84,
      avgAcpl: 43,
      blundersPerGame: 0.5,
      mistakesPerGame: 1.2,
      inaccuraciesPerGame: 2,
      player: {
        games: 3,
        avgAccuracy: 84,
        avgAcpl: 43,
        inaccuraciesPerGame: 2,
        mistakesPerGame: 1.2,
        blundersPerGame: 0.5,
        errorsPer100Moves: 4.4,
        cleanGamePct: 33.3,
      },
      pairedPlayer: {
        games: 2,
        avgAccuracy: 91,
        avgAcpl: 22,
        inaccuraciesPerGame: 1,
        mistakesPerGame: 0.5,
        blundersPerGame: 0,
        errorsPer100Moves: 1.5,
        cleanGamePct: 50,
      },
      opponents: {
        games: 2,
        avgAccuracy: 81,
        avgAcpl: 51,
        inaccuraciesPerGame: 2.4,
        mistakesPerGame: 1.6,
        blundersPerGame: 0.8,
        errorsPer100Moves: 6.1,
        cleanGamePct: 0,
      },
      peerBenchmark: {
        ratingBandLabel: "1400-1599",
        samples: 2,
        expectedAccuracy: 80,
        expectedAcpl: 56,
        accuracyDelta: 4,
        acplDelta: -13,
      },
      situations: {
        games: 3,
        winningChances: 2,
        convertedWinningChances: 1,
        conversionPct: 50,
        losingChances: 1,
        savedLosingChances: 1,
        savePct: 100,
        avgMove15EvalCp: 42,
        avgOpeningExitWinPct: 55,
        critical: { moves: 8, errors: 2, accuracy: 74, errorPct: 25 },
        endgames: { better: { games: 1, scorePct: 100 } },
      },
    },
  });

  assert.match(digest, /OPPONENTS\|.*average_rating=1544.*score_minus_expected_pp=\+19\.3/);
  assert.match(digest, /OPPONENT_BAND\|1400-1599\|contains_player_rating=true/);
  assert.match(digest, /MOVE_QUALITY_PLAYER\|games=2\|sample=paired\|accuracy=91%/);
  assert.match(digest, /MOVE_QUALITY_OPPONENTS_IN_THESE_GAMES\|/);
  assert.match(
    digest,
    /ESTIMATED_RATING_BAND_MODEL\|1400-1599\|.*model_baseline_not_live_population=true/,
  );
  assert.match(digest, /POSITION_OUTCOMES\|.*conversion=50%.*save_rate=100%/);
  assert.match(
    digest,
    /DECISION_CONTEXT\|critical\|moves=8\|accuracy=74%\|errors=2\|error_rate=25%/,
  );
});

test("saved phone coach reviews are validated against their exact game key", () => {
  const review = {
    version: 1,
    contextKey: "context-a",
    lineContextKey: "line-a",
    scope: "whole-game",
    playerColor: "white",
    question: "Review my game",
    response: { overview: "Saved answer", categories: [] },
    savedAt: 123,
  };
  assert.deepEqual(normalizeSavedWebCoachReview(review, "line-a"), review);
  assert.equal(normalizeSavedWebCoachReview(review, "line-b"), null);
  assert.equal(normalizeSavedWebCoachReview({ ...review, response: null }, "line-a"), null);
});

test("saved phone coach store normalization preserves records and repairs missing stores", () => {
  const entry = { lineContextKey: "line-a", review: { savedAt: 123 } };
  assert.deepEqual(normalizeWebCoachReviewStore({ version: 1, records: { abc: entry } }), {
    version: 1,
    records: { abc: entry },
  });
  assert.deepEqual(normalizeWebCoachReviewStore(null), { version: 1, records: {} });
});

function fakeCodexStatusProcess({ code, output = "", neverExits = false }) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.killed = true;
  };
  queueMicrotask(() => {
    if (neverExits) return;
    child.stderr.write(output);
    child.emit("exit", code);
  });
  return child;
}

test("Codex auth probe distinguishes login, signed-out, and transient timeout states", async () => {
  const authenticated = await probeCodexAuthentication({
    spawnProcess: () => fakeCodexStatusProcess({ code: 0, output: "Logged in using ChatGPT" }),
    commandPath: "codex",
    cwd: ".",
    env: {},
  });
  assert.equal(authenticated.status, "authenticated");

  const signedOut = await probeCodexAuthentication({
    spawnProcess: () =>
      fakeCodexStatusProcess({ code: 1, output: "Not logged in. Run codex login." }),
    commandPath: "codex",
    cwd: ".",
    env: {},
  });
  assert.equal(signedOut.status, "signed-out");

  const timedOut = await probeCodexAuthentication({
    spawnProcess: () => fakeCodexStatusProcess({ neverExits: true }),
    commandPath: "codex",
    cwd: ".",
    env: {},
    timeoutMs: 5,
  });
  assert.equal(timedOut.status, "unavailable");
  assert.match(timedOut.detail, /timed out/);
});

test("a transient Codex probe cannot erase a confirmed login", () => {
  const result = preserveConfirmedCodexAuthentication(
    { status: "authenticated", detail: "confirmed" },
    { status: "unavailable", detail: "temporary timeout" },
  );
  assert.equal(result.status, "authenticated");
  assert.equal(result.transientDetail, "temporary timeout");
});

test("model auth failure classification requires a nonzero exit and auth stderr", () => {
  assert.equal(codexExitIndicatesSignedOut(1, "Authentication required; run codex login"), true);
  assert.equal(codexExitIndicatesSignedOut(0, "Authentication required; run codex login"), false);
  assert.equal(codexExitIndicatesSignedOut(1, "ordinary model error"), false);
});

test("Codex usage limits are recognized without treating transient rate limits as quota", () => {
  assert.deepEqual(
    codexUsageLimitFromOutput(
      "\u001b[31mERROR: You've hit your usage limit. Purchase more credits or try again at Jul 26th, 2026 11:35 PM.\u001b[0m",
    ),
    { retryLabel: "Jul 26th, 2026 11:35 PM" },
  );
  assert.deepEqual(codexUsageLimitFromOutput("insufficient_quota; quota exhausted"), {
    retryLabel: null,
  });
  assert.equal(codexUsageLimitFromOutput("429 Too Many Requests; retry in 2 seconds"), null);
  assert.equal(codexUsageLimitFromOutput("Not logged in. Run codex login."), null);
});

test("public coach failures never expose raw stderr, secrets, or local paths", () => {
  const internal = new Error(
    "Codex crashed at C:\\Users\\loxty\\.codex\\secret with token sk-private and raw stderr",
  );
  internal.code = "COACH_FAILED";
  const publicFailure = publicChessCoachFailure(internal);
  assert.deepEqual(publicFailure, {
    status: 502,
    code: "COACH_FAILED",
    error: "The PC coach could not complete this review. Please try again.",
  });
  assert.doesNotMatch(JSON.stringify(publicFailure), /Users|sk-private|stderr/);

  const signedOut = new Error("not signed in; run codex login");
  signedOut.code = "MODEL_UNAVAILABLE";
  assert.match(publicChessCoachFailure(signedOut).error, /codex login/);

  const usageLimited = new Error("raw diagnostics must stay private");
  usageLimited.code = "MODEL_USAGE_LIMIT";
  usageLimited.retryLabel = "Jul 26th, 2026 11:35 PM";
  assert.deepEqual(publicChessCoachFailure(usageLimited), {
    status: 429,
    code: "MODEL_USAGE_LIMIT",
    error:
      "OpenAI Codex has reached its usage limit. Add credits or try again at Jul 26th, 2026 11:35 PM.",
  });

  usageLimited.retryLabel = "C:\\Users\\loxty\\secret";
  assert.doesNotMatch(JSON.stringify(publicChessCoachFailure(usageLimited)), /Users|secret/);
});

test("Codex coach invocation is GPT-5.6 Sol, ephemeral, read-only, and tool-free", () => {
  const invocation = buildCodexCoachInvocation("Evidence payload", {
    outputSchemaPath: "C:/schemas/coach.json",
  });
  assert.deepEqual(invocation.args.slice(0, 4), [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
  ]);
  assert.ok(invocation.args.includes("gpt-5.6-sol"));
  assert.ok(invocation.args.includes("read-only"));
  assert.ok(invocation.args.includes('model_reasoning_effort="medium"'));
  assert.deepEqual(
    invocation.args.slice(
      invocation.args.indexOf("--output-schema"),
      invocation.args.indexOf("--output-schema") + 2,
    ),
    ["--output-schema", "C:/schemas/coach.json"],
  );
  assert.match(invocation.stdin, /Do not call tools/);
  assert.match(invocation.stdin, /one JSON object/);
  assert.match(invocation.stdin, /Evidence payload/);
});

test("Antigravity coach invocation uses allowlisted model effort and a prompt-bearing schema", () => {
  const promptSchema = buildAgyPromptSchema("PRIVATE CHESS EVIDENCE", {
    type: "object",
    properties: { plan: { type: "string" } },
    required: ["plan"],
  });
  assert.equal(promptSchema.unwrapAnswer, false);
  assert.match(promptSchema.schema.description, /PRIVATE CHESS EVIDENCE/);
  const invocation = buildAgyCoachInvocation({
    model: "gemini-3.5-flash",
    reasoningEffort: "high",
    outputSchemaPath: "C:/schemas/agy-coach.json",
    timeoutMs: 180000,
  });
  assert.deepEqual(
    invocation.args.slice(
      invocation.args.indexOf("--model"),
      invocation.args.indexOf("--model") + 2,
    ),
    ["--model", "gemini-3.5-flash"],
  );
  assert.ok(invocation.args.includes("--sandbox"));
  assert.ok(invocation.args.includes("--disable-slash-commands"));
  assert.ok(!invocation.args.includes("--dangerously-skip-permissions"));
  assert.deepEqual(
    invocation.args.slice(
      invocation.args.indexOf("--json-schema"),
      invocation.args.indexOf("--json-schema") + 2,
    ),
    ["--json-schema", "C:/schemas/agy-coach.json"],
  );
  assert.equal(
    parseAgyCoachOutput(
      JSON.stringify({ status: "SUCCESS", structured_output: { plan: "Play d5." } }),
    ),
    JSON.stringify({ plan: "Play d5." }),
  );
  assert.equal(
    parseAgyCoachOutput(
      JSON.stringify({ status: "SUCCESS", structured_output: { answer: "Plan first." } }),
      { unwrapAnswer: true },
    ),
    "Plan first.",
  );
});

test("Coach model selection rejects arbitrary models and enforces provider-specific effort", () => {
  assert.deepEqual(normalizeCoachModelSelection("gemini-3.1-pro", "high"), {
    provider: "gemini",
    model: "gemini-3.1-pro",
    reasoningEffort: "high",
  });
  assert.throws(
    () => normalizeCoachModelSelection("gemini-3.1-pro", "medium"),
    /does not support medium reasoning/,
  );
  assert.throws(() => normalizeCoachModelSelection("agy --dangerous", "high"), /Unsupported/);
});

test("large model stdin handles a late Windows EOF without an uncaught stream error", async () => {
  const stdin = new EventEmitter();
  stdin.destroyed = false;
  stdin.end = (input) => {
    stdin.input = input;
    queueMicrotask(() => {
      const error = new Error("write EOF");
      error.code = "EOF";
      stdin.emit("error", error);
    });
  };
  stdin.destroy = () => {
    stdin.destroyed = true;
  };
  const errors = [];
  const close = writeProcessStdinSafely(stdin, "x".repeat(256 * 1024), (error) =>
    errors.push(error),
  );
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(stdin.input.length, 256 * 1024);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "EOF");
  close();
  assert.equal(stdin.destroyed, true);
});

test("book search retrieves cited chunks and diversifies books", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE books (
      book_id TEXT PRIMARY KEY, title TEXT, author TEXT, shelf TEXT, local_path TEXT
    );
    CREATE TABLE chunks (
      chunk_id TEXT PRIMARY KEY, book_id TEXT, chapter_title TEXT, citation TEXT,
      pdf_page_start INTEGER, pdf_page_end INTEGER, printed_page_start INTEGER,
      printed_page_end INTEGER, text TEXT
    );
    CREATE VIRTUAL TABLE chunks_fts USING fts5(
      chunk_id UNINDEXED, title, author, shelf, chapter_title, coverage, text
    );
    INSERT INTO books VALUES
      ('calculation-one', 'Calculate Like a GM', 'A. Author', 'Thinking', 'C:/books/one.pdf'),
      ('strategy-two', 'Strategic Decisions', 'B. Author', 'Strategy', 'C:/books/two.pdf');
    INSERT INTO chunks VALUES
      ('one-a', 'calculation-one', 'Candidate moves', 'Calculate Like a GM - PDF p. 4', 4, 4, 10, 10,
       'Calculation starts with candidate moves and checking the opponent threats.'),
      ('one-b', 'calculation-one', 'Forcing lines', 'Calculate Like a GM - PDF p. 5', 5, 5, 11, 11,
       'Calculation of forcing candidate moves requires visualization.'),
      ('one-c', 'calculation-one', 'More calculation', 'Calculate Like a GM - PDF p. 6', 6, 6, 12, 12,
       'Calculation and candidate moves appear again.'),
      ('two-a', 'strategy-two', 'Decision making', 'Strategic Decisions - PDF p. 8', 8, 8, 20, 20,
       'Strategic decision making includes prophylaxis and opponent threats.');
    INSERT INTO chunks_fts VALUES
      ('one-a', 'Calculate Like a GM', 'A. Author', 'Thinking', 'Candidate moves', '',
       'Calculation starts with candidate moves and checking the opponent threats.'),
      ('one-b', 'Calculate Like a GM', 'A. Author', 'Thinking', 'Forcing lines', '',
       'Calculation of forcing candidate moves requires visualization.'),
      ('one-c', 'Calculate Like a GM', 'A. Author', 'Thinking', 'More calculation', '',
       'Calculation and candidate moves appear again.'),
      ('two-a', 'Strategic Decisions', 'B. Author', 'Strategy', 'Decision making', '',
       'Strategic decision making includes prophylaxis and opponent threats.');
  `);

  const passages = searchChessBookCorpus(database, {
    question: "Review my calculation and candidate moves",
    scope: "whole-game",
    moves: [],
  });

  assert.equal(passages.length, 3);
  assert.equal(passages.filter((passage) => passage.bookId === "calculation-one").length, 2);
  assert.ok(passages.some((passage) => passage.bookId === "strategy-two"));
  assert.match(passages[0].citation, /PDF p\./);
  database.close();
});

test("critical moments measure centipawn loss from the player's perspective", () => {
  const moves = [
    {
      ply: 1,
      color: "white",
      san: "e4",
      fenBefore: "start w - - 0 1",
      fenAfter: "after-e4 b - - 0 1",
    },
    {
      ply: 2,
      color: "black",
      san: "e5",
      fenBefore: "black-before b - - 0 1",
      fenAfter: "black-after w - - 0 2",
    },
  ];
  const evaluations = new Map([
    ["start w - -", { depth: 20, pvs: [{ cp: 80, moves: "e2e4 e7e5" }] }],
    ["after-e4 b - -", { depth: 20, pvs: [{ cp: 10, moves: "e7e5" }] }],
    ["black-before b - -", { depth: 20, pvs: [{ cp: -70, moves: "e7e5" }] }],
    ["black-after w - -", { depth: 20, pvs: [{ cp: 20, moves: "g1f3" }] }],
  ]);

  assert.equal(buildCriticalMoments(moves, evaluations, "white")[0].lossCp, 70);
  assert.equal(buildCriticalMoments(moves, evaluations, "black")[0].lossCp, 90);
});

test("phone prompt keeps engine and book evidence in separate roles", () => {
  const prompt = buildPhoneCoachPrompt({
    question: "What went wrong?",
    pgn: "1. e4 e5",
    playerColor: "white",
    currentFen: "fen",
    currentLines: [],
    criticalMoments: [],
    bookPassages: [
      {
        title: "Calculation",
        author: "GM Author",
        chapterTitle: "Candidates",
        citation: "Calculation - PDF p. 12",
        excerpt: "Generate candidate moves.",
      },
    ],
  });
  assert.match(prompt, /Stockfish evaluations and lines are authoritative/);
  assert.match(prompt, /Title: Calculation/);
  assert.match(prompt, /Chapter: Candidates/);
  assert.doesNotMatch(prompt, /\[Book \d+\]/);
  assert.match(prompt, /Never invent an evaluation/);
  assert.ok(
    buildChessBookSearchTerms({ question: "What went wrong?", scope: "whole-game" }).includes(
      "calculation",
    ),
  );
});

test("PC position sweep covers every ply, deduplicates transpositions, and keeps full FENs", () => {
  const moves = [
    {
      ply: 1,
      color: "white",
      san: "Nf3",
      fenBefore: "start w KQkq - 0 1",
      fenAfter: "after-one b KQkq - 1 1",
    },
    {
      ply: 2,
      color: "black",
      san: "Nf6",
      fenBefore: "after-one b KQkq - 1 1",
      fenAfter: "start w KQkq - 2 2",
    },
  ];
  const positions = buildCoachPositionRecords({ moves, scope: "whole-game", currentFen: "" });
  assert.equal(positions.length, 2);
  assert.equal(positions[0].fen, "start w KQkq - 0 1");
  assert.equal(positions[1].ply, 1);
});

test("coach request normalization never silently truncates the PGN or a long practical game", () => {
  const pgn = `${"1. Nf3 Nf6 ".repeat(1800)}END-OF-PGN`;
  const moves = Array.from({ length: 300 }, (_, index) => ({
    ply: index + 1,
    color: index % 2 === 0 ? "white" : "black",
    san: index % 2 === 0 ? "Nf3" : "Nf6",
    uci: index % 2 === 0 ? "g1f3" : "g8f6",
    fenBefore: `position-${index} ${index % 2 === 0 ? "w" : "b"} - - 0 1`,
    fenAfter: `position-${index + 1} ${index % 2 === 0 ? "b" : "w"} - - 0 1`,
  }));
  const normalized = normalizeChessCoachRequestPayload(
    {
      requestId: "coach-complete-input",
      question: "Review the whole game",
      currentFen: moves.at(-1).fenAfter,
      pgn,
      playerColor: "white",
      scope: "whole-game",
      moves,
    },
    { createRequestId: () => "unused-request-id" },
  );
  assert.equal(normalized.moves.length, 300);
  assert.equal(normalized.model, "gpt-5.6-sol");
  assert.equal(normalized.reasoningEffort, "medium");
  assert.equal(normalized.pgn, pgn);
  assert.match(normalized.pgn, /END-OF-PGN$/);

  const prompt = buildLibraryPlannerPrompt({
    ...normalized,
    moveAnalysis: [],
    inventory: { books: [], chapters: [] },
  });
  assert.match(prompt, /END-OF-PGN/);
  assert.match(prompt, /deepest stable opening position/);
  assert.match(prompt, /openingClassification/);
  assert.match(prompt, /does not make the resulting game a/);
  assert.match(prompt, /resultingFamily/);
});

test("coach request normalization carries validated PC persistence metadata", () => {
  const normalized = normalizeChessCoachRequestPayload({
    requestId: "coach-background-save",
    question: "Review the game",
    currentFen: "current w - - 0 1",
    pgn: "1. e4",
    moves: [],
    persistence: {
      storageKey: "game-storage-key",
      contextKey: "game-context-key",
      lineContextKey: "line-context-key",
    },
  });
  assert.deepEqual(normalized.persistence, {
    storageKey: "game-storage-key",
    contextKey: "game-context-key",
    lineContextKey: "line-context-key",
  });
  const gemini = normalizeChessCoachRequestPayload({
    requestId: "coach-gemini-model",
    question: "Review the game",
    currentFen: "current w - - 0 1",
    pgn: "1. e4",
    moves: [],
    model: "gemini-3.5-flash",
    reasoningEffort: "low",
  });
  assert.equal(gemini.provider, "gemini");
  assert.equal(gemini.model, "gemini-3.5-flash");
  assert.equal(gemini.reasoningEffort, "low");
  assert.throws(
    () =>
      normalizeChessCoachRequestPayload({
        question: "Review the game",
        currentFen: "current w - - 0 1",
        pgn: "1. e4",
        moves: [],
        persistence: { storageKey: "game-storage-key" },
      }),
    /Invalid coach persistence context/,
  );
});

test("coach request normalization explicitly rejects incomplete or oversized input", () => {
  const base = {
    question: "Review the game",
    currentFen: "current w - - 0 1",
    pgn: "1. e4",
    moves: [],
  };
  assert.throws(
    () =>
      normalizeChessCoachRequestPayload({
        ...base,
        moves: [{ ply: 1, san: "e4", fenBefore: "start w - - 0 1" }],
      }),
    /missing its complete before\/after position data/,
  );
  assert.throws(
    () => normalizeChessCoachRequestPayload({ ...base, pgn: "x".repeat(300_001) }),
    /PGN is too large/,
  );
  const discontinuousMoves = [
    {
      ply: 1,
      san: "e4",
      fenBefore: "start w - - 0 1",
      fenAfter: "after-e4 b - - 0 1",
    },
    {
      ply: 2,
      san: "e5",
      fenBefore: "different b - - 0 1",
      fenAfter: "after-e5 w - - 0 2",
    },
  ];
  assert.equal(
    buildCoachPositionRecords({ moves: discontinuousMoves, scope: "whole-game" }).length,
    4,
  );
  assert.throws(
    () => normalizeChessCoachRequestPayload({ ...base, moves: discontinuousMoves }),
    /does not continue from the preceding game position/,
  );
});

test("PC sweep checks every cloud position first and live-analyzes only misses sequentially", async () => {
  const positions = ["one", "two", "three"].map((key) => ({ key, fen: `${key} w - - 0 1` }));
  const calls = [];
  let liveConcurrency = 0;
  let maxLiveConcurrency = 0;
  const progress = [];
  const result = await collectPcCoachPositionEvaluations({
    positions,
    queryCloud: async (fen) => {
      calls.push(`cloud:${fen.split(" ")[0]}`);
      return fen.startsWith("two") ? { source: "pc-cloud", whiteCp: 10 } : null;
    },
    queryLive: async (fen) => {
      const key = fen.split(" ")[0];
      calls.push(`live:${key}:start`);
      liveConcurrency += 1;
      maxLiveConcurrency = Math.max(maxLiveConcurrency, liveConcurrency);
      await new Promise((resolve) => setTimeout(resolve, 2));
      liveConcurrency -= 1;
      calls.push(`live:${key}:end`);
      return { source: "pc-live", whiteCp: key === "one" ? 5 : -5 };
    },
    onProgress: (event) => progress.push(event),
  });
  assert.deepEqual(calls, [
    "cloud:one",
    "cloud:two",
    "cloud:three",
    "live:one:start",
    "live:one:end",
    "live:three:start",
    "live:three:end",
  ]);
  assert.equal(maxLiveConcurrency, 1);
  assert.equal(result.cloudHits, 1);
  assert.equal(result.liveAnalyses, 2);
  assert.equal(result.evaluations.size, 3);
  assert.deepEqual(progress.at(-1), { phase: "live", completed: 2, total: 2 });
});

test("Coach opening sweep stops at the first cache gap and analyzes only that boundary", async () => {
  const positions = [
    { key: "start", fen: "start w - - 0 1", ply: 0 },
    { key: "one", fen: "one b - - 0 1", ply: 1 },
    { key: "two", fen: "two w - - 0 2", ply: 2 },
    { key: "three", fen: "three b - - 0 2", ply: 3 },
  ];
  const calls = [];
  const result = await collectPcCoachPositionEvaluations({
    positions,
    stopAfterFirstCloudMiss: true,
    liveAttempts: 1,
    queryCloud: async (fen) => {
      const key = fen.split(" ")[0];
      calls.push(`cloud:${key}`);
      return key === "start" || key === "one"
        ? { source: "pc-cloud", whiteCp: key === "start" ? 20 : 12 }
        : null;
    },
    queryLive: async (fen) => {
      const key = fen.split(" ")[0];
      calls.push(`live:${key}`);
      return { source: "pc-live", depth: 16, whiteCp: 8 };
    },
  });

  assert.deepEqual(calls, ["cloud:start", "cloud:one", "cloud:two", "live:two"]);
  assert.equal(result.cloudHits, 2);
  assert.equal(result.liveAnalyses, 1);
  assert.equal(result.evaluations.size, 3);
  assert.equal(result.checkedPositions.length, 3);
  assert.equal(result.skippedPositions, 1);
  assert.equal(result.stoppedAtCloudBoundary, true);
  assert.equal(result.boundaryPly, 2);
});

test("Coach opening sweep can keep useful cached evidence if its one live boundary check fails", async () => {
  const result = await collectPcCoachPositionEvaluations({
    positions: [
      { key: "start", fen: "start w - - 0 1", ply: 0 },
      { key: "one", fen: "one b - - 0 1", ply: 1 },
      { key: "two", fen: "two w - - 0 2", ply: 2 },
    ],
    stopAfterFirstCloudMiss: true,
    allowLiveFailure: true,
    liveAttempts: 1,
    queryCloud: async (fen) =>
      fen.startsWith("start") ? { source: "pc-cloud", whiteCp: 20 } : null,
    queryLive: async () => {
      throw new Error("boundary timeout");
    },
  });

  assert.equal(result.cloudHits, 1);
  assert.equal(result.liveAnalyses, 0);
  assert.equal(result.liveFailures, 1);
  assert.equal(result.evaluatedPositions.length, 1);
  assert.equal(result.skippedPositions, 2);
});

test("PC sweep aborts before a cache miss can start live Stockfish", async () => {
  const controller = new AbortController();
  let liveCalls = 0;
  await assert.rejects(
    collectPcCoachPositionEvaluations({
      positions: [
        { key: "one", fen: "one w - - 0 1" },
        { key: "two", fen: "two w - - 0 1" },
      ],
      signal: controller.signal,
      queryCloud: async (fen) => {
        if (fen.startsWith("one")) controller.abort();
        return null;
      },
      queryLive: async () => {
        liveCalls += 1;
        return { source: "pc-live", whiteCp: 0 };
      },
    }),
    { name: "AbortError" },
  );
  assert.equal(liveCalls, 0);
});

test("PC sweep retries a transient live Stockfish transport failure", async () => {
  let attempts = 0;
  const result = await collectPcCoachPositionEvaluations({
    positions: [{ key: "one", fen: "one w - - 0 1" }],
    queryCloud: async () => null,
    queryLive: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("fetch failed");
      return { source: "pc-live", whiteCp: 12 };
    },
    liveRetryDelayMs: 0,
  });
  assert.equal(attempts, 3);
  assert.equal(result.evaluations.get("one").whiteCp, 12);
});

test("cloud scores stay White-relative while live black-to-move scores are flipped", () => {
  const cloud = normalizeCloudCoachEvaluation(
    { depth: 31, knodes: 12, pvs: [{ cp: 73, moves: "a7a6" }] },
    "fen b - - 0 1",
  );
  assert.equal(cloud.whiteCp, 73);
  assert.equal(cloud.nodes, 12000);

  const live = parseStockfishCoachInfo(
    "info depth 18 seldepth 22 multipv 1 score cp -73 nodes 12000 nps 900000 pv a7a6 a2a3",
    "fen b - - 0 1",
  );
  assert.equal(live.whiteCp, 73);
  assert.equal(live.depth, 18);
  assert.deepEqual(live.pvUci, ["a7a6", "a2a3"]);
  assert.equal(
    parseStockfishCoachInfo("info depth 20 score cp 5 lowerbound pv a2a3", "fen w - -"),
    null,
  );
});

test("AI planner is restricted to real accessible chapters and retrieval stays in its scope", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE books (
      book_id TEXT PRIMARY KEY, title TEXT, author TEXT, shelf TEXT, local_path TEXT
    );
    CREATE TABLE chapters (
      chapter_id TEXT PRIMARY KEY, book_id TEXT, order_index INTEGER, number TEXT, title TEXT,
      printed_page_start INTEGER, pdf_page_start INTEGER, pdf_page_end INTEGER,
      accessible_in_excerpt INTEGER
    );
    CREATE TABLE chunks (
      chunk_id TEXT PRIMARY KEY, book_id TEXT, chapter_id TEXT, chapter_title TEXT,
      pdf_page_start INTEGER, pdf_page_end INTEGER, printed_page_start INTEGER,
      printed_page_end INTEGER, sequence_in_page INTEGER, citation TEXT, text TEXT
    );
    CREATE TABLE opening_lines (
      line_id TEXT PRIMARY KEY, book_id TEXT, chapter_id TEXT, line_kind TEXT, pgn TEXT,
      confidence REAL, complete_game INTEGER, source_chunk_id TEXT, move_count INTEGER,
      uci_line TEXT
    );
    CREATE TABLE opening_line_moves (
      line_id TEXT, move_index INTEGER, ply INTEGER, san TEXT, uci TEXT, fen_before TEXT,
      fen_before_key TEXT, fen_after TEXT, fen_after_key TEXT, source_pdf_page INTEGER,
      source_printed_page INTEGER, source_chunk_id TEXT, confidence REAL
    );
    INSERT INTO books VALUES
      ('opening-book', 'Plans in the Dutch', 'GM Author', 'Openings', 'C:/books/dutch.pdf'),
      ('endgame-book', 'Rook Endgames', 'GM Endgamer', 'Endgames', 'C:/books/rook.pdf');
    INSERT INTO chapters VALUES
      ('dutch-structure', 'opening-book', 1, '3', 'The Stonewall structure', 20, 8, 10, 1),
      ('rook-active', 'endgame-book', 1, '5', 'Active rook defence', 40, 12, 13, 1),
      ('hidden-toc', 'opening-book', 2, '9', 'Unavailable theory', 80, NULL, NULL, 0);
    INSERT INTO chunks VALUES
      ('dutch-a', 'opening-book', 'dutch-structure', 'The Stonewall structure', 8, 8, 20, 20, 0,
       'Plans in the Dutch - PDF p. 8', 'The e5 break and dark-squared bishop determine the plan.'),
      ('hidden-a', 'opening-book', 'hidden-toc', 'Unavailable theory', 20, 20, 80, 80, 0,
       'Plans in the Dutch - PDF p. 20', 'An unrelated chapter that the planner did not select.'),
      ('rook-a', 'endgame-book', 'rook-active', 'Active rook defence', 12, 12, 40, 40, 0,
       'Rook Endgames - PDF p. 12', 'Keep the rook active behind the passed pawn.');
    INSERT INTO opening_lines VALUES
      ('dutch-line', 'opening-book', 'dutch-structure', 'variation', '1. e4 e6',
       0.98, 0, 'dutch-a', 2, 'e2e4 e7e6'),
      ('generic-divergence', 'opening-book', 'dutch-structure', 'variation', '1. e4 c5',
       0.98, 0, 'dutch-a', 2, 'e2e4 c7c5'),
      ('grounded-divergence', 'opening-book', 'dutch-structure', 'variation', '1. e4 e6 2. d4',
       0.98, 0, 'dutch-a', 3, 'e2e4 e7e6 d2d4'),
      ('transposed-position', 'opening-book', 'dutch-structure', 'variation',
       '1. d4 d5 2. Nf3 Nf6 3. c4',
       0.98, 0, 'dutch-a', 5, 'd2d4 d7d5 g1f3 g8f6 c2c4');
    INSERT INTO opening_line_moves VALUES
      ('dutch-line', 0, 1, 'e4', 'e2e4',
       'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
       'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
       'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
       'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
       8, 20, 'dutch-a', 0.98),
      ('dutch-line', 1, 2, 'e6', 'e7e6',
       'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
       'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
       'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
       'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -',
       8, 20, 'dutch-a', 0.98),
      ('generic-divergence', 0, 1, 'e4', 'e2e4',
       'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
       'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
       'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
       'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
       8, 20, 'dutch-a', 0.98),
      ('generic-divergence', 1, 2, 'c5', 'c7c5',
       'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
       'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
       'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
       'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -',
       8, 20, 'dutch-a', 0.98),
      ('grounded-divergence', 0, 1, 'e4', 'e2e4',
       'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
       'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
       'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
       'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
       8, 20, 'dutch-a', 0.98),
      ('grounded-divergence', 1, 2, 'e6', 'e7e6',
       'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
       'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
       'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
       'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -',
       8, 20, 'dutch-a', 0.98),
      ('grounded-divergence', 2, 3, 'd4', 'd2d4',
       'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
       'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -',
       'rnbqkbnr/pppp1ppp/4p3/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq - 0 2',
       'rnbqkbnr/pppp1ppp/4p3/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq -',
       8, 20, 'dutch-a', 0.98),
      ('transposed-position', 4, 5, 'c4', 'c2c4',
       'rnbqkb1r/ppp1pppp/5n2/3p4/3P4/5N2/PPP1PPPP/RNBQKB1R w KQkq - 2 3',
       'rnbqkb1r/ppp1pppp/5n2/3p4/3P4/5N2/PPP1PPPP/RNBQKB1R w KQkq -',
       'rnbqkb1r/ppp1pppp/5n2/3p4/2PP4/5N2/PP2PPPP/RNBQKB1R b KQkq - 0 3',
       'rnbqkb1r/ppp1pppp/5n2/3p4/2PP4/5N2/PP2PPPP/RNBQKB1R b KQkq -',
       8, 20, 'dutch-a', 0.98);
  `);
  const inventory = getChessBookLibraryInventory(database);
  assert.deepEqual(
    inventory.chapters.map((chapter) => chapter.chapterId),
    ["rook-active", "dutch-structure"],
  );
  const plan = normalizeLibraryPlan(
    {
      overview: "The opening structure mattered.",
      openingClassification: {
        relevant: true,
        initialMoveOrder: "1.Nf3 d5",
        resultingFamily: "Queen's Gambit by transposition",
        classificationPly: 7,
        transposition: true,
        explanation: "The d4/c4 centre determines the opening family.",
      },
      categories: [
        {
          id: "Opening ideas",
          label: "Dutch structure",
          reason: "White missed the thematic e5 response.",
          keyPlies: [7, 999],
          bookIds: ["invented-book"],
          chapterIds: ["dutch-structure", "hidden-toc", "invented-chapter"],
          searchQueries: ["e5 break dark squared bishop"],
        },
      ],
    },
    inventory,
    [{ ply: 7 }],
  );
  assert.deepEqual(plan.categories[0].chapterIds, ["dutch-structure"]);
  assert.deepEqual(plan.categories[0].bookIds, ["opening-book"]);
  assert.deepEqual(plan.categories[0].keyPlies, [7]);
  assert.deepEqual(plan.openingClassification, {
    relevant: true,
    initialMoveOrder: "1.Nf3 d5",
    resultingFamily: "Queen's Gambit by transposition",
    classificationPly: 7,
    transposition: true,
    explanation: "The d4/c4 centre determines the opening family.",
  });
  const exactOpeningMatches = findExactOpeningBookMatches(database, [
    {
      ply: 1,
      san: "e4",
      uci: "e2e4",
      fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    },
  ]);
  assert.equal(exactOpeningMatches.length, 1);
  assert.equal(exactOpeningMatches[0].playedMoveMatched, true);
  assert.equal(exactOpeningMatches[0].title, "Plans in the Dutch");
  assert.deepEqual(
    exactOpeningMatches[0].moves.slice(0, 2).map((move) => move.uci),
    ["e2e4", "e7e6"],
  );
  const divergentMatches = findExactOpeningBookMatches(database, [
    {
      ply: 1,
      san: "e4",
      uci: "e2e4",
      fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    },
    {
      ply: 2,
      san: "e6",
      uci: "e7e6",
      fenBefore: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    },
    {
      ply: 3,
      san: "Nf3",
      uci: "g1f3",
      fenBefore: "rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
    },
  ]);
  assert.equal(
    divergentMatches.some((match) => match.lineId === "generic-divergence"),
    false,
  );
  const groundedDivergence = divergentMatches.find(
    (match) => match.lineId === "grounded-divergence",
  );
  assert.equal(groundedDivergence?.playedMoveMatched, false);
  assert.equal(groundedDivergence?.sharedPlies, 2);
  const transposedMatches = findExactOpeningBookMatches(database, [
    {
      ply: 1,
      san: "Nf3",
      uci: "g1f3",
      fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    },
    {
      ply: 2,
      san: "Nf6",
      uci: "g8f6",
      fenBefore: "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1",
    },
    {
      ply: 3,
      san: "d4",
      uci: "d2d4",
      fenBefore: "rnbqkb1r/pppppppp/5n2/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 2 2",
    },
    {
      ply: 4,
      san: "d5",
      uci: "d7d5",
      fenBefore: "rnbqkb1r/pppppppp/5n2/8/3P4/5N2/PPP1PPPP/RNBQKB1R b KQkq - 0 2",
    },
    {
      ply: 5,
      san: "c4",
      uci: "c2c4",
      fenBefore: "rnbqkb1r/ppp1pppp/5n2/3p4/3P4/5N2/PPP1PPPP/RNBQKB1R w KQkq - 2 3",
    },
  ]);
  const transposedPosition = transposedMatches.find(
    (match) => match.lineId === "transposed-position",
  );
  assert.equal(transposedPosition?.playedMoveMatched, true);
  assert.equal(transposedPosition?.matchedGamePly, 5);
  assert.equal(transposedPosition?.sharedHistoryPlies, 0);
  const transpositionPrompt = buildLibraryPlannerPrompt({
    question: "Review the opening",
    pgn: "1. Nf3 Nf6 2. d4 d5 3. c4",
    playerColor: "white",
    scope: "whole-game",
    currentFen: "",
    moveAnalysis: [{ ply: 5 }],
    inventory,
    exactOpeningMatches: transposedMatches,
  });
  assert.match(transpositionPrompt, /relation=transposed_position/);
  const retrieval = retrievePlannedBookPassages(database, plan, { exactOpeningMatches });
  assert.deepEqual(retrieval.categoryPassageIds[plan.categories[0].id], ["dutch-a"]);
  assert.deepEqual(
    retrieval.passages.map((passage) => passage.chunkId),
    ["dutch-a"],
  );
  assert.equal(retrieval.passages[0].title, "Plans in the Dutch");
  assert.equal(retrieval.passages[0].openingLines.length, 1);
  database.close();
});

test("pawn-structure matches prioritize plan-led chapters and plan-first prompts", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE books (
      book_id TEXT PRIMARY KEY, title TEXT, author TEXT, shelf TEXT, local_path TEXT
    );
    CREATE TABLE chapters (
      chapter_id TEXT PRIMARY KEY, book_id TEXT, title TEXT
    );
    CREATE TABLE chunks (
      chunk_id TEXT PRIMARY KEY, book_id TEXT, chapter_id TEXT, chapter_title TEXT,
      pdf_page_start INTEGER, pdf_page_end INTEGER, printed_page_start INTEGER,
      printed_page_end INTEGER, sequence_in_page INTEGER, citation TEXT, text TEXT
    );
    CREATE TABLE structure_anchors (
      anchor_id TEXT PRIMARY KEY, book_id TEXT, chapter_id TEXT, source_chunk_id TEXT,
      label TEXT, fen TEXT, pawn_key TEXT, source_order INTEGER, confidence REAL
    );
    INSERT INTO books VALUES
      ('structures-course', 'Chess Structures: A Grandmaster Guide', 'Mauricio Flores Rios',
       'Pawn Structures', '');
    INSERT INTO chapters VALUES
      ('carlsbad', 'structures-course', 'The Carlsbad Formation');
    INSERT INTO chunks VALUES
      ('generic', 'structures-course', 'carlsbad', 'The Carlsbad Formation',
       1, 1, NULL, NULL, 0, 'Private course variation 1',
       'A generic model game note.'),
      ('carlsbad-plans', 'structures-course', 'carlsbad', 'The Carlsbad Formation',
       2, 2, NULL, NULL, 0, 'Private course variation 2',
       'White can use the minority attack or prepare e4; Black seeks ...Ne4 and ...c5 counterplay.');
  `);
  database
    .prepare("UPDATE chunks SET text=? WHERE chunk_id='carlsbad-plans'")
    .run(
      `White's plans: prepare the minority attack or e4. ${"Position-specific context. ".repeat(55)} Black's plans: seek ...Ne4 and ...c5 counterplay.`,
    );
  const fen = "4k3/ppp2ppp/8/3p4/3P4/4P3/PP3PPP/4K3 w - - 0 1";
  const key = pawnStructureKey(fen);
  assert.equal(key.length, 64);
  database
    .prepare("INSERT INTO structure_anchors VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      "carlsbad-anchor",
      "structures-course",
      "carlsbad",
      "carlsbad-plans",
      "The Carlsbad Formation",
      fen,
      key,
      2,
      1,
    );
  const structureMatches = findPawnStructureBookMatches(database, [
    { ply: 12, fenBefore: fen, fenAfter: fen },
  ]);
  assert.equal(structureMatches.length, 1);
  assert.equal(structureMatches[0].chapterTitle, "The Carlsbad Formation");
  assert.equal(structureMatches[0].matchedGamePly, 12);
  assert.match(structureMatches[0].excerpt, /Black's plans/);
  assert.deepEqual(
    findPawnStructureBookMatches(database, [{ ply: 80, fenBefore: fen, fenAfter: fen }]),
    [],
  );
  assert.equal(
    findPawnStructureBookMatches(database, [], {
      currentFen: fen.replace("0 1", "0 8"),
    })[0].chapterTitle,
    "The Carlsbad Formation",
  );

  const libraryPlan = {
    overview: "The structure determines the plan.",
    openingClassification: {
      relevant: true,
      initialMoveOrder: "Queen's Gambit",
      resultingFamily: "Carlsbad structure",
      classificationPly: 12,
      transposition: false,
      explanation: "The pawn placement is decisive.",
    },
    categories: [
      {
        id: "opening-plans",
        label: "Carlsbad plans",
        reason: "The player needed a plan.",
        keyPlies: [12],
        bookIds: ["structures-course"],
        chapterIds: ["carlsbad"],
        searchQueries: ["minority attack e4 counterplay"],
      },
    ],
  };
  const retrieval = retrievePlannedBookPassages(database, libraryPlan, { structureMatches });
  assert.equal(retrieval.passages[0].chunkId, "carlsbad-plans");
  const prompt = buildLibraryPlannerPrompt({
    question: "Explain my opening",
    pgn: "1. d4 d5",
    playerColor: "white",
    scope: "whole-game",
    currentFen: fen,
    moveAnalysis: [{ ply: 12 }],
    inventory: { books: [], chapters: [] },
    structureMatches,
  });
  assert.match(prompt, /STRUCTURE_PLAN/);
  assert.match(prompt, /strategic map/);
  database.close();
});

test("structured review keeps AI categories but rejects invented source and position ids", () => {
  const libraryPlan = {
    overview: "Plan overview",
    categories: [
      {
        id: "opening",
        label: "Opening structure",
        reason: "The structure was mishandled.",
        keyPlies: [3],
        bookIds: ["book"],
        chapterIds: ["chapter"],
        searchQueries: ["structure"],
      },
    ],
  };
  const bookPassages = [{ chunkId: "real-source", title: "Real Opening Book" }];
  const review = normalizeStructuredCoachReview(
    {
      overview: "You chose the wrong plan.",
      priorities: ["Study the structure"],
      categories: [
        {
          id: "opening",
          label: "Model tried to rename this",
          summary: "A concrete opening lesson.",
          explanation: "Use the thematic break.",
          positions: [
            {
              ply: 3,
              san: "Qh9",
              title: "The first decision",
              explanation: "The bishop belongs elsewhere.",
              engineEvidence: "+0.10 to -0.35",
              betterPlan: "Prepare e4.",
            },
            {
              ply: 99,
              san: "Qh9",
              title: "Invented",
              explanation: "",
              engineEvidence: "",
              betterPlan: "",
            },
          ],
          bookReferences: [
            { chunkId: "real-source", whyItMatters: "It explains the break.", positionPly: 3 },
            { chunkId: "fake-source", whyItMatters: "Invented.", positionPly: null },
          ],
        },
      ],
    },
    {
      libraryPlan,
      bookPassages,
      moves: [{ ply: 3, san: "Bf4" }],
      categoryPassageIds: { opening: ["real-source"] },
    },
  );
  assert.equal(review.categories[0].label, "Opening structure");
  assert.deepEqual(
    review.categories[0].positions.map((position) => position.ply),
    [3],
  );
  assert.equal(review.categories[0].positions[0].san, "Bf4");
  assert.deepEqual(
    review.categories[0].bookReferences.map((source) => source.chunkId),
    ["real-source"],
  );
  const prompt = buildStructuredPhoneCoachPrompt({
    question: "Review",
    pgn: "1. Nf3",
    playerColor: "white",
    currentFen: "fen",
    scope: "whole-game",
    moveAnalysis: [],
    analysisCoverage: { totalPositions: 2, cloudHits: 2, liveAnalyses: 0 },
    libraryPlan,
    bookPassages: [
      {
        ...bookPassages[0],
        bookId: "book",
        author: "GM Author",
        shelf: "Openings",
        chapterTitle: "Real chapter",
        citation: "PDF p. 2",
        excerpt: "The thematic break matters.",
      },
    ],
    categoryPassageIds: { opening: ["real-source"] },
  });
  assert.match(prompt, /complete real title/);
  assert.match(prompt, /exact move\/ply and current squares/);
  assert.match(prompt, /plan-first strategic map/);
  assert.match(prompt, /Do not narrate a book line move by move/);
  assert.doesNotMatch(prompt, /\[Book \d+\]/);
});

test("structured coach output rejects numbered book placeholders in user-visible text", () => {
  assert.throws(
    () =>
      assertNoNumberedBookPlaceholders({
        overview: "Concrete overview",
        categories: [
          {
            label: "Opening",
            positions: [{ explanation: "This is supposedly explained by Book 3." }],
          },
        ],
        priorities: ["Study the named chapter"],
      }),
    /numbered book placeholder/,
  );
  assert.doesNotThrow(() =>
    assertNoNumberedBookPlaceholders({
      overview: "Use Bologan's Ruy Lopez for Black, chapter Strategic Ideas & Themes.",
      priorities: ["Study the named chapter"],
    }),
  );

  assert.throws(
    () =>
      normalizeStructuredCoachReview(
        {
          overview: "Book 3 contains the answer.",
          priorities: [],
          categories: [
            {
              id: "opening",
              summary: "Opening lesson",
              explanation: "Use the thematic break.",
              positions: [],
              bookReferences: [
                { chunkId: "real-source", whyItMatters: "Named source lesson", positionPly: null },
              ],
            },
          ],
        },
        {
          libraryPlan: {
            overview: "Plan",
            categories: [
              {
                id: "opening",
                label: "Opening",
                reason: "Opening lesson",
                keyPlies: [],
              },
            ],
          },
          bookPassages: [{ chunkId: "real-source" }],
          moves: [],
          categoryPassageIds: { opening: ["real-source"] },
        },
      ),
    /numbered book placeholder/,
  );
});

test("structured coach output must include every AI-planned category", () => {
  assert.throws(
    () =>
      normalizeStructuredCoachReview(
        {
          overview: "Review",
          priorities: [],
          categories: [
            {
              id: "opening",
              summary: "Opening summary",
              explanation: "Opening explanation",
              positions: [],
              bookReferences: [],
            },
          ],
        },
        {
          libraryPlan: {
            overview: "Plan",
            categories: [
              { id: "opening", label: "Opening", reason: "Opening reason", keyPlies: [] },
              { id: "endgame", label: "Endgame", reason: "Endgame reason", keyPlies: [] },
            ],
          },
          bookPassages: [],
          moves: [],
          categoryPassageIds: { opening: [], endgame: [] },
        },
      ),
    /omitted the AI-planned review category Endgame/,
  );
});

test("move trace keeps every move and records source/depth-aware player loss", () => {
  const moves = [
    {
      ply: 1,
      color: "white",
      san: "e4",
      uci: "e2e4",
      fenBefore: "start w - - 0 1",
      fenAfter: "after b - - 0 1",
      annotations: [],
    },
  ];
  const evaluations = new Map([
    ["start w - -", { source: "pc-cloud", depth: 30, whiteCp: 40, pvUci: ["d2d4"] }],
    ["after b - -", { source: "pc-live", depth: 18, whiteCp: -15, pvUci: ["e7e5"] }],
  ]);
  const trace = buildCoachMoveAnalysis(moves, evaluations, "white");
  assert.equal(trace.length, 1);
  assert.equal(trace[0].playerLossCp, 55);
  assert.equal(trace[0].before.source, "pc-cloud");
  assert.equal(trace[0].after.depth, 18);
});

test("PC analysis-only result reports complete coverage and a full per-move trace", () => {
  const moves = [
    {
      ply: 1,
      color: "white",
      san: "e4",
      uci: "e2e4",
      fenBefore: "start w - - 0 1",
      fenAfter: "after-one b - - 0 1",
      annotations: [],
    },
    {
      ply: 2,
      color: "black",
      san: "e5",
      uci: "e7e5",
      fenBefore: "after-one b - - 0 1",
      fenAfter: "after-two w - - 0 2",
      annotations: [],
    },
  ];
  const positions = buildCoachPositionRecords({ moves, scope: "whole-game", currentFen: "" });
  const evaluations = new Map([
    ["start w - -", { source: "pc-cloud", depth: 30, whiteCp: 60, pvUci: ["d2d4"] }],
    ["after-one b - -", { source: "pc-live", depth: 18, whiteCp: 10, pvUci: ["c7c5"] }],
    ["after-two w - -", { source: "pc-cloud", depth: 31, whiteCp: 80, pvUci: ["g1f3"] }],
  ]);
  const result = buildPcCoachAnalysisResult({
    scope: "whole-game",
    currentFen: moves.at(-1).fenAfter,
    moves,
    positions,
    evaluations,
    playerColor: "white",
    cloudHits: 2,
    liveAnalyses: 1,
    liveDepth: 18,
  });
  assert.equal(result.moveAnalysis.length, 2);
  assert.deepEqual(result.analysisCoverage, {
    totalPositions: 3,
    uniquePositions: 3,
    cloudHits: 2,
    liveAnalyses: 1,
    failed: 0,
    liveDepth: 18,
    skippedPositions: 0,
    stoppedAtCloudBoundary: false,
    boundaryPly: null,
    complete: true,
  });
  assert.equal(result.moveAnalysis[0].before.source, "pc-cloud");
  assert.equal(result.moveAnalysis[0].after.source, "pc-live");
  assert.equal(result.moveAnalysis[0].moverLossCp, 50);
  assert.equal(result.criticalMoments[0].ply, 1);
});

test("PC analysis result exposes only the fully verified opening prefix and reports the skipped tail", () => {
  const moves = [
    {
      ply: 1,
      color: "white",
      san: "e4",
      uci: "e2e4",
      fenBefore: "start w - - 0 1",
      fenAfter: "after-one b - - 0 1",
      annotations: [],
    },
    {
      ply: 2,
      color: "black",
      san: "e5",
      uci: "e7e5",
      fenBefore: "after-one b - - 0 1",
      fenAfter: "after-two w - - 0 2",
      annotations: [],
    },
    {
      ply: 3,
      color: "white",
      san: "Nf3",
      uci: "g1f3",
      fenBefore: "after-two w - - 0 2",
      fenAfter: "after-three b - - 1 2",
      annotations: [],
    },
  ];
  const positions = buildCoachPositionRecords({ moves, scope: "whole-game" }).slice(0, 3);
  const evaluations = new Map([
    ["start w - -", { source: "pc-cloud", depth: 28, whiteCp: 20, pvUci: [] }],
    ["after-one b - -", { source: "pc-cloud", depth: 27, whiteCp: 12, pvUci: [] }],
    ["after-two w - -", { source: "pc-live", depth: 16, whiteCp: 8, pvUci: [] }],
  ]);
  const result = buildPcCoachAnalysisResult({
    scope: "whole-game",
    moves,
    positions,
    evaluations,
    playerColor: "white",
    cloudHits: 2,
    liveAnalyses: 1,
    liveDepth: 16,
    totalPositions: 4,
    skippedPositions: 1,
    stoppedAtCloudBoundary: true,
    boundaryPly: 2,
  });

  assert.deepEqual(
    result.moveAnalysis.map((move) => move.san),
    ["e4", "e5"],
  );
  assert.deepEqual(result.analysisCoverage, {
    totalPositions: 4,
    uniquePositions: 3,
    cloudHits: 2,
    liveAnalyses: 1,
    failed: 0,
    liveDepth: 16,
    skippedPositions: 1,
    stoppedAtCloudBoundary: true,
    boundaryPly: 2,
    complete: false,
  });
});
