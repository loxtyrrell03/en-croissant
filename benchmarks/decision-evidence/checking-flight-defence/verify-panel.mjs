import { readFileSync } from "node:fs";
import { verifyDecisionPanel } from "../decision-panel-test-harness.mjs";

const { input, frames } = JSON.parse(
  readFileSync(new URL("./fixture.json", import.meta.url), "utf8"),
);
await verifyDecisionPanel({
  input: { ...input, passerFlight: frames.shallow },
  previousSan: "Rd4",
  assessment: process.env.PASSER_FLIGHT_REVISION ?? "index",
  baseline: "f851ecda",
  description: "Mixed rook defence and tactical mistake",
  async verify(page) {
    const move = page.getByText("What the move achieves", { exact: true }).locator("../..");
    await move.getByText("Mixed", { exact: true }).waitFor();
    await move.getByText(/rook on b2 works along the passed pawn/).waitFor();
    const toggle = move.getByRole("button", { name: "Show evidence" });
    await toggle.focus();
    await toggle.press("Enter");
    await move.getByText(/After Rb2.*b7.*Ne3[+].*Rxb7/).waitFor();
    await move.getByText(/After Rd4.*b7.*Ne3[+].*Ke2.*Kxe3/).waitFor();
    const mistake = page.getByText("What Rd4 missed or allowed", { exact: true }).locator("../..");
    await mistake.getByText("Tactical", { exact: true }).waitFor();
    await mistake.getByText(/Rb2 covers e2/).waitFor();
  },
});
