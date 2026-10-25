import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WebApp from "../WebApp";
import { createEmptyWebState } from "../storage";
import { parsePgnDatabase } from "../pgn";
import { webStateSession } from "../webStateSession";
import { phoneWorkspaceKey } from "../workspacePreferences";
import type { WebCompanionState } from "../model";

const persistence = vi.hoisted(() => ({ save: vi.fn(async () => {}) }));
vi.mock("../storage", async (original) => ({
  ...(await original()),
  loadWebState: async () => createEmptyWebState(),
  saveWebState: persistence.save,
}));
vi.mock("@/utils/sharedLichessAuth", () => ({
  loadSharedLichessCredential: async () => null,
  saveSharedLichessCredential: async () => {},
}));
vi.mock("../stockfishEngine", () => ({
  analyzeWithWebStockfish18: vi.fn(),
  stopWebStockfish18Search: vi.fn(),
  releaseWebPcEngine: vi.fn(async () => {}),
}));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("en-croissant-phone-engine-enabled", "false");
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  );
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 25, 12));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function fixture() {
  const parsed = parsePgnDatabase(
    "Invented date lesson",
    '[White "Fixture"]\n[Date "2026.09.25"]\n1. e4 *\n\n[White "Fixture"]\n[Date "2026.10.24"]\n1. d4 *',
    1,
  );
  parsed.database.hostedFilePath = "C:/Fixture/Dates.pgn";
  parsed.database.sourceKind = "source";
  const other = parsePgnDatabase("Other invented date lesson", '[Date "2026.10.20"]\n1. c4 *', 2);
  other.database.hostedFilePath = "C:/Fixture/Other.pgn";
  other.database.sourceKind = "source";
  const state = createEmptyWebState();
  return {
    parsed,
    other,
    state: {
      ...state,
      databases: [parsed.database, other.database],
      gamesByDatabase: { [parsed.database.id]: parsed.games, [other.database.id]: other.games },
      board: {
        ...state.board,
        annotationOwnerId: "date-first",
        sourceDatabaseId: parsed.database.id,
        sourceGameId: parsed.games[0].id,
      },
    } satisfies WebCompanionState,
  };
}
async function mount(state: WebCompanionState) {
  await webStateSession.load();
  webStateSession.setState(state);
  const host = document.createElement("div");
  document.body.append(host);
  let root = createRoot(host);
  await act(async () => root.render(<WebApp />));
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  const click = async (selector: string) =>
    act(async () => {
      const target = host.querySelector<HTMLElement>(selector);
      expect(target).not.toBeNull();
      target!.click();
    });
  const text = async (label: string) =>
    act(async () => {
      const target = Array.from(host.querySelectorAll("button")).find(
        (button) => button.textContent === label,
      );
      expect(target).not.toBeUndefined();
      target!.click();
    });
  const range = async (label: string) => {
    await click('[aria-label="Game date range"]');
    await act(async () => {
      const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
        (item) => item.textContent === label,
      );
      expect(option).not.toBeUndefined();
      option!.click();
    });
    await settle();
  };
  const input = async (label: string, value: string) =>
    act(async () => {
      const field = host.querySelector<HTMLInputElement>(`[aria-label="${label} date"]`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const close = async () => {
    await act(async () => root.unmount());
    await webStateSession.flush();
    host.remove();
  };
  const remount = async () => {
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<WebApp />));
    await settle();
  };
  return { host, settle, click, text, range, input, close, remount };
}

