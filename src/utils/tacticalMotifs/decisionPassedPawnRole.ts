import { castlingSide } from "chessops/chess";
import { makeFen } from "chessops/fen";
import type { Chess } from "chessops/chess";
import type { Color, Square } from "chessops/types";
import { makeSquare, opposite, parseSquare } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "./causalTactics";
import type { DecisionEngineLine } from "./decisionEvidence";
import { followPieceIdentities, initialPieceIdentities } from "./decisionPieceIdentity";
import type { PositionStrategicPlan } from "./decisionPositionPlans";
import { validateDecisionSearchFrame } from "./decisionSearchFrame";
import type { TacticalGameHistory } from "./gameHistory";
import { extractPositionalBoardFacts } from "./positionalEvidence";

const WINDOW = 14;
type RoleInput = {
    fen: string;
    candidates: DecisionEngineLine[];
    comparisonCandidates?: DecisionEngineLine[];
    replyProbes?: { moveUci: string; lines: DecisionEngineLine[] }[];
    history?: TacticalGameHistory;
};
type Scored = DecisionEngineLine & { cp: number };
type Step = TacticalReplayStep & {
    origin: Square;
    taken: Square | undefined;
    identities: Map<Square, Square>;
};
type Role = "advance" | "remove" | "blockade";
type Observation = {
    role: Role;
    actor: Square;
    initialHelps: boolean;
    target: Square;
    removedGuards: string;
    ply: number;
    before: string;
    path: string[];
    handoff?: string;
};

function score(line: DecisionEngineLine | undefined): line is Scored {
    return !!line && line.depth >= 16 && line.cp !== null && Number.isFinite(line.cp) && line.mate == null &&
        !line.lowerbound && !line.upperbound && !line.claimHistory;
}

function continuation(input: RoleInput, root: Scored) {
    const move = root.pvUci[0];
    const probe = input.replyProbes?.find(p => p.moveUci === move);
    const step = replayTacticalLine(input.fen, [move])[0];
    if (!probe || !step) return [];
    const history = input.history && { fen: input.history.fen, moves: [...input.history.moves, move] };
    const lines = validateDecisionSearchFrame(makeFen(step.after.toSetup()), probe.lines, history);
    const first = lines?.[0];
    if (!lines || !score(first) || Math.abs(first.cp + root.cp) > 90) return [];
    return [root.pvUci, ...lines.flatMap(line =>
        score(line) && line.depth === first.depth && first.cp - line.cp <= 100 ? [[move, ...line.pvUci]] : []
    )];
}

function routes(input: RoleInput) {
    const first = input.candidates[0];
    if (!score(first)) return [];
    const roots = validateDecisionSearchFrame(input.fen, input.candidates, input.history);
    if (!roots) return [];
    const paired = input.comparisonCandidates?.length
        ? validateDecisionSearchFrame(input.fen, input.comparisonCandidates, input.history)
        : null;
    const pairedLeader = paired?.[0];
    return roots.flatMap(root => {
        if (!score(root) || first.cp - root.cp > 50 || first.depth !== root.depth) return [];
        const counterpart = paired?.find(line => line.pvUci[0] === root.pvUci[0]);
        if (score(counterpart) && score(pairedLeader) && pairedLeader.depth === counterpart.depth &&
            pairedLeader.cp - counterpart.cp > 50) return [];
        return continuation(input, root);
    });
}

function trace(fen: string, moves: string[]): Step[] {
    const steps = replayTacticalLine(fen, moves.slice(0, WINDOW));
    if (!steps.length) return [];
    const ids = initialPieceIdentities(steps[0].before);
    const recorded: Step[] = [];
    for (const step of steps) {
        if (castlingSide(step.before, step.move)) break;
        const origin = ids.get(step.move.from)!;
        const taken = followPieceIdentities(ids, step);
        recorded.push({ ...step, origin, taken, identities: new Map(ids) });
    }
    return recorded;
}

function currentSquare(step: Step, origin: Square) {
    return [...step.identities].find(([, id]) => id === origin)?.[0];
}

function quiet(step: Step) {
    return !step.capture && !step.after.isCheck() && !step.move.promotion;
}

function newlyGuards(first: Step, target: Square) {
    const side = first.before.turn;
    return canGuard(first.after, first.move.to, target, side) &&
        !canGuard(first.before, first.move.from, target, side);
}

function canGuard(position: Chess, attacker: Square, target: Square, side: Color) {
    // Legality of the shown blockade is proved by the replay. King exposure
    // must not make a geometric rook or bishop guard fictitious.
    if (!position.kingAttackers(target, side, position.board.occupied).has(attacker)) return false;
    const before = position.clone();
    if (before.board.get(target)?.role === "king") return false;
    before.board.set(target, { role: "pawn", color: opposite(side) });
    before.turn = side;
    before.epSquare = undefined;
    return before.isLegal({ from: attacker, to: target });
}

