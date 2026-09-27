import {
  PREP_KEYS,
  sourceKeyForVariant,
  type PrepPanelVariant,
} from "@/features/tournaments/prepPersistence";
import type { TournamentSide } from "./tournamentInsights";

export const TOURNAMENT_PREP_HANDOFF_KEY = "encroissant.tournamentPrep.handoff";

export interface TournamentPrepHandoff {
  collectionId: number;
  playerName: string;
  userSide: TournamentSide;
  tournamentTitle: string;
}

interface TournamentPrepHandoffPayload extends TournamentPrepHandoff {
  variant: "side";
}

function parseHandoff(raw: string | null): TournamentPrepHandoffPayload | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<TournamentPrepHandoffPayload>;
    if (
      value.variant !== "side" ||
      typeof value.collectionId !== "number" ||
      !Number.isInteger(value.collectionId) ||
      value.collectionId <= 0 ||
      typeof value.playerName !== "string" ||
      !value.playerName.trim() ||
      (value.userSide !== "white" && value.userSide !== "black") ||
      typeof value.tournamentTitle !== "string"
    ) {
      return null;
    }
    return value as TournamentPrepHandoffPayload;
  } catch {
    return null;
  }
}

export function stageTournamentPrepHandoff(
  handoff: TournamentPrepHandoff,
  storage: Storage | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  const payload: TournamentPrepHandoffPayload = { ...handoff, variant: "side" };
  const opponentSide = handoff.userSide === "white" ? "black" : "white";
  storage.setItem(TOURNAMENT_PREP_HANDOFF_KEY, JSON.stringify(payload));
  storage.setItem(PREP_KEYS.mode, "opponent");
  storage.setItem(PREP_KEYS.player, handoff.playerName);
  storage.setItem(PREP_KEYS.playerColor, opponentSide);
}

export function hasPendingTournamentPrepHandoff(
  storage: Storage | undefined = globalThis.localStorage,
): boolean {
  if (!storage) return false;
  return parseHandoff(storage.getItem(TOURNAMENT_PREP_HANDOFF_KEY)) !== null;
}

/** One-shot source selection consumed by the Prep panel that owns the handoff. */
export function consumeTournamentPrepHandoff(
  variant: PrepPanelVariant,
  storage: Storage | undefined = globalThis.localStorage,
): TournamentPrepHandoffPayload | null {
  if (!storage) return null;
  const payload = parseHandoff(storage.getItem(TOURNAMENT_PREP_HANDOFF_KEY));
  if (!payload || payload.variant !== variant) return null;
  storage.removeItem(TOURNAMENT_PREP_HANDOFF_KEY);
  storage.removeItem(sourceKeyForVariant(variant));
  return payload;
}
