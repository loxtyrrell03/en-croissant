import { MantineProvider } from "@mantine/core";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GoMode } from "@/bindings";
import { AnalysisSearchControls } from "./AnalysisSearchControls";

let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
let initial: GoMode, current: GoMode, currentLines: number;
const save = vi.fn(),
  restore = vi.fn(),
  prepared = vi.fn();
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value() {} });
afterAll(async () => {
  await new Promise((done) => setTimeout(done, 0));
  if (scrollDescriptor)
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});
function Probe() {
  const [go, setGo] = useState(initial),
    [lines, setLines] = useState(4);
  current = go;
  currentLines = lines;
  return (
    <AnalysisSearchControls
      go={go}
      lines={lines}
      scope="Invented tab only"
      successLabel="Tab search updated."
      prepare={(patch) => {
        prepared(patch);
        return {
          owns: () => true,
          async save() {
            await save(patch);
            if (patch.go) setGo(patch.go);
            if (patch.lines !== undefined) setLines(patch.lines);
          },
          restore,
        };
      }}
    />
  );
}
const render = () =>
  act(async () =>
    root.render(
      <MantineProvider env="test">
        <Probe />
      </MantineProvider>,
    ),
  );
const field = (label: string) =>
  host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const button = (label: string) =>
  Array.from(host.querySelectorAll("button")).find((button) => button.textContent === label)!;
const change = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
const key = (input: HTMLElement, value: string, type = "keydown") =>
  act(async () => input.dispatchEvent(new KeyboardEvent(type, { key: value, bubbles: true })));
const pointer = (input: HTMLInputElement, type: string) =>
  act(async () => input.dispatchEvent(new Event(type, { bubbles: true })));
