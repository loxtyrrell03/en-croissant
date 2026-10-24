import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { createEmptyWebState } from "../storage";
import { webStateSession } from "../webStateSession";
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

test("the phone PGN import action opens an unplayed FEN and respects a later explicit orientation", async () => {
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
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const fen = "7k/6pp/8/8/8/8/6PP/KR6 b - - 0 20";
  const tick = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  try {
    await act(async () => {
      root.render(<WebApp />);
    });
    await vi.waitFor(async () => {
      await tick();
      expect(container.querySelector('button[data-view="import"]')).not.toBeNull();
    });
    for (const orientation of [undefined, "white"] as const) {
      await act(async () =>
        (container.querySelector('button[data-view="import"]') as HTMLButtonElement).click(),
      );
      const textarea = container.querySelector("textarea")!;
      const pgn = `[White "Invented"]\n[Black "Fixture"]\n[SetUp "1"]\n[FEN "${fen}"]\n${orientation ? '[Orientation " White "]\n' : ""}\n*`;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          textarea,
          pgn,
        );
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const submit = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "Import pasted games",
      )!;
      expect(submit.disabled).toBe(false);
      await act(async () => submit.click());
      await vi.waitFor(async () => {
        await tick();
        expect(webStateSession.getSnapshot().state.board).toMatchObject({
          startFen: fen,
          orientation: orientation ?? "black",
          cursor: 0,
          line: [],
        });
        expect(container.querySelector(`.orientation-${orientation ?? "black"}`)).not.toBeNull();
      });
    }
    expect(container.textContent).not.toContain("This view could not open");
  } finally {
    await act(async () => root.unmount());
    await webStateSession.flush();
    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
