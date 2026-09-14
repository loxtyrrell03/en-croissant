import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { Board } from "chessops/board";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { SquareSet } from "chessops/squareSet";
import { makeUci } from "chessops/util";
import {
  KPK_STATES,
  buildKpkBitbase,
  kpkIndex,
  kpkState,
  proveKpkZugzwang,
} from "../../src/utils/tacticalMotifs/kpkBitbase.ts";

// Offline unless --tablebase is explicitly supplied. No engine, owner data,
// app/service process or paid course is used. Node's native TS support suffices.
const args = process.argv.slice(2);
const reportPath = args[args.indexOf("--report") + 1];
assert.ok(
  args.includes("--report") && reportPath && !reportPath.startsWith("--"),
  "--report <new JSON path> required",
);
assert.equal(existsSync(reportPath), false, "Preserve prior reports");
const table = buildKpkBitbase();
const groups = new Map();
const counts = {
  valid: 0,
  winningZugzwang: 0,
  drawingZugzwang: 0,
  neither: 0,
  promotionReplies: 0,
};
const failures = [];
for (let index = 0; index < KPK_STATES; index++) {
  if (!table.valid[index]) continue;
  const state = kpkState(index);
  const board = Board.empty();
  board.set(state.pawn, { role: "pawn", color: "white" });
  board.set(state.ownKing, { role: "king", color: "white" });
  board.set(state.enemyKing, { role: "king", color: "black" });
  const position = Chess.fromSetup({
    board,
    turn: state.pawnTurn ? "white" : "black",
    castlingRights: SquareSet.empty(),
    halfmoves: 0,
    fullmoves: 1,
  }).unwrap();
  const passedIndex = kpkIndex({ ...state, pawnTurn: !state.pawnTurn });
  const win = Boolean(table.ranks[index]);
  const passWin = Boolean(table.ranks[passedIndex]);
  const eligible = Boolean(table.valid[passedIndex]) && !position.isCheck() && !position.isEnd();
  const expected = !eligible
    ? null
    : state.pawnTurn && !win && passWin
      ? "draw"
      : !state.pawnTurn && win && !passWin
        ? "win"
        : null;
  const proof = proveKpkZugzwang(position);
  counts.valid++;
  counts[
    expected === "win" ? "winningZugzwang" : expected === "draw" ? "drawingZugzwang" : "neither"
  ]++;
  if ((proof?.outcome ?? null) !== expected)
    failures.push({ index, fen: makeFen(position.toSetup()), expected, proof });
  if (proof?.replies.some((move) => move.promotion)) counts.promotionReplies++;
  // Selection uses position/side-to-move outcomes, never classifier labels.
  const kind = expected ?? (win && passWin ? "both-win" : !win && !passWin ? "both-draw" : "other");
  if (!eligible || kind === "other") continue;
  const key = kind === "draw" ? `draw-rank-${(state.pawn >> 3) + 1}` : kind;
  if (!groups.has(key)) groups.set(key, []);
  const fen = makeFen(position.toSetup());
  const hash = createHash("sha256")
    .update(`drawing-zugzwang-audit-2026-09-14:${fen}`)
    .digest("hex");
  const group = groups.get(key);
  group.push({ id: `kpk:${index}`, fen, state, expected, win, passWin, proof, hash });
  group.sort((a, b) => a.hash.localeCompare(b.hash));
  group.length = Math.min(group.length, kind === "draw" ? 2 : 3);
}
const selected = [...groups.values()].flat();
for (const row of selected) {
  const position = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
  const beneficiary = position.turn === "white" ? "black" : "white";
  const king = position.board.kingOf(beneficiary);
  // A legal quiet predecessor gives live/review tests the move that creates
  // the reached relation; the pass board itself is never treated as a move.
  for (let from = 0; from < 64; from++) {
    if (position.board.get(from)) continue;
    const setup = position.toSetup();
    setup.turn = beneficiary;
    setup.board.take(king);
    setup.board.set(from, { color: beneficiary, role: "king" });
    const before = Chess.fromSetup(setup);
    if (before.isOk && before.unwrap().isLegal({ from, to: king })) {
      row.beforeFen = makeFen(setup);
      row.moveUci = makeUci({ from, to: king });
      break;
    }
  }
}
const report = {
  scope:
    "Complete canonical zero-clock KPK proof-versus-retrograde outcome relation, plus structurally selected independent Syzygy checks. Internal enumeration is not independent tablebase validation and is not general chess accuracy.",
  selection:
    "SHA-256 order with fixed seed; two drawing cases per available pawn rank, three each of winning zugzwang/both-win/both-draw controls. Chosen before classifier output.",
  counts,
  failures,
  selected,
  tablebase: [],
};
writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ counts, failures: failures.length, selected: selected.length }));
assert.deepEqual(failures, []);
if (args.includes("--tablebase")) {
  for (const row of selected) {
    for (const pass of [false, true]) {
      const fields = row.fen.split(" ");
      if (pass) fields[1] = fields[1] === "w" ? "b" : "w";
      const fen = fields.join(" ");
      const url = `https://tablebase.lichess.ovh/standard?fen=${encodeURIComponent(fen)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      assert.equal(
        response.status,
        200,
        `Stop on HTTP ${response.status}; do not hammer or silently skip failed probes`,
      );
      const result = await response.json();
      const win = pass ? row.passWin : row.win;
      const expected = !win ? "draw" : fields[1] === "w" ? "win" : "loss";
      report.tablebase.push({
        id: row.id,
        pass,
        fen,
        url,
        checkedAt: new Date().toISOString(),
        expected,
        result,
      });
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
      assert.equal(result.category, expected, `${row.id}, pass=${pass}`);
      if (!pass && row.proof) {
        assert.deepEqual(
          result.moves.map((m) => m.uci).sort(),
          row.proof.replies.map(makeUci).sort(),
        );
        assert.ok(
          result.moves.every((m) => m.category === (row.expected === "draw" ? "draw" : "win")),
        );
      }
      console.log(`${row.id} ${pass ? "pass" : "actual"}: ${result.category}`);
      await delay(500);
    }
  }
}
