import type {
  TournamentPairing,
  TournamentPlayer,
  TournamentSnapshot,
} from "@/features/tournaments/platform";
import { publishedNoOpponentScore } from "./publishedNoOpponentScore";

export type TournamentSide = "white" | "black";

export interface TournamentGameHistoryRow {
  round: number;
  board: number | null;
  side: TournamentSide;
  opponent: TournamentPlayer;
  score: number;
  result: string;
}

export interface TournamentPlayerStats {
  games: TournamentGameHistoryRow[];
  wins: number;
  draws: number;
  losses: number;
  score: number;
  possibleScore: number;
  averageOpponent: number | null;
  performanceRating: number | null;
  whiteGames: number;
  blackGames: number;
}

const HALF_RESULTS = ["1/2-1/2", "0.5-0.5", "½-½", "0,5-0,5"];

function normalizedResult(result: string | null): string {
  return (result ?? "")
    .replace(/\s+/g, "")
    .replace(/[–—]/g, "-")
    .toLocaleLowerCase();
}

export function pairingScore(pairing: TournamentPairing, side: TournamentSide): number | null {
  if ((pairing.whiteStartNumber === null) !== (pairing.blackStartNumber === null)) {
    if ((side === "white" ? pairing.whiteStartNumber : pairing.blackStartNumber) === null) return null;
    return publishedNoOpponentScore(pairing);
  }
  if (!pairing.decided) return null;
  const result = normalizedResult(pairing.result);
  if (result === "+--") return side === "white" ? 1 : 0;
  if (result === "--+") return side === "black" ? 1 : 0;
  if (result === "---") return 0;
  if (HALF_RESULTS.some((value) => result.includes(value))) return 0.5;
  if (/^1(?:f|w|\+)?-0(?:f|l|-)?/.test(result)) return side === "white" ? 1 : 0;
  if (/^0(?:f|l|-)?-1(?:f|w|\+)?/.test(result)) return side === "black" ? 1 : 0;
  return null;
}

export function playerSideInPairing(
  pairing: TournamentPairing,
  startNumber: number,
): TournamentSide | null {
  if (pairing.whiteStartNumber === startNumber) return "white";
  if (pairing.blackStartNumber === startNumber) return "black";
  return null;
}

export type TournamentStandingPlayer = TournamentPlayer & { scoreKnown: boolean };

function scoreThroughRound(
  snapshot: TournamentSnapshot,
  player: TournamentPlayer,
  round: number,
): { points: number; scoreKnown: boolean } {
  let score = 0;
  let scoreKnown = true;
  const assignedRounds = new Set<number>();
  for (const pairing of snapshot.pairings) {
    if (pairing.round > round) continue;
    const side = playerSideInPairing(pairing, player.startNumber);
    if (!side) continue;
    assignedRounds.add(pairing.round);
    const points = pairingScore(pairing, side);
    if (points === null && (pairing.decided || pairing.round <= snapshot.completedRound ||
      pairing.whiteStartNumber === null || pairing.blackStartNumber === null)) scoreKnown = false;
    score += points ?? 0;
  }
  for (const byeRound of player.halfPointByeRounds ?? []) {
    // The explicit occupied-seat score takes precedence over older bye flags.
    if (byeRound <= round && !assignedRounds.has(byeRound)) score += 0.5;
  }
  return { points: score, scoreKnown };
}

/**
 * Prefer Chess-Results' published rank so tie-break ordering stays exact. Old
 * cached trackers that pre-date roundStandings fall back to a deterministic
 * score/rating order until their next automatic refresh.
 */
