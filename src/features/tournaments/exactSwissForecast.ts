import { publishedGameResult } from "./publishedPairingResult";
import { normalizeTournamentResults } from "./normalizeTournamentResults";
import { publishedNoOpponentScore, hasUnscoredNoOpponentHistory } from "./publishedNoOpponentScore";
import { pair as pairDutch } from "@echecs/swiss/dutch";
import { pair as pairBurstein } from "@echecs/swiss/burstein";
import { pair as pairDubov } from "@echecs/swiss/dubov";
import { pair as pairLim } from "@echecs/swiss/lim";
import type { Bye, CompletedRound, Game, Player } from "@echecs/swiss";
import { swissParticipationScenario } from "./swissParticipation";
import type { PairingHistoryReliability } from "./pairingHistoryCalibration";
import type {
  TournamentPairing,
  TournamentPlayer,
  TournamentSnapshot,
} from "@/features/tournaments/platform";

export interface ExactSwissForecast {
  history?: PairingHistoryReliability;
  sampling?: { samples: number; successful: number };
  opponentStartNumber: number | null;
  color: "white" | "black" | null;
  estimatedLiveResults: boolean;
  system: SwissPairingSystem;
  acceleration: SwissAcceleration | null;
}

import { declaredSwissAcceleration, inferSwissAcceleration, accelerationVirtualPoints } from "./swissPairingSettings";
import type { SwissPairingSystem, SwissAcceleration } from "./swissPairingSettings";
export { declaredSwissAcceleration, inferSwissAcceleration, swissPairingSystemFor } from "./swissPairingSettings";
export type { SwissPairingSystem, SwissAcceleration } from "./swissPairingSettings";

interface CachedExactRound {
  targetRound: number;
  system: SwissPairingSystem;
  acceleration: SwissAcceleration | null;
  forecasts: Map<number, ExactSwissForecast> | null;
}

const exactRoundCache = new WeakMap<TournamentSnapshot, CachedExactRound>();

const pairingSystems = {
  dutch: pairDutch,
  burstein: pairBurstein,
  dubov: pairDubov,
  lim: pairLim,
} satisfies Record<SwissPairingSystem, typeof pairDutch>;

function virtualAccelerationRound(
  snapshot: TournamentSnapshot,
  players: Player[],
  points: number,
): CompletedRound {
  const gaSize = 2 * Math.ceil(snapshot.players.length / 4);
  const gaPlayers = new Set(
    [...snapshot.players]
      .sort((left, right) => left.startNumber - right.startNumber)
      .slice(0, gaSize)
      .map((player) => String(player.startNumber)),
  );
  return {
    games: [],
    byes: players.map((player) => ({
      player: player.id,
      kind: gaPlayers.has(player.id) ? (points === 1 ? "pairing" : "half") : "zero",
    })),
  };
}

function playedGame(pairing: TournamentPairing): Game | null {
  const result = publishedGameResult(pairing);
  if (!result) return null;
  const base = { white: String(pairing.whiteStartNumber), black: String(pairing.blackStartNumber) };
  if (result.forfeit === "both") return { ...base, result: "none", forfeit: "both" };
  if (result.forfeit === "white") return { ...base, result: "black", forfeit: "white" };
  if (result.forfeit === "black") return { ...base, result: "white", forfeit: "black" };
  return result.result === "none" ? null : { ...base, result: result.result };
}

function mostLikelyGame(
  pairing: TournamentPairing,
  players: Map<number, TournamentPlayer>,
): Game | null {
  if (pairing.whiteStartNumber === null || pairing.blackStartNumber === null) return null;
  const white = players.get(pairing.whiteStartNumber);
  const black = players.get(pairing.blackStartNumber);
  const base = {
    white: String(pairing.whiteStartNumber),
    black: String(pairing.blackStartNumber),
  };
  if (!white?.rating || !black?.rating) return { ...base, result: "draw" };
  const whiteExpected = 1 / (1 + 10 ** ((black.rating - white.rating) / 400));
  if (whiteExpected >= 0.64) return { ...base, result: "white" };
  if (whiteExpected <= 0.36) return { ...base, result: "black" };
  return { ...base, result: "draw" };
}

function pairingBye(pairing: TournamentPairing): Bye | null {
  if (pairing.whiteStartNumber !== null && pairing.blackStartNumber !== null) return null;
  const player = pairing.whiteStartNumber ?? pairing.blackStartNumber;
  if (player === null) return null;
  const score = publishedNoOpponentScore(pairing);
  if (score === null) return null;
  const kind = score === 0.5 ? "half" : score === 1 ? "pairing" : "zero";
  return { player: String(player), kind };
}

