import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const arm = process.env.IDENTITY_ARM ?? "record";
const release = process.env.IDENTITY_RELEASE;
const base = arm === "release" && release !== "index" ? release ?? "HEAD" : "6a0dd563";
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const folder = "src/utils/tacticalMotifs/";
const paths = [worker, ...["decisionAssessment", "causalTactics", "tacticalMistakeEpisode", "tacticalSequenceEvidence"].map(name => folder + name + ".ts")];
const pinned = new Map(paths.map((path) => {
    let source = execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" });
    if (arm === "release" && path.endsWith("/tacticalSequenceEvidence.ts")) {
        source += "\nexport function resetComparisons() { return []; }\n";
    }
    if (arm === "release") {
        // Before committing, read the two deliberately changed sources from
        // the verified index. Unrelated local assessment edits stay outside it.
        if (process.env.IDENTITY_RELEASE === "index" &&
            ["/decisionAssessment.ts", "/tacticalSequenceEvidence.ts"].some(name => path.endsWith(name))) {
            source = execFileSync("git", ["show", ":" + path], { encoding: "utf8" });
            if (path.endsWith("/tacticalSequenceEvidence.ts"))
                source += "\nexport function resetComparisons() { return []; }\n";
        }
    } else if (path.endsWith("/tacticalSequenceEvidence.ts")) {
        const signature = "export function sameTacticalMechanism(";
        if (!source.includes(signature)) throw new Error("Mechanism matcher missing");
        source = source.replace(signature, "function legacyMechanismMatcher(");
        if (arm !== "record")
            source = 'import { compareWitnesses, type ComparisonRoot } from "@/../benchmarks/decision-evidence/compared-motif-identity/compare";\n' + source;
        else
            source += '\ntype ComparisonRoot = { fen: string, firstPrefix?: string[], secondPrefix?: string[] };\n';
        const decision = arm === "record" ? "legacy" : `compareWitnesses(a, b, context, "${arm}") ?? legacy`;
        source += `
const observed: unknown[] = [];
export function resetComparisons() { return observed.splice(0); }
export function sameTacticalMechanism(a: TacticalSequenceWitness, b: TacticalSequenceWitness, context?: ComparisonRoot) {
    if (a.actor !== b.actor || a.mechanism !== b.mechanism) return false;
    const legacy = legacyMechanismMatcher(a, b);
    const result = ${decision};
    observed.push({ a, b, context, legacy, result });
    return result;
}
`;
    }
    if (arm !== "release" && path.endsWith("/decisionAssessment.ts")) {
        source = source.replace("sameTacticalMechanism(w, other),", "sameTacticalMechanism(w, other, { fen: input.fen }),");
        const actual = "other.rootMoveInvolved && sameTacticalMechanism(w, other)";
        if (!source.includes(actual)) throw new Error("Expected played-to-better comparison");
        source = source.replace(actual, "other.rootMoveInvolved && sameTacticalMechanism(w, other, { fen: input.fen, firstPrefix: [playedLine.pvUci[0]], secondPrefix: [comparedBest.pvUci[0]] })");
    }
    if (arm !== "release" && path.endsWith("/tacticalMistakeEpisode.ts")) {
        const actual = "sameTacticalMechanism(witness, other)";
        if (!source.includes(actual)) throw new Error("Expected opponent comparison");
        source = source.replace(actual, "sameTacticalMechanism(witness, other, { fen, firstPrefix: [played.uci], secondPrefix: [betterSteps[0].uci] })");
    }
    if (path === worker) {
        const offset = source.indexOf("\nself.onmessage =");
        if (offset === -1) throw new Error("Worker entry missing");
        source = source.slice(0, offset) + "\nexport { classify };";
    }
    return [resolve(path).replaceAll("\\", "/"), source];
}));

export default {
    resolve: { alias: { "@": resolve("src") } },
    plugins: [{ name: "compared-motif-identity", enforce: "pre", load(id) {
        return pinned.get(id.split("?")[0]) ?? null;
    }}],
    test: {
        environment: "node",
        include: [fileURLToPath(new URL(process.env.IDENTITY_PAIRS ? "./pairs.bench.ts" : "./replay.bench.ts", import.meta.url)).replaceAll("\\", "/")],
    },
};
