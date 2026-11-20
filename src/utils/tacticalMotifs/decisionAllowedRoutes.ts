import { castlingSide } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSquare } from "chessops/util";
import {
    MIN_TACTICAL_CAPTURE_GAIN,
    replayTacticalLine,
    tacticalExchangeGain,
    type TacticalReplayStep,
} from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import { compareSameBoardRoutes } from "./decisionLineRoutes";
import { followPieceIdentities, initialPieceIdentities } from "./decisionPieceIdentity";
import type { TacticalGameHistory } from "./gameHistory";
import {
    advanceTacticalRepetitionContext,
    readTacticalRepetitionContext,
    tacticalRepetitionClaim,
} from "./repetitionHistory";
import type { TacticalMistakeEpisode } from "./tacticalMistakeEpisode";

function legalSteps(fen: string, line: DecisionEngineLine, history?: TacticalGameHistory) {
    if (measureDecisionLine(fen, line)?.drawnEnding !== false) return [];
    const steps = replayTacticalLine(fen, line.pvUci.slice(0, 15));
    if (history) {
        let context = readTacticalRepetitionContext(fen, history);
        if (!context || tacticalRepetitionClaim(context)) return [];
        for (const step of steps) {
            context = advanceTacticalRepetitionContext(context, step.uci);
            if (!context || tacticalRepetitionClaim(context)) return [];
        }
    }
    return steps;
}

/** Follow the actual attack against the stronger choice, keeping original
 * pieces attached to their squares across both branches. A changed unit
 * earlier in the line makes the comparison inconclusive. */
function findPreventedRoute(
    wrong: TacticalReplayStep[],
    right: TacticalReplayStep,
    payoffPly: number,
) {
    const positions = initialPieceIdentities(right.before);
    const actual = new Map(positions);
    followPieceIdentities(positions, right);
    const played = wrong[0];
    followPieceIdentities(actual, played);
    const alternative = right.after.clone();
    const control = [right.uci];
    for (let index = 1; index <= payoffPly; index++) {
        const step = wrong[index];
        const { from, to } = step.move;
        if (positions.get(from) !== actual.get(from)) {
            const missingAttacker =
                index === 1 &&
                right.capture &&
                right.move.to === from &&
                right.after.board.get(from)?.color === right.before.turn;
            if (missingAttacker)
                return {
                    control,
                    reason: `${right.san} takes the ${step.before.board.get(from)!.role} that would play ${step.san}.`,
                };
            return null;
        }
        if (alternative.board.get(from)?.role !== step.before.board.get(from)?.role) return null;
        if (positions.get(to) !== actual.get(to)) {
            const victim = actual.get(to);
            if (index === payoffPly && step.capture && victim !== undefined) {
                const other = [...positions].find(([, original]) => original === victim)?.[0];
                if (
                    other !== undefined &&
                    ((played.move.to === to && played.move.from === victim) ||
                        right.move.from === victim)
                )
                    return {
                        control,
                        reason: `After ${right.san}, the original target is on ${makeSquare(other)}. The same move no longer takes it on ${makeSquare(to)}.`,
                    };
            }
            return null;
        }
        if (!alternative.isLegal(step.move)) {
            if (index === 1 && alternative.isCheck())
                return {
                    control,
                    reason: `${right.san} gives check first, so ${step.san} is unavailable.`,
                };
            if (index === payoffPly)
                return {
                    control,
                    reason: `After ${right.san}, ${step.san} is unavailable in the same continuation.`,
                };
            return null;
        }
        const [next] = replayTacticalLine(makeFen(alternative.toSetup()), [step.uci]);
        if (
            !next ||
            next.capture !== step.capture ||
            (next.before.epSquare === to) !== (step.before.epSquare === to) ||
            Boolean(castlingSide(next.before, next.move)) !==
                Boolean(castlingSide(step.before, step.move))
        )
            return null;
        alternative.play(step.move);
        followPieceIdentities(positions, next);
        followPieceIdentities(actual, step);
        control.push(step.uci);
        if (alternative.isCheck() !== step.after.isCheck() && index < payoffPly) return null;
    }
    return null;
}

function comparablePayoff(branches: TacticalReplayStep[][], closure: number) {
    const [paired, independent, best, betterReply] = branches;
    const horizon = Math.min(...branches.map((line) => line.length));
    for (let end = closure + 1; end <= Math.min(horizon, closure + 4); end++) {
        const held = (line: TacticalReplayStep[]) =>
            line.slice(end - 2, end).map((step) => step.balance);
        const bad = Math.max(...[paired, independent].flatMap(held));
        const good = Math.min(...[best, betterReply].flatMap(held));
        if (bad <= -90 && good - bad >= 90) return { end, difference: (good - bad) / 100 };
    }
    return null;
}

/** A later capture of the original collector can settle an earlier
 * exchange, even after intervening moves. Separate gains elsewhere in the
 * line do not prove the advertised capture won material on its own. */
