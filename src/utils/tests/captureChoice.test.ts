import { expect, test } from "vitest";
import { positionSchema } from "@/components/files/opening";
import { qualifyComparableCaptureChoice } from "../tacticalMotifs/captureChoice";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
    tacticalMotifPerspective,
} from "../tacticalMotifs/mistakeReviewAdapter";
import type { TacticalMotifEvidence } from "../tacticalMotifs/types";

const fen = "1rr3k1/5ppp/2B1b3/5p2/6N1/1P6/P1P2PPP/R3R1K1 b - - 0 21";
const line = ["c8c6", "g4e5", "c6c2", "e1b1", "g7g6", "h2h3"];
const review = (length = line.length) =>
    classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: line[0],
        playedMoveUci: "f5g4",
        pvUci: line.slice(0, length),
        refutationUci: ["c6e4", "c8c5", "a2a4"],
    });
const proposal: TacticalMotifEvidence = {
    id: "hangingPiece",
    label: "Hanging Piece",
    confidence: "high",
    source: "missed",
    ply: 1,
    moveUci: "c8c6",
    evidence: "Rxc6 captures the bishop.",
    value: 330,
};

test.each([1, 3, line.length])(
    "a comparable capture is not a proved missed-material cause, PV length %s",
    (length) => {
        const result = review(length);
        expect(result.missedMotifs[0]).toMatchObject({
            id: "hangingPiece",
            value: 330,
            alternativeCapture: true,
        });
        expect(
            result.missedTimeline?.find((m) => m.ply === 1 && m.id === "hangingPiece")
                ?.alternativeCapture,
        ).toBe(true);
        const explanation = buildMistakeReviewTacticalExplanation(result)!;
        expect(explanation.title).toBe("Capture in the better line");
        expect(explanation.text).toContain(
            "Rxc6 captures the bishop on c6; fxg4 captures the knight on g4",
        );
        expect(explanation.text).toContain("not a verified explanation");
        expect(explanation.secondary).toBeUndefined();
        expect(tacticalMotifPerspective(explanation.primary)).toBe("Capture choice");
    },
);

test("colour reflection does not restore an unsupported missed-piece cause", () => {
    const reflected = fen.split(" ");
    reflected[0] = reflected[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-z]/gi, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    reflected[1] = "w";
    const flip = (move: string) => move.replace(/[1-8]/g, (rank) => String(9 - Number(rank)));
    const result = classifyMistakeReviewMotifs({
        fen: reflected.join(" "),
        bestMoveUci: flip(line[0]),
        playedMoveUci: flip("f5g4"),
        pvUci: line.map(flip),
        refutationUci: ["c6e4"].map(flip),
    });
    expect(result.missedMotifs[0]).toMatchObject({ alternativeCapture: true, value: 330 });
    expect(buildMistakeReviewTacticalExplanation(result)?.title).toBe("Capture in the better line");
});

test("position scans still show the genuinely available capture; comparison never mutates them", () => {
    const available = classifyPositionTacticalMotifs({ fen, pvUci: [line[0]] });
    expect(available.motifs[0]).toMatchObject({ id: "hangingPiece", value: 330 });
    expect(available.motifs[0].alternativeCapture).toBeUndefined();
    const input = [{ ...proposal }];
    qualifyComparableCaptureChoice(fen, line[0], "f5g4", input);
    expect(input).toEqual([proposal]);
});

test("a higher engine score or longer cooperative line cannot certify capture causation", () => {
    for (const cpLoss of [1, 269, 1000]) {
        const result = classifyMistakeReviewMotifs({
            fen,
            bestMoveUci: line[0],
            playedMoveUci: "f5g4",
            pvUci: line,
            refutationUci: ["c6e4"],
            cpLoss,
            cpBefore: -cpLoss,
            cpAfter: cpLoss,
        });
        expect(result.missedMotifs[0].alternativeCapture).toBe(true);
    }
});

test.each([
    ["quiet move", "g8f8"],
    ["illegal move", "f5h4"],
    ["same move", "c8c6"],
    ["missing move", null],
])("%s cannot supply an alternative capture", (_name, played) => {
    expect(qualifyComparableCaptureChoice(fen, line[0], played, [proposal])).toEqual([proposal]);
});

test.each([
    { source: "allowed" as const },
    { ply: 3 },
    { moveUci: "b8b6" },
    { id: "fork" },
    { id: "pin" },
    { id: "interference" },
    { id: "zugzwang" },
    { id: "mateIn3" },
    { verifiedCombination: true as const },
])("comparable exchanges do not qualify other motifs or plies: %j", (change) => {
    const input = [{ ...proposal, ...change }];
    expect(qualifyComparableCaptureChoice(fen, line[0], "f5g4", input)).toEqual(input);
});

