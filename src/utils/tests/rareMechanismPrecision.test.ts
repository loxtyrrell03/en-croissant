import { expect, test } from "vitest";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { makeSquare, parseUci } from "chessops/util";
import selection from "../../../benchmarks/tactical-relevance/rare-mechanism-precision-v1-selection.json";
import { proveQuietDoubleThreat, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs, isImmediateTacticalLesson } from "../tacticalMotifs/mistakeReviewAdapter";
import { liveTacticalMotifLabel } from "../tacticalMotifs/liveTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

const get = (id: string) => selection.cases.find(row => row.id === `lichess:${id}`)!;
for (const reflected of [false, true]) {
  const fenFor = (fen: string) => reflected ? reflectMixedForkFen(fen) : fen;
  const moveFor = (move: string) => reflected ? reflectMixedForkMove(move) : move;
  const classify = (fen: string, line: string[]) => classifyPositionTacticalMotifs({ fen: fenFor(fen), pvUci: line.map(moveFor) });

  for (const full of [false, true]) test(`exact-target interference subsumes its redundant double-threat heading; reflected=${reflected}, full=${full}`, () => {
    const row = get("eAHH6"), line = full ? row.bestLine : row.bestLine.slice(0, 1);
    const proof = proveQuietDoubleThreat(replayTacticalLine(fenFor(row.startFen), line.map(moveFor))[0]);
    expect(proof?.targets.map(makeSquare).sort()).toEqual((reflected ? ["e1", "h1"] : ["e8", "h8"]).sort());
    expect(proof?.directTargets.map(makeSquare)).toEqual([reflected ? "e1" : "e8"]);
    expect(proof?.branches).toHaveLength(16);
    expect(proof?.gain).toBe(320);
    const result = classify(row.startFen, line);
    expect(result.motifs[0]).toMatchObject({ id: "interference", value: 320, ply: 1, relevance: "primary" });
    expect(result.motifs.some(motif => motif.id === "doubleThreat" && motif.ply === 1)).toBe(false);
    expect(result.timeline?.some(motif => motif.id === "doubleThreat" && motif.ply === 1)).toBe(false);
  });

  test(`an extra independently connected fork victim retains the double-threat lesson; reflected=${reflected}`, () => {
    const fen = "1n2r2n/6RP/8/8/4k1K1/8/8/8 w - - 3 74";
    const proof = proveQuietDoubleThreat(replayTacticalLine(fenFor(fen), [moveFor("g7g8")])[0]);
    expect(proof?.targets.map(makeSquare).sort()).toEqual((reflected ? ["e1", "b1", "h1"] : ["e8", "b8", "h8"]).sort());
    expect(proof?.branches).toHaveLength(17);
    for (const line of [["g7g8"], ["g7g8", "e8e7", "g8h8"]]) {
      const result = classify(fen, line);
      expect(result.motifs).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "interference", ply: 1, value: 320 }),
        expect.objectContaining({ id: "doubleThreat", ply: 1, value: 320 }),
      ]));
    }
  });

  test(`removing the supporting pawn exposes a real capture of the interposer; reflected=${reflected}`, () => {
    const fen = get("eAHH6").startFen.replace("6RP", "6R1");
    const steps = replayTacticalLine(fenFor(fen), ["g7g8", "e8g8"].map(moveFor));
    expect(steps).toHaveLength(2);
    expect(steps[1].capture).toBe(500);
    expect(proveQuietDoubleThreat(steps[0])).toBeNull();
    expect(classify(fen, ["g7g8"]).motifs.some(motif => motif.id === "interference")).toBe(false);
  });

  test(`both forced king blocks retain the exact guard-winning interference primary; reflected=${reflected}`, () => {
    const row = get("fVyR4");
    for (const line of [row.bestLine.slice(0, 1), row.bestLine])
      expect(classify(row.startFen, line).motifs[0]).toMatchObject({ id: "interference", label: "Forced Interference", value: 600, ply: 1 });
    const noGuard = row.startFen.replace("R6P", "7P");
    expect(classify(noGuard, ["h6h3"]).motifs.some(motif => motif.id === "interference")).toBe(false);
  });

  test(`the forced mate keeps attraction and named geometry on their actual moves; reflected=${reflected}`, () => {
    const row = get("UpwI4"), result = classify(row.startFen, row.bestLine);
    expect(result.motifs[0]).toMatchObject({ id: "mateIn3", ply: 1, outcome: "mate" });
    expect(result.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "attraction", ply: 3 }),
      expect.objectContaining({ id: "anastasiaMate", ply: 5 }),
    ]));
    const contraryFen = row.startFen.replace("PP3PPP", "PP3P1P");
    const steps = replayTacticalLine(fenFor(contraryFen), row.bestLine.map(moveFor));
    expect(steps).toHaveLength(5);
    expect(steps[4].after.isCheckmate()).toBe(false);
    expect(steps[4].after.isLegal(parseUci(moveFor("h2g2"))!)).toBe(true);
    expect(classify(contraryFen, row.bestLine).timeline?.some(motif => motif.id === "anastasiaMate") ?? false).toBe(false);
  });

  test(`the sacrificed-rook continuation remains explicitly later rather than a root proof; reflected=${reflected}`, () => {
    const row = get("SzulO"), result = classify(row.startFen, row.bestLine);
    const laterFork = result.motifs.find(motif => motif.id === "fork" && motif.ply === 5);
    expect(laterFork).toBeDefined();
    expect(isImmediateTacticalLesson(laterFork)).toBe(false);
    expect(liveTacticalMotifLabel(laterFork!)).toBe("Later: Fork");
    const board = Chess.fromSetup(parseFen(fenFor(row.startFen)).unwrap()).unwrap();
    for (const uci of row.bestLine.map(moveFor)) { expect(board.isLegal(parseUci(uci)!)).toBe(true); board.play(parseUci(uci)!); }
    expect(board.board.get(parseUci(moveFor("g2f1n"))!.to)?.role).toBe("knight");
  });
}
