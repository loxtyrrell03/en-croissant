import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = "94d4df03";
const arm = process.env.ROUTE_ARM ?? "baseline";
const revision = process.env.ROUTE_REVISION ?? base;
const worker = "src/components/panels/tactics/decisionReport.worker.ts";
const helpers = ["causalTactics", "tacticalMistakeEpisode", "decisionAssessment"];
if (arm === "release") helpers.push("decisionLineRoutes", "lineRouteEvidence");
const files = [worker, ...helpers.map(file => `src/utils/tacticalMotifs/${file}.ts`)];
const pinned = new Map(files.map((path) => {
    const version = arm === "release" && /\/(?:decisionAssessment|decisionLineRoutes|lineRouteEvidence)\.ts$/.test(path)
        ? revision
        : base;
    const spec = version === "index" ? ":" + path : version + ":" + path;
    let source = execFileSync("git", ["show", spec], { encoding: "utf8" });
    if (path === worker) {
        const end = source.indexOf("\nself.onmessage =");
        if (end < 0) throw new Error("Missing worker entry");
        source = source.slice(0, end) + "\nexport { classify };\n";
    }
    if (path.endsWith("decisionAssessment.ts") && ["leading-reply", "repeated", "named-repeated", "separated", "settled", "retained"].includes(arm)) {
        const overlay = "    result.category = category(result.tactical, result.positional);";
        if (source.split(overlay).length !== 2) throw new Error("Missing single move boundary");
        source = 'import { corroborateDecisionLineRoutes, isStructuralEffectFromTacticalCapture } from "./decisionLineRoutes";\n' + source.replace(overlay, `
    if (corroborated${["named-repeated", "separated", "settled", "retained"].includes(arm) ? "" : ' && result.tactical.support !== "supported"'}) {
        const routes = corroborateDecisionLineRoutes(input.fen, line, probe!.lines[0], input.history, "${["leading-reply", "settled", "retained"].includes(arm) ? arm : "repeated"}")
            .filter(route => result.tactical.support !== "supported" ||
                (!result.mechanisms.some(item => item.mechanism === route.mechanism && item.rootMoveInvolved) &&
                 !result.verifiedMotifs.some(item => item.id === route.mechanism)));
        if (routes.length) {
            result.mechanisms = mergeTacticalSequenceWitnesses([
                ...result.mechanisms.filter(item => !routes.some(route => route.mechanism === item.mechanism && route.mechanismPly === item.mechanismPly)),
                ...routes,
            ]);
            if (result.tactical.support !== "supported") result.tactical = {
                support: "supported",
                basis: "engine-supported",
                reasons: routes.map(route => route.description),
            };
            result.limitations.push("These mechanisms apply to the shown defence. Other replies can change the route or payoff.");
            ${["separated", "settled", "retained"].includes(arm) ? `
            const kept = [];
            const reasons = [];
            for (const [index, factor] of result.positionalFactors.entries()) {
                if (isStructuralEffectFromTacticalCapture(input.fen, line.pvUci[0], factor)) {
                    result.limitations.push(factor.description + " Its strategic importance alongside the material gain remains uncertain.");
                } else {
                    kept.push(factor);
                    reasons.push(result.positional.reasons[index]);
                }
            }
            if (kept.length < result.positionalFactors.length) {
                result.positionalFactors = kept;
                result.positional = kept.length
                    ? { ...result.positional, reasons }
                    : { support: "suggestive", basis: "insufficient", reasons: ["The capture changes the position. Its separate strategic impact is uncertain."] };
            }
            ` : ""}
        }
    }
` + overlay);
    }
    return [resolve(path).replaceAll("\\", "/"), source];
}));

export default {
    resolve: { alias: { "@": resolve("src") } },
    plugins: [{ name: "scored-route-decisions", enforce: "pre", load(id) {
        return pinned.get(id.split("?")[0]) ?? null;
    }}],
    test: {
        environment: "node",
        include: [fileURLToPath(new URL("./replay.bench.ts", import.meta.url)).replaceAll("\\", "/")],
    },
};
