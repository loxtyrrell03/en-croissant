import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { tablebaseCases } from "./fixtures/tablebaseRelevance";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), classify: vi.fn() }));
vi.mock("../tacticalMotifs/tablebaseLookup", () => ({ lookupZugzwangEvidence: mocks.lookup }));
vi.mock("../tacticalMotifs/liveTacticsWorker", () => ({
  classifyLiveTacticsInWorker: mocks.classify,
}));
import { TacticalEndgameResult } from "@/components/panels/tactics/TacticalEndgameResult";

const row = tablebaseCases.find((r) => r.id === "EKWHC:g4f4")!;
const input = {
  fen: row.fen,
  pvUci: [row.move],
  engineName: "Stockfish",
  depth: 16,
  previousFen: "8/8/7p/2p1k2P/6K1/1P6/8/8 b - - 1 41",
  previousMoveUci: "e5f6",
  variations: [{ pvUci: [row.move], multipv: 1, cp: 400 }],
};
const scan = buildLiveTacticalScan(input);
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const changed = vi.fn();
beforeEach(() => {
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
  mocks.lookup.mockResolvedValue(row.evidence);
  mocks.classify.mockImplementation(async (value) => buildLiveTacticalScan(value));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(value = scan) {
  await act(async () =>
    root.render(
      <MantineProvider>
        <TacticalEndgameResult scan={value} input={input} onPreviewChange={changed} />
      </MantineProvider>,
    ),
  );
}
function button(text: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
}

test("local results remain visible and no lookup happens until the explicit online action", async () => {
  await render();
  expect(mocks.lookup).not.toHaveBeenCalled();
  expect(host.textContent).toContain("sends this position to Lichess");
  expect(host.textContent).toContain("No tactical theme verified");
  await act(async () => button("Verify Kf4 online").click());
  expect(host.textContent).toContain("Zugzwang found");
  expect(host.textContent).toContain("Zugzwang verified after Kf4");
  expect(mocks.classify).toHaveBeenCalledWith(
    { ...input, tablebaseEvidence: row.evidence },
    expect.any(AbortSignal),
  );
  expect(
    changed.mock.calls.at(-1)?.[0].arrows.map((a: { from: string; to: string }) => [a.from, a.to]),
  ).toEqual([["g4", "f4"]]);
});

test("failed lookup retains the local result and exposes a working retry", async () => {
  mocks.lookup.mockRejectedValueOnce(new Error("Lichess unavailable"));
  await render();
  await act(async () => button("Verify Kf4 online").click());
  expect(host.textContent).toContain("Online verification unavailable");
  expect(host.textContent).toContain("No tactical theme verified");
  expect(changed).not.toHaveBeenCalled();
  await act(async () => button("Retry endgame check").click());
  expect(host.textContent).toContain("Zugzwang found");
});

test.each(["cancel", "navigation", "unmount"])(
  "a late lookup after %s cannot classify or move the board",
  async (action) => {
    let resolve!: (value: unknown) => void;
    mocks.lookup.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await render();
    await act(async () => {
      button("Verify Kf4 online").click();
      button("Checking endgame")?.click();
    });
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    const signal = mocks.lookup.mock.calls[0][2] as AbortSignal;
    if (action === "cancel") await act(async () => button("Cancel verification").click());
    else if (action === "navigation")
      await render({ ...scan, fen: scan.fen.replace("2 42", "4 42") });
    else await act(async () => root.render(null));
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(row.evidence));
    expect(mocks.classify).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  },
);

test("a late worker result after cancellation cannot publish a board or preview", async () => {
  let resolve!: (value: unknown) => void;
  mocks.classify.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await render();
  await act(async () => button("Verify Kf4 online").click());
  await act(async () => button("Cancel verification").click());
  await act(async () =>
    resolve(buildLiveTacticalScan({ ...input, tablebaseEvidence: row.evidence })),
  );
  expect(changed).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("Zugzwang found");
});
