import { attacks } from "chessops/attacks";
import type { Chess } from "chessops/chess";
import type { Color, Square } from "chessops/types";
import { makeSquare, opposite } from "chessops/util";
import { replayTacticalLine } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import type { PositionStrategicPlan } from "./decisionPositionPlans";
import type { ComparativePositionalEvidence } from "./positionalTransitions";

const WINDOW = 12;
const file = (square: Square) => square % 8;

function pawnOnFile(board: Chess, side: Color, column: number) {
    return [...board.board.pawn.intersect(board.board[side])].some(
        (square) => file(square) === column,
    );
}

function kingFileExposure(fen: string, exposed: DecisionEngineLine, sheltered: DecisionEngineLine) {
    const [root] = replayTacticalLine(fen, exposed.pvUci.slice(0, 1));
    if (!root?.capture) return null;
    const side = root.before.turn;
    const king = root.before.board.kingOf(side);
    const { from, to } = root.move;
    const homeRank = Math.floor(from / 8);
    if (
        king === undefined ||
        (side === "white" ? king >= 16 || homeRank > 2 : king < 48 || homeRank < 5) ||
        root.before.board.get(from)?.role !== "pawn" ||
        file(from) !== file(king) ||
        file(from) === file(to) ||
        pawnOnFile(root.after, side, file(from))
    )
        return null;

    for (const line of [exposed, sheltered]) {
        const measured = measureDecisionLine(fen, line);
        if (!measured || measured.drawnEnding) return null;
    }
    const steps = replayTacticalLine(fen, exposed.pvUci.slice(0, WINDOW));
    const keep = replayTacticalLine(fen, sheltered.pvUci.slice(0, WINDOW));
    for (const [index, step] of steps.entries()) {
        if (
            step.after.board.kingOf(side) !== king ||
            pawnOnFile(step.after, side, file(from)) ||
            keep[index]?.after.board.kingOf(side) !== king ||
            keep[index]?.after.board.get(from)?.color !== side ||
            keep[index]?.after.board.get(from)?.role !== "pawn"
        )
            break;
        const attacker = step.after.board.get(step.move.to);
        if (
            index < 3 ||
            attacker?.color !== opposite(side) ||
            (attacker.role !== "rook" && attacker.role !== "queen") ||
            file(step.move.to) !== file(king) ||
            !attacks(attacker, step.move.to, step.after.board.occupied).has(king)
        )
            continue;
        // The retained pawn must stand between the invasion square and king.
        // Otherwise a pawn on the same file is incidental to the check.
        if ((step.move.to - from) * (from - king) <= 0) continue;
        const column = makeSquare(from)[0];
        return {
            side,
            column,
            through: index + 1,
            sameCapture:
                keep[0].move.to === root.move.to &&
                keep[0].capture === root.capture &&
                root.before.board.get(to)?.color === opposite(side),
            description: `${root.san} opens the ${column}-file in front of the king. ${step.san} checks down that file. After ${keep[0].san}, the pawn on ${makeSquare(from)} still shields the king through the same stretch of play.`,
        };
    }
    return null;
}

/** A severe loss can still be an instructive position-level choice when
 * two different pieces can recapture the same opponent. Show the concrete
 * long-term cost of using the shielding pawn alongside any tactical cost. */
export function findKingShelterTradeoff(
    fen: string,
    candidates: DecisionEngineLine[],
): PositionStrategicPlan | null {
    const [best, ...alternatives] = candidates;
    if (!best || best.depth < 16 || best.cp === null || best.mate != null) return null;
    for (const alternative of alternatives) {
        if (alternative.depth !== best.depth || alternative.cp === null || alternative.mate != null)
            continue;
        for (const [exposed, sheltered] of [
            [alternative, best],
            [best, alternative],
        ]) {
            const evidence = kingFileExposure(fen, exposed, sheltered);
            if (!evidence) continue;
            if (!evidence.sameCapture && best.cp - alternative.cp > 100) continue;
            return {
                linesUci: [
                    best.pvUci.slice(0, evidence.through),
                    alternative.pvUci.slice(0, evidence.through),
                ],
                description: evidence.description,
            };
        }
    }
    return null;
}

/** Require the same exposed file and an actual invasion in both searches.
 * This is a board consequence of the move, separate from the engine score. */
export function compareLostKingShelter(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    betterReply: DecisionEngineLine,
    playedReply: DecisionEngineLine,
): ComparativePositionalEvidence | null {
    const evidence = kingFileExposure(fen, played, better);
    if (!evidence || better.cp === null || played.cp === null) return null;
    const repeated = kingFileExposure(
        fen,
        { ...played, pvUci: [played.pvUci[0], ...playedReply.pvUci] },
        { ...better, pvUci: [better.pvUci[0], ...betterReply.pvUci] },
    );
    if (!repeated || evidence.column !== repeated.column) return null;
    return {
        feature: "king-file-shelter",
        side: evidence.side,
        squareOrFile: evidence.column,
        firstPly: 1,
        lastConsecutivePly: evidence.through,
        description: evidence.description,
        support: "board-fact",
        comparisonMoveUci: better.pvUci[0],
        comparisonGapCp: better.cp - played.cp,
        supportInComparison: false,
        comparison: "separate-reply-search",
        interpretation: "heuristic",
    };
}
