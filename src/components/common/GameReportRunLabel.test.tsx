import { webcrypto } from "node:crypto";
import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { parseUci } from "chessops";
import { createTreeStore } from "@/state/store/tree";
import { createNode, defaultTree } from "@/utils/treeReducer";
import { recordGameReportRun } from "@/utils/gameReportRun";
import { TreeStateContext } from "./TreeStateContext";
import { GameReportRunLabel } from "./GameReportRunLabel";
vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

test("only verified saved-run limits are displayed, with bounded shared help", async () => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const tree = defaultTree();
  tree.root.score = { value: { type: "cp", value: 15 }, wdl: null };
  tree.root.depth = 8;
  const node = createNode({
    fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    move: parseUci("e2e4")!,
    san: "e4",
    halfMoves: 1,
  });
  node.score = { value: { type: "cp", value: 15 }, wdl: null };
  node.depth = 8;
  tree.root.children.push(node);
  const store = createTreeStore(undefined, tree);
  await recordGameReportRun(
    store,
    { engine: "Fixture Stockfish", limit: { t: "Combined", c: { depth: 8, timeMs: 50 } } },
    () => true,
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <TreeStateContext.Provider value={store}>
            <GameReportRunLabel />
          </TreeStateContext.Provider>
        </MantineProvider>,
      );
    });
    // WebCrypto resolves on the native task queue rather than React's queue.
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
      expect(container.textContent).toContain("Depth 8 · up to 0.05 s per position");
    });
    await act(async () => (container.querySelector("button") as HTMLButtonElement).click());
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("Fixture Stockfish");
    await act(async () =>
      store.getState().setScore({ value: { type: "cp", value: 20 }, wdl: null }),
    );
    expect(container.textContent).toContain("Analysis limits not recorded");
    expect(container.textContent).not.toContain("Depth 8");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
