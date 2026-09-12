import type { Chess } from "chessops/chess";
import type { Color } from "chessops/types";

// Exact finite K+P versus K reachability, with colour/file symmetry. This is
// generated locally once, not an engine-score threshold or a downloaded table.
// Retrograde method reference: official-stockfish/Stockfish sf_15 bitbase.cpp.
// The move graph and queue implementation below are independent of that code.
export const KPK_STATES = 24 * 64 * 64 * 2;
const kingMoves = Array.from({ length: 64 }, (_, square) =>
    Array.from({ length: 64 }, (_, target) => target).filter(
        (target) => target !== square && kingDistance(square, target) === 1,
    ),
);
function kingDistance(a: number, b: number) {
    return Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 3) - (b >> 3)));
}
function pawnAttacks(pawn: number, target: number) {
    return target >> 3 === (pawn >> 3) + 1 && Math.abs((target & 7) - (pawn & 7)) === 1;
}
export type KpkState = { pawn: number; ownKing: number; enemyKing: number; pawnTurn: boolean };
export function kpkIndex({ pawn, ownKing, enemyKing, pawnTurn }: KpkState) {
    return (
        ((((pawn >> 3) - 1) * 4 + (pawn & 7)) * 2 + (pawnTurn ? 0 : 1)) * 4096 +
        ownKing * 64 +
        enemyKing
    );
}
export function kpkState(index: number): KpkState {
    const group = index >> 13;
    return {
        pawn: (Math.floor(group / 4) + 1) * 8 + (group % 4),
        ownKing: (index >> 6) & 63,
        enemyKing: index & 63,
        pawnTurn: ((index >> 12) & 1) === 0,
    };
}
export function validKpk(state: KpkState) {
    return (
        state.pawn !== state.ownKing &&
        state.pawn !== state.enemyKing &&
        kingDistance(state.ownKing, state.enemyKing) > 1 &&
        (!state.pawnTurn || !pawnAttacks(state.pawn, state.enemyKing))
    );
}
function sliderAttacks(from: number, to: number, king: number, queen: boolean) {
    const dx = (to & 7) - (from & 7),
        dy = (to >> 3) - (from >> 3);
    if (!(dx === 0 || dy === 0 || (queen && Math.abs(dx) === Math.abs(dy)))) return false;
    const step = Math.sign(dx) + Math.sign(dy) * 8;
    for (let square = from + step; square !== to; square += step) if (square === king) return false;
    return true;
}
/** KQK/KRK is won unless the king can immediately take the new piece or the
 * promotion stalemates. Try both: a queen alone can wrongly reject rook wins. */
export function winningKpkPromotion(state: KpkState) {
    const target = state.pawn + 8;
    if (target === state.ownKing || target === state.enemyKing) return false;
    if (kingDistance(target, state.enemyKing) === 1 && kingDistance(target, state.ownKing) > 1)
        return false;
    return [true, false].some(
        (queen) =>
            sliderAttacks(target, state.enemyKing, state.ownKing, queen) ||
            kingMoves[state.enemyKing].some(
                (square) =>
                    kingDistance(square, state.ownKing) > 1 &&
                    square !== target &&
                    !sliderAttacks(target, square, state.ownKing, queen),
            ),
    );
}
export type KpkTransition = { to: number | "promotion" | "draw"; from: number; target: number };
export function kpkTransitions(state: KpkState): KpkTransition[] {
    const result: KpkTransition[] = [];
    if (!validKpk(state)) return result;
    if (state.pawnTurn) {
        for (const square of kingMoves[state.ownKing])
            if (square !== state.pawn && kingDistance(square, state.enemyKing) > 1)
                result.push({
                    from: state.ownKing,
                    target: square,
                    to: kpkIndex({ ...state, ownKing: square, pawnTurn: false }),
                });
        const target = state.pawn + 8;
        if (target !== state.ownKing && target !== state.enemyKing) {
            result.push({
                from: state.pawn,
                target,
                to:
                    state.pawn >= 48
                        ? winningKpkPromotion(state)
                            ? "promotion"
                            : "draw"
                        : kpkIndex({ ...state, pawn: target, pawnTurn: false }),
            });
            if (state.pawn < 16 && target + 8 !== state.ownKing && target + 8 !== state.enemyKing)
                result.push({
                    from: state.pawn,
                    target: target + 8,
                    to: kpkIndex({ ...state, pawn: target + 8, pawnTurn: false }),
                });
        }
    } else {
        for (const square of kingMoves[state.enemyKing])
            if (kingDistance(square, state.ownKing) > 1 && !pawnAttacks(state.pawn, square))
                result.push({
                    from: state.enemyKing,
                    target: square,
                    to:
                        square === state.pawn
                            ? "draw"
                            : kpkIndex({ ...state, enemyKing: square, pawnTurn: true }),
                });
    }
    return result;
}

