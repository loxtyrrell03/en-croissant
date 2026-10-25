import { afterEach, describe, expect, it, vi } from "vitest";
import { installPanelScrolling } from "../panelScrolling";

class ElementNode {
  parentElement: Panel | null = null;
  excluded = false;
  closest() {
    return this.excluded ? this : null;
  }
}
class Panel extends ElementNode {
  scrollTop = 0;
  scrollHeight = 1200;
  clientHeight = 300;
  isConnected = true;
  style = { overflowY: "auto", lineHeight: "20px", overscrollBehaviorY: "auto" };
  scrollTo({ top }: { top: number }) {
    this.scrollTop = top;
  }
}
function fixture() {
  vi.stubGlobal("Element", ElementNode);
  vi.stubGlobal("HTMLElement", Panel);
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const frames = new Map<number, FrameRequestCallback>();
  let now = 0,
    id = 0;
  const motion = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const root = new Panel();
  root.style.overflowY = "visible";
  const doc = {
    scrollingElement: root,
    defaultView: {
      matchMedia: () => motion,
      performance: { now: () => now },
      getComputedStyle: (panel: Panel) => panel.style,
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        frames.set(++id, callback);
        return id;
      },
      cancelAnimationFrame: (key: number) => frames.delete(key),
    },
    addEventListener: (type: string, handler: (...args: unknown[]) => void) =>
      listeners.set(type, handler),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", doc.defaultView);
  for (const [name, value] of Object.entries(doc.defaultView)) vi.stubGlobal(name, value);
  const dispose = installPanelScrolling();
  const panel = new Panel();
  const tick = (elapsed = 16) => {
    now += elapsed;
    const batch = [...frames.values()];
    frames.clear();
    batch.forEach((callback) => callback(now));
  };
  const finish = () => {
    for (let i = 0; i < 400 && frames.size; i++) tick();
    expect(frames.size).toBe(0);
  };
  const wheel = (extra = {}, target: ElementNode = panel) => {
    const event = {
      target,
      deltaY: 120,
      deltaX: 0,
      deltaMode: 0,
      cancelable: true,
      defaultPrevented: false,
      preventDefault: vi.fn(),
      ...extra,
    };
    listeners.get("wheel")!(event);
    return event;
  };
  return { panel, root, motion, listeners, frames, dispose, tick, finish, wheel };
}
afterEach(() => vi.unstubAllGlobals());
describe("panel wheel scrolling", () => {
  it("animates wheel steps continuously and preserves repeated-wheel distance", () => {
    const f = fixture();
    expect(f.wheel().preventDefault).toHaveBeenCalledOnce();
    expect(f.panel.scrollTop).toBe(0);
    f.tick();
    expect(f.panel.scrollTop).toBeGreaterThan(0);
    expect(f.panel.scrollTop).toBeLessThan(120);
    f.wheel();
    f.finish();
    expect(f.panel.scrollTop).toBe(240);
  });
  it("starts gently and bounds every painted step, including accelerated input and stalled frames", () => {
    const f = fixture();
    f.panel.scrollHeight = 10000;
    f.wheel();
    f.tick();
    expect(f.panel.scrollTop).toBeGreaterThan(0);
    expect(f.panel.scrollTop).toBeLessThan(3);
    f.wheel({ deltaY: 600 });
    for (let i = 0; i < 200 && f.frames.size; i++) {
      const before = f.panel.scrollTop;
      f.tick(i === 2 ? 200 : 16);
      expect(f.panel.scrollTop - before).toBeGreaterThan(0);
      expect(f.panel.scrollTop - before).toBeLessThanOrEqual(8);
    }
    f.finish();
    expect(f.panel.scrollTop).toBe(720);
  });
  it("carries motion through repeated notches without restarting the easing", () => {
    const f = fixture();
    f.wheel();
    f.tick();
    f.tick();
    const before = f.panel.scrollTop;
    f.wheel();
    f.tick();
    const step = f.panel.scrollTop - before;
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThan(8);
    f.finish();
    expect(f.panel.scrollTop).toBe(240);
  });
  it("smooths smaller pixel wheel steps instead of treating them as a trackpad", () => {
    const f = fixture();
    expect(f.wheel({ deltaY: 33 }).preventDefault).toHaveBeenCalledOnce();
    f.tick();
    expect(f.panel.scrollTop).toBeGreaterThan(0);
    expect(f.panel.scrollTop).toBeLessThan(33);
    f.wheel({ deltaY: 33 });
    f.finish();
    expect(f.panel.scrollTop).toBe(66);
  });
  it("finds the panel when the pointer is over an SVG icon", () => {
    const f = fixture(),
      icon = new ElementNode();
    icon.parentElement = f.panel;
    expect(f.wheel({}, icon).preventDefault).toHaveBeenCalledOnce();
    f.finish();
    expect(f.panel.scrollTop).toBe(120);
  });
  it("smooths the document viewport even with visible overflow", () => {
    const f = fixture();
    f.panel.style.overflowY = "visible";
    f.panel.parentElement = f.root;
    expect(f.wheel().preventDefault).toHaveBeenCalledOnce();
    f.finish();
    expect(f.root.scrollTop).toBe(120);
  });
  it("reverses immediately", () => {
    const f = fixture();
    f.panel.scrollTop = 300;
    f.wheel();
    f.tick();
    const before = f.panel.scrollTop;
    f.wheel({ deltaY: -120 });
    f.tick();
    expect(f.panel.scrollTop).toBeLessThan(before);
  });
  it("normalizes line and page units", () => {
    const f = fixture();
    f.wheel({ deltaMode: 1, deltaY: 3 });
    f.finish();
    expect(f.panel.scrollTop).toBe(60);
    f.wheel({ deltaMode: 2, deltaY: 1 });
    f.finish();
    expect(f.panel.scrollTop).toBe(360);
  });
  it("chains at a nested boundary but respects contained panels", () => {
    const f = fixture(),
      outer = new Panel();
    f.panel.parentElement = outer;
    f.panel.scrollTop = 900;
    f.wheel();
    f.tick();
    expect(outer.scrollTop).toBeGreaterThan(0);
    f.dispose();
    const g = fixture();
    g.panel.parentElement = outer;
    g.panel.scrollTop = 900;
    g.panel.style.overscrollBehaviorY = "contain";
    expect(g.wheel().preventDefault).not.toHaveBeenCalled();
  });
  it("preserves zoom, horizontal and already-handled events", () => {
    const f = fixture();
    for (const extra of [
      { ctrlKey: true },
      { shiftKey: true },
      { deltaX: 200 },
      { defaultPrevented: true },
      { cancelable: false },
    ]) {
      expect(f.wheel(extra).preventDefault).not.toHaveBeenCalled();
    }
    expect(f.frames.size).toBe(0);
  });
  it("smooths tiny deltas without cancelling queued wheel distance", () => {
    const f = fixture();
    f.wheel();
    f.tick();
    expect(f.wheel({ deltaY: 0.5 }).preventDefault).toHaveBeenCalledOnce();
    expect(f.wheel({ deltaY: 4 }).preventDefault).toHaveBeenCalledOnce();
    f.finish();
    expect(f.panel.scrollTop).toBe(124.5);
  });
  it("retains subpixel movement even when the browser rounds scroll positions", () => {
    const f = fixture();
    f.panel.scrollTo = ({ top }) => {
      f.panel.scrollTop = Math.round(top);
    };
    f.wheel({ deltaY: 5 });
    f.finish();
    expect(f.panel.scrollTop).toBe(5);
  });
  it("uses smaller steps on faster displays and reaches the same destination", () => {
    const f = fixture();
    f.wheel();
    for (let i = 0; i < 200 && f.frames.size; i++) {
      const before = f.panel.scrollTop;
      f.tick(8);
      expect(f.panel.scrollTop - before).toBeGreaterThan(0);
      expect(f.panel.scrollTop - before).toBeLessThan(4.1);
    }
    expect(f.frames.size).toBe(0);
    expect(f.panel.scrollTop).toBe(120);
  });
  it("respects reduced motion and board/editable exclusions", () => {
    const f = fixture();
    f.motion.matches = true;
    expect(f.wheel().preventDefault).not.toHaveBeenCalled();
    f.motion.matches = false;
    f.panel.excluded = true;
    expect(f.wheel().preventDefault).not.toHaveBeenCalled();
  });
  it("yields to keyboard, pointer and external scroll changes", () => {
    const f = fixture();
    f.wheel();
    f.listeners.get("keydown")!();
    expect(f.frames.size).toBe(0);
    f.wheel();
    f.listeners.get("pointerdown")!();
    expect(f.frames.size).toBe(0);
    f.wheel();
    f.panel.scrollTop = 500;
    f.tick();
    expect(f.panel.scrollTop).toBe(500);
    expect(f.frames.size).toBe(0);
  });
  it("starts from an external scroll change even when another wheel event precedes the next paint", () => {
    const f = fixture();
    f.wheel();
    f.tick();
    f.panel.scrollTop = 400;
    f.wheel();
    f.finish();
    expect(f.panel.scrollTop).toBe(520);
  });
  it("cleans up on disposal and detached panels", () => {
    const f = fixture();
    f.wheel();
    f.panel.isConnected = false;
    f.tick();
    expect(f.frames.size).toBe(0);
    f.dispose();
    expect(f.listeners.size).toBe(0);
  });
});
