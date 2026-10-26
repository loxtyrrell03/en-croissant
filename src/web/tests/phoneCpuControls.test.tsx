import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { EngineUnderBoardPanel } from "../WebApp";
import { PHONE_ENGINE_SETTINGS_KEY, DEFAULT_PHONE_ENGINE_SETTINGS } from "../phoneEngineSettings";
import { PHONE_CPU_RESOURCES_KEY } from "../phoneCpuPreferences";
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
  noMove = () => {};
const health = {
  resourceProtocolVersion: 1,
  device: { logicalThreads: 20, totalMemoryMb: 32768, availableMemoryMb: 24000 },
  cpuResources: { threads: { min: 1, max: 64 }, hashMb: { min: 16, max: 8192 } },
};
const cpu = { version: 1, threads: 3, hashMb: 333 };
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, fetchMock: ReturnType<typeof vi.fn>;
const button = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent === label || button.getAttribute("aria-label") === label,
  )!;
const click = (label: string) =>
  act(async () => {
    const target = button(label);
    if (!target)
      throw Error(
        `Missing ${label}; buttons: ${Array.from(host.querySelectorAll("button"))
          .map((button) => button.textContent)
          .join(" | ")}`,
      );
    target.click();
  });
const field = (label: string) =>
  host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const change = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
