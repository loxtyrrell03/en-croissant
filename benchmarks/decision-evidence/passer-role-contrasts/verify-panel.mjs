import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyDecisionPanel } from "../decision-panel-test-harness.mjs";

const { chile } = JSON.parse(readFileSync(new URL("./runtime-fixture.json", import.meta.url)));
const { captureOrder, ...input } = chile;

await verifyDecisionPanel({
  input: { ...input, playedMoveUci: "g3f2", fixtureCaptureOrder: captureOrder },
  previousSan: "Bf2",
  assessment: "9812c1bf",
  baseline: "9812c1bf",
  description: "Separate tactical and passed-pawn evidence",
  async verify(page) {
    const position = page.getByText("Position character", { exact: true }).locator("../..");
    const move = page.getByText("What the move achieves", { exact: true }).locator("../..");
    for (const section of [position, move]) {
      await section.getByRole("button", { name: "Show evidence", exact: true }).click();
      const text = await section.innerText();
      assert.match(text, /\bMixed\b/i);
      assert.match(text, /Engine supported.*Bxf2/);
      assert.match(text, /Strategic interpretation.*passed pawn on b6/);
      assert.match(text, /Bg5.*Rxb6/);
      await section.getByRole("button", { name: "Hide evidence", exact: true }).click();
    }
  },
});