export function standingsAfterRound(
  snapshot: TournamentSnapshot,
  round: number,
): TournamentStandingPlayer[] {
  const published = snapshot.roundStandings?.find((standing) => standing.round === round);
  if (published?.players.length) {
    return published.players.map(player => ({ ...player, scoreKnown: true })).sort(
      (left, right) =>
        (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER) ||
        right.points - left.points ||
        left.startNumber - right.startNumber,
    );
  }

  if (round === snapshot.completedRound && snapshot.players.some((player) => player.rank !== null)) {
    return snapshot.players.map(player => ({ ...player, scoreKnown: true })).sort(
      (left, right) =>
        (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER) ||
        right.points - left.points ||
        left.startNumber - right.startNumber,
    );
  }

  const players = snapshot.players
    .map((player) => ({
      ...player,
      ...scoreThroughRound(snapshot, player, round),
      rank: null,
    }))
    .sort(
      (left, right) =>
        right.points - left.points ||
        (right.rating ?? 0) - (left.rating ?? 0) ||
        left.startNumber - right.startNumber,
    )
    .map((player, index) => ({ ...player, rank: index + 1 }));
  // An unknown score can change everyone's order, not just that player's.
  return players.some(player => !player.scoreKnown) ? players.map(player => ({ ...player, rank: null })) : players;
}

export function playerGameHistory(
  snapshot: TournamentSnapshot,
  startNumber: number,
  throughRound = Number.MAX_SAFE_INTEGER,
): TournamentGameHistoryRow[] {
  const players = new Map(snapshot.players.map((player) => [player.startNumber, player]));
  const games: TournamentGameHistoryRow[] = [];
  for (const pairing of snapshot.pairings) {
    if (pairing.round > throughRound) continue;
    const side = playerSideInPairing(pairing, startNumber);
    if (!side) continue;
    const opponentNumber =
      side === "white" ? pairing.blackStartNumber : pairing.whiteStartNumber;
    const opponent = opponentNumber === null ? undefined : players.get(opponentNumber);
    const score = pairingScore(pairing, side);
    // Awarded forfeit points affect standings, but are not played games or a
    // rating-performance sample. Byes already have no named opponent here.
    if (!opponent || score === null || /[fwl+]/i.test(pairing.result ?? "") || normalizedResult(pairing.result) === "---") continue;
    games.push({
      round: pairing.round,
      board: pairing.board,
      side,
      opponent,
      score,
      result: score === 1 ? "Win" : score === 0.5 ? "Draw" : "Loss",
    });
  }
  return games.sort((left, right) => right.round - left.round);
}

export function tournamentPlayerStats(
  snapshot: TournamentSnapshot,
  startNumber: number,
  throughRound = Number.MAX_SAFE_INTEGER,
): TournamentPlayerStats {
  const games = playerGameHistory(snapshot, startNumber, throughRound);
  const wins = games.filter((game) => game.score === 1).length;
  const draws = games.filter((game) => game.score === 0.5).length;
  const losses = games.filter((game) => game.score === 0).length;
  const score = games.reduce((total, game) => total + game.score, 0);
  const rated = games.filter((game) => game.opponent.rating !== null);
  const averageOpponent = rated.length
    ? Math.round(
        rated.reduce((total, game) => total + (game.opponent.rating ?? 0), 0) / rated.length,
      )
    : null;
  let performanceRating: number | null = null;
  if (rated.length && averageOpponent !== null) {
    const ratedScore = rated.reduce((total, game) => total + game.score, 0);
    const percentage = Math.min(0.99, Math.max(0.01, ratedScore / rated.length));
    performanceRating = Math.round(averageOpponent + 400 * Math.log10(percentage / (1 - percentage)));
  }
  return {
    games,
    wins,
    draws,
    losses,
    score,
    possibleScore: games.length,
    averageOpponent,
    performanceRating,
    whiteGames: games.filter((game) => game.side === "white").length,
    blackGames: games.filter((game) => game.side === "black").length,
  };
}

export function projectedSideFromHistory(
  snapshot: TournamentSnapshot,
  userStartNumber: number,
): TournamentSide {
  const games = playerGameHistory(snapshot, userStartNumber);
  const white = games.filter((game) => game.side === "white").length;
  const black = games.length - white;
  return white <= black ? "white" : "black";
}

export function roundPairings(
  snapshot: TournamentSnapshot,
  round: number,
): TournamentPairing[] {
  return snapshot.pairings
    .filter((pairing) => pairing.round === round)
    .sort(
      (left, right) =>
        (left.board ?? Number.MAX_SAFE_INTEGER) - (right.board ?? Number.MAX_SAFE_INTEGER),
    );
}
