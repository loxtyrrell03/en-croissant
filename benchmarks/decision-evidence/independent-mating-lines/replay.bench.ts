import { readFileSync, writeFileSync } from "node:fs";
import { test, expect } from "vitest";
import {
    assessChessDecision,
    type DecisionAssessmentInput,
    type ChessDecisionReport,
} from "@/utils/tacticalMotifs/decisionAssessment";
import { nominatePositionRefutation } from "@/utils/tacticalMotifs/decisionPositionContrast";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";

import { compareOpponentTactics, compareRookFileContests } from "opponent-evidence-candidate";

type Probe = NonNullable<DecisionAssessmentInput["replyProbes"]>[number];
type CostedProbe = Probe & {
    cost: { nodes: number; requestedNodes: number; milliseconds: number };
};
type Case = DecisionAssessmentInput & {
    id: string;
    event: string;
    cohort: string;
    label: { tactical: boolean | null; positional: boolean | null; rationale: string };
    referenceReplies: CostedProbe[];
};

function describe(report: ChessDecisionReport) {
    const { position } = report;
    return {
        category: position.category,
        tactical: position.tactical,
        positional: position.positional,
        mechanisms: position.mechanisms,
        strategicPlan: position.strategicPlan,
        tacticalContrast: position.tacticalContrast,
        preparedCheckpointRequest: position.preparedCheckpointRequest,
        proposedMoves: report.moves.map(({ moveUci, tactical, positional }) => ({
            moveUci,
            tactical,
            positional,
        })),
    };
}

test("measures what independent replies change at fixed root depth", () => {
    const input = process.env.REPLY_COVERAGE_INPUT;
    const output = process.env.REPLY_COVERAGE_OUTPUT;
    if (!input || !output) throw new Error("Set REPLY_COVERAGE_INPUT and REPLY_COVERAGE_OUTPUT");
    const rows = JSON.parse(readFileSync(input, "utf8")) as Case[];
    const results = rows.map(
        ({ id, event, cohort, label, fen, candidates, replyProbes, referenceReplies }) => {
            const best = candidates[0];
            const motifs = buildLiveTacticalScan({
                fen,
                pvUci: best.pvUci,
                depth: best.depth,
                engineName: "Stockfish 19",
                variations: candidates,
            }).variations;
            const input = {
                fen,
                candidates,
                replyProbes,
                rootCertificates: motifs.map((variation) => ({
                    fen,
                    moveUci: variation.lineUci[0],
                    motifs: variation.motifs,
                })),
            };
            const available = referenceReplies.filter((item) => item.moveUci !== best.pvUci[0]);
            const request = nominatePositionRefutation(fen, candidates);
            const selected = available.find((item) => item.moveUci === request?.moveUci);
            const arms = {
                leadingOnly: input,
                currentRefutation: { ...input, positionReply: selected },
                runnerUp: {
                    ...input,
                    replyProbes: [...(replyProbes ?? []), ...available.slice(0, 1)],
                },
                allAlternatives: { ...input, replyProbes: referenceReplies },
            };
            const reports = Object.fromEntries(
                Object.entries(arms).map(([name, config]) => {
                    const report = assessChessDecision(config);
                    expect(report, name + " " + id).toBeTruthy();
                    return [name, describe(report!)];
                }),
            );
            const baseline = reports.leadingOnly;
            const start = performance.now();
            const opponentEvidence =
                baseline.tactical.support !== "supported"
                    ? compareOpponentTactics(fen, candidates, replyProbes?.[0]?.lines ?? [])
                    : null;

            const fileContest =
                baseline.positional.support !== "supported"
                    ? compareRookFileContests(fen, candidates, replyProbes?.[0]?.lines ?? [])
                    : null;
            return {
                id,
                event,
                cohort,
                label,
                reports,
                opponentEvidence,
                fileContest,
                classifierMs: performance.now() - start,
                trials: {
                    leader: referenceReplies[0]?.cost,
                    refutation: selected?.cost,
                    runnerUp: available[0]?.cost,
                    allAlternatives: available.map((item) => item.cost),
                },
            };
        },
    );
    writeFileSync(output, JSON.stringify(results), { flag: "wx" });
}, 180_000);
