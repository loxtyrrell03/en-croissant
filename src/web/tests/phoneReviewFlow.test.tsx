import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { expect, it, vi } from "vitest";
import PhoneMistakeReview from "../PhoneMistakeReview";
import { createEmptyWebState } from "../storage";
import { parsePgnDatabase, playUciMove } from "../pgn";
import { reviewMistakeFrames } from "../reviewVisuals";
import { emptyPhoneReview } from "../mistakeReview";
vi.mock("../stockfishEngine", () => ({
  releaseWebPcEngine: vi.fn(async () => {}),
  analyzeWithWebStockfish18: vi.fn(async ({ fen }) => [
    {
      source: "stockfish",
      depth: 14,
      multipv: 1,
      score: { type: "cp", value: fen.split(" ")[1] === "w" ? 50 : -450 },
      uciMoves: fen.split(" ")[1] === "w" ? ["e2e4"] : ["e7e5"],
      sanMoves: fen.split(" ")[1] === "w" ? ["e4"] : ["e5"],
    },
  ]),
}));
it("scans imported games, saves cards, hides the answer, and completes a daily review", async () => {
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
  const imported = parsePgnDatabase(
    "review",
    '[White "Tester"]\n[Black "Opponent"]\n\n1. f3 e5 2. g4 Qh4# 0-1',
  );
  let latest = createEmptyWebState();
  latest.databases = [imported.database];
  latest.gamesByDatabase = { [imported.database.id]: imported.games };
  latest.mistakeReview = { ...emptyPhoneReview(), player: "Tester" };
  function Harness() {
    const [state, setState] = useState(latest);
    return (
      <MantineProvider>
        <PhoneMistakeReview
          state={state}
          onSave={(r) =>
            setState((s) => {
              latest = { ...s, mistakeReview: r };
              return latest;
            })
          }
          onImport={() => {}}
          renderBoard={(fen, _color, onMove, lastMove, interactive, shapes) => (
            <div
              data-testid="practice"
              data-fen={fen}
              data-last-move={lastMove}
              data-interactive={interactive}
              data-shapes={JSON.stringify(shapes)}
            >
              <button onClick={() => onMove("a2a3")}>Practice board</button>
              <button onClick={() => onMove(latest.mistakeReview!.cards[0].best)}>Best move</button>
            </div>
          )}
        />
      </MantineProvider>
    );
  }
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  const button = (text: string) =>
    [...div.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
  try {
    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      button("Find my mistakes").click();
    });
    expect(latest.mistakeReview!.scanned).toHaveLength(1);
    expect(latest.mistakeReview!.cards.length).toBeGreaterThan(0);
    await act(async () => {
      button("Daily review").click();
    });
    expect(div.textContent).toContain("Practice board");
    expect(div.textContent).not.toContain("· Mistake");
    const attemptedBoard = button("Practice board");
    await act(async () => attemptedBoard.click());
    expect(attemptedBoard.isConnected).toBe(true);
    const board = () => div.querySelector('[data-testid="practice"]')!;
    const card = latest.mistakeReview!.cards[0];
    expect(board().getAttribute("data-fen")).toBe(playUciMove(card.fen, "a2a3")!.fenAfter);
    expect(board().getAttribute("data-interactive")).toBe("false");
    expect(div.textContent).toContain("Try again");
    await act(async () => {
      button("Try again").click();
    });
    expect(board().getAttribute("data-fen")).toBe(card.fen);
    expect(board().getAttribute("data-interactive")).toBe("true");
    await act(async () => {
      button("Best move").click();
    });
    expect(div.querySelector('[role="status"]')?.getAttribute("data-tone")).toBe("green");
    expect(board().getAttribute("data-shapes")).toContain('"brush":"green"');
    expect(board().getAttribute("data-fen")).toBe(playUciMove(card.fen, card.best)!.fenAfter);
    expect(board().getAttribute("data-last-move")).toBe(card.best);
    await act(async () => button("· Mistake").click());
    const frames = reviewMistakeFrames(card);
    expect(board().getAttribute("data-fen")).toBe(frames[0].fen);
    expect(board().getAttribute("data-shapes")).toContain('"brush":"red"');
    if (frames.length > 1) {
      await act(async () => button("Show punishment").click());
      expect(board().getAttribute("data-fen")).toBe(frames[1].fen);
    }
    await act(async () => button("· Best").click());
    expect(board().getAttribute("data-fen")).toBe(playUciMove(card.fen, card.best)!.fenAfter);
    await act(async () => {
      button("Got it").click();
    });
    expect(latest.mistakeReview!.cards.some((c) => c.reviews === 1)).toBe(true);
    expect(div.textContent).toContain("Done for today");
  } finally {
    await act(async () => root.unmount());
    div.remove();
    vi.unstubAllGlobals();
  }
});
