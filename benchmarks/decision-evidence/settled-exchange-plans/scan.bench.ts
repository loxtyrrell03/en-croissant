import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import { findSettledExchangePlan } from "@/utils/tacticalMotifs/decisionSettledExchange";

type Request = DecisionAssessmentInput & { id: string; cohort: string };

test("replays the same root and separate reply for all exchange plans", () => {
    const input = JSON.parse(
        readFileSync(process.env.SETTLED_EXCHANGE_INPUT!, "utf8"),
    ) as Request[];
    expect(input.length).toBeGreaterThan(0);
    const output = input.map((row) => {
        const first = row.candidates[0];
        const start = performance.now();
        const plans =
            first?.cp == null
                ? []
                : row.candidates.slice(0, 3).flatMap((line) => {
                      if (line.depth !== first.depth || line.cp == null || first.cp! - line.cp > 50)
                          return [];
                      const moveUci = line.pvUci[0];
                      const reply = row.replyProbes?.find((probe) => probe.moveUci === moveUci)
                          ?.lines[0];
                      if (!reply) return [];
                      const plan = findSettledExchangePlan(row.fen, line, reply);
                      return plan ? [{ moveUci, plan }] : [];
                  });
        const ms = performance.now() - start;
        const workerStart = performance.now();
        const report =
            first && (plans.length || process.env.SETTLED_EXCHANGE_FULL)
                ? classify(row, "Stockfish 19", row.history)
                : undefined;
        const workerMs = performance.now() - workerStart;
        return { id: row.id, cohort: row.cohort, plans, report, ms, workerMs };
    });
    writeFileSync(process.env.SETTLED_EXCHANGE_OUTPUT!, JSON.stringify(output), { flag: "wx" });
}, 420_000);
