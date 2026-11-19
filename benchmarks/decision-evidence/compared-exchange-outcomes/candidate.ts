import { castlingSide } from "chessops/chess";
import { makeFen } from "chessops/fen";
import type { Square } from "chessops/types";
import { kingCastlesTo, makeSquare, rookCastlesTo } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "@/utils/tacticalMotifs/causalTactics";
import {
    measureDecisionLine,
    type DecisionEngineLine,
} from "@/utils/tacticalMotifs/decisionEvidence";

const MAX_PLIES = 17;
const LAST_CAPTURE_PLY = 10;

export type DecisionExchangeConsequence = {
    betterLineUci: string[];
    playedLineUci: string[];
    confirmationLineUci: string[];
    explanation: string;
};

type TrackedStep = {
    step: TacticalReplayStep;
    captured?: Square;
    remaining: Set<Square>;
};

function track(steps: TacticalReplayStep[]): TrackedStep[] {
    const origins = new Map([...steps[0].before.board].map(([square]) => [square, square]));
    return steps.map((step) => {
        const { before, move } = step;
        const origin = origins.get(move.from)!;
        const castle = castlingSide(before, move);
        let captured: Square | undefined;
        if (castle) {
            const rook = before.castles.rook[before.turn][castle]!;
            const rookOrigin = origins.get(rook)!;
            origins.delete(move.from);
            origins.delete(rook);
            origins.set(kingCastlesTo(before.turn, castle), origin);
            origins.set(rookCastlesTo(before.turn, castle), rookOrigin);
        } else {
            if (step.capture) {
                const square =
                    before.epSquare === move.to && before.board.get(move.from)?.role === "pawn"
                        ? ((move.to + (before.turn === "white" ? -8 : 8)) as Square)
                        : move.to;
                captured = origins.get(square);
                origins.delete(square);
            }
            origins.delete(move.from);
            origins.set(move.to, origin);
        }
        return { step, captured, remaining: new Set(origins.values()) };
    });
}

function quiet({ step }: TrackedStep) {
    return !step.capture && !step.move.promotion && !step.after.isCheck();
}

function opponentCaptures(line: TrackedStep[], limit: number) {
    const captures = new Set<Square>();
    for (let index = 1; index < limit; index += 2) {
        const { captured } = line[index];
        if (captured !== undefined) captures.add(captured);
    }
    return captures;
}

/** Compare the actual material through the resolved exchange, tracking which
 * original pieces disappear. A routine exchange shared by both choices
 * cannot supply the distinguishing piece. This is a comparison of searched
 * replies, rather than a claim that every possible reply loses material. */
export function compareExchangeConsequence(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    reply: DecisionEngineLine,
    betterReply?: DecisionEngineLine,
): DecisionExchangeConsequence | null {
    if (
        better.depth < 16 ||
        better.depth !== played.depth ||
        better.cp === null ||
        played.cp === null ||
        better.cp - played.cp < 100 ||
        reply.cp === null ||
        reply.depth < 16 ||
        Math.abs(played.cp + reply.cp) > 90 ||
        played.pvUci[1] !== reply.pvUci[0] ||
        [better, played, reply].some((line) => line.mate != null)
    )
        return null;
    const [alternative] = replayTacticalLine(fen, played.pvUci.slice(0, 1));
    if (!alternative) return null;
    const childFen = makeFen(alternative.after.toSetup());
    if (
        !measureDecisionLine(fen, better) ||
        !measureDecisionLine(fen, played) ||
        !measureDecisionLine(childFen, reply)
    )
        return null;
    const replays = [better.pvUci, played.pvUci, [alternative.uci, ...reply.pvUci]].map((line) =>
        replayTacticalLine(fen, line.slice(0, MAX_PLIES)),
    );
    const last = Math.min(...replays.map((line) => line.length)) - 1;
    if (last < 6) return null;
    const entry = replays[1][1];
    if (!entry.capture && !entry.after.isCheck()) return null;
    const [good, bad, corroboration] = replays.map(track);
    const weaker = [bad, corroboration];
    if (weaker.some((line) => line[last].step.balance >= Math.min(0, good[last].step.balance)))
        return null;
    let betterSurvivors = good[last].remaining;
    if (betterReply) {
        const reached = makeFen(good[0].step.after.toSetup());
        if (
            betterReply.cp === null ||
            betterReply.mate != null ||
            betterReply.depth < 16 ||
            Math.abs(better.cp + betterReply.cp) > 90 ||
            !measureDecisionLine(reached, betterReply)
        )
            return null;
        const check = replayTacticalLine(
            fen,
            [good[0].step.uci, ...betterReply.pvUci].slice(0, MAX_PLIES),
        );
        if (check.length <= last) return null;
        const checked = track(check)[last].remaining;
        betterSurvivors = new Set([...betterSurvivors].filter((square) => checked.has(square)));
    }
    for (let through = 7; through <= last + 1; through++) {
        const pivot = through - 1;
        if (![good, ...weaker].every((line) => line.slice(through - 2, through).every(quiet)))
            continue;
        if (
            weaker.some(
                (line) =>
                    line[pivot].step.balance > -100 ||
                    good[pivot].step.balance - line[pivot].step.balance < 100,
            )
        )
            continue;
        const limit = Math.min(through - 2, LAST_CAPTURE_PLY);
        const [taken, repeated] = weaker.map((line) => opponentCaptures(line, limit));
        if (taken.size < 2 || repeated.size < 2) continue;
        const extra = [...taken].filter(
            (square) => repeated.has(square) && betterSurvivors.has(square),
        );
        if (!extra.length) continue;
        const retained = extra
            .sort((a, b) => a - b)
            .map(
                (square) =>
                    `the ${alternative.before.board.get(square)!.role} from ${makeSquare(square)}`,
            )
            .join(" and ");
        return {
            betterLineUci: better.pvUci.slice(0, through),
            playedLineUci: played.pvUci.slice(0, through),
            confirmationLineUci: [alternative.uci, ...reply.pvUci].slice(0, through),
            explanation: `After ${alternative.san}, both searches start with ${entry.san} and take ${retained}. ${good[0].step.san} keeps that material in the compared line.`,
        };
    }
    return null;
}