it("persists actual phone calendars independently across files, Database sources and Prep modes, including newly started Prep", async () => {
  const { state, other } = fixture(),
    key = phoneWorkspaceKey(state);
  const h = await mount(state);
  const selected = () =>
    h.host.querySelector<HTMLInputElement>('[aria-label="Game date range"]')?.value;
  try {
    await h.click('[role="tab"][aria-label="Database"]');
    await h.range("Custom range…");
    await h.input("From", "2026-10-01");
    await h.input("To", "2026-10-25");
    await h.text("Apply dates");
    await h.settle();
    expect(
      webStateSession.getSnapshot().state.workspacePreferences?.[key]?.gameDates?.database?.local,
    ).toEqual({ period: "custom", since: "2026-10-01", until: "2026-10-25" });
    await h.text("Start");
    expect(
      Array.from(h.host.querySelectorAll("tbody"))
        .map((item) => item.textContent)
        .join(" "),
    ).toContain("d4");
    expect(
      Array.from(h.host.querySelectorAll("tbody"))
        .map((item) => item.textContent)
        .join(" "),
    ).not.toContain("e4");
    await h.click('[aria-label="Return to database settings"]');
    await h.click('[aria-label="Database source"] input[value="lichess-all"]');
    expect(selected()).toBe("All time");
    await h.range("Last year");
    await h.click('[aria-label="Database source"] input[value="local"]');
    expect(selected()).toBe("Custom range…");
    const firstBoard = webStateSession.getSnapshot().state.board;
    await act(async () =>
      webStateSession.setState((current) => ({
        ...current,
        board: {
          ...current.board,
          annotationOwnerId: "date-other",
          sourceDatabaseId: other.database.id,
          sourceGameId: other.games[0].id,
        },
      })),
    );
    await h.settle();
    expect(selected()).toBe("All time");
    await act(async () =>
      webStateSession.setState((current) => ({ ...current, board: firstBoard })),
    );
    await h.settle();
    expect(selected()).toBe("Custom range…");
    await h.click('[role="tab"][aria-label="Prep"]');
    expect(selected()).toBe("All time");
    await h.range("Last month");
    await h.click('[aria-label="Prep target"] input[value="general"]');
    expect(selected()).toBe("All time");
    await h.text("Lichess All");
    await vi.waitFor(() =>
      expect(document.querySelector('[aria-label="Search databases"]')).not.toBeNull(),
    );
    await act(async () => {
      const search = document.querySelector<HTMLInputElement>('[aria-label="Search databases"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        search,
        "Invented date lesson",
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.startsWith("Invented date lesson"))!
        .click(),
    );
    await h.range("Last 3 months");
    await h.click('[aria-label="Prep target"] input[value="player"]');
    expect(selected()).toBe("Last month");
    await h.click('[aria-label="Prep target"] input[value="general"]');
    await h.text("Start prep");
    await h.settle();
    const active = webStateSession.getSnapshot().state.prepWorkspaces[0];
    expect(active.dateRanges?.["general:local"].period).toBe("3m");
    expect(active.dateRanges?.["player:local"].period).toBe("1m");
    await act(async () => {
      await webStateSession.flush();
    });
    await h.remount();
    await h.click('[role="tab"][aria-label="Prep"]');
    expect(selected()).toBe("Last 3 months");
    expect(persistence.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prepWorkspaces: expect.arrayContaining([
          expect.objectContaining({ dateRanges: expect.any(Object) }),
        ]),
      }),
    );
    expect(h.host.textContent).not.toContain("This view could not open");
  } finally {
    await h.close();
  }
}, 15_000);

it("refreshes the real active Prep training rows after the local calendar advances", async () => {
  const { state, parsed } = fixture();
  const prep = {
    id: "dated-prep",
    name: "Invented rolling prep",
    mode: "general" as const,
    source: "local" as const,
    opponent: "",
    userColor: "black" as const,
    sourceIds: [parsed.database.id],
    startFen: state.board.startFen,
    line: [],
    notesByFen: {},
    preparedMoves: {},
    minGames: 1,
    panelStage: "train" as const,
    createdAt: 1,
    updatedAt: 1,
    dateRanges: { "general:local": { period: "1m" as const, since: "", until: "" } },
  };
  const h = await mount({ ...state, activePrepId: prep.id, prepWorkspaces: [prep] });
  const rows = () =>
    Array.from(h.host.querySelectorAll("tbody"))
      .map((item) => item.textContent)
      .join(" ");
  try {
    await h.click('[role="tab"][aria-label="Prep"]');
    expect(rows()).toContain("e4");
    expect(rows()).toContain("d4");
    await act(async () => {
      vi.setSystemTime(new Date(2026, 9, 26, 12));
      window.dispatchEvent(new Event("focus"));
    });
    await h.settle();
    expect(rows()).not.toContain("e4");
    expect(rows()).toContain("d4");
    expect(
      webStateSession.getSnapshot().state.prepWorkspaces[0].dateRanges?.["general:local"].period,
    ).toBe("1m");
  } finally {
    await h.close();
  }
});

it.each([false, true])(
  "blocks an unsupported lazy date filter (invalid=%s) until the user explicitly clears it",
  async (invalid) => {
    const { state, parsed } = fixture();
    parsed.database.hostedLazy = true;
    parsed.database.hostedPath = `Databases/Fixture/dates-${invalid}`;
    const key = phoneWorkspaceKey(state);
    const range = {
      period: "custom" as const,
      since: invalid ? "2026-12-31" : "2026-01-01",
      until: "2026-10-25",
    };
    const h = await mount({
      ...state,
      workspacePreferences: {
        [key]: {
          database: invalid ? { source: "retired-source" } : undefined,
          gameDates: { database: { local: range } },
        },
      },
    });
    try {
      await h.click('[role="tab"][aria-label="Database"]');
      await h.settle();
      expect(
        h.host.querySelector('[data-phone-date-scope="database"] [role="alert"]')?.textContent,
      ).toContain(invalid ? "Saved dates are invalid" : "full PGN import");
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(([url]) => String(url).includes("/api/database-position?")),
      ).toBe(false);
      if (invalid) await h.text("Clear date filter");
      else await h.range("All time");
      await vi.waitFor(async () => {
        await h.settle();
        expect(
          vi
            .mocked(fetch)
            .mock.calls.some(([url]) => String(url).includes("/api/database-position?")),
        ).toBe(true);
      });
      expect(
        webStateSession.getSnapshot().state.workspacePreferences?.[key]?.gameDates?.database?.local
          .period,
      ).toBe("all");
    } finally {
      await h.close();
    }
  },
);
