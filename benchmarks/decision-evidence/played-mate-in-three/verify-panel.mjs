import { readFileSync } from "node:fs";
import { verifyDecisionPanel } from "../decision-panel-test-harness.mjs";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"));
const board = fixtures.biel;
const input = {
  ...board,
  replyProbes: board.replyProbes.filter((probe) => probe.moveUci === board.candidates[0].pvUci[0]),
};
await verifyDecisionPanel({
  input,
  previousSan: "Nxe4",
  assessment: process.env.MATE_THREE_REVISION ?? "HEAD",
  baseline: "c9e35249",
  description: "Played move, mating line and avoidance",
  async verify(page) {
    const panel = page.getByText("What Nxe4 missed or allowed", { exact: true }).locator("../..");
    await panel.getByText("Tactical", { exact: true }).first().waitFor();
    await panel.getByText(/Nxe4 permits Qh5.*within three.*d5/).waitFor();
    const toggle = panel.getByRole("button", { name: "Show evidence" });
    await toggle.focus();
    await toggle.press("Enter");
    await panel.getByText(/Mating line.*Nxe4.*Qh5.*#/).waitFor();
    await panel.getByText(/Move that avoids mate in 3.*d5.*Qh5/).waitFor();
    await panel.getByRole("button", { name: "Hide evidence" }).click();
  },
});
