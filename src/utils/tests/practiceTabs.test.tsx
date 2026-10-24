import { act } from "react";
import { createRoot } from "react-dom/client";
import { createStore, Provider } from "jotai";
import { MantineProvider } from "@mantine/core";
import BoardControls from "@/components/boards/BoardControls";
import { afterEach, expect, it, vi } from "vitest";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { useBlindfoldMaiaTrainer } from "@/hooks/useBlindfoldMaiaTrainer";
import { usePracticeAgainstBot } from "@/hooks/usePracticeAgainstBot";
import { useStartPracticeGame } from "@/hooks/useStartPracticeGame";
import {
  activeTabAtom,
  blindfoldGameSettingsFamily,
  currentGameStateAtom,
  DEFAULT_BLINDFOLD_GAME_SETTINGS,
  gameInputColorAtom,
  gamePlayer2SettingsAtom,
  tabsAtom,
} from "@/state/atoms";
import { createTreeStore } from "@/state/store/tree";
import { ownTabTree } from "@/state/store/treeOwner";
import { defaultTree } from "../treeReducer";
import { openPracticeTab, type PracticeMode } from "../practiceTabs";
import type { Tab } from "../tabs";

vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "windows" }));
vi.mock("@mantine/notifications", () => ({ notifications: { show: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({ useLoaderData: () => ({ documentDir: "/fixture" }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const WHITE_FEN = "7k/6pp/8/8/8/8/6PP/KR6 w - - 0 37";
const ids: string[] = [];
afterEach(() => {
  for (const id of ids.splice(0)) sessionStorage.removeItem(id);
});
function setup(kind: "file" | "database" = "file") {
  const source: Tab = {
    value: "source",
    name: "Original",
    type: "analysis",
    gameOrigin:
      kind === "database"
        ? { kind, database: "/original.db3", gameId: 12, sourceIdentity: "original" }
        : {
            kind,
            gameNumber: 2,
            sourceIdentity: "original",
            file: {
              type: "file",
              path: "/original.pgn",
              name: "Original",
              numGames: 4,
              lastModified: 1,
              metadata: { type: "game", tags: [] },
            },
          },
  };
  const initial = defaultTree(WHITE_FEN);
  initial.headers.orientation = "white";
  const tree = createTreeStore(undefined, initial);
  ownTabTree(tree, source.value);
  tree.getState().makeMove({ payload: "Rb2" });
  tree.getState().setComment("Keep my annotation");
  tree.getState().goToStart();
  tree.getState().makeMove({ payload: "Rc1" });
  tree.getState().setComment("Keep this variation");
  const atoms = createStore();
  atoms.set(tabsAtom, [source]);
  atoms.set(activeTabAtom, source.value);
  atoms.set(gameInputColorAtom, "white");
  atoms.set(gamePlayer2SettingsAtom, { type: "human" });
  atoms.set(currentGameStateAtom, "gameOver");
  atoms.set(blindfoldGameSettingsFamily(source.value), {
    ...DEFAULT_BLINDFOLD_GAME_SETTINGS,
    enabled: true,
    hideBoard: true,
    allowPeeking: true,
    aiMoveDisplayMs: 800,
    moveInputMode: "legal",
  });
  return { atoms, tree, source };
}

it.each([
  ["standard", "file"],
  ["bot", "file"],
  ["blindfold", "file"],
  ["standard", "database"],
  ["bot", "database"],
  ["blindfold", "database"],
] as const)("starts %s in a separate tab and preserves the %s source tree", async (mode, kind) => {
  const { atoms, tree, source } = setup(kind);
  const before = tree.getState();
  const blindfoldBefore = atoms.get(blindfoldGameSettingsFamily(source.value));
  const id = await openPracticeTab({ atoms, tree, mode });
  ids.push(id);
  expect(atoms.get(tabsAtom)[0]).toEqual(source);
  expect(tree.getState()).toBe(before);
  expect(tree.getState().dirty).toBe(true);
  expect(tree.getState().root.children).toHaveLength(2);
  expect(atoms.get(blindfoldGameSettingsFamily(source.value))).toEqual(blindfoldBefore);
  const opened = atoms.get(tabsAtom).find((tab) => tab.value === id)!;
  expect(opened).toMatchObject({ type: "play", gameOrigin: { kind: "none" } });
  const initial = JSON.parse(sessionStorage.getItem(id)!).state;
  expect(initial.root.fen).toBe(before.currentNode().fen);
  expect(initial.root.fen.split(" ")[1]).toBe("b");
  expect(initial.root.fen.split(" ")[5]).toBe("37");
  expect(initial.root.children).toEqual([]);
  expect(initial.headers).toMatchObject({ id: 0, result: "*" });
  expect(initial.report).toEqual({ inProgress: false });
  expect(atoms.get(currentGameStateAtom)).toBe("settingUp");
  expect(atoms.get(blindfoldGameSettingsFamily(id)).enabled).toBe(mode === "blindfold");
  expect(atoms.get(gameInputColorAtom)).toBe(mode === "standard" ? "white" : "black");
  const opponent = atoms.get(gamePlayer2SettingsAtom);
  expect(opponent.type === "engine" ? opponent.botProfile?.kind : null).toBe(
    mode === "blindfold" ? "maia" : mode === "bot" ? "patricia" : null,
  );
});

it("does not activate or alter the game state of a tab selected during creation", async () => {
  const { atoms, tree, source } = setup();
  atoms.set(tabsAtom, [
    source,
    { value: "other", name: "Other", type: "play", gameOrigin: { kind: "none" } },
  ]);
  const creating = openPracticeTab({ atoms, tree, mode: "blindfold" });
  atoms.set(activeTabAtom, "other");
  atoms.set(currentGameStateAtom, "playing");
  const id = await creating;
  ids.push(id);
  expect(atoms.get(activeTabAtom)).toBe("other");
  expect(atoms.get(currentGameStateAtom)).toBe("playing");
  expect(atoms.get(blindfoldGameSettingsFamily("other")).enabled).toBe(false);
  expect(atoms.get(blindfoldGameSettingsFamily(id)).enabled).toBe(true);
});

it("refuses a closed source instead of changing the active tab", async () => {
  const { atoms, tree } = setup();
  atoms.set(tabsAtom, []);
  await expect(openPracticeTab({ atoms, tree, mode: "bot" })).rejects.toThrow("no longer open");
  expect(atoms.get(tabsAtom)).toEqual([]);
});

it("wires Play from here and Analyze game through the actual board controls", async () => {
  const { atoms, tree, source } = setup();
  const before = tree.getState();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    act(() => root.render(<MantineProvider><Provider store={atoms}><TreeStateContext.Provider value={tree}><BoardControls editingMode={false} toggleEditingMode={() => {}} dirty={true} /></TreeStateContext.Provider></Provider></MantineProvider>));
    const play = host.querySelector<HTMLButtonElement>('button[aria-label="Board.Action.PlayFromHere"]');
    expect(play).not.toBeNull();
    await act(async () => { play!.click(); });
    const opened = atoms.get(tabsAtom)[1];
    ids.push(opened.value);
    expect(opened).toMatchObject({ type: "play", gameOrigin: { kind: "none" } });
    const analyze = host.querySelector<HTMLButtonElement>('button[aria-label="Board.Action.AnalyzeGame"]');
    expect(analyze).not.toBeNull();
    act(() => analyze!.click());
    expect(atoms.get(tabsAtom)[1]).toMatchObject({ value: opened.value, type: "analysis", gameOrigin: { kind: "none" } });
    expect(atoms.get(tabsAtom)[0]).toEqual(source);
    expect(tree.getState()).toBe(before);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it.each(["standard", "bot", "blindfold"] as PracticeMode[])(
  "wires the real %s shortcut to a new play tab",
  async (mode) => {
    const { atoms, tree, source } = setup();
    const hook =
      mode === "bot"
        ? usePracticeAgainstBot
        : mode === "blindfold"
          ? useBlindfoldMaiaTrainer
          : () => useStartPracticeGame("standard");
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let start!: () => Promise<unknown>;
    function Harness() { start = hook(); return null; }
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<Provider store={atoms}><TreeStateContext.Provider value={tree}><Harness /></TreeStateContext.Provider></Provider>));
    await act(async () => { await start(); });
    const opened = atoms.get(tabsAtom)[1];
    ids.push(opened.value);
    expect(opened.gameOrigin.kind).toBe("none");
    expect(atoms.get(tabsAtom)[0]).toEqual(source);
    expect(atoms.get(activeTabAtom)).toBe(opened.value);
    act(() => root.unmount());
    vi.unstubAllGlobals();
  },
);
