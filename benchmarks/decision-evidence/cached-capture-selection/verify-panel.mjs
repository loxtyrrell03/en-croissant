import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyDecisionPanel } from "../decision-panel-test-harness.mjs";

const { amager } = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url)));

await verifyDecisionPanel({
  input: { ...amager.input, fixtureCaptureOrder: amager.captureOrder },
  previousSan: "...Qd4",
  assessment: "893c9234",
  baseline: "893c9234",
  description: "The exact capture orders and their conditional scope",
  async verify(page) {
    const position = page.getByText("Position character", { exact: true }).locator("../..");
    const move = page.getByText("What the move achieves", { exact: true }).locator("../..");
    for (const section of [position, move]) {
      await section.getByRole("button", { name: "Show evidence", exact: true }).click();
      const evidence = await section.innerText();
      assert.match(evidence, /After bxc3, Qxc5.*on c3.*Rxc3.*Qxd4/);
      assert.match(evidence, /Other defences can change the continuation/);
      assert.match(evidence, /Defender first\..*Qxc5/);
      assert.match(evidence, /Taking too early\..*Rxc3 Qxd4/);
      await section.getByRole("button", { name: "Hide evidence", exact: true }).click();
      assert.equal(await section.getByText("Defender first.", { exact: true }).count(), 0);
    }
  },
});
