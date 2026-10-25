import { resolve } from "@tauri-apps/api/path";
import {
    exists,
    readDir,
    readTextFile,
    remove,
    rename,
    writeTextFile,
} from "@tauri-apps/plugin-fs";
import { getEnginesDir } from "./directories";
import { createEnginePreferenceStore } from "./enginePreferenceStore";

let loadedDirectory: string | undefined;
async function directory() {
    const current = await getEnginesDir();
    if (loadedDirectory !== current)
        throw new Error("The engine folder changed. Restore the previous folder to save pending edits, or reload profiles before making new edits.");
    return current;
}

export const enginePreferences = createEnginePreferenceStore({
    async beginLoad() { loadedDirectory = await getEnginesDir(); },
    identity: () => loadedDirectory,
    async read() {
        const selected = await directory();
        const file = await resolve(selected, "engines.json");
        try {
            return await readTextFile(file);
        } catch (error) {
            // A boolean existence check can hide access errors. Confirm absence
            // through the parent listing before classifying this as a fresh store.
            const entries = await readDir(selected);
            if (entries.some((entry) => entry.name.toLowerCase() === "engines.json")) throw error;
            return null;
        }
    },
    async write(text) {
        const file = await resolve(await directory(), "engines.json");
        const temporary = `${file}.${crypto.randomUUID()}.tmp`;
        try {
            await writeTextFile(temporary, text);
            await rename(temporary, file);
        } finally {
            if (await exists(temporary)) await remove(temporary);
        }
    },
});
