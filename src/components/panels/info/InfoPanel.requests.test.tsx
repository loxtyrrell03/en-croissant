import { MantineProvider } from "@mantine/core";
import { atom, createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { tabsAtom, currentTabAtom } from "@/state/atoms";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { createTreeStore } from "@/state/store/tree";
import { defaultTree } from "@/utils/treeReducer";
import type { Tab } from "@/utils/tabs";
import { GameSelectorAccordion } from "./InfoPanel";

const io = vi.hoisted(() => ({ read: vi.fn(), parse: vi.fn(), toast: vi.fn() }));
vi.mock("@/bindings", () => ({ commands: { readGames: io.read } }));
vi.mock("@/utils/chess", () => ({ parsePGN: io.parse }));
vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));
vi.mock("@/utils/unwrap", () => ({ unwrap: (result: { data: string[] }) => result.data }));
vi.mock("@mantine/notifications", () => ({ notifications: { show: io.toast } }));
vi.mock("@tanstack/react-router", () => ({
  useLoaderData: () => ({ documentDir: "/fixture" }),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/state/atoms", () => {
  const tabs = atom<Tab[]>([]);
  return { tabsAtom: tabs, currentTabAtom: atom((get) => get(tabs)[0]) };
});
vi.mock("@/state/keybinds", () => ({
  keyMapAtom: atom({ NEXT_GAME: { keys: ["x"] }, PREVIOUS_GAME: { keys: ["y"] } }),
}));
vi.mock("./GameSelector", () => ({
  default: ({ setPage }: { setPage: (page: number) => void }) => (
    <>
      <button onClick={() => setPage(1)}>Open first</button>
      <button onClick={() => setPage(2)}>Open second</button>
    </>
  ),
}));
vi.mock("./FenSearch", () => ({ default: () => null }));
vi.mock("./FileInfo", () => ({ default: () => null }));
vi.mock("./PgnInput", () => ({ default: () => null }));
vi.mock("@/components/common/GameInfo", () => ({ default: () => null }));

function deferred() {
  let resolve!: (value: { data: string[] }) => void;
  const promise = new Promise<{ data: string[] }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  io.parse.mockImplementation(async (name: string) => {
    const tree = defaultTree();
    tree.headers.white = name;
    return tree;
  });
});
async function mount() {
  const atoms = createStore();
  const tab: Tab = {
    name: "Fixture",
    value: "owner",
    type: "analysis",
    gameOrigin: {
      kind: "file",
      gameNumber: 0,
      file: {
        type: "file",
        name: "Fixture",
        path: "/fixture.pgn",
        numGames: 3,
        lastModified: 1,
        metadata: { type: "game", tags: [] },
      },
    },
  };
  atoms.set(tabsAtom, [tab]);
  const tree = createTreeStore();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <Provider store={atoms}>
        <MantineProvider>
          <TreeStateContext.Provider value={tree}>
            <GameSelectorAccordion games={new Map()} setGames={() => {}} />
          </TreeStateContext.Provider>
        </MantineProvider>
      </Provider>,
    ),
  );
  return {
    atoms,
    tree,
    click: async (name: string) =>
      act(async () =>
        [...host.querySelectorAll("button")].find((button) => button.textContent === name)!.click(),
      ),
    dispose: async () => {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    },
  };
}
it("applies only the latest requested game when native reads complete out of order", async () => {
  const a = deferred(),
    b = deferred();
  io.read.mockImplementation((_path, page) => (page === 1 ? a.promise : b.promise));
  const view = await mount();
  try {
    await view.click("Open first");
    await view.click("Open second");
    await act(async () => b.resolve({ data: ["Second"] }));
    await act(async () => a.resolve({ data: ["First"] }));
    expect(view.tree.getState().headers.white).toBe("Second");
    expect(view.atoms.get(currentTabAtom)?.gameOrigin).toMatchObject({ gameNumber: 2 });
  } finally {
    await view.dispose();
  }
});
it("keeps edits made while a slow game read was running", async () => {
  const pending = deferred();
  io.read.mockReturnValue(pending.promise);
  const view = await mount();
  try {
    await view.click("Open first");
    await act(async () => view.tree.getState().setComment("Keep my newer note"));
    await act(async () => pending.resolve({ data: ["Late game"] }));
    expect(view.tree.getState().root.comment).toBe("Keep my newer note");
    expect(view.tree.getState().dirty).toBe(true);
    expect(view.atoms.get(currentTabAtom)?.gameOrigin).toMatchObject({ gameNumber: 0 });
    expect(io.toast).toHaveBeenCalled();
  } finally {
    await view.dispose();
  }
});
it("cannot apply an old file read after its tab has switched sources", async () => {
  const pending = deferred();
  io.read.mockReturnValue(pending.promise);
  const view = await mount();
  try {
    await view.click("Open first");
    await act(async () =>
      view.atoms.set(tabsAtom, (tabs) =>
        tabs.map((tab) => ({ ...tab, gameOrigin: { kind: "none" } })),
      ),
    );
    await act(async () => pending.resolve({ data: ["Old source"] }));
    expect(view.tree.getState().headers.white).toBe("");
    expect(view.atoms.get(currentTabAtom)?.gameOrigin.kind).toBe("none");
  } finally {
    await view.dispose();
  }
});
