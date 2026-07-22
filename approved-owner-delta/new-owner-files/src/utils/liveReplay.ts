import type { Color } from "chessops";
import { getMoveThinkTime, parseTimeControl, type TimeControlField } from "@/utils/clock";
import { type GameHeaders, getNodeAtPath, type TreeNode } from "@/utils/treeReducer";

export const LIVE_REPLAY_MIN_DELAY_MS = 350;

export type LiveReplayStep = {
    movePath: number[];
    delayMs: number;
    moveTimeSeconds: number;
    clockColor?: Color;
    clockStartSeconds?: number;
    clockEndSeconds?: number;
};

export type LiveReplayProgress = {
    totalMs: number;
    elapsedMs: number;
    remainingMs: number;
    value: number;
};

function moveColor(halfMoves: number): Color {
    return halfMoves % 2 === 1 ? "white" : "black";
}

function pathsEqual(a: number[], b: number[]) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

function getMoveDelayMs({
    headers,
    root,
    movePath,
    minDelayMs,
}: {
    headers: GameHeaders;
    root: TreeNode;
    movePath: number[];
    minDelayMs: number;
}) {
    const timing = getMoveThinkTime({ headers, root, movePath });
    if (!timing) return null;
    return {
        delayMs: Math.max(minDelayMs, Math.round(timing.moveTimeSeconds * 1000)),
        moveTimeSeconds: timing.moveTimeSeconds,
    };
}

function getLiveReplayLinePaths({
    root,
    position,
    practicePath,
}: {
    root: TreeNode;
    position: number[];
    practicePath?: number[] | null;
}) {
    const paths: number[][] = [];
    let path: number[] = [];

    for (let guard = 0; guard < 1000; guard++) {
        const node = getNodeAtPath(root, path);
        const childIndex =
            practicePath && path.length < practicePath.length
                ? practicePath[path.length]
                : path.length < position.length
                  ? position[path.length]
                  : 0;
        const nextNode = node.children[childIndex];
        if (!nextNode?.san) break;

        path = [...path, childIndex];
        paths.push(path);
    }

    return paths;
}

function getSideTimeControl(headers: GameHeaders, color: Color): TimeControlField | null {
    const sharedTimeControl = headers.time_control ? parseTimeControl(headers.time_control) : null;
    const sideTimeControl =
        color === "white" ? headers.white_time_control : headers.black_time_control;
    return sideTimeControl
        ? (parseTimeControl(sideTimeControl)[0] ?? null)
        : (sharedTimeControl?.[0] ?? null);
}

function getLiveReplayClockRange({
    headers,
    root,
    movePath,
}: {
    headers: GameHeaders;
    root: TreeNode;
    movePath: number[];
}) {
    const node = getNodeAtPath(root, movePath);
    if (typeof node.clock !== "number") return null;

    const color = moveColor(node.halfMoves);
    const timeControl = getSideTimeControl(headers, color);
    const previousSameColorPath = movePath.slice(0, -2);
    const previousSameColor =
        previousSameColorPath.length > 0 ? getNodeAtPath(root, previousSameColorPath) : null;
    const startSeconds =
        previousSameColorPath.length > 0
            ? previousSameColor?.clock
            : timeControl
              ? timeControl.seconds / 1000
              : undefined;
    if (typeof startSeconds !== "number") return null;

    const incrementSeconds = (timeControl?.increment ?? 0) / 1000;
    const endSeconds = Math.max(0, node.clock - incrementSeconds);
    return {
        color,
        startSeconds,
        endSeconds,
    };
}

export function getLiveReplayNextPath({
    root,
    position,
    practicePath,
}: {
    root: TreeNode;
    position: number[];
    practicePath?: number[] | null;
}): number[] | null {
    const node = getNodeAtPath(root, position);
    const childIndex =
        practicePath && position.length < practicePath.length ? practicePath[position.length] : 0;
    const nextNode = node.children[childIndex];
    if (!nextNode?.san) return null;
    return [...position, childIndex];
}

export function getLiveReplayStep({
    headers,
    root,
    position,
    practicePath,
    minDelayMs = LIVE_REPLAY_MIN_DELAY_MS,
}: {
    headers: GameHeaders;
    root: TreeNode;
    position: number[];
    practicePath?: number[] | null;
    minDelayMs?: number;
}): LiveReplayStep | null {
    const movePath = getLiveReplayNextPath({ root, position, practicePath });
    if (!movePath) return null;

    const timing = getMoveDelayMs({ headers, root, movePath, minDelayMs });
    if (!timing) return null;
    const clockRange = getLiveReplayClockRange({ headers, root, movePath });

    return {
        movePath,
        delayMs: timing.delayMs,
        moveTimeSeconds: timing.moveTimeSeconds,
        clockColor: clockRange?.color,
        clockStartSeconds: clockRange?.startSeconds,
        clockEndSeconds: clockRange?.endSeconds,
    };
}

export function getLiveReplayProgress({
    headers,
    root,
    position,
    practicePath,
    currentMoveElapsedMs = 0,
    minDelayMs = LIVE_REPLAY_MIN_DELAY_MS,
}: {
    headers: GameHeaders;
    root: TreeNode;
    position: number[];
    practicePath?: number[] | null;
    currentMoveElapsedMs?: number;
    minDelayMs?: number;
}): LiveReplayProgress | null {
    const timedSteps: Array<{ movePath: number[]; delayMs: number }> = [];
    for (const movePath of getLiveReplayLinePaths({ root, position, practicePath })) {
        const timing = getMoveDelayMs({ headers, root, movePath, minDelayMs });
        if (!timing) break;
        timedSteps.push({
            movePath,
            delayMs: timing.delayMs,
        });
    }

    const totalMs = timedSteps.reduce((total, step) => total + step.delayMs, 0);
    if (totalMs <= 0) return null;

    let elapsedMs = 0;
    if (position.length > 0) {
        const currentIndex = timedSteps.findIndex((step) => pathsEqual(step.movePath, position));
        if (currentIndex < 0) return null;
        elapsedMs = timedSteps
            .slice(0, currentIndex + 1)
            .reduce((total, step) => total + step.delayMs, 0);
    }

    const nextMovePath = getLiveReplayNextPath({ root, position, practicePath });
    const nextStep = nextMovePath
        ? timedSteps.find((step) => pathsEqual(step.movePath, nextMovePath))
        : null;
    if (nextStep && currentMoveElapsedMs > 0) {
        elapsedMs += Math.min(nextStep.delayMs, currentMoveElapsedMs);
    }

    const clampedElapsedMs = Math.min(totalMs, Math.max(0, elapsedMs));
    const remainingMs = Math.max(0, totalMs - clampedElapsedMs);
    return {
        totalMs,
        elapsedMs: clampedElapsedMs,
        remainingMs,
        value: (clampedElapsedMs / totalMs) * 100,
    };
}
