import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect, test } from "vitest";
import { extractTacticalSequenceWitnesses } from "../tacticalMotifs/tacticalSequenceEvidence";
import { measureDecisionLine, type DecisionEngineLine } from "../tacticalMotifs/decisionEvidence";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { classifyMistakeReviewNature } from "../mistakeReview";
import { extractStrategicRootEffects } from "../tacticalMotifs/strategicRootEffects";
import { extractPositionalTransitions } from "../tacticalMotifs/positionalTransitions";
import {
    compareExtraPositionMove,
    nominatePositionRefutation,
    pickExtraPositionMove,
} from "../tacticalMotifs/decisionPositionContrast";
import {
    nominateSharedReply,
    type DecisionSharedReplyProbe,
} from "../tacticalMotifs/decisionSharedReply";

const directory = process.env.DECISION_EVIDENCE_AUDIT;
const rankReplies = process.env.DECISION_AUDIT_RANK_REPLIES === "1";
const sharedReplies = process.env.DECISION_AUDIT_SHARED_REPLIES === "1";
const positionChoices = process.env.DECISION_AUDIT_POSITION_CHOICES === "1";
const extraChoices = process.env.DECISION_AUDIT_EXTRA_CHOICE === "1";

type ExtraChoiceCase = {
    id: string;
    cachedRootSha256: string;
    observed: { six90k?: { lines: DecisionEngineLine[]; attempt: { milliseconds: number } } };
    choices: { six90k?: string | null };
    verification: Record<
        string,
        {
            pair: DecisionEngineLine[];
            attempt: { milliseconds: number };
            reply?: { lines: DecisionEngineLine[]; attempt: { milliseconds: number } };
        }
    >;
};

type ReplyQuery = {
    moveUci: string;
    nodes: number;
    milliseconds: number;
    line: DecisionEngineLine;
};

function auditRankedReplies(
    path: string,
    engine: {
        identity: { engine_sha256: string };
        reply: DecisionEngineLine[];
        comparison: DecisionEngineLine[];
    },
    rootSha256: string,
    input: Parameters<typeof assessChessDecision>[0],
) {
    const {
        identity,
        replies,
    }: {
        identity: { protocol: number; rootSha256: string; engineSha256: string; nodes: number };
        replies: ReplyQuery[];
    } = JSON.parse(readFileSync(path, "utf8"));
    if (
        identity.protocol !== 1 ||
        identity.rootSha256 !== rootSha256 ||
        identity.engineSha256 !== engine.identity.engine_sha256 ||
        identity.nodes !== 1_000_000 ||
        (replies.length !== 0 && replies.length !== engine.reply.length) ||
        replies.some(
            (query, index) =>
                query.moveUci !== engine.reply[index].pvUci[0] ||
                query.line.pvUci[0] !== query.moveUci,
        )
    )
        throw new Error("Targeted queries must match their exact inexpensive shortlist and budget");
    const withoutProof = { ...input, replyProbes: [], mistakeCertificate: undefined };
    const baseline = assessChessDecision(withoutProof)?.mistake;
    const baselineTactical = baseline?.tactical.support === "supported";
    const played = engine.comparison.find((line) => line.pvUci[0] === input.playedMoveUci);
    if (!played) throw new Error("Targeted replies require an independently scored played move");
    return {
        baselineTactical,
        queries: replies.map(({ line, ...query }) => {
            const mistake = assessChessDecision({
                ...withoutProof,
                replyProbes: [{ moveUci: input.playedMoveUci!, lines: [line] }],
            })?.mistake;
            const combined = [input.playedMoveUci!, ...line.pvUci];
            let lastSettledBalance: number | undefined;
            for (let end = 5; end <= Math.min(13, combined.length); end++) {
                const prefix = measureDecisionLine(input.fen, {
                    ...played,
                    pvUci: combined.slice(0, end),
                });
                if (
                    prefix &&
                    !prefix.drawnEnding &&
                    prefix.quietEndingPlies >= 2 &&
                    prefix.endingMaterialRangeCp[0] === prefix.endingMaterialRangeCp[1]
                )
                    lastSettledBalance = prefix.materialChangeCp;
            }
            return {
                ...query,
                addsTacticalEvidence:
                    !baselineTactical && mistake?.tactical.support === "supported",
                corroboratedScore:
                    line.depth >= 16 &&
                    line.cp !== null &&
                    played.cp !== null &&
                    Math.abs(played.cp + line.cp) <= 90,
                settledMaterialLoss: (lastSettledBalance ?? 0) <= -90,
            };
        }),
    };
}

