import { importOpponent } from "./opponentImport";
import { registerJob } from "@/features/tournaments/jobs";
import { pushToast } from "@/features/tournaments/ui";
import { mergeTournamentRoster } from "./tournamentRoster";
import {
  desktopApi,
  isDesktop,
  type CollectionRow,
} from "@/features/tournaments/platform";

import {
  loadTournamentPreps,
  removeTournamentPrep,
  saveTournamentPreps,
  tournamentPrepDatabaseIds,
  type TournamentOpponentDatabase,
  type TournamentPrepRecord,
} from "./tournamentPrepStore";

export const TOURNAMENT_PREP_JOB_ID = "tournament-prep.auto-update";
export const TOURNAMENT_PREP_JOB_INTERVAL_MS = 15 * 60 * 1000;

export type TournamentSyncMode = "roster" | "full" | "player";
export type TournamentSyncPhase =
  | "queued"
  | "roster"
  | "database"
  | "stopping"
  | "complete"
  | "error";

export interface TournamentSyncEvent {
  tournamentId: string;
  phase: TournamentSyncPhase;
  current: number;
  total: number;
  playerName: string | null;
  message: string;
}

export interface TournamentSyncResult {
  tournamentId: string;
  newOpponents: number;
  databasesUpdated: number;
  failures: number;
  stopped: boolean;
}

interface RunController {
  tournamentId: string;
  cancelled: boolean;
  jobId: string | null;
  promise: Promise<TournamentSyncResult>;
}

const listeners = new Set<(event: TournamentSyncEvent) => void>();
const latestEvents = new Map<string, TournamentSyncEvent>();
const activeRuns = new Map<string, RunController>();
let syncTail: Promise<void> = Promise.resolve();

function emit(event: TournamentSyncEvent): void {
  latestEvents.set(event.tournamentId, event);
  for (const listener of listeners) listener(event);
}

/** Keep a completed background check's outcome available when its tracker opens. */
export function latestTournamentSyncEvent(tournamentId: string): TournamentSyncEvent | null {
  return latestEvents.get(tournamentId) ?? null;
}