const simpleFen = "r5kr/5pp1/8/8/B6N/8/5PPP/6K1 b - - 0 1";
test.each([
    ["bishop versus knight", simpleFen, true],
    ["queen versus knight is a real extra capture", simpleFen.replace("B6N", "Q6N"), false],
    ["bishop versus pawn is a real extra capture", simpleFen.replace("B6N", "B6P"), false],
    ["a pawn can recapture the rook", simpleFen.replace("B6N/8", "B6N/6P1"), false],
    ["an equal rook exchange", simpleFen.replace("B6N/8", "B6R/6P1"), false],
    ["the proposed better capture loses its rook to the queen", simpleFen.replace("B6N", "B6Q"), false],
])("local exchange controls: %s", (_name, position, expected) => {
    expect(replayTacticalLine(position, ["a8a4"])).toHaveLength(1);
    expect(replayTacticalLine(position, ["h8h4"])).toHaveLength(1);
    const result = qualifyComparableCaptureChoice(position, "a8a4", "h8h4", [
        { ...proposal, moveUci: "a8a4" },
    ]);
    expect(result[0].alternativeCapture === true).toBe(expected);
});

test("promotion captures are separate mechanisms, not comparable ordinary captures", () => {
    const position = "q2r3k/4P3/8/8/8/8/6PP/R5K1 w - - 0 1";
    for (const [best, played] of [
        ["e7d8n", "a1a8"],
        ["a1a8", "e7d8q"],
    ]) {
        expect(replayTacticalLine(position, [best])).toHaveLength(1);
        expect(replayTacticalLine(position, [played])).toHaveLength(1);
        expect(
            qualifyComparableCaptureChoice(position, best, played, [
                { ...proposal, moveUci: best },
            ])[0].alternativeCapture,
        ).toBeUndefined();
    }
});

test("capturing the same victim with a different attacker is not missing that capture", () => {
    const position = "3r2k1/5ppp/8/8/r2B4/8/5PPP/6K1 b - - 0 1";
    for (const move of ["d8d4", "a4d4"])
        expect(replayTacticalLine(position, [move])).toHaveLength(1);
    expect(
        qualifyComparableCaptureChoice(position, "d8d4", "a4d4", [
            { ...proposal, moveUci: "d8d4" },
        ])[0].alternativeCapture,
    ).toBe(true);
});

test("a larger played capture is not described as equal, and en passant names the actual victim", () => {
    const larger = qualifyComparableCaptureChoice(simpleFen.replace("8/B6N", "7Q/B7"), "a8a4", "h8h5", [
        { ...proposal, moveUci: "a8a4" },
    ]);
    expect(larger[0].comparisonEvidence).toContain("larger immediate exchange gain");
    const ep = "7k/8/8/3pPp2/2P5/8/6PP/6K1 w - f6 0 1";
    const result = qualifyComparableCaptureChoice(ep, "c4d5", "e5f6", [
        { ...proposal, moveUci: "c4d5", value: 100 },
    ]);
    expect(result[0].alternativeCapture).toBe(true);
    expect(result[0].comparisonEvidence).toContain("exf6 captures the pawn on f5");
});

test.each(["prevented", "reduced", "persists", undefined] as const)(
    "a real opponent root lesson outranks a comparable capture: %s",
    (comparison) => {
        const allowed: TacticalMotifEvidence = {
            ...proposal,
            source: "allowed",
            id: "fork",
            label: "Fork",
            moveUci: "e4d6",
            value: 180,
            comparison,
            comparisonEvidence: "The alternative answers this fork.",
        };
        const explanation = buildMistakeReviewTacticalExplanation({
            allowedMotifs: [allowed],
            missedMotifs: review().missedMotifs,
        })!;
        expect(explanation.primary.source).toBe("allowed");
        expect(explanation.secondary).toBeUndefined();
        expect(explanation.text).not.toContain("also missed");
    },
);

test("save and reload preserve the qualification and do not alter older records", () => {
    const restored = positionSchema.shape.mistakeReview.parse(
        JSON.parse(JSON.stringify(review())),
    )!;
    expect(restored.missedMotifs?.[0].alternativeCapture).toBe(true);
    expect(restored.missedTimeline?.find((m) => m.ply === 1)?.alternativeCapture).toBe(true);
    expect(
        buildMistakeReviewTacticalExplanation({
            allowedMotifs: restored.allowedMotifs!,
            missedMotifs: restored.missedMotifs!,
        })?.title,
    ).toBe("Capture in the better line");
    expect(positionSchema.shape.mistakeReview.safeParse({ missedMotifs: [proposal] }).success).toBe(
        true,
    );
});
