import { MantineProvider } from "@mantine/core";
import { Provider, createStore, useAtom } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enginesAtom, tabsAtom, tabEngineSettingsFamily } from "@/state/atoms";
import { useEnsureDesktopEngines } from "@/hooks/useEnsureDesktopEngines";
import { enginePreferences } from "@/utils/enginePreferences";
import { EnginePreferencesNotice } from "./EnginePreferencesNotice";

const fixture = vi.hoisted(() => ({
  disk: "[]" as string | null,
  fail: false,
  writes: vi.fn(),
  discover: vi.fn(),
  show: vi.fn(),
}));
vi.mock("@/utils/enginePreferences", async () => {
  const { createEnginePreferenceStore } = await import("@/utils/enginePreferenceStore");
  return {
    enginePreferences: createEnginePreferenceStore({
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
async function mount(startup: boolean, busy = false) {
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
  const remount = async () => {
    await act(async () => root.unmount());
    root = createRoot(host);
    atoms = createStore();
    await render();
  };
  const release = () =>
    act(async () =>
      atoms.set(
        tabEngineSettingsFamily({ tab: "active-fixture", engineId: profile.id }),
        (current) => ({ ...current, enabled: false }),
      ),
    );
  return { host, settle, click, close, remount, release };
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
