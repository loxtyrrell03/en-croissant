import { readFileSync } from "node:fs";
import { verifyDecisionPanel } from "../decision-panel-test-harness.mjs";

const { position, mistake, counterattack } = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url)));
for (const [fixture, title, example, capture, played] of [
    [position, "Position character", /Check first.*Rd1\+.*gxf4/, /Qxd3/],
    [mistake, "What Nxd5 missed or allowed", /Check first.*Qxh2\+.*hxg5\+/, /Nxc7\+/, "Nxd5"],
    [counterattack, "What f4 missed or allowed", /Check first.*Qxg4\+.*Bxf1/, /fxg5/, "f4"],
]) {
    await verifyDecisionPanel({
        input: { ...fixture.input, fixtureCheckingOrder: fixture.probe },
        previousSan: played,
        assessment: process.env.CHECKING_ORDER_VERSION ?? "HEAD",
        baseline: "a29403a9",
        description: title,
        async verify(page) {
            const section = page.getByText(title, { exact: true }).locator("../..");
            await section.getByRole("button", { name: "Show evidence" }).press("Enter");
            await section.getByText(example).waitFor();
            await section.getByText(new RegExp(`Take immediately.*${capture.source}`)).waitFor();
            if (played === "f4") await section.getByText(/Tactical · Engine supported\. After f4/).waitFor();
        },
    });
}
