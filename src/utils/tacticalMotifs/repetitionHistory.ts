import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import type { NormalMove } from "chessops/types";
import { makeUci, parseUci } from "chessops/util";
import { tacticalGameHistory, type TacticalGameHistory } from "./gameHistory";

/** Clocks are not repetition identity. toSetup keeps castling rights and
 * normalizes en passant to a LEGAL capture, including the pinned-pawn case. */
export function tacticalRepetitionKey(position: Chess): string {
    return makeFen(position.toSetup()).split(" ").slice(0, 4).join(" ");
}

type ReachedHistory = { position: Chess; counts: Map<string, number>; endedAtPly?: number;
    endedBy?: "fivefold" | "seventy-five-move"; completeSinceReset: boolean; ply: number };
const historyCache = new Map<string, ReachedHistory | null>();

/** A reduced-material origin can witness repetition without reconstructing
 * old capture debts. This deliberately does not relax verifiedTacticalHistory.
 * A supplied prefix proves occurrences, never the absence of earlier ones. */
function reachedHistory(history: TacticalGameHistory | null | undefined, fen: string): ReachedHistory | null {
    if (!history || !Array.isArray(history.moves) || !tacticalGameHistory(history.fen, history.moves)) return null;
    const key = JSON.stringify([history.fen, history.moves]);
    let result = historyCache.get(key);
    if (result === undefined) {
        result = null;
        try {
            const position = Chess.fromSetup(parseFen(history.fen).unwrap()).unwrap();
            const counts = new Map<string, number>([[tacticalRepetitionKey(position), 1]]);
            let endedAtPly: number | undefined = position.halfmoves >= 150 && !position.isCheckmate() ? 0 : undefined;
            let endedBy: ReachedHistory["endedBy"] = endedAtPly === 0 ? "seventy-five-move" : undefined;
            let completeSinceReset = position.halfmoves === 0;
            for (let index = 0; index < history.moves.length; index++) {
                const move = parseUci(history.moves[index]);
                if (!move || !("from" in move) || !position.isLegal(move)) throw new Error("Illegal history");
                position.play(move);
                if (position.halfmoves === 0) { counts.clear(); completeSinceReset = true; }
                const identity = tacticalRepetitionKey(position);
                const count = (counts.get(identity) ?? 0) + 1;
                counts.set(identity, count);
                if (endedAtPly === undefined && (count >= 5 || position.halfmoves >= 150) && !position.isCheckmate()) {
                    endedAtPly = index + 1;
                    endedBy = count >= 5 ? "fivefold" : "seventy-five-move";
                }
                // Continue geometric replay only to bind the supplied target.
                // Later moves never revive a game ended by fivefold or75 moves.
            }
            result = { position, counts, endedAtPly, endedBy, completeSinceReset, ply: history.moves.length };
        } catch { /* A malformed/truncated line is not evidence about this board. */ }
        historyCache.set(key, result);
        if (historyCache.size > 8) historyCache.delete(historyCache.keys().next().value!);
    }
    try {
        const target = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
        return result && makeFen(result.position.toSetup()) === makeFen(target.toSetup()) ? result : null;
    } catch { return null; }
}

/** Opaque immutable replay state. The board and occurrence map never escape;
 * a caller can advance it only by a legal move on this exact board. */
export type TacticalRepetitionContext = Readonly<{
    fen: string;
    completeSinceReset: boolean;
    hasRepeatedPositions: boolean;
    currentCount: number;
    endedAtPly?: number;
    endedBy?: "fivefold" | "seventy-five-move";
}>;
const contexts = new WeakMap<TacticalRepetitionContext, ReachedHistory>();
function contextFor(state: ReachedHistory): TacticalRepetitionContext {
    const context = Object.freeze({
        fen: makeFen(state.position.toSetup()), completeSinceReset: state.completeSinceReset,
        hasRepeatedPositions: [...state.counts.values()].some(count => count >= 2),
        currentCount: state.counts.get(tacticalRepetitionKey(state.position)) ?? 0,
        ...(state.endedAtPly === undefined ? {} : { endedAtPly: state.endedAtPly, endedBy: state.endedBy }),
    });
    contexts.set(context, state);
    return context;
}

export function readTacticalRepetitionContext(
    fen: string, history?: TacticalGameHistory | null,
): TacticalRepetitionContext | null {
    const state = reachedHistory(history, fen);
    return state ? contextFor(state) : null;
}

