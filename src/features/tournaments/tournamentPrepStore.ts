import { desktopApi, isDesktop, type TournamentSnapshot } from "@/features/tournaments/platform";

export const TOURNAMENT_PREP_KEY = "encroissant.tournamentPrep";
export const TOURNAMENT_PREP_UPDATED_EVENT = "encroissant:tournament-prep-updated";

export type OpponentDatabaseStatus =
  | "not-imported"
  | "queued"
  | "searching"
  | "ready"
  | "no-games"
  | "error";

export interface TournamentOpponentDatabase {
  startNumber: number;
  name: string;
  fideId: string | null;
  collectionId: number | null;
  status: OpponentDatabaseStatus;
  lastSyncAt: string | null;
  gameCount: number;
  importFromYear?: number;
  error: string | null;
}

export interface TournamentPrepRecord {
  id: string;
  url: string;
  title: string;
  folder: string;
  userStartNumber: number | null;
  userName: string;
  userFideId: string | null;
  fromYear: number;
  autoUpdate: boolean;
  createdAt: string;
  lastRosterSyncAt: string | null;
  lastDatabaseSyncAt: string | null;
  snapshot: TournamentSnapshot;
  opponents: Record<string, TournamentOpponentDatabase>;
  /** Imported identities no longer in the active roster; never discard their games. */
  retiredOpponents?: TournamentOpponentDatabase[];
  seenPlayerKeys?: string[];
}

export type TournamentPrepMap = Record<string, TournamentPrepRecord>;

