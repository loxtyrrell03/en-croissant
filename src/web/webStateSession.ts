import type { Dispatch, SetStateAction } from "react";
import type { WebCompanionState } from "./model";
import { createEmptyWebState, loadWebState, saveWebState } from "./storage";

type Snapshot = {
    state: WebCompanionState;
    savedState: WebCompanionState | null;
    loaded: boolean;
    loading: boolean;
    loadError: string | null;
    saving: boolean;
    saveError: string | null;
    revision: number;
    savedRevision: number;
};

export function createWebStateSession(io = { load: loadWebState, save: saveWebState }) {
    let snapshot: Snapshot = {
        state: createEmptyWebState(),
        savedState: null,
        loaded: false,
        loading: false,
        loadError: null,
        saving: false,
        saveError: null,
        revision: 0,
        savedRevision: 0,
    };
    const listeners = new Set<() => void>();
    let loadPromise: Promise<void> | null = null;
    let savePromise: Promise<void> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const publish = (change: Partial<Snapshot>) => {
        snapshot = { ...snapshot, ...change };
        for (const listener of listeners) listener();
    };
    const clearSaveTimer = () => {
        if (timer) clearTimeout(timer);
        timer = null;
    };
    const scheduleSave = () => {
        clearSaveTimer();
        timer = setTimeout(() => {
            timer = null;
            void flush().catch(() => {});
        }, 250);
    };
    const flush = (): Promise<void> => {
        clearSaveTimer();
        if (savePromise) return savePromise;
        if (!snapshot.loaded)
            return Promise.reject(new Error("Load the saved workspace before saving changes."));
        if (snapshot.savedRevision === snapshot.revision) return Promise.resolve();
        savePromise = Promise.resolve().then(async () => {
            let succeeded = false;
            try {
                while (snapshot.savedRevision < snapshot.revision) {
                    const state = snapshot.state,
                        revision = snapshot.revision;
                    await io.save(state);
                    publish({ savedState: state, savedRevision: revision });
                }
                succeeded = true;
            } catch (error: unknown) {
                publish({
                    saveError:
                        error instanceof Error
                            ? error.message
                            : "Browser storage rejected the latest change.",
                });
                throw error;
            } finally {
                savePromise = null;
                publish({ saving: false, ...(succeeded ? { saveError: null } : {}) });
                if (!snapshot.saveError && snapshot.savedRevision < snapshot.revision)
                    scheduleSave();
            }
        });
        publish({ saving: true });
        return savePromise;
    };
    const setState: Dispatch<SetStateAction<WebCompanionState>> = (update) => {
        // The UI is gated until loading succeeds. Never turn a failed read into
        // a fresh empty snapshot that could replace the owner's saved games.
        if (!snapshot.loaded) return;
        const next = typeof update === "function" ? update(snapshot.state) : update;
        if (next === snapshot.state) return;
        publish({ state: next, revision: snapshot.revision + 1 });
        if (snapshot.saveError || savePromise) return;
        clearSaveTimer();
        scheduleSave();
    };
    return {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        setState,
        load: () => {
            if (snapshot.loaded) return Promise.resolve();
            if (loadPromise) return loadPromise;
            loadPromise = Promise.resolve()
                .then(() => io.load())
                .then((state) => {
                    publish({ state, savedState: state, loaded: true, loadError: null });
                })
                .catch((error: unknown) => {
                    publish({
                        loadError:
                            error instanceof Error
                                ? error.message
                                : "The saved workspace could not be opened.",
                    });
                })
                .finally(() => {
                    loadPromise = null;
                    publish({ loading: false });
                });
            publish({ loading: true, loadError: null });
            return loadPromise;
        },
        flush,
        hasUnsavedChanges: () => snapshot.loaded && snapshot.revision !== snapshot.savedRevision,
        canReload: () => snapshot.loaded && snapshot.revision === snapshot.savedRevision,
    };
}

// View navigation and a remounted root keep the same pending state and writer.
export const webStateSession = createWebStateSession();

export function installWebStatePageLifecycle(session = webStateSession) {
    const flush = () => {
        if (session.hasUnsavedChanges()) void session.flush().catch(() => {});
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
        if (!session.hasUnsavedChanges()) return;
        event.preventDefault();
        event.returnValue = "";
    };
    const onVisibility = () => {
        if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
        window.removeEventListener("pagehide", flush);
        window.removeEventListener("beforeunload", beforeUnload);
        document.removeEventListener("visibilitychange", onVisibility);
        flush();
    };
}
