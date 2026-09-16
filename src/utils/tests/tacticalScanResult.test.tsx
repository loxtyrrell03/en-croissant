import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { TacticalScanResult } from "@/components/panels/tactics/TacticalScanResult";
import { capturingPawnGuardInput } from "./fixtures/capturingPawnGuard";
import { quietRootMateCases } from "./fixtures/quietRootMate";
import { counterplayFen, counterplayPreviousFen, counterplayLine } from "./fixtures/tacticalCounterplay";
import { mixedForkFen, mixedForkLine } from "./fixtures/mixedTargetFork";
import { directThreatFen, directThreatLine } from "./fixtures/directThreatRelevance";
import { pawnExposureAlternateInput } from "./fixtures/pawnExposure";
import { compensatedCaptureInput } from "./fixtures/compensatedCapture";
import { shortMatingThreatCases } from "./fixtures/shortMatingThreat";
import { matingCheckEvasionFen, matingCheckEvasionLine } from "./fixtures/matingCheckEvasion";
import { settledRootExchangeCases } from "./fixtures/settledRootExchange";
import { captureMatingGuardCases } from "./fixtures/captureMatingGuard";
import { immediateAlternativeInputs } from "./fixtures/immediateTacticalAlternative";
import { kingDefenderRemovalCases } from "./fixtures/kingDefenderRemoval";
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

test("a king-safe defender removal explains legality and draws its current relationships", () => {
  const row = kingDefenderRemovalCases[0];
  const value = buildLiveTacticalScan({ fen: row.fen, pvUci: [row.move, "c7d6", "g3f4"],
    depth: 16, engineName: "Constructed king-capture guard" });
  const element = document.createElement("div"); element.innerHTML = markup(value);
  expect(element.textContent).toContain("Removing the Defender found");
  expect(element.textContent).toContain("king could not legally take");
  expect(element.textContent).toContain("Kxd6, Kxf4");
  expect(element.textContent).not.toContain("No tactical theme verified");
  expect(value.arrows.map(arrow => arrow.from + arrow.to)).toEqual(["h6d6", "d6f4", "g3f4"]);
  expect(value.arrows.every(arrow => arrow.ply === 1)).toBe(true);
  expect(value.variations[0].timeline).toContainEqual(expect.objectContaining({
    label: "Defender Removal Payoff", ply: 3, moveUci: "g3f4", value: undefined,
  }));
});

test("a capture-led mating attack keeps its later exchange off the starting board", () => {
  const value = buildLiveTacticalScan({fen: captureMatingGuardCases[0].fen,
    pvUci: ["c8c3", "b7g7", "g8h8", "g7h7", "h8h7"],
    depth: 16, engineName: "Constructed mating-guard concession"});
  const element = document.createElement("div"); element.innerHTML = markup(value);
  expect(element.textContent).toContain("Mating Attack found");
  expect(element.textContent).toContain("new threat Rh3#");
  expect(element.textContent).toContain("not a forced-mate claim");
  expect(value.arrows.map(a => a.from + a.to)).toEqual(["c8c3", "c3h3"]);
  expect(value.variations[0].timeline).toContainEqual(expect.objectContaining({
    label: "Winning Recapture", moveUci: "h8h7", ply: 5,
  }));
});

test("a pawn after a settled exchange is visible without adding future capture badges", () => {
  const row = settledRootExchangeCases[0];
  const value = buildLiveTacticalScan({ ...row, depth: 16, engineName: "Constructed exchange",
    variations: [{ depth: 16, pvUci: row.pvUci, cp: 100 }] });
  const element = document.createElement("div"); element.innerHTML = markup(value);
  expect(element.textContent).toContain("Hanging Pawn found");
  expect(element.textContent).toContain("already settled the earlier losses");
  expect(element.textContent).toContain("at least 1 pawn;");
  expect(value.variations[0].timeline).toHaveLength(1);
  expect(value.arrows.map(a => a.from + a.to)).toEqual(["c6d4"]);
});

