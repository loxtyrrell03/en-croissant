import { attacks, between, ray as throughLine } from "chessops/attacks";
import type { Chess } from "chessops/chess";
import { makeSan } from "chessops/san";
import type { Color, NormalMove, Square } from "chessops/types";
import { makeSquare, opposite } from "chessops/util";
import {
    MIN_TACTICAL_CAPTURE_GAIN,
    replayTacticalLine,
    tacticalCaptureGain,
    tacticalExchangeGain,
    type TacticalReplayStep,
} from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";

/** A mechanism witnessed in a legal engine line. This is deliberately separate
 * from an all-defence certificate and from a diagnosis of the player's error. */
export type TacticalSequenceWitness = {
    fen: string;
    mechanism:
        | "fork"
        | "pin"
        | "deflection"
        | "capturingDefender"
        | "discoveredAttack"
        | "discoveredCheck"
        | "clearance"
        | "skewer"
        | "intermezzo"
        | "attraction"
        | "trappedPiece"
        | "tacticalPreparation";
    actor: Color;
    mechanismPly: number;
    payoffPly: number;
    squares: string[];
    description: string;
    support: "legal-continuation";
    rootMoveInvolved: boolean;
    lineUci: string[];
    supportingMechanisms?: string[];
    alternatives?: TacticalSequenceWitness[];
};

/** Compare the roles in forks and discoveries. A king or any other shared
 * square alone cannot make two distinct double attacks equivalent. */
export function sameTacticalMechanism(a: TacticalSequenceWitness, b: TacticalSequenceWitness) {
    if (a.actor !== b.actor || a.mechanism !== b.mechanism) return false;
    if (a.mechanism === "discoveredAttack")
        return (
            a.squares[1] === b.squares[1] &&
            a.squares[2] === b.squares[2] &&
            a.lineUci[a.mechanismPly - 1] === b.lineUci[b.mechanismPly - 1]
        );
    if (a.mechanism === "fork" && a.squares.length === 3 && b.squares.length === 3) {
        const [from, first, second] = a.squares;
        const [otherFrom, otherFirst, otherSecond] = b.squares;
        return (
            from === otherFrom &&
            ((first === otherFirst && second === otherSecond) ||
                (first === otherSecond && second === otherFirst))
        );
    }
    return a.squares.some((square) => b.squares.includes(square));
}

/** One label per mechanism and target set, retaining the separate legal reply
 * witnesses for inspection rather than conflating their moves into one PV. */
export function mergeTacticalSequenceWitnesses(witnesses: TacticalSequenceWitness[]) {
    const grouped = new Map<string, TacticalSequenceWitness>();
    for (const item of witnesses) {
        const key = `${item.fen}:${item.actor}:${item.mechanism}:${item.mechanismPly}:${item.squares.slice().sort().join(",")}`;
        const existing = grouped.get(key);
        if (!existing) grouped.set(key, structuredClone(item));
        else if (
            [existing, ...(existing.alternatives ?? [])].every(
                (other) => other.lineUci.join(" ") !== item.lineUci.join(" "),
            )
        ) {
            existing.alternatives ??= [];
            existing.alternatives.push(structuredClone(item));
        }
    }
    return [...grouped.values()];
}

export type TacticalEpisodeOutcome = {
    kind: "material";
    throughPly: number;
    materialGainPoints: number;
    lineUci: string[];
    limitation: string;
};

/** A bounded material episode after the actual payoff and settling replies.
 * This is not a claim about the PV's final balance or every legal defence. */
export function measureTacticalEpisode(
    fen: string,
    line: DecisionEngineLine,
    witness: TacticalSequenceWitness,
): TacticalEpisodeOutcome | null {
    if (
        witness.fen !== fen ||
        !witness.rootMoveInvolved ||
        !measureDecisionLine(fen, line) ||
        !witness.lineUci.every((move, index) => line.pvUci[index] === move)
    )
        return null;
    for (
        let end = witness.payoffPly + 3;
        end <= Math.min(line.pvUci.length, witness.payoffPly + 6);
        end++
    ) {
        const prefix = line.pvUci.slice(0, end);
        const measured = measureDecisionLine(fen, { ...line, pvUci: prefix });
        if (
            measured &&
            !measured.drawnEnding &&
            measured.quietEndingPlies >= 2 &&
            measured.endingMaterialRangeCp[0] === measured.endingMaterialRangeCp[1] &&
            measured.materialChangeCp >= 90
        )
            return {
                kind: "material",
                throughPly: end,
                materialGainPoints: measured.materialChangeCp / 100,
                lineUci: prefix,
                limitation:
                    "This is the material change in the displayed tactical episode after settling replies. Later play and other defences can alter it.",
            };
    }
    return null;
}

