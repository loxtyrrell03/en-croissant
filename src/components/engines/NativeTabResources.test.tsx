import { Accordion, MantineProvider } from "@mantine/core";
import { createStore, Provider, useAtomValue } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  activeTabAtom,
  enginesAtom,
  engineSearchErrorFamily,
  tabEngineSettingsFamily,
  tabsAtom,
  useStoredEvaluationsAtom,
} from "@/state/atoms";
import { enginePreferences } from "@/utils/enginePreferences";
import type { LocalEngine } from "@/utils/engines";
import type { EngineConfig } from "@/bindings";
import type { Tab } from "@/utils/tabs";
import BestMoves from "@/components/panels/analysis/BestMoves";
import { EngineListener } from "@/components/boards/EvalListener";

const io = vi.hoisted(() => ({
  disk: "[]",
  read: vi.fn(),
  write: vi.fn(),
  device: vi.fn(),
  config: vi.fn(),
  native: vi.fn(),
  stop: vi.fn(),
  matching: vi.fn(),
  kill: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@/bindings", async (original) => {
  const actual = await original<typeof import("@/bindings")>();
  return {
    ...actual,
    commands: { ...actual.commands, engineDeviceInfo: io.device, getEngineConfig: io.config },
    events: { bestMovesPayload: { listen: async () => () => {} } },
  };
});
vi.mock("@/utils/enginePreferences", async () => {
  const { createEnginePreferenceStore } = await import("@/utils/enginePreferenceStore");
  return {
    enginePreferences: createEnginePreferenceStore({
      read: () => io.read(),
      write: async (text) => {
        await io.write(text);
        io.disk = text;
      },
    }),
  };
});
vi.mock("@/utils/engines", async (original) => ({
  ...(await original<typeof import("@/utils/engines")>()),
  getBestMoves: io.native,
  stopEngine: io.stop,
  stopMatchingEngine: io.matching,
  killEngine: io.kill,
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original()),
  useNavigate: () => io.navigate,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/panels/analysis/AnalysisRow", () => ({ default: () => null }));

const profile: LocalEngine = {
  type: "local",
  id: "tab-cpu",
  name: "Invented CPU",
  version: "19",
  path: "C:/Fixture/tab-cpu.exe",
  loaded: true,
  go: { t: "Nodes", c: 170003 },
  settings: [
    { name: "Threads", value: 3 },
    { name: "Hash", value: 768 },
    { name: "MultiPV", value: 4 },
    { name: "OwnerOption", value: "keep" },
  ],
};
const config: EngineConfig = {
  name: "Invented CPU",
  options: [
    {
      type: "spin",
      value: { name: "Threads", default: BigInt(1), min: BigInt(1), max: BigInt(64) },
    },
    {
      type: "spin",
      value: { name: "Hash", default: BigInt(16), min: BigInt(16), max: BigInt(8192) },
    },
  ],
};
const tab = (value: string): Tab => ({
  value,
  name: value,
  type: "analysis",
  gameOrigin: { kind: "none" },
});
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const noMoves: string[] = [];
const settingsAtom = (id = "resource-a") =>
  tabEngineSettingsFamily({
    tab: id,
    engineId: profile.id,
    defaultSettings: profile.settings!,
    defaultGo: profile.go!,
  });
const resources = (settings: typeof profile.settings) =>
  settings?.filter((s) => ["Threads", "Hash"].includes(s.name)).map((s) => s.value);
let host: HTMLDivElement,
  root: ReturnType<typeof createRoot>,
  atoms: ReturnType<typeof createStore>,
  unsubscribe: () => void;
let listening = true;
function Probe({ listening }: { listening: boolean }) {
  const engines = useAtomValue(enginesAtom),
    active = useAtomValue(activeTabAtom);
  const engine = engines?.find((engine) => engine.id === profile.id);
  if (!engine || !active) return null;
  return (
    <>
      <Accordion>
        <Accordion.Item value={engine.name}>
          <BestMoves
            id={0}
            engine={engine}
            fen={fen}
            moves={noMoves}
            halfMoves={0}
            dragHandleProps={{}}
            orientation="white"
          />
        </Accordion.Item>
      </Accordion>
      {listening && (
        <EngineListener
          engine={engine}
          engineWakeRevision={0}
          firstEngineWithLines={null}
          isGameOver={false}
          finalFen={fen}
          searchingFen={fen}
          searchingMoves={noMoves}
          fen={fen}
          moves={noMoves}
          threat={false}
        />
      )}
    </>
  );
}
const swrCache = new Map();
const render = () =>
  act(async () =>
    root.render(
      <MantineProvider env="test">
        <SWRConfig value={{ provider: () => swrCache }}>
          <Provider store={atoms}>
            <Probe listening={listening} />
          </Provider>
        </SWRConfig>
      </MantineProvider>,
    ),
  );
const button = (label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ??
  Array.from(host.querySelectorAll("button")).find((button) => button.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
const current = (id?: string) => atoms.get(settingsAtom(id));
const open = async () => {
  await click("Engine settings");
  await vi.waitFor(() => expect(button("Balanced")).toBeTruthy());
};
const sync = () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const line = (cp: number) => ({
  depth: 10,
  nodes: 50,
  nps: 100,
  multipv: 1,
  uciMoves: ["e2e4"],
  sanMoves: ["e4"],
  score: { value: { type: "cp", value: cp }, wdl: null },
});
beforeEach(async () => {
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
  swrCache.clear();
  listening = true;
  io.disk = JSON.stringify([profile]);
  io.read.mockReset().mockImplementation(async () => io.disk);
  io.write.mockReset().mockResolvedValue(undefined);
  io.device
    .mockReset()
    .mockResolvedValue({ logicalThreads: 20, totalMemoryMb: 32768, availableMemoryMb: 24000 });
  io.config.mockReset().mockResolvedValue({ status: "ok", data: config });
  io.native.mockReset().mockResolvedValue([100, [line(20)]]);
  io.stop.mockReset().mockResolvedValue(undefined);
  io.matching.mockReset().mockResolvedValue(undefined);
  io.kill.mockReset().mockResolvedValue(undefined);
  await enginePreferences.reload();
  atoms = createStore();
  unsubscribe = atoms.sub(enginesAtom, () => {});
  await vi.waitFor(() => {
    if (atoms.get(enginesAtom)?.length !== 1) throw new Error("Fixture profiles have not loaded.");
  });
  atoms.set(tabsAtom, [tab("resource-a"), tab("resource-b")]);
  atoms.set(activeTabAtom, "resource-a");
  atoms.set(useStoredEvaluationsAtom, false);
  atoms.set(settingsAtom(), (current) => ({ ...current, enabled: true }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render();
  await vi.waitFor(() => {
    if (io.native.mock.calls.length !== 1)
      throw new Error("Initial fixture analysis has not started.");
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  unsubscribe();
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("reads no resource metadata while closed and preserves exact saved values when opened", async () => {
  expect(io.device).not.toHaveBeenCalled();
  expect(io.config).not.toHaveBeenCalled();
  await open();
  expect(io.config).toHaveBeenCalledTimes(1);
  expect(io.device).toHaveBeenCalled();
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Threads"]')?.value).toBe("3");
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Hash memory (MiB)"]')?.value).toBe(
    "768",
  );
  expect(io.write).not.toHaveBeenCalled();
  expect(io.native).toHaveBeenCalledTimes(1);
  await click("Engine settings");
  await open();
  expect(io.config).toHaveBeenCalledTimes(1);
  expect(io.write).not.toHaveBeenCalled();
});
it("applies unsynced resources to the current tab once without saving defaults", async () => {
  await act(async () => atoms.set(settingsAtom(), (s) => ({ ...s, synced: false })));
  await open();
  const before = current();
  await click("Balanced");
  expect(resources(current().settings)).toEqual([10, 1024]);
  expect(current().go).toEqual(before.go);
  expect(current().settings.slice(2)).toEqual(before.settings.slice(2));
  expect(current().enabled).toBe(true);
  expect(resources(atoms.get(enginesAtom)![0].settings)).toEqual([3, 768]);
  expect(io.write).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(io.native).toHaveBeenCalledTimes(2));
  expect(io.native.mock.lastCall![3].extraOptions).toEqual(
    expect.arrayContaining([
      { name: "Threads", value: "10" },
      { name: "Hash", value: "1024" },
    ]),
  );
  expect(host.textContent).toContain("Tab resources updated.");
});
it("verifies a synced save before one same-position resource restart", async () => {
  let finish!: () => void;
  io.write.mockReturnValueOnce(
    new Promise<void>((done) => {
      finish = done;
    }),
  );
  await open();
  await click("Balanced");
  expect(resources(current().settings)).toEqual([3, 768]);
  expect(io.native).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  await vi.waitFor(() => expect(io.native).toHaveBeenCalledTimes(2));
  expect(resources(current().settings)).toEqual([10, 1024]);
  expect(resources(atoms.get(enginesAtom)![0].settings)).toEqual([10, 1024]);
  expect(io.native.mock.lastCall![1]).toBe("resource-a");
  expect(io.native.mock.lastCall![2]).toEqual(profile.go);
  expect(io.native.mock.lastCall![3].fen).toBe(fen);
  expect(io.write).toHaveBeenCalledTimes(1);
  expect(current().enabled).toBe(true);
});
it("never revives an engine paused while its resource defaults save", async () => {
  let finish!: () => void;
  io.write.mockReturnValueOnce(
    new Promise<void>((done) => {
      finish = done;
    }),
  );
  await open();
  await click("Balanced");
  await click("Pause engine analysis");
  expect(current().enabled).toBe(false);
  await act(async () => finish());
  expect(current().enabled).toBe(false);
  expect(resources(current().settings)).toEqual([10, 1024]);
  expect(io.native).toHaveBeenCalledTimes(1);
  expect(io.write).toHaveBeenCalledTimes(1);
  await click("Start engine analysis");
  await vi.waitFor(() => expect(io.native).toHaveBeenCalledTimes(2));
  expect(io.native.mock.lastCall![3].extraOptions).toContainEqual({ name: "Threads", value: "10" });
});
it("leaves a suspended listener stopped while the save completes", async () => {
  let finish!: () => void;
  io.write.mockReturnValueOnce(
    new Promise<void>((done) => {
      finish = done;
    }),
  );
  await open();
  await click("Balanced");
  listening = false;
  await render();
  await act(async () => finish());
  expect(current().enabled).toBe(true);
  expect(io.native).toHaveBeenCalledTimes(1);
  listening = true;
  await render();
  await vi.waitFor(() => expect(io.native).toHaveBeenCalledTimes(2));
});
it("preserves a replacement tab's unsynced resources during a late global save", async () => {
  atoms.set(settingsAtom("resource-b"), {
    enabled: true,
    synced: false,
    go: { t: "Depth", c: 23 },
    settings: profile.settings!.map((s) =>
      s.name === "Threads" ? { ...s, value: 7 } : s.name === "Hash" ? { ...s, value: 333 } : s,
    ),
  });
  let finish!: () => void;
  io.write.mockReturnValueOnce(
    new Promise<void>((done) => {
      finish = done;
    }),
  );
  await open();
  await click("Balanced");
  await act(async () => atoms.set(activeTabAtom, "resource-b"));
  await vi.waitFor(() => expect(io.native).toHaveBeenCalledTimes(2));
  await act(async () => finish());
  expect(resources(current("resource-b").settings)).toEqual([7, 333]);
  expect(current("resource-b").go).toEqual({ t: "Depth", c: 23 });
  expect(io.native.mock.lastCall![1]).toBe("resource-b");
  expect(io.native.mock.lastCall![3].extraOptions).toContainEqual({ name: "Threads", value: "7" });
  expect(io.native).toHaveBeenCalledTimes(2);
});
it("cancels an unwritten edit after the original tab is removed and releases its pending save", async () => {
  let finish!: (text: string) => void;
  io.read.mockImplementationOnce(
    () =>
      new Promise<string>((done) => {
        finish = done;
      }),
  );
  await open();
  await click("Balanced");
  await act(async () => {
    atoms.set(tabsAtom, [tab("resource-b")]);
    atoms.set(activeTabAtom, "resource-b");
  });
  await act(async () => finish(io.disk));
  expect(io.write).not.toHaveBeenCalled();
  expect(enginePreferences.getSnapshot().pending).toBe(false);
  expect(enginePreferences.getSnapshot().error).toBeNull();
  expect(enginePreferences.isSavedValue(atoms.get(enginesAtom))).toBe(true);
  expect(atoms.get(tabsAtom).map((tab) => tab.value)).toEqual(["resource-b"]);
});
it("preserves an unsynced choice when synchronization is turned off during an already-started write", async () => {
  let finish!: () => void;
  io.write.mockReturnValueOnce(
    new Promise<void>((done) => {
      finish = done;
    }),
  );
  await open();
  await click("Balanced");
  await act(async () => sync().click());
  expect(current().synced).toBe(false);
  await act(async () => finish());
  expect(current().synced).toBe(false);
  expect(resources(current().settings)).toEqual([3, 768]);
  expect(resources(atoms.get(enginesAtom)![0].settings)).toEqual([10, 1024]);
  expect(io.native).toHaveBeenCalledTimes(1);
});
it("keeps failed synced resources separate and retries the original change", async () => {
  io.write.mockRejectedValueOnce(new Error("Invented write failure"));
  await open();
  await click("Balanced");
  expect(resources(current().settings)).toEqual([3, 768]);
  expect(io.native).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("Invented write failure");
  await click("Retry save");
  await vi.waitFor(() => expect(io.native).toHaveBeenCalledTimes(2));
  expect(resources(current().settings)).toEqual([10, 1024]);
  expect(io.write).toHaveBeenCalledTimes(2);
});
it("keeps stopped and focus-paused included instances in the recommendation budget", async () => {
  const other = { ...profile, id: "other-cpu", path: "C:/Fixture/other-cpu.exe" };
  await act(async () => atoms.set(enginesAtom, [...atoms.get(enginesAtom)!, other]));
  await enginePreferences.flush();
  atoms.set(settingsAtom("resource-b"), (s) => ({ ...s, enabled: true }));
  await open();
  expect(host.textContent).toContain("3 included CPU engines");
  await click("Balanced");
  expect(resources(current().settings)).toEqual([3, 256]);
});
it("reads current state for two queued pause clicks instead of reviving the old render", async () => {
  const pause = button("Pause engine analysis");
  await act(async () => {
    pause.click();
    pause.click();
  });
  expect(current().enabled).toBe(true);
  expect(io.write).not.toHaveBeenCalled();
});
it("keeps options errors visible beside retry without applying resources", async () => {
  io.config.mockResolvedValueOnce({ status: "error", error: "Invented invalid options" });
  await click("Engine settings");
  expect(host.textContent).toContain("Could not read this engine");
  expect(io.write).not.toHaveBeenCalled();
  await click("Retry engine options");
  await vi.waitFor(() => expect(button("Balanced")).toBeTruthy());
  expect(io.write).not.toHaveBeenCalled();
});
it("shows a saved-but-failed native request and retries analysis without another preference write", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  io.native
    .mockRejectedValueOnce(new Error("Invented rejected hash"))
    .mockRejectedValueOnce(new Error("Invented rejected hash"));
  await open();
  await click("Balanced");
  await vi.waitFor(() =>
    expect(atoms.get(engineSearchErrorFamily({ engine: profile.id, tab: "resource-a" }))).toBe(
      "Invented rejected hash",
    ),
  );
  expect(host.textContent).toContain("Analysis could not start: Invented rejected hash");
  expect(host.textContent).toContain("Resources saved.");
  expect(io.write).toHaveBeenCalledTimes(1);
  await click("Retry analysis");
  await vi.waitFor(() => expect(io.native).toHaveBeenCalledTimes(4));
  expect(atoms.get(engineSearchErrorFamily({ engine: profile.id, tab: "resource-a" }))).toBeNull();
  expect(resources(current().settings)).toEqual([10, 1024]);
  expect(io.write).toHaveBeenCalledTimes(1);
});
it("restores only previous CPU resources after a native apply failure, retaining lines and limits", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  io.native.mockImplementation(async (_engine, _tab, _go, options) => {
    if (
      options.extraOptions.some(
        (option: { name: string; value: string }) =>
          option.name === "Threads" && option.value === "10",
      )
    )
      throw new Error("Invented resource rejection");
    return [100, [line(20)]];
  });
  await open();
  await click("Balanced");
  await vi.waitFor(() => expect(button("Restore previous resources")).toBeTruthy());
  await click("Restore previous resources");
  await vi.waitFor(() => expect(resources(current().settings)).toEqual([3, 768]));
  expect(current().go).toEqual(profile.go);
  expect(current().settings.slice(2)).toEqual(profile.settings?.slice(2));
  expect(io.write).toHaveBeenCalledTimes(2);
  expect(current().enabled).toBe(true);
  expect(atoms.get(engineSearchErrorFamily({ engine: profile.id, tab: "resource-a" }))).toBeNull();
});
it("cancels an unwritten global change when sync is disabled, then permits a fresh local edit", async () => {
  let finish!: (text: string) => void;
  io.read.mockImplementationOnce(
    () =>
      new Promise<string>((done) => {
        finish = done;
      }),
  );
  await open();
  await click("Balanced");
  await act(async () => sync().click());
  await act(async () => finish(io.disk));
  expect(enginePreferences.getSnapshot().pending).toBe(false);
  expect(io.write).not.toHaveBeenCalled();
  expect(resources(current().settings)).toEqual([3, 768]);
  expect(current().synced).toBe(false);
  await click("Faster");
  expect(resources(current().settings)).toEqual([15, 2048]);
  expect(io.write).not.toHaveBeenCalled();
});
it("restores a failed save without restarting analysis or rewriting unchanged previous bytes", async () => {
  io.write.mockRejectedValueOnce(new Error("Invented unavailable disk"));
  await open();
  await click("Balanced");
  await click("Restore previous");
  expect(resources(current().settings)).toEqual([3, 768]);
  expect(io.write).toHaveBeenCalledTimes(1);
  expect(io.native).toHaveBeenCalledTimes(1);
  expect(enginePreferences.getSnapshot().pending).toBe(false);
});
it("uses profile identity for synchronization when another engine has the same display name", async () => {
  const other = {
    ...profile,
    id: "same-label",
    path: "C:/Fixture/same-label.exe",
    settings: profile.settings!.map((s) => (s.name === "Threads" ? { ...s, value: 9 } : s)),
  };
  await act(async () => atoms.set(enginesAtom, [other, ...atoms.get(enginesAtom)!]));
  await enginePreferences.flush();
  await act(async () =>
    atoms.set(settingsAtom(), (s) => ({
      ...s,
      synced: false,
      settings: s.settings.map((s) => (s.name === "Threads" ? { ...s, value: 7 } : s)),
    })),
  );
  await open();
  await act(async () => sync().click());
  expect(resources(current().settings)).toEqual([3, 768]);
});
