import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import {
    assessChessDecision,
    type DecisionAssessmentInput,
} from "@/utils/tacticalMotifs/decisionAssessment";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";
import { assessReplyConsequences } from "reply-consequences-candidate";

type Case = DecisionAssessmentInput & {
    id: string;
    label?: Record<string, boolean | string | null>;
};

test("compares both effects against the clean incumbent on identical boards", () => {
    const input = process.env.DECISION_CONSEQUENCE_INPUT;
    const output = process.env.DECISION_CONSEQUENCE_OUTPUT;
    if (!input || !output) throw new Error("Set input and output");
    const rows = JSON.parse(readFileSync(input, "utf8")) as Case[];
    const reports = rows.map(({ id, label, fen, candidates, replyProbes }) => {
        const lead = candidates[0];
        const live = buildLiveTacticalScan({
            fen,
            pvUci: lead.pvUci,
            depth: lead.depth,
            engineName: "Stockfish 19",
            variations: candidates,
        });
        const position = assessChessDecision({
            fen,
            candidates,
            replyProbes,
            rootCertificates: live.variations.map((variation) => ({
                fen,
                moveUci: variation.lineUci[0],
                motifs: variation.motifs,
            })),
        })?.position;
        if (!position) return { id, label, invalid: true };
        const tactical = position.tactical.support === "supported";
        const positional = position.positional.support === "supported";
        const probe = replyProbes?.find((item) => item.moveUci === lead.pvUci[0]);
        const start = performance.now();
        const consequence =
            probe && (!tactical || !positional)
                ? assessReplyConsequences(fen, lead, probe.lines, !tactical, !positional)
                : null;
        return {
            id,
            label,
            tactical,
            positional,
            consequence,
            milliseconds: performance.now() - start,
        };
    });
    writeFileSync(output, JSON.stringify(reports), { flag: "wx" });
}, 180_000);
