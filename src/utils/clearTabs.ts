import type { createStore } from "jotai";
import { commands } from "@/bindings";
import {
    activeTabAtom,
    cleanupClosedTabAtomState,
    enginesAtom,
    gameStateFamily,
    tabsAtom,
} from "@/state/atoms";
import { removeDebouncedSessionStorageItem } from "@/state/store/debouncedStorage";
import { getTabTreeStore, releaseTabTreeStore } from "@/state/store/treeRegistry";
import { getPGN } from "./chess";
import { flushReviewDeckWrites, pendingReviewDeck } from "./reviewDeckWrites";
import { hasMeaningfulTabContent } from "./tabContent";
import { createTabSaveTarget } from "./tabSaveTarget";
import { saveToFile, type Tab } from "./tabs";

type Atoms = ReturnType<typeof createStore>;
export type ClearTabsResult = {
    ok: boolean;
    closed: number;
    saved: number;
    message: string;
    warnings: string[];
};
const pending = new WeakMap<Atoms, Promise<ClearTabsResult>>();
const sourceKey = (tab: Tab) => JSON.stringify([tab.type, tab.gameOrigin]);
const isGame = (tab: Tab) => tab.type === "analysis" || tab.type === "play";
const pgnOf = (tree: ReturnType<typeof getTabTreeStore>) => {
    const state = tree.getState();
    return getPGN(state.root, {
        headers: state.headers,
        comments: true,
        extraMarkups: true,
        glyphs: true,
        variations: true,
    });
};

/** Save every original first, then remove them together without an async gap. */
export function clearTabs(atoms: Atoms, dir: string): Promise<ClearTabsResult> {
    const running = pending.get(atoms);
    if (running) return running;
    const originals = [...atoms.get(tabsAtom)];
    const operation = Promise.resolve().then(() => saveAndClear(atoms, dir, originals));
    pending.set(atoms, operation);
    void operation.finally(() => {
        if (pending.get(atoms) === operation) pending.delete(atoms);
    });
    return operation;
}

async function saveAndClear(atoms: Atoms, dir: string, originals: Tab[]): Promise<ClearTabsResult> {
    let saved = 0;
    const fail = (name: string, error: unknown): ClearTabsResult => ({
        ok: false,
        saved,
        closed: 0,
        warnings: [],
        message: `${name}: ${error instanceof Error ? error.message : String(error)}`,
    });
    let title = "Tabs";
    try {
        // Materialize every original tree before the first write, including
        // initially clean boards. Session storage may lag the live registry.
        const rows = originals.map((tab) => {
            title = tab.name;
            const tree = isGame(tab) ? getTabTreeStore(tab.value) : null;
            return {
                tab,
                tree,
                pgn: tree ? pgnOf(tree) : null,
                key: sourceKey(tab),
                phase: atoms.get(gameStateFamily(tab.value)),
            };
        });
        for (const row of rows) {
            title = row.tab.name;
            const target = createTabSaveTarget(atoms, row.tab.value);
            const current = target.get();
            if (!current) continue;
            if (sourceKey(current) !== row.key)
                throw new Error("This tab changed while saving. Its changes are still open.");
            if (!row.tree) continue;
            const state = row.tree.getState();
            const meaningful = hasMeaningfulTabContent(state);
            const unsavedOrigin =
                current.gameOrigin.kind === "none" || current.gameOrigin.kind === "temp_file";
            if ((state.dirty && (meaningful || !unsavedOrigin)) || (unsavedOrigin && meaningful)) {
                row.pgn = pgnOf(row.tree);
                const success = await saveToFile({
                    dir,
                    tab: current,
                    target,
                    store: row.tree,
                    isUserSave: true,
                    automaticName: true,
                });
                if (!success)
                    throw new Error(
                        "The original game changed during saving. Its changes are still open.",
                    );
                saved++;
                const next = target.get();
                if (next) row.key = sourceKey(next);
            }
        }
        const reviews = originals.filter(
            (tab) =>
                tab.gameOrigin.kind === "opening_review" ||
                tab.gameOrigin.kind === "mistake_review",
        );
        for (const tab of reviews) {
            title = tab.name;
            const origin = tab.gameOrigin;
            if (origin.kind === "opening_review" || origin.kind === "mistake_review")
                await flushReviewDeckWrites(origin.path);
        }
        // This is the final async boundary. Later edits to any earlier/clean
        // board, changed bindings/phases, and new review writes keep all tabs.
        for (const row of rows) {
            const current = atoms.get(tabsAtom).find((tab) => tab.value === row.tab.value);
            if (!current) continue;
            title = current.name;
            if (
                sourceKey(current) !== row.key ||
                atoms.get(gameStateFamily(current.value)) !== row.phase ||
                (row.tree && pgnOf(row.tree) !== row.pgn)
            )
                throw new Error("Changes were made while saving. Clear tabs again to save them.");
            const origin = current.gameOrigin;
            if (
                (origin.kind === "opening_review" || origin.kind === "mistake_review") &&
                pendingReviewDeck(origin.path)
            )
                throw new Error(
                    "Review progress changed while saving. Clear tabs again to save it.",
                );
        }
        const beforeClose = atoms.get(tabsAtom);
        const ids = new Set(originals.map((tab) => tab.value));
        const closing = beforeClose.filter((tab) => ids.has(tab.value));
        const remaining = beforeClose.filter((tab) => !ids.has(tab.value));
        const active = atoms.get(activeTabAtom);
        try {
            atoms.set(tabsAtom, remaining);
            if (active && ids.has(active)) atoms.set(activeTabAtom, remaining[0]?.value ?? null);
        } catch (error) {
            // atomWithStorage can change its in-memory value before persistence
            // throws. Restore both values before yielding; retain all trees.
            try {
                atoms.set(tabsAtom, beforeClose);
            } catch {
                /* base value restored */
            }
            try {
                atoms.set(activeTabAtom, active);
            } catch {
                /* base value restored */
            }
            throw error;
        }
        const warnings: string[] = [];
        for (const tab of closing) {
            try {
                removeDebouncedSessionStorageItem(tab.value);
                releaseTabTreeStore(tab.value);
            } catch (error) {
                warnings.push(`${tab.name}: session cleanup failed: ${String(error)}`);
            }
            try {
                cleanupClosedTabAtomState(tab, remaining, atoms.get(enginesAtom));
            } catch (error) {
                warnings.push(`${tab.name}: board cleanup failed: ${String(error)}`);
            }
        }
        const stopped = await Promise.allSettled(
            closing.flatMap((tab) => [
                Promise.resolve().then(async () => {
                    const result = await commands.killEngines(tab.value);
                    if (result.status === "error") throw new Error(result.error);
                }),
                Promise.resolve().then(async () => {
                    const result = await commands.abortGame(`${tab.value}-game`);
                    if (result.status === "error") throw new Error(result.error);
                }),
            ]),
        );
        for (const result of stopped)
            if (result.status === "rejected")
                warnings.push(`An engine could not be stopped: ${String(result.reason)}`);
        return { ok: true, saved, closed: closing.length, message: "Tabs cleared", warnings };
    } catch (error) {
        return fail(title, error);
    }
}
