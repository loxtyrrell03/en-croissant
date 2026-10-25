import { invoke } from "@tauri-apps/api/core";
import { join, resolve } from "@tauri-apps/api/path";
import { commands } from "@/bindings";
import { catalogInstallKey, createCatalogInstall, type CatalogFiles } from "./catalogInstallState";
import { getEnginesDir } from "./directories";
import { enginePreferences } from "./enginePreferences";
import { requiredEngineSettings, type LocalEngine } from "./engines";

const installations = new WeakMap<object, Map<string, ReturnType<typeof createCatalogInstall>>>();
export function catalogInstall(scope: object, engine: LocalEngine) {
    let entries = installations.get(scope);
    if (!entries) installations.set(scope, (entries = new Map()));
    const key = catalogInstallKey(engine);
    let operation = entries.get(key);
    if (operation) return operation;
    const catalog = structuredClone(engine);
    operation = createCatalogInstall({
        directory: getEnginesDir,
        loadedDirectory: enginePreferences.getLoadedContext,
        saved: enginePreferences.isSavedValue,
        flush: enginePreferences.flush,
        retrySave: enginePreferences.retry,
        async download(id, directory): Promise<CatalogFiles> {
            if (catalog.managedInstall === "chessbot-lc0-0.32.1") {
                return await invoke<CatalogFiles>("install_chessbot_lc0", {
                    id,
                    enginesDir: directory,
                });
            }
            const url = catalog.downloadLink;
            if (!url) throw new Error("This engine does not have an install source.");
            let target = await resolve(directory, url.slice(url.lastIndexOf("/") + 1));
            if (url.endsWith(".zip") || url.endsWith(".tar")) target = directory;
            const result = await commands.downloadFile(id, url, target, null, null, null);
            if (result.status === "error") throw new Error(result.error);
            const path = await join(directory, ...catalog.path.split("/"));
            const executable = await commands.setFileAsExecutable(path);
            if (executable.status === "error") throw new Error(executable.error);
            return { path };
        },
        async validate(files) {
            const result = await commands.getEngineConfig(files.path);
            if (result.status === "error") throw new Error(result.error);
            const settings = result.data.options
                .filter((option) => requiredEngineSettings.includes(option.value.name))
                .map((option) => ({
                    name: option.value.name,
                    // @ts-expect-error generated UCI defaults have a wider union
                    value: option.value.default,
                }));
            if (files.weightsPath) settings.push({ name: "WeightsFile", value: files.weightsPath });
            return {
                ...catalog,
                id: crypto.randomUUID(),
                path: files.path,
                loaded: true,
                settings,
            };
        },
    });
    entries.set(key, operation);
    return operation;
}
