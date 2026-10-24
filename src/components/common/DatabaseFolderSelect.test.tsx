import { MantineProvider } from "@mantine/core";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import DatabaseFolderSelect from "./DatabaseFolderSelect";

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let viewport: EventTarget & { height: number };
const select = vi.fn();
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  viewport = Object.assign(new EventTarget(), {
    height: 844,
    width: 390,
    offsetLeft: 0,
    offsetTop: 0,
    scale: 1,
  });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  select.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  delete (window as { visualViewport?: unknown }).visualViewport;
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = false;
});

test("search keeps focus and selection across the phone keyboard viewport resize", async () => {
  function Harness() {
    const [value, setValue] = useState<string | null>(null);
    return (
      <MantineProvider env="test">
        <DatabaseFolderSelect
          size="xs"
          label="Prep source"
          value={value}
          onChange={(v) => {
            setValue(v);
            select(v);
          }}
          data={[
            { group: "Desktop", items: [{ value: "alex", label: "Alex Example - OTB prep" }] },
          ]}
        />
      </MantineProvider>
    );
  }
  await act(async () => root.render(<Harness />));
  await act(async () => container.querySelector("button")!.click());
  await vi.waitFor(() =>
    expect(document.querySelector('input[aria-label="Search databases"]')).toBeTruthy(),
  );
  const search = document.querySelector<HTMLInputElement>('input[aria-label="Search databases"]')!;
  expect(search).toBeTruthy();
  expect(getComputedStyle(search).fontSize).toBe("16px");
  await act(async () => {
    search.focus();
    viewport.height = 240;
    viewport.dispatchEvent(new Event("resize"));
  });
  expect(document.activeElement).toBe(search);
  expect(search.isConnected).toBe(true);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "Alex");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const result = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Alex Example"),
  )!;
  await act(async () => result.click());
  expect(select).toHaveBeenCalledExactlyOnceWith("alex");
  expect(document.querySelector('input[aria-label="Search databases"]')).toBeNull();
});
