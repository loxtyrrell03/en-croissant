import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "./causalTactics";
import {
    measureDecisionLine,
    measurePositionDecision,
    type DecisionEngineLine,
} from "./decisionEvidence";
import {
    comparePositionalTransitions,
    corroboratePositionalEffects,
    type ComparativePositionalEvidence,
} from "./positionalTransitions";
import {
    extractTacticalSequenceWitnesses,
    mergeTacticalSequenceWitnesses,
    measureTacticalEpisode,
    type TacticalEpisodeOutcome,
    type TacticalSequenceWitness,
} from "./tacticalSequenceEvidence";
import { isImmediateTacticalLesson } from "./mistakeReviewAdapter";
import type { TacticalMotifEvidence } from "./types";
import { refineDecisionCertificates, type DecisionLocalProof } from "./decisionProofAdapter";
import {
    findConditionalCaptureResources,
    type ConditionalTacticalResource,
} from "./conditionalTacticalResources";

export const DECISION_ASSESSMENT_VERSION = 1;
export type DecisionCategory = "tactical" | "positional" | "mixed" | "unclear";
export type DecisionDimension = {
    support: "unestablished" | "suggestive" | "supported";
    basis: "engine-supported" | "bounded-proof" | "heuristic" | "insufficient";
    reasons: string[];
};
export type DecisionAssessment = {
    category: DecisionCategory;
    tactical: DecisionDimension;
    positional: DecisionDimension;
    mechanisms: TacticalSequenceWitness[];
    verifiedMotifs: TacticalMotifEvidence[];
    localProofs: DecisionLocalProof[];
    episodeOutcomes: TacticalEpisodeOutcome[];
    conditionalResources: ConditionalTacticalResource[];
    positionalFactors: ComparativePositionalEvidence[];
    limitations: string[];
};
export type DecisionReplyProbe = {
    /** The root choice whose best opponent responses were searched. */
    moveUci: string;
    lines: DecisionEngineLine[];
    targetedCaptures?: Array<{ line: DecisionEngineLine }>;
};
export type DecisionAssessmentInput = {
    fen: string;
    candidates: DecisionEngineLine[];
    /** Paired same-search evaluations of the global best root and actual played
     * root. Useful when the human move is outside the global top three. */
    comparisonCandidates?: DecisionEngineLine[];
    replyProbes?: DecisionReplyProbe[];
    rootCertificates?: Array<{ fen: string; moveUci: string; motifs: TacticalMotifEvidence[] }>;
    mistakeCertificate?: {
        fen: string;
        bestMoveUci: string;
        playedMoveUci: string;
        tactical: boolean;
        reasons: string[];
    };
    /** A played move must be independently evaluated among these candidates.
     * Absence is unavailable data, never an assumed zero loss. */
    playedMoveUci?: string;
};
export type ChessDecisionReport = {
    version: number;
    fen: string;
    position: DecisionAssessment & {
        bestSecondGapCp: number | null;
        examinedChoices: number;
        legalChoices: number;
        rejectedChoices: number;
    };
    moves: Array<
        DecisionAssessment & { moveUci: string; evaluationCp: number | null; depth: number }
    >;
    mistakeStatus:
        | "not-requested"
        | "best-supplied-choice"
        | "no-meaningful-loss-measured"
        | "comparison-unavailable"
        | "assessed";
    mistake:
        | (DecisionAssessment & {
              evaluationLossCp: number;
              mechanisms: TacticalSequenceWitness[];
              missed: TacticalSequenceWitness[];
              allowed: TacticalSequenceWitness[];
          })
        | null;
};
const emptyDimension = (reason: string): DecisionDimension => ({
    support: "unestablished",
    basis: "insufficient",
    reasons: [reason],
});
function emptyAssessment(): DecisionAssessment {
    return {
        category: "unclear",
        tactical: emptyDimension("No relevant tactical mechanism has been established."),
        positional: emptyDimension("No relevant positional difference has been established."),
        mechanisms: [],
        verifiedMotifs: [],
        localProofs: [],
        episodeOutcomes: [],
        conditionalResources: [],
        positionalFactors: [],
        limitations: [],
    };
}
function category(tactical: DecisionDimension, positional: DecisionDimension): DecisionCategory {
    const t = tactical.support === "supported",
        p = positional.support === "supported";
    return t && p ? "mixed" : t ? "tactical" : p ? "positional" : "unclear";
}

/** Validate a separate search of the opponent's replies. This is engine
 * corroboration at a finite horizon, not exhaustive tactical proof. */
