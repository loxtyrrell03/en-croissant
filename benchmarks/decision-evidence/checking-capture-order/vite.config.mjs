import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = "src/utils/tacticalMotifs";
const revision = process.env.CHECKING_ORDER_VERSION ?? "HEAD";
const pinned = new Map(["decisionAssessment", "causalTactics"].map((name) => {
    const file = `${root}/${name}.ts`;
    const ref = name === "causalTactics" ? "a29403a9" : revision === "index" ? "" : revision;
    return [
        resolve(file).replaceAll("\\", "/"),
        execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf8" }),
    ];
}));

if (process.env.CHECKING_ORDER_MATERIAL_ONLY) {
    const file = resolve(`${root}/decisionCheckingOrder.ts`).replaceAll("\\", "/");
    const code = readFileSync(file, "utf8");
    const revised = "if ((weakBalance > -90 || bestBalance - weakBalance < 90) && !counterattack)";
    if (!code.includes(revised)) throw new Error("The retained-material comparison guard has moved.");
    pinned.set(file, code.replace(revised, "if (weakBalance > -90 || bestBalance - weakBalance < 90)"));
}

export default {
    resolve: { alias: { "@": resolve("src") } },
    plugins: [{
        name: "checking-order-frozen-sources",
        enforce: "pre",
        load(id) { return pinned.get(id.split("?")[0].replaceAll("\\", "/")) ?? null; },
    }],
    test: {
        environment: "node",
        include: [`benchmarks/decision-evidence/checking-capture-order/${process.env.CHECKING_ORDER_INPUT ? "scan" : "live"}.bench.ts`],
    },
};
