import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import { extractTacticalSequenceWitnesses } from "../tacticalMotifs/tacticalSequenceEvidence";
import type { DecisionEngineLine } from "../tacticalMotifs/decisionEvidence";

function fixture(
    fen: string,
    bestUci: string,
    bestCp: number,
    actualUci: string,
    actualCp: number,
    replies: [string, number][],
) {
    const line = (fen: string, uci: string, cp: number): DecisionEngineLine => ({
        fen,
        pvUci: uci.split(" "),
        cp,
        depth: 18,
    });
    const best = line(fen, bestUci, bestCp);
    const actual = line(fen, actualUci, actualCp);
    const played = replayTacticalLine(fen, actual.pvUci.slice(0, 1))[0];
    const after = makeFen(played.after.toSetup());
    return {
        fen,
        candidates: [best, actual],
        playedMoveUci: played.uci,
        replyProbes: [
            {
                moveUci: played.uci,
                lines: replies.map(([uci, cp]) => line(after, uci, cp)),
            },
        ],
    };
}

const delayedMate = fixture(
    "8/1p3pk1/2n1r2p/p1P4P/3N3Q/8/P3qPP1/5RK1 b - - 1 31",
    "c6d4 h4d4 e2e5 d4g4 g7f8 f1c1",
    0,
    "e6e4 d4f5 g7f8 h4f6 e4g4 f6h8 g4g8 h8h6",
    -686,
    [
        ["d4f5 g7f8 h4f6 e4g4 f5h6 g4g7 h6f5", 675],
        ["h4g3 e2g4 d4f5 g7h7 f5d6", 306],
    ],
);

const quietMate = fixture(
    "r3r1k1/pp1n1ppp/2pb1p2/5Q2/2P5/3BB2P/PP2KPq1/R2R4 w - - 0 19",
    "f5h7 g8f8 h7h8 f8e7 h8h4 g7g6",
    -51,
    "f5d7 d6g3 e2d2 e8e3 d3h7 g8h7 d2e3 g2f2",
    -362,
    [
        ["d6g3 e2d2 e8e3 d3h7 g8h7 d2e3 g2f2", 395],
        ["d6c5 d3h7 g8h8 d1d3", 224],
    ],
);

const checkingPin = fixture(
    "5r1k/1p4p1/pn2Bq1p/8/2P5/P6P/6Q1/1R5K w - - 2 39",
    "b1g1 f8e8 e6g4 b6c4 g2b7 c4a3 g4h5 e8d8 b7f3 f6e7 f3f7",
    -135,
    "b1b6 f6a1 h1h2 a1e5 h2h1 e5e1 h1h2 f8f2 e6d5 f2g2 d5g2 e1e5",
    -613,
    [
        ["f6a1 h1h2 a1e5 h2h1 e5e1 h1h2 f8f2 e6d5 f2g2 d5g2 e1e5 h2h1", 578],
        ["f8e8 g2e2 f6d4 b6b7 d4a1 h1g2", -4],
    ],
);

test("a check and quiet mate threat explain the mistake despite different later continuations", () => {
    const { mistake } = assessChessDecision(delayedMate)!;
    expect(mistake?.tacticalEpisode).toMatchObject({
        kind: "forcing-attack",
        playedLineUci: ["e6e4", "d4f5", "g7f8", "h4f6", "e4g4"],
        throughPly: 5,
    });
    expect(mistake?.tactical.reasons.join(" ")).toContain("Qf6 threatens Qh8#");
    expect(mistake?.tactical.reasons.join(" ")).toContain("Rg4 stopping immediate mate");
});

test("a direct quiet threat demonstrates the cost of giving up a check", () => {
    const episode = assessChessDecision(quietMate)?.mistake?.tacticalEpisode;
    expect(episode?.kind).toBe("forcing-attack");
    expect(episode?.explanation).toContain("Bg3 threatens Qxf2#");
    expect(episode?.explanation).toContain("Qxh7+ gives check first");
});

test("a later pin is shown with its actual origin and capture, without a net material comparison", () => {
    const mistake = assessChessDecision(checkingPin)?.mistake;
    expect(mistake?.tacticalEpisode?.kind).toBe("forcing-attack");
    expect(mistake?.allowed).toContainEqual(
        expect.objectContaining({
            mechanism: "pin",
            mechanismPly: 7,
            payoffPly: 9,
            squares: ["f2", "g2", "h2"],
            rootMoveInvolved: false,
        }),
    );
    expect(mistake?.tactical.reasons.join(" ")).toContain("Qa1 leaves the king out of check");
    expect(mistake?.tactical.reasons.join(" ")).not.toContain("retains more material");
});

test("an unchanged checking entry and an unsupported reply both withhold the new explanation", () => {
    const sameEntry = {
        ...checkingPin,
        candidates: [{ ...checkingPin.candidates[0], pvUci: ["b1b3"] }, checkingPin.candidates[1]],
    };
    expect(assessChessDecision(sameEntry)?.mistake?.tacticalEpisode?.kind).not.toBe(
        "forcing-attack",
    );
    const [best, runnerUp] = delayedMate.replyProbes[0].lines;
    const narrowGap = {
        ...delayedMate,
        replyProbes: [{ ...delayedMate.replyProbes[0], lines: [best, { ...runnerUp, cp: 660 }] }],
    };
    expect(assessChessDecision(narrowGap)?.mistake?.tacticalEpisode).toBeUndefined();
});

test("pin geometry without exploitation supplies no pin label", () => {
    const attack = checkingPin.replyProbes[0].lines[0];
    const beforePin = replayTacticalLine(attack.fen, attack.pvUci.slice(0, 6)).at(-1)!;
    const after = makeFen(beforePin.after.toSetup());
    expect(
        extractTacticalSequenceWitnesses(after, {
            ...attack,
            fen: after,
            pvUci: ["f8f2", "e6d5", "e1a1"],
        }),
    ).not.toContainEqual(expect.objectContaining({ mechanism: "pin" }));
});

test("an en passant mistake identifies the pawn's occupied square", () => {
    const input = fixture(
        "2r5/2r1p3/3p2p1/4p3/Rp2PkP1/1P1R1P2/2P5/2K5 w - - 14 41",
        "d3d2 c8b8 d2d3 g6g5 c1b2 b8c8 d3d2 f4e3 d2h2",
        -299,
        "c2c4 b4c3 a4a2 c8h8 a2e2 h8h1 c1c2 h1f1 d3c3",
        -446,
        [["b4c3 a4a3 c8h8 b3b4 h8h1 c1c2 h1h2 c2c1 c7b7", 469]],
    );
    const episode = assessChessDecision(input)?.mistake?.tacticalEpisode;
    expect(episode?.kind).toBe("comparative");
    expect(episode?.explanation).toContain("pawn on c4 en passant");
});
