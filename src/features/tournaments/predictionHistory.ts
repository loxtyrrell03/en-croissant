import type { TournamentPlayer, TournamentSnapshot } from "@/features/tournaments/platform";
import type { PairingForecast } from "./pairingForecast";
import { cachedTournamentEvidence } from "./tournamentForecastEvidence";

export interface PredictionIdentity { name: string; fideId: string | null }
export interface SavedCandidate { player: PredictionIdentity; probability: number | null; color: "white" | "black" | null }
export interface SavedPrediction {
  capturedAt: string;
  kind: "estimated" | "inferred";
  candidates: SavedCandidate[];
  otherProbability: number | null;
  manualResults: number;
}
export interface PublishedOpponent {
  player: PredictionIdentity | null;
  label: string;
  color: "white" | "black" | null;
}
export interface PredictionRound {
  player: PredictionIdentity;
  round: number;
  versions: SavedPrediction[];
  published: PublishedOpponent | null;
  corrected: boolean;
}
export interface PredictionHistory { version: 1; id: string; rounds: PredictionRound[]; closedThrough: number; closedRounds: number[] }
export const emptyPredictionHistory = (id: string): PredictionHistory => ({ version: 1, id, rounds: [], closedThrough: 0, closedRounds: [] });
const nameKey = (name: string) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
export function samePredictionPlayer(a: PredictionIdentity, b: PredictionIdentity): boolean {
  return a.fideId && b.fideId ? a.fideId === b.fideId : nameKey(a.name) === nameKey(b.name);
}
export function uniquePredictionPlayer(roster: TournamentPlayer[], identity: PredictionIdentity): TournamentPlayer | null {
  const matches = roster.filter(p => identity.fideId ? p.fideId === identity.fideId : nameKey(p.name) === nameKey(identity.name));
  return matches.length === 1 ? matches[0] : null;
}
export const predictionIdentity = (player: PredictionIdentity): PredictionIdentity => ({ name: player.name, fideId: player.fideId });

/** Resolve only the source's assignment for this round, never a historical forecast. */
export function publishedOpponent(snapshot: TournamentSnapshot, player: PredictionIdentity, round: number): PublishedOpponent | null {
  const current = uniquePredictionPlayer(snapshot.players, player);
  if (!current) return null;
  const target = cachedTournamentEvidence(snapshot, round)?.players.find(p => p.startNumber === current.startNumber)?.target;
  if (!target || target.assignment === "missing" || target.assignment === "conflict") return null;
  if (target.assignment === "paired") {
    const other = snapshot.players.find(p => p.startNumber === target.opponentStartNumber);
    if (!other || !uniquePredictionPlayer(snapshot.players, other)) return null;
    return { player: predictionIdentity(other), label: other.name, color: target.color };
  }
  const label = target.award === 1 ? "Full-point bye" : target.award === 0.5 ? "Half-point bye" : target.assignment === "not-yet-entered" ? "Not entered" : target.assignment === "not-paired" ? "Not paired" : "No opponent";
  return { player: null, label, color: null };
}

/** Only completed estimates from an input with no observed target publication qualify. */
export function predictionToSave(snapshot: TournamentSnapshot, player: TournamentPlayer | null, forecast: PairingForecast | null, calculating: boolean, manualResults = 0, now = new Date().toISOString()): SavedPrediction | null {
  const round = forecast?.round;
  if (calculating || !player || !forecast || !round || !Number.isSafeInteger(round) || round < 1 || round > 128 || snapshot.nextRound !== round || snapshot.phase === "complete" ||
    !uniquePredictionPlayer(snapshot.players, player) || !["estimated", "inferred"].includes(forecast.kind) || !forecast.candidates.length ||
    round <= Math.max(snapshot.completedRound, snapshot.publishedRound) || snapshot.pairings.some(p => p.round === round) ||
    (snapshot.evidenceVersion === 1 && snapshot.roundStatus?.some(p => p.round === round))) return null;
  return { capturedAt: now, kind: forecast.kind as SavedPrediction["kind"],
    candidates: forecast.candidates.slice(0, 24).map(c => ({ player: predictionIdentity(c.player), probability: c.probability, color: c.color })),
    otherProbability: forecast.otherProbability, manualResults };
}
const signature = (prediction: SavedPrediction) => JSON.stringify({ ...prediction, capturedAt: undefined });
const publishedKey = (published: PublishedOpponent) => JSON.stringify([published.player ? published.player.fideId ?? nameKey(published.player.name) : published.label, published.color]);

/** Called inside one IndexedDB read/write transaction. Official observations always win. */
export function mergePredictionHistory(history: PredictionHistory, snapshot: TournamentSnapshot, capture?: { player: PredictionIdentity; round: number; prediction: SavedPrediction }): PredictionHistory {
  const closedThrough = Math.max(history.closedThrough, snapshot.publishedRound, snapshot.completedRound);
  const closedRounds = [...new Set([...history.closedRounds, ...snapshot.pairings.map(p => p.round), ...(snapshot.evidenceVersion === 1 ? snapshot.roundStatus?.map(p => p.round) ?? [] : [])])].filter(r => Number.isSafeInteger(r) && r > 0 && r <= 128).sort((a,b) => a-b);
  let rounds = history.rounds.map(row => {
    const official = publishedOpponent(snapshot, row.player, row.round);
    if (!official || JSON.stringify(official) === JSON.stringify(row.published)) return row;
    return { ...row, published: official, corrected: row.corrected || (row.published !== null && publishedKey(row.published) !== publishedKey(official)) };
  });
  if (capture && capture.round > closedThrough && !closedRounds.includes(capture.round) && uniquePredictionPlayer(snapshot.players, capture.player)) {
    const matching = rounds.filter(r => r.round === capture.round && samePredictionPlayer(r.player, capture.player));
    if (matching.length > 1) throw new Error("This player's saved predictions could not be matched.");
    const old = matching[0];
    if (!old) {
      if (rounds.length >= 2_000) throw new Error("Prediction history is full. Earlier predictions are safe.");
      rounds = [...rounds, { player: predictionIdentity(capture.player), round: capture.round, versions: [capture.prediction], published: null, corrected: false }];
    } else if (signature(old.versions.at(-1)!) !== signature(capture.prediction)) {
      // Keep the first and two latest distinct predictions. Never alter frozen rounds.
      const versions = [...old.versions, capture.prediction];
      if (versions.length > 3) versions.splice(1, versions.length - 3);
      rounds = rounds.map(r => r === old ? { ...old, versions } : r);
    }
  }
  return { ...history, rounds, closedThrough, closedRounds };
}

export function playerPredictionRounds(history: PredictionHistory, snapshot: TournamentSnapshot, player: TournamentPlayer): PredictionRound[] {
  if (!uniquePredictionPlayer(snapshot.players, player)) return [];
  return history.rounds.filter(r => samePredictionPlayer(r.player, player)).sort((a,b) => b.round-a.round);
}

/** Exact saved chance only; a truncated shortlist never establishes zero. */
export function comparePrediction(prediction: SavedPrediction | undefined, actual: PublishedOpponent | null) {
  const index = actual?.player && prediction ? prediction.candidates.findIndex(c => samePredictionPlayer(c.player, actual.player!)) : -1;
  return { rank: index < 0 ? null : index + 1, candidate: index < 0 ? null : prediction!.candidates[index] };
}
