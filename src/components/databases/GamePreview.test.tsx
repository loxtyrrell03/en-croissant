import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { parsePgnTokens } from "@/utils/chess";
import type { Config } from "@lichess-org/chessground/config";
import { GamePreview } from "./GamePreview";
vi.mock("../common/GameNotation", () => ({ default: () => null }));
vi.mock("../common/MoveControls", () => ({ default: () => null }));
vi.mock("@/chessground/Chessground", () => ({
  Chessground: ({ fen, orientation, drawable, viewOnly }: Config) => (
    <div
      data-testid="preview-board"
      data-fen={fen}
      data-orientation={orientation}
      data-drawable={JSON.stringify(drawable)}
      data-view-only={viewOnly}
    />
  ),
}));
vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));
test("native preview keeps imported perspective while saved marks follow the selected node", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const game = parsePgnTokens([
    { type: "Header", value: { tag: "Orientation", value: " Black " } },
    { type: "Comment", value: "Root [%cal Ge2e4]" },
    { type: "San", value: "e4" },
    { type: "Comment", value: "Played [%csl Rd4]" },
  ]);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <MantineProvider>
          <GamePreview game={game} hideControls />
        </MantineProvider>,
      ),
    );
    let board = container.querySelector('[data-testid="preview-board"]')!;
    expect(board.getAttribute("data-orientation")).toBe("black");
    expect(JSON.parse(board.getAttribute("data-drawable")!)).toMatchObject({
      enabled: false,
      visible: true,
      shapes: [{ orig: "e2", dest: "e4", brush: "green" }],
    });
    await act(async () =>
      board.parentElement!.dispatchEvent(new WheelEvent("wheel", { deltaY: 1, bubbles: true })),
    );
    board = container.querySelector('[data-testid="preview-board"]')!;
    expect(board.getAttribute("data-orientation")).toBe("black");
    expect(JSON.parse(board.getAttribute("data-drawable")!).shapes).toEqual([
      { orig: "d4", brush: "red" },
    ]);
    expect(board.getAttribute("data-view-only")).toBe("true");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
