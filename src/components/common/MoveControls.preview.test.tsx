import { MantineProvider } from "@mantine/core";
import { Provider, createStore as createAtoms } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { createTreeStore } from "@/state/store/tree";
import { liveReplayClockAtom, type LiveReplayClockState } from "@/state/liveReplay";
import { parsePgnTokens } from "@/utils/chess";
import { TreeStateContext } from "./TreeStateContext";
import MoveControls from "./MoveControls";
vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));
vi.mock("@/state/keybinds", async () => {
  const { atom } = await import("jotai");
  const map = Object.fromEntries(
    [
      "PREVIOUS_MOVE",
      "NEXT_MOVE",
      "GO_TO_START",
      "GO_TO_END",
      "DELETE_MOVE",
      "GO_TO_BRANCH_START",
      "GO_TO_BRANCH_END",
      "NEXT_BRANCH",
      "PREVIOUS_BRANCH",
      "NEXT_BRANCHING",
      "PREVIOUS_BRANCHING",
    ].map((key) => [key, { keys: key === "NEXT_MOVE" ? ["right"] : [] }]),
  );
  return { keyMapAtom: atom(map) };
});

test.each([true, false])(
  "preview controls isolate global keys/clocks without changing normal navigation (isolated=%s)",
  async (isolated) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
    const tree = parsePgnTokens([
      { type: "San", value: "e4" },
      { type: "San", value: "e5" },
    ]);
    const store = createTreeStore(undefined, tree),
      atoms = createAtoms();
    const marker: LiveReplayClockState = {
      color: "white",
      startSeconds: 300,
      endSeconds: 299,
      remainingMs: 500,
      totalMs: 1000,
    };
    atoms.set(liveReplayClockAtom, marker);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <MantineProvider>
            <Provider store={atoms}>
              <TreeStateContext.Provider value={store}>
                <MoveControls readOnly isolated={isolated} compact={isolated} />
              </TreeStateContext.Provider>
            </Provider>
          </MantineProvider>,
        ),
      );
      await act(async () =>
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true }),
        ),
      );
      expect(store.getState().position).toEqual(isolated ? [] : [0]);
      await act(async () =>
        (container.querySelector('[aria-label="Next move"]') as HTMLButtonElement).click(),
      );
      expect(store.getState().position).toEqual(isolated ? [0] : [0, 0]);
      expect(store.getState().dirty).toBe(false);
      expect(container.querySelector('[aria-label="Watch at game pace"]')?.textContent).toBe(
        isolated ? "" : "Live replay",
      );
      expect(atoms.get(liveReplayClockAtom)).toBe(isolated ? marker : null);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
    expect(atoms.get(liveReplayClockAtom)).toBe(isolated ? marker : null);
  },
);
