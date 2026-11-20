import { pawnAttacks } from "chessops/attacks";
import type { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import type { Color, Square } from "chessops/types";
import { makeSquare, opposite } from "chessops/util";
import {
    replayTacticalLine,
    tacticalExchangeGain,
    type TacticalReplayStep,
} from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import type { TacticalGameHistory } from "./gameHistory";
import type { ComparativePositionalEvidence } from "./positionalTransitions";
import {
    advanceTacticalRepetitionContext,
    readTacticalRepetitionContext,
    tacticalRepetitionClaim,
} from "./repetitionHistory";

const LAST_ENTRY = 9;
const HORIZON = 12;
const RETAINED_PLIES = 4;
const MATERIAL_TOLERANCE = 110;
const rank = (square: Square, color: Color) =>
    color === "white" ? (square >> 3) + 1 : 8 - (square >> 3);

type Trace = { step: TacticalReplayStep; origins: Map<Square, Square> };
type OutpostRoute = {
    firstPly: number;
    origin: Square;
    target: Square;
    pawn: Square;
    capture: TacticalReplayStep;
    entry: TacticalReplayStep;
};

export type ExchangeOutpostEvidence = {
    factor: ComparativePositionalEvidence;
    playedLineUci: string[];
    betterLineUci: string[];
};

function supportingPawn(board: Chess, target: Square, side: Color) {
    const figure = board.board.get(target);
    if (
        rank(target, side) < 5 ||
        figure?.color !== side ||
        (figure.role !== "knight" && figure.role !== "bishop")
    )
        return undefined;
    if (
        [...board.board.pawn.intersect(board.board[opposite(side)])].some(
            (pawn) =>
                Math.abs((pawn % 8) - (target % 8)) === 1 &&
                rank(pawn, side) > rank(target, side),
        )
    )
        return undefined;
    const king = board.board.kingOf(side);
    if (king === undefined) return undefined;
    return [...board.board.pawn.intersect(board.board[side])].find(
        (pawn) =>
            pawnAttacks(side, pawn).has(target) &&
            board.kingAttackers(king, opposite(side), board.board.occupied.without(pawn)).isEmpty(),
    );
}

function track(steps: TacticalReplayStep[]): Trace[] {
    const original = steps[0].before.board;
    const origins = new Map<Square, Square>(
        [...original.pawn.union(original.knight).union(original.bishop)].map((sq) => [sq, sq]),
    );
    return steps.map((step) => {
        const { before, move, capture } = step;
        const piece = before.board.get(move.from);
        if (capture && piece?.role === "pawn" && move.to === before.epSquare)
            origins.delete((move.to + (before.turn === "white" ? -8 : 8)) as Square);
        const id = origins.get(move.from);
        origins.delete(move.from);
        origins.delete(move.to);
        if (id !== undefined && !move.promotion) origins.set(move.to, id);
        return { step, origins: new Map(origins) };
    });
}

function paths(fen: string, line: DecisionEngineLine, reply?: DecisionEngineLine) {
    if (reply) {
        const [first] = replayTacticalLine(fen, line.pvUci.slice(0, 1));
        if (!first || !measureDecisionLine(makeFen(first.after.toSetup()), reply)) return [];
    }
    const checked = reply ? { ...line, pvUci: [line.pvUci[0], ...reply.pvUci] } : line;
    return measureDecisionLine(fen, checked)?.drawnEnding === false
        ? replayTacticalLine(fen, checked.pvUci.slice(0, HORIZON))
        : [];
}

function findRoutes(frames: Trace[], root: Chess, attacker: Color) {
    let beforeOrigins = new Map<Square, Square>(
        [...root.board].map(([square]) => [square, square]),
    );
    const captures = new Map<
        Square,
        { step: TacticalReplayStep; firstPly: number; pawn: Square }
    >();
    const routes: OutpostRoute[] = [];
    for (const [index, { step, origins }] of frames.slice(0, LAST_ENTRY).entries()) {
        const { before, move, after } = step;
        const origin = beforeOrigins.get(move.from);
        const captured = beforeOrigins.get(move.to);
        beforeOrigins = origins;
        if (origin === undefined || before.turn !== attacker) continue;
        const mover = before.board.get(move.from);
        if (mover?.role !== "knight" && mover?.role !== "bishop") continue;
        if (
            captured !== undefined &&
            root.board.get(captured)?.role === "pawn" &&
            before.board.get(move.to)?.role === "pawn"
        ) {
            captures.set(origin, { step, firstPly: index + 1, pawn: captured });
            continue;
        }
        const event = captures.get(origin);
        if (!event || index + 1 - event.firstPly > 4 || move.to === origin) continue;
        const attacked = pawnAttacks(opposite(attacker), event.pawn);
        if (
            !attacked.has(event.step.move.to) &&
            !attacked.has(move.to) &&
            event.pawn !== event.step.move.to &&
            event.pawn !== move.to
        )
            continue;
        if (
            supportingPawn(after, move.to, attacker) === undefined ||
            supportingPawn(root, move.to, attacker) !== undefined
        )
            continue;
        routes.push({
            firstPly: index + 1,
            origin,
            target: move.to,
            pawn: event.pawn,
            capture: event.step,
            entry: step,
        });
    }
    return routes;
}

function retained(line: Trace[], route: OutpostRoute, through: number, color: Color) {
    return line.slice(route.firstPly - 1, through).every(({ step, origins }) => {
        if (
            origins.get(route.target) !== route.origin ||
            supportingPawn(step.after, route.target, color) === undefined
        )
            return false;
        if (step.after.turn === color) return true;
        for (const [from, destinations] of step.after.allDests()) {
            if (!destinations.has(route.target)) continue;
            const gain = tacticalExchangeGain(step.after, { from, to: route.target });
            if (gain >= 0 || gain < -10000) return false;
        }
        return true;
    });
}

function avoidsDraw(
    fen: string,
    branches: TacticalReplayStep[][],
    through: number,
    history?: TacticalGameHistory,
) {
    if (!history) return true;
    const start = readTacticalRepetitionContext(fen, history);
    if (!start || tacticalRepetitionClaim(start)) return false;
    return branches.every((branch) => {
        let context = start;
        for (const { uci } of branch.slice(0, through)) {
            const next = advanceTacticalRepetitionContext(context, uci);
            if (!next || tacticalRepetitionClaim(next)) return false;
            context = next;
        }
        return true;
    });
}

/** Both tactical continuations must give the same minor piece a lasting
 * pawn-backed square. Compare the matched position after exchanges settle. */
export function compareExchangeOutpost(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    betterReply: DecisionEngineLine,
    playedReply: DecisionEngineLine,
    history?: TacticalGameHistory,
): ExchangeOutpostEvidence | null {
    if (
        better.cp == null ||
        played.cp == null ||
        betterReply.cp == null ||
        playedReply.cp == null ||
        better.depth !== played.depth ||
        betterReply.depth < 16 ||
        playedReply.depth < 16 ||
        [better, played, betterReply, playedReply].some((line) => line.mate != null) ||
        better.cp - played.cp < 60 ||
        playedReply.cp - betterReply.cp < 40 ||
        Math.abs(better.cp + betterReply.cp) > 90 ||
        Math.abs(played.cp + playedReply.cp) > 90
    )
        return null;
    const weaker = [paths(fen, played), paths(fen, played, playedReply)] as const;
    if (weaker.some((line) => line.length < RETAINED_PLIES + 2)) return null;
    const root = weaker[0][0].before;
    const attacker = opposite(root.turn);
    const trackWeak = weaker.map(track);
    const proposed = findRoutes(trackWeak[0], root, attacker);
    if (!proposed.length) return null;
    const repeated = findRoutes(trackWeak[1], root, attacker);
    if (!repeated.length) return null;
    const stronger = [paths(fen, better), paths(fen, better, betterReply)] as const;
    const branches = [...weaker, ...stronger];
    const limit = Math.min(...branches.map((line) => line.length));
    for (const route of proposed) {
        const other = repeated.find(
            (candidate) =>
                candidate.origin === route.origin &&
                candidate.pawn === route.pawn &&
                candidate.target === route.target,
        );
        if (!other) continue;
        const first = Math.max(route.firstPly, other.firstPly);
        for (let through = first + RETAINED_PLIES - 1; through <= limit; through++) {
            const balances = branches.map((line) => line[through - 1].balance);
            if (
                Math.max(...balances) - Math.min(...balances) > MATERIAL_TOLERANCE ||
                branches.some((line) => line[through - 1].after.isCheck() ||
                    line[through - 1].balance !== line[through - 2].balance)
            )
                continue;
            if (
                stronger.some((branch) =>
                    branch.slice(0, through).some(({ after }) =>
                        supportingPawn(after, route.target, attacker) !== undefined),
                ) ||
                !retained(trackWeak[0], route, through, attacker) ||
                !retained(trackWeak[1], other, through, attacker) ||
                !avoidsDraw(fen, branches, through, history)
            )
                continue;
            const label = attacker === "white" ? "White" : "Black";
            const square = makeSquare(route.target);
            const name = route.entry.before.board.get(route.entry.move.from)!.role;
            const helper = supportingPawn(route.entry.after, route.target, attacker)!;
            return {
                playedLineUci: weaker[0].slice(0, through).map(({ uci }) => uci),
                betterLineUci: stronger[0].slice(0, through).map(({ uci }) => uci),
                factor: {
                    feature: "pawn-stable-minor",
                    side: attacker,
                    squareOrFile: square,
                    firstPly: route.firstPly,
                    lastConsecutivePly: through,
                    description: `After ${weaker[0][0].san}, ${route.capture.san} takes the pawn from ${makeSquare(route.pawn)}. ${route.entry.san} gives ${label}'s ${name} a lasting square on ${square}, supported by ${makeSquare(helper)}. Both searches keep it there after the exchange. The ${stronger[0][0].san} lines avoid that outpost through the same interval.`,
                    support: "board-fact",
                    comparisonMoveUci: better.pvUci[0],
                    comparisonGapCp: better.cp - played.cp,
                    supportInComparison: false,
                    comparison: "separate-reply-search",
                    materialWindowPlies: through,
                    interpretation: "heuristic",
                },
            };
        }
    }
    return null;
}
