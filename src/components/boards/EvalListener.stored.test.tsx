import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BestMoves } from "@/bindings";
import {
  activeTabAtom,
  currentLiveEvalAtom,
  engineCloudEvalStatusFamily,
  engineMovesFamily,
  enginesAtom,
  tabEngineSettingsFamily,
  useStoredEvaluationsAtom,
} from "@/state/atoms";
import { enginePreferences } from "@/utils/enginePreferences";
import type { LocalEngine } from "@/utils/engines";
import { EngineListener } from "./EvalListener";
import { getEvaluationSourceEpoch, noteEvaluationSourceRevision } from "@/utils/evaluationSource";

const fixture = vi.hoisted(() => ({
  disk: "[]",
  cloud: vi.fn(),
  native: vi.fn(),
  stop: vi.fn(),
  matching: vi.fn(),
  kill: vi.fn(),
  listeners: new Set<(event: any) => void>(),
}));
vi.mock("@/utils/enginePreferences", async () => {
  const { createEnginePreferenceStore } = await import("@/utils/enginePreferenceStore");
  return {
    enginePreferences: createEnginePreferenceStore({
      read: async () => fixture.disk,
      write: async (text) => {
        fixture.disk = text;
      },
    }),
  };
});
vi.mock("@/utils/engines", async (original) => ({
  ...(await original<typeof import("@/utils/engines")>()),
  getBestMoves: fixture.native,
  stopEngine: fixture.stop,
  stopMatchingEngine: fixture.matching,
  killEngine: fixture.kill,
}));
vi.mock("@/utils/lichess/api", async (original) => ({
  getBestMoves: fixture.cloud,
  getLichessCloudFailure: (await original<typeof import("@/utils/lichess/api")>())
    .getLichessCloudFailure,
}));
vi.mock("@/bindings", async (original) => ({
  ...(await original<typeof import("@/bindings")>()),
  events: {
    bestMovesPayload: {
      listen: async (callback: (event: any) => void) => {
        fixture.listeners.add(callback);
        return () => {
          fixture.listeners.delete(callback);
        };
      },
    },
  },
}));
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const engine: LocalEngine = {
  id: "fixture",
  type: "local",
  name: "Fixture engine",
  version: "19",
  path: "C:/Fixture/stockfish.exe",
  loaded: true,
};
const line = (source?: "lichess", cp = 20): BestMoves => ({
  source,
  depth: 20,
  nodes: 100,
  nps: 100,
  multipv: 1,
  uciMoves: ["e2e4", "e7e5"],
  sanMoves: ["e4", "e5"],
  score: { value: { type: "cp", value: cp }, wdl: null },
});
let host: HTMLDivElement,
  root: ReturnType<typeof createRoot>,
  store: ReturnType<typeof createStore>,
  unsubscribe: () => void;
beforeEach(async () => {
  fixture.cloud.mockReset().mockResolvedValue([100, [line("lichess")]]);
  fixture.native.mockReset().mockResolvedValue([100, [line(undefined, 50)]]);
  fixture.stop.mockReset().mockResolvedValue(undefined);
  fixture.matching.mockReset().mockResolvedValue(undefined);
  fixture.kill.mockReset().mockResolvedValue(undefined);
  fixture.listeners.clear();
  fixture.disk = JSON.stringify([engine]);
  localStorage.clear();
  await enginePreferences.reload();
  store = createStore();
  unsubscribe = store.sub(enginesAtom, () => {});
  await vi.waitFor(() => {
    if (store.get(enginesAtom)?.length !== 1) throw new Error("Fixture engine is not loaded");
  });
  store.set(activeTabAtom, "fixture-tab");
  store.set(useStoredEvaluationsAtom, true);
  store.set(tabEngineSettingsFamily({ engineId: engine.id, tab: "fixture-tab" }), (previous) => ({
    ...previous,
    enabled: true,
  }));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await act(async () => {
    await Promise.resolve();
  });
  unsubscribe();
  host.remove();
  vi.unstubAllGlobals();
});
async function render(position = fen, selected = engine, wake = 0) {
  await act(async () =>
    root.render(
      <Provider store={store}>
        <EngineListener
          engine={selected}
          engineWakeRevision={wake}
          firstEngineWithLines={null}
          isGameOver={false}
          finalFen={position}
          searchingFen={position}
          searchingMoves={[]}
          fen={position}
          moves={[]}
          threat={false}
        />
      </Provider>,
    ),
  );
}
const moves = () => store.get(engineMovesFamily({ tab: "fixture-tab", engine: engine.id }));

