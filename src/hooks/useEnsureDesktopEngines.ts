import { notifications } from "@mantine/notifications";
import { useAtom, useAtomValue, useStore } from "jotai";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { desktopEngineSessionsBusyAtom, enginesAtom } from "@/state/atoms";
import { enginePreferences } from "@/utils/enginePreferences";
import { planStockfishDefaultUpgrade, stockfish19Profile } from "@/utils/stockfishDefaultUpgrade";
import { savedEngineDigest, stockfishUpgradeNative, stockfishUpgradeState } from "@/utils/stockfishUpgrade";
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
    const upgrade = useSyncExternalStore(stockfishUpgradeState.subscribe, stockfishUpgradeState.getSnapshot);
    const retryRevision = useRef(upgrade.revision);
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
        if (upgrade.error)
            notifications.show({ id: "stockfish-upgrade-error", color: "red", autoClose: false,
                title: "Stockfish default needs attention", message: "Engine choices are kept in this app. Keep it open and use Engines to retry the upgrade." });
        else notifications.hide("stockfish-upgrade-error");
    }, [upgrade.error]);

    useEffect(() => {
        if (retryRevision.current !== upgrade.revision) {
            retryRevision.current = upgrade.revision;
            started.current = false;
        }
        if (
            !engines ||
            busy ||
            started.current ||
            preferences.phase === "loading" ||
            preferences.phase === "error" ||
            preferences.saving ||
            preferences.pending ||
            upgrade.error ||
            !enginePreferences.isSavedValue(engines)
        )
            return;
        started.current = true;
        const token = stockfishUpgradeState.begin();
        const mutation = enginePreferences.getMutationRevision();
        const owns = () => mounted.current && stockfishUpgradeState.owns(token) && atoms.get(enginesAtom) === engines &&
            enginePreferences.getMutationRevision() === mutation && !enginePreferences.getSnapshot().error;
        const availableToChange = () => {
            if (!owns()) {
                if (mounted.current) {
                    const current = atoms.get(enginesAtom);
                    const saved = enginePreferences.getSnapshot();
                    // Retry load may replace a normalized array with an equal
                    // saved snapshot. Re-evaluate that handoff, but never retry
                    // over an owner's real edit, including edit-then-revert.
                    if (stockfishUpgradeState.owns(token) && enginePreferences.getMutationRevision() === mutation &&
                        (current === undefined || saved.phase === "loading" || saved.phase === "error" ||
                        (enginePreferences.isSavedValue(current) && JSON.stringify(current) === JSON.stringify(engines))))
                        started.current = false;
                    stockfishUpgradeState.waiting(token);
                }
                return false;
            }
            if (atoms.get(desktopEngineSessionsBusyAtom)) {
                started.current = false;
                stockfishUpgradeState.waiting(token);
                return false;
            }
            return true;
        };
        void (async () => {
            const directory = await stockfishUpgradeNative.directory();
            if (!availableToChange()) return;
            stockfishUpgradeState.enter(directory, token);
            const loadedDirectory = enginePreferences.getLoadedContext();
            if (loadedDirectory !== undefined && loadedDirectory !== directory)
                throw new Error("The engine folder changed. Retry after loading its saved engine profiles.");
            const completed = await stockfishUpgradeNative.completed(directory);
            if (!availableToChange()) return;
            // Existing [] is an explicit choice. Acknowledge it without asset
            // discovery, legacy seeding, network access or engine startup.
            const explicitEmpty = preferences.phase === "ready" && engines.length === 0;
            const acknowledgementOnly = !completed && stockfishUpgradeState.decided(directory);
            const preserveList = explicitEmpty || acknowledgementOnly;
            const installed = preserveList ? [] : await discoverInstalledDesktopEngines().catch(() => []);
            if (!availableToChange()) return;
            const withPcLc0 = preserveList || engines.some((engine) => engine.id === "gaming-pc-lc0")
                ? engines : [...engines, createGamingPcLc0Engine()];
            const baseline = preserveList ? engines : mergeInstalledDesktopEngines(withPcLc0, installed);
            let planned = completed || stockfishUpgradeState.decided(directory)
                ? { engines: baseline, complete: true }
                : planStockfishDefaultUpgrade(baseline, preferences.phase === "missing", null);
            if (!planned.complete) {
                const available = await stockfishUpgradeNative.available(directory, baseline);
                if (!availableToChange()) return;
                planned = planStockfishDefaultUpgrade(baseline, preferences.phase === "missing", available ? stockfish19Profile(available) : null);
            }
            if (!availableToChange()) return;
            if (await stockfishUpgradeNative.directory() !== directory)
                throw new Error("The engine folder changed. Retry after loading its saved engine profiles.");
            if (!availableToChange()) return;
            if (JSON.stringify(planned.engines) !== JSON.stringify(engines)) setEngines(planned.engines);
            if (planned.complete) stockfishUpgradeState.rememberDecision(token);
            await enginePreferences.flush();
            if (!mounted.current || !stockfishUpgradeState.owns(token)) return;
            if (!planned.complete) { stockfishUpgradeState.waiting(token); return; }
            if (!completed) {
                if (await stockfishUpgradeNative.directory() !== directory) {
                    throw new Error("The engine folder changed. Retry after loading its saved engine profiles.");
                }
                await stockfishUpgradeNative.complete(directory, await savedEngineDigest(enginePreferences.getSavedText()));
            }
            stockfishUpgradeState.complete(token);
        })().catch((error) => {
            if (!mounted.current) return;
            started.current = false;
            if (enginePreferences.getSnapshot().error) stockfishUpgradeState.waiting(token);
            else stockfishUpgradeState.fail(error, token);
        });
    }, [atoms, busy, engines, preferences, setEngines, upgrade]);
}
