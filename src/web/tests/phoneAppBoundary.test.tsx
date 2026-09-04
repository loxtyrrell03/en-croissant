// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import PhoneAppBoundary from "../PhoneAppBoundary";

it("keeps recovery visible when the app fails outside the Mantine provider", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const host = document.createElement("div");
  const root = createRoot(host);
  const saved = '{"games":["saved"]}';
  localStorage.setItem("recovery-test", saved);
  function Broken(): never {
    throw new Error("header failed");
  }
  try {
    await act(async () =>
      root.render(
        <PhoneAppBoundary>
          <Broken />
        </PhoneAppBoundary>,
      ),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Reload app");
    expect(localStorage.getItem("recovery-test")).toBe(saved);
  } finally {
    await act(async () => root.unmount());
    localStorage.removeItem("recovery-test");
    errors.mockRestore();
    vi.unstubAllGlobals();
  }
});
