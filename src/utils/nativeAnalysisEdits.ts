import type { GoMode } from "@/bindings";
import { enginePreferences } from "./enginePreferences";
import type { Engine, EngineSettings, LocalEngine } from "./engines";

export type NativeAnalysisValues = { go: GoMode; settings: EngineSettings };
export type NativeAnalysisPatch = { go?: GoMode; lines?: number };
export type VerifiedEngineEdit = {
    save: () => Promise<void>;
    restore: () => Promise<void>;
    owns: () => boolean;
    isApplied?: () => boolean;
};

/** A narrow patch preserves independent UCI options and resource choices. */
export function withAnalysisPatch(
    value: NativeAnalysisValues,
    patch: NativeAnalysisPatch,
): NativeAnalysisValues {
    return {
        go: patch.go ?? value.go,
        settings:
            patch.lines === undefined
                ? value.settings
                : value.settings.map((setting) =>
                      setting.name === "MultiPV" ? { ...setting, value: patch.lines! } : setting,
                  ),
    };
}

export function withProfileAnalysisUpdate(
    engine: LocalEngine,
    update: (current: NativeAnalysisValues) => NativeAnalysisValues,
): LocalEngine {
    const source = { go: engine.go ?? { t: "Infinite" as const }, settings: engine.settings ?? [] };
    const next = update(source);
    return {
        ...engine,
        go: next.go === source.go ? engine.go : next.go,
        settings: next.settings === source.settings ? engine.settings : next.settings,
    };
}

/** Profile publication follows verified disk readback, so synced tabs cannot
 * restart using a value whose save failed. */
export function prepareNativeProfileEdit(
    engine: LocalEngine,
    current: () => Engine[] | undefined,
    publish: (value: Engine[]) => void,
    update: (current: NativeAnalysisValues) => NativeAnalysisValues,
): VerifiedEngineEdit {
    const before = current(),
        owns = () => current() === before;
    if (
        !before ||
        before.find((item) => item.id === engine.id) !== engine ||
        !enginePreferences.isSavedValue(before)
    )
        throw new Error(
            "Engine settings changed or are still saving. Open this engine again after saving finishes.",
        );
    const target = before.map((item) =>
        item === engine ? withProfileAnalysisUpdate(engine, update) : item,
    );
    const edit = enginePreferences.prepareVerifiedUpdate(target, owns);
    return {
        owns,
        isApplied: () =>
            enginePreferences.isSavedValue(current()) &&
            JSON.stringify(current()) === JSON.stringify(edit.value),
        async save() {
            try {
                await edit.save();
            } catch (error) {
                if (!owns()) await edit.settleCanceled();
                throw error;
            }
            if (!owns() || !enginePreferences.isSavedValue(edit.value))
                throw new Error(
                    "Another edit replaced this change. Current engine settings were preserved.",
                );
            publish(edit.value);
        },
        restore: edit.restore,
    };
}
