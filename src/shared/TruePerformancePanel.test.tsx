import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TruePerformanceOnline } from "./TruePerformanceOnline";
import { TruePerformancePanel } from "./TruePerformancePanel";
import type { PerformanceGame } from "./truePerformance";

const calculation = vi.hoisted(() => ({ ready: false }));
vi.mock("./usePerformanceCalculation", () => ({
  usePerformanceCalculation: (request: { kind: string; games: PerformanceGame[] } | null) => {
    const retry = () => {};
    if (!request) return { status: "idle", value: null, error: null, retry };
    if (!calculation.ready) return { status: "loading", value: null, error: null, retry };
    const points = request.games.map(game => ({ ...game, mean: 1800, low: 1700, high: 1900, sd: 50 }));
    return { status: "ready", error: null, retry, value: request.kind === "period" ? points : { points, games: request.games, excluded: 0 } };
  },
}));
beforeEach(() => { calculation.ready = false; });

const games: PerformanceGame[] = Array.from({ length: 6 }, (_, index) => ({
  id: String(index),
  pool: "chesscom:alice:blitz",
  at: 1_800_000_000 + index * 60,
  rating: 1800,
  opponentRating: 1800,
  score: index % 2 === 0 ? 1 : 0,
  white: index % 2 === 0,
  opponent: "Opponent",
  rated: true,
}));

describe("online performance range UI", () => {
  it("shows the range control before account history has loaded", () => {
    const html = renderToStaticMarkup(
      <TruePerformanceOnline
        accounts={[{ id: "chesscom:alice", provider: "chesscom", username: "Alice" }]}
      />,
    );
    expect(html).toContain('aria-label="Performance period"');
    expect(html).toContain("30 days");
    expect(html).toContain("Last day");
    expect(html).toContain("Last 3 days");
    expect(html).toContain("Custom…");
    expect(html).toContain("Loading account history");
  });

  it.each(["1d", "12h", "1.5d", "2w"] as const)("labels the exact %s selected duration", (period) => {
    const html = renderToStaticMarkup(<TruePerformancePanel games={games} period={period} poolLabel="Synthetic pool" asOf={games.at(-1)!.at + 60} />);
    const label = { "1d": "1 day", "12h": "12 hours", "1.5d": "1.5 days", "2w": "2 weeks" }[period];
    expect(html).toContain(`How well did you play over the last ${label}?`);
  });

  it("names the completed calculation and chart accurately and exposes the confidence band", () => {
    calculation.ready = true;
    const html = renderToStaticMarkup(
      <TruePerformancePanel
        games={games}
        period="30d"
        poolLabel="Chess.com · blitz"
        asOf={games.at(-1)!.at + 60}
        coverage="6 games fetched for 30 days"
      />,
    );
    expect(html).toContain("How well did you play over the last 30 days?");
    expect(html).toContain("95% model confidence band");
    expect(html).toContain("about ±");
    expect(html).toContain("Performance rating over selected games");
    expect(html).not.toContain(">Rating over time<");
  });

  it("renders loading without running the estimator during the first render", () => {
    const html = renderToStaticMarkup(<TruePerformancePanel games={games} period="30d" poolLabel="Synthetic pool" asOf={games.at(-1)!.at + 60} />);
    expect(html).toContain("Calculating performance...");
    expect(html).toContain('aria-label="Game results"');
    expect(html).not.toContain('aria-label="Performance rating over selected games"');
    expect(html).not.toContain("Not enough games");
  });

  it("shows a clear unavailable state instead of an accent-coloured dash when too few games qualify", () => {
    const html = renderToStaticMarkup(
      <TruePerformancePanel
        games={games.slice(0, 2)}
        period="30d"
        poolLabel="Chess.com · blitz"
        asOf={games[1].at + 60}
        coverage="2 games fetched for 30 days"
      />,
    );
    expect(html).toContain("Not enough games");
    expect(html).toContain("Needs at least 3 games with opponent ratings.");
    expect(html).not.toContain(">—</strong>");
  });
});
