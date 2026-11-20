import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = "8d022f1b";
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const names = ["causalTactics", "tacticalMistakeEpisode", "decisionAssessment", "decisionCheckingDefence"];
const candidate = process.env.ALLOWED_REVISION;
if (candidate) names.push("decisionAllowedRoutes", "decisionLineRoutes", "decisionPieceIdentity");
const paths = [worker, ...names.map(name => `src/utils/tacticalMotifs/${name}.ts`)];
const pinned = new Map(paths.map(path => {
    const updated = names.slice(2).some(name => path.endsWith("/" + name + ".ts"));
    const revision = updated && candidate ? candidate : base;
    const spec = revision === "index" ? ":" + path : revision + ":" + path;
    let text = execFileSync("git", ["show", spec], { encoding: "utf8" });
    if (path === worker) {
        const exit = text.indexOf("\nself.onmessage =");
        if (exit < 0) throw new Error("Missing worker entry");
        text = text.slice(0, exit) + "\nexport { classify };";
    }
    return [resolve(path).replaceAll("\\", "/"), text];
}));

export default {
    resolve: { alias: { "@": resolve("src") } },
    plugins: [{ name: "allowed-route-mistakes", enforce: "pre", load(id) {
        return pinned.get(id.split("?")[0]) ?? null;
    }}],
    test: {
        environment: "node",
        include: [fileURLToPath(new URL("./replay.bench.ts", import.meta.url)).replaceAll("\\", "/")],
    },
};
