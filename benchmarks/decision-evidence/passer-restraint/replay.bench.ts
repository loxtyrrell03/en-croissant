import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { comparePasserRestraint } from "./passerRestraint";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";

test.skipIf(!process.env.RESTRAINT_INPUT)(
    "compares restraint on the same four engine continuations",
    () => {
        const rows = JSON.parse(readFileSync(process.env.RESTRAINT_INPUT!, "utf8")) as Array<
            DecisionAssessmentInput & { id: string; cohort: string }
        >;
        const output = rows.map((row) => {
            const { id, cohort, fen, playedMoveUci, comparisonCandidates, replyProbes, history } =
                row;
            const [better, played] = comparisonCandidates ?? [];
            const good = replyProbes?.find((probe) => probe.moveUci === better?.pvUci[0])?.lines[0];
            const bad = replyProbes?.find((probe) => probe.moveUci === playedMoveUci)?.lines;
            if (!good || !bad?.length || !played || played.pvUci[0] !== playedMoveUci)
                return { id, cohort };
            const start = performance.now();
            const advance = comparePasserRestraint(
                fen,
                better,
                played,
                good,
                bad,
                history,
                "advance",
            );
            const lasting = comparePasserRestraint(
                fen,
                better,
                played,
                good,
                bad,
                history,
                "lasting",
            );
            const combined = comparePasserRestraint(
                fen,
                better,
                played,
                good,
                bad,
                history,
                "combined",
            );
            return { id, cohort, advance, lasting, combined, ms: performance.now() - start };
        });
        writeFileSync(process.env.RESTRAINT_OUTPUT!, JSON.stringify(output), { flag: "wx" });
    },
    80_000,
);
