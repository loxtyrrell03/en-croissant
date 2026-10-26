import { MantineProvider } from "@mantine/core";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EngineUnderBoardPanel } from "../WebApp";
import PhoneEnginePlansPanel from "../PhoneEnginePlansPanel";
import { useVerifiedJsonPreference } from "../useVerifiedJsonPreference";
import {
  PHONE_CPU_RESOURCES_KEY,
  DEFAULT_PHONE_CPU_PREFERENCES,
  normalizePhoneCpuPreferences,
} from "../phoneCpuPreferences";
import { PHONE_ENGINE_SETTINGS_KEY, DEFAULT_PHONE_ENGINE_SETTINGS } from "../phoneEngineSettings";
import type { WebEngineLine } from "../model";
const fixture = vi.hoisted(() => ({ analyze: vi.fn(), release: vi.fn(), availability: "ready" }));
vi.mock("../stockfishEngine", () => ({
  analyzeWithWebStockfish18: fixture.analyze,
  releaseWebPcEngine: fixture.release,
  stopWebStockfish18Search: vi.fn(),
}));
vi.mock("../pcServices", async (original) => ({
  ...(await original<typeof import("../pcServices")>()),
  usePcServicesAvailability: () => fixture.availability,
}));
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const saved = { version: 1 as const, threads: 3, hashMb: 333 };
const health = {
  resourceProtocolVersion: 1,
  device: { logicalThreads: 20, totalMemoryMb: 32768, availableMemoryMb: 24000 },
  cpuResources: { threads: { min: 1, max: 64 }, hashMb: { min: 16, max: 8192 } },
};
const lines: WebEngineLine[] = [
  {
    source: "stockfish",
    engineName: "Invented engine",
    depth: 17,
    multipv: 1,
    score: { type: "cp", value: 20 },
    uciMoves: ["e2e4", "e7e5", "g1f3"],
    sanMoves: ["e4", "e5", "Nf3"],
  },
];
const empty: string[] = [];
const noLines = () => {},
  noPlay = () => {};
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, fetchMock: ReturnType<typeof vi.fn>;
function SharedPanels() {
  const [, , , , store] = useVerifiedJsonPreference(
    PHONE_CPU_RESOURCES_KEY,
    DEFAULT_PHONE_CPU_PREFERENCES,
    normalizePhoneCpuPreferences,
  );
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div data-live>
        <EngineUnderBoardPanel
          currentFen={fen}
          upcomingFens={empty}
          onAnalysisLinesChange={noLines}
          onPlayMove={noPlay}
          suspended={busy}
          cpuPreferenceStore={store}
        />
      </div>
      <PhoneEnginePlansPanel
        fen={fen}
        onBusy={setBusy}
        onPlayLine={noPlay}
        cpuPreferenceStore={store}
      />
    </>
  );
}
const scope = () => host.querySelector('[data-testid="phone-engine-plans"]')!;
const live = () => host.querySelector("[data-live]")!;
const button = (name: string, parent: ParentNode = scope()) =>
  Array.from(parent.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name,
  )!;
async function click(name: string, parent: ParentNode = scope()) {
  await act(async () => {
    const b = button(name, parent);
    if (!b) throw Error(`Missing ${name}`);
    expect(b.disabled).toBe(false);
    b.click();
  });
}
const render = (shared = false) =>
  act(async () =>
    root.render(
      <MantineProvider env="test">
        {shared ? (
          <SharedPanels />
        ) : (
          <PhoneEnginePlansPanel fen={fen} onBusy={() => {}} onPlayLine={noPlay} />
        )}
      </MantineProvider>,
    ),
  );
