import historicalSwiss from "./fixtures/historicalSwiss.json";
import type {
  TournamentPairing,
  TournamentPlayer,
  TournamentSnapshot,
} from "@/features/tournaments/platform";

export const HISTORICAL_SWISS_FIXTURE_URL = new URL(
  "./fixtures/historicalSwiss.json",
  import.meta.url,
);

export interface HistoricalReplayCase {
  actualOpponent: number;
  player: number;
  snapshot: TournamentSnapshot;
  targetRound: number;
  tournamentId: string;
}

export function loadHistoricalSwissSnapshots(): TournamentSnapshot[] {
  return structuredClone(historicalSwiss) as TournamentSnapshot[];
}

function compactResult(value: string | null): string {
  return (value ?? "").replace(/\s+/g, "").toLocaleLowerCase();
}

function addResult(points: Map<number, number>, pairing: TournamentPairing): void {
  if (!pairing.decided) return;
  const white = pairing.whiteStartNumber;
  const black = pairing.blackStartNumber;
  const result = compactResult(pairing.result);
  const draw = result.includes("½") || result.includes("1/2") || result.includes(".5");
  if (white !== null && black === null) {
    points.set(white, (points.get(white) ?? 0) + (draw ? 0.5 : result.startsWith("1") ? 1 : 0));
    return;
  }
  if (black !== null && white === null) {
    points.set(black, (points.get(black) ?? 0) + (draw ? 0.5 : result.endsWith("1") ? 1 : 0));
    return;
  }
  if (white === null || black === null) return;
  if (draw) {
    points.set(white, (points.get(white) ?? 0) + 0.5);
    points.set(black, (points.get(black) ?? 0) + 0.5);
  } else if (result.startsWith("1") || result.startsWith("+")) {
    points.set(white, (points.get(white) ?? 0) + 1);
  } else if (result.endsWith("1") || result.endsWith("+")) {
    points.set(black, (points.get(black) ?? 0) + 1);
  }
}

function pointsBeforeRound(source: TournamentSnapshot, round: number): Map<number, number> {
  const points = new Map(source.players.map((player) => [player.startNumber, 0]));
  source.pairings
    .filter((pairing) => pairing.round < round)
    .forEach((pairing) => addResult(points, pairing));
  for (const pairing of source.pairings.filter((pairing) => pairing.round === round)) {
    if (pairing.whiteStartNumber !== null && pairing.whitePoints !== null) {
      points.set(pairing.whiteStartNumber, pairing.whitePoints);
    }
    if (pairing.blackStartNumber !== null && pairing.blackPoints !== null) {
      points.set(pairing.blackStartNumber, pairing.blackPoints);
    }
  }
  return points;
}

function pairedPlayersInRound(
  source: TournamentSnapshot,
  round: number,
): Set<number> {
  return new Set(
    source.pairings
      .filter(
        (pairing) =>
          pairing.round === round &&
          pairing.whiteStartNumber !== null &&
          pairing.blackStartNumber !== null,
      )
      .flatMap((pairing) => [pairing.whiteStartNumber!, pairing.blackStartNumber!]),
  );
}

function playersBeforeRound(
  source: TournamentSnapshot,
  round: number,
): TournamentPlayer[] {
  const points = pointsBeforeRound(source, round);
  const pairedPlayers = pairedPlayersInRound(source, round);
  return source.players.map((player) => ({
    ...player,
    points: points.get(player.startNumber) ?? 0,
    notPairedRounds: pairedPlayers.has(player.startNumber)
      ? player.notPairedRounds?.filter((item) => item !== round)
      : player.notPairedRounds,
    // Archived Chess-Results crosstables can list a player as "not paired"
    // after a forfeit even though the pairing itself had been published. Such
    // a player was part of the field when the round was generated.
    active:
      pairedPlayers.has(player.startNumber) ||
      !(player.notPairedRounds?.includes(round) ?? false),
  }));
}

