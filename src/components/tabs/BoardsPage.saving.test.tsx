import { MantineProvider } from "@mantine/core";
import { atom, createStore, Provider } from "jotai";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { getTabTreeStore, releaseTabTreeStore } from "@/state/store/treeRegistry";
import { removeDebouncedSessionStorageItem } from "@/state/store/debouncedStorage";
import { saveToFile, type Tab } from "@/utils/tabs";
import BoardsPage from "./BoardsPage";

const io = vi.hoisted(() => ({ stop: vi.fn(), abort: vi.fn(), cleanup: vi.fn() }));
vi.mock("@/state/atoms", () => {
  const panels = atom("analysis"),
    blindfold = atom({ enabled: false });
  return {
    tabsAtom: atom<Tab[]>([]),
    activeTabAtom: atom<string | null>(null),
    enginesAtom: atom([]),
    tabFamily: () => panels,
    blindfoldGameSettingsFamily: () => blindfold,
    cleanupClosedTabAtomState: io.cleanup,
  };
});
vi.mock("@/state/keybinds", () => ({
  keyMapAtom: atom({
    CLOSE_TAB: { keys: ["mod+w"] },
    CYCLE_TABS: { keys: ["ctrl+tab"] },
    REVERSE_CYCLE_TABS: { keys: ["ctrl+shift+tab"] },
  }),
}));
vi.mock("@/bindings", () => ({ commands: { killEngines: io.stop, abortGame: io.abort } }));
vi.mock("@/utils/unwrap", () => ({ unwrap: (result: { data: unknown }) => result.data }));
vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));
vi.mock("@/utils/tabs", async (original) => ({
  ...(await original<typeof import("@/utils/tabs")>()),
  saveToFile: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "windows" }));
vi.mock("@tanstack/react-router", () => ({
  useLoaderData: () => ({ documentDir: "/fixture" }),
  useNavigate: () => vi.fn(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (text: string) => text }) }));
vi.mock("@hello-pangea/dnd", () => ({
  DragDropContext: ({ children }: { children: ReactNode }) => children,
  Droppable: ({ children }: { children: (props: object) => ReactNode }) =>
    children({ innerRef: () => {}, droppableProps: {} }),
  Draggable: ({ children }: { children: (props: object) => ReactNode }) =>
    children({ innerRef: () => {}, draggableProps: {}, dragHandleProps: {} }),
}));
vi.mock("../boards/BoardAnalysis", () => ({ default: () => null }));
vi.mock("../boards/BoardGame", () => ({ default: () => null }));
vi.mock("../puzzles/Puzzles", () => ({ default: () => null }));
vi.mock("../review/OpeningReviewWorkspace", () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  io.stop.mockResolvedValue({ status: "ok", data: null });
  io.abort.mockResolvedValue(undefined);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  for (const id of ["background-save", "active-save", ...extraIds]) {
    releaseTabTreeStore(id);
    removeDebouncedSessionStorageItem(id);
  }
  vi.unstubAllGlobals();
  extraIds.length = 0;
});
const extraIds: string[] = [];
async function mount() {
  const tabs: Tab[] = ["background-save", "active-save"].map((value) => ({
    value,
    name: value,
    type: "analysis",
    gameOrigin: { kind: "none" },
  }));
  const atoms = createStore();
  atoms.set(tabsAtom, tabs);
  atoms.set(activeTabAtom, "active-save");
  const tree = getTabTreeStore("background-save");
  tree.getState().setComment("Latest note before session flush");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <Provider store={atoms}>
        <MantineProvider>
          <BoardsPage />
        </MantineProvider>
      </Provider>,
    ),
  );
  return {
    atoms,
    tree,
    close: async () =>
      act(async () => {
        const button = host.querySelector('[aria-label="Close background-save"]')!;
        button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
        (button as HTMLButtonElement).click();
      }),
    dispose: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
it("keeps a background tab selected for its own save and retains it after cancellation", async () => {
  const view = await mount();
  vi.mocked(saveToFile).mockResolvedValue(false);
  try {
    await view.close();
    expect(view.atoms.get(activeTabAtom)).toBe("active-save");
    expect(document.body.textContent).toContain("unsaved changes in background-save");
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "Save and Close")!
        .click(),
    );
    const request = vi.mocked(saveToFile).mock.calls[0][0];
    expect(request.tab?.value).toBe("background-save");
    expect(request.store).toBe(view.tree);
    expect(request.target.get()?.value).toBe("background-save");
    expect(view.atoms.get(tabsAtom)).toHaveLength(2);
    expect(io.stop).not.toHaveBeenCalled();
  } finally {
    await view.dispose();
  }
});
it("closes only the requested background tab after the save completes", async () => {
  const view = await mount();
  vi.mocked(saveToFile).mockImplementation(async () => {
    view.tree.getState().save();
    return true;
  });
  try {
    await view.close();
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "Save and Close")!
        .click(),
    );
    expect(view.atoms.get(tabsAtom).map((tab) => tab.value)).toEqual(["active-save"]);
    expect(view.atoms.get(activeTabAtom)).toBe("active-save");
    expect(io.stop).toHaveBeenCalledExactlyOnceWith("background-save");
    expect(io.abort).toHaveBeenCalledExactlyOnceWith("background-save-game");
  } finally {
    await view.dispose();
  }
});

it("duplicates the current pending tree without copying its action closures", async () => {
  const view = await mount();
  try {
    expect(sessionStorage.getItem("background-save")).toBeNull();
    await act(async () =>
      document
        .querySelector('[aria-label="Close background-save"]')!
        .closest(".mantine-Button-root")!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    await act(async () =>
      [...document.querySelectorAll('[role="menuitem"]')]
        .find((item) => item.textContent?.includes("Duplicate Tab"))!
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    const copy = view.atoms
      .get(tabsAtom)
      .find((tab) => !["background-save", "active-save"].includes(tab.value))!;
    expect(copy).toBeDefined();
    extraIds.push(copy.value);
    const copiedTree = getTabTreeStore(copy.value);
    expect(copiedTree.getState().root.comment).toBe("Latest note before session flush");
    expect(copiedTree.getState().dirty).toBe(true);
    copiedTree.getState().setComment("Separate copy");
    expect(view.tree.getState().root.comment).toBe("Latest note before session flush");
    expect(copiedTree.getState().root.comment).toBe("Separate copy");
  } finally {
    await view.dispose();
  }
});
