import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import type { DecisionEngineLine } from "../tacticalMotifs/decisionEvidence";
import { confirmExtraPositionChoice } from "../tacticalMotifs/decisionPositionContrast";

type Frame = {
    lines: DecisionEngineLine[];
    attempt: { requestedNodes: number; milliseconds: number };
};
type Case = {
    id: string;
    choices: Record<string, string | null>;
    observed?: Record<string, Frame>;
    verification: Record<string, { pair: DecisionEngineLine[]; reply: Frame | null }>;
};

const directory = process.env.DECISION_BREADTH_AUDIT;
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test.skipIf(!directory)(
    "checks the refutations found by short move nomination",
    () => {
        const raw = (name: string) => readFileSync(join(directory!, name));
        const roots = raw("engine-breadth.json");
        const old = raw("human-candidates.json");
        const quick = JSON.parse(raw("quick-nominations.json").toString("utf8")) as {
            rootSha256: string;
            oldCandidateSha256: string;
            profiles: Record<string, [number, number]>;
            results: Case[];
        };
        expect(quick.rootSha256).toBe(sha(roots));
        expect(quick.oldCandidateSha256).toBe(sha(old));
        const rootCases = JSON.parse(roots.toString("utf8")).rows as Array<{
            fen: string;
            id: string;
            cohort: string;
            playedMoveUci: string;
            frames: { original: Frame; equalWide: Frame };
        }>;
        const oldCases = JSON.parse(old.toString("utf8")).results as Case[];
        expect(rootCases.map(({ id }) => id)).toEqual(quick.results.map(({ id }) => id));
        expect(rootCases.map(({ id }) => id)).toEqual(oldCases.map(({ id }) => id));
        const results = rootCases.map((row, index) => {
            const original = row.frames.original.lines;
            const outcome = (move: string | null, queried: Case, frame?: Frame) => {
                if (!move || !frame) return null;
                const { pair, reply } = queried.verification[move];
                const [good, bad] = pair;
                const best = original[0];
                const rank = frame.lines.findIndex((line) => line.pvUci[0] === move);
                expect(rank).toBeGreaterThanOrEqual(0);
                expect(new Set(pair.map((line) => line.pvUci[0]))).toEqual(
                    new Set([move, best.pvUci[0]]),
                );
                const assessment = reply
                    ? assessChessDecision({
                          fen: row.fen,
                          candidates: original,
                          playedMoveUci: move,
                          comparisonCandidates: pair,
                          replyProbes: [{ moveUci: move, lines: reply.lines }],
                      })
                    : null;
                const mistake = assessment?.mistake;
                const fastBest = frame.lines[0];
                const proposed = frame.lines[rank];
                return {
                    move,
                    rank: rank + 1,
                    recorded: move === row.playedMoveUci,
                    reply: Boolean(reply),
                    fastGap:
                        fastBest.cp !== null && proposed.cp !== null
                            ? fastBest.cp - proposed.cp
                            : null,
                    stableControl:
                        good.cp !== null && best.cp !== null && Math.abs(good.cp - best.cp) <= 90,
                    sameEntry: bad.pvUci[1] === reply?.lines[0]?.pvUci[0],
                    lossCp: mistake?.evaluationLossCp ?? null,
                    evidence: mistake?.tacticalEpisode ?? mistake?.mateConsequence ?? null,
                    earlyEvidence: reply
                        ? confirmExtraPositionChoice(row.fen, original, {
                              shortlist: frame.lines,
                              pair,
                              replies: reply.lines,
                          })
                        : null,
                };
            };
            const current = quick.results[index];
            const arms = {
                wide: outcome(oldCases[index].choices.wide, oldCases[index], row.frames.equalWide),
                ...Object.fromEntries(
                    Object.keys(quick.profiles).map((name) => {
                        const frame = current.observed?.[name];
                        const chosen = current.choices[name] ?? null;
                        expect(chosen).toBe(
                            frame?.lines.find(
                                (candidate) =>
                                    !original.some((line) => line.pvUci[0] === candidate.pvUci[0]),
                            )?.pvUci[0] ?? null,
                        );
                        return [name, outcome(chosen, current, frame)];
                    }),
                ),
            };
            return {
                id: row.id,
                cohort: row.cohort,
                arms,
            };
        });
        writeFileSync(
            join(directory!, "quick-nomination-proofs.json"),
            JSON.stringify({ protocol: 1, rootSha256: sha(roots), results }),
            { flag: "wx" },
        );
    },
    120_000,
);
