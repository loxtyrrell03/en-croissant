import { MantineProvider } from "@mantine/core";
import { Provider, createStore as createAtoms } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { createTreeStore } from "@/state/store/tree";
import { parsePgnTokens } from "@/utils/chess";
import {
  currentShowCommentsAtom,
  currentShowVariationsAtom,
  currentShowMoveAnnotationsAtom,
  tableViewAtom,
} from "@/state/atoms";
import { TreeStateContext } from "./TreeStateContext";
import GameNotation from "./GameNotation";

vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));
vi.mock("@/state/keybinds", async () => {
  const { atom } = await import("jotai");
  return { keyMapAtom: atom({ TOGGLE_BLUR: { keys: [] } }) };
});
vi.mock("@/state/atoms", async () => {
  const { atom } = await import("jotai");
  return {
    currentEvalOpenAtom: atom(false),
    currentInvisibleAtom: atom(false),
    currentShowCommentsAtom: atom(false),
    currentShowVariationsAtom: atom(false),
    currentShowMoveAnnotationsAtom: atom(false),
    tableViewAtom: atom(false),
    currentTabAtom: atom(null),
    enginesAtom: atom([]),
    moveNotationTypeAtom: atom("letters"),
  };
});

test.each([false, true])(
  "read-only preview reveals saved notes/NAGs/variations without changing edit preferences (table=%s)",
  async (table) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Element.prototype.scrollIntoView = vi.fn();
    const tree = parsePgnTokens([
      { type: "Comment", value: "Starting explanation" },
      { type: "San", value: "e4" },
      { type: "Nag", value: "$1" },
      { type: "Comment", value: "Main move note" },
      { type: "ParenOpen" },
      { type: "San", value: "d4" },
      { type: "Comment", value: "Side line note" },
      { type: "ParenClose" },
      { type: "San", value: "e5" },
    ]);
    const store = createTreeStore(undefined, tree),
      atoms = createAtoms();
    atoms.set(tableViewAtom, table);
    const before = JSON.stringify(store.getState().root);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <MantineProvider>
            <Provider store={atoms}>
              <TreeStateContext.Provider value={store}>
                <GameNotation readOnly forceDetails />
              </TreeStateContext.Provider>
            </Provider>
          </MantineProvider>,
        ),
      );
      for (const note of ["Starting explanation", "Main move note", "Side line note"])
        expect(container.textContent).toContain(note);
      const mainMove = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("e4!"),
      )!;
      expect(mainMove).toBeDefined();
      await act(async () =>
        mainMove.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })),
      );
      expect(document.querySelector('[role="menu"]')).toBeNull();
      const sideMove = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "d4",
      )!;
      await act(async () => sideMove.click());
      expect(store.getState().position).toEqual([1]);
      expect(JSON.stringify(store.getState().root)).toBe(before);
      expect(store.getState().dirty).toBe(false);
      expect(atoms.get(currentShowCommentsAtom)).toBe(false);
      expect(atoms.get(currentShowVariationsAtom)).toBe(false);
      expect(atoms.get(currentShowMoveAnnotationsAtom)).toBe(false);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  },
);
