import { MantineProvider } from "@mantine/core";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { TacticalLineExplanation } from "@/components/panels/tactics/TacticalLineExplanation";
import { classifyPositionTacticalMotifs } from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import { replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";

test("a drawn recapturer is explained before the king's actual discovered check", () => {
  const fen = "6r1/1p6/6k1/4R3/4Nr2/8/7P/6K1 b - - 0 1";
  const line = ["f4e4", "e5e4", "g6f5", "g1f2", "f5e4"];
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
  expect(container.querySelector('[data-tactical-ply="1"]')?.textContent).toContain("Attraction");
  expect(container.querySelector('[data-tactical-ply="1"]')?.textContent).toContain(
    "not this board",
  );
  expect(container.querySelector('[data-tactical-ply="3"]')?.textContent).toContain(
    "Discovered Check",
  );
});

test("a defended block does not hide the initial skewer or move the mate to the root", () => {
  const fen = "4r1rk/4q2p/8/8/8/3BN3/1PP5/R1K5 b - - 0 1";
  const line = ["g8g1", "d3f1", "g1f1", "e3f1", "e7e1"];
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
  expect(root.textContent).toContain("Skewer");
  expect(root.textContent).toContain("Bf1 Rxf1+ Kd2 Rxa1");
  expect(root.textContent).toContain("not a forced-mate claim");
  expect(container.querySelector('[data-tactical-ply="5"]')?.textContent).toContain("Checkmate");
});

test("a shared mating route has one explanation rather than a third mechanism badge", () => {
  const fen = "4r1rk/4q2p/5n1Q/8/3n4/3B3R/3K4/8 w - - 0 1";
  const line = ["h6f6", "e7f6", "h3h7"];
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
  expect(root.textContent).toContain("Deflection");
  expect(root.textContent).toContain("Fork");
  expect(root.textContent).toContain("opens the rook's line from h3 to h7");
  expect(root.textContent).not.toContain("Discovered Attack");
  expect(container.querySelector('[data-tactical-ply="3"]')?.textContent).toContain("Checkmate");
});

test("a delaying check keeps the sacrifice and eventual fork on their actual moves", () => {
  const fen = "8/4r1p1/p2k4/1bN5/5K2/5P2/6P1/1R6 w - - 0 1";
  const line = ["c5a6", "g7g5", "f4g3", "b5a6", "b1b6", "d6d7", "b6a6"];
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
  expect(container.querySelector('[data-tactical-ply="1"]')?.textContent).toContain(
    "not an attack on this board",
  );
  expect(container.querySelector('[data-tactical-ply="4"]')?.textContent).not.toContain(
    "Hanging Piece",
  );
  expect(container.querySelector('[data-tactical-ply="5"]')?.textContent).toContain("Fork");
});

test("pawn-square clearance is explained at the offer and the fork at its actual move", () => {
  const fen = "4k3/7r/8/8/6pN/4r1P1/5RPK/8 b - - 0 1";
  const line = ["h7h4", "g3h4", "g4g3", "h2g1", "g3f2", "g1f2"];
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
  expect(root.textContent).toContain("draw the pawn off g3");
  expect(container.querySelector('[data-tactical-ply="2"]')?.textContent).not.toContain(
    "Winning Recapture",
  );
  expect(container.querySelector('[data-tactical-ply="3"]')?.textContent).toContain("Fork");
});

test("the two-defender combination explains the offer without a false winning recapture", () => {
  const fen = "6k1/2r2ppp/2q5/3n4/8/6Q1/5PPP/3R1RK1 w - - 0 1";
  const line = ["d1d5", "c6d5", "g3c7"];
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
    "Removing the Defenders",
  );
  expect(container.querySelector('[data-tactical-ply="1"]')?.textContent).toContain(
    "Both guarded the rook on c7",
  );
  expect(container.querySelector('[data-tactical-ply="2"]')?.textContent).not.toContain(
    "Winning Recapture",
  );
  expect(container.querySelector('[data-tactical-ply="3"]')?.textContent).toContain("Qxc7");
});

test("the pin entry explains its connected continuation without a premature fork badge", () => {
  const fen = "2r2rk1/pp4pp/1n3p2/3p4/3qp1N1/6Q1/P1P3PP/1N2R2K w - - 4 21";
  const result = classifyPositionTacticalMotifs({ fen, pvUci: ["g4h6"] });
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <MantineProvider>
      <TacticalLineExplanation moves={["Nh6+"]} motifs={result.timeline ?? []} />
    </MantineProvider>,
  );
  const root = container.querySelector('[data-tactical-ply="1"]')!;
  expect(root.textContent).toContain("Pin");
  expect(root.textContent).toContain("Nf5 attacks the queen on d4");
  expect(root.textContent).toContain("Qxg7#");
  expect(root.textContent).not.toContain("Fork");
});

test("an unverified repetition does not render a later gift as its pin lesson", () => {
  const fen = "6k1/5Npp/8/8/8/2r3Q1/8/6K1 w - - 0 1";
  const line = ["f7h6", "g8h8", "h6f7", "h8g8", "g3c3", "g7g6"];
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
  expect(container.textContent).not.toContain("Pin");
  expect(container.querySelector('[data-tactical-ply="5"]')).toBeNull();
});

test("deflection explains both defences without a false acceptance or early payoff arrow", () => {
  const fen = "4r1k1/3q1pbp/6p1/3Q4/8/5P2/P5PP/R2R2K1 b - - 0 1";
  const line = ["e8e1", "d1e1", "d7d5"];
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
    "Kf2 Qxd5 Rxd5 Rxa1",
  );
  expect(container.querySelector('[data-tactical-ply="2"]')?.textContent).toContain("Rxe1");
  expect(container.querySelector('[data-tactical-ply="2"]')?.textContent).not.toContain(
    "Hanging Piece",
  );
  expect(container.querySelector('[data-tactical-ply="3"]')?.textContent).toContain("queen on d5");
});

test("king attraction shows the complete mate and no false winning acceptance badge", () => {
  const fen = "5r1k/7p/4B3/4NpP1/8/3Q3R/8/6K1 w - - 0 1";
  const line = ["h3h7", "h8h7", "d3h3", "h7g7", "h3h6"];
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
    "Kxh7 Qh3+ Kg7 Qh6#",
  );
  const acceptance = container.querySelector('[data-tactical-ply="2"]')!;
  expect(acceptance.textContent).toContain("Kxh7");
  expect(acceptance.textContent).not.toContain("Winning Recapture");
  expect(acceptance.textContent).not.toContain("Hanging Piece");
  expect(container.querySelector('[data-tactical-ply="5"]')?.textContent).toContain("Checkmate");
});

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
