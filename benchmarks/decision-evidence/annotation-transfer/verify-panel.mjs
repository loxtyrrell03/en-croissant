import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyDecisionPanel } from "../decision-panel-test-harness.mjs";

const { pawnLock: input } = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url)));

await verifyDecisionPanel({
  input,
  previousSan: "h4",
  assessment: process.env.ANNOTATION_RELEASE ?? "HEAD",
  baseline: "cc956cb1",
  description: "Played move outside the engine shortlist",
  async verify(page) {
    const position = page.getByText("Position character", { exact: true }).locator("../..");
    assert.match(await position.innerText(), /Unclear/i);
    const section = page.getByText("What the move achieves", { exact: true }).locator("../..");
    const select = section.getByRole("textbox", { name: "Candidate move" });
    assert.match(await select.inputValue(), /Ba5.*first choice/);
    await select.click();
    await page.getByRole("option", { name: "h4 · Played move", exact: true }).click();
    await section.getByText("Positional", { exact: true }).first().waitFor();
    await section.getByRole("button", { name: "Show evidence", exact: true }).click();
    assert.match(await section.innerText(), /fixes opposing pawns on h4 and h5/);
    const mistake = page.getByText("What h4 missed or allowed", { exact: true }).locator("../..");
    assert.match(await mistake.innerText(), /evaluation loss/);
    await section.getByRole("button", { name: "Hide evidence", exact: true }).click();
  },
});
