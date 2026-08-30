import { MantineProvider } from "@mantine/core";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { FidePlayer } from "@/utils/fidePlayer";
import { FidePlayerSearchInput } from "./FidePlayerSearchInput";

const player: FidePlayer = {
  id: 4100947,
  name: "Binks, Michael",
  federation: "ENG",
  year: 1940,
};

describe("FIDE player phone picker", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  test("keeps touch-scrollable suggestions visible until a player is chosen", async () => {
    const onSelect = vi.fn();
    const searchPlayers = vi.fn(async () => [player]);

    function Harness() {
      const [value, setValue] = useState("Binks");
      const [selected, setSelected] = useState<FidePlayer | null>(null);
      return (
        <MantineProvider>
          <FidePlayerSearchInput
            mobileInline
            onChange={setValue}
            onSelect={(next) => {
              onSelect(next);
              setSelected(next);
              setValue(next.name);
            }}
            searchPlayers={searchPlayers}
            selected={selected}
            size="md"
            value={value}
          />
        </MantineProvider>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => vi.advanceTimersByTimeAsync(220));

    const input = container.querySelector<HTMLInputElement>('input[role="combobox"]');
    const results = container.querySelector<HTMLElement>('[role="listbox"]');
    const option = container.querySelector<HTMLButtonElement>('[role="option"]');
    expect(container.querySelector('[data-size="md"]')).not.toBeNull();
    expect(results?.textContent).toContain("Binks, Michael");
    expect(results?.className).toContain("mobileResults");

    await act(async () => {
      results?.dispatchEvent(new Event("scroll", { bubbles: true }));
      window.dispatchEvent(new Event("scroll"));
    });
    expect(container.querySelector('[role="listbox"]')).toBe(results);

    await act(async () => option?.click());
    expect(onSelect).toHaveBeenCalledWith(player);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(input?.value).toBe("Binks, Michael");
  });
});
