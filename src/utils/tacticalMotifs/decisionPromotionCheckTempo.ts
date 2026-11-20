import { castlingSide } from "chessops/chess";
import { makeFen } from "chessops/fen";
import type { Square } from "chessops/types";
import { makeSquare } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import type { PositionStrategicPlan } from "./decisionPositionPlans";
import type { TacticalGameHistory } from "./gameHistory";
import { extractPositionalBoardFacts } from "./positionalEvidence";
import { tacticalRepetitionBoundary } from "./repetitionHistory";

const SEARCH_PLY = 9;
const RETENTION_PLIES = 4;
const MIN_DEPTH = 16;

type Route = {
    steps: TacticalReplayStep[];
    index: number;
    pawn: Square;
};

function survivingPromotion(steps: TacticalReplayStep[], index: number): Route | undefined {
    const promotion = steps[index];
    const role = promotion?.move.promotion;
    if (!role || promotion.capture || promotion.move.to % 8 !== promotion.move.from % 8) return;
    let square = promotion.move.from;
    const side = promotion.before.turn;
    const earlierPath = steps.slice(0, index).reverse();
    for (const step of earlierPath) {
        if (step.before.turn === side && step.move.to === square) {
            if (step.capture || step.move.promotion || step.move.from % 8 !== square % 8) return;
            square = step.move.from;
        }
        if (!step.before.board.pawn.has(square) || !step.before.board[side].has(square)) return;
    }
    const retained = steps.slice(index + 1, index + 1 + RETENTION_PLIES);
    if (retained.length !== RETENTION_PLIES) return;
    let activeSquare = promotion.move.to;
    for (const step of retained) {
        if (step.before.turn === side && step.move.from === activeSquare)
            activeSquare = step.move.to;
        if (!step.after.board[role].has(activeSquare) || !step.after.board[side].has(activeSquare))
            return;
    }
    return { steps, index, pawn: square };
}

function promotionRoutes(steps: TacticalReplayStep[]) {
    return steps.slice(0, SEARCH_PLY).flatMap((_, index) => {
        const route = survivingPromotion(steps, index);
        return route ? [route] : [];
    });
}

function exactLine(fen: string, line: DecisionEngineLine | undefined): line is DecisionEngineLine {
    if (!line || line.depth < MIN_DEPTH || line.cp === null || line.mate != null) return false;
    const evidence = measureDecisionLine(fen, line);
    return !!evidence && !evidence.drawnEnding;
}

export type PromotionCheckTempo = {
    tactic: PositionStrategicPlan;
    pawnPlan: string;
    sameContinuation: boolean;
};

/** A legal, bounded counterfactual about the same promotion, not a claim
 * that the opponent must choose the displayed defence. */
export function comparePromotionCheckTempo(
    fen: string,
    better: DecisionEngineLine,
    alternative: DecisionEngineLine,
    betterReply: DecisionEngineLine | undefined,
    history?: TacticalGameHistory,
): PromotionCheckTempo | null {
    if (
        better.depth !== alternative.depth ||
        better.cp === null ||
        alternative.cp === null ||
        better.cp <= alternative.cp ||
        better.mate != null ||
        alternative.mate != null ||
        !better.pvUci.slice(2, SEARCH_PLY).some((uci) => uci.length === 5)
    )
        return null;
    const [bestRoot] = replayTacticalLine(fen, better.pvUci.slice(0, 1));
    const [otherRoot] = replayTacticalLine(fen, alternative.pvUci.slice(0, 1));
    if (
        !bestRoot ||
        !otherRoot ||
        bestRoot.uci === otherRoot.uci ||
        bestRoot.capture ||
        bestRoot.before.board.get(bestRoot.move.from)?.role !== "king" ||
        bestRoot.move.from !== otherRoot.move.from ||
        castlingSide(bestRoot.before, bestRoot.move) ||
        otherRoot.capture ||
        otherRoot.move.promotion ||
        castlingSide(otherRoot.before, otherRoot.move)
    )
        return null;
    const child = makeFen(bestRoot.after.toSetup());
    if (
        !exactLine(fen, better) ||
        !exactLine(fen, alternative) ||
        !exactLine(child, betterReply) ||
        Math.abs(better.cp + betterReply.cp!) > 90
    )
        return null;
    const searched = [better, { pvUci: [bestRoot.uci, ...betterReply.pvUci] }];
    const [primary, repeated] = searched.map(({ pvUci }) =>
        promotionRoutes(replayTacticalLine(fen, pvUci.slice(0, SEARCH_PLY + RETENTION_PLIES))),
    );
    let samePawn: PromotionCheckTempo | null = null;
    for (const route of primary) {
        const { steps, index, pawn } = route;
        if (index < 2 || !steps[index - 1].capture) continue;
        const responses = repeated.filter((other) => other.pawn === pawn);
        if (!responses.length) continue;
        const sameContinuation = responses.some(
            (other) =>
                other.index === index &&
                steps.slice(1, index + 1).every(({ uci }, i) => uci === other.steps[i + 1].uci),
        );
        const prefix = steps.slice(1, index).map(({ uci }) => uci);
        // Require this defence to be searched after each root choice. The
        // control's shared later pawn push is legal and counterfactual.
        if (alternative.pvUci[1] !== prefix[0]) continue;
        const control = replayTacticalLine(fen, [otherRoot.uci, ...prefix]);
        if (control.length !== index) continue;
        const check = control[index - 1];
        const withoutCheck = steps[index - 1];
        const promotion = steps[index];
        if (
            withoutCheck.after.isCheck() ||
            !check.after.ctx().checkers.has(check.move.to) ||
            check.capture !== withoutCheck.capture ||
            check.before.board.get(check.move.from)?.role !==
                withoutCheck.before.board.get(withoutCheck.move.from)?.role ||
            check.after.isLegal(promotion.move) ||
            !check.after.board[promotion.before.turn].has(promotion.move.from) ||
            !check.after.board.pawn.has(promotion.move.from) ||
            check.after.board.occupied.has(promotion.move.to)
        )
            continue;
        const played = steps.slice(0, index + 1).map(({ uci }) => uci);
        const blocked = control.map(({ uci }) => uci);
        if ([played, blocked].some((moves) => tacticalRepetitionBoundary(fen, moves[0], history)))
            continue;
        const start = makeSquare(pawn);
        if (!extractPositionalBoardFacts(fen)?.[promotion.before.turn].passedPawns.includes(start))
            continue;
        const evidence = {
            tactic: {
                description: `After ${bestRoot.san}, ${withoutCheck.san} comes without check and ${promotion.san} is legal. After ${otherRoot.san}, the same capture ${check.san} forces a response to check before the pawn can promote.`,
                linesUci: [played, blocked] satisfies PositionStrategicPlan["linesUci"],
            },
            pawnPlan: `The passed pawn on ${start} promotes and keeps its new piece through the next four plies in both searches of ${bestRoot.san}.`,
            sameContinuation,
        };
        if (sameContinuation) return evidence;
        samePawn ??= evidence;
    }
    return samePawn;
}
