import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import {
    clearanceKingDefence,
    forcingClearanceEpisodeLength,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";

const fen = "2rr2k1/1p3pp1/1q2p3/p2pP1N1/1n1P4/1Q1B4/1P3P1P/5RK1 b - - 0 21";
const line = [
    "d3h7",
    "g8h8",
    "b3h3",
    "d8d7",
    "h7g6",
    "h8g8",
    "g6f7",
    "g8f8",
    "g5e6",
    "f8f7",
    "e6d4",
];
const freshLine = [
    "d3h7",
    "g8h8",
    "b3h3",
    "d8d7",
    "h7g6",
    "h8g8",
    "g6f7",
    "d7f7",
    "h3h7",
    "g8f8",
    "g5e6",
    "f8e7",
    "e6d4",
    "c8c4",
    "d4f5",
    "f7f5",
    "h7f5",
];

test("a clearance cannot borrow a second queen route after its actual payoff", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: "g8f8",
        playedMoveUci: "b6d4",
        pvUci: ["g8f8"],
        refutationUci: freshLine,
    });
    expect(result.allowedMotifs[0]).toMatchObject({ id: "clearance", ply: 1 });
    for (const motifs of [result.allowedMotifs, result.allowedTimeline!]) {
        expect(motifs.some((m) => m.evidence.includes("Qxf5"))).toBe(false);
        expect(motifs.some((m) => m.id === "clearance" && m.ply === 7)).toBe(false);
        expect(motifs.every((m) => m.ply! <= 13)).toBe(true);
    }
    expect(result.allowedTimeline).toContainEqual(expect.objectContaining({ id: "fork", ply: 11 }));
    expect(result.allowedTimeline!.some((m) => m.id === "pin" && m.ply === 11)).toBe(false);
});

test("the queen-winning fork outranks an unrelated smaller attack on an already pinned pawn", () => {
    const replay = replayTacticalLine(fen, ["b6d4", ...freshLine]);
    expect(replay).toHaveLength(freshLine.length + 1);
    const forkFen = makeFen(replay[11].before.toSetup());
    const result = classifyPositionTacticalMotifs({ fen: forkFen, pvUci: freshLine.slice(10, 13) });
    expect(result.motifs[0]).toMatchObject({ id: "fork", ply: 1 });
    expect(result.motifs.some((m) => m.id === "pin")).toBe(false);
});

test("post-payoff engine play cannot change the clearance lesson or its timeline", () => {
    const input = { fen, bestMoveUci: "g8f8", playedMoveUci: "b6d4", pvUci: ["g8f8"] };
    const bounded = classifyMistakeReviewMotifs({
        ...input,
        refutationUci: freshLine.slice(0, 13),
    });
    const longer = classifyMistakeReviewMotifs({ ...input, refutationUci: freshLine });
    expect(longer.allowedMotifs).toEqual(bounded.allowedMotifs);
    expect(longer.allowedTimeline).toEqual(bounded.allowedTimeline);
});

test("the reflected full combination retains the fork but no post-payoff clearance or incidental pin", () => {
    const reflected = "5rk1/1p3p1p/1q1b4/1N1p4/P2Pp1n1/1Q2P3/1P3PP1/2RR2K1 w - - 0 21";
    const reflect = (uci: string) => uci.replace(/[1-8]/g, (rank) => String(9 - Number(rank)));
    const result = classifyMistakeReviewMotifs({
        fen: reflected,
        bestMoveUci: "g1f1",
        playedMoveUci: "b3d5",
        pvUci: ["g1f1"],
        refutationUci: freshLine.map(reflect),
    });
    expect(result.allowedTimeline).toContainEqual(expect.objectContaining({ id: "fork", ply: 11 }));
    expect(
        result.allowedTimeline!.some(
            (m) => (m.id === "clearance" && m.ply === 7) || (m.id === "pin" && m.ply === 11),
        ),
    ).toBe(false);
});
test("the king can escape before the cleared queen routes are used", () => {
    const better = replayTacticalLine(fen, ["g8f8", "d3h7"])[1];
    const proof = clearanceKingDefence(better);
    expect(proof?.defence).toBe("Ke7");
    expect(proof?.routes.map((route) => route.preparation)).toEqual([
        "Qd3",
        "Qe3",
        "Qf3",
        "Qg3",
        "Qh3",
    ]);
    expect(proof?.routes).toContainEqual({ preparation: "Qf3", reply: "f5" });
});

test("the actual checking clearance has a verified comparison without a premature fork", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: "g8f8",
        playedMoveUci: "b6d4",
        pvUci: ["g8f8"],
        refutationUci: line,
    });
    expect(result.allowedMotifs[0]).toMatchObject({
        id: "clearance",
        comparison: "prevented",
        ply: 1,
    });
    expect(result.allowedMotifs[0].comparisonEvidence).toContain("Ke7");
    expect(buildMistakeReviewTacticalExplanation(result)?.title).toBe(
        "Why the move was tactically bad",
    );
    expect(result.allowedMotifs.some((motif) => motif.id === "fork" && motif.ply === 1)).toBe(
        false,
    );
    expect(result.allowedTimeline).toContainEqual(expect.objectContaining({ id: "fork", ply: 9 }));
    expect(result.allowedTimeline?.every((motif) => motif.ply! <= 11)).toBe(true);
});

