import type { Color } from "chessops";
import { atom } from "jotai";

export type LiveReplayClockState = {
    color: Color;
    startSeconds: number;
    endSeconds: number;
    remainingMs: number;
    totalMs: number;
};

export const liveReplayClockAtom = atom<LiveReplayClockState | null>(null);
