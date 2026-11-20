import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = "ae566ad5";
const checked = process.env.DEFENCE_REVISION ?? base;
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const folder = "src/utils/tacticalMotifs/";
const modules = ["decisionAssessment", "causalTactics", "tacticalMistakeEpisode"];
if (checked !== base) modules.push("decisionCheckingDefence");
const paths = [worker, ...modules.map(name => folder + name + ".ts")];
const sources = new Map(paths.map((path) => {
    const version = /\/decision(?:Assessment|CheckingDefence)\.ts$/.test(path) ? checked : base;
    const spec = version === "index" ? ":" + path : version + ":" + path;
    let source = execFileSync("git", ["show", spec], { encoding: "utf8" });
    if (path === worker) {
        const end = source.indexOf("\nself.onmessage =");
        if (end < 0) throw new Error("Cannot locate decision worker entry");
        source = source.slice(0, end) + "\nexport { classify };";
    }
    return [resolve(path).replaceAll("\\", "/"), source];
}));

export default {
    resolve: { alias: { "@": resolve("src") } },
    plugins: [{ name: "defence-after-attack-replay", enforce: "pre", load(id) {
        return sources.get(id.split("?")[0]) ?? null;
    }}],
    test: {
        environment: "node",
        include: [fileURLToPath(new URL(process.env.DEFENCE_ENGINE ? "./engine.bench.ts" : "./replay.bench.ts", import.meta.url)).replaceAll("\\", "/")],
    },
};
