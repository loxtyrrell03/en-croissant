import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { LiveTacticalScan } from "../tacticalMotifs/liveTactics";

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  getBestMoves: vi.fn(),
  killEngine: vi.fn(),
  stopEngine: vi.fn(),
  classify: vi.fn(),
  nominate: vi.fn(),
  tree: null as any,
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
vi.mock("zustand", () => ({ useStore: (_store: unknown, selector: (tree: any) => unknown) => mocks.tree ? selector(mocks.tree) : mocks.position }));
vi.mock("@/components/common/TreeStateContext", async () => ({
  TreeStateContext: (await import("react")).createContext(null),
}));
vi.mock("@/utils/engines", () => ({
  getBestMoves: mocks.getBestMoves,
  killEngine: mocks.killEngine,
  stopEngine: mocks.stopEngine,
  engineSettingsToOptions: () => [],
}));
vi.mock("../tacticalMotifs/liveTacticsWorker", () => ({
  classifyLiveTacticsInWorker: mocks.classify,
}));
vi.mock("../tacticalMotifs/tacticalCandidateMoves", () => ({
  nominateTacticalCandidateMoves: mocks.nominate,
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
  mocks.nominate.mockReturnValue([]);
  mocks.tree = null;
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
  mocks.stopEngine.mockResolvedValue(undefined);
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
    (_input, _signal, onStarted) =>
      new Promise<LiveTacticalScan>((resolve, reject) => {
        succeed = resolve;
        fail = reject;
        onStarted?.();
      }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onScanChange = vi.fn();
});

function emit(depth: number, progress = (depth / 16) * 100, uciMoves = ["e5f7", "d8e8", "f7h8"], searchMoves?: string[]) {
  mocks.listen.mock.calls[0][0]({
    payload: {
      engine: mocks.engines[0].id,
      tab: mocks.getBestMoves.mock.calls[0][1],
      fen: mocks.position.fen,
      moves: [],
      progress,
      searchMoves,
      bestLines: [
        {
          depth,
          multipv: 1,
          uciMoves,
          sanMoves: [],
          score: { value: { type: "cp", value: 400 }, wdl: null },
        },
      ],
    },
  });
}

test("the real nominator drives a separate owned search and preserves the main line", async () => {
  const actual = await vi.importActual<typeof import("../tacticalMotifs/tacticalCandidateMoves")>("../tacticalMotifs/tacticalCandidateMoves");
  mocks.nominate.mockImplementation(actual.nominateTacticalCandidateMoves);
  mocks.getBestMoves.mockResolvedValueOnce(mocks.getBestMoves.getMockImplementation()!());
  mocks.getBestMoves.mockImplementation(() => new Promise(() => {}));
  await start();
  const [engine, tab, mode, options] = mocks.getBestMoves.mock.calls[1];
  expect([engine, tab, mode]).toEqual(mocks.getBestMoves.mock.calls[0].slice(0, 3));
  expect(options.searchMoves).toContain("c4f7");
  expect(options.searchMoves).not.toContain("e5f7");
  expect(options.extraOptions).toContainEqual({ name: "MultiPV", value: "2" });
  expect(mocks.classify).not.toHaveBeenCalled();
  expect(mocks.killEngine).not.toHaveBeenCalled();
  await act(async () => emit(16, 100, ["c4f7", "e8f8"], options.searchMoves));
  const input = mocks.classify.mock.calls[0][0];
  expect(input.variations[0].pvUci[0]).toBe("e5f7");
  expect(input.supplementalVariations[0]).toMatchObject({ pvUci: ["c4f7", "e8f8"], cp: 400, depth: 16 });
  expect(input.supplementalSearchIncomplete).toBe(false);
  expect(mocks.killEngine).toHaveBeenCalledTimes(1);
});

test("late same-board main events cannot impersonate targeted evidence", async () => {
  mocks.nominate.mockReturnValue([{ moveUci: "c4f7", priority: 1 }]);
  mocks.getBestMoves.mockResolvedValueOnce(mocks.getBestMoves.getMockImplementation()!());
  mocks.getBestMoves.mockResolvedValue(null); // Reused native processes reply through events.
  await start();
  await act(async () => {
    emit(16, 100, ["c4f7"]); // Nominated move, but from the old search.
    emit(16, 100, ["c4f7"], ["e5f7"]); // Different restricted search.
    emit(16, 100, ["e5f7"], ["c4f7"]); // Engine ignored the restriction.
  });
  expect(mocks.classify).not.toHaveBeenCalled();
  await act(async () => emit(16, 100, ["c4f7"], ["c4f7"]));
  expect(mocks.classify).toHaveBeenCalledTimes(1);
});

test("optional candidate work does not restart the original six-second clock", async () => {
  mocks.nominate.mockReturnValue([{ moveUci: "c4f7", priority: 1 }]);
  mocks.getBestMoves.mockImplementation(() => new Promise(() => {}));
  await start();
  await act(async () => {
    emit(8);
    await vi.advanceTimersByTimeAsync(5500);
    emit(16, 100);
    emit(15, 99, ["c4f7"], ["c4f7"]);
    await vi.advanceTimersByTimeAsync(499);
  });
  expect(mocks.classify).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(mocks.classify.mock.calls[0][0]).toMatchObject({ depth: 16, supplementalVariations: [], supplementalSearchIncomplete: true });
  expect(mocks.getBestMoves).toHaveBeenCalledTimes(2);
});

test("an optional search failure keeps the usable main result without a red error", async () => {
  mocks.nominate.mockReturnValue([{ moveUci: "c4f7", priority: 1 }]);
  mocks.getBestMoves.mockResolvedValueOnce(mocks.getBestMoves.getMockImplementation()!());
  mocks.getBestMoves.mockRejectedValue(new Error("Restricted search unavailable"));
  await start();
  expect(mocks.classify.mock.calls[0][0].variations[0].pvUci[0]).toBe("e5f7");
  expect(mocks.classify.mock.calls[0][0].supplementalSearchIncomplete).toBe(true);
  expect(container.textContent).not.toContain("Tactical scan failed");
});

test("time-limited main fallback does not launch optional work", async () => {
  mocks.nominate.mockReturnValue([{ moveUci: "c4f7", priority: 1 }]);
  mocks.getBestMoves.mockImplementation(() => new Promise(() => {}));
  await start();
  await act(async () => { emit(10); await vi.advanceTimersByTimeAsync(6000); });
  expect(mocks.getBestMoves).toHaveBeenCalledTimes(1);
  expect(mocks.nominate).not.toHaveBeenCalled();
});

test("Black's supplemental scores use the same root-side orientation as its main search", async () => {
  const { reflectMixedForkFen, reflectMixedForkMove } = await import("./fixtures/mixedTargetFork");
  const original = mocks.position.fen;
  try {
    mocks.position.fen = reflectMixedForkFen(original);
    const extraMove = reflectMixedForkMove("c4f7");
    mocks.nominate.mockReturnValue([{ moveUci: extraMove, priority: 1 }]);
    const line = (move: string, cp: number) => ({ depth: 16, multipv: 1, uciMoves: [move], sanMoves: [], score: { value: { type: "cp", value: cp }, wdl: null } });
    mocks.getBestMoves.mockResolvedValueOnce([100, [line(reflectMixedForkMove("e5f7"), -450)]]);
    mocks.getBestMoves.mockResolvedValue([100, [line(extraMove, -400)]]);
    await start();
    const input = mocks.classify.mock.calls[0][0];
    expect(input.variations[0].cp).toBe(450);
    expect(input.supplementalVariations[0].cp).toBe(400);
    expect(input.supplementalVariations[0].pvUci).toEqual([extraMove]);
  } finally { mocks.position.fen = original; }
});

test("cancelling a targeted search releases its engine and discards its late result", async () => {
  mocks.nominate.mockReturnValue([{ moveUci: "c4f7", priority: 1 }]);
  mocks.getBestMoves.mockResolvedValueOnce(mocks.getBestMoves.getMockImplementation()!());
  let resolveProbe!: (value: any) => void;
  mocks.getBestMoves.mockImplementation(() => new Promise(resolve => { resolveProbe = resolve; }));
  await start();
  await act(async () => root.render(null));
  onScanChange.mockClear();
  await act(async () => resolveProbe([100, [{ depth: 16, multipv: 1, uciMoves: ["c4f7"], sanMoves: [], score: { value: { type: "cp", value: 400 } } }]]));
  expect(mocks.killEngine).toHaveBeenCalledTimes(1);
  expect(mocks.classify).not.toHaveBeenCalled();
  expect(onScanChange).not.toHaveBeenCalled();
});

test("the real panel selector sends the complete selected history, excluding future moves", async () => {
  const { persistentPawnCases } = await import("./fixtures/persistentPawnCapture");
  const { parseUci } = await import("chessops/util");
  const { makeFen } = await import("chessops/fen");
  const { replayTacticalLine } = await import("../tacticalMotifs/causalTactics");
  const row = persistentPawnCases[0];
  const steps = replayTacticalLine(row.tacticalHistory.fen, row.tacticalHistory.moves);
  const origin: any = { fen: row.tacticalHistory.fen, move: null, san: null, children: [] };
  let node = origin;
  for (const step of steps) {
    const child = { fen: makeFen(step.after.toSetup()), move: step.move, san: step.san, children: [] };
    node.children.push(child);
    node = child;
  }
  // An unselected continuation must not leak into past exchange accounting.
  node.children.push({ fen: "unused", move: parseUci("f6e4"), san: "Nxe4", children: [] });
  mocks.tree = { root: origin, position: steps.map(() => 0), currentNode: () => node };
  mocks.getBestMoves.mockResolvedValue([100, [{ depth: 16, multipv: 1,
    uciMoves: row.pvUci, sanMoves: ["Nxe4"], score: { value: { type: "cp", value: -100 }, wdl: null } }]]);
  await start();
  const input = mocks.classify.mock.calls[0][0];
  expect(input.tacticalHistory).toEqual(row.tacticalHistory);
  expect(input.previousFen).toBe(row.previousFen);
  expect(input.previousMoveUci).toBe(row.previousMoveUci);
  expect(buildLiveTacticalScan(input).motifs.map(m => m.label)).toEqual(["Hanging Pawn"]);
});

test("cold startup does not consume the search allowance", async () => {
  mocks.getBestMoves.mockImplementation(() => new Promise(() => {}));
  await start();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(7000);
    emit(10);
  });
  expect(container.textContent).not.toContain("Tactical scan failed");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(mocks.classify.mock.calls[0][0].depth).toBe(10);
  await act(async () => succeed(buildLiveTacticalScan(mocks.classify.mock.calls[0][0])));
  expect(container.textContent).toContain("Time-limited scan at depth 10");
});

