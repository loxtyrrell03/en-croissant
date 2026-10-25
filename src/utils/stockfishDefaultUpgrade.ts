import type { Engine, EngineSettings, LocalEngine } from "./engines";
import stockfishOptions from "../../config/stockfish-19-options.json";

const normalizedPath = (path: string) => path.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
const version = (engine: LocalEngine) => {
    const number = engine.version.match(/\d+(?:\.\d+)*/)?.[0];
    return number ? Number.parseInt(number, 10) : null;
};
function stockfish(engine: LocalEngine) {
    const filename = engine.path.replaceAll("\\", "/").split("/").at(-1) ?? "";
    return /^stockfish\b/i.test(engine.name.trim()) ||
        /^stockfish[-_](?:v?\d|windows-|linux-|macos-)/i.test(filename);
}
const options = new Map(stockfishOptions.options.map((option) => [option.name.toLowerCase(), option]));
const absoluteWindowsPath = (path: string) => /^(?:[a-z]:[\\/]|\\\\)/i.test(path);
function compatibleSettings(engine: LocalEngine) {
    return (engine.settings ?? []).every((setting) => {
        // Null settings are omitted by the actual UCI serializer.
        if (setting.value === null) return true;
        const option = options.get(setting.name.toLowerCase());
        if (!option) return false;
        if (option.type === "spin") {
            const text = String(setting.value);
            const value = Number(text);
            return /^[+-]?\d+$/.test(text) && Number.isSafeInteger(value) &&
                value >= option.min! && value <= option.max!;
        }
        if (option.type === "check") return setting.value === true || setting.value === false || setting.value === "true" || setting.value === "false";
        if (option.type !== "string" || typeof setting.value !== "string") return false;
        if (option.name === "EvalFile") return setting.value === option.default;
        if (option.name === "Debug Log File") return setting.value === "" || setting.value === "<empty>" || absoluteWindowsPath(setting.value);
        if (option.name === "SyzygyPath") return setting.value === "" || setting.value === "<empty>" || setting.value.split(";").every(absoluteWindowsPath);
        return true;
    });
}
function settings(current: EngineSettings | null | undefined, defaults: EngineSettings | null | undefined) {
    const values = new Map((defaults ?? []).map((entry) => [entry.name.toLowerCase(), entry]));
    for (const entry of current ?? []) {
        const option = options.get(entry.name.toLowerCase());
        values.set(entry.name.toLowerCase(), entry.value === "<empty>" && option?.type === "string" && option.default === "<empty>"
            ? { ...entry, value: "" } : entry);
    }
    return [...values.values()];
}

export function stockfish19Profile(install: { path: string; version: string }): LocalEngine {
    if (install.version !== "19" || !install.path)
        throw new Error("The installed Stockfish did not match version 19.");
    return {
        type: "local", id: "managed-stockfish-19", name: "Stockfish 19", version: "19", path: install.path,
        loaded: true, enabled: false, go: { t: "Depth", c: 17 },
        settings: [{ name: "MultiPV", value: 3 }, { name: "Threads", value: 8 }, { name: "Hash", value: 512 }],
    };
}

/** The first local profile is En's fallback for Play/reports/Plans. Explicit
 * per-feature IDs remain unchanged. Old profiles are kept for manual reversion;
 * this function never repoints one or enables a live session. */
export function planStockfishDefaultUpgrade(
    engines: Engine[],
    missingStore: boolean,
    available: LocalEngine | null,
    newId: () => string = () => crypto.randomUUID(),
): { engines: Engine[]; complete: boolean } {
    if (!missingStore && engines.length === 0) return { engines, complete: true };
    const first = engines.findIndex((engine) => engine.type === "local");
    const previous = first < 0 ? undefined : engines[first] as LocalEngine;
    if (!missingStore && (!previous || !stockfish(previous) || version(previous) === null || version(previous)! >= 19))
        return { engines, complete: true };
    // Preserve custom networks/fork options and incompatible values instead of
    // transferring settings that Stockfish 19 would reject. The old profile is
    // still available; manual use of the new engine starts from its own options.
    if (!missingStore && previous && !compatibleSettings(previous)) return { engines, complete: true };
    if (!available || available.version !== "19") return { engines, complete: false };
    const existing = engines.find((engine): engine is LocalEngine =>
        engine.type === "local" && normalizedPath(engine.path) === normalizedPath(available.path));
    if (existing && version(existing) !== 19) return { engines, complete: false };
    if (existing && !compatibleSettings(existing)) return { engines, complete: true };
    const inherited = missingStore ? undefined : previous;

    let target = existing;
    if (!target) {
        const id = engines.some((engine) => engine.id === available.id) ? newId() : available.id;
        if (engines.some((engine) => engine.id === id)) return { engines, complete: false };
        target = inherited ? {
            ...available, id, loaded: inherited.loaded, enabled: false,
            go: inherited.go ?? available.go,
            image: inherited.image !== undefined ? inherited.image : available.image,
            settings: settings(inherited.settings, available.settings),
        } : { ...available, id, enabled: false };
    }
    // A registered target keeps its explicit visibility/tuning. Only a newly
    // introduced visible replacement takes the older default's panel position.
    const remaining = engines.filter((engine) => engine !== existing).map((engine) =>
        !existing && engine === previous && previous.loaded && stockfish(previous) ? { ...engine, loaded: false } : engine);
    remaining.splice(missingStore || first < 0 ? 0 : first, 0, target);
    return { engines: remaining, complete: true };
}