test("a proved mate through counterchecks names the root without drawing future captures", () => {
  const value = buildLiveTacticalScan({fen: matingCheckEvasionFen, pvUci: matingCheckEvasionLine, depth: 16, engineName: "Constructed mating proof"});
  const element = document.createElement("div"); element.innerHTML = markup(value);
  expect(element.textContent).toContain("Forcing Mate found");
  expect(element.textContent).toContain("Every legal defence permits mate within 7 moves");
  expect(element.textContent).not.toContain("No verified immediate theme");
  expect(value.arrows.map(a => a.from + a.to)).toEqual(["e4e5"]);
  expect(value.variations[0].timeline).toContainEqual(expect.objectContaining({id: "mateIn1", ply: 13}));
});

test("a short mating threat explains the root without promising an unavoidable mate", () => {
  const row = shortMatingThreatCases[0];
  const value = buildLiveTacticalScan({fen: row.fen, pvUci: [row.move], depth: 16, engineName: "Constructed threat"});
  const element = document.createElement("div"); element.innerHTML = markup(value);
  expect(element.textContent).toContain("Mating Attack found");
  expect(element.textContent).toContain("mate in two if unanswered");
  expect(element.textContent).toContain("not a forced-mate claim");
  expect(element.textContent).not.toContain("No verified immediate theme");
  expect(element.textContent).not.toContain("Stopping the mate concedes");
  expect(value.arrows.map(a => a.from + a.to)).toEqual(["g1g3", "g3h3"]);
});

test("an ordinary alternative is on board initially, with honest provenance and a usable main-line switch", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const value = buildLiveTacticalScan(immediateAlternativeInputs[0]);
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  const onPreviewChange = vi.fn();
  try {
    await act(async () => root.render(<MantineProvider env="test"><TacticalScanResult scan={value} lastMoveSan={null} onPreviewChange={onPreviewChange} /></MantineProvider>));
    expect(element.textContent).toContain("Fork found");
    expect(element.textContent).toContain("close-scoring alternative");
    expect(element.textContent).toContain("Engine's first choice");
    expect(element.textContent).not.toContain("Additional option");
    expect(element.textContent).not.toContain("No tactical theme verified");
    expect(element.querySelector('[aria-label="Show Nxf7 on board"]')?.getAttribute("aria-pressed")).toBe("true");
    const main = [...element.querySelectorAll("button")].find(b => b.textContent === "Show main line")!;
    await act(async () => main.click());
    expect(onPreviewChange.mock.lastCall?.[0]).toMatchObject({ motifs: [], arrows: [], labels: [], lineUci: ["h2h3"] });
    const restore = [...element.querySelectorAll("button")].find(b => b.textContent === "Restore immediate option")!;
    await act(async () => restore.click());
    expect(onPreviewChange.mock.lastCall?.[0].arrows).toEqual(value.arrows);
    expect(onPreviewChange.mock.lastCall?.[0].lineUci).toEqual(["e5f7"]);
  } finally {
    await act(async () => root.unmount());
    element.remove();
  }
});

test("a targeted preview explains its provenance and keeps the original main line available", () => {
  // Synthetic scores test presentation, not an engine ranking of h3 above Nxf7.
  const value = buildLiveTacticalScan({
    fen: scan.fen, depth: 16, engineName: "Structural test", pvUci: ["h2h3"],
    variations: [{ multipv: 1, depth: 16, pvUci: ["h2h3"], cp: 450 }],
    supplementalVariations: [{ depth: 16, pvUci: ["e5f7"], cp: 400 }],
  });
  const element = document.createElement("div"); element.innerHTML = markup(value);
  expect(element.textContent).toContain("Fork found");
  expect(element.textContent).toContain("not the engine's first choice");
  expect(element.textContent).toContain("Additional option");
  expect(element.textContent).toContain("Engine's first choice");
  expect(value.arrows.map(arrow => arrow.from + arrow.to)).toEqual(["e5f7", "f7d8", "f7h8"]);
  expect(previewLiveTacticalVariation(value, 1).motifs).toEqual([]);
  expect(markup({ ...value, supplementalSearchIncomplete: true })).toContain("additional candidate check was incomplete");
});

