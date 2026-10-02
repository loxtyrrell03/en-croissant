import { isValidTournamentTargetRound } from "./tournamentRoundMetadata";
import { calculateSampledSwissForecast } from "./sampledSwissForecast";
/// <reference lib="webworker" />

import type { TournamentSnapshot } from "@/features/tournaments/platform";
import {
  type ExactSwissForecast,
  type SwissPairingSystem,
} from "./exactSwissForecast";

interface ExactSwissWorkerRequest {
  id: number;
  snapshot: TournamentSnapshot;
  targetRound: number;
  system: SwissPairingSystem;
}

interface ExactSwissWorkerResponse {
  id: number;
  forecasts: Record<number, ExactSwissForecast | null>;
}

self.addEventListener("message", (event: MessageEvent<ExactSwissWorkerRequest>) => {
  const { id, snapshot, targetRound, system } = event.data;
  const response: ExactSwissWorkerResponse = {
    id,
    // Exact rounds and sampled ensembles are cached by immutable snapshot, so
    // the remaining players reuse the same whole-field calculation.
    forecasts: isValidTournamentTargetRound(snapshot, targetRound) ? Object.fromEntries(snapshot.players.map(player => [player.startNumber,
      calculateSampledSwissForecast(snapshot, targetRound, player.startNumber, system),
    ])) : {},
  };
  self.postMessage(response);
});

export {};
