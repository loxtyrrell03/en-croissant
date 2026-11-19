import { makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import {
    observeDefensibleMateThreat,
    replayTacticalLine,
    type TacticalReplayStep,
} from "./causalTactics";
import type { DecisionEngineLine } from "./decisionEvidence";

export type QuietMateThreat = {
    fen: string;
    defenceLinesUci: Array<[string, string]>;
    ignoredLineUci: [string, string, string];
    exampleWasSearched: boolean;
    explanation: string;
};

/** A quiet move can create tactical demand even when a defence exists.
 * The caller has checked the root and independent reply frames. Both
 * must show a real defence, and the alternate reply must actually allow
 * the mate threatened before the defence. */
export function findQuietMateThreat(
    fen: string,
    root: DecisionEngineLine,
    replies: DecisionEngineLine[],
): QuietMateThreat | null {
    const [main, ...alternatives] = replies;
    const defenceUci = root.pvUci[1];
    if (
        root.depth < 16 ||
        root.cp === null ||
        root.cp < -100 ||
        root.mate != null ||
        main?.cp == null ||
        main.mate != null
    )
        return null;
    const failedDefences = alternatives.filter(
        ({ mate, pvUci }) => mate === -1 && pvUci.length === 2,
    );
    const [first] = replayTacticalLine(fen, root.pvUci.slice(0, 1));
    if (!first || makeFen(first.after.toSetup()) !== main.fen) return null;
    const threat = observeDefensibleMateThreat(first);
    if (!threat) return null;
    const defence = threat.defences.find(({ uci }) => uci === defenceUci);
    const independentDefence = threat.defences.find(({ uci }) => uci === main.pvUci[0]);
    if (!defence || !independentDefence) return null;
    const defences = defence === independentDefence ? [defence] : [defence, independentDefence];
    const threatBoard = first.after.clone();
    threatBoard.turn = first.before.turn;
    threatBoard.epSquare = undefined;
    const evidence = (
        reply: TacticalReplayStep,
        mate: TacticalReplayStep,
        searched: boolean,
    ): QuietMateThreat => ({
        fen,
        defenceLinesUci: defences.map(({ uci }) => [first.uci, uci]),
        ignoredLineUci: [first.uci, reply.uci, mate.uci],
        exampleWasSearched: searched,
        explanation: [
            `${first.san} threatens ${makeSan(threatBoard, mate.move)}.`,
            defences.length === 1
                ? `${defence.san} stops immediate mate.`
                : `${defence.san} and ${independentDefence.san} each stop immediate mate.`,
            `${reply.san} allows ${mate.san}.`,
        ].join(" "),
    });
    for (const failed of failedDefences) {
        if (failed.fen !== main.fen) continue;
        const [ignored, mate] = replayTacticalLine(failed.fen, failed.pvUci);
        if (!ignored || !mate?.after.isCheckmate() || !threatBoard.isLegal(mate.move)) continue;
        const threatenedMate = threatBoard.clone();
        threatenedMate.play(mate.move);
        if (!threatenedMate.isCheckmate()) continue;
        return evidence(ignored, mate, true);
    }
    // The bounded search already checked this legal example. It can
    // demonstrate the threat even if the engine's shortlist is all defences.
    const ignored = parseSan(first.after, threat.ignored.reply);
    if (!ignored) return null;
    const next = first.after.clone();
    next.play(ignored);
    const matingMove = parseSan(next, threat.ignored.mate);
    if (!matingMove) return null;
    const [reply, mate] = replayTacticalLine(main.fen, [makeUci(ignored), makeUci(matingMove)]);
    return reply && mate?.after.isCheckmate() ? evidence(reply, mate, false) : null;
}
