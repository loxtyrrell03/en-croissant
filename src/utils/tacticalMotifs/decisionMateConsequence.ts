import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";

export type DecisionMateConsequence = {
    kind: "allowed" | "missed";
    mateIn: number;
    lineUci: string[];
    explanation: string;
};

/** A mate evaluation and a finite centipawn evaluation are different kinds of
 * evidence. Require a legal mating witness and independent confirmation for
 * any multi-ply claim. Two already-lost mate lines do not diagnose an error. */
export function compareMateConsequence(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    searchAfterBetter?: DecisionEngineLine,
    searchAfterPlayed?: DecisionEngineLine,
): DecisionMateConsequence | null {
    const good = measureDecisionLine(fen, better);
    const actual = measureDecisionLine(fen, played);
    if (!good || !actual || better.depth !== played.depth || good.drawnEnding || actual.drawnEnding)
        return null;
    const allowed = better.mate == null && better.cp !== null && (played.mate ?? 0) < 0;
    const missed =
        (better.mate ?? 0) > 0 &&
        played.mate == null &&
        played.cp !== null &&
        !(actual.checkmate && actual.plies === 1);
    if (!allowed && !missed) return null;

    const matingRoot = allowed ? played : better;
    const root = replayTacticalLine(fen, matingRoot.pvUci.slice(0, 1))[0];
    if (!root) return null;
    const rootMate = Math.abs(matingRoot.mate!);
    if (missed && rootMate === 1 && root.after.isCheckmate())
        return {
            kind: "missed",
            mateIn: 1,
            lineUci: [root.uci],
            explanation: `${root.san} was legal checkmate in one.`,
        };
    const reply = allowed ? searchAfterPlayed : searchAfterBetter;
    if (
        !reply ||
        reply.mate == null ||
        reply.depth < 16 ||
        (allowed ? reply.mate < 1 : reply.mate > -1)
    )
        return null;
    const reached = makeFen(root.after.toSetup());
    const continuation = measureDecisionLine(reached, reply);
    if (!continuation?.checkmate || continuation.drawnEnding) return null;
    const mateIn = allowed ? reply.mate : 1 - reply.mate;
    // UCI mate distance counts the winning side's moves. The line must
    // exhibit the right winner and duration from the original position.
    const matePlies = allowed ? 2 * mateIn - 1 : 2 * mateIn - 2;
    if (mateIn > 6 || rootMate !== mateIn || reply.pvUci.length !== matePlies) return null;
    return {
        kind: allowed ? "allowed" : "missed",
        mateIn,
        lineUci: [root.uci, ...reply.pvUci],
        explanation: allowed
            ? `After ${root.san}, the opponent's separate search confirms mate in ${mateIn}. The displayed continuation ends in legal checkmate.`
            : `${root.san} starts an engine-confirmed mate in ${mateIn}. The played move gives up that mating line.`,
    };
}