function observations(fen: string, path: Step[], pawn: Square, owner: Color) {
    const first = path[0];
    const side = first.before.turn;
    const guards = new Set(first.before.kingAttackers(pawn, owner, first.before.board.occupied));
    const roles: Observation[] = [];
    const note = (
        role: Role, ply: number, step: Step, initialHelps: boolean, target: Square,
        removedGuards = "", tail = 2, handoff?: string,
    ) => roles.push({
        role, ply, actor: step.origin, initialHelps, target, removedGuards, handoff,
        before: ply ? makeFen(step.before.toSetup()).split(" ").slice(0, 4).join(" ") : fen,
        path: path.slice(0, ply + tail + 1).map(item => item.uci),
    });
    for (let ply = 0; ply < Math.min(path.length, 8); ply += 2) {
        const step = path[ply];
        if (owner === side) {
            if (step.origin === pawn && quiet(step) && path.length > ply + 2 &&
                path.slice(ply, ply + 3).every(later => {
                    const position = currentSquare(later, pawn);
                    return position !== undefined && later.after.board.get(position)?.role === "pawn";
                })) {
                note("advance", ply, step, !ply || newlyGuards(first, pawn) || newlyGuards(first, step.move.to), step.move.to);
            }
            continue;
        }
        const last = path[ply + 2];
        if (step.taken === pawn && last && last.balance >= -100) {
            const reply = path[ply + 1];
            const recapture = reply.taken === step.origin && last.taken === reply.origin &&
                last.origin === first.origin && last.move.to === step.move.to;
            const removed = [...guards].filter(guard => currentSquare(step, guard) === undefined).sort().join(",");
            const removesGuard = path.slice(0, ply).some(item =>
                item.origin === first.origin && item.taken !== undefined && guards.has(item.taken));
            note("remove", ply, step, ply > 0 && (step.origin === first.origin || recapture || removesGuard),
                step.move.to, removed);
        } else if (quiet(step) && path[ply + 4]?.balance >= -100) {
            const square = currentSquare(step, pawn);
            if (square === undefined) continue;
            const front = square + (owner === "white" ? 8 : -8);
            if (step.move.to !== front || !path.slice(ply + 1, ply + 5).every(later =>
                later.identities.get(front) === step.origin && later.identities.get(square) === pawn)) continue;
            const actor = currentSquare(step, first.origin);
            const handoff = first.move.from === front && actor !== undefined && actor % 8 === front % 8 &&
                canGuard(step.after, actor, front, side);
            note("blockade", ply, step, step.origin === first.origin || handoff, front, "", 4,
                handoff ? `${first.san} leaves ${makeSquare(front)} for the blockading piece and still defends that square.` : undefined);
        }
    }
    return roles;
}

function distinct(a: Observation, b: Observation) {
    if (a.path[0] === b.path[0] && a.path[1] === b.path[1]) return false;
    if (a.before === b.before)
        return a.ply === 0 && b.ply === 0 && a.path[0] === b.path[0] &&
            a.role === b.role && (a.role === "advance" || a.role === "blockade");
    return a.role !== b.role || a.actor !== b.actor || a.removedGuards !== b.removedGuards ||
        a.target !== b.target || a.role === "advance" || a.role === "blockade";
}

function explain(pawn: string, a: Observation, b: Observation, exact = false): PositionStrategicPlan {
    const role = a.role === "advance"
        ? `The passed pawn on ${pawn} advances and survives the next moves in both lines.`
        : a.role !== b.role
            ? `Both lines deal with the opposing passed pawn on ${pawn}. One captures it and the other blocks it.`
            : a.role === "remove"
                ? `Both lines remove the opposing passed pawn on ${pawn} through different exchanges.`
                : `Both lines keep a piece in front of the opposing passed pawn on ${pawn} and stop its advance.`;
    const description = exact && a.handoff && a.handoff === b.handoff ? `${a.handoff} ${role}` : role;
    return { description, linesUci: [a.path, b.path] };
}

/** Position evidence can span viable choices. Exact move evidence requires its
 * original mover to participate under two legal, independently scored replies. */
export function findPassedPawnRoles(input: RoleInput) {
    const facts = extractPositionalBoardFacts(input.fen);
    const moves = new Map<string, PositionStrategicPlan>();
    if (!facts) return { position: undefined, moves };
    const pawns = (["white", "black"] as const).flatMap(owner => facts[owner].passedPawns.flatMap(name => {
        const square = parseSquare(name)!;
        const rank = square >> 3;
        return (owner === "white" ? rank : 7 - rank) >= 4 ? [{ name, square, owner }] : [];
    }));
    if (!pawns.length) return { position: undefined, moves };
    const traces = routes(input).map(line => trace(input.fen, line)).filter(line => line.length);
    let position: PositionStrategicPlan | undefined;
    for (const { name, square, owner } of pawns) {
        const roles = traces.flatMap(path => observations(input.fen, path, square, owner));
        for (const [index, first] of roles.entries()) {
            for (const second of roles.slice(index + 1)) {
                if (!distinct(first, second)) continue;
                position ??= explain(name, first, second);
                const root = first.path[0];
                if (root === second.path[0] && first.initialHelps && second.initialHelps && !moves.has(root))
                    moves.set(root, explain(name, first, second, true));
            }
        }
    }
    return { position, moves };
}
