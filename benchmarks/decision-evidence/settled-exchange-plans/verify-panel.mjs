import { readFileSync } from "node:fs";
import { verifyDecisionPanel } from "../decision-panel-test-harness.mjs";

const { amsterdam } = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
await verifyDecisionPanel({
  input: { ...amsterdam, playedMoveUci: amsterdam.recordedMove },
  previousSan: "Bxe5",
  assessment: process.env.SETTLED_EXCHANGE_REVISION ?? "index",
  baseline: "a779f152",
  description: "Mixed move and the pawn plan after the exchange",
  async verify(page) {
    const move = page.getByText("What the move achieves", { exact: true }).locator("../..");
    await move.getByText("Mixed", { exact: true }).waitFor();
    await move.getByText(/passed pawn on d5.*d4 advances/).waitFor();
    await move.getByRole("button", { name: "Show evidence" }).press("Enter");
    await move.getByText(/After Bxe5.*dxe5.*d4/).waitFor();
  },
});
