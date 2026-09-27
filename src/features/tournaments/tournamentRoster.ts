import type { TournamentPlayer, TournamentSnapshot } from "@/features/tournaments/platform";
import { tournamentPlayerKey, type TournamentOpponentDatabase, type TournamentPrepRecord } from "./tournamentPrepStore";

export type TournamentIdentity = Pick<TournamentPlayer, "fideId" | "name">;

function identityLookup<T extends TournamentIdentity>(values: T[]): (identity: TournamentIdentity) => T | null | undefined {
  const entries = new Map<string, T | null>();
  for (const value of values) {
    const keys = [tournamentPlayerKey({ ...value, fideId: null })];
    if (value.fideId) keys.push(tournamentPlayerKey(value));
    for (const key of keys) entries.set(key, entries.has(key) ? null : value);
  }
  return identity => entries.get(tournamentPlayerKey(identity));
}

/** Match an old identity into a new roster. A missing ID may be enriched by a
 * unique name; an existing ID must never fall back to a different person's ID. */
export function matchTournamentIdentity<T extends TournamentIdentity>(values: T[], identity: TournamentIdentity): T | null {
  return identityLookup(values)(identity) ?? null;
}

/** Require the previous roster to identify the person uniquely too: a later
 * withdrawal must not make two formerly ambiguous names look like one person. */
export function reconcileTournamentIdentity<T extends TournamentIdentity>(previous: TournamentIdentity[], current: T[], identity: TournamentIdentity): T | null {
  return matchTournamentIdentity(previous, identity) ? matchTournamentIdentity(current, identity) : null;
}

export function mergeTournamentRoster(record: TournamentPrepRecord, snapshot: TournamentSnapshot): {record: TournamentPrepRecord; newOpponents: number} {
  // A failed parser must not turn an established roster into an empty one.
  if (!snapshot.players.length && record.snapshot.players.length && snapshot.warnings.length) {
    throw new Error("The entry list could not be refreshed. Your previous list is still available.");
  }
  const previousRosterMatch = identityLookup(record.snapshot.players);
  const currentMatch = identityLookup(snapshot.players);
  const identity = {name: record.userName, fideId: record.userFideId};
  const user = (record.userName || record.userFideId) && (previousRosterMatch(identity) || record.userFideId) ? currentMatch(identity) : null;
  const seenPlayerKeys = new Set(record.seenPlayerKeys ?? record.snapshot.players.map(tournamentPlayerKey));
  for (const oldPlayer of record.snapshot.players) {
    const player = previousRosterMatch(oldPlayer) ? currentMatch(oldPlayer) : null;
    const oldKey = tournamentPlayerKey(oldPlayer);
    if (player && seenPlayerKeys.has(oldKey)) {
      seenPlayerKeys.delete(oldKey);
      seenPlayerKeys.add(tournamentPlayerKey(player));
    }
  }
  const previous = [...Object.values(record.opponents), ...(record.retiredOpponents ?? [])];
  const previousMatch = identityLookup(previous);
  const savedByPlayer = new Map<TournamentPlayer, TournamentOpponentDatabase[]>();
  for (const item of previous) {
    // The selected user's row is absent from `previous` databases, but must
    // still count when checking whether an old name was ambiguous.
    const player = previousMatch(item) && (item.fideId || previousRosterMatch(item) !== null) ? currentMatch(item) : null;
    if (player) savedByPlayer.set(player, [...(savedByPlayer.get(player) ?? []), item]);
  }
  const used = new Set<TournamentOpponentDatabase>();
  const opponents: Record<string, TournamentOpponentDatabase> = {};
  let newOpponents = 0;
  for (const player of snapshot.players) {
    if (player.startNumber === user?.startNumber) continue;
    // Duplicate names/FIDE IDs are ambiguous. Never move a saved database to
    // one of those rows solely because its start number now happens to match.
    const matches = savedByPlayer.get(player) ?? [];
    const existing = matches.length === 1 ? matches[0] : null;
    if (existing) used.add(existing); else newOpponents++;
    opponents[String(player.startNumber)] = existing ? {...existing, startNumber: player.startNumber, name: player.name, fideId: player.fideId,
      status: existing.status === "searching" ? "queued" : existing.status} : {
      startNumber: player.startNumber, name: player.name, fideId: player.fideId,
      collectionId: null, status: "not-imported", lastSyncAt: null, gameCount: 0, error: null,
    };
  }
  return {newOpponents, record: {...record, url:snapshot.sourceUrl, title:snapshot.title,
    userStartNumber:user?.startNumber ?? null, userName:user?.name ?? record.userName, userFideId:user?.fideId ?? record.userFideId,
    snapshot, opponents, seenPlayerKeys:[...seenPlayerKeys], retiredOpponents:previous.filter(item=>!used.has(item) && item.collectionId !== null),
    lastRosterSyncAt:new Date().toISOString()}};
}

export function selectTournamentEntry(record:TournamentPrepRecord, player:TournamentPlayer | null):TournamentPrepRecord {
  return mergeTournamentRoster({...record,userStartNumber:player?.startNumber ?? null,userName:player?.name ?? "",userFideId:player?.fideId ?? null},record.snapshot).record;
}

/** Attach imports only to the unique current roster identity, never a name-search result. */
export function matchTournamentImportOpponent(
  record: TournamentPrepRecord,
  expected: Pick<TournamentOpponentDatabase, "name" | "fideId">,
  imported: { playerName: string; fideId: string | null },
): TournamentOpponentDatabase {
  if (!expected.fideId || !/^[1-9]\d*$/.test(expected.fideId) || imported.fideId !== expected.fideId || imported.playerName !== expected.name) {
    throw new Error("The imported player does not match this tournament opponent. The games remain in your Library.");
  }
  const players = record.snapshot.players.filter(player => player.fideId === expected.fideId);
  const player = players.length === 1 ? players[0] : null;
  const opponent = player ? record.opponents[String(player.startNumber)] : null;
  if (!player || !opponent || opponent.name !== player.name || (opponent.fideId && opponent.fideId !== player.fideId)) {
    throw new Error("This opponent is no longer uniquely identified in the roster. Imported games remain in your Library.");
  }
  return { ...opponent, name: player.name, fideId: player.fideId };
}
