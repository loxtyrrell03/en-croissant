// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import WebApp from "../WebApp";
import { createEmptyWebState } from "../storage";
import { parsePgnDatabase } from "../pgn";
const fixture = createEmptyWebState();
vi.mock("../storage", async (original) => ({
  ...(await original()),
  loadWebState: async () => fixture,
  saveWebState: async () => {},
}));
vi.mock("@/utils/sharedLichessAuth", () => ({ loadSharedLichessCredential: async () => null }));
it("handles a real watcher completion while the OTB import screen is mounted", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as any;
  let imported = parsePgnDatabase("OTB", '[White "Test Player"]\n[Black "Opponent"]\n\n1. e4 e5 *');
  if (process.env.OTB_TEST_ARTIFACT) {
    const { readFileSync } = await import("node:fs");
    imported = JSON.parse(readFileSync(process.env.OTB_TEST_ARTIFACT, "utf8")).prepDatabase;
  }
  let complete = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (String(url).includes("/api/otb-import/jobs/"))
        return Response.json({
          id: "handoff-test",
          status: complete ? "completed" : "running",
          request: { playerName: "Test Player", sources: {} },
          report: { playerName: "Test Player", gamesFound: imported.games.length },
          prepDatabase: complete ? imported : null,
          games: [],
          createdAt: new Date().toISOString(),
        });
      return Response.json({});
    }),
  );
  window.localStorage.setItem("encroissant-web-otb-job", "handoff-test");
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  try {
    await act(async () => root.render(<WebApp />));
    await act(async () =>
      (div.querySelector('button[data-view="import"]') as HTMLButtonElement).click(),
    );
    const otb = [...div.querySelectorAll("label")].find((l) => l.textContent === "OTB")!;
    await act(async () => otb.click());
    complete = true;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(div.textContent).toContain(imported.database.name);
    expect(div.textContent).not.toContain("This view could not open");
    expect(div.textContent).not.toContain("The app could not display this screen");
    expect(div.querySelector('button[data-view="import"]')).not.toBeNull();
    expect(window.localStorage.getItem("encroissant-web-otb-prep-handled-job")).toBe(
      "handoff-test",
    );
  } finally {
    await act(async () => root.unmount());
    div.remove();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  }
});
