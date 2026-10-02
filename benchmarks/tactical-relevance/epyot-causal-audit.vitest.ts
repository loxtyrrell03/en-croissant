import base from "./rare-causal-cohort-v2.vitest";
import { execFileSync } from "node:child_process";
const index = {
    name: "epyot-staged-tactical-modules",
    enforce: "pre" as const,
    load(id: string) {
        if (!process.env.EPYOT_SOURCE_INDEX) return;
        if (process.env.RARE_CAUSAL_COHORT_V2_REF) throw Error("Choose one frozen source");
        const normalized = id.replaceAll("\\", "/").split("?")[0];
        const at = normalized.indexOf("/src/utils/tacticalMotifs/");
        if (at < 0 || !normalized.endsWith(".ts")) return;
        return execFileSync(
            "git",
            [
                "-c",
                "safe.directory=C:/Users/Lox/Desktop/repo/en-croissant",
                "show",
                `:${normalized.slice(at + 1)}`,
            ],
            { encoding: "utf8" },
        );
    },
};
export default {
    ...base,
    plugins: [index, ...(base.plugins ?? [])],
    test: { ...base.test, include: ["benchmarks/tactical-relevance/epyot-causal-audit.test.ts"] },
};
