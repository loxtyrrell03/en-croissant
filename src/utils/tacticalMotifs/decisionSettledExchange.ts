import { attacks } from "chessops/attacks";
import { castlingSide, type Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import type { Color, Role, Square } from "chessops/types";
import { makeSquare, opposite, parseSquare } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import { followPieceIdentities, initialPieceIdentities } from "./decisionPieceIdentity";
import type { PositionStrategicPlan } from "./decisionPositionPlans";
import { extractPositionalBoardFacts } from "./positionalEvidence";

const WINDOW = 14;
const rank = (square: Square, side: Color) => (side === "white" ? square >> 3 : 7 - (square >> 3));
const file = (square: Square) => square % 8;

function isForcing(step: TacticalReplayStep) {
    return step.capture !== 0 || !!step.move.promotion || step.after.isCheck();
}

function replay(fen: string, moves: string[]) {
    const steps = replayTacticalLine(fen, moves.slice(0, WINDOW));
    if (!steps.length || steps.some(({ before, move }) => castlingSide(before, move))) return [];
    const identities = initialPieceIdentities(steps[0].before);
    return steps.map((step) => {
        const origin = identities.get(step.move.from)!;
        const removed = followPieceIdentities(identities, step);
        return { step, origin, removed, identities: new Map(identities) };
    });
}

type Trace = ReturnType<typeof replay>;

function balanceReturns(trace: Trace) {
    const taken = new Set<Square>();
    const root = trace[0].origin;
    let involved = false;
    for (const [index, { step, origin, removed }] of trace.slice(0, 6).entries()) {
        if (removed === undefined) continue;
        if (!taken.size && index >= 4) return;
        involved ||= origin === root || removed === root;
        taken.add(removed);
        if (!involved || taken.size < 2 || Math.abs(step.balance) > 50) continue;
        const tail = trace.slice(index + 1, index + 3);
        if (
            tail.length === 2 &&
            tail.every(({ step }) => !isForcing(step)) &&
            !trace.slice(0, index + 1).some(({ step }) => step.move.promotion)
        )
            return { index, victims: [...taken].sort((a, b) => a - b).join(",") };
    }
}

function retains(
    trace: Trace,
    from: number,
    origin: Square,
    side: Color,
    role: Role,
    plies: number,
) {
    return (
        trace.length > from + plies &&
        trace.slice(from, from + plies + 1).every(({ step, identities }) => {
            const match = [...identities].find(([, identity]) => identity === origin)?.[0];
            const piece = match !== undefined ? step.after.board.get(match) : undefined;
            return piece?.color === side && piece.role === role;
        })
    );
}

function passes(position: Chess, color: Color) {
    return new Set(
        extractPositionalBoardFacts(makeFen(position.toSetup()))?.[color].passedPawns ?? [],
    );
}

function hasFriendlyPawn(board: Chess, side: Color, column: number) {
    return [...board.board.pieces(side, "pawn")].some((square) => file(square) === column);
}

type Use = { key: string; actor: Square; through: number; action: string; description: string };

function usedAssets(trace: Trace, trade: number): Use[] {
    const root = trace[0].step.before;
    const side = root.turn;
    const settled = trace[trade];
    const start = passes(root, side);
    const created = [...passes(settled.step.after, side)].flatMap((square) => {
        const origin = settled.identities.get(parseSquare(square)!);
        return origin !== undefined &&
            !start.has(makeSquare(origin)) &&
            rank(parseSquare(square)!, side) >= 3
            ? [{ square, origin }]
            : [];
    });
    const neighbour = opposite(side);
    const handles = new Map<string, Use>();
    for (const [offset, { step, origin }] of trace.slice(trade + 1, trade + 7).entries()) {
        const index = trade + offset + 1;
        if (step.before.turn !== side || isForcing(step)) continue;
        const target = step.move.to;
        const kind = step.before.board.get(step.move.from)?.role;
        const createdPawn =
            kind === "pawn" ? created.find((item) => item.origin === origin) : undefined;
        if (
            createdPawn &&
            rank(target, side) >= 4 &&
            passes(step.after, side).has(makeSquare(target)) &&
            retains(trace, index, origin, side, "pawn", 4)
        ) {
            const key = `pawn:${origin}`;
            if (!handles.has(key))
                handles.set(key, {
                    key,
                    actor: origin,
                    through: index + 5,
                    action: step.san,
                    description: `The exchange creates a passed pawn on ${createdPawn.square}, and ${step.san} advances that pawn.`,
                });
        }
        const column = file(target);
        if (
            kind !== "rook" ||
            !hasFriendlyPawn(root, side, column) ||
            hasFriendlyPawn(settled.step.after, side, column) ||
            hasFriendlyPawn(step.after, side, column) ||
            (file(step.move.from) === column && rank(target, side) <= rank(step.move.from, side)) ||
            !retains(trace, index, origin, side, "rook", 2)
        )
            continue;
        const contacts = [
            ...attacks({ role: "rook", color: side }, target, step.after.board.occupied),
        ].some((square) => file(square) === column && step.after.board[neighbour].has(square));
        if (rank(target, side) < 4 && !contacts) continue;
        const key = `file:${column}`;
        if (!handles.has(key))
            handles.set(key, {
                key,
                actor: origin,
                through: index + 3,
                action: step.san,
                description: `The captures leave no friendly pawn on the ${makeSquare(target)[0]}-file. ${step.san} puts the rook to work on that file.`,
            });
    }
    return [...handles.values()];
}

/** The two searches agree on a materially balanced exchange involving the
 * root piece. The new strategic asset has to be put to use in both lines. */
export function findSettledExchangePlan(
    fen: string,
    root: DecisionEngineLine,
    reply: DecisionEngineLine,
): PositionStrategicPlan | null {
    if (
        root.depth < 16 ||
        reply.depth < 16 ||
        root.cp === null ||
        reply.cp === null ||
        root.mate != null ||
        reply.mate != null ||
        Math.abs(root.cp + reply.cp) > 90
    )
        return null;
    const moves = [root.pvUci[0], ...reply.pvUci];
    const first = replay(fen, root.pvUci);
    if (
        !first.length ||
        measureDecisionLine(fen, root)?.drawnEnding !== false ||
        measureDecisionLine(makeFen(first[0].step.after.toSetup()), reply)?.drawnEnding !== false
    )
        return null;
    const second = replay(fen, moves);
    if (!second.length) return null;
    const a = balanceReturns(first);
    const b = balanceReturns(second);
    if (!a || !b || a.victims !== b.victims) return null;
    const firstAssets = usedAssets(first, a.index);
    if (!firstAssets.length) return null;
    const secondAssets = usedAssets(second, b.index);
    for (const asset of firstAssets) {
        const matching = secondAssets.find(
            (item) => item.key === asset.key && item.actor === asset.actor,
        );
        if (!matching) continue;
        const description =
            asset.action === matching.action
                ? `${asset.description} Both searches show this follow-up.`
                : `${asset.description} The separate reply search uses ${matching.action} with the same ${asset.key.startsWith("pawn:") ? "pawn" : "rook"}.`;
        return {
            description,
            linesUci: [root.pvUci.slice(0, asset.through), moves.slice(0, matching.through)],
        };
    }
    return null;
}
