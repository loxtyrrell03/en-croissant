import { Chess, castlingSide } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import type { Move, NormalMove, Role, Square } from "chessops/types";
import { kingCastlesTo, makeUci, parseUci, rookCastlesTo } from "chessops/util";

export type TacticalGameHistory = { fen: string; moves: string[] };
export const MAX_TACTICAL_HISTORY_PLIES = 1024;
const values: Record<Role, number> = {
    pawn: 100,
    knight: 320,
    bishop: 330,
    rook: 500,
    queen: 900,
    king: 0,
};
const originalCounts: Record<Role, number> = {
    pawn: 8,
    knight: 2,
    bishop: 2,
    rook: 2,
    queen: 1,
    king: 1,
};

type HistoryFrame = {
    before: Chess;
    locations: readonly number[];
    move: NormalMove;
    movedId: number;
    capture: number;
    promotionGain: number;
};
export type VerifiedTacticalHistory = {
    frames: readonly HistoryFrame[];
    position: Chess;
    locations: readonly number[];
};
const historyCache = new Map<string, VerifiedTacticalHistory | null>();

/** Preserve the complete supplied line. Never trim it into a seemingly complete
 * recent history: that can hide a gambit or sacrifice before the cutoff. */
export function tacticalGameHistory(
    fen: string,
    moves: readonly (string | null | undefined)[],
): TacticalGameHistory | undefined {
    if (
        typeof fen !== "string" ||
        !fen ||
        moves.length > MAX_TACTICAL_HISTORY_PLIES ||
        moves.some(
            (move) =>
                typeof move !== "string" ||
                !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move),
        )
    )
        return undefined;
    return { fen, moves: [...moves] as string[] };
}

type HistoryNode = { fen: string; move: Move | null; children: HistoryNode[] };
/** Follow the selected variation, not the main line or any future moves. */
export function tacticalHistoryAtPath(
    root: HistoryNode,
    path: readonly number[],
): TacticalGameHistory | undefined {
    if (path.length > MAX_TACTICAL_HISTORY_PLIES) return undefined;
    let node = root;
    const moves: string[] = [];
    for (const index of path) {
        if (!Number.isSafeInteger(index) || index < 0) return undefined;
        const child = node.children[index];
        if (!child?.move) return undefined;
        moves.push(makeUci(child.move));
        node = child;
    }
    return tacticalGameHistory(root.fen, moves);
}

export function appendTacticalHistory(
    history: TacticalGameHistory | null | undefined,
    move: string | null | undefined,
) {
    return history && move
        ? tacticalGameHistory(history.fen, [...history.moves, move])
        : undefined;
}

/** The origin must have every original man: with eight pawns and the original
 * piece counts per colour, no earlier capture/promotion debt can be hidden.
 * This also accepts complete-material Chess960/analysis starts. A shortened
 * history beginning after a gambit capture fails even if it replays perfectly.
 * Arbitrary reduced-material FEN origins remain unknown for this new rule. */
