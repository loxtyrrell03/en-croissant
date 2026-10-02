import { afterAll, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { classifyPositionTacticalMotifs, MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION } from "../../src/utils/tacticalMotifs/mistakeReviewAdapter";
import { replayTacticalLine } from "../../src/utils/tacticalMotifs/causalTactics";
import { verifiedTacticalHistory } from "../../src/utils/tacticalMotifs/gameHistory";

type Context = { id: string; fen: string; previousFen: string; previousMoveUci: string;
    sourceUci: string[]; quietAlternatives: { uci: string; san: string }[]; history: { fen: string; moves: string[] } };
const cases = ["ordinary-precision-v1-selection.json", "ordinary-precision-v1-adjacent-selection.json"].flatMap(name =>
    (JSON.parse(readFileSync(`benchmarks/tactical-relevance/${name}`, "utf8")) as { cases: Context[] }).cases);
const observations: unknown[] = [];
const ref = process.env.ORDINARY_PRECISION_REF;
if (ref && !["index", "index-core"].includes(ref) && !/^[0-9a-f]{40}$/.test(ref)) throw new Error("Invalid pinned source ref");
const sourceHashes = () => Object.fromEntries(["causalTactics.ts", "mistakeReviewAdapter.ts", "continuationHistory.ts",
    "gameHistory.ts", "quietClearancePreparation.ts", "quietIntermediateCapture.ts", "historyAwareMate.ts",
    "repetitionHistory.ts", "types.ts"].map(name => [name,
    createHash("sha256").update((ref && (ref !== "index-core" || name === "causalTactics.ts") ? execFileSync("git", ["show", `${["index", "index-core"].includes(ref) ? "" : ref}:src/utils/tacticalMotifs/${name}`], { encoding: "utf8" }) :
        readFileSync(`src/utils/tacticalMotifs/${name}`, "utf8")).replace(/\r\n/g, "\n")).digest("hex")]));
const startingHashes = process.env.ORDINARY_PRECISION_V1_REPORT ? sourceHashes() : undefined;
afterAll(() => {
    const path = process.env.ORDINARY_PRECISION_V1_REPORT;
    if (!path) return;
    const hashes = sourceHashes();
    if (JSON.stringify(hashes) !== JSON.stringify(startingHashes)) throw new Error("Observed tactical sources changed during the run");
    writeFileSync(path, JSON.stringify({ classifierVersion: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
        sourceRef: ref ?? "working-tree", startingHashes, hashes, sourcesUnchanged: true,
        scope: "Output-blind ordinary public-game contexts. These observations are not tactical/positional gold labels or an accuracy metric.", observations }, null, 2), { flag: "wx" });
});

for (const row of cases) test(`legal complete public context ${row.id}`, () => {
    const history = verifiedTacticalHistory(row.history, row.fen);
    expect(history).not.toBeNull();
    expect(makeFen(history!.position.toSetup())).toBe(row.fen);
    const previous = Chess.fromSetup(parseFen(row.previousFen).unwrap()).unwrap();
    expect(previous.isLegal(parseUci(row.previousMoveUci)!)).toBe(true);
    previous.play(parseUci(row.previousMoveUci)!);
    expect(makeFen(previous.toSetup())).toBe(row.fen);
    const variants = [
        { kind: "played-root", line: row.sourceUci.slice(0, 1) },
        { kind: "played-full", line: row.sourceUci },
        ...row.quietAlternatives.map((alternative, index) => ({ kind: `quiet-${index + 1}`, line: [alternative.uci] })),
    ];
    for (const variant of variants) {
        expect(replayTacticalLine(row.fen, variant.line)).toHaveLength(variant.line.length);
        const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: variant.line,
            previousFen: row.previousFen, previousMoveUci: row.previousMoveUci, tacticalHistory: row.history });
        observations.push({ id: row.id, kind: variant.kind, line: variant.line, result });
        // Deliberately no assertions that empty output is correct/positional,
        // or that a source-game line is optimal. This suite freezes inputs and
        // exact history; concrete adjudicated regressions are separate.
        expect(Array.isArray(result.motifs)).toBe(true);
    }
}, 30000);
