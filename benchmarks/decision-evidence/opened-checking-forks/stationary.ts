import { between, attacks } from "chessops/attacks";
import { makeFen } from "chessops/fen";
import { makeSquare } from "chessops/util";
import {
    MIN_TACTICAL_CAPTURE_GAIN,
    replayTacticalLine,
    tacticalExchangeGain,
    type TacticalReplayStep,
} from "@/utils/tacticalMotifs/causalTactics";
import {
    measureDecisionLine,
    type DecisionEngineLine,
} from "@/utils/tacticalMotifs/decisionEvidence";
import type { TacticalGameHistory } from "@/utils/tacticalMotifs/gameHistory";
import {
    advanceTacticalRepetitionContext,
    readTacticalRepetitionContext,
    tacticalRepetitionClaim,
} from "@/utils/tacticalMotifs/repetitionHistory";
import type { TacticalMistakeEpisode } from "@/utils/tacticalMotifs/tacticalMistakeEpisode";

const MIN_SCORE_LOSS = 100;
const MAX_CONFIRMATION_DRIFT = 90;
const MIN_DEPTH = 16;
const LAST_CHECKPOINT = 8;

type Line = TacticalReplayStep[];

function reliablePair(better: DecisionEngineLine, played: DecisionEngineLine) {
    return (
        better.depth === played.depth &&
        better.depth >= MIN_DEPTH &&
        better.cp != null &&
        played.cp != null &&
        better.mate == null &&
        played.mate == null &&
        better.cp - played.cp >= MIN_SCORE_LOSS
    );
}

function replyFor(
    root: TacticalReplayStep,
    choice: DecisionEngineLine,
    confirmation: DecisionEngineLine,
) {
    if (
        choice.cp == null ||
        confirmation.cp == null ||
        confirmation.depth < MIN_DEPTH ||
        confirmation.mate != null ||
        Math.abs(choice.cp + confirmation.cp) > MAX_CONFIRMATION_DRIFT ||
        measureDecisionLine(makeFen(root.after.toSetup()), confirmation)?.drawnEnding !== false
    )
        return [];
    return replayTacticalLine(makeFen(root.before.toSetup()), [
        root.uci,
        ...confirmation.pvUci.slice(0, LAST_CHECKPOINT - 1),
    ]);
}

function checkedFrame(fen: string, choice: DecisionEngineLine) {
    return measureDecisionLine(fen, choice)?.drawnEnding === false
        ? replayTacticalLine(fen, choice.pvUci.slice(0, LAST_CHECKPOINT))
        : [];
}

function inSameLine(first: Line, second: Line, checkAt: number, gainAt: number) {
    return (
        first.slice(0, checkAt + 1).every((step, index) => step.uci === second[index].uci) &&
        first[gainAt].uci === second[gainAt].uci
    );
}

function captureTarget(line: Line, checkAt: number) {
    const check = line[checkAt];
    const takes = line[checkAt + 2];
    const attacker = check?.after.board.get(check.move.to);
    if (
        !attacker ||
        (attacker.role !== "bishop" && attacker.role !== "rook" && attacker.role !== "queen") ||
        !check.after.ctx().checkers.has(check.move.to) ||
        !takes ||
        takes.move.from !== check.move.to ||
        takes.move.promotion ||
        takes.capture < 300
    )
        return null;
    const { to } = takes.move;
    const victim = check.after.board.get(to);
    const original = line[0].before.board.get(to);
    if (
        !victim ||
        victim.role === "king" ||
        original?.role !== victim.role ||
        original.color !== victim.color ||
        victim.color === attacker.color ||
        line.slice(0, checkAt + 2).some(({ move }) => move.from === to || move.to === to) ||
        !attacks(attacker, check.move.to, check.after.board.occupied).has(to) ||
        tacticalExchangeGain(takes.before, takes.move) < MIN_TACTICAL_CAPTURE_GAIN
    )
        return null;
    return { check, takes, attacker, victim };
}