export function verifiedTacticalHistory(
    history: TacticalGameHistory | null | undefined,
    targetFen: string,
): VerifiedTacticalHistory | null {
    if (
        !history ||
        !Array.isArray(history.moves) ||
        !tacticalGameHistory(history.fen, history.moves)
    )
        return null;
    const key = JSON.stringify([history.fen, history.moves]);
    let result = historyCache.get(key);
    if (result === undefined) {
        result = null;
        try {
            let position = Chess.fromSetup(
                parseFen(history.fen).unwrap(),
            ).unwrap();
            if (
                ["white", "black"].every((color) =>
                    Object.entries(originalCounts).every(
                        ([role, count]) =>
                            position.board[color as "white" | "black"]
                                .intersect(position.board[role as Role])
                                .size() === count,
                    ),
                )
            ) {
                let locations = Array.from({ length: 64 }, (_, id) =>
                    position.board.has(id as Square) ? id : -1,
                );
                const frames: HistoryFrame[] = [];
                let legal = true;
                for (const uci of history.moves) {
                    const move = parseUci(uci);
                    if (!move || !("from" in move) || !position.isLegal(move)) {
                        legal = false;
                        break;
                    }
                    const piece = position.board.get(move.from)!;
                    const movedId = locations.indexOf(move.from);
                    if (movedId < 0) {
                        legal = false;
                        break;
                    }
                    const nextLocations = [...locations];
                    const castle = castlingSide(position, move);
                    let capture = 0;
                    if (castle) {
                        const rookFrom =
                            position.castles.rook[position.turn][castle];
                        if (rookFrom === undefined) {
                            legal = false;
                            break;
                        }
                        const rookId = locations.indexOf(rookFrom);
                        if (rookId < 0) {
                            legal = false;
                            break;
                        }
                        nextLocations[movedId] = kingCastlesTo(
                            position.turn,
                            castle,
                        );
                        nextLocations[rookId] = rookCastlesTo(
                            position.turn,
                            castle,
                        );
                    } else {
                        const captureSquare =
                            piece.role === "pawn" &&
                            move.to === position.epSquare
                                ? move.to + (position.turn === "white" ? -8 : 8)
                                : move.to;
                        const victim = position.board.get(
                            captureSquare as Square,
                        );
                        if (victim) {
                            const victimId = locations.indexOf(captureSquare);
                            if (victimId < 0 || victim.color === piece.color) {
                                legal = false;
                                break;
                            }
                            capture = values[victim.role];
                            nextLocations[victimId] = -1;
                        }
                        nextLocations[movedId] = move.to;
                    }
                    frames.push({
                        before: position,
                        locations,
                        move,
                        movedId,
                        capture,
                        promotionGain: move.promotion
                            ? values[move.promotion] - 100
                            : 0,
                    });
                    position = position.clone();
                    position.play(move);
                    locations = nextLocations;
                }
                if (legal) result = { frames, position, locations };
            }
        } catch {
            /* Malformed, incomplete or illegal context cannot admit a theme. */
        }
        historyCache.set(key, result);
        if (historyCache.size > 8)
            historyCache.delete(historyCache.keys().next().value!);
    }
    try {
        const target = Chess.fromSetup(parseFen(targetFen).unwrap()).unwrap();
        return result &&
            makeFen(result.position.toSetup()) === makeFen(target.toSetup())
            ? result
            : null;
    } catch {
        return null;
    }
}

/** Return recent exchange context for this exact capturer and pawn. The local
 * safety/profit proof remains the caller's responsibility; historical material
 * cannot certify a current capture or increase its value. */
export function persistentPawnExchangeContext(
    history: TacticalGameHistory | null | undefined,
    fen: string,
    move: NormalMove,
) {
    const verified = verifiedTacticalHistory(history, fen);
    if (!verified || !verified.position.isLegal(move)) return null;
    const side = verified.position.turn;
    const attacker = verified.position.board.get(move.from);
    const victim = verified.position.board.get(move.to);
    if (
        !attacker ||
        victim?.role !== "pawn" ||
        victim.color === side ||
        move.promotion
    )
        return null;
    const attackerId = verified.locations.indexOf(move.from),
        victimId = verified.locations.indexOf(move.to);
    if (attackerId < 0 || victimId < 0) return null;
    let boundary: number | null = null,
        victimCapture: number | null = null;
    for (let index = verified.frames.length - 1; index >= 0; index--) {
        const frame = verified.frames[index];
        if (
            victimCapture === null &&
            frame.movedId === victimId &&
            frame.capture
        )
            victimCapture = index;
        if (boundary !== null || frame.before.turn !== side) continue;
        const from = frame.locations[attackerId],
            to = frame.locations[victimId];
        if (from < 0 || to < 0) return null;
        if (
            frame.before.board.get(from as Square)?.role !== attacker.role ||
            !frame.before.isLegal({ from: from as Square, to: to as Square })
        )
            boundary = index;
    }
    let start =
        victimCapture === null
            ? (boundary ?? 0)
            : Math.min(boundary ?? 0, victimCapture);
    // A pawn's old capture may have completed an exchange rather than won a
    // piece. Include the contiguous same-square capture chain before the
    // boundary: Nxd4 exd4 must not leave a fictitious knight debt against a
    // later Qxd4. Unrelated earlier captures and quiet moves do not qualify.
    while (start > 0) {
        const current = verified.frames[start], previous = verified.frames[start - 1];
        if (!current.capture || !previous.capture ||
            current.move.to !== previous.move.to) break;
        start--;
    }
    const episode = verified.frames.slice(start);
    // An untouched pawn cannot be the receiver of an earlier piece sacrifice.
    // Keep pawn-for-pawn compensation, but neither unrelated piece gains nor
    // losses finance/erase this pawn opportunity. A completed same-square
    // piece exchange CAN settle its own pawn cost: Bxg4 Nxg4 must not leave a
    // fictitious pawn debt when the bishop was exchanged for that pawn.
    // Never borrow surplus beyond that chain's own pawn balance.
    let pawnBalance = 0;
    for (let index = 0; index < episode.length;) {
        const first = episode[index];
        let net = 0, pawns = 0;
        do {
            const frame = episode[index++];
            const sign = frame.before.turn === side ? 1 : -1;
            net += sign * (frame.capture + frame.promotionGain);
            if (frame.capture === values.pawn) pawns += sign * values.pawn;
        } while (first.capture && index < episode.length &&
            episode[index].capture && episode[index].move.to === first.move.to);
        pawnBalance += Math.sign(pawns) * Math.min(Math.abs(pawns), Math.max(0, Math.sign(pawns) * net));
    }
    // A pawn which has captured still needs the complete material ledger,
    // including any piece it took. Current capture safety is proved separately.
    const balance = victimCapture === null ? pawnBalance : episode
        .reduce(
            (sum, frame) =>
                sum +
                (frame.before.turn === side ? 1 : -1) *
                    (frame.capture + frame.promotionGain),
            0,
        );
    return { balance, pawnBalance, episodePlies: verified.frames.length - start };
}

