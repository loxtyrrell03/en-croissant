import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";
import { findScoredLineRoutes } from "@/utils/tacticalMotifs/lineRouteEvidence";
import { corroborateDecisionLineRoutes } from "@/utils/tacticalMotifs/decisionLineRoutes";

test("compares live and decision proofs on the identical legal frames", () => {
    const inputs = JSON.parse(readFileSync(process.env.INTERFERENCE_INPUT!, "utf8")) as Array<
        DecisionAssessmentInput & { id: string }
    >;
    expect(inputs.length).toBe(new Set(inputs.map((item) => item.id)).size);
    const result = inputs.map(({ id, ...input }) => {
        const started = performance.now();
        const root = input.candidates[0];
        const report = root ? classify(input, "Stockfish 19", input.history) : null;
        const ms = performance.now() - started;
        if (!root || process.env.INTERFERENCE_MODE === "archive") return { id, report, ms };
        const scan = buildLiveTacticalScan({
            fen: input.fen,
            pvUci: root.pvUci,
            depth: root.depth,
            engineName: "Stockfish 19",
            tacticalHistory: input.history,
            variations: [{ ...root, multipv: 1 }],
        });
        const live = scan.variations[0]?.motifs ?? [];
        const routes = findScoredLineRoutes(
            input.fen,
            root.pvUci,
            root.cp,
            root.mate,
            root.depth,
            input.history,
        );
        const reply = input.replyProbes?.find((one) => one.moveUci === root.pvUci[0])?.lines[0];
        const corroborated = reply
            ? corroborateDecisionLineRoutes(input.fen, root, reply, input.history)
            : [];
        return { id, report, ms, live, routes, corroborated };
    });
    writeFileSync(process.env.INTERFERENCE_OUTPUT!, JSON.stringify(result), { flag: "wx" });
}, 420_000);
