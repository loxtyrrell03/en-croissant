import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import type { DecisionEngineLine } from "../tacticalMotifs/decisionEvidence";

function line(fen: string, cp: number | null, uci: string, mate?: number): DecisionEngineLine {
    return { fen, cp, depth: 20, pvUci: uci.split(" "), mate };
}

function after(fen: string, move: string) {
    return makeFen(replayTacticalLine(fen, [move])[0].after.toSetup());
}

const recoveryFen = "1r3rk1/2pqbppp/1P1p1n2/3Pp3/8/1B1nBN1P/1P3PP1/R2Q1RK1 b - - 0 17";
const recoveryRoot = line(recoveryFen, -51, "c7b6 d1d3 e5e4 d3e2 e4f3 e2f3 f8c8 f1e1");
const recoveryReply = line(after(recoveryFen, "c7b6"), 64, "d1d3 e5e4 d3d1 e4f3 d1f3 f6e8 f3e2");

test("recognizes a compensating fork after taking the advanced pawn", () => {
    const result = assessChessDecision({
        fen: recoveryFen,
        candidates: [recoveryRoot],
        replyProbes: [{ moveUci: "c7b6", lines: [recoveryReply] }],
    })!;
    expect(result.position.tactical.support).toBe("supported");
    expect(result.position.mechanisms).toMatchObject([
        { mechanism: "fork", mechanismPly: 3, payoffPly: 5, rootMoveInvolved: false },
    ]);
    expect(result.moves[0].tactical.reasons[0]).toContain(
        "e4 forks the queen and the knight on f3",
    );
    expect(result.moves[0].episodeOutcomes).toEqual([]);
});

test("withholds a recovery when the second search does not show the fork", () => {
    const reply = line(after(recoveryFen, "c7b6"), 64, "f3g5 d3c5 b3c2 d7b7 b2b4");
    const result = assessChessDecision({
        fen: recoveryFen,
        candidates: [recoveryRoot],
        replyProbes: [{ moveUci: "c7b6", lines: [reply] }],
    })!;
    expect(result.position.tactical.support).toBe("unestablished");
});

const mateFen = "5k1r/p3b3/3Np3/2p2p2/1p4p1/6K1/PP1RbP2/R1B5 b - - 4 31";
const mateRoot = line(mateFen, 555, "e7d6 d2d6 f8e7 d6c6 h8h3 g3f4");
const mateReplyFen = after(mateFen, "e7d6");
const saferReply = line(mateReplyFen, -548, "d2d6 f8e7 d6c6 h8h3 g3f4");
const losingReply = line(mateReplyFen, null, "g3g2 e2f3 g2f1 h8h1", -2);

test("shows a mating line conditional on the defender's choice", () => {
    const result = assessChessDecision({
        fen: mateFen,
        candidates: [mateRoot],
        replyProbes: [{ moveUci: "e7d6", lines: [saferReply, losingReply] }],
    })!;
    expect(result.position.tactical.basis).toBe("bounded-proof");
    expect(result.position.conditionalMate).toMatchObject({
        mateIn: 2,
        lineUci: ["e7d6", "g3g2", "e2f3", "g2f1", "h8h1"],
    });
    expect(result.position.tactical.reasons[0]).toContain("Kg2 allows mate in 2");
    expect(result.mistake).toBeNull();
});

test("a mixed-depth or incomplete mating line supplies no proof", () => {
    for (const reply of [
        { ...losingReply, depth: 19 },
        { ...losingReply, pvUci: losingReply.pvUci.slice(0, 3) },
    ]) {
        const result = assessChessDecision({
            fen: mateFen,
            candidates: [mateRoot],
            replyProbes: [{ moveUci: "e7d6", lines: [saferReply, reply] }],
        })!;
        expect(result.position.conditionalMate).toBeUndefined();
    }
});
