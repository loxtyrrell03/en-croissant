import { describe, expect, test } from "vitest";
import {
    formatChessComClock,
    makeChessComClockComment,
    parseChessComMoveClocks,
} from "@/utils/chess.com/clocks";

describe("Chess.com clock helpers", () => {
    test("parses callback move timestamps as remaining clock seconds", () => {
        expect(parseChessComMoveClocks("9042,9059,348,0")).toEqual([904.2, 905.9, 34.8, 0]);
    });

    test("formats simple PGN clock comments", () => {
        expect(formatChessComClock(904.2)).toBe("0:15:04.2");
        expect(formatChessComClock(0)).toBe("0:00:00");
        expect(makeChessComClockComment(905.9)).toBe("[%clk 0:15:05.9]");
    });
});
