import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getEvaluationSourceEpoch } from "@/utils/evaluationSource";
import { useEvaluationSourceSelection } from "./useEvaluationSourceSelection";
const io = vi.hoisted(() => ({
  get: vi.fn(),
  listen: vi.fn(),
  stop: vi.fn(),
  event: null as null | ((event: any) => void),
}));
vi.mock("@/bindings", () => ({ commands: { getLocalEvalSourceSelection: io.get } }));
vi.mock("@tauri-apps/api/event", () => ({ listen: io.listen }));
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
function Probe({ enabled }: { enabled: boolean }) {
  useEvaluationSourceSelection(enabled);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  io.get
    .mockReset()
    .mockResolvedValue({ status: "ok", data: { path: "fixture", revision: "before" } });
  io.stop.mockReset();
  io.listen.mockReset().mockImplementation(async (_: string, callback: any) => {
    io.event = callback;
    return io.stop;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("waits for startup and removes its native event subscription", async () => {
  await act(async () => root.render(<Probe enabled={false} />));
  expect(io.get).not.toHaveBeenCalled();
  await act(async () => root.render(<Probe enabled />));
  expect(io.get).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<Probe enabled={false} />));
  expect(io.stop).toHaveBeenCalledTimes(1);
});
it("lets a source event supersede an older pending focus read", async () => {
  let resolve!: (value: unknown) => void;
  io.get.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await act(async () => root.render(<Probe enabled />));
  const before = getEvaluationSourceEpoch();
  await act(async () =>
    io.event!({ payload: { selection: { path: "new", revision: "event-new" } } }),
  );
  const current = getEvaluationSourceEpoch();
  expect(current).toBeGreaterThan(before);
  await act(async () => resolve({ status: "ok", data: { path: "old", revision: "stale" } }));
  expect(getEvaluationSourceEpoch()).toBe(current);
});
it("invalidates stale data on a failed settings read and recovers on focus", async () => {
  io.get.mockResolvedValueOnce({ status: "error", error: "Invented settings failure" });
  await act(async () => root.render(<Probe enabled />));
  const failed = getEvaluationSourceEpoch();
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(getEvaluationSourceEpoch()).toBeGreaterThan(failed);
});
it("keeps focus checks working if event subscription is unavailable", async () => {
  io.listen.mockRejectedValueOnce(new Error("Invented unavailable event bridge"));
  await act(async () => root.render(<Probe enabled />));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(io.get).toHaveBeenCalledTimes(2);
});
