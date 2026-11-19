import { attacks, between } from "chessops/attacks";
import type { Chess } from "chessops/chess";
import type { Color, NormalMove, Square } from "chessops/types";
import { makeSquare, opposite } from "chessops/util";
import { replayTacticalLine } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";

/** A mechanism witnessed in a legal engine line. This is deliberately separate
 * from an all-defence certificate and from a diagnosis of the player's error. */
export type TacticalSequenceWitness = {
    fen: string;
    mechanism:
        | "fork"
        | "deflection"
        | "capturingDefender"
        | "discoveredAttack"
        | "discoveredCheck"
        | "clearance"
        | "skewer"
        | "intermezzo"
        | "attraction"
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
            rootMoveInvolved: i === 0,
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

            // A stationary slider gains a previously blocked line and uses it.
            const slider = first.before.board.get(third.move.from);
            if (
                slider?.color === side &&
                ["bishop", "rook", "queen"].includes(slider.role) &&
                third.move.from !== first.move.to &&
                between(third.move.from, third.move.to).has(first.move.from) &&
                !attacks(slider, third.move.from, first.before.board.occupied).has(third.move.to) &&
                attacks(slider, third.move.from, first.after.board.occupied).has(third.move.to)
            ) {
                push(
                    "discoveredAttack",
                    i,
                    i + 2,
                    [first.move.from, third.move.from, third.move.to],
                    `${first.san} opens the ${makeSquare(third.move.from)}–${makeSquare(third.move.to)} line; ${third.san} uses the discovered attack after ${reply.san}.`,
                );
            }
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
            push(
                "intermezzo",
                i,
                i + 2,
                [first.move.to, previous.move.to],
                `${first.san} inserts a check before ${third.san} recaptures on ${makeSquare(previous.move.to)}.`,
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
