import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";

const args = process.argv.slice(2);
const output = args[args.indexOf("--report") + 1];
assert(
  args.includes("--online") && args.includes("--report") && output && !output.startsWith("--"),
  "Explicit --online --report <new path> required",
);
assert(!existsSync(output), "Preserve prior receipts");
const original = JSON.parse(
  readFileSync("benchmarks/tactical-relevance/cross-phase-tablebase-verified.json"),
);
const root = original.queries.find((row) => row.id === "root").fen;
const position = Chess.fromSetup(parseFen(root).unwrap()).unwrap();
let cases = [...position.allDests()].flatMap(([from, tos]) =>
  [...tos].map((to) => ({
    id: `EKWHC:${makeUci({ from, to })}`,
    fen: root,
    move: makeUci({ from, to }),
    judgement:
      "Kf4 is the only winning move. Evaluate all legal alternatives without assuming a drawn result cannot contain a defensive zugzwang.",
  })),
);
cases.push(
  {
    id: "IKbcw",
    fen: "8/8/8/3p4/1BpP4/K1n5/3k4/8 w - - 0 85",
    move: "a3b2",
    judgement:
      "Kb2 wins the pinned knight even with a pass; zugzwang should not replace the independently verified pin/material mechanism.",
  },
  {
    id: "drawing-one-wing",
    fen: "8/2k5/8/p7/P1K5/2P5/8/8 b - - 0 1",
    move: "c7c6",
    judgement:
      "Opposition with an additional locked wing. Extra pawns may change the outcome; verify rather than extrapolating KPK.",
  },
  {
    id: "drawing-two-wings",
    fen: "8/2k5/8/p6p/P1K4P/2P5/8/8 b - - 0 1",
    move: "c7c6",
    judgement:
      "Seven-piece opposition with two locked wings; an outcome-changing pass is required.",
  },
  {
    id: "rook-equality",
    fen: "7k/7r/8/8/8/8/R7/K7 w - - 0 1",
    move: "a2b2",
    judgement:
      "A reversible rook manoeuvre in an equal ending is not a tactic merely because a tablebase is available.",
  },
  {
    id: "queen-equality",
    fen: "7k/5q2/8/8/8/8/8/KQ6 w - - 0 1",
    move: "b1c1",
    judgement:
      "Queen-ending manoeuvre: distinguish exact same-outcome positions from a forcing tactical move.",
  },
  {
    id: "wrong-bishop-rook-pawn",
    fen: "k7/8/PK6/8/8/8/2B5/8 w - - 0 1",
    move: "c2d3",
    judgement:
      "Wrong-coloured bishop and rook pawn against the corner king stays drawn; pressure is not a winning zugzwang.",
  },
);
if (args.includes("--supplementary"))
  cases = [
    {
      id: "wrong-bishop-light-square",
      fen: "k7/8/PK6/8/8/8/3B4/8 w - - 0 1",
      move: "d2e3",
      judgement:
        "A genuinely wrong-coloured light-square bishop cannot evict the king from dark a8. The previous c2-bishop example was a mistaken initial judgement: its bishop was the correct colour and the tablebase correctly returned a win.",
    },
    {
      id: "promotion-choices",
      fen: "7k/P7/2K5/8/8/8/8/8 w - - 0 1",
      move: "c6c5",
      judgement:
        "A won KPK manoeuvre, not zugzwang. The pass response must enumerate all four promotion choices.",
    },
    {
      id: "EKWHC-black-reflection",
      fen: "8/8/1p6/6k1/2P4p/5K1P/8/8 b - - 2 42",
      move: "g5f5",
      judgement:
        "Colour/rank reflection of the confirmed Kf4 zugzwang. Independent queries must preserve the outcome comparison and colour attribution.",
    },
    {
      id: "EKWHC-better-defence",
      fen: "8/8/7p/2p1k2P/6K1/1P6/8/8 b - - 1 41",
      move: "e5e6",
      judgement:
        "Before ...Kf6 allows Kf4 zugzwang, inspect ...Ke6 as a possible outcome-preserving defence. Do not assume prevention merely because the immediate Kf4 certificate is absent.",
    },
  ];
