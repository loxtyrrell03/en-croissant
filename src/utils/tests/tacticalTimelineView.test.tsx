import { MantineProvider } from "@mantine/core";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { TacticalLineExplanation } from "@/components/panels/tactics/TacticalLineExplanation";
import { classifyPositionTacticalMotifs } from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import { replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";

test("a mate-protected fork leads with its actual targets and keeps mate conditional", () => {
  const fen = "3qkb1r/5p1b/4p1pp/4N3/2B5/6N1/4QPPP/6K1 w k - 0 1";
  const line = ["e5f7", "e8f7", "e2e6", "f7g7", "e6f7"];
  const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <MantineProvider>
      <TacticalLineExplanation
        moves={replayTacticalLine(fen, line).map((s) => s.san)}
        motifs={result.timeline ?? []}
      />
    </MantineProvider>,
  );
  const root = container.querySelector('[data-tactical-ply="1"]')!;
  expect(root.textContent).toContain("forks the queen on d8 and rook on h8");
  expect(root.textContent).toContain("conditional, not a forced mate");
  expect(root.textContent).not.toContain("Nf5+");
  expect(container.querySelector('[data-tactical-ply="2"]')?.textContent).not.toContain(
    "Hanging Piece",
  );
  expect(container.querySelector('[data-tactical-ply="2"]')?.textContent).not.toContain(
    "Winning Recapture",
  );
  expect(container.querySelector('[data-tactical-ply="5"]')?.textContent).toContain("Checkmate");
});

test("a perpetual is one drawing lesson, not a new tactic on every repeated check", () => {
  const fen = "r6k/5Q1p/6p1/8/q7/8/8/5R1K w - - 0 1";
  const line = ["f7f6", "h8g8", "f6f7", "g8h8", "f7f6"];
  const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <MantineProvider>
      <TacticalLineExplanation
        moves={replayTacticalLine(fen, line).map((s) => s.san)}
        motifs={result.timeline ?? []}
      />
    </MantineProvider>,
  );
  expect(container.querySelector('[data-tactical-ply="1"]')?.textContent).toContain(
    "Perpetual Check",
  );
  expect(container.textContent).toContain("not a draw already claimed");
  expect(container.querySelector('[data-tactical-ply="3"]')?.textContent).not.toContain(
    "Perpetual Check",
  );
});

test("the forced mate renders without advertising the unrelated attacked knight", () => {
  const fen = "1n5k/7p/5q2/8/8/6R1/8/4R1K1 w - - 0 1";
  const line = ["e1e8", "f6f8", "e8f8"];
  const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <MantineProvider>
      <TacticalLineExplanation
        moves={replayTacticalLine(fen, line).map((s) => s.san)}
        motifs={result.timeline ?? []}
      />
    </MantineProvider>,
  );
  expect(container.textContent).not.toContain("Fork");
  expect(container.querySelector('[data-tactical-ply="1"]')?.textContent).toContain("Forcing Mate");
  expect(container.querySelector('[data-tactical-ply="3"]')?.textContent).toContain("Checkmate");
});

test("a declined mating offer does not label its compensated knight capture a new win", () => {
  const fen = "4r2k/5rp1/6qp/3PB3/4Q2n/3R4/6PP/4R1K1 b - - 0 1";
  const line = ["e8e5", "e4h4", "e5e1", "h4e1", "g6d3"];
  const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <MantineProvider>
      <TacticalLineExplanation
        moves={replayTacticalLine(fen, line).map((s) => s.san)}
        motifs={result.timeline ?? []}
      />
    </MantineProvider>,
  );
  const root = container.querySelector('[data-tactical-ply="1"]')!;
  expect(root.textContent).toContain("Accepting with Qxe5 allows Qxg2#");
  expect(root.textContent).toContain("After Qxh4, Rxe1+");
  expect(root.textContent).toContain("not a forced-mate claim");
  expect(container.querySelector('[data-tactical-ply="2"]')?.textContent).toContain("Qxh4");
  expect(container.querySelector('[data-tactical-ply="2"]')?.textContent).not.toContain(
    "Hanging Piece",
  );
  expect(container.querySelector('[data-tactical-ply="5"]')?.textContent).toContain("Qxd3");
});

test("attraction explains move order while the discovery remains at its actual ply", () => {
  const fen = "6k1/8/1qp5/5b2/Q1P1n3/2N5/1P3PP1/6K1 w - - 0 1";
  const line = ["c3e4", "f5e4", "c4c5", "b6c5", "a4e4"];
  const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <MantineProvider>
      <TacticalLineExplanation
        moves={replayTacticalLine(fen, line).map((s) => s.san)}
        motifs={result.timeline ?? []}
      />
    </MantineProvider>,
  );
  const root = container.querySelector('[data-tactical-ply="1"]')!;
  expect(root.textContent).toContain("Attraction");
  expect(root.textContent).toContain("invites Bxe4");
  expect(root.textContent).toContain("Playing c5 first instead permits Nxc5");
  expect(container.querySelector('[data-tactical-ply="2"]')?.textContent).not.toContain(
    "Winning Recapture",
  );
  expect(container.querySelector('[data-tactical-ply="3"]')?.textContent).toContain(
    "Discovered Attack",
  );
});

