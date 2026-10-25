import type { AsyncStorage } from "jotai/vanilla/utils/atomWithStorage";
import { engineSchema, type Engine } from "./engines";

type Status = {
    phase: "loading" | "missing" | "ready" | "error";
    saving: boolean;
    pending: boolean;
    error: string | null;
    value: Engine[] | undefined;
};
type IO = { read: () => Promise<string | null>; write: (text: string) => Promise<void> };

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
    let pending: { text: string; value: Engine[] } | null = null;
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
            const text = await io.read();
            const value = text === null ? [] : parse(text);
            expected = text;
            canonical = JSON.stringify(value, null, 4);
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
            publish({ saving: true });
            try {
                if (expected === undefined)
                    throw new Error(
                        "Saved engines must be loaded successfully before saving. The file was preserved.",
                    );
                const current = await io.read();
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
            if (pending) return pending.value;
            try {
                return await load();
            } catch {
                return initial;
            }
        },
        async setItem(_key, value) {
            if (expected === undefined) await load();
            const text = JSON.stringify(value, null, 4);
            if (expected !== null && !pending && canonical === text) return;
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
        getSnapshot: () => status,
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