test("a nonchecking mating capture leads with mate and does not draw a future branch", () => {
  const row = quietRootMateCases[1];
  const value = buildLiveTacticalScan({ ...row, engineName: "Constructed quiet mate", depth: 16 });
  const element = document.createElement("div"); element.innerHTML = markup(value);
  expect(element.textContent).toContain("Forcing Mate found");
  expect(element.textContent).toContain("Every legal defence permits mate within 4 moves");
  expect(element.textContent).not.toContain("Hanging Piece found");
  expect(value.arrows.map(arrow => `${arrow.from}${arrow.to}`)).toEqual(["f6h4"]);
  expect(value.variations[0].timeline).toContainEqual(expect.objectContaining({ id: "mateIn1", ply: 7 }));
});

test("a pawn exposed by a capturing defender shows the current capture and its explanation", () => {
  const value = buildLiveTacticalScan({ ...capturingPawnGuardInput(), engineName: "Constructed guard exposure", depth: 16 });
  const element = document.createElement("div"); element.innerHTML = markup(value);
  expect(element.textContent).toContain("Hanging Pawn found");
  expect(element.textContent).toContain("pawn defender away from d6");
  expect(element.textContent).not.toContain("No verified immediate theme");
  expect(value.arrows.some(arrow => arrow.from === "f3" && arrow.to === "e5")).toBe(true);
  expect(value.arrows.every(arrow => arrow.ply === 1)).toBe(true);
});

test("a compensated capture displays the retained gain rather than a free knight", () => {
  const value = buildLiveTacticalScan(compensatedCaptureInput);
  const element = document.createElement("div"); element.innerHTML = markup(value);
  expect(element.textContent).toContain("Material Gain found");
  expect(element.textContent).toContain("0.9 pawns");
  expect(element.textContent).not.toContain("Hanging Piece found");
  expect(value.arrows.some(arrow => arrow.from === "c3" && arrow.to === "d5")).toBe(true);
});

test("a stronger capture alternative explains its priority without claiming an engine repetition", () => {
  const value = buildLiveTacticalScan(pawnExposureAlternateInput);
  const element = document.createElement("div"); element.innerHTML = markup(value);
  expect(value.preferredMultipv).toBe(2);
  expect(element.textContent).toContain("Hanging Piece found");
  expect(element.textContent).toContain("clearer material-winning lesson");
  expect(element.textContent).not.toContain("repeats this position");
  expect(value.variations.map(v => v.lineUci[0])).toEqual(["e5c3", "f8a3"]);
});

test("a discovery has one root lesson while promotion and the capture payoff remain later", () => {
  const value = buildLiveTacticalScan({ fen: directThreatFen, pvUci: directThreatLine, engineName: "Public counterfactual", depth: 16 });
  const element = document.createElement("div"); element.innerHTML = markup(value);
  expect(element.textContent).toContain("Discovered Check found");
  expect(element.textContent).not.toContain("Threatening a Piece");
  expect(element.querySelector('[data-tactical-ply="1"]')?.textContent).toContain("Discovered Check");
  expect(element.querySelector('[data-tactical-ply="3"]')?.textContent).toContain("Under-Promotion");
  expect(value.labels.map(label => label.id)).toEqual(["discoveredCheck"]);
  expect(element.querySelector("details")?.hasAttribute("open")).toBe(false);
});

test("the mixed-target fork leads the panel while the actual pin payoff stays later", () => {
  const value = buildLiveTacticalScan({ fen: mixedForkFen, pvUci: mixedForkLine, engineName: "Frozen real game", depth: 16 });
  const element = document.createElement("div"); element.innerHTML = markup(value);
  expect(element.textContent).toContain("Fork found");
  expect(element.textContent).not.toContain("Pin found");
  expect(element.querySelector('[data-tactical-ply="1"]')?.textContent).toContain("Fork");
  expect(element.querySelector('[data-tactical-ply="3"]')?.textContent).toContain("Pin");
  expect(element.querySelector("details")?.hasAttribute("open")).toBe(false);
  expect(value.labels.map(label => label.id)).toEqual(["fork"]);
});