const resources = () => JSON.parse(localStorage.getItem(PHONE_CPU_RESOURCES_KEY) ?? "null");
const preferences = () => localStorage.getItem(PHONE_ENGINE_SETTINGS_KEY);
async function openResources() {
  await click("PC resource settings");
  await vi.waitFor(() => expect(button("Balanced")).toBeTruthy());
}
beforeEach(() => {
  localStorage.clear();
  fixture.availability = "ready";
  fixture.analyze.mockReset().mockResolvedValue(lines);
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
  Element.prototype.scrollIntoView = vi.fn();
  fetchMock = vi.fn(async () => new Response(JSON.stringify(health)));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.setItem(
    PHONE_CPU_RESOURCES_KEY,
    JSON.stringify({ cpuResources: saved, ownerField: "keep" }),
  );
  localStorage.setItem(
    PHONE_ENGINE_SETTINGS_KEY,
    JSON.stringify({
      ...DEFAULT_PHONE_ENGINE_SETTINGS,
      enabled: false,
      stockfishPreset: "eco",
      ownerField: "keep",
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  vi.restoreAllMocks();
  // Settle this fixture's pending edit so it cannot become another test's
  // intentionally retained navigation draft.
  const retry = button("Retry PC settings");
  if (retry) await act(async () => retry.click());
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});
it("uses the saved CPU choice for Plans without opening settings or waking a capability check", async () => {
  const before = preferences();
  await render();
  expect(fetchMock).not.toHaveBeenCalled();
  await click("Explore plans");
  expect(fixture.analyze).toHaveBeenCalledTimes(1);
  expect(fixture.analyze.mock.calls[0][0]).toMatchObject({
    cpuResources: saved,
    depth: 17,
    multipv: 8,
    planSearch: true,
  });
  expect(Object.isFrozen(fixture.analyze.mock.calls[0][0].cpuResources)).toBe(true);
  expect(preferences()).toBe(before);
});
it("keeps fixed Plans behavior and all legacy Live choices when there is no CPU selection", async () => {
  localStorage.removeItem(PHONE_CPU_RESOURCES_KEY);
  const before = preferences();
  await render();
  await click("Explore plans");
  expect(fixture.analyze.mock.calls[0][0].cpuResources).toBeUndefined();
  expect(fixture.analyze.mock.calls[0][0].performancePreset).toBeUndefined();
  expect(preferences()).toBe(before);
  expect(resources()).toBeNull();
  expect(scope().textContent).toContain("fixed Good preset");
});
it("shares verified edits between actual Live and Plans forms without enabling Live analysis", async () => {
  const before = preferences();
  await render(true);
  await click("Engine settings", live());
  await openResources();
  await click("Balanced");
  expect((live().querySelector('input[aria-label="Threads"]') as HTMLInputElement).value).toBe(
    "10",
  );
  expect(resources()).toEqual({
    cpuResources: { version: 1, threads: 10, hashMb: 1024 },
    ownerField: "keep",
  });
  await click("Explore plans");
  expect(fixture.analyze.mock.calls[0][0].cpuResources).toEqual({
    version: 1,
    threads: 10,
    hashMb: 1024,
  });
  expect(preferences()).toBe(before);
  expect(fixture.analyze.mock.calls.every(([request]) => request.planSearch)).toBe(true);
});
it("captures a running job once and applies later resource edits to the next refresh", async () => {
  let resolve!: (value: WebEngineLine[]) => void;
  fixture.analyze.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render(true);
  await click("Explore plans");
  const request = fixture.analyze.mock.calls[0][0];
  await openResources();
  await click("Quiet");
  expect(resources().cpuResources).toEqual({ version: 1, threads: 5, hashMb: 256 });
  expect(request.cpuResources).toEqual(saved);
  expect(request.signal.aborted).toBe(false);
  expect(fixture.analyze).toHaveBeenCalledTimes(1);
  await act(async () => resolve(lines));
  await click("Refresh plans");
  expect(fixture.analyze.mock.calls[1][0].cpuResources).toEqual({
    version: 1,
    threads: 5,
    hashMb: 256,
  });
});
it("keeps failed edits out of requests and lets Live retry the same shared pending choice", async () => {
  await render(true);
  await openResources();
  const set = Storage.prototype.setItem;
  const failure = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key, value) {
      if (key === PHONE_CPU_RESOURCES_KEY) throw Error("Invented quota failure");
      set.call(this, key, value);
    });
  await click("Balanced");
  expect(resources().cpuResources).toEqual(saved);
  expect(button("Retry PC settings", live())).toBeTruthy();
  await click("Explore plans");
  expect(fixture.analyze.mock.calls[0][0].cpuResources).toEqual(saved);
  failure.mockRestore();
  await click("Retry PC settings", live());
  expect(scope().textContent).toContain("10 threads · 1024 MiB");
  await click("Refresh plans");
  expect(fixture.analyze.mock.calls[1][0].cpuResources).toEqual({
    version: 1,
    threads: 10,
    hashMb: 1024,
  });
});
it("preserves unreadable bytes, blocks another fallback and retries the read beside Plans", async () => {
  localStorage.setItem(PHONE_CPU_RESOURCES_KEY, "{unreadable");
  await render();
  expect(button("Explore plans").disabled).toBe(true);
  expect(resources).toThrow(SyntaxError);
  expect(localStorage.getItem(PHONE_CPU_RESOURCES_KEY)).toBe("{unreadable");
  expect(fixture.analyze).not.toHaveBeenCalled();
  localStorage.setItem(PHONE_CPU_RESOURCES_KEY, JSON.stringify({ cpuResources: saved }));
  await click("Retry PC settings");
  await click("Explore plans");
  expect(fixture.analyze.mock.calls[0][0].cpuResources).toEqual(saved);
});
it.each(["off", "starting"])(
  "keeps %s services cold when opening settings and blocks a plan search",
  async (availability) => {
    fixture.availability = availability;
    const before = localStorage.getItem(PHONE_CPU_RESOURCES_KEY);
    await render();
    await click("PC resource settings");
    expect(button("Explore plans").disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fixture.analyze).not.toHaveBeenCalled();
    expect(localStorage.getItem(PHONE_CPU_RESOURCES_KEY)).toBe(before);
    expect(scope().textContent).toContain(
      availability === "off" ? "PC services are off" : "PC services are starting",
    );
  },
);
it("restores only a still-owned choice after an actual plan request error", async () => {
  fixture.analyze.mockRejectedValueOnce(Error("Invented resource acknowledgement failure"));
  const before = preferences();
  await render();
  await openResources();
  await click("Balanced");
  await click("Explore plans");
  await click("Restore previous PC resources");
  expect(resources().cpuResources).toEqual(saved);
  expect(resources().ownerField).toBe("keep");
  expect(preferences()).toBe(before);
});
it("cannot restore an obsolete Plans edit over a later choice made in Live", async () => {
  fixture.analyze.mockRejectedValueOnce(Error("Invented resource acknowledgement failure"));
  await render(true);
  await openResources();
  await click("Balanced");
  await click("Explore plans");
  expect(button("Restore previous PC resources")).toBeTruthy();
  await click("Engine settings", live());
  await click("Quiet", live());
  expect(button("Restore previous PC resources")).toBeUndefined();
  expect(resources().cpuResources).toEqual({ version: 1, threads: 5, hashMb: 256 });
});
it("uses fresh external settings on the next explicit run without clearing old results", async () => {
  await render();
  await click("Explore plans");
  expect(scope().textContent).toContain("1 evaluated root choices");
  await act(async () => {
    localStorage.setItem(
      PHONE_CPU_RESOURCES_KEY,
      JSON.stringify({ cpuResources: { version: 1, threads: 2, hashMb: 77 } }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: PHONE_CPU_RESOURCES_KEY }));
  });
  expect(scope().textContent).toContain("1 evaluated root choices");
  await click("Refresh plans");
  expect(fixture.analyze.mock.calls[1][0].cpuResources).toEqual({
    version: 1,
    threads: 2,
    hashMb: 77,
  });
});
