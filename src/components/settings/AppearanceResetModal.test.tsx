import { MantineProvider } from "@mantine/core";
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { APPEARANCE_BACKUP_KEY } from "@/utils/appearanceReset";
import AppearanceResetModal from "./AppearanceResetModal";

let root: Root, container: HTMLDivElement;
const store = createStore();
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
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("font-size", "125");
  sessionStorage.setItem("tabs", "synthetic unsaved game");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function show(onClose = vi.fn()) {
  await act(async () =>
    root.render(
      <Provider store={store}>
        <MantineProvider>
          <AppearanceResetModal onClose={onClose} />
        </MantineProvider>
      </Provider>,
    ),
  );
  await vi.waitFor(() => expect(document.activeElement?.textContent).toBe("Close"));
  return onClose;
}
async function click(text: string) {
  const button = Array.from(document.querySelectorAll("button")).find(
    (item) => item.textContent === text,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}

test("the actual modal resets, reopens with its undo copy and restores without closing the workspace", async () => {
  const close = await show();
  await click("Reset appearance");
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Appearance reset");
  expect(document.activeElement?.textContent).toBe("Restore previous");
  expect(sessionStorage.getItem("tabs")).toBe("synthetic unsaved game");
  expect(close).not.toHaveBeenCalled();
  await act(async () => root.render(null));
  await show(close);
  await click("Restore previous");
  expect(localStorage.getItem("font-size")).toBe("125");
  expect(localStorage.getItem(APPEARANCE_BACKUP_KEY)).toBeNull();
  expect(document.querySelector('[role="status"]')?.textContent).toContain(
    "Previous appearance restored",
  );
  await click("Close");
  expect(close).toHaveBeenCalledTimes(1);
});
test("backup failure stays visible and can be retried without losing the dialog or saved work", async () => {
  const close = await show();
  const write = Storage.prototype.setItem;
  const spy = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key, value) {
      if (key === APPEARANCE_BACKUP_KEY) throw Error("Full");
      write.call(this, key, value);
    });
  await click("Reset appearance");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not save the undo copy",
  );
  expect(document.activeElement).toBe(document.querySelector('[role="alert"]'));
  expect(localStorage.getItem("font-size")).toBe("125");
  expect(close).not.toHaveBeenCalled();
  spy.mockRestore();
  await click("Retry lookup");
  await click("Reset appearance");
  expect(localStorage.getItem(APPEARANCE_BACKUP_KEY)).not.toBeNull();
  expect(sessionStorage.getItem("tabs")).toBe("synthetic unsaved game");
});
test("unreadable backup blocks reset while preserving close and retry controls", async () => {
  localStorage.setItem(APPEARANCE_BACKUP_KEY, "{ unreadable");
  const close = await show();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "backup could not be read",
  );
  const reset = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === "Reset appearance",
  )!;
  expect(reset.disabled).toBe(true);
  await click("Retry lookup");
  expect(localStorage.getItem(APPEARANCE_BACKUP_KEY)).toBe("{ unreadable");
  await click("Close");
  expect(close).toHaveBeenCalledTimes(1);
});
