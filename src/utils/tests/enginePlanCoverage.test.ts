import { makeUci } from "chessops";
import { parseSan } from "chessops/san";
import { expect, test } from "vitest";
import type { BestMoves } from "@/bindings";
import { positionFromFen } from "../chessops";
import { buildEnginePlanChoices, buildEnginePlanReport, enginePlanDisplayForHorizon,
  enginePlanSourceEvaluation, selectContinuationIdeas } from "../enginePlanExplorer";

const fen = "3r1rk1/1pp1bpp1/p1b1pn1p/P7/1q1PP3/2N2NP1/1P2QPBP/R3R1K1 b - - 0 16";
// Retained Stockfish fixture from Novelty; replayed independently with chessops.
const samples = [
  [-37, "Rfe8 Red1 Nd7 h4 Nb8 Qe3 Nd7 Bf1 Bf8 Qe2 Nb8 Qc2"],
  [-53, "Nd7 d5 Bb5 Nxb5 axb5 dxe6 fxe6 Red1 Nc5 Ne5 Kh7 a6"],
  [-55, "g6 Red1 h5 Qc2 Kg7 h3 b5 axb6 Qxb6 Ne5 Ba8 Ra4"],
  [-56, "h5 Red1 g6 Qc2 Kg7 h3 b5 Ne1 Ba8 e5 Nd5 Bxd5"],
  [-68, "Bb5 Nxb5 axb5 Red1 Nd7 e5 c6 Ne1 Nb8 Nc2 Qb3 h4"],
] as const;
function line(rank: number, sans: string, score = 0, position = fen): BestMoves {
  const [board] = positionFromFen(position);
  if (!board) throw new Error("Invalid fixture position");
  const whiteCp = score * (board.turn === "white" ? 1 : -1);
  const uciMoves = sans.split(" ").map(san => {
    const move = parseSan(board, san);
    if (!move) throw new Error(`Illegal fixture SAN: ${san}`);
    const uci = makeUci(move); board.play(move); return uci;
  });
  return { multipv: rank, depth: 20, uciMoves, sanMoves: [], nodes: 1, nps: 1,
    score: { value: { type: "cp", value: whiteCp }, wdl: null } };
}
const report = (lines = samples.map(([score, sans], i) => line(i + 1, sans, score)), position = fen) =>
  buildEnginePlanReport(position, lines, { requestedMultipv: lines.length, limitLabel: "Depth 20" });
const edges = (plan: ReturnType<typeof report>["displayPlans"][number]) => plan.routeSquares?.join("-");

