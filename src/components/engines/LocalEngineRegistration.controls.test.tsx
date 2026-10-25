import { MantineProvider } from "@mantine/core";
import { createStore, Provider, useAtomValue } from "jotai";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enginesAtom } from "@/state/atoms";
import { enginePreferences } from "@/utils/enginePreferences";
import type { LocalEngine } from "@/utils/engines";
import AddEngine from "./AddEngine";
import EditEngine from "./EditEngine";

const fixture = vi.hoisted(() => ({
  disk: "[]",
  fail: false,
  save: vi.fn(),
  open: vi.fn(),
  validate: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: fixture.open }));
vi.mock("@/hooks/useProgress", () => ({ useProgress: () => ({ progress: 0 }) }));
vi.mock("@/utils/files", async (original) => ({
  ...(await original()),
  usePlatform: () => ({ os: "windows" }),
}));
vi.mock("@/utils/engines", async (original) => ({
  ...(await original()),
  useDefaultEngines: () => ({ defaultEngines: [], isLoading: false }),
}));
vi.mock("@/bindings", async (original) => {
  const actual = await original<typeof import("@/bindings")>();
  return {
    ...actual,
    commands: {
      ...actual.commands,
      validateLocalEngine: fixture.validate,
      cancelLocalEngineValidation: async () => ({ status: "ok", data: true }),
    },
  };
});
vi.mock("@/utils/enginePreferences", async () => {
  const { createEnginePreferenceStore } = await import("@/utils/enginePreferenceStore");
  return {
    enginePreferences: createEnginePreferenceStore({
      read: async () => fixture.disk,
      write: async (text) => {
        await fixture.save(text);
        if (fixture.fail) throw new Error("Fixture save failed");
        fixture.disk = text;
      },
    }),
  };
});
const owner: LocalEngine = {
  type: "local",
  id: "owner",
  name: "Owner engine",
  version: "18",
  path: "C:/Owner/engine.exe",
  loaded: false,
  image: "C:/Owner/logo.png",
  go: { t: "Time", c: 500 },
  settings: [
    { name: "WeightsFile", value: "C:/Owner/network.pb.gz" },
    { name: "Threads", value: 2 },
  ],
};
beforeEach(async () => {
  fixture.fail = false;
  fixture.save.mockReset().mockResolvedValue(undefined);
  await enginePreferences.retry().catch(() => {});
  fixture.disk = JSON.stringify([owner]);
  await enginePreferences.reload();
  fixture.open.mockReset();
  fixture.validate
    .mockReset()
    .mockImplementation(async (_id: string, path: string) => ({
      status: "ok",
      data: { name: path.includes("one") ? "Engine One" : "Engine Two", options: [] },
    }));
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
async function mount(edit = false) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    atoms = createStore();
  let toggle!: (value: boolean) => void;
  function Harness() {
    const profiles = useAtomValue(enginesAtom);
    const [opened, setOpened] = useState(true);
    toggle = setOpened;
    return (
      <>
        <pre>{JSON.stringify(profiles)}</pre>
        {edit ? (
          <EditEngine initialEngine={owner} />
        ) : (
          <AddEngine opened={opened} setOpened={setOpened} />
        )}
      </>
    );
  }
  await act(async () =>
    root.render(
      <MantineProvider env="test">
        <Provider store={atoms}>
          <Harness />
        </Provider>
      </MantineProvider>,
    ),
  );
  const click = (text: string) =>
    act(async () => {
      const action =
        Array.from(document.querySelectorAll<HTMLButtonElement>("form button")).find(
          (button) => button.textContent === text,
        ) ??
        Array.from(document.querySelectorAll("button")).find(
          (button) => button.textContent === text,
        );
      action!.click();
    });
  const choose = () =>
    act(async () => {
      const label = Array.from(document.querySelectorAll("label")).find((item) =>
        item.textContent?.startsWith("Engines.Add.BinaryFile"),
      )!;
      document.querySelector<HTMLElement>(`[id="${label.htmlFor}"]`)!.click();
    });
  const wait = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  await wait();
  return {
    host,
    atoms,
    click,
    choose,
    wait,
    hide: () => act(async () => toggle(false)),
    show: () => act(async () => toggle(true)),
    close: async () => {
      await act(async () => {
        fixture.fail = false;
        await enginePreferences.retry().catch(() => {});
        root.unmount();
      });
      host.remove();
    },
  };
}
it("assigns unique persisted identities to successive manual adds and preserves the existing default", async () => {
  fixture.open
    .mockResolvedValueOnce("C:/Fixture/one.exe")
    .mockResolvedValueOnce("C:/Fixture/two.exe");
  const h = await mount();
  try {
    await h.click("Common.Local");
    await h.choose();
    await h.click("Common.Add");
    await vi.waitFor(() => expect(JSON.parse(fixture.disk)).toHaveLength(2));
    await h.show();
    await h.wait();
    await h.choose();
    await h.click("Common.Add");
    await vi.waitFor(() => expect(JSON.parse(fixture.disk)).toHaveLength(3));
    const profiles = JSON.parse(fixture.disk);
    expect(profiles[0]).toEqual(owner);
    expect(new Set(profiles.map((profile: LocalEngine) => profile.id)).size).toBe(3);
    expect(profiles.slice(1)).toEqual([
      expect.objectContaining({ name: "Engine One", enabled: false }),
      expect.objectContaining({ name: "Engine Two", enabled: false }),
    ]);
  } finally {
    await h.close();
  }
});
it("retains a failed manual registration across closing/reopening and retries it without adding twice", async () => {
  fixture.fail = true;
  fixture.open.mockResolvedValue("C:/Fixture/one.exe");
  const h = await mount();
  try {
    await h.click("Common.Local");
    await h.choose();
    await h.click("Common.Add");
    await vi.waitFor(() => expect(enginePreferences.getSnapshot().pending).toBe(true));
    await h.hide();
    await h.show();
    await h.wait();
    fixture.fail = false;
    const form = document.querySelector("form")!;
    await act(async () =>
      Array.from(form.querySelectorAll("button"))
        .find((button) => button.textContent === "Retry save")!
        .click(),
    );
    await vi.waitFor(() => expect(enginePreferences.getSnapshot().pending).toBe(false));
    expect(JSON.parse(fixture.disk)).toHaveLength(2);
    expect(fixture.validate).toHaveBeenCalledTimes(1);
  } finally {
    await h.close();
  }
});
it("does not close a reopened dialog when an old save completes; Done acknowledges the saved profile", async () => {
  let finish!: () => void;
  fixture.save.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  fixture.open.mockResolvedValue("C:/Fixture/one.exe");
  const h = await mount();
  try {
    await h.click("Common.Local");
    await h.choose();
    await h.click("Common.Add");
    await vi.waitFor(() => expect(enginePreferences.getSnapshot().saving).toBe(true));
    await h.hide();
    await h.show();
    await h.wait();
    await act(async () => {
      finish();
      await enginePreferences.flush();
    });
    await h.wait();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(enginePreferences.isSavedValue(h.atoms.get(enginesAtom))).toBe(true);
    await vi.waitFor(() => expect(document.body.textContent).toContain("Engine settings saved."));
    await h.click("Done");
    expect(JSON.parse(fixture.disk)).toHaveLength(2);
    expect(fixture.validate).toHaveBeenCalledTimes(1);
  } finally {
    await h.close();
  }
});
it("preserves custom network, hidden state, identity and search limits through the real Edit engine save", async () => {
  const h = await mount(true);
  try {
    await h.click("Common.Save");
    await h.wait();
    expect(JSON.parse(fixture.disk)).toEqual([owner]);
    expect(fixture.validate).not.toHaveBeenCalled();
  } finally {
    await h.close();
  }
});
it("refuses an edit after another owner changes that profile", async () => {
  const h = await mount(true);
  try {
    await act(async () => h.atoms.set(enginesAtom, [{ ...owner, name: "Later owner choice" }]));
    await enginePreferences.flush();
    await h.click("Common.Save");
    await h.wait();
    expect(document.body.textContent).toContain("profile changed");
    expect(JSON.parse(fixture.disk)[0].name).toBe("Later owner choice");
  } finally {
    await h.close();
  }
});
