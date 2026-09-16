import { makeFen } from "chessops/fen";
import {
    MIN_TACTICAL_CAPTURE_GAIN,
    replayTacticalLine,
    tacticalCaptureGain,
    type TacticalReplayStep,
} from "../../tacticalMotifs/causalTactics";

export type TacticalCaptureHistory = { fen: string; moves: string[] };

/** EXPERIMENTAL relevance policy, intentionally outside production. Legal move
 * history reconciles recent exchange credit; this does not prove that a pawn
 * capture is the best teaching theme, harmless strategically, or a mistake
 * cause. A prior legal capture is not necessarily a profitable one. The current
 * local capture bound is still independently calculated and never inflated by
 * earlier gains. Sixteen-ply truncation, older compensation and conditional
 * king attacks require further review before this can become an admission rule.
 */
export function inspectPersistentPawnCapture(
    root: TacticalReplayStep,
    history: TacticalCaptureHistory | null | undefined,
): { gain: number; exchangeBalance: number; episodePlies: number } | null {
    if (
        !history ||
        !Array.isArray(history.moves) ||
        !history.moves.length ||
        history.moves.length > 16 ||
        !root ||
        root.capture !== 100 ||
        root.move.promotion ||
        root.after.isCheck() ||
        root.after.isEnd() ||
        root.before.board.get(root.move.to)?.role !== "pawn"
    )
        return null;
    const steps = replayTacticalLine(history.fen, history.moves);
    if (
        steps.length !== history.moves.length ||
        makeFen(steps.at(-1)!.after.toSetup()) !==
            makeFen(root.before.toSetup())
    )
        return null;
    const side = root.before.turn;
    const piece = root.before.board.get(root.move.from)!;
    let from = root.move.from,
        target = root.move.to,
        boundary: number | null = null;
    let victimCapture: number | null = null;
    for (let index = steps.length - 1; index >= 0; index--) {
        const step = steps[index];
        if (step.move.promotion) return null;
        if (step.before.turn === side && step.move.to === from)
            from = step.move.from;
        if (step.before.turn !== side && step.move.to === target) {
            if (step.capture && victimCapture === null) victimCapture = index;
            target = step.move.from;
        }
        const attacker = step.before.board.get(from),
            victim = step.before.board.get(target);
        if (
            attacker?.color !== side ||
            attacker.role !== piece.role ||
            victim?.color === side ||
            victim?.role !== "pawn"
        )
            return null;
        // Never infer an availability boundary from a failed bounded proof.
        if (
            boundary === null &&
            step.before.turn === side &&
            !step.before.isLegal({ from, to: target })
        )
            boundary = index;
    }
    if (boundary === null) return null;
    // Qa4+ can prepare recovering a Catalan pawn several plies after ...dxc4.
    // Ignoring the target's earlier capture would erase the gambit debt.
    const start =
        victimCapture === null ? boundary : Math.min(boundary, victimCapture);
    const balance = steps
        .slice(start)
        .reduce(
            (sum, step) =>
                sum + (step.before.turn === side ? 1 : -1) * step.capture,
            0,
        );
    const localGain = tacticalCaptureGain(root);
    if (localGain === null) return null;
    const gain = Math.min(localGain, localGain + balance);
    return gain >= MIN_TACTICAL_CAPTURE_GAIN
        ? { gain, exchangeBalance: balance, episodePlies: steps.length - start }
        : null;
}
