import type { AsyncStorage } from "jotai/vanilla/utils/atomWithStorage";
import { engineSchema, type Engine } from "./engines";

type Status = {
    phase: "loading" | "missing" | "ready" | "error";
    saving: boolean;
    pending: boolean;
    error: string | null;
    value: Engine[] | undefined;
};
type IO = {
    read: () => Promise<string | null>;
    write: (text: string) => Promise<void>;
    beginLoad?: () => Promise<void>;
    identity?: () => string | undefined;
};

/** Engine reads never repair by overwriting. Writes retain failed snapshots for retry. */
export function createEnginePreferenceStore(io: IO) {
    let status: Status = {
        phase: "loading",
        saving: false,
        pending: false,
        error: null,
        value: undefined,
    };
    let expected: string | null | undefined;
    let canonical: string | undefined;
    let mutationRevision = 0;
    let loadedContext: string | undefined;
    let pending: {
        text: string;
        value: Engine[];
        owns?: () => boolean;
        verifiedOnly?: boolean;
    } | null = null;
    let queue = Promise.resolve();
    const listeners = new Set<() => void>();
    const publish = (patch: Partial<Status>) => {
        status = { ...status, ...patch };
        for (const listener of listeners) listener();
    };
    const parse = (text: string): Engine[] => {
        let raw: unknown;
        try {
            raw = JSON.parse(text);
        } catch {
            throw new Error(
                "Saved engine settings are unreadable. The original file was preserved.",
            );
        }
        const result = engineSchema.array().safeParse(raw);
        if (!result.success)
            throw new Error(
                "Saved engine settings are unreadable. The original file was preserved.",
            );
        // Keep extra fields from newer versions; normalize only recognized values in memory.
        return result.data.map((value, index) => ({ ...(raw as Engine[])[index], ...value }));
    };
    const load = async (): Promise<Engine[]> => {
        if (pending) throw new Error("Retry the pending engine save before reloading.");
        publish({ phase: "loading", error: null });
        try {
            await io.beginLoad?.();
            const text = await io.read();
            const value = text === null ? [] : parse(text);
            expected = text;
            canonical = JSON.stringify(value, null, 4);
            loadedContext = io.identity?.();
            publish({ phase: text === null ? "missing" : "ready", value, error: null });
            return value;
        } catch (error) {
            expected = undefined;
            publish({
                phase: "error",
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    };
    const save = (target: NonNullable<typeof pending>): Promise<void> => {
        const operation = queue.then(async () => {
            // Local and shared Retry can observe the same failed snapshot.
            // A second queued retry must not republish an error after the first
            // has a verified receipt and the caller has published its new model.
            if (expected === target.text && pending !== target) return;
            publish({ saving: true });
            try {
                if (expected === undefined)
                    throw new Error(
                        "Saved engines must be loaded successfully before saving. The file was preserved.",
                    );
                if (target.owns && !target.owns())
                    throw new Error(
                        "The engine changed during this edit. The pending edit was not applied.",
                    );
                const current = await io.read();
                if (target.owns && !target.owns())
                    throw new Error(
                        "The engine changed during this edit. The pending edit was not applied.",
                    );
                // Recover an uncertain successful write by observing its exact bytes.
                if (current !== target.text) {
                    if (current !== expected)
                        throw new Error(
                            "Engine settings changed in another app. Pending changes were retained; the file was preserved.",
                        );
                    await io.write(target.text);
                    if ((await io.read()) !== target.text)
                        throw new Error(
                            "The engine save could not be verified. Pending changes were retained.",
                        );
                }
                expected = target.text;
                canonical = target.text;
                if (pending === target) pending = null;
                publish({
                    phase: "ready",
                    value: target.value,
                    error: null,
                    pending: pending !== null,
                });
            } catch (error) {
                publish({
                    error: error instanceof Error ? error.message : String(error),
                    pending: true,
                });
                throw error;
            } finally {
                publish({ saving: false });
            }
        });
        queue = operation.catch(() => {});
        return operation;
    };
    const storage: AsyncStorage<Engine[]> = {
        async getItem(_key, initial) {
            if (pending) return pending.verifiedOnly ? (status.value ?? initial) : pending.value;
            try {
                return await load();
            } catch {
                return initial;
            }
        },
        async setItem(_key, value) {
            if (expected === undefined) await load();
            const text = JSON.stringify(value, null, 4);
            // Publishing an exact successful load/readback is not an edit.
            // In particular, a missing file must not become an explicit [] on
            // Retry load/upgrade. A newly created [] still records that choice.
            if (!pending && value === status.value && canonical === text) return;
            if (expected !== null && !pending && canonical === text) return;
            mutationRevision++;
            const target = { text, value: parse(text) };
            pending = target;
            publish({ pending: true });
            await save(target);
        },
        async removeItem(key) {
            await storage.setItem(key, []);
        },
    };
    return {
        storage,
        /** Stage resource edits without publishing them to running engines.
         * The caller publishes the returned value only after verified save.
         * Retry retains the original ownership guard, including global retry. */
        prepareVerifiedUpdate(value: Engine[], owns: () => boolean) {
            if (
                expected == null ||
                !status.value ||
                status.pending ||
                status.saving ||
                status.error
            )
                throw new Error("Load or finish saving engine settings before changing resources.");
            if (!owns()) throw new Error("The engine changed. Open its settings again.");
            const previous = { text: expected, canonical, value: status.value };
            const revision = ++mutationRevision;
            const target = {
                text: JSON.stringify(value, null, 4),
                value: parse(JSON.stringify(value)),
                verifiedOnly: true,
                owns: () => revision === mutationRevision && owns(),
            };
            pending = target;
            publish({ pending: true });
            return {
                value: target.value,
                /** A canceled scope can release only these exact owned bytes.
                 * This is readback, never a rollback over a newer/external file. */
                async settleCanceled() {
                    const operation = queue.then(async () => {
                        if (pending !== target) return undefined;
                        const current = await io.read();
                        if (pending !== target) return undefined;
                        if (current !== previous.text && current !== target.text)
                            throw new Error(
                                "Engine settings changed in another app. The saved file was preserved.",
                            );
                        const written = current === target.text;
                        expected = current;
                        canonical = written ? target.text : previous.canonical;
                        pending = null;
                        const value = written ? target.value : previous.value;
                        publish({ phase: "ready", value, pending: false, error: null });
                        return value;
                    });
                    queue = operation.then(
                        () => {},
                        () => {},
                    );
                    return operation;
                },
                async save() {
                    if (expected === target.text && !pending && !status.error) return;
                    if (pending !== target || !target.owns())
                        throw new Error(
                            "A newer engine edit replaced this change. Open its settings again.",
                        );
                    await save(target);
                },
                async restore() {
                    const operation = queue.then(async () => {
                        if (pending !== target || !target.owns())
                            throw new Error(
                                "A newer engine edit replaced this change. The saved file was preserved.",
                            );
                        publish({ saving: true });
                        try {
                            const current = await io.read();
                            if (!target.owns())
                                throw new Error(
                                    "The engine changed. The saved file was preserved.",
                                );
                            if (current !== previous.text && current !== target.text)
                                throw new Error(
                                    "Engine settings changed in another app. The saved file was preserved.",
                                );
                            // A write may have succeeded without its receipt. Restore only
                            // these exact owned bytes, never an external edit.
                            if (current !== previous.text) {
                                await io.write(previous.text);
                                if ((await io.read()) !== previous.text)
                                    throw new Error(
                                        "The previous engine settings could not be verified.",
                                    );
                            }
                            expected = previous.text;
                            canonical = previous.canonical;
                            if (pending === target) pending = null;
                            publish({
                                phase: "ready",
                                value: previous.value,
                                pending: pending !== null,
                                error: null,
                            });
                        } catch (error) {
                            publish({
                                error: error instanceof Error ? error.message : String(error),
                            });
                            throw error;
                        } finally {
                            publish({ saving: false });
                        }
                    });
                    queue = operation.catch(() => {});
                    await operation;
                },
            };
        },
        getSnapshot: () => status,
        getSavedText: () => expected,
        getLoadedContext: () => loadedContext,
        getMutationRevision: () => mutationRevision,
        noteModelUpdate(update: unknown) {
            // Async/function edits establish ownership before their result or
            // disk write exists. Equal concrete load/readback snapshots do not.
            let equal = false;
            try {
                equal = Array.isArray(update) && JSON.stringify(update, null, 4) === canonical;
            } catch {
                /* Save reports invalid values. */
            }
            if (!equal) mutationRevision++;
        },
        isSavedValue: (value: Engine[] | undefined) =>
            expected !== undefined &&
            !pending &&
            !status.saving &&
            !status.error &&
            value !== undefined &&
            JSON.stringify(value, null, 4) === canonical,
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        reload: load,
        noteUpdateError() {
            if (!status.error)
                publish({
                    error: "Engine settings could not be changed. The saved settings were preserved.",
                });
        },
        async retry() {
            if (pending) await save(pending);
            else await load();
        },
        async flush() {
            await queue;
            if (status.error || pending)
                throw new Error(status.error ?? "Engine settings have not been saved.");
        },
    };
}
