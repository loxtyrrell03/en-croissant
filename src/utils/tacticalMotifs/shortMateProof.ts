import type { Chess } from "chessops/chess";
import type { NormalMove } from "chessops/types";
import { legalMoves, mayGiveCheck } from "./causalTactics";

export type MateBudget = { remaining: number };
export type MateInTwoLine = [NormalMove, NormalMove, NormalMove];
export const MATE_BUDGET_EXHAUSTED = Symbol("short mate proof budget");

export function playShortMateMove(position: Chess, move: NormalMove, budget: MateBudget) {
    if (--budget.remaining < 0) throw MATE_BUDGET_EXHAUSTED;
    const next = position.clone();
    next.play(move);
    return next;
}

export function mateOnNextMove(position: Chess, budget: MateBudget) {
    return legalMoves(position).find(
        (move) =>
            mayGiveCheck(position, move) && playShortMateMove(position, move, budget).isCheckmate(),
    );
}

/** Material and one example PV cannot prove mate. Every reply after
 * the nominated start must admit legal checkmate on the next move. */
export function mateInTwoFromMove(
    position: Chess,
    move: NormalMove,
    budget: MateBudget,
    checkingOnly = false,
): MateInTwoLine | null {
    if ((checkingOnly && !mayGiveCheck(position, move)) || !position.isLegal(move)) return null;
    const reached = playShortMateMove(position, move, budget);
    if ((checkingOnly && !reached.isCheck()) || reached.isEnd() || reached.halfmoves >= 99)
        return null;
    let line: MateInTwoLine | null = null;
    for (const reply of legalMoves(reached)) {
        const mate = mateOnNextMove(playShortMateMove(reached, reply, budget), budget);
        if (!mate) return null;
        line ??= [move, reply, mate];
    }
    return line;
}
