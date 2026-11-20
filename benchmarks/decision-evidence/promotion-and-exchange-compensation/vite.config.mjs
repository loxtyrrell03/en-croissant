import { execFileSync } from "node:child_process";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const baseline = "90e63d0e5b68156c5fd61ebca5ec306077519b57";
const root = "src/utils/tacticalMotifs/";
const arm = process.env.COMPENSATION_ARM ?? "baseline";
const changed = ["decisionAssessment", "decisionPromotionPressure"];
const modules = ["causalTactics", "tacticalMistakeEpisode", ...changed];
const pinned = new Map(modules.map((file) => {
    const path = root + file + ".ts";
    const revision = arm === "candidate" && changed.includes(file)
        ? process.env.COMPENSATION_REVISION ?? ""
        : baseline;
    return [resolve(path).replaceAll(sep, "/"),
        execFileSync("git", ["show", revision + ":" + path], { encoding: "utf8" })];
}));
export default {
    resolve: { alias: { "@": resolve("src"), chessops: resolve("node_modules/chessops/dist/esm") } },
    plugins: [{
        name: "compare-compensation",
        enforce: "pre",
        load(id) { return pinned.get(id.split("?")[0]) ?? null; },
    }],
    test: {
        environment: "node",
        include: [
            fileURLToPath(new URL("screen.bench.ts", import.meta.url)).replaceAll(sep, "/"),
            ...(arm === "candidate" ? [
                "decisionPromotionTrade", "decisionPromotionPressure", "decisionPromotionMistake",
                "decisionPawnInterception", "decisionTacticalRecovery", "decisionPreparedCheckpoint",
                "decisionAssessment", "decisionDiscoveredTargets", "tacticalSequenceEvidence",
                "tacticalMistakeEpisode",
            ].map((name) => `src/utils/tests/${name}.test.ts`) : []),
        ],
    },
};
