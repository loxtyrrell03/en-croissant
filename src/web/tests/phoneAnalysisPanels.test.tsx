import { webcrypto } from "node:crypto";
import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import WebGameReportPanel from "../WebGameReportPanel";
import PhoneEnginePlansPanel from "../PhoneEnginePlansPanel";
import { createEmptyWebState } from "../storage";
import { createWebStateSession } from "../webStateSession";
import { parsePgnDatabase } from "../pgn";
import { analyzeWithWebStockfish18 } from "../stockfishEngine";
import { readGameReportRun } from "@/utils/gameReportRun";
import type { WebEngineLine } from "../model";
vi.mock("../stockfishEngine", () => ({ analyzeWithWebStockfish18: vi.fn() }));
const analyze = vi.mocked(analyzeWithWebStockfish18);
const fixture = (pgn = "1. e4 e5 *") => {
  const game = parsePgnDatabase("Invented fixture", pgn, 1).games[0];
  return {
    startFen: game.moves[0].fenBefore,
    line: game.moves,
    white: "Fixture White",
    black: "Fixture Black",
  };
};
const line = (cp = 30): WebEngineLine[] => [
  {
    source: "stockfish",
    engineName: "Fixture engine",
    depth: 7,
    multipv: 1,
    score: { type: "cp", value: cp },
    uciMoves: ["e2e4"],
    sanMoves: ["e4"],
  },
];
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const tick = async () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
const button = (name: string) =>
  Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === name,
  )!;
const click = async (name: string) =>
  act(async () => {
    const found = button(name);
    expect(found).toBeTruthy();
    expect(found.disabled).toBe(false);
    found.click();
  });
const render = async (node: React.ReactNode) =>
  act(async () => root.render(<MantineProvider>{node}</MantineProvider>));
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
  }));
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  analyze.mockReset().mockResolvedValue(line());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

test("actual report controls save Low limits and keep the previous durable report when replacement saving fails", async () => {
  let failSave = false;
  const io = {
    load: async () => createEmptyWebState(),
    save: vi.fn(async () => {
      if (failSave) throw new Error("Disk full fixture");
    }),
  };
  const session = createWebStateSession(io);
  await session.load();
  const onBusy = vi.fn(),
    game = fixture(),
    onSelectPly = vi.fn();
  await render(
    <WebGameReportPanel game={game} session={session} onBusy={onBusy} onSelectPly={onSelectPly} />,
  );
  await vi.waitFor(async () => {
    await tick();
    expect(button("Analyze game")?.disabled).toBe(false);
  });
  await act(async () => (host.querySelector('input[value="low"]') as HTMLInputElement).click());
  await click("Analyze game");
  await vi.waitFor(async () => {
    await tick();
    expect(host.querySelector('[aria-label="Saved game report"]')).not.toBeNull();
  });
  expect(analyze).toHaveBeenCalledTimes(3);
  expect(analyze.mock.calls[0][0].reportLimits).toEqual({ depth: 8, timeMs: 50 });
  const old = Object.values(session.getSnapshot().savedState!.gameReports!)[0];
  expect((await readGameReportRun(old.run, old.root))?.limit).toEqual({
    t: "Combined",
    c: { depth: 8, timeMs: 50 },
  });
  expect(host.textContent).toContain("Fixture White · White accuracy");
  failSave = true;
  analyze.mockResolvedValue(line(-400));
  await click("Analyze again");
  await vi.waitFor(async () => {
    await tick();
    expect(host.textContent).toContain("Report ready; save failed");
  });
  expect(Object.values(session.getSnapshot().savedState!.gameReports!)[0]).toBe(old);
  expect(session.getSnapshot().state.gameReports).not.toBe(
    session.getSnapshot().savedState!.gameReports,
  );
  expect(host.querySelector('[aria-label="Saved game report"]')).not.toBeNull();
  failSave = false;
  await click("Retry report save");
  await vi.waitFor(async () => {
    await tick();
    expect(host.textContent).not.toContain("Report ready; save failed");
    expect(session.hasUnsavedChanges()).toBe(false);
  });
  expect(analyze).toHaveBeenCalledTimes(6); // Retry saves the completed result; no new engine run.
  expect(onBusy.mock.calls).toContainEqual([true]);
  expect(onBusy.mock.calls.at(-1)).toEqual([false]);
});

