import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EngineUnderBoardPanel } from "../WebApp";
import { PHONE_ENGINE_SETTINGS_KEY, DEFAULT_PHONE_ENGINE_SETTINGS } from "../phoneEngineSettings";
import { PHONE_CPU_RESOURCES_KEY } from "../phoneCpuPreferences";
import { PHONE_SEARCH_PREFERENCES_KEY } from "../phoneSearchPreferences";
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
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  empty: string[] = [];
const noLines = () => {},
  noPlay = () => {};
const health = {
  searchProtocolVersion: 1,
  searchLimits: {
    depth: { min: 1, max: 70 },
    timeMs: { min: 50, max: 3600000 },
    nodes: { min: 1, max: 4294967295 },
    infinite: true,
  },
  resourceProtocolVersion: 1,
  device: { logicalThreads: 20, totalMemoryMb: 32768, availableMemoryMb: 24000 },
  cpuResources: { threads: { min: 1, max: 64 }, hashMb: { min: 16, max: 8192 } },
};
const line: WebEngineLine = {
  source: "stockfish",
  executionLocation: "gaming-pc",
  depth: 8,
  multipv: 1,
  nodes: 1500,
  score: { type: "cp", value: 20 },
  uciMoves: ["e2e4"],
  sanMoves: ["e4"],
};
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, fetchMock: ReturnType<typeof vi.fn>;
const button = (name: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name,
  )!;
const field = (name: string) =>
  host.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
const read = () => JSON.parse(localStorage.getItem(PHONE_SEARCH_PREFERENCES_KEY) ?? "null");
const latest = () => fixture.analyze.mock.calls.at(-1)![0];
const click = (name: string) =>
  act(async () => {
    const b = button(name);
    if (!b) throw Error(`Missing ${name}`);
    expect(b.disabled).toBe(false);
    b.click();
  });
const render = (options: { fen?: string; compact?: boolean } = {}) =>
  act(async () =>
    root.render(
      <MantineProvider env="test">
        <EngineUnderBoardPanel
          currentFen={options.fen ?? fen}
          compact={options.compact}
          upcomingFens={empty}
          onAnalysisLinesChange={noLines}
          onPlayMove={noPlay}
        />
      </MantineProvider>,
    ),
  );
