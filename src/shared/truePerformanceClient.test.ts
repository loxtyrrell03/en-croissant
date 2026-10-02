import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERFORMANCE_WORKER_TIMEOUT_MS, requestPerformanceCalculation } from "./truePerformanceClient";
import { PERFORMANCE_CALCULATION_ERROR, type PerformanceWorkerRequest } from "./truePerformanceProtocol";

class FakeWorker {
  static instances: FakeWorker[] = [];
  listeners = new Map<string, EventListener>();
  sent: PerformanceWorkerRequest | null = null;
  terminate = vi.fn();
  constructor(readonly url: URL, readonly options: WorkerOptions) { FakeWorker.instances.push(this); }
  addEventListener(type: string, listener: EventListener) { this.listeners.set(type, listener); }
  postMessage(request: PerformanceWorkerRequest) { this.sent = request; }
  reply(result: unknown, overrides: object = {}) {
    this.listeners.get("message")?.({ data: { id: this.sent!.id, kind: this.sent!.kind, result, ...overrides } } as MessageEvent);
  }
  fail(type: "error" | "messageerror") {
    const event = { type, message: "Synthetic worker failure", preventDefault: vi.fn() };
    this.listeners.get(type)?.(event as unknown as Event);
    return event;
  }
}
const request = { kind: "period" as const, games: [], asOf: 1_800_000_000, gameType: "rated" as const };

beforeEach(() => {
  FakeWorker.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("background performance calculations", () => {
  it("starts independent jobs and preserves a valid period when history fails", async () => {
    const period = requestPerformanceCalculation(request);
    const history = requestPerformanceCalculation({ ...request, kind: "history" });
    const [first, second] = FakeWorker.instances;
    expect(first.options).toEqual({ type: "module" });
    expect(first.url.pathname).toContain("truePerformance.worker.ts");
    expect(first.sent).toMatchObject(request);
    second.reply({ status: "error", error: PERFORMANCE_CALCULATION_ERROR, diagnostic: "Synthetic support limit" });
    await expect(history.result).resolves.toMatchObject({ status: "error" });
    expect(first.terminate).not.toHaveBeenCalled();
    first.reply({ status: "ready", value: [] });
    await expect(period.result).resolves.toEqual({ status: "ready", value: [] });
    expect(first.terminate).toHaveBeenCalledTimes(1);
    expect(second.terminate).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledExactlyOnceWith("Performance estimate could not be calculated (history)", "Synthetic support limit");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("terminates cancellation immediately and ignores late completion", async () => {
    const job = requestPerformanceCalculation(request);
    const worker = FakeWorker.instances[0];
    job.cancel(); job.cancel();
    worker.reply({ status: "ready", value: [] });
    await expect(job.result).resolves.toEqual({ status: "cancelled" });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("ignores replies for another request or calculation", async () => {
    const job = requestPerformanceCalculation(request);
    const worker = FakeWorker.instances[0];
    worker.reply({ status: "ready", value: [] }, { id: -1 });
    worker.reply({ status: "ready", value: [] }, { kind: "history" });
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.reply({ status: "ready", value: [] });
    await expect(job.result).resolves.toEqual({ status: "ready", value: [] });
  });

  it.each(["error", "messageerror"] as const)("cleans up %s and allows a new retry", async type => {
    const job = requestPerformanceCalculation(request);
    const worker = FakeWorker.instances[0];
    expect(worker.fail(type).preventDefault).toHaveBeenCalledOnce();
    await expect(job.result).resolves.toMatchObject({ status: "error", error: PERFORMANCE_CALCULATION_ERROR });
    expect(worker.terminate).toHaveBeenCalledOnce();
    const retry = requestPerformanceCalculation(request);
    FakeWorker.instances[1].reply({ status: "ready", value: [] });
    await expect(retry.result).resolves.toEqual({ status: "ready", value: [] });
  });

  it("stops a stalled job and reports its timeout once", async () => {
    const job = requestPerformanceCalculation(request);
    const worker = FakeWorker.instances[0];
    await vi.advanceTimersByTimeAsync(PERFORMANCE_WORKER_TIMEOUT_MS);
    worker.fail("error");
    await expect(job.result).resolves.toMatchObject({ status: "error", error: "This estimate took too long. Try again." });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("reports unavailable workers without running the estimator in the caller", async () => {
    vi.stubGlobal("Worker", undefined);
    await expect(requestPerformanceCalculation(request).result).resolves.toMatchObject({ status: "error", diagnostic: "Workers unavailable" });
    expect(FakeWorker.instances).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains constructor and serialization diagnostics, cleaning up created workers", async () => {
    vi.stubGlobal("Worker", class { constructor() { throw new Error("Synthetic constructor failure"); } });
    await expect(requestPerformanceCalculation(request).result).resolves.toMatchObject({ status: "error", diagnostic: "Synthetic constructor failure" });
    vi.stubGlobal("Worker", FakeWorker);
    vi.spyOn(FakeWorker.prototype, "postMessage").mockImplementation(() => { throw new Error("Synthetic clone failure"); });
    await expect(requestPerformanceCalculation(request).result).resolves.toMatchObject({ status: "error", diagnostic: "Synthetic clone failure" });
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails an invalid matching response instead of keeping a worker alive", async () => {
    const job = requestPerformanceCalculation(request);
    FakeWorker.instances[0].reply({ status: "unknown" });
    await expect(job.result).resolves.toMatchObject({ status: "error", error: PERFORMANCE_CALCULATION_ERROR });
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
});
