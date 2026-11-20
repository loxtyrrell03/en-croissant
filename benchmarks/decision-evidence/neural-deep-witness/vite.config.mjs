import { execFileSync } from "node:child_process";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const baseline = "e412e3be";
const root = "src/utils/tacticalMotifs/";
const paths = ["causalTactics", "decisionAssessment", "tacticalMistakeEpisode"].map((file) => root + file + ".ts");
const pinned = new Map(paths.map((path) => [
    resolve(path).replaceAll(sep, "/"),
    execFileSync("git", ["show", baseline + ":" + path], { encoding: "utf8" }),
]));

export default {
    resolve: { alias: { "@": resolve("src") } },
    plugins: [{
        name: "frozen-decision-assessor",
        enforce: "pre",
        load(id) { return pinned.get(id.split("?")[0]) ?? null; },
    }],
    test: {
        environment: "node",
        include: [fileURLToPath(new URL("incumbent.bench.ts", import.meta.url)).replaceAll(sep, "/")],
    },
};
