import type { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import type { NormalMove, Role, Square } from "chessops/types";
import { makeUci } from "chessops/util";
import type { TacticalReplayStep } from "./causalTactics";

const VALUE: Record<Role, number> = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 20000 };
type Budget = { nodes: number };
export type QuietIntermediateLeaf = {
    fen: string; moveUci: string; balance: number; gain: number; quiet: boolean;
    lineUci?: string[]; counterchecks?: { fen: string; moveUci: string }[];
};
export type QuietIntermediateProof = {
    gain: number;
    recovery: number;
    reversedUpper: number;
    extra: number;
    deferred: NormalMove;
    escape: NormalMove;
    visits: number;
    collectionLeaves: QuietIntermediateLeaf[];
    recoveryLeaves: QuietIntermediateLeaf[];
};
export type QuietIntermediateSafety = {
    moves: (position: Chess) => NormalMove[];
    capture: (position: Chess, move: NormalMove) => number;
    exchange: (position: Chess, move: NormalMove) => number;
    replay: (fen: string, line: string[]) => TacticalReplayStep[];
    combination: (step: TacticalReplayStep, targets: Square[], capturers: Square[],
        budget: Budget, minimum: number, onLeaf: (leaf: QuietIntermediateLeaf) => void) => number | null;
};

/** A separate quiet move-order certificate, not a relaxed checking detector.
 * The removed victim must itself have a concrete reversed-order recovery of
 * the initiating piece. Both sides' retained material is proved independently
 * inside one budget; only then compare the orders. The proof's baseline is
 * this FEN: an earlier lost piece must be debited by exact-history consumers.
 * Safety leaves are nonchecking and bounded, not a full game outcome. */
export function computeQuietIntermediateCapture(
    root: TacticalReplayStep,
    safety: QuietIntermediateSafety,
    nodeLimit = 16384,
): QuietIntermediateProof | null {
    if (!root || !Number.isSafeInteger(nodeLimit) || nodeLimit < 1 || nodeLimit > 16384 ||
        !root.capture || root.move.promotion || root.before.isCheck() || root.after.isCheck() ||
        root.before.isEnd() || root.after.isEnd() || root.before.halfmoves >= 150 ||
        !root.before.isLegal(root.move)) return null;
    const mover = root.before.board.get(root.move.from), victim = root.before.board.get(root.move.to);
    if (!mover || !victim || victim.color === mover.color || victim.role === "pawn" || victim.role === "king" ||
        Math.abs(VALUE[mover.role] - VALUE[victim.role]) > 10 ||
        safety.capture(root.before, root.move) !== root.capture) return null;
    const after = root.before.clone();
    after.play(root.move);
    if (makeFen(after.toSetup()) !== makeFen(root.after.toSetup())) return null;
    // Nominal equality is not enough: two initially loose pieces must not
    // turn an already free capture into a new move-order primary lesson.
    if (Math.abs(safety.exchange(root.before, root.move)) > 10) return null;
    const budget = { nodes: nodeLimit }, side = root.before.turn;
    const relative = (square: Square) => side === "white" ? square : square ^ 56;
    const ordered = safety.moves(root.before).sort((a, b) =>
        relative(a.from) - relative(b.from) || relative(a.to) - relative(b.to));
    try {
        for (const deferred of ordered) {
            if (--budget.nodes < 0) return null;
            if (deferred.from === root.move.from || deferred.to === root.move.to || deferred.promotion ||
                safety.capture(root.before, deferred) < VALUE.knight) continue;
            const reversed = root.before.clone();
            reversed.play(deferred);
            if (reversed.isCheck() || reversed.isEnd()) continue;
            // Exact removed-piece identity is causal. An unrelated hanging
            // piece, pawn fork or hypothetical new attacker cannot fund it.
            const escape = { from: root.move.to, to: root.move.from };
            if (!reversed.isLegal(escape) || safety.capture(reversed, escape) !== VALUE[mover.role]) continue;
            const reverseStep = safety.replay(makeFen(reversed.toSetup()), [makeUci(escape)])[0];
            if (!reverseStep || reverseStep.after.isCheck() || reverseStep.after.isEnd()) continue;
            if (--budget.nodes < 0) return null;
            const recoveryLeaves: QuietIntermediateLeaf[] = [];
            let collectionLeaves: QuietIntermediateLeaf[] = [];
            let gain = safety.combination(root, [deferred.to], [deferred.from, root.move.to], budget, 90,
                leaf => collectionLeaves.push(leaf));
            if (gain === null || gain >= 10000 || budget.nodes < 0) continue;
            // Ask for enough retained recovery to distinguish the orders;
            // a low-threshold first-found leaf must not masquerade as the
            // maximum recovery or prevent a stronger bounded certificate.
            const neededRecovery = Math.max(90, safety.capture(root.before, deferred) - gain + 90);
            const recovery = safety.combination(reverseStep, [], [escape.to], budget, neededRecovery,
                leaf => recoveryLeaves.push(leaf));
            if (recovery === null || recovery >= 10000 || budget.nodes < 0) continue;
            // One pawn-sized strengthening attempt, sharing the REMAINING
            // budget. Failure cannot erase the already complete lower bound.
            const strongerLeaves: QuietIntermediateLeaf[] = [];
            let stronger: number | null = null;
            try {
                if (budget.nodes > 0) stronger = safety.combination(root, [deferred.to],
                    [deferred.from, root.move.to], budget, gain + VALUE.pawn,
                    leaf => strongerLeaves.push(leaf));
            } catch { /* Preserve only the already completed smaller certificate. */ }
            if (stronger !== null && stronger < 10000 && budget.nodes >= 0) {
                gain = stronger;
                collectionLeaves = strongerLeaves;
            }
            // Subtract the actual deferred capture exactly once. The reverse
            // proof is measured from its own pre-capture board, not our root.
            const reversedUpper = safety.capture(root.before, deferred) - recovery;
            const extra = gain - reversedUpper;
            if (extra < 90) continue;
            return { gain, recovery, reversedUpper, extra, deferred, escape,
                visits: nodeLimit - Math.max(0, budget.nodes), collectionLeaves, recoveryLeaves };
        }
    } catch {
        // Missing or exhausted evidence is unknown, not a move-order proof.
    }
    return null;
}