export function subscribeTournamentSync(listener: (event: TournamentSyncEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isTournamentSyncRunning(tournamentId: string): boolean {
  return activeRuns.has(tournamentId);
}

function uniqueCollectionName(base: string, collections: CollectionRow[]): string {
  const clean = base.trim() || "Tournament opponent";
  const names = new Set(collections.map((collection) => collection.name.toLocaleLowerCase()));
  if (!names.has(clean.toLocaleLowerCase())) return clean;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${clean} (${suffix})`;
    if (!names.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

async function persistRecord(record: TournamentPrepRecord): Promise<boolean> {
  const records = await loadTournamentPreps();
  const latest = records[record.id];
  if (!latest) return false;
  await saveTournamentPreps({
    ...records,
    [record.id]: { ...record, autoUpdate: latest.autoUpdate },
  });
  return true;
}

async function syncOpponentDatabase(
  record: TournamentPrepRecord,
  opponent: TournamentOpponentDatabase,
  collections: CollectionRow[],
  controller: RunController,
): Promise<TournamentOpponentDatabase> {
  if (!opponent.fideId || !/^[1-9]\d*$/.test(opponent.fideId)) throw new Error("No exact FIDE profile is listed for this opponent.");
  let collectionId = opponent.collectionId;
  let collection = collections.find((item) => item.id === collectionId);
  if (!collection) {
    const collectionName = uniqueCollectionName(opponent.name, collections);
    collectionId = await desktopApi.collectionCreate(collectionName, `tournament-${record.id}-fide-${opponent.fideId}`);
    await desktopApi.collectionSetFolder(collectionId, record.folder);
    collection = { id: collectionId, name: collectionName, folder: record.folder, game_count: 0 };
    collections.push(collection);
  } else if (collection.folder !== record.folder) {
    await desktopApi.collectionSetFolder(collection.id, record.folder);
    collection.folder = record.folder;
  }
  // Keep the collection attached even if a source later fails or the user
  // cancels. A retry can then resume in-place instead of leaving an orphaned
  // collection and creating another one with the same opponent name.
  opponent.collectionId = collection.id;
  opponent.gameCount = collection.game_count;

  if (controller.cancelled) throw new Error("Opponent import stopped.");
  const imported = await importOpponent({playerName:opponent.name,fideId:opponent.fideId,fromYear:record.fromYear,collectionId:collection.id,requestKey:`tournament-${record.id}-fide-${opponent.fideId}`,refresh:true}, id=>{controller.jobId=id;});
  controller.jobId=null;
  if(imported.cancelled)controller.cancelled=true;
  return {...opponent,collectionId:imported.collectionId,status:imported.cancelled?"queued":imported.gameCount>0?"ready":"no-games",lastSyncAt:new Date().toISOString(),gameCount:imported.gameCount,importFromYear:imported.fromYear,error:imported.warning ?? null};

}

async function performTournamentSync(
  tournamentId: string,
  mode: TournamentSyncMode,
  controller: RunController,
  targetStartNumber?: number,
): Promise<TournamentSyncResult> {
  const result: TournamentSyncResult = {
    tournamentId,
    newOpponents: 0,
    databasesUpdated: 0,
    failures: 0,
    stopped: false,
  };
  if (controller.cancelled) {
    result.stopped = true;
    return result;
  }
  if (!isDesktop()) throw new Error("Tournament prep sync is available in the desktop app.");
  let records = await loadTournamentPreps();
  let record = records[tournamentId];
  if (!record) throw new Error("That tournament tracker no longer exists.");

  emit({
    tournamentId,
    phase: "roster",
    current: 0,
    total: 0,
    playerName: null,
    message: "Checking the tournament roster and latest round",
  });
  const snapshot = await desktopApi.fetchTournamentSnapshot(record.url);
  records = await loadTournamentPreps();
  if (!records[tournamentId] || controller.cancelled) {
    result.stopped = true;
    return result;
  }
  // Merge into the latest saved record after the request, preserving imports,
  // personal-entry choices and reviewed markers changed while it was loading.
  const merged = mergeTournamentRoster(records[tournamentId], snapshot);
  record = merged.record;
  result.newOpponents = merged.newOpponents;
  await saveTournamentPreps({ ...records, [tournamentId]: record });

  if (mode === "roster") {
    emit({
      tournamentId,
      phase: "complete",
      current: 0,
      total: 0,
      playerName: null,
      message: "Tournament tracking is up to date",
    });
    return result;
  }

  const collections = await desktopApi.collectionList();
  const existingIds = new Set(collections.map((collection) => collection.id));
  for (const opponent of Object.values(record.opponents)) {
    if (opponent.collectionId !== null && !existingIds.has(opponent.collectionId)) {
      opponent.collectionId = null;
      opponent.status = "queued";
      opponent.gameCount = 0;
    }
  }
  const queue =
    mode === "player"
      ? Object.values(record.opponents).filter(
          (opponent) => opponent.startNumber === targetStartNumber,
        )
      : Object.values(record.opponents);
  if (mode === "player" && queue.length === 0) {
    throw new Error("That player is no longer present in the tournament roster.");
  }
  await persistRecord(record);

  for (let index = 0; index < queue.length; index += 1) {
    if (controller.cancelled) {
      result.stopped = true;
      break;
    }
    const queued = queue[index];
    const current = record.opponents[String(queued.startNumber)];
    if (!current) continue;
    current.status = "searching";
    current.error = null;
    await persistRecord(record);
    emit({
      tournamentId,
      phase: "database",
      current: index,
      total: queue.length,
      playerName: current.name,
      message: `Building ${current.name}'s opponent database`,
    });
    try {
      record.opponents[String(current.startNumber)] = await syncOpponentDatabase(
        record,
        current,
        collections,
        controller,
      );
      result.databasesUpdated += 1;
    } catch (caught) {
      controller.jobId = null;
      const message = caught instanceof Error ? caught.message : String(caught);
      record.opponents[String(current.startNumber)] = {
        ...current,
        status: controller.cancelled ? "queued" : "error",
        error: controller.cancelled ? null : message.slice(0, 500),
      };
      if (!controller.cancelled) result.failures += 1;
    }
    await persistRecord(record);
  }

  result.stopped ||= controller.cancelled;
  if (!result.stopped) {
    record.lastDatabaseSyncAt = new Date().toISOString();
    await persistRecord(record);
  }
  emit({
    tournamentId,
    phase: "complete",
    current: result.databasesUpdated,
    total: queue.length,
    playerName: null,
    message: result.stopped
      ? "Tournament database sync stopped; the remaining queue is saved"
      : "Tournament prep databases are up to date",
  });
  return result;
}

export function runTournamentPrepSync(
  tournamentId: string,
  mode: TournamentSyncMode = "roster",
  targetStartNumber?: number,
): Promise<TournamentSyncResult> {
  const existing = activeRuns.get(tournamentId);
  if (existing) return existing.promise;

  const controller: RunController = {
    tournamentId,
    cancelled: false,
    jobId: null,
    promise: Promise.resolve({
      tournamentId,
      newOpponents: 0,
      databasesUpdated: 0,
      failures: 0,
      stopped: false,
    }),
  };
  emit({
    tournamentId,
    phase: "queued",
    current: 0,
    total: 0,
    playerName: null,
    message: "Tournament sync queued",
  });
  const run = syncTail
    .catch(() => {})
    .then(() => performTournamentSync(tournamentId, mode, controller, targetStartNumber))
    .catch((caught) => {
      const message = caught instanceof Error ? caught.message : String(caught);
      emit({
        tournamentId,
        phase: "error",
        current: 0,
        total: 0,
        playerName: null,
        message,
      });
      throw caught;
    });
  controller.promise = run.finally(() => activeRuns.delete(tournamentId));
  syncTail = controller.promise.then(
    () => {},
    () => {},
  );
  activeRuns.set(tournamentId, controller);
  return controller.promise;
}

