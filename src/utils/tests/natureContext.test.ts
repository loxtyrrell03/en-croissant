import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { classifyMistakeReviewNature } from "../mistakeReview";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";

const read = (name: string) =>
    JSON.parse(readFileSync(`benchmarks/tactical-relevance/${name}.json`, "utf8"));
const cases = ["nature", "quiet-game"].flatMap((prefix) => {
    const sample = read(`${prefix}-context-development`);
    const engine = read(`${prefix}-context-stockfish-18`);
    return sample.cases.map((row: any) => {
        const searches = ["best", "played", "reply"].map((lane) =>
            engine.searches.find((s: any) => s.id === `${row.id}:${lane}`),
        );
        const [best, played, reply] = searches;
        const sign = row.fen.split(" ")[1] === "w" ? 1 : -1;
        const input = {
            fen: row.fen,
            bestMoveUci: best.lines[0].pvUci[0],
            bestMoveSan: best.lines[0].pvSan[0],
            playedMoveUci: row.sourceUci[0],
            playedMoveSan: row.sourceSan[0],
            pvUci: best.lines[0].pvUci,
            pvSan: best.lines[0].pvSan,
            refutationUci: reply.lines[0].pvUci,
            refutationSan: reply.lines[0].pvSan,
            cpLoss:
                best.lines[0].cp === null || played.lines[0].cp === null
                    ? undefined
                    : Math.max(0, best.lines[0].cp - played.lines[0].cp),
            cpBefore: best.lines[0].cp === null ? null : best.lines[0].cp * sign,
            cpAfter: played.lines[0].cp === null ? null : played.lines[0].cp * sign,
            reachedDepth: 16,
        };
        const motifs = classifyMistakeReviewMotifs(input);
        return {
            id: row.id,
            input,
            searches,
            motifs,
            explanation: buildMistakeReviewTacticalExplanation(motifs),
            nature: classifyMistakeReviewNature(input),
        };
    });
});

test("audit all 45 fixed game boards without selecting on move quality or classifier output", () => {
    expect(cases).toHaveLength(45);
    for (const row of cases) {
        const [best, played, reply] = row.searches;
        expect(best.fen).toBe(row.input.fen);
        expect(played.searchMove).toBe(row.input.playedMoveUci);
        const actual = replayTacticalLine(row.input.fen, [row.input.playedMoveUci]);
        expect(actual).toHaveLength(1);
        expect(makeFen(actual[0].after.toSetup())).toBe(reply.fen);
        for (const search of row.searches)
            for (const line of search.lines)
                expect(replayTacticalLine(search.fen, line.pvUci)).toHaveLength(line.pvUci.length);
    }
    if (process.env.TACTICAL_NATURE_REPORT)
        writeFileSync(
            process.env.TACTICAL_NATURE_REPORT,
            JSON.stringify(
                {
                    scope: "Fixed mixed-phase audit. Outputs are diagnostics, not 45 independently accurate decisions.",
                    cases,
                },
                null,
                2,
            ) + "\n",
            { flag: "wx" },
        );
});

test.each([
    "context:yOwOb8mH:ply8",
    "context:yOwOb8mH:ply40",
    "context:yOwOb8mH:ply59",
    "context:8OYE3aem:ply8",
    "context:eTscGjLx:ply21",
    "context:eTscGjLx:ply59",
    "context:BkwHTU3l:ply8",
    "context:BkwHTU3l:ply21",
    "context:oD1ADLSC:ply8",
    "context:oD1ADLSC:ply21",
    "context:oD1ADLSC:ply40",
    "context:oD1ADLSC:ply99",
    "context:ZFgq8VzD:ply60",
    "context:C9q6jvtW:ply41",
])(
    "routine threats, existing danger and capture choices do not prove a mistake cause: %s",
    (id) => {
        const row = cases.find((row: any) => row.id === id)!;
        expect(row.nature.nature).toBe("unknown");
        expect(row.nature.tacticalSignals).toEqual([]);
        expect(row.nature.reason).not.toContain("prevents that concrete outcome");
    },
);

test("sharp unresolved attacking and exchange positions are not re-labelled positional", () => {
    for (const id of [
        "context:8OYE3aem:ply40",
        "context:eTscGjLx:ply40",
        "context:BkwHTU3l:ply40",
    ]) {
        const row = cases.find((row: any) => row.id === id)!;
        expect(row.nature).toMatchObject({ nature: "unknown", confidence: "low" });
    }
});

test("the genuine missed checking capture leads with its discovery rather than the later queen capture", () => {
    const row = cases.find((row: any) => row.id === "context:BkwHTU3l:ply59")!;
    expect(row.nature).toMatchObject({ nature: "tactical", aspect: "missed" });
    expect(row.nature.reason).toContain("Rxd7+");
    expect(row.explanation.primary).toMatchObject({ id: "discoveredCheck", ply: 1, moveUci: "d3d7" });
    // The queen exchange is now independently verified as a conditional
    // defense, not borrowed from a later PV as the root's main theme.
    expect(row.nature.reason).toContain("Rxc2 is met by Rxa7");
    expect(row.nature.reason).toBe(row.explanation.text);
});
