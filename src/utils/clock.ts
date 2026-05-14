import type { Chess, Color } from "chessops";
import { match } from "ts-pattern";
import { type GameHeaders, getNodeAtPath, type TreeNode } from "./treeReducer";

function calculateProgress(
    root: TreeNode,
    timeControl: TimeControl | null,
    clock: number | null,
    tc: TimeControlField | null,
) {
    if (clock === null) {
        return 0;
    }
    if (tc) {
        return clock / (tc.seconds / 1000);
    }
    if (timeControl) {
        return clock / (timeControl[0].seconds / 1000);
    }
    if (root.children.length > 0 && root.children[0].clock !== undefined) {
        return clock / root.children[0].clock;
    }
    return 0;
}

export type TimeControlField = {
    seconds: number;
    increment?: number;
    moves?: number;
};

type TimeControl = TimeControlField[];

type ClockInfo = {
    progress: number;
    value: number | undefined;
};

export function parseTimeControl(timeControl: string): TimeControl {
    const fields = timeControl.split(":");
    const timeControlFields: TimeControl = [];
    for (const field of fields) {
        const match = field.match(/(?:(\d+)\/)?(\d+)(?:\+(\d+))?/);
        if (!match) {
            continue;
        }
        const moves = match[1];
        const seconds = match[2];
        const increment = match[3];
        const timeControlField: TimeControlField = {
            seconds: Number.parseInt(seconds) * 1000,
        };
        if (increment) {
            timeControlField.increment = Number.parseInt(increment) * 1000;
        }
        if (moves) {
            timeControlField.moves = Number.parseInt(moves);
        }
        timeControlFields.push(timeControlField);
    }
    return timeControlFields;
}

function getSideTimeControl(headers: GameHeaders, color: Color): TimeControlField | null {
    const sharedTimeControl = headers.time_control ? parseTimeControl(headers.time_control) : null;
    const sideTimeControl =
        color === "white" ? headers.white_time_control : headers.black_time_control;
    return sideTimeControl
        ? (parseTimeControl(sideTimeControl)[0] ?? null)
        : (sharedTimeControl?.[0] ?? null);
}

function moveColor(halfMoves: number): Color {
    return halfMoves % 2 === 1 ? "white" : "black";
}

function clampDuration(seconds: number): number | null {
    if (!Number.isFinite(seconds)) return null;
    if (seconds < -0.75) return null;
    return Math.max(0, seconds);
}

function parseHeaderDateTimeSeconds(headers: GameHeaders): number | null {
    const date = headers.date?.trim();
    const time = headers.time?.trim() || headers.other?.UTCTime?.trim();
    if (!date || !time) return null;

    const dateMatch = date.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
    const timeMatch = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!dateMatch || !timeMatch) return null;

    const [, year, month, day] = dateMatch;
    const [, hour, minute, second = "0"] = timeMatch;
    const timestamp = Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
    );
    return Number.isFinite(timestamp) ? timestamp / 1000 : null;
}

export type MoveThinkTime = {
    moveTimeSeconds: number;
    clockBeforeSeconds?: number;
    clockAfterSeconds?: number;
    source: "clock" | "timestamp";
};

export function getMoveThinkTime({
    headers,
    root,
    movePath,
}: {
    headers: GameHeaders;
    root: TreeNode;
    movePath: number[];
}): MoveThinkTime | null {
    if (movePath.length === 0) return null;

    const node = getNodeAtPath(root, movePath);
    if (!node?.san) return null;

    const color = moveColor(node.halfMoves);
    const timeControl = getSideTimeControl(headers, color);
    const incrementSeconds = (timeControl?.increment ?? 0) / 1000;
    const previousSameColorPath = movePath.slice(0, -2);
    const previousSameColor =
        previousSameColorPath.length > 0 ? getNodeAtPath(root, previousSameColorPath) : null;
    const previousClockSeconds =
        previousSameColorPath.length > 0
            ? previousSameColor?.clock
            : timeControl
              ? timeControl.seconds / 1000
              : undefined;

    if (typeof node.clock === "number" && previousClockSeconds !== undefined) {
        const moveTimeSeconds = clampDuration(
            previousClockSeconds + incrementSeconds - node.clock,
        );
        if (moveTimeSeconds !== null) {
            return {
                moveTimeSeconds,
                clockBeforeSeconds:
                    previousClockSeconds !== undefined
                        ? previousClockSeconds + incrementSeconds
                        : undefined,
                clockAfterSeconds: node.clock,
                source: "clock",
            };
        }
    }

    const parent = getNodeAtPath(root, movePath.slice(0, -1));
    const previousTimestamp =
        parent?.timestamp ?? (movePath.length === 1 ? parseHeaderDateTimeSeconds(headers) : null);
    if (typeof node.timestamp === "number" && typeof previousTimestamp === "number") {
        const moveTimeSeconds = clampDuration(node.timestamp - previousTimestamp);
        if (moveTimeSeconds !== null && moveTimeSeconds <= 24 * 60 * 60) {
            return {
                moveTimeSeconds,
                source: "timestamp",
            };
        }
    }

    return null;
}