function corroboratingReply(
    fen: string,
    line: DecisionEngineLine,
    probe: DecisionReplyProbe | undefined,
) {
    if (!probe || probe.moveUci !== line.pvUci[0]) return false;
    const first = replayTacticalLine(fen, [line.pvUci[0]])[0];
    if (!first) return false;
    const replyFen = makeFen(first.after.toSetup());
    const replies = measurePositionDecision(replyFen, probe.lines);
    if (!replies || !replies.lines.length || replies.lines.length !== probe.lines.length)
        return false;
    const reply = probe.lines[0];
    if (reply.depth < 16 || probe.lines.some((item) => item.depth !== reply.depth)) return false;
    if (
        probe.lines.every((item) => item.cp !== null && item.mate == null) &&
        probe.lines.some((item, index) => index > 0 && item.cp! > probe.lines[index - 1].cp!)
    )
        return false;
    // Finite score convergence is a reliability gate, not a motif classifier.
    if (line.mate != null) return line.mate > 0 && reply.mate != null && reply.mate < 0;
    return (
        line.cp !== null &&
        reply.cp !== null &&
        reply.mate == null &&
        Math.abs(line.cp + reply.cp) <= 90
    );
}

function assessMove(input: DecisionAssessmentInput, line: DecisionEngineLine): DecisionAssessment {
    const result = emptyAssessment();
    const measured = measureDecisionLine(input.fen, line);
    if (!measured || measured.drawnEnding) {
        result.limitations.push(
            "The continuation is invalid or reaches an available draw; no later payoff is inferred.",
        );
        return result;
    }
    const probe = input.replyProbes?.find((item) => item.moveUci === line.pvUci[0]);
    const corroborated = corroboratingReply(input.fen, line, probe);
    const branches: DecisionEngineLine[] = corroborated
        ? probe!.lines
              .filter(
                  (item, index) =>
                      index === 0 ||
                      (item.cp !== null &&
                          probe!.lines[0].cp !== null &&
                          item.cp >= probe!.lines[0].cp - 80),
              )
              .map((reply) => ({
                  ...reply,
                  fen: input.fen,
                  cp: reply.cp === null ? null : -reply.cp,
                  mate: reply.mate == null ? null : -reply.mate,
                  pvUci: [line.pvUci[0], ...reply.pvUci],
              }))
        : [line];
    const witnessedBranches = branches.map((branch) => ({
        line: branch,
        measured: measureDecisionLine(input.fen, branch),
        witnesses: extractTacticalSequenceWitnesses(input.fen, branch).filter(
            (item) => item.rootMoveInvolved,
        ),
    }));
    const witnesses = mergeTacticalSequenceWitnesses(
        witnessedBranches.flatMap((branch) => branch.witnesses),
    );
    const factors = comparePositionalTransitions(input.fen, line, input.candidates);
    if (corroborated)
        for (const item of corroboratePositionalEffects(input.fen, line, branches[0])) {
            if (
                !factors.some(
                    (other) =>
                        other.feature === item.feature &&
                        other.side === item.side &&
                        other.squareOrFile === item.squareOrFile,
                )
            )
                factors.push(item);
        }
    result.mechanisms = witnesses;
    result.positionalFactors = factors;
    if (factors.length) {
        result.positional = {
            support: "supported",
            basis: "heuristic",
            reasons: factors.map((item) =>
                item.comparison === "alternative-choice"
                    ? `${item.description} This persists through ply ${item.lastConsecutivePly} in the better line and is absent from the compared choice (${item.comparisonMoveUci}).`
                    : `${item.description} The same effect persists in the root search and the separate search of the opponent's best reply.${item.materialWindowPlies ? ` Material remains balanced within the first ${item.materialWindowPlies} plies; this does not describe every later consequence.` : ""}`,
            ),
        };
        result.limitations.push(
            "The feature changes are verified board facts. Their strategic importance is a heuristic interpretation; the engine does not assign its score to individual features.",
        );
    }
    if (witnesses.length) {
        result.episodeOutcomes = witnessedBranches
            .flatMap((branch) =>
                branch.witnesses
                    .map((witness) => measureTacticalEpisode(input.fen, branch.line, witness))
                    .filter((outcome): outcome is TacticalEpisodeOutcome => outcome !== null),
            )
            .filter(
                (outcome, index, all) =>
                    all.findIndex(
                        (other) => other.lineUci.join(" ") === outcome.lineUci.join(" "),
                    ) === index,
            );
        const relevantOutcome = witnessedBranches.some((branch) => {
            const outcome = branch.measured;
            return (
                branch.witnesses.length > 0 &&
                outcome &&
                !outcome.drawnEnding &&
                ((outcome.endingMaterialRangeCp[0] >= 90 &&
                    outcome.endingMaterialRangeCp[0] === outcome.endingMaterialRangeCp[1] &&
                    outcome.quietEndingPlies >= 2) ||
                    (outcome.checkmate && (branch.line.mate ?? 0) > 0) ||
                    factors.length > 0)
            );
        });
        result.tactical = {
            support:
                corroborated && (relevantOutcome || result.episodeOutcomes.length > 0)
                    ? "supported"
                    : "suggestive",
            basis: corroborated ? "engine-supported" : "insufficient",
            reasons: witnesses.map((item) => item.description),
        };
        if (!corroborated)
            result.limitations.push(
                "The mechanism appears in a legal line, but a separate stable search of the opponent's replies has not confirmed it.",
            );
        if (!relevantOutcome && !result.episodeOutcomes.length)
            result.limitations.push(
                "The analysed line does not yet connect this mechanism to a settled material, mating or identified positional outcome.",
            );
        result.limitations.push(
            "The shown reply is the engine's choice at the recorded depth. Other defences may change the mechanism or outcome.",
            ...result.episodeOutcomes.map((outcome) => outcome.limitation).slice(0, 1),
        );
    }
    if (corroborated && probe?.targetedCaptures?.length) {
        result.conditionalResources = findConditionalCaptureResources(
            input.fen,
            line,
            probe.lines,
            probe.targetedCaptures.map((item) => item.line),
        );
        if (result.conditionalResources.length) {
            result.tactical = {
                support: "supported",
                basis: "engine-supported",
                reasons: [
                    ...result.tactical.reasons.filter(
                        (reason) => !reason.startsWith("No relevant"),
                    ),
                    ...result.conditionalResources.map((item) => item.description),
                ],
            };
            result.limitations.push(result.conditionalResources[0].limitation);
        }
    }
    const certificates =
        input.rootCertificates
            ?.find((item) => item.fen === input.fen && item.moveUci === line.pvUci[0])
            ?.motifs.filter(
                (motif) =>
                    motif.moveUci === line.pvUci[0] &&
                    motif.ply === 1 &&
                    isImmediateTacticalLesson(motif),
            ) ?? [];
    if (certificates.length) {
        const refined = refineDecisionCertificates(input.fen, line.pvUci[0], certificates);
        result.verifiedMotifs = refined.motifs;
        result.localProofs = refined.proofs;
        result.tactical = {
            support: "supported",
            basis: "bounded-proof",
            reasons: refined.motifs.map((item) => item.evidence),
        };
        result.limitations.push(
            "The local tactical certificate covers its recorded mechanism and search horizon, not a complete proof of the position's value.",
        );
    }
    if (measured.checkmate && measured.plies === 1) {
        result.tactical = {
            support: "supported",
            basis: "bounded-proof",
            reasons: ["The first move legally checkmates. There is no legal reply."],
        };
    } else if (
        corroborated &&
        (line.mate ?? 0) > 0 &&
        line.mate! <= 6 &&
        witnessedBranches.some((branch) => branch.measured?.checkmate)
    ) {
        result.tactical = {
            support: "supported",
            basis: "engine-supported",
            reasons: [
                "The root search and separate reply search agree on a short forced mate, and the displayed continuation legally ends in checkmate.",
                ...result.tactical.reasons.filter((reason) => !reason.startsWith("No relevant")),
            ],
        };
        result.limitations.push(
            "This is an engine-supported mating conclusion. No more specific mating motif is inferred from the score.",
        );
    }
    result.category = category(result.tactical, result.positional);
    return result;
}

