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

// Public development puzzles. Scores nominate a transport card only;
// legal move-order proof and exact prior material debt belong to the classifier.
const cases = [
  { id: "Ltbye", origin: "r1r3k1/4pp1p/p1p1b1pb/qp1BP3/3P4/2P2N1P/P1Q2PPB/2R1K2R b K - 0 19",
    reached: "r1r3k1/4pp1p/p1p1b1p1/qp1BP3/3P4/2P2N1P/P1Q2PPB/2b1K2R w K - 0 20",
    prior: "h6c1", line: ["d5e6", "f7e6", "c2c1"], played: "c2c1", punishment: "e6d5", local: 230, net: 0 },
  { id: "Qq0JW", origin: "r4rk1/pp3pp1/2nb1n1p/3p4/3P2q1/2NBBQ2/PP3PPP/R3R1K1 w - - 2 15",
    reached: "r4rk1/pp3pp1/2nb1n1p/3N4/3P2q1/3BBQ2/PP3PPP/R3R1K1 b - - 0 15",
    prior: "c3d5", line: ["g4f3", "g2f3", "f6d5"], played: "f6d5", punishment: "f3g4", local: 320, net: 220 },
  { id: "EpYOT", origin: "r1b2r2/pp4bk/1q1Qp2p/4ppp1/8/2P2NP1/PP2PPBP/1R1R2K1 w - - 2 19",
    reached: "r1b2r2/pp4bk/1q1Qp2p/4Npp1/8/2P3P1/PP2PPBP/1R1R2K1 b - - 0 19",
    prior: "f3e5", line: ["b6d6", "d1d6", "g7e5"], played: "g7e5", punishment: "d6e5", local: 320, net: 220,
    motif: "capturingDefender", label: "Removing the Defender" },
];
const key = fen => fen.split(" ").slice(0, 4).join(" ");

