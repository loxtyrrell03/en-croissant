import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { TacticalLineExplanation } from "@/components/panels/tactics/TacticalLineExplanation";
import { classifyPositionTacticalMotifs } from "@/utils/tacticalMotifs/mistakeReviewAdapter";

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