function priorInterference(line: Line, better: Line, checkAt: number, check: TacticalReplayStep) {
    const root = line[0];
    const control = better[0];
    const { from, to } = check.move;
    const route = between(from, to);
    if (checkAt === 1) {
        if (
            !route.has(root.move.from) ||
            !control.after.board[root.before.turn].has(root.move.from) ||
            control.after.isLegal(check.move)
        )
            return null;
        const blocker = control.after.board.get(root.move.from);
        return {
            entrance: `${root.san} leaves ${makeSquare(root.move.from)} clear`,
            improvement: `${control.san} leaves the ${blocker!.role} on ${makeSquare(root.move.from)}, blocking the same route.`,
        };
    }
    const [, offered, retake] = line;
    if (
        !offered.capture ||
        !retake.capture ||
        offered.move.to !== root.move.to ||
        retake.move.to !== offered.move.to ||
        offered.before.epSquare === offered.move.to ||
        [root, offered, retake].some(({ move }) => move.promotion) ||
        !route.has(retake.move.from) ||
        control.after.board[root.before.turn].has(root.move.to)
    )
        return null;
    const shifted = retake.before.board.get(retake.move.from);
    if (!shifted) return null;
    return {
        entrance: `After ${root.san} ${offered.san}, ${retake.san} moves the ${shifted.role} off ${makeSquare(retake.move.from)}`,
        improvement: `${control.san} keeps the original ${root.before.board.get(root.move.from)!.role} off ${makeSquare(root.move.to)}, so the opponent cannot begin with the same capture.`,
    };
}

/** A checking move uses the square the played choice or its recapture emptied.
 * It also attacks a separate piece, which the same attacker takes in both
 * weak lines. Compare the material that remains after the immediate response. */
export function compareOpenedCheckingAttack(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    betterReply: DecisionEngineLine,
    playedReply: DecisionEngineLine,
    history?: TacticalGameHistory,
): TacticalMistakeEpisode | null {
    if (
        !reliablePair(better, played) ||
        betterReply.cp == null ||
        playedReply.cp == null ||
        playedReply.cp - betterReply.cp < MIN_SCORE_LOSS ||
        better.pvUci[0] === played.pvUci[0] ||
        played.pvUci[1] !== playedReply.pvUci[0] ||
        played.pvUci.length < 6
    )
        return null;
    const playedRoute = replayTacticalLine(fen, played.pvUci.slice(0, 6));
    if (
        [1, 3].every(
            (index) =>
                !playedRoute
                    .slice(0, index + 1)
                    .every(({ uci }, ply) => ply === 0 || uci === playedReply.pvUci[ply - 1]) ||
                !captureTarget(playedRoute, index),
        )
    )
        return null;
    const weak = checkedFrame(fen, played);
    const strong = checkedFrame(fen, better);
    if (!weak[0] || !strong[0]) return null;
    const confirmedWeak = replyFor(weak[0], played, playedReply);
    const confirmedStrong = replyFor(strong[0], better, betterReply);
    const lines = [weak, confirmedWeak, strong, confirmedStrong];
    for (const checkAt of [1, 3]) {
        const gainAt = checkAt + 2;
        const checkpoint = gainAt + 2;
        if (
            lines.some((line) => line.length <= checkpoint) ||
            !inSameLine(weak, confirmedWeak, checkAt, gainAt)
        )
            continue;
        const primary = captureTarget(weak, checkAt);
        if (!primary || !captureTarget(confirmedWeak, checkAt)) continue;
        const contrast = priorInterference(weak, strong, checkAt, primary.check);
        if (!contrast) continue;
        const weakBalance = Math.max(weak[checkpoint].balance, confirmedWeak[checkpoint].balance);
        const strongBalance = Math.min(
            strong[checkpoint].balance,
            confirmedStrong[checkpoint].balance,
        );
        if (
            weakBalance > -MIN_TACTICAL_CAPTURE_GAIN ||
            strongBalance - weakBalance < MIN_SCORE_LOSS
        )
            continue;
        const throughPly = checkpoint + 1;
        if (history) {
            const start = readTacticalRepetitionContext(fen, history);
            if (!start || tacticalRepetitionClaim(start)) return null;
            const protectedFromDraw = lines.every((line) => {
                let context = start;
                for (const step of line.slice(0, throughPly)) {
                    const next = advanceTacticalRepetitionContext(context, step.uci);
                    if (!next || next.endedAtPly !== undefined || tacticalRepetitionClaim(next))
                        return false;
                    context = next;
                }
                return true;
            });
            if (!protectedFromDraw) continue;
        }
        const { check, takes, attacker, victim } = primary;
        return {
            kind: "comparative",
            throughPly,
            materialDifferencePoints: (strongBalance - weakBalance) / 100,
            playedLineUci: weak.slice(0, throughPly).map((step) => step.uci),
            betterLineUci: strong.slice(0, throughPly).map((step) => step.uci),
            mechanisms: [],
            explanation: `${contrast.entrance}. The opposing ${attacker.role} uses that line with ${check.san}, checking the king and attacking the ${victim.role} on ${makeSquare(takes.move.to)}. Both searches show ${takes.san} taking it. ${contrast.improvement}`,
        };
    }
    return null;
}
