import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const revision = process.env.QUIET_REPLY_VERSION ?? "HEAD";
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const files = new Map([
    [worker, revision === "index" ? "HEAD" : revision],
    ["src/utils/tacticalMotifs/causalTactics.ts", "27580772"],
    ["src/utils/tacticalMotifs/decisionAssessment.ts", revision === "index" ? "" : revision],
].map(([file, ref]) => {
    let code = execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf8" });
    if (file === worker) {
        const boundary = code.indexOf("\nself.onmessage =");
        if (boundary < 0) throw new Error("Decision worker entry missing.");
        code = code.slice(0, boundary) + "\nexport { classify };";
    }
    return [resolve(file).replaceAll("\\", "/"), code];
}));

export default {
    resolve: { alias: { "@": resolve("src") } },
    plugins: [{
        name: "quiet-reply-exact-sources",
        enforce: "pre",
        load(id) { return files.get(id.split("?")[0].replaceAll("\\", "/")) ?? null; },
    }],
    test: {
        environment: "node",
        include: [
            "src/utils/tests/quietReplyEvidence.test.ts",
            ...(process.env.QUIET_REPLY_ENGINE ? ["benchmarks/decision-evidence/quiet-reply-counterplay/live.bench.ts"] : []),
            ...(process.env.INTERFERENCE_INPUT ? ["benchmarks/decision-evidence/interference-in-line/replay.bench.ts"] : []),
        ],
    },
};
