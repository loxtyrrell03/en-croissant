import { INITIAL_FEN } from "chessops/fen";
import { expect, test } from "vitest";
import type { BestMoves } from "@/bindings";
import { buildEnginePlanReport, getPvMovePreviews, validatedPlanLines } from "../enginePlanExplorer";

function pv(rank: number, uciMoves: string[], depth = 17): BestMoves {
  return { multipv: rank, depth, uciMoves, sanMoves: [], nodes: 1, nps: 1,
    score: { value: { type: "cp", value: 15 }, wdl: null } };
}
test("only usable legal lines compete for a source rank and retain real ranks", () => {
  const valid = pv(3, ["e2e4", "e7e5"]);
  const invalid = pv(3, ["e2e5"], 30);
  const report = buildEnginePlanReport(INITIAL_FEN, [valid, valid, invalid, pv(7, ["d2d4", "d7d5", "d4d7"])],
    { requestedMultipv: 10, limitLabel: "Depth 17" });
  expect(report.totalPvs).toBe(2);
  expect(report.pvs.map(line => line.rank)).toEqual([3, 7]);
  expect(report.pvs[0].depth).toBe(17);
  expect(report.pvs[1].uciMoves).toEqual(["d2d4", "d7d5"]);
  expect(report.pvs[0].sanMoves).toEqual(["e4", "e5"]);
  expect(report.plans.flatMap(plan => plan.evidence).every(line => line.rank === 3 || line.rank === 7)).toBe(true);
});
test("duplicate root alternatives cannot manufacture recurrence, including castle encodings", () => {
  expect(validatedPlanLines(INITIAL_FEN, [pv(1, ["e2e4"]), pv(2, ["e2e4", "c7c5"]), pv(4, ["d2d4"])])
    .map(line => line.multipv)).toEqual([1, 4]);
  const fen = "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1";
  expect(validatedPlanLines(fen, [pv(1, ["e8h8"]), pv(2, ["e8g8"]), pv(3, ["e8a8"])])
    .map(line => line.multipv)).toEqual([1, 3]);
  expect(getPvMovePreviews(fen, ["e8h8"])[0]).toMatchObject({ from: "e8", to: "g8", san: "O-O" });
});
test("malformed ranks, explicit stale positions and illegal moves never supply evidence", () => {
  const lines = [pv(0, ["e2e4"]), pv(1.5, ["e2e4"]), pv(2, ["e7e5"]), pv(3, ["a1a8"]),
    { ...pv(4, ["e2e4"]), fen: "stale" }, { ...pv(5, ["e2e4"]), depth: NaN }];
  expect(validatedPlanLines(INITIAL_FEN, lines)).toEqual([]);
  expect(getPvMovePreviews(INITIAL_FEN, ["e2e4", "e7e5", "e4e6"])).toHaveLength(2);
  expect(validatedPlanLines("not a FEN", [pv(1, ["e2e4"])])).toEqual([]);
  expect(validatedPlanLines("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1", [pv(1, ["h8h7"])])).toEqual([]);
});
test("Chess960 castles retain legal UCI and the real king destination", () => {
  const fen = "4k3/8/8/8/8/8/8/4KR2 w F - 0 1";
  const lines = validatedPlanLines(fen, [pv(2, ["e1f1"]), pv(3, ["e1g1"])]);
  expect(lines).toHaveLength(1);
  expect(lines[0].uciMoves).toEqual(["e1f1"]);
  expect(getPvMovePreviews(fen, lines[0].uciMoves)[0]).toMatchObject({ san: "O-O", from: "e1", to: "g1" });
  expect(getPvMovePreviews(fen, lines[0].uciMoves)[0].fen.split(" ")[0]).toBe("4k3/8/8/8/8/8/8/5RK1");
});