const exact = async (label: string, value: string) => {
  await change(field(label), value);
  await key(field(label), "Enter");
};
async function select(label: string, text: string) {
  await act(async () => field(label).click());
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (option) => option.textContent === text,
  )!;
  await act(async () => option.click());
}
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
  initial = { t: "Nodes", c: 170003 };
  save.mockReset().mockResolvedValue(undefined);
  restore.mockReset().mockResolvedValue(undefined);
  prepared.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps incomplete and canceled pointer, keyboard and exact drafts out of settings", async () => {
  await render();
  await change(field("Lines"), "7");
  expect(save).not.toHaveBeenCalled();
  await key(field("Lines"), "Escape");
  await key(field("Lines"), "Enter");
  const slider = field("Lines slider");
  await pointer(slider, "pointerdown");
  await change(slider, "6");
  await pointer(slider, "pointercancel");
  await pointer(slider, "pointerup");
  expect(save).not.toHaveBeenCalled();
  expect(currentLines).toBe(4);
});
it("commits a drag once and a completed keyboard edit once", async () => {
  await render();
  const slider = field("Lines slider");
  await pointer(slider, "pointerdown");
  await change(slider, "7");
  expect(save).not.toHaveBeenCalled();
  await pointer(slider, "pointerup");
  expect(save).toHaveBeenCalledTimes(1);
  expect(currentLines).toBe(7);
  const next = field("Lines slider");
  await key(next, "ArrowLeft");
  await change(next, "6");
  expect(save).toHaveBeenCalledTimes(1);
  await key(next, "ArrowLeft", "keyup");
  expect(save).toHaveBeenCalledTimes(2);
  expect(currentLines).toBe(6);
});
it("serializes fractional seconds and every existing display unit as exact milliseconds", async () => {
  initial = { t: "Time", c: 250 };
  await render();
  expect(field("Time per position").value).toBe("0.25");
  await exact("Time per position", "1.249");
  expect(current).toEqual({ t: "Time", c: 1249 });
  await select("Time unit", "Minutes");
  expect(save).toHaveBeenCalledTimes(1);
  await exact("Time per position", "0.5");
  expect(current).toEqual({ t: "Time", c: 30000 });
  await select("Time unit", "Hours");
  await exact("Time per position", "0.25");
  expect(current).toEqual({ t: "Time", c: 900000 });
  await select("Time unit", "Milliseconds");
  await exact("Time per position", "75");
  expect(current).toEqual({ t: "Time", c: 75 });
  expect(save).toHaveBeenCalledTimes(4);
});
it("remembers committed limits across modes without remembering a draft", async () => {
  initial = { t: "Depth", c: 37 };
  await render();
  await change(field("Depth"), "58");
  await key(field("Depth"), "Escape");
  await select("Stop analysis", "Until stopped");
  await select("Stop analysis", "At a depth");
  expect(current).toEqual({ t: "Depth", c: 37 });
  await select("Stop analysis", "After a time");
  await exact("Time per position", "1.234");
  await select("Stop analysis", "After a node count");
  await exact("Nodes per position", "179003");
  await select("Stop analysis", "After a time");
  expect(current).toEqual({ t: "Time", c: 1234 });
  await select("Stop analysis", "After a node count");
  expect(current).toEqual({ t: "Nodes", c: 179003 });
});
it("rejects a node count beyond the native u32 wire limit, including noninteger text", async () => {
  await render();
  await exact("Nodes per position", "4294967296");
  await exact("Nodes per position", "2.5");
  expect(save).not.toHaveBeenCalled();
  expect(current).toEqual(initial);
  await exact("Nodes per position", "4294967295");
  expect(current).toEqual({ t: "Nodes", c: 4294967295 });
  expect(save).toHaveBeenCalledTimes(1);
});
it("preserves an older high depth and validates a new edit against the current range", async () => {
  initial = { t: "Depth", c: 80 };
  await render();
  expect(field("Depth").value).toBe("80");
  expect(host.textContent).toContain("Saved value 80");
  await exact("Depth", "61");
  expect(save).not.toHaveBeenCalled();
  await exact("Depth", "36");
  expect(current).toEqual({ t: "Depth", c: 36 });
});
it("accepts 50ms and one hour but rejects shorter, longer or submillisecond new limits", async () => {
  initial = { t: "Time", c: 250 };
  await render();
  for (const value of ["0.049", "3600.001", "0.0505"]) await exact("Time per position", value);
  expect(save).not.toHaveBeenCalled();
  await exact("Time per position", "0.05");
  expect(current).toEqual({ t: "Time", c: 50 });
  await exact("Time per position", "3600");
  expect(current).toEqual({ t: "Time", c: 3600000 });
});
it("preserves both player clocks and increments when returning to their saved mode", async () => {
  initial = { t: "PlayersTime", c: { white: 120003, black: 90005, winc: 2000, binc: 3000 } };
  await render();
  expect(host.textContent).toContain("both players' remaining clocks");
  expect(save).not.toHaveBeenCalled();
  await select("Stop analysis", "Until stopped");
  await select("Stop analysis", "Player clocks");
  expect(current).toEqual(initial);
});
it("keeps a failed save out of committed mode memory and retries the same prepared change", async () => {
  save.mockRejectedValueOnce(new Error("Invented unavailable disk"));
  await render();
  await select("Stop analysis", "At a depth");
  expect(current).toEqual(initial);
  expect(host.textContent).toContain("Invented unavailable disk");
  expect(field("Stop analysis").disabled).toBe(true);
  await act(async () => button("Retry search save").click());
  expect(current).toEqual({ t: "Depth", c: 24 });
  expect(prepared).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledTimes(2);
});
it("restores a failed-save draft without submitting another change", async () => {
  save.mockRejectedValueOnce(new Error("Invented unavailable disk"));
  await render();
  await exact("Lines", "7");
  await act(async () => button("Restore previous search save").click());
  expect(currentLines).toBe(4);
  expect(field("Lines").value).toBe("4");
  expect(restore).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledTimes(1);
});
it("associates a field error and opens adjacent focus/touch help without applying settings", async () => {
  await render();
  await exact("Lines", "9");
  expect(field("Lines").getAttribute("aria-invalid")).toBe("true");
  const id = field("Lines").getAttribute("aria-describedby")!;
  expect(document.getElementById(id)?.textContent).toContain("from 1 to 8");
  const help = host.querySelector<HTMLButtonElement>('button[aria-label="About lines"]')!;
  await act(async () => help.focus());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("candidate moves");
  await key(help, "Escape");
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await act(async () => help.click());
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(save).not.toHaveBeenCalled();
});
it("discards a same-value field draft when its editor owner is replaced", async () => {
  await render();
  await change(field("Lines"), "7");
  await act(async () =>
    root.render(
      <MantineProvider env="test">
        <Probe key="replacement" />
      </MantineProvider>,
    ),
  );
  expect(field("Lines").value).toBe("4");
  await key(field("Lines"), "Enter");
  expect(save).not.toHaveBeenCalled();
});
