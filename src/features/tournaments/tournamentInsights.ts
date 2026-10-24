import { publishedGameResult, publishedPairingScore } from "./publishedPairingResult";
import { cachedTournamentEvidence } from "./tournamentForecastEvidence";
import type { EvidenceTournamentSnapshot } from "./tournamentSnapshotEvidenceTypes";
import type {
  TournamentPairing,
  TournamentPlayer,
  TournamentSnapshot,
} from "@/features/tournaments/platform";

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

export function pairingScore(pairing: TournamentPairing, side: TournamentSide): number | null {
  const player = side === "white" ? pairing.whiteStartNumber : pairing.blackStartNumber;
  return player === null ? null : publishedPairingScore(pairing, player);
}

export function playerSideInPairing(
  pairing: TournamentPairing,
  startNumber: number,
): TournamentSide | null {
  if (pairing.whiteStartNumber === startNumber) return "white";
  if (pairing.blackStartNumber === startNumber) return "black";
  return null;
}

export type TournamentStandingPlayer = TournamentPlayer & {
  scoreKnown: boolean;
  rankSource: "published" | "reconstructed" | "unknown";
};
const standingCache = new WeakMap<TournamentSnapshot, Map<number, TournamentStandingPlayer[]>>();
const validRank = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

/** Rank authority is independent of score availability. A partial published
 * table cannot supply invented ranks for the rest of the source roster. */
export const hasPublishedStandingRanks = (players: TournamentStandingPlayer[]) =>
  players.some(player => player.rankSource === "published");

/**
 * Exact-scope published ranks retain organiser tie-breaks. Versionless numeric
 * defaults are not score evidence: only complete recognised history can recover
 * them. A live display scope does not change the source's completion metadata.
 */
export function standingsAfterRound(
  snapshot: TournamentSnapshot,
  round: number,
): TournamentStandingPlayer[] {
  const saved = standingCache.get(snapshot)?.get(round);
  if (saved) return saved;
  const source: EvidenceTournamentSnapshot = snapshot;
  const scopeValid = Number.isSafeInteger(round) && round >= 0 &&
    (snapshot.totalRounds === 0 || round <= snapshot.totalRounds);
  const evidence = scopeValid ? cachedTournamentEvidence({ ...source, completedRound: round }, round + 1) : null;
  const scores = new Map(evidence?.players.map(player => [player.startNumber, player.aggregate]));
  const publishedRows = source.evidenceVersion === 1 && Array.isArray(source.roundStandings)
    ? source.roundStandings.filter(table => table?.round === round && Array.isArray(table.players)).flatMap(table => table.players)
    : [];
  const players: TournamentStandingPlayer[] = source.players.map(player => {
    const score = scores.get(player.startNumber);
    const rows = publishedRows.filter(row => row?.startNumber === player.startNumber);
    let rank: number | null = null;
    if (evidence && source.evidenceVersion === 1 && rows.length === 1 && validRank(rows[0].rank)) rank = rows[0].rank;
    else if (evidence && source.evidenceVersion === 1 && rows.length === 0 && player.scoreKnown === true &&
      player.scoreSource === "published" && player.scoreRound === round && validRank(player.rank)) rank = player.rank;
    const known = Boolean(score?.scoreKnown && score.throughRound === round && score.points !== null);
    return { ...player, points: known ? score!.points! : 0, scoreKnown: known,
      scoreRound: known ? round : null, scoreSource: known ? score!.source : "unknown",
      rank, rankSource: rank !== null ? "published" : "unknown" };
  });
  players.sort((left, right) =>
    (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER) ||
    Number(right.scoreKnown) - Number(left.scoreKnown) ||
    (left.scoreKnown && right.scoreKnown ? right.points - left.points : 0) ||
    (right.rating ?? 0) - (left.rating ?? 0) || left.startNumber - right.startNumber);
  // Derived order needs all totals; never mix it with a partial published order.
  if (scopeValid && evidence && players.every(player => player.scoreKnown) && !hasPublishedStandingRanks(players)) {
    players.forEach((player, index) => { player.rank = index + 1; player.rankSource = "reconstructed"; });
  }
  let rounds = standingCache.get(snapshot);
  if (!rounds) { rounds = new Map(); standingCache.set(snapshot, rounds); }
  rounds.set(round, players);
  return players;
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
    if (!opponent || score === null || publishedGameResult(pairing)?.forfeit) continue;
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
