import type { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import type { NormalMove, Square } from "chessops/types";
import { makeSquare, parseUci, squareFile, squareRank } from "chessops/util";
import type { TacticalGameHistory } from "./gameHistory";
import { readTacticalRepetitionContext } from "./repetitionHistory";
import {
    tablebasePosition,
    verifiedTablebasePosition,
    type ExactOutcome,
    type TablebaseEvidence,
} from "./tablebaseEvidence";

export type DecisionEndgameTarget = {
    fen: string;
    playedMoveUci?: string;
    history?: TacticalGameHistory;
};
type Choice = { uci: string; san: string; move: NormalMove; outcome: ExactOutcome };
type ReplyCheck = { choice: Choice; after: Chess; fen: string };

function eligible(fen: string, history?: TacticalGameHistory) {
    const pos = tablebasePosition(fen);
    if (!pos || pos.isEnd() || pos.halfmoves >= 99) return null;
    if (history) {
        const reached = readTacticalRepetitionContext(fen, history);
        if (!reached || reached.hasRepeatedPositions || reached.endedAtPly !== undefined)
            return null;
    }
    return pos;
}

export function decisionEndgameFen(target: DecisionEndgameTarget): string | null {
    const pos = eligible(target.fen, target.history);
    return pos && makeFen(pos.toSetup());
}

function reached(pos: Chess, move: NormalMove) {
    const after = pos.clone();
    after.play(move);
    return after;
}

function quiet(pos: Chess, move: NormalMove) {
    return !move.promotion && !pos.board.get(move.to) && !reached(pos, move).isCheck();
}

function ray(move: NormalMove) {
    return [
        move.from,
        Math.sign(squareFile(move.to) - squareFile(move.from)),
        Math.sign(squareRank(move.to) - squareRank(move.from)),
    ].join("/");
}

function distance(a: Square, b: Square) {
    return Math.max(
        Math.abs(squareFile(a) - squareFile(b)),
        Math.abs(squareRank(a) - squareRank(b)),
    );
}

function takesUndefendedPiece(after: Chess, reply: NormalMove, square: Square) {
    if (reply.to !== square || reply.promotion || !after.isLegal(reply)) return false;
    const collected = reached(after, reply);
    return ![...collected.allDests().values()].some((squares) => squares.has(square));
}

function canTakeUndefendedPiece(pos: Chess, move: NormalMove) {
    const after = reached(pos, move);
    return [...after.allDests()].some(
        ([from, squares]) =>
            squares.has(move.to) && takesUndefendedPiece(after, { from, to: move.to }, move.to),
    );
}

function plan(target: DecisionEndgameTarget, evidence: TablebaseEvidence) {
    const pos = eligible(target.fen, target.history);
    if (!pos) return null;
    const fen = makeFen(pos.toSetup());
    const root = verifiedTablebasePosition(fen, evidence);
    if (!root) return null;
    const moves = root.moves.map(({ uci, outcome }): Choice => {
        const move = parseUci(uci) as NormalMove;
        return {
            uci,
            move,
            san: makeSan(pos, move),
            outcome: outcome === 0 ? 0 : (-outcome as ExactOutcome),
        };
    });
    const best = moves.filter(({ outcome }) => outcome === root.outcome);
    const actual = moves.find(({ uci }) => uci === target.playedMoveUci);
    const check = (choice: Choice): ReplyCheck | undefined => {
        const after = reached(pos, choice.move);
        const fen = makeFen(after.toSetup());
        return after.halfmoves < 99 && tablebasePosition(fen) ? { choice, after, fen } : undefined;
    };
    const played = actual && actual.outcome < root.outcome ? check(actual) : undefined;
    const first = best[0];
    const role = first && pos.board.get(first.move.from)?.role;
    let contrast: ReplyCheck | undefined;
    // Assess a defensive calculation at the root only when every best move
    // uses the same quiet slider route and a close lookalike drops that piece.
    if (
        root.outcome === 0 &&
        !pos.isCheck() &&
        first &&
        (role === "rook" || role === "bishop" || role === "queen") &&
        best.every(
            ({ move }) =>
                ray(move) === ray(first.move) &&
                quiet(pos, move) &&
                ![...reached(pos, move).allDests().values()].some((squares) =>
                    squares.has(move.to),
                ),
        )
    ) {
        const rival = moves
            .filter(
                ({ outcome, move }) =>
                    outcome === -1 &&
                    ray(move) === ray(first.move) &&
                    quiet(pos, move) &&
                    canTakeUndefendedPiece(pos, move),
            )
            .sort(
                (a, b) => distance(a.move.to, first.move.to) - distance(b.move.to, first.move.to),
            )[0];
        if (rival) contrast = check(rival);
    }
    return { pos, root, best, actual, played, contrast };
}

export function decisionEndgameReplyFens(
    target: DecisionEndgameTarget,
    evidence: TablebaseEvidence,
) {
    const checked = plan(target, evidence);
    return [
        ...new Set(
            [checked?.played?.fen, checked?.contrast?.fen].filter((fen) => fen !== undefined),
        ),
    ];
}

function assessReply(pos: Chess, checked: ReplyCheck, best: Choice[], evidence: TablebaseEvidence) {
    const record = verifiedTablebasePosition(checked.fen, evidence);
    if (!record || -record.outcome !== checked.choice.outcome) return undefined;
    const { choice, after } = checked;
    const role = pos.board.get(choice.move.from)?.role;
    const originalCapture = pos.board.get(choice.move.to)?.role;
    const acceptable = record.moves.filter(({ outcome }) => -outcome === record.outcome);
    for (const { uci } of acceptable) {
        const move = parseUci(uci) as NormalMove;
        const san = makeSan(after, move);
        const next = reached(after, move);
        if (next.isCheckmate()) return { san, cause: san + " is checkmate.", capturedMover: false };
        if (
            role &&
            role !== "king" &&
            role !== "pawn" &&
            !choice.move.promotion &&
            (!originalCapture || originalCapture === "pawn") &&
            takesUndefendedPiece(after, move, choice.move.to) &&
            best.some(({ move: safe }) => !canTakeUndefendedPiece(pos, safe))
        ) {
            return {
                san,
                cause: san + " takes the " + role + " without a recapture.",
                capturedMover: true,
            };
        }
        if (
            role === "king" &&
            move.to === choice.move.from &&
            after.board.get(move.from)?.role === "pawn" &&
            squareFile(move.from) === squareFile(move.to) &&
            squareRank(move.to) === (after.turn === "white" ? 6 : 1) &&
            next.isCheck() &&
            best.some(({ move: safe }) => !reached(pos, safe).isLegal(move))
        ) {
            return {
                san,
                cause:
                    choice.san +
                    " leaves " +
                    makeSquare(move.to) +
                    ", allowing the pawn to advance with " +
                    san +
                    ".",
                capturedMover: false,
            };
        }
    }
    return (
        acceptable[0] && {
            san: makeSan(after, parseUci(acceptable[0].uci)!),
            cause: undefined,
            capturedMover: false,
        }
    );
}

export function assessDecisionEndgame(target: DecisionEndgameTarget, evidence: TablebaseEvidence) {
    const checked = plan(target, evidence);
    if (!checked) return null;
    const { pos, root, best, actual, played, contrast } = checked;
    const actualReply = played && assessReply(pos, played, best, evidence);
    const contrastReply = contrast && assessReply(pos, contrast, best, evidence);
    const defensiveTactic =
        contrast && contrastReply?.capturedMover
            ? {
                  avoidingCapture:
                      "The drawing moves keep the piece beyond the immediate capture. " +
                      contrast.choice.san +
                      " allows " +
                      contrastReply.san +
                      ".",
                  safeMoves: best.map(({ uci }) => uci),
              }
            : undefined;
    return {
        bestOutcome: root.outcome,
        bestMoves: best.map(({ uci, san }) => ({ uci, san })),
        moveOutcomes: root.moves.map(({ uci, outcome }) => ({
            uci,
            outcome: outcome === 0 ? 0 : (-outcome as ExactOutcome),
        })),
        legalMoveCount: root.moves.length,
        defensiveTactic,
        played: actual && { san: actual.san, outcome: actual.outcome, reply: actualReply },
    };
}

export type DecisionEndgameAssessment = NonNullable<ReturnType<typeof assessDecisionEndgame>>;