export function formatMoveThinkTime(seconds: number) {
    const rounded = Math.max(0, Math.round(seconds));
    if (rounded < 1) return "<1s";
    if (rounded < 60) return `${rounded}s`;

    const minutes = Math.floor(rounded / 60);
    const remainingSeconds = rounded % 60;
    if (minutes < 60) {
        return remainingSeconds === 0
            ? `${minutes}m`
            : `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes === 0
        ? `${hours}h`
        : `${hours}h ${remainingMinutes.toString().padStart(2, "0")}m`;
}

export function formatClockTime(seconds: number) {
    let s = Math.max(0, seconds);
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    s = (s % 3600) % 60;

    let timeString = `${minutes.toString().padStart(2, "0")}`;
    if (hours > 0) {
        timeString = `${hours}:${timeString}`;
    }
    if (seconds < 60) {
        timeString += `:${s.toFixed(1).padStart(4, "0")}`;
    } else {
        timeString += `:${Math.floor(s).toString().padStart(2, "0")}`;
    }
    return timeString;
}

export function getClockInfo({
    headers,
    root,
    currentClock,
    pos,
    position,
    whiteTime,
    blackTime,
}: {
    headers: GameHeaders;
    root: TreeNode;
    currentClock: number | undefined;
    pos: Chess | null;
    position: number[];
    whiteTime?: number;
    blackTime?: number;
}): {
    white: ClockInfo;
    black: ClockInfo;
} {
    const timeControl = headers.time_control ? parseTimeControl(headers.time_control) : null;

    let whiteTc: TimeControlField | null = null;
    let blackTc: TimeControlField | null = null;

    if (headers.white_time_control) {
        whiteTc = parseTimeControl(headers.white_time_control)[0];
    } else if (timeControl) {
        whiteTc = timeControl[0];
    }
    if (headers.black_time_control) {
        blackTc = parseTimeControl(headers.black_time_control)[0];
    } else if (timeControl) {
        blackTc = timeControl[0];
    }

    let { whiteSeconds, blackSeconds } = match(pos?.turn)
        .with("white", () => ({
            whiteSeconds: getNodeAtPath(root, position.slice(0, -1))?.clock,
            blackSeconds: currentClock,
        }))
        .with("black", () => ({
            whiteSeconds: currentClock,
            blackSeconds: getNodeAtPath(root, position.slice(0, -1))?.clock,
        }))
        .otherwise(() => {
            return {
                whiteSeconds: undefined,
                blackSeconds: undefined,
            };
        });
    if (position.length <= 1 && timeControl) {
        if (timeControl.length > 0) {
            const seconds = timeControl[0].seconds / 1000;
            if (whiteSeconds === undefined) {
                whiteSeconds = seconds;
            }
            if (blackSeconds === undefined) {
                blackSeconds = seconds;
            }
        }
    }
    if (whiteTime !== undefined) {
        whiteSeconds = whiteTime / 1000;
    }
    if (blackTime !== undefined) {
        blackSeconds = blackTime / 1000;
    }

    return {
        white: {
            value: whiteSeconds,
            progress: calculateProgress(root, timeControl, whiteSeconds ?? null, whiteTc),
        },
        black: {
            value: blackSeconds,
            progress: calculateProgress(root, timeControl, blackSeconds ?? null, blackTc),
        },
    };
}