test("a higher-depth empty snapshot cannot erase a usable fallback", async () => {
  mocks.getBestMoves.mockImplementation(() => new Promise(() => {}));
  await start();
  await act(async () => {
    emit(10);
    emit(17, 100, []);
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(mocks.classify.mock.calls[0][0].depth).toBe(10);
});

test("an engine request error retains a previously usable partial result", async () => {
  let rejectEngine!: (error: Error) => void;
  mocks.getBestMoves.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectEngine = reject;
      }),
  );
  await start();
  await act(async () => {
    emit(10);
    rejectEngine(new Error("Engine connection ended"));
  });
  expect(mocks.classify).toHaveBeenCalledTimes(1);
  expect(mocks.classify.mock.calls[0][0].depth).toBe(10);
  await act(async () => succeed(buildLiveTacticalScan(mocks.classify.mock.calls[0][0])));
  expect(container.textContent).toContain("Time-limited scan at depth 10");
  expect(container.textContent).not.toContain("Tactical scan failed");
});

test("a rejected stop still allows its final snapshot to arrive during the grace period", async () => {
  mocks.getBestMoves.mockImplementation(() => new Promise(() => {}));
  mocks.stopEngine.mockRejectedValue(new Error("Stop transport closed"));
  await start();
  await act(async () => {
    emit(2);
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(container.textContent).not.toContain("Tactical scan failed");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    emit(10, 100);
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(mocks.classify).toHaveBeenCalledTimes(1);
  expect(mocks.classify.mock.calls[0][0].depth).toBe(10);
});

test("a failed engine with only shallow analysis remains an error, not a false empty result", async () => {
  let rejectEngine!: (error: Error) => void;
  mocks.getBestMoves.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectEngine = reject;
      }),
  );
  await start();
  await act(async () => {
    emit(2);
    rejectEngine(new Error("Engine connection ended"));
  });
  expect(mocks.classify).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Engine connection ended");
});

