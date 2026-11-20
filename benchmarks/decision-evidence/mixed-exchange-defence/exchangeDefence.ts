import { attacks } from "chessops/attacks";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import type { NormalMove } from "chessops/types";
import { makeSquare, makeUci } from "chessops/util";
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
import type { TacticalMistakeEpisode } from "@/utils/tacticalMotifs/tacticalMistakeEpisode";

const MIN_GAIN = MIN_TACTICAL_CAPTURE_GAIN;
const PIECE_VALUES = { knight: 320, bishop: 330, rook: 500, queen: 900, pawn: 100, king: 0 };
const EXHAUSTED = -20000;

function recaptures(take: TacticalReplayStep) {
    const replies: NormalMove[] = [];
    for (const [from, targets] of take.after.allDests()) {
        if (!targets.has(take.move.to)) continue;
        // Promotions make both the new piece's identity and the resulting
        // cost ambiguous. Leave those exchanges to the promotion verifier.
        if (take.after.board.get(from)?.role === "pawn" && (take.move.to < 8 || take.move.to >= 56))
            return null;
        replies.push({ from, to: take.move.to });
    }
    return replies;
}

function plausibleRecaptures(take: TacticalReplayStep) {
    const replies = recaptures(take);
    if (!replies) return null;
    const plausible: Array<{ reply: NormalMove }> = [];
    for (const reply of replies) {
        const localGain = tacticalExchangeGain(take.after, reply);
        if (localGain <= EXHAUSTED) return null;
        if (localGain > take.capture - MIN_GAIN) plausible.push({ reply });
    }
    return plausible;
}

function deflectedGuard(take: TacticalReplayStep, reply: NormalMove) {
    const after = take.after.clone();
    after.play(reply);
    const guard = take.after.board.get(reply.from);
    const vacatedGuard = after.board.get(reply.to);
    const offered = take.before.board.get(take.move.from);
    if (!guard || !vacatedGuard || !offered || guard.role === "king" || endsContinuation(after))
        return null;
    const targets = attacks(guard, reply.from, take.after.board.occupied)
        .intersect(after.board[guard.color])
        .without(reply.to)
        .diff(attacks(vacatedGuard, reply.to, after.board.occupied));

    for (const [from, destinations] of after.allDests()) {
        for (const to of destinations.intersect(targets)) {
            const move = { from, to };
            const victim = after.board.get(to)!;
            if (victim.role === "pawn" || victim.role === "king") continue;
            const previous = take.before.isLegal(move)
                ? tacticalExchangeGain(take.before, move)
                : 0;
            if (previous <= EXHAUSTED || previous >= MIN_GAIN) continue;
            const gain = tacticalExchangeGain(after, move);
            if (gain < MIN_GAIN + PIECE_VALUES[offered.role] - take.capture) continue;
            // The countercapture compares the outright price of the guard's
            // recapture. A hypothetical recapture on the first square is
            // never credited in addition to taking the other piece.
            return { move, san: makeSan(after, move), square: makeSquare(to), role: victim.role };
        }
    }
    return null;
}

function endsContinuation(board: TacticalReplayStep["after"]) {
    return board.halfmoves >= 100 || board.isEnd();
}

function measured(fen: string, choice: DecisionEngineLine, reply?: DecisionEngineLine) {
    const [root] = replayTacticalLine(fen, choice.pvUci.slice(0, 1));
    if (
        !root ||
        (reply && measureDecisionLine(makeFen(root.after.toSetup()), reply)?.drawnEnding !== false)
    )
        return [];
    const line = reply ? { ...choice, pvUci: [root.uci, ...reply.pvUci] } : choice;
    return measureDecisionLine(fen, line)?.drawnEnding === false
        ? replayTacticalLine(fen, line.pvUci.slice(0, 9))
        : [];
}

export type ExchangeDefence = TacticalMistakeEpisode & {
    branchUci: string[];
    controlUci: string[];
};

