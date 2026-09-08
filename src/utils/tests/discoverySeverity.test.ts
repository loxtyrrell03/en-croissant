import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";

const fen = "Q2b1rk1/p1p2ppp/1p1p4/3N4/7P/5NPB/PPP1P3/2KR4 w - - 1 20";
const input = {
    fen,
    bestMoveUci: "f3d4",
    playedMoveUci: "f3g5",
    pvUci: ["f3d4"],
    refutationUci: ["d8g5", "h4g5", "f8a8"],
};

test("Ng5 makes an existing checking discovery more costly rather than creating it", () => {
    const result = classifyMistakeReviewMotifs(input);
    expect(result.allowedMotifs[0]).toMatchObject({
        id: "discoveredAttack",
        comparison: "reduced",
    });
    expect(result.allowedMotifs[0].comparisonEvidence).toContain("5.7 pawns rather than 8.9");
    expect(result.allowedMotifs[0].comparisonEvidence).toContain("hxg5");
    expect(buildMistakeReviewTacticalExplanation(result)?.text).toContain(
        "made an existing tactic more costly",
    );
    expect(result.allowedTimeline?.[0].comparison).toBe("reduced");
});

test("both discovered attacks and their different material costs are real", () => {
    for (const [move, gain] of [
        ["f3g5", 890],
        ["f3d4", 570],
    ] as const) {
        const line = replayTacticalLine(fen, [move, "d8g5", "h4g5", "f8a8"]);
        expect(line).toHaveLength(4);
        expect(line[1].after.isCheck()).toBe(true);
        expect(line[3].balance).toBe(-gain);
        const result = classifyPositionTacticalMotifs({
            fen: makeFen(line[0].after.toSetup()),
            pvUci: input.refutationUci,
        });
        expect(result.motifs[0]).toMatchObject({ id: "discoveredAttack", value: gain });
    }
});

test("the frozen full engine line has the same local severity comparison", () => {
    const rows = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/ordinary-adjacent-stockfish-18.json", "utf8"),
    );
    const row = rows.find((row: { id: string }) => row.id === "ordinary-1:ply39");
    const result = classifyMistakeReviewMotifs({
        ...input,
        pvUci: row.before[0].pvUci,
        refutationUci: row.after[0].pvUci,
    });
    expect(result.allowedMotifs[0]).toMatchObject({
        id: "discoveredAttack",
        comparison: "reduced",
    });
});

test("reflection preserves the relative cost, not the colour of the attacker", () => {
    const reflected = "2kr4/ppp1p3/5npb/7p/3n4/1P1P4/P1P2PPP/q2B1RK1 b - - 1 20";
    const flip = (uci: string) => uci.replace(/[1-8]/g, (rank) => String(9 - Number(rank)));
    const result = classifyMistakeReviewMotifs({
        fen: reflected,
        bestMoveUci: flip(input.bestMoveUci),
        playedMoveUci: flip(input.playedMoveUci),
        pvUci: input.pvUci.map(flip),
        refutationUci: input.refutationUci.map(flip),
    });
    expect(result.allowedMotifs[0]).toMatchObject({
        id: "discoveredAttack",
        comparison: "reduced",
    });
    expect(result.allowedMotifs[0].comparisonEvidence).toContain("5.7 pawns rather than 8.9");
});

test("two choices with the same exchange cost retain existing danger", () => {
    const result = classifyMistakeReviewMotifs({ ...input, playedMoveUci: "f3e5" });
    expect(result.allowedMotifs[0]).toMatchObject({
        id: "discoveredAttack",
        comparison: "persists",
    });
    expect(buildMistakeReviewTacticalExplanation(result)?.text).not.toContain(
        "made an existing tactic more costly",
    );
});

test("removing the recapturing pawn changes the verified cost and legal defence", () => {
    const result = classifyMistakeReviewMotifs({ ...input, fen: fen.replace("7P", "8") });
    expect(result.allowedMotifs[0]).toMatchObject({
        id: "discoveredAttack",
        comparison: "reduced",
    });
    expect(result.allowedMotifs[0].comparisonEvidence).toContain("9.0 pawns rather than 12.2");
    expect(result.allowedMotifs[0].comparisonEvidence).not.toContain("hxg5");
});

test("a missing discovered victim cannot inherit the old material verdict", () => {
    const result = classifyMistakeReviewMotifs({ ...input, fen: fen.replace("Q2b1rk1", "3b1rk1") });
    expect(result.allowedMotifs.some((m) => m.id === "discoveredAttack")).toBe(false);
});

test("an alternative user capture or changed discovery targets is not a comparable exchange", () => {
    const result = classifyMistakeReviewMotifs({ ...input, bestMoveUci: "a8a7", pvUci: ["a8a7"] });
    expect(result.allowedMotifs[0].id).toBe("discoveredAttack");
    expect(result.allowedMotifs[0].comparison).toBeUndefined();
});

test("playing the engine's best move never becomes a costlier-discovery accusation", () => {
    const result = classifyMistakeReviewMotifs({
        ...input,
        bestMoveUci: input.playedMoveUci,
        pvUci: [input.playedMoveUci],
    });
    expect(result.allowedMotifs[0].comparison).toBe("persists");
});
