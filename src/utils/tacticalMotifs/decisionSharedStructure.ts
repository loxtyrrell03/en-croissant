import { pawnAttacks } from "chessops/attacks";
import type { Chess } from "chessops/chess";
import type { Color, Square } from "chessops/types";
import { makeSquare, opposite } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import type { PositionStrategicPlan } from "./decisionPositionPlans";

type StructuralWitness = {
    key: string;
    /** Start of the relevant action, counted from the root. */
    begins: number;
    through: number;
    theme: string;
    action: string;
    setup: boolean;
    neutral: boolean;
    exchangeSquare?: Square;
};

const WINDOW = 14;
const file = (square: Square) => square % 8;
const sideName = (side: Color) => (side === "white" ? "White" : "Black");
const onFile = (position: Chess, column: number, side?: Color) =>
    [...(side ? position.board.pawn.intersect(position.board[side]) : position.board.pawn)].some(
        (square) => file(square) === column,
    );
const central = (square: Square) => file(square) >= 2 && file(square) <= 5;

function endOfExchange(steps: TacticalReplayStep[], capture: number) {
    const square = steps[capture].move.to;
    let end = capture;
    while (steps[end + 1]?.move.to === square && steps[end + 1].capture > 0) end++;
    return end;
}

/** The same central pawn advance can occur before or after a piece move.
 * Observe the pawn contact, a capture that actually resolves it, and the
 * precise files vacated by that exchange. */
function centralBreaks(steps: TacticalReplayStep[]) {
    const results: StructuralWitness[] = [];
    for (const [index, start] of steps.slice(0, 7).entries()) {
        const { before, after, move } = start;
        const side = before.turn;
        if (
            before.board.get(move.from)?.role !== "pawn" ||
            start.capture ||
            move.promotion ||
            !central(move.to)
        )
            continue;
        for (const target of pawnAttacks(side, move.to)
            .intersect(after.board.pawn)
            .intersect(after.board[opposite(side)])) {
            for (let at = index + 1; at <= index + 4 && at < steps.length; at++) {
                const take = steps[at];
                const takesContact =
                    take.capture > 0 &&
                    ((take.before.turn === side &&
                        take.move.from === move.to &&
                        take.move.to === target) ||
                        (take.before.turn !== side &&
                            take.move.from === target &&
                            take.move.to === move.to));
                if (!takesContact) {
                    if (
                        take.after.board.get(move.to)?.role !== "pawn" ||
                        take.after.board.get(move.to)?.color !== side ||
                        (take.before.turn !== side && take.move.from === target) ||
                        (take.before.turn === side && take.move.from === move.to)
                    )
                        break;
                    // A piece can take the original opposing pawn on the
                    // contact square first. Keep its replacement only when
                    // the advancing pawn actually captures it on that square.
                    continue;
                }
                const resolved = endOfExchange(steps, at);
                const exchanges = steps.slice(at, resolved + 1);
                const closure = resolved + 2;
                if (!steps[closure]) break;
                // A new exchange elsewhere can begin at the window boundary.
                // Count its recapture before testing the settled material.
                const end = steps[closure].capture ? endOfExchange(steps, closure) : closure;
                const settled = steps.slice(resolved, end + 1);
                for (const column of [file(move.to), file(target)]) {
                    for (const owner of [side, opposite(side)]) {
                        if (
                            !onFile(before, column, owner) ||
                            settled.some(({ after: board }) => onFile(board, column, owner))
                        )
                            continue;
                        // Require a pawn from the affected file to be part of
                        // the episode. An unrelated move cannot clear it.
                        const displaced = exchanges.some(
                            (step) =>
                                (step.before.turn === owner &&
                                    file(step.move.from) === column &&
                                    step.before.board.get(step.move.from)?.role === "pawn") ||
                                (step.before.turn !== owner &&
                                    step.capture > 0 &&
                                    file(step.move.to) === column &&
                                    step.before.board.get(step.move.to)?.role === "pawn"),
                        );
                        if (!displaced) continue;
                        const columnName = "abcdefgh"[column];
                        results.push({
                            key: `break:${side}:${start.uci}:${target}:${owner}:${column}`,
                            begins: index,
                            through: end + 1,
                            theme: `The ${start.san} pawn break changes the ${columnName}-file in both move orders`,
                            action: `${start.san} makes contact with the pawn on ${makeSquare(target)}. The exchange ${exchanges.map((step) => step.san).join(" ")} leaves ${sideName(owner)} with no pawn on the ${columnName}-file`,
                            setup: true,
                            neutral:
                                Math.abs(steps[resolved].balance) <= 100 &&
                                Math.abs(steps[end].balance) <= 100,
                        });
                    }
                }
                break;
            }
        }
    }
    return results;
}

