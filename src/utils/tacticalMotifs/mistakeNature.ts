import { makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import type { MistakeReviewNatureClassification } from "../mistakeReview";
import { positionFromFen } from "../chessops";
import { replayTacticalLine } from "./causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    isImmediateTacticalLesson,
    type MistakeReviewMotifInput,
} from "./mistakeReviewAdapter";

/** A move's cause, not a second, notation-based position motif detector. */
export function classifyProvedMistakeNature(
    input: MistakeReviewMotifInput,
): MistakeReviewNatureClassification {
    const uncertain = (reason: string): MistakeReviewNatureClassification => ({
        nature: "unknown",
        confidence: "low",
        reason,
        tacticalSignals: [],
        aspect: "both",
        allowedNature: "unknown",
        missedNature: "unknown",
        allowedReason: "No independently established opponent cause.",
        missedReason: "No independently established missed root opportunity.",
    });
    const [position] = positionFromFen(input.fen ?? "");
    if (!position)
        return uncertain(
            "The starting board is missing or invalid. Move notation alone cannot establish the cause of a mistake.",
        );
    const resolveMove = (uci: string | null | undefined, san: string | null | undefined) => {
        if (uci) return uci;
        const move = san ? parseSan(position, san) : undefined;
        return move ? makeUci(move) : undefined;
    };
    const bestMoveUci = resolveMove(input.bestMoveUci ?? input.pvUci?.[0], input.bestMoveSan);
    const playedMoveUci = resolveMove(input.playedMoveUci, input.playedMoveSan);
    const best = replayTacticalLine(input.fen!, bestMoveUci ? [bestMoveUci] : []);
    const played = replayTacticalLine(input.fen!, playedMoveUci ? [playedMoveUci] : []);
    if (best.length !== 1 || played.length !== 1)
        return uncertain(
            "The better move and played move must both be legal on the starting board before a tactical cause can be established.",
        );
    if (makeFen(best[0].after.toSetup()) === makeFen(played[0].after.toSetup()))
        return uncertain(
            "The played move is the supplied best move. A tactic in this position is not evidence of a mistake by that move.",
        );
    if (typeof input.cpLoss === "number" && Number.isFinite(input.cpLoss) && input.cpLoss <= 20)
        return uncertain(
            "The supplied evaluations do not establish a meaningful loss for this move. A tactic in the position alone is not a mistake explanation.",
        );

    // Disagreement between the nominated root and the PV must not silently
    // move a later idea onto a different first move. SAN remains display text.
    if (input.pvUci?.length && input.pvUci[0] !== bestMoveUci)
        return uncertain(
            "The supplied better move and engine continuation disagree; the tactical cause is unclassified.",
        );
    const classification = classifyMistakeReviewMotifs({ ...input, bestMoveUci, playedMoveUci });
    // Exact WDL zugzwang certificates deliberately carry no invented material
    // value. They are still important lessons, including drawing resources.
    const rootLesson = (m: (typeof classification.missedMotifs)[number]) =>
        isImmediateTacticalLesson(m) ||
        (m.id === "zugzwang" && m.ply === 1 && m.confidence === "high");
    const allowedMotifs = classification.allowedMotifs.filter(
        (m) => rootLesson(m) && (m.comparison === "prevented" || m.comparison === "reduced"),
    );
    const missedMotifs = classification.missedMotifs.filter(rootLesson);
    const explanation = buildMistakeReviewTacticalExplanation({ allowedMotifs, missedMotifs });
    if (explanation) {
        const allowed = allowedMotifs.length > 0,
            missed = missedMotifs.length > 0;
        return {
            nature: "tactical",
            confidence: explanation.primary.confidence,
            reason: explanation.text,
            tacticalSignals: [
                explanation.primary,
                ...(explanation.secondary ? [explanation.secondary] : []),
            ].map(
                (m) =>
                    `${m.source === "missed" ? "Missed" : "Allowed"}: ${m.label}. ${m.evidence}${m.comparisonEvidence ? ` ${m.comparisonEvidence}` : ""}`,
            ),
            aspect: allowed && missed ? "both" : allowed ? "allowed" : "missed",
            allowedNature: allowed ? "tactical" : "unknown",
            allowedReason: allowed
                ? [allowedMotifs[0].evidence, allowedMotifs[0].comparisonEvidence]
                      .filter(Boolean)
                      .join(" ")
                : "No independently established opponent cause.",
            missedNature: missed ? "tactical" : "unknown",
            missedReason: missed
                ? missedMotifs[0].evidence
                : "No independently established missed root opportunity.",
        };
    }

    // A conservative *estimate*, never proof of absence. Checks and captures
    // may disqualify this quiet estimate; they can never certify a tactic.
    const bestWindow = input.pvUci?.slice(0, 8) ?? [];
    const replyWindow = input.refutationUci?.slice(0, 8) ?? [];
    const quietWindow = (fen: string, moves: string[]) => {
        const replay = replayTacticalLine(fen, moves);
        return (
            moves.length >= 4 &&
            replay.length === moves.length &&
            replay.every((ply) => !/[x+#=]/.test(makeSan(ply.before, ply.move)))
        );
    };
    const hasUnresolvedMotifs =
        classification.allowedMotifs.length ||
        classification.missedMotifs.length ||
        classification.allowedTimeline?.length ||
        classification.missedTimeline?.length;
    if (
        !hasUnresolvedMotifs &&
        (input.reachedDepth ?? 0) >= 14 &&
        typeof input.cpLoss === "number" &&
        Number.isFinite(input.cpLoss) &&
        input.cpLoss < 180 &&
        (input.winProbabilityDrop ?? 0) < 12 &&
        quietWindow(input.fen!, bestWindow) &&
        quietWindow(makeFen(played[0].after.toSetup()), replyWindow)
    ) {
        return {
            ...uncertain(
                "Both supplied continuations remain quiet through the checked window, with no proved root tactical cause. This is likely positional, not proof that no deeper tactic exists.",
            ),
            nature: "positional",
            confidence: "medium",
            allowedNature: "positional",
            missedNature: "positional",
        };
    }
    return uncertain(
        classification.missedMotifs.some((m) => m.alternativeCapture)
            ? "The better move and played move have comparable immediate captures. Their tactical difference is not established by those captures alone."
            : classification.allowedMotifs.some((m) => m.comparison === "persists")
              ? "The opponent's tactical danger also exists after the better move. It is not an established cause of this mistake."
              : "The available evidence does not establish a root tactical cause. Later line events, a large evaluation loss or an unproved threat do not establish one; the decision may be positional or an unproved tactic.",
    );
}
