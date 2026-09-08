import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { TacticalLineExplanation } from "@/components/panels/tactics/TacticalLineExplanation";
import { classifyPositionTacticalMotifs } from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import { replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";

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
