import { MantineProvider } from "@mantine/core";
import { Provider, createStore, useAtom } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enginesAtom, tabsAtom, tabEngineSettingsFamily } from "@/state/atoms";
import { useEnsureDesktopEngines } from "@/hooks/useEnsureDesktopEngines";
import { enginePreferences } from "@/utils/enginePreferences";
import { EnginePreferencesNotice } from "./EnginePreferencesNotice";
import { StockfishUpgradeNotice } from "./StockfishUpgradeNotice";
import { stockfishUpgradeState } from "@/utils/stockfishUpgrade";
import { StockfishCatalogCard } from "./StockfishCatalogCard";
import { createHash } from "node:crypto";

const fixture = vi.hoisted(() => ({
  disk: "[]" as string | null,
  fail: false,
  writes: vi.fn(),
  discover: vi.fn(),
  show: vi.fn(),
  directory: "",
  completed: vi.fn(),
  available: vi.fn(),
  acknowledge: vi.fn(),
  install: vi.fn(),
  cancel: vi.fn(),
  loadedDirectory: undefined as string | undefined,
}));
vi.mock("@/bindings", async (original) => {
  const actual = await original<typeof import("@/bindings")>();
  return { ...actual, commands: { ...actual.commands, installStockfish19: fixture.install, cancelStockfish19Install: fixture.cancel } };
});
vi.mock("@/hooks/useProgress", () => ({ useProgress: () => ({ progress: 100, finished: true }) }));
vi.mock("@/utils/files", async (original) => ({ ...(await original()), usePlatform: () => ({ os: "windows" }) }));
vi.mock("@/utils/stockfishUpgrade", async (original) => ({
  ...(await original()),
  stockfishUpgradeNative: {
    directory: async () => fixture.directory,
    completed: fixture.completed,
    available: fixture.available,
    complete: fixture.acknowledge,
  },
}));
vi.mock("@/utils/enginePreferences", async () => {
  const { createEnginePreferenceStore } = await import("@/utils/enginePreferenceStore");
  return {
    enginePreferences: createEnginePreferenceStore({
      beginLoad: async () => { fixture.loadedDirectory = fixture.directory; },
      identity: () => fixture.loadedDirectory,
      read: async () => fixture.disk,
      write: async (text) => {
        fixture.writes(text);
        if (fixture.fail) throw new Error("Fixture save failed");
        fixture.disk = text;
      },
    }),
  };
});
vi.mock("@/utils/engines", async (original) => ({
  ...(await original()),
  discoverInstalledDesktopEngines: fixture.discover,
  useDefaultEngines: () => ({ defaultEngines: undefined, error: new Error("Invented offline catalog"), isLoading: false }),
}));
vi.mock("@mantine/notifications", () => ({ notifications: { show: fixture.show, hide: vi.fn() } }));
const profile = {
  type: "local" as const,
  id: "owner-id",
  name: "Owner label",
  version: "18",
  path: "C:/Fixture/stockfish.exe",
  loaded: false,
  settings: [{ name: "Hash", value: 128 }],
};
beforeEach(async () => {
  fixture.directory = `C:/Fixture/${crypto.randomUUID()}`;
  fixture.completed.mockReset().mockResolvedValue(true);
  fixture.available.mockReset().mockResolvedValue(null);
  fixture.install.mockReset().mockResolvedValue({ status: "ok", data: { path: "C:/Included/stockfish-19.exe", version: "19" } });
  fixture.cancel.mockReset().mockResolvedValue({ status: "ok", data: true });
  fixture.acknowledge.mockReset().mockImplementation(async () => {
    fixture.completed.mockResolvedValue(true);
    return null;
  });
  stockfishUpgradeState.retry();
  sessionStorage.clear();
  fixture.disk = "[]";
  fixture.fail = false;
  fixture.writes.mockClear();
  fixture.show.mockClear();
  fixture.discover
    .mockReset()
    .mockResolvedValue([
      { ...profile, name: "Managed label", loaded: true, settings: [{ name: "Hash", value: 512 }] },
    ]);
  await enginePreferences.reload();
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
});
afterEach(() => vi.unstubAllGlobals());
async function mount(startup: boolean, busy = false, catalog = false) {
  const host = document.createElement("div");
  document.body.append(host);
  let root = createRoot(host),
    atoms = createStore();
  if (busy) {
    atoms.set(tabsAtom, [
      {
        value: "active-fixture",
        name: "Invented active analysis",
        type: "analysis",
        gameOrigin: { kind: "none" },
      },
    ]);
    atoms.set(tabEngineSettingsFamily({ tab: "active-fixture", engineId: profile.id }), {
      enabled: true,
      go: { t: "Infinite" },
      settings: [],
      synced: true,
    });
  }
  function Startup() {
    useEnsureDesktopEngines();
    return null;
  }
  function Probe() {
    const [engines, setEngines] = useAtom(enginesAtom);
    return (
      <>
        <pre>{JSON.stringify(engines)}</pre>
        <button onClick={() => setEngines([{ ...profile, name: "Pending label" }])}>
          Change label
        </button>
      </>
    );
  }
  const render = () =>
    act(async () =>
      root.render(
        <MantineProvider env="test">
          <Provider store={atoms}>
            {startup && <Startup />}
            <Probe />
            <EnginePreferencesNotice />
            <StockfishUpgradeNotice />
            {catalog && <StockfishCatalogCard />}
          </Provider>
        </MantineProvider>,
      ),
    );
  await render();
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  const click = (label: string) =>
    act(async () =>
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent === label)!
        .click(),
    );
  const close = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  const remount = async (keepStore = false) => {
    await act(async () => root.unmount());
    root = createRoot(host);
    if (!keepStore) atoms = createStore();
    await render();
  };
  const release = () =>
    act(async () =>
      atoms.set(
        tabEngineSettingsFamily({ tab: "active-fixture", engineId: profile.id }),
        (current) => ({ ...current, enabled: false }),
      ),
    );
  const replace = (profiles: typeof profile[]) => act(async () => { atoms.set(enginesAtom, profiles); });
  const enable = () => act(async () => {
    atoms.set(tabsAtom, [{ value: "active-fixture", name: "Invented active analysis", type: "analysis", gameOrigin: { kind: "none" } }]);
    atoms.set(tabEngineSettingsFamily({ tab: "active-fixture", engineId: profile.id }), {
      enabled: true, go: { t: "Infinite" }, settings: [], synced: true,
    });
  });
  const deferEdit = async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    await act(async () => { atoms.set(enginesAtom, async (previous) => { await gate; return await previous; }); });
    return () => act(async () => finish());
  };
  return { host, settle, click, close, remount, release, replace, enable, deferEdit };
}
it("preserves an intentionally empty list through real startup without adding installed or PC engines", async () => {
  const h = await mount(true);
  try {
    await h.settle();
    expect(fixture.discover).not.toHaveBeenCalled();
    expect(fixture.writes).not.toHaveBeenCalled();
    expect(h.host.querySelector("pre")?.textContent).toBe("[]");
  } finally {
    await h.close();
  }
});

