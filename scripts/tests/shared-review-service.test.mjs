import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { SharedReviewService, engineLine } from "../generated/shared-review-service.js";

const pgn = '[White "Tester"]\n[Black "Opponent"]\n[Date "2026.09.04"]\n\n1. f3 e5 2. g4 Qh4# 0-1';

test("built review service publishes and reloads the constructive fork-preparation cause", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-acceptance-"));
  const evidence = JSON.parse(
    await readFile(
      new URL(
        "../../benchmarks/tactical-relevance/capture-acceptance-stockfish-18.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const before = evidence.searches.find((s) => s.kind === "choice" && s.move === "f1f4");
  const after = evidence.searches.find((s) => s.kind === "reached" && s.move === "f1f2");
  assert.ok(before && after);
  const options = {
    root,
    documentsRoot: join(root, "documents"),
    engineConfigPath: join(root, "engine.json"),
    lookup: async (fen) => {
      const row = [before, after].find((r) => r.fen === fen);
      assert.ok(row, `Unexpected position: ${fen}`);
      const line = row.lines[0];
      return {
        depth: line.depth,
        pvs: [{ cp: line.cp * (fen.split(" ")[1] === "b" ? -1 : 1), moves: line.pvUci.join(" ") }],
      };
    },
    fetchGames: async () => [],
  };
  let service;
  try {
    await writeFile(
      join(root, "config.json"),
      JSON.stringify({ accounts: { chesscom: "Tester" } }),
    );
    const game = `[White "Tester"]\n[Black "Opponent"]\n[Date "2026.09.09"]\n[SetUp "1"]\n[FEN "${before.fen}"]\n[Result "0-1"]\n\n1. Rf2 Rxh4+ 0-1`;
    await writeFile(
      join(root, "games.json"),
      JSON.stringify({
        games: [
          {
            source: "chesscom",
            pgn: game,
            end: 1788912000,
            url: "https://example.test/game/capture-acceptance",
          },
        ],
      }),
    );
    service = new SharedReviewService(options);
    await service.initialize(false);
    await service.run();
    assert.equal(service.snapshot().error, null);
    assert.equal(service.snapshot().cards.length, 1);
    const deck = await service.deck();
    const card = service.snapshot().cards[0];
    const preparation = card.refutationTimeline.find((m) => m.id === "forkPreparation");
    assert.equal(preparation.comparison, "prevented");
    assert.match(preparation.comparisonEvidence, /After Rf4, gxh4/);
    assert.match(card.explanation, /After Rf4, gxh4/);
    // The shared deck publishes this text as reason; desktop motif metadata
    // is populated lazily on reveal rather than stored by this producer.
    assert.equal(deck.positions[0].reason, card.explanation);
    service.close();
    service = new SharedReviewService(options);
    await service.initialize(false);
    assert.deepEqual(service.snapshot().cards[0].refutationTimeline, card.refutationTimeline);
    assert.equal((await service.deck()).positions[0].reason, card.explanation);
  } finally {
    service?.close();
    const target = resolve(root);
    assert.ok(
      target.startsWith(resolve(tmpdir()) + sep) && target.includes("en-shared-review-acceptance-"),
    );
    await rm(target, { recursive: true, force: true });
  }
});

test("archived games become shared cards without rewriting analysis; progress survives retries and restarts", async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-"));
  let service;
  let lookups = 0;
  const options = {
    root,
    documentsRoot: join(root, "documents"),
    engineConfigPath: join(root, "engine.json"),
    lookup: async (fen) => {
      lookups++;
      const black = fen.split(" ")[1] === "b";
      return {
        depth: 18,
        pvs: [
          {
            cp: black ? -400 : 50,
            moves: black ? (fen.includes("4p3") ? "d8h4" : "e7e5") : "e2e4",
          },
        ],
      };
    },
    fetchGames: async () => [],
  };
  try {
    await writeFile(
      join(root, "config.json"),
      "\uFEFF" + JSON.stringify({ accounts: { chesscom: "Tester" } }),
    );
    const original = JSON.stringify({
      entries: [{ key: "existing-deep-analysis", stats: { accuracy: 87 } }],
    });
    await writeFile(join(root, "entries.json"), original);
    await writeFile(
      join(root, "games.json"),
      JSON.stringify({
        games: [{ source: "chesscom", pgn, end: 1788550000, url: "https://example.test/game/1" }],
      }),
    );
    service = new SharedReviewService(options);
    await service.initialize(false);
    await service.run();
    const ready = service.snapshot();
    assert.equal(ready.error, null);
    assert.equal(ready.savedAnalysisSummaries, 1);
    assert.equal(ready.reviewedGames, 1);
    assert.equal(ready.cards.length, 1);
    assert.equal(await readFile(join(root, "entries.json"), "utf8"), original);
    const id = ready.cards[0].id;
    const staleDeck = await service.deck();
    await service.grade(id, "good", 0);
    await service.grade(id, "good", 0);
    assert.equal(service.snapshot().cards[0].reviews, 1);
    await service.saveDeck(staleDeck);
    assert.equal(service.snapshot().cards[0].reviews, 1);
    const count = lookups;
    await service.run();
    assert.equal(lookups, count);
    assert.equal(service.snapshot().cards.length, 1);
    service.close();
    service = new SharedReviewService(options);
    await service.initialize(false);
    assert.equal(service.snapshot().cards[0].reviews, 1);
    const desktop = await service.deck();
    desktop.positions[0].card.last_review = new Date(Date.now() + 1000).toISOString();
    desktop.positions[0].card.due = new Date(Date.now() + 86400000).toISOString();
    desktop.positions[0].card.reps = 2;
    desktop.positions[0].comment = "My saved note";
    await service.saveDeck(desktop);
    assert.equal(service.snapshot().cards[0].reviews, 2);
    assert.equal((await service.deck()).positions[0].comment, "My saved note");
    await service.grade(id, "hide", 2);
    assert.ok(new Date((await service.deck()).positions[0].card.due).getFullYear() === 9999);
    assert.equal(service.snapshot().cards[0].hidden, true);
  } finally {
    service?.close();
    const target = resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes("en-shared-review-"));
    await rm(target, { recursive: true, force: true });
  }
});

test("PV conversion verifies moves against their actual position", () => {
  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const line = engineLine(fen, 16, { type: "cp", value: 30 }, ["e2e4", "e7e5", "e2e3"]);
  assert.deepEqual(line.uciMoves, ["e2e4", "e7e5"]);
  assert.deepEqual(line.sanMoves, ["e4", "e5"]);
});
