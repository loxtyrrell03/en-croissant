import { INITIAL_FEN } from "chessops/fen";
import type { WebCompanionState } from "./model";
import { getWebServerUrl } from "./serverUrl";

const DB_NAME = "en-croissant-web-companion";
const DB_VERSION = 1;
const STORE_NAME = "state";
const STATE_KEY = "main";
const REMOTE_STATE_URL = getWebServerUrl("api/web-state");

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
    const localState = await loadLocalWebState();
    const remoteState = await loadRemoteWebState().catch((error) => {
        console.warn(
            "Home server state is unavailable; using this device's saved workspace.",
            error,
        );
        return null;
    });
    const state = remoteState ? mergeWebStates(localState, remoteState) : localState;
    await saveLocalWebState(state);
    if (!remoteState) void saveRemoteWebState(state);
    return state;
}

export async function saveWebState(state: WebCompanionState) {
    await saveLocalWebState(state);
    await saveRemoteWebState(state).catch((error) => {
        console.warn(
            "Home server state sync failed; the change remains saved on this device.",
            error,
        );
    });
}

async function loadLocalWebState(): Promise<WebCompanionState> {
    const database = await openDatabase();
    const value = await requestToPromise<WebCompanionState | undefined>(
        database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(STATE_KEY),
    );

    return isValidState(value) ? normalizeWebState(value) : createEmptyWebState();
}

async function saveLocalWebState(state: WebCompanionState) {
    const database = await openDatabase();
    await requestToPromise(
        database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(state, STATE_KEY),
    );
}

async function loadRemoteWebState(): Promise<WebCompanionState | null> {
    const response = await fetchWithTimeout(REMOTE_STATE_URL, { cache: "no-store" });
    if (response.status === 404 || response.status === 204) return null;
    if (!response.ok || !isJsonResponse(response)) return null;
    const payload = await response.json().catch(() => null);
    const state = payload?.state ?? payload;
    return isValidState(state) ? normalizeWebState(state) : null;
}

async function saveRemoteWebState(state: WebCompanionState) {
    const response = await fetchWithTimeout(REMOTE_STATE_URL, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
    });
    if (response.status === 404 || response.status === 405) return;
    if (!response.ok) {
        throw new Error(`Home server state sync failed: ${response.status}`);
    }
}

async function fetchWithTimeout(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        window.clearTimeout(timeout);
    }
}

function isJsonResponse(response: Response) {
    return (
        response.headers.get("content-type")?.toLowerCase().includes("application/json") ?? false
    );
}

function mergeWebStates(
    localState: WebCompanionState,
    remoteState: WebCompanionState,
): WebCompanionState {
    const databases = mergeUpdatedRecords(localState.databases, remoteState.databases);
    const databaseSource = new Map(
        databases.map((database) => {
            const local = localState.databases.find((item) => item.id === database.id);
            return [database.id, local === database ? "local" : "remote"] as const;
        }),
    );
    const gamesByDatabase: WebCompanionState["gamesByDatabase"] = {};
    for (const database of databases) {
        gamesByDatabase[database.id] =
            databaseSource.get(database.id) === "local"
                ? (localState.gamesByDatabase[database.id] ??
                  remoteState.gamesByDatabase[database.id] ??
                  [])
                : (remoteState.gamesByDatabase[database.id] ??
                  localState.gamesByDatabase[database.id] ??
                  []);
    }

    return normalizeWebState({
        version: 1,
        databases,
        gamesByDatabase,
        prepWorkspaces: mergeUpdatedRecords(localState.prepWorkspaces, remoteState.prepWorkspaces),
        activePrepId: remoteState.activePrepId ?? localState.activePrepId,
        board: remoteState.board ?? localState.board,
    });
}

function mergeUpdatedRecords<T extends { id: string; updatedAt: number }>(local: T[], remote: T[]) {
    const records = new Map<string, T>();
    for (const item of local) records.set(item.id, item);
    for (const item of remote) {
        const current = records.get(item.id);
        if (!current || Number(item.updatedAt) >= Number(current.updatedAt))
            records.set(item.id, item);
    }
    return Array.from(records.values());
}

function openDatabase() {
    databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME);
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    return databasePromise;
}

function requestToPromise<T>(request: IDBRequest<T>) {
    return new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function isValidState(value: unknown): value is WebCompanionState {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<WebCompanionState>;
    return (
        candidate.version === 1 &&
        Array.isArray(candidate.databases) &&
        typeof candidate.gamesByDatabase === "object" &&
        candidate.gamesByDatabase !== null &&
        Array.isArray(candidate.prepWorkspaces)
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
