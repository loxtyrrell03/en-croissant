import { pawnAttacks } from "chessops/attacks";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import type { Color, Square } from "chessops/types";
import { makeSquare, opposite } from "chessops/util";
import { extractPawnStructureFeatures } from "../pawnStructureDetector";

export type PositionalBoardFacts = {
    white: SidePositionalFacts;
    black: SidePositionalFacts;
};

export type SidePositionalFacts = {
    isolatedPawns: string[];
    doubledPawnFiles: string[];
    passedPawns: string[];
    rooksOnOpenFiles: string[];
    rooksOnSemiOpenFiles: string[];
    bishopPair: boolean;
    /** Pawn-supported minor pieces with no opposing pawn on an adjacent file
     * which could advance to attack their square. Piece exchanges can still
     * remove them. These are structural facts, not safety or value judgements. */
    minorSquaresWithoutPawnChallengers: string[];
};

/** Extract concrete structure facts. A feature's presence alone is insufficient
 * to assign positional importance or claim that it caused an evaluation change. */
export function extractPositionalBoardFacts(fen: string): PositionalBoardFacts | null {
    const setup = parseFen(fen);
    if (setup.isErr) return null;
    const parsed = Chess.fromSetup(setup.value);
    const structure = extractPawnStructureFeatures(fen);
    if (parsed.isErr || !structure) return null;
    const position = parsed.value;
    const pawns = structure.pawns;
    const files = (color: Color) =>
        pawns.filter((pawn) => pawn.side === color).map((pawn) => pawn.file);
    function sideFacts(side: Color): SidePositionalFacts {
        const ownFiles = files(side),
            enemyFiles = files(opposite(side));
        const ownPawns = position.board.pawn.intersect(position.board[side]);
        const enemyPawns = position.board.pawn.intersect(position.board[opposite(side)]);
        const inFront = (origin: Square, target: Square, color: Color) =>
            color === "white"
                ? Math.floor(target / 8) > Math.floor(origin / 8)
                : Math.floor(target / 8) < Math.floor(origin / 8);
        const result: SidePositionalFacts = {
            isolatedPawns: [],
            doubledPawnFiles: [],
            passedPawns: [],
            rooksOnOpenFiles: [],
            rooksOnSemiOpenFiles: [],
            bishopPair: false,
            minorSquaresWithoutPawnChallengers: [],
        };
        result.doubledPawnFiles = [
            ...new Set(
                ownFiles.filter((file) => ownFiles.filter((other) => other === file).length > 1),
            ),
        ].sort();
        result.bishopPair =
            new Set(
                [...position.board.bishop.intersect(position.board[side])].map(
                    (square) => ((square % 8) + Math.floor(square / 8)) % 2,
                ),
            ).size === 2;
        for (const square of ownPawns) {
            if (![...ownPawns].some((other) => Math.abs((other % 8) - (square % 8)) === 1))
                result.isolatedPawns.push(makeSquare(square));
            if (
                ![...enemyPawns].some(
                    (other) =>
                        Math.abs((other % 8) - (square % 8)) <= 1 && inFront(square, other, side),
                )
            ) {
                result.passedPawns.push(makeSquare(square));
            }
        }
        for (const square of position.board.rook.intersect(position.board[side])) {
            const file = makeSquare(square)[0];
            if (ownFiles.some((own) => own === file)) continue;
            if (enemyFiles.some((enemy) => enemy === file))
                result.rooksOnSemiOpenFiles.push(makeSquare(square));
            else result.rooksOnOpenFiles.push(makeSquare(square));
        }
        const minors = position.board.bishop
            .union(position.board.knight)
            .intersect(position.board[side]);
        for (const square of minors) {
            const supported = [...ownPawns].some((pawn) => pawnAttacks(side, pawn).has(square));
            const challenge = [...enemyPawns].some(
                (pawn) =>
                    Math.abs((pawn % 8) - (square % 8)) === 1 &&
                    inFront(pawn, square, opposite(side)),
            );
            if (supported && !challenge)
                result.minorSquaresWithoutPawnChallengers.push(makeSquare(square));
        }
        return result;
    }
    return { white: sideFacts("white"), black: sideFacts("black") };
}
