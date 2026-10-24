import { resolve, tempDir } from "@tauri-apps/api/path";
import { save } from "@tauri-apps/plugin-dialog";
import { copyFile, exists } from "@tauri-apps/plugin-fs";
import { z } from "zod";
import type { StoreApi } from "zustand";
import { commands } from "@/bindings";
import { pgnFiles } from "@/bindings/pgnFiles";
import { type FileMetadata, fileMetadataSchema } from "@/components/files/file";
import type { TreeStoreState } from "@/state/store/tree";
import {
    getAiCoachPersistenceTarget,
    getAiCoachSidecarPath,
    loadPersistedAiCoachReview,
    savePersistedAiCoachReview,
} from "./aiCoachPersistence";
import { getPGN, parsePGN } from "./chess";
import { hydrateOnlinePgnClocks } from "./onlinePgnClocks";
import { explicitPgnOrientation } from "./pgnOrientation";
import { type GameHeaders, getGameName, type TreeState } from "./treeReducer";
import type { TabSaveTarget } from "./tabSaveTarget";
import { tabTreeOwner } from "@/state/store/treeOwner";
import { withPgnFileTask } from "./pgnFileQueue";

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]+/g;

export function normalizeSourcePgn(pgn: string): string {
    return pgn
        .replace(/^\uFEFF/, "")
        .trim()
        .replace(/\r\n/g, "\n");
}

const reviewInitialPracticeSchema = z.object({
    mode: z.enum(["due", "all"]),
    indices: z.number().array(),
    label: z.string().optional(),
    source: z.literal("daily-goals").optional(),
    goalId: z.string().optional(),
    goalTitle: z.string().optional(),
});

function getDefaultGameFilename(headers: GameHeaders) {
    const baseName = getGameName(headers).trim();
    const date = headers.date?.trim() || "";
    const hasUsableBase = baseName.length > 0 && baseName !== "Unknown";
    const hasUsableDate = Boolean(date) && date !== "????.??.??" && date !== "????.??";

    let filename = hasUsableBase ? baseName : "";
    if (hasUsableDate) {
        filename = filename ? `${date}_${filename}` : date;
    }

    filename = filename.replace(INVALID_FILENAME_CHARS, " ").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
    let bounded = "";
    const encoder = new TextEncoder();
    for (const character of filename) {
        if (encoder.encode(bounded + character).length > 160) break;
        bounded += character;
    }
    filename = bounded.replace(/[. ]+$/, "");
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) filename = `Game ${filename}`;

    if (filename.length > 0) {
        return filename;
    }

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const time = now.toISOString().slice(11, 16).replace(":", ".");
    return `${today}_${time}_analysis`;
}

const gameOriginSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("none"),
    }),
    z.object({
        kind: z.literal("file"),
        file: fileMetadataSchema,
        gameNumber: z.number(),
        sourceIdentity: z.string().optional(),
    }),
    z.object({
        kind: z.literal("temp_file"),
        file: fileMetadataSchema,
        gameNumber: z.number(),
        sourceIdentity: z.string().optional(),
    }),
    z.object({
        kind: z.literal("database"),
        database: z.string(),
        gameId: z.number(),
        sourceIdentity: z.string().optional(),
    }),
    z.object({
        kind: z.literal("opening_review"),
        path: z.string(),
        name: z.string(),
        initialTab: z.string().optional(),
        initialPractice: reviewInitialPracticeSchema.optional(),
    }),
    z.object({
        kind: z.literal("mistake_review"),
        path: z.string(),
        name: z.string(),
        initialTab: z.string().optional(),
        initialPractice: reviewInitialPracticeSchema.optional(),
    }),
]);

export const tabSchema = z.object({
    name: z.string(),
    value: z.string(),
    type: z.enum(["new", "play", "analysis", "puzzles", "opening-review", "mistake-review"]),
    gameOrigin: gameOriginSchema,
});