test("a rejected stop without a usable final snapshot remains bounded", async () => {
  mocks.getBestMoves.mockImplementation(() => new Promise(() => {}));
  mocks.stopEngine.mockRejectedValue(new Error("Stop transport closed"));
  await start();
  await act(async () => {
    emit(2);
    await vi.advanceTimersByTimeAsync(6600);
  });
  expect(container.textContent).toContain("Tactical scan failed");
  expect(mocks.classify).not.toHaveBeenCalled();
  expect(mocks.killEngine).toHaveBeenCalledTimes(1);
});

test("a request rejection during stopping cannot discard a queued final result", async () => {
  let rejectEngine!: (error: Error) => void;
  mocks.getBestMoves.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectEngine = reject;
      }),
  );
  await start();
  await act(async () => {
    emit(2);
    await vi.advanceTimersByTimeAsync(6000);
    rejectEngine(new Error("Search stopped"));
  });
  expect(dispose).not.toHaveBeenCalled();
  await act(async () => emit(10, 100));
  expect(mocks.classify).toHaveBeenCalledTimes(1);
  expect(dispose).toHaveBeenCalledTimes(1);
});

test("cancelled scans cannot recover an old snapshot after an engine error", async () => {
  let rejectEngine!: (error: Error) => void;
  mocks.getBestMoves.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectEngine = reject;
      }),
  );
  await start();
  await act(async () => emit(10));
  await act(async () => root.render(null));
  onScanChange.mockClear();
  await act(async () => rejectEngine(new Error("Cancelled engine")));
  expect(mocks.classify).not.toHaveBeenCalled();
  expect(onScanChange).not.toHaveBeenCalled();
});

