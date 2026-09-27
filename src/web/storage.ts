import { INITIAL_FEN } from "chessops/fen";
import type { WebCompanionState } from "./model";

const DB_NAME = "en-croissant-web-companion";
const DB_VERSION = 1;
const STORE_NAME = "state";
const STATE_KEY = "main";

let databasePromise: Promise<IDBDatabase> | null = null;

export function createEmptyWebState(): WebCompanionState {
    return {
        version: 1,
        databases: [],
        gamesByDatabase: {},
        prepWorkspaces: [],
        activePrepId: null,
        board: createEmptyWebBoardState(),
    };
}

export function createEmptyWebBoardState(): WebCompanionState["board"] {
    return {
        orientation: "white",
        startFen: INITIAL_FEN,
        line: [],
        cursor: 0,
        sourceTitle: null,
        sourceDatabaseId: null,
        sourceGameId: null,
        sourceComments: [],
    };
}

export async function loadWebState(): Promise<WebCompanionState> {
    const database = await openDatabase();
    const value = await runTransaction<WebCompanionState | undefined>(
        database,
        "readonly",
        (store) => store.get(STATE_KEY),
    );
    if (value === undefined) return createEmptyWebState();
    if (!isValidState(value))
        throw new Error("The saved workspace could not be read. Its data has been preserved.");
    return normalizeWebState(value);
}

export async function saveWebState(state: WebCompanionState) {
    const database = await openDatabase();
    await runTransaction(database, "readwrite", (store) => store.put(state, STATE_KEY));
}

function openDatabase() {
    if (databasePromise) return databasePromise;
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        let settled = false;
        const fail = (error: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
        };
        const timer = setTimeout(
            () => fail(new Error("Browser storage took too long to open. Retry loading.")),
            10_000,
        );

        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME);
            }
        };

        request.onsuccess = () => {
            const database = request.result;
            if (settled) {
                database.close();
                return;
            }
            settled = true;
            clearTimeout(timer);
            const forget = () => {
                if (databasePromise === pending) databasePromise = null;
            };
            database.onversionchange = () => {
                database.close();
                forget();
            };
            database.onclose = forget;
            resolve(database);
        };
        request.onerror = () => fail(request.error);
        request.onblocked = () =>
            fail(
                new Error(
                    "Another tab is holding browser storage open. Close it, then retry loading.",
                ),
            );
    });
    databasePromise = pending;
    void pending.catch(() => {
        if (databasePromise === pending) databasePromise = null;
    });
    return pending;
}

function runTransaction<T>(
    database: IDBDatabase,
    mode: IDBTransactionMode,
    requestFrom: (store: IDBObjectStore) => IDBRequest<T>,
) {
    return new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        let result: T;
        const timer = setTimeout(() => {
            try {
                transaction.abort();
            } catch {
                /* May already have completed. */
            }
            reject(new Error("Browser storage took too long. Keep this tab open and retry."));
        }, 60_000);
        transaction.oncomplete = () => {
            clearTimeout(timer);
            resolve(result);
        };
        transaction.onabort = () => {
            clearTimeout(timer);
            reject(
                transaction.error ??
                    new Error("Browser storage could not finish. Keep this tab open and retry."),
            );
        };
        // Request success precedes commit; the transaction can still abort.
        try {
            const request = requestFrom(transaction.objectStore(STORE_NAME));
            request.onsuccess = () => {
                result = request.result;
            };
        } catch (error) {
            clearTimeout(timer);
            try {
                transaction.abort();
            } catch {
                /* Preserve the original error. */
            }
            reject(error);
        }
    });
}

function isValidState(value: unknown): value is WebCompanionState {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<WebCompanionState>;
    return (
        candidate.version === 1 &&
        Array.isArray(candidate.databases) &&
        candidate.databases.every(
            (database) =>
                database && typeof database.id === "string" && typeof database.name === "string",
        ) &&
        typeof candidate.gamesByDatabase === "object" &&
        candidate.gamesByDatabase !== null &&
        !Array.isArray(candidate.gamesByDatabase) &&
        Object.values(candidate.gamesByDatabase).every(Array.isArray) &&
        Array.isArray(candidate.prepWorkspaces) &&
        candidate.prepWorkspaces.every(
            (prep) =>
                prep &&
                typeof prep.id === "string" &&
                Array.isArray(prep.sourceIds) &&
                Array.isArray(prep.line),
        ) &&
        (candidate.completedOtbImports === undefined ||
            (candidate.completedOtbImports !== null &&
                typeof candidate.completedOtbImports === "object" &&
                !Array.isArray(candidate.completedOtbImports) &&
                Object.values(candidate.completedOtbImports).every(
                    (receipt) =>
                        receipt &&
                        typeof receipt.databaseId === "string" &&
                        typeof receipt.prepId === "string",
                ))) &&
        (!candidate.board || Array.isArray(candidate.board.line))
    );
}

function normalizeWebState(state: WebCompanionState): WebCompanionState {
    return {
        ...state,
        prepWorkspaces: state.prepWorkspaces.map((prep) => ({
            ...prep,
            skippedMoves: prep.skippedMoves ?? {},
            panelStage: prep.panelStage === "setup" ? "setup" : "train",
        })),
        board: {
            ...createEmptyWebBoardState(),
            ...(state.board ?? {}),
            cursor: Math.min(
                Math.max(0, state.board?.cursor ?? state.board?.line?.length ?? 0),
                state.board?.line?.length ?? 0,
            ),
        },
    };
}
