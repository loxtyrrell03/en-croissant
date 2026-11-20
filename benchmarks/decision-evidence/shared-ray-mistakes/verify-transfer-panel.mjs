import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyDecisionPanel } from "../decision-panel-test-harness.mjs";

const { promotionExchange: input } = JSON.parse(
  readFileSync(new URL("./candidate-regression.json", import.meta.url)),
);

await verifyDecisionPanel({
  input,
  previousSan: "Nc2",
  assessment: process.env.RAY_RELEASE ?? "HEAD",
  baseline: "46101c2f",
  description: "Same-reply material comparison",
  async verify(page) {
    const section = page.getByText("What Nc2 missed or allowed", { exact: true }).locator("../..");
    await section.getByText("Tactical", { exact: true }).first().waitFor();
    const show = section.getByRole("button", { name: "Show evidence", exact: true });
    await show.focus();
    await show.press("Enter");
    const evidence = await section.innerText();
    assert.match(evidence, /Nc2 lets Rb2.*Rxe2.*After Be5.*Bxb2/s);
    assert.match(evidence, /Played line.*Nc2 Rb2.*a1=Q.*Nxa1.*Rxe2.*Better line.*Be5 Rb2 Bxb2/s);
    await section.getByRole("button", { name: "Hide evidence", exact: true }).click();
  },
});
