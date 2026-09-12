import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { replayTacticalLine, counterCaptureMaterialDefence } from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

// Sparse constructed control: answering the knight check concedes the queen.
const fen = "4k3/6p1/5N2/8/8/8/3q4/3R2K1 b - - 0 1";
test("a knight capture cannot hide the larger off-square queen loss", () => {
    const steps = replayTacticalLine(fen, ["g7f6", "d1d2"]);
    expect(steps).toHaveLength(2);
    expect(steps[1].balance).toBe(-580);
    expect(counterCaptureMaterialDefence(steps[0], 8192, 0, true)?.defence).toBe("Rxd2");
    expect(classifyPositionTacticalMotifs({ fen, pvUci: ["g7f6"] }).motifs).toEqual([]);
});
test("a defended countercapture cannot erase a genuine free-knight win", () => {
    const defended = "3rk3/6p1/5N2/8/8/8/3r4/3R2K1 b - - 0 1";
    const steps = replayTacticalLine(defended, ["g7f6", "d1d2", "d8d2"]);
    expect(steps).toHaveLength(3);
    expect(steps[2].balance).toBe(320);
    expect(counterCaptureMaterialDefence(steps[0], 8192, 0, true)).toBeNull();
    expect(classifyPositionTacticalMotifs({ fen: defended, pvUci: ["g7f6"] }).motifs[0]?.id).toBe(
        "hangingPiece",
    );
});
test("the compensating capture is not promoted by extra engine lines or a high root score", () => {
    for (const rootCp of [undefined, -500, 1000]) {
        expect(
            classifyPositionTacticalMotifs({ fen, pvUci: ["g7f6", "d1d2"], rootCp }).motifs,
        ).toEqual([]);
    }
    const scan = buildLiveTacticalScan({
        fen,
        pvUci: ["g7f6"],
        depth: 16,
        engineName: "Constructed",
    });
    expect(scan.labels).toEqual([]);
    expect(scan.arrows).toEqual([]);
});
test("the bishop capture is a secondary mistake only after the exposed rook has been exchanged", () => {
    const black = classifyMistakeReviewMotifs({
        fen: "2k1r2R/ppp5/4p3/5nb1/3Pb3/2P5/PP1QNP2/2KR4 b - - 0 24",
        bestMoveUci: "g5d2",
        playedMoveUci: "e8h8",
        pvUci: ["g5d2"],
        refutationUci: ["d2g5"],
    });
    expect(buildMistakeReviewTacticalExplanation(black)).toMatchObject({
        source: "missed",
        primary: { id: "intermezzo" },
        secondary: { id: "hangingPiece", source: "allowed" },
    });
    const white = classifyMistakeReviewMotifs({
        fen: "2k1r2r/ppp5/4p3/5nb1/3Pb3/2P5/PP1QNP1R/2KR4 w - - 0 24",
        bestMoveUci: "d2g5",
        playedMoveUci: "h2h8",
        pvUci: ["d2g5"],
        refutationUci: ["g5d2"],
    });
    expect(buildMistakeReviewTacticalExplanation(white)).toMatchObject({
        source: "allowed",
        primary: { id: "intermezzo" },
    });
    expect(white.missedMotifs).toEqual([]);
});
test.each([0, 1, -1, NaN, Infinity, 1.5])(
    "a countercapture must have a complete budgeted proof: %s",
    (limit) => {
        expect(
            counterCaptureMaterialDefence(replayTacticalLine(fen, ["g7f6"])[0], limit, 0, true),
        ).toBeNull();
    },
);
test.skipIf(!process.env.TACTICAL_PRIVATE_POSITIONAL_MIDDLE_SAMPLE)(
    "the real checking-knight capture is not labelled a free-piece win",
    () => {
        const sample = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_POSITIONAL_MIDDLE_SAMPLE!, "utf8"),
        );
        const row = sample.cases.find((r: { id: string }) => r.id === "private-corpus:910");
        expect(row).toBeDefined();
        const step = replayTacticalLine(row.fen, row.sourceUci)[0];
        expect(counterCaptureMaterialDefence(step, 8192, 0, true)?.defence).toBe("Rxd2");
        expect(
            classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci }).motifs,
        ).toEqual([]);
    },
);
