import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { engineArrowsAllowed, type PlanPreviewLines } from "@/utils/planArrowLayers";
import { useAutoPlanArrowClaim, usePlanArrowPreview, usePlanArrowSnapshot } from "./usePlanArrows";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const fen = "fixture-position-A";
let controls: Record<string, (lines: PlanPreviewLines | null) => void>;
const line = {
  squares: ["g1", "f3"],
  san: [],
  uci: ["g1f3"],
  games: 10,
  white: 5,
  draw: 3,
  black: 2,
};
function Owner({
  board,
  id,
  enabled = true,
  position = fen,
  kind = "plans",
}: {
  board: object;
  id: string;
  enabled?: boolean;
  position?: string;
  kind?: "plans" | "engine-plans";
}) {
  useAutoPlanArrowClaim(board, kind, enabled);
  controls[id] = usePlanArrowPreview(board, position);
  return null;
}
function View({ board, id }: { board: object; id: string }) {
  const state = usePlanArrowSnapshot(board);
  return (
    <output
      data-board={id}
      data-engines={String(engineArrowsAllowed(true, false, state))}
      data-claims={state.claims.length}
    >
      {state.preview ? `${state.preview.fen}:${state.preview.lines ? "hover" : "none"}` : "none"}
    </output>
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  controls = {};
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(children: React.ReactNode) {
  await act(async () => root.render(children));
}
const view = (id: string) => host.querySelector(`[data-board="${id}"]`)!;

it("claims priority even before results and restores the stored engine toggle after disabling Auto arrows", async () => {
  const board = {};
  await render(
    <>
      <Owner board={board} id="plan" />
      <View board={board} id="board" />
    </>,
  );
  expect(view("board").getAttribute("data-engines")).toBe("false");
  await render(
    <>
      <Owner board={board} id="plan" enabled={false} />
      <View board={board} id="board" />
    </>,
  );
  expect(view("board").getAttribute("data-engines")).toBe("true");
});
it("keeps another mounted owner when a plan panel unmounts", async () => {
  const board = {};
  await render(
    <>
      <Owner key="a" board={board} id="a" />
      <Owner key="b" board={board} id="b" kind="engine-plans" />
      <View board={board} id="board" />
    </>,
  );
  await render(
    <>
      <Owner key="b" board={board} id="b" kind="engine-plans" />
      <View board={board} id="board" />
    </>,
  );
  expect(view("board").getAttribute("data-claims")).toBe("1");
  expect(view("board").getAttribute("data-engines")).toBe("false");
});
it("separates board ownership and clears only the departing board", async () => {
  const a = {},
    b = {};
  await render(
    <>
      <Owner key="a" board={a} id="a" />
      <Owner key="b" board={b} id="b" />
      <View board={a} id="a" />
      <View board={b} id="b" />
    </>,
  );
  const old = controls.a;
  await act(async () => {
    controls.a(line);
    controls.b(line);
  });
  await render(
    <>
      <Owner key="b" board={b} id="b" />
      <View board={a} id="a" />
      <View board={b} id="b" />
    </>,
  );
  await act(async () => old(line));
  expect(view("a").getAttribute("data-engines")).toBe("true");
  expect(view("a").textContent).toBe("none");
  expect(view("b").getAttribute("data-engines")).toBe("false");
  expect(view("b").textContent).toBe(`${fen}:hover`);
});
it("rejects stale hover setters after a position change, including stale clearing", async () => {
  const board = {};
  await render(
    <>
      <Owner board={board} id="a" />
      <View board={board} id="board" />
    </>,
  );
  const old = controls.a;
  await act(async () => old(line));
  await render(
    <>
      <Owner board={board} id="a" position="fixture-position-B" />
      <View board={board} id="board" />
    </>,
  );
  expect(view("board").textContent).toBe("none");
  await act(async () => old(line));
  expect(view("board").textContent).toBe("none");
  await act(async () => {
    controls.a(line);
    old(null);
  });
  expect(view("board").textContent).toBe("fixture-position-B:hover");
});
it("old panel cleanup leaves a newer hover and automatic owner intact", async () => {
  const board = {};
  await render(
    <>
      <Owner key="a" board={board} id="a" />
      <Owner key="b" board={board} id="b" />
      <View board={board} id="board" />
    </>,
  );
  await act(async () => {
    controls.a(line);
    controls.b(line);
  });
  await render(
    <>
      <Owner key="b" board={board} id="b" />
      <View board={board} id="board" />
    </>,
  );
  expect(view("board").textContent).toBe(`${fen}:hover`);
  expect(view("board").getAttribute("data-claims")).toBe("1");
});
it("does not leak claims or hover through strict lifecycle remounts", async () => {
  const board = {};
  await render(
    <StrictMode>
      <Owner board={board} id="a" />
      <View board={board} id="board" />
    </StrictMode>,
  );
  expect(view("board").getAttribute("data-claims")).toBe("1");
  const old = controls.a;
  await act(async () => old(line));
  await render(<View board={board} id="board" />);
  await act(async () => old(line));
  expect(view("board").getAttribute("data-claims")).toBe("0");
  expect(view("board").textContent).toBe("none");
});
