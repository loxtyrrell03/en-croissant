import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = "fb53374e";
const arm = process.env.OUTPOST_ARM ?? "baseline";
if (!["baseline", "candidate"].includes(arm)) throw new Error("Expected baseline or candidate");
const active = arm === "candidate";
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const assessment = "src/utils/tacticalMotifs/decisionAssessment.ts";
const module = "src/utils/tacticalMotifs/decisionExchangeOutpost.ts";
const modulePath = resolve(module).replaceAll("\\", "/");
const pinned = [
    worker,
    assessment,
    "src/utils/tacticalMotifs/causalTactics.ts",
    "src/utils/tacticalMotifs/tacticalMistakeEpisode.ts",
];
const overlay = JSON.parse(readFileSync(new URL("assessment-overlay.json", import.meta.url), "utf8"));
function applyOverlay(source) {
    const lines = source.split("\n");
    for (const { offset, before, after } of overlay.toReversed()) {
        if (lines.slice(offset, offset + before.length).join("\n") !== before.join("\n"))
            throw new Error("The experiment no longer matches its frozen baseline");
        lines.splice(offset, before.length, ...after);
    }
    return lines.join("\n");
}
const resolved = new Map(pinned.map(path => {
    let source = path === assessment && active
        ? applyOverlay(execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" }))
        : execFileSync("git", ["show", base + ":" + path], { encoding:"utf8" });
    if (path === worker) {
        const cut=source.indexOf("\nself.onmessage =");
        if (cut === -1) throw new Error("Expected a worker message handler");
        source=source.slice(0,cut)+"\nexport { classify };";
    }
    return [resolve(path).replaceAll("\\", "/"),source];
}));
if (active)
    resolved.set(modulePath,readFileSync(new URL("decisionExchangeOutpost.ts",import.meta.url),"utf8"));

export default {
    resolve: { alias: { "@": resolve("src") } },
    plugins: [{
        name:"exchange-outpost-replay",
        enforce:"pre",
        resolveId(id) {
            if (active && (id.endsWith("/decisionExchangeOutpost") || id === modulePath)) return modulePath;
        },
        load(id) { return resolved.get(id.split("?")[0]) ?? null; },
    }],
    test: {
        environment:"node",
        include:[fileURLToPath(new URL("worker.bench.ts",import.meta.url)).replaceAll("\\", "/")],
    },
};
