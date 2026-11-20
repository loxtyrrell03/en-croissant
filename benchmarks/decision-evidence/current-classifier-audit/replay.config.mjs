import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const revision = process.env.DECISION_AUDIT_REVISION ?? "27580772";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const changed = git("diff", "--name-only", "-z", revision, "--", "src")
    .split("\0").filter(Boolean);
const sources = new Map([...new Set([worker, ...changed])].map((file) => {
    let code = git("show", `${revision}:${file}`);
    if (file === worker) {
        const boundary = code.indexOf("\nself.onmessage =");
        if (boundary < 0) throw new Error("Decision report worker entry changed.");
        code = code.slice(0, boundary) + "\nexport { classify };";
    }
    return [resolve(file).replaceAll("\\", "/"), code];
}));

export default {
    resolve: { alias: { "@": resolve("src") } },
    plugins: [{
        name: "committed-decision-worker-audit",
        enforce: "pre",
        load(id) { return sources.get(id.split("?")[0].replaceAll("\\", "/")) ?? null; },
    }],
    test: {
        environment: "node",
        include: [fileURLToPath(new URL("../interference-in-line/replay.bench.ts", import.meta.url)).replaceAll("\\", "/")],
    },
};