export type GameOrigin = z.infer<typeof gameOriginSchema>;
export type Tab = z.infer<typeof tabSchema>;

export function getTabFile(tab?: Tab | null): FileMetadata | undefined {
    if (!tab) return undefined;
    if (tab.gameOrigin.kind === "file" || tab.gameOrigin.kind === "temp_file") {
        return tab.gameOrigin.file;
    }
    return undefined;
}

export function getTabGameNumber(tab?: Tab | null): number {
    if (!tab) return 0;
    if (tab.gameOrigin.kind === "file" || tab.gameOrigin.kind === "temp_file") {
        return tab.gameOrigin.gameNumber;
    }
    return 0;
}

export function getTabPracticeKey(tab?: Tab | null): string {
    if (!tab) return "";
    if (tab.gameOrigin.kind === "opening_review") {
        return tab.gameOrigin.path;
    }
    if (tab.gameOrigin.kind === "mistake_review") {
        return tab.gameOrigin.path;
    }
    return getTabFile(tab)?.path || "";
}

export function getTabWorkspaceKey(tab?: Tab | null): string | null {
    if (!tab) return null;

    switch (tab.gameOrigin.kind) {
        case "file":
        case "temp_file":
            return tab.gameOrigin.file.path;
        case "database":
            return `database:${tab.gameOrigin.database}:${tab.gameOrigin.gameId}`;
        case "opening_review":
        case "mistake_review":
            return tab.gameOrigin.path;
        case "none":
            return null;
    }
}

export function isPersistentGameOrigin(tab?: Tab | null): boolean {
    if (!tab) return false;
    return (
        tab.gameOrigin.kind !== "none" &&
        tab.gameOrigin.kind !== "opening_review" &&
        tab.gameOrigin.kind !== "mistake_review"
    );
}

export function genID() {
    function S4() {
        return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
    }
    return S4() + S4();
}

export async function createTab({
    tab,
    setTabs,
    setActiveTab,
    pgn,
    headers,
    gameOrigin,
    position,
    initialState,
}: {
    tab: Omit<Tab, "value" | "gameOrigin">;
    setTabs: React.Dispatch<React.SetStateAction<Tab[]>>;
    setActiveTab: React.Dispatch<React.SetStateAction<string | null>>;
    pgn?: string;
    headers?: GameHeaders;
    gameOrigin?: GameOrigin;
    position?: number[];
    initialState?: TreeState;
}) {
    const id = genID();
    if (
        gameOrigin &&
        (gameOrigin.kind === "file" || gameOrigin.kind === "temp_file") &&
        !gameOrigin.sourceIdentity
    ) {
        if (initialState)
            throw new Error(
                "A file-origin board needs its captured source identity. Reopen the file or save a separate copy.",
            );
        const captured = await pgnFiles.read(gameOrigin.file.path, gameOrigin.gameNumber);
        if (pgn !== undefined && normalizeSourcePgn(pgn) !== normalizeSourcePgn(captured.pgn))
            throw new Error(
                "The PGN changed while opening it. Refresh the game list and open it again.",
            );
        pgn = captured.pgn;
        gameOrigin = {
            ...gameOrigin,
            sourceIdentity: captured.identity,
            file: { ...gameOrigin.file, numGames: captured.gameCount, numGamesKnown: true },
        };
    }

    if (initialState !== undefined || pgn !== undefined) {
        const hydratedPgn =
            initialState === undefined && pgn !== undefined
                ? await hydrateOnlinePgnClocks(pgn)
                : pgn;
        const tree = initialState ?? (await parsePGN(hydratedPgn ?? "", headers?.fen));
        if (
            gameOrigin &&
            (gameOrigin.kind === "file" || gameOrigin.kind === "temp_file") &&
            hydratedPgn !== pgn
        )
            tree.dirty = true;
        if (headers) {
            tree.headers = {
                ...headers,
                orientation:
                    explicitPgnOrientation(headers.orientation) ?? tree.headers.orientation,
            };
            if (position) {
                tree.position = position;
            }
        }
        sessionStorage.setItem(id, JSON.stringify({ version: 0, state: tree }));
    }

    setTabs((prev) => {
        const nextTab = {
            ...tab,
            value: id,
            gameOrigin: gameOrigin ?? { kind: "none" },
        };
        if (
            prev.length === 0 ||
            (prev.length === 1 && prev[0].type === "new" && tab.type !== "new")
        ) {
            return [nextTab];
        }
        return [...prev, nextTab];
    });
    setActiveTab(id);
    return id;
}

