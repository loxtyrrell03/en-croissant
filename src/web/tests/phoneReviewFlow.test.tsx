import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { expect, it, vi } from "vitest";
import PhoneMistakeReview from "../PhoneMistakeReview";
import { createEmptyWebState } from "../storage";
import { parsePgnDatabase } from "../pgn";
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
          renderBoard={(_fen, _color, onMove) => (
            <button onClick={() => onMove("a2a3")}>Practice board</button>
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
    expect(div.textContent).not.toContain("improves on");
    const attemptedBoard = button("Practice board");
    await act(async () => attemptedBoard.click());
    expect(attemptedBoard.isConnected).toBe(false);
    expect(div.textContent).toContain("Try again");
    await act(async () => {
      button("Reveal solution").click();
    });
    expect(div.textContent).toContain("improves on");
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
