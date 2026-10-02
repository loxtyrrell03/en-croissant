import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { SharedReviewService } from "../generated/shared-review-service.js";
import { reflectMixedForkFen, reflectMixedForkMove } from "../../src/utils/tests/fixtures/mixedTargetFork.ts";

for (const reflected of [false, true]) test(`shared fork stays neutral through generated review, export and reload: reflected=${reflected}`, async () => {
  const root = await mkdtemp(join(tmpdir(), "en-shared-review-retained-fork-"));
  const original = "1k1q3r/pppp4/3N3N/8/2B5/8/5PPP/6K1 w - - 0 1";
  const fen = reflected ? reflectMixedForkFen(original) : original;
  const flip = move => reflected ? reflectMixedForkMove(move) : move;
  const position = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const played = parseUci(flip("h6f7"));
  assert.ok(position.isLegal(played));
  const san = makeSan(position, played);
  position.play(played);
  const after = makeFen(position.toSetup());
  const options = {
    root, documentsRoot: join(root, "documents"), engineConfigPath: join(root, "engine.json"),
    fetchGames: async () => [], lookup: async requested => {
      assert.ok(requested === fen || requested === after);
      // Controlled scores nominate a card and test transport, not the moves'
      // true evaluation. The two ordinary forks are independently proved.
      return { depth: 18, pvs: requested === fen
        ? [{ cp: reflected ? -300 : 300, moves: ["d6f7", "d8e7", "f7h8"].map(flip).join(" ") }]
        : [{ cp: 0, moves: flip("d8e7") }] };
    },
  };
  let service;
  try {
    const result = reflected ? "0-1" : "1-0";
    const game = `[White "${reflected ? "Opponent" : "Tester"}"]\n[Black "${reflected ? "Tester" : "Opponent"}"]\n[Date "2026.10.02"]\n[Result "${result}"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n${reflected ? "1..." : "1."} ${san} ${result}`;
    await writeFile(join(root, "config.json"), JSON.stringify({ accounts: { chesscom: "Tester" } }));
    await writeFile(join(root, "games.json"), JSON.stringify({ games: [{ source: "chesscom", pgn: game,
      end: 1790899200, url: "https://example.test/retained-fork" }] }));
    service = new SharedReviewService(options);
    await service.initialize(false);
    await service.run();
    assert.equal(service.snapshot().error, null);
    assert.equal(service.snapshot().cards.length, 1);
    const card = service.snapshot().cards[0];
    const fork = card.tacticalClassification.missedMotifs.find(m => m.id === "fork");
    assert.equal(fork.source, "available");
    assert.equal(fork.comparison, "persists");
    assert.match(card.explanation, /^Both moves create this fork:/);
    assert.match(card.explanation, /does not establish that the moves are equally good/);
    assert.doesNotMatch(card.explanation, /you missed|also missed/i);
    assert.ok(card.bestTimeline.some(m => m.id === "fork" && m.source === "available" && m.comparison === "persists"));
    const saved = (await service.deck()).positions[0].mistakeReview;
    assert.deepEqual(saved.missedMotifs, card.tacticalClassification.missedMotifs);
    assert.ok(saved.missedTimeline.some(m => m.id === "fork" && m.source === "available"));
    service.close();
    service = new SharedReviewService(options);
    await service.initialize(false);
    assert.equal(service.snapshot().cards[0].explanation, card.explanation);
    assert.deepEqual(service.snapshot().cards[0].tacticalClassification, JSON.parse(JSON.stringify(card.tacticalClassification)));
  } finally {
    service?.close();
    const target = resolve(root);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes("en-shared-review-retained-fork-"));
    await rm(target, { recursive: true, force: true });
  }
});
