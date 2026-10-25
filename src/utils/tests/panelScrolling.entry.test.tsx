import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const boot = vi.hoisted(() => ({
  roots: [] as { unmount(): void }[],
  native: vi.fn(() => "native root"),
  phone: vi.fn(() => "phone root"),
}));
vi.mock("react-dom/client", async (original) => {
  const actual = await original<typeof import("react-dom/client")>();
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args);
      boot.roots.push(root);
      return root;
    },
  };
});
vi.mock("@/App", () => ({ default: boot.native }));
vi.mock("@/web/WebApp", () => ({ default: boot.phone }));
vi.mock("i18next", () => ({
  default: {
    use() {
      return this;
    },
    init() {
      return Promise.resolve();
    },
  },
}));

let frames: Map<number, FrameRequestCallback>, now: number;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  boot.native.mockClear();
  boot.phone.mockClear();
  now = 0;
  frames = new Map();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(async () => {
  await act(async () => {
    for (const root of boot.roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["native", "phone"] as const)(
  "the actual entry installs and releases bounded panel scrolling for the %s root",
  async (runtime) => {
    vi.stubGlobal("__TAURI_INTERNALS__", runtime === "native" ? {} : undefined);
    await act(async () => {
      await import("@/index");
    });
    await vi.waitFor(() => expect(boot[runtime]).toHaveBeenCalled());
    const panel = document.createElement("div");
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
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 });
    panel.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(frames.size).toBe(1);
    expect(panel.scrollTop).toBe(0);
    now = 16;
    const batch = [...frames.values()];
    frames.clear();
    batch.forEach((callback) => callback(now));
    expect(panel.scrollTop).toBeGreaterThan(0);
    expect(panel.scrollTop).toBeLessThan(3);
    await act(async () => {
      boot.roots.splice(0).forEach((root) => root.unmount());
    });
    expect(frames.size).toBe(0);
    const nativeEvent = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 });
    panel.dispatchEvent(nativeEvent);
    expect(nativeEvent.defaultPrevented).toBe(false);
  },
);