test("stop flushes an unthrottled usable snapshot before declaring a timeout", async () => {
  let rejectStop!: (error: Error) => void;
  mocks.stopEngine.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectStop = reject;
      }),
  );
  mocks.getBestMoves.mockImplementation(() => new Promise(() => {}));
  await start();
  await act(async () => {
    emit(2);
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(mocks.stopEngine).toHaveBeenCalledTimes(1);
  expect(mocks.classify).not.toHaveBeenCalled();
  await act(async () => {
    emit(12, 100);
    rejectStop(new Error("Engine released after final snapshot"));
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(mocks.classify.mock.calls[0][0].depth).toBe(12);
  expect(container.textContent).not.toContain("Tactical scan failed");
});

test("a genuinely silent engine reaches a bounded startup error and late registration is cleaned up", async () => {
  mocks.getBestMoves.mockImplementation(() => new Promise(() => {}));
  await start();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12000);
  });
  expect(container.textContent).toContain("did not start returning analysis");
  expect(mocks.killEngine).toHaveBeenCalledTimes(1);
  expect(dispose).not.toHaveBeenCalled();
  await act(async () => emit(10));
  expect(mocks.killEngine).toHaveBeenCalledTimes(2);
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(mocks.classify).not.toHaveBeenCalled();
});

