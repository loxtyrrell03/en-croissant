import { useAtomValue, useStore } from "jotai";
import { useMemo } from "react";
import { activeTabAtom, enginesAtom, tabEngineSettingsFamily, tabsAtom } from "@/state/atoms";
import { enginePreferences } from "@/utils/enginePreferences";
import type { LocalEngine } from "@/utils/engines";
import type { NativeAnalysisValues, VerifiedEngineEdit } from "@/utils/nativeAnalysisEdits";
import { withProfileAnalysisUpdate } from "@/utils/nativeAnalysisEdits";
import { analysisResourceScope, sameAnalysisEngine } from "@/utils/nativeEngineResources";

export function useNativeTabSettings(engine: LocalEngine, tab: string) {
    const atoms = useStore();
    const tabSettings = useMemo(
        () =>
            tabEngineSettingsFamily({
                tab,
                engineId: engine.id,
                defaultSettings: engine.settings ?? undefined,
                defaultGo: engine.go ?? undefined,
            }),
        [tab, engine.id, engine.settings, engine.go],
    );
    const settings = useAtomValue(tabSettings);
    const scope = analysisResourceScope(useAtomValue(tabsAtom).find((item) => item.value === tab));

    function prepare(
        update: (current: NativeAnalysisValues) => NativeAnalysisValues,
        applied?: (previous: NativeAnalysisValues) => void,
    ): VerifiedEngineEdit {
        const profiles = atoms.get(enginesAtom),
            before = atoms.get(tabSettings);
        const profile = profiles?.find((item) => item.id === engine.id);
        const ownsProfile = () => atoms.get(enginesAtom) === profiles;
        const ownsScope = () => {
            const current = atoms.get(tabSettings);
            return (
                scope !== null &&
                analysisResourceScope(atoms.get(tabsAtom).find((item) => item.value === tab)) ===
                    scope &&
                sameAnalysisEngine(
                    atoms.get(enginesAtom)?.find((item) => item.id === engine.id),
                    engine,
                ) &&
                current.settings === before.settings &&
                current.go === before.go &&
                current.synced === before.synced
            );
        };
        if (
            atoms.get(activeTabAtom) !== tab ||
            !ownsScope() ||
            profile?.type !== "local" ||
            profile.path !== engine.path
        )
            throw new Error("This tab or engine changed. Open its current settings again.");
        const updated = update({ go: before.go, settings: before.settings });
        const next = { go: updated.go, settings: updated.settings };
        if (!before.synced)
            return {
                owns: ownsScope,
                async save() {
                    if (!ownsScope() || atoms.get(activeTabAtom) !== tab)
                        throw new Error("This tab changed. Its settings were preserved.");
                    applied?.(before);
                    atoms.set(tabSettings, (current) => ({ ...current, ...next }));
                },
                async restore() {},
            };
        if (!profiles || !enginePreferences.isSavedValue(profiles))
            throw new Error("Finish saving engine defaults before changing analysis settings.");
        const target = profiles.map((item) =>
            item === profile ? withProfileAnalysisUpdate(profile, update) : item,
        );
        const edit = enginePreferences.prepareVerifiedUpdate(
            target,
            () => ownsProfile() && ownsScope(),
        );
        return {
            owns: () => ownsProfile() && ownsScope(),
            isApplied: () =>
                enginePreferences.isSavedValue(atoms.get(enginesAtom)) &&
                JSON.stringify(atoms.get(enginesAtom)) === JSON.stringify(edit.value),
            async save() {
                try {
                    await edit.save();
                } catch (error) {
                    if (!ownsScope()) {
                        const settled = await edit.settleCanceled();
                        if (settled && ownsProfile() && enginePreferences.isSavedValue(settled))
                            atoms.set(enginesAtom, settled);
                    }
                    throw error;
                }
                if (!ownsProfile() || !enginePreferences.isSavedValue(edit.value))
                    throw new Error(
                        "A newer engine edit replaced this change. Current settings were preserved.",
                    );
                const tabStillOwned = ownsScope();
                atoms.set(enginesAtom, edit.value);
                if (tabStillOwned) {
                    applied?.(before);
                    atoms.set(tabSettings, (current) => ({ ...current, ...next }));
                }
            },
            restore: edit.restore,
        };
    }
    return { settings, scope, prepare };
}
