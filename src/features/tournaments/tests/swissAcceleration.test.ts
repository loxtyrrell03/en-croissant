import { describe, expect, test } from "vitest";
import type { TournamentSnapshot } from "@/features/tournaments/platform";
import { calculateExactSwissForecast, declaredSwissAcceleration } from "../exactSwissForecast";
import { calculatePairingForecast } from "../pairingForecast";

function registration(title = "Baku Open", count = 20): TournamentSnapshot {
  return {
    tournamentId: "synthetic-declaration", sourceUrl: "https://chess-results.com/tnr42.aspx", title,
    section: "Open", format: "swiss", formatLabel: "Swiss-System", totalRounds: 9,
    completedRound: 0, publishedRound: 0, liveRound: null, nextRound: 1, phase: "registration",
    dateRange: null, timeControl: null, sourceUpdatedAt: null, fetchedAt: "synthetic", warnings: [], pairings: [],
    players: Array.from({ length: count }, (_, index) => ({ startNumber: index + 1, name: `Player ${index + 1}`,
      fideId: null, federation: null, title: null, rating: 2200 - index * 20, rank: null, points: 0, active: true })),
  };
}

describe("declared acceleration evidence", () => {
  test.each(["Baku Open", "Baku Rapid 2026", "International festival in Baku", "Bakunin Memorial"])("%s does not turn a place or name into a pairing method", title => {
    const event = registration(title);
    expect(declaredSwissAcceleration(event)).toBeNull();
    const exact = calculateExactSwissForecast(event, 1, 1);
    expect(exact).toMatchObject({ opponentStartNumber: 11, acceleration: null });
    const forecast = calculatePairingForecast(event, 1, { exactSwiss: exact });
    expect(forecast.candidates[0].player.startNumber).toBe(11);
    expect(forecast.caveat).not.toContain("Baku acceleration");
  });

  test.each(["Open with Baku acceleration", "Baku-accelerated Open", "Baku-Beschleunigung Open"])("preserves an explicit method phrase: %s", title => {
    const event = registration(title);
    expect(declaredSwissAcceleration(event)).toBe("baku");
    expect(calculateExactSwissForecast(event, 1, 1)).toMatchObject({ opponentStartNumber: 6, acceleration: "baku" });
  });

  test("the format field declares the method and explicit overrides retain precedence", () => {
    const event = { ...registration("City Open"), formatLabel: "Swiss-System (Baku)" };
    expect(declaredSwissAcceleration(event)).toBe("baku");
    expect(calculateExactSwissForecast(event, 1, 1)).toMatchObject({ opponentStartNumber: 6, acceleration: "baku" });
    expect(calculateExactSwissForecast(event, 1, 1, "dutch", null)).toMatchObject({ opponentStartNumber: 11, acceleration: null });
    expect(calculateExactSwissForecast(registration(), 1, 1, "dutch", "baku")).toMatchObject({ opponentStartNumber: 6, acceleration: "baku" });
  });

  test("city-title repair retains the odd-field pairing bye", () => {
    const event = registration("Baku Open", 9);
    expect(calculateExactSwissForecast(event, 1, 1)).toMatchObject({ opponentStartNumber: 5, acceleration: null });
    expect(calculateExactSwissForecast(event, 1, 9)).toMatchObject({ opponentStartNumber: null, acceleration: null });
  });

  test("published accelerated history still supplies an inferred method", () => {
    const event = { ...registration(), nextRound: 2, completedRound: 1, publishedRound: 1, phase: "between-rounds" as const,
      pairings: Array.from({ length: 10 }, (_, i) => {
        const white = i < 5 ? i + 1 : i + 6;
        return { round: 1, board: i + 1, whiteStartNumber: white, blackStartNumber: white + 5,
          whitePoints: 0, blackPoints: 0, result: "1-0", decided: true };
      }),
    };
    expect(declaredSwissAcceleration(event)).toBeNull();
    expect(calculateExactSwissForecast(event, 2, 1)?.acceleration).toBe("two-stage");
  });
});