test.skipIf(!process.env.TACTICAL_PRIVATE_PGN_SAMPLE)(
  "renders mixed recaptures conditionally without labelling sacrifice acceptance a win",
  () => {
    const row = JSON.parse(
      readFileSync(process.env.TACTICAL_PRIVATE_PGN_SAMPLE!, "utf8"),
    ).cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 193);
    for (const line of [row.sourceUci, ["g4e3", "c1e3", "e1a1"]]) {
      const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: line });
      const container = document.createElement("div");
      container.innerHTML = renderToStaticMarkup(
        <MantineProvider>
          <TacticalLineExplanation
            moves={replayTacticalLine(row.fen, line).map((s) => s.san)}
            motifs={result.timeline ?? []}
          />
        </MantineProvider>,
      );
      const root = container.querySelector('[data-tactical-ply="1"]')!;
      expect(root.textContent).toContain("Deflection");
      expect(root.textContent).toContain("If Bxe3, Qxa1");
      expect(root.textContent).toContain("different recapture, Rxe3");
      expect(root.textContent).toContain("not every defence");
      expect(container.querySelector('[data-tactical-ply="2"]')?.textContent).not.toContain(
        "Winning Recapture",
      );
      const third = container.querySelector('[data-tactical-ply="3"]')?.textContent ?? "";
      expect(third.includes("Pin")).toBe(line[1] === "f3e3");
      expect(third.includes("adds an attack on the rook on e3")).toBe(line[1] === "f3e3");
    }
  },
);

test("defender-removing preparation explains both move orders without a premature fork badge", () => {
  const fen = "8/5pkp/6p1/2p5/2Rp4/3Q4/1q4PP/6BK w - - 0 1";
  const line = ["c4d4", "c5d4", "g1d4"];
  const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <MantineProvider>
      <TacticalLineExplanation
        moves={replayTacticalLine(fen, line).map((s) => s.san)}
        motifs={result.timeline ?? []}
      />
    </MantineProvider>,
  );
  const root = container.querySelector('[data-tactical-ply="1"]')!;
  expect(root.textContent).toContain("Fork Preparation");
  expect(root.textContent).toContain("draw the defending pawn off c5");
  expect(root.textContent).toContain("Playing Bxd4+ first");
  expect(root.textContent).toContain("Taking with Qxd4");
  expect(container.querySelector('[data-tactical-ply="2"]')?.textContent).not.toContain(
    "Winning Recapture",
  );
  expect(container.querySelector('[data-tactical-ply="3"]')?.textContent).toContain("Fork");
});

test("the fork's checking recapture is conditional and the sacrifice acceptance is not a win", () => {
  const fen = "3r2qk/6pr/5p1P/8/4N3/2B5/5PPP/5RK1 w - - 0 1";
  const line = ["e4f6", "g7f6", "c3f6", "h7g7", "f6g7"];
  const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <MantineProvider>
      <TacticalLineExplanation
        moves={replayTacticalLine(fen, line).map((s) => s.san)}
        motifs={result.timeline ?? []}
      />
    </MantineProvider>,
  );
  expect(container.querySelector('[data-tactical-ply="1"]')?.textContent).toContain(
    "Taking the forker with gxf6 instead allows Bxf6+",
  );
  expect(container.querySelector('[data-tactical-ply="1"]')?.textContent).toContain("conditional");
  expect(container.querySelector('[data-tactical-ply="2"]')?.textContent).not.toContain(
    "Winning Recapture",
  );
  expect(container.querySelector('[data-tactical-ply="3"]')?.textContent).toContain("Bxf6+");
});

test("a declined mating deflection keeps its conditional explanation at the offer", () => {
  const fen = "8/3Q4/6pp/5n1k/2B1N1pq/8/3B4/6K1 w - - 0 1";
  const line = ["d7f5", "h4g5", "d2g5"];
  const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <MantineProvider>
      <TacticalLineExplanation
        moves={replayTacticalLine(fen, line).map((s) => s.san)}
        motifs={result.timeline ?? []}
      />
    </MantineProvider>,
  );
  const offer = container.querySelector('[data-tactical-ply="1"]')!;
  expect(offer.textContent).toContain("Deflection");
  expect(offer.textContent).toContain("Accepting with gxf5 allows Bf7#");
  expect(offer.textContent).toContain("not a forced-mate claim");
  expect(container.querySelector('[data-tactical-ply="3"]')?.textContent).toContain("Bxg5");
  expect(container.querySelector('[data-tactical-ply="3"]')?.textContent).not.toContain("Bf7#");
});

