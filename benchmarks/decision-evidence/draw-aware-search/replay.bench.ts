import { readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import type { DecisionAssessmentInput } from "@/utils/tacticalMotifs/decisionAssessment";
import { replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";
import { measureDecisionLine } from "@/utils/tacticalMotifs/decisionEvidence";
import { validateDecisionSearchFrame } from "@/utils/tacticalMotifs/decisionSearchFrame";
import { validateOriginalFrame } from "./originalFrame";

type FrameValidation = typeof validateDecisionSearchFrame;
function collect(input: DecisionAssessmentInput, validate: FrameValidation) {
    const { fen, history } = input;
    const started = performance.now();
    const candidates = validate(fen, input.candidates, history);
    const comparisonCandidates = input.comparisonCandidates
        ? validate(fen, input.comparisonCandidates, history)
        : undefined;
    const probes = (input.replyProbes ?? []).map((probe) => {
        const [root] = replayTacticalLine(fen, [probe.moveUci]);
        const replyFen = root && makeFen(root.after.toSetup());
        const reachedHistory = history && { ...history, moves: [...history.moves, probe.moveUci] };
        return replyFen ? validate(replyFen, probe.lines, reachedHistory) : null;
    });
    const validationMs = performance.now() - started;
    return { candidates, comparisonCandidates, probes, validationMs };
}

test("replays the actual search-frame guard before invoking the decision worker", () => {
    const corpus = JSON.parse(
        readFileSync(process.env.DRAW_FRAME_INPUT!, "utf8"),
    ) as (DecisionAssessmentInput & { id: string })[];
    expect(corpus.length).toBe(new Set(corpus.map(({ id }) => id)).size);
    const cases = corpus.map(({ id, ...input }) => {
        const original = collect(input, validateOriginalFrame);
        const revised = collect(input, validateDecisionSearchFrame);
        const board = (data: typeof revised) => ({
            candidates: data.candidates,
            comparisonCandidates: data.comparisonCandidates,
            probes: data.probes,
        });
        const same = JSON.stringify(board(original)) === JSON.stringify(board(revised));
        const describe = (data: typeof revised) => {
            const frames = [data.candidates, data.comparisonCandidates, ...data.probes];
            return {
                validationMs: data.validationMs,
                accepted: frames.map(Boolean),
                shortened: frames.flatMap(
                    (frame, scope) =>
                        frame?.flatMap((line, rank) => {
                            const actual =
                                scope === 0
                                    ? input.candidates
                                    : scope === 1
                                      ? input.comparisonCandidates
                                      : input.replyProbes?.[scope - 2].lines;
                            if (
                                actual?.[rank].pvUci.length === line.pvUci.length &&
                                !line.claimHistory
                            )
                                return [];
                            expect(measureDecisionLine(line.fen, line)?.drawnEnding).toBe(true);
                            return [
                                {
                                    scope,
                                    rank,
                                    plies: line.pvUci.length,
                                    claim: !!line.claimHistory,
                                },
                            ];
                        }) ?? [],
                ),
            };
        };
        const report = (data: typeof revised) =>
            data.candidates
                ? classify(
                      {
                          ...input,
                          candidates: data.candidates,
                          comparisonCandidates:
                              data.comparisonCandidates ??
                              (input.comparisonCandidates ? [] : undefined),
                          replyProbes: (input.replyProbes ?? []).flatMap((probe, index) =>
                              data.probes[index] ? [{ ...probe, lines: data.probes[index]! }] : [],
                          ),
                      },
                      "Stockfish 19",
                      input.history,
                  )
                : null;
        return {
            id,
            same,
            original: describe(original),
            revised: describe(revised),
            ...(same ? {} : { beforeReport: report(original), afterReport: report(revised) }),
        };
    });
    writeFileSync(process.env.DRAW_FRAME_OUTPUT!, JSON.stringify(cases), { flag: "wx" });
}, 360_000);