const change = (name: string, value: string) =>
  act(async () => {
    const input = field(name);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
async function exact(name: string, value: string) {
  await change(name, value);
  await act(async () =>
    field(name).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
}
async function select(label: string, value: string) {
  await act(async () => field(label).click());
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (option) => option.textContent?.trim() === value,
  );
  if (!option) throw Error(`Missing ${label} option ${value}`);
  await act(async () => option.click());
}
async function open() {
  await click("Engine settings");
  await vi.waitFor(() => expect(field("Stop analysis").disabled).toBe(false));
}
beforeEach(() => {
  localStorage.clear();
  fixture.availability = "ready";
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
  Element.prototype.scrollIntoView = vi.fn();
  fetchMock = vi.fn(async () => new Response(JSON.stringify(health)));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.setItem(
    PHONE_ENGINE_SETTINGS_KEY,
    JSON.stringify({
      ...DEFAULT_PHONE_ENGINE_SETTINGS,
      enabled: true,
      useCloud: true,
      depth: 70,
      stockfishPreset: "eco",
      ownerOption: "keep",
    }),
  );
  localStorage.setItem(
    PHONE_CPU_RESOURCES_KEY,
    JSON.stringify({ cpuResources: { version: 1, threads: 3, hashMb: 333 } }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  vi.restoreAllMocks();
  const retry = button("Retry search settings");
  if (retry) await act(async () => retry.click());
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});
it("keeps exact inherited depth70 and performs no default write or closed-settings check", async () => {
  const before = localStorage.getItem(PHONE_ENGINE_SETTINGS_KEY);
  await render();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(read()).toBeNull();
  await open();
  expect(field("Depth").value).toBe("70");
  expect(Number(field("Depth slider").max)).toBe(60);
  expect(read()).toBeNull();
  expect(localStorage.getItem(PHONE_ENGINE_SETTINGS_KEY)).toBe(before);
});
it("applies a completed depth edit once through the actual Live request without rewriting legacy/CPU choices", async () => {
  const before = localStorage.getItem(PHONE_ENGINE_SETTINGS_KEY),
    cpu = localStorage.getItem(PHONE_CPU_RESOURCES_KEY);
  await render();
  await open();
  const calls = fixture.analyze.mock.calls.length;
  await exact("Depth", "6");
  expect(read()).toEqual({ limit: { version: 1, mode: "depth", value: 6 }, lines: null });
  expect(latest().searchLimit).toEqual({ version: 1, mode: "depth", value: 6 });
  expect(fixture.analyze).toHaveBeenCalledTimes(calls + 1);
  expect(localStorage.getItem(PHONE_ENGINE_SETTINGS_KEY)).toBe(before);
  expect(localStorage.getItem(PHONE_CPU_RESOURCES_KEY)).toBe(cpu);
});
it("saves exact fractional milliseconds and changes display units without changing requests", async () => {
  await render();
  await open();
  await select("Stop analysis", "After a time");
  await exact("Time per position", "0.051");
  expect(read().limit).toEqual({ version: 1, mode: "time", value: 51 });
  expect(latest().searchLimit.value).toBe(51);
  const calls = fixture.analyze.mock.calls.length;
  await select("Time unit", "Milliseconds");
  expect(field("Time per position").value).toBe("51");
  await select("Time unit", "Minutes");
  await select("Time unit", "Hours");
  expect(fixture.analyze).toHaveBeenCalledTimes(calls);
  expect(read().limit.value).toBe(51);
});
it("supports node limits and until-stopped without confusing them with legacy infinite depth", async () => {
  await render();
  await open();
  await select("Stop analysis", "After a node count");
  await exact("Nodes per position", "4294967295");
  expect(read().limit).toEqual({ version: 1, mode: "nodes", value: 4294967295 });
  await select("Stop analysis", "Until stopped");
  expect(read().limit).toEqual({ version: 1, mode: "infinite" });
  expect(latest().searchLimit).toEqual({ version: 1, mode: "infinite" });
  expect(JSON.parse(localStorage.getItem(PHONE_ENGINE_SETTINGS_KEY)!).infinite).toBe(false);
});
it("changes only lines when the limit remains inherited", async () => {
  await render();
  await open();
  await exact("Lines", "2");
  expect(read()).toEqual({ limit: null, lines: 2 });
  expect(latest().multipv).toBe(2);
  expect(latest().searchLimit).toBeUndefined();
  expect(latest().depth).toBe(70);
});
it("keeps a failed edit out of requests, preserves Pause and retries while settings are closed", async () => {
  await render();
  await open();
  const count = fixture.analyze.mock.calls.length,
    set = Storage.prototype.setItem;
  const fail = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key, value) {
      if (key === PHONE_SEARCH_PREFERENCES_KEY) throw Error("Invented quota failure");
      set.call(this, key, value);
    });
  await exact("Depth", "6");
  expect(read()).toBeNull();
  expect(fixture.analyze).toHaveBeenCalledTimes(count);
  await click("Pause Stockfish");
  await click("Engine settings");
  fail.mockRestore();
  await click("Retry search settings");
  expect(read().limit.value).toBe(6);
  expect(JSON.parse(localStorage.getItem(PHONE_ENGINE_SETTINGS_KEY)!).enabled).toBe(false);
  expect(fixture.analyze).toHaveBeenCalledTimes(count);
});
it("verifies readback and refuses a write that silently did not persist", async () => {
  await render();
  await open();
  const count = fixture.analyze.mock.calls.length,
    set = Storage.prototype.setItem;
  const fail = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key, value) {
      if (key !== PHONE_SEARCH_PREFERENCES_KEY) set.call(this, key, value);
    });
  await exact("Lines", "2");
  expect(read()).toBeNull();
  expect(fixture.analyze).toHaveBeenCalledTimes(count);
  expect(button("Retry search settings")).toBeTruthy();
  fail.mockRestore();
  await click("Retry search settings");
  expect(latest().multipv).toBe(2);
});
it.each([false, true])(
  "preserves unreadable settings and blocks fallback in compact=%s",
  async (compact) => {
    localStorage.setItem(PHONE_SEARCH_PREFERENCES_KEY, "{unreadable");
    await render({ compact });
    expect(fixture.analyze).not.toHaveBeenCalled();
    expect(localStorage.getItem(PHONE_SEARCH_PREFERENCES_KEY)).toBe("{unreadable");
    localStorage.setItem(
      PHONE_SEARCH_PREFERENCES_KEY,
      JSON.stringify({ limit: { version: 1, mode: "time", value: 333 }, lines: null }),
    );
    await click("Retry search settings");
    expect(latest().searchLimit).toEqual({ version: 1, mode: "time", value: 333 });
  },
);
it.each(["off", "starting"])(
  "keeps %s services and saved search settings untouched while editing is unavailable",
  async (availability) => {
    fixture.availability = availability;
    await render();
    await click("Engine settings");
    expect(field("Stop analysis").disabled).toBe(true);
    expect(field("Lines").disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fixture.analyze).not.toHaveBeenCalled();
    expect(read()).toBeNull();
  },
);
it("restores only an owned previous search choice after a request error", async () => {
  localStorage.setItem(
    PHONE_SEARCH_PREFERENCES_KEY,
    JSON.stringify({ limit: { version: 1, mode: "depth", value: 6 }, lines: 2, other: "keep" }),
  );
  fixture.analyze.mockRejectedValue(Error("Invented request failure"));
  await render();
  await open();
  await select("Stop analysis", "After a time");
  await click("Restore previous search settings");
  expect(read()).toEqual({
    limit: { version: 1, mode: "depth", value: 6 },
    lines: 2,
    other: "keep",
  });
});
it("does not restore an older choice over a newer external edit", async () => {
  fixture.analyze.mockRejectedValue(Error("Invented request failure"));
  await render();
  await open();
  await exact("Depth", "6");
  expect(button("Restore previous search settings")).toBeTruthy();
  await act(async () => {
    localStorage.setItem(
      PHONE_SEARCH_PREFERENCES_KEY,
      JSON.stringify({ limit: { version: 1, mode: "nodes", value: 800 }, lines: 4 }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: PHONE_SEARCH_PREFERENCES_KEY }));
  });
  expect(button("Restore previous search settings")).toBeUndefined();
  expect(read().limit.mode).toBe("nodes");
});
it("does not infer first use from an existing search record when both older stores are missing", async () => {
  localStorage.removeItem(PHONE_ENGINE_SETTINGS_KEY);
  localStorage.removeItem(PHONE_CPU_RESOURCES_KEY);
  localStorage.setItem(PHONE_SEARCH_PREFERENCES_KEY, JSON.stringify({ limit: null, lines: null }));
  await render();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(localStorage.getItem(PHONE_CPU_RESOURCES_KEY)).toBeNull();
  expect(fixture.analyze).not.toHaveBeenCalled();
});
it("rejects a late first-use CPU setup after a manual search edit", async () => {
  localStorage.removeItem(PHONE_ENGINE_SETTINGS_KEY);
  localStorage.removeItem(PHONE_CPU_RESOURCES_KEY);
  let complete!: () => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        complete = () => resolve(new Response(JSON.stringify(health)));
      }),
  );
  await render();
  await open();
  await select("Stop analysis", "After a time");
  await act(async () => complete());
  expect(read().limit.mode).toBe("time");
  expect(localStorage.getItem(PHONE_CPU_RESOURCES_KEY)).toBeNull();
  expect(localStorage.getItem(PHONE_ENGINE_SETTINGS_KEY)).toBeNull();
  expect(fixture.analyze).not.toHaveBeenCalled();
});
it("keeps unfinished fields/gestures out of requests and supports adjacent keyboard/touch help", async () => {
  await render();
  await open();
  const count = fixture.analyze.mock.calls.length;
  await change("Depth", "6");
  expect(read()).toBeNull();
  await act(async () =>
    field("Depth").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  await act(async () =>
    field("Depth").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  const slider = field("Depth slider");
  await act(async () => slider.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  await change("Depth slider", "10");
  await act(async () => slider.dispatchEvent(new Event("pointercancel", { bubbles: true })));
  await act(async () => slider.dispatchEvent(new Event("pointerup", { bubbles: true })));
  expect(read()).toBeNull();
  expect(fixture.analyze).toHaveBeenCalledTimes(count);
  const help = button("About search limits");
  await act(async () => help.focus());
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  await act(async () =>
    help.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await act(async () => help.click());
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});
it("shows actual engine-time progress without treating stored scores or depth as elapsed time", async () => {
  localStorage.setItem(
    PHONE_SEARCH_PREFERENCES_KEY,
    JSON.stringify({ limit: { version: 1, mode: "time", value: 1000 }, lines: null }),
  );
  let finish!: (value: WebEngineLine[]) => void;
  fixture.analyze.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await act(async () =>
    latest().onUpdate([{ ...line, source: "lichess-cloud", depth: 65, timeMs: 900 }]),
  );
  expect(host.querySelector('[aria-label="Live search progress"]')).toBeNull();
  await act(async () => latest().onUpdate([{ ...line, timeMs: 500 }]));
  const progress = host.querySelector('[aria-label="Live search progress"]')!;
  expect(progress.getAttribute("aria-valuenow")).toBe("50");
  expect(progress.getAttribute("aria-valuetext")).toContain("500 ms");
  await act(async () => finish([{ ...line, timeMs: 1000 }]));
  expect(
    host.querySelector('[aria-label="Live search progress"]')!.getAttribute("aria-valuenow"),
  ).toBe("100");
});
it("uses original saved search settings without changing CPU or the Live On choice", async () => {
  const before = localStorage.getItem(PHONE_ENGINE_SETTINGS_KEY),
    cpu = localStorage.getItem(PHONE_CPU_RESOURCES_KEY);
  localStorage.setItem(
    PHONE_SEARCH_PREFERENCES_KEY,
    JSON.stringify({ limit: { version: 1, mode: "nodes", value: 1000 }, lines: 2 }),
  );
  await render();
  await open();
  await click("Use original search settings");
  expect(read()).toEqual({ limit: null, lines: null });
  expect(latest().searchLimit).toBeUndefined();
  expect(latest().multipv).toBe(3);
  expect(localStorage.getItem(PHONE_ENGINE_SETTINGS_KEY)).toBe(before);
  expect(localStorage.getItem(PHONE_CPU_RESOURCES_KEY)).toBe(cpu);
});

it("keeps lines editable with an older service and checks support again without starting analysis", async () => {
  localStorage.setItem(
    PHONE_ENGINE_SETTINGS_KEY,
    JSON.stringify({ ...DEFAULT_PHONE_ENGINE_SETTINGS, enabled: false }),
  );
  fetchMock.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          resourceProtocolVersion: 1,
          device: health.device,
          cpuResources: health.cpuResources,
        }),
      ),
  );
  await render();
  await click("Engine settings");
  await vi.waitFor(() => expect(button("Retry search controls check")).toBeTruthy());
  expect(field("Stop analysis").disabled).toBe(true);
  expect(field("Lines").disabled).toBe(false);
  await exact("Lines", "2");
  expect(read()).toEqual({ limit: null, lines: 2 });
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(health)));
  await click("Retry search controls check");
  await vi.waitFor(() => expect(field("Stop analysis").disabled).toBe(false));
  expect(fixture.analyze).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.every((call) => String(call[0]).endsWith("/v1/health"))).toBe(true);
});

