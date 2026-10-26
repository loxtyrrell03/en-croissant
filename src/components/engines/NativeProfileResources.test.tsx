import { MantineProvider } from "@mantine/core";
import { createStore, Provider, useAtomValue } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EngineConfig } from "@/bindings";
import { enginesAtom, tabEngineSettingsFamily } from "@/state/atoms";
import { enginePreferences } from "@/utils/enginePreferences";
import type { LocalEngine } from "@/utils/engines";
import { NativeProfileResources } from "./NativeProfileResources";
import { EnginePreferencesNotice } from "./EnginePreferencesNotice";
import { NativeProfileSearchControls } from "./NativeProfileSearchControls";

const io = vi.hoisted(() => ({ disk: "[]", write: vi.fn(), device: vi.fn() }));
vi.mock("@/bindings", async (original) => {
  const actual = await original<typeof import("@/bindings")>();
  return { ...actual, commands: { ...actual.commands, engineDeviceInfo: io.device } };
});
vi.mock("@/utils/enginePreferences", async () => {
  const { createEnginePreferenceStore } = await import("@/utils/enginePreferenceStore");
  return {
    enginePreferences: createEnginePreferenceStore({
      read: async () => io.disk,
      write: async (text) => {
        await io.write(text);
        io.disk = text;
      },
    }),
  };
});
const config: EngineConfig = {
  name: "Invented CPU engine",
  options: [
    {
      type: "spin",
      value: { name: "MultiPV", default: BigInt(1), min: BigInt(1), max: BigInt(256) },
    },
    {
      type: "spin",
      value: { name: "Threads", min: BigInt(1), max: BigInt(64), default: BigInt(1) },
    },
    {
      type: "spin",
      value: { name: "Hash", min: BigInt(16), max: BigInt(8192), default: BigInt(16) },
    },
  ],
};
const profile: LocalEngine = {
  type: "local",
  id: "cpu-fixture",
  name: "Invented CPU",
  version: "19",
  path: "C:/Fixture/cpu.exe",
  loaded: true,
  go: { t: "Nodes", c: 170003 },
  enabled: false,
  settings: [
    { name: "Threads", value: 3 },
    { name: "Hash", value: 768 },
    { name: "MultiPV", value: 4 },
    { name: "OwnerOption", value: "keep" },
  ],
};
const values = (p: LocalEngine) =>
  p.settings?.filter((s) => ["Threads", "Hash"].includes(s.name)).map((s) => s.value);
let host: HTMLDivElement,
  root: ReturnType<typeof createRoot>,
  atoms: ReturnType<typeof createStore>;
let selected = profile.id;
function Probe() {
  const engines = useAtomValue(enginesAtom);
  const engine = engines?.find((item) => item.id === selected);
  return engine?.type === "local" ? (
    <>
      <NativeProfileSearchControls
        key={`search:${engine.id}:${engine.path}`}
        engine={engine}
        config={config}
      />
      <NativeProfileResources
        key={`cpu:${engine.id}:${engine.path}`}
        engine={engine}
        config={config}
      />
    </>
  ) : null;
}
const render = () =>
  act(async () =>
    root.render(
      <MantineProvider env="test">
        <Provider store={atoms}>
          <Probe />
        </Provider>
      </MantineProvider>,
    ),
  );
