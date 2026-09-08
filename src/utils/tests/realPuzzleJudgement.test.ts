import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { replayTacticalLine, tacticalBoardEvidence } from "@/utils/tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "@/utils/tacticalMotifs/mistakeReviewAdapter";

type RealPuzzle = {
    id: string;
    startFen: string;
    bestLine: string[];
    judgement: string;
    observedEngineLine?: string[];
};
const fixture: { cases: RealPuzzle[] } = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/real-puzzle-development.json", "utf8"),
);
const puzzle = (id: string) => fixture.cases.find((item) => item.id === `lichess:${id}`)!;

test("record all twelve real development puzzles, including unresolved findings", () => {
    const report = fixture.cases.map((item) => {
        const steps = replayTacticalLine(item.startFen, item.bestLine);
        expect(steps).toHaveLength(item.bestLine.length);
        const started = performance.now();
        const result = classifyPositionTacticalMotifs({ fen: item.startFen, pvUci: item.bestLine });
        return {
            ...item,
            san: steps.map((s) => s.san),
            result,
            classificationMs: performance.now() - started,
        };
    });
    expect(report).toHaveLength(12);
    if (process.env.TACTICAL_REAL_PUZZLE_REPORT)
        writeFileSync(process.env.TACTICAL_REAL_PUZZLE_REPORT, JSON.stringify(report, null, 2));
    // Legal replay/report creation is NOT an assertion that every lesson is correct.
});

test.each([
    ["1DoTa", "fork", 3],
    ["1GRFo", "interference", 1],
    ["48ION", "interference", 1],
    ["2QybO", "discoveredAttack", 1],
    ["2Gc77", "capturingDefender", 1],
    ["2SvDe", "intermezzo", 1],
    ["9THyd", "intermezzo", 1],
] as const)("retain the judged cause in %s", (id, expected, ply) => {
    const item = puzzle(id);
    const result = classifyPositionTacticalMotifs({ fen: item.startFen, pvUci: item.bestLine });
    expect(result.motifs[0]).toMatchObject({ id: expected, ply });
});

test("the incidental pawn discovery does not borrow the knight fork's payoff", () => {
    const item = puzzle("1DoTa");
    const result = classifyPositionTacticalMotifs({ fen: item.startFen, pvUci: item.bestLine });
    expect(result.motifs.map((m) => m.id)).not.toContain("discoveredAttack");
    expect(result.timeline?.some((m) => m.id === "discoveredAttack" && m.ply === 3)).toBe(false);
});

test.each(["1GRFo", "48ION"])("shows the defender attack and later payoff in %s", (id) => {
    const item = puzzle(id);
    const result = classifyPositionTacticalMotifs({ fen: item.startFen, pvUci: item.bestLine });
    expect(result.timeline).toContainEqual(expect.objectContaining({ id: "hangingPiece", ply: 3 }));
    const board = tacticalBoardEvidence(item.startFen, item.bestLine, result.motifs[0]);
    expect(board?.arrows).toContainEqual(
        id === "1GRFo" ? { from: "b4", to: "a3" } : { from: "c7", to: "b8" },
    );
    expect(result.motifs[0].evidence).toContain("attacks that queen");
});

test.each(["2SvDe", "8DHuj", "9THyd"])(
    "later engine moves cannot invent root clearance in %s",
    (id) => {
        const item = puzzle(id);
        expect(replayTacticalLine(item.startFen, item.observedEngineLine!)).toHaveLength(
            item.observedEngineLine!.length,
        );
        const result = classifyPositionTacticalMotifs({
            fen: item.startFen,
            pvUci: item.observedEngineLine!,
        });
        expect(result.motifs.map((m) => m.id)).not.toContain("clearance");
        // The defender-removal/zwischenzug lesson is still an explicit open issue.
    },
);

test("capturing the bishop blocker loses the queen, not the defended knight", () => {
    const item = puzzle("1GRFo");
    const pvUci = ["d2b4", "a3b4", "b1b4"];
    const steps = replayTacticalLine(item.startFen, pvUci);
    expect(steps).toHaveLength(3);
    expect(steps[2].balance).toBe(570);
    expect(classifyPositionTacticalMotifs({ fen: item.startFen, pvUci }).motifs[0]?.id).toBe(
        "interference",
    );
});

test("the blocking pawn's promotion answers a knight escape", () => {
    const item = puzzle("48ION");
    const pvUci = ["c6c7", "f4d3", "c7c8q", "b8c8", "c1c8"];
    const steps = replayTacticalLine(item.startFen, pvUci);
    expect(steps).toHaveLength(5);
    expect(steps[4].balance).toBe(800);
    const result = classifyPositionTacticalMotifs({ fen: item.startFen, pvUci });
    expect(result.motifs[0]?.id).toBe("interference");
    expect(result.motifs[0].evidence).toContain("promotion of the blocking pawn");
});
