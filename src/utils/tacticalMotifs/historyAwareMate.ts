import type { Chess } from "chessops/chess";
import { makeSan, parseSan } from "chessops/san";
import type { NormalMove } from "chessops/types";
import { makeUci, parseUci } from "chessops/util";
import type { TacticalGameHistory } from "./gameHistory";
import type { TacticalMotifEvidence } from "./types";
import {
    advanceTacticalRepetitionContext, readTacticalRepetitionContext,
    tacticalRepetitionClaim, tacticalRepetitionPosition,
    type TacticalRepetitionContext,
} from "./repetitionHistory";

export type HistoryAwareMateProof = Readonly<{
    status: "proven"; maxMoves: number; visits: number; line: readonly string[];
}> | Readonly<{ status: "unknown" | "unproven"; visits: number }>;
const NODE_LIMIT = 65536;
const cache = new Map<string, HistoryAwareMateProof>();

function legalMoves(position: Chess): NormalMove[] {
    const result: NormalMove[] = [];
    for (const [from, destinations] of position.allDests()) for (const to of destinations) {
        const promotions = position.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
            ? ["queen", "rook", "bishop", "knight"] as const : [undefined];
        for (const promotion of promotions) {
            const move: NormalMove = { from, to, ...(promotion ? { promotion } : {}) };
            if (position.isLegal(move)) result.push(move);
        }
    }
    return result;
}

/** Reprove a nominated mate on actual legal history, not on the supplied PV.
 * All defender moves are universal. Short finishes try every legal attacker
 * move; longer ones try checks and at most two legally nominated quiet moves.
 * Restrictions/exhaustion are UNKNOWN, never an invented drawing verdict.
 * The 13-ply/65,536-node envelope matches the existing checking-mate proof.
 */
export function proveHistoryAwareMate(
    fen: string, line: readonly string[], history: TacticalGameHistory | null | undefined,
    maxMoves: number, nodeLimit = NODE_LIMIT,
): HistoryAwareMateProof {
    if (!Number.isSafeInteger(maxMoves) || maxMoves < 1 || maxMoves > 7 ||
        !Number.isSafeInteger(nodeLimit) || nodeLimit <= 0 || nodeLimit > NODE_LIMIT)
        return Object.freeze({ status: "unknown", visits: 0 });
    const key = JSON.stringify([fen, line, history, maxMoves, nodeLimit]);
    const cached = cache.get(key);
    if (cached) return cached;
    const context = readTacticalRepetitionContext(fen, history);
    const initial = context && tacticalRepetitionPosition(context);
    const rootMove = line[0] && parseUci(line[0]);
    if (!context || !initial || !rootMove || !("from" in rootMove) ||
        !initial.isLegal(rootMove) || context.endedAtPly !== undefined)
        return Object.freeze({ status: "unknown", visits: 0 });

    // Nominations are bound to actual replay. A malformed tail cannot donate
    // a later quiet move, and no nominated move substitutes for legal proof.
    const hints = new Set<string>(), quietHints = new Set<string>();
    const replay = initial.clone(), attacker = initial.turn;
    for (const uci of line.slice(0, 13)) {
        const move = parseUci(uci);
        if (!move || !("from" in move) || !replay.isLegal(move) || replay.isEnd()) break;
        const actor = replay.turn;
        replay.play(move);
        if (actor === attacker) {
            hints.add(makeUci(move));
            if (!replay.isCheck()) quietHints.add(makeUci(move));
        }
    }
    let visits = 0, restricted = false;
    const visit = () => { if (++visits > nodeLimit) throw new Error("Mate qualification budget"); };
    const nextContext = (state: TacticalRepetitionContext, move: NormalMove) => {
        visit();
        const next = advanceTacticalRepetitionContext(state, makeUci(move));
        if (!next) throw new Error("Invalid proof continuation");
        return next;
    };
    const terminalDraw = (state: TacticalRepetitionContext, position: Chess) =>
        state.endedAtPly !== undefined || position.halfmoves >= 150 || position.isEnd();
    const ordered = (position: Chess) => legalMoves(position).sort((a, b) => {
        const hint = Number(hints.has(makeUci(b))) - Number(hints.has(makeUci(a)));
        const flip = attacker === "white" ? 0 : 56;
        return hint || (a.from ^ flip) - (b.from ^ flip) || (a.to ^ flip) - (b.to ^ flip);
    });

    const attack = (state: TacticalRepetitionContext, remaining: number, quiet: number): string[] | null => {
        const position = tacticalRepetitionPosition(state)!;
        if (remaining <= 0 || terminalDraw(state, position)) return null;
        // Optional attacker claims are deliberately ignored; automatic draws
        // still end the game. Actual checks/captures/underpromotions are legal.
        const candidates = ordered(position).map(move => {
            visit();
            const after = position.clone(); after.play(move);
            return { move, check: after.isCheck() };
        }).sort((a, b) => Number(b.check) - Number(a.check));
        for (const { move, check } of candidates) {
            const nominatedQuiet = !check && quiet > 0 && quietHints.has(makeUci(move));
            if (remaining > 2 && !check && !nominatedQuiet) { restricted = true; continue; }
            const after = nextContext(state, move);
            const win = defend(after, remaining - 1, quiet - Number(nominatedQuiet));
            if (win) return [makeSan(position, move), ...win];
        }
        return null;
    };
    const defend = (state: TacticalRepetitionContext, remaining: number, quiet: number): string[] | null => {
        const position = tacticalRepetitionPosition(state)!;
        if (position.isCheckmate()) return [];
        if (terminalDraw(state, position) || remaining <= 0 ||
            position.halfmoves >= 100 || tacticalRepetitionClaim(state, visit)) return null;
        let longest: string[] = [];
        for (const move of ordered(position)) {
            const next = nextContext(state, move), nextPosition = tacticalRepetitionPosition(next)!;
            // An announced fifty-move claim belongs to this defender, including
            // a non-checking move that reaches 100; mate takes precedence.
            if (nextPosition.halfmoves >= 100 && !nextPosition.isCheckmate()) return null;
            const win = attack(next, remaining, quiet);
            if (!win) return null;
            const branch = [makeSan(position, move), ...win];
            if (branch.length > longest.length) longest = branch;
        }
        return longest;
    };
    let result: HistoryAwareMateProof;
    try {
        const after = nextContext(context, rootMove);
        const win = defend(after, maxMoves - 1, 2);
        result = win ? Object.freeze({ status: "proven", maxMoves: (win.length + 2) / 2,
            visits, line: Object.freeze([makeSan(initial, rootMove), ...win]) })
            : Object.freeze({ status: restricted ? "unknown" : "unproven", visits });
    } catch {
        result = Object.freeze({ status: "unknown", visits: Math.min(visits, nodeLimit) });
    }
    cache.set(key, result);
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
    return result;
}

