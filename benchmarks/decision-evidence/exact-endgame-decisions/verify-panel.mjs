import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyDecisionPanel } from "../decision-panel-test-harness.mjs";

const { panelInput, evidence } = JSON.parse(
  readFileSync(new URL("./witness.json", import.meta.url)),
);
const seen = new WeakMap();
const snapshots = new Map(evidence.records.map((record) => [record.fen, record.result]));

await verifyDecisionPanel({
  input: panelInput,
  previousSan: "Kf1",
  baseline: "ef2448a0",
  assessment: "ef2448a0",
  description: "Tablebase scope, failure, retry and exact outcomes",
  async prepare(page) {
    const requests = [];
    seen.set(page, requests);
    await page.route("https://tablebase.lichess.org/standard?*", async (route) => {
      const fen = new URL(route.request().url()).searchParams.get("fen");
      requests.push(fen);
      const headers = { "access-control-allow-origin": "*" };
      if (requests.length === 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.abort().catch(() => {});
      } else if (requests.length === 2) {
        await route.fulfill({ status: 503, headers });
      } else {
        assert.ok(snapshots.has(fen));
        await route.fulfill({ json: snapshots.get(fen), headers });
      }
    });
  },
  async verify(page) {
    const position = page.getByText("Position character", { exact: true }).locator("../..");
    const check = position.getByRole("button", { name: "Check endgame online" });
    await position.getByText("Positional", { exact: true }).waitFor();
    await check.waitFor();
    const requests = seen.get(page);
    assert.equal(requests.length, 0);
    const help = position.getByRole("button", { name: "About the endgame check" });
    await help.press("Enter");
    await page.getByText(/Sends this board and, when needed/).waitFor();
    await help.press("Escape");
    await Promise.all([
      page.waitForRequest("https://tablebase.lichess.org/standard?*"),
      check.click(),
    ]);
    await position.getByRole("button", { name: "Cancel endgame check" }).click();
    await check.click();
    await position
      .getByRole("alert")
      .getByText("Couldn’t verify this endgame. You can try again.")
      .waitFor();
    await position.getByRole("button", { name: "Retry endgame check" }).click();
    await position.getByText("Mixed", { exact: true }).waitFor();
    await position.getByText(/3 of 19 legal moves draw.*Rg6, Rg7, Rg8/).waitFor();
    await position.getByText(/Rg5 allows Rxg5/).waitFor();
    const candidate = page.getByText("What the move achieves", { exact: true }).locator("../..");
    await candidate.getByText("Tablebase · Draw", { exact: true }).waitFor();
    await candidate.getByText("Tactical", { exact: true }).waitFor();
    const mistake = page.getByText("What Kf1 allows", { exact: true }).locator("../..");
    await mistake.getByText("Tactical", { exact: true }).waitFor();
    await mistake.getByText(/Draw → Loss/).waitFor();
    await mistake.getByText(/Kf1 leaves e2.*e2\+/).waitFor();
    assert.deepEqual(requests, [
      evidence.records[0].fen,
      evidence.records[0].fen,
      evidence.records[0].fen,
      evidence.records[2].fen,
      evidence.records[1].fen,
    ]);
  },
});

await verifyDecisionPanel({
  input: { ...panelInput, forceFailure: true },
  previousSan: "Kf1",
  baseline: "ef2448a0",
  assessment: "ef2448a0",
  description: "Exact endgame fallback after an unavailable engine report",
  async prepare(page) {
    await page.route("https://tablebase.lichess.org/standard?*", (route) => {
      const fen = new URL(route.request().url()).searchParams.get("fen");
      assert.ok(snapshots.has(fen));
      return route.fulfill({
        json: snapshots.get(fen),
        headers: { "access-control-allow-origin": "*" },
      });
    });
  },
  async verify(page) {
    await page.getByRole("alert").getByText("No completed engine result.").waitFor();
    await page.getByRole("button", { name: "Check endgame online" }).click();
    await page.getByText(/3 of 19 legal moves draw/).waitFor();
    await page.getByText(/Kf1 leaves e2.*e2\+/).waitFor();
  },
});
