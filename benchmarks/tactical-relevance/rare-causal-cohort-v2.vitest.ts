import base from "../../vite.config";
import { execFileSync } from "node:child_process";
const ref = process.env.RARE_CAUSAL_COHORT_V2_REF;
if (ref && !/^[0-9a-f]{40}$/.test(ref))
    throw Error("Use an exact committed SHA for frozen production");
const frozen = {
    name: "frozen-public-cohort-tactical-modules",
    enforce: "pre" as const,
    load(id: string) {
        if (!ref) return;
        const normalized = id.replaceAll("\\", "/").split("?")[0];
        const marker = "/src/utils/tacticalMotifs/",
            at = normalized.indexOf(marker);
        if (at < 0 || !normalized.endsWith(".ts")) return;
        const path = normalized.slice(at + 1);
        return execFileSync(
            "git",
            [
                "-c",
                "safe.directory=C:/Users/Lox/Desktop/repo/en-croissant",
                "show",
                `${ref}:${path}`,
            ],
            { encoding: "utf8" },
        );
    },
};
export default {
    ...base,
    plugins: [frozen, ...(base.plugins ?? [])],
    test: {
        ...base.test,
        include: ["benchmarks/tactical-relevance/rare-causal-cohort-v2.test.ts"],
        testTimeout: 30000,
    },
};
