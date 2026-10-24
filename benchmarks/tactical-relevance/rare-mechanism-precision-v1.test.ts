import { afterAll, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import selection from "./rare-mechanism-precision-v1-selection.json";
import { classifyPositionTacticalMotifs, MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION } from "../../src/utils/tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "../../src/utils/tests/fixtures/mixedTargetFork";

const observations: unknown[] = [];
const ref = process.env.RARE_MECHANISM_PRECISION_REF ?? selection.baselineCommit;
const hash = (value: string) => createHash("sha256").update(value.replace(/\r\n/g, "\n")).digest("hex");
const hashes = () => Object.fromEntries(["causalTactics.ts", "mistakeReviewAdapter.ts", "continuationHistory.ts", "gameHistory.ts", "quietClearancePreparation.ts", "quietIntermediateCapture.ts", "historyAwareMate.ts", "repetitionHistory.ts", "types.ts"].map(name => [name, hash(execFileSync("git", ["show", `${ref === "index" ? "" : ref}:src/utils/tacticalMotifs/${name}`], { encoding: "utf8", maxBuffer: 8000000 }))]));
const startingHashes = hashes();
afterAll(() => {
  const endingHashes = hashes();
  if (JSON.stringify(endingHashes) !== JSON.stringify(startingHashes)) throw new Error("Pinned source changed during the run");
  const report = process.env.RARE_MECHANISM_PRECISION_REPORT;
  if (report) writeFileSync(report, JSON.stringify({ ref, classifierVersion: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION, startingHashes, endingHashes,
    inputHashes: Object.fromEntries(["selection", "hypotheses"].map(name => [name, hash(readFileSync(`benchmarks/tactical-relevance/rare-mechanism-precision-v1-${name}.json`, "utf8"))])), observations }, null, 2), { flag: "wx" });
});

test("frozen sample is development-only and game-disjoint from recorded reviews", () => {
  expect(selection.cases).toHaveLength(6);
  expect(new Set(selection.cases.map(row => row.sourceGroup)).size).toBe(6);
  expect(selection.excludedIds).toEqual(expect.arrayContaining(["lichess:EpYOT", "lichess:Qq0JW", "lichess:FSJC4", "lichess:gMkbY", "lichess:q4FtX", "lichess:2qDuS", "lichess:3LtAI", "lichess:9YfbQ"]));
  for (const row of selection.cases) {
    expect(selection.excludedIds).not.toContain(row.id);
    expect(selection.excludedGames).not.toContain(row.sourceGroup);
  }
});
for (const row of selection.cases) for (const reflected of [false, true]) test(`${row.id} ${reflected ? "reflected" : "original"} legal root/full observation`, () => {
  const previousFen = reflected ? reflectMixedForkFen(row.sourceFen) : row.sourceFen;
  const previousMoveUci = reflected ? reflectMixedForkMove(row.precedingMove) : row.precedingMove;
  const previous = Chess.fromSetup(parseFen(previousFen).unwrap()).unwrap();
  expect(previous.isLegal(parseUci(previousMoveUci)!)).toBe(true);
  previous.play(parseUci(previousMoveUci)!);
  const fen = makeFen(previous.toSetup());
  const expectedFen = reflected ? reflectMixedForkFen(row.startFen) : row.startFen;
  // Colour reflection changes which preceding move increments the fullmove counter.
  expect(fen.split(" ").slice(0, 5)).toEqual(expectedFen.split(" ").slice(0, 5));
  const line = row.bestLine.map(move => reflected ? reflectMixedForkMove(move) : move);
  const legal = previous.clone();
  for (const uci of line) { expect(legal.isLegal(parseUci(uci)!)).toBe(true); legal.play(parseUci(uci)!); }
  for (const [kind, pvUci] of [["root", line.slice(0, 1)], ["full", line]] as const) {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: [...pvUci], previousFen, previousMoveUci });
    observations.push({ id: row.id, reflected, kind, fen, line: pvUci, result });
    expect(Array.isArray(result.motifs)).toBe(true);
  }
}, 30000);