for (const row of cases) for (const reflected of [false, true]) for (const withHistory of [false, true]) for (const short of [false, true]) test(
  `${row.id} capture-order lesson survives review export/reload: reflected=${reflected}, history=${withHistory}, short=${short}`,
  async () => {
    const flip = move => reflected ? reflectMixedForkMove(move) : move;
    const start = reflected ? reflectMixedForkFen(withHistory ? row.origin : row.reached) : withHistory ? row.origin : row.reached;
    const history = withHistory ? [flip(row.prior)] : [];
    const pv = (short ? row.line.slice(0, 1) : row.line).map(flip);
    const played = flip(row.played), punishment = flip(row.punishment);
    const board = Chess.fromSetup(parseFen(start).unwrap()).unwrap();
    const words = [];
    for (const uci of [...history, played]) {
      const move = parseUci(uci);
      assert.ok(move && board.isLegal(move), `Illegal fixture move ${uci}`);
      words.push(`${board.fullmoves}${board.turn === "white" ? "." : "..."}`, makeSan(board, move));
      board.play(move);
    }
    const after = makeFen(board.toSetup());
    assert.ok(board.isLegal(parseUci(punishment)));
    const rootBoard = Chess.fromSetup(parseFen(start).unwrap()).unwrap();
    for (const uci of history) rootBoard.play(parseUci(uci));
    const fen = makeFen(rootBoard.toSetup());
    const side = rootBoard.turn;
    const target = await mkdtemp(join(tmpdir(), "en-quiet-intermediate-review-"));
    const options = {
      root: target, documentsRoot: join(target, "documents"), engineConfigPath: join(target, "engine.json"),
      fetchGames: async () => [], lookup: async requested => {
        const position = Chess.fromSetup(parseFen(requested).unwrap()).unwrap();
        const first = [...position.allDests()].flatMap(([from, destinations]) =>
          [...destinations].map(to => makeUci({ from, to })))[0];
        assert.ok(first);
        return { depth: 18, pvs: [{
          cp: key(requested) === key(after) ? 0 : side === "black" ? -600 : 600,
          moves: key(requested) === key(fen) ? pv.join(" ") : key(requested) === key(after) ? punishment : first,
        }] };
      },
    };
    const verify = metadata => {
      assert.equal(metadata.motifClassifierVersion, "site-55.adapter-175");
      const motif = metadata.missedMotifs.find(m => m.id === (row.motif ?? "intermezzo") && m.ply === 1);
      assert.ok(motif, "The necessary first capture must retain its causal lesson");
      assert.equal(motif.label, row.label ?? "Intermediate Capture");
      assert.equal(motif.value, withHistory ? row.net : row.local);
      assert.equal(motif.moveUci, flip(row.line[0]));
      assert.doesNotMatch(motif.evidence, /checking exchange/i);
      assert.equal(metadata.missedMotifs.some(m => m.id === "pin"), false);
      const allowedCapture = metadata.allowedMotifs.find(m => m.id === "hangingPiece" && m.moveUci === punishment);
      if (row.id === "Ltbye") assert.equal(allowedCapture, undefined,
        "The already-proved reversed recovery is not a separate main loss");
      else if (row.id === "Qq0JW") {
        // Qq0JW has a stronger independently quantified queen loss than the
        // quiet-order proof's570 lower bound. Do not erase it to prefer the
        // newly admitted label; preserve the missed ordering lesson alongside.
        assert.equal(allowedCapture?.value, 890);
        assert.equal(allowedCapture?.relevance, "primary");
      }
      if (row.id === "EpYOT") {
        assert.equal(metadata.missedMotifs[0]?.id, "capturingDefender");
        assert.equal(metadata.missedMotifs.some(m => m.id === "skewer"), false,
          "Losing rear-pawn captures cannot borrow the queen exchange to become skewers");
      }
      assert.equal(metadata.missedTimeline.some(m => m.ply > 1 && m.id === "hangingPiece" && m.value > 0), false,
        "The deferred bishop must not become an extra free-material gain");
      assert.equal(metadata.missedTimeline.some(m => m.id === (row.motif ?? "intermezzo") && m.ply === 1), true);
    };
    let service;
    try {
      const result = side === "black" ? "0-1" : "1-0";
      const pgn = `[White "${side === "black" ? "Opponent" : "Tester"}"]\n[Black "${side === "black" ? "Tester" : "Opponent"}"]\n[Date "2026.10.02"]\n[Result "${result}"]\n[SetUp "1"]\n[FEN "${start}"]\n\n${words.join(" ")} ${result}`;
      await writeFile(join(target, "config.json"), JSON.stringify({ accounts: { chesscom: "Tester" } }));
      await writeFile(join(target, "games.json"), JSON.stringify({ games: [{ source: "chesscom", pgn,
        end: 1790899200, url: `https://example.test/quiet-intermediate-${row.id}-${reflected}-${withHistory}-${short}` }] }));
      service = new SharedReviewService(options);
      await service.initialize(false);
      await service.run();
      assert.equal(service.snapshot().error, null);
      assert.equal(service.snapshot().cards.length, 1);
      const card = service.snapshot().cards[0];
      assert.equal(card.fen, fen);
      assert.ok(card.explanation.includes(row.label ?? "Intermediate Capture"), "The card must retain the causal capture lesson");
      if (withHistory) assert.deepEqual(card.tacticalHistory, { fen: start, moves: history });
      verify(card.tacticalClassification);
      const exported = (await service.deck()).positions[0].mistakeReview;
      if (withHistory) assert.deepEqual(exported.tacticalHistory, { fen: start, moves: history });
      verify(exported);
      const saved = JSON.parse(JSON.stringify(card.tacticalClassification));
      service.close();
      service = new SharedReviewService(options);
      await service.initialize(false);
      assert.deepEqual(service.snapshot().cards[0].tacticalClassification, saved);
      verify(service.snapshot().cards[0].tacticalClassification);
      verify((await service.deck()).positions[0].mistakeReview);
    } finally {
      service?.close();
      const resolved = resolve(target);
      assert.ok(resolved.startsWith(resolve(tmpdir()) + sep) && resolved.includes("en-quiet-intermediate-review-"));
      await rm(resolved, { recursive: true, force: true });
    }
  },
);
