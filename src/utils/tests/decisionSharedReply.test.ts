import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    assessChessDecision,
    type DecisionAssessmentInput,
} from "../tacticalMotifs/decisionAssessment";
import type { DecisionEngineLine } from "../tacticalMotifs/decisionEvidence";
import { compareSharedReply } from "../tacticalMotifs/decisionSharedReply";

function study(
    fen: string,
    better: [string, number],
    played: [string, number],
    defence: [string, number],
    attack: [string, number],
    control?: [string, number],
): DecisionAssessmentInput {
    const line = (board: string, [moves, cp]: [string, number]): DecisionEngineLine => ({
        fen: board,
        pvUci: moves.split(" "),
        cp,
        depth: 20,
    });
    const after = (uci: string) => makeFen(replayTacticalLine(fen, [uci])[0].after.toSetup());
    const choices = [line(fen, better), line(fen, played)];
    const [betterMoveUci, playedMoveUci] = choices.map((item) => item.pvUci[0]);
    return {
        fen,
        candidates: choices,
        playedMoveUci,
        replyProbes: [
            { moveUci: betterMoveUci, lines: [line(after(betterMoveUci), defence)] },
            { moveUci: playedMoveUci, lines: [line(after(playedMoveUci), attack)] },
        ],
        sharedReply: control && {
            betterMoveUci,
            playedMoveUci,
            line: line(after(betterMoveUci), control),
        },
    };
}

const tempo = study(
    "5k2/1p3r2/3R2p1/7n/P6P/1P3n2/1K3R2/8 w - - 1 32",
    ["d6d3 f3e5 f2f7 f8f7 d3d5 f7e6 d5b5 e6d6", 420],
    ["d6g6 h5f4 g6d6 f3h4 d6d8 f8g7 b2a3 h4g6", 50],
    ["f3e5 f2f7 f8f7 d3d5 f7e6 d5b5 h5f4 b5b7", -377],
    ["h5f4 g6d6 f3h4 d6d8 f8e7 f2d2 e7e6 d8d6", -44],
    ["h5f4 d3f3 f4d3 f3d3 f7f2 b2a3 f8e7 d3d4", -444],
);

test("a shared knight reply gains tempo only against the played rook square", () => {
    const mistake = assessChessDecision(tempo)?.mistake;
    expect(mistake?.tacticalEpisode?.betterLineUci).toEqual(["d6d3", "h5f4", "d3f3"]);
    expect(mistake?.tacticalEpisode?.explanation).toContain("Nf4 attacks the rook on g6");
    expect(mistake?.tacticalEpisode?.explanation).toContain("Rdxf3");
});

test("a control from another board or without a meaningful difference gives no proof", () => {
    for (const bad of [{ fen: tempo.fen }, { cp: -45 }]) {
        expect(
            assessChessDecision({
                ...tempo,
                sharedReply: {
                    ...tempo.sharedReply!,
                    line: { ...tempo.sharedReply!.line, ...bad },
                },
            })?.mistake?.tacticalEpisode,
        ).toBeUndefined();
    }
});

const queen = study(
    "1r1q4/1P3ppk/2Qpb3/3Np3/4P2p/6P1/5P1P/1R4K1 b - - 4 38",
    ["e6d5 c6d5 h4g3 h2g3 d8c7 d5b3 h7g8 g1f1", -30],
    ["h4h3 c6c7 e6d5 c7d8 b8d8 e4d5 d8b8 f2f4", -238],
    ["c6d5 h4g3 h2g3 d8c7 g1g2 h7g8 d5b3 g8f8", 25],
    ["c6c7 e6d5 c7d8 b8d8 e4d5 d8b8 f2f4 e5e4", 239],
    ["c6c7 d8c7 e4d5 h4h3 g1f1 c7c2 f2f4 c2b1", -1936],
);

test("the earlier removal of a knight makes the same queen capture profitable", () => {
    const episode = assessChessDecision(queen)?.mistake?.tacticalEpisode;
    expect(episode?.betterLineUci).toEqual(["e6d5", "c6c7", "d8c7", "e4d5"]);
    expect(episode?.explanation).toContain("Qxc7, a profitable capture");
    expect(episode?.explanation).toContain("can recapture with Nxc7");
});

test("a loose bishop in the control does not turn a quiet reply into a tactical mistake", () => {
    const input = study(
        "6k1/5pbp/p1q2np1/1p6/3p4/B4QP1/PP2PPKP/3N4 b - - 3 25",
        ["f6d5 b2b3 h7h5 a3b2 b5b4 g2g1 c6e6 b2c1 d5c3 d1c3", 172],
        ["f6e4 a3b4 h7h5 g2g1 c6e6 f3b3 e6b3 a2b3 g7f8 b4f8", 37],
        ["b2b3 b5b4 a3b2 h7h6 a2a3 a6a5 a3b4 a5b4 b2a1 c6e6", -149],
        ["a3b4 h7h5 a2a3 g7f6 h2h4 f6g7 b2b3 c6e6 a3a4 e4f6", -36],
        ["a3b4 d5b4 f3c6 b4c6 f2f4 d4d3 e2e4 g6g5 f4g5 g7d4", -630],
    );
    const report = assessChessDecision(input);
    expect(report?.mistake?.evaluationLossCp).toBe(135);
    expect(report?.mistake?.tactical.support).toBe("unestablished");
    expect(report?.mistake?.tacticalEpisode).toBeUndefined();
});

