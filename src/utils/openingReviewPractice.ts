import { makeUci, parseUci } from "chessops";
import { parseSan } from "chessops/san";
import type { Position } from "@/components/files/opening";
import type { ChessDbCloudMove } from "@/utils/chessdb/api";
import { positionFromFen } from "@/utils/chessops";
import type { LichessCloudMove } from "@/utils/lichess/api";
import {
    classifyMistakeReviewAttempt,
    isMistakeReviewPassingLabel,
    type MistakeReviewAttemptLabel,
} from "@/utils/mistakeReview";

export type OpeningReviewMoveAssessmentSource = "lichess" | "chessdb" | "engine" | "saved";

export type OpeningReviewMoveAssessment = {
    quality: "correct" | "best" | "ok" | "incorrect";
    label: MistakeReviewAttemptLabel;
    passed: boolean;
    bestMoveSan: string;
    bestMoveUci?: string;
    bestMoveSource: OpeningReviewMoveAssessmentSource;
    chessDbBestMoveSan?: string;
    chessDbBestMoveUci?: string;
    moveLossCp?: number;
    chessDbRank?: number | null;
};

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
    lichessMoves?: LichessCloudMove[] | null,
): OpeningReviewMoveAssessment {
    const lichessAssessment = assessLichessCloudMove(position, playedMove, lichessMoves);
    if (lichessAssessment) return lichessAssessment;

    const savedLichessBestMove = getSavedLichessBestMove(position);
    if (
        savedLichessBestMove &&
        reviewMovesMatch(savedLichessBestMove.uci, savedLichessBestMove.san, playedMove)
    ) {
        return {
            quality: "best",
            label: "best",
            passed: true,
            bestMoveSan: savedLichessBestMove.san,
            bestMoveUci: savedLichessBestMove.uci,
            bestMoveSource: "lichess",
            moveLossCp: 0,
        };
    }

    const chessDbAssessment = assessChessDbMove(
        position,
        playedMove,
        chessDbMoves,
        savedLichessBestMove,
    );
    if (chessDbAssessment) return chessDbAssessment;

    const savedBestMove = getOpeningReviewBestMove(position);

    if (isOpeningReviewEngineMove(position, playedMove)) {
        return {
            quality: "best",
            label: "best",
            passed: true,
            bestMoveSan: savedBestMove.san,
            bestMoveUci: savedBestMove.uci,
            bestMoveSource: getSavedBestMoveSource(position),
            moveLossCp: 0,
        };
    }

    if (isOpeningReviewSavedMove(position, playedMove)) {
        return {
            quality: "correct",
            label: "best",
            passed: true,
            bestMoveSan: savedBestMove.san,
            bestMoveUci: savedBestMove.uci,
            bestMoveSource: getSavedBestMoveSource(position),
        };
    }

    return {
        quality: "incorrect",
        label: "mistake",
        passed: false,
        bestMoveSan: savedBestMove.san,
        bestMoveUci: savedBestMove.uci,
        bestMoveSource: getSavedBestMoveSource(position),
    };
}

export function formatOpeningReviewMoveSource(
    source: OpeningReviewMoveAssessmentSource | undefined,
) {
    switch (source) {
        case "lichess":
            return "Lichess Cloud";
        case "chessdb":
            return "ChessDB";
        case "engine":
            return "Engine";
        case "saved":
            return "Saved answer";
        default:
            return "Engine";
    }
}

function assessLichessCloudMove(
    position: Position,
    playedMove: { san: string; uci: string },
    lichessMoves?: LichessCloudMove[] | null,
): OpeningReviewMoveAssessment | null {
    if (!lichessMoves?.length) return null;

    const sideToMove = position.fen.split(" ")[1] === "b" ? "black" : "white";
    const scoredMoves = lichessMoves
        .map((move, index) => ({
            move,
            rank: index + 1,
            scoreForSide: getScoreForSide(move, sideToMove),
        }))
        .filter(
            (entry): entry is { move: LichessCloudMove; rank: number; scoreForSide: number } =>
                entry.scoreForSide !== null,
        )
        .sort(
            (a, b) =>
                b.scoreForSide - a.scoreForSide ||
                a.rank - b.rank ||
                a.move.san.localeCompare(b.move.san),
        );

    const best = scoredMoves[0];
    if (!best) return null;

    const played = scoredMoves.find((entry) =>
        reviewMovesMatch(entry.move.uci, entry.move.san, playedMove),
    );

    if (!played) {
        return {
            quality: "incorrect",
            label: "mistake",
            passed: false,
            bestMoveSan: best.move.san,
            bestMoveUci: best.move.uci,
            bestMoveSource: "lichess",
        };
    }

    const moveLossCp = Math.max(0, best.scoreForSide - played.scoreForSide);
    const exactBest = played.rank === best.rank;
    const label = classifyOpeningReviewAttempt(moveLossCp, exactBest);

    return {
        quality: openingReviewQualityFromLabel(label),
        label,
        passed: isMistakeReviewPassingLabel(label),
        bestMoveSan: best.move.san,
        bestMoveUci: best.move.uci,
        bestMoveSource: "lichess",
        moveLossCp,
    };
}