test("cancellation during startup retains cleanup but cannot publish late results", async () => {
  mocks.getBestMoves.mockImplementation(() => new Promise(() => {}));
  await start();
  const oldTab = mocks.getBestMoves.mock.calls[0][1];
  await act(async () => root.render(null));
  onScanChange.mockClear();
  await act(async () => emit(16, 100));
  expect(mocks.killEngine).toHaveBeenLastCalledWith(mocks.engines[0], oldTab);
  expect(mocks.killEngine).toHaveBeenCalledTimes(2);
  expect(mocks.classify).not.toHaveBeenCalled();
  expect(onScanChange).not.toHaveBeenCalled();
  await start();
  expect(mocks.getBestMoves.mock.calls[1][1]).not.toBe(oldTab);
});

test("silent cancelled startup cleanup is bounded", async () => {
  mocks.getBestMoves.mockImplementation(() => new Promise(() => {}));
  await start();
  await act(async () => root.render(null));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(35000);
  });
  expect(mocks.killEngine).toHaveBeenCalledTimes(2);
  expect(dispose).toHaveBeenCalledTimes(1);
});

test("a shallow stopped engine cannot hang or pretend the position has no tactics", async () => {
  mocks.getBestMoves.mockImplementation(() => new Promise(() => {}));
  await start();
  await act(async () => {
    emit(2);
    await vi.advanceTimersByTimeAsync(6600);
  });
  expect(container.textContent).toContain("stopped before reaching a usable depth");
  expect(mocks.classify).not.toHaveBeenCalled();
  expect(mocks.killEngine).toHaveBeenCalledTimes(1);
});

test("terminal positions do not start an engine and time out waiting for an impossible PV", async () => {
  const original = mocks.position.fen;
  try {
    mocks.position.fen = "7k/6Q1/5K2/8/8/8/8/8 b - - 0 1";
    await start();
    expect(container.textContent).toContain("Position finished");
    expect(mocks.getBestMoves).not.toHaveBeenCalled();
  } finally {
    mocks.position.fen = original;
  }
});

test.each(["7k/5K2/6Q1/8/8/8/8/8 b - - 0 1", "7k/8/5K2/8/8/8/8/8 w - - 0 1"])(
  "stalemate and insufficient material do not time out: %s",
  async (fen) => {
    const original = mocks.position.fen;
    try {
      mocks.position.fen = fen;
      await start();
      expect(container.textContent).toContain("Position finished");
      expect(mocks.getBestMoves).not.toHaveBeenCalled();
    } finally {
      mocks.position.fen = original;
    }
  },
);

test("invalid setup produces an immediate actionable error, not an effect exception", async () => {
  const original = mocks.position.fen;
  try {
    mocks.position.fen = "not a fen";
    await start();
    expect(container.textContent).toContain("This position is not legal");
    expect(mocks.getBestMoves).not.toHaveBeenCalled();
  } finally {
    mocks.position.fen = original;
  }
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

test("cold verifier loading is shown separately after the native engine is released", async () => {
  let started!: () => void;
  mocks.classify.mockImplementation((_input, _signal, callback) => {
    started = callback;
    return new Promise<LiveTacticalScan>((resolve, reject) => {
      succeed = resolve;
      fail = reject;
    });
  });
  await start();
  expect(container.textContent).toContain("Loading tactical verifier");
  expect(container.textContent).not.toContain("Verifying tactical themes");
  expect(mocks.killEngine).toHaveBeenCalledTimes(1);
  expect(
    container.querySelector<HTMLButtonElement>('button[aria-label="Scan this position again"]')!
      .disabled,
  ).toBe(true);
  await act(async () => started());
  expect(container.textContent).toContain("Verifying tactical themes");
  expect(container.textContent).not.toContain("Loading tactical verifier");
  await act(async () => succeed(buildLiveTacticalScan(mocks.classify.mock.calls[0][0])));
  expect(container.textContent).toContain("Verified result");
});

test("a queued worker-start callback after navigation cannot replace the new panel state", async () => {
  await start();
  const started = mocks.classify.mock.calls[0][2];
  await act(async () => root.render(null));
  await act(async () => started());
  expect(container.textContent).toBe("");
  expect(onScanChange).not.toHaveBeenCalledWith(
    expect.objectContaining({ motifs: expect.anything() }),
  );
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
