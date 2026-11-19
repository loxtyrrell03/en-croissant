import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import { extractPositionalTransitions } from "../tacticalMotifs/positionalTransitions";

const fen = "3r4/4k2p/8/8/1N6/8/7P/6K1 w - - 0 1";
// Synthetic score payloads exercise the evidence contract. They are not an
// engine benchmark or reference labels for real chess strength.
const best = {
    fen,
    depth: 18,
    cp: 200,
    pvUci: ["b4c6", "e7f7", "c6d8", "f7g6", "g1f2", "g6f5", "f2e3", "f5e5"],
};
const other = {
    fen,
    depth: 18,
    cp: 0,
    pvUci: ["b4d5", "e7f7", "g1f2", "f7g6", "f2e3", "g6f5", "e3d3", "f5e5"],
};
const after = makeFen(replayTacticalLine(fen, [best.pvUci[0]])[0].after.toSetup());
const probe = {
    moveUci: best.pvUci[0],
    lines: [{ fen: after, depth: 18, cp: -200, pvUci: best.pvUci.slice(1) }],
};

test("a legal pattern needs separately corroborated replies and a connected outcome", () => {
    const withoutProbe = assessChessDecision({ fen, candidates: [best, other] })!;
    expect(withoutProbe.moves[0].tactical.support).toBe("suggestive");
    expect(withoutProbe.moves[0].category).toBe("unclear");
    const confirmed = assessChessDecision({
        fen,
        candidates: [best, other],
        replyProbes: [probe],
    })!;
    expect(confirmed.moves[0].tactical).toMatchObject({
        support: "supported",
        basis: "engine-supported",
    });
    expect(confirmed.moves[0].positional.support).toBe("unestablished");
    expect(confirmed.mistake).toBeNull();
});

test("mismatched, shallow, divergent or bound reply searches do not corroborate a tactic", () => {
    for (const changed of [{ fen }, { depth: 10 }, { cp: 200 }, { upperbound: true }]) {
        const report = assessChessDecision({
            fen,
            candidates: [best, other],
            replyProbes: [{ ...probe, lines: [{ ...probe.lines[0], ...changed }] }],
        })!;
        expect(report.moves[0].tactical.support).toBe("suggestive");
    }
});

test("mistake attribution requires the actual evaluated played move and loss", () => {
    const input = { fen, candidates: [best, other], replyProbes: [probe] };
    expect(assessChessDecision({ ...input, playedMoveUci: best.pvUci[0] })?.mistake).toBeNull();
    expect(assessChessDecision({ ...input, playedMoveUci: "g1h1" })?.mistake).toBeNull();
    const mistake = assessChessDecision({ ...input, playedMoveUci: other.pvUci[0] })?.mistake;
    expect(mistake).toMatchObject({ evaluationLossCp: 200, category: "tactical", allowed: [] });
    expect(mistake?.missed[0].mechanism).toBe("fork");
    const almostEqual = { ...other, cp: 190 };
    expect(
        assessChessDecision({
            ...input,
            candidates: [best, almostEqual],
            playedMoveUci: other.pvUci[0],
        })?.mistake,
    ).toBeNull();
});

test("a lasting structural change records what changed, not an assumed cause", () => {
    const position = "3r2k1/1p6/2b5/8/3P4/4B3/P2Nq1PP/R5K1 b - - 0 1";
    const line = {
        fen: position,
        depth: 18,
        cp: 50,
        pvUci: ["d8d4", "e3d4", "e2d2", "a1f1", "g8h7", "g1h1", "h7g6", "h1g1"],
    };
    const changes = extractPositionalTransitions(position, line);
    expect(changes).toContainEqual(
        expect.objectContaining({
            feature: "pawn-stable-minor",
            squareOrFile: "c6",
            firstPly: 1,
            lastConsecutivePly: 8,
            support: "board-fact",
        }),
    );
    expect(changes.every((item) => !("evaluationContribution" in item))).toBe(true);
});

test("incoherent root evidence cannot produce a report", () => {
    expect(assessChessDecision({ fen, candidates: [best, best] })).toBeNull();
    expect(assessChessDecision({ fen, candidates: [{ ...best, pvUci: ["b4b8"] }] })).toBeNull();
});

test("an allowed fork is diagnosed independently of the quiet better move", () => {
    const root = "7k/p7/8/8/6n1/7K/P7/3Q4 w - - 0 1";
    const better = {
        fen: root,
        depth: 18,
        cp: 200,
        pvUci: ["h3g3", "g4e3", "d1f3", "h8g7", "g3f2", "e3f5", "f3d3", "g7f6"],
    };
    const played = {
        fen: root,
        depth: 18,
        cp: -200,
        pvUci: ["h3g2", "g4e3", "g2f2", "e3d1", "f2e2", "h8g7", "e2d2", "d1f2"],
    };
    const reached = makeFen(replayTacticalLine(root, [played.pvUci[0]])[0].after.toSetup());
    const report = assessChessDecision({
        fen: root,
        candidates: [better, played],
        playedMoveUci: played.pvUci[0],
        replyProbes: [
            {
                moveUci: played.pvUci[0],
                lines: [{ ...played, fen: reached, cp: 200, pvUci: played.pvUci.slice(1) }],
            },
        ],
    })!;
    expect(report.moves[0].tactical.support).toBe("unestablished");
    expect(report.mistake?.tactical.support).toBe("supported");
    expect(report.mistake?.missed).toEqual([]);
    expect(report.mistake?.allowed).toContainEqual(
        expect.objectContaining({ fen: reached, mechanism: "fork" }),
    );
});

test("existing mistake certificates preserve their exact board and move ownership", () => {
    const input = {
        fen,
        candidates: [best, other],
        playedMoveUci: other.pvUci[0],
        mistakeCertificate: {
            fen,
            bestMoveUci: best.pvUci[0],
            playedMoveUci: other.pvUci[0],
            tactical: true,
            reasons: ["A bounded legacy proof established a tactical cause."],
        },
    };
    expect(assessChessDecision(input)?.mistake?.tactical.basis).toBe("bounded-proof");
    for (const changed of [{ fen: after }, { playedMoveUci: best.pvUci[0] }, { tactical: false }]) {
        expect(
            assessChessDecision({
                ...input,
                mistakeCertificate: { ...input.mistakeCertificate, ...changed },
            })?.mistake?.category,
        ).toBe("unclear");
    }
});
