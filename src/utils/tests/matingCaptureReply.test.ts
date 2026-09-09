import { readFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { expect, test } from "vitest";
import {
    proveMatingCaptureReply,
    replayTacticalLine,
    winningRecaptureEvidence,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

// Constructed king-attraction net: the captured rook is not a four-pawn win
// when Qh3+ and Qh6# follow. The proof must work without that supplied suffix.
const fen = "5r1k/7p/4B3/4NpP1/8/3Q3R/8/6K1 w - - 0 1";
const line = ["h3h7", "h8h7", "d3h3", "h7g7", "h3h6"];
const nomination = {
    id: "hangingPiece",
    label: "Hanging Piece",
    source: "available" as const,
    confidence: "high" as const,
    ply: 2,
    moveUci: line[1],
    evidence: "Untrusted nomination",
};

test("the accepted rook has an independently legal mate-in-two reply", () => {
    const steps = replayTacticalLine(fen, line);
    expect(steps).toHaveLength(5);
    expect(steps[4].after.isCheckmate()).toBe(true);
    const proof = proveMatingCaptureReply(steps[1]);
    expect(proof).toEqual(["Qh3+", "Kg7", "Qh6#"]);
    const position = steps[1].after.clone();
    for (const san of proof!) {
        const move = parseSan(position, san)!;
        expect(position.isLegal(move)).toBe(true);
        position.play(move);
    }
    expect(position.isCheckmate()).toBe(true);
    expect(winningRecaptureEvidence(steps.slice(0, 2), 1, nomination)).toBeNull();
});

test.each([0, 1, -1, NaN, Infinity, 1.5])("budget %s cannot borrow a cached mate", (budget) => {
    const step = replayTacticalLine(fen, line)[1];
    expect(proveMatingCaptureReply(step)).not.toBeNull();
    expect(proveMatingCaptureReply(step, budget)).toBeNull();
});

test("a legal capture of the checker refutes the cooperative mating line", () => {
    const position = fen.replace("4NpP1", "4NbP1");
    const steps = replayTacticalLine(position, line);
    expect(steps).toHaveLength(5);
    expect(steps[4].after.isCheckmate()).toBe(true);
    expect(replayTacticalLine(position, [...line.slice(0, 3), "f5h3"])).toHaveLength(4);
    expect(proveMatingCaptureReply(steps[1])).toBeNull();
    expect(winningRecaptureEvidence(steps, 1, nomination)).toMatchObject({
        id: "hangingPiece",
        label: "Winning Recapture",
        value: 400,
    });
});

test("root and timeline agree without needing future PV moves for the capture proof", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.timeline?.some((m) => m.ply === 2 && m.id === "hangingPiece")).toBe(false);
    expect(result.timeline?.some((m) => m.ply === 5 && m.id === "mateIn1")).toBe(true);
    const after = makeFen(replayTacticalLine(fen, line)[0].after.toSetup());
    const root = classifyPositionTacticalMotifs({
        fen: after,
        previousFen: fen,
        previousMoveUci: line[0],
        pvUci: [line[1]],
    });
    expect(root.motifs.some((m) => m.id === "hangingPiece")).toBe(false);
    const noHistory = classifyPositionTacticalMotifs({ fen: after, pvUci: [line[1]] });
    expect(noHistory.motifs.some((m) => m.id === "hangingPiece")).toBe(true);
    const wrongHistory = classifyPositionTacticalMotifs({
        fen: after,
        previousFen: fen.replace("4NpP1", "5pP1"),
        previousMoveUci: line[0],
        pvUci: [line[1]],
    });
    expect(wrongHistory.motifs.some((m) => m.id === "hangingPiece")).toBe(true);
});

test("removing the bishop supplies a real king escape and an uncaptured move cannot qualify", () => {
    const position = fen.replace("4B3", "8");
    const steps = replayTacticalLine(position, [...line.slice(0, 3), "h7g8"]);
    expect(steps).toHaveLength(4);
    expect(proveMatingCaptureReply(steps[1])).toBeNull();
    expect(proveMatingCaptureReply(steps[2])).toBeNull();
});

test("attraction wording includes the legal intervening check instead of jumping to mate", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    const attraction = result.motifs.find((m) => m.id === "attraction");
    expect(attraction?.evidence).toContain("Kxh7 Qh3+ Kg7 Qh6#");
    const scan = buildLiveTacticalScan({ fen, pvUci: line, depth: 16, engineName: "Constructed" });
    expect(scan.motifs[0]?.id).toBe("attraction");
    expect(scan.arrows.some((a) => a.from === "h3" && a.to === "h7")).toBe(true);
});

test("missed mate and played sacrifice review do not invent a winning enemy recapture", () => {
    const missed = classifyMistakeReviewMotifs({
        fen,
        playedMoveUci: "g1f1",
        bestMoveUci: line[0],
        pvUci: line,
        refutationUci: [],
    });
    expect(buildMistakeReviewTacticalExplanation(missed)?.source).toBe("missed");
    expect(missed.missedTimeline?.some((m) => m.ply === 2 && m.id === "hangingPiece")).toBe(false);
    const played = classifyMistakeReviewMotifs({
        fen,
        playedMoveUci: line[0],
        bestMoveUci: line[0],
        pvUci: line,
        refutationUci: [line[1]],
    });
    expect(played.allowedMotifs.some((m) => m.id === "hangingPiece" && m.ply === 1)).toBe(false);
});

test("colour reflection retains the proof without white-specific squares", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    const moves = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    const steps = replayTacticalLine(fields.join(" "), moves);
    expect(steps).toHaveLength(5);
    expect(proveMatingCaptureReply(steps[1])).not.toBeNull();
    expect(winningRecaptureEvidence(steps, 1, { ...nomination, moveUci: moves[1] })).toBeNull();
});

test.skipIf(!process.env.TACTICAL_PRIVATE_THIRD_SAMPLE)(
    "real fresh-sample acceptance is not a four-pawn win",
    () => {
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_THIRD_SAMPLE!, "utf8"));
        const row = sample.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 50);
        const steps = replayTacticalLine(row.fen, row.sourceUci);
        expect(proveMatingCaptureReply(steps[1])).toEqual(["Qh3+", "Kg7", "Qh6#"]);
        const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci });
        expect(result.motifs[0]?.evidence).toContain("Kxh7 Qh3+ Kg7 Qh6#");
        expect(result.timeline?.some((m) => m.ply === 2 && m.id === "hangingPiece")).toBe(false);
    },
);