function legalCapture(position: Chess, from: Square, to: Square, side: Color) {
    const piece = position.board.get(from),
        target = position.board.get(to);
    if (
        !piece ||
        piece.color !== side ||
        !target ||
        target.color === side ||
        target.role === "king"
    )
        return false;
    const copy = position.clone();
    copy.turn = side;
    copy.epSquare = undefined;
    const promotion =
        piece.role === "pawn" && (to < 8 || to >= 56) ? ("queen" as const) : undefined;
    return copy.isLegal({ from, to, ...(promotion ? { promotion } : {}) });
}

function attacksTarget(position: Chess, from: Square, to: Square, side: Color) {
    const target = position.board.get(to),
        piece = position.board.get(from);
    if (!target || !piece || target.color === side) return false;
    if (target.role === "king") {
        // A king cannot be captured. Check geometry is legal only when the
        // checking piece is not exposing its own king by leaving the square.
        return attacks(piece, from, position.board.occupied).has(to);
    }
    return legalCapture(position, from, to, side);
}

const VALUE = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 20000 };
function meaningfulTarget(position: Chess, from: Square, to: Square, side: Color) {
    if (!attacksTarget(position, from, to, side)) return false;
    const attacker = position.board.get(from)!,
        target = position.board.get(to)!;
    if (VALUE[target.role] > VALUE[attacker.role]) return true;
    // An equal/cheaper target counts only when this capture cannot immediately
    // be recaptured legally. Geometric double attacks on protected pawns are
    // not meaningful forks merely because the arrows exist.
    const after = position.clone();
    after.turn = side;
    after.epSquare = undefined;
    const move = {
        from,
        to,
        ...(attacker.role === "pawn" && (to < 8 || to >= 56)
            ? { promotion: "queen" as const }
            : {}),
    };
    if (!after.isLegal(move)) return false;
    after.play(move);
    return ![...after.board[opposite(side)]].some((square) =>
        legalCapture(after, square, to, opposite(side)),
    );
}

/** Does an actual legal capture permit this specific defender to recapture?
 * The defender's pseudo-attack alone is insufficient (absolute pins matter). */
function canRecapture(position: Chess, capture: NormalMove, defender: Square, side: Color) {
    const copy = position.clone();
    copy.turn = side;
    copy.epSquare = undefined;
    if (!copy.isLegal(capture)) return false;
    copy.play(capture);
    return legalCapture(copy, defender, capture.to, opposite(side));
}

function discoveryPayoff(steps: TacticalReplayStep[], index: number, payoffIndex: number) {
    const opening = steps[index],
        payoff = steps[payoffIndex];
    if (
        opening.after.isCheck() ||
        payoff.after.isCheck() ||
        tacticalExchangeGain(payoff.before, payoff.move) >= MIN_TACTICAL_CAPTURE_GAIN
    )
        return payoffIndex;

    // A recapture of the slider can uncover a different payoff. Require the
    // immediate new capture to improve on what was available before the swap.
    const retake = steps[payoffIndex + 1];
    if (!retake?.capture || retake.move.to !== payoff.move.to) return;
    const materialGain = (end: TacticalReplayStep) =>
        (end.balance - (steps[index - 1]?.balance ?? 0)) *
        (opening.before.turn === steps[0].before.turn ? 1 : -1);
    const follow = steps[payoffIndex + 2];
    if (follow?.capture && materialGain(follow) >= MIN_TACTICAL_CAPTURE_GAIN) {
        const gain = tacticalExchangeGain(follow.before, follow.move);
        const original = tacticalExchangeGain(payoff.before, follow.move);
        if (
            gain >= MIN_TACTICAL_CAPTURE_GAIN &&
            gain - Math.max(original, 0) >= MIN_TACTICAL_CAPTURE_GAIN
        )
            return payoffIndex + 2;
    }
    // The opening piece can insert a check before taking the very piece
    // lured onto the ray. Its identity and the retaker's must both persist.
    const defence = steps[payoffIndex + 3],
        collect = steps[payoffIndex + 4];
    if (
        payoffIndex === index + 2 &&
        retake.move.to !== opening.move.to &&
        follow?.move.from === opening.move.to &&
        follow.after.isCheck() &&
        defence &&
        defence.move.from !== retake.move.to &&
        defence.move.to !== follow.move.to &&
        collect?.capture &&
        collect.move.from === follow.move.to &&
        collect.move.to === retake.move.to &&
        materialGain(collect) >= MIN_TACTICAL_CAPTURE_GAIN &&
        tacticalExchangeGain(collect.before, collect.move) >= MIN_TACTICAL_CAPTURE_GAIN
    )
        return payoffIndex + 4;
}

