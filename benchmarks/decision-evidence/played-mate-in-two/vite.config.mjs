import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baseline = "e1e86a58dbe7fce909f096af7d91d36b8fdf6114";
const revision = process.env.MATE_TWO_REVISION;
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const unchanged = ["causalTactics", "tacticalMistakeEpisode"].map((name) => `src/utils/tacticalMotifs/${name}.ts`);
const decisions = [
    "decisionAssessment", "decisionQuietMateInTwo", "decisionMateConsequence",
    ...(revision ? ["decisionAllowedMateInTwo", "shortMateProof"] : []),
].map((name) => `src/utils/tacticalMotifs/${name}.ts`);
const sources = new Map([worker, ...unchanged, ...decisions].map((path) => {
    const target = decisions.includes(path) && revision ? revision : baseline;
    let code = execFileSync("git", ["show", target === "index" ? `:${path}` : `${target}:${path}`], { encoding: "utf8" });
    if (path === worker) {
        const handler = code.indexOf("\nself.onmessage =");
        if (handler < 0) throw new Error("Missing worker entry");
        code = code.slice(0, handler) + "\nexport { classify };";
    }
    return [resolve(path).replaceAll("\\", "/"), code];
}));

export default {
    resolve: { alias: { "@": resolve("src") } },
    plugins: [{ name: "played-mate-in-two", enforce: "pre", load(id) {
        return sources.get(id.split("?")[0]) ?? null;
    }}],
    test: {
        environment: "node",
        include: [fileURLToPath(new URL("./replay.bench.ts", import.meta.url)).replaceAll("\\", "/")],
    },
};