test("recurring rook/queen ideas and a competitive alternative's pawn break remain available", () => {
  const result = report(), white = result.displayPlans.filter(plan => plan.color === "white");
  expect(white.length).toBeGreaterThanOrEqual(3);
  expect(white.find(plan => edges(plan) === "e1-d1")).toMatchObject({ supportCount: 5, context: "opponentResponse" });
  expect(white.find(plan => edges(plan) === "e2-c2")).toMatchObject({ supportCount: 2 });
  const pawn = white.find(plan => plan.label === "Pawn break d5");
  expect(pawn?.evidence.map(evidence => evidence.rank)).toEqual([2]);
  expect(pawn?.routeSquares).toEqual(["d4", "d5"]);
  const losing = samples.map(([score, sans], i) => line(i + 1, sans, i === 0 ? score : -200));
  expect(report(losing).displayPlans.some(plan => plan.label === "Pawn break d5")).toBe(false);
});
test("later transfers neither erase a repeated quiet move nor extend its arrow", () => {
  const result = report([line(1, "g6 Red1 h5 Rd2", -40), line(2, "h5 Red1 g6 Rd2", -45)]);
  expect(result.displayPlans.find(plan => edges(plan) === "e1-d1")).toMatchObject({ supportCount: 2 });
  expect(result.displayPlans.some(plan => plan.color === "white" && plan.routeSquares?.includes("d2"))).toBe(false);
});
test("different rooks reaching one destination do not manufacture route recurrence", () => {
  const position = "4k3/7p/8/8/8/8/6K1/R6R b - - 0 20";
  const result = report([line(1, "h6 Rad1", 0, position), line(2, "h5 Rhd1", 0, position)], position);
  expect(result.displayPlans.filter(plan => plan.color === "white")).toEqual([]);
});
test("horizon filtering uses each occurrence before grouping support or filling display slots", () => {
  const result = report(), choices = buildEnginePlanChoices(fen, result.pvs.slice(0, 2));
  const idea = choices[1].ideas.find(idea => idea.label === "Pawn break d5")!;
  expect(idea).toBeDefined();
  choices[0].ideas = [{ ...idea, firstPly: 3, achievedPly: 3 }];
  choices[1].ideas = [{ ...idea, firstPly: 7, achievedPly: 7 }];
  const selected = selectContinuationIdeas(choices, "long");
  expect(selected).toHaveLength(1);
  expect(selected[0].supports.map(support => support.choice.pv.rank)).toEqual([2]);
  expect(selected[0].idea.achievedPly).toBe(7);
  expect(enginePlanDisplayForHorizon(result, "long").every(plan => plan.context !== "rootChoice")).toBe(true);
  expect(result.displayPlans.some(plan => plan.context === "rootChoice")).toBe(true);
});
test("pawn-break arrows snapshot every preparatory push before later moves", () => {
  const position = "4k3/6pp/3p4/8/8/8/4P3/R3K3 w - - 0 1";
  const result = report([line(1, "e3 h6 e4 h5 e5 h4 e6", 0, position)], position);
  expect(result.displayPlans.find(plan => plan.label === "Pawn break e5")?.routeSquares).toEqual(["e2", "e3", "e4", "e5"]);
  const captured = "4k3/7p/4p3/8/3n4/8/2P5/R3K3 w - - 0 1";
  const withCapture = report([line(1, "c3 h6 cxd4 h5 d5", 0, captured)], captured);
  expect(withCapture.plans.find(plan => plan.signature === "pawn_break:white:d5")?.routeSquares).toEqual(["c2", "c3", "d4", "d5"]);
});
test("all root move kinds retain their own exact score and legal arrows", () => {
  const position = "4k3/2P4p/8/8/8/8/6K1/R6R w - - 0 20";
  const sans = ["c8=Q+", "c8=N", "Ra2", "Rxh7", "Kf2"];
  const result = report(sans.map((san, i) => line(i + 1, san, 100 - i, position)), position);
  expect(result.displayPlans.filter(plan => plan.context === "rootChoice").map(plan => plan.label)).toEqual(sans);
  expect(result.displayPlans.filter(plan => plan.context === "rootChoice").map(plan => enginePlanSourceEvaluation(plan)?.score.value))
    .toEqual([100, 99, 98, 97, 96]);
});
test("different preparation routes to one pawn break do not share arrow evidence", () => {
  const position = "4k3/7p/3p4/8/8/8/4P3/R3K3 b - - 0 1";
  const result = report([line(1, "h6 e3 h5 e4 h4 e5", 0, position), line(2, "h5 e4 h4 e5", 0, position)], position);
  const breaks = result.displayPlans.filter(plan => plan.label === "Pawn break e5");
  expect(breaks).toHaveLength(1);
  expect(breaks[0].supportCount).toBe(1);
  expect(breaks[0].routeSquares).toEqual(["e2", "e3", "e4", "e5"]);
});
test("conditional scores identify supporting PV evidence without changing independent strength values", () => {
  const rook = report().displayPlans.find(plan => edges(plan) === "e1-d1")!;
  expect(enginePlanSourceEvaluation(rook)).toEqual({ score: { type: "cp", value: 37 }, rank: 1, depth: 20, conditional: true });
  expect(rook.weightedEvalCp).toBeNull(); expect(rook.bestCpLoss).toBeNull(); expect(rook.approval).toBe("Unclear");
});
