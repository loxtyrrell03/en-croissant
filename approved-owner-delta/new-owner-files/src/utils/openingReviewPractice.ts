import { makeUci, parseUci } from "chessops";
import { parseSan } from "chessops/san";
import type { Position } from "@/components/files/opening";
import type { PracticeState } from "@/state/atoms";
import type { ChessDbCloudMove } from "@/utils/chessdb/api";
import { positionFromFen } from "@/utils/chessops";
import type { LichessCloudMove } from "@/utils/lichess/api";
import {
    classifyMistakeReviewAttempt,
    isMistakeReviewPassingLabel,
    type MistakeReviewAttemptLabel,
} from "@/utils/mistakeReview";
import {
    findReviewPositionIndexForFen,
    type ReviewPositionFenIndex,
} from "@/utils/openingReviewPersistence";

export type OpeningReviewMoveAssessmentSource = "lichess" | "chessdb" | "engine" | "saved";

export type OpeningReviewMoveAssessment = {
    quality: "correct" | "best" | "ok" | "incorrect";
    label: MistakeReviewAttemptLabel;
    passed: boolean;
    repertoireMoveSan: string;
    repertoireMoveUci?: string;
    followedRepertoire: boolean;
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

export function openingReviewAssessmentToPracticeState({
    position,
    positionIndex,
    playedMove,
    assessment,
    timeTaken,
}: {
    position: Position;
    positionIndex: number;
    playedMove: { san: string; uci: string };
    assessment: OpeningReviewMoveAssessment;
    timeTaken: number;
}): PracticeState {
    return {
        phase: assessment.passed ? "correct" : "incorrect",
        currentFen: position.fen,
        answer: assessment.repertoireMoveSan || position.answer,
        repertoireMove: assessment.repertoireMoveSan,
        repertoireMoveUci: assessment.repertoireMoveUci,
        followedRepertoire: assessment.followedRepertoire,
        playedMove: playedMove.san,
        playedMoveUci: playedMove.uci,
        moveAssessment: practiceMoveAssessmentFromLabel(assessment.label),
        moveQualityLabel: assessment.label,
        bestMove: assessment.bestMoveSan,
        bestMoveUci: assessment.bestMoveUci,
        bestMoveSource: assessment.bestMoveSource,
        moveLossCp: assessment.moveLossCp,
        chessDbRank: assessment.chessDbRank,
        positionIndex,
        timeTaken,
        resultRecorded: false,
    };
}

export function findReviewPracticePositionForBoard(
    positions: Position[],
    currentFen: string | undefined,
    practicePositionIndex: number | undefined,
    fenIndex?: ReviewPositionFenIndex,
): ReviewPracticePositionEntry | null {
    if (practicePositionIndex !== undefined) {
        const position = positions[practicePositionIndex];
        return position && sameReviewBoardPosition(position.fen, currentFen)
            ? { position, index: practicePositionIndex }
            : null;
    }

    if (!currentFen) return null;

    const index = findReviewPositionIndexForFen(positions, currentFen, undefined, fenIndex);
    return index === -1 ? null : { position: positions[index]!, index };
}

export function assessOpeningReviewMove(
    position: Position,
    playedMove: { san: string; uci: string },
    chessDbMoves?: ChessDbCloudMove[] | null,
    lichessMoves?: LichessCloudMove[] | null,
): OpeningReviewMoveAssessment {
    const savedLichessBestMove = getSavedLichessBestMove(position);
    const savedBestMove = getOpeningReviewBestMove(position);

    if (isOpeningReviewSavedMove(position, playedMove)) {
        return assessOpeningReviewSavedMove(
            position,
            playedMove,
            chessDbMoves,
            lichessMoves,
            savedLichessBestMove,
            savedBestMove,
        );
    }

    const lichessAssessment = assessLichessCloudMove(position, playedMove, lichessMoves);
    if (lichessAssessment) return lichessAssessment;

    if (
        savedLichessBestMove &&
        reviewMovesMatch(savedLichessBestMove.uci, savedLichessBestMove.san, playedMove)
    ) {
        return {
            quality: "best",
            label: "best",
            passed: true,
            ...getOpeningReviewRepertoireContext(position, playedMove),
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

    if (isOpeningReviewEngineMove(position, playedMove)) {
        return {
            quality: "best",
            label: "best",
            passed: true,
            ...getOpeningReviewRepertoireContext(position, playedMove),
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
            ...getOpeningReviewRepertoireContext(position, playedMove),
            bestMoveSan: savedBestMove.san,
            bestMoveUci: savedBestMove.uci,
            bestMoveSource: getSavedBestMoveSource(position),
        };
    }

    return {
        quality: "incorrect",
        label: "mistake",
        passed: false,
        ...getOpeningReviewRepertoireContext(position, playedMove),
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
    const scoredMoves = rankLichessCloudMoves(position, lichessMoves);

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
            ...getOpeningReviewRepertoireContext(position, playedMove),
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
        ...getOpeningReviewRepertoireContext(position, playedMove),
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
    const savedBestMove = getOpeningReviewBestMove(position);
    const scoredMoves = rankChessDbCloudMoves(position, chessDbMoves);

    const chessDbBest = scoredMoves[0];
    if (!chessDbBest) return null;

    const played = scoredMoves.find((entry) =>
        reviewMovesMatch(entry.move.uci, entry.move.san, playedMove),
    );

    if (!played) {
        return {
            quality: "incorrect",
            label: "mistake",
            passed: false,
            ...getOpeningReviewRepertoireContext(position, playedMove),
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
        ...getOpeningReviewRepertoireContext(position, playedMove),
        bestMoveSan: authoritativeBestMove?.san ?? chessDbBest.move.san ?? savedBestMove.san,
        bestMoveUci: authoritativeBestMove?.uci ?? chessDbBest.move.uci ?? savedBestMove.uci,
        bestMoveSource: authoritativeBestMove ? "lichess" : "chessdb",
        chessDbBestMoveSan: chessDbBest.move.san,
        chessDbBestMoveUci: chessDbBest.move.uci,
        moveLossCp,
        chessDbRank: played.move.rank,
    };
}

function assessOpeningReviewSavedMove(
    position: Position,
    playedMove: { san: string; uci: string },
    chessDbMoves: ChessDbCloudMove[] | null | undefined,
    lichessMoves: LichessCloudMove[] | null | undefined,
    savedLichessBestMove: { san: string; uci?: string } | null,
    savedBestMove: { san: string; uci?: string },
): OpeningReviewMoveAssessment {
    const repertoireContext = getOpeningReviewRepertoireContext(position, playedMove);
    const lichessScoredMoves = rankLichessCloudMoves(position, lichessMoves);
    const lichessBest = lichessScoredMoves[0];

    if (lichessBest) {
        const played = lichessScoredMoves.find((entry) =>
            reviewMovesMatch(entry.move.uci, entry.move.san, playedMove),
        );
        const moveLossCp = played
            ? Math.max(0, lichessBest.scoreForSide - played.scoreForSide)
            : undefined;
        const exactBest = reviewMovesMatch(lichessBest.move.uci, lichessBest.move.san, playedMove);

        return {
            quality: exactBest ? "best" : "correct",
            label: "best",
            passed: true,
            ...repertoireContext,
            bestMoveSan: lichessBest.move.san,
            bestMoveUci: lichessBest.move.uci,
            bestMoveSource: "lichess",
            moveLossCp,
        };
    }

    if (savedLichessBestMove) {
        const exactBest = reviewMovesMatch(
            savedLichessBestMove.uci,
            savedLichessBestMove.san,
            playedMove,
        );

        return {
            quality: exactBest ? "best" : "correct",
            label: "best",
            passed: true,
            ...repertoireContext,
            bestMoveSan: savedLichessBestMove.san,
            bestMoveUci: savedLichessBestMove.uci,
            bestMoveSource: "lichess",
            moveLossCp: exactBest ? 0 : undefined,
        };
    }

    const chessDbScoredMoves = rankChessDbCloudMoves(position, chessDbMoves);
    const chessDbBest = chessDbScoredMoves[0];

    if (chessDbBest) {
        const played = chessDbScoredMoves.find((entry) =>
            reviewMovesMatch(entry.move.uci, entry.move.san, playedMove),
        );
        const moveLossCp = played
            ? Math.max(0, chessDbBest.scoreForSide - played.scoreForSide)
            : undefined;
        const exactBest = reviewMovesMatch(chessDbBest.move.uci, chessDbBest.move.san, playedMove);

        return {
            quality: exactBest ? "best" : "correct",
            label: "best",
            passed: true,
            ...repertoireContext,
            bestMoveSan: chessDbBest.move.san,
            bestMoveUci: chessDbBest.move.uci,
            bestMoveSource: "chessdb",
            chessDbBestMoveSan: chessDbBest.move.san,
            chessDbBestMoveUci: chessDbBest.move.uci,
            moveLossCp,
            chessDbRank: played?.move.rank ?? null,
        };
    }

    const exactSavedBest = isOpeningReviewEngineMove(position, playedMove);

    return {
        quality: exactSavedBest ? "best" : "correct",
        label: "best",
        passed: true,
        ...repertoireContext,
        bestMoveSan: savedBestMove.san,
        bestMoveUci: savedBestMove.uci,
        bestMoveSource: getSavedBestMoveSource(position),
        moveLossCp: exactSavedBest ? 0 : undefined,
    };
}

function rankLichessCloudMoves(position: Position, lichessMoves?: LichessCloudMove[] | null) {
    if (!lichessMoves?.length) return [];

    const sideToMove = getOpeningReviewSideToMove(position);
    return lichessMoves
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
}

function rankChessDbCloudMoves(position: Position, chessDbMoves?: ChessDbCloudMove[] | null) {
    if (!chessDbMoves?.length) return [];

    const sideToMove = getOpeningReviewSideToMove(position);
    return chessDbMoves
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
}

function classifyOpeningReviewAttempt(moveLossCp: number, exactBest: boolean) {
    const label = classifyMistakeReviewAttempt(Math.round(moveLossCp), undefined, exactBest);
    return !exactBest && label === "best" ? "good" : label;
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

function practiceMoveAssessmentFromLabel(label: MistakeReviewAttemptLabel | undefined) {
    switch (label) {
        case "best":
            return "best";
        case "good":
        case "okay":
            return "ok";
        default:
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

function getOpeningReviewRepertoireMove(position: Position) {
    return {
        san: position.answer,
        uci: getOpeningReviewAnswerUci(position) ?? position.answerUci,
    };
}

function getOpeningReviewRepertoireContext(
    position: Position,
    playedMove: { san: string; uci: string },
) {
    const repertoireMove = getOpeningReviewRepertoireMove(position);

    return {
        repertoireMoveSan: repertoireMove.san,
        repertoireMoveUci: repertoireMove.uci,
        followedRepertoire: isOpeningReviewSavedMove(position, playedMove),
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

function getOpeningReviewSideToMove(position: Position): "white" | "black" {
    return position.fen.split(" ")[1] === "b" ? "black" : "white";
}

function sameReviewBoardPosition(a: string | undefined, b: string | undefined) {
    if (!a || !b) return false;
    return a.split(" ").slice(0, 4).join(" ") === b.split(" ").slice(0, 4).join(" ");
}
