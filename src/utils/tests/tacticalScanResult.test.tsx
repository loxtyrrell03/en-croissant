import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { TacticalScanResult } from "@/components/panels/tactics/TacticalScanResult";
import {
  buildLiveTacticalScan,
  previewLiveTacticalVariation,
  type LiveTacticalScan,
} from "@/utils/tacticalMotifs/liveTactics";

const scan = buildLiveTacticalScan({
  fen: "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5",
  pvUci: ["e5f7", "d8e8", "f7h8"],
  pvSan: ["Nxf7", "Qe8", "Nxh8"],
  engineName: "Regression",
  depth: 16,
  variations: [
    { multipv: 1, pvUci: ["e5f7", "d8e8", "f7h8"], pvSan: ["Nxf7", "Qe8", "Nxh8"], cp: 460 },
    { multipv: 2, pvUci: ["c4f7", "e8f8", "f7b3"], pvSan: ["Bxf7+", "Kf8", "Bb3"], cp: 350 },
  ],
});

const markup = (value: LiveTacticalScan) =>
  renderToStaticMarkup(
    <MantineProvider env="test">
      <TacticalScanResult scan={value} lastMoveSan="b6" />
    </MantineProvider>,
  );

const laterScan = buildLiveTacticalScan({
  fen: "2k4r/1p3p2/2p3q1/P1Q3p1/3R4/8/6B1/6K1 w - - 0 1",
  pvUci: ["g2h3", "c8b8", "c5e5", "g6d6", "e5h8"],
  pvSan: ["Bh3+", "Kb8", "Qe5+", "Qd6", "Qxh8+"],
  engineName: "Constructed",
  depth: 16,
});
test("an unresolved root exposes later themes only as collapsed continuation details", () => {
  const value = buildLiveTacticalScan({
    fen: "5r1k/6pp/8/8/4n3/5NPQ/3qB2P/4R2K b - - 0 1",
    pvUci: ["d2e1", "f3e1", "e4f2", "h1g2", "f2h3", "e1f3", "f8f3", "e2f3", "h3g5"],
    depth: 16,
    engineName: "Constructed",
  });
  const element = document.createElement("div");
  element.innerHTML = markup(value);
  expect(value.motifs).toEqual([]);
  expect(element.textContent).toContain("Continuation only");
  expect(element.textContent).toContain("No first-move tactic was verified");
  expect(element.textContent).not.toContain("Sacrifice found");
  expect(element.querySelector('[data-tactical-ply="3"]')?.textContent).toContain("Fork");
  expect(element.querySelectorAll("details[open]")).toHaveLength(0);
});
test("a verified square-clearing capture leads with the preparation, not its later fork", () => {
  const value = buildLiveTacticalScan({
    fen: "5r1k/6pp/8/8/4n3/5NPQ/4Bq1P/4R2K b - - 0 1",
    pvUci: ["f2e1", "f3e1", "e4f2", "h1g2", "f2h3"],
    depth: 16,
    engineName: "Constructed",
  });
  const element = document.createElement("div");
  element.innerHTML = markup(value);
  expect(value.motifs[0]).toMatchObject({ id: "forkPreparation", ply: 1 });
  expect(element.textContent).toContain("clearing f2 for a checking fork");
  expect(element.textContent).not.toContain("Continuation only");
  expect(element.querySelector('[data-tactical-ply="3"]')?.textContent).toContain("Fork");
  expect(element.querySelector('[data-tactical-ply="2"]')?.textContent ?? "").not.toContain(
    "Hanging",
  );
  expect(element.querySelectorAll("details[open]")).toHaveLength(0);
});
test("a root mate proof does not relabel the supplied material continuation as checkmate", () => {
  const value = buildLiveTacticalScan({
    fen: "R2r2k1/p4ppp/1p6/2pq4/4R3/1P2PQ2/P5PP/6K1 w - - 0 24",
    pvUci: ["e4e8", "d8e8", "f3d5"],
    depth: 16,
    engineName: "Constructed",
  });
  const element = document.createElement("div");
  element.innerHTML = markup(value);
  expect(value.motifs[0]).toMatchObject({ id: "mateIn2", ply: 1 });
  expect(element.textContent).toContain("Every legal defence permits mate within 2 moves");
  expect(element.querySelector('[data-tactical-ply="3"]')?.textContent ?? "").not.toContain(
    "Checkmate",
  );
  expect(value.labels[0].text).toBe("Forcing Mate");
});
test("a verified mixed checking offer explains the root and leaves its fork in the timeline", () => {
  const mixed = buildLiveTacticalScan({
    fen: "2k4r/pp3p2/1np3q1/2Q3p1/P2R4/4P1P1/5PB1/6K1 w - - 0 1",
    pvUci: ["g2h3", "c8b8", "c5e5", "g6d6", "e5h8"],
    depth: 16,
    engineName: "Constructed",
  });
  const element = document.createElement("div");
  element.innerHTML = markup(mixed);
  expect(mixed.motifs[0]).toMatchObject({ id: "forcingAttack", ply: 1 });
  expect(element.textContent).toContain("offers the bishop with check");
  expect(element.textContent).toContain("Rxh3");
  expect(element.textContent).not.toContain("Fork in the continuation");
  expect(element.querySelector('[data-tactical-ply="3"]')?.textContent).toContain("Fork");
  expect(element.querySelectorAll("details[open]")).toHaveLength(0);
});
test("a later fork is not presented as a verified root explanation", () => {
  expect(laterScan.motifs[0]).toMatchObject({ id: "fork", ply: 3 });
  const element = document.createElement("div");
  element.innerHTML = markup(laterScan);
  expect(element.textContent).toContain("Fork in the continuation");
  expect(element.textContent).not.toContain("Fork found");
  expect(element.textContent).not.toContain("White's main tactical idea");
  expect(element.textContent).toContain(
    "not verified it as the tactical explanation of the first move",
  );
  expect(element.textContent).toContain("Continuation move");
  expect(element.querySelector('[data-tactical-ply="3"]')?.textContent).toContain("Fork");
  expect(element.querySelectorAll("details[open]")).toHaveLength(0);
});
test("later board annotations survive candidate projection without changing its position", () => {
  expect(laterScan.labels[0].text).toBe("Later: Fork");
  const before = JSON.stringify(laterScan);
  const projected = previewLiveTacticalVariation(laterScan, 1);
  expect(projected.labels[0].text).toBe("Later: Fork");
  expect(projected.fen).toBe(laterScan.fen);
  expect(JSON.stringify(laterScan)).toBe(before);
  expect(scan.labels[0].text).toBe("Fork");
});