/** Returns a clone, never the context's private mutable board. */
export function tacticalRepetitionPosition(context: TacticalRepetitionContext): Chess | null {
    return contexts.get(context)?.position.clone() ?? null;
}

export function advanceTacticalRepetitionContext(
    context: TacticalRepetitionContext, uci: string,
): TacticalRepetitionContext | null {
    const state = contexts.get(context), move = parseUci(uci);
    if (!state || state.endedAtPly !== undefined || state.position.isEnd() ||
        !move || !("from" in move) || !state.position.isLegal(move)) return null;
    const position = state.position.clone(); position.play(move);
    const reset = position.halfmoves === 0;
    const counts = reset ? new Map<string, number>() : new Map(state.counts);
    const key = tacticalRepetitionKey(position), count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return contextFor({ position, counts, ply: state.ply + 1,
        completeSinceReset: reset || state.completeSinceReset,
        ...((count >= 5 || position.halfmoves >= 150) && !position.isCheckmate()
            ? { endedAtPly: state.ply + 1, endedBy: count >= 5 ? "fivefold" as const : "seventy-five-move" as const } : {}),
    });
}

/** Positive claims only. The caller decides which player is the defender.
 * visit accounts for each legal announced-move test in its search budget. */
export function tacticalRepetitionClaim(
    context: TacticalRepetitionContext, visit: () => void = () => {},
): "current-threefold" | "announced-threefold" | "fivefold" | "seventy-five-move" | null {
    const state = contexts.get(context);
    if (!state || state.position.isCheckmate()) return null;
    if (state.endedAtPly !== undefined) return state.endedBy ?? "fivefold";
    if (context.currentCount >= 3) return "current-threefold";
    if (!context.hasRepeatedPositions) return null;
    for (const [from, destinations] of state.position.allDests()) for (const to of destinations) {
        const promotions = state.position.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
            ? ["queen", "rook", "bishop", "knight"] as const : [undefined];
        for (const promotion of promotions) {
            const move: NormalMove = { from, to, ...(promotion ? { promotion } : {}) };
            if (!state.position.isLegal(move)) continue;
            visit();
            const next = state.position.clone(); next.play(move);
            if (next.halfmoves === 0 || next.isCheckmate()) continue;
            if ((state.counts.get(tacticalRepetitionKey(next)) ?? 0) >= 2) return "announced-threefold";
        }
    }
    return null;
}

export type TacticalRepetitionBoundary =
    | { kind: "game-over"; endedAtPly: number }
    | { kind: "defender-draw"; reason: "current-threefold" | "announced-threefold" | "fivefold"; moveUci?: string };

/** Only positive, exact-history facts are returned. null means no established
 * boundary, not no repetition. The attacker's optional claim is not a defence;
 * checkmate ends the game before the opponent can claim. This checks the actual
 * root move only; historyAwareMate qualifies deeper mating alternatives. */
export function tacticalRepetitionBoundary(
    fen: string, rootMove: string | null | undefined, history?: TacticalGameHistory | null,
): TacticalRepetitionBoundary | null {
    const reached = reachedHistory(history, fen);
    if (!reached) return null;
    if (reached.endedAtPly !== undefined) return { kind: "game-over", endedAtPly: reached.endedAtPly };
    const move = rootMove && parseUci(rootMove);
    if (!move || !("from" in move) || !reached.position.isLegal(move)) return null;
    const after = reached.position.clone(); after.play(move);
    if (after.isCheckmate()) return null;
    const identity = tacticalRepetitionKey(after);
    const count = (reached.counts.get(identity) ?? 0) + 1;
    if (count >= 5) return { kind: "defender-draw", reason: "fivefold" };
    if (count >= 3) return { kind: "defender-draw", reason: "current-threefold" };
    if (after.isEnd()) return null;
    for (const [from, destinations] of after.allDests()) for (const to of destinations) {
        const promotions = after.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
            ? ["queen", "rook", "bishop", "knight"] as const : [undefined];
        for (const promotion of promotions) {
            const reply: NormalMove = { from, to, ...(promotion ? { promotion } : {}) };
            if (!after.isLegal(reply)) continue;
            const next = after.clone(); next.play(reply);
            if (next.isCheckmate()) continue;
            const nextIdentity = tacticalRepetitionKey(next);
            const prior = (reached.counts.get(nextIdentity) ?? 0) + (nextIdentity === identity ? 1 : 0);
            if (prior >= 2) return { kind: "defender-draw", reason: "announced-threefold", moveUci: makeUci(reply) };
        }
    }
    return null;
}
