import { webcrypto } from "node:crypto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { parsePgnDatabase, webGameToLine } from "../pgn";
import { createEmptyWebState } from "../storage";
import { webStateSession } from "../webStateSession";
import { analyzeWithWebStockfish18 } from "../stockfishEngine";
import WebApp from "../WebApp";
vi.mock("../storage", async (original) => ({
  ...(await original()),
  loadWebState: async () => createEmptyWebState(),
  saveWebState: async () => {},
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
test("the real phone Board Analysis path saves a report, selects its mistake and plays a Plans line without changing the source game", async () => {
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  );
  Element.prototype.scrollIntoView = vi.fn();
  const imported = parsePgnDatabase(
      "Invented analysis",
      '[White "Fixture White"]\n[Black "Fixture Black"]\n1. e4 e5 *',
      1,
    ),
    game = imported.games[0];
  await webStateSession.load();
  webStateSession.setState((state) => ({
    ...state,
    databases: [imported.database],
    gamesByDatabase: { [imported.database.id]: imported.games },
    board: {
      ...state.board,
      startFen: game.moves[0].fenBefore,
      line: webGameToLine(game),
      cursor: 0,
      sourceDatabaseId: game.databaseId,
      sourceGameId: game.id,
    },
  }));
  await webStateSession.flush();
  const engine = vi.mocked(analyzeWithWebStockfish18);
  engine.mockImplementation(async (request) =>
    request.planSearch
      ? [
          {
            source: "stockfish",
            multipv: 1,
            depth: 17,
            score: { type: "cp", value: 20 },
            uciMoves: ["e7e5", "g1f3", "b8c6"],
            sanMoves: ["e5", "Nf3", "Nc6"],
          },
        ]
      : [
          {
            source: "stockfish",
            engineName: "Fixture engine",
            multipv: 1,
            depth: 7,
            score: { type: "cp", value: request.fen === game.moves[0].fenAfter ? -500 : 20 },
            uciMoves: ["e2e4"],
            sanMoves: ["e4"],
          },
        ],
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const tick = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  const click = async (scope: ParentNode, name: string) =>
    act(async () => {
      const button = Array.from(scope.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === name,
      )!;
      expect(button).toBeTruthy();
      expect(button.disabled).toBe(false);
      button.click();
    });
  const switchView = (value: string) =>
    act(async () => (host.querySelector(`input[value="${value}"]`) as HTMLInputElement).click());
  try {
    await act(async () => root.render(<WebApp />));
    await vi.waitFor(async () => {
      await tick();
      expect(host.querySelector('[role="tab"][aria-label="Analysis"]')).not.toBeNull();
    });
    await act(async () =>
      (host.querySelector('[role="tab"][aria-label="Analysis"]') as HTMLButtonElement).click(),
    );
    await switchView("report");
    const panel = host.querySelector('[data-testid="phone-game-report"]')!;
    await vi.waitFor(async () => {
      await tick();
      expect(
        Array.from(panel.querySelectorAll("button")).find(
          (button) => button.textContent === "Analyze game",
        )?.disabled,
      ).toBe(false);
    });
    await act(async () => (panel.querySelector('input[value="low"]') as HTMLInputElement).click());
    await click(panel, "Analyze game");
    await vi.waitFor(async () => {
      await tick();
      expect(panel.querySelector('[aria-label="Saved game report"]')).not.toBeNull();
    });
    expect(engine.mock.calls.filter(([request]) => request.reportLimits)).toHaveLength(3);
    const mistake = Array.from(panel.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("blunder"),
    )!;
    await act(async () => mistake.click());
    expect(webStateSession.getSnapshot().state.board.cursor).toBe(1);
    await switchView("plans");
    const plans = host.querySelector('[data-testid="phone-engine-plans"]')!;
    await click(plans, "Explore plans");
    await vi.waitFor(async () => {
      await tick();
      expect(plans.textContent).toContain("1 evaluated root choices");
    });
    await act(async () =>
      (plans.querySelector('button[aria-expanded="false"]') as HTMLButtonElement).click(),
    );
    await click(plans, "Play this line");
    const saved = webStateSession.getSnapshot().state;
    expect(saved.board.line.map((move) => move.san)).toEqual(["e4", "e5", "Nf3", "Nc6"]);
    expect(saved.gamesByDatabase[game.databaseId][0].moves.map((move) => move.san)).toEqual([
      "e4",
      "e5",
    ]);
    expect(Object.keys(saved.gameReports!)).toHaveLength(1);
    expect(host.textContent).not.toContain("This view could not open");
    expect(
      engine.mock.calls.filter(([request]) => !request.reportLimits && !request.planSearch),
    ).toHaveLength(0); // Live engine remains explicitly Off.
  } finally {
    await act(async () => root.unmount());
    await webStateSession.flush();
    host.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
