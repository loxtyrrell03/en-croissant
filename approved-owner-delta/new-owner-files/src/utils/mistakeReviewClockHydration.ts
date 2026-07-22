import { commands, type MistakeReviewClockTiming } from "@/bindings";
import type { Position } from "@/components/files/opening";
import {
    DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT,
    formatMistakeReviewMoveTime,
    mistakeReviewPositionKey,
    type MistakeReviewDeck,
} from "@/utils/mistakeReview";
import { unwrap } from "@/utils/unwrap";

export type MistakeReviewClockHydrationResult = {
    deck: MistakeReviewDeck;
    updatedCount: number;
};

export async function hydrateMistakeReviewClockData(
    deck: MistakeReviewDeck,
): Promise<MistakeReviewClockHydrationResult> {
    const requests = deck.positions.flatMap((position) => {
        if (!needsClockHydration(position)) return [];
        const metadata = position.mistakeReview;
        if (!metadata?.playedMoveUci) return [];
        const gameIds = getMistakeReviewGameIds(position);
        if (gameIds.length === 0) return [];

        return [
            {
                reviewKey: mistakeReviewPositionKey(position),
                fen: position.fen,
                playedMoveUci: metadata.playedMoveUci,
                gameIds,
            },
        ];
    });

    if (requests.length === 0) {
        return { deck, updatedCount: 0 };
    }

    const timings = unwrap(
        await commands.getMistakeReviewClockTimings(deck.settings.playerDb, requests),
    );
    if (timings.length === 0) {
        return { deck, updatedCount: 0 };
    }

    return applyMistakeReviewClockTimings(deck, timings);
}

export function applyMistakeReviewClockTimings(
    deck: MistakeReviewDeck,
    timings: MistakeReviewClockTiming[],
): MistakeReviewClockHydrationResult {
    const timingsByKey = new Map<string, MistakeReviewClockTiming>();
    for (const timing of timings) {
        const previous = timingsByKey.get(timing.reviewKey);
        if (!previous || hasMoreClockData(timing, previous)) {
            timingsByKey.set(timing.reviewKey, timing);
        }
    }

    let updatedCount = 0;
    const positions = deck.positions.map((position) => {
        const timing = timingsByKey.get(mistakeReviewPositionKey(position));
        if (!timing || !position.mistakeReview) return position;
        if (!clockTimingChangesPosition(position, timing)) return position;

        updatedCount += 1;
        return applyMistakeReviewClockTiming(position, timing);
    });

    return {
        deck: updatedCount > 0 ? { ...deck, positions, updatedAt: Date.now() } : deck,
        updatedCount,
    };
}

function needsClockHydration(position: Position) {
    const metadata = position.mistakeReview;
    if (!metadata) return false;
    if (!metadata.playedMoveUci) return false;
    if (getMistakeReviewGameIds(position).length === 0) return false;
    const needsMoveSequence = !position.moveSequence?.trim() && metadata.ply !== 0;
    return (
        needsMoveSequence || metadata.moveTimeSeconds == null || metadata.clockAfterSeconds == null
    );
}

function getMistakeReviewGameIds(position: Position) {
    const ids = [...(position.mistakeReview?.gameIds ?? []), position.mistakeReview?.gameId].filter(
        (id): id is number => typeof id === "number" && Number.isFinite(id),
    );
    return Array.from(new Set(ids)).sort((a, b) => a - b);
}

function hasMoreClockData(left: MistakeReviewClockTiming, right: MistakeReviewClockTiming) {
    return clockTimingScore(left) > clockTimingScore(right);
}

function clockTimingScore(timing: MistakeReviewClockTiming) {
    return (
        (timing.moveTimeSeconds != null ? 4 : 0) +
        (timing.clockBeforeSeconds != null ? 2 : 0) +
        (timing.clockAfterSeconds != null ? 2 : 0) +
        (timing.moveSequence ? 1 : 0) +
        (timing.timeControl ? 1 : 0)
    );
}

function clockTimingChangesPosition(position: Position, timing: MistakeReviewClockTiming) {
    const metadata = position.mistakeReview;
    if (!metadata) return false;
    return (
        (timing.moveSequence && position.moveSequence !== timing.moveSequence) ||
        (timing.moveTimeSeconds != null && metadata.moveTimeSeconds !== timing.moveTimeSeconds) ||
        (timing.clockBeforeSeconds != null &&
            metadata.clockBeforeSeconds !== timing.clockBeforeSeconds) ||
        (timing.clockAfterSeconds != null &&
            metadata.clockAfterSeconds !== timing.clockAfterSeconds) ||
        (timing.timeControl != null && metadata.timeControl !== timing.timeControl)
    );
}

function applyMistakeReviewClockTiming(
    position: Position,
    timing: MistakeReviewClockTiming,
): Position {
    const metadata = position.mistakeReview!;
    const moveTimeSeconds = timing.moveTimeSeconds ?? metadata.moveTimeSeconds;
    const clockBeforeSeconds = timing.clockBeforeSeconds ?? metadata.clockBeforeSeconds;
    const clockAfterSeconds = timing.clockAfterSeconds ?? metadata.clockAfterSeconds;
    const minMoveSeconds =
        metadata.timeManagement?.minMoveSeconds ??
        DEFAULT_MISTAKE_REVIEW_TIME_MANAGEMENT.minMoveSeconds;
    const isLongThink =
        typeof moveTimeSeconds === "number" &&
        Number.isFinite(moveTimeSeconds) &&
        moveTimeSeconds >= minMoveSeconds;
    const tags = isLongThink
        ? Array.from(new Set([...(position.tags ?? []), "Long think"]))
        : position.tags;
    const moveTimeText = formatMistakeReviewMoveTime(moveTimeSeconds);

    return {
        ...position,
        moveSequence: timing.moveSequence || position.moveSequence,
        tags,
        evidence: moveTimeText
            ? withSpentTimeEvidence(position.evidence, moveTimeText)
            : position.evidence,
        mistakeReview: {
            ...metadata,
            moveTimeSeconds,
            clockBeforeSeconds,
            clockAfterSeconds,
            date: timing.date ?? metadata.date,
            time: timing.time ?? metadata.time,
            timeControl: timing.timeControl ?? metadata.timeControl,
            longThinkThresholdSeconds: metadata.timeManagement?.enabled
                ? minMoveSeconds
                : metadata.longThinkThresholdSeconds,
        },
    };
}

function withSpentTimeEvidence(evidence: string | undefined, moveTimeText: string) {
    const rest = (evidence ?? "clock data from updated game.").replace(/^Spent [^;]+; /, "");
    return `Spent ${moveTimeText}; ${rest}`;
}
