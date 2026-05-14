import { describe, expect, test } from "vitest";
import { formatMoveThinkTime, getMoveThinkTime } from "@/utils/clock";
import { defaultTree, type GameHeaders, type TreeNode } from "@/utils/treeReducer";

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

describe("move timing", () => {
    test("calculates move time from clock comments and increment", () => {
        const whiteSecond = node({ san: "Nf3", halfMoves: 3, clock: 284 });
        const blackFirst = node({ san: "e5", halfMoves: 2, clock: 297, children: [whiteSecond] });
        const whiteFirst = node({ san: "e4", halfMoves: 1, clock: 294, children: [blackFirst] });
        const root = node({ san: null, halfMoves: 0, children: [whiteFirst] });

        expect(
            getMoveThinkTime({
                headers: headers({ time_control: "300+2" }),
                root,
                movePath: [0],
            })?.moveTimeSeconds,
        ).toBe(8);
        expect(
            getMoveThinkTime({
                headers: headers({ time_control: "300+2" }),
                root,
                movePath: [0, 0],
            })?.moveTimeSeconds,
        ).toBe(5);
        expect(
            getMoveThinkTime({
                headers: headers({ time_control: "300+2" }),
                root,
                movePath: [0, 0, 0],
            })?.moveTimeSeconds,
        ).toBe(12);
    });

    test("falls back to chess.com move timestamps when clocks are absent", () => {
        const start = Date.UTC(2026, 4, 14, 12, 0, 0) / 1000;
        const blackFirst = node({ san: "e5", halfMoves: 2, timestamp: start + 27 });
        const whiteFirst = node({
            san: "e4",
            halfMoves: 1,
            timestamp: start + 15,
            children: [blackFirst],
        });
        const root = node({ san: null, halfMoves: 0, children: [whiteFirst] });

        expect(
            getMoveThinkTime({
                headers: headers({ date: "2026.05.14", time: "12:00:00" }),
                root,
                movePath: [0],
            })?.moveTimeSeconds,
        ).toBe(15);
        expect(
            getMoveThinkTime({
                headers: headers({ date: "2026.05.14", time: "12:00:00" }),
                root,
                movePath: [0, 0],
            })?.moveTimeSeconds,
        ).toBe(12);
    });

    test("formats move time as simple human text", () => {
        expect(formatMoveThinkTime(8.4)).toBe("8s");
        expect(formatMoveThinkTime(84)).toBe("1m 24s");
        expect(formatMoveThinkTime(3600)).toBe("1h");
    });
});
