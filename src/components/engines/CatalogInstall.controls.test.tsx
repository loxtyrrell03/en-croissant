import { MantineProvider } from "@mantine/core";
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enginesAtom } from "@/state/atoms";
import { enginePreferences } from "@/utils/enginePreferences";
import type { LocalEngine } from "@/utils/engines";
import { CatalogEngineCard as EngineCard } from "./CatalogEngineCard";
import { EnginePreferencesNotice } from "./EnginePreferencesNotice";

const fixture = vi.hoisted(() => ({
  disk: "[]",
  fail: false,
  install: vi.fn(),
  config: vi.fn(),
  write: vi.fn(),
  directory: "C:/Fixture/engines",
  loadedDirectory: undefined as string | undefined,
  download: vi.fn(),
  executable: vi.fn(),
  progress: new Map<string, any>(),
  listeners: new Set<(event: any) => void>(),
  settle: [] as (() => void)[],
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: fixture.install }));
vi.mock("@tauri-apps/api/path", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/path")>()),
  join: async (...parts: string[]) => parts.join("/"),
  resolve: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@/utils/directories", () => ({ getEnginesDir: async () => fixture.directory }));
vi.mock("@/bindings", async (original) => {
  const actual = await original<typeof import("@/bindings")>();
  return {
    ...actual,
    commands: {
      ...actual.commands,
      getEngineConfig: fixture.config,
      downloadFile: fixture.download,
      setFileAsExecutable: fixture.executable,
      getProgress: async (id: string) => fixture.progress.get(id) ?? null,
    },
    events: {
      ...actual.events,
      progressEvent: {
        listen: async (listener: (event: any) => void) => {
          fixture.listeners.add(listener);
          return () => {
            fixture.listeners.delete(listener);
          };
        },
      },
    },
  };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "Common.Install": "Install",
        "Common.Installed": "Installed",
        "Common.Downloading": "Downloading",
        "Common.Extracting": "Extracting",
      })[key] ?? key,
  }),
}));
vi.mock("@/utils/enginePreferences", async () => {
  const { createEnginePreferenceStore } = await import("@/utils/enginePreferenceStore");
  return {
    enginePreferences: createEnginePreferenceStore({
      beginLoad: async () => {
        fixture.loadedDirectory = fixture.directory;
      },
      identity: () => fixture.loadedDirectory,
      read: async () => fixture.disk,
      write: async (value) => {
        fixture.write(value);
        if (fixture.fail) throw new Error("Invented profile save failure");
        fixture.disk = value;
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
};
const engine: LocalEngine = {
  type: "local",
  id: "catalog-lc0",
  name: "LCZero",
  version: "0.32.1",
  path: "lc0/lc0.exe",
  managedInstall: "chessbot-lc0-0.32.1",
  loaded: false,
};
const installed = {
  path: "C:/Fixture/engines/lc0/lc0.exe",
  weightsPath: "C:/Fixture/engines/lc0/network.pb.gz",
  version: "0.32.1",
  network: "fixture",
};
const config = { status: "ok", data: { name: "LCZero", options: [] } };
let host: HTMLDivElement,
  root: ReturnType<typeof createRoot>,
  atoms: ReturnType<typeof createStore>,
  unsubscribe: () => void;
beforeEach(async () => {
  fixture.fail = false;
  fixture.directory = "C:/Fixture/engines";
  await enginePreferences.retry().catch(() => {});
  fixture.disk = JSON.stringify([owner]);
  await enginePreferences.reload();
  fixture.write.mockClear();
  fixture.install.mockReset().mockResolvedValue(installed);
  fixture.config.mockReset().mockResolvedValue(config);
  fixture.download.mockReset().mockResolvedValue({ status: "ok", data: null });
  fixture.executable.mockReset().mockResolvedValue({ status: "ok", data: null });
  fixture.progress.clear();
  fixture.listeners.clear();
  fixture.settle = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  atoms = createStore();
  unsubscribe = atoms.sub(enginesAtom, () => {});
  await vi.waitFor(() => {
    if (atoms.get(enginesAtom)?.length !== 1) throw new Error("Fixture profiles are not loaded");
  });
});
afterEach(async () => {
  await act(async () => {
    for (const finish of fixture.settle) finish();
  });
  await act(async () => root.unmount());
  unsubscribe();
  host.remove();
  vi.unstubAllGlobals();
});
async function render(visible = true, selected = engine) {
  await act(async () =>
    root.render(
      <Provider store={atoms}>
        <MantineProvider>
          <section aria-label="Fixture card">{visible && <EngineCard engine={selected} />}</section>
          <EnginePreferencesNotice />
        </MantineProvider>
      </Provider>,
    ),
  );
}
const card = () => host.querySelector('section[aria-label="Fixture card"]')!;
const button = () => card().querySelector<HTMLButtonElement>("button")!;
async function finishFiles() {
  await act(async () => {
    const payload = {
      id: fixture.install.mock.calls.at(-1)?.[1]?.id,
      progress: 100,
      finished: true,
    };
    fixture.progress.set(payload.id, payload);
    for (const listener of fixture.listeners) listener({ payload });
  });
}

it("does not claim installation complete while the downloaded engine is still being validated", async () => {
  fixture.config.mockImplementation(
    () => new Promise((resolve) => fixture.settle.push(() => resolve(config))),
  );
  await render();
  await act(async () => button().click());
  await vi.waitFor(() => expect(fixture.config).toHaveBeenCalledTimes(1));
  await finishFiles();
  expect(button().textContent).not.toContain("Installed");
  expect(atoms.get(enginesAtom)).toHaveLength(1);
});
it("retains a managed installation failure when the dialog closes before it arrives", async () => {
  let reject!: (error: Error) => void;
  fixture.install.mockReturnValue(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  await render();
  await act(async () => button().click());
  await render(false);
  await act(async () => reject(new Error("Invented managed download failure")));
  await render();
  expect(card().textContent).toContain("Invented managed download failure");
});
it("offers profile-save retry instead of reporting completion after a failed save", async () => {
  fixture.fail = true;
  await render();
  await act(async () => button().click());
  await vi.waitFor(() => expect(enginePreferences.getSnapshot().error).toContain("save failure"));
  await finishFiles();
  expect(button().textContent).toBe("Retry save");
  expect(fixture.install).toHaveBeenCalledTimes(1);
  // The existing global writer already retains the failed snapshot; the card
  // still needs to represent that unfinished phase and its next action.
  expect(enginePreferences.getSnapshot().pending).toBe(true);
  await render(false);
  await render();
  expect(button().textContent).toBe("Retry save");
  const current = atoms.get(enginesAtom)!;
  await act(async () =>
    atoms.set(
      enginesAtom,
      current.map((profile) =>
        profile.id === owner.id ? { ...profile, name: "Latest owner name" } : profile,
      ),
    ),
  );
  fixture.fail = false;
  await act(async () => button().click());
  await vi.waitFor(() => expect(button().textContent).toBe("Installed"));
  const saved = JSON.parse(fixture.disk);
  expect(saved).toHaveLength(2);
  expect(saved[0]).toEqual({ ...owner, name: "Latest owner name" });
  expect(saved[1].settings).toContainEqual({ name: "WeightsFile", value: installed.weightsPath });
  expect(fixture.config).toHaveBeenCalledTimes(1);
  expect(fixture.install).toHaveBeenCalledTimes(1);
});
it("keeps one managed install running across close, reopen and catalog reordering", async () => {
  let finish!: (value: typeof installed) => void;
  fixture.install.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  await act(async () => button().click());
  const id = fixture.install.mock.calls[0][1].id;
  expect(id).not.toBe("engine_0");
  await render(false);
  await render(true, { ...engine, id: "different-catalog-row-id" });
  expect(button().disabled).toBe(true);
  expect(button().textContent).toBe("Installing…");
  await act(async () => {
    for (const listener of fixture.listeners)
      listener({ payload: { id: "engine_0", progress: 100, finished: true } });
  });
  expect(button().textContent).toBe("Installing…");
  await act(async () => finish(installed));
  await vi.waitFor(() => expect(button().textContent).toBe("Installed"));
  expect(fixture.install).toHaveBeenCalledTimes(1);
});
it("recognizes the existing global Retry save action without running installation again", async () => {
  fixture.fail = true;
  await render();
  await act(async () => button().click());
  await vi.waitFor(() => expect(button().textContent).toBe("Retry save"));
  fixture.fail = false;
  const retry = Array.from(host.querySelectorAll("button")).find(
    (element) => !card().contains(element) && element.textContent === "Retry save",
  )!;
  await act(async () => retry.click());
  await vi.waitFor(() => expect(button().textContent).toBe("Installed"));
  expect(fixture.install).toHaveBeenCalledTimes(1);
  expect(fixture.config).toHaveBeenCalledTimes(1);
});
it("does not resurrect a profile removed while its failed save was pending", async () => {
  fixture.fail = true;
  await render();
  await act(async () => button().click());
  await vi.waitFor(() => expect(button().textContent).toBe("Retry save"));
  await act(async () => atoms.set(enginesAtom, [owner]));
  fixture.fail = false;
  await act(async () => button().click());
  await vi.waitFor(() => expect(button().textContent).toBe("Install"));
  expect(JSON.parse(fixture.disk)).toEqual([owner]);
  expect(fixture.install).toHaveBeenCalledTimes(1);
});
it("retries validation using completed files without redownloading", async () => {
  fixture.config
    .mockResolvedValueOnce({ status: "error", error: "Invented UCI check failure" })
    .mockResolvedValue(config);
  await render();
  await act(async () => button().click());
  expect(card().querySelector('[role="alert"]')?.textContent).toContain("UCI check failure");
  expect(button().textContent).toBe("Retry install");
  await render(false);
  await render();
  await act(async () => button().click());
  await vi.waitFor(() => expect(button().textContent).toBe("Installed"));
  expect(fixture.config).toHaveBeenCalledTimes(2);
  expect(fixture.install).toHaveBeenCalledTimes(1);
});
it("rejects registration into a changed engine folder after an old install completes", async () => {
  let finish!: (value: typeof installed) => void;
  fixture.install.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  await act(async () => button().click());
  fixture.directory = "D:/Other/engines";
  await act(async () => enginePreferences.reload());
  await act(async () => finish(installed));
  expect(card().querySelector('[role="alert"]')?.textContent).toContain("folder changed");
  expect(atoms.get(enginesAtom)).toEqual([owner]);
  expect(fixture.config).not.toHaveBeenCalled();
});
it("preserves a manual profile added at the installed path while files were downloading", async () => {
  let finish!: (value: typeof installed) => void;
  fixture.install.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  await act(async () => button().click());
  const manual: LocalEngine = {
    ...owner,
    id: "manual",
    name: "Custom LCZero name",
    path: installed.path,
    loaded: false,
    settings: [{ name: "WeightsFile", value: "D:/Owner/other-network.pb.gz" }],
    image: "D:/Owner/logo.png",
  };
  await act(async () => atoms.set(enginesAtom, [owner, manual]));
  await enginePreferences.flush();
  await act(async () => finish(installed));
  await vi.waitFor(() => expect(button().textContent).toBe("Installed"));
  expect(atoms.get(enginesAtom)).toEqual([owner, manual]);
  expect(JSON.parse(fixture.disk)).toEqual([owner, manual]);
});
it("keeps third-party download and executable errors distinct from a valid installed profile", async () => {
  const third: LocalEngine = {
    type: "local",
    id: "third",
    name: "Fixture engine",
    version: "1",
    path: "Vendor/engine.exe",
    downloadLink: "https://fixture.invalid/engine.zip",
  };
  fixture.download.mockResolvedValueOnce({ status: "error", error: "Invented download error" });
  await render(true, third);
  await act(async () => button().click());
  expect(card().querySelector('[role="alert"]')?.textContent).toContain("download error");
  expect(fixture.config).not.toHaveBeenCalled();
  fixture.executable.mockResolvedValueOnce({
    status: "error",
    error: "Invented executable permission error",
  });
  await act(async () => button().click());
  expect(card().querySelector('[role="alert"]')?.textContent).toContain("permission error");
  expect(fixture.config).not.toHaveBeenCalled();
  await act(async () => button().click());
  await vi.waitFor(() => expect(button().textContent).toBe("Installed"));
  expect(atoms.get(enginesAtom)).toHaveLength(2);
});
