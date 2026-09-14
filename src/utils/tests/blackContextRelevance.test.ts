import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";

const evidence = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/black-context-stockfish-18.json", "utf8"),
);
const decisions = evidence.cases.map((row: any, index: number) => {
    const after = evidence.responses[index];
    if (after.id !== row.id + ":reply") throw new Error("Mismatched response identity");
    const input = {
        fen: row.fen,
        pvUci: row.engineLines[0].pvUci,
        variations: row.engineLines,
        previousFen: row.previousFen,
        previousMoveUci: row.previousMoveUci,
        depth: 16,
        engineName: "Stockfish 18",
    };
    const responseInput = {
        fen: after.fen,
        pvUci: after.lines[0]?.pvUci ?? [],
        variations: after.lines,
        previousFen: row.fen,
        previousMoveUci: row.sourceUci[0],
        depth: 16,
        engineName: "Stockfish 18",
    };
    // The adapter's cpBefore/cpAfter contract is White-relative, while this
    // frozen engine receipt is root-side-relative (Black for every root).
    const review = classifyMistakeReviewMotifs({
        fen: row.fen,
        playedMoveUci: row.sourceUci[0],
        bestMoveUci: row.engineLines[0].pvUci[0],
        pvUci: row.engineLines[0].pvUci,
        refutationUci: after.lines[0]?.pvUci ?? [],
        cpBefore: row.engineLines[0].cp === null ? null : -row.engineLines[0].cp,
        cpAfter: row.sourceEngine.cp === null ? null : -row.sourceEngine.cp,
        cpLoss:
            row.engineLines[0].cp !== null && row.sourceEngine.cp !== null
                ? Math.max(0, row.engineLines[0].cp - row.sourceEngine.cp)
                : undefined,
    });
    return {
        id: row.id,
        input,
        responseInput,
        sourceResult: classifyPositionTacticalMotifs({
            fen: row.fen,
            pvUci: row.sourceUci,
            previousFen: row.previousFen,
            previousMoveUci: row.previousMoveUci,
        }),
        scan: buildLiveTacticalScan(input),
        responseScan: buildLiveTacticalScan(responseInput),
        review,
        lesson: buildMistakeReviewTacticalExplanation(review),
    };
});

test("replays the fixed Black-root and actual White-reply observations without filtering small moves", () => {
    expect(decisions).toHaveLength(20);
    for (const row of decisions)
        for (const input of [row.input, row.responseInput])
            expect(replayTacticalLine(input.fen, input.pvUci)).toHaveLength(input.pvUci.length);
    if (process.env.TACTICAL_BLACK_CONTEXT_REPORT)
        writeFileSync(
            process.env.TACTICAL_BLACK_CONTEXT_REPORT,
            JSON.stringify(
                {
                    scope: "Current source/live/mistake outputs for fixed public game contexts. Empty and stable results are not automatically correct negatives; initial and reviewed judgements are separate.",
                    cases: decisions,
                },
                null,
                2,
            ) + "\n",
            { flag: "wx" },
        );
});

test.each([
    "context:mD14jttw:ply5",
    "context:mD14jttw:ply15",
    "context:TCE52bRu:ply5",
    "context:TCE52bRu:ply15",
    "context:TCE52bRu:ply29",
    "context:zcEVXTW1:ply5",
    "context:zcEVXTW1:ply15",
    "context:BNbGN5Pe:ply5",
    "context:BNbGN5Pe:ply15",
    "context:fvNmdR3U:ply5",
    "context:fvNmdR3U:ply15",
])("reviewed opening/development context does not inherit a later trap: %s", (id) => {
    const row = decisions.find((row: any) => row.id === id)!;
    expect(row.scan.motifs).toEqual([]);
    expect(row.scan.labels).toEqual([]);
    expect(row.sourceResult.motifs).toEqual([]);
});

test("the real rook recapture does not acquire the opponent's discovery as its cause", () => {
    const row = decisions.find((row: any) => row.id === "context:TCE52bRu:ply49")!;
    expect(row.scan.motifs).toEqual([]);
    expect(row.responseScan.motifs[0]).toMatchObject({
        id: "discoveredAttack",
        ply: 1,
        value: 320,
    });
    expect(row.responseScan.variations[0].timeline).toContainEqual(
        expect.objectContaining({ label: "Discovery Payoff", ply: 3, moveUci: "d1d7" }),
    );
    expect(row.review.allowedMotifs[0]).toMatchObject({
        id: "discoveredAttack",
        comparison: "persists",
    });
    expect(row.lesson?.title).toBe("Tactical danger in the position");
});

test("active king play keeps the conditional equalizing fork at its actual ply", () => {
    const row = decisions.find((row: any) => row.id === "context:zcEVXTW1:ply49")!;
    expect(row.scan.motifs).toEqual([]);
    expect(row.responseScan.motifs).toEqual([]);
    const alternative = row.responseScan.variations.find((line: any) => line.multipv === 2)!;
    expect(alternative.motifs[0]).toMatchObject({ id: "fork", ply: 3 });
    expect(alternative.labels[0].text).toBe("Later: Fork");
    expect(row.review.allowedMotifs).toEqual([]);
});

test.each(["context:zcEVXTW1:ply29", "context:zcEVXTW1:ply69", "context:zcEVXTW1:ply89"])(
    "equal liquidation is not a free rook or queen: %s",
    (id) => {
        const row = decisions.find((row: any) => row.id === id)!;
        expect(row.scan.motifs).toEqual([]);
        expect(row.sourceResult.motifs).toEqual([]);
        expect(row.review.allowedMotifs).toEqual([]);
    },
);
