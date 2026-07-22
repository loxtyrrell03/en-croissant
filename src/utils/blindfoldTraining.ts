import { makeUci, parseUci, squareRank, type Move, type NormalMove } from "chessops";
import { makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { positionFromFen } from "@/utils/chessops";

const PROMOTION_ROLES = ["queen", "rook", "bishop", "knight"] as const;

export type BlindfoldLegalMove = {
    san: string;
    uci: string;
    fenAfter: string;
};

function normalizeCastleNotation(value: string) {
    return value.replaceAll("0", "O");
}

export function normalizeBlindfoldMoveInput(value: string) {
    return normalizeCastleNotation(value).trim().replace(/\s+/g, "").replace(/[!?]+/g, "");
}

function normalizeForLooseCompare(value: string) {
    return normalizeBlindfoldMoveInput(value).replace(/[+#]+$/g, "");
}

function isPromotionMove(fen: string, move: NormalMove) {
    const [pos] = positionFromFen(fen);
    if (!pos) return false;
    const piece = pos.board.get(move.from);
    if (piece?.role !== "pawn") return false;
    const targetRank = squareRank(move.to);
    return targetRank === 0 || targetRank === 7;
}

function moveAfterFen(fen: string, move: Move) {
    const [pos] = positionFromFen(fen);
    if (!pos) return null;
    pos.play(move);
    return makeFen(pos.toSetup());
}

export function getBlindfoldLegalMoves(fen: string): BlindfoldLegalMove[] {
    const [pos] = positionFromFen(fen);
    if (!pos) return [];

    const moves: BlindfoldLegalMove[] = [];

    for (const [from, destinations] of pos.allDests()) {
        for (const to of destinations) {
            const baseMove: NormalMove = { from, to };
            const variants: Move[] = isPromotionMove(fen, baseMove)
                ? PROMOTION_ROLES.map((promotion) => ({ ...baseMove, promotion }))
                : [baseMove];

            for (const move of variants) {
                const fenAfter = moveAfterFen(fen, move);
                if (!fenAfter) continue;
                moves.push({
                    san: makeSan(pos, move),
                    uci: makeUci(move),
                    fenAfter,
                });
            }
        }
    }

    return moves.sort((a, b) => a.san.localeCompare(b.san, undefined, { numeric: true }));
}

export function findBlindfoldMove(fen: string, input: string): BlindfoldLegalMove | null {
    const cleaned = normalizeBlindfoldMoveInput(input);
    if (!cleaned) return null;

    const legalMoves = getBlindfoldLegalMoves(fen);
    const [pos] = positionFromFen(fen);
    if (!pos) return null;

    const parsedSan = parseSan(pos, cleaned);
    const parsedUci = parseUci(cleaned);
    const parsedMove = parsedSan ?? parsedUci;
    if (parsedMove) {
        const parsedUciText = makeUci(parsedMove);
        const exact = legalMoves.find((move) => move.uci === parsedUciText);
        if (exact) return exact;
    }

    const looseInput = normalizeForLooseCompare(cleaned);
    return (
        legalMoves.find(
            (move) =>
                normalizeBlindfoldMoveInput(move.san) === cleaned ||
                normalizeForLooseCompare(move.san) === looseInput ||
                move.uci === cleaned,
        ) ?? null
    );
}

export function getBlindfoldMoveInputStatus(fen: string, input: string) {
    const cleaned = normalizeBlindfoldMoveInput(input);
    if (!cleaned) {
        return { kind: "empty" as const, move: null };
    }

    const move = findBlindfoldMove(fen, cleaned);
    return move ? { kind: "legal" as const, move } : { kind: "illegal" as const, move: null };
}
