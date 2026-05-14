import { getMoveThinkTime } from "@/utils/clock";
import { type GameHeaders, getNodeAtPath, type TreeNode } from "@/utils/treeReducer";

export const LIVE_REPLAY_MIN_DELAY_MS = 350;

export type LiveReplayStep = {
    movePath: number[];
    delayMs: number;
    moveTimeSeconds: number;
};

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

    const timing = getMoveThinkTime({ headers, root, movePath });
    if (!timing) return null;

    return {
        movePath,
        delayMs: Math.max(minDelayMs, Math.round(timing.moveTimeSeconds * 1000)),
        moveTimeSeconds: timing.moveTimeSeconds,
    };
}
