import { castlingSide } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import type { DecisionSharedReplyProbe } from "./decisionSharedReply";

const MIN_ADVANTAGE = 70;

function finite(line: DecisionEngineLine): line is DecisionEngineLine & { cp: number } {
    return line.cp !== null && Number.isFinite(line.cp) && line.mate == null && line.depth >= 16 &&
        !line.lowerbound && !line.upperbound && !line.claimHistory;
}

function playsKing(step: TacticalReplayStep) {
    return step.before.board.get(step.move.from)?.role === "king" && !castlingSide(step.before, step.move);
}

function readDisplacement(
    fen: string, best: DecisionEngineLine, played: DecisionEngineLine, opponent: DecisionEngineLine,
) {
    if (!finite(best) || !finite(played) || !finite(opponent) || best.depth !== played.depth ||
        best.cp - played.cp < MIN_ADVANTAGE || Math.abs(played.cp + opponent.cp) > 90 ||
        played.pvUci[1] !== opponent.pvUci[0]) return;
    const [castle] = replayTacticalLine(fen, best.pvUci.slice(0, 1));
    const [delay, check, eviction] = replayTacticalLine(fen, played.pvUci.slice(0, 3));
    if (!castle || !delay || !check || !eviction || delay.capture || delay.move.promotion) return;
    const wing = castlingSide(castle.before, castle.move);
    const side = castle.before.turn;
    const moving = delay.before.board.get(delay.move.from);
    if (!wing || !moving || moving.role === "king" || moving.role === "rook" ||
        !check.after.isCheck() || check.after.castles.rook[side][wing] === undefined || !playsKing(eviction))
        return;
    const repeated = replayTacticalLine(fen, [delay.uci, ...opponent.pvUci.slice(0, 2)]);
    if (!repeated[2] || !playsKing(repeated[2])) return;
    const king = check.after.board.kingOf(side);
    if (king === undefined || [...check.after.allDests()].some(([from, destinations]) =>
        from !== king && destinations.nonEmpty())) return;
    if (measureDecisionLine(fen, best)?.drawnEnding !== false ||
        measureDecisionLine(fen, played)?.drawnEnding !== false ||
        measureDecisionLine(makeFen(delay.after.toSetup()), opponent)?.drawnEnding !== false)
        return;
    return { castle, delay, check, eviction: repeated[2] };
}

export function nominateCastleDisplacement(
    fen: string, best: DecisionEngineLine, played: DecisionEngineLine, opponent: DecisionEngineLine,
) {
    const context = readDisplacement(fen, best, played, opponent);
    const reply = parseUci(opponent.pvUci[0]);
    if (!context || !reply || !context.castle.after.isLegal(reply)) return;
    return {
        betterMoveUci: context.castle.uci,
        playedMoveUci: context.delay.uci,
        replyUci: context.check.uci,
        fen: makeFen(context.castle.after.toSetup()),
    };
}

export type CastlingDisplacementEvidence = {
    tactical: string;
    positional: string;
    playedLineUci: string[];
    controlLineUci?: string[];
};

export function confirmCastleDisplacement(
    fen: string, best: DecisionEngineLine, played: DecisionEngineLine, opponent: DecisionEngineLine,
    probe?: DecisionSharedReplyProbe,
): CastlingDisplacementEvidence | undefined {
    const context = readDisplacement(fen, best, played, opponent);
    const move = parseUci(opponent.pvUci[0]);
    if (!context || !move) return;
    const { castle, delay, check, eviction } = context;
    const evidence = {
        tactical: `${delay.san} allows ${check.san}. Every legal reply moves the king, as in ${eviction.san}.`,
        positional: `Moving the king permanently gives up castling. ${castle.san} gets the king out first.`,
        playedLineUci: [delay.uci, check.uci, eviction.uci],
    };
    if (!castle.after.isLegal(move))
        return { ...evidence, tactical: `${evidence.tactical} The same reply is illegal after ${castle.san}.` };
    if (!probe || probe.betterMoveUci !== castle.uci || probe.playedMoveUci !== delay.uci ||
        probe.line.pvUci[0] !== check.uci || !finite(probe.line) ||
        opponent.cp! - probe.line.cp < MIN_ADVANTAGE ||
        measureDecisionLine(makeFen(castle.after.toSetup()), probe.line)?.drawnEnding !== false)
        return;
    const [, attack, answer] = replayTacticalLine(fen, [castle.uci, ...probe.line.pvUci.slice(0, 2)]);
    if (!attack || !answer || playsKing(answer)) return;
    const attacker = attack.before.board.get(attack.move.from)!.role;
    const reply = answer.capture && answer.move.to === attack.move.to
        ? `After ${castle.san} ${attack.san}, ${answer.san} takes the ${attacker}.`
        : `After ${castle.san}, ${attack.san} can be answered with ${answer.san}.`;
    return {
        ...evidence,
        tactical: `${evidence.tactical} ${reply}`,
        controlLineUci: [castle.uci, attack.uci, answer.uci],
    };
}
