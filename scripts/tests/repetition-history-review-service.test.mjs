import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci, parseUci } from "chessops/util";
import { SharedReviewService } from "../generated/shared-review-service.js";
import { reflectMixedForkFen, reflectMixedForkMove } from "../../src/utils/tests/fixtures/mixedTargetFork.ts";
import { deepMateOrigin, deepMateAlternativeOrigin, deepMateRepeated, deepMateClean, deepMateLine } from "../../src/utils/tests/fixtures/historyAwareMate.ts";
import { continuationOrigin, continuationCycle, continuationClean, continuationApproach, continuationLine } from "../../src/utils/tests/fixtures/continuationHistory.ts";

// A public mating fixture with constructed legal histories. The histories end
// at identical full FENs, but only one permits a defensive repetition claim.
// Controlled scores nominate transport cards; they are not engine adjudication.
const origin = "r2q1r2/p4p1k/1p2pP1n/2p4R/3p1P2/P2P1N1P/1PP4K/6R1 w - - 0 30";
const histories = {
  repeated: ["g1g7", "h7h8", "g7g1", "h8h7", "g1g7", "h7h8", "g7g1", "h8h7"],
  clean: ["g1g2", "h7h8", "g2g3", "h8h7", "g3g4", "h7h8", "g4g1", "h8h7"],
};
const key = fen => fen.split(" ").slice(0, 4).join(" ");
const cases = [
  ...Object.entries(histories).map(([kind, history]) => ({
    kind: `immediate-${kind}`, origin, history, pv: ["g1g7", "h7h8", "h5h6"], played: "a3a4",
    expectedMate: kind === "clean" ? "mateIn2" : null,
  })),
  { kind: "deep-repeated", origin: deepMateOrigin, history: deepMateRepeated, pv: deepMateLine, played: "a2a3", expectedMate: "mateIn4" },
  { kind: "deep-clean", origin: deepMateOrigin, history: deepMateClean, pv: deepMateLine, played: "a2a3", expectedMate: "mateIn3" },
  { kind: "deep-safe-alternative", origin: deepMateAlternativeOrigin, history: deepMateRepeated, pv: deepMateLine, played: "a2a3", expectedMate: "mateIn3" },
  { kind: "conditional-repeated", origin: continuationOrigin, history: [...continuationCycle, ...continuationCycle, ...continuationApproach],
    pv: continuationLine, played: "h2h3", expectedFork: false },
  { kind: "conditional-clean", origin: continuationOrigin, history: [...continuationClean, ...continuationApproach],
    pv: continuationLine, played: "h2h3", expectedFork: true },
];

for (const reflected of [false, true]) for (const row of cases) test(
  `generated review preserves repetition-sensitive history: ${row.kind}, reflected=${reflected}`, async () => {
    const { kind, history } = row;
    const flip = move => reflected ? reflectMixedForkMove(move) : move;
    const start = reflected ? reflectMixedForkFen(row.origin) : row.origin;
    const moves = history.map(flip), pv = row.pv.map(flip);
    const board = Chess.fromSetup(parseFen(start).unwrap()).unwrap();
    const words = [];
    for (const uci of [...moves, flip(row.played)]) {
      const move = parseUci(uci);
      assert.ok(move && board.isLegal(move));
      words.push(`${board.fullmoves}${board.turn === "white" ? "." : "..."}`, makeSan(board, move));
      board.play(move);
    }
    const after = makeFen(board.toSetup());
    const rootBoard = Chess.fromSetup(parseFen(start).unwrap()).unwrap();
    for (const uci of moves) rootBoard.play(parseUci(uci));
    const fen = makeFen(rootBoard.toSetup());
    const root = await mkdtemp(join(tmpdir(), "en-repetition-review-"));
    const options = {
      root, documentsRoot: join(root, "documents"), engineConfigPath: join(root, "engine.json"),
      fetchGames: async () => [], lookup: async requested => {
        const position = Chess.fromSetup(parseFen(requested).unwrap()).unwrap();
        const first = [...position.allDests()].flatMap(([from, destinations]) =>
          [...destinations].map(to => makeUci({ from, to })))[0];
        assert.ok(first);
        return { depth: 18, pvs: [{
          cp: key(requested) === key(after) ? 0 : reflected ? -600 : 600,
          moves: key(requested) === key(fen) ? pv.join(" ") : first,
        }] };
      },
    };
    let service;
    try {
      const result = reflected ? "0-1" : "1-0";
      const pgn = `[White "${reflected ? "Opponent" : "Tester"}"]\n[Black "${reflected ? "Tester" : "Opponent"}"]\n[Date "2026.10.02"]\n[Result "${result}"]\n[SetUp "1"]\n[FEN "${start}"]\n\n${words.join(" ")} ${result}`;
      await writeFile(join(root, "config.json"), JSON.stringify({ accounts: { chesscom: "Tester" } }));
      await writeFile(join(root, "games.json"), JSON.stringify({ games: [{ source: "chesscom", pgn,
        end: 1790899200, url: `https://example.test/repetition-${kind}-${reflected}` }] }));
      service = new SharedReviewService(options);
      await service.initialize(false);
      await service.run();
      assert.equal(service.snapshot().error, null);
      assert.equal(service.snapshot().cards.length, 1);
      const card = service.snapshot().cards[0];
      assert.equal(card.fen, fen);
      assert.deepEqual(card.tacticalHistory, { fen: start, moves });
      const verify = metadata => {
        assert.equal(metadata.motifClassifierVersion, "site-55.adapter-176");
        const mates = metadata.missedMotifs.filter(m => /^mateIn\d+$/.test(m.id));
        if (row.expectedMate) assert.equal(mates[0]?.id, row.expectedMate);
        else {
          assert.deepEqual(mates, []);
          assert.equal(metadata.missedMotifs.some(m => m.outcome === "mate" || m.value === 10000), false);
          assert.equal(metadata.missedTimeline.some(m => m.outcome === "mate" || m.value === 10000), false);
        }
        if (kind === "deep-repeated") {
          assert.equal(metadata.missedMotifs.some(m => m.id === "mateIn3"), false);
          assert.equal(metadata.missedTimeline.some(m => m.id === "mateIn3"), false);
          assert.match(mates[0].evidence, /within 4 moves/);
        }
        if (kind === "immediate-repeated") assert.deepEqual(metadata.missedMotifs.filter(m => m.value > 0), []);
        if (typeof row.expectedFork === "boolean") {
          assert.equal(metadata.missedMotifs.some(m => m.id === "fork"), row.expectedFork);
          assert.equal(metadata.missedTimeline.some(m => m.label === "Fork Payoff"), row.expectedFork);
        }
      };
      verify(card.tacticalClassification);
      let exported = (await service.deck()).positions[0];
      assert.deepEqual(exported.mistakeReview.tacticalHistory, { fen: start, moves });
      verify(exported.mistakeReview);
      const before = JSON.parse(JSON.stringify(card.tacticalClassification));
      service.close();
      service = new SharedReviewService(options);
      await service.initialize(false);
      assert.deepEqual(service.snapshot().cards[0].tacticalClassification, before);
      exported = (await service.deck()).positions[0];
      assert.deepEqual(exported.mistakeReview.tacticalHistory, { fen: start, moves });
      verify(exported.mistakeReview);
    } finally {
      service?.close();
      const target = resolve(root);
      assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes("en-repetition-review-"));
      await rm(target, { recursive: true, force: true });
    }
  },
);
