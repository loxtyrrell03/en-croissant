import { castlingSide, type Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import type { Square } from "chessops/types";
import { kingCastlesTo, makeSquare, parseSquare, rookCastlesTo } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "@/utils/tacticalMotifs/causalTactics";
import type { TacticalSequenceWitness } from "@/utils/tacticalMotifs/tacticalSequenceEvidence";

export type ComparisonRoot = { fen: string; firstPrefix?: string[]; secondPrefix?: string[] };

function squareParticipants(witness: TacticalSequenceWitness): string[] {
    const [first, second, third] = witness.squares;
    switch (witness.mechanism) {
        case "fork":
            return [first, ...[second, third].sort()];
        case "deflection":
            return [first, third];
        case "discoveredAttack":
            // Keep the current exact ray comparison in the square-based arm.
            return [second, third, witness.lineUci[witness.mechanismPly - 1]];
        case "tacticalPreparation":
            return [...witness.squares, ...(witness.supportingMechanisms ?? []).slice().sort()];
        default:
            return witness.squares;
    }
}

function captureSquare(step: TacticalReplayStep): Square {
    return step.before.epSquare === step.move.to &&
        step.before.board.get(step.move.from)?.role === "pawn" && step.capture
        ? step.move.to + (step.before.turn === "white" ? -8 : 8)
        : step.move.to;
}

function applyIdentity(step: TacticalReplayStep, from: Map<Square, Square>) {
    const { move, before } = step;
    const prior = from.get(move.from);
    if (prior === undefined) return false;
    const castle = castlingSide(before, move);
    from.delete(move.from);
    if (castle) {
        const rook = before.castles.rook[before.turn][castle];
        if (rook === undefined) return false;
        const rookIdentity = from.get(rook);
        if (rookIdentity === undefined) return false;
        from.delete(rook);
        from.set(rookCastlesTo(before.turn, castle), rookIdentity);
        from.set(kingCastlesTo(before.turn, castle), prior);
    } else {
        if (step.capture) from.delete(captureSquare(step));
        from.set(move.to, prior);
    }
    return true;
}

function traced(steps: TacticalReplayStep[], through: number) {
    const ids = new Map([...steps[0].before.board].map(([square]) => [square, square]));
    for (const step of steps.slice(0, through)) if (!applyIdentity(step, ids)) return null;
    return ids;
}

function marker(position: Chess, ids: Map<Square, Square>, value: string | undefined) {
    if (!value) return null;
    const square = parseSquare(value);
    if (square === undefined) return null;
    const original = ids.get(square);
    const piece = position.board.get(square);
    return original === undefined || !piece ? null : `${piece.color}:${piece.role}:${makeSquare(original)}`;
}

/**
 * Compare the participants at each event, using their identities before
 * either choice. Board squares alone can refer to replacement pieces.
 */
function originalParticipants(
    witness: TacticalSequenceWitness,
    fen: string,
    prefix: string[],
): (string | null)[] | null {
    const through = prefix.length + witness.mechanismPly - 1;
    const end = prefix.length + witness.payoffPly - 1;
    const line = [...prefix, ...witness.lineUci];
    const steps = replayTacticalLine(fen, line);
    const event = steps[through];
    const payoff = steps[end];
    if (
        steps.length !== line.length || !event || !payoff ||
        makeFen(steps[prefix.length].before.toSetup()) !== witness.fen
    ) return null;
    const identities = traced(steps, through);
    if (!identities) return null;
    const before = (square: string | undefined) => marker(event.before, identities, square);
    const take = (step: TacticalReplayStep, ids: Map<Square, Square>) =>
        step.capture ? marker(step.before, ids, makeSquare(captureSquare(step))) : null;
    const actor = before(makeSquare(event.move.from));
    const afterIds = new Map(identities);
    if (!applyIdentity(event, afterIds)) return null;
    const after = (square: string | undefined) => marker(event.after, afterIds, square);
    const [first, second, third] = witness.squares;
    switch (witness.mechanism) {
        case "fork":
            return [after(first), ...[after(second), after(third)].sort()];
        case "pin":
        case "skewer":
            return [after(first), after(second), after(third)];
        case "deflection":
            return [actor, after(first), after(third)];
        case "capturingDefender": {
            const atPayoff = traced(steps, end);
            return [actor, take(event, identities), atPayoff ? take(payoff, atPayoff) : null];
        }
        case "discoveredAttack":
        case "discoveredCheck":
            return [actor, after(second), after(third), event.uci];
        case "clearance": {
            const atPayoff = traced(steps, end);
            return [actor, first, atPayoff ? marker(payoff.before, atPayoff, third) : null];
        }
        case "intermezzo": {
            const atPayoff = traced(steps, end);
            return [actor, second, atPayoff ? take(payoff, atPayoff) : null];
        }
        case "attraction":
            return [actor, after(second), first];
        case "tacticalPreparation": {
            const atPayoff = traced(steps, end);
            return [actor, third, atPayoff ? take(payoff, atPayoff) : null,
                ...(witness.supportingMechanisms ?? []).slice().sort()];
        }
        default:
            return null;
    }
}

/** A missing anchor is an unknown comparison. Callers may preserve their
 * prior judgement when provenance is genuinely unavailable. */
export function compareWitnesses(
    a: TacticalSequenceWitness,
    b: TacticalSequenceWitness,
    context: ComparisonRoot | undefined,
    mode: "squares" | "origins",
): boolean | null {
    if (a.mechanism !== b.mechanism || a.actor !== b.actor) return false;
    const pair = mode === "origins" && context
        ? [originalParticipants(a, context.fen, context.firstPrefix ?? []),
           originalParticipants(b, context.fen, context.secondPrefix ?? [])]
        : [squareParticipants(a), squareParticipants(b)];
    const [left, right] = pair;
    if (!left || !right || left.some((item) => !item) || right.some((item) => !item))
        return null;
    return left.length === right.length && left.every((item, index) => item === right[index]);
}
