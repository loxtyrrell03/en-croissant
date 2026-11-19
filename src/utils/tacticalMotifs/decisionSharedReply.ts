import { attacks } from "chessops/attacks";
import type { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import type { Square } from "chessops/types";
import { makeSquare, makeUci } from "chessops/util";
import {
    MIN_TACTICAL_CAPTURE_GAIN,
    replayTacticalLine,
    tacticalCaptureGain,
    tacticalExchangeGain,
    type TacticalReplayStep,
} from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import type { TacticalMistakeEpisode } from "./tacticalMistakeEpisode";

export type DecisionSharedReplyProbe = {
    betterMoveUci: string;
    playedMoveUci: string;
    line: DecisionEngineLine;
};

function threatGain(reply: TacticalReplayStep, target: Square) {
    const attacker = reply.after.board.get(reply.move.to);
    if (
        !attacker ||
        reply.after.isCheck() ||
        !attacks(attacker, reply.move.to, reply.after.board.occupied).has(target)
    )
        return 0;
    const board = reply.after.clone();
    board.turn = reply.before.turn;
    board.epSquare = undefined;
    const capture = { from: reply.move.to, to: target };
    if (!board.isLegal(capture)) return 0;
    const gain = tacticalExchangeGain(board, capture);
    return gain <= -20000 ? null : gain;
}

function attacksMovedPiece(
    reply: TacticalReplayStep,
    played: TacticalReplayStep,
    better: TacticalReplayStep,
    control: TacticalReplayStep,
) {
    const victim = played.after.board.get(played.move.to);
    if (played.move.promotion || !victim || victim.role === "king" || control.after.isCheck())
        return null;
    const gain = threatGain(reply, played.move.to);
    if (gain === null || gain < MIN_TACTICAL_CAPTURE_GAIN) return null;
    const otherSquare = better.move.from === played.move.from ? better.move.to : played.move.from;
    const alternativeVictim = control.after.board.get(otherSquare);
    if (alternativeVictim?.role !== victim.role || alternativeVictim.color !== victim.color)
        return null;
    const alternativeGain = threatGain(control, otherSquare);
    if (alternativeGain === null) return null;
    if (alternativeGain < MIN_TACTICAL_CAPTURE_GAIN) return { countercaptures: null };
    const countercaptures: string[] = [];
    for (const target of control.after
        .dests(otherSquare)
        .intersect(control.after.board[control.before.turn])) {
        const answer = { from: otherSquare, to: target };
        const old = { from: played.move.to, to: target };
        if (tacticalExchangeGain(control.after, answer) < MIN_TACTICAL_CAPTURE_GAIN) continue;
        if (reply.after.isLegal(old)) {
            const previous = tacticalExchangeGain(reply.after, old);
            if (previous >= MIN_TACTICAL_CAPTURE_GAIN || previous <= -20000) continue;
        }
        countercaptures.push(makeUci(answer));
    }
    return countercaptures.length ? { countercaptures } : null;
}

function captureResources(better: Chess, played: Chess, target: number) {
    const resources: string[] = [];
    for (const [from, targets] of better.allDests()) {
        if (!targets.has(target)) continue;
        const move = { from, to: target };
        if (tacticalExchangeGain(better, move) < MIN_TACTICAL_CAPTURE_GAIN) continue;
        if (played.isLegal(move)) {
            const oldGain = tacticalExchangeGain(played, move);
            if (oldGain >= MIN_TACTICAL_CAPTURE_GAIN || oldGain <= -20000) continue;
        }
        resources.push(makeUci(move));
    }
    return resources;
}

function sharedReplyContext(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    opponent: DecisionEngineLine,
) {
    if (
        better.cp === null ||
        played.cp === null ||
        opponent.cp === null ||
        better.depth !== played.depth ||
        better.depth < 16 ||
        opponent.depth < 16 ||
        better.cp - played.cp < 100 ||
        Math.abs(played.cp + opponent.cp) > 90 ||
        better.mate != null ||
        played.mate != null ||
        opponent.mate != null ||
        played.pvUci[1] !== opponent.pvUci[0]
    )
        return null;
    const [actual, reply] = replayTacticalLine(fen, played.pvUci.slice(0, 2));
    const [choice, control] = replayTacticalLine(fen, [better.pvUci[0], opponent.pvUci[0]]);
    if (!actual || !reply || !choice || !control || reply.move.promotion) return null;
    const measured = measureDecisionLine(makeFen(actual.after.toSetup()), opponent);
    if (!measured || measured.drawnEnding) return null;
    const moved = reply.before.board.get(reply.move.from);
    const other = control.before.board.get(control.move.from);
    if (!moved || !other || moved.role !== other.role || moved.color !== other.color) return null;
    const attack = attacksMovedPiece(reply, actual, choice, control);
    const captures =
        moved.role === "king" ? [] : captureResources(control.after, reply.after, control.move.to);
    return attack || captures.length ? { actual, reply, choice, control, attack, captures } : null;
}

/** A legal tactical contrast nominates one controlled engine query. */
export function nominateSharedReply(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    opponent: DecisionEngineLine,
) {
    const context = sharedReplyContext(fen, better, played, opponent);
    if (!context) return null;
    return {
        betterMoveUci: context.choice.uci,
        playedMoveUci: context.actual.uci,
        replyUci: context.reply.uci,
        fen: makeFen(context.choice.after.toSetup()),
    };
}

/** Analyse the same opponent reply under two choices. Scores establish that the
 * difference mattered. A legal attack or a locally proved capture explains it. */
export function compareSharedReply(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    opponent: DecisionEngineLine,
    probe: DecisionSharedReplyProbe | undefined,
): TacticalMistakeEpisode | null {
    if (
        !probe ||
        probe.betterMoveUci !== better.pvUci[0] ||
        probe.playedMoveUci !== played.pvUci[0]
    )
        return null;
    const context = sharedReplyContext(fen, better, played, opponent);
    if (!context) return null;
    const { actual, reply, choice, control, attack, captures } = context;
    const checked = probe.line;
    const nextFen = makeFen(choice.after.toSetup());
    const evidence = measureDecisionLine(nextFen, checked);
    if (
        !evidence ||
        evidence.drawnEnding ||
        checked.pvUci[0] !== reply.uci ||
        checked.depth < 16 ||
        checked.cp === null ||
        checked.mate != null ||
        opponent.cp! - checked.cp < 100 ||
        checked.cp > -better.cp! + 90
    )
        return null;
    const answer = replayTacticalLine(nextFen, checked.pvUci.slice(0, 2))[1];
    if (!answer) return null;
    const episode = (plies: number, explanation: string): TacticalMistakeEpisode => ({
        kind: "forcing-attack",
        throughPly: plies + 1,
        playedLineUci: [actual.uci, ...opponent.pvUci.slice(0, plies)],
        betterLineUci: [choice.uci, ...checked.pvUci.slice(0, plies)],
        mechanisms: [],
        explanation,
    });
    if (
        captures.includes(answer.uci) &&
        (tacticalCaptureGain(answer, 4096) ?? 0) >= MIN_TACTICAL_CAPTURE_GAIN
    ) {
        const afterPlayed = reply.after.clone();
        let detail = `${actual.san} leaves that capture unavailable.`;
        if (afterPlayed.isLegal(answer.move)) {
            detail = `After ${actual.san}, the same capture yields less material in the exchange check.`;
            afterPlayed.play(answer.move);
            const removed = choice.before.board.get(choice.move.to);
            const defender = afterPlayed.board.get(choice.move.to);
            const recapture = { from: choice.move.to, to: answer.move.to };
            if (
                choice.capture &&
                removed?.color === afterPlayed.turn &&
                defender?.color === removed.color &&
                defender.role === removed.role &&
                afterPlayed.isLegal(recapture)
            )
                detail = `${choice.san} removes the ${removed.role} on ${makeSquare(choice.move.to)}. After ${actual.san} that piece can recapture with ${makeSan(afterPlayed, recapture)}.`;
        }
        return episode(
            3,
            `Against ${reply.san}, ${choice.san} gives you ${answer.san}, a profitable capture of the attacking piece. ${detail}`,
        );
    }
    if (!attack) return null;
    const square = actual.move.to;
    const piece = actual.after.board.get(square)!;
    const shown = replayTacticalLine(opponent.fen, opponent.pvUci.slice(0, 5));
    let escapeIndex = -1;
    for (const [index, step] of shown.entries()) {
        if (step.uci !== played.pvUci[index + 1]) break;
        if (index % 2 === 0 && step.move.to === square) return null;
        if (index % 2 === 1 && step.move.from === square) {
            escapeIndex = index;
            break;
        }
    }
    if (escapeIndex < 0) return null;
    const comparison = attack.countercaptures
        ? attack.countercaptures.includes(answer.uci) &&
          (tacticalCaptureGain(answer, 4096) ?? 0) >= MIN_TACTICAL_CAPTURE_GAIN &&
          !shown[escapeIndex].capture
            ? `After ${choice.san} the same ${control.san} lets the ${piece.role} escape with ${answer.san}, winning material in the local exchange.`
            : null
        : `After ${choice.san}, the same ${control.san} meets ${answer.san} with the ${piece.role} safe from a profitable capture by that attacker.`;
    if (!comparison) return null;
    return episode(
        escapeIndex + 1,
        `${reply.san} attacks the ${piece.role} on ${makeSquare(square)} after ${actual.san}. Both searches show ${shown[escapeIndex].san} moving it away. ${comparison}`,
    );
}