test("the proved clearance episode ends at its queen-winning payoff", () => {
    const start = replayTacticalLine(fen, ["b6d4"])[0].after;
    const tactical = replayTacticalLine(makeFen(start.toSetup()), [...line, "d7c7", "h3e6"]);
    expect(tactical).toHaveLength(13);
    expect(forcingClearanceEpisodeLength(tactical)).toBe(11);
});

test("an extra quiet attacking move cannot borrow the clearance's episode extension", () => {
    const start = makeFen(replayTacticalLine(fen, ["b6d4"])[0].after.toSetup());
    const delayed = [
        "d3h7",
        "g8h8",
        "b3h3",
        "d8d7",
        "b2b3",
        "g7g6",
        "h7g6",
        "h8g8",
        "g6f7",
        "g8f8",
        "g5e6",
        "f8f7",
        "e6d4",
    ];
    const replay = replayTacticalLine(start, delayed);
    expect(replay).toHaveLength(13);
    expect(forcingClearanceEpisodeLength(replay)).toBeNull();
});

test("a different queen preparation does not inherit the independently proved branch", () => {
    const start = makeFen(replayTacticalLine(fen, ["b6d4"])[0].after.toSetup());
    const different = [...line];
    different[2] = "b3f3";
    different[9] = "f8e7";
    const replay = replayTacticalLine(start, different);
    expect(replay).toHaveLength(11);
    expect(forcingClearanceEpisodeLength(replay)).toBeNull();
});

test("reflection preserves the causal king defence and later fork", () => {
    const reflected = "5rk1/1p3p1p/1q1b4/1N1p4/P2Pp1n1/1Q2P3/1P3PP1/2RR2K1 w - - 0 21";
    const reflect = (uci: string) => uci.replace(/[1-8]/g, (rank) => String(9 - Number(rank)));
    const result = classifyMistakeReviewMotifs({
        fen: reflected,
        bestMoveUci: "g1f1",
        playedMoveUci: "b3d5",
        pvUci: ["g1f1"],
        refutationUci: line.map(reflect),
    });
    expect(result.allowedMotifs[0]).toMatchObject({ id: "clearance", comparison: "prevented" });
    expect(result.allowedMotifs[0].comparisonEvidence).toMatch(/Ke[12]/);
    expect(result.allowedTimeline).toContainEqual(expect.objectContaining({ id: "fork", ply: 9 }));
});

test("a capturing clearance root requires a different material comparison", () => {
    const root = replayTacticalLine(fen.replace("1p3pp1", "1p3ppp"), ["g8f8", "d3h7"])[1];
    expect(root.capture).toBe(100);
    expect(clearanceKingDefence(root)).toBeNull();
});

test("a king flight without a newly opened slider route is not a clearance proof", () => {
    const root = replayTacticalLine(fen.replace("1Q1B4", "1N1B4"), ["g8f8", "d3h7"])[1];
    expect(clearanceKingDefence(root)).toBeNull();
});

test("the real checking attack stays dangerous, but Rd7 has its own legal king reply", () => {
    const actual = replayTacticalLine(fen, ["b6d4", "d3h7"])[1];
    const other = replayTacticalLine(fen, ["d8d7", "d3h7"])[1];
    expect(actual.after.isCheck()).toBe(true);
    expect(other.after.isCheck()).toBe(true);
    expect(clearanceKingDefence(actual)).toBeNull();
    expect(clearanceKingDefence(other)?.defence).toBe("Kf8");
    const result = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: "d8d7",
        playedMoveUci: "b6d4",
        pvUci: ["d8d7"],
        refutationUci: line,
    });
    expect(result.allowedMotifs[0]).toMatchObject({ id: "clearance", comparison: "prevented" });
    expect(result.allowedMotifs[0].comparisonEvidence).toContain("Kf8 answers Bh7+");
    expect(result.allowedMotifs[0].comparisonEvidence).not.toContain("not check");
});

test("f5 prevents Bh7 by blocking the bishop's route, not by a fictional king escape", () => {
    expect(replayTacticalLine(fen, ["f7f5", "d3h7"])).toHaveLength(1);
    const result = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: "f7f5",
        playedMoveUci: "b6d4",
        pvUci: ["f7f5"],
        refutationUci: line,
    });
    expect(result.allowedMotifs[0]).toMatchObject({ id: "clearance", comparison: "prevented" });
    expect(result.allowedMotifs[0].comparisonEvidence).toContain("illegal");
});

test("an extra protected f7 capture defeats the proposed king escape", () => {
    const position = fen.replace("1q2p3", "1q2P3").replace("p2pP1N1", "p2p2N1");
    const root = replayTacticalLine(position, ["g8f8", "d3h7"])[1];
    const capture = replayTacticalLine(position, ["g8f8", "d3h7", "f8e7", "g5f7", "e7f7"]);
    expect(capture).toHaveLength(4);
    expect(clearanceKingDefence(root)).toBeNull();
});

test.each([0, 1, -1, Infinity, NaN])(
    "incomplete budgets do not certify a king escape: %s",
    (budget) => {
        const root = replayTacticalLine(fen, ["g8f8", "d3h7"])[1];
        expect(clearanceKingDefence(root, budget)).toBeNull();
    },
);
