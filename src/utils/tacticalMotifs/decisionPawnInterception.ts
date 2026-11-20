import type { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import type { Color, Square } from "chessops/types";
import { makeSquare, opposite } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import type { TacticalGameHistory } from "./gameHistory";
import {
    advanceTacticalRepetitionContext,
    readTacticalRepetitionContext,
    tacticalRepetitionClaim,
} from "./repetitionHistory";
import type { TacticalMistakeEpisode } from "./tacticalMistakeEpisode";

const INTERCEPTION_PLIES = 12;
const DEFENCE_DELAY = 2;
const DEFENCE_RECAPTURES = 4;
const MIN_TRADE_COST = 65;
const relativeRank = (square: Square, side: Color) =>
    side === "white" ? (square >> 3) + 1 : 8 - (square >> 3);

function passed(position: Chess, square: Square, color: Color) {
    return [...position.board.pawn.intersect(position.board[opposite(color)])].every(
        (pawn) =>
            Math.abs((pawn % 8) - (square % 8)) > 1 ||
            relativeRank(pawn, color) <= relativeRank(square, color),
    );
}

function lineSteps(
    fen: string,
    line: DecisionEngineLine,
    limit: number,
    reply?: DecisionEngineLine,
) {
    const [root] = replayTacticalLine(fen, line.pvUci.slice(0, 1));
    if (!root || (reply && !measureDecisionLine(makeFen(root.after.toSetup()), reply))) return [];
    const branch = reply ? { ...line, pvUci: [root.uci, ...reply.pvUci] } : line;
    return measureDecisionLine(fen, branch)?.drawnEnding === false
        ? replayTacticalLine(fen, branch.pvUci.slice(0, limit))
        : [];
}

function findRemoval(line: TacticalReplayStep[], origin: Square) {
    const holder = opposite(line[0].before.turn);
    let pawn = origin;
    let reachedSeventh = relativeRank(pawn, holder) >= 7;
    let gainFromAdvancing = 0;
    for (const [index, step] of line.entries()) {
        const { before, move, capture } = step;
        if (before.turn === holder && move.from === pawn) {
            gainFromAdvancing += (index === 0 ? 0 : line[index - 1].balance) - step.balance;
            pawn = move.to;
            reachedSeventh ||= relativeRank(pawn, holder) >= 7;
            continue;
        }
        if (!capture || before.turn === holder) continue;
        const mover = before.board.get(move.from);
        const enPassant = mover?.role === "pawn" && before.epSquare === move.to;
        const captured = enPassant ? move.to + (before.turn === "white" ? -8 : 8) : move.to;
        if (captured !== pawn) continue;
        return { index, step, pawn, mover, gainFromAdvancing, reachedSeventh };
    }
    return null;
}

function exchangeEnd(
    line: TacticalReplayStep[],
    index: number,
    square: Square,
    lastAdditionalPly: number,
) {
    let end = index + 1;
    while (end < line.length && end <= index + lastAdditionalPly && line[end].move.to === square)
        end++;
    return line[end]?.move.to === square ? null : end;
}

function tradeCost(line: TacticalReplayStep[], origin: Square) {
    const removal = findRemoval(line, origin);
    if (!removal) return null;
    const { index, step, pawn, mover } = removal;
    const side = opposite(step.before.turn);
    if (
        index < 2 ||
        relativeRank(pawn, side) !== 7 ||
        step.before.board.get(pawn)?.role !== "pawn" ||
        !passed(step.before, pawn, side) ||
        !mover ||
        mover.role === "king" ||
        mover.role === "pawn"
    )
        return null;
    const end = exchangeEnd(line, index, pawn, 3);
    if (end === null || end < index + 2) return null;
    const cost = line[index - 1].balance - line[end - 1].balance;
    if (cost < MIN_TRADE_COST) return null;
    return { step, pawn, cost, end, index, role: mover.role };
}

function cleanRemoval(line: TacticalReplayStep[], origin: Square, within: number) {
    const removal = findRemoval(line, origin);
    if (!removal) return null;
    const { step, index, pawn, gainFromAdvancing, reachedSeventh } = removal;
    // A late capture corroborates containment only if this pawn was
    // held below the seventh rank on the way to the capture.
    const limit = reachedSeventh ? within : INTERCEPTION_PLIES + DEFENCE_DELAY;
    if (index >= limit) return null;
    const end = exchangeEnd(line, index, step.move.to, DEFENCE_RECAPTURES);
    // A capture alone is not a safe defence. Replay the same-square
    // exchange and the first reply outside it before counting the material.
    if (end === null || end >= line.length) return null;
    // The promoted piece cannot count at full value as a gain. The original
    // pawn earned that value, and may also have taken pieces while advancing.
    const before = (index === 0 ? 0 : line[index - 1].balance) + gainFromAdvancing;
    if (Math.min(line[end - 1].balance, line[end].balance) < before) return null;
    return {
        san: step.san,
        end: end + 1,
        afterPromotion: step.before.board.get(pawn)?.role !== "pawn",
    };
}

function noDrawClaim(
    fen: string,
    line: TacticalReplayStep[],
    end: number,
    history?: TacticalGameHistory,
) {
    if (!history) return true;
    let context = readTacticalRepetitionContext(fen, history);
    if (!context || tacticalRepetitionClaim(context)) return false;
    for (const step of line.slice(0, end)) {
        context = advanceTacticalRepetitionContext(context, step.uci);
        if (!context || tacticalRepetitionClaim(context)) return false;
    }
    return true;
}

/** The same passer is costly to take after the played move and is
 * removed at no cost after the stronger choice. This certifies the
 * sampled continuation, without asserting a forced result against every defence. */
export function comparePawnInterception(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    betterReply: DecisionEngineLine,
    playedReply: DecisionEngineLine,
    history?: TacticalGameHistory,
): TacticalMistakeEpisode | null {
    if (
        better.cp == null ||
        played.cp == null ||
        betterReply.cp == null ||
        playedReply.cp == null ||
        better.depth !== played.depth ||
        [better, played, betterReply, playedReply].some((line) => line.mate != null) ||
        betterReply.depth < 16 ||
        playedReply.depth < 16 ||
        better.cp - played.cp < 80 ||
        playedReply.cp - betterReply.cp < 65 ||
        Math.abs(better.cp + betterReply.cp) > 90 ||
        Math.abs(played.cp + playedReply.cp) > 90
    )
        return null;

    const [root] = replayTacticalLine(fen, played.pvUci.slice(0, 1));
    if (!root) return null;
    const board = root.before;
    const attacker = opposite(board.turn);
    const pawns = [...board.board.pawn.intersect(board.board[attacker])].filter(
        (square) => relativeRank(square, attacker) >= 5 && passed(board, square, attacker),
    );
    if (!pawns.length) return null;

    const poor = [
        lineSteps(fen, played, INTERCEPTION_PLIES),
        lineSteps(fen, played, INTERCEPTION_PLIES, playedReply),
    ] as const;
    if (poor.some((line) => !line.length)) return null;
    let strong: [TacticalReplayStep[], TacticalReplayStep[]] | undefined;
    for (const pawn of pawns) {
        const first = tradeCost(poor[0], pawn);
        const second = tradeCost(poor[1], pawn);
        if (!first || !second || first.pawn !== second.pawn || first.role !== second.role) continue;

        const within = Math.max(first.end, second.end) + DEFENCE_DELAY;
        // The defence must start near the costly trade. Keep enough of the
        // existing PV to play its recaptures and the next reply to completion.
        const controlPlies = INTERCEPTION_PLIES + DEFENCE_DELAY + DEFENCE_RECAPTURES + 1;
        strong ??= [
            lineSteps(fen, better, controlPlies),
            lineSteps(fen, better, controlPlies, betterReply),
        ];
        if (strong.some((line) => !line.length)) return null;
        const defence = cleanRemoval(strong[0], pawn, within);
        const independent = cleanRemoval(strong[1], pawn, within);
        if (
            !defence ||
            !independent ||
            !noDrawClaim(fen, strong[0], defence.end, history) ||
            !noDrawClaim(fen, strong[1], independent.end, history) ||
            !noDrawClaim(fen, poor[0], first.end, history) ||
            !noDrawClaim(fen, poor[1], second.end, history)
        )
            continue;

        const sample = poor[0]
            .slice(first.index, first.end)
            .map(({ san }) => san)
            .join(" ");
        const original = makeSquare(pawn);
        const cost = (Math.min(first.cost, second.cost) / 100).toFixed(1);
        const control =
            defence.afterPromotion || independent.afterPromotion
                ? "remove the same pawn or the piece it promotes to"
                : "take the same pawn";
        return {
            kind: "forcing-attack",
            throughPly: Math.max(first.end, second.end),
            playedLineUci: poor[0].slice(0, first.end).map(({ uci }) => uci),
            betterLineUci: strong[0].slice(0, defence.end).map(({ uci }) => uci),
            mechanisms: [],
            explanation: `After ${root.san}, stopping the passed pawn from ${original} costs at least ${cost} material points in both searched lines. One line shows ${sample}. After ${strong[0][0].san}, both searches ${control} without a material loss through the next reply.`,
        };
    }
    return null;
}
