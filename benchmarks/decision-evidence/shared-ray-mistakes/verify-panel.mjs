import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyDecisionPanel } from "../decision-panel-test-harness.mjs";

const input = JSON.parse(readFileSync(new URL("./retained-tactic.json", import.meta.url)));

await verifyDecisionPanel({
  input,
  previousSan: "Rf6",
  assessment: process.env.RAY_RELEASE ?? "c62e78f0",
  baseline: "c62e78f0",
  description: "The tactical mistake keeps its supported exchange explanation",
  async verify(page) {
    const panel = page.getByText("What Rf6 missed or allowed", { exact: true }).locator("../..");
    await panel.getByText("Tactical", { exact: true }).first().waitFor();
    await panel.getByRole("button", { name: "Show evidence", exact: true }).click();
    const evidence = await panel.innerText();
    assert.doesNotMatch(evidence, /skewer/i);
    assert.match(evidence, /Bxe7 removes the piece on e7/);
    assert.match(evidence, /Qxd6/);
    await panel.getByRole("button", { name: "Hide evidence", exact: true }).click();
  },
});