export async function isInTempDir(filePath: string): Promise<boolean> {
    const tmp = await tempDir();
    const normalize = (p: string) => p.replace(/[\\/]+/g, "/").toLowerCase();
    return normalize(filePath).startsWith(normalize(tmp));
}

type SaveRequest = {
    dir: string;
    tab: Tab;
    target: TabSaveTarget;
    store: StoreApi<TreeStoreState>;
    isUserSave?: boolean;
    forceSaveAs?: boolean;
    copyOnly?: boolean;
    automaticName?: boolean;
    pgn: string;
    headers: GameHeaders;
    binding: string;
};
type SaveJob = {
    request: SaveRequest;
    resolve: (value: boolean) => void;
    reject: (error: unknown) => void;
};
type SaveQueue = { running: boolean; jobs: SaveJob[]; rebindings: Map<string, string> };
const saveQueues = new WeakMap<StoreApi<TreeStoreState>, SaveQueue>();

function saveBinding(tab: Tab) {
    const origin = tab.gameOrigin;
    switch (origin.kind) {
        case "file":
        case "temp_file":
            return JSON.stringify([
                origin.kind,
                origin.file.path,
                origin.gameNumber,
                origin.sourceIdentity ?? null,
            ]);
        case "database":
            return JSON.stringify([origin.kind, origin.database, origin.gameId, origin.sourceIdentity ?? null]);
        default:
            return JSON.stringify([origin.kind]);
    }
}

function savePgn(state: Pick<TreeState, "root" | "headers">) {
    return `${getPGN(state.root, { headers: state.headers, comments: true, extraMarkups: true, glyphs: true, variations: true })}\n\n`;
}


export function saveToFile({
    dir,
    tab,
    target,
    store,
    isUserSave,
    forceSaveAs,
    copyOnly,
    automaticName,
}: {
    dir: string;
    tab: Tab | undefined;
    target: TabSaveTarget;
    store: StoreApi<TreeStoreState>;
    isUserSave?: boolean;
    forceSaveAs?: boolean;
    copyOnly?: boolean;
    automaticName?: boolean;
}) {
    if (!tab) return Promise.reject(new Error("This game tab is no longer open."));
    const owner = tabTreeOwner(store);
    if (owner !== undefined && owner !== tab.value)
        return Promise.reject(
            new Error("This board belongs to a different tab. Select the game and save again."),
        );
    const state = store.getState();
    const request: SaveRequest = {
        dir,
        tab,
        target,
        store,
        isUserSave,
        forceSaveAs,
        copyOnly,
        automaticName,
        pgn: savePgn(state),
        headers: structuredClone(state.headers),
        binding: saveBinding(tab),
    };
    let queue = saveQueues.get(store);
    if (!queue) {
        queue = { running: false, jobs: [], rebindings: new Map() };
        saveQueues.set(store, queue);
    }
    const ownerQueue = queue;
    const pending = new Promise<boolean>((resolve, reject) => {
        const latest = ownerQueue.jobs.at(-1);
        if (
            !isUserSave &&
            !forceSaveAs &&
            latest &&
            !latest.request.isUserSave &&
            !latest.request.forceSaveAs &&
            latest.request.binding === request.binding
        ) {
            const previousResolve = latest.resolve,
                previousReject = latest.reject;
            latest.request = request;
            latest.resolve = (value) => {
                previousResolve(value);
                resolve(value);
            };
            latest.reject = (error) => {
                previousReject(error);
                reject(error);
            };
        } else ownerQueue.jobs.push({ request, resolve, reject });
    });
    if (!ownerQueue.running) {
        ownerQueue.running = true;
        void Promise.resolve().then(async () => {
            try {
                while (ownerQueue.jobs.length) {
                    const job = ownerQueue.jobs.shift()!;
                    try {
                        job.resolve(await performSave(job.request, ownerQueue));
                    } catch (error) {
                        job.reject(error);
                    }
                }
            } finally {
                ownerQueue.running = false;
            }
        });
    }
    return pending;
}