function assessChessDbMove(
    position: Position,
    playedMove: { san: string; uci: string },
    chessDbMoves?: ChessDbCloudMove[] | null,
    authoritativeBestMove?: { san: string; uci?: string } | null,
): OpeningReviewMoveAssessment | null {
    if (!chessDbMoves?.length) return null;

    const savedBestMove = getOpeningReviewBestMove(position);
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
            label: "mistake",
            passed: false,
            bestMoveSan: authoritativeBestMove?.san ?? savedBestMove.san,
            bestMoveUci: authoritativeBestMove?.uci ?? savedBestMove.uci,
            bestMoveSource: authoritativeBestMove ? "lichess" : getSavedBestMoveSource(position),
        };
    }

    const moveLossCp = Math.max(0, chessDbBest.scoreForSide - played.scoreForSide);
    const isChessDbBest = reviewMovesMatch(chessDbBest.move.uci, chessDbBest.move.san, playedMove);
    const rawLabel = classifyOpeningReviewAttempt(
        moveLossCp,
        !authoritativeBestMove && isChessDbBest,
    );
    const label = capAuthoritativeAlternativeLabel(rawLabel, authoritativeBestMove, playedMove);

    return {
        quality: openingReviewQualityFromLabel(label),
        label,
        passed: isMistakeReviewPassingLabel(label),
        bestMoveSan: authoritativeBestMove?.san ?? chessDbBest.move.san ?? savedBestMove.san,
        bestMoveUci: authoritativeBestMove?.uci ?? chessDbBest.move.uci ?? savedBestMove.uci,
        bestMoveSource: authoritativeBestMove ? "lichess" : "chessdb",
        chessDbBestMoveSan: chessDbBest.move.san,
        chessDbBestMoveUci: chessDbBest.move.uci,
        moveLossCp,
        chessDbRank: played.move.rank,
    };
}

function classifyOpeningReviewAttempt(moveLossCp: number, exactBest: boolean) {
    return classifyMistakeReviewAttempt(Math.round(moveLossCp), undefined, exactBest);
}

function openingReviewQualityFromLabel(label: MistakeReviewAttemptLabel) {
    switch (label) {
        case "best":
            return "best";
        case "good":
        case "okay":
            return "ok";
        case "inaccuracy":
        case "mistake":
        case "blunder":
            return "incorrect";
    }
}

function capAuthoritativeAlternativeLabel(
    label: MistakeReviewAttemptLabel,
    authoritativeBestMove: { san: string; uci?: string } | null | undefined,
    playedMove: { san: string; uci: string },
) {
    if (!authoritativeBestMove) return label;
    if (reviewMovesMatch(authoritativeBestMove.uci, authoritativeBestMove.san, playedMove)) {
        return label;
    }
    return label === "best" ? "good" : label;
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

function getSavedLichessBestMove(position: Position) {
    if (position.engine?.source !== "lichess") return null;
    if (!position.engine.bestMoveSan && !position.engine.bestMoveUci) return null;

    return {
        san: position.engine.bestMoveSan || position.answer,
        uci: position.engine.bestMoveUci ?? undefined,
    };
}

function getSavedBestMoveSource(position: Position): OpeningReviewMoveAssessmentSource {
    switch (position.engine?.source) {
        case "lichess":
            return "lichess";
        case "chessdb":
        case "cloud":
            return "chessdb";
        case "local":
            return "engine";
        default:
            return position.engine?.bestMoveSan || position.engine?.bestMoveUci
                ? "engine"
                : "saved";
    }
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

function getScoreForSide(move: ChessDbCloudMove | LichessCloudMove, side: "white" | "black") {
    if (move.scoreCpForWhite === null) return null;
    return side === "black" ? -move.scoreCpForWhite : move.scoreCpForWhite;
}

function sameReviewBoardPosition(a: string | undefined, b: string | undefined) {
    if (!a || !b) return false;
    return a.split(" ").slice(0, 4).join(" ") === b.split(" ").slice(0, 4).join(" ");
}
