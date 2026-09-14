import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";

const evidence = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/broader-game-stockfish-18.json", "utf8"),
);
const decisions = (evidence.cases as Array<any>).map((row, index) => {
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
        pvUci: after.lines[0].pvUci,
        variations: after.lines,
        previousFen: row.fen,
        previousMoveUci: row.sourceUci[0],
        depth: 16,
        engineName: "Stockfish 18",
    };
    const review = classifyMistakeReviewMotifs({
        fen: row.fen,
        playedMoveUci: row.sourceUci[0],
        bestMoveUci: row.engineLines[0].pvUci[0],
        pvUci: row.engineLines[0].pvUci,
        refutationUci: after.lines[0].pvUci,
        cpBefore: row.engineLines[0].cp,
        cpAfter: row.sourceEngine.cp,
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

test("replays every frozen root and actual response with previous-move context", () => {
    expect(decisions).toHaveLength(23);
    for (const row of decisions) {
        for (const input of [row.input, row.responseInput])
            expect(replayTacticalLine(input.fen, input.pvUci)).toHaveLength(input.pvUci.length);
    }
    if (process.env.TACTICAL_BROADER_GAME_REPORT)
        writeFileSync(
            process.env.TACTICAL_BROADER_GAME_REPORT,
            JSON.stringify(
                {
                    scope: "Exact source, contextual live and review results for 23 fixed game contexts. Stability is not correctness; review output is inspected even for small/non-mistakes, not an assertion that all moves are mistakes.",
                    cases: decisions,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
});

test("the new fork does not turn the sampled opening plans and geometric pins into tactics", () => {
    const ids = [
        "context:h5yHhpzr:ply6",
        "context:h5yHhpzr:ply16",
        "context:h5yHhpzr:ply30",
        "context:h5yHhpzr:ply50",
        "context:zJqoVvf1:ply6",
        "context:zJqoVvf1:ply16",
        "context:QwS7iWSm:ply6",
        "context:QwS7iWSm:ply16",
        "context:T675oRjx:ply6",
        "context:T675oRjx:ply16",
        "context:T675oRjx:ply50",
    ];
    for (const id of ids) {
        const row = decisions.find((row) => row.id === id)!;
        expect({ id, motifs: row.scan.motifs }).toEqual({ id, motifs: [] });
    }
});

test("Kc2 enables the three-target fork, while the later pin does not lead its lesson", () => {
    const row = decisions.find((row) => row.id === "context:h5yHhpzr:ply70")!;
    expect(row.responseScan.motifs[0]).toMatchObject({ id: "fork", ply: 1, value: 100 });
    expect(row.responseScan.variations[0].timeline.find((m: any) => m.id === "pin")).toMatchObject({
        ply: 3,
    });
    expect(row.lesson?.primary).toMatchObject({
        id: "fork",
        source: "allowed",
        comparison: "prevented",
    });
});

test("the ordinary recapture keeps its move without a newly hanging-piece claim", () => {
    const row = decisions.find((row) => row.id === "context:h5yHhpzr:ply16")!;
    expect(row.responseInput.pvUci[0]).toBe("c7d6");
    expect(row.responseScan.motifs.some((m: any) => m.id === "hangingPiece")).toBe(false);
    expect(
        decisions.find((row) => row.id === "context:T675oRjx:ply30")!.sourceResult.motifs,
    ).toEqual([]);
});