/** Confirm a real, like-for-like exchange of opposing rooks on the same
 * file. A line can either reposition first or trade immediately. */
function rookExchanges(steps: TacticalReplayStep[]) {
    const results: StructuralWitness[] = [];
    for (const [index, take] of steps.slice(0, 9).entries()) {
        const { before, move } = take;
        const column = file(move.to);
        const retake = steps[index + 1];
        if (
            !retake ||
            before.board.get(move.from)?.role !== "rook" ||
            before.board.get(move.to)?.role !== "rook" ||
            file(move.from) !== column ||
            retake.move.to !== move.to ||
            retake.capture !== 500 ||
            retake.balance !== (steps[index - 1]?.balance ?? 0) ||
            onFile(before, column)
        )
            continue;
        const setup = steps
            .slice(Math.max(0, index - 4), index)
            .find(
                ({ before: board, move: m, capture }, offset, previous) =>
                    !capture &&
                    (m.to === move.from || m.to === move.to) &&
                    board.board.get(m.from)?.role === "rook" &&
                    !onFile(board, column) &&
                    previous
                        .slice(offset + 1)
                        .every((step) => step.move.from !== m.to && step.move.to !== m.to),
            );
        const columnName = makeSquare(move.to)[0];
        results.push({
            key: `rook-trade:${column}`,
            begins: setup ? steps.indexOf(setup) : index,
            through: index + 2,
            theme: `Both lines settle the rook contest on the ${columnName}-file`,
            action: `${setup ? `${setup.san} repositions a rook. ` : ""}${take.san} ${retake.san} exchanges rooks on ${makeSquare(move.to)}`,
            setup: !!setup,
            neutral: Math.abs(retake.balance) <= 100,
            exchangeSquare: move.to,
        });
    }
    return results;
}

function describe(steps: TacticalReplayStep[], action: StructuralWitness) {
    return action.action.startsWith(`${steps[0].san} `)
        ? action.action
        : `After ${steps[0].san}, ${action.action}`;
}

/** Match use of a named feature across viable legal candidates. This is
 * evidence of a strategic theme and does not decompose the engine score. */
export function findSharedStructuralPlan(
    fen: string,
    candidates: DecisionEngineLine[],
): PositionStrategicPlan | null {
    const [best, ...alternatives] = candidates;
    if (!best || best.depth < 16 || best.cp === null || best.mate != null) return null;
    const comparable = alternatives.filter(
        (line) =>
            line.depth === best.depth &&
            line.cp !== null &&
            line.mate == null &&
            best.cp! >= line.cp &&
            best.cp! - line.cp <= 100 &&
            line.pvUci[0] !== best.pvUci[0],
    );
    if (!comparable.length) return null;
    const analyse = (line: DecisionEngineLine) => {
        const bounded = { ...line, pvUci: line.pvUci.slice(0, WINDOW) };
        if (!measureDecisionLine(fen, bounded)) return null;
        const steps = replayTacticalLine(fen, bounded.pvUci);
        return { steps, actions: [...centralBreaks(steps), ...rookExchanges(steps)] };
    };
    const principal = analyse(best);
    if (!principal?.actions.length) return null;
    for (const alternative of comparable) {
        const other = analyse(alternative);
        if (!other) continue;
        for (const first of principal.actions) {
            const second = other.actions.find(
                (item) =>
                    first.key === item.key &&
                    Math.min(first.begins, item.begins) <= 2 &&
                    (first.setup || item.setup) &&
                    (first.exchangeSquare === item.exchangeSquare ||
                        first.begins === 0 ||
                        item.begins === 0) &&
                    first.neutral &&
                    item.neutral,
            );
            if (!second) continue;
            return {
                linesUci: [
                    best.pvUci.slice(0, first.through),
                    alternative.pvUci.slice(0, second.through),
                ],
                description: `${first.theme}. ${describe(principal.steps, first)}. ${describe(other.steps, second)}.`,
            };
        }
    }
    return null;
}
