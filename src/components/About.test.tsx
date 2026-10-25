import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import notices from "../../licenses/THIRD_PARTY_NOTICES.txt?raw";
import AboutModal from "./About";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: async () => "fixture-version",
  getTauriVersion: async () => "fixture-tauri",
}));
vi.mock("@tauri-apps/plugin-os", () => ({
  arch: () => "fixture-arch",
  type: () => "fixture-os",
  version: () => "fixture-os-version",
}));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
test("the existing About dialog exposes complete optional notices and keeps its close action", async () => {
  const close = vi.fn();
  await act(async () =>
    root.render(
      <MantineProvider>
        <AboutModal opened setOpened={close} />
      </MantineProvider>,
    ),
  );
  expect(document.body.textContent).toContain("fixture-version");
  expect(document.body.textContent).toContain("fixture-os-version");
  const control = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === "Compression library notices",
  );
  expect(control).toBeTruthy();
  expect(control?.getAttribute("aria-expanded")).toBe("false");
  await act(async () => control!.click());
  expect(control?.getAttribute("aria-expanded")).toBe("true");
  const text = document.querySelector<HTMLElement>(
    '[aria-label="Compression library notice text"]',
  );
  expect(text?.textContent).toBe(notices);
  text!.focus();
  expect(document.activeElement).toBe(text);
  expect(text?.style.whiteSpace).toBe("pre-wrap");
  expect(text?.style.overflowWrap).toBe("anywhere");
  const closeButton = document.querySelector<HTMLButtonElement>('[aria-label="Close"]');
  await act(async () => closeButton!.click());
  expect(close).toHaveBeenCalledWith(false);
});
