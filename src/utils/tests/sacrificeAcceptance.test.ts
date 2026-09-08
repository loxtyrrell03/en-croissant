import { readFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import { replayTacticalLine, winningRecaptureEvidence } from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";

const fen = "8/8/6k1/5qpr/4N3/8/8/K6Q w - - 0 1";
const line = ["h1h5", "g6h5", "e4g3", "h5h4", "g3f5"];

test("accepting a sound queen offer is not a winning-recapture lesson", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(replayTacticalLine(fen, line)).toHaveLength(line.length);
    expect(result.motifs[0]?.id).toBe("forkPreparation");
    expect(result.timeline?.some((m) => m.ply === 2 && m.id === "hangingPiece")).toBe(false);
    expect(result.timeline?.some((m) => m.ply === 3 && m.id === "fork")).toBe(true);
});

test("viewing the acceptance as a new root retains replay-matching context without future moves", () => {
    const root = replayTacticalLine(fen, line)[0];
    const result = classifyPositionTacticalMotifs({
        fen: makeFen(root.after.toSetup()),
        previousFen: fen,
        previousMoveUci: line[0],
        pvUci: [line[1]],
    });
    expect(result.motifs.some((m) => m.ply === 1 && m.id === "hangingPiece")).toBe(false);
});

test("wrong history cannot erase a material label using another position's sacrifice", () => {
    const root = replayTacticalLine(fen, line)[0];
    const result = classifyPositionTacticalMotifs({
        fen: makeFen(root.after.toSetup()),
        previousFen: fen.replace("5qpr", "5qpb"),
        previousMoveUci: line[0],
        pvUci: [line[1]],
    });
    expect(result.motifs.some((m) => m.ply === 1 && m.id === "hangingPiece")).toBe(true);
});

test("an unsound offer cannot hide behind its cooperative continuation", () => {
    const position = fen.replace("5qpr", "5qpb");
    const steps = replayTacticalLine(position, line);
    const result = classifyPositionTacticalMotifs({
        fen: makeFen(steps[0].after.toSetup()),
        previousFen: position,
        previousMoveUci: line[0],
        pvUci: line.slice(1),
    });
    expect(result.motifs[0]).toMatchObject({ id: "hangingPiece", label: "Winning Recapture" });
});

test("a recapture allowing immediate smothered mate cannot claim a material win", () => {
    const position = "5rnk/6pp/4Q2N/8/8/8/8/K7 w - - 0 1";
    const moves = ["e6g8", "f8g8", "h6f7"];
    const steps = replayTacticalLine(position, moves);
    expect(steps).toHaveLength(3);
    expect(steps[2].after.isCheckmate()).toBe(true);
    const result = classifyPositionTacticalMotifs({ fen: position, pvUci: moves });
    expect(result.timeline?.some((m) => m.ply === 2 && m.id === "hangingPiece")).toBe(false);
    const viewed = classifyPositionTacticalMotifs({
        fen: makeFen(steps[0].after.toSetup()),
        previousFen: position,
        previousMoveUci: moves[0],
        pvUci: [moves[1]],
    });
    expect(viewed.motifs.some((m) => m.id === "hangingPiece")).toBe(false);
});

test("removing the mating net restores the genuinely profitable recapture", () => {
    const position = "5rnk/6p1/4Q2N/8/8/8/8/K7 w - - 0 1";
    const moves = ["e6g8", "f8g8", "h6f7", "h8h7"];
    const steps = replayTacticalLine(position, moves);
    expect(steps).toHaveLength(4);
    const result = classifyPositionTacticalMotifs({
        fen: makeFen(steps[0].after.toSetup()),
        previousFen: position,
        previousMoveUci: moves[0],
        pvUci: [moves[1]],
    });
    expect(result.motifs[0]).toMatchObject({ id: "hangingPiece", label: "Winning Recapture" });
});

test("mistake review does not accuse a verified sacrifice of hanging the queen", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        playedMoveUci: line[0],
        bestMoveUci: line[0],
        pvUci: line,
        refutationUci: line.slice(1),
    });
    expect(review.allowedMotifs.some((m) => m.id === "hangingPiece" && m.ply === 1)).toBe(false);
});

test("taking a queen offered to remove another queen's defender is not a free queen", () => {
    const position = "8/p7/4kq2/3nP1B1/7P/8/P7/K2Q4 w - - 0 1";
    const moves = ["d1d5", "e6d5", "g5f6"];
    const steps = replayTacticalLine(position, moves);
    expect(steps).toHaveLength(3);
    expect(classifyPositionTacticalMotifs({ fen: position, pvUci: moves }).motifs[0]?.id).toBe(
        "capturingDefender",
    );
    const result = classifyPositionTacticalMotifs({
        fen: makeFen(steps[0].after.toSetup()),
        previousFen: position,
        previousMoveUci: moves[0],
        pvUci: [moves[1]],
    });
    expect(result.motifs.some((m) => m.id === "hangingPiece")).toBe(false);
});

test("missing recovery attackers restore the queen-loss label", () => {
    const position = "8/p7/4kq2/3n4/7P/8/P7/1K1Q4 w - - 0 1";
    const steps = replayTacticalLine(position, ["d1d5", "e6d5"]);
    expect(steps).toHaveLength(2);
    const result = classifyPositionTacticalMotifs({
        fen: makeFen(steps[0].after.toSetup()),
        previousFen: position,
        previousMoveUci: "d1d5",
        pvUci: ["e6d5"],
    });
    expect(result.motifs[0]).toMatchObject({ id: "hangingPiece", label: "Winning Recapture" });
});

test("colour reflection retains the sacrifice's compensation rather than its gross capture", () => {
    const before = "k6q/8/8/4n3/5QPR/6K1/8/8 b - - 0 1";
    const moves = ["h8h4", "g3h4", "e5g6"];
    const result = classifyPositionTacticalMotifs({ fen: before, pvUci: moves });
    expect(result.motifs[0]?.id).toBe("forkPreparation");
    expect(result.timeline?.some((m) => m.ply === 2 && m.id === "hangingPiece")).toBe(false);
    expect(result.timeline?.some((m) => m.ply === 3 && m.id === "fork")).toBe(true);
});

test.skipIf(!process.env.TACTICAL_PRIVATE_PGN_SAMPLE)(
    "private king and rook acceptances retain compensation context",
    () => {
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_PGN_SAMPLE!, "utf8"));
        for (const [index, reply] of [
            [77, "g7f6"],
            [97, "g2h3"],
            [68, "d6f6"],
            [125, "h8f8"],
        ] as const) {
            const row = sample.cases.find(
                (r: { eligibleIndex: number }) => r.eligibleIndex === index,
            );
            const steps = replayTacticalLine(row.fen, [row.sourceUci[0], reply]);
            expect(steps).toHaveLength(2);
            expect(
                winningRecaptureEvidence(steps, 1, {
                    id: "hangingPiece",
                    label: "Hanging Piece",
                    source: "available",
                    confidence: "high",
                    ply: 2,
                    moveUci: reply,
                    evidence: "Test nomination",
                }),
            ).toBeNull();
            const result = classifyPositionTacticalMotifs({
                fen: makeFen(steps[0].after.toSetup()),
                previousFen: row.fen,
                previousMoveUci: row.sourceUci[0],
                pvUci: [reply],
            });
            expect(result.motifs.some((m) => m.id === "hangingPiece" && m.ply === 1)).toBe(false);
        }
    },
);
