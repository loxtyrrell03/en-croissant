import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect, test } from "vitest";
import { extractTacticalSequenceWitnesses } from "../tacticalMotifs/tacticalSequenceEvidence";
import { measureDecisionLine } from "../tacticalMotifs/decisionEvidence";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { classifyMistakeReviewNature } from "../mistakeReview";
import { extractStrategicRootEffects } from "../tacticalMotifs/strategicRootEffects";
import { extractPositionalTransitions } from "../tacticalMotifs/positionalTransitions";

const directory = process.env.DECISION_EVIDENCE_AUDIT;
test.skipIf(!directory)(
    "audit sequence nominations on the sealed development partition",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const cohort = process.env.DECISION_AUDIT_COHORT ?? "course";
        if (!["course", "independent", "classical"].includes(cohort))
            throw new Error("Invalid cohort");
        const protocol = process.env.DECISION_ENGINE_PROTOCOL ?? "2";
        if (!["1", "2"].includes(protocol)) throw new Error("Invalid engine protocol");
        const profile = process.env.DECISION_ENGINE_PROFILE ?? "v2";
        if (!/^[a-z0-9-]+$/.test(profile)) throw new Error("Invalid engine profile");
        const probeProfile = process.env.DECISION_PROBE_PROFILE ?? profile;
        if (!/^[a-z0-9-]+$/.test(probeProfile)) throw new Error("Invalid probe profile");
        const sample = JSON.parse(readFileSync(join(directory!, `${cohort}-sample.json`), "utf8"));
        const name = process.env.DECISION_AUDIT_NAME ?? "decision-candidate-v3";
        if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Invalid audit name");
        const output = privateReportPath(join(directory!, `${name}.json`));
        expect(existsSync(output)).toBe(false);
        const rows = sample.cases.filter((r: { split: string }) => r.split === "development");
        const results = rows.map((row: { id: string; fen: string; category: string }) => {
            const engine = JSON.parse(
                readFileSync(
                    join(
                        directory!,
                        protocol === "2"
                            ? `${cohort}-engine-${profile}`
                            : cohort === "course"
                              ? "engine-reproducible"
                              : `${cohort}-engine`,
                        `${row.id}.json`,
                    ),
                    "utf8",
                ),
            );
            const probes = JSON.parse(
                readFileSync(
                    join(
                        directory!,
                        protocol === "2"
                            ? `${cohort}-probes-${probeProfile}`
                            : cohort === "course"
                              ? "reply-probes"
                              : `${cohort}-probes`,
                        `${row.id}.json`,
                    ),
                    "utf8",
                ),
            );
            const started = performance.now();
            const baseline = buildLiveTacticalScan({
                fen: row.fen,
                pvUci: engine.deep[0].pvUci,
                depth: engine.deep[0].depth,
                engineName: "Stockfish 19",
                variations: engine.deep,
            });
            const compared = engine.comparison ?? engine.deep;
            const played = compared.find(
                (line: { pvUci: string[] }) => line.pvUci[0] === engine.played,
            );
            const reply =
                probes.replyProbes.find(
                    (probe: { moveUci: string }) => probe.moveUci === engine.played,
                )?.lines ?? engine.reply;
            const sign = row.fen.split(" ")[1] === "b" ? -1 : 1;
            const baselineMistake = classifyMistakeReviewNature({
                fen: row.fen,
                bestMoveUci: compared[0].pvUci[0],
                playedMoveUci: engine.played,
                pvUci: compared[0].pvUci,
                refutationUci: reply[0]?.pvUci,
                bestCandidates: compared,
                refutationCandidates: reply,
                cpBefore: compared[0].cp === null ? null : sign * compared[0].cp,
                cpAfter: played?.cp == null ? null : sign * played.cp,
                cpLoss:
                    compared[0].cp !== null && played?.cp != null
                        ? Math.max(0, compared[0].cp - played.cp)
                        : null,
                reachedDepth: Math.min(compared[0].depth, reply[0]?.depth ?? 0),
            });
            const baselineMs = performance.now() - started;
            const witnesses = extractTacticalSequenceWitnesses(row.fen, engine.deep[0]);
            const assessment = assessChessDecision({
                fen: row.fen,
                candidates: engine.deep,
                replyProbes: probes.replyProbes,
                playedMoveUci: engine.played,
                comparisonCandidates: engine.comparison,
                mistakeCertificate: {
                    fen: row.fen,
                    bestMoveUci: compared[0].pvUci[0],
                    playedMoveUci: engine.played,
                    tactical: baselineMistake.nature === "tactical",
                    reasons: [baselineMistake.reason],
                },
                rootCertificates: baseline.variations.map((variation) => ({
                    fen: row.fen,
                    moveUci: variation.lineUci[0],
                    motifs: variation.motifs,
                })),
            });
            return {
                id: row.id,
                category: row.category,
                engineIdentity: engine.identity,
                probeIdentity: probes.identity,
                witnesses,
                strategicEffects: extractStrategicRootEffects(row.fen, engine.deep[0]),
                structuralTransitions: extractPositionalTransitions(row.fen, engine.deep[0]),
                assessment,
                baseline,
                baselineMistake,
                baselineMs,
                measurements: measureDecisionLine(row.fen, engine.deep[0]),
                milliseconds: performance.now() - started - baselineMs,
            };
        });
        const sourceHashes = Object.fromEntries(
            [
                "decisionAssessment.ts",
                "decisionProofAdapter.ts",
                "conditionalTacticalResources.ts",
                "tacticalSequenceEvidence.ts",
                "positionalTransitions.ts",
                "strategicRootEffects.ts",
                "decisionEvidence.ts",
                "positionalEvidence.ts",
                "liveTactics.ts",
                "mistakeNature.ts",
                "causalTactics.ts",
            ].map((name) => [
                name,
                createHash("sha256")
                    .update(readFileSync(join("src/utils/tacticalMotifs", name)))
                    .digest("hex"),
            ]),
        );
        writeFileSync(
            output,
            JSON.stringify(
                {
                    scope: "Development candidate, not held-out accuracy",
                    engineProtocol: protocol,
                    engineProfile: profile,
                    probeProfile,
                    cohort,
                    sourceHashes,
                    results,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
    120000,
);
