import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  buildCodexCoachInvocation,
  buildChessBookSearchTerms,
  buildCriticalMoments,
  buildPhoneCoachPrompt,
  preserveConfirmedCodexAuthentication,
  probeCodexAuthentication,
  searchChessBookCorpus,
} from "../chess-coach-service.mjs";

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

test("Codex coach invocation is GPT-5.6 Sol, ephemeral, read-only, and tool-free", () => {
  const invocation = buildCodexCoachInvocation("Evidence payload");
  assert.deepEqual(invocation.args.slice(0, 4), [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
  ]);
  assert.ok(invocation.args.includes("gpt-5.6-sol"));
  assert.ok(invocation.args.includes("read-only"));
  assert.ok(invocation.args.includes('model_reasoning_effort="medium"'));
  assert.match(invocation.stdin, /Do not call tools/);
  assert.match(invocation.stdin, /Evidence payload/);
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
  assert.match(prompt, /\[Book 1\] Calculation/);
  assert.match(prompt, /Never invent an evaluation/);
  assert.ok(buildChessBookSearchTerms({ question: "What went wrong?", scope: "whole-game" }).includes("calculation"));
});
