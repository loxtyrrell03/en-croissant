import { resolve } from "@tauri-apps/api/path";
import { exists, readTextFile, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { getEnginesDir } from "./directories";
import { createEnginePreferenceStore } from "./enginePreferenceStore";

async function path() {
    return resolve(await getEnginesDir(), "engines.json");
}

export const enginePreferences = createEnginePreferenceStore({
    async read() {
        const file = await path();
        return (await exists(file)) ? readTextFile(file) : null;
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
