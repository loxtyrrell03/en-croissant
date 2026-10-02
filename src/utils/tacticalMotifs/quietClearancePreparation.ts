import { attacks, between } from "chessops/attacks";
import type { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import type { NormalMove, Role, Square } from "chessops/types";
import { makeSquare, makeUci, opposite } from "chessops/util";
import type { TacticalReplayStep } from "./causalTactics";

const VALUE: Record<Role, number> = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 20000 };
type Budget = { nodes: number };

/** Core-owned safety leaves are injected to keep this bounded search separate
 * without a runtime dependency cycle. A leaf debits every friendly piece and
 * answers immediate counterchecks; it is not a whole-position evaluation. */
export type ClearanceSafety = {
    moves: (position: Chess) => NormalMove[];
    capture: (position: Chess, move: NormalMove) => number;
    exchange: (position: Chess, move: NormalMove) => number;
    defenderDraw: (position: Chess) => boolean;
    retainedGain: (position: Chess, move: NormalMove, budget: Budget) => number | null;
};
export type QuietClearanceNode = {
    fen: string;
    moveUci: string;
    kind: "capture" | "check" | "repair" | "retention";
    gain: number;
    balance: number;
    target?: "direct" | "fork";
    replies?: QuietClearanceBranch[];
};
export type QuietClearanceBranch = { replyUci: string; node: QuietClearanceNode };
export type QuietClearanceProof = {
    gain: number;
    visits: number;
    entry: NormalMove;
    directTarget: Square;
    forkTarget: Square;
    branches: QuietClearanceBranch[];
};

type State = {
    // Missing/captured identities are undefined, never substituted by a later
    // occupant of the same square.
    victims: [Square | undefined, Square | undefined];
    pieces: [Square | undefined, Square | undefined];
    balance: number;
    cleared: boolean;
    earned: boolean;
    repair: number;
    checks: number;
    depth: number;
};

/** A knight both attacks a new major-piece victim and opens a previously
 * blocked checking entry for an allied slider. All actual defences must end
 * in a connected local material retention. One attacked-slider repair and
 * two checks are allowed; every check, including a sacrificial capture,
 * enumerates ALL evasions before reaching a nonchecking safety leaf.
 * Missing repetition history remains unknown. Caller qualification checks
 * supplied-route history, not the hidden branches of this material tree. */