it("adds the included Stockfish through real controls and the retained preference writer", async () => {
  fixture.disk = JSON.stringify([profile]);
  fixture.available.mockResolvedValue(currentStockfish);
  await enginePreferences.reload();
  const h = await mount(false, false, true);
  try {
    await h.settle(); await h.click("Add Stockfish 19");
    await vi.waitFor(async () => { await h.settle(); expect(h.host.querySelector('[aria-label="Stockfish 19 setup"]')?.textContent).toContain("Added"); });
    expect(JSON.parse(fixture.disk!)).toEqual([profile, expect.objectContaining({ version: "19", enabled: false })]);
    expect(fixture.install).not.toHaveBeenCalled();
  } finally { await h.close(); }
});

it("does not retain Added when the same profile array loses confirmed saved-file state", async () => {
  fixture.disk = JSON.stringify([profile]); fixture.available.mockResolvedValue(currentStockfish);
  await enginePreferences.reload();
  const h = await mount(false, false, true);
  let saved = fixture.disk;
  try {
    await h.settle(); await h.click("Add Stockfish 19");
    await vi.waitFor(async () => { await h.settle(); expect(h.host.querySelector('[aria-label="Stockfish 19 setup"]')?.textContent).toContain("Added"); });
    saved = fixture.disk; fixture.disk = '{"unreadable"';
    await act(async () => { await enginePreferences.reload().catch(() => {}); });
    expect(h.host.querySelector('[aria-label="Stockfish 19 setup"]')?.textContent).not.toContain("Added");
  } finally { fixture.disk = saved; await act(async () => { await enginePreferences.reload(); }); await h.close(); }
});

