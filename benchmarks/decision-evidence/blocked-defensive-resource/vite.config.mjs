import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const base = "18738d623c05de9f51e6a035a9fb075720b225bd";
const tactical = "src/utils/tacticalMotifs/";
const abs = (path) => resolve(path).replaceAll(sep, "/");
const experiment = abs(tactical + "decisionBlockedResource.ts");
const pinned = new Map(
    ["causalTactics", "decisionAssessment", "tacticalMistakeEpisode"].map((file) => {
        const path = tactical + file + ".ts";
        return [abs(path), execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" })];
    }),
);
export default {
    resolve: { alias: { "@": resolve("src") } },
    plugins: [{
        name: "blocked-resource-replay",
        enforce: "pre",
        resolveId(id) { if (id === "blocked-resource") return experiment; },
        load(id) {
            if (id === experiment) return readFileSync(new URL("blockedResource.ts", import.meta.url), "utf8");
            return pinned.get(id.split("?")[0]) ?? null;
        },
    }],
    test: {
        environment: "node",
        include: [fileURLToPath(new URL("blocked.bench.ts", import.meta.url)).replaceAll(sep, "/")],
    },
};