export function computeQuietClearancePreparation(
    root: TacticalReplayStep,
    safety: ClearanceSafety,
    nodeLimit = 16384,
): QuietClearanceProof | null {
    if (!Number.isInteger(nodeLimit) || nodeLimit < 1 || nodeLimit > 16384 ||
        !root || root.capture || root.move.promotion || root.before.isEnd() ||
        root.before.halfmoves >= 150 || root.before.isCheck() || root.after.isCheck() ||
        !root.before.isLegal(root.move)) return null;
    const verified = root.before.clone();
    verified.play(root.move);
    if (makeFen(verified.toSetup()) !== makeFen(root.after.toSetup())) return null;
    const piece = root.after.board.get(root.move.to);
    if (piece?.role !== "knight" || piece.color !== root.before.turn) return null;
    const side = root.before.turn, enemy = opposite(side), budget = { nodes: nodeLimit };
    const oldAttacks = attacks(piece, root.move.from, root.before.board.occupied);
    const direct = [...attacks(piece, root.move.to, root.after.board.occupied)].filter(square => {
        const victim = root.after.board.get(square);
        return victim?.color === enemy && ["rook", "queen"].includes(victim.role) && !oldAttacks.has(square);
    });
    if (direct.length !== 1) return null;
    const relative = (square: Square) => side === "white" ? square : square ^ 56;
    const moves = (position: Chess) => safety.moves(position).sort((a, b) =>
        relative(a.from) - relative(b.from) || relative(a.to) - relative(b.to) ||
        (a.promotion ?? "").localeCompare(b.promotion ?? ""));
    const visit = (position: Chess, move: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Quiet clearance budget exhausted");
        const next = position.clone();
        next.play(move);
        return next;
    };
    try {
        // A turn-adjusted board is nomination only. Every certificate below
        // starts after an actual legal defender move, never a null move.
        const probe = root.after.clone();
        probe.turn = side;
        probe.epSquare = undefined;
        for (const entry of moves(probe)) {
            const slider = probe.board.get(entry.from)!;
            if (entry.from === root.move.to || !["rook", "bishop", "queen"].includes(slider.role) ||
                safety.capture(probe, entry) ||
                !(entry.to === root.move.from || between(entry.from, entry.to).has(root.move.from)) ||
                root.before.isLegal(entry)) continue;
            const entered = visit(probe, entry);
            if (!entered.isCheck()) continue;
            const payoffs = [...attacks(slider, entry.to, entered.board.occupied)].filter(square => {
                const victim = entered.board.get(square);
                return square !== direct[0] && victim?.color === enemy &&
                    victim.role !== "king" && VALUE[victim.role] >= VALUE.knight;
            }).sort((a, b) => relative(a) - relative(b));
            for (const payoff of payoffs) {
                const attack = (position: Chess, state: State): QuietClearanceNode | null => {
                    if (position.isEnd() || position.halfmoves >= 150 || state.depth <= 0) return null;
                    const choices = moves(position).filter(move => state.pieces.includes(move.from) && !move.promotion);
                    const node = (move: NormalMove, kind: QuietClearanceNode["kind"], gain: number,
                        replies?: QuietClearanceBranch[]): QuietClearanceNode => ({
                        fen: makeFen(position.toSetup()), moveUci: makeUci(move), kind,
                        gain, balance: state.balance,
                        ...(safety.capture(position, move) && state.victims.includes(move.to)
                            ? { target: move.to === state.victims[0] ? "direct" as const : "fork" as const } : {}),
                        ...(replies ? { replies } : {}),
                    });
                    for (const move of choices) {
                        if (!safety.capture(position, move) || !state.victims.includes(move.to)) continue;
                        const caused = move.to === state.victims[0] ||
                            (state.cleared && move.from === state.pieces[1]) || state.earned || state.repair === 0;
                        if (!caused) continue;
                        const next = visit(position, move);
                        // A checking capture cannot stop before a quiet king
                        // evasion exposes an off-square loss (e.g. ...Rxb6).
                        if (next.isCheck() || safety.defenderDraw(next)) continue;
                        const gain = safety.retainedGain(position, move, budget);
                        if (gain !== null && state.balance + gain >= VALUE.pawn)
                            return node(move, "capture", state.balance + gain);
                    }
                    if (state.earned && state.balance >= VALUE.pawn && !position.isCheck()) {
                        for (const move of choices) {
                            if (safety.capture(position, move)) continue;
                            const next = visit(position, move);
                            if (next.isCheck() || safety.defenderDraw(next)) continue;
                            const gain = safety.retainedGain(position, move, budget);
                            if (gain !== null && state.balance + gain >= VALUE.pawn)
                                return node(move, "retention", state.balance + gain);
                        }
                    }
                    if (state.checks > 0) for (const move of choices) {
                        const captured = safety.capture(position, move);
                        if (captured && !state.victims.includes(move.to)) continue;
                        const next = visit(position, move);
                        if (!next.isCheck() || next.isCheckmate()) continue;
                        const cleared = state.cleared || (move.from === entry.from && move.to === entry.to);
                        const result = defend(next, {
                            ...state,
                            victims: state.victims.map(square => square === move.to ? undefined : square) as State["victims"],
                            pieces: state.pieces.map(square => square === move.from ? move.to : square) as State["pieces"],
                            balance: state.balance + captured, cleared,
                            earned: state.earned || (captured > 0 &&
                                (move.to === state.victims[0] || cleared || state.repair === 0)),
                            checks: state.checks - 1, depth: state.depth - 1,
                        });
                        if (result) return node(move, "check", result.gain, result.branches);
                    }
                    const [directVictim, counterattacker] = state.victims;
                    const [knight, rook] = state.pieces;
                    if (state.repair && directVictim !== undefined && counterattacker !== undefined &&
                        knight !== undefined && rook !== undefined) {
                        const counter = position.clone();
                        counter.turn = enemy;
                        counter.epSquare = undefined;
                        const threat = { from: counterattacker, to: rook };
                        const current = position.board.get(rook)!;
                        const oldAttack = attacks(current, rook, position.board.occupied).has(counterattacker);
                        if (!oldAttack && counter.isLegal(threat) && safety.exchange(counter, threat) > 0 &&
                            position.isLegal({ from: knight, to: directVictim })) {
                            for (const move of choices) {
                                if (move.from !== rook || safety.capture(position, move)) continue;
                                const next = visit(position, move);
                                if (next.isCheck() || !attacks(current, move.to, next.board.occupied).has(counterattacker)) continue;
                                const result = defend(next, { ...state,
                                    pieces: [knight, move.to], repair: 0, depth: state.depth - 1 });
                                if (result) return node(move, "repair", result.gain, result.branches);
                            }
                        }
                    }
                    return null;
                };
                const defend = (position: Chess, state: State):
                    { gain: number; branches: QuietClearanceBranch[] } | null => {
                    if (position.isEnd() || safety.defenderDraw(position)) return null;
                    const branches: QuietClearanceBranch[] = [];
                    for (const reply of moves(position)) {
                        if (reply.promotion) return null;
                        const next = visit(position, reply);
                        const response = attack(next, { ...state,
                            victims: state.victims.map(square => square === reply.from ? reply.to : square) as State["victims"],
                            pieces: state.pieces.map(square => square === reply.to ? undefined : square) as State["pieces"],
                            balance: state.balance - safety.capture(position, reply),
                        });
                        if (!response) return null;
                        branches.push({ replyUci: makeUci(reply), node: response });
                    }
                    return branches.length ? { gain: Math.min(...branches.map(branch => branch.node.gain)), branches } : null;
                };
                const result = defend(root.after, { victims: [direct[0], payoff], pieces: [root.move.to, entry.from],
                    balance: 0, cleared: false, earned: false, repair: 1, checks: 2, depth: 4 });
                const collectsForkVictim = (node: QuietClearanceNode): boolean =>
                    node.target === "fork" || (!!node.replies?.length &&
                        node.replies.every(branch => collectsForkVictim(branch.node)));
                // An optional new check cannot borrow an unrelated attack:
                // a real escape by the newly attacked major piece must be met
                // by this exact entry AND collect the distinct fork victim on
                // every selected continuation, not return to the first victim.
                if (result && result.branches.some(branch =>
                    branch.replyUci.slice(0, 2) === makeSquare(direct[0]) &&
                    branch.node.moveUci === makeUci(entry) && collectsForkVictim(branch.node))) {
                    return { ...result, visits: nodeLimit - budget.nodes, entry,
                        directTarget: direct[0], forkTarget: payoff };
                }
            }
        }
    } catch {
        // An exhausted or unsupported proof is unknown, never a certificate.
    }
    return null;
}
