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
