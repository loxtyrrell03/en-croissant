import { MantineProvider } from "@mantine/core";
import { createStore } from "zustand";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { defaultTree, createNode } from "@/utils/treeReducer";
import { parseUci } from "chessops";
import type { TreeStoreState } from "@/state/store/tree";
import GameAnalysisReport from "./GameAnalysisReport";
import { TreeStateContext } from "./TreeStateContext";

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
test("one played side can show accuracy while the absent side stays unavailable", async () => {
  const tree = defaultTree(); tree.headers.white = "Invented White"; tree.headers.black = "Invented Black";
  const child = createNode({ fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", san: "e4", move: parseUci("e2e4")!, halfMoves: 1 });
  child.score = { value: { type: "cp", value: 15 }, wdl: null }; tree.root.children.push(child);
  const store = createStore(() => ({ ...tree, goToMove: vi.fn() }) as unknown as TreeStoreState);
  await act(async () => root.render(<MantineProvider><TreeStateContext.Provider value={store}><GameAnalysisReport isAnalysing={false} /></TreeStateContext.Provider></MantineProvider>));
  expect(container.textContent).toContain("Invented White");
  expect(container.textContent?.match(/100%/g)).toHaveLength(1);
  expect(container.querySelectorAll('[aria-label="Help: Game accuracy"]')).toHaveLength(2);
  await act(async () => (container.querySelector('[aria-label="Help: Game accuracy"]') as HTMLButtonElement).click());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("actual starting score for custom positions");
});
