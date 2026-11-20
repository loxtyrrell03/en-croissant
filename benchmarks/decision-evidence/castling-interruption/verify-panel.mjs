import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyDecisionPanel } from "../decision-panel-test-harness.mjs";

const { checked } = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url)));
await verifyDecisionPanel({
  input: checked,
  previousSan: "c6",
  assessment: process.env.CASTLE_RELEASE ?? "HEAD",
  baseline: "7a11ac6a",
  description: "Castling rights lost to a forced king move",
  async verify(page) {
    const summary = page.getByText("What c6 missed or allowed", { exact: true }).locator("../..");
    await summary.getByText("Mixed", { exact: true }).first().waitFor();
    const compact = await summary.innerText();
    assert.match(compact, /Tactical · Engine supported.*Nd6\+/s);
    assert.match(compact, /Positional · Strategic interpretation.*permanently gives up castling/s);
    assert.doesNotMatch(compact, /Same check after castling first/);
    await summary.getByRole("button", { name: "Show evidence", exact: true }).click();
    const evidence = await summary.innerText();
    assert.match(evidence, /Nd6\+.*Every legal reply moves the king.*Kd7/s);
    assert.match(evidence, /permanently gives up castling/);
    assert.match(evidence, /Same check after castling first/);
  },
});