export interface TournamentOpponentPrepResult {
  collectionId: number;
  opponent: TournamentOpponentDatabase;
}

/** Import or refresh exactly one opponent, then return the database that Prep
 * should open. Tournament roster/status still refreshes first so the handoff
 * uses the latest name, FIDE id, and pairing state. */
export async function prepareTournamentOpponent(
  tournamentId: string,
  startNumber: number,
): Promise<TournamentOpponentPrepResult> {
  const result = await runTournamentPrepSync(tournamentId, "player", startNumber);
  if (result.stopped) throw new Error("Opponent import stopped.");
  if (result.failures) throw new Error("The opponent import failed. Open the tournament to retry the saved request.");
  const record = (await loadTournamentPreps())[tournamentId];
  const opponent = record?.opponents[String(startNumber)];
  if (!opponent?.collectionId) {
    throw new Error("The opponent database could not be opened after import.");
  }
  if (opponent.status === "error") {
    throw new Error(opponent.error || "The opponent database import failed.");
  }
  if (opponent.status !== "ready" && opponent.status !== "no-games") {
    throw new Error("The opponent import has not completed. Try again when the current update finishes.");
  }
  return { collectionId: opponent.collectionId, opponent };
}

export async function cancelTournamentPrepSync(tournamentId: string): Promise<boolean> {
  const controller = activeRuns.get(tournamentId);
  if (!controller) return false;
  controller.cancelled = true;
  emit({
    tournamentId,
    phase: "stopping",
    current: 0,
    total: 0,
    playerName: null,
    message: "Stopping after the current opponent",
  });
  if (controller.jobId) {
    await desktopApi.cancelOtbGames(controller.jobId).catch(() => false);
  }
  return true;
}

export interface RemoveTournamentPrepResult {
  databasesDeleted: number;
}

export async function stopFollowingTournament(tournamentId: string): Promise<void> {
  const running = activeRuns.get(tournamentId);
  if (running) {
    await cancelTournamentPrepSync(tournamentId);
    await running.promise.catch(() => undefined);
  }
  const latest = await loadTournamentPreps();
  await saveTournamentPreps(removeTournamentPrep(latest, tournamentId));
  latestEvents.delete(tournamentId);
}

export async function removeTournamentPrepAndDatabases(
  tournamentId: string,
): Promise<RemoveTournamentPrepResult> {
  const running = activeRuns.get(tournamentId);
  if (running) {
    await cancelTournamentPrepSync(tournamentId);
    // A collection can be created just before cancellation is observed. Wait
    // for the run to persist that collection id so cleanup cannot orphan it.
    await running.promise.catch(() => undefined);
  }

  const records = await loadTournamentPreps();
  const record = records[tournamentId];
  if (!record) return { databasesDeleted: 0 };

  const databaseIds = tournamentPrepDatabaseIds(record);
  for (const collectionId of databaseIds) {
    await desktopApi.collectionDelete(collectionId);
  }

  // Reload before removing the tracker so unrelated tracker changes made while
  // the database cleanup was running are preserved.
  const latest = await loadTournamentPreps();
  await saveTournamentPreps(removeTournamentPrep(latest, tournamentId));
  latestEvents.delete(tournamentId);
  return { databasesDeleted: databaseIds.length };
}

export function registerTournamentPrepAutoUpdateJob(): void {
  registerJob({
    id: TOURNAMENT_PREP_JOB_ID,
    intervalMs: TOURNAMENT_PREP_JOB_INTERVAL_MS,
    run: async () => {
      if (!isDesktop()) return;
      const records = await loadTournamentPreps();
      let newOpponents = 0;
      let failures = 0;
      for (const record of Object.values(records)) {
        // A manual or resumed pass already refreshes the roster. Do not make
        // the app-wide scheduler wait on that potentially long import.
        if (!record.autoUpdate || isTournamentSyncRunning(record.id)) continue;
        try {
          const result = await runTournamentPrepSync(record.id, "roster");
          newOpponents += result.newOpponents;
          failures += result.failures;
        } catch (caught) {
          failures += 1;
          console.warn(
            `[tournament prep] ${caught instanceof Error ? caught.message : String(caught)}`,
          );
        }
      }
      if (newOpponents > 0) {
        pushToast({
          tone: "success",
          message: "Tournament roster updated",
          detail: `${newOpponents} new opponent${newOpponents === 1 ? "" : "s"} added to the tracked roster.`,
        });
      }
      if (failures > 0) {
        pushToast({
          tone: "error",
          message: "Tournament sync needs attention",
          detail: `${failures} tournament roster check${failures === 1 ? "" : "s"} could not be completed.`,
        });
      }
    },
  });
}
