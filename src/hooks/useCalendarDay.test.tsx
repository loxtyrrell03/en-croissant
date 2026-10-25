import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useCalendarDay } from "./useCalendarDay";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("advances on the real local midnight across the UK clock change and catches up after a hidden tab", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("TZ", "Europe/London");
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 25, 0, 0, 0));
  expect(new Date().getTimezoneOffset()).toBe(-60);
  const host = document.createElement("div");
  const root = createRoot(host);
  function Harness() {
    return <span>{useCalendarDay()}</span>;
  }
  try {
    act(() => root.render(<Harness />));
    expect(host.textContent).toBe("2026-10-25");
    act(() => vi.advanceTimersByTime(24 * 60 * 60 * 1000));
    expect(host.textContent).toBe("2026-10-25");
    act(() => vi.advanceTimersByTime(60 * 60 * 1000));
    expect(host.textContent).toBe("2026-10-26");
    vi.setSystemTime(new Date(2026, 10, 2, 11));
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(host.textContent).toBe("2026-11-02");
    expect(vi.getTimerCount()).toBe(1);
  } finally {
    act(() => root.unmount());
  }
  expect(vi.getTimerCount()).toBe(0);
});
