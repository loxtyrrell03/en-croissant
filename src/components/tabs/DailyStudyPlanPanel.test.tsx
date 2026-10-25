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
async function fillField(label: string, value: string) {
  const field = Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea"),
  ).find((node) =>
    Array.from(node.labels ?? []).some((item) => item.textContent?.includes(label)),
  )!;
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
describe("loaded daily study routine", () => {
  it("seeks inside the top progress bar and keyboard timer without inventing logged study", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
    await mount();
    const segment = container.querySelector(
      '[aria-label^="Jump to Calculation"]',
    ) as HTMLButtonElement;
    vi.spyOn(segment, "getBoundingClientRect").mockReturnValue({
      left: 100,
      width: 400,
    } as DOMRect);
    await act(async () =>
      segment.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: 300 })),
    );
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("40:00");
    const saved = () => JSON.parse(localStorage.getItem("daily-study-journal:test")!);
    expect(saved().attempts[0].elapsedMs).toBe(0);
    expect(container.textContent).toContain("0 of 2 study blocks completed");
    const slider = document.querySelector('[role="dialog"] [role="slider"]')!;
    await act(async () => {
      slider.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
      slider.dispatchEvent(new KeyboardEvent("keyup", { key: "End", bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("00:00");
    await act(async () => {
      slider.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
      slider.dispatchEvent(new KeyboardEvent("keyup", { key: "Home", bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("80:00");
    await act(async () => button("Start timer").click());
    await act(async () => vi.advanceTimersByTime(60000));
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    expect(container.textContent).toContain("79:00");
    expect(saved().attempts[0].timerOffsetMs).toBe(0);
  });

  it("resumes or restarts saved partial work, retains notes and leaves state intact on failed restart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
    await mount();
    await act(async () => button("Start Calculation").click());
    await fillField("Work, lesson and next step", "Keep this first attempt");
    await act(async () => vi.advanceTimersByTime(60000));
    await act(async () => button("Save partial block").click());
    const read = () => JSON.parse(localStorage.getItem("daily-study-journal:test")!);
    const first = read().attempts[0];
    await act(async () => button("Start Calculation").click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("79:00");
    expect(read().attempts).toHaveLength(1);
    const original = Storage.prototype.setItem;
    const write = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key, value) {
        if (key.startsWith("daily-study-journal:")) throw new Error("full");
        original.call(this, key, value);
      });
    const slider = document.querySelector('[role="dialog"] [role="slider"]')!;
    await act(async () => {
      slider.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("79:00");
    expect(read().attempts[0].timerOffsetMs).toBeUndefined();
    await act(async () => button("Restart block").click());
    expect(document.body.textContent).toContain("Study changes were not saved");
    expect(read().attempts).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("79:00");
    write.mockRestore();
    await act(async () => button("Restart block").click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("80:00");
    expect(read().attempts).toHaveLength(2);
    expect(read().attempts[0]).toMatchObject({
      id: first.id,
      notes: "Keep this first attempt",
      elapsedMs: 60000,
      status: "partial",
    });
    expect(read().attempts[1]).toMatchObject({ notes: "", elapsedMs: 0, runningSince: null });
    await act(async () => button("Save partial block").click());
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    const restart = container.querySelector(
      '[aria-label="Restart Calculation"]',
    ) as HTMLButtonElement;
    await act(async () => restart.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("80:00");
    expect(read().attempts).toHaveLength(3);
  });

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
    vi.useRealTimers();
    vi.restoreAllMocks();
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
  it("runs, pauses and restores the timer without inferring completion, then advances manually", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
    await mount();
    await act(async () => button("Start Calculation").click());
    await act(async () => vi.advanceTimersByTime(65000));
    expect(document.body.textContent).toContain("78:55");
    await act(async () => button("Pause timer").click());
    await act(async () => vi.advanceTimersByTime(60000));
    expect(document.body.textContent).toContain("78:55");
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    expect(container.textContent).toContain("78:55");
    await act(async () => button("Resume timer").click());
    await act(async () => vi.advanceTimersByTime(80 * 60000));
    expect(container.textContent).toContain("Time reached");
    expect(container.textContent).toContain("0 of 2 study blocks completed");
    await act(async () => button("Complete & next").click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Opening repair");
    expect(container.textContent).toContain("1 of 2 study blocks completed");
    expect(container.textContent).toContain("10:00");
    await act(async () => button("Complete & next").click());
    expect(container.textContent).toContain("All study blocks complete for this session");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps running across resource navigation and reload, and changes allocation without erasing checks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
    await mount();
    await act(async () => button("Start Calculation").click());
    await act(async () => button("Open positions").click());
    await act(async () => root.unmount());
    await act(async () => vi.advanceTimersByTime(120000));
    root = createRoot(container);
    await mount();
    expect(container.textContent).toContain("78:00");
    const radio = container.querySelector('input[value="60"]') as HTMLInputElement;
    await act(async () => radio.click());
    expect(container.textContent).toContain("53:00");
    expect(container.textContent).toContain("Paused");
    await act(async () => button("Complete & next").click());
    expect(container.textContent).toContain("55 of 60 planned minutes marked complete");
    await act(async () =>
      (container.querySelector('input[value="90"]') as HTMLInputElement).click(),
    );
    expect(container.textContent).toContain("1 of 2 study blocks completed");
    expect(container.textContent).toContain("80 of 90 planned minutes marked complete");
  });

  it("starts a separate London day without carrying yesterday's running timer or notes forward", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T22:59:58Z"));
    await mount();
    await act(async () => button("Start Calculation").click());
    await act(async () => vi.advanceTimersByTime(3000));
    expect(container.textContent).toContain("2026-10-25");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[aria-label="Block time remaining"]')).toBeNull();
    expect(localStorage.getItem("daily-study-journal:test")).toContain("calculation");
  });

  it("does not advance or mark done when saving progress fails", async () => {
    await mount();
    await act(async () => button("Start Calculation").click());
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith("daily-study-journal:")) throw new Error("full");
      original.call(this, key, value);
    });
    await act(async () => button("Complete & next").click());
    expect(container.textContent).toContain("0 of 2 study blocks completed");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Calculation");
    expect(container.textContent).toContain("Study changes were not saved");
  });

  it("jumps without marking skipped blocks complete and returns to unfinished blocks", async () => {
    await mount();
    await act(async () =>
      (
        container.querySelector('[aria-label^="Jump to Opening repair"]') as HTMLButtonElement
      ).click(),
    );
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Opening repair");
    expect(container.textContent).toContain("0 of 2 study blocks completed");
    await act(async () => button("Complete & next").click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Calculation");
    expect(container.textContent).toContain("1 of 2 study blocks completed");
  });

  it("requires an actual annotation record per intentional session and retains previous sessions", async () => {
    const withGame = structuredClone(fixture);
    withGame.steps[1].id = "transfer";
    withGame.steps[1].title = "Annotate game";
    mocks.read.mockResolvedValue(JSON.stringify(withGame));
    await mount();
    await act(async () => button("Start Calculation").click());
    await act(async () => button("Complete & next").click());
    await act(async () => button("Complete & next").click());
    expect(document.body.textContent).toContain("Record the game, saved annotation reference");
    expect(container.textContent).toContain("1 of 2 study blocks completed");
    await act(async () => button("Record game and annotations").click());
    await fillField("Game and saved annotation reference", "Example game — saved-example.pgn");
    await fillField(
      "What I calculated, annotated or reviewed",
      "Annotated the opening plan and three critical decisions; saved my comments.",
    );
    const confirmation = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ).find((n) =>
      Array.from(n.labels ?? []).some((l) => l.textContent?.includes("I annotated this game")),
    )!;
    await act(async () => confirmation.click());
    await act(async () => button("Complete & next").click());
    expect(container.textContent).toContain("All study blocks complete for this session");
    await act(async () => button("Start another session").click());
    await act(async () => button("Save current & start new session").click());
    expect(container.textContent).toContain("Session 2");
    expect(container.textContent).toContain("0 of 2 study blocks completed");
    const history = JSON.parse(localStorage.getItem("daily-study-journal:test")!);
    expect(history.pastSessions).toHaveLength(1);
    expect(
      history.attempts.filter(
        (a: { stepId: string; status: string }) =>
          a.stepId === "transfer" && a.status === "completed",
      ),
    ).toHaveLength(1);
    expect(history.attempts[1].work[0].reference).toContain("saved-example.pgn");
  });

  it("keeps a partial position record through reload without marking it complete", async () => {
    await mount();
    await act(async () => button("Start Calculation").click());
    await act(async () => button("Add position or chapter").click());
    await fillField("Position, chapter or game reference", "Exercise 4, move 23");
    await fillField("Position FEN (optional)", "8/8/8/8/8/6k1/8/K7 w - - 0 1");
    await fillField(
      "What I calculated, annotated or reviewed",
      "Compared king routes; need to review opposition.",
    );
    await act(async () => button("Save partial block").click());
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    expect(container.textContent).toContain("0 of 2 study blocks completed");
    const history = JSON.parse(localStorage.getItem("daily-study-journal:test")!);
    expect(history.attempts[0]).toMatchObject({
      status: "partial",
      work: [
        expect.objectContaining({
          reference: "Exercise 4, move 23",
          work: "Compared king routes; need to review opposition.",
        }),
      ],
    });
    expect(history.attempts[0].runningSince).toBeNull();
  });
});