const exact = async (label: string, value: string) => {
  await change(field(label), value);
  await act(async () =>
    field(label).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
};
const render = () =>
  act(async () =>
    root.render(
      <MantineProvider env="test">
        <EngineUnderBoardPanel
          currentFen={fen}
          upcomingFens={empty}
          onAnalysisLinesChange={noLines}
          onPlayMove={noMove}
        />
      </MantineProvider>,
    ),
  );
const open = async () => {
  await click("Engine settings");
  await vi.waitFor(() => expect(button("Balanced")).toBeTruthy());
};
const legacy = () => localStorage.getItem(PHONE_ENGINE_SETTINGS_KEY);
const resources = () => JSON.parse(localStorage.getItem(PHONE_CPU_RESOURCES_KEY) ?? "null");
const originalScroll = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
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
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value() {} });
  fetchMock = vi.fn(async () => new Response(JSON.stringify(health)));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.setItem(
    PHONE_ENGINE_SETTINGS_KEY,
    JSON.stringify({
      ...DEFAULT_PHONE_ENGINE_SETTINGS,
      enabled: true,
      stockfishPreset: "balanced",
      lc0Preset: "eco",
      lc0AutoNetwork: false,
      ownerOption: "keep",
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  vi.restoreAllMocks();
  // Settle only this fixture's failed choice before its component is removed;
  // production deliberately retains a pending edit across navigation.
  localStorage.setItem(PHONE_ENGINE_SETTINGS_KEY, JSON.stringify(DEFAULT_PHONE_ENGINE_SETTINGS));
  const retry = button("Retry PC settings");
  if (retry) await act(async () => retry.click());
  if (button("Retry PC settings")) {
    localStorage.setItem(PHONE_CPU_RESOURCES_KEY, JSON.stringify({ cpuResources: null }));
    await act(async () => button("Retry PC settings").click());
  }
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await new Promise((done) => setTimeout(done, 0));
  if (originalScroll) Object.defineProperty(Element.prototype, "scrollIntoView", originalScroll);
  else delete (Element.prototype as Partial<Element>).scrollIntoView;
});

it("keeps saved fixed choices and performs no device check while their settings are closed", async () => {
  const before = legacy();
  await render();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(resources()).toBeNull();
  expect(legacy()).toBe(before);
  expect(fixture.analyze.mock.calls[0][0].performancePreset).toBe("balanced");
  expect(fixture.analyze.mock.calls[0][0].cpuResources).toBeUndefined();
});
it("can explicitly enter the new policy even when its numbers equal an existing fixed Balanced", async () => {
  const before = legacy();
  await render();
  await open();
  await click("Balanced");
  expect(resources()).toEqual({ cpuResources: { version: 1, threads: 10, hashMb: 1024 } });
  expect(legacy()).toBe(before);
  await vi.waitFor(() => expect(fixture.analyze).toHaveBeenCalledTimes(2));
  expect(fixture.analyze.mock.lastCall![0].cpuResources).toEqual(resources().cpuResources);
  await click("Use fixed preset: Balanced");
  expect(resources()).toEqual({ cpuResources: null });
  expect(legacy()).toBe(before);
  await vi.waitFor(() => expect(fixture.analyze).toHaveBeenCalledTimes(3));
  expect(fixture.analyze.mock.lastCall![0].cpuResources).toBeUndefined();
});
it("keeps exact drafts out of saves and sends a completed resource edit only after readback", async () => {
  await render();
  await open();
  await change(field("Threads"), "9");
  expect(resources()).toBeNull();
  expect(fixture.analyze).toHaveBeenCalledTimes(1);
  await exact("Threads", "9");
  await vi.waitFor(() => expect(fixture.analyze).toHaveBeenCalledTimes(2));
  expect(resources().cpuResources).toEqual({ version: 1, threads: 9, hashMb: 1024 });
  expect(fixture.analyze.mock.lastCall![0].cpuResources).toEqual(resources().cpuResources);
});
it("keeps a failed CPU choice unapplied and retains Pause through its retry", async () => {
  await render();
  await open();
  const write = Storage.prototype.setItem;
  const failure = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key, value) {
      if (key === PHONE_CPU_RESOURCES_KEY) throw Error("Invented resource quota failure");
      write.call(this, key, value);
    });
  await click("Faster");
  expect(resources()).toBeNull();
  expect(fixture.analyze).toHaveBeenCalledTimes(1);
  await click("Pause Stockfish");
  expect(JSON.parse(legacy()!).enabled).toBe(false);
  failure.mockRestore();
  await click("Retry PC settings");
  expect(resources().cpuResources).toEqual({ version: 1, threads: 15, hashMb: 2048 });
  expect(fixture.analyze).toHaveBeenCalledTimes(1);
  await click("Start Stockfish");
  await vi.waitFor(() => expect(fixture.analyze).toHaveBeenCalledTimes(2));
  expect(fixture.analyze.mock.lastCall![0].cpuResources).toEqual(resources().cpuResources);
});
it("keeps an explicit Pause immediate when its legacy preference save fails", async () => {
  await render();
  const write = Storage.prototype.setItem;
  const failure = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key, value) {
      if (key === PHONE_ENGINE_SETTINGS_KEY) throw Error("Invented pause save failure");
      write.call(this, key, value);
    });
  await click("Pause Stockfish");
  expect(button("Start Stockfish")).toBeTruthy();
  expect(fixture.analyze).toHaveBeenCalledTimes(1);
  expect(fixture.analyze.mock.calls[0][0].signal.aborted).toBe(true);
  expect(JSON.parse(legacy()!).enabled).toBe(true);
  failure.mockRestore();
  await click("Retry saving");
  expect(JSON.parse(legacy()!).enabled).toBe(false);
  expect(fixture.analyze).toHaveBeenCalledTimes(1);
});
it("allows saved CPU edits with analysis Off without starting it", async () => {
  localStorage.setItem(
    PHONE_ENGINE_SETTINGS_KEY,
    JSON.stringify({ ...DEFAULT_PHONE_ENGINE_SETTINGS, stockfishPreset: "balanced" }),
  );
  await render();
  await open();
  await click("Quiet");
  expect(resources().cpuResources).toEqual({ version: 1, threads: 5, hashMb: 256 });
  expect(fixture.analyze).not.toHaveBeenCalled();
});
it("initializes only genuine first use from the PC snapshot while retaining Off and absent legacy bytes", async () => {
  localStorage.removeItem(PHONE_ENGINE_SETTINGS_KEY);
  vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(1);
  await render();
  await vi.waitFor(() =>
    expect(resources()?.cpuResources).toEqual({ version: 1, threads: 10, hashMb: 1024 }),
  );
  expect(legacy()).toBeNull();
  expect(fixture.analyze).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("defers automatic first use until the owner service state is known to be ready", async () => {
  localStorage.removeItem(PHONE_ENGINE_SETTINGS_KEY);
  fixture.availability = "unknown";
  await render();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(resources()).toBeNull();
  fixture.availability = "ready";
  await render();
  await vi.waitFor(() =>
    expect(resources()?.cpuResources).toEqual({ version: 1, threads: 10, hashMb: 1024 }),
  );
  expect(fixture.analyze).not.toHaveBeenCalled();
  expect(legacy()).toBeNull();
});
it.each(["null", "{}", JSON.stringify(DEFAULT_PHONE_ENGINE_SETTINGS)])(
  "retains an existing legacy record %s without inferring first use",
  async (text) => {
    localStorage.setItem(PHONE_ENGINE_SETTINGS_KEY, text);
    await render();
    expect(resources()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(legacy()).toBe(text);
  },
);
it("ignores a late first-use device reply after an explicit engine choice", async () => {
  localStorage.removeItem(PHONE_ENGINE_SETTINGS_KEY);
  let finish!: (response: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise<Response>((done) => (finish = done)));
  await render();
  await click("Start Stockfish");
  await act(async () => finish(new Response(JSON.stringify(health))));
  expect(resources()).toBeNull();
  expect(JSON.parse(legacy()!).enabled).toBe(true);
  expect(fixture.analyze).toHaveBeenCalledTimes(1);
});
it("ignores a late device reply when PC services turn Off without changing either preference", async () => {
  localStorage.removeItem(PHONE_ENGINE_SETTINGS_KEY);
  let finish!: (response: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise<Response>((done) => (finish = done)));
  await render();
  fixture.availability = "off";
  await render();
  await act(async () => finish(new Response(JSON.stringify(health))));
  expect(resources()).toBeNull();
  expect(legacy()).toBeNull();
  expect(fixture.analyze).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.every((call) => String(call[0]).endsWith("/v1/health"))).toBe(true);
});
it("preserves old out-of-recommendation values while limiting only a new field edit", async () => {
  localStorage.setItem(
    PHONE_CPU_RESOURCES_KEY,
    JSON.stringify({ cpuResources: { version: 1, threads: 10, hashMb: 3000 } }),
  );
  fetchMock.mockImplementation(
    () =>
      new Response(
        JSON.stringify({
          ...health,
          device: { logicalThreads: 4, totalMemoryMb: 4096, availableMemoryMb: 2048 },
        }),
      ),
  );
  await render();
  await open();
  expect(field("Threads").value).toBe("10");
  expect(field("Hash memory (MiB)").value).toBe("3000");
  await exact("Threads", "5");
  expect(resources().cpuResources.threads).toBe(10);
  await exact("Threads", "4");
  expect(resources().cpuResources).toEqual({ version: 1, threads: 4, hashMb: 3000 });
});
it("keeps CPU settings separate from LCZero preset and network choices", async () => {
  localStorage.setItem(PHONE_CPU_RESOURCES_KEY, JSON.stringify({ cpuResources: cpu }));
  await render();
  await open();
  await act(async () => host.querySelector<HTMLInputElement>('input[value="Stockfish"]')!.click());
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (option) => option.textContent === "LCZero 0.32.1",
  )!;
  await act(async () => option.click());
  expect(fixture.analyze.mock.lastCall![0]).toMatchObject({
    engineKind: "lc0",
    performancePreset: "eco",
    lc0AutoNetwork: false,
  });
  expect(fixture.analyze.mock.lastCall![0].cpuResources).toBeUndefined();
  expect(resources().cpuResources).toEqual(cpu);
});
it("does not replace unreadable legacy settings with defaults", async () => {
  localStorage.setItem(PHONE_ENGINE_SETTINGS_KEY, "{unreadable");
  await render();
  expect(legacy()).toBe("{unreadable");
  expect(resources()).toBeNull();
  expect(fixture.analyze).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not read");
});
it("preserves an unreadable CPU record and blocks a fallback to a different fixed search", async () => {
  localStorage.setItem(PHONE_CPU_RESOURCES_KEY, "{unreadable");
  await render();
  expect(fixture.analyze).not.toHaveBeenCalled();
  expect(localStorage.getItem(PHONE_CPU_RESOURCES_KEY)).toBe("{unreadable");
  localStorage.setItem(PHONE_CPU_RESOURCES_KEY, JSON.stringify({ cpuResources: cpu }));
  await click("Retry PC settings");
  await vi.waitFor(() => expect(fixture.analyze).toHaveBeenCalledTimes(1));
  expect(fixture.analyze.mock.lastCall![0].cpuResources).toEqual(cpu);
});
it("retains an unapplied CPU draft through navigation and retries it without enabling analysis", async () => {
  localStorage.setItem(PHONE_ENGINE_SETTINGS_KEY, JSON.stringify(DEFAULT_PHONE_ENGINE_SETTINGS));
  await render();
  await open();
  const write = Storage.prototype.setItem;
  const failure = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key, value) {
      if (key === PHONE_CPU_RESOURCES_KEY) throw Error("Invented quota failure");
      write.call(this, key, value);
    });
  await click("Quiet");
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  expect(button("Retry PC settings")).toBeTruthy();
  failure.mockRestore();
  await click("Retry PC settings");
  expect(resources().cpuResources).toEqual({ version: 1, threads: 5, hashMb: 256 });
  expect(fixture.analyze).not.toHaveBeenCalled();
});

