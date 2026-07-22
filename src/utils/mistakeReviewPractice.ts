import type { Position } from "@/components/files/opening";
import { commands } from "@/bindings";
import {
    classifyMistakeReviewAttempt,
    DEFAULT_MISTAKE_REVIEW_THRESHOLDS,
    isMistakeReviewPassingLabel,
    type MistakeReviewAttemptLabel,
} from "@/utils/mistakeReview";
import { isOpeningReviewSavedMove } from "@/utils/openingReviewPractice";
import { unwrap } from "@/utils/unwrap";

export type MistakeReviewMoveAssessment = {
    label: MistakeReviewAttemptLabel;
    passed: boolean;
    bestMoveSan: string;
    bestMoveUci?: string;
    moveLossCp?: number;
    winProbabilityDrop?: number;
    requestedDepth?: number;
    reachedDepth?: number;
    engineName?: string;
};

export function assessMistakeReviewMove(
    position: Position,
    playedMove: { san: string; uci: string },
): MistakeReviewMoveAssessment {
    const metadata = position.mistakeReview;
    const bestMoveSan = metadata?.bestMoveSan || position.engine?.bestMoveSan || position.answer;
    const bestMoveUci =
        metadata?.bestMoveUci || position.engine?.bestMoveUci || position.answerUci || undefined;

    if (isOpeningReviewSavedMove(position, playedMove)) {
        return {
            label: "best",
            passed: true,
            bestMoveSan,
            bestMoveUci,
            moveLossCp: 0,
            winProbabilityDrop: 0,
            requestedDepth: metadata?.requestedDepth,
            reachedDepth: metadata?.reachedDepth,
            engineName: metadata?.engineName,
        };
    }

    const thresholds = metadata?.thresholds ?? DEFAULT_MISTAKE_REVIEW_THRESHOLDS;
    const playedOriginalMistake =
        Boolean(metadata?.playedMoveUci && metadata.playedMoveUci === playedMove.uci) ||
        Boolean(metadata?.playedMoveSan && metadata.playedMoveSan === playedMove.san);
    const label = playedOriginalMistake
        ? classifyMistakeReviewAttempt(metadata?.cpLoss ?? thresholds.mistake, thresholds)
        : (metadata?.severity ?? "mistake");

    return {
        label,
        passed: isMistakeReviewPassingLabel(label),
        bestMoveSan,
        bestMoveUci,
        moveLossCp: metadata?.cpLoss,
        winProbabilityDrop: metadata?.winProbabilityDrop,
        requestedDepth: metadata?.requestedDepth,
        reachedDepth: metadata?.reachedDepth,
        engineName: metadata?.engineName,
    };
}

export async function assessMistakeReviewMoveWithEngine(
    position: Position,
    playedMove: { san: string; uci: string },
    options: { requestId?: string | null } = {},
): Promise<MistakeReviewMoveAssessment> {
    const metadata = position.mistakeReview;
    const savedAssessment = assessMistakeReviewMove(position, playedMove);
    if (savedAssessment.label === "best") {
        return savedAssessment;
    }

    if (!metadata?.enginePath) {
        return savedAssessment;
    }

    try {
        const score = unwrap(
            await commands.scoreMistakeReviewMove({
                requestId: options.requestId ?? null,
                fen: position.fen,
                playedMoveUci: playedMove.uci,
                enginePath: metadata.enginePath,
                engineName: metadata.engineName ?? null,
                depth: metadata.requestedDepth ?? metadata.reachedDepth ?? 17,
                multiPv: metadata.multiPv ?? 3,
                thresholds: metadata.thresholds ?? DEFAULT_MISTAKE_REVIEW_THRESHOLDS,
            }),
        );

        return {
            label: score.label,
            passed: score.passed,
            bestMoveSan: savedAssessment.bestMoveSan || score.bestMoveSan,
            bestMoveUci: savedAssessment.bestMoveUci || score.bestMoveUci,
            moveLossCp: score.cpLoss,
            winProbabilityDrop: score.winProbabilityDrop,
            requestedDepth: score.requestedDepth,
            reachedDepth: score.reachedDepth,
            engineName: score.engineName,
        };
    } catch {
        return savedAssessment;
    }
}
