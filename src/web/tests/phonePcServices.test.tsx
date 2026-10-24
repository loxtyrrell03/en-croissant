import { act } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { expect, it, vi } from "vitest";
import PhonePcServices from "../PhonePcServices";
import { requestPcServices } from "../pcServices";
vi.mock("../pcServices", () => ({ requestPcServices: vi.fn() }));

it("changes real PC state through the switch and reports a failed start without claiming ready", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.matchMedia = vi
    .fn()
    .mockImplementation(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
  const off = {
    ok: true as const,
    service: "en-croissant-service-controller" as const,
    enabled: false,
    home: false,
    engine: false,
    busy: false,
    error: null,
  };
  vi.mocked(requestPcServices).mockResolvedValue(off);
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  try {
    await act(async () =>
      root.render(
        <MantineProvider>
          <PhonePcServices />
        </MantineProvider>,
      ),
    );
    const toggle = div.querySelector('input[role="switch"]') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    let finish!: (result: typeof off) => void;
    vi.mocked(requestPcServices).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => toggle.click());
    expect(requestPcServices).toHaveBeenLastCalledWith(true, expect.any(AbortSignal));
    expect(div.textContent).toContain("Starting…");
    expect(toggle.disabled).toBe(true);
    await act(async () =>
      finish({ ...off, enabled: true, error: "Engine failed to start." } as any),
    );
    expect(div.textContent).toContain("Unavailable");
    expect(div.textContent).not.toContain("Ready");
    vi.mocked(requestPcServices).mockResolvedValueOnce({
      ...off,
      enabled: true,
      home: true,
      engine: true,
    });
    await act(async () =>
      [...div.querySelectorAll("button")].find((button) => button.textContent === "Retry")!.click(),
    );
    expect(div.textContent).toContain("Ready");
    vi.mocked(requestPcServices).mockResolvedValueOnce(off);
    await act(async () => toggle.click());
    expect(requestPcServices).toHaveBeenLastCalledWith(false, expect.any(AbortSignal));
    expect(toggle.checked).toBe(false);
    expect(div.textContent).toContain("PC analysis and reviews are stopped.");
  } finally {
    await act(async () => root.unmount());
    div.remove();
    vi.unstubAllGlobals();
  }
});
