import { rookAttacks } from "chessops/attacks";
import type { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import type { Color, Square } from "chessops/types";
import { makeSquare, opposite } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import type { ComparativePositionalEvidence } from "./positionalTransitions";

const WINDOW = 10;
const MIN_DURATION = 4;
const file = (square: Square) => square % 8;
const rank = (square: Square, side: Color) =>
    side === "white" ? Math.floor(square / 8) + 1 : 8 - Math.floor(square / 8);

type Pressure = {
    front: Square;
    behind?: Square;
    pawn: Square;
    pawnOrigin: Square;
    rookOrigins: Square[];
    legalTake: boolean;
};
type PressureWindow = Pressure & { first: number; last: number; firstLegal: number };
type Trace = ReturnType<typeof pressureTrace>;
export type RookPressureEvidence = {
    factor: ComparativePositionalEvidence;
    betterLineUci: string[];
    playedLineUci: string[];
};

function pressureKey(pressure: Pressure) {
    return `${pressure.front}:${pressure.behind ?? "-"}:${pressure.pawn}:${pressure.pawnOrigin}:${pressure.rookOrigins.join(",")}`;
}

function pressureOn(position: Chess, root: Chess, side: Color, origins: Map<Square, Square>) {
    const result: Pressure[] = [];
    const rooks = position.board.rook.intersect(position.board[side]);
    const pawns = position.board.pawn.intersect(position.board[opposite(side)]);
    for (const front of rooks) {
        const origin = origins.get(front);
        if (origin === undefined || root.board.get(origin)?.role !== "rook") continue;
        const attacked = rookAttacks(front, position.board.occupied);
        for (const pawn of attacked.intersect(pawns)) {
            const pawnOrigin = origins.get(pawn);
            if (pawnOrigin === undefined || root.board.get(pawnOrigin)?.role !== "pawn") continue;
            const pressure = {
                front,
                pawn,
                pawnOrigin,
                rookOrigins: [origin],
                legalTake: position.turn === side && position.isLegal({ from: front, to: pawn }),
            };
            if (rank(front, side) >= 4) result.push(pressure);
            if (file(pawn) !== file(front) || rank(pawn, side) <= rank(front, side)) continue;
            for (const behind of attacked.intersect(rooks)) {
                if (file(behind) !== file(front) || rank(behind, side) >= rank(front, side))
                    continue;
                const partner = origins.get(behind);
                if (partner === undefined || root.board.get(partner)?.role !== "rook") continue;
                result.push({ ...pressure, behind, rookOrigins: [origin, partner] });
            }
        }
    }
    return result;
}

function pressureTrace(steps: TacticalReplayStep[], side: Color) {
    const root = steps[0].before;
    const origins = new Map([...root.board].map(([square]) => [square, square]));
    const initial = new Set(pressureOn(root, root, side, origins).map(pressureKey));
    const active = new Map<string, PressureWindow>();
    const windows: PressureWindow[] = [];
    const removedPawns = new Map<Square, number>();
    let ply = 0;
    for (const { before, after, move, capture } of steps) {
        ply++;
        const enPassant =
            capture && before.epSquare === move.to && before.board.get(move.from)?.role === "pawn";
        const taken = (
            enPassant ? move.to + (before.turn === "white" ? -8 : 8) : move.to
        ) as Square;
        const targetOrigin = origins.get(taken);
        if (capture && targetOrigin !== undefined && before.board.get(taken)?.role === "pawn")
            removedPawns.set(targetOrigin, ply);
        const from = origins.get(move.from);
        if (move.promotion && from !== undefined) removedPawns.set(from, ply);
        origins.delete(move.from);
        origins.delete(taken);
        if (from !== undefined) origins.set(move.to, from);
        const current = new Set<string>();
        for (const pressure of pressureOn(after, root, side, origins)) {
            const key = pressureKey(pressure);
            current.add(key);
            let window = active.get(key);
            if (!window) {
                window = { ...pressure, first: ply, last: ply, firstLegal: Infinity };
                windows.push(window);
                active.set(key, window);
            }
            window.last = ply;
            if (pressure.legalTake) window.firstLegal = Math.min(window.firstLegal, ply);
        }
        for (const key of active.keys()) if (!current.has(key)) active.delete(key);
    }
    return { initial, windows, removedPawns };
}

function directlyEnabled(steps: TacticalReplayStep[], pressure: PressureWindow) {
    const [first] = steps;
    const role = first.before.board.get(first.move.from)?.role;
    if (role === "rook") return pressure.rookOrigins.includes(first.move.from);
    if (
        role !== "pawn" ||
        pressure.behind === undefined ||
        file(first.move.from) !== file(pressure.front)
    )
        return false;
    const after = steps[pressure.first - 1].after;
    return ![...after.board.pawn.intersect(after.board[first.before.turn])].some(
        (square) => file(square) === file(pressure.front),
    );
}

function replayChoice(fen: string, line: DecisionEngineLine, reply?: DecisionEngineLine) {
    let expanded = line;
    if (reply) {
        const root = replayTacticalLine(fen, line.pvUci.slice(0, 1))[0];
        if (!root || !measureDecisionLine(makeFen(root.after.toSetup()), reply)) return [];
        expanded = { ...line, pvUci: [line.pvUci[0], ...reply.pvUci] };
    }
    return measureDecisionLine(fen, expanded)
        ? replayTacticalLine(fen, expanded.pvUci.slice(0, WINDOW))
        : [];
}

/** A rook's geometric reach is an observation. Give it strategic weight only
 * when both searched lines use the same rook(s) against the same pawn, the
 * root sets it up, and the played lines neither reproduce it nor take that pawn. */
export function compareRookPressure(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    betterReply: DecisionEngineLine,
    playedReply: DecisionEngineLine,
): RookPressureEvidence | null {
    const { cp } = better;
    if (
        cp === null ||
        played.cp === null ||
        better.depth !== played.depth ||
        better.depth < 16 ||
        cp - played.cp < 60 ||
        betterReply.cp === null ||
        playedReply.cp === null ||
        playedReply.cp - betterReply.cp < 40 ||
        [better, played, betterReply, playedReply].some((line) => line.mate != null)
    )
        return null;
    const betterSteps = replayChoice(fen, better);
    const first = betterSteps[0];
    if (!first || !["rook", "pawn"].includes(first.before.board.get(first.move.from)?.role ?? ""))
        return null;
    const stronger = [betterSteps, replayChoice(fen, better, betterReply)];
    const weaker = [replayChoice(fen, played), replayChoice(fen, played, playedReply)];
    if ([...stronger, ...weaker].some((line) => line.length < 6)) return null;
    const side = stronger[0][0].before.turn;
    const [main, repeat] = stronger.map((steps) => pressureTrace(steps, side));
    const comparisons: Trace[] = weaker.map((steps) => pressureTrace(steps, side));
    const candidate = (window: PressureWindow) =>
        window.first <= 6 &&
        window.last - window.first + 1 >= MIN_DURATION &&
        Number.isFinite(window.firstLegal);
    const ordered = main.windows
        .filter((window) => candidate(window) && !main.initial.has(pressureKey(window)))
        .sort(
            (a, b) =>
                Number(b.behind !== undefined) - Number(a.behind !== undefined) ||
                a.first - b.first,
        );
    for (const witness of ordered) {
        const other = repeat.windows.find(
            (window) => pressureKey(window) === pressureKey(witness) && candidate(window),
        );
        if (
            !other ||
            !directlyEnabled(stronger[0], witness) ||
            !directlyEnabled(stronger[1], other)
        )
            continue;
        const through = Math.max(witness.first, other.first) + MIN_DURATION - 1;
        if (
            witness.last < through ||
            other.last < through ||
            witness.firstLegal > through ||
            other.firstLegal > through ||
            weaker.some((line) => line.length < through) ||
            comparisons.some(
                (trace) =>
                    (trace.removedPawns.get(witness.pawnOrigin) ?? Infinity) <= through ||
                    trace.windows.some(
                        (window) =>
                            window.pawnOrigin === witness.pawnOrigin &&
                            (witness.behind === undefined || window.behind !== undefined) &&
                            window.first <= through,
                    ),
            )
        )
            continue;
        const balances = [...stronger, ...weaker].map((line) => line[through - 1].balance);
        if (Math.max(...balances) - Math.min(...balances) > 100) continue;
        const choice = stronger[0][0].san;
        const actual = weaker[0][0].san;
        const entry = stronger[0][witness.first - 1].san;
        const target = makeSquare(witness.pawn);
        const pawnLabel =
            witness.pawnOrigin === witness.pawn
                ? `the pawn on ${target}`
                : `the pawn from ${makeSquare(witness.pawnOrigin)} on ${target}`;
        const explanation =
            witness.behind === undefined
                ? `a rook on ${makeSquare(witness.front)} keeps pressure on ${pawnLabel}`
                : `the rooks on ${makeSquare(witness.behind)} and ${makeSquare(witness.front)} stay doubled against ${pawnLabel}`;
        return {
            betterLineUci: better.pvUci.slice(0, through),
            playedLineUci: played.pvUci.slice(0, through),
            factor: {
                feature: "rook-pawn-pressure",
                side,
                squareOrFile: target,
                description: `Both searches after ${choice} show that ${explanation}. The displayed line reaches this setup with ${entry}. After ${actual}, the same pressure is missing from the compared early moves.`,
                firstPly: witness.first,
                lastConsecutivePly: through,
                support: "board-fact",
                comparisonMoveUci: played.pvUci[0],
                comparisonGapCp: cp - played.cp,
                supportInComparison: false,
                comparison: "separate-reply-search",
                materialWindowPlies: through,
                interpretation: "heuristic",
            },
        };
    }
    return null;
}
