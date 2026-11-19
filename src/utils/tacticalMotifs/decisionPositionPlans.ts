import { attacks, pawnAttacks } from "chessops/attacks";
import type { Chess } from "chessops/chess";
import type { Color, Square } from "chessops/types";
import { makeSquare, opposite, parseSquare } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import type { ComparativePositionalEvidence } from "./positionalTransitions";
import { tacticalRepetitionKey } from "./repetitionHistory";

const WINDOW = 12;
const rank = (square: Square, side: Color) =>
    side === "white" ? 1 + Math.floor(square / 8) : 8 - Math.floor(square / 8);
const file = (square: Square) => square % 8;
const sideName = (side: Color) => (side === "white" ? "White" : "Black");

function passed(position: Chess, square: Square, side: Color) {
    return ![...position.board.pawn.intersect(position.board[opposite(side)])].some(
        (other) =>
            Math.abs(file(other) - file(square)) <= 1 && rank(other, side) > rank(square, side),
    );
}

function openForRook(position: Chess, square: Square, side: Color) {
    return ![...position.board.pawn.intersect(position.board[side])].some(
        (pawn) => file(pawn) === file(square),
    );
}

function onOutpost(position: Chess, square: Square, side: Color) {
    const supported = [...position.board.pawn.intersect(position.board[side])].some((pawn) =>
        pawnAttacks(side, pawn).has(square),
    );
    return (
        supported &&
        ![...position.board.pawn.intersect(position.board[opposite(side)])].some(
            (pawn) =>
                Math.abs(file(pawn) - file(square)) === 1 && rank(pawn, side) > rank(square, side),
        )
    );
}

type PlanAction = {
    key: string;
    ply: number;
    maintainedThrough: number;
    theme: string;
    description: string;
};

export type PositionStrategicPlan = {
    linesUci: [string[], string[]];
    description: string;
};

function describePlan(rootSan: string, action: PlanAction) {
    return action.description.startsWith(`${rootSan} `)
        ? action.description
        : `After ${rootSan}, ${action.description}`;
}

/** Follow the actual piece, checking its identity and a board property at
 * each ply. An exchange cannot transfer credit to a same-colour replacement. */
function maintain(
    steps: TacticalReplayStep[],
    index: number,
    square: Square,
    predicate: (position: Chess, tracked: Square) => boolean,
) {
    const piece = steps[index].after.board.get(square);
    if (!piece) return index;
    for (let next = index; next < steps.length; next++) {
        const step = steps[next];
        if (next !== index) {
            if (step.before.turn === piece.color && step.move.from === square)
                square = step.move.to;
            const occupant = step.after.board.get(square);
            if (occupant?.color !== piece.color || occupant.role !== piece.role) return next;
        }
        if (!predicate(step.after, square)) return next;
    }
    return steps.length;
}

function completedRookExchange(steps: TacticalReplayStep[], captureIndex: number, column: number) {
    const take = steps[captureIndex];
    const retake = steps[captureIndex + 1];
    if (
        !take ||
        !retake ||
        take.before.board.get(take.move.from)?.role !== "rook" ||
        take.before.board.get(take.move.to)?.role !== "rook" ||
        file(take.move.from) !== column ||
        file(take.move.to) !== column ||
        retake.move.to !== take.move.to ||
        retake.capture !== 500 ||
        retake.balance !== (steps[captureIndex - 1]?.balance ?? 0)
    )
        return null;
    return `${take.san} ${retake.san} exchanges rooks on the file`;
}

