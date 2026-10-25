import { notifications } from "@mantine/notifications";
import { useAtom, useAtomValue, useStore } from "jotai";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { desktopEngineSessionsBusyAtom, enginesAtom } from "@/state/atoms";
import { enginePreferences } from "@/utils/enginePreferences";
import {
    createGamingPcLc0Engine,
    discoverInstalledDesktopEngines,
    mergeInstalledDesktopEngines,
} from "@/utils/engines";

export function useEnsureDesktopEngines() {
    const [engines, setEngines] = useAtom(enginesAtom);
    const atoms = useStore();
    const busy = useAtomValue(desktopEngineSessionsBusyAtom);
    const preferences = useSyncExternalStore(
        enginePreferences.subscribe,
        enginePreferences.getSnapshot,
    );
    const started = useRef(false);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const lastError = useRef<string | null>(null);
    useEffect(() => {
        if (preferences.error && preferences.error !== lastError.current)
            notifications.show({
                id: "engine-preferences-error",
                color: "red",
                autoClose: false,
                title: "Engine settings need attention",
                message: preferences.pending
                    ? "Pending settings are kept in this app. Keep it open and use Engines to retry saving."
                    : "The saved settings file was left unchanged. Open Engines to retry loading it.",
            });
        if (!preferences.error && lastError.current) notifications.hide("engine-preferences-error");
        lastError.current = preferences.error;
    }, [preferences.error, preferences.pending]);

    useEffect(() => {
        if (
            !engines ||
            busy ||
            started.current ||
            preferences.phase === "loading" ||
            preferences.phase === "error" ||
            preferences.saving ||
            preferences.pending ||
            engines !== preferences.value
        )
            return;
        started.current = true;
        // An existing empty list is an explicit choice, not a fresh installation.
        if (preferences.phase === "ready" && engines.length === 0) return;
        void discoverInstalledDesktopEngines()
            .catch(() => [])
            .then((installed) => {
                if (!mounted.current) return;
                if (atoms.get(desktopEngineSessionsBusyAtom)) {
                    started.current = false;
                    return;
                }
                const current = atoms.get(enginesAtom);
                if (current !== engines || enginePreferences.getSnapshot().error) return;
                const withPcLc0 = current.some((engine) => engine.id === "gaming-pc-lc0")
                    ? current
                    : [...current, createGamingPcLc0Engine()];
                setEngines(mergeInstalledDesktopEngines(withPcLc0, installed));
            });
    }, [atoms, busy, engines, preferences, setEngines]);
}
