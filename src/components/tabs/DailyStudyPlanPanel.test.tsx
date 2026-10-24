import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DailyStudyPlanPanel from "./DailyStudyPlanPanel";

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), exists: vi.fn() }));
vi.mock("@/utils/directories", () => ({ getDocumentDir: async () => "C:/Study" }));
vi.mock("@tauri-apps/api/path", () => ({ resolve: async (...parts: string[]) => parts.join("/") }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: mocks.read,
  writeTextFile: mocks.write,
  exists: mocks.exists,
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));

const fixture = {
  schemaVersion: 1,
  id: "test",
  title: "Daily study plan",
  startDate: "2026-10-06",
  defaultMinutes: 90,
  steps: [
    {
      id: "calculation",
      title: "Calculation",
      minutes60: 55,
      minutes90: 80,
      instructions: "Find their best reply",
      resources: [{ kind: "pgn", id: "exercise", title: "Personal exercises", path: "drills.pgn" }],
    },
    {
      id: "opening",
      title: "Opening repair",
      minutes60: 5,
      minutes90: 10,
      instructions: "Recall your branch",
      resources: [],
    },
  ],
  openingWeeks: [],
};
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
async function mount(openFile = vi.fn()) {
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <DailyStudyPlanPanel onOpenFile={openFile} />
      </MantineProvider>,
    );
  });
  return openFile;
}
function button(text: string) {
  return Array.from(document.querySelectorAll("button")).find((node) => node.textContent === text)!;
}
describe("loaded daily study routine", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.exists.mockResolvedValue(true);
    mocks.read.mockResolvedValue(JSON.stringify(fixture));
    mocks.write.mockResolvedValue(undefined);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  it("opens a saved personal exercise with its original path and preserves completion across remount", async () => {
    const openFile = await mount();
    expect(container.textContent).toContain("0 of 2 study blocks completed");
    await act(async () => button("Start Calculation").click());
    await act(async () => button("Open positions").click());
    expect(openFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: "C:/Study/drills.pgn", type: "game" }),
    );
    await act(async () =>
      (
        container.querySelector('input[aria-label="Mark Calculation complete"]') as HTMLInputElement
      ).click(),
    );
    expect(container.textContent).toContain("1 of 2 study blocks completed");
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    expect(container.textContent).toContain("1 of 2 study blocks completed");
  });
  it("keeps an absent plan quiet and reports a corrupt existing plan with retry", async () => {
    mocks.exists.mockResolvedValue(false);
    await mount();
    expect(container.querySelector("button")).toBeNull();
    mocks.exists.mockResolvedValue(true);
    mocks.read.mockResolvedValue("broken");
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    expect(container.textContent).toContain("Could not read the saved study plan");
    expect(button("Retry")).toBeDefined();
  });
});