function findPlanActions(steps: TacticalReplayStep[]) {
    if (!steps.length) return [];
    const actions: PlanAction[] = [];
    const start = steps[0].before;
    const pawns = new Map([...start.board.pawn].map((square) => [square, square]));
    for (const [index, step] of steps.entries()) {
        const { before, after, move, san } = step;
        const side = before.turn;
        const mover = before.board.get(move.from)!;
        const quiet = !step.capture && !move.promotion && !after.isCheck() && !before.isCheck();
        if (quiet && mover.role === "rook" && rank(move.to, side) >= 5) {
            const use = maintain(
                steps,
                index,
                move.to,
                (board, square) =>
                    file(square) === file(move.to) &&
                    rank(square, side) >= 5 &&
                    openForRook(board, square, side),
            );
            const exchange =
                steps[use - 1]?.before.turn === side
                    ? completedRookExchange(steps, use - 1, file(move.to))
                    : null;
            if (use >= index + 3)
                actions.push({
                    key: `rook:${side}:${file(move.to)}`,
                    ply: exchange ? use + 1 : index + 1,
                    maintainedThrough: exchange ? steps.length : use,
                    theme: `${sideName(side)} uses the ${makeSquare(move.to)[0]}-file for rook activity`,
                    description: `${san} brings a rook to ${makeSquare(move.to)}${exchange ? `, and ${exchange}` : ""}`,
                });
        }
        if (quiet && ["knight", "bishop"].includes(mover.role) && rank(move.to, side) >= 4) {
            const occupied = maintain(
                steps,
                index,
                move.to,
                (board, square) => square === move.to && onOutpost(board, square, side),
            );
            if (occupied >= index + 4)
                actions.push({
                    key: `outpost:${side}:${move.to}`,
                    ply: index + 1,
                    maintainedThrough: occupied,
                    theme: `${sideName(side)} uses the pawn-supported outpost on ${makeSquare(move.to)}`,
                    description: `${san} occupies the outpost`,
                });
        }
        for (const [origin, square] of pawns) {
            const color = start.board.get(origin)!.color;
            const moved = color === side && move.from === square;
            const tracked = moved ? move.to : square;
            const piece = after.board.get(tracked);
            if (piece?.role !== "pawn" || piece.color !== color) {
                pawns.delete(origin);
                continue;
            }
            pawns.set(origin, tracked);
            const blocking = color !== side && move.to === tracked + (color === "white" ? 8 : -8);
            if (
                !quiet ||
                (!moved && !blocking) ||
                rank(tracked, color) < 5 ||
                rank(tracked, color) > 6
            )
                continue;
            const lasting = moved
                ? maintain(
                      steps,
                      index,
                      tracked,
                      (board, current) =>
                          passed(board, current, color) &&
                          file(current) === file(tracked) &&
                          rank(current, color) >= 5,
                  )
                : maintain(
                      steps,
                      index,
                      move.to,
                      (board, current) =>
                          board.board.get(tracked)?.color === color &&
                          board.board.get(tracked)?.role === "pawn" &&
                          passed(board, tracked, color) &&
                          (current === move.to ||
                              attacks(mover, current, board.board.occupied).has(move.to)),
                  );
            if (lasting >= index + 3)
                actions.push({
                    key: `passer:${color}:${origin}`,
                    ply: index + 1,
                    maintainedThrough: lasting,
                    theme: `${sideName(color)}’s passed pawn from ${makeSquare(origin)} shapes both lines`,
                    description: `${san} ${moved ? "advances" : "blockades"} the passer on ${makeSquare(tracked)}`,
                });
        }
    }
    return actions;
}

function quietMaterialWindow(steps: TacticalReplayStep[], ply: number, tolerance: number) {
    const tail = steps.slice(ply - 4, ply);
    return (
        tail.length === 4 &&
        Math.abs(tail[0].balance) <= tolerance &&
        tail.every((step) => step.balance === tail[0].balance) &&
        tail
            .slice(-2)
            .every((step) => !step.capture && !step.move.promotion && !step.after.isCheck())
    );
}

function quietSettlement(steps: TacticalReplayStep[], earliest: number, tolerance: number) {
    for (let ply = earliest; ply <= steps.length; ply++)
        if (quietMaterialWindow(steps, ply, tolerance)) return true;
    return false;
}

/** A position can revolve around the same plan even though several moves
 * are equally strong. Require actual use of the same asset in different
 * legal root choices during a matched, settled early window. */