test.skipIf(!directory)(
    "audit decision evidence against an explicit development or validation partition",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const cohort = process.env.DECISION_AUDIT_COHORT ?? "course";
        if (!["course", "independent", "classical", "tournament"].includes(cohort))
            throw new Error("Invalid cohort");
        if (rankReplies && cohort !== "tournament")
            throw new Error("Use the tournament cohort for the reply ranking experiment");
        const protocol = process.env.DECISION_ENGINE_PROTOCOL ?? "2";
        if (!["1", "2"].includes(protocol)) throw new Error("Invalid engine protocol");
        const profile = process.env.DECISION_ENGINE_PROFILE ?? "v2";
        if (!/^[a-z0-9-]+$/.test(profile)) throw new Error("Invalid engine profile");
        const probeProfile = process.env.DECISION_PROBE_PROFILE ?? profile;
        if (!/^[a-z0-9-]+$/.test(probeProfile)) throw new Error("Invalid probe profile");
        const sampleBytes = readFileSync(join(directory!, `${cohort}-sample.json`));
        const sample = JSON.parse(sampleBytes.toString("utf8"));
        const split = process.env.DECISION_AUDIT_SPLIT ?? "development";
        if (!["development", "validation", "reviewed-validation"].includes(split))
            throw new Error("Invalid split");
        let frozen: {
            engineSha256: string;
            search: {
                minimumDepth: number;
                maximumRootNodes: number;
                sharedReplyBudgetNodes?: number;
                positionReplyBudgetNodes?: number;
                extraChoice?: {
                    shortlistNodes: number;
                    shortlistWidth: number;
                    pairNodes: number;
                    replyNodes: number;
                };
            };
        } | null = null;
        let freezeSha256: string | null = null;
        let referenceSha256: string | null = null;
        let rows = sample.cases.filter((r: { split: string }) => r.split === split);
        if (split !== "development") {
            const { assertFrozenFiles, selectFrozenValidation, sha256 } =
                await import("../../../scripts/benchmarks/decision-evidence-freeze.mjs");
            const freezePath = process.env.DECISION_FREEZE_PATH;
            const referencePath = process.env.DECISION_REFERENCE_PATH;
            if (!freezePath || !referencePath)
                throw new Error(
                    "Held-out evaluation requires a frozen candidate and a saved reference before classification",
                );
            const freezeBytes = readFileSync(freezePath);
            frozen = JSON.parse(freezeBytes.toString("utf8"));
            if (split === "validation") {
                assertFrozenFiles(process.cwd(), frozen);
                if (Boolean(frozen?.search.sharedReplyBudgetNodes) !== sharedReplies)
                    throw new Error("Shared reply use must match the frozen search plan");
                if (Boolean(frozen?.search.positionReplyBudgetNodes) !== positionChoices)
                    throw new Error("Position reply use must match the frozen search plan");
                if (Boolean(frozen?.search.extraChoice) !== extraChoices)
                    throw new Error("Extra candidate use must match the frozen search plan");
            }
            rows = selectFrozenValidation(sampleBytes, cohort, frozen);
            const referenceBytes = readFileSync(referencePath);
            const reviewed = new Set(
                JSON.parse(referenceBytes.toString("utf8")).cases.map(
                    (row: { id: string }) => row.id,
                ),
            );
            if (rows.some((row: { id: string }) => !reviewed.has(row.id)))
                throw new Error(
                    "Every held-out case needs a reference entry, including explicit uncertainty",
                );
            freezeSha256 = sha256(freezeBytes);
            referenceSha256 = sha256(referenceBytes);
            if (split === "reviewed-validation") {
                const path = process.env.DECISION_PRIOR_RESULT_PATH;
                if (!path) throw new Error("A replay requires the original held-out result");
                const prior = JSON.parse(readFileSync(path, "utf8"));
                if (
                    prior.split !== "validation" ||
                    prior.freezeSha256 !== freezeSha256 ||
                    prior.referenceSha256 !== referenceSha256 ||
                    prior.cohort !== cohort ||
                    prior.engineProfile !== profile ||
                    prior.probeProfile !== probeProfile
                )
                    throw new Error("The original held-out result does not match this replay");
            }
        }
        const name = process.env.DECISION_AUDIT_NAME ?? "decision-candidate-v3";
        if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Invalid audit name");
        const output = privateReportPath(join(directory!, `${name}.json`));
        expect(existsSync(output)).toBe(false);
        const extra = extraChoices
            ? JSON.parse(readFileSync(join(directory!, "quick-nominations.json"), "utf8"))
            : null;
        if (
            extra &&
            (extra.rootSha256 !== createHash("sha256").update(sampleBytes).digest("hex") ||
                (frozen && extra.engineSha256 !== frozen.engineSha256) ||
                JSON.stringify(extra.profiles) !== JSON.stringify({ six90k: [6, 90_000] }))
        )
            throw new Error("Extra search does not match the audited sample and shortlist budget");
        const extraById = new Map<string, ExtraChoiceCase>(
            (extra?.results ?? []).map((row: ExtraChoiceCase) => [row.id, row]),
        );
        const results = rows.map((row: { id: string; fen: string; category: string }) => {
            const engineBytes = readFileSync(
                join(
                    directory!,
                    protocol === "2"
                        ? `${cohort}-engine-${profile}`
                        : cohort === "course"
                          ? "engine-reproducible"
                          : `${cohort}-engine`,
                    `${row.id}.json`,
                ),
            );
            const engine = JSON.parse(engineBytes.toString("utf8"));
            const engineHash = createHash("sha256").update(engineBytes).digest("hex");
            const probeBytes = readFileSync(
                join(
                    directory!,
                    protocol === "2"
                        ? `${cohort}-probes-${probeProfile}`
                        : cohort === "course"
                          ? "reply-probes"
                          : `${cohort}-probes`,
                    `${row.id}.json`,
                ),
            );
            const probes = JSON.parse(probeBytes.toString("utf8"));
            if (
                frozen &&
                (engine.identity.protocol !== 2 ||
                    engine.identity.engine_sha256 !== frozen.engineSha256 ||
                    engine.identity.minimum_depth !== frozen.search.minimumDepth ||
                    engine.identity.maximum_root_nodes !== frozen.search.maximumRootNodes ||
                    probes.identity.engine_sha256 !== frozen.engineSha256 ||
                    probes.identity.capture_resource_limit !== 3 ||
                    probes.identity.root_sha256 !== engineHash)
            )
                throw new Error("Held-out search evidence does not match the frozen policy");
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
            const input: Parameters<typeof assessChessDecision>[0] = {
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
            };
            let sharedReplyNodes: number | undefined;
            let sharedReplyMs: number | undefined;
            if (sharedReplies) {
                const opponent = probes.replyProbes.find(
                    (item: { moveUci: string }) => item.moveUci === engine.played,
                )?.lines[0];
                if (played && opponent && engine.deep[0].pvUci[0] === compared[0].pvUci[0]) {
                    const request = nominateSharedReply(row.fen, compared[0], played, opponent);
                    if (request) {
                        const cached = JSON.parse(
                            readFileSync(
                                join(
                                    directory!,
                                    `${cohort}-shared-${probeProfile}`,
                                    `${row.id}.json`,
                                ),
                                "utf8",
                            ),
                        );
                        const evidence: DecisionSharedReplyProbe | null = cached.sharedReply;
                        if (
                            cached.identity.rootSha256 !== engineHash ||
                            cached.identity.probeSha256 !==
                                createHash("sha256").update(probeBytes).digest("hex") ||
                            cached.identity.budget !== 1_000_000 ||
                            cached.identity.engineSha256 !== engine.identity.engine_sha256 ||
                            (evidence &&
                                (evidence.betterMoveUci !== request.betterMoveUci ||
                                    evidence.playedMoveUci !== request.playedMoveUci ||
                                    evidence.line.pvUci[0] !== request.replyUci))
                        )
                            throw new Error(
                                "Shared reply evidence differs from the nominated exact query",
                            );
                        input.sharedReply = evidence ?? undefined;
                        sharedReplyNodes = cached.requestedNodes;
                        sharedReplyMs = cached.milliseconds;
                    }
                }
            }
            let positionReplyNodes: number | undefined;
            let positionReplyMs: number | undefined;
            if (positionChoices) {
                if (probes.identity.position_reply_budget !== 1_000_000)
                    throw new Error("Position reply cache uses an unexpected node budget");
                const nomination = nominatePositionRefutation(row.fen, input.candidates);
                if (nomination) {
                    const fromGame = input.replyProbes!.some(
                        (probe) => probe.moveUci === nomination.moveUci,
                    );
                    if (fromGame) positionReplyNodes = 0;
                    else {
                        const evidence = probes.positionReplyProbes.find(
                            (probe: { moveUci: string }) => probe.moveUci === nomination.moveUci,
                        );
                        if (!evidence)
                            throw new Error("No cached position reply for the nominated move");
                        input.positionReply = evidence;
                        positionReplyNodes = evidence.attempt.requestedNodes;
                        positionReplyMs = evidence.attempt.milliseconds;
                    }
                }
            }
            const assessmentWithoutExtraChoice = assessChessDecision(input);
            let extraChoiceNodes: number | undefined;
            let extraChoiceMs: number | undefined;
            if (
                extraChoices &&
                assessmentWithoutExtraChoice?.position.tactical.support !== "supported"
            ) {
                const cache = extraById.get(row.id);
                if (!cache || cache.cachedRootSha256 !== engineHash)
                    throw new Error("Extra search did not use this board's exact root frame");
                const shortlist = cache.observed.six90k;
                if (
                    shortlist &&
                    input.candidates[0].depth >= 18 &&
                    input.candidates[0].cp !== null
                ) {
                    extraChoiceNodes = 90_000;
                    extraChoiceMs = shortlist.attempt.milliseconds;
                    const move = pickExtraPositionMove(row.fen, input.candidates, shortlist.lines);
                    if (move !== (cache.choices.six90k ?? null))
                        throw new Error("Engine shortlist and move nomination disagree");
                    if (move) {
                        const evidence = cache.verification[move];
                        extraChoiceNodes += 1_200_000;
                        extraChoiceMs += evidence.attempt.milliseconds;
                        if (
                            compareExtraPositionMove(
                                row.fen,
                                input.candidates[0],
                                move,
                                evidence.pair,
                            ) &&
                            evidence.reply
                        ) {
                            extraChoiceNodes += 1_000_000;
                            extraChoiceMs += evidence.reply.attempt.milliseconds;
                            input.extraPositionChoice = {
                                shortlist: shortlist.lines,
                                pair: evidence.pair,
                                replies: evidence.reply.lines,
                            };
                        }
                    }
                }
            }
            const assessment = input.extraPositionChoice
                ? assessChessDecision(input)
                : assessmentWithoutExtraChoice;
            const milliseconds = performance.now() - started - baselineMs;
            const rootOnlyAssessment =
                cohort === "tournament"
                    ? assessChessDecision({
                          ...input,
                          replyProbes: [],
                          positionReply: undefined,
                          extraPositionChoice: undefined,
                      })
                    : undefined;
            return {
                id: row.id,
                category: row.category,
                engineIdentity: engine.identity,
                probeIdentity: probes.identity,
                witnesses,
                strategicEffects: extractStrategicRootEffects(row.fen, engine.deep[0]),
                structuralTransitions: extractPositionalTransitions(row.fen, engine.deep[0]),
                assessment,
                assessmentWithoutExtraChoice: extraChoices
                    ? assessmentWithoutExtraChoice
                    : undefined,
                extraChoiceNodes,
                extraChoiceMs,
                rootOnlyAssessment,
                sharedReplyNodes,
                sharedReplyMs,
                positionReplyNodes,
                positionReplyMs,
                replyRanking: rankReplies
                    ? auditRankedReplies(
                          join(directory!, `${cohort}-rank-probes-${profile}`, `${row.id}.json`),
                          engine,
                          engineHash,
                          input,
                      )
                    : undefined,
                baseline,
                baselineMistake,
                baselineMs,
                measurements: measureDecisionLine(row.fen, engine.deep[0]),
                milliseconds,
                probeNodes:
                    cohort === "tournament"
                        ? probes.replyProbes.reduce(
                              (
                                  nodes: number,
                                  probe: {
                                      attempts: { nodes: number }[];
                                      targetedCaptures: { attempts: { nodes: number }[] }[];
                                  },
                              ) =>
                                  nodes +
                                  [
                                      ...probe.attempts,
                                      ...probe.targetedCaptures.flatMap((r) => r.attempts),
                                  ].reduce((sum, attempt) => sum + attempt.nodes, 0),
                              0,
                          )
                        : undefined,
            };
        });
        const sourceHashes = Object.fromEntries(
            [
                "decisionAssessment.ts",
                "decisionProofAdapter.ts",
                "conditionalTacticalResources.ts",
                "tacticalMistakeEpisode.ts",
                "decisionMateConsequence.ts",
                "decisionForcingConsequence.ts",
                "decisionSharedReply.ts",
                "decisionPawnEpisode.ts",
                "decisionPositionContrast.ts",
                "conditionalForkEvidence.ts",
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
                    scope:
                        split === "validation"
                            ? "Frozen held-out candidate; accuracy requires reviewed reference scoring"
                            : split === "reviewed-validation"
                              ? "Development replay of previously reviewed validation cases"
                              : "Development candidate, not held-out accuracy",
                    split,
                    freezeSha256,
                    referenceSha256,
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
