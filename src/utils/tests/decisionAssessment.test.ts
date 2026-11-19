import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import { extractPositionalTransitions } from "../tacticalMotifs/positionalTransitions";
import { corroboratePositionalEffects } from "../tacticalMotifs/positionalTransitions";
import {
    compareLostOutpost,
    comparePositionalTransitions,
} from "../tacticalMotifs/positionalTransitions";

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

test("a played move can give up an established outpost without creating a new feature", () => {
    const position = "2r3k1/p5pp/4N3/5P2/8/8/P5PP/3R2K1 w - - 0 1";
    const keep = { fen: position, cp: 80, depth: 18, pvUci: ["a2a3", "h7h6", "g1f2", "g8h7"] };
    const leave = { fen: position, cp: 0, depth: 18, pvUci: ["e6f4", "h7h6", "g1f2", "g8h7"] };
    expect(compareLostOutpost(position, keep, leave)).toMatchObject({
        feature: "pawn-stable-minor",
        squareOrFile: "e6",
        materialWindowPlies: 4,
        interpretation: "heuristic",
    });
    const report = assessChessDecision({
        fen: position,
        candidates: [keep, leave],
        playedMoveUci: "e6f4",
    });
    expect(report?.mistake?.positional.support).toBe("supported");
    expect(
        compareLostOutpost(position, keep, {
            ...leave,
            pvUci: ["e6f4", "h7h6", "f4e6", "g8h7"],
        }),
    ).toBeNull();
});

test("strategic comparisons use equivalent early windows before unrelated late captures", () => {
    const position = "1rbq2k1/5ppp/p7/8/8/8/PP3PPP/R1BQ2K1 w - - 0 1";
    const space = {
        fen: position,
        depth: 18,
        cp: 80,
        pvUci: ["a2a4", "c8b7", "d1e2", "b7d5", "g2g3", "h7h6", "a4a5", "b8b2"],
    };
    const quiet = {
        fen: position,
        depth: 18,
        cp: 0,
        pvUci: ["h2h3", "d8e7", "d1e2", "g7g6", "g2g3", "h7h6", "b2b3", "c8b7"],
    };
    expect(comparePositionalTransitions(position, space, [quiet])).toContainEqual(
        expect.objectContaining({
            feature: "pawn-space",
            squareOrFile: "a4",
            materialWindowPlies: 6,
        }),
    );
    const transposes = {
        ...quiet,
        pvUci: ["h2h3", "d8e7", "a2a4", "g7g6", "g2g3", "h7h6", "b2b3", "c8b7"],
    };
    expect(
        comparePositionalTransitions(position, space, [transposes]).some(
            (item) => item.feature === "pawn-space",
        ),
    ).toBe(false);
});

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
    expect(confirmed.mistakeStatus).toBe("not-requested");
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
    expect(assessChessDecision({ ...input, playedMoveUci: "g1h1" })?.mistakeStatus).toBe(
        "comparison-unavailable",
    );
    expect(assessChessDecision({ ...input, playedMoveUci: best.pvUci[0] })?.mistakeStatus).toBe(
        "best-supplied-choice",
    );
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
    // Rook for minor/pawn changes the material balance by -0.8 points. That
    // must not erase the separately confirmed structural compensation.
    expect(corroboratePositionalEffects(position, line, line)).toContainEqual(
        expect.objectContaining({
            feature: "pawn-stable-minor",
            comparison: "separate-reply-search",
            interpretation: "heuristic",
        }),
    );
});

test("a later capture does not erase a bounded strategic window", () => {
    const root = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const line = {
        fen: root,
        depth: 18,
        cp: 30,
        pvUci: ["e2e4", "e7e5", "g1f3", "b8c6", "b1c3", "g8f6", "a2a3", "a7a6", "f3e5"],
    };
    const factors = corroboratePositionalEffects(root, line, line);
    expect(factors).toContainEqual(
        expect.objectContaining({ feature: "pawn-space", materialWindowPlies: 6 }),
    );
    expect(corroboratePositionalEffects(root, line, { ...line, fen })).toEqual([]);
    expect(corroboratePositionalEffects(root, line, { ...line, depth: 8 })).toEqual([]);
    // Without a separate reliable reply search the full assessor must not
    // upgrade this observation merely because its geometric feature is clear.
    expect(
        assessChessDecision({ fen: root, candidates: [line] })?.moves[0].positional.support,
    ).toBe("unestablished");
});

test("incoherent root evidence cannot produce a report", () => {
    expect(assessChessDecision({ fen, candidates: [best, best] })).toBeNull();
    expect(assessChessDecision({ fen, candidates: [{ ...best, pvUci: ["b4b8"] }] })).toBeNull();
    expect(
        assessChessDecision({ fen, candidates: [{ ...best, pvUci: ["b4b8"] }, other] }),
    ).toBeNull();
    expect(assessChessDecision({ fen, candidates: [other, best] })).toBeNull();
});

test("an invalid later continuation cannot erase or replace valid principal evidence", () => {
    const report = assessChessDecision({
        fen,
        candidates: [best, { ...other, pvUci: ["b4d5", "f7g6"] }],
        replyProbes: [probe],
        playedMoveUci: other.pvUci[0],
    })!;
    expect(report.moves.map((move) => move.moveUci)).toEqual([best.pvUci[0]]);
    expect(report.moves[0].tactical.support).toBe("supported");
    expect(report.position).toMatchObject({
        examinedChoices: 1,
        rejectedChoices: 1,
        bestSecondGapCp: null,
    });
    expect(report.mistake).toBeNull();
    expect(report.mistakeStatus).toBe("comparison-unavailable");
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

test("equivalent castling notation is the same supplied choice, not missing error evidence", () => {
    const root = "k7/8/8/8/8/8/8/4K2R w K - 0 1";
    const report = assessChessDecision({
        fen: root,
        candidates: [{ fen: root, depth: 18, cp: 500, pvUci: ["e1h1"] }],
        playedMoveUci: "e1g1",
    });
    expect(report?.mistake).toBeNull();
    expect(report?.mistakeStatus).toBe("best-supplied-choice");
});
