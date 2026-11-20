import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyDecisionPanel } from "../decision-panel-test-harness.mjs";

const input = JSON.parse(readFileSync(new URL("./wording-fixture.json", import.meta.url)));
await verifyDecisionPanel({
  input,
  previousSan: "Bf2",
  assessment: process.env.DECISION_WORDING_RELEASE ?? "HEAD",
  baseline: "8de75033",
  description: "Explaining the defender in a mixed decision",
  async verify(page) {
    const summary = page.getByText("What the move achieves", { exact: true }).locator("../..");
    await summary.getByText("Mixed", { exact: true }).waitFor();
    const compact = await summary.innerText();
    assert.match(compact, /Bf2.*e3.*Bxe3 removes.*recapture on b6.*Rxb6/s);
    assert.doesNotMatch(compact, /capturingDefender|at ply/);
    assert.match(compact, /Strategic interpretation.*passed pawn on b6/);
    await summary.getByRole("button", { name: "Show evidence", exact: true }).click();
    assert.match(await summary.innerText(), /Bf2 Rh5 Bxe3 Kxe3 Rxb6/);
  },
});