it("retains an installation across dialog remount and ignores a premature progress-finished event", async () => {
  fixture.disk = JSON.stringify([profile]); await enginePreferences.reload();
  let finish!: (result: unknown) => void;
  fixture.install.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const h = await mount(false, false, true);
  try {
    await h.settle(); await h.click("Add Stockfish 19");
    await vi.waitFor(() => expect(fixture.install).toHaveBeenCalledTimes(1));
    await h.remount(true); await h.settle();
    const card = () => h.host.querySelector('[aria-label="Stockfish 19 setup"]')!;
    expect(card().textContent).toContain("Engine files: 95%");
    expect(card().textContent).not.toContain("Added");
    await act(async () => finish({ status: "ok", data: currentStockfish }));
    await vi.waitFor(async () => { await h.settle(); expect(card().textContent).toContain("Added"); });
    expect(JSON.parse(fixture.disk!)).toHaveLength(2);
  } finally { await h.close(); }
});

it("keeps cancelling visible after dialog remount and never adds a late completed native result", async () => {
  fixture.disk = JSON.stringify([profile]); await enginePreferences.reload();
  let finish!: (result: unknown) => void;
  fixture.install.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const h = await mount(false, false, true);
  try {
    await h.settle(); await h.click("Add Stockfish 19");
    await vi.waitFor(() => expect(fixture.install).toHaveBeenCalledTimes(1));
    await h.click("Cancel"); await h.remount(true); await h.settle();
    expect(h.host.textContent).toContain("Waiting for installation to stop");
    expect(fixture.cancel).toHaveBeenCalledWith(fixture.install.mock.calls[0][0]);
    await act(async () => finish({ status: "ok", data: currentStockfish }));
    await vi.waitFor(async () => { await h.settle(); expect(h.host.textContent).toContain("Cancelled."); });
    expect(JSON.parse(fixture.disk!)).toEqual([profile]);
  } finally { await h.close(); }
});

it("retries a failed catalog profile save after dialog remount without reinstalling", async () => {
  fixture.disk = JSON.stringify([profile]); await enginePreferences.reload();
  fixture.fail = true; fixture.available.mockResolvedValue(currentStockfish);
  const h = await mount(false, false, true);
  try {
    await h.settle(); await h.click("Add Stockfish 19");
    await vi.waitFor(() => expect(enginePreferences.getSnapshot().pending).toBe(true));
    await h.remount(true); await h.settle();
    const card = () => h.host.querySelector('[aria-label="Stockfish 19 setup"]')!;
    expect(card().textContent).toContain("Keep this app open");
    expect(card().textContent).not.toContain("Added");
    fixture.fail = false;
    await act(async () => Array.from(card().querySelectorAll("button")).find((button) => button.textContent === "Retry save")!.click());
    await vi.waitFor(async () => { await h.settle(); expect(card().textContent).toContain("Added"); });
    expect(JSON.parse(fixture.disk!)).toHaveLength(2);
    expect(fixture.install).not.toHaveBeenCalled();
  } finally { fixture.fail = false; await enginePreferences.retry().catch(() => {}); await h.close(); }
});

