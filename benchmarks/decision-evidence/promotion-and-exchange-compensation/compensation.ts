import { between } from "chessops/attacks";
import { makeFen } from "chessops/fen";
import type { Color, Square } from "chessops/types";
import { makeSquare } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "@/utils/tacticalMotifs/causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "@/utils/tacticalMotifs/decisionEvidence";
import type { PositionStrategicPlan } from "@/utils/tacticalMotifs/decisionPositionPlans";
import { traceAdvancedPawn } from "@/utils/tacticalMotifs/decisionPromotionPressure";
import { tacticalRepetitionKey } from "@/utils/tacticalMotifs/repetitionHistory";

const file = (square: Square) => square & 7;
const relativeRank = (square: Square, color: Color) =>
    color === "white" ? 1 + (square >> 3) : 8 - (square >> 3);
const prefix = (steps: TacticalReplayStep[], through: number) =>
    steps.slice(0, through).map((step) => step.uci);

function repliesAt(choice: TacticalReplayStep, root: DecisionEngineLine, replies: DecisionEngineLine[]) {
    const [top] = replies;
    const board = makeFen(choice.after.toSetup());
    if (
        root.depth < 18 || root.cp === null || root.mate != null ||
        !top || top.cp === null || top.mate != null || top.depth < 16 ||
        Math.abs(root.cp + top.cp) > 90 || !measureDecisionLine(board, top)
    )
        return [];
    return replies.slice(0, 3).filter((line) =>
        line.cp !== null && line.mate == null && line.depth === top.depth &&
        top.cp! >= line.cp && top.cp! - line.cp <= 50 &&
        measureDecisionLine(board, line),
    );
}

export function promotionTradeAfterAdvance(
    fen: string, root: DecisionEngineLine, replies: DecisionEngineLine[], allowSingle = false,
    horizon = 7,
) {
    const [choice] = replayTacticalLine(fen, root.pvUci.slice(0, 1));
    if (!choice || choice.before.board.get(choice.move.from)?.role !== "pawn" || !measureDecisionLine(fen, root))
        return;
    const side = choice.before.turn;
    if (relativeRank(choice.move.from, side) !== 6 ||
        relativeRank(choice.move.to, side) !== 7)
        return;
    const found = [];
    for (const reply of repliesAt(choice, root, replies)) {
        const steps = replayTacticalLine(fen, [choice.uci, ...reply.pvUci.slice(0, horizon + 3)]);
        const result = traceAdvancedPawn(steps, choice.move.from, side);
        const promotion = result.promotion;
        const trade = promotion?.trade;
        if (
            !promotion || !trade || promotion.through > horizon ||
            file(promotion.square) !== file(choice.move.to) ||
            steps.length < trade.through + 2 ||
            steps.slice(trade.through - 1, trade.through + 2).some((step) => step.balance < 90)
        )
            continue;
        if (found.some((other) => other.steps[1].uci === steps[1].uci)) continue;
        found.push({ steps, promotion, trade });
    }
    const best = found[0];
    if (!best) return;
    const firstBoards = new Set(best.steps.slice(1, best.promotion.through - 1)
        .map((step) => tacticalRepetitionKey(step.after)));
    const second = found.find((item) =>
        item.steps[1].uci !== best.steps[1].uci && item.promotion.square === best.promotion.square &&
        item.trade.role === best.trade.role && item.steps.slice(1, item.promotion.through - 1)
            .every((step) => !firstBoards.has(tacticalRepetitionKey(step.after))));
    if (!second && !allowSingle) return;
    const explain = (item: typeof best) => `${item.steps[1].san} allows ${item.trade.description}`;
    return {
        description: second
            ? `The advance ${choice.san} threatens to trade the pawn for a ${best.trade.role}. In the searched continuations, ${explain(best)} and ${explain(second)}.`
            : `After ${choice.san}, ${explain(best)}, trading the pawn for a ${best.trade.role} in this continuation.`,
        linesUci: [
            prefix(best.steps, best.trade.through),
            second ? prefix(second.steps, second.trade.through) : root.pvUci.slice(0, 10),
        ],
    } satisfies PositionStrategicPlan;
}

/** Follow one rook across the search line and require the actual occupation
 * of the advanced file to survive another three plies. */