const cycleScan = buildLiveTacticalScan({
  fen: "6k1/2r2Npp/2q1P3/3n4/8/6Q1/5PPP/3R1RK1 w - - 0 1",
  pvUci: ["f7h6", "g8h8", "h6f7", "h8g8", "d1d5", "c6d5", "g3c7"],
  depth: 16,
  engineName: "Constructed",
  variations: [
    {
      multipv: 1,
      pvUci: ["f7h6", "g8h8", "h6f7", "h8g8", "d1d5", "c6d5", "g3c7"],
      pvSan: ["Nh6+", "Kh8", "Nf7+", "Kg8", "Rxd5", "Qxd5", "Qxc7"],
      cp: 420,
    },
    { multipv: 2, pvUci: ["d1d5", "c6d5", "g3c7"], pvSan: ["Rxd5", "Qxd5", "Qxc7"], cp: 413 },
  ],
});

test("the preferred immediate option is first without relabelling engine ranks", () => {
  const element = document.createElement("div");
  element.innerHTML = markup(cycleScan);
  expect(element.textContent).toContain("White's immediate tactical option");
  expect(element.textContent).toContain("separately analysed immediate alternative");
  const cards = [...element.querySelectorAll("[data-tactical-candidate]")];
  expect(cards.map((c) => c.getAttribute("data-tactical-candidate"))).toEqual(["2", "1"]);
  expect(cards[0].textContent).toContain("Alternative");
  expect(cards[1].textContent).toContain("Main line");
  expect(cards[1].textContent).toContain("Nh6+");
  expect(element.querySelectorAll("details[open]")).toHaveLength(0);
});

test("a candidate preview uses only that root's evidence and leaves the cached scan unchanged", () => {
  const original = JSON.stringify(scan);
  const alternative = previewLiveTacticalVariation(scan, 2);
  expect(alternative.motifs[0].id).toBe("attackingF2F7");
  expect(alternative.labels).toHaveLength(1);
  expect(alternative.labels[0].text).toBe("Weak f7");
  expect(alternative.arrows).toEqual(scan.variations[1].arrows);
  expect(alternative.arrows.some((arrow) => arrow.from === "f7" && arrow.to === "h8")).toBe(false);
  expect(alternative.fen).toBe(scan.fen);
  expect(alternative.variations).toBe(scan.variations);
  expect(JSON.stringify(scan)).toBe(original);
  expect(previewLiveTacticalVariation(scan, 999)).toBe(scan);
});

