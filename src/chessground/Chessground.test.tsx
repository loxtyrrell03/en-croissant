import { MantineProvider } from "@mantine/core";
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { boardStyleAtom } from "@/state/atoms";
import { Chessground } from "./Chessground";
vi.mock("@/state/atoms", async () => {
  const { atom } = await import("jotai");
  return {
    boardImageAtom: atom(""),
    boardStyleAtom: atom("default"),
    moveMethodAtom: atom("both"),
  };
});

test("real Chessground renders saved marks without caller brushes and restores the base palette after a style change", async () => {
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
  const atoms = createStore(),
    container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const stroke = () => container.querySelector("svg line")?.getAttribute("stroke");
  const expectStroke = async (color: string, opacity: string) =>
    vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(stroke()?.toLowerCase()).toBe(color.toLowerCase());
      expect(container.querySelector("svg line")?.getAttribute("opacity")).toBe(opacity);
    });
  try {
    await act(async () =>
      root.render(
        <MantineProvider>
          <Provider store={atoms}>
            <Chessground
              viewOnly
              drawable={{
                enabled: false,
                visible: true,
                shapes: [{ orig: "e2", dest: "e4", brush: "green" }],
              }}
            />
          </Provider>
        </MantineProvider>,
      ),
    );
    await expectStroke("#15781b", "1");
    await act(async () => atoms.set(boardStyleAtom, "chess-com"));
    await expectStroke("#15781b", "0.78");
    await act(async () => atoms.set(boardStyleAtom, "default"));
    await expectStroke("#15781b", "1");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