function retainedRookEntry(steps: TacticalReplayStep[], from: number, square: Square, target: Square) {
    const owner = steps[0].before.turn;
    for (let i = from; i < steps.length; i++) {
        const { move, before, after } = steps[i];
        if (before.turn !== owner) {
            if (move.to === square) return;
            continue;
        }
        if (move.from !== square) continue;
        square = move.to;
        if (
            file(square) !== file(target) || relativeRank(square, owner) < 6 ||
            relativeRank(square, owner) <= relativeRank(target, owner) ||
            [...after.board.pawn].some((pawn) => file(pawn) === file(target))
        )
            continue;
        const tail = steps.slice(i + 1, i + 4);
        if (tail.length === 3 && tail.every((step) => step.move.from !== square && step.move.to !== square))
            return { san: steps[i].san, through: i + 4, square };
    }
}

function acceptedExchange(steps: TacticalReplayStep[]) {
    const [choice, reply, take] = steps;
    if (
        !take?.capture || !reply.capture || reply.move.to !== choice.move.to ||
        take.move.to !== choice.move.to ||
        choice.before.board.get(choice.move.from)?.role !== "rook" ||
        take.before.board.get(take.move.from)?.role !== "rook" ||
        !["bishop", "knight"].includes(reply.before.board.get(reply.move.from)?.role ?? "") ||
        file(choice.move.to) !== file(take.move.from) ||
        !between(take.move.from, choice.move.to).has(choice.move.from) ||
        take.balance > -60 || take.balance < -220
    )
        return;
    return { choice, reply, take };
}

export function exchangeForRookActivity(
    fen: string, root: DecisionEngineLine, alternatives: DecisionEngineLine[], replies: DecisionEngineLine[],
    allowUncompared = false,
) {
    if (root.cp === null || root.cp < 80 || !measureDecisionLine(fen, root)) return;
    const main = replayTacticalLine(fen, root.pvUci.slice(0, 13));
    const exchange = acceptedExchange(main);
    if (!exchange) return;
    const { choice, reply, take } = exchange;
    const target = take.move.to;
    const entry = retainedRookEntry(main, 3, target, target);
    if (!entry) return;
    const checked = repliesAt(choice, root, replies);
    if (!checked[0] || checked[0].pvUci[0] !== reply.uci || checked[0].pvUci[1] !== take.uci)
        return;
    const sameBranch = replayTacticalLine(fen, [choice.uci, ...checked[0].pvUci.slice(0, 12)]);
    const repeated = retainedRookEntry(sameBranch, 3, target, target);
    if (!repeated || main[entry.through - 1].balance > -60 ||
        sameBranch[repeated.through - 1].balance > -60)
        return;
    const otherCandidates = alternatives.filter((line) =>
        line.pvUci[0] !== choice.uci && line.depth === root.depth &&
        line.cp !== null && line.cp >= 0 && Math.abs(root.cp! - line.cp) <= 80 &&
        measureDecisionLine(fen, line));
    for (const other of otherCandidates) {
        const path = replayTacticalLine(fen, other.pvUci.slice(0, 13));
        if (acceptedExchange(path)) continue;
        for (const square of choice.before.board.rook.intersect(choice.before.board[choice.before.turn])) {
            const alternative = retainedRookEntry(path, 0, square, target);
            if (!alternative || path[alternative.through - 1].balance < 0) continue;
            const captures = choice.capture ? " and a pawn" : "";
            const replyPiece = reply.before.board.get(reply.move.from)!.role;
            return {
                tactical: `${choice.san} gives up a rook for a ${replyPiece}${captures} in ${reply.san} ${take.san}. Both searches show that the second rook can recapture up the cleared file.`,
                strategic: `After ${choice.san}, ${entry.san} establishes an advanced rook on the ${makeSquare(target)[0]}-file. After ${path[0].san}, ${alternative.san} gives a rook access to the same file with a different exchange.`,
                linesUci: [prefix(main, entry.through), prefix(path, alternative.through)],
            };
        }
    }
    if (allowUncompared)
        return { tactical: `${choice.san} ${reply.san} ${take.san} gives up the exchange.`,
            strategic: `${entry.san} establishes an advanced rook on the opened file.`,
            linesUci: [prefix(main, entry.through), prefix(sameBranch, repeated.through)] };
}
