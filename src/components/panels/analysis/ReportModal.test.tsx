import { MantineProvider } from "@mantine/core";
import { Provider, createStore as createAtomStore } from "jotai";
import { createStore } from "zustand";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { reportSettingsAtom } from "@/state/gameAnalysisSettings";
import type { TreeStoreState } from "@/state/store/tree";
import { DEFAULT_GAME_REPORT_SETTINGS, type GameReportLimit } from "@/utils/gameAnalysisSettings";
import { defaultTree } from "@/utils/treeReducer";
import ReportModal from "./ReportModal";

const native = vi.hoisted(() => ({ analyzeGame: vi.fn(), cancelAnalysis: vi.fn() }));
vi.mock("@/bindings", () => ({ commands: native }));
vi.mock("@/state/atoms", async () => {
  const { atom } = await import("jotai");
  return {
    enginesAtom: atom([
      {
        id: "sf",
        type: "local",
        path: "C:/Fixture/stockfish.exe",
        name: "Fixture Stockfish",
        loaded: true,
        settings: [],
      },
    ]),
    referenceDbAtom: atom(null),
  };
});
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
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
  HTMLElement.prototype.scrollIntoView = vi.fn();
  native.analyzeGame.mockReset().mockResolvedValue({ status: "ok", data: [] });
  native.cancelAnalysis.mockReset().mockResolvedValue({ status: "ok" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(limit: GameReportLimit = DEFAULT_GAME_REPORT_SETTINGS.goMode) {
  const atoms = createAtomStore();
  atoms.set(reportSettingsAtom, {
    ...DEFAULT_GAME_REPORT_SETTINGS,
    novelty: false,
    engine: "sf",
    goMode: limit,
  });
  const addAnalysis = vi.fn();
  const store = createStore<TreeStoreState>()(
    (set) =>
      ({
        ...defaultTree(),
        addAnalysis,
        setReportInProgress: (inProgress: boolean) =>
          set((state) => ({ report: { ...state.report, inProgress } })),
        setReportError: (error: string | null) =>
          set((state) => ({ report: { ...state.report, error } })),
      }) as unknown as TreeStoreState,
  );
  await act(async () =>
    root.render(
      <MantineProvider env="test">
        <Provider store={atoms}>
          <TreeStateContext.Provider value={store}>
            <ReportModal
              tab="owned-tab"
              reportingMode={true}
              toggleReportingMode={vi.fn()}
              setInProgress={store.getState().setReportInProgress}
            />
          </TreeStateContext.Provider>
        </Provider>
      </MantineProvider>,
    ),
  );
  return { store, addAnalysis, atoms };
}
async function submit() {
  await act(async () =>
    document
      .querySelector('button[type="submit"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
}
test("the Low preset sends depth 8 and 50 ms to the native report command", async () => {
  const { addAnalysis } = await render();
  await act(async () => (document.querySelector('input[value="low"]') as HTMLInputElement).click());
  await submit();
  expect(native.analyzeGame).toHaveBeenCalledWith(
    "report_owned-tab",
    "C:/Fixture/stockfish.exe",
    { t: "Time", c: 50 },
    expect.objectContaining({ searchLimits: { depth: 8, timeMs: 50 } }),
    [],
  );
  expect(addAnalysis).toHaveBeenCalledTimes(1);
});
test("legacy time-only settings remain time-only when submitted", async () => {
  await render({ t: "Time", c: 500 });
  await submit();
  expect(native.analyzeGame.mock.calls[0][2]).toEqual({ t: "Time", c: 500 });
  expect(native.analyzeGame.mock.calls[0][3].searchLimits).toBeUndefined();
});
test("changing the game cancels its request and prevents late evidence from being applied", async () => {
  let finish!: (result: unknown) => void;
  native.analyzeGame.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { store, addAnalysis } = await render();
  await submit();
  await act(async () =>
    store.setState({ root: defaultTree("4k3/7p/8/8/8/8/6K1/R7 b - - 0 20").root }),
  );
  await act(async () => finish({ status: "ok", data: [] }));
  expect(native.cancelAnalysis).toHaveBeenCalledWith("report_owned-tab");
  expect(addAnalysis).not.toHaveBeenCalled();
  expect(store.getState().report.error).toContain("game changed");
  expect(store.getState().report.inProgress).toBe(false);
});
test("a failed native search keeps existing evidence and exposes a retryable error", async () => {
  native.analyzeGame.mockResolvedValue({
    status: "error",
    error: "No exact score. Try a longer limit.",
  });
  const { store, addAnalysis } = await render();
  const score = { value: { type: "cp" as const, value: 73 }, wdl: null };
  store.setState((state) => ({ root: { ...state.root, score } }));
  await submit();
  expect(store.getState().report.error).toContain("No exact score");
  expect(store.getState().root.score).toBe(score);
  expect(addAnalysis).not.toHaveBeenCalled();
  expect(store.getState().report.inProgress).toBe(false);
});
