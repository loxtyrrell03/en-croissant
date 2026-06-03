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
  };
}

export async function loadWebState(): Promise<WebCompanionState> {
  const database = await openDatabase();
  const value = await requestToPromise<WebCompanionState | undefined>(
    database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(STATE_KEY),
  );

  return isValidState(value) ? value : createEmptyWebState();
}

export async function saveWebState(state: WebCompanionState) {
  const database = await openDatabase();
  await requestToPromise(
    database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(state, STATE_KEY),
  );
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
