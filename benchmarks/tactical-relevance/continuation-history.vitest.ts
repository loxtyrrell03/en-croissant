import { execFileSync } from "node:child_process";
import base from "../../vite.config";
const ref = process.env.CONTINUATION_HISTORY_REF;
if (ref && !/^[0-9a-f]{40}$/.test(ref)) throw Error("Use an exact committed SHA");
export default {
    ...base,
    plugins: [
        {
            name: "frozen-continuation-history-baseline",
            enforce: "pre" as const,
            load(id: string) {
                if (!ref) return;
                const normalized = id.replaceAll("\\", "/").split("?")[0];
                const start = normalized.indexOf("/src/utils/tacticalMotifs/");
                if (start < 0 || !normalized.endsWith(".ts")) return;
                return execFileSync("git", ["show", `${ref}:${normalized.slice(start + 1)}`], {
                    encoding: "utf8",
                });
            },
        },
        ...(base.plugins ?? []),
    ],
    test: {
        ...base.test,
        include: ["benchmarks/tactical-relevance/continuation-history-benchmark.test.ts"],
    },
};
