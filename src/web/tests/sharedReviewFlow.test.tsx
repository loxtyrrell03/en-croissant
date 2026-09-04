import { act } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { expect, it, vi } from "vitest";
import PhoneMistakeReview from "../PhoneMistakeReview";
import { createEmptyWebState } from "../storage";
import { sharedReviewRequest } from "../sharedReviewClient";
import { gradePhoneReview, type PhoneReviewCard } from "../mistakeReview";
vi.mock("../sharedReviewClient", () => ({ sharedReviewRequest: vi.fn() }));
vi.mock("../stockfishEngine", () => ({
  releaseWebPcEngine: vi.fn(),
  analyzeWithWebStockfish18: vi.fn(),
}));

it("opens PC reviews without a username or scan and only advances after the PC saves the grade", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.matchMedia = vi
    .fn()
    .mockImplementation(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
  const card: PhoneReviewCard = {
    id: "pc-card",
    gameKey: "game",
    gameTitle: "Me – Opponent",
    gameDate: "2026.09.04",
    player: "online-user",
    fen: "8/8/8/8/8/8/K7/7k w - - 0 1",
    color: "white",
    ply: 40,
    played: "Ka1",
    best: "a2a3",
    bestSan: "Ka3",
    pv: ["a2a3"],
    pvSan: ["Ka3"],
    refutation: [],
    before: 60,
    after: 20,
    drop: 40,
    explanation: "Keep the chances.",
    createdAt: Date.now(),
    due: 0,
    reviews: 0,
    streak: 0,
  };
  const snapshot = {
    accounts: { chesscom: "online-user", lichess: "second-user" },
    cards: [card],
    enabled: true,
    running: false,
    reviewedGames: 10,
    archivedGames: 100,
    usefulPositionsCount: 1,
    savedAnalysisSummaries: 100,
    updatedAt: Date.now(),
  };
  vi.mocked(sharedReviewRequest).mockResolvedValueOnce(snapshot);
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  const find = (text: string) =>
    [...div.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
  try {
    await act(async () =>
      root.render(
        <MantineProvider>
          <PhoneMistakeReview
            state={createEmptyWebState()}
            onSave={vi.fn()}
            onImport={vi.fn()}
            renderBoard={() => <div>Board</div>}
          />
        </MantineProvider>,
      ),
    );
    expect(div.textContent).toContain("10 games prepared");
    expect(div.querySelector("input[type=text]")).toBeNull();
    expect(find("Daily review").disabled).toBe(false);
    await act(async () => find("Daily review").click());
    await act(async () => find("Reveal solution").click());
    vi.mocked(sharedReviewRequest).mockRejectedValueOnce(new Error("PC offline — retry"));
    await act(async () => find("Got it").click());
    expect(div.textContent).toContain("PC offline — retry");
    expect(div.textContent).not.toContain("Done for today");
    vi.mocked(sharedReviewRequest).mockResolvedValueOnce({
      ...snapshot,
      cards: [gradePhoneReview(card, "good")],
    });
    await act(async () => find("Got it").click());
    expect(sharedReviewRequest).toHaveBeenLastCalledWith("/grade", {
      id: card.id,
      grade: "good",
      expectedReviews: 0,
    });
    expect(div.textContent).toContain("Done for today");
  } finally {
    await act(async () => root.unmount());
    div.remove();
    vi.unstubAllGlobals();
  }
});
