import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installPanelScrolling } from "../panelScrolling";

let dispose: () => void, frames: Map<number, FrameRequestCallback>, now: number;
let changed: (() => void) | undefined;
let reduced: boolean;
beforeEach(() => {
  frames = new Map();
  now = 0;
  reduced = false;
  changed = undefined;
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_type: string, callback: () => void) => {
      changed = callback;
    },
    removeEventListener: vi.fn(),
  }));
  dispose = installPanelScrolling();
});
afterEach(() => {
  dispose();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function surface(tag = "div") {
  const panel = document.createElement(tag);
  panel.style.overflowY = "auto";
  Object.defineProperties(panel, {
    scrollHeight: { value: 1200 },
    clientHeight: { value: 300 },
    scrollTo: {
      value: ({ top }: { top: number }) => {
        panel.scrollTop = top;
      },
    },
  });
  document.body.append(panel);
  return panel;
}
function wheel(target: Element, deltaY = 120) {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: Number.isFinite(deltaY) ? deltaY : 0,
  });
  if (!Number.isFinite(deltaY)) Object.defineProperty(event, "deltaY", { value: deltaY });
  target.dispatchEvent(event);
  return event;
}
function finish() {
  for (let index = 0; index < 400 && frames.size; index++) {
    now += 16;
    const batch = [...frames.values()];
    frames.clear();
    batch.forEach((callback) => callback(now));
  }
  expect(frames.size).toBe(0);
}

it("recognizes real board/editor/control selectors and leaves their own wheel handlers authoritative", () => {
  const panel = surface();
  for (const html of [
    "<div data-board-area><span></span></div>",
    '<div class="cg-wrap"><piece></piece></div>',
    "<cg-board><piece></piece></cg-board>",
    '<input type="number">',
    "<select><option>x</option></select>",
    '<div contenteditable="true"><span></span></div>',
    "<div contenteditable><span></span></div>",
    '<div contenteditable="plaintext-only"><span></span></div>',
  ]) {
    panel.innerHTML = html;
    const target = panel.firstElementChild!;
    const ownWheel = vi.fn();
    target.addEventListener("wheel", ownWheel);
    expect(wheel(target).defaultPrevented).toBe(false);
    expect(ownWheel).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(panel.scrollTop).toBe(0);
  }
});
it("walks from an actual SVG path to its scroll surface, including contenteditable=false widgets", () => {
  const panel = surface();
  panel.innerHTML = '<div contenteditable="false"><svg><path></path></svg></div>';
  expect(wheel(panel.querySelector("path")!).defaultPrevented).toBe(true);
  finish();
  expect(panel.scrollTop).toBe(120);
});
it("smooths a scrollable textarea without changing its text/selection or scrolling the parent", () => {
  const panel = surface(),
    textarea = surface("textarea") as HTMLTextAreaElement;
  panel.append(textarea);
  textarea.value = "Synthetic PGN notes";
  textarea.setSelectionRange(4, 9);
  expect(wheel(textarea).defaultPrevented).toBe(true);
  finish();
  expect(textarea.scrollTop).toBe(120);
  expect(panel.scrollTop).toBe(0);
  expect(textarea.value).toBe("Synthetic PGN notes");
  expect(textarea.selectionStart).toBe(4);
  expect(textarea.selectionEnd).toBe(9);
});
it("leaves finger scrolling native and cancels queued motion when reduced motion changes", () => {
  const panel = surface();
  const touch = new Event("touchmove", { bubbles: true, cancelable: true });
  panel.dispatchEvent(touch);
  expect(touch.defaultPrevented).toBe(false);
  expect(frames.size).toBe(0);
  wheel(panel);
  expect(frames.size).toBe(1);
  reduced = true;
  changed?.();
  expect(frames.size).toBe(0);
  expect(wheel(panel).defaultPrevented).toBe(false);
});
it("ignores malformed synthetic deltas instead of scheduling invalid positions", () => {
  const panel = surface();
  for (const deltaY of [Infinity, -Infinity, NaN])
    expect(wheel(panel, deltaY).defaultPrevented).toBe(false);
  expect(frames.size).toBe(0);
  expect(panel.scrollTop).toBe(0);
});
it("falls back to native scrolling when animation or media-query support is absent", () => {
  dispose();
  vi.stubGlobal("matchMedia", undefined);
  dispose = installPanelScrolling();
  const panel = surface();
  expect(wheel(panel).defaultPrevented).toBe(false);
  expect(frames.size).toBe(0);
});
