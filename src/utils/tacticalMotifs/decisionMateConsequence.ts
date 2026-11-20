import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { replayTacticalLine } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import { legalImmediateMates } from "./decisionMateDefence";
import type { TacticalGameHistory } from "./gameHistory";
import {
    advanceTacticalRepetitionContext,
    readTacticalRepetitionContext,
} from "./repetitionHistory";

export type DecisionMateConsequence = {
    kind: "allowed" | "missed";
    mateIn: number;
    proof?: "legal";
    lineUci: string[];
    avoidingMoveUci?: string;
    avoidingLineUci?: string[];
    explanation: string;
};

/** The recorded move and its exact legal mating reply form the losing line.
 * The validated engine choice must leave no immediate mate for the opponent.
 * No played-move evaluation or hypothetical change of turn is required. */
export function findAllowedImmediateMate(
    fen: string,
    better: DecisionEngineLine,
    playedMove: string | undefined,
    history?: TacticalGameHistory,
): DecisionMateConsequence | null {
    if (
        !playedMove ||
        playedMove === better.pvUci[0] ||
        better.depth < 16 ||
        better.cp === null ||
        better.mate != null
    )
        return null;
    const [actual] = replayTacticalLine(fen, [playedMove]);
    if (!actual || actual.after.isEnd() || actual.after.halfmoves >= 100) return null;
    const mate = legalImmediateMates(actual.after).next().value;
    if (!mate) return null;
    const [avoiding] = replayTacticalLine(fen, better.pvUci.slice(0, 1));
    if (
        !avoiding ||
        !measureDecisionLine(fen, better) ||
        !legalImmediateMates(avoiding.after).next().done
    )
        return null;
    const repetition = readTacticalRepetitionContext(fen, history);
    if (repetition) {
        const reached = advanceTacticalRepetitionContext(repetition, playedMove);
        if (!reached || reached.endedAtPly !== undefined) return null;
    }
    return {
        kind: "allowed",
        mateIn: 1,
        lineUci: [actual.uci, makeUci(mate)],
        avoidingMoveUci: avoiding.uci,
        explanation: `${actual.san} allows ${makeSan(actual.after, mate)}. ${avoiding.san} avoids mate on the next move.`,
    };
}

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