export function findPositionStrategicPlan(fen: string, candidates: DecisionEngineLine[]) {
    const [best, ...others] = candidates;
    if (!best || best.cp === null || best.depth < 16 || best.mate != null) return null;
    const eligible = others.filter(
        (line) =>
            line.depth === best.depth &&
            line.cp !== null &&
            line.mate == null &&
            Math.abs(line.cp - best.cp!) <= 100,
    );
    if (!eligible.length) return null;
    const analysed = (line: DecisionEngineLine) => {
        const legal = measureDecisionLine(fen, line);
        if (!legal || legal.drawnEnding) return null;
        const steps = replayTacticalLine(fen, line.pvUci.slice(0, WINDOW));
        const positions = steps.map(({ after }) => tacticalRepetitionKey(after));
        return { steps, actions: findPlanActions(steps), positions };
    };
    const principal = analysed(best);
    if (!principal?.actions.length) return null;
    for (const alternative of eligible) {
        const other = analysed(alternative);
        if (!other || other.steps[0]?.uci === principal.steps[0].uci) continue;
        for (const main of principal.actions) {
            for (const matching of other.actions.filter((item) => item.key === main.key)) {
                // A minor piece settling on an outpost only after convergence
                // is one later observation. Require evidence tied to the
                // actual choice before using it to characterise the position.
                if (main.key.startsWith("outpost:")) {
                    const earlier = new Set(principal.positions.slice(0, main.ply - 1));
                    if (other.positions.slice(0, matching.ply - 1).some((fen) => earlier.has(fen)))
                        continue;
                }
                const first = Math.max(8, main.ply, matching.ply);
                const end = Math.min(main.maintainedThrough, matching.maintainedThrough);
                for (let ply = first; ply <= end; ply++) {
                    if (
                        !quietMaterialWindow(principal.steps, ply, 100) ||
                        !quietMaterialWindow(other.steps, ply, 100) ||
                        Math.abs(principal.steps[ply - 1].balance - other.steps[ply - 1].balance) >
                            50
                    )
                        continue;
                    return {
                        linesUci: [best.pvUci.slice(0, ply), alternative.pvUci.slice(0, ply)],
                        description: `${main.theme}. ${describePlan(principal.steps[0].san, main)}. ${describePlan(other.steps[0].san, matching)}.`,
                    } satisfies PositionStrategicPlan;
                }
            }
        }
    }
    return null;
}

/** A rook on its own back rank can still contest the file. Track it from
 * the first observation, including an exchange initiated by either side. */
function rookUsesFile(
    steps: TacticalReplayStep[],
    index: number,
    side: Color,
    initial: Square,
): { description?: string; exchange?: true } | null {
    const start = steps[index];
    const column = file(initial);
    let square = initial;
    if (
        start.before.turn === side &&
        start.move.to === square &&
        start.before.board.get(start.move.from)?.role === "rook" &&
        !start.capture &&
        !start.after.isCheck() &&
        rank(square, side) >= 5
    )
        return {};
    for (let i = index + 1; i < steps.length; i++) {
        const step = steps[i];
        if (!openForRook(step.before, square, side)) return null;
        const byRook = step.before.turn === side && step.move.from === square;
        const takesRook = step.before.turn !== side && step.move.to === square;
        if (!byRook && !takesRook) continue;
        if (file(step.move.from) !== column || file(step.move.to) !== column) return null;
        if (step.capture) {
            if (i < index + 2 || !openForRook(step.after, step.move.to, side)) return null;
            const exchange = completedRookExchange(steps, i, column);
            return exchange ? { description: `${exchange}.`, exchange: true } : null;
        }
        square = step.move.to;
        if (!step.after.isCheck() && rank(square, side) >= 5)
            return { description: `${step.san} takes the same rook to ${makeSquare(square)}.` };
    }
    return null;
}