export function compareExchangeDefence(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    betterReply: DecisionEngineLine,
    playedReply: DecisionEngineLine,
): ExchangeDefence | null {
    if (
        better.cp == null ||
        played.cp == null ||
        betterReply.cp == null ||
        playedReply.cp == null ||
        better.depth !== played.depth ||
        better.depth < 16 ||
        betterReply.depth < 16 ||
        playedReply.depth < 16 ||
        better.cp - played.cp < 100 ||
        playedReply.cp - betterReply.cp < 75 ||
        Math.abs(better.cp + betterReply.cp) > 90 ||
        Math.abs(played.cp + playedReply.cp) > 90 ||
        [better, played, betterReply, playedReply].some((line) => line.mate != null)
    )
        return null;
    const route = played.pvUci.slice(1, 4);
    if (route.length !== 3 || route.some((uci, index) => uci !== playedReply.pvUci[index]))
        return null;
    const weak = measured(fen, played);
    const [root, trade, pawn, take] = weak;
    if (
        !take ||
        !trade.capture ||
        !pawn.capture ||
        !take.capture ||
        trade.move.to !== pawn.move.to ||
        take.move.to === pawn.move.to ||
        [trade, pawn, take].some((step) => step.move.promotion) ||
        take.before.board.get(take.move.to)?.role !== "pawn"
    )
        return null;
    const recaptureOptions = plausibleRecaptures(take);
    if (!recaptureOptions?.length) return null;
    const punishments = recaptureOptions.map(({ reply }) => ({
        reply,
        resource: deflectedGuard(take, reply),
    }));
    if (punishments.some(({ resource }) => !resource)) return null;
    const strong = measured(fen, better);
    const [control] = strong;
    if (!control) return null;
    const alternative = replayTacticalLine(fen, [control.uci, ...route]);
    const afterControl = alternative[3];
    if (
        !afterControl ||
        alternative
            .slice(1)
            .some(
                (step, index) =>
                    step.capture !== weak[index + 1].capture || endsContinuation(step.after),
            )
    )
        return null;
    const controlledReplies = plausibleRecaptures(afterControl);
    if (!controlledReplies) return null;
    const saved = punishments.find(({ reply, resource }) => {
        if (
            !resource ||
            control.move.from !== resource.move.to ||
            !controlledReplies.some((item) => makeUci(item.reply) === makeUci(reply)) ||
            deflectedGuard(afterControl, reply)
        )
            return false;
        const response = afterControl.after.clone();
        response.play(reply);
        const movedVictim = response.board.get(control.move.to);
        if (
            endsContinuation(response) ||
            movedVictim?.role !== resource.role ||
            movedVictim.color !== take.after.turn
        )
            return false;
        if (
            alternative
                .slice(1)
                .some(({ move }) => move.from === control.move.to || move.to === control.move.to)
        )
            return false;
        for (const [from, destinations] of response.allDests()) {
            if (!destinations.has(control.move.to)) continue;
            const gain = tacticalExchangeGain(response, { from, to: control.move.to });
            if (gain <= EXHAUSTED || gain >= MIN_GAIN) return false;
        }
        return true;
    });
    if (!saved?.resource) return null;
    const { reply, resource } = saved;
    const [immediate] = replayTacticalLine(makeFen(root.after.toSetup()), [take.uci]);
    const immediateReplies = immediate ? plausibleRecaptures(immediate) : null;
    if (
        !immediateReplies?.length ||
        immediateReplies.every(({ reply }) => deflectedGuard(immediate, reply))
    )
        return null;
    const verifiedWeak = measured(fen, played, playedReply);
    const verifiedStrong = measured(fen, better, betterReply);
    const window = Math.min(weak.length, verifiedWeak.length, strong.length, verifiedStrong.length);
    for (let end = 5; end < window; end++) {
        const retained = weak[end].balance;
        if (
            retained > -MIN_GAIN ||
            [weak, verifiedWeak].some((line) =>
                line
                    .slice(end - 2, end + 1)
                    .some((step) => step.balance !== retained || step.after.isCheck()),
            ) ||
            [strong, verifiedStrong].some((line) => line[end].balance - retained < MIN_GAIN)
        )
            continue;
        const san = makeSan(take.after, reply);
        return {
            kind: "comparative",
            throughPly: end + 1,
            materialDifferencePoints: (strong[end].balance - retained) / 100,
            betterLineUci: strong.slice(0, end + 1).map((step) => step.uci),
            playedLineUci: weak.slice(0, end + 1).map((step) => step.uci),
            branchUci: [root.uci, ...route, makeUci(reply), makeUci(resource.move)],
            controlUci: [control.uci, ...route, makeUci(reply)],
            mechanisms: [],
            explanation: `After ${root.san}, ${trade.san} ${pawn.san} ${take.san} takes the pawn. Taking back with ${san} moves the defender off ${makeSquare(reply.from)}, allowing ${resource.san} to win the ${resource.role} on ${resource.square}. After ${control.san}, the ${resource.role} is on ${makeSquare(control.move.to)} and survives that local exchange.`,
        };
    }
    return null;
}
