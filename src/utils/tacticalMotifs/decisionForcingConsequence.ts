import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import {
    observeDefensibleMateThreat,
    replayTacticalLine,
    type TacticalReplayStep,
} from "./causalTactics";
import type { DecisionEngineLine } from "./decisionEvidence";
import type { TacticalMistakeEpisode } from "./tacticalMistakeEpisode";
import { extractTacticalSequenceWitnesses } from "./tacticalSequenceEvidence";

/** Attribution requires a concrete change in the entry, and a shared attack
 * in both searches. A check by itself is used only to track the continuation.
 * The caller has verified exact search frames and corroborated the reply. */
export function compareExposedForcingAttack(
    fen: string,
    better: DecisionEngineLine,
    actual: DecisionEngineLine,
    replies: DecisionEngineLine[],
): TacticalMistakeEpisode | null {
    const [reply, runnerUp] = replies;
    if (
        better.cp === null ||
        actual.cp === null ||
        better.cp - actual.cp < 100 ||
        better.depth < 16 ||
        !reply ||
        reply.cp === null ||
        runnerUp?.cp == null ||
        reply.cp - runnerUp.cp < 90
    )
        return null;

    const played = replayTacticalLine(fen, actual.pvUci.slice(0, 12));
    const control = replayTacticalLine(fen, better.pvUci.slice(0, 1))[0];
    const root = played[0];
    if (!control || !root || makeFen(root.after.toSetup()) !== reply.fen) return null;
    const attack = replayTacticalLine(reply.fen, reply.pvUci.slice(0, 11));
    const common: TacticalReplayStep[] = [];
    for (const [index, step] of attack.entries()) {
        if (step.uci !== played[index + 1]?.uci) break;
        common.push(step);
    }
    const first = common[0];
    if (!first) return null;
    const alternative = control.after.clone();
    const legalEntry = alternative.isLegal(first.move);
    if (legalEntry) {
        alternative.play(first.move);
        if (!first.after.isCheck() || alternative.isCheck()) return null;
    }
    const entry = legalEntry
        ? `After ${control.san}, ${makeSan(control.after, first.move)} leaves the king out of check.`
        : control.capture && control.move.to === first.move.from
          ? `${control.san} takes the piece that starts the attack.`
          : control.after.isCheck()
            ? `${control.san} gives check first, so the opponent has to answer it.`
            : `${control.san} prevents the same entry move.`;
    const result = (
        through: number,
        explanation: string,
        mechanisms: TacticalMistakeEpisode["mechanisms"] = [],
    ): TacticalMistakeEpisode => ({
        kind: "forcing-attack",
        throughPly: through + 1,
        playedLineUci: [root.uci, ...common.slice(0, through).map((step) => step.uci)],
        betterLineUci: better.pvUci.slice(0, through + 1),
        mechanisms,
        explanation: `After ${root.san}, ${explanation} ${entry}`,
    });

    // A quiet entry can itself threaten mate. A checking entry can instead
    // lead to a quiet threat after the same evasion in both engine searches.
    const threatIndex = first.after.isCheck() ? 2 : 0;
    const setup = common[threatIndex];
    const defence = common[threatIndex + 1];
    if (setup && defence) {
        const threat = observeDefensibleMateThreat(setup);
        if (threat?.defences.some((move) => move.uci === defence.uci)) {
            const description = threatIndex
                ? `${first.san} ${common[1].san} ${setup.san} threatens ${threat.threatSan}.`
                : `${setup.san} threatens ${threat.threatSan}.`;
            return result(
                threatIndex + 2,
                `${description} Both searches show ${defence.san} stopping immediate mate.`,
            );
        }
    }
    if (!first.after.isCheck()) return null;

    // Attribute a later exploit only when each earlier attacking move in the
    // common prefix gives check. The initial change opens that exact route to
    // the pin, and the local capture has its own legal material proof.
    const pin = extractTacticalSequenceWitnesses(reply.fen, {
        ...reply,
        pvUci: common.map((step) => step.uci),
    }).find(
        (witness) =>
            witness.mechanism === "pin" &&
            witness.mechanismPly > 1 &&
            common
                .slice(0, witness.mechanismPly - 1)
                .every((step, index) => index % 2 !== 0 || step.after.isCheck()),
    );
    return pin
        ? result(
              Math.min(pin.payoffPly + 1, common.length),
              `${first.san} starts a checking sequence. ${pin.description}`,
              [pin],
          )
        : null;
}