/** Three separate assessments with independent dimensions. No score sums to
 * 100%, and no player thought process is inferred from the objective error. */
export function assessChessDecision(input: DecisionAssessmentInput): ChessDecisionReport | null {
    const measured = measurePositionDecision(input.fen, input.candidates);
    if (!measured || !measured.lines.length || !measureDecisionLine(input.fen, input.candidates[0]))
        return null;
    const validCandidates = input.candidates.filter((line) => measureDecisionLine(input.fen, line));
    // Duplicated roots are incoherent input; a later invalid alternative is
    // merely unavailable evidence. Keep a valid principal line without
    // promoting a different move or borrowing an invalid variation's score.
    if (validCandidates.length !== measured.lines.length) return null;
    const rejectedChoices = input.candidates.length - validCandidates.length;
    if (
        validCandidates.every(
            (line) =>
                line.cp !== null && line.mate == null && line.depth === validCandidates[0].depth,
        ) &&
        validCandidates.some(
            (line, index) => index > 0 && line.cp! > validCandidates[index - 1].cp!,
        )
    )
        return null;
    const originalCandidates = input.candidates;
    input = { ...input, candidates: validCandidates };
    const moves = input.candidates.map((line) => ({
        ...assessMove(input, line),
        moveUci: line.pvUci[0],
        evaluationCp: line.cp,
        depth: line.depth,
    }));
    const first = input.candidates[0];
    const position = {
        ...emptyAssessment(),
        bestSecondGapCp: measured.bestSecondGapCp,
        examinedChoices: measured.lines.length,
        legalChoices: measured.legalMoves,
        rejectedChoices,
    };
    // Position character describes the available decisions. Only choices within
    // the measured competitive band contribute; a losing combination does not.
    const viable = moves.filter(
        (move, i) =>
            i === 0 ||
            (first.cp !== null &&
                move.evaluationCp !== null &&
                move.depth === first.depth &&
                move.evaluationCp >= first.cp - 50),
    );
    const tactical = viable.find((move) => move.tactical.support === "supported");
    const positional = viable.find((move) => move.positional.support === "supported");
    if (tactical) position.tactical = tactical.tactical;
    if (positional) position.positional = positional.positional;
    position.category = category(position.tactical, position.positional);
    position.mechanisms = tactical?.mechanisms ?? [];
    position.verifiedMotifs = tactical?.verifiedMotifs ?? [];
    position.localProofs = tactical?.localProofs ?? [];
    position.episodeOutcomes = tactical?.episodeOutcomes ?? [];
    position.conditionalResources = tactical?.conditionalResources ?? [];
    position.positionalFactors = positional?.positionalFactors ?? [];
    position.limitations = [
        "Position character reflects the supplied competitive choices, not every legal move or every future plan.",
        ...(rejectedChoices
            ? [
                  `${rejectedChoices} alternative continuation(s) could not be validated. Their scores and motifs were not used; the gap between choices is unavailable.`,
              ]
            : []),
    ];

    let mistake: ChessDecisionReport["mistake"] = null;
    let mistakeStatus: ChessDecisionReport["mistakeStatus"] = input.playedMoveUci
        ? "comparison-unavailable"
        : "not-requested";
    const comparison = input.comparisonCandidates ?? originalCandidates;
    const comparisonMeasured = measurePositionDecision(input.fen, comparison);
    const comparedBest = comparison[0];
    const afterChoice = (uci: string | undefined) => {
        const step = uci ? replayTacticalLine(input.fen, [uci])[0] : undefined;
        return step ? makeFen(step.after.toSetup()) : undefined;
    };
    const playedBoard = afterChoice(input.playedMoveUci);
    const playedIndex = comparison.findIndex(
        (line) => playedBoard !== undefined && afterChoice(line.pvUci[0]) === playedBoard,
    );
    if (
        playedIndex === 0 &&
        comparedBest?.pvUci[0] === first.pvUci[0] &&
        comparisonMeasured?.lines.length === comparison.length
    )
        mistakeStatus = "best-supplied-choice";
    if (
        playedIndex > 0 &&
        comparisonMeasured?.bestSecondGapCp !== null &&
        comparisonMeasured &&
        comparedBest?.cp !== null &&
        comparedBest.pvUci[0] === first.pvUci[0]
    ) {
        const playedLine = comparison[playedIndex];
        const loss = comparedBest.cp! - playedLine.cp!;
        if (loss <= 20) mistakeStatus = "no-meaningful-loss-measured";
        if (loss > 20) {
            mistakeStatus = "assessed";
            // A best-move label is not automatically an error explanation.
            // Require a witnessed root mechanism absent from the played choice
            // AND a material consequence difference to attribute a missed tactic.
            const bestMeasured = comparisonMeasured.lines[0],
                playedMeasured = comparisonMeasured.lines[playedIndex];
            const comparisonInput = { ...input, candidates: comparison };
            const bestAssessment = assessMove(comparisonInput, comparedBest);
            const playedAssessment = assessMove(comparisonInput, playedLine);
            const sameMechanism = (a: TacticalSequenceWitness, b: TacticalSequenceWitness) =>
                a.mechanism === b.mechanism &&
                a.actor === b.actor &&
                a.squares.some((square) => b.squares.includes(square));
            const settled = (line: typeof bestMeasured) =>
                !line.drawnEnding &&
                line.quietEndingPlies >= 2 &&
                line.endingMaterialRangeCp[0] === line.endingMaterialRangeCp[1];
            const missed =
                bestAssessment.tactical.support === "supported" &&
                settled(bestMeasured) &&
                settled(playedMeasured) &&
                bestMeasured.endingMaterialRangeCp[0] - playedMeasured.endingMaterialRangeCp[1] >=
                    90
                    ? bestAssessment.mechanisms
                          .flatMap((witness) => [witness, ...(witness.alternatives ?? [])])
                          .filter(
                              (w) =>
                                  w.lineUci.every(
                                      (uci, index) => comparedBest.pvUci[index] === uci,
                                  ) &&
                                  !playedAssessment.mechanisms.some((other) =>
                                      sameMechanism(w, other),
                                  ),
                          )
                    : [];
            let allowed: TacticalSequenceWitness[] = [];
            const playedProbe = input.replyProbes?.find(
                (item) => item.moveUci === playedLine.pvUci[0],
            );
            if (settled(bestMeasured) && corroboratingReply(input.fen, playedLine, playedProbe)) {
                const opponent = playedProbe!.lines[0];
                const playedBranch = measureDecisionLine(input.fen, {
                    ...opponent,
                    fen: input.fen,
                    cp: opponent.cp === null ? null : -opponent.cp,
                    mate: opponent.mate == null ? null : -opponent.mate,
                    pvUci: [playedLine.pvUci[0], ...opponent.pvUci],
                });
                const firstBest = replayTacticalLine(input.fen, [comparedBest.pvUci[0]])[0];
                const bestReplyFen = makeFen(firstBest.after.toSetup());
                const betterReplyWitnesses = extractTacticalSequenceWitnesses(bestReplyFen, {
                    ...comparedBest,
                    fen: bestReplyFen,
                    cp: comparedBest.cp === null ? null : -comparedBest.cp,
                    mate: comparedBest.mate == null ? null : -comparedBest.mate,
                    pvUci: comparedBest.pvUci.slice(1),
                });
                if (
                    playedBranch &&
                    settled(playedBranch) &&
                    bestMeasured.materialChangeCp - playedBranch.materialChangeCp >= 90
                ) {
                    allowed = extractTacticalSequenceWitnesses(opponent.fen, opponent).filter(
                        (w) =>
                            w.rootMoveInvolved &&
                            !betterReplyWitnesses.some(
                                (other) => other.rootMoveInvolved && sameMechanism(w, other),
                            ),
                    );
                }
            }
            const assessment = emptyAssessment();
            if (missed.length || allowed.length)
                assessment.tactical = {
                    support: "supported",
                    basis: "engine-supported",
                    reasons: [
                        ...missed.map(
                            (item) =>
                                `The better choice uses ${item.mechanism}. The played continuation retains less material in the analysed horizon. ${item.description}`,
                        ),
                        ...allowed.map(
                            (item) =>
                                `The opponent can use ${item.mechanism} after the played move. This mechanism is absent from the compared better line, which retains more material. ${item.description}`,
                        ),
                    ],
                };
            const certificate = input.mistakeCertificate;
            if (
                certificate?.tactical &&
                certificate.fen === input.fen &&
                certificate.bestMoveUci === comparedBest.pvUci[0] &&
                certificate.playedMoveUci === playedLine.pvUci[0] &&
                certificate.reasons.length
            ) {
                assessment.tactical = {
                    support: "supported",
                    basis: "bounded-proof",
                    reasons: [
                        ...certificate.reasons,
                        ...assessment.tactical.reasons.filter(
                            (reason) => !reason.startsWith("No relevant"),
                        ),
                    ],
                };
            }
            // Compare this particular played choice, not a different alternative.
            const factors = comparePositionalTransitions(input.fen, comparedBest, [playedLine]);
            if (factors.length) {
                assessment.positional = {
                    support: "supported",
                    basis: "heuristic",
                    reasons: factors.map(
                        (item) =>
                            `${item.description} The played continuation does not establish this feature in the compared window.`,
                    ),
                };
                assessment.positionalFactors = factors;
            }
            assessment.category = category(assessment.tactical, assessment.positional);
            assessment.limitations = [
                "This compares objective consequences. It cannot establish what the player saw or misunderstood.",
                "The compared branches and finite search depth limit the attribution. A delayed strategic collapse can remain unresolved.",
            ];
            mistake = {
                ...assessment,
                evaluationLossCp: loss,
                mechanisms: [...allowed, ...missed],
                missed,
                allowed,
            };
        }
    }
    return {
        version: DECISION_ASSESSMENT_VERSION,
        fen: input.fen,
        position,
        moves,
        mistake,
        mistakeStatus,
    };
}
