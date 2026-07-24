import { describe, expect, test } from "vitest";
import {
    getWebLiveReplayProgress,
    getWebLiveReplayStep,
    WEB_LIVE_REPLAY_MIN_DELAY_MS,
} from "@/web/liveReplay";
import { getWebGameReplayTiming, parsePgnDatabase, webGameToLine } from "@/web/pgn";

function timedGame() {
    return parsePgnDatabase(
        "timed-game.pgn",
        `
[Event "Timed game"]
[Date "2026.07.24"]
[UTCTime "09:00:00"]
[White "White"]
[Black "Black"]
[Result "*"]
[TimeControl "300+2"]

1. e4 {[%clk 0:04:54]} e5 {[%clk 0:04:57]} *
`,
        1,
    ).games[0];
}

describe("phone live replay", () => {
    test("uses the desktop replay pace from PGN clocks", () => {
        const game = timedGame();
        const line = webGameToLine(game);
        const timing = getWebGameReplayTiming(game);

        expect(line[0]).toMatchObject({
            san: "e4",
            clockSeconds: 294,
        });
        expect(
            getWebLiveReplayStep({
                line,
                cursor: 0,
                timing,
            }),
        ).toMatchObject({
            moveIndex: 0,
            delayMs: 8000,
            moveTimeSeconds: 8,
        });
        expect(
            getWebLiveReplayStep({
                line,
                cursor: 1,
                timing,
            }),
        ).toMatchObject({
            moveIndex: 1,
            delayMs: 5000,
            moveTimeSeconds: 5,
        });
    });

    test("tracks whole-game progress while the next move counts down", () => {
        const game = timedGame();
        const line = webGameToLine(game);
        const timing = getWebGameReplayTiming(game);

        expect(
            getWebLiveReplayProgress({
                line,
                cursor: 0,
                timing,
                currentMoveElapsedMs: 2500,
            }),
        ).toMatchObject({
            totalMs: 13000,
            elapsedMs: 2500,
            remainingMs: 10500,
        });
        expect(
            getWebLiveReplayProgress({
                line,
                cursor: 1,
                timing,
            }),
        ).toMatchObject({
            elapsedMs: 8000,
            remainingMs: 5000,
        });
    });

    test("falls back to Chess.com timestamps and keeps instant moves visible", () => {
        const startedAtSeconds = Date.UTC(2026, 6, 24, 9, 0, 0) / 1000;
        const game = parsePgnDatabase(
            "timestamped-game.pgn",
            `
[Event "Timestamped game"]
[UTCDate "2026.07.24"]
[UTCTime "09:00:00"]
[White "White"]
[Black "Black"]
[Result "*"]

1. d4 {[%timestamp ${startedAtSeconds}]} d5 {[%timestamp ${startedAtSeconds + 3}]} *
`,
            1,
        ).games[0];
        const line = webGameToLine(game);
        const timing = getWebGameReplayTiming(game);

        expect(
            getWebLiveReplayStep({
                line,
                cursor: 0,
                timing,
            })?.delayMs,
        ).toBe(WEB_LIVE_REPLAY_MIN_DELAY_MS);
        expect(
            getWebLiveReplayStep({
                line,
                cursor: 1,
                timing,
            })?.delayMs,
        ).toBe(3000);
    });

    test("rehydrates timing for games saved before replay metadata existed", () => {
        const game = timedGame();
        const legacyGame = {
            ...game,
            timeControl: undefined,
            whiteTimeControl: undefined,
            blackTimeControl: undefined,
            startedAtSeconds: undefined,
            moves: game.moves.map(
                ({ clockSeconds: _clockSeconds, timestampSeconds: _timestampSeconds, ...move }) =>
                    move,
            ),
        };

        expect(webGameToLine(legacyGame)[0]?.clockSeconds).toBe(294);
        expect(getWebGameReplayTiming(legacyGame).timeControl).toBe("300+2");
    });
});
