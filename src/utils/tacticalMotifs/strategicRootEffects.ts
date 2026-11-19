import { attacks, pawnAttacks } from "chessops/attacks";
import type { Chess } from "chessops/chess";
import { SquareSet } from "chessops/squareSet";
import type { Color, Square } from "chessops/types";
import { makeSquare, opposite } from "chessops/util";
import { replayTacticalLine } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";

export type StrategicRootEffect = {
    feature:
        | "pawn-space"
        | "piece-reach"
        | "piece-restriction"
        | "pawn-lock"
        | "bishop-pair-removal";
    side: Color;
    squareOrFile: string;
    description: string;
    firstPly: number;
    lastConsecutivePly: number;
    support: "board-fact";
    /** Exact observed units; these are not engine score contributions. */
    before: number;
    after: number;
    unit: "squares" | "relative-rank" | "locked-pawn-pairs" | "bishop-colours";
};

/** Geometric reach excludes friendly occupancy and opposing pawn attacks.
 * It deliberately is NOT called legal or safe mobility: pins, other attackers,
 * king exposure and tactical replies can still prohibit these destinations. */
export function pawnUnattackedReach(position: Chess, square: Square): SquareSet {
    const piece = position.board.get(square);
    if (!piece || piece.role === "pawn" || piece.role === "king") return SquareSet.empty();
    let enemyPawnAttacks = SquareSet.empty();
    for (const pawn of position.board.pawn.intersect(position.board[opposite(piece.color)]))
        enemyPawnAttacks = enemyPawnAttacks.union(pawnAttacks(opposite(piece.color), pawn));
    return attacks(piece, square, position.board.occupied)
        .diff(position.board[piece.color])
        .diff(enemyPawnAttacks);
}

/** Track only effects created on the first move. Following the actual piece
 * through the legal continuation prevents an unrelated later improvement from
 * being attributed to the original decision. No strategic value is assigned. */
