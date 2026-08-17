import { describe, expect, test } from "vitest";
import { defaultTree, type GameHeaders, type TreeNode } from "@/utils/treeReducer";
import {
    getLiveReplayProgress,
    getLiveReplayNextPath,
    getLiveReplayStep,
    LIVE_REPLAY_MIN_DELAY_MS,
} from "@/utils/liveReplay";

function node({
    san,
    halfMoves,
    clock,
    timestamp,
    children = [],
}: {
    san: string | null;
    halfMoves: number;
    clock?: number;
    timestamp?: number;
    children?: TreeNode[];
}): TreeNode {
    return {
        fen: "",
        move: null,
        san,
        children,
        score: null,
        depth: null,
        halfMoves,
        shapes: [],
        annotations: [],
        comment: "",
        clock,
        timestamp,
    };
}

function headers(patch: Partial<GameHeaders> = {}): GameHeaders {
    return {
        ...defaultTree().headers,
        ...patch,
    };
}

describe("live replay", () => {
    test("uses recorded move time for the next mainline move", () => {
        const blackFirst = node({ san: "e5", halfMoves: 2, clock: 297 });
        const whiteFirst = node({ san: "e4", halfMoves: 1, clock: 294, children: [blackFirst] });
        const root = node({ san: null, halfMoves: 0, children: [whiteFirst] });

        expect(
            getLiveReplayStep({
                headers: headers({ time_control: "300+2" }),
                root,
                position: [],
            }),
        ).toMatchObject({
            movePath: [0],
            delayMs: 8000,
            moveTimeSeconds: 8,
            clockColor: "white",
            clockStartSeconds: 300,
            clockEndSeconds: 292,
        });
        expect(
            getLiveReplayStep({
                headers: headers({ time_control: "300+2" }),
                root,
                position: [0],
            }),
        ).toMatchObject({
            movePath: [0, 0],
            delayMs: 5000,
            moveTimeSeconds: 5,
            clockColor: "black",
            clockStartSeconds: 300,
            clockEndSeconds: 295,
        });
    });

    test("counts down from the pre-move clock before adding increment", () => {
        const whiteSecond = node({ san: "c4", halfMoves: 3, clock: 310 });
        const blackFirst = node({ san: "Nf6", halfMoves: 2, clock: 305, children: [whiteSecond] });
        const whiteFirst = node({ san: "d4", halfMoves: 1, clock: 304, children: [blackFirst] });
        const root = node({ san: null, halfMoves: 0, children: [whiteFirst] });

        expect(
            getLiveReplayStep({
                headers: headers({ time_control: "300+10" }),
                root,
                position: [0, 0],
            }),
        ).toMatchObject({
            movePath: [0, 0, 0],
            delayMs: 4000,
            moveTimeSeconds: 4,
            clockColor: "white",
            clockStartSeconds: 304,
            clockEndSeconds: 300,
        });
    });

    test("tracks full game replay progress from the selected line", () => {
        const blackFirst = node({ san: "e5", halfMoves: 2, clock: 297 });
        const whiteFirst = node({ san: "e4", halfMoves: 1, clock: 294, children: [blackFirst] });
        const root = node({ san: null, halfMoves: 0, children: [whiteFirst] });

        expect(
            getLiveReplayProgress({
                headers: headers({ time_control: "300+2" }),
                root,
                position: [],
            }),
        ).toMatchObject({
            totalMs: 13000,
            elapsedMs: 0,
            remainingMs: 13000,
            value: 0,
        });
        const duringFirstMove = getLiveReplayProgress({
            headers: headers({ time_control: "300+2" }),
            root,
            position: [],
            currentMoveElapsedMs: 2500,
        });
        expect(duringFirstMove?.elapsedMs).toBe(2500);
        expect(duringFirstMove?.remainingMs).toBe(10500);
        expect(duringFirstMove?.value).toBeCloseTo(19.23, 2);
        expect(
            getLiveReplayProgress({
                headers: headers({ time_control: "300+2" }),
                root,
                position: [0],
            }),
        ).toMatchObject({
            elapsedMs: 8000,
            remainingMs: 5000,
        });
    });

    test("keeps instant moves visible", () => {
        const whiteFirst = node({ san: "e4", halfMoves: 1, timestamp: 100 });
        const root = node({ san: null, halfMoves: 0, timestamp: 100, children: [whiteFirst] });

        expect(
            getLiveReplayStep({
                headers: headers(),
                root,
                position: [],
            })?.delayMs,
        ).toBe(LIVE_REPLAY_MIN_DELAY_MS);
    });

    test("follows a practice path when one is active", () => {
        const mainMove = node({ san: "e4", halfMoves: 1, timestamp: 101 });
        const sideMove = node({ san: "d4", halfMoves: 1, timestamp: 101 });
        const root = node({ san: null, halfMoves: 0, children: [mainMove, sideMove] });

        expect(getLiveReplayNextPath({ root, position: [], practicePath: [1] })).toEqual([1]);
    });
});
