import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createEmptyCard } from "ts-fsrs";
import { expect, test, vi } from "vitest";
import type { Position } from "@/components/files/opening";
import { MistakeDecisionCheck } from "./MistakeDecisionCheck";

const mocks = vi.hoisted(() => ({ gather: vi.fn(), classify: vi.fn() }));
vi.mock("@/state/atoms", async () => {
  const { atom } = await import("jotai");
  return {
    enginesAtom: atom([
      {
        type: "local",
        id: "stockfish-test",
        path: "fixture-engine",
        name: "Stockfish",
        version: "test",
      },
    ]),
  };
});
vi.mock("@/components/panels/tactics/decisionSearch", () => ({
  gatherDecisionEvidence: mocks.gather,
}));
vi.mock("@/components/panels/tactics/decisionReportWorker", () => ({
  classifyDecisionInWorker: mocks.classify,
}));

test("revealing a valid card enables on-demand analysis and changing cards cancels the owned search", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const fen = "6k1/p4ppp/8/8/8/8/7P/4R2K b - - 0 1";
  const position: Position = {
    fen,
    answer: "h6",
    card: createEmptyCard(),
    mistakeReview: { playedMoveSan: "a6", gameId: 1, tacticalHistory: { fen, moves: [] } },
  };
  let signal: AbortSignal | undefined;
  mocks.gather.mockImplementation((_engine, _target, active: AbortSignal) => {
    signal = active;
    return new Promise((_, reject) =>
      active.addEventListener("abort", () => reject(active.reason), { once: true }),
    );
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (value: Position, revealed: boolean) =>
    act(async () =>
      root.render(
        <MantineProvider>
          <MistakeDecisionCheck position={value} revealAnswer={revealed} />
        </MantineProvider>,
      ),
    );
  try {
    await render(position, false);
    expect(host.textContent).not.toContain("Analyse this mistake");
    expect(mocks.gather).not.toHaveBeenCalled();
    await render(position, true);
    const start = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Analyse this mistake",
    );
    expect(start).toBeTruthy();
    await act(async () => start?.click());
    expect(mocks.gather.mock.calls[0][1]).toEqual({
      fen,
      playedMoveUci: "a7a6",
      history: { fen, moves: [] },
    });
    expect(signal?.aborted).toBe(false);
    await render({ ...position, mistakeReview: { playedMoveUci: "g8g6", gameId: 2 } }, true);
    expect(signal?.aborted).toBe(true);
    expect(host.textContent).not.toContain("Analyse this mistake");
    expect(mocks.classify).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
