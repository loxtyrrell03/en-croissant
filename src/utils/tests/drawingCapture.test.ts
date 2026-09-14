import { expect, test, vi } from "vitest";
import { drawingCaptureEvidenceCases as cases } from "./fixtures/drawingCaptureEvidence";
import {
    drawingCaptureRequest,
    proveDrawingCapture,
    validateTablebaseRecord,
    type TablebaseEvidence,
} from "../tacticalMotifs/tablebaseEvidence";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    isImmediateTacticalLesson,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { classifyProvedMistakeNature } from "../tacticalMotifs/mistakeNature";
import { tacticalBoardEvidence } from "../tacticalMotifs/causalTactics";
import { lookupTacticalEndgameEvidence } from "../tacticalMotifs/tablebaseLookup";

test.each(cases)("exact saving-capture judgement: $id", (row) => {
    expect(validateTablebaseRecord(row.evidence.records[0], row.fen)).not.toBeNull();
    expect(Boolean(proveDrawingCapture(row.fen, row.move, row.evidence))).toBe(row.expected);
    const input = { fen: row.fen, pvUci: [row.move], tablebaseEvidence: row.evidence };
    const classified = classifyPositionTacticalMotifs(input);
    const scan = buildLiveTacticalScan({ ...input, engineName: "Stockfish", depth: 16 });
    expect(classified.motifs.some((m) => m.id === "drawingCapture")).toBe(row.expected);
    expect(scan.motifs.some((m) => m.id === "drawingCapture")).toBe(row.expected);
});

test.each(cases.filter((row) => row.expected))(
    "saving capture is primary with precise board geometry and no invented gain: $id",
    (row) => {
        const input = { fen: row.fen, pvUci: [row.move], tablebaseEvidence: row.evidence };
        const classified = classifyPositionTacticalMotifs(input);
        const scan = buildLiveTacticalScan({ ...input, engineName: "Stockfish", depth: 16 });
        expect(classified.motifs.map((m) => m.id)).toEqual(["drawingCapture"]);
        expect(scan.motifs[0]).toMatchObject({
            id: "drawingCapture",
            value: 0,
            ply: 1,
            relevance: "primary",
        });
        expect(scan.labels.map((l) => [l.text, l.square])).toEqual([
            ["Drawing Capture", row.move.slice(2, 4)],
        ]);
        expect(scan.arrows.map((a) => [a.from, a.to])).toEqual([
            [row.move.slice(0, 2), row.move.slice(2, 4)],
        ]);
        expect(scan.variations[0].timeline.map((m) => [m.id, m.ply])).toEqual([
            ["drawingCapture", 1],
        ]);
        expect(isImmediateTacticalLesson(classified.motifs[0])).toBe(true);
        expect(tacticalBoardEvidence(row.fen, [row.move], classified.motifs[0])).toBeNull();
        // Evidence-bearing calls cannot contaminate ordinary scans or vice versa.
        expect(
            classifyPositionTacticalMotifs({ ...input, tablebaseEvidence: undefined }).motifs,
        ).toEqual([]);
    },
);

test.each(cases.filter((r) => r.expected))(
    "missed saving resource has an exact losing alternative: $id",
    (row) => {
        const proof = proveDrawingCapture(row.fen, row.move, row.evidence)!;
        const input = {
            fen: row.fen,
            bestMoveUci: row.move,
            playedMoveUci: proof.losingMoves[0],
            pvUci: [row.move],
            tablebaseEvidence: row.evidence,
            cpLoss: 300,
        };
        const classification = classifyMistakeReviewMotifs(input);
        expect(classification.missedMotifs[0]).toMatchObject({
            id: "drawingCapture",
            value: 0,
            source: "missed",
        });
        expect(classifyProvedMistakeNature(input)).toMatchObject({
            nature: "tactical",
            aspect: "missed",
        });
        expect(buildMistakeReviewTacticalExplanation(classification)?.primary.id).toBe(
            "drawingCapture",
        );
        expect(
            classifyMistakeReviewMotifs({ ...input, playedMoveUci: row.move }).missedMotifs,
        ).toEqual([]);
    },
);

