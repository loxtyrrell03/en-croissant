import { MantineProvider } from "@mantine/core";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CpuResourceControls } from "./CpuResourceControls";
import type { EngineDevice, EngineResourceValues } from "@/utils/engineResources";
const machine: EngineDevice = {
  logicalThreads: 20,
  totalMemoryMb: 32768,
  availableMemoryMb: 24000,
};
let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
const save = vi.fn();
function Probe({
  device,
  count,
  initial,
}: {
  device: EngineDevice;
  count: number;
  initial: EngineResourceValues;
}) {
  const [values, setValues] = useState(initial);
  return (
    <CpuResourceControls
      values={values}
      device={device}
      checking={false}
      deviceError={null}
      retryDevice={() => {}}
      bounds={{ threads: { min: 1, max: 64 }, hashMb: { min: 16, max: 8192 } }}
      includedEngines={count}
      scope="Invented engine defaults"
      prepare={(next) => ({
        save: async () => {
          save(next);
          setValues(next);
        },
        restore: async () => {},
      })}
    />
  );
}
function render(device = machine, count = 1, initial = { threads: 16, hashMb: 4096 }) {
  return act(async () =>
    root.render(
      <MantineProvider env="test">
        <Probe device={device} count={count} initial={initial} />
      </MantineProvider>,
    ),
  );
}
const field = (label: string) =>
  host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const change = (label: string, value: string) =>
  act(async () => {
    const input = field(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
const key = (label: string, key: string, type = "keydown") =>
  act(async () => field(label).dispatchEvent(new KeyboardEvent(type, { key, bubbles: true })));
const pointer = (label: string, type: string) =>
  act(async () => field(label).dispatchEvent(new Event(type, { bubbles: true })));
beforeEach(() => {
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
  save.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("retains old values above today's budget but restricts new exact edits", async () => {
  await render(machine, 3);
  expect(field("Threads").value).toBe("16");
  expect(field("Hash memory (MiB)").value).toBe("4096");
  expect(field("Threads slider").max).toBe("6");
  expect(field("Threads").getAttribute("aria-invalid")).toBe("true");
  expect(host.textContent).toContain("Saved value 16 threads is outside");
  expect(save).not.toHaveBeenCalled();
  const message = field("Threads").getAttribute("aria-describedby");
  expect(message && document.getElementById(message)?.textContent).toContain(
    "Saved value 16 threads",
  );
  await change("Threads", "7");
  await key("Threads", "Enter");
  expect(host.textContent).toContain("Choose a whole number from 1 to 6");
  expect(save).not.toHaveBeenCalled();
  await key("Threads", "Escape");
  expect(field("Threads").value).toBe("16");
  await change("Hash memory (MiB)", "3000");
  await key("Hash memory (MiB)", "Enter");
  expect(save).not.toHaveBeenCalled();
});
it("changes one field without silently reducing another older out-of-range choice", async () => {
  await render(machine, 3);
  await change("Threads", "5");
  await key("Threads", "Enter");
  expect(save).toHaveBeenCalledExactlyOnceWith({ threads: 5, hashMb: 4096 });
  expect(field("Hash memory (MiB)").value).toBe("4096");
});
it("cancels an old slider gesture when a new included-engine budget narrows its range", async () => {
  await render();
  await pointer("Threads slider", "pointerdown");
  await change("Threads slider", "12");
  await render(machine, 3);
  await pointer("Threads slider", "pointerup");
  expect(save).not.toHaveBeenCalled();
  expect(field("Threads").value).toBe("16");
  expect(field("Threads slider").max).toBe("6");
});
it("preserves a typed draft through a budget read, then validates its completed value", async () => {
  await render();
  await change("Threads", "5");
  await render(machine, 3);
  expect(field("Threads").value).toBe("5");
  expect(save).not.toHaveBeenCalled();
  await key("Threads", "Enter");
  expect(save).toHaveBeenCalledExactlyOnceWith({ threads: 5, hashMb: 4096 });
});
it("allows an explicit keyboard end selection to replace an old out-of-range value once", async () => {
  await render(machine, 3);
  await key("Threads slider", "End");
  await key("Threads slider", "End", "keyup");
  expect(save).toHaveBeenCalledExactlyOnceWith({ threads: 6, hashMb: 4096 });
});
it("keeps known memory pressure distinct from zero saved memory without applying a preset", async () => {
  await render({ ...machine, availableMemoryMb: 0 });
  const presets = Array.from(host.querySelectorAll("button")).filter((button) =>
    ["Quiet", "Balanced", "Faster"].includes(button.textContent ?? ""),
  );
  expect(presets).toHaveLength(3);
  expect(presets.every((button) => button.disabled)).toBe(true);
  expect(field("Hash memory (MiB)").value).toBe("4096");
  expect(save).not.toHaveBeenCalled();
});
