import type { TournamentSnapshot } from "@/features/tournaments/platform";
import type { PairingForecast } from "../pairingForecast";
import { createTournamentPrepRecord } from "../tournamentPrepStore";
export function trackerFixture() {
  const names = ["Jordan Vale", "Alex Morgan", "Sam Rivera", "Jamie Chen", "Robin Ellis", "Casey Bell", "Taylor Reed"];
  const snapshot: TournamentSnapshot = {
    tournamentId: "42", sourceUrl: "https://chess-results.com/tnr42.aspx", title: "Cardiff Autumn Open", section: "Open",
    format: "swiss", formatLabel: "Swiss-System", totalRounds: 7, completedRound: 4, publishedRound: 4, liveRound: null, nextRound: 5,
    phase: "between-rounds", dateRange: null, timeControl: "90 min + 30 sec", sourceUpdatedAt: null, fetchedAt: "2026-09-08T12:00:00Z", warnings: [],
    players: names.map((name, index) => ({ startNumber: index + 1, name, fideId: String(100000 + index), federation: "ENG", title: null, rating: 2050 + index * 25, rank: index + 1, points: index === 0 ? 3 : 2.5, active: true })),
    pairings: [{ round: 1, board: 1, whiteStartNumber: 1, blackStartNumber: 3, whitePoints: 0, blackPoints: 0, result: "1-0", decided: true }],
  };
  const record = createTournamentPrepRecord(snapshot, 1, 2023);
  record.opponents["2"] = { ...record.opponents["2"], collectionId: 12, status: "ready", gameCount: 128 };
  record.opponents["4"] = { ...record.opponents["4"], collectionId: 14, status: "no-games", gameCount: 0 };
  const probabilities = [.42, .23, .14, .08, .05, .03];
  const forecast: PairingForecast = { kind: "estimated", round: 5, confidence: "medium", otherProbability: .05, summary: "Likely round 5 opponents", caveat: "Unknown organiser settings can change pairings.", candidates: snapshot.players.slice(1).map((player, index) => ({ player, probability: probabilities[index], color: index % 2 ? "black" : "white", board: null, reasons: [] })) };
  return { record, forecast };
}