test("equivalent king/knight captures both draw, even if a caller supplies an erroneous evaluation loss", () => {
    const row = cases.find((r) => r.id === "equivalent-saving-captures")!;
    expect(proveDrawingCapture(row.fen, row.move, row.evidence)?.drawingMoves.sort()).toEqual([
        "c4e5",
        "e4e5",
    ]);
    const input = {
        fen: row.fen,
        bestMoveUci: row.move,
        playedMoveUci: "c4e5",
        pvUci: [row.move],
        tablebaseEvidence: row.evidence,
        cpLoss: 900,
    };
    const review = classifyMistakeReviewMotifs(input);
    expect(review.missedMotifs).toEqual([]);
    expect(review.missedTimeline).toEqual([]);
    expect(classifyProvedMistakeNature(input).nature).toBe("unknown");
});

test("allowing a saving draw needs an exact winning alternative, not just an illegal capture", () => {
    const before = cases.find((r) => r.id === "allow-drawing-capture")!,
        after = cases.find((r) => r.id === "allowed-rook-rescue")!;
    const input = {
        fen: before.fen,
        playedMoveUci: before.move,
        bestMoveUci: "a5a8",
        pvUci: ["a5a8"],
        refutationUci: [after.move],
        cpLoss: 500,
        tablebaseEvidence: {
            provider: "lichess-syzygy",
            records: [...before.evidence.records, ...after.evidence.records],
        } satisfies TablebaseEvidence,
    };
    expect(classifyMistakeReviewMotifs(input).allowedMotifs[0]).toMatchObject({
        id: "drawingCapture",
        comparison: "prevented",
    });
    expect(classifyProvedMistakeNature(input)).toMatchObject({
        nature: "tactical",
        aspect: "allowed",
    });
    expect(
        classifyMistakeReviewMotifs({ ...input, bestMoveUci: "a5d5", pvUci: ["a5d5"] })
            .allowedMotifs[0],
    ).toMatchObject({ id: "drawingCapture", comparison: "persists" });
    expect(
        classifyProvedMistakeNature({ ...input, bestMoveUci: "a5d5", pvUci: ["a5d5"] }).nature,
    ).toBe("unknown");
    expect(
        classifyMistakeReviewMotifs({ ...input, tablebaseEvidence: after.evidence })
            .allowedMotifs[0].comparison,
    ).toBeUndefined();
});

test.each([
    "missing-move",
    "unknown",
    "wrong-side",
    "wrong-clock",
    "duplicate",
    "terminal",
    "false-win",
    "unknown-child",
])("reject broken evidence: %s", (kind) => {
    const row = cases.find((r) => r.id === "king-rook-rescue")!;
    const evidence = structuredClone(row.evidence),
        result = evidence.records[0].result as any;
    if (kind === "missing-move") result.moves.pop();
    if (kind === "unknown") result.category = "unknown";
    if (kind === "wrong-side") evidence.records[0].fen = row.fen.replace(" w ", " b ");
    if (kind === "wrong-clock") evidence.records[0].fen = row.fen.replace("0 1", "1 1");
    if (kind === "duplicate") evidence.records.push(evidence.records[0]);
    if (kind === "terminal") result.insufficient_material = true;
    if (kind === "false-win") result.category = "win";
    if (kind === "unknown-child") result.moves.at(-1).category = "maybe-win";
    expect(proveDrawingCapture(row.fen, row.move, evidence)).toBeNull();
});

test("eligibility excludes a claimable fifty-move draw and invalid moves", () => {
    const row = cases.find((r) => r.id === "king-rook-rescue")!;
    expect(drawingCaptureRequest(row.fen.replace("0 1", "100 1"), row.move)).toBeNull();
    expect(drawingCaptureRequest(row.fen, "e4h8")).toBeNull();
});

test("explicit drawing-capture lookup needs only the real root, no hypothetical pass", async () => {
    const row = cases.find((r) => r.id === "king-rook-rescue")!;
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(row.result)));
    vi.stubGlobal("fetch", fetcher);
    try {
        expect(
            await lookupTacticalEndgameEvidence(row.fen, row.move, new AbortController().signal),
        ).toEqual(row.evidence);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(new URL(fetcher.mock.calls[0][0]).searchParams.get("fen")).toBe(row.fen);
        expect(fetcher.mock.calls[0][1]).toMatchObject({
            credentials: "omit",
            referrerPolicy: "no-referrer",
        });
    } finally {
        vi.unstubAllGlobals();
    }
});