const enPassant = study(
    "2r5/2r1p3/3p2p1/4p3/Rp2PkP1/1P1R1P2/2P5/2K5 w - - 14 41",
    ["d3d2 c8b8 d2d3 g6g5 c1b2 b8c8 d3d2 f4e3", -299],
    ["c2c4 b4c3 a4a2 c8h8 a2e2 h8h1 c1c2 h1f1", -446],
    ["c7b7 d2d3 g6g5 c1b2 f4g3 a4a1 b7c7 a1g1", 442],
    ["b4c3 a4a3 c8h8 b3b4 h8h1 c1c2 h1h2 c2c1", 469],
);

test("a direct en passant concession and a lasting passer are separate mixed evidence", () => {
    const mistake = assessChessDecision(enPassant)?.mistake;
    expect(mistake?.category).toBe("mixed");
    expect(mistake?.positionalFactors).toContainEqual(
        expect.objectContaining({
            side: "black",
            feature: "passed-pawn",
            squareOrFile: "c",
            comparisonMoveUci: "d3d2",
        }),
    );
    expect(mistake?.positional.reasons.join(" ")).toContain("advanced passer on c3");
});

test("the passer does not explain the score loss if separate searches reverse the move order", () => {
    const probes = enPassant.replyProbes!;
    const report = assessChessDecision({
        ...enPassant,
        replyProbes: [{ ...probes[0], lines: [{ ...probes[0].lines[0], cp: 500 }] }, probes[1]],
    });
    expect(report?.mistake?.positional.support).toBe("unestablished");
});

const trapFen = "r1b2rk1/ppnpnpp1/4p1qp/2P4P/4P1P1/1N6/PP2QP2/R1B1KB1R b KQ - 0 15";
const trap = (fen: string) =>
    study(
        fen,
        ["g6h7 f2f3 b7b6", -372],
        ["g6f6 e4e5 f6f4 c1f4", -973],
        ["f2f3 b7b6 e2h2", 356],
        ["e4e5 f6g6 h5g6 b7b6", 985],
        ["e4e5 b7b6 f1g2 c8a6", 0],
    );

test("different queen retreats still support the same verified trap", () => {
    const mistake = assessChessDecision(trap(trapFen))?.mistake;
    expect(mistake?.tactical.support).toBe("supported");
    expect(mistake?.tactical.basis).toBe("bounded-proof");
    expect(mistake?.allowed).toContainEqual(
        expect.objectContaining({
            mechanism: "trappedPiece",
            squares: ["f6"],
            lineUci: ["e4e5", "f6g6", "h5g6"],
        }),
    );
    expect(mistake?.tacticalEpisode).toMatchObject({ kind: "trap", checkedReplies: 29 });
    expect(mistake?.tacticalEpisode?.explanation).toContain("29 legal replies");
});

test("one captured queen in the PV does not prove a trap when another retreat escapes", () => {
    const fen = trapFen.replace("R1B1KB1R", "R3KB1R");
    const input = trap(fen);
    const [better, played] = input.candidates;
    const retreat = { ...played, pvUci: ["g6f6", "e4e5", "f6f4", "f1g2"] };
    const opponent = input.replyProbes![1].lines[0];
    expect(compareSharedReply(fen, better, retreat, opponent, input.sharedReply)).toBeNull();
});

const stationaryQueen = study(
    "r3k2r/pp1bq3/1bn2n1p/5pp1/5Q2/2NP1N2/PP1BBPPP/2R2RK1 w kq - 0 18",
    ["f4a4 e8c8 f1e1 c8b8", 52],
    ["f4c4 c6a5 d3d4 a5c4", -559],
    ["e8c8 f1e1 c8b8 e2f1", -34],
    ["c6a5 c3d5 a5c4 d2g5", 561],
);

test("the trapped piece can stay put and the better choice can face a different reply", () => {
    const episode = assessChessDecision(stationaryQueen)?.mistake?.tacticalEpisode;
    expect(episode?.kind).toBe("trap");
    expect(episode?.mechanisms[0]).toMatchObject({ mechanism: "trappedPiece", squares: ["c4"] });
    expect(episode?.playedLineUci).toEqual(["f4c4", "c6a5", "c3d5", "a5c4"]);
    expect(episode?.betterLineUci).toEqual(["f4a4", "e8c8", "f1e1", "c8b8"]);
});

test("two separate searches must confirm the advantage of the better choice", () => {
    const [better, played] = stationaryQueen.replyProbes!;
    const withDivergentControl = {
        ...stationaryQueen,
        replyProbes: [{ ...better, lines: [{ ...better.lines[0], cp: 575 }] }, played],
    };
    expect(assessChessDecision(withDivergentControl)?.mistake?.tacticalEpisode?.kind).not.toBe(
        "trap",
    );
});
