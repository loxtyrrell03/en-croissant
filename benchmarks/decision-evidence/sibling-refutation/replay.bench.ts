import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import {
    confirmSiblingRefutation,
    nominateSiblingRefutation,
    type SiblingRefutationFrames,
} from "@/utils/tacticalMotifs/decisionSiblingRefutation";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";

type Row = DecisionAssessmentInput & { id: string; cohort?: string; event?: string; site?: string };
test("ranked similar alternatives are checked on their exact boards", () => {
    const rows = JSON.parse(readFileSync(process.env.SIBLING_INPUT!, "utf8")) as Row[];
    const evidence = process.env.SIBLING_FRAMES
        ? (JSON.parse(readFileSync(process.env.SIBLING_FRAMES, "utf8")) as Record<
              string,
              SiblingRefutationFrames
          >)
        : {};
    const results = process.env.SIBLING_REPORTS
        ? rows.map((row) => ({
              id: row.id,
              report: row.candidates[0]
                  ? classify(
                        { ...row, siblingRefutation: evidence[row.id] },
                        "Stockfish 19",
                        row.history,
                    )
                  : null,
          }))
        : rows.flatMap((row) => {
              const scope = process.env.SIBLING_SCOPE as
                  | "similar"
                  | "causal"
                  | "ranked"
                  | undefined;
              const ticket = nominateSiblingRefutation(row.fen, row.candidates, scope);
              if (!ticket) return [];
              const result =
                  evidence[row.id] &&
                  confirmSiblingRefutation(row.fen, ticket, evidence[row.id], row.history);
              return [
                  {
                      id: row.id,
                      cohort: row.cohort,
                      event: row.event,
                      site: row.site,
                      preferred: ticket.safeStep.uci,
                      alternative: ticket.weakStep.uci,
                      replyUci: ticket.replyUci,
                      replyFen: ticket.replyFen,
                      controlFen: ticket.controlFen,
                      reason: ticket.reason,
                      result,
                      relation: ticket.relation,
                  },
              ];
          });
    expect(rows.length).toBeGreaterThan(0);
    writeFileSync(process.env.SIBLING_OUTPUT!, JSON.stringify(results, null, 2), { flag: "wx" });
}, 480_000);
