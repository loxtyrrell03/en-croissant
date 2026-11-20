import { readFileSync } from "node:fs";
import { verifyDecisionPanel } from "../decision-panel-test-harness.mjs";

const { bavaria } = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url)));
await verifyDecisionPanel({
  input: { ...bavaria.input, fixtureSiblingRefutation: bavaria.causal },
  assessment: process.env.SIBLING_REVISION ?? "index",
  baseline: "8e38f00f",
  description: "Tactical alternative alongside two sound choices",
  async verify(page) {
    const position = page.getByText("Position character", { exact: true }).locator("../..");
    await position.getByText("Tactical", { exact: true }).waitFor();
    await position.getByText(/Qc8 allows Nxb5.*Nxd4 removes the piece/).waitFor();
    await position.getByRole("button", { name: "Show evidence" }).press("Enter");
    await position.getByText(/Refuted choice.*Qc8 Nxb5/).waitFor();
    await position.getByText(/Better line.*Nxd4/).waitFor();
  },
});
