import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyDecisionPanel } from "../decision-panel-test-harness.mjs";

const { clubCup: { captureRouteReply, ...clubCup } } = JSON.parse(
  readFileSync(new URL("./fixtures.json", import.meta.url)),
);

await verifyDecisionPanel({
  input: { ...clubCup, fixtureCaptureRouteReply: captureRouteReply },
  previousSan: "Qd4+",
  assessment: process.env.CAPTURE_ROUTE_RELEASE ?? "HEAD",
  baseline: "6a9bd4e1",
  description: "Pawn chain survives the checking capture",
  async verify(page) {
    for (const title of ["Position character", "What the move achieves"]) {
      const summary = page.getByText(title, { exact: true }).locator("../..");
      await summary.getByText("Mixed", { exact: true }).first().waitFor();
      await summary.getByRole("button", { name: "Show evidence", exact: true }).click();
      assert.match(await summary.innerText(), /pawn on b7 still supports c6/);
      assert.match(await summary.innerText(), /Taking the same bishop immediately with cxd5/);
      assert.match(await summary.innerText(), /After cxd5/);
    }
  },
});
