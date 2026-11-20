import { execFileSync } from "node:child_process";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const baseline = "7c3b50eb58e2f6597e57242600460bc16f48a1df";
const arm = process.env.DISCOVERY_ARM ?? "baseline";
if (!["baseline", "candidate"].includes(arm)) throw new Error("Unknown discovery trial arm");
const root = "src/utils/tacticalMotifs/";
const modules = ["causalTactics", "decisionAssessment", "tacticalSequenceEvidence", "tacticalMistakeEpisode"];
const pinned = new Map(modules.map((file) => {
    const path = root + file + ".ts";
    const revision = arm === "candidate" && file !== "causalTactics"
        ? process.env.DISCOVERY_REVISION ?? ""
        : baseline;
    return [resolve(path).replaceAll(sep, "/"),
        execFileSync("git", ["show", revision + ":" + path], { encoding: "utf8" })];
}));

export default {
    resolve: { alias: { "@": resolve("src") } },
    plugins: [{
        name: "discovery-replay",
        enforce: "pre",
        load(id) { return pinned.get(id.split("?")[0]) ?? null; },
    }],
    test: {
        environment: "node",
        include: [
            fileURLToPath(new URL("replay.bench.ts", import.meta.url)).replaceAll(sep, "/"),
            ...(arm === "candidate" ? [
                "decisionDiscoveredTargets", "tacticalSequenceEvidence", "tacticalMistakeEpisode",
                "decisionAssessment", "decisionForcingConsequence", "decisionTacticalRecovery",
                "decisionPromotionMistake", "decisionOpenedCheckingAttack", "decisionPawnInterception",
                "decisionPromotionPressure", "decisionSharedReply", "decisionQuietMateThreat",
            ].map((name) => "src/utils/tests/" + name + ".test.ts") : []),
        ],
    },
};
