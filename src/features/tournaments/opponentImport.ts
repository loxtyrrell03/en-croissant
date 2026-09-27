import { invoke } from "@tauri-apps/api/core";
import {
    desktopApi,
    isNativeDesktop,
    type ImportCheckpoint,
    type OpponentCollection,
    type OtbImportProgress,
    type OtbImportReport,
} from "./platform";
import {
    createOtbImportRequest,
    DEFAULT_OTB_IMPORT_SOURCES,
    OTB_IMPORT_CACHE_DIRECTORY,
    type OtbImportSourceSelection,
} from "./otbImportModel";

export interface OpponentImportOptions {
    playerName: string;
    fideId: string;
    fromYear: number;
    databaseName?: string;
    collectionId?: number | null;
    requestKey: string;
    sources?: OtbImportSourceSelection;
    refresh?: boolean;
}
export interface OpponentImportResult {
    collectionId: number;
    playerName: string;
    fideId: string | null;
    fromYear: number;
    gameCount: number;
    cancelled: boolean;
    warning?: string;
}
export interface ImportView {
    busy: boolean;
    phase: string;
    message: string;
    progress?: OtbImportProgress;
    error?: string;
    result?: OpponentImportResult;
    collectionId?: number;
    jobId?: string;
}
const active = new Map<string, Promise<OpponentImportResult>>();
const views = new Map<string, ImportView>();
const listeners = new Set<() => void>();
const empty: ImportView = { busy: false, phase: "idle", message: "" };
export function importView(key: string) {
    return views.get(key) ?? empty;
}
export function subscribeOpponentImports(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
export function restoreOpponentImport(key: string, collection: OpponentCollection) {
    if (active.has(key) || !collection.metadata.jobId) return;
    const cp = collection.metadata as ImportCheckpoint;
    publish(key, {
        collectionId: collection.id,
        jobId: cp.jobId,
        phase: cp.phase!,
        busy: false,
        message:
            cp.phase === "collect"
                ? "A saved search is available to resume."
                : cp.phase === "save"
                  ? "Games were fetched. Resume saving to finish this import."
                  : `${collection.game_count} ${collection.game_count===1?"game":"games"} saved`,
        result: cp.phase === "ready" || cp.phase === "stopped" ? result(collection, cp) : undefined,
    });
}
function publish(key: string, change: Partial<ImportView>) {
    views.set(key, { ...importView(key), ...change });
    for (const listener of listeners) listener();
}
export async function stopOpponentImport(key: string) {
    const id = importView(key).jobId;
    if (id) {
        publish(key, { message: "Stopping the search…" });
        await desktopApi.cancelOtbGames(id);
    }
}

export function importOpponent(
    options: OpponentImportOptions,
    onJob?: (id: string) => void,
): Promise<OpponentImportResult> {
    const running = active.get(options.requestKey);
    if (running) return running;
    publish(options.requestKey, {
        busy: true,
        phase: "setup",
        message: "Opening opponent database…",
        error: undefined,
        result: undefined,
    });
    const promise = run(options, onJob)
        .then((result) => {
            publish(options.requestKey, {
                busy: false,
                phase: "ready",
                message: result.gameCount
                    ? `${result.gameCount} ${result.gameCount===1?"game":"games"} saved`
                    : "No public games found",
                result,
            });
            return result;
        })
        .catch((error) => {
            publish(options.requestKey, {
                busy: false,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        })
        .finally(() => active.delete(options.requestKey));
    active.set(options.requestKey, promise);
    return promise;
}

async function run(
    options: OpponentImportOptions,
    onJob?: (id: string) => void,
): Promise<OpponentImportResult> {
    if (!/^[1-9]\d*$/.test(options.fideId))
        throw new Error("Select the opponent’s exact FIDE profile before importing.");
    if (
        !Number.isInteger(options.fromYear) ||
        options.fromYear < 1900 ||
        options.fromYear > new Date().getFullYear()
    )
        throw new Error("Choose a valid first year.");
    const id =
        options.collectionId ??
        (await desktopApi.collectionCreate(
            options.databaseName || options.playerName,
            options.requestKey,
        ));
    let collection = await desktopApi.collectionGet(id);
    let checkpoint = collection.metadata as Partial<ImportCheckpoint>;
    if (checkpoint.fideId && checkpoint.fideId !== options.fideId)
        throw new Error("The saved import belongs to a different FIDE player.");
    const resume =
        checkpoint.jobId && (checkpoint.phase === "save" || checkpoint.phase === "collect");
    if (!resume && (!checkpoint.jobId || options.refresh || checkpoint.phase === "stopped")) {
        checkpoint = {
            jobId: `otb-${crypto.randomUUID()}`,
            phase: "collect",
            playerName: options.playerName,
            fideId: options.fideId,
            fromYear: options.fromYear,
            sources: options.sources ?? DEFAULT_OTB_IMPORT_SOURCES,
            dbPath: checkpoint.dbPath,
            phoneDatabaseId: checkpoint.phoneDatabaseId,
            phonePrepId: checkpoint.phonePrepId,
            savedJobIds: checkpoint.savedJobIds,
            append: !!checkpoint.dbPath,
        };
        await desktopApi.collectionUpdate(
            id,
            collection.game_count,
            checkpoint as ImportCheckpoint,
        );
    }
    const cp = checkpoint as ImportCheckpoint;
    publish(options.requestKey, { jobId: cp.jobId, collectionId: id });
    onJob?.(cp.jobId);
    if (cp.phase === "ready") return result(collection, cp);
    const persist = async () => {
        await desktopApi.collectionUpdate(id, collection.game_count, cp);
        collection = { ...collection, metadata: { ...cp } };
    };
    const progress = (event: OtbImportProgress) =>
        publish(options.requestKey, { phase: cp.phase, message: event.message, progress: event });
    if (isNativeDesktop()) {
        const { commands, events } = await import("@/bindings");
        const { unwrap } = await import("@/utils/unwrap");
        const { appCacheDir, resolve } = await import("@tauri-apps/api/path");
        const cache = await resolve(await appCacheDir(), OTB_IMPORT_CACHE_DIRECTORY);
        if (!cp.outputPath) {
            cp.outputPath = await resolve(cache, `${cp.jobId}.pgn`);
            await persist();
        }
        if (cp.phase === "collect") {
            const unlisten = await events.otbImportProgress.listen(({ payload }) => {
                if (payload.jobId === cp.jobId) progress(payload);
            });
            try {
                cp.report = unwrap(
                    await commands.collectOtbGames(
                        createOtbImportRequest({
                            ...cp,
                            cacheDir: cache,
                            outputPath: cp.outputPath,
                        }),
                    ),
                );
            } finally {
                unlisten();
            }
            cp.phase = "save";
            await persist();
        }
        const report = cp.report!;
        if (report.gamesFound > 0) {
            publish(options.requestKey, { phase: "save", message: "Saving games…" });
            if (!cp.dbPath) {
                const { getDatabasesDir } = await import("@/utils/directories");
                cp.dbPath = await resolve(
                    await getDatabasesDir(),
                    `tournament-${id}-${cp.jobId}.db3`,
                );
                await persist();
            }
            collection.game_count = cp.append
                ? await invoke<number>("append_tournament_games", {
                      file: report.outputPath,
                      dbPath: cp.dbPath,
                      jobId: cp.jobId,
                  })
                : unwrap(
                      await commands.saveOtbDatabase(
                          report.outputPath,
                          cp.dbPath,
                          cp.jobId,
                          collection.name,
                          `Public OTB games for ${cp.playerName} (FIDE ${cp.fideId}).`,
                      ),
                  );
            const { mutate } = await import("swr");
            void mutate("databases");
        }
        cp.warning =
            report.coverageComplete === false
                ? report.coverageGaps?.join(" ") ||
                  "Some sources did not finish. Saved games are available; check again for missing games."
                : report.sources.flatMap((source) => source.errors).join(" ") || undefined;
        cp.phase = report.cancelled ? "stopped" : "ready";
    } else {
        const { startWebOtbImport, watchWebOtbImportJob, refreshWebOtbImportJob } =
            await import("@/web/otbImport");
        const request = {
            playerName: cp.playerName,
            fideId: cp.fideId,
            fromYear: cp.fromYear,
            sources: cp.sources,
        };
        if (cp.phase === "collect") await startWebOtbImport(request, cp.jobId);
        refreshWebOtbImportJob(cp.jobId);
        const job = await new Promise<import("@/web/otbImport").WebOtbImportJob>(
            (resolve, reject) => {
                let stop = () => {};
                let terminal = false;
                stop = watchWebOtbImportJob(
                    cp.jobId,
                    (job) => {
                        if (job.progress) progress(job.progress);
                        if (job.status === "completed" || job.status === "failed") {
                            terminal = true;
                            queueMicrotask(() => stop());
                            resolve(job);
                        }
                    },
                    (error) => {
                        terminal = true;
                        queueMicrotask(() => stop());
                        reject(error);
                    },
                );
                if (terminal) stop();
            },
        );
        if (
            job.request.fideId !== cp.fideId ||
            job.request.playerName !== cp.playerName ||
            job.request.fromYear !== cp.fromYear
        )
            throw new Error(
                "The saved job does not match this opponent. Its games were not imported.",
            );
        if (job.status === "failed") {
            cp.phase = "stopped";
            await persist();
            throw new Error(job.error || "The import failed. Retry to start a new search.");
        }
        cp.phase = "save";
        await persist();
        if (job.prepDatabase?.games.length) {
            publish(options.requestKey, { phase: "save", message: "Saving games to this phone…" });
            const { savePhoneTournamentImport } = await import("./phoneTournament");
            const saved = await savePhoneTournamentImport(job, collection);
            Object.assign(cp, saved);
            cp.savedJobIds = [...new Set([...(cp.savedJobIds ?? []), cp.jobId])];
            collection.game_count = saved.gameCount;
        }
        cp.warning =
            job.report?.coverageComplete === false
                ? job.report.coverageGaps?.join(" ") ||
                  "Some sources did not finish. Saved games are available."
                : undefined;
        cp.phase = job.report?.cancelled ? "stopped" : "ready";
    }
    await persist();
    return result(collection, cp);
}
function result(collection: OpponentCollection, cp: ImportCheckpoint): OpponentImportResult {
    return {
        collectionId: collection.id,
        playerName: cp.playerName,
        fideId: cp.fideId,
        fromYear: cp.fromYear,
        gameCount: collection.game_count,
        cancelled: cp.phase === "stopped",
        warning: cp.warning,
    };
}