export function extractStrategicRootEffects(
    fen: string,
    line: DecisionEngineLine,
): StrategicRootEffect[] {
    if (!measureDecisionLine(fen, line)) return [];
    const steps = replayTacticalLine(fen, line.pvUci);
    const root = steps[0];
    const side = root.before.turn;
    const piece = root.before.board.get(root.move.from)!;
    const result: StrategicRootEffect[] = [];
    const rank = (sq: Square, color: Color) =>
        color === "white" ? 1 + Math.floor(sq / 8) : 8 - Math.floor(sq / 8);
    // Piece identity, including loss and promotion, is followed through moves.
    const lasting = (
        initialSquare: Square,
        predicate: (position: Chess, square: Square) => boolean,
    ) => {
        const initialPiece = root.after.board.get(initialSquare);
        if (!initialPiece) return 0;
        let square = initialSquare,
            last = 0;
        for (const [index, step] of steps.entries()) {
            if (index > 0) {
                if (step.capture && step.move.to === square) break;
                if (step.move.from === square) {
                    if (step.move.promotion) break;
                    square = step.move.to;
                }
            }
            const current = step.after.board.get(square);
            if (
                current?.color !== initialPiece.color ||
                current.role !== initialPiece.role ||
                !predicate(step.after, square)
            )
                break;
            last = index + 1;
        }
        return last;
    };
    const add = (item: Omit<StrategicRootEffect, "firstPly" | "support">) => {
        if (item.lastConsecutivePly >= 6)
            result.push({ ...item, firstPly: 1, support: "board-fact" });
    };
    const name = side === "white" ? "White" : "Black";
    // Space is a middlegame interpretation. A lone advanced racing pawn is not
    // evidence for this feature, and promotions are handled elsewhere.
    const nonPawnPieces = root.before.board.occupied
        .diff(root.before.board.pawn)
        .diff(root.before.board.king)
        .size();
    if (
        piece.role === "pawn" &&
        root.capture === 0 &&
        rank(root.move.to, side) >= 4 &&
        nonPawnPieces >= 4
    ) {
        add({
            feature: "pawn-space",
            side,
            squareOrFile: makeSquare(root.move.to),
            description: `${name}'s pawn advances from ${makeSquare(root.move.from)} to ${makeSquare(root.move.to)} and remains at least this far advanced in the recorded continuation.`,
            before: rank(root.move.from, side),
            after: rank(root.move.to, side),
            unit: "relative-rank",
            lastConsecutivePly: lasting(
                root.move.to,
                (_, square) => rank(square, side) >= rank(root.move.to, side),
            ),
        });
        const ahead = root.move.to + (side === "white" ? 8 : -8);
        const blocker = root.after.board.get(ahead);
        if (blocker?.role === "pawn" && blocker.color !== side) {
            add({
                feature: "pawn-lock",
                side,
                squareOrFile: makeSquare(root.move.to)[0],
                description: `${root.san} fixes opposing pawns face to face on ${makeSquare(root.move.to)} and ${makeSquare(ahead)}; neither can advance while this lock remains.`,
                before: 0,
                after: 1,
                unit: "locked-pawn-pairs",
                lastConsecutivePly: lasting(root.move.to, (position, square) => {
                    const enemy = position.board.get(square + (side === "white" ? 8 : -8));
                    return enemy?.role === "pawn" && enemy.color !== side;
                }),
            });
        }
    }
    for (const square of root.after.board.occupied
        .diff(root.after.board.pawn)
        .diff(root.after.board.king)) {
        const current = root.after.board.get(square)!;
        const origin = square === root.move.to ? root.move.from : square;
        const previous = root.before.board.get(origin);
        if (!previous || previous.role !== current.role || previous.color !== current.color)
            continue;
        const before = pawnUnattackedReach(root.before, origin).size();
        const after = pawnUnattackedReach(root.after, square).size();
        const own = current.color === side;
        // A directly observable, substantial reach change, not a central-square
        // bonus or a generic annotation for every developed piece.
        if (own ? after - before < 4 : before - after < 4) continue;
        add({
            feature: own ? "piece-reach" : "piece-restriction",
            side: current.color,
            squareOrFile: makeSquare(square),
            before,
            after,
            unit: "squares",
            description: `${root.san} changes the ${current.color} ${current.role}'s reachable squares outside opposing pawn attacks from ${before} to ${after} (${makeSquare(origin)}${origin === square ? "" : `–${makeSquare(square)}`}). Other pieces and pins can still make these squares unsafe.`,
            lastConsecutivePly: lasting(square, (position, tracked) => {
                const reach = pawnUnattackedReach(position, tracked).size();
                return own ? reach >= before + 4 : reach <= before - 4;
            }),
        });
    }
    const bishopColours = (position: Chess, color: Color) =>
        new Set(
            [...position.board.bishop.intersect(position.board[color])].map(
                (square) => ((square % 8) + Math.floor(square / 8)) % 2,
            ),
        ).size;
    // A root piece may prepare its exchange for a bishop. Trace that piece and
    // the actual exchange; a bishop disappearing elsewhere is not its effect.
    if (bishopColours(root.before, opposite(side)) === 2) {
        let tracked = root.move.from;
        for (let i = 0; i < Math.min(steps.length, 5); i++) {
            const step = steps[i];
            if (step.before.turn !== side) {
                if (step.capture && step.move.to === tracked) break;
                continue;
            }
            if (step.move.from !== tracked) continue;
            tracked = step.move.to;
            if (step.before.board.get(step.move.to)?.role !== "bishop") continue;
            if (bishopColours(step.after, opposite(side)) !== 1) break;
            let last = i + 1;
            for (
                let k = i + 1;
                k < steps.length && bishopColours(steps[k].after, opposite(side)) < 2;
                k++
            )
                last = k + 1;
            if (last - i >= 6)
                result.push({
                    feature: "bishop-pair-removal",
                    side: opposite(side),
                    squareOrFile: "both colours",
                    description: `${root.san}${i ? ` leads to ${step.san} by the same piece` : ""}, removing the opponent's bishop pair. The opponent no longer has bishops on both colour complexes in the recorded continuation.`,
                    firstPly: i + 1,
                    lastConsecutivePly: last,
                    support: "board-fact",
                    before: 2,
                    after: 1,
                    unit: "bishop-colours",
                });
            break;
        }
    }
    return result;
}
