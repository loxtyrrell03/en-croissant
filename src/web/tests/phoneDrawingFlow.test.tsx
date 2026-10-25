import { act } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { expect, it, vi } from "vitest";
import WebApp, { WebChessboard } from "../WebApp";
import { createEmptyWebState } from "../storage";
import { parsePgnDatabase, webGameToLine } from "../pgn";
import { webStateSession } from "../webStateSession";
import { savedPhoneDrawings } from "../phoneAnnotations";

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
// Real Chessground rendering/handlers; only this JSDOM fixture permits synthetic
// input events. Production retains the library's trusted-event guard.
vi.mock("@lichess-org/chessground", async (original) => {
  const actual = await original<typeof import("@lichess-org/chessground")>();
  return {
    ...actual,
    Chessground: (
      element: Parameters<typeof actual.Chessground>[0],
      config: Parameters<typeof actual.Chessground>[1],
    ) => actual.Chessground(element, { ...config, trustAllEvents: true }),
  };
});

it("draws by square taps and native Chessground gestures, keeps imported marks, navigates and durably exports the chosen node", async () => {
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
  const bounds = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 320,
    bottom: 320,
    width: 320,
    height: 320,
    toJSON: () => ({}),
  });
  const imported = parsePgnDatabase(
    "Invented drawing game",
    "{Root [%csl Yd4]} 1. e4 {[%cal Ge2e4]} e5 *",
    1,
  );
  const source = imported.games[0];
  await webStateSession.load();
  webStateSession.setState((state) => ({
    ...state,
    databases: [imported.database],
    gamesByDatabase: { [source.databaseId]: [source] },
    board: {
      ...state.board,
      annotationOwnerId: "flow",
      line: webGameToLine(source),
      cursor: 0,
      sourceDatabaseId: source.databaseId,
      sourceGameId: source.id,
    },
  }));
  await webStateSession.flush();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
    });
  const click = async (selector: string) =>
    act(async () => {
      const button = host.querySelector<HTMLButtonElement>(selector)!;
      expect(button).toBeTruthy();
      expect(button.disabled).toBe(false);
      button.click();
    });
  const squarePosition = (square: string) => ({
    clientX: (square.charCodeAt(0) - 97 + 0.5) * 40,
    clientY: (8 - Number(square[1]) + 0.5) * 40,
  });
  const tap = async (square: string) => {
    await act(async () => {
      const board = host.querySelector("cg-board")!;
      const point = { identifier: 1, target: board, ...squarePosition(square) };
      for (const type of ["touchstart", "touchend"]) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, {
          touches: { value: type === "touchstart" ? [point] : [] },
          targetTouches: { value: type === "touchstart" ? [point] : [] },
          changedTouches: { value: [point] },
        });
        board.dispatchEvent(event);
      }
    });
    await settle();
  };
  try {
    localStorage.setItem("en-croissant-phone-engine-enabled", "false");
    await act(async () => root.render(<WebApp />));
    await vi.waitFor(async () => {
      await settle();
      expect(host.querySelector('[role="tab"][aria-label="Moves"]')).not.toBeNull();
    });
    await click('[role="tab"][aria-label="Moves"]');
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Help: Board drawings"]')!.focus(),
    );
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("same square twice");
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    const drawButton = () =>
      Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Draw")!;
    await act(async () => drawButton().click());
    expect(drawButton().getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[aria-label="Draw green"]')).not.toBeNull();
    expect(host.querySelectorAll("cg-board piece")).toHaveLength(32);
    await tap("c3");
    await tap("c5");
    expect(savedPhoneDrawings(webStateSession.getSnapshot().state)).toEqual([
      { orig: "d4", brush: "yellow" },
      { orig: "c3", dest: "c5", brush: "green" },
    ]);
    await click('[aria-label="Draw red"]');
    await tap("f4");
    await tap("f4");
    expect(savedPhoneDrawings(webStateSession.getSnapshot().state)).toContainEqual({
      orig: "f4",
      brush: "red",
    });
    await settle();
    expect(host.querySelector("svg.cg-shapes line")).not.toBeNull();
    expect(host.querySelectorAll("svg.cg-shapes circle").length).toBeGreaterThanOrEqual(2);
    await tap("a3"); // A half-finished arrow cannot follow navigation.
    await click('[aria-label="Next move"]');
    await tap("a5");
    expect(savedPhoneDrawings(webStateSession.getSnapshot().state)).toEqual([
      { orig: "e2", dest: "e4", brush: "green" },
    ]);
    await act(async () => drawButton().click());
    expect(drawButton().getAttribute("aria-pressed")).toBe("false");
    await tap("a4"); // Ordinary empty-square clicks keep the saved mark.
    expect(savedPhoneDrawings(webStateSession.getSnapshot().state)).toEqual([
      { orig: "e2", dest: "e4", brush: "green" },
    ]);
    await act(async () => {
      host.querySelector("cg-board")!.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 2,
          buttons: 2,
          ...squarePosition("d1"),
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, buttons: 2, ...squarePosition("d3") }),
      );
    });
    await settle();
    await act(async () =>
      document.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, button: 2, ...squarePosition("d3") }),
      ),
    );
    await settle();
    expect(savedPhoneDrawings(webStateSession.getSnapshot().state)).toEqual([
      { orig: "e2", dest: "e4", brush: "green" },
      { orig: "d1", dest: "d3", brush: "green" },
    ]);
    await webStateSession.flush();
    const durable = webStateSession.getSnapshot().savedState!;
    const reloaded = parsePgnDatabase("Reload", durable.gamesByDatabase[source.databaseId][0].pgn)
      .games[0];
    expect(reloaded.rootShapes).toHaveLength(3);
    expect(reloaded.moves[0].shapes).toHaveLength(2);
    expect(reloaded.moves.map((move) => move.san)).toEqual(["e4", "e5"]);
    expect(source.rootShapes).toEqual([{ orig: "d4", brush: "yellow" }]);
    expect(source.moves[0].shapes).toEqual([{ orig: "e2", dest: "e4", brush: "green" }]);
    expect(persistence.save).toHaveBeenLastCalledWith(durable);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    bounds.mockRestore();
    vi.unstubAllGlobals();
  }
}, 15_000);

