import { afterEach, describe, expect, it, vi } from "vitest";
import type { PerformanceWorkerRequest } from "./truePerformanceProtocol";

const calculations = vi.hoisted(() => ({ period: vi.fn(), history: vi.fn() }));
vi.mock("./truePerformance", () => ({ periodPerformanceHistory: calculations.period, strengthHistory: calculations.history }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks(); });

async function worker() {
  let listener!: (event: MessageEvent<PerformanceWorkerRequest>) => void;
  const postMessage = vi.fn();
  vi.stubGlobal("self", { addEventListener: (_: string, callback: typeof listener) => { listener = callback; }, postMessage });
  await import("./truePerformance.worker");
  return { postMessage, send: (kind: "period" | "history") => listener({ data: { id: 17, kind, games: [], asOf: 123, gameType: "both" } } as unknown as MessageEvent<PerformanceWorkerRequest>) };
}

describe("performance worker dispatch", () => {
  it("uses the period history as the only source of the headline and period graph", async () => {
    const points = [{ mean: 1800 }];
    calculations.period.mockReturnValue(points);
    const target = await worker(); target.send("period");
    expect(calculations.period).toHaveBeenCalledExactlyOnceWith([], 123, "both");
    expect(calculations.history).not.toHaveBeenCalled();
    expect(target.postMessage).toHaveBeenCalledWith({ id: 17, kind: "period", result: { status: "ready", value: points } });
  });
  it("uses the full loaded history independently of the period graph", async () => {
    calculations.history.mockReturnValue({ points: [] });
    const target = await worker(); target.send("history");
    expect(calculations.history).toHaveBeenCalledExactlyOnceWith([], 123, undefined, "both");
    expect(calculations.period).not.toHaveBeenCalled();
    expect(target.postMessage).toHaveBeenCalledWith({ id: 17, kind: "history", result: { status: "ready", value: { points: [] } } });
  });
  it("preserves a solver diagnostic while returning a separate user-facing failure", async () => {
    calculations.period.mockImplementation(() => { throw new Error("Synthetic integration limit"); });
    const target = await worker(); target.send("period");
    expect(target.postMessage).toHaveBeenCalledWith({ id: 17, kind: "period", result: { status: "error", error: "This estimate could not be calculated reliably for these games.", diagnostic: "Synthetic integration limit" } });
  });
});