test("keeps the sacrifice acceptance visible without a misleading material-win badge", () => {
  const fen = "8/8/6k1/5qpr/4N3/8/8/K6Q w - - 0 1";
  const line = ["h1h5", "g6h5", "e4g3"];
  const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <MantineProvider>
      <TacticalLineExplanation
        moves={replayTacticalLine(fen, line).map((s) => s.san)}
        motifs={result.timeline ?? []}
      />
    </MantineProvider>,
  );
  expect(container.querySelector('[data-tactical-ply="1"]')?.textContent).toContain(
    "Fork Preparation",
  );
  const acceptance = container.querySelector('[data-tactical-ply="2"]')!;
  expect(acceptance.textContent).toContain("Kxh5");
  expect(acceptance.textContent).not.toContain("Winning Recapture");
  expect(acceptance.textContent).not.toContain("Hanging Piece");
  expect(container.querySelector('[data-tactical-ply="3"]')?.textContent).toContain("Fork");
});

test("retains later engine moves without presenting them as current tactical findings", () => {
  const fen = "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5";
  const line = [
    "c4f7",
    "e8f8",
    "f7b3",
    "c7c5",
    "d2d4",
    "c8b7",
    "e1g1",
    "d7d5",
    "c2c4",
    "d5c4",
    "b3c4",
    "d8c7",
    "b1c3",
    "b8c6",
    "c3d5",
    "f6d5",
    "c4d5",
    "c6e5",
  ];
  const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
  const html = renderToStaticMarkup(
    <MantineProvider>
      <TacticalLineExplanation
        moves={replayTacticalLine(fen, line).map((step) => step.san)}
        motifs={result.timeline ?? []}
      />
    </MantineProvider>,
  );
  const container = document.createElement("div");
  container.innerHTML = html;
  expect(container.textContent).toContain("quiet pause ends the tactical labels");
  expect(container.querySelector('[data-tactical-ply="1"]')?.textContent).toContain("Weak f7");
  expect(container.querySelector('[data-tactical-ply="18"]')?.textContent).toContain("Nxe5");
  expect(container.querySelector('[data-tactical-ply="18"]')?.textContent).not.toContain(
    "Hanging Piece",
  );
});

test("renders the actual counterfork under Black's reply, with continuation details collapsed", () => {
  const result = classifyPositionTacticalMotifs({
    fen: "6k1/8/4q3/8/1n6/8/4R3/R3K3 w Q - 0 1",
    pvUci: ["e2e6", "b4c2", "e1d1", "c2a1"],
  });
  const html = renderToStaticMarkup(
    <MantineProvider>
      <TacticalLineExplanation
        moves={["Rxe6", "Nc2+", "Kd1", "Nxa1"]}
        motifs={result.timeline ?? []}
      />
    </MantineProvider>,
  );
  const container = document.createElement("div");
  container.innerHTML = html;
  expect(container.querySelector("details")?.hasAttribute("open")).toBe(false);
  const root = container.querySelector('[data-tactical-ply="1"]')!;
  const reply = container.querySelector('[data-tactical-ply="2"]')!;
  expect(root.textContent).toContain("White");
  expect(root.textContent).not.toContain("Fork");
  expect(reply.textContent).toContain("Nc2+");
  expect(reply.textContent).toContain("Black");
  expect(reply.textContent).toContain("Fork");
  expect(container.querySelector('[data-tactical-ply="4"]')?.textContent).toContain("Nxa1");
});

test("renders a profitable recapture as the material payoff, not a hanging-piece accusation", () => {
  const fen = "rnbq1bnr/pppp1kpp/5P2/8/8/2N5/PP2QPPP/R1B1KBNR w KQ - 1 8";
  const line = ["e2h5", "g7g6", "f1c4", "d7d5", "c4d5", "d8d5", "h5d5"];
  const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
  const html = renderToStaticMarkup(
    <MantineProvider>
      <TacticalLineExplanation
        moves={replayTacticalLine(fen, line).map((step) => step.san)}
        motifs={result.timeline ?? []}
      />
    </MantineProvider>,
  );
  const container = document.createElement("div");
  container.innerHTML = html;
  const payoff = container.querySelector('[data-tactical-ply="7"]')!;
  expect(payoff.textContent).toContain("Qxd5+");
  expect(payoff.textContent).toContain("Winning Recapture");
  expect(payoff.textContent).toContain("bishop");
  expect(payoff.textContent).not.toContain("Hanging Piece");
});