/** Recover a different safe distance without multiplying the search budget.
 * A failed mate-in-three certificate does not imply there is no mate-in-four.
 * Each attempt pays its actual visits from this single shared envelope. */
export function proveHistoryAwareMateWithinBudget(
    fen: string, line: readonly string[], history: TacticalGameHistory | null | undefined,
    firstDistance = 1,
): HistoryAwareMateProof {
    if (!Number.isSafeInteger(firstDistance) || firstDistance < 1 || firstDistance > 7)
        return Object.freeze({ status: "unknown", visits: 0 });
    let visits = 0;
    for (let distance = firstDistance; distance <= 7 && visits < NODE_LIMIT; distance++) {
        const proof = proveHistoryAwareMate(fen, line, history, distance, NODE_LIMIT - visits);
        visits += proof.visits;
        if (proof.status === "proven") return Object.freeze({ ...proof, visits });
    }
    return Object.freeze({ status: "unknown", visits });
}

/** Schema-defined mating outcome, not an evidence-text guess. */
export function dependsOnMatingProof(motif: TacticalMotifEvidence): boolean {
    return motif.outcome === "mate" || motif.value === 10000 ||
        /(?:^mate(?:In\d+|Threat)?$|Mate$)/.test(motif.id);
}

function hasRepeatedRoute(context: TacticalRepetitionContext, line: readonly string[]): boolean {
    if (context.hasRepeatedPositions) return true;
    let route: TacticalRepetitionContext | null = context;
    for (const move of line) {
        if (!route) break;
        route = advanceTacticalRepetitionContext(route, move);
        if (route?.hasRepeatedPositions) return true;
    }
    return false;
}

/** Additional positive gate for a played move's history-blind mate proof.
 * Failure is only unavailable retained-mate evidence, not proof of a draw. */
export function retainsHistoryAwareMate(
    fen: string, line: readonly string[], history: TacticalGameHistory | null | undefined,
): boolean {
    const context = readTacticalRepetitionContext(fen, history);
    if (!context) return true;
    if (context.endedAtPly !== undefined) return false;
    if (!hasRepeatedRoute(context, line)) return true;
    return proveHistoryAwareMateWithinBudget(fen, line, history).status === "proven";
}

/** Qualify the mating cluster, including supporting mechanisms and the
 * supplied continuation's distance/geometry. A new safe route proves generic
 * mate, not the named mechanisms of a different, repetition-defeated route.
 * Unrelated material certificates and drawing resources are untouched.
 */
export function qualifyHistoryAwareMatingMotifs(
    fen: string, line: readonly string[], history: TacticalGameHistory | null | undefined,
    motifs: TacticalMotifEvidence[],
): TacticalMotifEvidence[] {
    const context = readTacticalRepetitionContext(fen, history);
    if (!context || !motifs.some(dependsOnMatingProof)) return motifs;
    // With inherited counts <=1, an acyclic finite mating strategy never
    // permits a third occurrence. But this proves existence, not the geometry
    // of a supplied looping PV: cheaply replay it before taking that fast path.
    if (!hasRepeatedRoute(context, line) && !motifs.some(m => m.alternativeLine)) return motifs;
    const rootMates = motifs.filter(m => (m.ply ?? 1) === 1 && dependsOnMatingProof(m));
    const independent = motifs.filter(m => !dependsOnMatingProof(m));
    if (rootMates.length) return [
        ...qualifyMatingGroups(context, line, history!, rootMates), ...independent,
    ];
    return qualifyConditionalMates(context, line, history!, motifs);
}

