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

// Public development nominations, with the independent root judgments from
// checkingMatingPreparation / compoundSpecialMoveProof. Artificial alternative
// moves and scores below exercise card transport, not whole-game evaluation.
const cases = [
  {
    id: "KmpJY", fen: "r1bqk2r/pppnp1b1/3p2p1/6p1/2PPQ3/5N2/PP4PP/R3KB1R w KQkq - 0 12",
    pv: ["e4g6", "e8f8", "f3g5", "d7e5", "d4e5"], played: "a2a3", reply: "a7a6",
    motif: "forcingAttack", label: "Mating Attack Preparation", value: 420,
  },
  {
    id: "Vk1Ud", fen: "r3k2r/pR2pp1p/2n3p1/8/4P3/5BP1/P2K1P1P/7R b kq - 0 16",
    pv: ["e8c8", "d2e3", "c8b7"], played: "e8f8", reply: "a2a3",
    motif: "doubleThreat", label: "Castling Double Attack", value: 500,
  },
  {
    id: "UohLn", fen: "2Qr1k1r/3Pb1p1/5p2/2p1pq2/1PP4p/P2RR2P/3B2P1/7K b - - 0 37",
    pv: ["d8c8", "d7c8r", "f5c8"], played: "h8h7", reply: "h1h2",
    motif: "xRayAttack", label: "X-Ray Support", value: 500,
  },
];

function replay(fen, line) {
  const position = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  for (const uci of line) {
    const move = parseUci(uci);
    assert.ok(move && position.isLegal(move), `Illegal fixture move ${uci}`);
    position.play(move);
  }
  return position;
}

function assertRootContract(row, card) {
  const root = card.tacticalClassification.missedMotifs[0];
  assert.ok(root, `${row.id} must retain a root explanation`);
  assert.equal(root.id, row.motif);
  assert.equal(root.label, row.label);
  assert.equal(root.value, row.value);
  assert.equal(root.ply, 1);
  assert.equal(root.source, "missed");
  assert.ok(card.explanation.includes(row.label));
  assert.ok(card.bestTimeline.some(m => m.ply === 1 && m.id === row.motif));
  if (row.id === "KmpJY") {
    assert.match(root.evidence, /not a forced.mate claim/);
    assert.equal(card.tacticalClassification.missedMotifs.some(m => /mateIn\d+/.test(m.id)), false);
    assert.equal(card.tacticalClassification.missedMotifs.some(m => m.ply === 1 && ["fork", "intermezzo", "pin"].includes(m.id)), false);
  }
  if (row.id === "Vk1Ud") {
    assert.match(root.evidence, /not a discovered check/);
    assert.equal(card.tacticalClassification.missedMotifs.some(m => ["fork", "discoveredCheck", "discoveredAttack"].includes(m.id)), false);
    const payoff = card.bestTimeline.find(m => m.ply === 3);
    assert.equal(payoff?.label, "Castling Payoff");
    assert.notEqual(payoff?.relevance, "primary");
    assert.equal(payoff?.value, undefined);
  }
  if (row.id === "UohLn") {
    assert.match(root.evidence, /promotion value and recaptures/);
    assert.equal(card.bestTimeline.some(m => m.ply === 3 && m.id === "hangingPiece"), false);
  }
}

for (const row of cases) for (const reflected of [false, true]) test(
  `${row.id} survives generated review classification, export and reload: reflected=${reflected}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "en-shared-review-frontier-"));
    const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
    const flip = uci => reflected ? reflectMixedForkMove(uci) : uci;
    const pv = row.pv.map(flip), playedUci = flip(row.played), reply = flip(row.reply);
    replay(fen, pv);
    replay(fen, [playedUci, reply]);
    const position = replay(fen, []);
    const side = position.turn, number = position.fullmoves;
    const played = parseUci(playedUci), san = makeSan(position, played);
    position.play(played);
    const after = makeFen(position.toSetup());
    const options = {
      root, documentsRoot: join(root, "documents"), engineConfigPath: join(root, "engine.json"),
      fetchGames: async () => [], lookup: async requested => {
        assert.ok(requested === fen || requested === after);
        // White-relative controlled scores nominate one card. Tactics must
        // still be proved from legal board evidence by the generated service.
        return { depth: 18, pvs: requested === fen
          ? [{ cp: side === "white" ? 600 : -600, moves: pv.join(" ") }]
          : [{ cp: 0, moves: reply }] };
      },
    };
    let service;
    try {
      const result = side === "white" ? "1-0" : "0-1";
      const game = `[White "${side === "white" ? "Tester" : "Opponent"}"]\n[Black "${side === "black" ? "Tester" : "Opponent"}"]\n[Date "2026.10.02"]\n[Result "${result}"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n${number}${side === "white" ? "." : "..."} ${san} ${result}`;
      await writeFile(join(root, "config.json"), JSON.stringify({ accounts: { chesscom: "Tester" } }));
      await writeFile(join(root, "games.json"), JSON.stringify({ games: [{ source: "chesscom", pgn: game,
        end: 1790899200, url: `https://example.test/frontier-${row.id}` }] }));
      service = new SharedReviewService(options);
      await service.initialize(false);
      await service.run();
      assert.equal(service.snapshot().error, null);
      assert.equal(service.snapshot().cards.length, 1);
      const card = service.snapshot().cards[0];
      assertRootContract(row, card);
      const saved = (await service.deck()).positions[0].mistakeReview;
      assert.deepEqual(saved.missedMotifs, card.tacticalClassification.missedMotifs);
      // JSON persistence omits optional fields whose value is undefined.
      assert.deepEqual(saved.missedTimeline, JSON.parse(JSON.stringify(card.bestTimeline)));
      if (row.id === "Vk1Ud") {
        const savedPayoff = saved.missedTimeline.find(m => m.ply === 3);
        assert.equal(savedPayoff?.label, "Castling Payoff");
        assert.equal(savedPayoff?.value, undefined);
      }
      service.close();
      service = new SharedReviewService(options);
      await service.initialize(false);
      const loaded = service.snapshot().cards[0];
      assertRootContract(row, loaded);
      assert.equal(loaded.explanation, card.explanation);
      assert.deepEqual(loaded.tacticalClassification, JSON.parse(JSON.stringify(card.tacticalClassification)));
      assert.deepEqual(loaded.bestTimeline, JSON.parse(JSON.stringify(card.bestTimeline)));
    } finally {
      service?.close();
      const target = resolve(root);
      assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes("en-shared-review-frontier-"));
      await rm(target, { recursive: true, force: true });
    }
  },
);
