import { makeUci, parseUci } from "chessops";
import { parseSan } from "chessops/san";
import type { Position } from "@/components/files/opening";
import type { ChessDbCloudMove } from "@/utils/chessdb/api";
import { positionFromFen } from "@/utils/chessops";

export type OpeningReviewMoveAssessment = {
    quality: "correct" | "best" | "ok" | "incorrect";
    bestMoveSan: string;
    bestMoveUci?: string;
    chessDbBestMoveSan?: string;
    chessDbBestMoveUci?: string;
    moveLossCp?: number;
    chessDbRank?: number | null;
};

const OK_ALTERNATIVE_CP_LOSS = 80;

export type ReviewPracticePositionEntry = {
    position: Position;
    index: number;
};

export function findReviewPracticePositionForBoard(
    positions: Position[],
    currentFen: string | undefined,
    practicePositionIndex: number | undefined,
): ReviewPracticePositionEntry | null {
    if (practicePositionIndex !== undefined) {
        const position = positions[practicePositionIndex];
        return position && sameReviewBoardPosition(position.fen, currentFen)
            ? { position, index: practicePositionIndex }
            : null;
    }

    const index = positions.findIndex((position) =>
        sameReviewBoardPosition(position.fen, currentFen),
    );
    return index === -1 ? null : { position: positions[index]!, index };
}

export function assessOpeningReviewMove(
    position: Position,
    playedMove: { san: string; uci: string },
    chessDbMoves?: ChessDbCloudMove[] | null,
): OpeningReviewMoveAssessment {
    const savedBestMove = getOpeningReviewBestMove(position);
    const hasSavedEngineBest = Boolean(
        position.engine?.bestMoveSan || position.engine?.bestMoveUci,
    );

    if (isOpeningReviewEngineMove(position, playedMove)) {
        return {
            quality: "best",
            bestMoveSan: savedBestMove.san,
            bestMoveUci: savedBestMove.uci,
            moveLossCp: 0,
        };
    }

    if (isOpeningReviewSavedMove(position, playedMove)) {
        return {
            quality: "correct",
            bestMoveSan: savedBestMove.san,
            bestMoveUci: savedBestMove.uci,
        };
    }

    const sideToMove = position.fen.split(" ")[1] === "b" ? "black" : "white";
    const scoredMoves = (chessDbMoves ?? [])
        .map((move) => ({
            move,
            scoreForSide: getScoreForSide(move, sideToMove),
        }))
        .filter(
            (entry): entry is { move: ChessDbCloudMove; scoreForSide: number } =>
                entry.scoreForSide !== null,
        )
        .sort(
            (a, b) =>
                b.scoreForSide - a.scoreForSide ||
                (a.move.rank ?? Number.MAX_SAFE_INTEGER) -
                    (b.move.rank ?? Number.MAX_SAFE_INTEGER) ||
                a.move.san.localeCompare(b.move.san),
        );

    const chessDbBest = scoredMoves[0];
    const played = scoredMoves.find((entry) =>
        reviewMovesMatch(entry.move.uci, entry.move.san, playedMove),
    );

    if (!chessDbBest || !played) {
        return {
            quality: "incorrect",
            bestMoveSan: savedBestMove.san,
            bestMoveUci: savedBestMove.uci,
        };
    }

    const moveLossCp = Math.max(0, chessDbBest.scoreForSide - played.scoreForSide);
    const isChessDbBest = reviewMovesMatch(chessDbBest.move.uci, chessDbBest.move.san, playedMove);
    const quality =
        !hasSavedEngineBest && isChessDbBest
            ? "best"
            : moveLossCp <= OK_ALTERNATIVE_CP_LOSS
              ? "ok"
              : "incorrect";

    return {
        quality,
        bestMoveSan: hasSavedEngineBest
            ? savedBestMove.san
            : chessDbBest.move.san || savedBestMove.san,
        bestMoveUci: hasSavedEngineBest
            ? savedBestMove.uci
            : chessDbBest.move.uci || savedBestMove.uci,
        chessDbBestMoveSan: chessDbBest.move.san,
        chessDbBestMoveUci: chessDbBest.move.uci,
        moveLossCp,
        chessDbRank: played.move.rank,
    };
}

export function isOpeningReviewSavedMove(
    position: Position,
    playedMove: { san: string; uci: string },
) {
    const answerUci = getOpeningReviewAnswerUci(position);
    if (answerUci === playedMove.uci) return true;

    return normalizeReviewSan(position.answer) === normalizeReviewSan(playedMove.san);
}

export function isOpeningReviewEngineMove(
    position: Position,
    playedMove: { san: string; uci: string },
) {
    const bestMoveUci = position.engine?.bestMoveUci;
    if (bestMoveUci === playedMove.uci) return true;

    const bestMoveSan = position.engine?.bestMoveSan;
    return Boolean(
        bestMoveSan && normalizeReviewSan(bestMoveSan) === normalizeReviewSan(playedMove.san),
    );
}

function getOpeningReviewBestMove(position: Position) {
    if (position.engine?.bestMoveSan || position.engine?.bestMoveUci) {
        return {
            san: position.engine.bestMoveSan || position.answer,
            uci: position.engine.bestMoveUci ?? undefined,
        };
    }

    return {
        san: position.answer,
        uci: position.answerUci,
    };
}

function reviewMovesMatch(
    moveUci: string | null | undefined,
    moveSan: string | null | undefined,
    playedMove: { san: string; uci: string },
) {
    if (moveUci && moveUci === playedMove.uci) return true;
    return Boolean(moveSan && normalizeReviewSan(moveSan) === normalizeReviewSan(playedMove.san));
}

function getOpeningReviewAnswerUci(position: Position) {
    if (position.answerUci) return position.answerUci;

    const [pos] = positionFromFen(position.fen);
    if (!pos) return null;

    const answer = normalizeReviewSan(position.answer);
    const sanMove = parseSan(pos, answer);
    if (sanMove && pos.isLegal(sanMove)) return makeUci(sanMove);

    const uciMove = parseUci(answer);
    if (uciMove && pos.isLegal(uciMove)) return makeUci(uciMove);

    return null;
}

function normalizeReviewSan(san: string) {
    return san
        .trim()
        .replace(/^0-0-0/, "O-O-O")
        .replace(/^0-0/, "O-O")
        .replace(/\s*\$\d+$/g, "")
        .replace(/[+#!?]+$/g, "");
}

function getScoreForSide(move: ChessDbCloudMove, side: "white" | "black") {
    if (move.scoreCpForWhite === null) return null;
    return side === "black" ? -move.scoreCpForWhite : move.scoreCpForWhite;
}

function sameReviewBoardPosition(a: string | undefined, b: string | undefined) {
    if (!a || !b) return false;
    return a.split(" ").slice(0, 4).join(" ") === b.split(" ").slice(0, 4).join(" ");
}