function sameFen(first: string, second: string): boolean {
    return first.trim().split(/\s+/).join(" ") === second.trim().split(/\s+/).join(" ");
}

function qualifyMatingGroups(
    context: TacticalRepetitionContext, line: readonly string[], history: TacticalGameHistory,
    motifs: TacticalMotifEvidence[],
): TacticalMotifEvidence[] {
    const groups = new Map<string, { line: readonly string[]; motifs: TacticalMotifEvidence[] }>();
    for (const motif of motifs) {
        // Self-interference is a CONCESSION by the mover, not their attacking
        // certificate. Do not reverse its beneficiary into a generic mate.
        // Repetition-sensitive mating support is conservatively withheld;
        // independent material self-interference never enters this function.
        if (motif.id === "selfInterference") continue;
        // Alternative geometry on an unrelated board cannot borrow this
        // context. Later positions must arrive through exact legal replay.
        if (motif.alternativeLine && !sameFen(motif.alternativeLine.fen, context.fen)) continue;
        const candidate = motif.alternativeLine?.uci ?? line;
        if (!candidate[0] || (motif.moveUci && motif.moveUci !== candidate[0])) continue;
        const group = groups.get(candidate[0]) ?? { line: candidate, motifs: [] };
        group.motifs.push(motif);
        if (candidate.length > group.line.length) group.line = candidate;
        groups.set(candidate[0], group);
    }
    const result: TacticalMotifEvidence[] = [];
    for (const group of groups.values()) {
        const position = tacticalRepetitionPosition(context)!;
        const root = parseUci(group.line[0]);
        if (context.endedAtPly !== undefined || !root || !("from" in root) || !position.isLegal(root)) continue;
        const after = position.clone(); after.play(root);
        // Actual terminal geometry, or a zeroed history, needs no replacement
        // by a new forecast. This retains independently verified named mates.
        if (after.isCheckmate() || !hasRepeatedRoute(context, group.line)) {
            result.push(...group.motifs); continue;
        }
        const main = group.motifs.find(m => /^mateIn\d+$/.test(m.id)) ?? group.motifs[0];
        const distance = /^mateIn(\d+)$/.exec(main.id)?.[1];
        const proof = proveHistoryAwareMateWithinBudget(context.fen, group.line, history, distance ? Number(distance) : 1);
        if (proof.status !== "proven") continue;
        const certified: TacticalMotifEvidence = {
            ...main, id: `mateIn${proof.maxMoves}`, label: "Forcing Mate", confidence: "high",
            value: 10000, outcome: "mate", moveUci: group.line[0],
            evidence: `${proof.line[0]} starts a forced mating attack. Every legal defence permits mate within ${proof.maxMoves} moves without an available defender repetition claim in the supplied legal history; one verified line is ${proof.line.join(" ")}. The exact continuation depends on the defence.`,
        };
        delete certified.alternativeLine;
        delete certified.verifiedCombination;
        delete certified.comparison;
        delete certified.comparisonEvidence;
        delete certified.alternativeCapture;
        if (group.line[0] !== line[0]) {
            const board = position.clone(), uci: string[] = [];
            for (const san of proof.line) {
                const move = parseSan(board, san);
                if (!move) throw new Error("Invalid certified mating line");
                uci.push(makeUci(move)); board.play(move);
            }
            certified.alternativeLine = { fen: context.fen, uci, san: [...proof.line] };
        }
        result.push(certified);
    }
    return result;
}

function qualifyConditionalMates(
    context: TacticalRepetitionContext, line: readonly string[], history: TacticalGameHistory,
    motifs: TacticalMotifEvidence[],
): TacticalMotifEvidence[] {
    // Reprove each local event on its reached history. Inspecting only the PV
    // would miss another defensive branch's claim (and could miss a claim
    // created by the event move itself). Never move an event to the root.
    let state: TacticalRepetitionContext | null = context;
    const result = motifs.filter(m => !dependsOnMatingProof(m));
    for (let index = 0; index < line.length && state; index++) {
        const local = motifs.filter(m => m.ply === index + 1 && dependsOnMatingProof(m));
        if (local.length) result.push(...qualifyMatingGroups(state, line.slice(index),
            { fen: history.fen, moves: [...history.moves, ...line.slice(0, index)] }, local));
        state = advanceTacticalRepetitionContext(state, line[index]);
    }
    return result.sort((a, b) => (a.ply ?? 1) - (b.ply ?? 1));
}
