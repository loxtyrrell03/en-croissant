import { readFileSync } from "node:fs";
import { verifyDecisionPanel } from "../decision-panel-test-harness.mjs";

const { heldout } = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url)));
await verifyDecisionPanel({
    input: { ...heldout.input, fixtureQuietReply: heldout.probe },
    assessment: process.env.QUIET_REPLY_VERSION ?? "HEAD",
    baseline: "27580772",
    description: "Quiet reply and counterplay",
    async verify(page) {
        const move = page.getByText("What the move achieves", { exact: true }).locator("../..");
        await move.getByRole("button", { name: "Show evidence" }).press("Enter");
        await move.getByText(/Engine supported.*After h3, Qg3.*on g4/).waitFor();
        await move.getByText(/If Qg3.*h3.*Qg3/).waitFor();
        await page.getByRole("textbox", { name: "Candidate move" }).click();
        const other = page.getByRole("option").nth(1);
        await other.click();
        await move.getByText(/After h3, Qg3/).waitFor({ state: "hidden" });
    },
});
