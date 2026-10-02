import { normalizeTournamentResults } from "./normalizeTournamentResults";
import { isValidTournamentTargetRound } from "./tournamentRoundMetadata";
import { prepareTournamentForecastEvidence } from "./tournamentForecastEvidence";
import { hasUnknownPriorPairingResults } from "./pairingHistoryCompleteness";
import { useEffect, useMemo, useState } from "react";
import type { TournamentSnapshot } from "@/features/tournaments/platform";
import type { ExactSwissForecast } from "./exactSwissForecast";
import {
  exactSwissForecastKey,
  requestExactSwissForecast,
} from "./exactSwissForecastClient";
import {
  calculatePairingForecast,
  type PairingForecast,
} from "./pairingForecast";

interface ExactState {
  key: string;
  player: number;
  status: "pending" | "resolved";
  forecast: ExactSwissForecast | null;
}

function shouldCalculateExact(
  snapshot: TournamentSnapshot | null,
  myStartNumber: number | null,
): snapshot is TournamentSnapshot {
  if (!snapshot || myStartNumber === null || snapshot.format !== "swiss") return false;
  const targetRound = snapshot.nextRound;
  if (!isValidTournamentTargetRound(snapshot, targetRound) || snapshot.phase === "complete") return false;
  const evidence = prepareTournamentForecastEvidence(snapshot, targetRound);
  if (!evidence.solverCompatible) return false;
  if (snapshot.incompletePairingRounds?.some(round => round > 0 && round < targetRound) || hasUnknownPriorPairingResults(snapshot, targetRound)) return false;
  if (snapshot.pairings.some((pairing) => pairing.round === targetRound)) return false;
  const me = evidence.snapshot.players.find((player) => player.startNumber === myStartNumber);
  return Boolean(me?.active && !me.notPairedRounds?.includes(targetRound));
}

export function usePairingForecast(
  sourceSnapshot: TournamentSnapshot | null,
  myStartNumber: number | null,
): { forecast: PairingForecast | null; isCalculating: boolean } {
  const snapshot = sourceSnapshot ? normalizeTournamentResults(sourceSnapshot) : null;
  const targetRound = snapshot?.nextRound ?? null;
  const shouldCalculate = shouldCalculateExact(snapshot, myStartNumber);
  const key =
    shouldCalculate && targetRound !== null && myStartNumber !== null
      ? exactSwissForecastKey(snapshot, targetRound, myStartNumber)
      : "";
  const [exact, setExact] = useState<ExactState | null>(null);

  useEffect(() => {
    if (!shouldCalculate || targetRound === null || myStartNumber === null) return;
    let cancelled = false;
    const controller = new AbortController();
    setExact(current => current?.key === key && current.player === myStartNumber &&
      current.status === "resolved" && current.forecast !== null
      ? current
      : { key, player: myStartNumber, status: "pending", forecast: null });
    void requestExactSwissForecast(snapshot, targetRound, myStartNumber, controller.signal).then((forecast) => {
      if (!cancelled) setExact({ key, player: myStartNumber, status: "resolved", forecast });
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, myStartNumber, shouldCalculate, snapshot, targetRound]);

  // The worker/cache key belongs to the whole field, but this state contains
  // one player's projection. Reject the previous selection during render,
  // before the effect for the new selection has had a chance to run.
  const currentExact = exact?.key === key && exact.player === myStartNumber ? exact : null;
  const resolvedExact = currentExact?.forecast ?? null;
  const isCalculating = shouldCalculate && (!currentExact || currentExact.status === "pending");
  const forecast = useMemo(
    () =>
      snapshot && myStartNumber !== null
        ? calculatePairingForecast(snapshot, myStartNumber, { exactSwiss: resolvedExact })
        : null,
    [myStartNumber, resolvedExact, snapshot],
  );
  return { forecast, isCalculating };
}
