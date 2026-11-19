import { makeFen } from "chessops/fen";
import type { Color, Square } from "chessops/types";
import { makeSquare, opposite } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import { traceAdvancedPawn } from "./decisionPromotionPressure";

const PROMOTION_WINDOW = 8;
const RETENTION_WINDOW = 3;

export type PromotionMistakeEvidence = {
    tactical: string;
    positional?: string;
    betterLineUci: string[];
    playedLineUci: string[];
};

function playedVariation(root: TacticalReplayStep, reply: DecisionEngineLine) {
    const after = makeFen(root.after.toSetup());
    if (!measureDecisionLine(after, reply)) return [];
    return [
        root,
        ...replayTacticalLine(after, reply.pvUci.slice(0, PROMOTION_WINDOW + RETENTION_WINDOW - 1)),
    ];
}

function promotionPayoff(steps: TacticalReplayStep[], pawn: Square, opponent: Color) {
    const { promotion } = traceAdvancedPawn(steps, pawn, opponent);
    if (!promotion || promotion.through > PROMOTION_WINDOW) return;
    const move = steps[promotion.through - 1];
    const role = move.move.promotion!;
    if (promotion.trade)
        return {
            signature: `trade:${promotion.trade.role}`,
            through: promotion.trade.through,
            square: promotion.square,
            description: `${promotion.trade.description} trades the pawn for a ${promotion.trade.role}`,
        };

    const end = promotion.through + RETENTION_WINDOW;
    if (steps.length < end) return;
    let square = promotion.square;
    for (const next of steps.slice(promotion.through, end)) {
        if (next.before.turn === opponent && next.move.from === square) square = next.move.to;
        const piece = next.after.board.get(square);
        if (piece?.color !== opponent || piece.role !== role) return;
    }
    return {
        signature: `retained:${role}`,
        through: end,
        square: promotion.square,
        description: `${move.san} promotes the pawn and retains the new ${role} through ${steps[end - 1].san}`,
    };
}

function validatedLoss(
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    betterReply: DecisionEngineLine,
    playedReply: DecisionEngineLine,
) {
    if (
        better.cp === null ||
        played.cp === null ||
        better.mate != null ||
        played.mate != null ||
        better.depth !== played.depth ||
        better.cp - played.cp < 100 ||
        betterReply.cp === null ||
        betterReply.mate != null ||
        Math.abs(better.cp + betterReply.cp) > 90
    )
        return false;
    if (playedReply.mate != null) return playedReply.mate > 0 && played.cp <= -450;
    return (
        playedReply.cp !== null &&
        Math.abs(played.cp + playedReply.cp) <= 100 &&
        playedReply.cp - betterReply.cp >= 70
    );
}

/** A paired and separately searched actual choice must lose to the same
 * pawn on the same promotion square. The paired and separately searched
 * better choice must both show how that specific payoff was prevented. */
export function comparePromotionMistake(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    betterReply: DecisionEngineLine,
    playedReply: DecisionEngineLine,
): PromotionMistakeEvidence | null {
    if (
        !validatedLoss(better, played, betterReply, playedReply) ||
        better.pvUci[0] === played.pvUci[0] ||
        !played.pvUci
            .slice(0, PROMOTION_WINDOW)
            .some((uci, index) => index % 2 === 1 && uci.length === 5) ||
        !playedReply.pvUci
            .slice(0, PROMOTION_WINDOW - 1)
            .some((uci, index) => index % 2 === 0 && uci.length === 5)
    )
        return null;
    if (!measureDecisionLine(fen, better) || !measureDecisionLine(fen, played)) return null;
    const limit = PROMOTION_WINDOW + RETENTION_WINDOW;
    const preferred = replayTacticalLine(fen, better.pvUci.slice(0, limit));
    const actual = replayTacticalLine(fen, played.pvUci.slice(0, limit));
    if (!preferred.length || !actual.length) return null;
    const defender = preferred[0].before.turn;
    const opponent = opposite(defender);
    const board = preferred[0].before.board;
    const threats = [...board.pawn.intersect(board[opponent])].filter((square) =>
        opponent === "white" ? square >= 32 : square < 32,
    );
    const preferredSearch = playedVariation(preferred[0], betterReply);
    const actualSearch = playedVariation(actual[0], playedReply);
    if (!preferredSearch.length || !actualSearch.length) return null;
    for (const pawn of threats) {
        const original = promotionPayoff(actual, pawn, opponent);
        const found = promotionPayoff(actualSearch, pawn, opponent);
        if (
            !original ||
            !found ||
            original.square !== found.square ||
            original.signature !== found.signature
        )
            continue;
        const through = Math.max(original.through, found.through);
        const first = traceAdvancedPawn(preferred.slice(0, through), pawn, opponent);
        const second = traceAdvancedPawn(preferredSearch.slice(0, through), pawn, opponent);
        const prevented = first.removes ?? first.blockade;
        if (
            first.promotion ||
            second.promotion ||
            !prevented ||
            !(second.removes || second.blockade)
        )
            continue;
        const strategic = first.blockade && second.blockade;
        return {
            tactical: `${actual[0].san} allows the pawn from ${makeSquare(pawn)} to promote in both searches. ${found.description}. After ${preferred[0].san}, ${prevented.description}.`,
            ...(strategic
                ? {
                      positional: `The better choice keeps a blockade against the pawn from ${makeSquare(pawn)} in both continuations. ${first.blockade!.description}.`,
                  }
                : {}),
            betterLineUci: preferred
                .slice(0, prevented.contextThrough ?? prevented.through)
                .map((step) => step.uci),
            playedLineUci: actualSearch.slice(0, found.through).map((step) => step.uci),
        };
    }
    return null;
}
