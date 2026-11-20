import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import { findAllowedMateInTwo } from "@/utils/tacticalMotifs/decisionAllowedMateInTwo";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";

test("compares the same played move with and without the local proof", () => {
    const rows = JSON.parse(readFileSync(process.env.MATE_TWO_INPUT!, "utf8")) as Array<
        DecisionAssessmentInput & { id: string }
    >;
    const output = rows.map(({ id, ...input }) => {
        const start = performance.now();
        const [best] = input.candidates;
        const mode = process.env.MATE_TWO_MODE;
        if (mode === "worker" || mode === "root") {
            const frames =
                mode === "root"
                    ? {
                          ...input,
                          comparisonCandidates: undefined,
                          candidates: input.candidates,
                          replyProbes: input.replyProbes?.filter(
                              (probe) => probe.moveUci === best?.pvUci[0],
                          ),
                      }
                    : input;
            const report = best ? classify(frames, "Stockfish 19", input.history) : null;
            return { id, report, ms: performance.now() - start };
        }
        if (!best || !input.playedMoveUci) return { id };
        const hint = input.replyProbes?.find((probe) => probe.moveUci === input.playedMoveUci)
            ?.lines[0]?.pvUci[0];
        const proof = (method: "nominated" | "checking" | "all", candidate?: string) =>
            findAllowedMateInTwo(
                input.fen,
                best,
                input.playedMoveUci,
                input.history,
                candidate,
                method,
            );
        const historical = proof("nominated", hint);
        const checking = proof("checking");
        const all = proof("all");
        return { id, nominated: historical, checking, all, ms: performance.now() - start };
    });
    writeFileSync(process.env.MATE_TWO_OUTPUT!, JSON.stringify(output), { flag: "wx" });
}, 420_000);
