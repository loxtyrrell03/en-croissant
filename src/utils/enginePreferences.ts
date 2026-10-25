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

async function path() {
    return resolve(await getEnginesDir(), "engines.json");
}

export const enginePreferences = createEnginePreferenceStore({
    async read() {
        const directory = await getEnginesDir();
        const file = await resolve(directory, "engines.json");
        try {
            return await readTextFile(file);
        } catch (error) {
            // A boolean existence check can hide access errors. Confirm absence
            // through the parent listing before classifying this as a fresh store.
            const entries = await readDir(directory);
            if (entries.some((entry) => entry.name.toLowerCase() === "engines.json")) throw error;
            return null;
        }
    },
    async write(text) {
        const file = await path();
        const temporary = `${file}.${crypto.randomUUID()}.tmp`;
        try {
            await writeTextFile(temporary, text);
            await rename(temporary, file);
        } finally {
            if (await exists(temporary)) await remove(temporary);
        }
    },
});