test("the mate headline keeps x-ray support on the initiating row and board", () => {
  const value = buildLiveTacticalScan({fen: "4r1k1/pp1b1pbp/2p3p1/8/1qNp4/1P1P1Q2/P1P1RPPP/4R1K1 b - - 6 23", pvUci: ["b4e1", "e2e1", "e8e1"], pvSan: ["Qxe1+", "Rxe1", "Rxe1#"], depth: 16, engineName: "Frozen real game"});
  const element = document.createElement("div"); element.innerHTML = markup(value);
  expect(element.textContent).toContain("Forcing Mate found");
  expect(element.textContent).not.toContain("Intermediate Check");
  expect(element.querySelector('[data-tactical-ply="1"]')?.textContent).toContain("X-Ray Support");
  expect(element.querySelector('[data-tactical-ply="3"]')?.textContent).toContain("Back Rank Mate");
  expect(element.querySelector('[data-tactical-ply="3"]')?.textContent).not.toContain("X-Ray");
  expect(value.labels.map(label => label.id)).toEqual(["mateIn2", "xRayAttack"]);
  expect(value.arrows.map(a => a.from + a.to)).toEqual(["b4e1", "e8e2", "e2e1"]);
  expect(previewLiveTacticalVariation(value, 1)?.labels).toEqual(value.labels);
});

test("mating self-interference is the defender's later detail, not the headline", () => {
  const value = buildLiveTacticalScan({fen: "8/p3NQpk/1p6/1P2p2p/6q1/6P1/P1rr1P2/5RK1 w - - 1 33", pvUci: ["f7g8", "h7h6", "g8h8", "h6g5", "h8g7"], pvSan: ["Qg8+", "Kh6", "Qh8+", "Kg5", "Qxg7#"], depth: 16, engineName: "Frozen real game"});
  const element = document.createElement("div"); element.innerHTML = markup(value);
  expect(element.textContent).toContain("Forcing Mate found");
  expect(element.querySelector('[data-tactical-ply="4"]')?.textContent).toContain("Self-Interference");
  expect(element.querySelector('[data-tactical-ply="1"]')?.textContent).not.toContain("Self-Interference");
  expect(value.labels.some(label => label.id === "selfInterference")).toBe(false);
  expect(value.arrows.some(a => a.from === "g4" && a.to === "g5")).toBe(false);
});

test("the opening discovered check is the headline without borrowing a future bishop arrow", () => {
  const value = buildLiveTacticalScan({ fen: "rnbqkbnr/pppp2pp/5p2/4P3/8/2N5/PP2QPPP/R1B1KBNR w KQkq - 0 7", pvUci: ["e5f6", "g8e7", "f6e7", "d8e7"], engineName: "Frozen opening", depth: 16 });
  const element = document.createElement("div");
  element.innerHTML = markup(value);
  expect(element.textContent).toContain("Discovered Check found");
  expect(element.textContent).not.toContain("Forcing Mate found");
  expect(value.labels[0].text).toContain("Discovered Check");
  expect(value.arrows.map(arrow => arrow.from + arrow.to)).toContain("e2e8");
  expect(value.arrows.some(arrow => arrow.from === "c1" || arrow.from === "f1")).toBe(false);
});

test("drawing opposition is labelled as a draw, not a won ending or future promotion", () => {
  const value = buildLiveTacticalScan({ fen: "8/2k5/8/8/2K5/2P5/8/8 b - - 0 1", pvUci: ["c7c6", "c4b4", "c6b6"], engineName: "Exact ending", depth: 16 });
  const element = document.createElement("div");
  element.innerHTML = markup(value);
  expect(element.textContent).toContain("Drawing Zugzwang found");
  expect(element.textContent).toContain("holds the draw");
  expect(element.textContent).not.toContain("this is a winning endgame");
  expect(element.textContent).not.toContain("Promotion");
  expect(value.labels[0]).toMatchObject({ text: "Drawing Zugzwang", square: "c4" });
  expect(value.arrows.map(a => a.from + a.to)).toEqual(["c7c6"]);
});

test("the stronger discovery leads the panel and board without discarding a distinct smaller skewer", () => {
  const value = buildLiveTacticalScan({ fen: "8/p2R1pk1/1p2r3/1p2n2b/2P1K3/6PP/3QP3/8 b - - 0 1", pvUci: ["e5c4"], engineName: "Constructed", depth: 16 });
  const element = document.createElement("div");
  element.innerHTML = markup(value);
  expect(value.motifs[0]).toMatchObject({ id: "discoveredCheck", relevance: "primary" });
  expect(element.textContent).toContain("Discovered Check found");
  expect(element.textContent).not.toContain("Skewer found");
  expect(element.querySelector('[data-tactical-ply="1"]')?.textContent).toContain("Skewer");
  expect(value.labels[0].text).toContain("Discovered Check");
  expect(value.arrows.map(a => a.from + a.to)).toContain("c4d2");
});

