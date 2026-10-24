import type { TournamentPairing, TournamentPlayer, TournamentSnapshot } from "@/features/tournaments/platform";
import { normalizeTournamentResults } from "./normalizeTournamentResults";
import { publishedGameResult } from "./publishedPairingResult";

export type ManualGameResult = "1-0" | "1/2-1/2" | "0-1";
type Identity = Pick<TournamentPlayer, "name" | "fideId">;
export interface ManualTournamentResult {
  round: number;
  whiteStartNumber: number;
  blackStartNumber: number;
  white: Identity;
  black: Identity;
  result: ManualGameResult;
}
const EMPTY: ManualTournamentResult[] = [];
export const manualPairingKey = (p: Pick<TournamentPairing, "round" | "whiteStartNumber" | "blackStartNumber">) =>
  `${p.round}:${p.whiteStartNumber}:${p.blackStartNumber}`;
const indexes = new WeakMap<TournamentSnapshot, Map<string, TournamentPairing>>();
function pendingGames(snapshot: TournamentSnapshot) {
  const saved = indexes.get(snapshot);
  if (saved) return saved;
  const counts = new Map<string, number>();
  const players = new Map(snapshot.players.map(p => [p.startNumber, p]));
  const rosterCounts = new Map<number, number>();
  const identityCounts = new Map<string, number>();
  const identityKey = (p: Identity) => p.fideId ? `fide:${p.fideId}` : `name:${p.name}`;
  for (const p of snapshot.players) {
    rosterCounts.set(p.startNumber, (rosterCounts.get(p.startNumber) ?? 0) + 1);
    const key = identityKey(p); identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
  }
  for (const p of snapshot.pairings) for (const id of [p.whiteStartNumber, p.blackStartNumber]) {
    if (id !== null) { const key = `${p.round}:${id}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
  }
  const games = new Map<string, TournamentPairing>();
  for (const p of snapshot.pairings) {
    const white = players.get(p.whiteStartNumber!), black = players.get(p.blackStartNumber!);
    if (!white || !black || white.startNumber === black.startNumber || publishedGameResult(p) ||
        !Number.isSafeInteger(p.round) || p.round < 1 || p.round > snapshot.publishedRound ||
        (snapshot.totalRounds > 0 && p.round > snapshot.totalRounds) ||
        [white, black].some(player => counts.get(`${p.round}:${player.startNumber}`) !== 1 ||
          rosterCounts.get(player.startNumber) !== 1 || identityCounts.get(identityKey(player)) !== 1 ||
          snapshot.roundStatus?.some(status => status.round === p.round && status.startNumber === player.startNumber))) continue;
    games.set(manualPairingKey(p), p);
  }
  indexes.set(snapshot, games);
  return games;
}
export function canEnterManualResult(snapshot: TournamentSnapshot, pairing: TournamentPairing): boolean {
  return pendingGames(snapshot).has(manualPairingKey(pairing));
}
function sameIdentity(value: unknown, player: TournamentPlayer): boolean {
  if (!value || typeof value !== "object") return false;
  const identity = value as Identity;
  return typeof identity.name === "string" && (identity.fideId
    ? identity.fideId === player.fideId
    : identity.fideId === null && identity.name === player.name);
}
/** Pending games only, bound to both seats and identities. Official results,
 * changed pairings and malformed saved values permanently retire assumptions. */
export function reconcileManualResults(snapshot: TournamentSnapshot, values: unknown): ManualTournamentResult[] {
  if (!Array.isArray(values)) return EMPTY;
  const games = pendingGames(snapshot), players = new Map(snapshot.players.map(p => [p.startNumber, p]));
  const results = new Map<string, ManualTournamentResult>();
  for (const value of values.slice(0, 5_000)) {
    if (!value || typeof value !== "object" || !["1-0", "1/2-1/2", "0-1"].includes(value.result)) continue;
    const key = manualPairingKey(value), pairing = games.get(key);
    if (!pairing || !sameIdentity(value.white, players.get(pairing.whiteStartNumber!)!) ||
        !sameIdentity(value.black, players.get(pairing.blackStartNumber!)!)) continue;
    results.set(key, { round: pairing.round, whiteStartNumber: pairing.whiteStartNumber!, blackStartNumber: pairing.blackStartNumber!,
      white: { name: value.white.name, fideId: value.white.fideId },
      black: { name: value.black.name, fideId: value.black.fideId }, result: value.result });
  }
  return [...results.values()];
}
export function manualResultInput(snapshot: TournamentSnapshot, pairing: TournamentPairing, result: ManualGameResult): ManualTournamentResult {
  const white = snapshot.players.find(p => p.startNumber === pairing.whiteStartNumber);
  const black = snapshot.players.find(p => p.startNumber === pairing.blackStartNumber);
  if (!white || !black || !canEnterManualResult(snapshot, pairing)) throw new Error("This game is no longer awaiting a result.");
  return { round: pairing.round, whiteStartNumber: white.startNumber, blackStartNumber: black.startNumber,
    white: { name: white.name, fideId: white.fideId }, black: { name: black.name, fideId: black.fideId }, result };
}
/** Apply against freshly loaded state so a source refresh wins a save race. */
export function setManualResult(snapshot: TournamentSnapshot, values: unknown, input: ManualTournamentResult, result: ManualGameResult | null) {
  const current = reconcileManualResults(snapshot, values).filter(p => manualPairingKey(p) !== manualPairingKey(input));
  if (result === null) return current;
  return [...current, ...reconcileManualResults(snapshot, [{ ...input, result }])];
}
const projections = new WeakMap<TournamentSnapshot, { values: unknown; snapshot: TournamentSnapshot }>();
/** Private forecast input only. Source snapshots, official standings and phase
 * metadata remain untouched. Existing solvers consume the selected awards. */
export function tournamentPredictionSnapshot(source: TournamentSnapshot, values?: unknown): TournamentSnapshot {
  const cached = projections.get(source);
  if (cached && cached.values === values) return cached.snapshot;
  const normalized = normalizeTournamentResults(source);
  const manual = new Map(reconcileManualResults(source, values).map(p => [manualPairingKey(p), p.result]));
  const snapshot = !manual.size ? normalized : { ...normalized, pairings: normalized.pairings.map(p => {
    const result = manual.get(manualPairingKey(p));
    return result ? { ...p, result, decided: true } : p;
  }) };
  projections.set(source, { values, snapshot });
  return snapshot;
}
