import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import { confirmExtraPositionChoice } from "../tacticalMotifs/decisionPositionContrast";

test("a later deflection can explain a hypothetical mistake without defining the position", () => {
    const fen = "1r3r2/pp4bk/2q2npp/P1p2P2/2Pp4/3P2PP/4N2K/1RBQ1R2 b - - 0 22";
    const line = (cp: number, depth: number, uci: string, root = fen) => ({
        fen: root,
        cp,
        depth,
        pvUci: uci.split(" "),
    });
    const candidates = [
        line(23, 22, "g6g5 e2g1 b7b6 a5b6 a7b6 d1f3 c6a4 h2h1 b6b5 c4b5 b8b5 b1b5 a4b5"),
        line(-8, 22, "g6f5"),
        line(-62, 22, "b7b6"),
    ];
    const shortlist = [
        line(23, 11, "g6g5"),
        line(0, 11, "f6h5"),
        line(-7, 11, "g6f5"),
        line(-72, 11, "b7b6"),
    ];
    const pair = [
        line(25, 19, "g6g5 e2g1 b7b5 a5b6 a7b6 g1f3 f8e8 d1c2 c6d6 b1b2 h7g8 c2g2 f6h5"),
        line(-134, 19, "f6h5 f5g6 h7g6 f1f8 b8f8 e2f4 h5f4 d1g4 g6h7 c1f4 b7b6 a5b6 a7b6"),
    ];
    const [move] = replayTacticalLine(fen, ["f6h5"]);
    const after = makeFen(move.after.toSetup());
    const reply = line(
        118,
        18,
        "f5g6 c6g6 c1f4 b8e8 b1b7 g6a6 b7b5 a6c6 f1f2 g7e5 d1f1 e5f4 e2f4",
        after,
    );
    const report = assessChessDecision({
        fen,
        candidates,
        comparisonCandidates: pair,
        playedMoveUci: "f6h5",
        replyProbes: [{ moveUci: "f6h5", lines: [reply] }],
        extraPositionChoice: { shortlist, pair, replies: [reply] },
    });
    expect(report?.mistake?.tacticalEpisode?.mechanisms.map((motif) => motif.mechanism)).toContain(
        "deflection",
    );
    expect(report?.position.tacticalContrast).toBeUndefined();
    expect(
        confirmExtraPositionChoice(fen, candidates, {
            shortlist,
            pair,
            replies: [{ ...reply, fen }],
        }),
    ).toBeNull();
});

test("taking a simply offered pawn supplies no extra evidence about the original position", () => {
    const fen = "r4rk1/pppnp1bp/6p1/5p2/3P4/2P2N1P/PP3PP1/R1B1R1K1 b - - 0 14";
    const line = (cp: number, depth: number, uci: string, root = fen) => ({
        fen: root, cp, depth, pvUci: uci.split(" "),
    });
    const candidates = [
        line(-25, 20, "f8e8 c1f4 c7c5 a1d1 c5d4 f3d4 d7c5 f4e5"),
        line(-36, 20, "g7f6"),
        line(-44, 20, "a8e8"),
    ];
    const shortlist = [
        line(-33, 10, "f8e8"), line(-44, 10, "a8e8"),
        line(-47, 10, "g7f6"), line(-111, 10, "e7e5"),
    ];
    const pair = [
        line(-24, 21, "f8e8 c1f4 c7c5 a1d1 c5d4 f3d4 d7c5 f4e5 g7e5 e1e5"),
        line(-126, 21, "e7e5 d4e5 d7c5 e1d1 c5e6 f3d4 a8d8 c1e3 e6d4 e3d4"),
    ];
    const [choice] = replayTacticalLine(fen, ["e7e5"]);
    const reply = line(118, 18, "d4e5 d7c5 e1d1 f5f4 c3c4 c5e6 c1d2 g8f7 d2b4", makeFen(choice.after.toSetup()));
    expect(confirmExtraPositionChoice(fen, candidates, { shortlist, pair, replies: [reply] })).toBeNull();
    const report = assessChessDecision({
        fen, candidates, comparisonCandidates: pair, playedMoveUci: "e7e5",
        replyProbes: [{ moveUci: "e7e5", lines: [reply] }],
    });
    expect(report?.mistake?.tacticalEpisode?.explanation).toContain("dxe5 takes the pawn on e5");
});

test("the same pawn-capture reply can answer a plausible threat to a piece", () => {
    const fen = "r1b3k1/pp1nq2p/2pb3r/8/2PPpPP1/P7/1P1BBPK1/2RQ1RN1 b - - 0 20";
    const line = (cp: number, depth: number, uci: string, root = fen) => ({
        fen: root, cp, depth, pvUci: uci.split(" "),
    });
    const candidates = [
        line(131, 19, "e7h4 f1e1 h4h1 g2f1 d7f6 c1c3 h6h2"),
        line(-158, 19, "c6c5"),
        line(-246, 19, "d7f6"),
    ];
    const shortlist = [line(211, 9, "e7h4"), line(-85, 9, "e4e3"), line(-152, 9, "c6c5")];
    const pair = [
        line(94, 18, "e7h4 f1e1 d7f6 c1c3 h4h1 g2f1 h6h2 c3g3 h7h5 d1b3"),
        line(-299, 18, "e4e3 f2e3 d7f6 g4g5 e7g7 g1f3 h6h3 c4c5 f6e4 d2e1"),
    ];
    const [choice] = replayTacticalLine(fen, ["e4e3"]);
    const reply = line(296, 16, "f2e3 d7f6 g4g5 e7g7 f1f3 f6e4 e2d3 c8f5 g1e2", makeFen(choice.after.toSetup()));
    expect(confirmExtraPositionChoice(fen, candidates, {
        shortlist, pair, replies: [reply],
    })?.explanation).toContain("fxe3 can take the pawn on e3");
});