function usesPawnSpace(
    steps: TacticalReplayStep[],
    comparison: TacticalReplayStep[],
    side: Color,
    squareText: string,
) {
    const start = steps[0];
    const square = parseSquare(squareText);
    if (
        square === undefined ||
        start.move.to !== square ||
        start.before.turn !== side ||
        start.after.board.get(square)?.role !== "pawn" ||
        rank(square, side) >= 7
    )
        return null;
    const supported = pawnAttacks(side, square);
    const reply = steps[1];
    if (
        reply &&
        !reply.capture &&
        supported.has(reply.move.from) &&
        !["pawn", "king"].includes(reply.before.board.get(reply.move.from)!.role) &&
        steps.slice(1, 4).length === 3 &&
        steps
            .slice(1, 4)
            .every(
                (step) =>
                    step.after.board.get(square)?.role === "pawn" &&
                    step.after.board.get(square)?.color === side &&
                    step.after.board.get(reply.move.from)?.color !== opposite(side),
            )
    )
        return `${reply.san} moves the attacked piece away, and the pawn keeps control of ${makeSquare(reply.move.from)}.`;
    for (let i = 1; i < steps.length; i++) {
        const step = steps[i];
        const { from, to } = step.move;
        if (step.before.turn === side && from === square)
            return !step.capture && !step.after.isCheck() && rank(to, side) <= 6
                ? `${step.san} advances the same pawn again.`
                : null;
        if (
            step.after.board.get(square)?.color !== side ||
            step.after.board.get(square)?.role !== "pawn"
        )
            return null;
        const piece = step.before.board.get(from);
        if (
            step.before.turn === side &&
            !step.capture &&
            !step.after.isCheck() &&
            piece &&
            !["pawn", "king"].includes(piece.role) &&
            supported.has(to) &&
            steps[i + 1]?.after.board.get(to)?.color === side
        )
            return `${step.san} uses the square newly covered by the pawn.`;
        const alternative = comparison[i];
        if (
            alternative &&
            alternative.before.turn !== side &&
            !alternative.capture &&
            !alternative.after.isCheck() &&
            supported.has(alternative.move.to) &&
            ["knight", "bishop"].includes(
                alternative.before.board.get(alternative.move.from)!.role,
            ) &&
            comparison[i + 1]?.after.board.get(alternative.move.to)?.color === opposite(side) &&
            !step.after.board.get(alternative.move.to)
        )
            return `${alternative.san} uses ${makeSquare(alternative.move.to)} in the other line. The advanced pawn controls that square here.`;
    }
    return null;
}

type QualifiedFactor = {
    factor: ComparativePositionalEvidence;
    continuationEvidence?: string;
};

/** A new square may simply be where a piece escaped an attack. For the
 * position-level diagnosis require evidence that the file or pawn is used.
 * Removing a free piece alone is not a positional exchange. */
export function qualifyPositionFactors(
    fen: string,
    line: DecisionEngineLine,
    factors: ComparativePositionalEvidence[],
    candidates: DecisionEngineLine[] = [],
) {
    if (!factors.length) return [];
    const steps = replayTacticalLine(fen, line.pvUci.slice(0, WINDOW));
    if (!steps.length) return [];
    return factors.flatMap((factor): QualifiedFactor[] => {
        const accepted = [{ factor }];
        const index = factor.firstPly - 1;
        const reached = steps[index]?.after;
        if (!reached) return [];
        switch (factor.feature) {
            case "open-rook-file":
            case "semi-open-rook-file":
                for (const square of reached.board.rook.intersect(reached.board[factor.side])) {
                    if (makeSquare(square)[0] !== factor.squareOrFile) continue;
                    const fileUse = rookUsesFile(steps, index, factor.side, square);
                    if (
                        fileUse &&
                        (!fileUse.exchange || factor.comparison === "separate-reply-search")
                    )
                        return [{ factor, continuationEvidence: fileUse.description }];
                }
                return [];
            case "bishop-pair-removal":
                return quietSettlement(steps, Math.max(6, factor.firstPly + 3), 50) ? accepted : [];
            case "piece-reach":
            case "piece-restriction":
                return !steps[0].capture && !steps[0].after.isCheck() ? accepted : [];
            case "pawn-space": {
                const comparison = candidates.find(
                    (candidate) => candidate.pvUci[0] === factor.comparisonMoveUci,
                );
                const support = usesPawnSpace(
                    steps,
                    comparison ? replayTacticalLine(fen, comparison.pvUci.slice(0, WINDOW)) : [],
                    factor.side,
                    factor.squareOrFile,
                );
                return support ? [{ factor, continuationEvidence: support }] : [];
            }
            case "pawn-stable-minor":
                // Check can be the whole reason for landing there. Retaining
                // the outpost only during a decisive material win is weak evidence.
                return !reached.isCheck() ||
                    quietSettlement(steps, Math.max(6, factor.firstPly + 3), 100)
                    ? accepted
                    : [];
            case "passed-pawn-progress":
                return factor.after < 7 ? accepted : [];
            case "passed-pawn":
                return [...reached.board.pawn.intersect(reached.board[factor.side])].some(
                    (square) =>
                        makeSquare(square)[0] === factor.squareOrFile &&
                        rank(square, factor.side) >= 5 &&
                        passed(reached, square, factor.side),
                )
                    ? accepted
                    : [];
            default:
                return accepted;
        }
    });
}