it("uses no stored lookup when local-only is saved and publishes actual local evidence", async () => {
  store.set(useStoredEvaluationsAtom, false);
  await render();
  await vi.waitFor(() => expect(fixture.native).toHaveBeenCalledTimes(1));
  expect(fixture.cloud).not.toHaveBeenCalled();
  expect(moves().get(`${fen}:`)?.[0].score.value.value).toBe(50);
  expect(store.get(currentLiveEvalAtom)?.storedForLocal).toBe(false);
});
it("removes the stored result and evaluation fallback when the running setting changes", async () => {
  await render();
  expect(fixture.cloud).toHaveBeenCalledTimes(1);
  expect(fixture.native).not.toHaveBeenCalled();
  expect(store.get(currentLiveEvalAtom)?.storedForLocal).toBe(true);
  await act(async () => store.set(useStoredEvaluationsAtom, false));
  await vi.waitFor(() => expect(fixture.native).toHaveBeenCalledTimes(1));
  expect(moves().get(`${fen}:`)?.[0].score.value.value).toBe(50);
  expect(store.get(currentLiveEvalAtom)?.storedForLocal).toBe(false);
});
it("a cancelled late stored miss cannot start another local search", async () => {
  let reply!: (value: null) => void;
  fixture.cloud.mockReturnValue(
    new Promise<null>((done) => {
      reply = done;
    }),
  );
  await render();
  await act(async () => store.set(useStoredEvaluationsAtom, false));
  await vi.waitFor(() => expect(fixture.native).toHaveBeenCalledTimes(1));
  await act(async () => reply(null));
  expect(fixture.native).toHaveBeenCalledTimes(1);
  expect(fixture.kill).not.toHaveBeenCalled();
});
it("a cancelled late stored hit cannot restore a stored score or start continuations", async () => {
  let reply!: (value: [number, BestMoves[]]) => void;
  fixture.cloud.mockReturnValue(
    new Promise<[number, BestMoves[]]>((done) => {
      reply = done;
    }),
  );
  await render();
  await act(async () => store.set(useStoredEvaluationsAtom, false));
  await vi.waitFor(() => expect(fixture.native).toHaveBeenCalledTimes(1));
  await act(async () =>
    reply([
      100,
      [{ ...line("lichess", -100), cloudLinePartial: true, uciMoves: ["e2e4"] } as BestMoves],
    ]),
  );
  expect(moves().get(`${fen}:`)?.[0].score.value.value).toBe(50);
  expect(fixture.native).toHaveBeenCalledTimes(1);
});
it("waits for the predecessor's native stop before starting the same-position successor", async () => {
  fixture.cloud.mockResolvedValue(null);
  await render();
  await vi.waitFor(() => expect(fixture.native).toHaveBeenCalledTimes(1));
  let stopped!: () => void;
  fixture.matching.mockReturnValue(
    new Promise<void>((done) => {
      stopped = done;
    }),
  );
  await act(async () => store.set(useStoredEvaluationsAtom, false));
  expect(fixture.matching).toHaveBeenCalled();
  expect(fixture.native).toHaveBeenCalledTimes(1);
  await act(async () => stopped());
  await vi.waitFor(() => expect(fixture.native).toHaveBeenCalledTimes(2));
});
it("reports an unreadable stored position while using real local evidence and recovers on same-FEN retry", async () => {
  fixture.cloud.mockRejectedValueOnce(new Error("Invented temporarily unreadable shard"));
  await render();
  await vi.waitFor(() => expect(fixture.native).toHaveBeenCalledTimes(1));
  expect(
    store
      .get(engineCloudEvalStatusFamily({ engine: engine.id, tab: "fixture-tab" }))
      .get(`${fen}:`),
  ).toMatchObject({
    phase: "error",
    message: expect.stringContaining("unreadable shard"),
  });
  expect(moves().get(`${fen}:`)?.[0].score.value.value).toBe(50);
  await render(fen, engine, 1);
  await vi.waitFor(() => expect(fixture.cloud).toHaveBeenCalledTimes(2));
  expect(
    store.get(engineCloudEvalStatusFamily({ engine: engine.id, tab: "fixture-tab" })).get(`${fen}:`)
      ?.phase,
  ).toBe("available");
  expect(moves().get(`${fen}:`)?.[0].score.value.value).toBe(20);
  expect(fixture.native).toHaveBeenCalledTimes(1);
});

it("refreshes a covered position after a source change and rejects an older pending reply", async () => {
  let finish!: (value: any) => void;
  const before = getEvaluationSourceEpoch();
  fixture.cloud.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fixture.cloud.mockImplementation(async () => [
    100,
    [{ ...line("lichess", 42), evaluationSourceEpoch: getEvaluationSourceEpoch() }],
  ]);
  await render();
  await vi.waitFor(() => expect(fixture.cloud).toHaveBeenCalledTimes(1));
  await act(async () => noteEvaluationSourceRevision("listener-source-changed"));
  await vi.waitFor(() => expect(fixture.cloud).toHaveBeenCalledTimes(2));
  await act(async () => finish([100, [{ ...line("lichess", 24), evaluationSourceEpoch: before }]]));
  expect(moves().get(`${fen}:`)?.[0].score.value.value).toBe(42);
});

it("keeps local-only analysis running through a stored-source change", async () => {
  store.set(useStoredEvaluationsAtom, false);
  await render();
  await vi.waitFor(() => expect(fixture.native).toHaveBeenCalledTimes(1));
  const stopped = fixture.matching.mock.calls.length;
  await act(async () => noteEvaluationSourceRevision("listener-local-only-source-changed"));
  expect(fixture.native).toHaveBeenCalledTimes(1);
  expect(fixture.matching).toHaveBeenCalledTimes(stopped);
  expect(moves().get(`${fen}:`)?.[0].score.value.value).toBe(50);
});
