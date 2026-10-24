import { it, expect, vi, afterEach } from "vitest";
import {
  normaliseChessComPerformance,
  chessComOpeningName,
  readableOpeningName,
  normaliseLichessPerformance,
  fetchOnlinePerformance,
  performanceFetchBounds,
  performanceCacheKey,
} from "./onlinePerformance";
const account = { id: "chesscom:alice", provider: "chesscom" as const, username: "Alice" };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
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

it("keeps rated, unrated and combined cache identities separate", () => {
  expect(
    new Set(
      ["rated", "unrated", "both"].map((kind) =>
        performanceCacheKey(account, "blitz", kind as "rated" | "unrated" | "both"),
      ),
    ).size,
  ).toBe(3);
  expect(performanceCacheKey(account, "blitz", "rated", "30d")).not.toBe(
    performanceCacheKey(account, "blitz", "rated", "20g"),
  );
});
it.each(["rated", "unrated", "both"] as const)(
  "requests and normalises the %s Lichess sample",
  async (kind) => {
    const a = { ...account, provider: "lichess" as const };
    const games = [true, false].map((rated, i) => ({
      id: `abcd123${i}`,
      rated,
      variant: "standard",
      speed: "blitz",
      status: "mate",
      winner: "white",
      createdAt: 1700000000000,
      players: {
        white: { user: { name: "Alice" }, rating: 1800 },
        black: { user: { name: "Bob" }, rating: 1800 },
      },
    }));
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(games.map((g) => JSON.stringify(g)).join("\n")));
    vi.stubGlobal("fetch", fetcher);
    const result = await fetchOnlinePerformance(
      a,
      "blitz",
      new AbortController().signal,
      () => {},
      {},
      kind,
    );
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get("rated")).toBe(kind === "both" ? null : String(kind === "rated"));
    expect(result.games.map((g) => g.rated)).toEqual(
      kind === "both" ? [true, false] : [kind === "rated"],
    );
  },
);
it("preserves an unrated Chess.com result when requested", () => {
  const raw = {
    url: "https://www.chess.com/game/live/2",
    rules: "chess",
    rated: false,
    time_class: "blitz",
    end_time: 1700000000,
    white: { username: "Alice", result: "win" },
    black: { username: "Bob", result: "resigned", rating: 1800 },
    pgn: '[WhiteElo "1800"]',
  };
  expect(normaliseChessComPerformance(raw, account, "blitz", "unrated")?.rated).toBe(false);
  expect(normaliseChessComPerformance(raw, account, "blitz", "both")?.score).toBe(1);
  expect(normaliseChessComPerformance(raw, account, "blitz", "rated")).toBeNull();
});

it("uses opening names and ECOUrl, never a bare ECO code", () => {
  expect(chessComOpeningName('[ECO "B20"]')).toBeUndefined();
  expect(readableOpeningName(" B20 ")).toBeUndefined();
  expect(
    chessComOpeningName('[ECOUrl "https://www.chess.com/openings/Sicilian-Defense-2.Nf3"]'),
  ).toBe("Sicilian Defense");
  expect(chessComOpeningName('[Opening "Italian Game"]')).toBe("Italian Game");
  expect(chessComOpeningName('[ECOUrl "https://attacker.invalid/openings/Fake"]')).toBeUndefined();
});

it("turns each range into the smallest provider request that can satisfy it", () => {
  const now = 1_800_000_000;
  expect(performanceFetchBounds("20g", now)).toEqual({
    limit: 20,
    requestedGames: 20,
    since: null,
  });
  expect(performanceFetchBounds("30d", now)).toEqual({
    limit: 5000,
    requestedGames: null,
    since: now - 30 * 86400,
  });
});

it("asks Lichess only for the selected game count or date window", async () => {
  const a = { ...account, provider: "lichess" as const };
  const fetcher = vi.fn().mockImplementation(async () => new Response(""));
  vi.stubGlobal("fetch", fetcher);

  await fetchOnlinePerformance(
    a,
    "blitz",
    new AbortController().signal,
    () => {},
    {},
    "rated",
    "20g",
  );
  let url = new URL(fetcher.mock.calls[0][0]);
  expect(url.searchParams.get("max")).toBe("20");
  expect(url.searchParams.has("since")).toBe(false);

  fetcher.mockClear();
  const startedAt = Date.now();
  await fetchOnlinePerformance(
    a,
    "blitz",
    new AbortController().signal,
    () => {},
    {},
    "rated",
    "30d",
  );
  url = new URL(fetcher.mock.calls[0][0]);
  expect(url.searchParams.get("max")).toBe("5000");
  expect(Number(url.searchParams.get("since"))).toBeGreaterThanOrEqual(startedAt - 30 * 86400_000);
});

const chessComGame = (id: number, at: number) => ({
  url: `https://www.chess.com/game/live/${id}`,
  rules: "chess",
  rated: true,
  time_class: "blitz",
  end_time: at,
  white: { username: "Alice", result: "win" },
  black: { username: "Bob", result: "resigned", rating: 1800 },
  pgn: '[WhiteElo "1800"]\n[BlackElo "1800"]',
});

it("reads only Chess.com months that overlap a selected date range", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 10));
  const archiveRoot = "https://api.chess.com/pub/player/Alice/games";
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/archives"))
      return new Response(
        JSON.stringify({
          archives: [
            `${archiveRoot}/2024/01`,
            `${archiveRoot}/2026/07`,
            `${archiveRoot}/2026/08`,
            `${archiveRoot}/2026/09`,
          ],
        }),
      );
    const at = url.endsWith("/08") ? Date.UTC(2026, 7, 20) / 1000 : Date.UTC(2026, 8, 5) / 1000;
    return new Response(JSON.stringify({ games: [chessComGame(at, at)] }));
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await fetchOnlinePerformance(
    account,
    "blitz",
    new AbortController().signal,
    () => {},
    {},
    "rated",
    "30d",
  );
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
    `${archiveRoot}/archives`,
    `${archiveRoot}/2026/09`,
    `${archiveRoot}/2026/08`,
  ]);
  expect(result.games).toHaveLength(2);
});

it("stops Chess.com archive loading as soon as the selected last-N sample is full", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 10));
  const archiveRoot = "https://api.chess.com/pub/player/Alice/games";
  const september = Array.from({ length: 30 }, (_, i) =>
    chessComGame(i, Date.UTC(2026, 8, 1 + i / 4) / 1000),
  );
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/archives"))
      return new Response(
        JSON.stringify({ archives: [`${archiveRoot}/2026/08`, `${archiveRoot}/2026/09`] }),
      );
    return new Response(JSON.stringify({ games: september }));
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await fetchOnlinePerformance(
    account,
    "blitz",
    new AbortController().signal,
    () => {},
    {},
    "rated",
    "20g",
  );
  expect(result.games).toHaveLength(20);
  expect(result.limited).toBe(false);
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
    `${archiveRoot}/archives`,
    `${archiveRoot}/2026/09`,
  ]);
});