const laterScan = buildLiveTacticalScan({
  fen: "2k4r/1p3p2/2p3q1/P1Q3p1/3R4/8/6B1/6K1 w - - 0 1",
  pvUci: ["g2h3", "c8b8", "c5e5", "g6d6", "e5h8"],
  pvSan: ["Bh3+", "Kb8", "Qe5+", "Qd6", "Qxh8+"],
  engineName: "Constructed",
  depth: 16,
});

test("mating compensation removes the free-piece headline but preserves the opponent's actual-ply explanation", () => {
  const value = buildLiveTacticalScan({ fen: "6k1/5ppp/8/8/7q/6pb/4B1PP/5RBK w - - 0 1", pvUci: ["g2h3", "h4h3", "f1f2", "g3f2", "g1f2"], engineName: "Constructed mating net", depth: 16 });
  const element = document.createElement("div");
  element.innerHTML = markup(value);
  expect(element.textContent).toContain("No immediate theme verified");
  expect(element.textContent).not.toContain("Hanging Piece");
  expect(element.textContent).not.toContain("Defensive Capture");
  expect(element.querySelector('[data-tactical-ply="2"]')?.textContent).toContain("Mating Attack");
  expect(element.querySelector('[data-tactical-ply="2"]')?.textContent).toContain("Black");
  expect(element.querySelectorAll("details[open]")).toHaveLength(0);
  expect(previewLiveTacticalVariation(value, 1).arrows).toEqual([]);
});
test("a remote trap stays collapsed and cannot become the recapture's headline or board preview", () => {
  const value = buildLiveTacticalScan({ fen: counterplayFen, previousFen: counterplayPreviousFen, previousMoveUci: "d6b4", pvUci: counterplayLine, engineName: "Generated engine game", depth: 16 });
  const element = document.createElement("div");
  element.innerHTML = markup(value);
  expect(element.textContent).toContain("No immediate theme verified");
  expect(element.textContent).toContain("Continuation only");
  expect(element.textContent).not.toContain("Trapped Rook in the continuation");
  expect(element.textContent).not.toContain("White's main tactical idea");
  expect(element.querySelector('[data-tactical-ply="19"]')?.textContent).toContain("Trapped Rook");
  expect(element.querySelectorAll("details[open]")).toHaveLength(0);
  expect(previewLiveTacticalVariation(value, 1).arrows).toEqual([]);
});
test("the recovered exchange discovery is the headline and shows only current-board arrows", () => {
  const value = buildLiveTacticalScan({
    fen: "2kr1br1/pp1n1p2/2p2p1p/q6b/2BNN3/P2Q3P/1PP2PP1/R3R1K1 b - - 0 15",
    pvUci: ["d7e5", "d3c3", "a5c3", "b2c3", "e5c4"],
    depth: 16,
    engineName: "Regression",
  });
  const element = document.createElement("div");
  element.innerHTML = markup(value);
  expect(value.motifs[0]).toMatchObject({ id: "discoveredAttack", ply: 1 });
  expect(element.textContent).toContain("Discovered Attack found");
  expect(element.textContent).toContain("Qc3, Qxc3");
  expect(element.textContent).not.toContain("Continuation only");
  expect(value.arrows.map((arrow) => `${arrow.from}${arrow.to}`)).toContain("d8d4");
  expect(value.arrows.map((arrow) => `${arrow.from}${arrow.to}`)).not.toContain("a5c3");
});