test("switching the legal game cancels late report results without saving into the replacement", async () => {
  let finish!: (value: WebEngineLine[]) => void;
  analyze.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const io = { load: async () => createEmptyWebState(), save: vi.fn(async () => {}) },
    session = createWebStateSession(io);
  await session.load();
  const busy = vi.fn();
  await render(
    <WebGameReportPanel game={fixture()} session={session} onBusy={busy} onSelectPly={() => {}} />,
  );
  await vi.waitFor(async () => {
    await tick();
    expect(button("Analyze game")?.disabled).toBe(false);
  });
  await click("Analyze game");
  await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
  const signal = analyze.mock.calls[0][0].signal!;
  await render(
    <WebGameReportPanel
      game={fixture("1. d4 d5 *")}
      session={session}
      onBusy={busy}
      onSelectPly={() => {}}
    />,
  );
  expect(signal.aborted).toBe(true);
  await act(async () => finish(line()));
  await tick();
  expect(session.getSnapshot().state.gameReports).toBeUndefined();
  expect(io.save).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Game changed");
});

test("cancel leaves a visible retryable report state and changing limits does not start analysis", async () => {
  analyze.mockImplementation(
    ({ signal }) =>
      new Promise((_resolve, reject) =>
        signal?.addEventListener("abort", () =>
          reject(new DOMException("cancelled", "AbortError")),
        ),
      ),
  );
  const session = createWebStateSession({
    load: async () => createEmptyWebState(),
    save: async () => {},
  });
  await session.load();
  await render(
    <WebGameReportPanel
      game={fixture()}
      session={session}
      onBusy={() => {}}
      onSelectPly={() => {}}
    />,
  );
  await vi.waitFor(async () => {
    await tick();
    expect(button("Analyze game")?.disabled).toBe(false);
  });
  await act(async () => (host.querySelector('input[value="custom"]') as HTMLInputElement).click());
  expect(host.querySelector('input[type="text"]')).not.toBeNull();
  expect(analyze).not.toHaveBeenCalled();
  await click("Analyze game");
  await click("Cancel analysis");
  await vi.waitFor(async () => {
    await tick();
    expect(host.textContent).toContain("Analysis cancelled");
  });
  expect(button("Analyze game").disabled).toBe(false);
});

test("Plans starts fresh at depth 17, retains real ranks/evidence and filters cached horizons without another search", async () => {
  const game = fixture(),
    play = vi.fn(),
    busy = vi.fn();
  const lines = [
    {
      ...line()[0],
      depth: 17,
      multipv: 1,
      uciMoves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"],
    },
    {
      ...line(20)[0],
      depth: 16,
      multipv: 3,
      uciMoves: ["d2d4", "d7d5", "c2c4", "e7e6", "b1c3", "g8f6"],
    },
  ];
  analyze.mockResolvedValue(lines);
  await render(<PhoneEnginePlansPanel fen={game.startFen} onBusy={busy} onPlayLine={play} />);
  expect((host.querySelector("input") as HTMLInputElement).value).toBe("17");
  await click("Explore plans");
  await vi.waitFor(async () => {
    await tick();
    expect(host.textContent).toContain("2 evaluated root choices");
  });
  expect(analyze.mock.calls[0][0]).toMatchObject({ depth: 17, multipv: 8, planSearch: true });
  const detail = Array.from(host.querySelectorAll("button")).find(
    (button) => button.getAttribute("aria-expanded") === "false",
  )!;
  await act(async () => detail.click());
  expect(host.textContent).toContain("Supporting PV");
  await click("Play this line");
  expect(play).toHaveBeenCalledWith(
    game.startFen,
    expect.arrayContaining([expect.stringMatching(/^[a-h]/)]),
  );
  expect(host.textContent).toContain("depth 17");
  await act(async () =>
    (host.querySelector('input[aria-label="Plan horizon"]') as HTMLInputElement).click(),
  );
  const immediate = Array.from(document.querySelectorAll('[role="option"]')).find(
    (option) => option.textContent === "Immediate",
  ) as HTMLElement;
  expect(immediate).toBeTruthy();
  await act(async () => immediate.click());
  expect((host.querySelector('input[aria-label="Plan horizon"]') as HTMLInputElement).value).toBe(
    "Immediate",
  );
  expect(analyze).toHaveBeenCalledTimes(1);
});

test("Plans ignores an obsolete position completion and keeps cancellation independent of the report", async () => {
  const source = fixture(),
    busy = vi.fn();
  let resolve!: (lines: WebEngineLine[]) => void;
  analyze.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render(<PhoneEnginePlansPanel fen={source.startFen} onBusy={busy} onPlayLine={() => {}} />);
  await click("Explore plans");
  const signal = analyze.mock.calls[0][0].signal!;
  await render(
    <PhoneEnginePlansPanel fen={source.line[0].fenAfter} onBusy={busy} onPlayLine={() => {}} />,
  );
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(line()));
  expect(host.textContent).not.toContain("evaluated root choices");
  expect(button("Explore plans").disabled).toBe(false);
});