const MAX_TRACKED_TOURNAMENTS = 24;
const MAX_OPPONENTS_PER_TOURNAMENT = 5_000;
const CURRENT_YEAR = new Date().getFullYear();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validIso(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function validId(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function validStatus(value: unknown): OpponentDatabaseStatus {
  return value === "not-imported" ||
    value === "searching" ||
    value === "ready" ||
    value === "no-games" ||
    value === "error" ||
    value === "queued"
    ? value
    : "queued";
}

function parseOpponent(value: unknown): TournamentOpponentDatabase | null {
  if (!isObject(value)) return null;
  const startNumber = validId(value.startNumber);
  if (startNumber === null || typeof value.name !== "string" || !value.name.trim()) return null;
  return {
    startNumber,
    name: value.name.trim().slice(0, 200),
    fideId:
      typeof value.fideId === "string" && /^\d+$/.test(value.fideId)
        ? value.fideId
        : null,
    collectionId: validId(value.collectionId),
    status: validStatus(value.status),
    lastSyncAt: validIso(value.lastSyncAt),
    gameCount:
      typeof value.gameCount === "number" && Number.isFinite(value.gameCount)
        ? Math.max(0, Math.trunc(value.gameCount))
        : 0,
    ...(typeof value.importFromYear === "number" && Number.isInteger(value.importFromYear) && value.importFromYear >= 1900 && value.importFromYear <= CURRENT_YEAR
      ? { importFromYear: value.importFromYear } : {}),
    error: typeof value.error === "string" ? value.error.slice(0, 500) : null,
  };
}

function looksLikeSnapshot(value: unknown): value is TournamentSnapshot {
  if (!isObject(value)) return false;
  return (
    typeof value.tournamentId === "string" &&
    typeof value.sourceUrl === "string" &&
    typeof value.title === "string" &&
    typeof value.format === "string" &&
    typeof value.phase === "string" &&
    Array.isArray(value.players) &&
    Array.isArray(value.pairings)
  );
}

export function parseTournamentPreps(raw: string | null): TournamentPrepMap {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isObject(parsed)) return {};
  const result: TournamentPrepMap = {};
  for (const [id, value] of Object.entries(parsed).slice(0, MAX_TRACKED_TOURNAMENTS)) {
    if (!/^\d{1,12}$/.test(id) || !isObject(value) || !looksLikeSnapshot(value.snapshot)) continue;
    const userStartNumber = validId(value.userStartNumber);
    if (
      (value.userStartNumber !== null && userStartNumber === null) ||
      typeof value.url !== "string" ||
      typeof value.title !== "string" ||
      typeof value.folder !== "string" ||
      typeof value.userName !== "string"
    ) {
      continue;
    }
    const opponents: Record<string, TournamentOpponentDatabase> = {};
    if (isObject(value.opponents)) {
      for (const [key, opponentValue] of Object.entries(value.opponents).slice(
        0,
        MAX_OPPONENTS_PER_TOURNAMENT,
      )) {
        if (!/^\d+$/.test(key)) continue;
        const opponent = parseOpponent(opponentValue);
        if (opponent) opponents[key] = opponent;
      }
    }
    const createdAt = validIso(value.createdAt) ?? new Date(0).toISOString();
    result[id] = {
      id,
      url: value.url.slice(0, 500),
      title: value.title.trim().slice(0, 240),
      folder: value.folder.trim().slice(0, 240),
      userStartNumber,
      userName: value.userName.trim().slice(0, 200),
      userFideId:
        typeof value.userFideId === "string" && /^\d+$/.test(value.userFideId)
          ? value.userFideId
          : value.snapshot.players.find((player) => player.startNumber === userStartNumber)
              ?.fideId ?? null,
      fromYear:
        typeof value.fromYear === "number" && Number.isFinite(value.fromYear)
          ? Math.min(CURRENT_YEAR, Math.max(1900, Math.trunc(value.fromYear)))
          : Math.max(2020, CURRENT_YEAR - 3),
      autoUpdate: value.autoUpdate === true,
      createdAt,
      lastRosterSyncAt: validIso(value.lastRosterSyncAt),
      lastDatabaseSyncAt: validIso(value.lastDatabaseSyncAt),
      snapshot: {
        ...value.snapshot,
        section:
          typeof value.snapshot.section === "string" && value.snapshot.section.trim()
            ? value.snapshot.section.trim().slice(0, 80)
            : null,
      },
      opponents,
      retiredOpponents: Array.isArray(value.retiredOpponents) ? value.retiredOpponents.slice(0, MAX_OPPONENTS_PER_TOURNAMENT).map(parseOpponent).filter((item): item is TournamentOpponentDatabase => item !== null) : [],
      seenPlayerKeys: Array.isArray(value.seenPlayerKeys) ? value.seenPlayerKeys.filter((key): key is string => typeof key === "string").slice(0, MAX_OPPONENTS_PER_TOURNAMENT) : value.snapshot.players.map(tournamentPlayerKey),
    };
  }
  return result;
}

export function serializeTournamentPreps(records: TournamentPrepMap): string {
  return JSON.stringify(records);
}

function notifyUpdated(): void {
  globalThis.dispatchEvent?.(new Event(TOURNAMENT_PREP_UPDATED_EVENT));
}

function cacheLocal(records: TournamentPrepMap, notify = false): void {
  try {
    localStorage.setItem(TOURNAMENT_PREP_KEY, serializeTournamentPreps(records));
  } catch {
    // The desktop settings store remains authoritative if the cache is full.
  }
  if (notify) notifyUpdated();
}

export function loadLocalTournamentPreps(): TournamentPrepMap {
  try {
    return parseTournamentPreps(localStorage.getItem(TOURNAMENT_PREP_KEY));
  } catch {
    return {};
  }
}

// Read completions must not replace a newer read or successfully saved fallback.
let cacheRevision = 0;

export async function loadTournamentPreps(): Promise<TournamentPrepMap> {
  if (!isDesktop()) return loadLocalTournamentPreps();
  const revision = ++cacheRevision;
  try {
    const stored = await desktopApi.settingsGet(TOURNAMENT_PREP_KEY);
    // A local save remains usable if the native settings write failed or the
    // key has not made it to disk yet. Do not erase that fallback with an
    // absent native value on the next read.
    if (!stored) return loadLocalTournamentPreps();
    const records = parseTournamentPreps(stored);
    if (revision === cacheRevision) cacheLocal(records);
    return records;
  } catch {
    return loadLocalTournamentPreps();
  }
}

export async function saveTournamentPreps(records: TournamentPrepMap): Promise<void> {
  // Publish the fallback and notify only after the authoritative save succeeds.
  // A failed write must remain a visible failure and retain the prior cache.
  if (isDesktop()) {
    await desktopApi.settingsSet(TOURNAMENT_PREP_KEY, serializeTournamentPreps(records));
  }
  ++cacheRevision;
  cacheLocal(records);
  notifyUpdated();
}

export function createTournamentPrepRecord(
  snapshot: TournamentSnapshot,
  userStartNumber: number | null,
  fromYear: number,
): TournamentPrepRecord {
  const user = snapshot.players.find((player) => player.startNumber === userStartNumber);
  if (userStartNumber !== null && !user) throw new Error("Select your name from the tournament roster.");
  const createdAt = new Date().toISOString();
  const folder = `Tournament · ${snapshot.title}`.slice(0, 240);
  const opponents = Object.fromEntries(
    snapshot.players
      .filter((player) => player.startNumber !== userStartNumber)
      .map((player) => [
        String(player.startNumber),
        {
          startNumber: player.startNumber,
          name: player.name,
          fideId: player.fideId,
          collectionId: null,
          status: "not-imported" as const,
          lastSyncAt: null,
          gameCount: 0,
          error: null,
        },
      ]),
  );
  return {
    id: snapshot.tournamentId,
    url: snapshot.sourceUrl,
    title: snapshot.title,
    folder,
    userStartNumber,
    userName: user?.name ?? "",
    userFideId: user?.fideId ?? null,
    fromYear,
    autoUpdate: true,
    createdAt,
    lastRosterSyncAt: createdAt,
    lastDatabaseSyncAt: null,
    snapshot,
    opponents,
    retiredOpponents: [],
    seenPlayerKeys: snapshot.players.map(tournamentPlayerKey),
  };
}

export function upsertTournamentPrep(
  records: TournamentPrepMap,
  record: TournamentPrepRecord,
): TournamentPrepMap {
  return { ...records, [record.id]: record };
}

export function removeTournamentPrep(
  records: TournamentPrepMap,
  tournamentId: string,
): TournamentPrepMap {
  const next = { ...records };
  delete next[tournamentId];
  return next;
}

export function tournamentPrepDatabaseIds(record: TournamentPrepRecord): number[] {
  return [
    ...new Set(
      [...Object.values(record.opponents), ...(record.retiredOpponents ?? [])].flatMap((opponent) =>
        opponent.collectionId === null ? [] : [opponent.collectionId],
      ),
    ),
  ];
}

export function tournamentPlayerKey(player: { fideId: string | null; name: string }): string {
  return player.fideId ? `fide:${player.fideId}` : `name:${player.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, " ").trim().toLocaleLowerCase()}`;
}
