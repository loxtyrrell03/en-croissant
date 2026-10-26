import type { EngineResourceValues } from "./engineResources";
import type { Engine, EngineSettings } from "./engines";
import type { Tab } from "./tabs";

/** The tab and selected game own drafts; moves within that game do not. */
export function analysisResourceScope(tab: Tab | undefined): string | null {
    if (!tab) return null;
    const origin = tab.gameOrigin;
    const source =
        origin.kind === "file" || origin.kind === "temp_file"
            ? [origin.file.path, origin.gameNumber]
            : origin.kind === "database"
              ? [origin.database, origin.gameId]
              : origin.kind === "opening_review" || origin.kind === "mistake_review"
                ? [origin.path]
                : [];
    return JSON.stringify([tab.value, tab.type, origin.kind, ...source]);
}

export function sameAnalysisEngine(current: Engine | undefined, expected: Engine): boolean {
    if (!current || current.id !== expected.id || current.type !== expected.type) return false;
    if (current.type === "local" && expected.type === "local")
        return current.path === expected.path;
    if (current.type === "pc" && expected.type === "pc")
        return current.url === expected.url && current.engineKind === expected.engineKind;
    return current.type !== "local" && expected.type !== "local" && current.url === expected.url;
}

export function withCpuResources(
    settings: EngineSettings,
    values: EngineResourceValues,
): EngineSettings {
    const next = settings.map((setting) =>
        setting.name === "Threads"
            ? { ...setting, value: values.threads }
            : setting.name === "Hash"
              ? { ...setting, value: values.hashMb }
              : setting,
    );
    // Callers verify both advertised UCI options before using this update.
    if (!next.some((setting) => setting.name === "Threads"))
        next.push({ name: "Threads", value: values.threads });
    if (!next.some((setting) => setting.name === "Hash"))
        next.push({ name: "Hash", value: values.hashMb });
    return next;
}
