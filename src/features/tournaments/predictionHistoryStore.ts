import type { TournamentSnapshot } from "@/features/tournaments/platform";
import { emptyPredictionHistory, mergePredictionHistory, type PredictionHistory, type PredictionIdentity, type SavedPrediction } from "./predictionHistory";

const DB = "tournament-prediction-history-v1";
export const PREDICTION_HISTORY_UPDATED = "tournament-prediction-history-updated";
let opening: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  return opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("events", { keyPath: "id" });
    request.onerror = () => reject(request.error ?? new Error("Prediction history could not be opened."));
    request.onblocked = () => reject(new Error("Close another tournament window and retry saving predictions."));
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = undefined; }; resolve(db); };
  }).catch(error => { opening = undefined; throw error; });
}
/** This archive is local to this app/browser profile. It never writes tracker or Library data. */
export async function updatePredictionHistory(id: string, snapshot: TournamentSnapshot, capture?: { player: PredictionIdentity; round: number; prediction: SavedPrediction }): Promise<PredictionHistory> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("events", "readwrite");
    const store = transaction.objectStore("events");
    let result: PredictionHistory, failure: unknown, changed = false;
    const request = store.get(id);
    request.onsuccess = () => {
      try {
        const previous: PredictionHistory = request.result ?? emptyPredictionHistory(id);
        if (previous.version !== 1 || !Array.isArray(previous.rounds) || !Array.isArray(previous.closedRounds)) throw new Error("Saved predictions could not be read. They have been kept unchanged.");
        result = mergePredictionHistory(previous, snapshot, capture);
        const serialized = JSON.stringify(result);
        if (serialized.length > 4 * 1024 * 1024) throw new Error("Prediction history is full. Earlier predictions are safe.");
        changed = serialized !== JSON.stringify(previous);
        if (changed) {
          if (request.result) store.put(result);
          else { const count = store.count(); count.onsuccess = () => { if (count.result >= 32) { failure = new Error("Prediction history is full. Earlier tournaments are safe."); transaction.abort(); } else store.put(result); }; }
        }
      } catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => { if (changed) globalThis.dispatchEvent?.(new CustomEvent(PREDICTION_HISTORY_UPDATED, { detail: id })); resolve(result); };
    transaction.onabort = transaction.onerror = () => reject(failure ?? transaction.error ?? new Error("Prediction not saved. Please retry."));
  });
}

export async function deletePredictionHistory(id: string): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve,reject) => {
    const transaction = db.transaction("events", "readwrite");
    transaction.objectStore("events").delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error("Saved predictions could not be removed."));
  });
  globalThis.dispatchEvent?.(new CustomEvent(PREDICTION_HISTORY_UPDATED, { detail: id }));
}
