import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePlanArrowSnapshot } from "@/hooks/usePlanArrows";
import { engineArrowsAllowed, planOverlayShapes } from "@/utils/planArrowLayers";
import PhoneEnginePlansPanel from "../PhoneEnginePlansPanel";
import type { WebEngineLine } from "../model";

const fixture = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock("../stockfishEngine", () => ({ analyzeWithWebStockfish18: fixture.analyze }));
vi.mock("../pcServices", () => ({ usePcServicesAvailability: () => "on" }));
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const lines: WebEngineLine[] = [
  {
    source: "stockfish",
    depth: 17,
    multipv: 1,
    score: { type: "cp", value: 30 },
    uciMoves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"],
    sanMoves: [],
  },
  {
    source: "stockfish",
    depth: 17,
    multipv: 2,
    score: { type: "cp", value: 20 },
    uciMoves: ["d2d4", "d7d5", "c2c4", "e7e6", "b1c3", "g8f6"],
    sanMoves: [],
  },
];
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
function Probe({
  board,
  position = fen,
  id = "overlay",
}: {
  board: object;
  position?: string;
  id?: string;
}) {
  const state = usePlanArrowSnapshot(board);
  const shapes = planOverlayShapes({
    state,
    fen: position,
    planData: null,
    engineData: null,
    autoEnabled: true,
    limit: 10,
  });
  return (
    <output
      data-testid={id}
      data-live={String(engineArrowsAllowed(true, false, state))}
      data-preview={String(!!state.preview)}
    >
      {JSON.stringify(shapes)}
    </output>
  );
}
const result = (id = "overlay") => host.querySelector(`[data-testid="${id}"]`)!;
const shapes = () =>
  JSON.parse(result().textContent!) as { orig: string; dest: string; brush: string }[];
const button = (name: string) =>
  Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === name,
  )!;
const render = async (node: React.ReactNode) =>
  act(async () => root.render(<MantineProvider>{node}</MantineProvider>));
async function click(name: string) {
  await act(async () => button(name).click());
}
beforeEach(() => {
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
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  fixture.analyze.mockReset().mockResolvedValue(lines);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const panel = (board: object, active = true, key = "owner") => (
  <PhoneEnginePlansPanel
    key={key}
    arrowBoard={board}
    active={active}
    fen={fen}
    onBusy={() => {}}
    onPlayLine={() => {}}
  />
);

it("gives an empty visible Auto arrows control priority and releases hidden controls", async () => {
  const board = {};
  await render(
    <>
      {panel(board)}
      <Probe board={board} />
    </>,
  );
  expect(result().getAttribute("data-live")).toBe("false");
  expect(shapes()).toEqual([]);
  await render(
    <>
      {panel(board, false)}
      <Probe board={board} />
    </>,
  );
  expect(result().getAttribute("data-live")).toBe("true");
  await render(
    <>
      {panel(board)}
      <Probe board={board} />
    </>,
  );
  await act(async () =>
    host.querySelector<HTMLInputElement>('input[aria-label="Auto plan arrows"]')!.click(),
  );
  expect(result().getAttribute("data-live")).toBe("true");
  expect(JSON.parse(localStorage.getItem("en-croissant-phone-engine-plans")!)).toMatchObject({
    autoArrows: false,
    depth: 17,
  });
  expect(fixture.analyze).not.toHaveBeenCalled();
});
it("retains automatic arrows across hover, focus and selected details", async () => {
  const board = {};
  await render(
    <>
      {panel(board)}
      <Probe board={board} />
    </>,
  );
  await click("Explore plans");
  await vi.waitFor(() => expect(shapes().length).toBeGreaterThan(1));
  const automatic = shapes();
  const row = host.querySelector<HTMLButtonElement>(
    'button[data-plan-detail][aria-expanded="false"]',
  )!;
  await act(async () => row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect(result().getAttribute("data-preview")).toBe("true");
  expect(shapes()).toEqual(expect.arrayContaining(automatic));
  await act(async () =>
    row.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })),
  );
  expect(result().getAttribute("data-preview")).toBe("false");
  await act(async () => row.focus());
  expect(result().getAttribute("data-preview")).toBe("true");
  await act(async () => row.click());
  await act(async () => row.blur());
  expect(result().getAttribute("data-preview")).toBe("true");
  expect(shapes()).toEqual(expect.arrayContaining(automatic));
  await click("Close details");
  expect(result().getAttribute("data-preview")).toBe("false");
  expect(shapes()).toEqual(automatic);
});
it("updates only the arrow limit without another engine search or storage dependency", async () => {
  const board = {};
  await render(
    <>
      {panel(board)}
      <Probe board={board} />
    </>,
  );
  await click("Explore plans");
  await vi.waitFor(() => expect(shapes().length).toBeGreaterThan(1));
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Max plan arrows"]')!;
  const fail = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Invented storage failure");
  });
  try {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "1");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(shapes()).toHaveLength(1);
    expect(fixture.analyze).toHaveBeenCalledTimes(1);
  } finally {
    fail.mockRestore();
  }
});
it("does not carry a same-position report or late result to a new workspace owner", async () => {
  const old = {},
    current = {};
  let finish!: (value: WebEngineLine[]) => void;
  fixture.analyze.mockImplementation(
    () =>
      new Promise<WebEngineLine[]>((done) => {
        finish = done;
      }),
  );
  await render(
    <>
      {panel(old, true, "old")}
      <Probe board={old} id="old" />
      <Probe board={current} />
    </>,
  );
  await click("Explore plans");
  const signal = fixture.analyze.mock.calls[0][0].signal as AbortSignal;
  await render(
    <>
      {panel(current, true, "new")}
      <Probe board={old} id="old" />
      <Probe board={current} />
    </>,
  );
  expect(signal.aborted).toBe(true);
  await act(async () => finish(lines));
  expect(result("old").getAttribute("data-live")).toBe("true");
  expect(result().getAttribute("data-live")).toBe("false");
  expect(shapes()).toEqual([]);
  expect(host.textContent).not.toContain("evaluated root choices");
});
