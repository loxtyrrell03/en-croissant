import { parseTimeControl } from "@/utils/clock";
import type { WebColor, WebPrepLineMove } from "./model";
import { getFenColor } from "./pgn";

export const WEB_LIVE_REPLAY_MIN_DELAY_MS = 350;

export type WebLiveReplayTiming = {
    timeControl?: string | null;
    whiteTimeControl?: string | null;
    blackTimeControl?: string | null;
    startedAtSeconds?: number | null;
};

export type WebLiveReplayStep = {
    moveIndex: number;
    delayMs: number;
    moveTimeSeconds: number;
};

export type WebLiveReplayProgress = {
    totalMs: number;
    elapsedMs: number;
    remainingMs: number;
    value: number;
};

function getSideTimeControl(timing: WebLiveReplayTiming, color: WebColor) {
    const sideValue = color === "white" ? timing.whiteTimeControl : timing.blackTimeControl;
    const value = sideValue || timing.timeControl;
    return value ? (parseTimeControl(value)[0] ?? null) : null;
}

function clampDuration(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < -0.75) return null;
    return Math.max(0, seconds);
}

function getMoveTimeSeconds({
    line,
    moveIndex,
    timing,
}: {
    line: WebPrepLineMove[];
    moveIndex: number;
    timing: WebLiveReplayTiming;
}) {
    const move = line[moveIndex];
    if (!move) return null;

    const color = getFenColor(move.fenBefore);
    const timeControl = getSideTimeControl(timing, color);
    const incrementSeconds = (timeControl?.increment ?? 0) / 1000;
    let previousSameColorClock: number | undefined;
    for (let index = moveIndex - 1; index >= 0; index -= 1) {
        const candidate = line[index];
        if (getFenColor(candidate.fenBefore) === color) {
            if (typeof candidate.clockSeconds === "number") {
                previousSameColorClock = candidate.clockSeconds;
            }
            break;
        }
    }
    if (previousSameColorClock === undefined && timeControl) {
        previousSameColorClock = timeControl.seconds / 1000;
    }

    if (typeof move.clockSeconds === "number" && previousSameColorClock !== undefined) {
        const duration = clampDuration(
            previousSameColorClock + incrementSeconds - move.clockSeconds,
        );
        if (duration !== null) return duration;
    }

    const previousTimestamp =
        moveIndex > 0 ? line[moveIndex - 1]?.timestampSeconds : timing.startedAtSeconds;
    if (typeof move.timestampSeconds === "number" && typeof previousTimestamp === "number") {
        const duration = clampDuration(move.timestampSeconds - previousTimestamp);
        if (duration !== null && duration <= 24 * 60 * 60) return duration;
    }

    return null;
}

export function getWebLiveReplayStep({
    line,
    cursor,
    timing,
    minDelayMs = WEB_LIVE_REPLAY_MIN_DELAY_MS,
}: {
    line: WebPrepLineMove[];
    cursor: number;
    timing: WebLiveReplayTiming;
    minDelayMs?: number;
}): WebLiveReplayStep | null {
    const moveTimeSeconds = getMoveTimeSeconds({ line, moveIndex: cursor, timing });
    if (moveTimeSeconds === null) return null;

    return {
        moveIndex: cursor,
        delayMs: Math.max(minDelayMs, Math.round(moveTimeSeconds * 1000)),
        moveTimeSeconds,
    };
}

export function getWebLiveReplayProgress({
    line,
    cursor,
    timing,
    currentMoveElapsedMs = 0,
    minDelayMs = WEB_LIVE_REPLAY_MIN_DELAY_MS,
}: {
    line: WebPrepLineMove[];
    cursor: number;
    timing: WebLiveReplayTiming;
    currentMoveElapsedMs?: number;
    minDelayMs?: number;
}): WebLiveReplayProgress | null {
    const delays: number[] = [];
    for (let moveIndex = 0; moveIndex < line.length; moveIndex += 1) {
        const moveTimeSeconds = getMoveTimeSeconds({ line, moveIndex, timing });
        if (moveTimeSeconds === null) break;
        delays.push(Math.max(minDelayMs, Math.round(moveTimeSeconds * 1000)));
    }

    const totalMs = delays.reduce((total, delay) => total + delay, 0);
    if (totalMs <= 0 || cursor > delays.length) return null;

    const completedMs = delays
        .slice(0, Math.min(cursor, delays.length))
        .reduce((total, delay) => total + delay, 0);
    const nextDelay = delays[cursor] ?? 0;
    const elapsedMs = Math.min(
        totalMs,
        completedMs + Math.min(nextDelay, Math.max(0, currentMoveElapsedMs)),
    );

    return {
        totalMs,
        elapsedMs,
        remainingMs: Math.max(0, totalMs - elapsedMs),
        value: (elapsedMs / totalMs) * 100,
    };
}