export function buildKpkBitbase() {
    // A positive rank is a finite promotion proof. Zero is the residual drawn
    // region: the defending king can stay in it, capture the pawn, or stalemate.
    const ranks = new Uint8Array(KPK_STATES);
    const valid = new Uint8Array(KPK_STATES);
    const replies = new Uint8Array(KPK_STATES);
    const longest = new Uint8Array(KPK_STATES);
    const heads = new Int32Array(KPK_STATES).fill(-1);
    const parents = new Uint32Array(KPK_STATES * 10);
    const links = new Int32Array(KPK_STATES * 10);
    const queue = new Uint32Array(KPK_STATES);
    let edges = 0,
        tail = 0;
    for (let index = 0; index < KPK_STATES; index++) {
        const state = kpkState(index);
        if (!validKpk(state)) continue;
        valid[index] = 1;
        const moves = kpkTransitions(state);
        replies[index] = moves.length;
        for (const move of moves) {
            if (move.to === "promotion") {
                ranks[index] = 1;
                queue[tail++] = index;
            } else if (typeof move.to === "number") {
                if (edges >= parents.length) throw new Error("KPK graph capacity exceeded");
                parents[edges] = index;
                links[edges] = heads[move.to];
                heads[move.to] = edges++;
            }
        }
    }
    for (let cursor = 0; cursor < tail; cursor++) {
        const child = queue[cursor];
        for (let edge = heads[child]; edge !== -1; edge = links[edge]) {
            const parent = parents[edge];
            if (ranks[parent]) continue;
            const pawnTurn = ((parent >> 12) & 1) === 0;
            longest[parent] = Math.max(longest[parent], ranks[child]);
            if (pawnTurn || --replies[parent] === 0) {
                const rank = longest[parent] + 1;
                if (rank >= 255) throw new Error("KPK proof rank overflow");
                ranks[parent] = rank;
                queue[tail++] = parent;
            }
        }
    }
    return { ranks, valid, winningStates: tail, edges };
}

let table: ReturnType<typeof buildKpkBitbase> | undefined;
export function probeKingPawnEndgame(
    position: Chess,
): { pawnSide: Color; win: boolean; promotionPlies: number } | null {
    if (
        position.board.occupied.size() !== 3 ||
        position.board.pawn.size() !== 1 ||
        position.board.king.size() !== 2 ||
        position.epSquare !== undefined
    )
        return null;
    let pawn = position.board.pawn.first()!;
    const pawnSide = position.board.get(pawn)!.color;
    let ownKing = position.board.kingOf(pawnSide)!;
    let enemyKing = position.board.kingOf(pawnSide === "white" ? "black" : "white")!;
    if (pawnSide === "black") {
        pawn ^= 56;
        ownKing ^= 56;
        enemyKing ^= 56;
    }
    if ((pawn & 7) > 3) {
        pawn ^= 7;
        ownKing ^= 7;
        enemyKing ^= 7;
    }
    const state = { pawn, ownKing, enemyKing, pawnTurn: position.turn === pawnSide };
    if (pawn < 8 || pawn >= 56 || !validKpk(state)) return null;
    table ??= buildKpkBitbase();
    const promotionPlies = table.ranks[kpkIndex(state)];
    // The distance is to conversion, not mate. Ignoring earlier pawn resets is
    // conservative: do not certify a win if the 50-move claim could arrive first.
    if (promotionPlies && position.halfmoves + promotionPlies >= 100) return null;
    return { pawnSide, win: promotionPlies > 0, promotionPlies };
}

export function proveKpkZugzwang(position: Chess) {
    const actual = probeKingPawnEndgame(position);
    if (!actual?.win || position.turn === actual.pawnSide || position.isCheck() || position.isEnd())
        return null;
    const passed = position.clone();
    passed.turn = actual.pawnSide;
    const waiting = probeKingPawnEndgame(passed);
    if (!waiting || waiting.win) return null;
    const replies = [...position.allDests()].flatMap(([from, targets]) =>
        [...targets].map((to) => ({ from, to })),
    );
    if (
        !replies.length ||
        replies.some((move) => {
            const after = position.clone();
            after.play(move);
            const result = probeKingPawnEndgame(after);
            return !result?.win || result.pawnSide !== actual.pawnSide;
        })
    )
        return null;
    return {
        pawnSide: actual.pawnSide,
        defender: position.turn,
        replies,
        promotionPlies: actual.promotionPlies,
    };
}
