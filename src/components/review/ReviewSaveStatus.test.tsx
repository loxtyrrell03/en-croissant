import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import ReviewSaveStatus from "./ReviewSaveStatus";
import { pendingReviewDeck, writeReviewDeck } from "@/utils/reviewDeckWrites";

it("keeps the failed-save notice through remount and retries the retained snapshot", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
  let failing = true;
  const write = vi.fn(async (value: { reviews: number }) => {
    if (failing) throw new Error("Example disk full");
    return value;
  });
  await expect(writeReviewDeck("status-deck", { reviews: 7 }, write)).rejects.toThrow(
    "Example disk full",
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    const panel = (
      <MantineProvider>
        <ReviewSaveStatus path="status-deck" />
      </MantineProvider>
    );
    await act(async () => root.render(panel));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("not saved");
    await act(async () => root.render(null));
    expect(pendingReviewDeck("status-deck")).toEqual({ reviews: 7 });
    await act(async () => root.render(panel));
    expect(host.textContent).toContain("Example disk full");
    failing = false;
    await act(async () => host.querySelector("button")!.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0]).toEqual({ reviews: 7 });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
