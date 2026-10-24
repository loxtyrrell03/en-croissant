import { createStore, Provider, useAtom, useAtomValue } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  activeTabAtom,
  currentOpponentPrepAtom,
  currentTabAtom,
  currentUnderBoardOpponentPrepAtom,
  tabsAtom,
  type OpponentPrepState,
} from "@/state/atoms";
import {
  FILE_BOARD_PREFERENCES_KEY,
  loadFileBoardPreferences,
  saveFileBoardPreferences,
  type FilePrepMode,
  type FilePrepScope,
  type FilePrepSource,
} from "@/utils/fileBoardPreferences";
import type { Tab } from "@/utils/tabs";
import { useFilePrepSources } from "./useFilePrepSources";
const io = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@mantine/notifications", () => ({ notifications: { show: io.toast } }));
beforeEach(() => {
  localStorage.removeItem(FILE_BOARD_PREFERENCES_KEY);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  io.toast.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const sourceA: FilePrepSource = { source: "local", databasePath: "/a.db3", databaseLabel: "A" };
const sourceB: FilePrepSource = { source: "local", databasePath: "/b.db3", databaseLabel: "B" };
const masters: FilePrepSource = {
  source: "lch_master",
  databasePath: null,
  databaseLabel: "Masters",
};
const all: FilePrepSource = { source: "lch_all", databasePath: null, databaseLabel: "Lichess All" };
const file = (id: string, path: string): Tab => ({
  value: id,
  name: id,
  type: "analysis",
  gameOrigin: {
    kind: "file",
    gameNumber: 0,
    sourceIdentity: id,
    file: {
      type: "file",
      path,
      name: id,
      lastModified: 1,
      numGames: 1,
      metadata: { type: "game", tags: [] },
    },
  },
});
function mount(initial?: Partial<OpponentPrepState>, unbound = false) {
  const atoms = createStore();
  const a = unbound
    ? { ...file("pref-A", "C:/A.pgn"), gameOrigin: { kind: "none" as const } }
    : file("pref-A", "C:/A.pgn");
  const b = file("pref-B", "C:/B.pgn");
  atoms.set(tabsAtom, [a, b]);
  atoms.set(activeTabAtom, a.value);
  if (initial) atoms.set(currentOpponentPrepAtom, (current) => ({ ...current, ...initial }));
  const controls: Partial<
    Record<
      FilePrepScope,
      {
        value: OpponentPrepState;
        mode: (mode: FilePrepMode) => void;
        source: (source: FilePrepSource, mode?: FilePrepMode) => void;
      }
    >
  > = {};
  function Panel({ scope }: { scope: FilePrepScope }) {
    const tab = useAtomValue(currentTabAtom);
    const [prep, setPrep] = useAtom(
      scope === "side" ? currentOpponentPrepAtom : currentUnderBoardOpponentPrepAtom,
    );
    const preference = useFilePrepSources({
      tab,
      scope,
      prep,
      setPrep,
      pristine: prep.rootPath === null && prep.databasePath === null,
    });
    controls[scope] = {
      value: prep,
      mode(mode) {
        preference.markModeChoice();
        if (preference.isOwnerCurrent())
          setPrep((current) => ({
            ...current,
            mode,
            ...(mode === "general"
              ? all
              : { source: "local", databasePath: null, databaseLabel: null }),
          }));
      },
      source(source, mode = prep.mode) {
        preference.markSourceChoice(mode);
        if (preference.isOwnerCurrent()) setPrep((current) => ({ ...current, ...source, mode }));
      },
    };
    return (
      <div>
        {prep.mode}:{prep.source}:{prep.databasePath}
      </div>
    );
  }
  function Host() {
    const tab = useAtomValue(currentTabAtom);
    return (
      <>
        <Panel key={`side-${tab?.value}`} scope="side" />
        <Panel key={`under-${tab?.value}`} scope="underBoard" />
      </>
    );
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() =>
    root.render(
      <Provider store={atoms}>
        <Host />
      </Provider>,
    ),
  );
  return { atoms, controls, a, b, dispose: () => act(() => root.unmount()) };
}
it("restores independent per-file modes and sources for both placements", () => {
  saveFileBoardPreferences("C:/A.pgn", {
    orientation: "black",
    prepModes: { side: "general", underBoard: "player" },
    prepSources: { "side:general": masters, "side:player": sourceA, "underBoard:player": sourceB },
  });
  const view = mount();
  try {
    expect(view.controls.side?.value).toMatchObject({ mode: "general", ...masters });
    expect(view.controls.underBoard?.value).toMatchObject({ mode: "player", ...sourceB });
    act(() => view.controls.side!.mode("player"));
    expect(view.controls.side?.value).toMatchObject({ mode: "player", ...sourceA });
    act(() => view.controls.side!.mode("general"));
    expect(view.controls.side?.value).toMatchObject(masters);
    act(() => view.controls.side!.source(sourceA));
    expect(loadFileBoardPreferences("C:/A.pgn")).toMatchObject({
      orientation: "black",
      prepSources: {
        "side:general": sourceA,
        "side:player": sourceA,
        "underBoard:player": sourceB,
      },
    });
  } finally {
    view.dispose();
  }
});
it("keeps a fresh explicit source choice when it also switches the mode", () => {
  saveFileBoardPreferences("C:/A.pgn", {
    prepSources: { "side:general": masters, "side:player": sourceA },
  });
  const view = mount();
  try {
    act(() => view.controls.side!.source(all, "general"));
    expect(view.controls.side?.value).toMatchObject({ mode: "general", ...all });
    expect(loadFileBoardPreferences("C:/A.pgn")?.prepSources?.["side:general"]).toEqual(all);
  } finally {
    view.dispose();
  }
});
it("keeps choices separate across files and rejects a late old-tab action", () => {
  saveFileBoardPreferences("C:/A.pgn", { prepSources: { "side:player": sourceA } });
  saveFileBoardPreferences("C:/B.pgn", { prepSources: { "side:player": sourceB } });
  const view = mount();
  try {
    const old = view.controls.side!;
    act(() => view.atoms.set(activeTabAtom, view.b.value));
    expect(view.controls.side?.value).toMatchObject(sourceB);
    act(() => old.source(masters, "general"));
    expect(view.controls.side?.value).toMatchObject({ mode: "player", ...sourceB });
    expect(loadFileBoardPreferences("C:/A.pgn")?.prepSources?.["side:player"]).toEqual(sourceA);
  } finally {
    view.dispose();
  }
});
it("preserves an explicit import handoff and training progress on first mount", () => {
  saveFileBoardPreferences("C:/A.pgn", { prepSources: { "side:player": sourceB } });
  const view = mount({ ...sourceA, rootPath: [0], completedBranches: { x: 2 } });
  try {
    expect(view.controls.side?.value).toMatchObject({
      ...sourceA,
      rootPath: [0],
      completedBranches: { x: 2 },
    });
  } finally {
    view.dispose();
  }
});
it("retains live workspace choices when the first save binds a new file", () => {
  saveFileBoardPreferences("C:/B.pgn", { prepSources: { "side:player": sourceB } });
  const view = mount({ ...sourceA, rootPath: [] }, true);
  try {
    act(() =>
      view.atoms.set(tabsAtom, (tabs) =>
        tabs.map((tab) => (tab.value === view.a.value ? { ...view.b, value: view.a.value } : tab)),
      ),
    );
    expect(view.controls.side?.value).toMatchObject(sourceA);
    expect(loadFileBoardPreferences("C:/B.pgn")?.prepSources?.["side:player"]).toEqual(sourceA);
  } finally {
    view.dispose();
  }
});
