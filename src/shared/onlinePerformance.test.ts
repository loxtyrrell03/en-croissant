import { it, expect, vi, afterEach } from "vitest";
import {
    normaliseChessComPerformance,
    normaliseLichessPerformance,
    fetchOnlinePerformance,
} from "./onlinePerformance";
const account = { id: "chesscom:alice", provider: "chesscom" as const, username: "Alice" };
afterEach(() => vi.unstubAllGlobals());
it("uses Chess.com PGN pre-game ratings, rejects unfinished/casual/wrong-user games", () => {
    const g = {
        url: "https://www.chess.com/game/live/1",
        rules: "chess",
        rated: true,
        time_class: "blitz",
        end_time: 1700000000,
        white: { username: "Alice", rating: 1990, result: "win" },
        black: { username: "Bob", rating: 1800, result: "resigned" },
        pgn: '[WhiteElo "1980"]\n[BlackElo "1810"]',
    };
    expect(normaliseChessComPerformance(g, account, "blitz")).toMatchObject({
        rating: 1980,
        opponentRating: 1810,
        score: 1,
    });
    expect(normaliseChessComPerformance({ ...g, rated: false }, account, "blitz")).toBeNull();
    expect(
        normaliseChessComPerformance(
            { ...g, white: { ...g.white, result: "abandoned" } },
            account,
            "blitz",
        ),
    ).toBeNull();
});
it("does not turn a Lichess aborted game into a draw or apply ratingDiff as prior evidence", () => {
    const a = { id: "lichess:alice", provider: "lichess" as const, username: "Alice" };
    const g = {
        id: "abcd1234",
        variant: "standard",
        rated: true,
        speed: "blitz",
        status: "mate",
        winner: "white",
        createdAt: 1700000000000,
        players: {
            white: { user: { name: "Alice" }, rating: 1800, ratingDiff: 8 },
            black: { user: { name: "Bob" }, rating: 1810, provisional: true },
        },
    };
    expect(normaliseLichessPerformance(g, a, "blitz")).toMatchObject({
        rating: 1800,
        opponentSd: 150,
        score: 1,
    });
    expect(
        normaliseLichessPerformance({ ...g, status: "aborted", winner: undefined }, a, "blitz"),
    ).toBeNull();
});
it("never follows an untrusted archive URL and does not silently return partial failures", async () => {
    const fetch = vi
        .fn()
        .mockResolvedValue(
            new Response(JSON.stringify({ archives: ["https://attacker.invalid/games"] })),
        );
    vi.stubGlobal("fetch", fetch);
    await expect(
        fetchOnlinePerformance(account, "blitz", new AbortController().signal, () => {}),
    ).rejects.toThrow("Unexpected");
    expect(fetch).toHaveBeenCalledTimes(1);
});