/** A discovery reveals a threat to an existing enemy piece. Follow that
 * target and the stationary slider until the threat is used. A recapture of
 * a different piece on the same square can use the ray without being a
 * discovered attack. */
function usedDiscoveredAttack(steps: TacticalReplayStep[], index: number, payoffIndex: number) {
    const first = steps[index];
    const payoff = steps[payoffIndex];
    if (!payoff?.capture) return;
    const side = first.before.turn;
    const { from, to } = payoff.move;
    const slider = first.before.board.get(from);
    if (!slider || slider.color !== side || !["bishop", "rook", "queen"].includes(slider.role))
        return;
    const ray = between(from, to);
    if (
        !ray.has(first.move.from) ||
        first.move.to === to ||
        ray.intersect(first.before.board.occupied).size() !== 1 ||
        !legalCapture(first.after, from, to, side)
    )
        return;
    for (let ply = index + 1; ply < payoffIndex; ply++) {
        const reply = steps[ply];
        if (
            reply.move.from === from ||
            reply.move.to === from ||
            reply.move.from === to ||
            reply.move.to === to ||
            !ray.intersect(reply.after.board.occupied).isEmpty()
        )
            return;
    }
    const through = discoveryPayoff(steps, index, payoffIndex);
    if (through === undefined) return;
    return { from, to, through };
}

function exploitedAbsolutePin(steps: TacticalReplayStep[], index: number) {
    const step = steps[index];
    const pinner = step.move.to;
    const payoff = steps[index + 2];
    if (!payoff?.capture || payoff.move.from !== pinner) return;
    const slider = step.after.board.get(pinner);
    const side = step.before.turn;
    const defender = opposite(side);
    const king = step.after.board.kingOf(defender);
    if (
        !slider ||
        !["bishop", "rook", "queen"].includes(slider.role) ||
        king === undefined ||
        step.after.isCheck()
    )
        return;
    const ray = between(pinner, king);
    const target = payoff.move.to;
    if (!ray.has(target) || ray.intersect(step.after.board.occupied).size() !== 1) return;
    const pinned = step.after.board.get(target);
    if (
        pinned?.color !== defender ||
        !step.after.ctx().blockers.has(target) ||
        !attacks(slider, pinner, step.after.board.occupied).has(target) ||
        !attacks(slider, pinner, step.after.board.occupied.without(target)).has(king)
    )
        return;
    // Require an actual departure constrained by this new ray. Removing the
    // pinner in a local legality test leaves other checks and pins in place.
    const withoutPin = step.after.clone();
    withoutPin.board.take(pinner);
    if (
        withoutPin
            .dests(target)
            .diff(throughLine(pinner, king))
            .diff(step.after.dests(target))
            .isEmpty()
    )
        return;
    const original = step.before.clone();
    original.turn = defender;
    if (original.ctx().blockers.has(target)) return;
    if (
        payoff.before.board.kingOf(defender) !== king ||
        ray.intersect(payoff.before.board.occupied).size() !== 1 ||
        !payoff.before.board.get(target) ||
        (tacticalCaptureGain(payoff, 4096) ?? 0) < MIN_TACTICAL_CAPTURE_GAIN
    )
        return;
    return { target, king, pinner, role: pinned.role, payoff };
}

/** A promoted pawn can draw a rook onto the promotion square before an
 * intervening check removes its king's protection. Verify the immediate
 * king recapture as well as the changed outcome after the check. */
function promotionSetsUpIntermezzo(steps: TacticalReplayStep[], checkIndex: number) {
    if (checkIndex !== 2) return null;
    const [lead, take, check, defence, payoff] = steps;
    if (
        !lead.move.promotion ||
        lead.capture ||
        take.move.to !== lead.move.to ||
        take.before.board.get(take.move.from)?.role !== "rook" ||
        check.capture ||
        defence.before.board.get(defence.move.from)?.role !== "king"
    )
        return null;
    const before = check.before;
    const immediate = tacticalExchangeGain(before, payoff.move);
    if (immediate <= -20000 || immediate >= 90 || tacticalExchangeGain(payoff.before, payoff.move) < 90)
        return null;
    const position = before.clone();
    position.play(payoff.move);
    const king = position.board.kingOf(position.turn);
    if (king === undefined) return null;
    const recapture = { from: king, to: payoff.move.to };
    if (!position.isLegal(recapture)) return null;
    return { immediate: makeSan(before, payoff.move), reply: makeSan(position, recapture) };
}