it("keeps saved drawings separate from changing engine overlays in the real renderer", async () => {
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
  const bounds = vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 320,
      bottom: 320,
      width: 320,
      height: 320,
      toJSON: () => ({}),
    });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const changes = vi.fn();
  const saved = [{ orig: "a2", dest: "a4", brush: "green" as const }];
  const render = async (engineDestination: "c3" | "a3", keepSaved = true, brush = "blue") => {
    await act(async () => {
      root.render(
        <MantineProvider>
          <WebChessboard
            fen={createEmptyWebState().board.startFen}
            orientation="white"
            lastMoveUci={null}
            savedDrawings={keepSaved ? saved : []}
            onDrawingsChange={changes}
            engineArrowShapes={[{ orig: "b1", dest: engineDestination, brush }]}
            engineScore={null}
            onMove={() => {}}
            canGoToPreviousMove={false}
            canGoToNextMove={false}
            onPreviousMove={() => {}}
            onNextMove={() => {}}
          />
        </MantineProvider>,
      );
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  };
  try {
    await render("c3");
    expect(host.querySelectorAll("svg.cg-shapes line")).toHaveLength(2);
    await render("a3");
    expect(host.querySelectorAll("svg.cg-shapes line")).toHaveLength(2);
    await render("a3", true, "planWhite");
    expect(host.querySelectorAll("svg.cg-shapes line")).toHaveLength(2);
    expect(Array.from(host.querySelectorAll("svg.cg-shapes line")).some(line => line.getAttribute("stroke") === "#228be6")).toBe(true);
    await render("a3", false);
    expect(host.querySelectorAll("svg.cg-shapes line")).toHaveLength(1);
    expect(changes).not.toHaveBeenCalled();
    expect(saved).toEqual([{ orig: "a2", dest: "a4", brush: "green" }]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    bounds.mockRestore();
    vi.unstubAllGlobals();
  }
});
