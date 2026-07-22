import { createStore } from "jotai";
import { beforeEach, expect, test } from "vitest";
import {
    AI_COACH_GEMINI_MODEL,
    activeTabAtom,
    currentShowCommentsAtom,
    currentShowMoveAnnotationsAtom,
    currentTabAtom,
    tabsAtom,
} from "@/state/atoms";
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

test("main GPT coach model is owner-pinned", () => {
    expect(AI_COACH_GEMINI_MODEL).toBe("gpt-5.6-sol");
});

test("per-tab atoms fall back when no tab is selected", () => {
    const store = createStore();

    expect(store.get(currentShowCommentsAtom)).toBe(true);

    store.set(currentShowCommentsAtom, false);

    expect(store.get(currentShowCommentsAtom)).toBe(false);
});

test("move annotation visibility has independent per-tab fallback state", () => {
    const store = createStore();

    expect(store.get(currentShowMoveAnnotationsAtom)).toBe(true);

    store.set(currentShowMoveAnnotationsAtom, false);

    expect(store.get(currentShowMoveAnnotationsAtom)).toBe(false);
});

test("current tab falls back to the first workspace tab when active tab is stale", () => {
    const store = createStore();

    store.set(tabsAtom, [analysisTab("tab-a")]);
    store.set(activeTabAtom, "missing-tab");

    expect(store.get(currentTabAtom)?.value).toBe("tab-a");
});