it("keeps a failed first-use save visible without looping, then retries while analysis remains Off", async () => {
  localStorage.removeItem(PHONE_ENGINE_SETTINGS_KEY);
  const write = Storage.prototype.setItem;
  const failure = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key, value) {
      if (key === PHONE_CPU_RESOURCES_KEY) throw Error("Invented setup quota failure");
      write.call(this, key, value);
    });
  await render();
  await vi.waitFor(() => expect(button("Retry PC settings")).toBeTruthy());
  expect(failure.mock.calls.filter((call) => call[0] === PHONE_CPU_RESOURCES_KEY)).toHaveLength(1);
  expect(resources()).toBeNull();
  expect(legacy()).toBeNull();
  expect(fixture.analyze).not.toHaveBeenCalled();
  failure.mockRestore();
  await click("Retry PC settings");
  expect(resources()?.cpuResources).toEqual({ version: 1, threads: 10, hashMb: 1024 });
  expect(legacy()).toBeNull();
  expect(fixture.analyze).not.toHaveBeenCalled();
});
it("keeps existing choices available when the PC lacks apply support and retries only its read-only check", async () => {
  const before = legacy();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ device: health.device })));
  await render();
  await click("Engine settings");
  await vi.waitFor(() => expect(button("Retry PC resource check")).toBeTruthy());
  expect(button("Balanced")).toBeUndefined();
  expect(resources()).toBeNull();
  expect(legacy()).toBe(before);
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(health)));
  await click("Retry PC resource check");
  await vi.waitFor(() => expect(button("Balanced")).toBeTruthy());
  expect(resources()).toBeNull();
  expect(fixture.analyze).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls.every((call) => String(call[0]).endsWith("/v1/health"))).toBe(true);
});
it("cancels unfinished phone edits and supports adjacent focus/touch help without saving", async () => {
  await render();
  await open();
  await change(field("Threads"), "9");
  await act(async () =>
    field("Threads").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  await act(async () =>
    field("Threads").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  const slider = field("Threads slider");
  await act(async () => slider.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  await change(slider, "9");
  await act(async () => slider.dispatchEvent(new Event("pointercancel", { bubbles: true })));
  await act(async () => slider.dispatchEvent(new Event("pointerup", { bubbles: true })));
  expect(resources()).toBeNull();
  expect(fixture.analyze).toHaveBeenCalledTimes(1);
  const help = button("About CPU resources");
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
  expect(resources()).toBeNull();
});
