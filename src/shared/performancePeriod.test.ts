import { afterEach, expect, it, vi } from "vitest";
import { customPerformancePeriod, performanceDurationLabel } from "./performancePeriod";
import { selectPerformancePeriod, selectResultPeriod, type PerformanceGame, type PerformancePeriod } from "./truePerformance";
import { fetchOnlinePerformance, performanceCacheKey, performanceFetchBounds } from "./onlinePerformance";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const now = Date.UTC(2026, 9, 1, 12) / 1000;

it.each<[PerformancePeriod, number]>([["1d", 86400], ["3d", 259200], ["12h", 43200], ["1.5d", 129600], ["2w", 1209600]])(
  "uses the same exact %s boundary in requests, results and performance",
  (period, seconds) => {
    const since = now - seconds;
    const games: PerformanceGame[] = [-1, 0, 1, seconds, seconds + 1].map((offset, i) => ({
      id: String(i), pool: "test:blitz", at: since + offset, rated: true,
      rating: 1800, opponentRating: 1800, score: 1, opponent: "Test", white: true,
    }));
    expect(performanceFetchBounds(period, now).since).toBe(since);
    expect(selectResultPeriod(games, period, now).map(g => g.id)).toEqual(["1", "2", "3"]);
    expect(selectPerformancePeriod(games, period, now).map(g => g.id)).toEqual(["1", "2", "3"]);
    const missingRatings = games.map(g => ({ ...g, opponentRating: null }));
    expect(selectResultPeriod(missingRatings, period, now)).toHaveLength(3);
    expect(selectPerformancePeriod(missingRatings, period, now)).toHaveLength(0);
  },
);

it("accepts fractional durations, labels units and rejects invalid input", () => {
  expect(customPerformancePeriod(" 1.50 ", "d")).toBe("1.5d");
  expect(customPerformancePeriod(".5", "h")).toBe("0.5h");
  expect(customPerformancePeriod("1e-8", "h")).toBe("1e-8h");
  for (const value of ["", " ", "0", "-2", "NaN", "Infinity", "1e100", "0x10"])
    expect(customPerformancePeriod(value, "d")).toBeNull();
  expect(performanceDurationLabel("1d")).toBe("1 day");
  expect(performanceDurationLabel("1.5d")).toBe("1.5 days");
  expect(performanceDurationLabel("12h")).toBe("12 hours");
  expect(performanceDurationLabel("2w")).toBe("2 weeks");
  expect(performanceFetchBounds("100000d", now).since).toBe(0);
});

it("isolates cached custom durations and keeps last-N and all-loaded behavior", () => {
  const account = { id: "test", provider: "lichess" as const, username: "PeriodTest" };
  expect(performanceCacheKey(account, "blitz", "rated", "12h"))
    .not.toBe(performanceCacheKey(account, "blitz", "rated", "13h"));
  expect(performanceFetchBounds("20g", now)).toEqual({ limit: 20, requestedGames: 20, since: null });
  expect(performanceFetchBounds("all", now)).toEqual({ limit: 5000, requestedGames: null, since: null });
});

it("requests the exact custom Lichess duration and excludes out-of-range returned games", async () => {
  vi.spyOn(Date, "now").mockReturnValue(now * 1000);
  const account = { id: "lichess:periodtest", provider: "lichess" as const, username: "PeriodTest" };
  const raw = [-1, 0, 1].map((offset, i) => ({
    id: `period0${i}`, variant: "standard", rated: true, speed: "blitz", status: "mate", winner: "white",
    lastMoveAt: (now - 12 * 3600 + offset) * 1000,
    players: { white: { user: { name: "PeriodTest" }, rating: 1800 }, black: { user: { name: "Rival" }, rating: 1800 } },
  }));
  const fetcher = vi.fn().mockResolvedValue(new Response(raw.map(g => JSON.stringify(g)).join("\n")));
  vi.stubGlobal("fetch", fetcher);
  const snapshot = await fetchOnlinePerformance(account, "blitz", new AbortController().signal, () => {}, {}, "rated", "12h");
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get("since")).toBe(String((now - 43200) * 1000));
  expect(snapshot.games.map(g => g.id)).toEqual(["period01", "period02"]);
});

it("loads a custom Chess.com window across a month boundary without scanning older months", async () => {
  vi.spyOn(Date, "now").mockReturnValue(now * 1000);
  const root = "https://api.chess.com/pub/player/PeriodTest/games";
  const fetcher = vi.fn(async (input: string) => {
    if (input.endsWith("/archives")) return new Response(JSON.stringify({ archives: [`${root}/2026/08`, `${root}/2026/09`, `${root}/2026/10`] }));
    const at = input.endsWith("/09") ? now - 86400 : now - 3600;
    return new Response(JSON.stringify({ games: [{
      url: `https://www.chess.com/game/live/${at}`, rules: "chess", rated: true, time_class: "blitz", end_time: at,
      white: { username: "PeriodTest", result: "win" }, black: { username: "Rival", result: "resigned", rating: 1800 }, pgn: '[WhiteElo "1800"]',
    }] }));
  });
  vi.stubGlobal("fetch", fetcher);
  const snapshot = await fetchOnlinePerformance({ id: "chesscom:periodtest", provider: "chesscom", username: "PeriodTest" }, "blitz", new AbortController().signal, () => {}, {}, "rated", "1.5d");
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([`${root}/archives`, `${root}/2026/10`, `${root}/2026/09`]);
  expect(snapshot.games).toHaveLength(2);
});
