import { readFileSync } from "node:fs";
import { verifyDecisionPanel } from "../decision-panel-test-harness.mjs";

const board = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
const input = board;
await verifyDecisionPanel({
  input,
  previousSan: "Kf3",
  assessment: process.env.PROMOTION_TEMPO_ASSESSMENT ?? "index",
  baseline: "e624c951",
  description: "Mixed move evidence and unchanged Kf3 verdict",
  async verify(page) {
    const panel = page.getByText("What the move achieves", { exact: true }).locator("../..");
    await panel.getByText("Mixed", { exact: true }).waitFor();
    await panel.getByText(/same capture Rxd3\+ forces a response to check/).waitFor();
    await panel.getByText(/passed pawn on b6 promotes/).waitFor();
    const toggle = panel.getByRole("button", { name: "Show evidence" });
    await toggle.focus();
    await toggle.press("Enter");
    await panel.getByText(/After Kg1.*Rd6.*b7.*Rxd3.*b8=Q/).waitFor();
    await panel.getByText(/After Kf3.*Rd6.*b7.*Rxd3\+/).waitFor();
    await panel.getByRole("button", { name: "Hide evidence" }).click();
    await page
      .getByText("What Kf3 missed or allowed", { exact: true })
      .locator("../..")
      .getByText("Unclear", { exact: true })
      .waitFor();
  },
});
