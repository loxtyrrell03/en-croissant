import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { LiveTacticalScan } from "../tacticalMotifs/liveTactics";

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  getBestMoves: vi.fn(),
  killEngine: vi.fn(),
  classify: vi.fn(),
  position: {
    fen: "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5",
    lastMoveSan: "b6",
    previousFen: null,
    previousMoveUci: null,
  },
  engines: [{ id: "worker-lifecycle", type: "local", name: "Regression", settings: [] }],
}));
vi.mock("@/bindings", () => ({ events: { bestMovesPayload: { listen: mocks.listen } } }));
vi.mock("@/state/atoms", () => ({ activeTabAtom: "tab", enginesAtom: "engines" }));
vi.mock("jotai", () => ({
  useAtomValue: (atom: string) => (atom === "engines" ? mocks.engines : "board"),
}));
vi.mock("zustand", () => ({ useStore: () => mocks.position }));
vi.mock("@/components/common/TreeStateContext", async () => ({
  TreeStateContext: (await import("react")).createContext(null),
}));
vi.mock("@/utils/engines", () => ({
  getBestMoves: mocks.getBestMoves,
  killEngine: mocks.killEngine,
  engineSettingsToOptions: () => [],
}));
vi.mock("../tacticalMotifs/liveTacticsWorker", () => ({
  classifyLiveTacticsInWorker: mocks.classify,
}));
vi.mock("@/components/panels/tactics/TacticalScanResult", () => ({
  TacticalScanResult: () => <div>Verified result</div>,
}));
import TacticalClassifierPanel from "@/components/panels/tactics/TacticalClassifierPanel";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let onScanChange = vi.fn<(scan: LiveTacticalScan | null) => void>();
let succeed: (scan: LiveTacticalScan) => void;
let fail: (error: Error) => void;
let uniqueId = 0;
const dispose = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
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
  mocks.engines = [{ ...mocks.engines[0], id: `worker-lifecycle-${++uniqueId}` }];
  mocks.listen.mockResolvedValue(dispose);
  mocks.killEngine.mockResolvedValue(undefined);
  mocks.getBestMoves.mockResolvedValue([
    100,
    [
      {
        depth: 16,
        multipv: 1,
        uciMoves: ["e5f7", "d8e8", "f7h8"],
        sanMoves: ["Nxf7", "Qe8", "Nxh8"],
        score: { value: { type: "cp", value: 400 }, wdl: null },
      },
    ],
  ]);
  mocks.classify.mockImplementation(
    () =>
      new Promise<LiveTacticalScan>((resolve, reject) => {
        succeed = resolve;
        fail = reject;
      }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onScanChange = vi.fn();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function start() {
  await act(async () =>
    root.render(
      <MantineProvider env="test">
        <TacticalClassifierPanel onScanChange={onScanChange} />
      </MantineProvider>,
    ),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120);
  });
}

test("engine completion releases native work while verification remains cancellable", async () => {
  await start();
  expect(container.textContent).toContain("Verifying tactical themes");
  expect(mocks.classify).toHaveBeenCalledTimes(1);
  expect(mocks.killEngine).toHaveBeenCalledTimes(1);
  expect(dispose).toHaveBeenCalledTimes(1);
  const scan = buildLiveTacticalScan(mocks.classify.mock.calls[0][0]);
  await act(async () => succeed(scan));
  expect(container.textContent).toContain("Verified result");
  expect(onScanChange).toHaveBeenLastCalledWith(scan);
  expect(mocks.killEngine).toHaveBeenCalledTimes(1);
});

test("a classifier failure exits loading and permits retry instead of settling too early", async () => {
  await start();
  await act(async () => fail(new Error("Verification deadline")));
  expect(container.textContent).toContain("Tactical scan failed");
  expect(container.textContent).toContain("Verification deadline");
  expect(container.textContent).not.toContain("Verifying tactical themes");
  expect(onScanChange).toHaveBeenLastCalledWith(null);
  const retry = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Scan this position again"]',
  )!;
  expect(retry.disabled).toBe(false);
  await act(async () => retry.click());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120);
  });
  expect(mocks.classify).toHaveBeenCalledTimes(2);
});

test("unmount aborts proof work and a late result cannot reach board or cache", async () => {
  await start();
  const signal = mocks.classify.mock.calls[0][1] as AbortSignal;
  const scan = buildLiveTacticalScan(mocks.classify.mock.calls[0][0]);
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  onScanChange.mockClear();
  await act(async () => succeed(scan));
  expect(onScanChange).not.toHaveBeenCalled();
  await start();
  expect(mocks.classify).toHaveBeenCalledTimes(2);
});

test("late engine replies or kill-related rejection cannot disrupt verification", async () => {
  let rejectEngine!: (error: Error) => void;
  mocks.getBestMoves.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectEngine = reject;
      }),
  );
  await start();
  const requestTab = mocks.getBestMoves.mock.calls[0][1];
  const listener = mocks.listen.mock.calls[0][0];
  const payload = {
    engine: mocks.engines[0].id,
    tab: requestTab,
    fen: mocks.position.fen,
    moves: [],
    progress: 100,
    bestLines: [
      {
        depth: 16,
        multipv: 1,
        uciMoves: ["e5f7", "d8e8", "f7h8"],
        sanMoves: ["Nxf7", "Qe8", "Nxh8"],
        score: { value: { type: "cp", value: 400 }, wdl: null },
      },
    ],
  };
  await act(async () => {
    listener({ payload });
    listener({ payload });
    rejectEngine(new Error("Engine released"));
  });
  expect(mocks.classify).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("Verifying tactical themes");
  expect(container.textContent).not.toContain("Tactical scan failed");
  await act(async () => succeed(buildLiveTacticalScan(mocks.classify.mock.calls[0][0])));
  expect(container.textContent).toContain("Verified result");
});
