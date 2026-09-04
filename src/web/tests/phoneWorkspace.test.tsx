// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { it, vi, expect } from "vitest";
import { INITIAL_FEN } from "chessops/fen";
import { createEmptyWebState } from "../storage";
import { parsePgnDatabase } from "../pgn";
import WebApp from "../WebApp";
import { DEFAULT_WEB_OTB_IMPORT_SOURCES, type WebOtbImportJob } from "../otbImport";
const watcher = vi.hoisted(() => ({ callback: null as ((job: WebOtbImportJob) => void) | null }));
vi.mock("../otbImport", async (original) => ({
  ...(await original()),
  watchWebOtbImportJob: (_id: string, callback: (job: WebOtbImportJob) => void) => {
    watcher.callback = callback;
    return () => {};
  },
}));
vi.mock("../storage", async (original) => ({
  ...(await original()),
  loadWebState: async () => fixture,
  saveWebState: async () => {},
}));
vi.mock("@/utils/sharedLichessAuth", () => ({
  loadSharedLichessCredential: async () => null,
  saveSharedLichessCredential: async () => {},
}));
const fixture = createEmptyWebState();
it("renders a finished OTB database and opens Prep without crashing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  );
  const parsed = parsePgnDatabase(
    "OTB",
    '[White "Test Player"]\n[Black "Opponent"]\n\n1. e4 e5 2. Nf3 Nc6 *',
  );
  fixture.databases = [parsed.database];
  fixture.gamesByDatabase = { [parsed.database.id]: parsed.games };
  fixture.activePrepId = "test";
  fixture.prepWorkspaces = [
    {
      id: "test",
      name: "OTB prep",
      opponent: parsed.database.playerNames[0],
      userColor: "black",
      source: "local",
      sourceIds: [parsed.database.id],
      startFen: INITIAL_FEN,
      line: [],
      notesByFen: {},
      preparedMoves: {},
      panelStage: "setup",
      createdAt: 0,
      updatedAt: 0,
    },
  ];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<WebApp />);
    });
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Prep",
    )!;
    await act(async () => {
      button.click();
    });
    expect(container.textContent).toContain(parsed.database.playerNames[0]);
    expect(container.textContent).toContain("I'm Black");
    const prepSide = container.querySelector<HTMLInputElement>(
      '[aria-label="Your prep side"] input[value="black"]',
    );
    expect(prepSide?.checked).toBe(true);
    const whiteSide = container.querySelector<HTMLInputElement>(
      '[aria-label="Your prep side"] input[value="white"]',
    );
    await act(async () => whiteSide?.click());
    expect(whiteSide?.checked).toBe(true);
    expect(container.querySelector(".orientation-white")).not.toBeNull();
    // A newly finished import must keep its results accessible rather than mounting Prep.
    window.localStorage.setItem("encroissant-web-otb-job", "completed-test");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1600));
    });
    expect(watcher.callback).not.toBeNull();
    const job: WebOtbImportJob = {
      id: "completed-test",
      status: "completed",
      request: {
        playerName: "Test Player",
        fideId: "123456",
        fromYear: 2000,
        sources: DEFAULT_WEB_OTB_IMPORT_SOURCES,
      },
      progress: null,
      report: {
        playerName: "Test Player",
        fideId: "123456",
        cancelled: false,
        gamesFound: 1,
        duplicatesRemoved: 0,
      },
      games: [],
      prepDatabase: parsed,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: null,
    };
    await act(async () => watcher.callback!(job));
    expect(
      container.querySelector('button[data-view="import"]')?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(container.textContent).toContain("Review mistakes across my games");
    expect(container.textContent).not.toContain("This view could not open");
    expect(window.localStorage.getItem("encroissant-web-otb-prep-handled-job")).toBe(
      "completed-test",
    );
  } finally {
    await act(async () => root.unmount());
    window.localStorage.clear();
    container.remove();
    vi.unstubAllGlobals();
  }
});
