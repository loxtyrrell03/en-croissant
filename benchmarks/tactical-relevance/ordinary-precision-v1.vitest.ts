import base from "../../vite.config";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const ref = process.env.ORDINARY_PRECISION_REF;
if (ref && !["index", "index-core"].includes(ref) && !/^[0-9a-f]{40}$/.test(ref)) throw new Error("Use an exact committed SHA, index or index-core");
const loaded = new Map<string, string>();
const source = (path: string) => execFileSync("git", ["show", `${ref && ["index", "index-core"].includes(ref) ? "" : ref}:${path}`], {
    encoding: "utf8", maxBuffer: 8000000,
});
const hash = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
const frozen = {
    name: "read-only-ordinary-precision-source", enforce: "pre" as const,
    load(id: string) {
        if (!ref) return;
        const normalized = id.replaceAll("\\", "/").split("?")[0];
        const marker = "/src/utils/tacticalMotifs/", at = normalized.indexOf(marker);
        if (at < 0 || !normalized.endsWith(".ts")) return;
        if (ref === "index-core" && !normalized.endsWith("/causalTactics.ts")) return;
        const path = normalized.slice(at + 1), text = source(path);
        loaded.set(path, hash(text));
        return text;
    },
    closeBundle() {
        if (!ref) return;
        if (!loaded.size) throw new Error("Pinned source loader was not used");
        for (const [path, original] of loaded)
            if (hash(source(path)) !== original) throw new Error(`Pinned source changed: ${path}`);
        const report = process.env.ORDINARY_PRECISION_LOADER_REPORT;
        if (report) writeFileSync(report, JSON.stringify({ ref, loaded: Object.fromEntries(loaded), unchanged: true }, null, 2), { flag: "wx" });
    },
};
export default { ...base, plugins: [frozen, ...(base.plugins ?? [])], test: { ...base.test,
    include: ["benchmarks/tactical-relevance/ordinary-precision-v1.test.ts", "src/utils/tests/ordinaryPrecisionContext.test.ts"] } };
