import { createStore } from "jotai";
import { beforeEach, expect, test } from "vitest";
import {
    AI_COACH_GEMINI_MODEL,
    activeTabAtom,
    currentShowCommentsAtom,
    currentShowMoveAnnotationsAtom,
    currentAnalysisTabAtom,
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

test("analysis reports open only by an explicit choice in each native tab", () => {
    const store = createStore();
    store.set(tabsAtom, [analysisTab("report-a"), analysisTab("report-b")]);
    store.set(activeTabAtom, "report-a");
    expect(store.get(currentAnalysisTabAtom)).toBe("engines");
    store.set(currentAnalysisTabAtom, "report");
    store.set(activeTabAtom, "report-b");
    expect(store.get(currentAnalysisTabAtom)).toBe("engines");
    store.set(currentAnalysisTabAtom, "logs");
    store.set(activeTabAtom, "report-a");
    expect(store.get(currentAnalysisTabAtom)).toBe("report");
    store.set(currentAnalysisTabAtom, "engines");
    store.set(activeTabAtom, "report-b");
    expect(store.get(currentAnalysisTabAtom)).toBe("logs");
});

test("a fresh native session and a newly opened tab keep earlier reports closed", () => {
    const old = createStore();
    old.set(tabsAtom, [analysisTab("previous-report")]);
    old.set(activeTabAtom, "previous-report");
    old.set(currentAnalysisTabAtom, "report");
    const fresh = createStore();
    fresh.set(tabsAtom, [analysisTab("previous-report")]);
    fresh.set(activeTabAtom, "previous-report");
    expect(fresh.get(currentAnalysisTabAtom)).toBe("engines");
    old.set(tabsAtom, [analysisTab("new-report-tab")]);
    old.set(activeTabAtom, "new-report-tab");
    expect(old.get(currentAnalysisTabAtom)).toBe("engines");
});
