import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = "src/utils/tacticalMotifs";
const revision = process.env.CHECKING_ORDER_VERSION ?? "8bb06b6f";
const pinned = new Map(["decisionAssessment", "causalTactics"].map((name) => {
    const file = `${root}/${name}.ts`;
    const ref = name === "causalTactics" ? "a29403a9" : revision === "index" ? "" : revision;
    return [
        resolve(file).replaceAll("\\", "/"),
        execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf8" }),
    ];
}));

if (revision !== "index") {
    for (const file of [`${root}/decisionCheckingOrder.ts`, "src/components/panels/tactics/decisionSearch.ts"]) {
        pinned.set(resolve(file).replaceAll("\\", "/"),
            execFileSync("git", ["show", `${revision}:${file}`], { encoding: "utf8" }));
    }
}

if (process.env.CHECKING_ORDER_MATERIAL_ONLY) {
    const file = resolve(`${root}/decisionCheckingOrder.ts`).replaceAll("\\", "/");
    const code = pinned.get(file) ?? readFileSync(file, "utf8");
    const revised = "if ((weakBalance > -90 || bestBalance - weakBalance < 90) && !counterattack)";
    if (!code.includes(revised)) throw new Error("The retained-material comparison guard has moved.");
    pinned.set(file, code.replace(revised, "if (weakBalance > -90 || bestBalance - weakBalance < 90)"));
}

if (process.env.CHECKING_ORDER_ALLOW_CHANGED_DEFENCE) {
    const file = resolve(`${root}/decisionCheckingOrder.ts`).replaceAll("\\", "/");
    const code = pinned.get(file) ?? readFileSync(file, "utf8");
    const exact = "check.pvUci[1] !== defence.uci ||";
    if (!code.includes(exact)) throw new Error("The exact-defence comparison guard has moved.");
    pinned.set(file, code.replace(exact,
        '(request.betterDefence.kind === "move-target" && check.pvUci[1] !== defence.uci) ||'));
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
