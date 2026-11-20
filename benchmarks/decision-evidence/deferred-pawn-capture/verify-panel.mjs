import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyDecisionPanel } from "../decision-panel-test-harness.mjs";

const input = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url)));
await verifyDecisionPanel({
  input,
  previousSan: "Kxg4",
  assessment: "8de75033",
  baseline: "8de75033",
  description: "A positional capture with a deferred alternative",
  async verify(page) {
    const choice = page.getByText("What the move achieves", { exact: true }).locator("../..");
    await choice.getByText("Positional", { exact: true }).waitFor();
    const show = choice.getByRole("button", { name: "Show evidence", exact: true });
    assert.equal(await show.getAttribute("aria-expanded"), "false");
    await show.click();
    const text = await choice.innerText();
    assert.match(text, /Bb2 Rd7 Bc4 Nc6 Kxg4/);
    assert.match(text, /The pawn on g4 can also be taken later/);
    assert.doesNotMatch(text, /Hanging Pawn/);
    await choice.getByRole("button", { name: "Hide evidence", exact: true }).click();
    assert.equal(await show.getAttribute("aria-expanded"), "false");
  },
});
