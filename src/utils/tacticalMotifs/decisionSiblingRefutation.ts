import { castlingSide } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSquare, squareFile, squareRank } from "chessops/util";
import {
    MIN_TACTICAL_CAPTURE_GAIN,
    replayTacticalLine,
    tacticalExchangeGain,
    type TacticalReplayStep,
} from "./causalTactics";
import {
    measureDecisionLine,
    measurePositionDecision,
    type DecisionEngineLine,
} from "./decisionEvidence";
import { followPieceIdentities, initialPieceIdentities } from "./decisionPieceIdentity";
import type { TacticalGameHistory } from "./gameHistory";
import {
    advanceTacticalRepetitionContext,
    readTacticalRepetitionContext,
    tacticalRepetitionClaim,
} from "./repetitionHistory";
import type { TacticalMistakeEpisode } from "./tacticalMistakeEpisode";

function distance(a: number, b: number) {
    return Math.max(
        Math.abs(squareFile(a) - squareFile(b)),
        Math.abs(squareRank(a) - squareRank(b)),
    );
}

function related(good: TacticalReplayStep, weak: TacticalReplayStep) {
    if (
        good.move.promotion ||
        weak.move.promotion ||
        castlingSide(good.before, good.move) ||
        castlingSide(weak.before, weak.move)
    )
        return false;
    if (good.capture && weak.capture && good.move.to === weak.move.to) return true;
    return (
        good.move.from === weak.move.from &&
        Boolean(good.capture) === Boolean(weak.capture) &&
        good.after.isCheck() === weak.after.isCheck() &&
        distance(good.move.to, weak.move.to) <= 2
    );
}

function contrast(
    safe: TacticalReplayStep,
    insufficient: TacticalReplayStep,
    attack: TacticalReplayStep,
) {
    const pos = safe.after;
    if (!attack.capture || attack.move.promotion) return null;
    const gain = tacticalExchangeGain(attack.before, attack.move);
    if (gain - insufficient.capture < MIN_TACTICAL_CAPTURE_GAIN) return null;
    const { from, to } = attack.move;
    const victim = attack.before.board.get(to);
    if (!victim) return null;
    const original = initialPieceIdentities(safe.before);
    const weak = new Map(original),
        strong = new Map(original);
    followPieceIdentities(weak, insufficient);
    followPieceIdentities(strong, safe);
    const targetId = weak.get(to);
    if (targetId === undefined) return null;
    if (
        !pos.isLegal(attack.move) &&
        safe.capture &&
        safe.move.to === from &&
        weak.get(from) === from
    )
        return {
            kind: "attacker" as const,
            reason: safe.san + " removes the piece that would play " + attack.san + ".",
        };
    if (strong.get(from) !== weak.get(from)) return null;
    const otherSquare = [...strong].find(([, identity]) => identity === targetId)?.[0];
    if (otherSquare !== undefined && otherSquare !== to && safe.move.from === targetId) {
        if (
            [...pos.allDests()].some(([source, targets]) => {
                if (!targets.has(otherSquare)) return false;
                const immediate = tacticalExchangeGain(pos, { from: source, to: otherSquare });
                return immediate <= -20000 || immediate >= MIN_TACTICAL_CAPTURE_GAIN;
            })
        )
            return null;
        return {
            kind: "target" as const,
            reason:
                safe.san +
                " keeps the original " +
                victim.role +
                " on " +
                makeSquare(otherSquare) +
                " where no immediate capture passes the exchange check.",
        };
    }
    if (strong.get(to) !== targetId) return null;
    if (!pos.isLegal(attack.move)) {
        return safe.after.isCheck()
            ? {
                  kind: "check" as const,
                  reason: safe.san + " gives check, preventing the same capture.",
              }
            : null;
    }
    const safeGain = tacticalExchangeGain(pos, attack.move);
    if (safeGain > 0 || safeGain <= -20000 || gain - safeGain < MIN_TACTICAL_CAPTURE_GAIN)
        return null;
    return { kind: "exchange" as const, control: true as const };
}

// Require two genuinely competitive choices. The third must resemble one
// of them and lose to a concrete nominal refutation, beyond the score gap.
export function nominateSiblingRefutation(
    fen: string,
    candidates: DecisionEngineLine[],
    scope: "similar" | "causal" | "ranked" = "causal",
) {
    if (candidates.length !== 3) return null;
    const [leader, runnerUp, weak] = candidates;
    if (
        leader.depth < 16 ||
        weak.depth !== leader.depth ||
        weak.mate != null ||
        leader.cp == null ||
        runnerUp.cp == null ||
        weak.cp == null ||
        leader.cp - runnerUp.cp < 0 ||
        leader.cp - runnerUp.cp > 75 ||
        runnerUp.cp < weak.cp ||
        leader.cp - weak.cp < 100
    )
        return null;
    const measured = measurePositionDecision(fen, candidates);
    if (measured?.lines.length !== 3 || measured.bestSecondGapCp == null) return null;
    const [insufficient, attack] = replayTacticalLine(fen, weak.pvUci.slice(0, 2));
    if (!attack) return null;
    for (const safe of [leader, runnerUp]) {
        if (safe.cp! - weak.cp < 100) continue;
        const [step] = replayTacticalLine(fen, safe.pvUci.slice(0, 1));
        if (!step) continue;
        const reason = contrast(step, insufficient, attack);
        if (!reason) continue;
        const similar = related(step, insufficient);
        if (scope === "similar" && !similar) continue;
        if (
            scope === "causal" &&
            !similar &&
            reason.kind !== "target" &&
            reason.kind !== "attacker"
        )
            continue;
        return {
            safe,
            weak,
            safeStep: step,
            weakStep: insufficient,
            replyUci: attack.uci,
            replyFen: makeFen(insufficient.after.toSetup()),
            relation: similar ? "similar" : reason.kind,
            controlFen: "control" in reason ? makeFen(step.after.toSetup()) : undefined,
            reason: "reason" in reason ? reason.reason : undefined,
        };
    }
    return null;
}

