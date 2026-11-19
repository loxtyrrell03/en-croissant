import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import type { DecisionEngineLine } from "../tacticalMotifs/decisionEvidence";

const directory = process.env.DECISION_BREADTH_AUDIT;
const arms = ["policy", "wide"] as const;

test.skipIf(!directory)(
    "verifies human-like candidate moves with Stockfish only",
    () => {
        const path = (name: string) => join(directory!, name);
        const rootBytes = readFileSync(path("engine-breadth.json"));
        const roots = JSON.parse(rootBytes.toString("utf8")) as {
            engineSha256: string;
            rows: Array<{
                id: string;
                fen: string;
                cohort: string;
                playedMoveUci: string;
                frames: { original: { lines: DecisionEngineLine[] } };
            }>;
        };
        const raw = readFileSync(path("human-candidates.json"));
        const candidates = JSON.parse(raw.toString("utf8")) as {
            rootSha256: string;
            engineSha256: string;
            policyMaxRank?: number;
            results: Array<{
                id: string;
                policy: string[];
                policyMs: number;
                choices: Record<(typeof arms)[number], string | null>;
                verification: Record<
                    string,
                    {
                        pair: DecisionEngineLine[];
                        reply?: { lines: DecisionEngineLine[] } | null;
                    }
                >;
            }>;
        };
        const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
        expect(candidates.rootSha256).toBe(sha(rootBytes));
        expect(candidates.engineSha256).toBe(roots.engineSha256);
        expect(candidates.results.map((row) => row.id)).toEqual(roots.rows.map((row) => row.id));
        const results = roots.rows.map((row, index) => {
            const input = candidates.results[index];
            const original = row.frames.original.lines;
            const inOriginal = original.some((line) => line.pvUci[0] === row.playedMoveUci);
            expect(input.choices.policy).toBe(
                input.policy
                    .slice(0, candidates.policyMaxRank ?? 8)
                    .find((uci) => !original.some((line) => line.pvUci[0] === uci)) ?? null,
            );
            return {
                id: row.id,
                cohort: row.cohort,
                inOriginal,
                policyWithin3: input.policy.slice(0, 3).includes(row.playedMoveUci),
                policyMs: input.policyMs,
                alternatives: Object.fromEntries(
                    arms.map((arm) => {
                        const move = input.choices[arm];
                        if (!move) return [arm, null];
                        const { pair, reply } = input.verification[move];
                        expect(pair.map((line) => line.pvUci[0]).sort()).toEqual(
                            [move, original[0].pvUci[0]].sort(),
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
                        return [
                            arm,
                            {
                                move,
                                policyRank:
                                    arm === "policy" ? input.policy.indexOf(move) + 1 : null,
                                recorded: move === row.playedMoveUci,
                                searchedReply: Boolean(reply),
                                lossCp: mistake?.evaluationLossCp ?? null,
                                evidence:
                                    mistake?.tacticalEpisode ?? mistake?.mateConsequence ?? null,
                            },
                        ];
                    }),
                ),
            };
        });
        writeFileSync(
            path("human-proof-reports.json"),
            JSON.stringify({
                protocol: 1,
                rootSha256: sha(rootBytes),
                candidateSha256: sha(raw),
                results,
            }),
            { flag: "wx" },
        );
    },
    120_000,
);
