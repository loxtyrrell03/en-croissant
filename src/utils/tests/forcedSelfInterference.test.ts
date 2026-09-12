import { readFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import {
    proveSelfInterference,
    proveForcedSelfInterference,
    replayTacticalLine,
    tacticalBoardEvidence,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

const fixture = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/rare-theme-development.json", "utf8"),
);
const real = fixture.cases.find((r: { id: string }) => r.id === "lichess:zYjb5");
const fen = real.startFen as string,
    line = real.bestLine as string[];

test("the forcing check explains the defensive ray, not a generic checking attack", () => {
    const steps = replayTacticalLine(fen, line);
    const proof = proveForcedSelfInterference(steps[0]);
    // Kxc3 is a legal checking evasion after Qxd7+: debit that pawn.
    expect(proof).toMatchObject({
        gain: 400,
        branches: [{ reply: "Kd3", proof: { captureSan: "Qxd7+", gain: 400 } }],
    });
    for (const pvUci of [[line[0]], line]) {
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs.map((m) => m.id)).toEqual(["interference"]);
        expect(result.motifs[0]).toMatchObject({ label: "Forced Interference", ply: 1 });
        expect(result.motifs[0].evidence).toContain("Every legal check evasion");
    }
});

test("the defender's self-interference and material payoff stay at their actual plies", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.timeline?.map((m) => [m.id, m.ply, m.actor])).toEqual([
        ["interference", 1, "white"],
        ["selfInterference", 2, "black"],
        ["hangingPiece", 3, "white"],
    ]);
    expect(result.timeline?.[1].evidence).toContain("not a tactic won by Black");
    expect(tacticalBoardEvidence(fen, line, result.timeline![1])).toEqual({
        square: "d3",
        arrows: [
            { from: "d1", to: "d3" },
            { from: "c6", to: "d7" },
        ],
    });
    const scan = buildLiveTacticalScan({ fen, pvUci: line, depth: 16, engineName: "Source" });
    expect(scan.motifs[0].id).toBe("interference");
    expect(scan.variations[0].timeline.map((m) => m.id)).toContain("selfInterference");
});

test("missing later moves do not fabricate a defensive timeline event", () => {
    expect(
        classifyPositionTacticalMotifs({ fen, pvUci: [line[0]] }).timeline?.map((m) => m.id),
    ).toEqual(["interference"]);
});

test("the evasion is not presented as an offensive tactic for the defender", () => {
    const steps = replayTacticalLine(fen, line);
    const reached = classifyPositionTacticalMotifs({
        fen: makeFen(steps[0].after.toSetup()),
        pvUci: line.slice(1),
    });
    expect(reached.motifs.some((m) => m.id === "selfInterference")).toBe(false);
});

test("a legal alternative king flight prevents a forced-interference root claim", () => {
    const open = "8/3r4/5Q2/8/2k5/8/7K/3q4 w - - 0 1";
    const steps = replayTacticalLine(open, line);
    expect(steps).toHaveLength(3);
    expect(proveSelfInterference(steps[1])).not.toBeNull();
    expect(proveForcedSelfInterference(steps[0])).toBeNull();
    expect(replayTacticalLine(open, [line[0], "c4b4"])).toHaveLength(2);
    expect(
        classifyPositionTacticalMotifs({ fen: open, pvUci: line }).motifs.some(
            (m) => m.id === "interference" && m.ply === 1,
        ),
    ).toBe(false);
});

test.each([
    ["8/r2r4/5Q2/p6P/2k5/2P5/P3pBPK/3q4 w - - 9 66", "a second rook legally recaptures the queen"],
    ["8/3r4/5Q2/p6P/2k5/2P5/P3pBPK/8 w - - 9 66", "the rook was already undefended"],
] as const)("the ray must really cause new profit: %s (%s)", (position, _reason) => {
    const steps = replayTacticalLine(position, line);
    expect(steps).toHaveLength(3);
    expect(proveSelfInterference(steps[1])).toBeNull();
    expect(proveForcedSelfInterference(steps[0])).toBeNull();
});

test("capturing a queen cannot be called a new loss merely because it concedes a rook", () => {
    const steps = replayTacticalLine("8/R2r4/8/8/4k3/3Q4/7K/3q4 b - - 0 1", ["e4d3"]);
    expect(steps).toHaveLength(1);
    expect(proveSelfInterference(steps[0])).toBeNull();
});

test.each([0, 1, -1, 1.5, NaN, Infinity])(
    "partial or invalid proof budgets cannot borrow cached success: %s",
    (limit) => {
        const steps = replayTacticalLine(fen, line);
        expect(proveForcedSelfInterference(steps[0])).not.toBeNull();
        expect(proveForcedSelfInterference(steps[0], limit)).toBeNull();
        expect(proveSelfInterference(steps[1], limit)).toBeNull();
    },
);

test("Black's reflected checking combination has the same cause and correctly owned secondary", () => {
    const parts = fen.split(" ");
    parts[0] = parts[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-z]/gi, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));
    parts[1] = "b";
    const pvUci = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    const result = classifyPositionTacticalMotifs({ fen: parts.join(" "), pvUci });
    expect(result.motifs[0]).toMatchObject({ id: "interference", value: 400 });
    expect(result.timeline?.[1]).toMatchObject({ id: "selfInterference", actor: "white", ply: 2 });
});

test("missing the checking move teaches interference, not a future loose rook", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: line[0],
        playedMoveUci: "f6f3",
        pvUci: line,
    });
    expect(result.missedMotifs[0]).toMatchObject({ id: "interference", ply: 1 });
    expect(buildMistakeReviewTacticalExplanation(result)?.primary).toMatchObject({
        id: "interference",
        source: "missed",
    });
    expect(result.missedTimeline?.some((m) => m.id === "selfInterference" && m.ply === 2)).toBe(
        true,
    );
});

test("the supplied zugzwang tag does not replace the pinned-knight lesson", () => {
    const row = fixture.cases.find((r: { id: string }) => r.id === "lichess:IKbcw");
    expect(row.sourceThemes).toContain("zugzwang");
    const result = classifyPositionTacticalMotifs({ fen: row.startFen, pvUci: row.bestLine });
    expect(result.motifs[0].id).toBe("pin");
    expect(result.motifs.map((m) => m.id)).not.toContain("zugzwang");
});