function button(label: string) {
  return Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === label,
  )!;
}
const click = (label: string) => act(async () => button(label).click());
function input(label: string) {
  return host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
}
const change = (field: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
const key = (field: HTMLInputElement, value: string, type = "keydown") =>
  act(async () => field.dispatchEvent(new KeyboardEvent(type, { key: value, bubbles: true })));
const pointer = (field: HTMLInputElement, type: string) =>
  act(async () => field.dispatchEvent(new Event(type, { bubbles: true })));
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
  io.disk = JSON.stringify([profile]);
  io.write.mockReset().mockResolvedValue(undefined);
  io.device
    .mockReset()
    .mockResolvedValue({ logicalThreads: 20, totalMemoryMb: 32768, availableMemoryMb: 24000 });
  await enginePreferences.reload();
  selected = profile.id;
  atoms = createStore();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render();
  await act(async () => {
    await new Promise((done) => setTimeout(done, 5));
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("keeps saved non-power-of-two resources and every unrelated option on device read", () => {
  expect(input("Threads").value).toBe("3");
  expect(input("Hash memory (MiB)").value).toBe("768");
  expect(host.textContent).toContain("Custom");
  expect(host.textContent).toContain("20 logical threads");
  expect(io.write).not.toHaveBeenCalled();
  expect(atoms.get(enginesAtom)).toEqual(enginePreferences.getSnapshot().value);
});
it("does not publish before readback, then saves one CPU-only preset edit", async () => {
  let finish!: () => void;
  io.write.mockReturnValueOnce(
    new Promise<void>((done) => {
      finish = done;
    }),
  );
  const tab = tabEngineSettingsFamily({ tab: "fixture-tab", engineId: profile.id });
  atoms.set(tab, {
    enabled: false,
    synced: true,
    go: { t: "Infinite" },
    settings: profile.settings!,
  });
  await click("Balanced");
  expect(values(atoms.get(enginesAtom)![0] as LocalEngine)).toEqual([3, 768]);
  expect(enginePreferences.getSnapshot().value![0].settings).toEqual(profile.settings);
  expect(host.textContent).toContain("Saving resources");
  expect(input("Threads").disabled).toBe(true);
  await act(async () => finish());
  const saved = atoms.get(enginesAtom)![0] as LocalEngine;
  expect(values(saved)).toEqual([10, 1024]);
  expect(saved.go).toEqual(profile.go);
  expect(saved.enabled).toBe(false);
  expect(saved.settings?.slice(2)).toEqual(profile.settings?.slice(2));
  expect(atoms.get(tab).enabled).toBe(false);
  expect(io.write).toHaveBeenCalledTimes(1);
});
it("drafts exact values, applies once on Enter and ignores the following blur", async () => {
  const field = input("Hash memory (MiB)");
  await change(field, "777");
  expect(io.write).not.toHaveBeenCalled();
  await key(field, "Enter");
  await act(async () => field.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  expect(io.write).toHaveBeenCalledTimes(1);
  expect(values(atoms.get(enginesAtom)![0] as LocalEngine)).toEqual([3, 777]);
});
it.each(["Escape", "window blur", "pointercancel", "lostpointercapture"])(
  "discards unfinished edits on %s",
  async (cancel) => {
    const field = input("Threads slider");
    await pointer(field, "pointerdown");
    await change(field, "7");
    expect(io.write).not.toHaveBeenCalled();
    if (cancel === "Escape") await key(field, "Escape");
    else if (cancel === "window blur")
      await act(async () => window.dispatchEvent(new Event("blur")));
    else await pointer(field, cancel);
    await pointer(field, "pointerup");
    expect(input("Threads").value).toBe("3");
    expect(io.write).not.toHaveBeenCalled();
  },
);
it("commits one completed pointer gesture and supports every whole thread count", async () => {
  const field = input("Threads slider");
  await pointer(field, "pointerdown");
  await change(field, "7");
  await change(field, "11");
  expect(io.write).not.toHaveBeenCalled();
  await pointer(field, "pointerup");
  expect(values(atoms.get(enginesAtom)![0] as LocalEngine)).toEqual([11, 768]);
  expect(io.write).toHaveBeenCalledTimes(1);
});
it("commits a keyboard slider edit on key release", async () => {
  const field = input("Threads slider");
  await key(field, "ArrowRight");
  await change(field, "4");
  expect(io.write).not.toHaveBeenCalled();
  await key(field, "ArrowRight", "keyup");
  expect(values(atoms.get(enginesAtom)![0] as LocalEngine)).toEqual([4, 768]);
  expect(io.write).toHaveBeenCalledTimes(1);
});
it.each(["0", "1.5", "word", "999"])(
  "rejects invalid exact threads %s without saving",
  async (value) => {
    await change(input("Threads"), value);
    await key(input("Threads"), "Enter");
    expect(host.textContent).toContain("Choose a whole number");
    expect(io.write).not.toHaveBeenCalled();
    await key(input("Threads"), "Escape");
    expect(input("Threads").value).toBe("3");
  },
);
it("keeps failed values separate, retries the same immutable edit and verifies one success", async () => {
  io.write.mockRejectedValueOnce(new Error("Invented disk failure"));
  await click("Faster");
  expect(host.textContent).toContain("Invented disk failure");
  expect(host.textContent).toContain("has not been applied");
  expect(values(atoms.get(enginesAtom)![0] as LocalEngine)).toEqual([3, 768]);
  await click("Retry save");
  expect(values(atoms.get(enginesAtom)![0] as LocalEngine)).toEqual([15, 2048]);
  expect(io.write).toHaveBeenCalledTimes(2);
});
it("restores previous exact field values after a failed save", async () => {
  io.write.mockRejectedValueOnce(new Error("Invented disk failure"));
  await change(input("Threads"), "9");
  await key(input("Threads"), "Enter");
  await click("Restore previous");
  expect(input("Threads").value).toBe("3");
  expect(host.textContent).toContain("Previous settings restored");
  expect(values(atoms.get(enginesAtom)![0] as LocalEngine)).toEqual([3, 768]);
  expect(io.write).toHaveBeenCalledTimes(1);
});
it("retains the original profile owner across a view switch during save", async () => {
  const before = atoms.get(enginesAtom)!;
  const other = { ...profile, id: "other-fixture", path: "C:/Fixture/other.exe" };
  await act(async () => {
    atoms.set(enginesAtom, [...before, other]);
  });
  await enginePreferences.flush();
  let finish!: () => void;
  io.write.mockReturnValueOnce(
    new Promise<void>((done) => {
      finish = done;
    }),
  );
  await click("Balanced");
  selected = other.id;
  await render();
  await act(async () => finish());
  const result = atoms.get(enginesAtom)! as LocalEngine[];
  expect(values(result[0])).toEqual([10, 1024]);
  expect(values(result[1])).toEqual([3, 768]);
  expect(input("Threads").value).toBe("3");
});
it("refuses to replace a newer engine edit while a save is finishing", async () => {
  let finish!: () => void;
  io.write.mockReturnValueOnce(
    new Promise<void>((done) => {
      finish = done;
    }),
  );
  await click("Balanced");
  await act(async () => {
    atoms.set(enginesAtom, [{ ...profile, name: "Owner replacement", settings: profile.settings }]);
  });
  await act(async () => finish());
  await enginePreferences.flush();
  expect((atoms.get(enginesAtom)![0] as LocalEngine).name).toBe("Owner replacement");
  expect(values(atoms.get(enginesAtom)![0] as LocalEngine)).toEqual([3, 768]);
  expect(JSON.parse(io.disk)[0].name).toBe("Owner replacement");
  expect(button("Dismiss")).toBeTruthy();
  expect(button("Retry save").disabled).toBe(true);
});
it("keeps saved choices through a failed device read and a successful retry", async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  io.device.mockRejectedValue(new Error("Invented unavailable metadata"));
  await render();
  expect(host.textContent).toContain("resources are unavailable");
  expect(input("Threads").value).toBe("3");
  expect(input("Hash memory (MiB)").value).toBe("768");
  expect(io.write).not.toHaveBeenCalled();
  io.device.mockResolvedValue({
    logicalThreads: 20,
    totalMemoryMb: 32768,
    availableMemoryMb: 24000,
  });
  await click("Retry resource check");
  expect(host.textContent).toContain("20 logical threads");
  expect(input("Threads").value).toBe("3");
  expect(io.write).not.toHaveBeenCalled();
});
it("disables presets under known memory pressure while preserving exact saved resources", async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  io.device.mockResolvedValue({ logicalThreads: 20, totalMemoryMb: 32768, availableMemoryMb: 0 });
  await render();
  expect(button("Quiet").disabled).toBe(true);
  expect(button("Balanced").disabled).toBe(true);
  expect(host.textContent).toContain("recommendation is unavailable");
  expect(input("Threads").value).toBe("3");
  expect(input("Hash memory (MiB)").value).toBe("768");
  expect(io.write).not.toHaveBeenCalled();
});
it("never infers first use from saved values that happen to match a preset", async () => {
  await act(async () =>
    atoms.set(enginesAtom, [
      {
        ...profile,
        settings: profile.settings!.map((s) =>
          s.name === "Threads"
            ? { ...s, value: 10 }
            : s.name === "Hash"
              ? { ...s, value: 1024 }
              : s,
        ),
      },
    ]),
  );
  await enginePreferences.flush();
  io.write.mockClear();
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  expect(button("Balanced").getAttribute("aria-pressed")).toBe("true");
  expect(io.write).not.toHaveBeenCalled();
});
it("keeps non-power-of-two hash in slider stops throughout a completed drag", async () => {
  const field = input("Hash memory (MiB) slider");
  const maximum = field.max;
  await pointer(field, "pointerdown");
  await change(field, "5");
  expect(field.max).toBe(maximum);
  expect(io.write).not.toHaveBeenCalled();
  await change(field, "6");
  expect(field.max).toBe(maximum);
  await pointer(field, "pointerup");
  expect(values(atoms.get(enginesAtom)![0] as LocalEngine)).toEqual([3, 768]);
  expect(io.write).not.toHaveBeenCalled();
});
it("opens adjacent help on focus/touch and dismisses it with Escape/outside tap", async () => {
  const help = host.querySelector<HTMLButtonElement>('button[aria-label="About CPU resources"]')!;
  await act(async () => help.focus());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
    "search limits and lines",
  );
  await key(help as unknown as HTMLInputElement, "Escape");
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await act(async () => help.click());
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(io.write).not.toHaveBeenCalled();
});
it("reflects a verified retry from the shared preference notice", async () => {
  io.write.mockRejectedValueOnce(new Error("Invented disk failure"));
  await click("Balanced");
  await act(async () =>
    root.render(
      <MantineProvider env="test">
        <Provider store={atoms}>
          <Probe />
          <EnginePreferencesNotice />
        </Provider>
      </MantineProvider>,
    ),
  );
  const retryButtons = Array.from(host.querySelectorAll("button")).filter(
    (button) => button.textContent === "Retry save",
  );
  expect(retryButtons).toHaveLength(2);
  await act(async () => retryButtons[1].click());
  expect(values(atoms.get(enginesAtom)![0] as LocalEngine)).toEqual([10, 1024]);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain("Resources saved.");
});

it("saves a completed profile line edit after readback, preserving its independent resources and go", async () => {
  let finish!: () => void;
  io.write.mockReturnValueOnce(
    new Promise<void>((done) => {
      finish = done;
    }),
  );
  await change(input("Lines"), "7");
  expect(io.write).not.toHaveBeenCalled();
  await key(input("Lines"), "Enter");
  expect(atoms.get(enginesAtom)![0].settings?.find((s) => s.name === "MultiPV")?.value).toBe(4);
  await act(async () => finish());
  const engine = atoms.get(enginesAtom)![0] as LocalEngine;
  expect(engine.settings?.find((s) => s.name === "MultiPV")?.value).toBe(7);
  expect(engine.go).toEqual(profile.go);
  expect(values(engine)).toEqual([3, 768]);
  expect(engine.enabled).toBe(false);
  expect(io.write).toHaveBeenCalledTimes(1);
});
it("retains an absent default go field when only lines are changed", async () => {
  await act(async () => atoms.set(enginesAtom, [{ ...profile, go: undefined }]));
  await enginePreferences.flush();
  io.write.mockClear();
  await change(input("Lines"), "6");
  await key(input("Lines"), "Enter");
  expect(atoms.get(enginesAtom)![0].go).toBeUndefined();
  expect(JSON.parse(io.disk)[0].go).toBeUndefined();
  expect(io.write).toHaveBeenCalledTimes(1);
});
it("keeps failed profile search values separate and retries the same original edit", async () => {
  io.write.mockRejectedValueOnce(new Error("Invented search write failure"));
  await change(input("Nodes per position"), "250007");
  await key(input("Nodes per position"), "Enter");
  expect(atoms.get(enginesAtom)![0].go).toEqual(profile.go);
  const retry = button("Retry search save");
  await act(async () => retry.click());
  expect(atoms.get(enginesAtom)![0].go).toEqual({ t: "Nodes", c: 250007 });
  expect(io.write).toHaveBeenCalledTimes(2);
});
it("finishes only the original profile when its search view is switched during saving", async () => {
  const other = { ...profile, id: "search-other", path: "C:/Fixture/search-other.exe" };
  await act(async () => atoms.set(enginesAtom, [...atoms.get(enginesAtom)!, other]));
  await enginePreferences.flush();
  io.write.mockClear();
  let finish!: () => void;
  io.write.mockReturnValueOnce(
    new Promise<void>((done) => {
      finish = done;
    }),
  );
  await change(input("Nodes per position"), "250007");
  await key(input("Nodes per position"), "Enter");
  selected = other.id;
  await render();
  await act(async () => finish());
  expect(atoms.get(enginesAtom)![0].go).toEqual({ t: "Nodes", c: 250007 });
  expect(atoms.get(enginesAtom)![1].go).toEqual(profile.go);
  expect(input("Nodes per position").value).toBe("170003");
  expect(io.write).toHaveBeenCalledTimes(1);
});
it("preserves player clock and increment payloads through a verified profile update and reload", async () => {
  const clocks = {
    t: "PlayersTime" as const,
    c: { white: 120003, black: 90005, winc: 2000, binc: 3000 },
  };
  await act(async () => atoms.set(enginesAtom, [{ ...profile, go: clocks }]));
  await enginePreferences.flush();
  io.write.mockClear();
  await change(input("Lines"), "7");
  await key(input("Lines"), "Enter");
  expect(atoms.get(enginesAtom)![0].go).toEqual(clocks);
  const loaded = await enginePreferences.reload();
  expect(loaded[0].go).toEqual(clocks);
  expect(loaded[0].settings?.find((s) => s.name === "MultiPV")?.value).toBe(7);
});

it("reflects a verified search retry from the shared notice without retaining a stale field error", async () => {
  io.write.mockRejectedValueOnce(new Error("Invented disk failure"));
  await change(input("Nodes per position"), "250007");
  await key(input("Nodes per position"), "Enter");
  await act(async () =>
    root.render(
      <MantineProvider env="test">
        <Provider store={atoms}>
          <Probe />
          <EnginePreferencesNotice />
        </Provider>
      </MantineProvider>,
    ),
  );
  await click("Retry save");
  expect(atoms.get(enginesAtom)![0].go).toEqual({ t: "Nodes", c: 250007 });
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain("Search settings saved.");
});