/** Nominate only mechanisms with an observed use, never a board pattern alone.
 * These nominations retain their real ply. A later motif is not automatically
 * the cause of the root move, even in a favourable principal variation. */
export function extractTacticalSequenceWitnesses(
    fen: string,
    line: DecisionEngineLine,
): TacticalSequenceWitness[] {
    if (!measureDecisionLine(fen, line)) return [];
    const steps = replayTacticalLine(fen, line.pvUci);
    const result: TacticalSequenceWitness[] = [];
    const push = (
        mechanism: TacticalSequenceWitness["mechanism"],
        i: number,
        k: number,
        squares: Square[],
        description: string,
        rootMoveInvolved = i === 0,
    ) => {
        result.push({
            fen,
            mechanism,
            actor: steps[i].before.turn,
            mechanismPly: i + 1,
            payoffPly: k + 1,
            squares: [...new Set(squares)].map(makeSquare),
            description,
            support: "legal-continuation",
            rootMoveInvolved,
            lineUci: line.pvUci.slice(0, k + 1),
        });
    };
    // Bounded nomination. Full supplied PV has already been validated above.
    for (let i = 0; i < Math.min(steps.length, 12); i++) {
        const first = steps[i],
            side = first.before.turn;
        const moved = first.after.board.get(first.move.to);
        if (!moved || moved.color !== side) continue; // excludes rook-square castling ambiguity
        const reply = steps[i + 1],
            third = steps[i + 2];
        const pin = exploitedAbsolutePin(steps, i);
        if (pin)
            push(
                "pin",
                i,
                i + 2,
                [pin.pinner, pin.target, pin.king],
                `${first.san} pins the ${pin.role} on ${makeSquare(pin.target)} to the king on ${makeSquare(pin.king)}. After ${reply.san}, ${pin.payoff.san} wins material on that square in this continuation.`,
            );
        const targets = [...first.after.board[opposite(side)]].filter((sq) =>
            meaningfulTarget(first.after, first.move.to, sq, side),
        );
        if (
            targets.length >= 2 &&
            reply &&
            third &&
            third.capture > 0 &&
            third.move.from === first.move.to &&
            targets.includes(third.move.to) &&
            reply.move.to !== first.move.to
        ) {
            const other = targets.includes(reply.move.from)
                ? reply.move.from
                : targets.find((sq) => sq !== third.move.to)!;
            push(
                "fork",
                i,
                i + 2,
                [first.move.to, other, third.move.to],
                `${first.san} attacks ${makeSquare(other)} and ${makeSquare(third.move.to)}. After ${reply.san}, ${third.san} takes one of these targets in this line.`,
            );
        }

        if (reply && third?.capture && third.before.turn === side) {
            const originalTarget = first.before.board.get(third.move.to);
            const payoffTarget = third.before.board.get(third.move.to);
            const sameTarget =
                originalTarget &&
                payoffTarget &&
                originalTarget.role === payoffTarget.role &&
                originalTarget.color === payoffTarget.color &&
                reply.move.to !== third.move.to &&
                first.move.to !== third.move.to;
            // A defender changes its duty, enabling a capture it could have
            // answered before. Keep this conditional; the reply is not forced.
            if (
                sameTarget &&
                canRecapture(first.after, third.move, reply.move.from, side) &&
                !canRecapture(third.before, third.move, reply.move.to, side)
            ) {
                const offered = reply.capture > 0 && reply.move.to === first.move.to;
                const attacked = attacksTarget(first.after, first.move.to, reply.move.from, side);
                if (offered || attacked || first.after.isCheck()) {
                    push(
                        "deflection",
                        i,
                        i + 2,
                        [reply.move.from, reply.move.to, third.move.to],
                        `${first.san} is met by ${reply.san}, taking the defender from ${makeSquare(reply.move.from)}. ${third.san} then captures the target it could previously recapture on.`,
                    );
                }
            }
            if (
                sameTarget &&
                first.capture > 0 &&
                canRecapture(first.before, third.move, first.move.to, side)
            ) {
                push(
                    "capturingDefender",
                    i,
                    i + 2,
                    [first.move.to, third.move.to],
                    `${first.san} removes the piece on ${makeSquare(first.move.to)} which could legally recapture on ${makeSquare(third.move.to)}. The line continues ${reply.san} ${third.san}.`,
                );
            }

            const slider = first.before.board.get(third.move.from);
            if (
                slider?.color === side &&
                ["bishop", "rook", "queen"].includes(slider.role) &&
                third.move.to === first.move.from &&
                third.move.from !== first.move.to &&
                first.capture === 0
            ) {
                push(
                    "clearance",
                    i,
                    i + 2,
                    [first.move.from, first.move.to, third.move.from],
                    `${first.san} vacates ${makeSquare(first.move.from)}. ${third.san} uses that square after ${reply.san}.`,
                );
            }

            // A more valuable front target moves and exposes the rear target.
            if (
                ["bishop", "rook", "queen"].includes(moved.role) &&
                third.move.from === first.move.to &&
                between(first.move.to, third.move.to).has(reply.move.from) &&
                targets.includes(reply.move.from)
            ) {
                const value = (role: string) =>
                    ({ pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100 })[role] ?? 0;
                const front = reply.before.board.get(reply.move.from),
                    back = third.before.board.get(third.move.to);
                if (front && back && value(front.role) > value(back.role))
                    push(
                        "skewer",
                        i,
                        i + 2,
                        [first.move.to, reply.move.from, third.move.to],
                        `${first.san} attacks the more valuable piece on ${makeSquare(reply.move.from)}. After it moves, ${third.san} takes the piece behind it.`,
                    );
            }
        }

        for (const k of [i + 2, i + 4]) {
            const discovery = usedDiscoveredAttack(steps, i, k);
            if (!discovery) continue;
            const { from, to, through } = discovery;
            const target = first.after.board.get(to)!;
            const slider = first.after.board.get(from)!;
            const followUp =
                through === k
                    ? ""
                    : through === k + 2
                      ? ` The exchange also enables ${steps[through].san}.`
                      : ` ${steps[k + 2].san} inserts a check before ${steps[through].san} takes the recapturing piece.`;
            push(
                "discoveredAttack",
                i,
                through,
                [first.move.from, from, to],
                `${first.san} uncovers the ${slider.role} on ${makeSquare(from)} against the ${target.role} on ${makeSquare(to)}. The ${slider.role} takes it with ${steps[k].san} in the analysed line.${followUp}`,
            );
        }

        // Defender removal can enable a later combination, rather than the
        // very next capture. Keep the target and attacking piece identities
        // unchanged until that later use; intervening replacements invalidate
        // this causal link. The legal recapture duty is tested before removal.
        if (first.capture > 0) {
            for (let k = i + 4; k < Math.min(steps.length, i + 9); k += 2) {
                const payoff = steps[k];
                const target = first.before.board.get(payoff.move.to);
                if (
                    !payoff.capture ||
                    payoff.before.turn !== side ||
                    !target ||
                    target.color === side ||
                    first.move.to === payoff.move.to ||
                    steps
                        .slice(i, k)
                        .some(
                            (step) =>
                                step.move.from === payoff.move.to ||
                                step.move.to === payoff.move.to ||
                                step.move.from === payoff.move.from ||
                                step.move.to === payoff.move.from,
                        ) ||
                    !canRecapture(first.before, payoff.move, first.move.to, side)
                )
                    continue;
                push(
                    "capturingDefender",
                    i,
                    k,
                    [first.move.to, payoff.move.to],
                    `${first.san} removes the defender on ${makeSquare(first.move.to)}. At ply ${k + 1}, ${payoff.san} uses a capture that this defender could legally have recaptured on before its removal. The intervening moves are part of this combination.`,
                );
            }
        }

        const king = first.after.board.kingOf(opposite(side));
        if (king !== undefined && first.after.isCheck()) {
            for (const square of first.after.kingAttackers(
                king,
                side,
                first.after.board.occupied,
            )) {
                if (square === first.move.to || square === first.move.from) continue;
                const piece = first.before.board.get(square);
                if (
                    piece &&
                    ["bishop", "rook", "queen"].includes(piece.role) &&
                    between(square, king).has(first.move.from) &&
                    !attacks(piece, square, first.before.board.occupied).has(king)
                ) {
                    push(
                        "discoveredCheck",
                        i,
                        i,
                        [first.move.from, square, king],
                        `${first.san} moves out of the ${makeSquare(square)}–${makeSquare(king)} line and uncovers check.`,
                    );
                }
            }
        }
        // A checking move intervenes before a legal recapture of the previous
        // capturer. This is a line event, not a claim that the tempo is decisive.
        const previous = steps[i - 1];
        if (
            previous?.capture &&
            first.after.isCheck() &&
            third?.capture &&
            first.move.to !== previous.move.to &&
            third.move.to === previous.move.to &&
            legalCapture(first.before, third.move.from, previous.move.to, side)
        ) {
            const kingRecapture = promotionSetsUpIntermezzo(steps, i);
            push(
                "intermezzo",
                i,
                i + 2,
                [first.move.to, previous.move.to],
                kingRecapture
                    ? `${steps[0].san} draws the rook to ${makeSquare(previous.move.to)}. An immediate ${kingRecapture.immediate} allows ${kingRecapture.reply}. In this line, ${first.san} moves the king away before the recapture.`
                    : `${first.san} inserts a check before ${third.san} recaptures on ${makeSquare(previous.move.to)}.`,
                kingRecapture !== null || i === 0,
            );
        }
    }
    // A decoy onto a fork square needs an observed fork and an independently
    // legal prior recapture duty. An ordinary exchange is insufficient.
    for (let i = 0; i + 4 < Math.min(steps.length, 12); i++) {
        const offer = steps[i],
            response = steps[i + 1],
            attack = steps[i + 2];
        const fork = result.find(
            (item) => item.mechanism === "fork" && item.mechanismPly === i + 3,
        );
        if (
            !fork ||
            !response.capture ||
            response.move.to !== offer.move.to ||
            attack.move.to !== response.move.to ||
            !attack.capture ||
            !canRecapture(offer.before, attack.move, response.move.from, offer.before.turn)
        )
            continue;
        push(
            "attraction",
            i,
            fork.payoffPly - 1,
            [offer.move.to, response.move.from, attack.move.from],
            `${offer.san} draws the defender from ${makeSquare(response.move.from)} onto ${makeSquare(response.move.to)}. ${attack.san} captures it and creates the fork used in the continuation.`,
        );
        result[result.length - 1].supportingMechanisms = ["fork"];
    }
    // Link a short preparation to a later mechanism only when the SAME piece
    // takes a route the original square did not provide. Opponent replies and
    // the real mechanism ply remain visible. This is conditional PV evidence,
    // never a claim that every defence permits the prepared combination.
    const root = steps[0];
    let square = root.move.to;
    const rootPiece = root.before.board.get(root.move.from);
    for (let i = 1; rootPiece && i < Math.min(steps.length, 7); i++) {
        const step = steps[i];
        const tracked = step.before.board.get(square);
        if (tracked?.color !== rootPiece.color || tracked.role !== rootPiece.role) break;
        if (step.before.turn !== root.before.turn) {
            if (step.move.to === square && step.capture) break;
            continue;
        }
        if (step.move.from !== square) continue;
        const later = result.filter(
            (item) => item.mechanismPly === i + 1 && item.mechanism !== "tacticalPreparation",
        );
        if (
            later.length &&
            !attacks(rootPiece, root.move.from, root.before.board.occupied).has(step.move.to)
        ) {
            const payoff = Math.max(...later.map((item) => item.payoffPly));
            push(
                "tacticalPreparation",
                0,
                payoff - 1,
                [root.move.from, root.move.to, step.move.to],
                `${root.san} gives this piece access to ${makeSquare(step.move.to)}. In the analysed continuation, ${step.san} uses ${[...new Set(later.map((item) => item.mechanism))].join(" and ")} at ply ${i + 1}.`,
            );
            result[result.length - 1].supportingMechanisms = [
                ...new Set(later.map((item) => item.mechanism)),
            ];
            break;
        }
        square = step.move.to;
    }
    // A single mechanism occurrence can have overlapping explanations. Preserve
    // distinct mechanisms, deduplicate identical mechanism/actor/ply/targets.
    const seen = new Set<string>();
    return result.filter((item) => {
        // A checking fork can also draw a king off its defence of the second
        // target. That is the same event, not a second independent lesson.
        if (
            item.mechanism === "deflection" &&
            result.some(
                (other) =>
                    other.mechanism === "fork" &&
                    other.mechanismPly === item.mechanismPly &&
                    other.payoffPly === item.payoffPly,
            )
        )
            return false;
        const key = `${item.mechanism}:${item.actor}:${item.mechanismPly}:${item.squares.slice().sort().join(",")}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
