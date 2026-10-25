// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { TournamentTrackerView } from "../TournamentTrackerView";
import { trackerFixture } from "./trackerFixture";

test("stop following is directly available on the initial tracker and never deletes games", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onUnfollow = vi.fn(async () => {});
  const onRemove = vi.fn(async () => {});
  const props = {
    ...trackerFixture(), calculating: false, running: true, prepBusy: null,
    removeBusy: false, settingBusy: false, syncEvent: null, error: null,
    projectedSideFor: () => "white" as const,
    onOpponent: vi.fn(), onOpenDatabase: vi.fn(), onToggleUpdate: vi.fn(),
    onCheck: vi.fn(), onStop: vi.fn(), onBack: vi.fn(), onUnfollow, onRemove,
  };
  try {
    await act(async () => root.render(<TournamentTrackerView {...props} />));
    const stop = [...host.querySelectorAll("button")].find(button => button.textContent === "Stop following")!;
    const tabs = host.querySelector('[role="tablist"]')!;
    expect(stop).toBeTruthy();
    expect(stop.closest('[role="tabpanel"]')).toBeNull();
    expect(stop.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stop.disabled).toBe(false); // It must also stop an in-flight check.
    await act(async () => stop.click());
    expect(onUnfollow).toHaveBeenCalledOnce();
    expect(onRemove).not.toHaveBeenCalled();

    await act(async () => root.render(<TournamentTrackerView {...props} removeBusy />));
    expect(stop.disabled).toBe(true);
    await act(async () => stop.click());
    expect(onUnfollow).toHaveBeenCalledOnce();

    await act(async () => root.render(<TournamentTrackerView {...props} settingBusy />));
    expect(stop.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
