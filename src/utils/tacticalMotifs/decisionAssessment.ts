import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "./causalTactics";
import {
    endPairedLineAtDeadDraw,
    measureDecisionLine,
    measurePositionDecision,
    type DecisionEngineLine,
} from "./decisionEvidence";
import {
    compareLostOutpost,
    comparePositionalTransitions,
    corroboratePositionalEffects,
    type ComparativePositionalEvidence,
} from "./positionalTransitions";
import {
    extractTacticalSequenceWitnesses,
    mergeTacticalSequenceWitnesses,
    measureTacticalEpisode,
    sameTacticalMechanism,
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
import {
    compareTacticalMistakeEpisode,
    type TacticalMistakeEpisode,
} from "./tacticalMistakeEpisode";
import {
    compareMateConsequence,
    findAllowedImmediateMate,
    type DecisionMateConsequence,
} from "./decisionMateConsequence";
import { findAllowedMateInTwo } from "./decisionAllowedMateInTwo";
import { findAllowedMateInThree } from "./decisionAllowedMateInThree";
import type { TacticalGameHistory } from "./gameHistory";
import { corroborateMatingLines, type ConfirmedMatingLines } from "./decisionMatingLines";
import { findImmediateMateDefence, type ImmediateMateDefence } from "./decisionMateDefence";
import { findQuietMateThreat, type QuietMateThreat } from "./decisionQuietMateThreat";
import { findQuietMateInTwoThreat } from "./decisionQuietMateInTwo";
import { explainFleetingCapture } from "./decisionCaptureOpportunity";
import { findConditionalFork, type ConditionalForkEvidence } from "./conditionalForkEvidence";
import {
    findConditionalMate,
    findRecoveringFork,
    type DecisionConditionalMate,
} from "./conditionalDecisionResources";
import { compareExposedForcingAttack } from "./decisionForcingConsequence";
import { compareOpenedCheckingAttack } from "./decisionOpenedCheckingAttack";
import { comparePawnInterception } from "./decisionPawnInterception";
import {
    compareTacticalRecovery,
    corroborateRecoveryReply,
    type DecisionTacticalRecovery,
} from "./decisionTacticalRecovery";
import {
    compareExposedPieceTrap,
    compareSharedReply,
    type DecisionSharedReplyProbe,
} from "./decisionSharedReply";
import { compareSharedRay } from "./decisionSharedRay";
import { comparePawnEpisodes } from "./decisionPawnEpisode";
import { compareLostKingShelter, findKingShelterTradeoff } from "./decisionKingShelter";
import {
    confirmExtraPositionChoice,
    confirmPositionRefutation,
    nominatePositionRefutation,
    type ExtraPositionChoice,
} from "./decisionPositionContrast";
import {
    findPositionStrategicPlan,
    qualifyPositionFactors,
    type PositionStrategicPlan,
} from "./decisionPositionPlans";
import { findSharedStructuralPlan } from "./decisionSharedStructure";
import { findPromotionPressure, findPromotionTradeAfterAdvance } from "./decisionPromotionPressure";
import { comparePromotionMistake, type PromotionMistakeEvidence } from "./decisionPromotionMistake";
import { compareRookPressure, type RookPressureEvidence } from "./decisionRookPressure";
import { comparePawnStructure, type PawnStructureEvidence } from "./decisionPawnStructure";
import {
    confirmPreparedCheckpoint,
    nominatePreparedCheckpoint,
} from "./decisionPreparedCheckpoint";

import {
    confirmCheckingDefence,
    confirmPassedAdvance,
    nominateCheckingDefence,
    type CheckingDefenceProbe,
    type CheckingDefenceRequest,
    type PassedAdvanceEvidence,
    type PassedAdvanceRequest,
} from "./decisionCheckingDefence";

import { compareAllowedDecisionRoutes } from "./decisionAllowedRoutes";
import { findCaptureEffectDependencies } from "./decisionCaptureEffects";
import {
    corroborateDecisionLineRoutes,
    isStructuralEffectFromTacticalCapture,
} from "./decisionLineRoutes";

import { comparePromotionCheckTempo } from "./decisionPromotionCheckTempo";

import { confirmPasserFlight, nominatePasserFlight, type PasserFlightProbe } from "./decisionPasserFlight";

import { findSettledExchangePlan } from "./decisionSettledExchange";

import {
    confirmSiblingRefutation,
    nominateSiblingRefutation,
    type SiblingRefutationFrames,
} from "./decisionSiblingRefutation";
import {
    confirmCheckingOrder,
    findCheckingOrderChoice,
    nominateCheckingOrder,
    type CheckingOrderEvidence,
    type CheckingOrderProbe,
} from "./decisionCheckingOrder";

import {
    confirmQuietReply,
    nominateQuietReply,
    type QuietReplyEvidence,
    type QuietReplyProbe,
} from "./quietReplyEvidence";

import { availableCaptureOrders, confirmCaptureOrder, type CaptureOrderEvidence, type CaptureOrderProbe } from "./captureOrderEvidence";
import { findPassedPawnRoles } from "./decisionPassedPawnRole";

import { verifyCaptureRouteStructure } from "./decisionCaptureRouteStructure";

const QUIET_REPLY_SCOPE = "The resource applies to this reply. Other defences can change the continuation.";
const CAPTURE_ORDER_SCOPE = "This capture order applies to the reply shown. Other defences can change the continuation.";

export const DECISION_ASSESSMENT_VERSION = 64;
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
    quietReply?: QuietReplyEvidence;
    captureOrder?: CaptureOrderEvidence;
    sharedPassedPawn?: PositionStrategicPlan;
    conditionalFork?: ConditionalForkEvidence;
    conditionalMate?: DecisionConditionalMate;
    matingLines?: ConfirmedMatingLines;
    mateDefence?: ImmediateMateDefence;
    quietMateThreat?: QuietMateThreat;
    promotionTactic?: PositionStrategicPlan;
    passerFlight?: PositionStrategicPlan;
    settledExchangePlan?: PositionStrategicPlan;
    retainedPawnSupport?: PositionStrategicPlan;
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
    history?: TacticalGameHistory;
    candidates: DecisionEngineLine[];
    /** Paired same-search evaluations of the global best root and actual played
     * root. Useful when the human move is outside the global top three. */
    comparisonCandidates?: DecisionEngineLine[];
    replyProbes?: DecisionReplyProbe[];
    positionReply?: DecisionReplyProbe;
    preparedCheckpoint?: DecisionEngineLine[];
    extraPositionChoice?: ExtraPositionChoice;
    siblingRefutation?: SiblingRefutationFrames;
    checkingOrder?: CheckingOrderProbe;
    quietReply?: QuietReplyProbe;
    captureOrder?: CaptureOrderProbe;
    captureRouteReply?: DecisionReplyProbe;
    sharedReply?: DecisionSharedReplyProbe;
    passerFlight?: PasserFlightProbe;
    checkingDefence?: CheckingDefenceProbe;
    passedAdvance?: DecisionEngineLine[];
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
type DecisionMoveAssessment = DecisionAssessment & {
    moveUci: string;
    evaluationCp: number | null;
    depth: number;
};

export type ChessDecisionReport = {
    version: number;
    fen: string;
    position: DecisionAssessment & {
        bestSecondGapCp: number | null;
        examinedChoices: number;
        legalChoices: number;
        rejectedChoices: number;
        tacticalContrast?: TacticalMistakeEpisode;
        checkingOrder?: CheckingOrderEvidence;
        tacticalRecovery?: DecisionTacticalRecovery;
        preparedCheckpointRequest?: { fen: string; prefix: string[] };
        preparedCheckpoint?: { lineUci: string[]; alternativeUci: string[] };
        strategicPlan?: PositionStrategicPlan;
    };
    moves: DecisionMoveAssessment[];
    playedMoveAssessment?: DecisionMoveAssessment;
    mistakeStatus:
        | "not-requested"
        | "best-supplied-choice"
        | "no-meaningful-loss-measured"
        | "comparison-unavailable"
        | "assessed";
    mistake:
        | (DecisionAssessment & {
              evaluationLossCp: number | null;
              mechanisms: TacticalSequenceWitness[];
              missed: TacticalSequenceWitness[];
              allowed: TacticalSequenceWitness[];
              tacticalEpisode?: TacticalMistakeEpisode;
              sharedRay?: TacticalMistakeEpisode;
              mateConsequence?: DecisionMateConsequence;
              promotion?: PromotionMistakeEvidence;
              rookPressure?: RookPressureEvidence;
              tacticalRecovery?: DecisionTacticalRecovery;
              pawnStructure?: PawnStructureEvidence;
              checkingDefenceRequest?: CheckingDefenceRequest;
              checkingOrder?: CheckingOrderEvidence;
              passedAdvanceRequest?: PassedAdvanceRequest;
              passedAdvance?: PassedAdvanceEvidence;
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

function validReplyFrame(
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
    return true;
}

/** Validate a separate search of the opponent's replies. This is engine
 * corroboration at a finite horizon, not exhaustive tactical proof. */
function corroboratingReply(
    fen: string,
    line: DecisionEngineLine,
    probe: DecisionReplyProbe | undefined,
) {
    if (!validReplyFrame(fen, line, probe)) return false;
    const reply = probe!.lines[0];
    // Finite score convergence is a reliability gate, not a motif classifier.
    if (line.mate != null) return line.mate > 0 && reply.mate != null && reply.mate < 0;
    return (
        line.cp !== null &&
        reply.cp !== null &&
        reply.mate == null &&
        Math.abs(line.cp + reply.cp) <= 90
    );
}

/** A near-best reply may expose the actual purpose of the advancing pawn.
 * A witnessed fork in which the same pawn immediately wins a piece cannot
 * establish independent strategic value for keeping these pawns locked. */
function pawnForkBreaksLock(
    fen: string,
    branch: DecisionEngineLine,
    witnesses: TacticalSequenceWitness[],
) {
    const fork = witnesses.find(
        (witness) =>
            witness.mechanism === "fork" && witness.mechanismPly === 1 && witness.payoffPly === 3,
    );
    if (!fork) return false;
    const [root, , payoff] = replayTacticalLine(fen, branch.pvUci.slice(0, 3));
    return Boolean(
        payoff &&
        payoff.move.from === root.move.to &&
        payoff.capture >= 300 &&
        root.before.board.get(root.move.from)?.role === "pawn",
    );
}

function assessMove(input: DecisionAssessmentInput, line: DecisionEngineLine): DecisionAssessment {
    const result = emptyAssessment();
    const measured = measureDecisionLine(input.fen, line);
    if (!measured || measured.drawnEnding) {
        result.limitations.push(
            measured?.drawnEnding && line.claimHistory
                ? "A draw by repetition can be claimed at the end of this line."
                : "The continuation is invalid or reaches an available draw; no later payoff is inferred.",
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
    let factors = comparePositionalTransitions(input.fen, line, input.candidates);
    const corroboratedFactors = corroborated ? corroboratePositionalEffects(input.fen, line, branches[0]) : [];
    for (const item of corroboratedFactors) {
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
    const leadingReplyCp = probe?.lines[0]?.cp;
    if (
        corroborated &&
        leadingReplyCp != null &&
        factors.some((item) => item.feature === "pawn-lock")
    ) {
        // These branches are from the same independent reply search. The
        // projected branch score has the opposite perspective to the reply.
        const tacticalLock = witnessedBranches.some(
            ({ line: branch, measured, witnesses }) =>
                branch.cp !== null &&
                leadingReplyCp + branch.cp >= 0 &&
                leadingReplyCp + branch.cp <= 35 &&
                measured &&
                !measured.drawnEnding &&
                pawnForkBreaksLock(input.fen, branch, witnesses),
        );
        if (tacticalLock) {
            factors = factors.filter((item) => item.feature !== "pawn-lock");
            result.limitations.push(
                "In a close reply, the pawn leaves the lock to take a piece. This line illustrates the pawn's tactical role.",
            );
        }
    }
    result.mechanisms = witnesses;
    result.positionalFactors = factors;
    if (factors.length) {
        result.positional = {
            support: "supported",
            basis: "heuristic",
            reasons: factors.map((item) =>
                item.comparison === "alternative-choice"
                    ? `${item.description} The effect is present in the better line and absent after ${item.comparisonMoveUci} at the same ${item.materialWindowPlies}-ply comparison point.`
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
    const conditionalFork = corroborated
        ? findConditionalFork(input.fen, line, probe!.lines, corroboratedFactors)
        : null;
    if (conditionalFork) result.conditionalFork = conditionalFork;
    if (conditionalFork?.defenceConsequence) {
        result.tactical = {
            support: "supported",
            basis: "engine-supported",
            reasons: [
                conditionalFork.defenceConsequence.description,
                ...result.tactical.reasons.filter((reason) => !reason.startsWith("No relevant")),
            ],
        };
    }
    if (corroborated && result.tactical.support !== "supported") {
        const recovery = findRecoveringFork(input.fen, line, branches[0]);
        if (recovery) {
            result.mechanisms = mergeTacticalSequenceWitnesses([...result.mechanisms, recovery]);
            result.tactical = {
                support: "supported",
                basis: "engine-supported",
                reasons: [recovery.description],
            };
            result.limitations.push(
                "Both searches show the recovery after the same capture. Other replies may lead to different exchanges.",
            );
        } else {
            const mate = findConditionalMate(input.fen, line, probe!.lines);
            if (mate) {
                result.conditionalMate = mate;
                result.tactical = {
                    support: "supported",
                    basis: "bounded-proof",
                    reasons: [mate.explanation],
                };
            }
        }
    }
    if (corroborated && result.tactical.support !== "supported") {
        const capture = explainFleetingCapture(input.fen, line, input.candidates, branches[0]);
        if (capture) {
            result.tactical = { support: "supported", basis: "engine-supported", reasons: [capture] };
            result.limitations.push("The material gain and the escape are shown in the compared engine lines.");
        }
    }
    if (corroborated && result.tactical.support !== "supported") {
        const promotion = findPromotionTradeAfterAdvance(input.fen, line, probe!.lines);
        if (promotion) {
            result.promotionTactic = promotion;
            result.tactical = {
                support: "supported",
                basis: "engine-supported",
                reasons: [promotion.description],
            };
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
    const matingLines =
        line.mate != null && (corroborated || validReplyFrame(input.fen, line, probe))
            ? corroborateMatingLines(input.fen, line, probe?.lines[0])
            : null;
    if (measured.checkmate && measured.plies === 1) {
        result.tactical = {
            support: "supported",
            basis: "bounded-proof",
            reasons: ["The first move legally checkmates. There is no legal reply."],
        };
    } else if (matingLines) {
        result.matingLines = matingLines;
        const winner = matingLines.winner === "white" ? "White" : "Black";
        result.tactical = {
            support: "supported",
            basis: "engine-supported",
            reasons: [
                `Stockfish finds mate in ${matingLines.mateIn} for ${winner}. Both searches reach legal checkmate.`,
                ...result.tactical.reasons.filter((reason) => !reason.startsWith("No relevant")),
            ],
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
    if (corroborated) {
        const captureEffects = new Map<ComparativePositionalEvidence, string>();
        const routes = corroborateDecisionLineRoutes(input.fen, line, probe!.lines[0], input.history)
            .filter(
                (route) => result.tactical.support !== "supported" ||
                    (!result.mechanisms.some(item => item.mechanism === route.mechanism && item.rootMoveInvolved) &&
                     !result.verifiedMotifs.some(item => item.id === route.mechanism)),
            );
        if (routes.length) {
            result.mechanisms = mergeTacticalSequenceWitnesses([
                ...result.mechanisms.filter(
                    item => !routes.some(route => route.mechanism === item.mechanism && route.mechanismPly === item.mechanismPly),
                ),
                ...routes,
            ]);
            if (result.tactical.support !== "supported") {
                result.tactical = {
                    support: "supported",
                    basis: "engine-supported",
                    reasons: routes.map(route => route.description),
                };
            }
            result.limitations.push("These mechanisms apply to the shown defence. Other replies can change the route or payoff.");

            for (const factor of result.positionalFactors) {
                if (isStructuralEffectFromTacticalCapture(input.fen, line.pvUci[0], factor))
                    captureEffects.set(
                        factor,
                        `${factor.description} Its strategic importance alongside the material gain remains uncertain.`,
                    );
            }
        }
        if (result.tactical.support === "supported") {
            for (const { factor, tacticalGain, separatelyUsed, captureSan } of findCaptureEffectDependencies(
                input.fen,
                line,
                branches[0],
                result.positionalFactors,
            )) {
                if (tacticalGain && !separatelyUsed && !captureEffects.has(factor))
                    captureEffects.set(
                        factor,
                        `${factor.description} Its separate strategic value alongside ${captureSan} is uncertain.`,
                    );
            }
        }
        if (captureEffects.size) {
            const reasons = result.positional.reasons.filter(
                (_, index) => !captureEffects.has(result.positionalFactors[index]),
            );
            result.positionalFactors = result.positionalFactors.filter((factor) => !captureEffects.has(factor));
            result.positional = reasons.length
                ? { ...result.positional, reasons }
                : {
                      support: "suggestive",
                      basis: "insufficient",
                      reasons: ["The capture changes the position. Its separate strategic impact is uncertain."],
                  };
            result.limitations.push(...captureEffects.values());
        }
    }
    const leader = input.candidates[0];
    if (
        corroborated &&
        result.positional.support !== "supported" &&
        leader.cp !== null && line.cp !== null &&
        line.depth === leader.depth && leader.cp - line.cp <= 50
    ) {
        const plan = findSettledExchangePlan(input.fen, line, probe!.lines[0]);
        if (plan) {
            result.settledExchangePlan = plan;
            result.positional = {
                support: "supported",
                basis: "heuristic",
                reasons: [plan.description],
            };
            result.limitations.push(
                "The searches show how this plan develops after the exchange. Its share of the engine evaluation is uncertain.",
            );
        }
    }
    const quietReply = input.quietReply;
    if (corroborated && result.tactical.support !== "supported" && quietReply?.rootMoveUci === line.pvUci[0]) {
        const request = nominateQuietReply(input.fen, line, quietReply.replies, input.history);
        const proof = request && confirmQuietReply(request, quietReply.answers, input.history);
        if (proof) {
            result.quietReply = proof;
            result.tactical = { support: "supported", basis: "engine-supported", reasons: [proof.explanation] };
            result.limitations.push(QUIET_REPLY_SCOPE);
        }
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
    const moves = input.candidates.map((line) => {
        const assessment = assessMove(input, line);
        if (assessment.tactical.support !== "supported") {
            const probe = input.replyProbes?.find(
                (item) => item.moveUci === line.pvUci[0],
            );
            if (probe && validReplyFrame(input.fen, line, probe)) {
                const threat =
                    findQuietMateThreat(input.fen, line, probe.lines) ??
                    findQuietMateInTwoThreat(input.fen, line, probe.lines, input.history);
                if (threat) {
                    assessment.quietMateThreat = threat;
                    assessment.tactical = {
                        support: "supported",
                        basis: "bounded-proof",
                        reasons: [threat.explanation],
                    };
                    assessment.category = category(assessment.tactical, assessment.positional);
                }
            }
        }
        const captureOrder = input.captureOrder;
        if (captureOrder?.moveUci === line.pvUci[0] && assessment.tactical.support !== "supported") {
            const choices = availableCaptureOrders(input, new Set([captureOrder.moveUci]));
            for (const choice of choices) {
                if (choice.reply.uci !== captureOrder.replyUci) continue;
                const proof = confirmCaptureOrder(choice, captureOrder.lines, input.history);
                if (!proof) continue;
                assessment.captureOrder = proof;
                assessment.tactical = { support: "supported", basis: "engine-supported", reasons: [proof.explanation] };
                assessment.category = category(assessment.tactical, assessment.positional);
                assessment.limitations.push(CAPTURE_ORDER_SCOPE);
                break;
            }
        }
        return { ...assessment, moveUci: line.pvUci[0], evaluationCp: line.cp, depth: line.depth };
    });
    const first = input.candidates[0];
    const position: ChessDecisionReport["position"] = {
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
    const tactical = viable.find(
        (move) =>
            move.tactical.support === "supported" &&
            (move.matingLines ||
                move.promotionTactic ||
                move.tactical.basis === "bounded-proof" ||
                move.conditionalResources.length > 0 ||
                move.quietReply ||
                move.captureOrder ||
                move.mechanisms.length === 0 ||
                move.mechanisms.some(
                    (witness) =>
                        witness.mechanism !== "tacticalPreparation" || witness.payoffPly <= 5,
                )),
    );
    if (tactical) position.tactical = tactical.tactical;
    position.mechanisms = tactical?.mechanisms ?? [];
    position.verifiedMotifs = tactical?.verifiedMotifs ?? [];
    position.localProofs = tactical?.localProofs ?? [];
    position.episodeOutcomes = tactical?.episodeOutcomes ?? [];
    position.conditionalResources = tactical?.conditionalResources ?? [];
    if (tactical?.quietReply) position.quietReply = tactical.quietReply;
    if (tactical?.captureOrder) position.captureOrder = tactical.captureOrder;
    if (tactical?.conditionalFork) position.conditionalFork = tactical.conditionalFork;
    if (tactical?.conditionalMate) position.conditionalMate = tactical.conditionalMate;
    if (tactical?.matingLines) position.matingLines = tactical.matingLines;
    if (tactical?.quietMateThreat) position.quietMateThreat = tactical.quietMateThreat;
    if (tactical?.promotionTactic) position.promotionTactic = tactical.promotionTactic;
    for (const move of viable) {
        const line = input.candidates.find((item) => item.pvUci[0] === move.moveUci)!;
        const qualified = qualifyPositionFactors(
            input.fen,
            line,
            move.positionalFactors,
            input.candidates,
        );
        if (!qualified.length) continue;
        position.positional = {
            ...move.positional,
            reasons: qualified.map(({ factor, continuationEvidence }) =>
                [
                    move.positional.reasons[move.positionalFactors.indexOf(factor)],
                    continuationEvidence,
                ]
                    .filter(Boolean)
                    .join(" "),
            ),
        };
        position.positionalFactors = qualified.map(({ factor }) => factor);
        break;
    }
    if (position.positional.support === "unestablished" && !rejectedChoices) {
        const plan =
            findPositionStrategicPlan(input.fen, input.candidates) ??
            findKingShelterTradeoff(input.fen, input.candidates) ??
            findSharedStructuralPlan(input.fen, input.candidates);
        if (plan) {
            position.strategicPlan = plan;
            position.positional = {
                support: "supported",
                basis: "heuristic",
                reasons: [plan.description],
            };
        }
    }
    const nomination =
        rejectedChoices === 0 && (input.positionReply || input.replyProbes?.length)
            ? nominatePositionRefutation(input.fen, input.candidates)
            : null;
    if (nomination) {
        const probe =
            input.positionReply?.moveUci === nomination.moveUci
                ? input.positionReply
                : input.replyProbes?.find((item) => item.moveUci === nomination.moveUci);
        if (corroboratingReply(input.fen, nomination.alternative, probe)) {
            const contrast = confirmPositionRefutation(input.fen, nomination, probe!.lines[0]);
            if (contrast) {
                const [alternative] = replayTacticalLine(input.fen, [nomination.moveUci]);
                position.tacticalContrast = contrast;
                if (!tactical)
                    position.tactical = {
                        support: "supported",
                        basis: "engine-supported",
                        reasons: [
                            `${alternative.san}, one of the engine's leading alternatives, allows a tactical reply. ${contrast.explanation}`,
                        ],
                    };
                position.mechanisms = mergeTacticalSequenceWitnesses([
                    ...position.mechanisms,
                    ...contrast.mechanisms,
                ]);
            }
        }
    }
    if (!position.tacticalContrast && !rejectedChoices && input.extraPositionChoice) {
        const contrast = confirmExtraPositionChoice(
            input.fen,
            input.candidates,
            input.extraPositionChoice,
        );
        if (contrast) {
            const [alternative] = replayTacticalLine(input.fen, contrast.playedLineUci.slice(0, 1));
            position.tacticalContrast = contrast;
            position.examinedChoices++;
            if (!tactical)
                position.tactical = {
                    support: "supported",
                    basis: "engine-supported",
                    reasons: [
                        `After ${alternative.san}, the opponent has a tactical reply. ${contrast.explanation}`,
                    ],
                };
            position.mechanisms = mergeTacticalSequenceWitnesses([
                ...position.mechanisms,
                ...contrast.mechanisms,
            ]);
        }
    }
    if (
        !rejectedChoices &&
        (position.tactical.support !== "supported" || position.positional.support !== "supported")
    ) {
        const promotion = findPromotionPressure(
            input.fen,
            input.candidates,
            position.tactical.support !== "supported",
        );
        if (promotion.positional && position.positional.support === "unestablished") {
            position.strategicPlan = promotion.positional;
            position.positional = {
                support: "supported",
                basis: "heuristic",
                reasons: [promotion.positional.description],
            };
        }
        if (promotion.tactical) {
            position.promotionTactic = promotion.tactical;
            position.tactical = {
                support: "supported",
                basis: "engine-supported",
                reasons: [promotion.tactical.description],
            };
        }
    }
    if (
        !rejectedChoices &&
        position.tactical.support !== "supported" &&
        moves[0].tactical.support === "supported"
    ) {
        const replies = input.replyProbes?.find((probe) => probe.moveUci === first.pvUci[0]);
        const preparation = nominatePreparedCheckpoint(input.fen, first, replies?.lines ?? []);
        if (preparation && input.preparedCheckpoint === undefined)
            position.preparedCheckpointRequest = { fen: preparation.fen, prefix: preparation.prefix };
        if (preparation && input.preparedCheckpoint) {
            const proof = confirmPreparedCheckpoint(preparation, input.preparedCheckpoint);
            if (proof) {
                position.preparedCheckpoint = {
                    lineUci: proof.witness.lineUci,
                    alternativeUci: proof.alternativeUci,
                };
                position.mechanisms = mergeTacticalSequenceWitnesses([
                    ...position.mechanisms,
                    proof.witness,
                ]);
                position.tactical = {
                    support: "supported",
                    basis: "engine-supported",
                    reasons: [proof.description],
                };
            }
        }
    }
    if (
        position.tactical.support !== "supported" ||
        moves[0].tactical.support !== "supported"
    ) {
        const mateDefence = findImmediateMateDefence(input.fen, input.candidates);
        if (mateDefence) {
            const tacticalEvidence: DecisionDimension = {
                support: "supported",
                basis: "bounded-proof",
                reasons: [mateDefence.description],
            };
            if (position.tactical.support !== "supported") {
                position.mateDefence = mateDefence;
                position.tactical = tacticalEvidence;
            }
            const leader = moves[0];
            if (leader.tactical.support !== "supported") {
                leader.mateDefence = mateDefence;
                leader.tactical = tacticalEvidence;
                leader.category = category(leader.tactical, leader.positional);
            }
        }
    }
    if (!rejectedChoices && position.tactical.support !== "supported") {
        const [better, alternative] = input.candidates;
        if (alternative) {
            const probeFor = (line: DecisionEngineLine) =>
                input.positionReply?.moveUci === line.pvUci[0]
                    ? input.positionReply
                    : input.replyProbes?.find((probe) => probe.moveUci === line.pvUci[0]);
            const betterReply = corroborateRecoveryReply(better, probeFor(better)?.lines ?? []);
            const alternativeReply = probeFor(alternative)?.lines[0];
            const recovery = betterReply && alternativeReply
                ? compareTacticalRecovery(input.fen, better, alternative, betterReply, alternativeReply)
                : null;
            if (recovery) {
                position.tacticalRecovery = recovery;
                position.tactical = {
                    support: "supported",
                    basis: "engine-supported",
                    reasons: [recovery.explanation],
                };
            }
        }
    }
    if (!rejectedChoices && position.tactical.support !== "supported" && input.siblingRefutation) {
        const request = nominateSiblingRefutation(input.fen, input.candidates);
        const proof = request && confirmSiblingRefutation(
            input.fen, request, input.siblingRefutation, input.history,
        );
        if (proof) {
            position.tacticalContrast = proof;
            position.tactical = {
                support: "supported",
                basis: "engine-supported",
                reasons: [proof.explanation],
            };
        }
    }
    if (!rejectedChoices && position.tactical.support !== "supported" && input.checkingOrder?.scope === "position") {
        const request = findCheckingOrderChoice(input.fen, input.candidates);
        const proof = request && confirmCheckingOrder(input.fen, request, input.checkingOrder.lines, input.history, input.checkingOrder.control);
        if (proof) {
            position.checkingOrder = proof;
            position.tactical = {
                support: "supported",
                basis: "engine-supported",
                reasons: [proof.explanation],
            };
        }
    }
    position.category = category(position.tactical, position.positional);
    position.limitations = [
        "The position assessment covers the candidate moves and replies examined in this search.",
        ...(position.quietReply ? [QUIET_REPLY_SCOPE] : []),
        ...(position.captureOrder ? [CAPTURE_ORDER_SCOPE] : []),
        ...(rejectedChoices
            ? [
                  `${rejectedChoices} alternative continuation(s) could not be validated. Their scores and motifs were not used; the gap between choices is unavailable.`,
              ]
            : []),
    ];

    let comparedPlayedAssessment: DecisionAssessment | undefined;
    let mistake: ChessDecisionReport["mistake"] = null;
    let mistakeStatus: ChessDecisionReport["mistakeStatus"] = input.playedMoveUci
        ? "comparison-unavailable"
        : "not-requested";
    let comparison = input.comparisonCandidates ?? originalCandidates;
    let comparisonMeasured = measurePositionDecision(input.fen, comparison);
    if (input.comparisonCandidates && comparisonMeasured?.lines.length !== comparison.length) {
        const bounded = comparison.map((line) => endPairedLineAtDeadDraw(input.fen, line));
        if (bounded.some((line, index) => line !== comparison[index])) {
            comparison = bounded;
            comparisonMeasured = measurePositionDecision(input.fen, comparison);
        }
    }
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
    const passerRequest =
        input.passerFlight && playedIndex > 0 && comparedBest?.pvUci[0] === first.pvUci[0]
            ? nominatePasserFlight(
                  input.fen,
                  comparedBest,
                  comparison[playedIndex],
                  input.replyProbes?.find((probe) => probe.moveUci === comparison[playedIndex].pvUci[0])?.lines ?? [],
                  input.history,
              )
            : null;
    const passerFlight = passerRequest && input.passerFlight
        ? confirmPasserFlight(passerRequest, input.passerFlight)
        : null;
    const mateHint = input.replyProbes?.find(
        (probe) => probe.moveUci === input.playedMoveUci,
    )?.lines[0]?.pvUci[0];
    let mateConsequence =
        findAllowedImmediateMate(input.fen, first, input.playedMoveUci, input.history) ??
        findAllowedMateInTwo(input.fen, first, input.playedMoveUci, input.history, mateHint);
    if (
        !mateConsequence &&
        playedIndex > 0 &&
        comparisonMeasured?.lines.length === comparison.length &&
        comparedBest.pvUci[0] === first.pvUci[0]
    ) {
        const played = comparison[playedIndex];
        const replyFor = (choice: DecisionEngineLine) =>
            input.replyProbes?.find((probe) => probe.moveUci === choice.pvUci[0])?.lines[0];
        mateConsequence = compareMateConsequence(
            input.fen,
            comparedBest,
            played,
            replyFor(comparedBest),
            replyFor(played),
        );
    }
    if (!mateConsequence)
        mateConsequence = findAllowedMateInThree(
            input.fen,
            first,
            input.playedMoveUci,
            comparison,
            input.replyProbes?.find((probe) => probe.moveUci === input.playedMoveUci)?.lines ?? [],
            input.history,
        );
    if (mateConsequence) {
        mistakeStatus = "assessed";
        mistake = {
            ...emptyAssessment(),
            category: "tactical",
            tactical: {
                support: "supported",
                basis:
                    mateConsequence.mateIn === 1 || mateConsequence.proof === "legal"
                        ? "bounded-proof"
                        : "engine-supported",
                reasons: [mateConsequence.explanation],
            },
            evaluationLossCp: null,
            missed: [],
            allowed: [],
            mateConsequence,
            limitations: [
                mateConsequence.avoidingMoveUci
                    ? `This checks mate within ${mateConsequence.mateIn} opposing ${mateConsequence.mateIn === 1 ? "move" : "moves"}.`
                    : "This is a measured mating consequence in the supplied search.",
            ],
        };
    }
    if (
        !mateConsequence &&
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
            const comparisonInput = { ...input, candidates: comparison, quietReply: undefined };
            const bestAssessment = assessMove(comparisonInput, comparedBest);
            const playedAssessment = assessMove(comparisonInput, playedLine);
            comparedPlayedAssessment = playedAssessment;
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
                                  w.rootMoveInvolved &&
                                  w.lineUci.every(
                                      (uci, index) => comparedBest.pvUci[index] === uci,
                                  ) &&
                                  !playedAssessment.mechanisms.some((other) =>
                                      sameTacticalMechanism(w, other),
                                  ),
                          )
                    : [];
            let allowed: TacticalSequenceWitness[] = [];
            let tacticalEpisode: TacticalMistakeEpisode | null = null;
            const playedProbe = input.replyProbes?.find(
                (item) => item.moveUci === playedLine.pvUci[0],
            );
            const betterProbe = input.replyProbes?.find(
                (item) => item.moveUci === comparedBest.pvUci[0],
            );
            const playedCorroborated = corroboratingReply(input.fen, playedLine, playedProbe);
            const betterCorroborated = corroboratingReply(input.fen, comparedBest, betterProbe);
            const corroboratedChoices = playedCorroborated && betterCorroborated;
            if (playedCorroborated) {
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
                const betterReply = {
                    ...comparedBest,
                    fen: bestReplyFen,
                    cp: comparedBest.cp === null ? null : -comparedBest.cp,
                    mate: comparedBest.mate == null ? null : -comparedBest.mate,
                    pvUci: comparedBest.pvUci.slice(1),
                };
                const betterReplyWitnesses = extractTacticalSequenceWitnesses(
                    bestReplyFen,
                    betterReply,
                );
                tacticalEpisode = compareTacticalMistakeEpisode(
                    input.fen,
                    comparedBest,
                    playedLine,
                    opponent,
                    betterReply,
                );
                if (
                    playedBranch &&
                    settled(bestMeasured) &&
                    settled(playedBranch) &&
                    bestMeasured.materialChangeCp - playedBranch.materialChangeCp >= 90
                ) {
                    allowed = extractTacticalSequenceWitnesses(opponent.fen, opponent).filter(
                        (w) =>
                            w.rootMoveInvolved &&
                            !betterReplyWitnesses.some(
                                (other) => other.rootMoveInvolved && sameTacticalMechanism(w, other),
                            ),
                    );
                }
                if (!tacticalEpisode && !missed.length && !allowed.length)
                    tacticalEpisode =
                        compareExposedForcingAttack(
                            input.fen,
                            comparedBest,
                            playedLine,
                            playedProbe!.lines,
                        ) ??
                        compareSharedReply(
                            input.fen,
                            comparedBest,
                            playedLine,
                            opponent,
                            input.sharedReply,
                        );
                if (tacticalEpisode?.kind !== "trap" && betterCorroborated)
                    tacticalEpisode =
                        compareExposedPieceTrap(
                            input.fen,
                            comparedBest,
                            playedLine,
                            opponent,
                            betterProbe!.lines[0],
                        ) ?? tacticalEpisode;
            }
            const assessment = emptyAssessment();
            const promotion =
                playedLine.pvUci
                    .slice(1, 8)
                    .some((uci, index) => index % 2 === 0 && uci.length === 5) &&
                validReplyFrame(input.fen, comparedBest, betterProbe) &&
                validReplyFrame(input.fen, playedLine, playedProbe)
                    ? comparePromotionMistake(
                          input.fen,
                          comparedBest,
                          playedLine,
                          betterProbe!.lines[0],
                          playedProbe!.lines[0],
                      )
                    : null;
            if (missed.length || allowed.length || tacticalEpisode || promotion)
                assessment.tactical = {
                    support: "supported",
                    basis: tacticalEpisode?.kind === "trap" ? "bounded-proof" : "engine-supported",
                    reasons: [
                        ...(promotion ? [promotion.tactical] : []),
                        ...missed.map((item) => {
                            const otherFork = item.mechanism === "fork" && playedAssessment.mechanisms.find(
                                (other) => other.mechanism === "fork" && other.rootMoveInvolved &&
                                    other.actor === item.actor && other.mechanismPly === item.mechanismPly,
                            );
                            return otherFork
                                ? `The two choices use different forks in the analysed lines. ${item.description} ${otherFork.description} The stronger line retains more material over the compared moves.`
                                : `The better choice uses ${item.mechanism}. The played continuation retains less material in the analysed horizon. ${item.description}`;
                        }),
                        ...allowed.map(
                            (item) =>
                                `The opponent can use ${item.mechanism} after the played move. This mechanism is absent from the compared better line, which retains more material. ${item.description}`,
                        ),
                        ...(tacticalEpisode
                            ? [
                                  tacticalEpisode.kind === "comparative"
                                      ? `${tacticalEpisode.explanation} The played line retains ${tacticalEpisode.materialDifferencePoints.toFixed(1)} fewer material points after ${tacticalEpisode.throughPly} plies of both compared lines.`
                                      : tacticalEpisode.kind === "concession"
                                        ? `${tacticalEpisode.explanation} Both searches show a net loss of ${tacticalEpisode.materialConcededPoints.toFixed(1)} material points after ${tacticalEpisode.throughPly} plies of the played line.`
                                        : tacticalEpisode.explanation,
                              ]
                            : []),
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
            const recoveryReply = corroborateRecoveryReply(comparedBest, betterProbe?.lines ?? []);
            const recovery =
                assessment.tactical.support !== "supported" && recoveryReply && playedProbe?.lines[0]
                    ? compareTacticalRecovery(
                          input.fen,
                          comparedBest,
                          playedLine,
                          recoveryReply,
                          playedProbe.lines[0],
                      )
                    : null;
            if (recovery)
                assessment.tactical = {
                    support: "supported",
                    basis: "engine-supported",
                    reasons: [recovery.explanation],
                };
            if (assessment.tactical.support !== "supported" && corroboratedChoices) {
                const opened = compareOpenedCheckingAttack(
                    input.fen,
                    comparedBest,
                    playedLine,
                    betterProbe!.lines[0],
                    playedProbe!.lines[0],
                    input.history,
                );
                if (opened) {
                    tacticalEpisode = opened;
                    assessment.tactical = {
                        support: "supported",
                        basis: "engine-supported",
                        reasons: [opened.explanation],
                    };
                }
            }
            let checkingDefenceRequest: CheckingDefenceRequest | null = null;
            let checkedDefence: ReturnType<typeof confirmCheckingDefence> = null;
            if (corroboratedChoices && assessment.tactical.support !== "supported") {
                const frames = [input.fen, comparedBest, playedLine, betterProbe!.lines[0], playedProbe!.lines[0]] as const;
                if (input.checkingDefence) {
                    checkedDefence = confirmCheckingDefence(...frames, input.checkingDefence, input.history);
                    if (checkedDefence) {
                        tacticalEpisode = checkedDefence.episode;
                        assessment.tactical = {
                            support: "supported",
                            basis: "engine-supported",
                            reasons: [tacticalEpisode.explanation],
                        };
                    }
                } else {
                    checkingDefenceRequest = nominateCheckingDefence(...frames, input.history);
                }
            }
            // Compare this particular played choice, not a different alternative.
            const factors = comparePositionalTransitions(input.fen, comparedBest, [playedLine]);
            const lostOutpost = compareLostOutpost(input.fen, comparedBest, playedLine);
            if (
                lostOutpost &&
                !factors.some(
                    (item) =>
                        item.feature === lostOutpost.feature &&
                        item.squareOrFile === lostOutpost.squareOrFile,
                )
            )
                factors.push(lostOutpost);
            const pawnEpisodes =
                validReplyFrame(input.fen, comparedBest, betterProbe) &&
                validReplyFrame(input.fen, playedLine, playedProbe)
                    ? comparePawnEpisodes(
                          input.fen,
                          comparedBest,
                          playedLine,
                          betterProbe!.lines[0],
                          playedProbe!.lines[0],
                      ).filter(
                          (item) =>
                              !factors.some(
                                  (other) =>
                                      item.feature === other.feature &&
                                      item.side === other.side &&
                                      item.squareOrFile === other.squareOrFile,
                              ),
                      )
                    : [];
            if (assessment.tactical.support !== "supported" && corroboratedChoices) {
                const interception = comparePawnInterception(
                    input.fen,
                    comparedBest,
                    playedLine,
                    betterProbe!.lines[0],
                    playedProbe!.lines[0],
                    input.history,
                );
                if (interception) {
                    tacticalEpisode = interception;
                    assessment.tactical = {
                        support: "supported",
                        basis: "engine-supported",
                        reasons: [interception.explanation],
                    };
                }
            }
            const shelter = corroboratedChoices
                ? compareLostKingShelter(
                      input.fen,
                      comparedBest,
                      playedLine,
                      betterProbe!.lines[0],
                      playedProbe!.lines[0],
                  )
                : null;
            const rookPressure = corroboratedChoices
                ? compareRookPressure(
                      input.fen,
                      comparedBest,
                      playedLine,
                      betterProbe!.lines[0],
                      playedProbe!.lines[0],
                  )
                : null;
            const pawnStructure = corroboratedChoices
                ? comparePawnStructure(
                      input.fen,
                      comparedBest,
                      playedLine,
                      betterProbe!.lines[0],
                      playedProbe!.lines[0],
                  )
                : null;
            if (
                factors.length ||
                pawnEpisodes.length ||
                shelter ||
                promotion?.positional ||
                rookPressure ||
                pawnStructure
            ) {
                assessment.positional = {
                    support: "supported",
                    basis: "heuristic",
                    reasons: [
                        ...(promotion?.positional ? [promotion.positional] : []),
                        ...factors.map(
                            (item) =>
                                `${item.description} The feature is absent from the played line in the compared window.`,
                        ),
                        ...pawnEpisodes.map((item) => item.description),
                        ...(shelter ? [shelter.description] : []),
                        ...(rookPressure ? [rookPressure.factor.description] : []),
                        ...(pawnStructure ? [pawnStructure.factor.description] : []),
                    ],
                };
                assessment.positionalFactors = [
                    ...factors,
                    ...pawnEpisodes,
                    ...(shelter ? [shelter] : []),
                    ...(rookPressure ? [rookPressure.factor] : []),
                    ...(pawnStructure ? [pawnStructure.factor] : []),
                ];
            }
            let passedAdvance: PassedAdvanceEvidence | null = null;
            let passedAdvanceRequest: PassedAdvanceRequest | null = null;
            if (checkedDefence?.pawnRequest && assessment.positional.support !== "supported") {
                if (input.passedAdvance) {
                    passedAdvance = confirmPassedAdvance(
                        input.fen, comparedBest, playedLine, checkedDefence.pawnRequest,
                        input.passedAdvance, input.history,
                    );
                    if (passedAdvance) {
                        assessment.positional = {
                            support: "supported",
                            basis: "heuristic",
                            reasons: [passedAdvance.factor.description],
                        };
                        assessment.positionalFactors.push(passedAdvance.factor);
                    }
                } else {
                    passedAdvanceRequest = checkedDefence.pawnRequest;
                }
            }
            if (
                corroboratedChoices &&
                !checkingDefenceRequest &&
                assessment.tactical.support !== "supported"
            ) {
                const contrast = compareAllowedDecisionRoutes(
                    input.fen,
                    comparedBest,
                    playedLine,
                    betterProbe!.lines[0],
                    playedProbe!.lines[0],
                    input.history,
                );
                if (contrast) {
                    tacticalEpisode = contrast;
                    assessment.tactical = {
                        support: "supported",
                        basis: "engine-supported",
                        reasons: [
                            contrast.explanation,
                            ...(contrast.kind === "comparative"
                                ? [`The played continuation gives up at least ${contrast.materialDifferencePoints} more material points over the compared moves.`]
                                : []),
                        ],
                    };
                }
            }
            if (passerFlight && assessment.tactical.support !== "supported") {
                tacticalEpisode = passerFlight.episode;
                assessment.tactical = {
                    support: "supported",
                    basis: "engine-supported",
                    reasons: [tacticalEpisode.explanation],
                };
            }
            let checkingOrder: CheckingOrderEvidence | null = null;
            if (input.checkingOrder?.scope === "mistake") {
                const request = nominateCheckingOrder(input.fen, comparedBest, playedLine);
                checkingOrder = request && confirmCheckingOrder(input.fen, request, input.checkingOrder.lines, input.history, input.checkingOrder.control);
                if (checkingOrder && assessment.tactical.support !== "supported") {
                    assessment.tactical = {
                        support: "supported",
                        basis: "engine-supported",
                        reasons: [checkingOrder.explanation],
                    };
                }
            }
            // The comparison should not preempt a separate tactical or positional proof.
            const sharedRay =
                playedCorroborated &&
                (assessment.tactical.support !== "supported" || assessment.tactical.basis === "engine-supported")
                    ? compareSharedRay(input.fen, comparedBest, playedLine, playedProbe!.lines[0], input.sharedReply)
                    : null;
            if (sharedRay)
                assessment.tactical = {
                    support: "supported",
                    basis: "engine-supported",
                    reasons: [
                        sharedRay.explanation,
                        ...(assessment.tactical.support === "supported" ? assessment.tactical.reasons : []),
                    ],
                };
            assessment.category = category(assessment.tactical, assessment.positional);
            assessment.limitations = [
                "This compares objective consequences. It cannot establish what the player saw or misunderstood.",
                "The compared branches and finite search depth limit the attribution. A delayed strategic collapse can remain unresolved.",
            ];
            if (tacticalEpisode)
                allowed = mergeTacticalSequenceWitnesses([
                    ...allowed,
                    ...tacticalEpisode.mechanisms,
                ]);
            mistake = {
                ...assessment,
                evaluationLossCp: loss,
                ...(sharedRay ? { sharedRay } : {}),
                mechanisms: [...allowed, ...missed],
                missed,
                allowed,
                ...(tacticalEpisode ? { tacticalEpisode } : {}),
                ...(checkingOrder ? { checkingOrder } : {}),
                ...(promotion ? { promotion } : {}),
                ...(rookPressure ? { rookPressure } : {}),
                ...(pawnStructure ? { pawnStructure } : {}),
                ...(checkingDefenceRequest ? { checkingDefenceRequest } : {}),
                ...(passedAdvanceRequest ? { passedAdvanceRequest } : {}),
                ...(passedAdvance ? { passedAdvance } : {}),
                ...(recovery ? { tacticalRecovery: recovery } : {}),
            };
        }
    }
    // A conditional promotion explains this candidate. The position and
    // played mistake were assessed on their own evidence above.
    const leader = moves[0];
    if (
        !leader.promotionTactic &&
        (leader.tactical.support !== "supported" || leader.positional.support !== "supported") &&
        comparedBest?.pvUci[0] === first.pvUci[0] &&
        comparisonMeasured?.lines.length === comparison.length
    ) {
        const reply = input.replyProbes?.find((probe) => probe.moveUci === leader.moveUci)?.lines[0];
        for (const alternative of comparison.slice(1)) {
            const evidence = comparePromotionCheckTempo(
                input.fen, comparedBest, alternative, reply, input.history,
            );
            if (!evidence?.sameContinuation) continue;
            leader.promotionTactic = evidence.tactic;
            if (leader.tactical.support !== "supported") {
                leader.tactical = {
                    support: "supported",
                    basis: "engine-supported",
                    reasons: [evidence.tactic.description],
                };
            }
            if (leader.positional.support !== "supported") {
                leader.positional = {
                    support: "supported",
                    basis: "heuristic",
                    reasons: [evidence.pawnPlan],
                };
            }
            leader.category = category(leader.tactical, leader.positional);
            leader.limitations.push("This is a comparison after the shown reply. Other defences can change the route to promotion.");
            break;
        }
    }
    if (passerFlight) {
        const episode = passerFlight.episode;
        leader.passerFlight = {
            description: episode.explanation,
            linesUci: [episode.betterLineUci, episode.playedLineUci],
        };
        if (leader.tactical.support !== "supported") {
            leader.tactical = {
                support: "supported",
                basis: "engine-supported",
                reasons: [episode.explanation],
            };
        }
        if (passerFlight.rookPlan && leader.positional.support !== "supported") {
            leader.positional = {
                support: "supported",
                basis: "heuristic",
                reasons: [passerFlight.rookPlan],
            };
        }
        leader.category = category(leader.tactical, leader.positional);
        leader.limitations.push("These lines compare the same pawn push. Other replies may require a different defence.");
    }
    // The pawn's strategic role can be shared by several plausible moves.
    // Add it only after the played mistake has been assessed on its own evidence.
    if (!rejectedChoices && (position.positional.support !== "supported" ||
        moves.some(move => move.positional.support !== "supported"))) {
        const plans = findPassedPawnRoles(input);
        const support = (assessment: DecisionAssessment, plan: PositionStrategicPlan | undefined) => {
            if (!plan || assessment.positional.support === "supported") return;
            assessment.sharedPassedPawn = plan;
            assessment.positional = {
                support: "supported",
                basis: "heuristic",
                reasons: [plan.description],
            };
            assessment.category = category(assessment.tactical, assessment.positional);
        };
        support(position, plans.position);
        for (const move of moves) support(move, plans.moves.get(move.moveUci));
    }
    let playedMoveAssessment: DecisionMoveAssessment | undefined;
    if (!rejectedChoices && leader.tactical.support === "supported" &&
        leader.positional.support !== "supported") {
        const plan = verifyCaptureRouteStructure(input.fen, validCandidates, input.replyProbes ?? [], input.captureRouteReply);
        if (plan) {
            const attach = (assessment: DecisionAssessment) => {
                assessment.retainedPawnSupport = plan;
                assessment.positional = { support: "supported", basis: "heuristic", reasons: [plan.description] };
                assessment.category = category(assessment.tactical, assessment.positional);
                assessment.limitations.push("The pawn link survives in the shown lines. Other replies can change the structure.");
            };
            attach(leader);
            if (position.positional.support !== "supported") attach(position);
        }
    }
    if (
        playedIndex > 0 &&
        playedBoard &&
        comparedBest.pvUci[0] === first.pvUci[0] &&
        comparisonMeasured?.lines.length === comparison.length &&
        !moves.some(move => afterChoice(move.moveUci) === playedBoard)
    ) {
        const line = comparison[playedIndex];
        const assessment = comparedPlayedAssessment ?? assessMove(
            { ...input, candidates: comparison, quietReply: undefined }, line,
        );
        playedMoveAssessment = {
            ...assessment, moveUci: line.pvUci[0], evaluationCp: line.cp, depth: line.depth,
        };
    }
    return {
        version: DECISION_ASSESSMENT_VERSION,
        fen: input.fen,
        position,
        moves,
        ...(playedMoveAssessment ? { playedMoveAssessment } : {}),
        mistake,
        mistakeStatus,
    };
}
