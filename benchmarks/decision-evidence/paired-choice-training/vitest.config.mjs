import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const baseline = "e6fbc1e8";
const root = "src/utils/tacticalMotifs";
const sources = ["causalTactics", "decisionAssessment", "tacticalMistakeEpisode"];
const pinned = new Map(sources.map((name) => {
    const file = `${root}/${name}.ts`;
    return [
        resolve(file).replaceAll("\\", "/"),
        execFileSync("git", ["show", `${baseline}:${file}`], { encoding: "utf8" }),
    ];
}));

export default {
    resolve: { alias: { "@": resolve("src") } },
    plugins: [{
        name: "paired-choice-baseline",
        enforce: "pre",
        load(id) {
            return pinned.get(id.split("?")[0].replaceAll("\\", "/")) ?? null;
        },
    }],
    test: {
        environment: "node",
        include: ["benchmarks/decision-evidence/paired-choice-training/app-readback.bench.ts"],
    },
};
