import { expect, test } from "vitest";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { normalizeContinuingTactics, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import type { TacticalMotifEvidence } from "../tacticalMotifs/types";
import { directMaterialPayoffCases, reflectPayoff } from "./fixtures/directMaterialPayoff";

test.each([...directMaterialPayoffCases, ...directMaterialPayoffCases.map(reflectPayoff)])(
    "keeps $id as the cause and links its actual capture",
    (row) => {
        const result = classifyPositionTacticalMotifs(row);
        expect(replayTacticalLine(row.fen, row.pvUci)).toHaveLength(3);
        expect(result.motifs[0]).toMatchObject({ id: row.theme, ply: 1 });
        expect(result.timeline).toContainEqual(
            expect.objectContaining({
                id: "hangingPiece",
                label: row.label,
                ply: 3,
                moveUci: row.pvUci[2],
                value: row.value,
            }),
        );
        expect(result.motifs).not.toContainEqual(expect.objectContaining({ label: row.label }));
        expect(
            normalizeContinuingTactics(replayTacticalLine(row.fen, row.pvUci), result.timeline!),
        ).toEqual(result.timeline);
    },
);

test("live root arrows remain the discovery, while the capture retains its actual move", () => {
    const row = directMaterialPayoffCases[0];
    const scan = buildLiveTacticalScan({ ...row, depth: 16, engineName: "Fixture" });
    expect(scan.labels.map((label) => label.text)).toEqual(["Discovered Attack"]);
    expect(scan.arrows.map((arrow) => [arrow.from, arrow.to, arrow.ply])).toEqual([
        ["d5", "e7", 1],
        ["d1", "d7", 1],
        ["e7", "g8", 1],
    ]);
    expect(scan.variations[0].timeline.find((motif) => motif.ply === 3)).toMatchObject({
        label: "Discovery Payoff",
        moveUci: "d1d7",
        actor: "white",
        value: 320,
    });
});

const real = directMaterialPayoffCases[0];
const steps = replayTacticalLine(real.fen, real.pvUci);
const classified = classifyPositionTacticalMotifs(real);
const root = classified.timeline!.find((motif) => motif.ply === 1)!;
const capture = {
    ...classified.timeline!.find((motif) => motif.ply === 3)!,
    label: "Hanging Piece",
    evidence: "Independently audited capture",
};

test.each([
    { name: "a capture selected as the primary", changed: { relevance: "primary" } },
    { name: "different source ownership", changed: { source: "missed" } },
    { name: "a different capture move", changed: { moveUci: "d1d3" } },
    { name: "an incidental lower-value capture", changed: { value: 100 } },
    { name: "an already specialized payoff", changed: { label: "Deflection Payoff" } },
] as const)("does not overwrite $name", ({ changed }) => {
    const candidate = { ...capture, ...changed } as TacticalMotifEvidence;
    expect(normalizeContinuingTactics(steps, [root, candidate])).toEqual([root, candidate]);
});

test("a supplied theme cannot bypass independent mechanism verification", () => {
    const falsePin = { ...root, id: "pin", label: "Pin" };
    expect(normalizeContinuingTactics(steps, [falsePin, capture])).toEqual([falsePin, capture]);
});

test("a capture after another quiet turn cannot borrow the old discovery", () => {
    const line = ["d5e7", "g8f8", "d1d3", "h5h4", "d3d7"];
    const replay = replayTacticalLine(real.fen, line);
    expect(replay).toHaveLength(5);
    const delayed = { ...capture, ply: 5, moveUci: "d3d7" };
    expect(normalizeContinuingTactics(replay, [root, delayed])).toEqual([root, delayed]);
});

test("a different capturing piece does not borrow the knight fork", () => {
    const fen = "2q1k3/8/8/5B2/4N3/8/8/6K1 w - - 0 1";
    const line = ["e4d6", "e8f8", "f5c8"];
    const replay = replayTacticalLine(fen, line);
    expect(replay).toHaveLength(3);
    const prior: TacticalMotifEvidence = {
        ...root,
        id: "fork",
        label: "Fork",
        moveUci: line[0],
        value: 580,
    };
    const collected = { ...capture, moveUci: line[2], value: 900 };
    expect(normalizeContinuingTactics(replay, [prior, collected])).toEqual([prior, collected]);
});

test("a pin with a legal king recapture does not inherit a material-payoff certificate", () => {
    const row = directMaterialPayoffCases[3];
    const fen = row.fen.replace("5P2", "8");
    const replay = replayTacticalLine(fen, [...row.pvUci, "f7e7"]);
    expect(replay).toHaveLength(4);
    const prior = { ...root, id: "pin", label: "Pin", moveUci: row.pvUci[0] };
    const collected = { ...capture, moveUci: row.pvUci[2] };
    expect(normalizeContinuingTactics(replay, [prior, collected])).toEqual([prior, collected]);
});

test("an opponent's new fork remains distinct from the primary queen capture", () => {
    const result = classifyPositionTacticalMotifs({
        fen: "6k1/8/4q3/8/1n6/8/4R3/R3K3 w Q - 0 1",
        pvUci: ["e2e6", "b4c2", "e1d1", "c2a1"],
    });
    expect(result.motifs[0]).toMatchObject({ id: "hangingPiece", label: "Hanging Piece", ply: 1 });
    expect(result.timeline).toContainEqual(
        expect.objectContaining({ id: "fork", ply: 2, actor: "black" }),
    );
    expect(result.timeline).toContainEqual(
        expect.objectContaining({ label: "Fork Payoff", ply: 4, actor: "black" }),
    );
});

test("missing the discovery retains its cause and labels the better-line capture as a payoff", () => {
    const result = classifyMistakeReviewMotifs({
        fen: real.fen,
        playedMoveUci: "h1g1",
        bestMoveUci: real.pvUci[0],
        pvUci: real.pvUci,
        refutationUci: ["a5c5"],
    });
    expect(result.missedMotifs[0]).toMatchObject({
        id: "discoveredAttack",
        ply: 1,
        source: "missed",
    });
    expect(result.missedTimeline).toContainEqual(
        expect.objectContaining({ label: "Discovery Payoff", ply: 3, source: "missed" }),
    );
});
