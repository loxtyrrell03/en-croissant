import { ray } from "chessops/attacks";
import { castlingSide } from "chessops/chess";
import { makeFen } from "chessops/fen";
import type { Square } from "chessops/types";
import { kingCastlesTo, makeSquare, rookCastlesTo } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";

export type DecisionTacticalRecovery = {
    betterLineUci: string[];
    playedLineUci: string[];
    confirmedBetterLineUci: string[];
    confirmedPlayedLineUci: string[];
    explanation: string;
};

const COMPARISON_PLIES = 17;
const LAST_RECOVERY_PLY = 9;

function captureOrigins(line: TacticalReplayStep[]) {
    const locations = new Map([...line[0].before.board].map(([square]) => [square, square]));
    const captured = line.map(({ before, move, capture }) => {
        const origin = locations.get(move.from)!;
        const castle = castlingSide(before, move);
        locations.delete(move.from);
        if (castle) {
            const rook = before.castles.rook[before.turn][castle]!;
            const rookOrigin = locations.get(rook)!;
            locations.delete(rook);
            locations.set(kingCastlesTo(before.turn, castle), origin);
            locations.set(rookCastlesTo(before.turn, castle), rookOrigin);
            return undefined;
        }
        const enPassant =
            before.board.get(move.from)?.role === "pawn" && move.to === before.epSquare;
        const square = enPassant
            ? ((move.to + (before.turn === "white" ? -8 : 8)) as Square)
            : move.to;
        const taken = capture ? locations.get(square) : undefined;
        if (capture) locations.delete(square);
        locations.set(move.to, origin);
        return taken;
    });
    return { captured, surviving: new Set(locations.values()) };
}

function seenRecovery(captures: (Square | undefined)[]) {
    const result = new Map<Square, number>();
    for (let index = 2; index < Math.min(LAST_RECOVERY_PLY, captures.length); index += 2) {
        const square = captures[index];
        if (square !== undefined) result.set(square, index);
    }
    return result;
}

function frameUsable(fen: string, line: DecisionEngineLine) {
    const measured = measureDecisionLine(fen, line);
    return measured && !measured.drawnEnding && !measured.checkmate;
}

function replyMatches(
    root: TacticalReplayStep,
    line: DecisionEngineLine,
    reply: DecisionEngineLine,
) {
    return (
        line.cp !== null &&
        reply.cp !== null &&
        reply.depth >= 16 &&
        reply.mate == null &&
        Math.abs(line.cp + reply.cp) <= 90 &&
        frameUsable(makeFen(root.after.toSetup()), reply)
    );
}

function unavailableAfter(
    resource: TacticalReplayStep,
    played: TacticalReplayStep,
    other: TacticalReplayStep,
) {
    const { move } = resource;
    const reached = other.after;
    const piece = reached.board.get(move.from);
    const occupant = reached.board.get(move.to);
    if (piece?.role === "king" && occupant?.color === reached.turn)
        return `After ${played.san} and ${other.san}, the ${occupant.role} still occupies ${makeSquare(move.to)}.`;
    const ctx = reached.ctx();
    if (
        piece &&
        ctx.king !== undefined &&
        ctx.checkers.isEmpty() &&
        ctx.blockers.has(move.from) &&
        !ray(ctx.king, move.from).has(move.to)
    )
        return `After ${played.san} and ${other.san}, the ${piece.role} on ${makeSquare(move.from)} is pinned to the king.`;
    return `${resource.san} is unavailable after the played move and ${other.san}.`;
}

/** Compare what both choices concede before either side can recover material.
 * The same opponent capture must occur in all four searches. The stronger
 * choice permits an immediate legal resource that the played choice lacks. */
export function compareTacticalRecovery(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    betterReply: DecisionEngineLine,
    playedReply: DecisionEngineLine,
): DecisionTacticalRecovery | null {
    if (
        better.depth < 16 ||
        better.depth !== played.depth ||
        better.cp === null ||
        played.cp === null ||
        better.cp - played.cp < 100 ||
        better.mate != null ||
        played.mate != null ||
        !better.pvUci[1] ||
        [played.pvUci[1], betterReply.pvUci[0], playedReply.pvUci[0]].some(
            (move) => move !== better.pvUci[1],
        ) ||
        better.pvUci[2] !== betterReply.pvUci[1]
    )
        return null;
    const [preferred] = replayTacticalLine(fen, better.pvUci.slice(0, 1));
    const [actual] = replayTacticalLine(fen, played.pvUci.slice(0, 1));
    if (
        !preferred ||
        !actual ||
        !frameUsable(fen, better) ||
        !frameUsable(fen, played) ||
        !replyMatches(preferred, better, betterReply) ||
        !replyMatches(actual, played, playedReply)
    )
        return null;
    const lines = [
        better.pvUci,
        [preferred.uci, ...betterReply.pvUci],
        played.pvUci,
        [actual.uci, ...playedReply.pvUci],
    ].map((line) => replayTacticalLine(fen, line.slice(0, COMPARISON_PLIES)));
    const plies = Math.min(...lines.map((line) => line.length));
    if (plies < 7) return null;
    const [primary, confirmation, weaker, weakerConfirmation] = lines;
    const resource = primary[2];
    const sharedReply = primary[1];
    if (!sharedReply.capture || weaker[1].after.isLegal(resource.move)) return null;
    const traced = lines.map((line) => captureOrigins(line.slice(0, plies)));
    const [goodTrace, confirmedGood, badTrace, confirmedBad] = traced;
    const commonVictim = goodTrace.captured[1];
    if (commonVictim === undefined || traced.some(({ captured }) => captured[1] !== commonVictim))
        return null;
    const recoveredInConfirmation = seenRecovery(confirmedGood.captured);
    for (const [victim, first] of seenRecovery(goodTrace.captured)) {
        const second = recoveredInConfirmation.get(victim);
        if (
            second === undefined ||
            !badTrace.surviving.has(victim) ||
            !confirmedBad.surviving.has(victim)
        )
            continue;
        // Include the opponent's next turn after the recovery. This local
        // comparison does not attribute later, different exchanges to it.
        const endpoint = Math.max(first, second) + 1;
        if (endpoint >= plies) continue;
        const stronger = [primary, confirmation];
        const difference =
            Math.min(...stronger.map((line) => line[endpoint].balance)) -
            Math.max(weaker[endpoint].balance, weakerConfirmation[endpoint].balance);
        if (
            difference < 100 ||
            stronger.some(
                (line) =>
                    line[endpoint].balance -
                        Math.min(...line.slice(1, endpoint + 1).map((step) => step.balance)) <
                    90,
            )
        )
            continue;
        const piece = preferred.before.board.get(victim)!;
        return {
            betterLineUci: better.pvUci.slice(0, endpoint + 1),
            playedLineUci: played.pvUci.slice(0, endpoint + 1),
            confirmedBetterLineUci: [preferred.uci, ...betterReply.pvUci].slice(0, endpoint + 1),
            confirmedPlayedLineUci: [actual.uci, ...playedReply.pvUci].slice(0, endpoint + 1),
            explanation: `Both choices allow ${sharedReply.san}. After ${preferred.san}, ${resource.san} is legal immediately. In both continuations after ${preferred.san}, taking the ${piece.role} that started on ${makeSquare(victim)} recovers material. ${unavailableAfter(resource, actual, weaker[1])}`,
        };
    }
    return null;
}