// All four other development zugzwang-tagged roots with at most seven pieces
// in the existing public fixture, SHA-256 ordered with the fixed seed
// tablebase-relevance-2026-09-14:<id>. No held-out rows or classifier selection.
cases.push(
  {
    id: "wXMJJ",
    fen: "8/8/6k1/8/4p1K1/8/5P2/8 w - - 1 67",
    move: "g4f4",
    judgement:
      "Kf4 attacks the e4 pawn, which can also be captured with a pass. Inspect winning-pawn-ending preparation rather than presuming the source zugzwang tag explains the root.",
  },
  {
    id: "iKN3Q",
    fen: "8/6p1/3kP2p/5P2/5K2/8/8/8 w - - 1 50",
    move: "f4g4",
    judgement:
      "Kg4 heads toward h5 and the h6 pawn. That route may still win with a pass: the quiet infiltration alone is not proof of zugzwang.",
  },
  {
    id: "8zRYr",
    fen: "8/5p1p/8/5P1k/8/4PK2/8/8 b - - 0 56",
    move: "h5g5",
    judgement:
      "Kg5 constrains the f5 pawn; White retains e4 and Black retains h6. The source's later waiting move may matter more than this root. Compare outcomes before calling it zugzwang.",
  },
  {
    id: "6fO6p",
    fen: "8/8/5k2/5p1p/5K2/6PP/8/8 w - - 3 43",
    move: "h3h4",
    judgement:
      "h4 spends a pawn tempo and locks h5 while g5 can invade against the h5 pawn. A plausible immediate zugzwang, requiring exact pass and all-reply confirmation.",
  },
);
if (args.includes("--reciprocal"))
  cases = [
    {
      id: "EKWHC-reciprocal-draw",
      fen: "8/8/4k2p/2p4P/5K2/1P6/8/8 b - - 2 42",
      move: "e6f6",
      judgement:
        "Constructed reciprocal side of the real Kf4 position: ...Kf6 leaves White the move, holding a draw instead of losing with a pass. Unlike KPK, White may also have losing choices, so only the best defence is said to draw.",
    },
    {
      id: "EKWHC-reciprocal-alternative",
      fen: "8/8/4k2p/2p4P/5K2/1P6/8/8 b - - 2 42",
      move: "e6d6",
      judgement:
        "Inspect ...Kd6 as an alternative to the reciprocal drawing resource. Do not assume it loses just because it lacks that motif.",
    },
  ];
for (const row of cases) {
  const parsed = Chess.fromSetup(parseFen(row.fen).unwrap());
  assert(parsed.isOk, `Invalid position before network: ${row.id}`);
  const before = parsed.unwrap();
  assert(before.isLegal(parseUci(row.move)), `Invalid fixture before network: ${row.id}`);
}
const report = {
  scope:
    "Public real-game and constructed endgame development checks, not a general accuracy score. Judgements precede fresh tablebase results; moves are never selected from classifier output.",
  cases: [],
  queries: [],
};
writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
for (const row of cases) {
  const before = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap(),
    move = parseUci(row.move);
  assert(before.isLegal(move), row.id);
  const after = before.clone();
  after.play(move);
  const passed = after.clone();
  passed.turn = before.turn;
  const pair = {
    ...row,
    actualFen: makeFen(after.toSetup()),
    passedFen: makeFen(passed.toSetup()),
  };
  report.cases.push(pair);
  for (const [kind, fen] of [
    ["actual", pair.actualFen],
    ["pass", pair.passedFen],
  ]) {
    const url = `https://tablebase.lichess.org/standard?fen=${encodeURIComponent(fen)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, `Stop on HTTP ${response.status}: ${row.id}`);
    const result = await response.json();
    report.queries.push({
      id: row.id,
      kind,
      fen,
      url,
      checkedAt: new Date().toISOString(),
      result,
    });
    writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(`${row.id} ${kind}: ${result.category}`);
    await delay(500);
  }
}