test("a mating countercapture defence supports the discovery without advertising root checkmate", () => {
  const value = buildLiveTacticalScan({
    fen: "3r2k1/5rb1/1p3n2/3P4/1B1N1R2/8/6PP/5RK1 b - - 0 1",
    pvUci: ["f6d5", "d4c6", "d5f4", "c6d8", "f4e2", "g1h1", "f7f1"],
    depth: 16,
    engineName: "Constructed",
  });
  const element = document.createElement("div");
  element.innerHTML = markup(value);
  expect(element.textContent).toContain("Discovered Attack found");
  expect(element.textContent).toContain("rook on f7 against the rook on f4");
  expect(element.textContent).toContain("bishop on g7 against the knight on d4");
  expect(element.querySelector('[data-tactical-ply="1"]')?.textContent).not.toContain("Checkmate");
  expect(element.querySelector('[data-tactical-ply="7"]')?.textContent).toContain("Checkmate");
  expect(value.arrows.map((a) => a.from + a.to)).not.toContain("f7f1");
});

test("the knight-for-queen countercapture does not render a free-piece headline", () => {
  const value = buildLiveTacticalScan({
    fen: "4k3/6p1/5N2/8/8/8/3q4/3R2K1 b - - 0 1",
    pvUci: ["g7f6"],
    depth: 16,
    engineName: "Constructed",
  });
  const element = document.createElement("div");
  element.innerHTML = markup(value);
  expect(element.textContent).not.toContain("Hanging Piece found");
  expect(element.textContent).not.toContain("wins the loose knight");
  expect(value.labels).toHaveLength(0);
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
test("a quiet pawn fork preparation keeps its move-order lesson and actual-ply fork separate", () => {
  const value = buildLiveTacticalScan({
    fen: "5bk1/5ppp/8/8/3pr3/8/2RRN3/7K b - - 0 1",
    pvUci: ["e4e2", "d2e2", "d4d3"],
    depth: 16,
    engineName: "Constructed",
  });
  const element = document.createElement("div");
  element.innerHTML = markup(value);
  expect(element.textContent).toContain("Fork Preparation found");
  expect(element.textContent).toContain("Playing d3 first instead allows Rxd3");
  expect(element.querySelector('[data-tactical-ply="3"]')?.textContent).toContain("Fork");
  expect(element.querySelector('[data-tactical-ply="2"]')?.textContent ?? "").not.toContain(
    "Hanging",
  );
  expect(value.arrows.map((a) => a.from + a.to)).toContain("d2e2");
  expect(value.arrows.map((a) => a.from + a.to)).not.toContain("d3c2");
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
  const targeted = buildLiveTacticalScan({
    fen: scan.fen, depth: 16, engineName: "Structural test", pvUci: ["h2h3"],
    variations: [{ multipv: 1, depth: 16, pvUci: ["h2h3"], cp: 450 }],
    supplementalVariations: [{ depth: 16, pvUci: ["e5f7"], cp: 400 }],
  });
  await render(targeted);
  const quietMain = [...container.querySelectorAll("button")].find(node => node.textContent === "Show main line")!;
  await act(async () => quietMain.click());
  expect(onPreviewChange.mock.lastCall?.[0].arrows).toEqual([]);
  expect(onPreviewChange.mock.lastCall?.[0].lineUci).toEqual(["h2h3"]);
  const restoreTargeted = [...container.querySelectorAll("button")].find(node => node.textContent === "Restore immediate option")!;
  await act(async () => restoreTargeted.click());
  expect(onPreviewChange.mock.lastCall?.[0].labels[0].text).toBe("Fork");
  await render(scan);
  const clearance = buildLiveTacticalScan({
    fen: "8/8/2k1B3/2b4r/p7/Pp4B1/1P2bPP1/R1K1R3 b - - 3 34",
    pvUci: ["c5e3", "f2e3", "h5c5", "e6c4", "c5c4", "c1b1", "e2d3"],
    pvSan: ["Be3+", "fxe3", "Rc5+", "Bc4", "Rxc4+", "Kb1", "Bd3#"],
    engineName: "Regression", depth: 16,
  });
  await render(clearance);
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Show Be3+ on board"]')!.click());
  expect(onPreviewChange.mock.lastCall?.[0].labels.map((label: {id: string}) => label.id)).toEqual(["mateIn4", "clearance"]);
  expect(onPreviewChange.mock.lastCall?.[0].arrows).toHaveLength(2);
  await render(scan);
  await act(async () => button().click());
  expect(onPreviewChange.mock.lastCall?.[0].labels).toHaveLength(1);
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
