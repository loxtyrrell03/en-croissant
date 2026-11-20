import { readFileSync } from "node:fs";
import { verifyDecisionPanel } from "../decision-panel-test-harness.mjs";

const { sameReply } = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url)));
await verifyDecisionPanel({
    input: { ...sameReply.input, fixtureCheckingOrder: sameReply.probe },
    assessment: process.env.CHECKING_ORDER_VERSION ?? "HEAD",
    baseline: "a29403a9",
    description: "Checking-order defence",
    async verify(page) {
        const position = page.getByText("Position character", { exact: true }).locator("../..");
        await position.getByRole("button", { name: "Show evidence" }).press("Enter");
        await position.getByText(/Engine supported.*Qh8 comes without check/).waitFor();
        await position.getByText(/Same reply after the better move.*Kg6.*Qh8.*Qf6/).waitFor();
    },
});
