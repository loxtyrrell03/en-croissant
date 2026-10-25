import { MantineProvider } from "@mantine/core";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ALL_GAME_DATES, type GameDateRange } from "@/utils/gameDateRange";
import { GameDateRangeControl } from "./GameDateRangeControl";

afterEach(() => vi.unstubAllGlobals());
it("applies calendar choices only on valid confirmation, supports cancel/Enter and bounded help", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
  Element.prototype.scrollIntoView = vi.fn();
  const changed = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Harness() {
    const [range, setRange] = useState<GameDateRange>({
      period: "custom",
      since: "2026-01-01",
      until: "2026-10-25",
    });
    return (
      <MantineProvider env="test">
        <GameDateRangeControl
          precision="day"
          value={range}
          onChange={(next) => {
            changed(next);
            setRange(next);
          }}
        />
      </MantineProvider>
    );
  }
  const clickText = async (text: string) =>
    act(async () =>
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent === text)!
        .click(),
    );
  const input = async (label: string, value: string) =>
    act(async () => {
      const field = host.querySelector<HTMLInputElement>(`[aria-label="${label} date"]`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  try {
    await act(async () => root.render(<Harness />));
    await clickText("Edit dates");
    await input("From", "2026-11-01");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("From on or before To");
    expect(
      Array.from(host.querySelectorAll("button")).find(
        (button) => button.textContent === "Apply dates",
      )?.disabled,
    ).toBe(true);
    await clickText("Cancel");
    expect(changed).not.toHaveBeenCalled();
    await clickText("Edit dates");
    await input("From", "2026-09-03");
    await act(async () =>
      host
        .querySelector('[aria-label="From date"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        ),
    );
    expect(changed).toHaveBeenLastCalledWith({
      period: "custom",
      since: "2026-09-03",
      until: "2026-10-25",
    });
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Help: Game date range"]')!.focus(),
    );
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("both endpoints");
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    const select = host.querySelector<HTMLInputElement>('[aria-label="Game date range"]')!;
    await act(async () => select.click());
    const all = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (option) => option.textContent === "All time",
    )!;
    await act(async () => all.click());
    expect(changed).toHaveBeenLastCalledWith(ALL_GAME_DATES);
    expect(host.querySelector('[aria-label="From date"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