it("keeps the pinned Stockfish card available in the real Add engine modal when the remote catalog fails", async () => {
  const { default: AddEngine } = await import("./AddEngine");
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), atoms = createStore();
  try {
    await act(async () => root.render(<MantineProvider env="test"><Provider store={atoms}><AddEngine opened setOpened={() => {}} /></Provider></MantineProvider>));
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Stockfish 19 setup"]')).not.toBeNull());
    expect(document.querySelector('[aria-label="Stockfish 19 setup"]')?.textContent).toContain("Add Stockfish 19");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it("keeps unreadable settings intact and wires Retry load back into real startup", async () => {
  fixture.disk = '{"invalid"';
  const h = await mount(true);
  try {
    await h.settle();
    expect(h.host.querySelector('[role="alert"]')?.textContent).toContain("preserved");
    expect(fixture.writes).not.toHaveBeenCalled();
    expect(fixture.discover).not.toHaveBeenCalled();
    fixture.disk = JSON.stringify([profile]);
    await h.click("Retry load");
    await vi.waitFor(async () => {
      await h.settle();
      expect(fixture.discover).toHaveBeenCalledTimes(1);
    });
    await h.settle();
    expect(JSON.parse(fixture.disk!)[0]).toMatchObject({
      name: "Owner label",
      loaded: false,
      settings: [{ name: "Hash", value: 128 }],
    });
    expect(h.host.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await h.close();
  }
});
it("retains a failed save across an actual provider remount and retries the exact pending settings", async () => {
  const h = await mount(false);
  try {
    await h.settle();
    fixture.fail = true;
    await h.click("Change label");
    await h.settle();
    expect(h.host.querySelector('[role="alert"]')?.textContent).toContain("Retry save");
    expect(fixture.disk).toBe("[]");
    await h.remount();
    await h.settle();
    expect(h.host.querySelector("pre")?.textContent).toContain("Pending label");
    fixture.fail = false;
    await h.click("Retry save");
    await h.settle();
    await enginePreferences.flush();
    expect(JSON.parse(fixture.disk!)[0].name).toBe("Pending label");
    expect(h.host.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await h.close();
  }
});

it("defers discovery while analysis is enabled or focus-paused and retries after the owner turns it off", async () => {
  fixture.disk = JSON.stringify([profile]);
  const h = await mount(true, true);
  try {
    await h.settle();
    expect(fixture.discover).not.toHaveBeenCalled();
    expect(fixture.writes).not.toHaveBeenCalled();
    await h.release();
    await vi.waitFor(async () => {
      await h.settle();
      expect(fixture.discover).toHaveBeenCalledTimes(1);
    });
    await h.settle();
    await enginePreferences.flush();
    expect(JSON.parse(fixture.disk!)[0].loaded).toBe(false);
  } finally {
    await h.close();
  }
});

it.each(["edit", "unmount"] as const)("rejects a late discovery reply after %s", async (action) => {
  fixture.disk = JSON.stringify([profile]);
  let finish!: (profiles: (typeof profile)[]) => void;
  fixture.discover.mockReturnValueOnce(
    new Promise<(typeof profile)[]>((resolve) => {
      finish = resolve;
    }),
  );
  const h = await mount(true);
  let closed = false;
  try {
    await vi.waitFor(async () => {
      await h.settle();
      expect(fixture.discover).toHaveBeenCalledTimes(1);
    });
    if (action === "edit") {
      await h.click("Change label");
      await h.settle();
    } else {
      await h.close();
      closed = true;
    }
    await act(async () => finish([profile]));
    await h.settle();
    await enginePreferences.flush();
    expect(JSON.parse(fixture.disk!)).toHaveLength(1);
    expect(JSON.parse(fixture.disk!)[0].name).toBe(
      action === "edit" ? "Pending label" : "Owner label",
    );
  } finally {
    if (!closed) await h.close();
  }
});

const previousStockfish = { ...profile, name: "Stockfish 18", path: "C:/Fixture/stockfish-18.exe" };
const currentStockfish = { path: "C:/Included/stockfish-19.exe", version: "19" };
it("acknowledges an explicit empty list without looking for or adding an engine", async () => {
  fixture.completed.mockResolvedValue(false);
  const h = await mount(true);
  try {
    await vi.waitFor(() => expect(fixture.acknowledge).toHaveBeenCalledTimes(1));
    expect(fixture.acknowledge.mock.calls[0]).toEqual([fixture.directory, createHash("sha256").update("[]").digest("hex")]);
    expect(fixture.available).not.toHaveBeenCalled();
    expect(fixture.discover).not.toHaveBeenCalled();
    expect(fixture.writes).not.toHaveBeenCalled();
    expect(h.host.querySelector("pre")?.textContent).toBe("[]");
  } finally { await h.close(); }
});
it("updates the older fallback while idle, preserves hidden settings, and acknowledges only its saved bytes", async () => {
  fixture.disk = JSON.stringify([previousStockfish]);
  fixture.completed.mockResolvedValue(false);
  fixture.available.mockResolvedValue(currentStockfish);
  fixture.acknowledge.mockImplementation(async (_directory, digest) => {
    expect(JSON.parse(fixture.disk!)[0]).toMatchObject({ version: "19", loaded: false, enabled: false });
    expect(digest).toBe(createHash("sha256").update(fixture.disk!).digest("hex"));
    fixture.completed.mockResolvedValue(true);
    return null;
  });
  const h = await mount(true);
  try {
    await vi.waitFor(() => expect(fixture.acknowledge).toHaveBeenCalledTimes(1));
    const saved = JSON.parse(fixture.disk!);
    expect(saved[0].settings).toContainEqual({ name: "Hash", value: 128 });
    expect(saved.find((engine: typeof profile) => engine.id === profile.id)).toMatchObject(previousStockfish);
    expect(new Set(saved.map((engine: typeof profile) => engine.id)).size).toBe(saved.length);
    expect(h.host.querySelector('[role="alert"]')).toBeNull();
  } finally { await h.close(); }
});
it("seeds a genuinely missing store with Stockfish 19 first and acknowledges the created file", async () => {
  fixture.disk = null;
  fixture.completed.mockResolvedValue(false);
  fixture.available.mockResolvedValue(currentStockfish);
  const h = await mount(true);
  try {
    await vi.waitFor(() => expect(fixture.acknowledge).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fixture.disk!)[0]).toMatchObject({ version: "19", loaded: true, enabled: false });
    expect(fixture.acknowledge.mock.calls[0][1]).toBe(createHash("sha256").update(fixture.disk!).digest("hex"));
  } finally { await h.close(); }
});
it("keeps an unavailable release pending rather than recording an upgrade", async () => {
  fixture.disk = JSON.stringify([previousStockfish]);
  fixture.completed.mockResolvedValue(false);
  const h = await mount(true);
  try {
    await vi.waitFor(() => expect(fixture.available).toHaveBeenCalledTimes(1));
    await h.settle();
    await enginePreferences.flush();
    expect(JSON.parse(fixture.disk!)[0].version).toBe("18");
    expect(fixture.acknowledge).not.toHaveBeenCalled();
  } finally { await h.close(); }
});
it("waits for a failed profile save to be retried before acknowledging the default upgrade", async () => {
  fixture.disk = JSON.stringify([previousStockfish]);
  fixture.completed.mockResolvedValue(false);
  fixture.available.mockResolvedValue(currentStockfish);
  fixture.fail = true;
  const h = await mount(true);
  try {
    await vi.waitFor(() => expect(enginePreferences.getSnapshot().pending).toBe(true));
    await h.settle();
    expect(JSON.parse(fixture.disk!)[0].version).toBe("18");
    expect(fixture.acknowledge).not.toHaveBeenCalled();
    fixture.fail = false;
    await h.click("Retry save");
    await vi.waitFor(() => expect(fixture.acknowledge).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fixture.disk!)[0].version).toBe("19");
    expect(h.host.querySelector('[role="alert"]')).toBeNull();
  } finally {
    fixture.fail = false;
    await enginePreferences.retry();
    await h.close();
  }
});
it("retries an acknowledgement failure across remount without replacing a later manual engine choice", async () => {
  fixture.disk = JSON.stringify([previousStockfish]);
  fixture.completed.mockResolvedValue(false);
  fixture.available.mockResolvedValue(currentStockfish);
  fixture.acknowledge.mockRejectedValueOnce(new Error("Fixture acknowledgement is read-only"));
  const h = await mount(true);
  try {
    await vi.waitFor(() => expect(stockfishUpgradeState.getSnapshot().error).toContain("read-only"));
    expect(JSON.parse(fixture.disk!)[0].version).toBe("19");
    await h.click("Change label");
    await h.settle();
    await enginePreferences.flush();
    await h.remount();
    await h.settle();
    expect(h.host.querySelector('[role="alert"]')?.textContent).toContain("Retry upgrade");
    await h.click("Retry upgrade");
    await vi.waitFor(() => expect(stockfishUpgradeState.getSnapshot().phase).toBe("complete"));
    expect(JSON.parse(fixture.disk!)).toEqual([{ ...profile, name: "Pending label" }]);
    expect(fixture.available).toHaveBeenCalledTimes(1);
    expect(fixture.acknowledge).toHaveBeenCalledTimes(2);
  } finally { await h.close(); }
});
it("does not apply a late reply while an owner update is unresolved, even if it returns equal values", async () => {
  fixture.disk = JSON.stringify([previousStockfish]);
  fixture.completed.mockResolvedValue(false);
  let finishAsset!: (value: typeof currentStockfish) => void;
  fixture.available.mockReturnValueOnce(new Promise((resolve) => { finishAsset = resolve; }));
  const h = await mount(true);
  try {
    await vi.waitFor(() => expect(fixture.available).toHaveBeenCalledTimes(1));
    const finishEdit = await h.deferEdit();
    await act(async () => finishAsset(currentStockfish));
    await h.settle();
    await finishEdit();
    await h.settle();
    await enginePreferences.flush();
    expect(JSON.parse(fixture.disk!)[0].version).toBe("18");
    expect(fixture.acknowledge).not.toHaveBeenCalled();
  } finally { await h.close(); }
});
it("rejects a changed profile folder and reloads that folder's own choices on retry", async () => {
  fixture.disk = JSON.stringify([previousStockfish]);
  fixture.completed.mockResolvedValue(false);
  let finishAsset!: (value: typeof currentStockfish) => void;
  fixture.available.mockReturnValueOnce(new Promise((resolve) => { finishAsset = resolve; }));
  const h = await mount(true);
  try {
    await vi.waitFor(() => expect(fixture.available).toHaveBeenCalledTimes(1));
    fixture.directory = "C:/Fixture/NewFolder";
    fixture.disk = "[]";
    await act(async () => finishAsset(currentStockfish));
    await vi.waitFor(() => expect(stockfishUpgradeState.getSnapshot().error).toContain("folder changed"));
    expect(fixture.writes).not.toHaveBeenCalled();
    expect(fixture.acknowledge).not.toHaveBeenCalled();
    await h.click("Retry upgrade");
    await vi.waitFor(() => expect(fixture.acknowledge).toHaveBeenCalledTimes(1));
    expect(fixture.acknowledge.mock.calls[0][0]).toBe(fixture.directory);
    expect(fixture.disk).toBe("[]");
    expect(h.host.querySelector("pre")?.textContent).toBe("[]");
  } finally { await h.close(); }
});
it.each(["edit", "edit-then-revert", "busy"] as const)("rejects a late verified-engine reply after %s", async (action) => {
  fixture.disk = JSON.stringify([previousStockfish]);
  fixture.completed.mockResolvedValue(false);
  let finish!: (value: typeof currentStockfish) => void;
  fixture.available.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const h = await mount(true);
  try {
    await vi.waitFor(() => expect(fixture.available).toHaveBeenCalledTimes(1));
    if (action === "busy") await h.enable();
    else {
      await h.click("Change label");
      await h.settle();
      await enginePreferences.flush();
      if (action === "edit-then-revert") {
        await h.replace([previousStockfish]);
        await h.settle();
        await enginePreferences.flush();
      }
    }
    await act(async () => finish(currentStockfish));
    await h.settle();
    expect(JSON.parse(fixture.disk!)[0].version).toBe("18");
    expect(fixture.acknowledge).not.toHaveBeenCalled();
    if (action === "busy") {
      fixture.available.mockResolvedValue(currentStockfish);
      await h.release();
    }
    await vi.waitFor(() => expect(fixture.acknowledge).toHaveBeenCalledTimes(action === "busy" ? 1 : 0));
  } finally { await h.close(); }
});
