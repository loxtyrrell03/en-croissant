import { MantineProvider } from "@mantine/core";
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { storedEvaluationSaveErrorAtom, useStoredEvaluationsAtom } from "@/state/atoms";
import { NATIVE_STORED_EVALUATIONS_KEY } from "@/utils/storedEvaluationPolicy";
import { StoredEvaluationSwitch } from "./StoredEvaluationSwitch";
let host: HTMLDivElement,
  root: ReturnType<typeof createRoot>,
  store: ReturnType<typeof createStore>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  store = createStore();
  store.set(useStoredEvaluationsAtom, true);
  store.set(storedEvaluationSaveErrorAtom, null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(visible = true, two = false) {
  await act(async () =>
    root.render(
      <Provider store={store}>
        <MantineProvider>
          {visible && (
            <>
              <StoredEvaluationSwitch />
              {two && <StoredEvaluationSwitch />}
            </>
          )}
        </MantineProvider>
      </Provider>,
    ),
  );
}
const switches = () =>
  Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
it("reads a saved Off choice before the first analysis render or subscription", async () => {
  localStorage.setItem(NATIVE_STORED_EVALUATIONS_KEY, "false");
  vi.resetModules();
  const { useStoredEvaluationsAtom: savedPreference } = await import("@/state/atoms");
  expect(createStore().get(savedPreference)).toBe(false);
});
it("keeps analysis and Engines controls synchronized and exposes dismissible keyboard/touch help", async () => {
  await render(true, true);
  await act(async () => switches()[0].click());
  expect(switches().map((input) => input.checked)).toEqual([false, false]);
  expect(JSON.parse(localStorage.getItem(NATIVE_STORED_EVALUATIONS_KEY)!)).toBe(false);
  const help = host.querySelector<HTMLButtonElement>(
    'button[aria-label="About stored evaluations for local engines"]',
  )!;
  await act(async () => help.focus());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
    "Separate cloud engines",
  );
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await act(async () => help.click());
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});
it("retains a failed Off choice through route remount and retries without reverting it", async () => {
  await render();
  const write = Storage.prototype.setItem;
  const failure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key === NATIVE_STORED_EVALUATIONS_KEY) throw new Error("Invented quota failure");
    return write.call(this, key, value);
  });
  await act(async () => switches()[0].click());
  expect(store.get(useStoredEvaluationsAtom)).toBe(false);
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await render(false);
  await render();
  expect(switches()[0].checked).toBe(false);
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  failure.mockRestore();
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent === "Retry saving")!
      .click(),
  );
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(JSON.parse(localStorage.getItem(NATIVE_STORED_EVALUATIONS_KEY)!)).toBe(false);
});
