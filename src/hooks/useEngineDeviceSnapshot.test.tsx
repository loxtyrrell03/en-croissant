import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEngineDeviceSnapshot } from "./useEngineDeviceSnapshot";
const io = vi.hoisted(() => ({ device: vi.fn() }));
vi.mock("@/bindings", () => ({ commands: { engineDeviceInfo: io.device } }));
let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
function Probe() {
  const state = useEngineDeviceSnapshot();
  return (
    <>
      <pre>{JSON.stringify(state)}</pre>
      <button onClick={state.retryDevice}>Retry</button>
    </>
  );
}
const snapshot = () => JSON.parse(host.querySelector("pre")!.textContent!);
const device = { logicalThreads: 20, totalMemoryMb: 32768, availableMemoryMb: 24000 };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  io.device.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("bounds a stalled snapshot and ignores its late reply after retry", async () => {
  let finish!: (value: unknown) => void;
  io.device
    .mockReturnValueOnce(
      new Promise((done) => {
        finish = done;
      }),
    )
    .mockResolvedValueOnce(device);
  await act(async () => root.render(<Probe />));
  expect(snapshot().checking).toBe(true);
  await act(async () => vi.advanceTimersByTime(5000));
  expect(snapshot().checking).toBe(false);
  expect(snapshot().device).toBeNull();
  await act(async () => host.querySelector("button")!.click());
  expect(snapshot().device).toEqual(device);
  await act(async () => finish({ ...device, logicalThreads: 1 }));
  expect(snapshot().device).toEqual(device);
});
it("retains known zero memory without a fallback zero for missing installed memory", async () => {
  io.device.mockResolvedValueOnce({ ...device, availableMemoryMb: 0 });
  await act(async () => root.render(<Probe />));
  expect(snapshot().device.availableMemoryMb).toBe(0);
  io.device.mockResolvedValueOnce({ logicalThreads: 4 });
  await act(async () => host.querySelector("button")!.click());
  expect(snapshot().device).toEqual({
    logicalThreads: 4,
    totalMemoryMb: null,
    availableMemoryMb: null,
  });
});
it("reports a malformed snapshot as unavailable and safely ignores unmounted completion", async () => {
  io.device.mockResolvedValueOnce({ logicalThreads: 0 });
  await act(async () => root.render(<Probe />));
  expect(snapshot().error).toContain("unavailable");
  let finish!: (value: unknown) => void;
  io.device.mockReturnValueOnce(
    new Promise((done) => {
      finish = done;
    }),
  );
  await act(async () => host.querySelector("button")!.click());
  await act(async () => root.render(null));
  await act(async () => finish(device));
  expect(host.textContent).toBe("");
  expect(vi.getTimerCount()).toBe(0);
});
