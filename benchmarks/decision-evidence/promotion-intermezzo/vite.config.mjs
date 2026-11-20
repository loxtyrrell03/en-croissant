import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const base = "2c52c9628bddace4b527b1b427f9af7107ddb289";
const arm = process.env.DECISION_LINK_ARM ?? "candidate";
if (!["baseline", "candidate"].includes(arm)) throw new Error("Expected baseline or candidate");
const mode = process.env.DECISION_PROMOTION_MODE ?? "line";
const files = { line: "link.bench.ts", worker: "capture.bench.ts", paired: "tempo.bench.ts" };
if (!files[mode]) throw new Error("Expected line, worker or paired");

const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const tactical = "src/utils/tacticalMotifs/";
const paths = [
    worker,
    ...["causalTactics", "decisionAssessment", "tacticalMistakeEpisode"].map(name => tactical + name + ".ts"),
    ...(arm === "baseline" ? [tactical + "tacticalSequenceEvidence.ts"] : []),
];
const canonicalPath = (path) => resolve(path).replaceAll(sep, "/");
const experiment = canonicalPath(tactical + "decisionPromotionTempo.ts");
const pinned = new Map(paths.map(path => {
    let source = execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" });
    if (path === worker) {
        const handler = source.indexOf("\nself.onmessage =");
        if (handler === -1) throw new Error("Expected the decision-report worker");
        source = source.slice(0, handler) + "\nexport { classify };";
    }
    return [canonicalPath(path), source];
}));

export default {
    resolve: { alias: { "@": resolve("src") } },
    plugins: [{
        name: "promotion-intermezzo-replay",
        enforce: "pre",
        resolveId(id) { if (mode === "paired" && id === "promotion-tempo") return experiment; },
        load(id) {
            if (mode === "paired" && id === experiment)
                return readFileSync(new URL("promotionTempo.ts", import.meta.url), "utf8");
            return pinned.get(id.split("?")[0]) ?? null;
        },
    }],
    test: {
        environment: "node",
        include: [fileURLToPath(new URL(files[mode], import.meta.url)).replaceAll(sep, "/")],
    },
};