async function performSave(request: SaveRequest, queue: SaveQueue): Promise<boolean> {
    const origin = request.target.get()?.gameOrigin;
    if (
        origin &&
        (origin.kind === "file" || origin.kind === "temp_file") &&
        !request.forceSaveAs &&
        !(origin.kind === "temp_file" && request.isUserSave)
    )
        return withPgnFileTask(origin.file.path, () => performOwnedSave(request, queue));
    return performOwnedSave(request, queue);
}

async function performOwnedSave(request: SaveRequest, queue: SaveQueue): Promise<boolean> {
    const { dir, tab, target, store, isUserSave, forceSaveAs, copyOnly, automaticName, pgn } = request;
    if (copyOnly && !forceSaveAs) throw new Error("A copy must use a separate destination.");
    const current = target.get();
    if (!current || current.value !== tab.value)
        throw new Error("This game tab is no longer open.");
    const binding = saveBinding(current);
    if (binding !== request.binding && queue.rebindings.get(request.binding) !== binding)
        throw new Error("This tab now points to another game. Save it again from that game.");
    const stillOwnsSource = () => {
        const latest = target.get();
        return !!latest && latest.value === tab.value && saveBinding(latest) === binding;
    };
    const complete = (nextOrigin = current.gameOrigin) => {
        if (!stillOwnsSource()) return false;
        if (copyOnly) return true;
        const nextBinding = saveBinding({ ...current, gameOrigin: nextOrigin });
        target.update((owner) => {
            if (saveBinding(owner) !== binding) return owner;
            const origin = owner.gameOrigin;
            if (
                (origin.kind === "file" || origin.kind === "temp_file") &&
                (nextOrigin.kind === "file" || nextOrigin.kind === "temp_file") &&
                origin.file.path === nextOrigin.file.path
            )
                return {
                    ...owner,
                    gameOrigin: {
                        ...nextOrigin,
                        file: {
                            ...origin.file,
                            numGames: nextOrigin.file.numGames,
                            numGamesKnown: true,
                            lastModified: Math.max(Date.now(), origin.file.lastModified + 1),
                        },
                    },
                };
            return { ...owner, gameOrigin: nextOrigin };
        });
        for (const [from, to] of queue.rebindings)
            if (to === binding) queue.rebindings.set(from, nextBinding);
        queue.rebindings.set(binding, nextBinding);
        const latest = target.get();
        if (!latest || saveBinding(latest) !== nextBinding) return false;
        if (savePgn(store.getState()) === pgn) store.getState().save();
        return true;
    };
    let filePath: string;
    let nextOrigin = current.gameOrigin;
    const currentOrigin = current.gameOrigin;
    const fileOrigin =
        currentOrigin?.kind === "file" || currentOrigin?.kind === "temp_file"
            ? currentOrigin
            : undefined;
    const databaseOrigin = currentOrigin?.kind === "database" ? currentOrigin : undefined;
    const sourceCoachTarget = getAiCoachPersistenceTarget(current);
    const isTempFile = currentOrigin?.kind === "temp_file";

    if (databaseOrigin && !forceSaveAs) {
        if (!databaseOrigin.sourceIdentity)
            throw new Error(
                "Original database-game identity is missing. Your changes are still open; reopen the source or save a separate copy.",
            );
        const written = await commands.writeDbGame(
            databaseOrigin.database,
            databaseOrigin.gameId,
            pgn,
            databaseOrigin.sourceIdentity,
        );
        if (written.status === "error") throw new Error(written.error);
        return complete({ ...databaseOrigin, sourceIdentity: written.data });
    }

    const metadata = JSON.stringify(fileOrigin?.file.metadata ?? { tags: [], type: "game" });
    if (fileOrigin && !forceSaveAs && !(isTempFile && isUserSave)) {
        if (!fileOrigin.sourceIdentity)
            throw new Error(
                "Original game identity is missing. Your changes are still open; reopen the source or save a separate copy.",
            );
        const written = await pgnFiles.write(
            fileOrigin.file.path,
            fileOrigin.gameNumber,
            fileOrigin.sourceIdentity,
            pgn,
            metadata,
        );
        filePath = fileOrigin.file.path;
        nextOrigin = {
            ...fileOrigin,
            gameNumber: written.index,
            sourceIdentity: written.identity,
            file: {
                ...fileOrigin.file,
                numGames: written.gameCount,
                numGamesKnown: true,
                lastModified: Date.now(),
            },
        };
    } else {
        const headers = request.headers;
        const suggestedName = getDefaultGameFilename(headers) || "Game";
        const defaultPath = await resolve(dir, `${suggestedName}.pgn`);
        const userChoice = automaticName ? defaultPath : await save({
            defaultPath,
            filters: [{ name: "PGN", extensions: ["pgn"] }],
        });
        if (userChoice === null) return false;
        const destination = /\.pgn$/i.test(userChoice) ? userChoice : userChoice.concat(".pgn");
        if (!stillOwnsSource())
            throw new Error(
                "The original game changed while choosing a file. It has not been saved.",
            );
        const promoting = isTempFile && fileOrigin && !forceSaveAs;
        if (promoting && !fileOrigin.sourceIdentity)
            throw new Error(
                "Original temporary-game identity is missing. Save a separate copy to preserve your current game.",
            );
        const created = await pgnFiles.create(
            destination,
            pgn,
            metadata,
            promoting
                ? {
                      file: fileOrigin.file.path,
                      index: fileOrigin.gameNumber,
                      identity: fileOrigin.sourceIdentity!,
                  }
                : null,
        );
        filePath = created.file;
        if (promoting) {
            try {
                const sourceCoachPath = getAiCoachSidecarPath(fileOrigin.file.path);
                const destinationCoachPath = getAiCoachSidecarPath(filePath);
                if ((await exists(sourceCoachPath)) && !(await exists(destinationCoachPath))) {
                    await copyFile(sourceCoachPath, destinationCoachPath);
                }
            } catch {
                /* Optional analysis never invalidates a saved PGN. */
            }
        }
        nextOrigin = {
            kind: "file",
            gameNumber: created.index,
            sourceIdentity: created.identity,
            file: {
                type: "file",
                name: filePath,
                path: filePath,
                numGames: created.gameCount,
                numGamesKnown: true,
                metadata: fileOrigin?.file.metadata ?? { tags: [], type: "game" },
                lastModified: Date.now(),
            },
        };
    }
    if (forceSaveAs && sourceCoachTarget) {
        try {
            const savedReview = await loadPersistedAiCoachReview(sourceCoachTarget);
            if (savedReview) {
                await savePersistedAiCoachReview(
                    {
                        sidecarPath: getAiCoachSidecarPath(filePath),
                        recordKey: "pgn:0",
                        sourceKind: "pgn",
                    },
                    savedReview,
                );
            }
        } catch {
            // Saving the PGN must still succeed if its optional coach sidecar cannot be copied.
        }
    }
    return complete(nextOrigin);
}