function recoversClaimedCapture(steps: TacticalReplayStep[], index: number) {
    const take = steps[index];
    const square = take.move.to;
    const side = take.before.turn;
    for (const later of steps.slice(index + 1, 13)) {
        if (later.move.from === square) return false;
        if (later.before.turn === side || !later.capture || later.move.to !== square) continue;
        const returned = tacticalExchangeGain(later.before, later.move);
        return (
            returned >= MIN_TACTICAL_CAPTURE_GAIN &&
            take.capture - returned < MIN_TACTICAL_CAPTURE_GAIN
        );
    }
    return false;
}

function consequenceAt(line: TacticalReplayStep[], index: number) {
    const square = line[index].move.to;
    let last = index;
    while (line[last + 1]?.capture && line[last + 1].move.to === square) last++;
    return line[last].balance <= line[index - 1].balance - 90 ? last + 1 : null;
}

/** Opponent's scoped route in two played branches, plus a retained material
 * difference against two exact independent continuations for the stronger move. */
export function compareAllowedDecisionRoutes(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    betterReply: DecisionEngineLine,
    opponent: DecisionEngineLine,
    history?: TacticalGameHistory,
    method: "outcome-only" | "prevented" | "capture" | "verified" = "verified",
): TacticalMistakeEpisode | null {
    if (
        better.depth !== played.depth ||
        better.depth < 16 ||
        [better, played, betterReply, opponent].some(
            (line) => line.cp === null || line.mate != null,
        ) ||
        better.cp! - played.cp! < 90 ||
        opponent.cp! - betterReply.cp! < 90 ||
        Math.abs(better.cp! + betterReply.cp!) > 90 ||
        betterReply.depth < 16 ||
        played.pvUci[0] === better.pvUci[0]
    )
        return null;
    const [actual] = replayTacticalLine(fen, played.pvUci.slice(0, 1));
    const [choice] = replayTacticalLine(fen, better.pvUci.slice(0, 1));
    if (
        !actual ||
        !choice ||
        measureDecisionLine(makeFen(choice.after.toSetup()), betterReply)?.drawnEnding !== false
    )
        return null;
    const attackedFen = makeFen(actual.after.toSetup());
    const attack = { ...played, fen: attackedFen, cp: -played.cp!, pvUci: played.pvUci.slice(1) };
    const attackHistory = history && { fen: history.fen, moves: [...history.moves, actual.uci] };
    const routes =
        method === "capture"
            ? []
            : compareSameBoardRoutes(attackedFen, attack, opponent, attackHistory);
    if (!routes.length && (method === "prevented" || method === "outcome-only")) return null;
    if (
        measureDecisionLine(attackedFen, opponent)?.drawnEnding !== false ||
        Math.abs(played.cp! + opponent.cp!) > 90 ||
        opponent.depth < 16
    )
        return null;
    const extend = (line: DecisionEngineLine, reply: DecisionEngineLine) => ({
        ...line,
        pvUci: [line.pvUci[0], ...reply.pvUci],
    });
    const worse = [
        legalSteps(fen, played, history),
        legalSteps(fen, extend(played, opponent), history),
    ];
    const stronger = [
        legalSteps(fen, better, history),
        legalSteps(fen, extend(better, betterReply), history),
    ];
    const steps = [...worse, ...stronger];
    if (steps.some((line) => !line.length)) return null;
    for (const { first, second } of routes) {
        const closure = Math.max(first.lineUci.length, second.lineUci.length) + 1;
        const outcome = comparablePayoff(steps, closure);
        if (!outcome) continue;
        const breach = findPreventedRoute(worse[1], choice, second.payoffPly);
        if (!breach && method !== "outcome-only") continue;
        return {
            kind: "comparative",
            throughPly: outcome.end,
            materialDifferencePoints: outcome.difference,
            playedLineUci: worse[1].slice(0, outcome.end).map((step) => step.uci),
            betterLineUci: stronger[0].slice(0, outcome.end).map((step) => step.uci),
            ...(breach && breach.control.length > 1 ? { controlLineUci: breach.control } : {}),
            mechanisms: [second],
            explanation: `After ${actual.san}, ${second.description}${breach ? " " + breach.reason : ""}`,
        };
    }
    if (method === "capture" || method === "verified") {
        for (let index = 1; index < Math.min(8, worse[0].length, worse[1].length); index++) {
            const step = worse[1][index];
            if (step.uci !== worse[0][index].uci) break;
            if (index % 2 === 0 || !step.capture) continue;
            const closures = worse.map((line) => consequenceAt(line, index));
            if (closures.some((time) => time === null)) continue;
            if (worse.some((line) => recoversClaimedCapture(line, index))) continue;
            const outcome = comparablePayoff(steps, Math.max(...closures.map((time) => time!)));
            if (!outcome) continue;
            const breach = findPreventedRoute(worse[1], choice, index);
            if (!breach) continue;
            return {
                kind: "comparative",
                throughPly: outcome.end,
                materialDifferencePoints: outcome.difference,
                playedLineUci: worse[1].slice(0, outcome.end).map((step) => step.uci),
                betterLineUci: stronger[0].slice(0, outcome.end).map((step) => step.uci),
                ...(breach.control.length > 1 ? { controlLineUci: breach.control } : {}),
                mechanisms: [],
                explanation: `After ${actual.san}, both searches show ${step.san} winning material. ${breach.reason}`,
            };
        }
    }
    return null;
}
