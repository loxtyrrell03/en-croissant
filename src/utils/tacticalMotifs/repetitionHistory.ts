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

type ReachedHistory = { position: Chess; counts: Map<string, number>; endedAtPly?: number };
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
            let endedAtPly: number | undefined;
            for (let index = 0; index < history.moves.length; index++) {
                const move = parseUci(history.moves[index]);
                if (!move || !("from" in move) || !position.isLegal(move)) throw new Error("Illegal history");
                position.play(move);
                const identity = tacticalRepetitionKey(position);
                const count = (counts.get(identity) ?? 0) + 1;
                counts.set(identity, count);
                if (count >= 5 && !position.isCheckmate()) endedAtPly ??= index + 1;
                // Continue geometric replay only to bind the supplied target.
                // Later moves never revive a game already ended by fivefold.
            }
            result = { position, counts, endedAtPly };
        } catch { /* A malformed/truncated line is not evidence about this board. */ }
        historyCache.set(key, result);
        if (historyCache.size > 8) historyCache.delete(historyCache.keys().next().value!);
    }
    try {
        const target = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
        return result && makeFen(result.position.toSetup()) === makeFen(target.toSetup()) ? result : null;
    } catch { return null; }
}

export type TacticalRepetitionBoundary =
    | { kind: "game-over"; endedAtPly: number }
    | { kind: "defender-draw"; reason: "current-threefold" | "announced-threefold" | "fivefold"; moveUci?: string };

/** Only positive, exact-history facts are returned. null means no established
 * boundary, not no repetition. The attacker's optional claim is not a defence;
 * checkmate ends the game before the opponent can claim. This checks the actual
 * root move only, not arbitrary PV tails or deeper proof-tree alternatives. */
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
