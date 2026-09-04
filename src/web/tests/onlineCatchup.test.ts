import { afterEach, expect, test, vi } from "vitest";
import { fetchWebOnlineGamesSince } from "../onlineImport";
afterEach(() => vi.unstubAllGlobals());
test("PC catch-up includes more than 300 completed games and uses end timestamps", async () => {
    const games = Array.from(
        { length: 320 },
        (_, i) =>
            `[Event "Game"]\n[White "Me"]\n[Black "Them"]\n[Date "2026.08.01"]\n[EndDate "2026.09.04"]\n[EndTime "12:00:00"]\n[Link "https://www.chess.com/game/${i}"]\n\n1. e4 e5 1/2-1/2`,
    ).join("\n\n");
    vi.stubGlobal(
        "fetch",
        vi
            .fn()
            .mockResolvedValueOnce(
                Response.json({ archives: ["https://api.chess.com/pub/player/me/games/2026/09"] }),
            )
            .mockResolvedValueOnce(new Response(games)),
    );
    const result = await fetchWebOnlineGamesSince({
        source: "chesscom",
        username: "Me",
        since: Date.parse("2026-09-03"),
    });
    expect(result).toHaveLength(320);
    expect(result[0].playedAt).toBe(Date.parse("2026-09-04T12:00:00Z"));
});
test("a failed archive does not publish a partial catch-up", async () => {
    vi.stubGlobal(
        "fetch",
        vi
            .fn()
            .mockResolvedValueOnce(
                Response.json({ archives: ["https://api.chess.com/pub/player/me/games/2026/09"] }),
            )
            .mockResolvedValueOnce(new Response("", { status: 503 })),
    );
    await expect(
        fetchWebOnlineGamesSince({
            source: "chesscom",
            username: "Me",
            since: Date.parse("2026-09-03"),
        }),
    ).rejects.toThrow("catch-up will retry");
});
test("Lichess catch-up sends its cursor without a batch cap", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(""));
    vi.stubGlobal("fetch", fetcher);
    await fetchWebOnlineGamesSince({ source: "lichess", username: "Me", since: 1000 });
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get("since")).toBe("1000");
    expect(url.searchParams.has("max")).toBe(false);
    expect(url.searchParams.get("ongoing")).toBe("false");
});
