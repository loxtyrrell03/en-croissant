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

export function assessOpeningReviewMove(
    position: Position,
    playedMove: { san: string; uci: string },
    chessDbMoves?: ChessDbCloudMove[] | null,
): OpeningReviewMoveAssessment {
    const savedBestMoveSan = position.engine?.bestMoveSan || position.answer;
    const savedBestMoveUci = position.engine?.bestMoveUci || position.answerUci;

    if (isOpeningReviewEngineMove(position, playedMove)) {
        return {
            quality: "best",
            bestMoveSan: savedBestMoveSan,
            bestMoveUci: savedBestMoveUci ?? undefined,
            moveLossCp: 0,
        };
    }

    if (isOpeningReviewSavedMove(position, playedMove)) {
        return {
            quality: "correct",
            bestMoveSan: savedBestMoveSan,
            bestMoveUci: savedBestMoveUci ?? undefined,
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
    const played = scoredMoves.find(
        (entry) => entry.move.uci === playedMove.uci || entry.move.san === playedMove.san,
    );

    if (!chessDbBest || !played) {
        return {
            quality: "incorrect",
            bestMoveSan: savedBestMoveSan,
            bestMoveUci: savedBestMoveUci ?? undefined,
        };
    }

    const moveLossCp = Math.max(0, chessDbBest.scoreForSide - played.scoreForSide);
    const isChessDbBest =
        chessDbBest.move.uci === playedMove.uci || chessDbBest.move.san === playedMove.san;
    const quality = isChessDbBest
        ? "best"
        : moveLossCp <= OK_ALTERNATIVE_CP_LOSS
          ? "ok"
          : "incorrect";

    return {
        quality,
        bestMoveSan: chessDbBest.move.san || savedBestMoveSan,
        bestMoveUci: chessDbBest.move.uci || savedBestMoveUci || undefined,
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
    if (answerUci) return answerUci === playedMove.uci;

    return normalizeReviewSan(position.answer) === normalizeReviewSan(playedMove.san);
}

export function isOpeningReviewEngineMove(
    position: Position,
    playedMove: { san: string; uci: string },
) {
    const bestMoveUci = position.engine?.bestMoveUci;
    if (bestMoveUci) return bestMoveUci === playedMove.uci;

    const bestMoveSan = position.engine?.bestMoveSan;
    return Boolean(bestMoveSan && normalizeReviewSan(bestMoveSan) === normalizeReviewSan(playedMove.san));
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
        .replace(/\s*\$\d+$/g, "")
        .replace(/[!?]+$/g, "");
}

function getScoreForSide(move: ChessDbCloudMove, side: "white" | "black") {
    if (move.scoreCpForWhite === null) return null;
    return side === "black" ? -move.scoreCpForWhite : move.scoreCpForWhite;
}
