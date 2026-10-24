import { MantineProvider, Tooltip } from "@mantine/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DatabaseWdlBar } from "@/components/panels/database/DatabaseWdlBar";
import { WdlResultBar } from "./WdlResultBar";
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
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
async function render(node: React.ReactNode) {
  await act(async () => root.render(<MantineProvider>{node}</MantineProvider>));
}

test.each([false, true])(
  "native Database keeps small and zero results visible (dense=%s)",
  async (dense) => {
    await render(<DatabaseWdlBar white={1} draw={999} black={0} dense={dense} />);
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      "White wins 0.1% · Draws 99.9% · Black wins 0.0%",
    );
    expect(container.textContent).toContain("0.1%99.9%0.0%");
    expect(container.querySelectorAll('[title="White wins"]')).toHaveLength(1);
  },
);
test("black perspective preserves its order and explicitly names each outcome", async () => {
  await render(<DatabaseWdlBar white={1} draw={0} black={3} perspective="black" />);
  expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
    "Black wins 75.0% · Draws 0.0% · White wins 25.0%",
  );
  expect(container.textContent).toContain("75.0%0.0%25.0%");
});
test("phone/Prep integer labels retain zero segments and the Prep palette", async () => {
  await render(<WdlResultBar white={100} draw={0} black={0} precision={0} compact tone="prep" />);
  expect(container.querySelector('[data-tone="prep"]')).not.toBeNull();
  expect(container.textContent).toContain("100%0%0%");
  expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain("Draws 0%");
  expect(
    Array.from(container.querySelectorAll('[role="progressbar"]')).map((section) =>
      (section as HTMLElement).style.getPropertyValue("--progress-section-color"),
    ),
  ).toEqual(["var(--wdl-white)", "var(--wdl-draw)", "var(--wdl-black)"]);
});
test.each([
  [0, 0, 0, "No completed game results"],
  [NaN, 1, 0, "Game results unavailable"],
  [-1, 1, 1, "Game results unavailable"],
  [1e308, 1e308, 0, "Game results unavailable"],
] as const)(
  "missing/empty results never claim 0%% (%s/%s/%s)",
  async (white, draw, black, label) => {
    await render(<WdlResultBar white={white} draw={draw} black={black} />);
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(label);
    expect(container.textContent).not.toContain("0%");
    expect(container.textContent).toContain("———");
  },
);
test("review tooltips retain their target events and forwarded DOM reference", async () => {
  await render(
    <Tooltip label="Fixture record details" openDelay={0}>
      <WdlResultBar white={1} draw={2} black={1} />
    </Tooltip>,
  );
  await act(async () =>
    container
      .querySelector('[role="img"]')!
      .dispatchEvent(new MouseEvent("mouseenter", { bubbles: true })),
  );
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      "Fixture record details",
    );
  });
});