function actualOpponents(
  source: TournamentSnapshot,
  round: number,
  playersPerRound: number | null = 16,
): { opponents: Map<number, number>; players: number[] } {
  const rows = source.pairings
    .filter(
      (pairing) =>
        pairing.round === round &&
        pairing.whiteStartNumber !== null &&
        pairing.blackStartNumber !== null,
    )
    .sort((left, right) => (left.board ?? 9999) - (right.board ?? 9999));
  const opponents = new Map<number, number>();
  for (const pairing of rows) {
    opponents.set(pairing.whiteStartNumber!, pairing.blackStartNumber!);
    opponents.set(pairing.blackStartNumber!, pairing.whiteStartNumber!);
  }
  return {
    opponents,
    players: rows
      .flatMap((pairing) => [pairing.whiteStartNumber!, pairing.blackStartNumber!])
      .slice(0, playersPerRound ?? undefined),
  };
}

export function snapshotBeforeRound(
  source: TournamentSnapshot,
  targetRound: number,
): TournamentSnapshot {
  return {
    ...source,
    completedRound: targetRound - 1,
    publishedRound: targetRound - 1,
    liveRound: null,
    nextRound: targetRound,
    phase: "between-rounds",
    players: playersBeforeRound(source, targetRound),
    pairings: source.pairings.filter((pairing) => pairing.round < targetRound),
  };
}

export function snapshotDuringRound(
  source: TournamentSnapshot,
  liveRound: number,
  resolvedFraction: number,
): TournamentSnapshot {
  const currentRows = source.pairings
    .filter((pairing) => pairing.round === liveRound)
    .sort((left, right) => (left.board ?? 9999) - (right.board ?? 9999));
  const decidedGames = currentRows.filter(
    (pairing) => pairing.whiteStartNumber !== null && pairing.blackStartNumber !== null,
  );
  const resolvedCount = Math.round(decidedGames.length * resolvedFraction);
  let seenGames = 0;
  const pairedNextRound = pairedPlayersInRound(source, liveRound + 1);
  const partialRows = currentRows.map((pairing) => {
    if (pairing.whiteStartNumber === null || pairing.blackStartNumber === null) return pairing;
    seenGames += 1;
    return seenGames <= resolvedCount
      ? pairing
      : { ...pairing, result: null, decided: false };
  });
  return {
    ...source,
    completedRound: liveRound - 1,
    publishedRound: liveRound,
    liveRound,
    nextRound: liveRound + 1,
    phase: "round-in-progress",
    players: playersBeforeRound(source, liveRound).map((player) => ({
      ...player,
      notPairedRounds: pairedNextRound.has(player.startNumber)
        ? player.notPairedRounds?.filter((item) => item !== liveRound + 1)
        : player.notPairedRounds,
      active:
        pairedNextRound.has(player.startNumber) ||
        !(player.notPairedRounds?.includes(liveRound + 1) ?? false),
    })),
    pairings: [
      ...source.pairings.filter((pairing) => pairing.round < liveRound),
      ...partialRows,
    ],
  };
}

export function completedRoundReplayCases(
  snapshots: TournamentSnapshot[],
  playersPerRound: number | null = 16,
): HistoricalReplayCase[] {
  return snapshots.flatMap((source) =>
    Array.from({ length: Math.max(0, source.totalRounds - 1) }, (_, index) => index + 2)
      .flatMap((targetRound) => {
        const { opponents, players } = actualOpponents(
          source,
          targetRound,
          playersPerRound,
        );
        const snapshot = snapshotBeforeRound(source, targetRound);
        return players.flatMap((player) => {
          const actualOpponent = opponents.get(player);
          return actualOpponent === undefined
            ? []
            : [{ actualOpponent, player, snapshot, targetRound, tournamentId: source.tournamentId }];
        });
      }),
  );
}

export function liveRoundReplayCases(
  snapshots: TournamentSnapshot[],
  resolvedFraction: number,
  playersPerRound: number | null = 16,
): HistoricalReplayCase[] {
  return snapshots.flatMap((source) =>
    Array.from({ length: Math.max(0, source.totalRounds - 1) }, (_, index) => index + 1)
      .flatMap((liveRound) => {
        const targetRound = liveRound + 1;
        const { opponents, players } = actualOpponents(
          source,
          targetRound,
          playersPerRound,
        );
        const snapshot = snapshotDuringRound(source, liveRound, resolvedFraction);
        return players.flatMap((player) => {
          const actualOpponent = opponents.get(player);
          return actualOpponent === undefined
            ? []
            : [{ actualOpponent, player, snapshot, targetRound, tournamentId: source.tournamentId }];
        });
      }),
  );
}
