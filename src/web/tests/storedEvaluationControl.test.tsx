import { MantineProvider } from "@mantine/core";
import { act, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EngineUnderBoardPanel } from "../WebApp";
import {
  retainWebEngineAnalysis,
  type LiveEnginePolicy,
  type LiveEngineSnapshot,
} from "../liveEnginePolicy";
import type { WebEngineLine } from "../model";
const fixture = vi.hoisted(() => ({ analyze: vi.fn(), release: vi.fn() }));
vi.mock("../stockfishEngine", () => ({
  analyzeWithWebStockfish18: fixture.analyze,
  releaseWebPcEngine: fixture.release,
  stopWebStockfish18Search: vi.fn(),
}));
vi.mock("../pcServices", async (original) => ({
  ...(await original<typeof import("../pcServices")>()),
  usePcServicesAvailability: () => "on",
}));
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            resourceProtocolVersion: 1,
            device: { logicalThreads: 20, totalMemoryMb: 32768, availableMemoryMb: 24000 },
            cpuResources: { threads: { min: 1, max: 64 }, hashMb: { min: 16, max: 8192 } },
          }),
        ),
    ),
  );
  fixture.analyze.mockReset().mockResolvedValue([]);
  fixture.release.mockReset().mockResolvedValue(undefined);
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
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("honors an existing saved phone useCloud false before starting analysis", async () => {
  localStorage.setItem(
    "en-croissant-web-engine-panel-settings",
    JSON.stringify({ enabled: true, useCloud: false }),
  );
  await act(async () =>
    root.render(
      <MantineProvider>
        <EngineUnderBoardPanel
          currentFen={fen}
          upcomingFens={[]}
          onAnalysisLinesChange={() => {}}
          onPlayMove={() => {}}
        />
      </MantineProvider>,
    ),
  );
  await vi.waitFor(() => expect(fixture.analyze).toHaveBeenCalled());
  expect(fixture.analyze.mock.calls[0][0].useStoredEvaluations).toBe(false);
});

const empty: string[] = [];
const nativeLine: WebEngineLine = {
  source: "stockfish",
  depth: 14,
  multipv: 1,
  score: { type: "cp", value: 50 },
  uciMoves: ["e2e4"],
  sanMoves: ["e4"],
};
const cloudLine: WebEngineLine = {
  ...nativeLine,
  source: "lichess-cloud",
  score: { type: "cp", value: -90 },
};
function Harness() {
  const [snapshot, setSnapshot] = useState<LiveEngineSnapshot | null>(null);
  const update = useCallback(
    (fen: string, lines: WebEngineLine[], policy?: LiveEnginePolicy) =>
      setSnapshot((previous) => retainWebEngineAnalysis(previous, fen, lines, policy)),
    [],
  );
  return (
    <>
      <EngineUnderBoardPanel
        currentFen={fen}
        upcomingFens={empty}
        onAnalysisLinesChange={update}
        onPlayMove={() => {}}
      />
      <output data-testid="last-source">{snapshot?.lines[0]?.source ?? "none"}</output>
    </>
  );
}
async function render(visible = true) {
  await act(async () => root.render(<MantineProvider>{visible && <Harness />}</MantineProvider>));
}
const storedSwitch = () =>
  host.querySelector<HTMLInputElement>('input[aria-label="Use stored evaluations"]')!;
async function settings() {
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="Engine settings"]')!.click(),
  );
}

it("switches off cached scores/arrows and ignores both late updates and completion", async () => {
  localStorage.setItem(
    "en-croissant-web-engine-panel-settings",
    JSON.stringify({ enabled: true, useCloud: true }),
  );
  const replies: ((value: WebEngineLine[]) => void)[] = [];
  fixture.analyze.mockImplementation((request) => {
    if (request.useStoredEvaluations) request.onUpdate([cloudLine]);
    return new Promise<WebEngineLine[]>((done) => {
      replies.push(done);
    });
  });
  await render();
  expect(host.querySelector('[data-testid="last-source"]')?.textContent).toBe("lichess-cloud");
  await settings();
  await act(async () => storedSwitch().click());
  expect(fixture.analyze.mock.calls[0][0].signal.aborted).toBe(true);
  expect(fixture.analyze.mock.calls[1][0].useStoredEvaluations).toBe(false);
  expect(host.querySelector('[data-testid="last-source"]')?.textContent).toBe("none");
  await act(async () => {
    fixture.analyze.mock.calls[0][0].onUpdate([cloudLine]);
    replies[0]([cloudLine]);
  });
  expect(host.querySelector('[data-testid="last-source"]')?.textContent).toBe("none");
  await act(async () => replies[1]([nativeLine]));
  expect(host.querySelector('[data-testid="last-source"]')?.textContent).toBe("stockfish");
  expect(JSON.parse(localStorage.getItem("en-croissant-web-engine-panel-settings")!).useCloud).toBe(
    false,
  );
});
it("retains a failed preference through remount and retries saving without enabling analysis", async () => {
  localStorage.setItem(
    "en-croissant-web-engine-panel-settings",
    JSON.stringify({ enabled: false, useCloud: true }),
  );
  await render();
  await settings();
  const write = Storage.prototype.setItem;
  const failure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key === "en-croissant-web-engine-panel-settings") throw new Error("Invented quota failure");
    return write.call(this, key, value);
  });
  await act(async () => storedSwitch().click());
  expect(storedSwitch().checked).toBe(false);
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await render(false);
  await render();
  await settings();
  expect(storedSwitch().checked).toBe(false);
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(fixture.analyze).not.toHaveBeenCalled();
  failure.mockRestore();
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent === "Retry saving")!
      .click(),
  );
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(JSON.parse(localStorage.getItem("en-croissant-web-engine-panel-settings")!).useCloud).toBe(
    false,
  );
  expect(fixture.analyze).not.toHaveBeenCalled();
});