test("the main lesson is visible and full engine continuation stays collapsed", () => {
  const element = document.createElement("div");
  element.innerHTML = markup(scan);
  expect(element.textContent).toContain("Fork found");
  expect(element.querySelectorAll("details")).toHaveLength(2);
  expect(element.querySelectorAll("details[open]")).toHaveLength(0);
  const detail = element.querySelector("details")!;
  expect(detail.textContent).toContain("Nxh8");
  expect(
    [...element.querySelectorAll('[data-tactical-candidate="1"] code')].some((node) =>
      node.textContent?.includes("Nxh8"),
    ),
  ).toBe(false);
});

test("verified alternatives do not sit under a global no-tactics claim", () => {
  // Presentation fixture: only the main line abstains; the independently
  // classified alternative keeps its real weak-f7 evidence.
  const value = {
    ...scan,
    motifs: [],
    labels: [],
    arrows: [],
    variations: [
      { ...scan.variations[0], motifs: [], timeline: [], labels: [], arrows: [] },
      scan.variations[1],
    ],
  };
  const html = markup(value);
  expect(html).toContain("Tactical alternatives");
  expect(html).toContain("Weak f7");
  expect(html).not.toContain("No tactical theme verified");
  expect(html).not.toContain("No forcing tactical theme found");
});

test("an empty bounded scan is abstention, not proof that no tactic exists", () => {
  const value = buildLiveTacticalScan({
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    pvUci: ["e2e4"],
    pvSan: ["e4"],
    engineName: "Regression",
    depth: 8,
  });
  expect(markup(value)).toContain("No tactical theme verified");
  expect(markup(value)).toContain("does not rule out a deeper tactic");
});

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  unmount = undefined;
  vi.unstubAllGlobals();
});

test("Show on board switches one candidate at a time and resets for a new scan", async () => {
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
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  unmount = () => {
    act(() => root.unmount());
    container.remove();
  };
  const onPreviewChange = vi.fn();
  const render = async (value: LiveTacticalScan) => {
    await act(async () =>
      root.render(
        <MantineProvider env="test">
          <TacticalScanResult scan={value} lastMoveSan="b6" onPreviewChange={onPreviewChange} />
        </MantineProvider>,
      ),
    );
  };
  await render(scan);
  const button = () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Show Bxf7+ on board"]')!;
  expect(button().getAttribute("aria-pressed")).toBe("false");
  await act(async () => button().click());
  expect(button().getAttribute("aria-pressed")).toBe("true");
  expect(onPreviewChange.mock.lastCall?.[0].labels[0].text).toBe("Weak f7");
  const restore = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "Restore main line",
  )!;
  await act(async () => restore.click());
  expect(onPreviewChange.mock.lastCall?.[0].labels[0].text).toBe("Fork");
  await act(async () => button().click());
  await render({ ...scan });
  expect(button().getAttribute("aria-pressed")).toBe("false");
  await render(scan);
  expect(button().getAttribute("aria-pressed")).toBe("false");
  await render(cycleScan);
  const immediate = () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Show Rxd5 on board"]')!;
  const engineFirst = () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Show Nh6+ on board"]')!;
  expect(immediate().getAttribute("aria-pressed")).toBe("true");
  expect(engineFirst().getAttribute("aria-pressed")).toBe("false");
  await act(async () => engineFirst().click());
  expect(onPreviewChange.mock.lastCall?.[0].lineUci[0]).toBe("f7h6");
  const restoreImmediate = [...container.querySelectorAll("button")].find(
    (n) => n.textContent === "Restore immediate option",
  )!;
  await act(async () => restoreImmediate.click());
  expect(onPreviewChange.mock.lastCall?.[0].lineUci[0]).toBe("d1d5");
  expect(
    onPreviewChange.mock.lastCall?.[0].arrows.some(
      (a: { from: string; to: string }) => a.from === "f7" && a.to === "h6",
    ),
  ).toBe(false);
  await act(async () => engineFirst().click());
  await render({ ...cycleScan });
  expect(immediate().getAttribute("aria-pressed")).toBe("true");
  await render(scan);
  expect(button().getAttribute("aria-pressed")).toBe("false");
});