export type SiblingRefutationFrames = {
    reply: DecisionEngineLine;
    control?: DecisionEngineLine;
};

export function confirmSiblingRefutation(
    fen: string,
    root: NonNullable<ReturnType<typeof nominateSiblingRefutation>>,
    { reply, control }: SiblingRefutationFrames,
    history?: TacticalGameHistory,
): TacticalMistakeEpisode | null {
    if (
        reply.pvUci[0] !== root.replyUci ||
        reply.depth < 16 ||
        reply.cp == null ||
        reply.mate != null ||
        Math.abs(reply.cp + root.weak.cp!) > 90 ||
        measureDecisionLine(root.replyFen, reply)?.drawnEnding !== false
    )
        return null;
    let reason = root.reason;
    if (root.controlFen) {
        if (
            !control ||
            control.pvUci[0] !== root.replyUci ||
            control.depth < 16 ||
            control.cp == null ||
            reply.cp - control.cp < 100 ||
            control.cp > -root.safe.cp! + 90 ||
            measureDecisionLine(root.controlFen, control)?.drawnEnding !== false
        )
            return null;
        const [take, recapture] = replayTacticalLine(root.controlFen, control.pvUci.slice(0, 2));
        if (!recapture || recapture.move.to !== take.move.to || !recapture.capture) return null;
        reason =
            "After " +
            root.safeStep.san +
            ", the same capture allows " +
            recapture.san +
            " and gives no immediate exchange gain.";
    }
    const bad = [root.weak.pvUci, [root.weakStep.uci, ...reply.pvUci]];
    const stronger = root.safe.pvUci;
    const held = (choice: DecisionEngineLine, line: string[], end: number) => {
        const measured = measureDecisionLine(fen, { ...choice, pvUci: line.slice(0, end) });
        if (
            !measured ||
            measured.drawnEnding ||
            measured.checkmate ||
            measured.quietEndingPlies < 2 ||
            measured.endingMaterialRangeCp[0] !== measured.endingMaterialRangeCp[1]
        )
            return undefined;
        return measured.materialChangeCp;
    };
    const horizon = Math.min(13, stronger.length, ...bad.map((line) => line.length));
    const costs = Array.from({ length: Math.max(0, horizon - 4) }, (_, index) => index + 5).map(
        (end) => ({
            end,
            good: held(root.safe, stronger, end),
            bad: bad.map((line) => held(root.weak, line, end)),
        }),
    );
    if (costs.some(({ bad }) => bad.some((balance) => balance !== undefined && balance > -90)))
        return null;
    const witness = costs.find(
        ({ good, bad }) =>
            good !== undefined &&
            bad.every((balance) => balance !== undefined && good - balance >= 90),
    );
    if (!witness || !reason) return null;
    const playedLineUci = bad[1].slice(0, witness.end);
    const betterLineUci = stronger.slice(0, witness.end);
    const controlLineUci =
        root.controlFen && control ? [root.safeStep.uci, ...control.pvUci.slice(0, 3)] : undefined;
    if (history) {
        const initial = readTacticalRepetitionContext(fen, history);
        if (!initial || tacticalRepetitionClaim(initial)) return null;
        for (const variation of [
            playedLineUci,
            betterLineUci,
            bad[0].slice(0, witness.end),
            controlLineUci ?? [],
        ]) {
            let context = initial;
            for (const uci of variation) {
                const next = advanceTacticalRepetitionContext(context, uci);
                if (!next || tacticalRepetitionClaim(next)) return null;
                context = next;
            }
        }
    }
    const evidence = replayTacticalLine(fen, playedLineUci);
    if (!evidence[1]) return null;
    return {
        kind: "comparative",
        throughPly: witness.end,
        materialDifferencePoints:
            (witness.good! - Math.max(...witness.bad.map((balance) => balance!))) / 100,
        betterLineUci,
        playedLineUci,
        ...(controlLineUci ? { controlLineUci } : {}),
        mechanisms: [],
        explanation:
            root.weakStep.san +
            " allows " +
            evidence[1].san +
            " and both searches retain a material loss. " +
            reason,
    };
}
