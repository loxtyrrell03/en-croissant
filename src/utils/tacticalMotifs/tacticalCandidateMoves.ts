import { Chess, castlingSide } from "chessops/chess";
import { attacks } from "chessops/attacks";
import { parseFen } from "chessops/fen";
import { kingCastlesTo, makeUci } from "chessops/util";
import type { NormalMove } from "chessops/types";
import { tacticalExchangeGain } from "./causalTactics";

const VALUE = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 1000 };
export type TacticalCandidateMove = { moveUci: string; priority: number };
export const MAX_TACTICAL_CANDIDATE_MOVES = 8;

/** Search nominations, NOT tactical evidence or recommended moves. Geometry
 * proposes a bounded set for a separate engine comparison; every admitted line
 * still needs the ordinary motif proofs. Do not display these as found themes. */
export function nominateTacticalCandidateMoves(
    fen: string,
    excludedMoves: readonly string[] = [],
): TacticalCandidateMove[] {
    const parsed = parseFen(fen).chain((setup) => Chess.fromSetup(setup));
    if (parsed.isErr || parsed.value.isEnd()) return [];
    const before = parsed.value;
    const side = before.turn;
    const enemy = side === "white" ? "black" : "white";
    const excluded = new Set(excludedMoves);
    const candidates: (TacticalCandidateMove & { order: number })[] = [];
    const guards = (pos: Chess, square: number) =>
        [...pos.board[enemy]].filter((from) =>
            attacks(pos.board.get(from)!, from, pos.board.occupied).has(square),
        ).length;
    const threatened = (pos: Chess, square: number) =>
        [...pos.board[side]].some((from) =>
            attacks(pos.board.get(from)!, from, pos.board.occupied).has(square),
        );
    const previousGuards = new Map(
        [...before.board[enemy]]
            .filter((to) => threatened(before, to))
            .map((to) => [to, guards(before, to)]),
    );
    for (const [from, destinations] of before.allDests())
        for (const to of destinations) {
            const piece = before.board.get(from)!;
            const promotions: readonly NormalMove["promotion"][] =
                piece.role === "pawn" && (to < 8 || to >= 56)
                    ? ["queen", "rook", "bishop", "knight"]
                    : [undefined];
            for (const [promotionIndex, promotion] of promotions.entries()) {
                const move: NormalMove = { from, to, ...(promotion ? { promotion } : {}) };
                const castle = castlingSide(before, move);
                const landing = castle ? {from, to: kingCastlesTo(side, castle)} : move;
                const moveUci = makeUci(castle && castlingSide(before, landing) === castle && before.isLegal(landing) ? landing : move);
                if (excluded.has(moveUci)) continue;
                const after = before.clone();
                after.play(move);
                let priority = 0;
                const victim = before.board.get(to);
                if (victim?.color === enemy) {
                    const gain = tacticalExchangeGain(before, move);
                    if (gain >= 90) priority += 10000 + gain;
                }
                const attacker = after.board.get(to);
                if (attacker?.color === side) {
                    const targets = [
                        ...attacks(attacker, to, after.board.occupied).intersect(
                            after.board[enemy],
                        ),
                    ];
                    const valuable = targets.filter(
                        (square) => after.board.get(square)!.role !== "pawn",
                    );
                    if (valuable.length >= 2)
                        priority +=
                            6000 +
                            valuable.reduce(
                                (sum, square) => sum + VALUE[after.board.get(square)!.role],
                                0,
                            );
                }
                for (const slider of after.board[side]) {
                    if (slider === to || slider === from) continue;
                    const p = after.board.get(slider)!;
                    if (
                        !["bishop", "rook", "queen"].includes(p.role) ||
                        before.board.get(slider)?.role !== p.role
                    )
                        continue;
                    const old = attacks(p, slider, before.board.occupied);
                    const revealed = attacks(p, slider, after.board.occupied)
                        .diff(old)
                        .intersect(after.board[enemy]);
                    for (const square of revealed) {
                        const target = after.board.get(square)!;
                        if (target.role !== "pawn") priority += 8000 + VALUE[target.role];
                    }
                }
                // A newly blocked guard is only a nomination. Pin legality and
                // profitable capture order are deliberately left to verification.
                for (const [square, count] of previousGuards) {
                    if (
                        count &&
                        after.board.get(square)?.color === enemy &&
                        threatened(after, square) &&
                        guards(after, square) < count
                    )
                        priority += 3000 + VALUE[after.board.get(square)!.role];
                }
                if (priority)
                    candidates.push({
                        moveUci,
                        priority,
                        order:
                            ((from ^ (side === "white" ? 0 : 56)) * 64 +
                                (to ^ (side === "white" ? 0 : 56))) *
                                4 +
                            promotionIndex,
                    });
            }
        }
    return candidates
        .sort((a, b) => b.priority - a.priority || a.order - b.order)
        .slice(0, MAX_TACTICAL_CANDIDATE_MOVES)
        .map(({ moveUci, priority }) => ({ moveUci, priority }));
}