function completedRounds(
  snapshot: TournamentSnapshot,
  targetRound: number,
  players: Map<number, TournamentPlayer>,
): { rounds: CompletedRound[]; estimatedLiveResults: boolean } {
  let estimatedLiveResults = false;
  const rounds = Array.from({ length: targetRound - 1 }, (_, offset) => {
    const round = offset + 1;
    const rows = snapshot.pairings.filter((pairing) => pairing.round === round);
    const games = rows.flatMap((pairing) => {
      const decided = playedGame(pairing);
      if (decided) return [decided];
      const estimated = mostLikelyGame(pairing, players);
      if (estimated) estimatedLiveResults = true;
      return estimated ? [estimated] : [];
    });
    const byes = rows.map(pairingBye).filter((bye): bye is Bye => bye !== null);
    for (const player of snapshot.players) {
      if (
        player.halfPointByeRounds?.includes(round) &&
        !byes.some((bye) => bye.player === String(player.startNumber))
      ) {
        byes.push({ player: String(player.startNumber), kind: "half" });
      }
    }
    return { games, byes };
  });
  return { rounds, estimatedLiveResults };
}

function enginePlayers(snapshot: TournamentSnapshot, targetRound: number): Player[] {
  return snapshot.players
    .filter(
      (player) => player.active && !player.notPairedRounds?.includes(targetRound),
    )
    .sort((left, right) => left.startNumber - right.startNumber)
    .map((player, index) => ({
      id: String(player.startNumber),
      name: player.name,
      points: player.points,
      rank: index + 1,
      startingRank: player.startNumber,
      ...(player.rating ? { rating: player.rating } : {}),
    }));
}

export function calculateExactSwissForecast(
  snapshot: TournamentSnapshot,
  targetRound: number,
  myStartNumber: number,
  system: SwissPairingSystem = "dutch",
  accelerationOverride: SwissAcceleration | null | "auto" = "auto",
): ExactSwissForecast | null {
  snapshot = normalizeTournamentResults(snapshot);
  if (hasUnscoredNoOpponentHistory(snapshot, targetRound)) return null;
  snapshot = swissParticipationScenario(snapshot, targetRound);
  if (snapshot.incompletePairingRounds?.some(round => round > 0 && round < targetRound)) return null;
  const acceleration =
    accelerationOverride === "auto"
      ? declaredSwissAcceleration(snapshot) ?? inferSwissAcceleration(snapshot)
      : accelerationOverride;
  const cached = exactRoundCache.get(snapshot);
  if (
    cached?.targetRound === targetRound &&
    cached.system === system &&
    cached.acceleration === acceleration
  ) {
    return cached.forecasts?.get(myStartNumber) ?? null;
  }
  const players = enginePlayers(snapshot, targetRound);
  if (players.length < 2) {
    exactRoundCache.set(snapshot, { targetRound, system, acceleration, forecasts: null });
    return null;
  }
  const sourcePlayers = new Map(
    snapshot.players.map((player) => [player.startNumber, player]),
  );
  const history = completedRounds(snapshot, targetRound, sourcePlayers);
  const virtualPoints =
    acceleration === null
      ? 0
      : accelerationVirtualPoints(acceleration, targetRound, snapshot.totalRounds);
  const rounds =
    virtualPoints > 0
      ? [virtualAccelerationRound(snapshot, players, virtualPoints), ...history.rounds]
      : history.rounds;
  try {
    const pairings = pairingSystems[system](players, rounds, {
      expectedRounds: snapshot.totalRounds + (virtualPoints > 0 ? 1 : 0),
    });
    const forecasts = new Map<number, ExactSwissForecast>();
    for (const game of pairings.games) {
      const white = Number(game.white);
      const black = Number(game.black);
      forecasts.set(white, {
        opponentStartNumber: black,
        color: "white",
        estimatedLiveResults: history.estimatedLiveResults,
        system,
        acceleration,
      });
      forecasts.set(black, {
        opponentStartNumber: white,
        color: "black",
        estimatedLiveResults: history.estimatedLiveResults,
        system,
        acceleration,
      });
    }
    for (const bye of pairings.byes) {
      forecasts.set(Number(bye.player), {
        opponentStartNumber: null,
        color: null,
        estimatedLiveResults: history.estimatedLiveResults,
        system,
        acceleration,
      });
    }
    exactRoundCache.set(snapshot, { targetRound, system, acceleration, forecasts });
    return forecasts.get(myStartNumber) ?? null;
  } catch {
    // Incomplete Chess-Results history or non-standard organizer settings can
    // make a strict reconstruction impossible. The calibrated model remains a
    // safe fallback and keeps refreshes working.
  }
  exactRoundCache.set(snapshot, { targetRound, system, acceleration, forecasts: null });
  return null;
}