/** A previously capturing pawn may create a different opportunity by advancing
 * onto a new square. Nominate that exact advance only across a capture-free,
 * check-free interval with the same unmoved attacker and victim. This is not
 * permission to discard history: the caller must prove the pawn was not
 * profitably capturable before the advance, and its current safety separately.
 * Pawn-for-pawn debts remain in persistentPawnExchangeContext.pawnBalance. */
export function advancedPawnOpportunityContext(
    history: TacticalGameHistory | null | undefined,
    fen: string,
    move: NormalMove,
) {
    const verified = verifiedTacticalHistory(history, fen);
    if (!verified || !verified.position.isLegal(move) || verified.position.isCheck() || move.promotion)
        return null;
    const victim = verified.position.board.get(move.to);
    if (victim?.role !== "pawn" || victim.color === verified.position.turn) return null;
    const victimId = verified.locations.indexOf(move.to);
    const attackerId = verified.locations.indexOf(move.from);
    if (victimId < 0 || attackerId < 0) return null;
    let advanceIndex = -1;
    for (let index = verified.frames.length - 1; index >= 0; index--) {
        const frame = verified.frames[index];
        if (frame.capture || frame.promotionGain || frame.before.isCheck() ||
            frame.locations[attackerId] !== move.from) return null;
        if (frame.movedId === victimId) {
            if (frame.move.to !== move.to) return null;
            advanceIndex = index;
            break;
        }
    }
    if (advanceIndex < 0) return null;
    // An untouched pawn already has its independent-pawn accounting route.
    // This fallback addresses a genuine older capture, not truncated history.
    if (!verified.frames.slice(0, advanceIndex).some(frame => frame.movedId === victimId && frame.capture))
        return null;
    const advance = verified.frames[advanceIndex];
    return { before: advance.before, originalSquare: advance.move.from,
        advanceUci: makeUci(advance.move), episodePlies: verified.frames.length - advanceIndex };
}

/** Account for every capture in the uninterrupted exchange ending at this
 * root. Earlier captures can settle part of the last loss, but a prior surplus
 * must never finance current profit. The caller still proves current safety. */
export function rootCaptureExchangeContext(
    history: TacticalGameHistory | null | undefined,
    fen: string,
    move: NormalMove,
    previousFen: string,
    previousMove: string,
) {
    const verified = verifiedTacticalHistory(history, fen);
    if (!verified || !verified.position.isLegal(move) || move.promotion ||
        !verified.position.board.get(move.to)) return null;
    const last = verified.frames.at(-1);
    if (!last || makeFen(last.before.toSetup()) !== previousFen ||
        makeUci(last.move) !== previousMove) return null;
    let start = verified.frames.length;
    while (start > 0) {
        const frame = verified.frames[start - 1];
        if (!frame.capture || frame.move.to !== move.to || frame.move.promotion ||
            !frame.before.board.get(frame.move.to)) break;
        start--;
    }
    const chain = verified.frames.slice(start);
    if (chain.length < 2 || chain.length % 2 !== 0) return null;
    const side = verified.position.turn;
    const balance = chain.reduce((sum, frame) =>
        sum + (frame.before.turn === side ? 1 : -1) * frame.capture, 0);
    if (balance > 0 || -balance >= last.capture) return null;
    return { moves: chain.map(frame => makeUci(frame.move)), debit: -balance };
}

/** Retain the exact-settlement contract for consumers that require zero debt. */
export function settledRootCaptureExchange(
    history: TacticalGameHistory | null | undefined,
    fen: string,
    move: NormalMove,
    previousFen: string,
    previousMove: string,
) {
    const context = rootCaptureExchangeContext(history, fen, move, previousFen, previousMove);
    return context?.debit === 0 ? context.moves : null;
}
