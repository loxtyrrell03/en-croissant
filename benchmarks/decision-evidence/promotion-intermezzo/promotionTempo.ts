import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import type { Color, Square } from "chessops/types";
import { makeSquare, opposite } from "chessops/util";
import {
    replayTacticalLine,
    tacticalExchangeGain,
    type TacticalReplayStep,
} from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import type { TacticalGameHistory } from "./gameHistory";
import {
    advanceTacticalRepetitionContext,
    readTacticalRepetitionContext,
    tacticalRepetitionClaim,
} from "./repetitionHistory";
import type { TacticalSequenceWitness } from "./tacticalSequenceEvidence";

const HORIZON = 12;
const PREFIX = 5;

function readLine(fen: string, choice: DecisionEngineLine, reply?: DecisionEngineLine) {
    if (reply) {
        const [first] = replayTacticalLine(fen, choice.pvUci.slice(0, 1));
        if (!first || !measureDecisionLine(makeFen(first.after.toSetup()), reply)) return [];
    }
    const pvUci = reply ? [choice.pvUci[0], ...reply.pvUci] : choice.pvUci;
    const line = { ...choice, pvUci: pvUci.slice(0, HORIZON) };
    return measureDecisionLine(fen, line)?.drawnEnding === false
        ? replayTacticalLine(fen, line.pvUci)
        : [];
}

function gainedRecapture(steps: TacticalReplayStep[]) {
    if (steps.length < PREFIX) return null;
    const [promotion, take, check, kingReply, recapture] = steps;
    const target = promotion.move.to;
    if (
        !promotion.move.promotion ||
        promotion.capture ||
        !take.capture ||
        take.move.to !== target ||
        check.capture ||
        check.move.to === target ||
        !check.after.isCheck() ||
        kingReply.before.board.get(kingReply.move.from)?.role !== "king" ||
        !recapture.capture ||
        recapture.move.to !== target ||
        take.before.board.get(take.move.from)?.role !== "rook"
    )
        return null;
    const before = check.before;
    const direct = recapture.move;
    const directGain = tacticalExchangeGain(before, direct);
    if (directGain <= -20000 || directGain >= 90) return null;
    if (tacticalExchangeGain(recapture.before, recapture.move) < 90) return null;
    const directSan = makeSan(before, direct);
    const tried = before.clone();
    tried.play(direct);
    const king = tried.board.kingOf(tried.turn);
    if (king === undefined || !tried.isLegal({ from: king, to: target })) return null;
    const control = makeSan(tried, { from: king, to: target });
    return { promotion, take, check, recapture, directSan, control, target };
}

function retainedRook(steps: TacticalReplayStep[], origin: Square, color: Color, through: number) {
    let square = origin;
    return steps.slice(0, through).every(({ before, after, move }) => {
        if (before.turn === color && move.from === square) square = move.to;
        const piece = after.board.get(square);
        return piece?.color === color && piece.role === "rook";
    });
}

function withoutDraw(fen: string, line: TacticalReplayStep[], through: number, history?: TacticalGameHistory) {
    if (!history) return true;
    let context = readTacticalRepetitionContext(fen, history);
    for (const { uci } of line.slice(0, through)) {
        if (!context || context.endedAtPly !== undefined || tacticalRepetitionClaim(context)) return false;
        context = advanceTacticalRepetitionContext(context, uci);
    }
    return Boolean(context && !tacticalRepetitionClaim(context));
}

export type PromotionTempoEvidence = {
    tactical: string;
    betterLineUci: string[];
    playedLineUci: string[];
    witness: TacticalSequenceWitness;
};

/** Reordering the two moves must change a legal recapture. Both stronger
 * searches move the king away and take the same original rook. */
export function comparePromotionTempo(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    betterReply: DecisionEngineLine,
    playedReply: DecisionEngineLine,
    history?: TacticalGameHistory,
): PromotionTempoEvidence | null {
    if (
        better.pvUci[0]?.length !== 5 ||
        !played.pvUci[0] ||
        better.pvUci[0] === played.pvUci[0] ||
        better.cp === null ||
        played.cp === null ||
        betterReply.cp === null ||
        playedReply.cp === null ||
        [better, played, betterReply, playedReply].some((line) => line.mate != null) ||
        better.depth < 16 ||
        better.depth !== played.depth ||
        Math.min(betterReply.depth, playedReply.depth) < 16 ||
        better.cp - played.cp < 100 ||
        playedReply.cp - betterReply.cp < 70 ||
        Math.abs(better.cp + betterReply.cp) > 90 ||
        Math.abs(played.cp + playedReply.cp) > 90
    )
        return null;
    const good = [readLine(fen, better), readLine(fen, better, betterReply)];
    const [first, independent] = good.map(gainedRecapture);
    if (
        !first ||
        !independent ||
        first.take.uci !== independent.take.uci ||
        first.check.uci !== independent.check.uci ||
        first.recapture.uci !== independent.recapture.uci
    )
        return null;
    const bad = [readLine(fen, played), readLine(fen, played, playedReply)];
    const all = [...good, ...bad];
    const limit = Math.min(...all.map((line) => line.length));
    const owner = first.promotion.before.turn;
    const rook = first.take.move.from;
    for (let through = PREFIX + 2; through <= limit; through++) {
        const balances = all.map((line) => line[through - 1].balance);
        if (
            Math.min(...balances.slice(0, 2)) - Math.max(...balances.slice(2)) < 90 ||
            all.some((line, i) =>
                line[through - 1].after.isCheck() || line[through - 2].balance !== balances[i] ||
                !withoutDraw(fen, line, through, history),
            ) ||
            bad.some((line) => !retainedRook(line, rook, opposite(owner), through))
        )
            continue;
        const description = `After ${first.promotion.san} ${first.take.san}, immediate ${first.directSan} allows ${first.control}. Both better searches insert ${first.check.san} to move the king before ${first.recapture.san}. After ${bad[0][0].san}, the opposing rook from ${makeSquare(rook)} survives the same window.`;
        return {
            tactical: description,
            betterLineUci: good[0].slice(0, through).map(({ uci }) => uci),
            playedLineUci: bad[0].slice(0, through).map(({ uci }) => uci),
            witness: {
                fen,
                actor: owner,
                mechanism: "intermezzo",
                mechanismPly: 3,
                payoffPly: 5,
                squares: [makeSquare(first.check.move.to), makeSquare(first.target)],
                description,
                support: "legal-continuation",
                rootMoveInvolved: true,
                lineUci: good[0].slice(0, PREFIX).map(({ uci }) => uci),
            },
        };
    }
    return null;
}
