import { createStore } from "jotai";
import { beforeEach, expect, test } from "vitest";
import { activeTabAtom, currentShowCommentsAtom, currentTabAtom, tabsAtom } from "@/state/atoms";
import type { Tab } from "@/utils/tabs";

function analysisTab(value: string): Tab {
    return {
        name: "Analysis",
        value,
        type: "analysis",
        gameOrigin: { kind: "none" },
    };
}

beforeEach(() => {
    sessionStorage.clear();
});

test("per-tab atoms fall back when no tab is selected", () => {
    const store = createStore();

    expect(store.get(currentShowCommentsAtom)).toBe(true);

    store.set(currentShowCommentsAtom, false);

    expect(store.get(currentShowCommentsAtom)).toBe(false);
});

test("current tab falls back to the first workspace tab when active tab is stale", () => {
    const store = createStore();

    store.set(tabsAtom, [analysisTab("tab-a")]);
    store.set(activeTabAtom, "missing-tab");

    expect(store.get(currentTabAtom)?.value).toBe("tab-a");
});
