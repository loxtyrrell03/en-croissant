import { useCallback } from "react";
import { useStore } from "jotai";
import { tabsAtom } from "@/state/atoms";
import type { Tab } from "./tabs";

export type TabSaveTarget = {
    get: () => Tab | undefined;
    update: (update: (tab: Tab) => Tab) => void;
};

export function createTabSaveTarget(
    store: ReturnType<typeof useStore>,
    id: string | undefined,
): TabSaveTarget {
    return {
        get: () => store.get(tabsAtom).find((tab) => tab.value === id),
        update: (update) =>
            store.set(tabsAtom, (tabs) =>
                tabs.map((tab) => (tab.value === id ? update(tab) : tab)),
            ),
    };
}

/** Capture the requested owner, independently of later active-tab changes. */
export function useTabSaveTargets() {
    const store = useStore();
    return useCallback((id: string | undefined) => createTabSaveTarget(store, id), [store]);
}
