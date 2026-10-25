import { commands } from "@/bindings";
import { getEnginesDir } from "./directories";
import { unwrap } from "./unwrap";
import type { Engine } from "./engines";

export const stockfishUpgradeNative = {
    directory: getEnginesDir,
    completed: async (directory: string) => unwrap(await commands.getStockfish19Upgrade(directory)),
    available: async (directory: string, profiles: Engine[] = []) => unwrap(await commands.getStockfish19(directory,
        profiles.filter((engine) => engine.type === "local" && /^19(?:\.0)*$/.test(engine.version)).map((engine) => engine.type === "local" ? engine.path : ""))),
    complete: async (directory: string, digest: string) => unwrap(await commands.completeStockfish19Upgrade(directory, digest)),
};

type Status = { phase: "idle" | "running" | "waiting" | "error" | "complete"; error: string | null; revision: number };
let status: Status = { phase: "idle", error: null, revision: 0 };
let directory: string | null = null;
let decided = false;
let operation = 0;
const listeners = new Set<() => void>();
const publish = (patch: Partial<Status>) => {
    status = { ...status, ...patch };
    for (const listener of listeners) listener();
};
/** Retain an already-applied decision across marker retries and component
 * remounts. Keep the app open after an acknowledgement failure. */
export const stockfishUpgradeState = {
    getSnapshot: () => status,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    begin() {
        const token = ++operation;
        publish({ phase: "running", error: null });
        return token;
    },
    owns: (token: number) => token === operation,
    enter(nextDirectory: string, token: number) {
        if (token !== operation) return;
        if (nextDirectory !== directory) { directory = nextDirectory; decided = false; }
    },
    decided: (nextDirectory: string) => nextDirectory === directory && decided,
    rememberDecision(token: number) { if (token === operation) decided = true; },
    waiting(token: number) { if (token === operation) publish({ phase: "waiting", error: null }); },
    complete(token: number) { if (token === operation) publish({ phase: "complete", error: null }); },
    fail(error: unknown, token: number) { if (token === operation) publish({ phase: "error", error: error instanceof Error ? error.message : String(error) }); },
    retry() { operation++; publish({ phase: "idle", error: null, revision: status.revision + 1 }); },
};

export async function savedEngineDigest(text: string | null | undefined) {
    if (typeof text !== "string") throw new Error("Save engine profiles before acknowledging the upgrade.");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