it("retains a failed search edit through navigation and retries without enabling Live", async () => {
  localStorage.setItem(PHONE_ENGINE_SETTINGS_KEY, JSON.stringify(DEFAULT_PHONE_ENGINE_SETTINGS));
  await render();
  await open();
  const set = Storage.prototype.setItem;
  const fail = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key, value) {
      if (key === PHONE_SEARCH_PREFERENCES_KEY) throw Error("Invented quota failure");
      set.call(this, key, value);
    });
  await exact("Depth", "6");
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  expect(button("Retry search settings")).toBeTruthy();
  fail.mockRestore();
  await click("Retry search settings");
  expect(read().limit).toEqual({ version: 1, mode: "depth", value: 6 });
  expect(fixture.analyze).not.toHaveBeenCalled();
});

it("keeps reset disabled with services Off and discards old progress when changing position", async () => {
  localStorage.setItem(
    PHONE_SEARCH_PREFERENCES_KEY,
    JSON.stringify({ limit: { version: 1, mode: "time", value: 1000 }, lines: 2 }),
  );
  fixture.analyze.mockImplementation(() => new Promise(() => {}));
  await render();
  const old = latest();
  await act(async () => old.onUpdate([{ ...line, timeMs: 500 }]));
  expect(
    host.querySelector('[aria-label="Live search progress"]')!.getAttribute("aria-valuenow"),
  ).toBe("50");
  await render({ fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1" });
  expect(host.querySelector('[aria-label="Live search progress"]')).toBeNull();
  await act(async () => old.onUpdate([{ ...line, timeMs: 900 }]));
  expect(host.querySelector('[aria-label="Live search progress"]')).toBeNull();
  fixture.availability = "off";
  await render();
  await click("Engine settings");
  expect(button("Use original search settings").disabled).toBe(true);
  expect(read().limit.value).toBe(1000);
});
