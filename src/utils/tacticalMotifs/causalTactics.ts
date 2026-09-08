import { attacks, between } from "chessops/attacks";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import type { Color, NormalMove, Role, Square } from "chessops/types";
import { makeSquare, makeUci, opposite, parseUci } from "chessops/util";
import type { TacticalMotifEvidence } from "./types";

const VALUE: Record<Role, number> = {
    pawn: 100,
    knight: 320,
    bishop: 330,
    rook: 500,
    queen: 900,
    king: 20000,
};
const MECHANISMS = new Set([
    "fork",
    "pin",
    "skewer",
    "deflection",
    "attraction",
    "interference",
    "selfInterference",
    "capturingDefender",
    "intermezzo",
    "discoveredAttack",
    "discoveredCheck",
    "doubleCheck",
    "clearance",
    "xRayAttack",
]);
const MATE = /(?:^mate(?:In\d+)?$|Mate$)/;
const CONCRETE_THEMES = new Set([
    "hangingPiece",
    "trappedPiece",
    "sacrifice",
    "promotion",
    "underPromotion",
    "attacking_undefended_piece",
    "attackingF2F7",
    "mateThreat",
    "backRank",
    "zugzwang",
    "enPassant",
]);

export type TacticalReplayStep = {
    before: Chess;
    after: Chess;
    move: NormalMove;
    uci: string;
    san: string;
    capture: number;
    balance: number;
};

/** Legal replay stops at the first invalid move: dropping it would join two
 * unrelated positions and manufacture evidence. */
export function replayTacticalLine(fen: string, line: string[]): TacticalReplayStep[] {
    try {
        const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
        const attacker = pos.turn;
        let balance = 0;
        const steps: TacticalReplayStep[] = [];
        for (const uci of line) {
            const move = parseUci(uci);
            if (!move || !("from" in move) || !pos.isLegal(move)) break;
            const before = pos.clone();
            const capture = capturedValue(pos, move);
            const promotion = move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0;
            balance += (pos.turn === attacker ? 1 : -1) * (capture + promotion);
            const san = makeSan(pos, move);
            pos.play(move);
            steps.push({ before, after: pos.clone(), move, uci, san, capture, balance });
        }
        return steps;
    } catch {
        return [];
    }
}

function capturedValue(pos: Chess, move: NormalMove) {
    const victim = pos.board.get(move.to);
    if (victim?.color === opposite(pos.turn)) return VALUE[victim.role];
    return pos.board.get(move.from)?.role === "pawn" && move.to === pos.epSquare ? VALUE.pawn : 0;
}

/** A piece which is still sitting on its profitable capture square may be
 * recaptured after an intervening check or counter-capture. That is exchange
 * continuation, not a newly hanging piece. A queen which only took a pawn
 * does not qualify, and moving the piece again clears this local credit. */
export function isCompensatedContinuationCapture(steps: TacticalReplayStep[], index: number) {
    const step = steps[index];
    if (!step?.capture || index === 0) return false;
    const square = step.move.to;
    const victim = step.before.board.get(square);
    if (!victim) return false;
    for (let i = index - 1; i >= 0; i--) {
        const previous = steps[i];
        const after = previous.after.board.get(square);
        if (after?.color !== victim.color || after.role !== victim.role) return false;
        const before = previous.before.board.get(square);
        if (
            previous.move.to === square ||
            before?.color !== victim.color ||
            before.role !== victim.role
        ) {
            const earned =
                previous.capture +
                (previous.move.promotion ? VALUE[previous.move.promotion] - VALUE.pawn : 0);
            return (
                previous.move.to === square &&
                previous.capture > 0 &&
                earned >= VALUE[victim.role] - 50
            );
        }
    }
    return false;
}

function legalMoves(pos: Chess): NormalMove[] {
    const result: NormalMove[] = [];
    for (const [from, dests] of pos.allDests()) {
        for (const to of dests) {
            if (pos.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)) {
                for (const promotion of ["queen", "rook", "bishop", "knight"] as const)
                    result.push({ from, to, promotion });
            } else result.push({ from, to });
        }
    }
    return result;
}

/** Legal static exchange. Pinned attackers and illegal king recaptures cannot
 * defend a square. The budget fails conservatively instead of claiming a gain. */
function exchange(pos: Chess, target: Square, budget: { nodes: number }): number {
    if (--budget.nodes < 0) throw new Error("Exchange proof budget exhausted");
    let best = 0;
    for (const from of pos.board[pos.turn]) {
        const move: NormalMove = { from, to: target };
        if (pos.board.get(from)?.role === "pawn" && (target < 8 || target >= 56))
            move.promotion = "queen";
        if (!pos.isLegal(move)) continue;
        const captured = capturedValue(pos, move);
        if (!captured) continue;
        const next = pos.clone();
        next.play(move);
        best = Math.max(
            best,
            captured +
                (move.promotion ? VALUE[move.promotion] - 100 : 0) -
                exchange(next, target, budget),
        );
    }
    return best;
}

export function tacticalExchangeGain(pos: Chess, move: NormalMove) {
    if (!pos.isLegal(move)) return -VALUE.king;
    const next = pos.clone();
    next.play(move);
    try {
        return (
            capturedValue(pos, move) +
            (move.promotion ? VALUE[move.promotion] - 100 : 0) -
            exchange(next, move.to, { nodes: 256 })
        );
    } catch {
        return -VALUE.king;
    }
}

function withTurn(pos: Chess, turn: Color) {
    const copy = pos.clone();
    copy.turn = turn;
    copy.epSquare = undefined;
    return copy;
}

type QuietMateProof = {
    threat: string;
    replyCount: number;
    example: { reply: string; mate: string };
};
const quietMateCache = new Map<string, QuietMateProof | null>();
const QUIET_MATE_NODE_LIMIT = 4096;

/** A null-move threat is only a candidate. Certify a quiet mating move only
 * after EVERY legal defence has a legal mate-in-one answer. A single PV, an
 * empty/stalemated reply set, or an exhausted budget is never a proof. */
export function proveQuietMateThreat(
    step: TacticalReplayStep,
    nodeLimit = QUIET_MATE_NODE_LIMIT,
): QuietMateProof | null {
    return proveMateNextTurn(step, nodeLimit, true);
}

function proveMateNextTurn(
    step: TacticalReplayStep,
    nodeLimit = QUIET_MATE_NODE_LIMIT,
    quietOnly = false,
): QuietMateProof | null {
    if (quietOnly && (step.capture || step.move.promotion || step.after.isCheck())) return null;
    const key = `${quietOnly}:${makeFen(step.after.toSetup())}`;
    if (nodeLimit === QUIET_MATE_NODE_LIMIT && quietMateCache.has(key))
        return quietMateCache.get(key)!;
    let nodes = nodeLimit;
    const mateInOne = (pos: Chess) => {
        for (const move of legalMoves(pos)) {
            if (--nodes < 0) throw new Error("Mate proof budget exhausted");
            const next = pos.clone();
            next.play(move);
            if (next.isCheckmate()) return makeSan(pos, move);
        }
        return null;
    };
    let proof: QuietMateProof | null = null;
    try {
        const replies = legalMoves(step.after);
        const threat =
            quietOnly && replies.length ? mateInOne(withTurn(step.after, step.before.turn)) : null;
        if (replies.length && (!quietOnly || threat)) {
            const answers: QuietMateProof["example"][] = [];
            for (const reply of replies) {
                if (--nodes < 0) throw new Error("Mate proof budget exhausted");
                const next = step.after.clone();
                next.play(reply);
                const mate = mateInOne(next);
                if (!mate) break;
                answers.push({ reply: makeSan(step.after, reply), mate });
            }
            if (answers.length === replies.length)
                proof = {
                    threat: threat ?? answers[0].mate,
                    replyCount: replies.length,
                    example: answers[0],
                };
        }
    } catch {
        // Unknown is withheld; it does not mean the position has no tactic.
    }
    if (nodeLimit === QUIET_MATE_NODE_LIMIT) {
        quietMateCache.set(key, proof);
        if (quietMateCache.size > 256) quietMateCache.delete(quietMateCache.keys().next().value!);
    }
    return proof;
}

type MatePreparationProof = { replyCount: number; example: string[] };
const preparationCache = new Map<string, MatePreparationProof | null>();

/** Verify a short supplied mate-in-three candidate with an AND/OR tree, not
 * with the supplied replies alone. The PV only orders legal attacking moves.
 * The cap keeps this local proof from becoming a second unbounded engine. */
export function proveMateWithinThree(
    steps: TacticalReplayStep[],
    nodeLimit = 16384,
): MatePreparationProof | null {
    if (
        steps.length < 5 ||
        !steps[4].after.isCheckmate() ||
        steps[4].before.turn !== steps[0].before.turn
    )
        return null;
    const root = steps[0];
    const key = `${makeFen(root.after.toSetup())}:${steps[2].uci}`;
    if (nodeLimit === 16384 && preparationCache.has(key)) return preparationCache.get(key)!;
    let nodes = nodeLimit;
    const visit = (pos: Chess, move: NormalMove) => {
        if (--nodes < 0) throw new Error("Preparation proof budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const mateInOne = (pos: Chess) => {
        for (const move of legalMoves(pos))
            if (visit(pos, move).isCheckmate()) return makeSan(pos, move);
        return null;
    };
    const forceMate = (pos: Chess): string[] | null => {
        const immediate = mateInOne(pos);
        if (immediate) return [immediate];
        const moves = legalMoves(pos);
        moves.sort(
            (a, b) =>
                Number(b.from === steps[2].move.from && b.to === steps[2].move.to) -
                Number(a.from === steps[2].move.from && a.to === steps[2].move.to),
        );
        for (const move of moves) {
            const next = visit(pos, move);
            const replies = legalMoves(next);
            if (!replies.length) continue;
            let sample: string[] | null = null;
            let allMated = true;
            for (const reply of replies) {
                const mate = mateInOne(visit(next, reply));
                if (!mate) {
                    allMated = false;
                    break;
                }
                sample ??= [makeSan(pos, move), makeSan(next, reply), mate];
            }
            if (allMated) return sample;
        }
        return null;
    };
    let proof: MatePreparationProof | null = null;
    try {
        const replies = legalMoves(root.after);
        const answers: string[][] = [];
        for (const reply of replies) {
            const continuation = forceMate(visit(root.after, reply));
            if (!continuation) break;
            answers.push([makeSan(root.after, reply), ...continuation]);
        }
        if (replies.length && answers.length === replies.length)
            proof = {
                replyCount: replies.length,
                example: answers.sort((a, b) => b.length - a.length)[0],
            };
    } catch {
        // Failed or incomplete search is not evidence of a forced mate.
    }
    if (nodeLimit === 16384) {
        preparationCache.set(key, proof);
        if (preparationCache.size > 256)
            preparationCache.delete(preparationCache.keys().next().value!);
    }
    return proof;
}

function quietPreparation(steps: TacticalReplayStep[]) {
    const root = steps[0];
    return root && !root.capture && !root.move.promotion && !root.after.isCheck()
        ? proveMateWithinThree(steps)
        : null;
}

type TacticalPreparationProof = {
    gain: number;
    example: string[];
    target: Square;
    forced: boolean;
    threat: string[];
};
const tacticalPreparationCache = new Map<string, TacticalPreparationProof | null>();

/** A supplied payoff only nominates the victim and orders checks. Try every
 * legal defence first. If that proof fails, certify a null-move threat AND
 * the actual supplied reply separately; this weaker result is root-only,
 * engine-gated, and must never be described as a globally forced sequence. */
export function proveQuietTacticalPreparation(
    steps: TacticalReplayStep[],
    nodeLimit = 16384,
): TacticalPreparationProof | null {
    const root = steps[0];
    if (
        !root ||
        root.capture ||
        root.move.promotion ||
        root.before.isCheck() ||
        root.after.isCheck()
    )
        return null;
    const payoff = steps
        .slice(2, 7)
        .find((step) => step.before.turn === root.before.turn && step.capture >= VALUE.rook);
    if (!payoff) return null;
    let target = payoff.move.to;
    for (const step of steps.slice(1, steps.indexOf(payoff)).reverse()) {
        if (step.before.turn !== root.before.turn && step.move.to === target)
            target = step.move.from;
    }
    const victim = root.after.board.get(target);
    if (!victim || victim.color === root.before.turn || VALUE[victim.role] < VALUE.rook)
        return null;
    // The initiating piece must participate, or clear the path of a different
    // checking piece. A quiet pawn move cannot borrow an unrelated combination.
    let mover = root.move.to;
    let participates = false;
    for (const step of steps.slice(2, 7)) {
        if (step.before.turn !== root.before.turn) continue;
        if (step.move.from === mover) {
            mover = step.move.to;
            if (step.after.isCheck()) participates = true;
        } else if (
            step.after.isCheck() &&
            between(step.move.from, step.move.to).has(root.move.from)
        )
            participates = true;
    }
    if (!participates) return null;
    const hints = steps
        .filter((step) => step.before.turn === root.before.turn && step.after.isCheck())
        .map((step) => step.uci);
    const key = `${makeFen(root.before.toSetup())}:${root.uci}:${steps[1]?.uci}:${target}:${hints}`;
    if (nodeLimit === 16384 && tacticalPreparationCache.has(key))
        return tacticalPreparationCache.get(key)!;
    let nodes = nodeLimit;
    type Win = { gain: number; line: string[] };
    const delta = (pos: Chess, move: NormalMove) =>
        capturedValue(pos, move) + (move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0);
    const visit = (pos: Chess, move: NormalMove) => {
        if (--nodes < 0) throw new Error("Tactical preparation budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const attack = (
        pos: Chess,
        square: Square,
        balance: number,
        checks: number,
        requireCheck = false,
    ): Win | null => {
        if (pos.isEnd()) return null;
        const moves = legalMoves(pos);
        for (const move of moves) {
            if (requireCheck || move.to !== square || !capturedValue(pos, move)) continue;
            const next = visit(pos, move);
            if (next.isEnd() && !next.isCheckmate()) continue;
            const exchangeGain = tacticalExchangeGain(pos, move);
            if (exchangeGain <= -VALUE.king) continue;
            if (balance + exchangeGain >= 90)
                return { gain: balance + exchangeGain, line: [makeSan(pos, move)] };
        }
        if (!checks) return null;
        moves.sort(
            (a, b) => Number(hints.includes(makeUci(b))) - Number(hints.includes(makeUci(a))),
        );
        for (const move of moves) {
            const next = visit(pos, move);
            if (!next.isCheck()) continue;
            if (next.isCheckmate()) return { gain: 10000, line: [makeSan(pos, move)] };
            const win = defend(next, square, balance + delta(pos, move), checks - 1);
            if (win) return { gain: win.gain, line: [makeSan(pos, move), ...win.line] };
        }
        return null;
    };
    const defend = (pos: Chess, square: Square, balance: number, checks: number): Win | null => {
        const moves = legalMoves(pos);
        if (!moves.length) return null;
        let weakest: Win | null = null;
        for (const move of moves) {
            const next = visit(pos, move);
            const win = attack(
                next,
                move.from === square ? move.to : square,
                balance - delta(pos, move),
                checks,
            );
            if (!win) return null;
            if (!weakest || win.gain < weakest.gain)
                weakest = { gain: win.gain, line: [makeSan(pos, move), ...win.line] };
        }
        return weakest;
    };
    let result: TacticalPreparationProof | null = null;
    try {
        const win = defend(root.after, target, 0, 2);
        if (win) result = { gain: win.gain, example: win.line, target, forced: true, threat: [] };
        else if (steps[1]) {
            const threat = attack(withTurn(root.after, root.before.turn), target, 0, 2, true);
            const reply = steps[1];
            const branch = threat
                ? attack(
                      reply.after,
                      reply.move.from === target ? reply.move.to : target,
                      -delta(reply.before, reply.move),
                      2,
                  )
                : null;
            if (threat && branch)
                result = {
                    gain: Math.min(threat.gain, branch.gain),
                    example: [reply.san, ...branch.line],
                    target,
                    forced: false,
                    threat: threat.line,
                };
        }
    } catch {
        /* Unknown bounded search is not evidence of a tactic. */
    }
    if (nodeLimit === 16384) {
        tacticalPreparationCache.set(key, result);
        if (tacticalPreparationCache.size > 128)
            tacticalPreparationCache.delete(tacticalPreparationCache.keys().next().value!);
    }
    return result;
}

function winningTargets(pos: Chess, from: Square, side: Color) {
    const probe = withTurn(pos, side);
    const piece = probe.board.get(from);
    if (!piece || piece.color !== side) return [];
    return [
        ...attacks(piece, from, probe.board.occupied).intersect(probe.board[opposite(side)]),
    ].filter((to) => {
        const target = probe.board.get(to)!;
        if (target.role === "king") return true;
        const promotions =
            piece.role === "pawn" && (to < 8 || to >= 56)
                ? (["queen", "rook", "bishop", "knight"] as const)
                : [undefined];
        return (
            target.role !== "pawn" &&
            promotions.some(
                (promotion) => tacticalExchangeGain(probe, { from, to, promotion }) >= 100,
            )
        );
    });
}

/** A fork must survive the opponent's choice, including capturing the forker,
 * a checking counterattack, or one move that protects both targets. */
function verifiedFork(step: TacticalReplayStep) {
    const side = step.before.turn;
    const targets = winningTargets(step.after, step.move.to, side);
    if (targets.length < 2) return false;
    const replies = legalMoves(step.after);
    if (!replies.length) return false;
    return replies.every((reply) => {
        // Capturing the forker with a queen can itself lose material after the
        // legal recapture; such a losing defence does not refute the fork.
        const replyGain = capturedValue(step.after, reply)
            ? tacticalExchangeGain(step.after, reply)
            : 0;
        if (replyGain <= -VALUE.king) return false;
        if (replyGain <= -100) return true;
        const next = step.after.clone();
        next.play(reply);
        if (next.board.get(step.move.to)?.color !== side || next.isCheck()) return false;
        return [...targets, reply.to].some((target) => {
            // The target must still be the original enemy piece, not the checking
            // king that moved onto an old target square.
            const victim = next.board.get(target);
            return (
                victim &&
                victim.color !== side &&
                victim.role !== "king" &&
                step.capture -
                    Math.max(0, replyGain) +
                    tacticalExchangeGain(next, { from: step.move.to, to: target }) >=
                    100
            );
        });
    });
}

function hasConcreteThreat(step: TacticalReplayStep) {
    return (
        winningTargets(step.after, step.move.to, step.before.turn).length > 0 ||
        Boolean(discoveredEvidence([step], "available")) ||
        Boolean(interferenceProof(step, "available"))
    );
}

type TrapProof = { gain: number; defenders: { reply: string; answer: string }[] };
const trapProofCache = new Map<string, TrapProof | null>();

export function proveTrappedMaterial(
    step: TacticalReplayStep,
    target: Square,
    nodeLimit = 256,
    pinProofLimit = 8,
): TrapProof | null {
    const key = `${makeFen(step.before.toSetup())}:${step.uci}:${target}`;
    const cacheable = nodeLimit === 256 && pinProofLimit === 8;
    if (cacheable && trapProofCache.has(key)) return trapProofCache.get(key)!;
    const side = step.before.turn;
    const initial =
        step.capture + (step.move.promotion ? VALUE[step.move.promotion] - VALUE.pawn : 0);
    const replies = legalMoves(step.after);
    const defenders: TrapProof["defenders"] = [];
    let minimum = Infinity;
    let nodes = nodeLimit;
    let pinProofs = pinProofLimit;
    const capture = (pos: Chess, to: Square) => {
        let best = -VALUE.king;
        let san = "";
        for (const move of legalMoves(pos).filter((m) => m.to === to)) {
            const gain = tacticalExchangeGain(pos, move);
            if (gain > best) {
                best = gain;
                san = makeSan(pos, move);
            }
        }
        return { gain: best, san };
    };
    let result: TrapProof | null = null;
    try {
        for (const reply of replies) {
            if (--nodes < 0) throw new Error("Trap proof budget exhausted");
            const next = step.after.clone();
            next.play(reply);
            const balance =
                initial -
                capturedValue(step.after, reply) -
                (reply.promotion ? VALUE[reply.promotion] - VALUE.pawn : 0);
            const victim = relocatedSquare(
                { before: step.after, after: next, move: reply },
                target,
            );
            if (victim === undefined) throw new Error("Unknown trapped-piece identity");
            const direct = capture(next, victim);
            if (balance + direct.gain >= initial + 100) {
                minimum = Math.min(minimum, balance + direct.gain);
                continue;
            }
            // If the victim itself escapes, this is not a trap. An unrelated
            // loose piece must not rescue the failed proof.
            if (
                reply.from === target ||
                next.isCheck() ||
                next.board.get(reply.to)?.role === "king"
            )
                throw new Error("Safe escape or checking/king defence");
            // Only the actual moved defender can be the alternative victim.
            // Removing it is a protection probe, never a game continuation.
            const unprotected = next.clone();
            unprotected.board.take(reply.to);
            if (capture(unprotected, victim).gain - direct.gain < 100)
                throw new Error("Not a causal defender");
            let answer = capture(next, reply.to);
            if (balance + answer.gain < initial + 100) {
                for (const move of legalMoves(next)) {
                    if (--nodes < 0) throw new Error("Trap proof budget exhausted");
                    // The defender's pin, not an unrelated capture or
                    // promotion by the answering move, must earn this gain.
                    if (capturedValue(next, move) || move.promotion) continue;
                    const after = next.clone();
                    after.play(move);
                    const continuation: TacticalReplayStep = {
                        before: next,
                        after,
                        move,
                        uci: makeUci(move),
                        san: makeSan(next, move),
                        capture: capturedValue(next, move),
                        balance: 0,
                    };
                    const pinsDefender = relevantRayTactics(continuation).some(
                        (ray) =>
                            ray.kind === "pin" &&
                            ray.front === reply.to &&
                            after.board.get(ray.rear)?.role === "king",
                    );
                    if (!pinsDefender) continue;
                    if (--pinProofs < 0) throw new Error("Trap pin proof budget exhausted");
                    const proof = materialThreatProof(
                        continuation,
                        [victim, reply.to],
                        [...after.board[side]],
                    );
                    if (proof.kind === "proven" && proof.gain > answer.gain)
                        answer = { gain: proof.gain, san: continuation.san };
                    if (balance + answer.gain >= initial + 100) break;
                }
            }
            if (balance + answer.gain < initial + 100)
                throw new Error("Defender saves the trapped piece");
            minimum = Math.min(minimum, balance + answer.gain);
            defenders.push({ reply: makeSan(step.after, reply), answer: answer.san });
        }
        if (replies.length && Number.isFinite(minimum)) result = { gain: minimum, defenders };
    } catch {
        // Incomplete local proof is unknown, not evidence that no tactic exists.
    }
    if (cacheable) {
        trapProofCache.set(key, result);
        if (trapProofCache.size > 256) trapProofCache.delete(trapProofCache.keys().next().value!);
    }
    return result;
}

/** A trap concerns this named piece, not a favourable endpoint elsewhere.
 * Include every defence and every flight/counter-capture by the victim.
 * Extra material must be won beyond the initiating capture itself. Checks
 * alone can immobilize a piece temporarily, so those are not trap proofs. */
function trappedPieceProof(step: TacticalReplayStep, source: TacticalMotifEvidence["source"]) {
    if (step.after.isCheck()) return null;
    const targets = winningTargets(step.after, step.move.to, step.before.turn).filter(
        (target) => step.after.board.get(target)?.role !== "king",
    );
    const proofs = [];
    for (const target of targets) {
        const proof = proveTrappedMaterial(step, target);
        const initial =
            step.capture + (step.move.promotion ? VALUE[step.move.promotion] - VALUE.pawn : 0);
        if (!proof || proof.gain - initial < 100) continue;
        const victim = step.after.board.get(target)!;
        const motif: TacticalMotifEvidence = {
            id: "trappedPiece",
            label: `Trapped ${victim.role[0].toUpperCase()}${victim.role.slice(1)}`,
            source,
            confidence: "high",
            ply: 1,
            moveUci: step.uci,
            value: proof.gain,
            evidence: `${step.san} attacks the ${victim.role} on ${makeSquare(target)}. It has no safe move, including captures.${
                proof.defenders.length
                    ? ` Defending it also concedes material: ${proof.defenders
                          .slice(0, 2)
                          .map((d) => `${d.reply} is answered by ${d.answer}`)
                          .join(
                              "; ",
                          )}. Every legal defence loses material through the trapped piece or its defender.`
                    : " Every legal defence still permits a profitable capture of that same piece."
            }${step.capture ? " This wins additional material beyond the initial capture." : ""}`,
        };
        proofs.push({ motif, target, gain: proof.gain });
    }
    return proofs.sort((a, b) => b.gain - a.gain)[0] ?? null;
}

const DISCOVERED_THEMES = new Set(["discoveredAttack", "discoveredCheck", "doubleCheck"]);
type RevealedRay = { from: Square; target: Square };

/** The moving piece must actually have blocked this unchanged slider before
 * moving. An already-open attack or a newly created ordinary check is not a
 * discovered attack, even if a later PV move wins a queen. */
function revealedRays(step: TacticalReplayStep): RevealedRay[] {
    const result: RevealedRay[] = [];
    const side = step.before.turn;
    for (const from of step.after.board[side]) {
        const piece = step.after.board.get(from)!;
        if (from === step.move.to || !["bishop", "rook", "queen"].includes(piece.role)) continue;
        const previous = step.before.board.get(from);
        if (previous?.color !== side || previous.role !== piece.role) continue;
        const newlyAttacked = attacks(piece, from, step.after.board.occupied)
            .diff(attacks(piece, from, step.before.board.occupied))
            .intersect(step.after.board[opposite(side)]);
        for (const target of newlyAttacked)
            if (between(from, target).has(step.move.from)) result.push({ from, target });
    }
    return result;
}

const discoveryProofCache = new Map<string, number | null>();
const DISCOVERY_NODE_LIMIT = 4096;

/** One extra forcing tempo beyond an immediate material capture. Every legal
 * defence is checked; the battery and its legal recapturers supply the check.
 * The PV is not a defence list. A budget failure is unknown, not a proof. */
export function proveDiscoveredMaterial(
    step: TacticalReplayStep,
    nodeLimit = DISCOVERY_NODE_LIMIT,
) {
    const rays = revealedRays(step);
    if (!rays.length) return null;
    const key = `${makeFen(step.before.toSetup())}:${step.uci}`;
    if (nodeLimit === DISCOVERY_NODE_LIMIT && discoveryProofCache.has(key))
        return discoveryProofCache.get(key)!;
    let nodes = nodeLimit;
    const side = step.before.turn;
    const capturers = [...new Set([...rays.map((r) => r.from), step.move.to])];
    const targets = [
        ...new Set([
            ...rays.map((r) => r.target),
            ...capturers.flatMap((from) => [
                ...attacks(step.after.board.get(from)!, from, step.after.board.occupied).intersect(
                    step.after.board[opposite(side)],
                ),
            ]),
            ...rayTactics(step.after, side)
                .filter((r) => capturers.includes(r.pinner))
                .map((r) => r.rear),
        ]),
    ];
    const visit = (pos: Chess, move: NormalMove) => {
        if (--nodes < 0) throw new Error("Discovery proof budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const delta = (pos: Chess, move: NormalMove) =>
        capturedValue(pos, move) + (move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0);
    const answer = (
        pos: Chess,
        threats: Square[],
        pieces: Square[],
        balance: number,
        extraCheck: boolean,
    ): number | null => {
        if (pos.isEnd()) return null;
        let best = -VALUE.king;
        for (const to of threats) {
            if (pos.board.get(to)?.color !== opposite(side) || pos.board.get(to)?.role === "king")
                continue;
            for (const from of pieces) {
                if (pos.board.get(from)?.color !== side) continue;
                for (const promotion of pos.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
                    ? (["queen", "rook", "bishop", "knight"] as const)
                    : [undefined]) {
                    if (--nodes < 0) throw new Error("Discovery proof budget exhausted");
                    const move: NormalMove = { from, to, promotion };
                    if (!pos.isLegal(move)) continue;
                    const gain = tacticalExchangeGain(pos, move);
                    if (gain <= -VALUE.king) continue;
                    best = Math.max(best, balance + gain);
                }
            }
        }
        if (best >= 100) return best;
        if (!extraCheck) return null;
        for (const move of legalMoves(pos)) {
            if (!pieces.includes(move.from)) continue;
            const next = visit(pos, move);
            if (!next.isCheck()) continue;
            if (next.isCheckmate()) return 10000;
            const gain = defend(
                next,
                threats.filter((to) => to !== move.to),
                pieces.map((sq) => (sq === move.from ? move.to : sq)),
                balance + delta(pos, move),
                false,
            );
            if (gain !== null) return gain;
        }
        return null;
    };
    const defend = (
        pos: Chess,
        threats: Square[],
        pieces: Square[],
        balance: number,
        extraCheck: boolean,
    ): number | null => {
        const replies = legalMoves(pos);
        if (!replies.length) return pos.isCheckmate() ? 10000 : null;
        const king = pos.board.kingOf(pos.turn)!;
        const blocks = [...pos.ctx().checkers].flatMap((from) => [...between(from, king)]);
        let minimum = Infinity;
        for (const reply of replies) {
            const next = visit(pos, reply);
            const movedTargets = threats.map((sq) => (sq === reply.from ? reply.to : sq));
            if (blocks.includes(reply.to)) movedTargets.push(reply.to);
            // A target may take the attacking piece; its legal recapture by
            // a supporter still counts, just as in the immediate proof.
            const remaining =
                delta(pos, reply) && pieces.includes(reply.to)
                    ? [
                          ...new Set([
                              ...pieces,
                              ...legalMoves(next)
                                  .filter((move) => move.to === reply.to)
                                  .map((move) => move.from),
                          ]),
                      ]
                    : pieces;
            const gain = answer(
                next,
                [...new Set(movedTargets)],
                remaining,
                balance - delta(pos, reply),
                extraCheck,
            );
            if (gain === null) return null;
            minimum = Math.min(minimum, gain);
        }
        return Number.isFinite(minimum) ? minimum : null;
    };
    let proof: number | null = null;
    try {
        proof = defend(step.after, targets, capturers, delta(step.before, step.move), true);
    } catch {
        // Incomplete bounded search cannot certify a tactical gain.
    }
    if (nodeLimit === DISCOVERY_NODE_LIMIT) {
        discoveryProofCache.set(key, proof);
        if (discoveryProofCache.size > 256)
            discoveryProofCache.delete(discoveryProofCache.keys().next().value!);
    }
    return proof;
}

function discoveredEvidence(steps: TacticalReplayStep[], source: TacticalMotifEvidence["source"]) {
    const step = steps[0];
    if (!step) return null;
    const rays = revealedRays(step);
    if (!rays.length) return null;
    const kingRay = rays.find((r) => step.after.board.get(r.target)?.role === "king");
    const moved = step.after.board.get(step.move.to)!;
    const targets = [
        ...new Set([
            ...rays.map((r) => r.target),
            ...attacks(moved, step.move.to, step.after.board.occupied).intersect(
                step.after.board[opposite(step.before.turn)],
            ),
        ]),
    ];
    const capturers = [...new Set([...rays.map((r) => r.from), step.move.to])];
    const mate =
        Boolean(kingRay) &&
        (step.after.isCheckmate() ||
            (steps[2]?.after.isCheckmate() && Boolean(proveMateNextTurn(step))) ||
            (steps[4]?.after.isCheckmate() && Boolean(proveMateWithinThree(steps.slice(0, 5)))));
    const proof = mate
        ? null
        : materialThreatProof(
              step,
              targets,
              capturers,
              kingRay ? [...between(kingRay.from, kingRay.target)] : [],
          );
    const gain =
        proof?.kind === "proven" ? proof.gain : !mate ? proveDiscoveredMaterial(step) : null;
    if (!mate && gain === null) return null;
    // A pawn ray uncovered incidentally by a winning knight fork does not
    // explain that fork's payoff. Non-king discoveries need a contribution
    // beyond what the moving piece already forces on its own targets.
    if (!kingRay && gain !== null && verifiedFork(step)) {
        const independentGain = materialThreatGain(
            step,
            winningTargets(step.after, step.move.to, step.before.turn),
            [step.move.to],
        );
        if (independentGain !== null && independentGain >= gain) return null;
    }
    // Do not promote incidental line-opening above a free piece that this
    // move already wins without needing a follow-up threat.
    if (!mate && step.capture && tacticalExchangeGain(step.before, step.move) >= gain!) return null;
    const id = kingRay
        ? step.after.ctx().checkers.size() > 1
            ? "doubleCheck"
            : "discoveredCheck"
        : "discoveredAttack";
    const label =
        id === "doubleCheck" ? "Double Check" : kingRay ? "Discovered Check" : "Discovered Attack";
    const ray = kingRay ?? rays[0];
    const slider = step.after.board.get(ray.from)!;
    const victim = step.after.board.get(ray.target)!;
    const action = `${step.san} vacates ${makeSquare(step.move.from)}, uncovering the ${slider.role} on ${makeSquare(ray.from)} against the ${victim.role} on ${makeSquare(ray.target)}.`;
    const moverTargets = targets.filter(
        (to) => !rays.some((r) => r.target === to) && step.after.board.get(to)?.role !== "king",
    );
    const accompaniment =
        kingRay && moverTargets.length
            ? ` The ${moved.role} on ${makeSquare(step.move.to)} also attacks ${moverTargets.map((to) => `the ${step.after.board.get(to)!.role} on ${makeSquare(to)}`).join(" and ")}.`
            : !kingRay && step.after.isCheck()
              ? ` The moving ${moved.role} gives check, so the opponent cannot simply ignore the exposed attack.`
              : "";
    const consequence = mate
        ? step.after.isCheckmate()
            ? "There is no legal defence: checkmate."
            : "Every legal defence allows the verified short forced mate."
        : `Every legal ${kingRay ? "answer to the discovered check" : "reply"} ${proof?.kind === "proven" ? "concedes material" : "allows material gain or mate with at most one extra checking move, allowing for legal recaptures"}. Captures and interpositions are included in this check.`;
    const motif: TacticalMotifEvidence = {
        id,
        label,
        source,
        confidence: "high",
        ply: 1,
        moveUci: step.uci,
        evidence: `${action}${accompaniment} ${id === "doubleCheck" ? "Both pieces give check. " : ""}${consequence}`,
        value: mate ? 10000 : (gain ?? undefined),
    };
    return { motif, rays, targets };
}

type RayTactic = { kind: "pin" | "skewer"; pinner: Square; front: Square; rear: Square };

function rayTactics(pos: Chess, side: Color): RayTactic[] {
    const rays: RayTactic[] = [];
    for (const pinner of pos.board[side]) {
        const role = pos.board.get(pinner)!.role;
        if (!["bishop", "rook", "queen"].includes(role)) continue;
        for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
        ]) {
            if (role === "bishop" && (!dx || !dy)) continue;
            if (role === "rook" && dx && dy) continue;
            const blockers: Square[] = [];
            for (
                let x = (pinner % 8) + dx, y = Math.floor(pinner / 8) + dy;
                x >= 0 && x < 8 && y >= 0 && y < 8;
                x += dx, y += dy
            ) {
                const sq = y * 8 + x;
                if (pos.board.get(sq)) blockers.push(sq);
                if (blockers.length === 2) break;
            }
            if (blockers.length !== 2) continue;
            const [front, rear] = blockers;
            const a = pos.board.get(front)!,
                b = pos.board.get(rear)!;
            if (a.color === side || b.color === side || VALUE[a.role] === VALUE[b.role]) continue;
            rays.push({
                kind: VALUE[a.role] < VALUE[b.role] ? "pin" : "skewer",
                pinner,
                front,
                rear,
            });
        }
    }
    return rays;
}

/** Prove that the named targets, not an unrelated loose piece elsewhere, yield
 * a gain after every legal defence. Track a target when it moves, consider
 * captures/checks/interpositions, and settle the selected capture legally. */
type MaterialThreatProof =
    | { kind: "proven"; gain: number }
    | { kind: "forcing"; gain: number; checks: string[] }
    | { kind: "refuted"; defence: string; checking: boolean }
    | { kind: "unknown" };
const materialProofCache = new Map<string, MaterialThreatProof>();
function materialThreatGain(step: TacticalReplayStep, targets: Square[], capturers: Square[]) {
    const proof = materialThreatProof(step, targets, capturers);
    return proof.kind === "proven" ? proof.gain : null;
}

function materialThreatProof(
    step: TacticalReplayStep,
    targets: Square[],
    capturers: Square[],
    interpositions: Square[] = [],
    allowMateAnswer = false,
    promotionFrom?: Square,
) {
    const key = `${makeFen(step.after.toSetup())}:${step.capture}:${step.move.promotion}:${targets}:${capturers}:${interpositions}:${allowMateAnswer}:${promotionFrom}`;
    if (materialProofCache.has(key)) return materialProofCache.get(key)!;
    const proof = computeMaterialThreatGain(
        step,
        targets,
        capturers,
        interpositions,
        allowMateAnswer,
        promotionFrom,
    );
    materialProofCache.set(key, proof);
    if (materialProofCache.size > 256)
        materialProofCache.delete(materialProofCache.keys().next().value!);
    return proof;
}

function computeMaterialThreatGain(
    step: TacticalReplayStep,
    targets: Square[],
    capturers: Square[],
    interpositions: Square[],
    allowMateAnswer: boolean,
    promotionFrom?: Square,
): MaterialThreatProof {
    const replies = legalMoves(step.after);
    if (!replies.length) return { kind: "unknown" };
    let minimum = Infinity;
    let incomplete = false;
    const checks: string[] = [];
    let mateNodes = 4096;
    for (const reply of replies) {
        const next = step.after.clone();
        next.play(reply);
        let best = -VALUE.king;
        let unknown = false;
        // Capturing the attacking piece with the skewered queen may itself
        // lose the queen to a supporter. Consider that legal recapture too.
        const availableCapturers =
            (capturedValue(step.after, reply) && capturers.includes(reply.to)) || next.isCheck()
                ? [...new Set([...capturers, ...next.board[step.before.turn]])]
                : capturers;
        const replyTargets = targets
            .filter((original) => {
                const victim = step.after.board.get(original);
                return victim && victim.role !== "king";
            })
            .map((original) => (reply.from === original ? reply.to : original));
        // A forced block on the newly uncovered checking ray can itself be
        // the material target. Do not include arbitrary pieces elsewhere.
        if (interpositions.includes(reply.to)) replyTargets.push(reply.to);
        for (const target of new Set(replyTargets)) {
            if (next.board.get(target)?.color !== opposite(step.before.turn)) continue;
            for (const from of availableCapturers) {
                if (next.board.get(from)?.color !== step.before.turn) continue;
                const promotions =
                    next.board.get(from)?.role === "pawn" && (target < 8 || target >= 56)
                        ? (["queen", "rook", "bishop", "knight"] as const)
                        : [undefined];
                for (const promotion of promotions) {
                    const move: NormalMove = { from, to: target, promotion };
                    if (!next.isLegal(move)) continue;
                    const exchangeGain = tacticalExchangeGain(next, move);
                    if (exchangeGain <= -VALUE.king) {
                        unknown = true;
                        continue;
                    }
                    best = Math.max(
                        best,
                        step.capture +
                            (step.move.promotion ? VALUE[step.move.promotion] - VALUE.pawn : 0) -
                            capturedValue(step.after, reply) -
                            (reply.promotion ? VALUE[reply.promotion] - VALUE.pawn : 0) +
                            exchangeGain,
                    );
                }
            }
        }
        if (
            best < 100 &&
            promotionFrom !== undefined &&
            next.board.get(promotionFrom)?.color === step.before.turn &&
            next.board.get(promotionFrom)?.role === "pawn"
        ) {
            const to = promotionFrom + (step.before.turn === "white" ? 8 : -8);
            if (to >= 0 && to < 64 && (to < 8 || to >= 56)) {
                for (const promotion of ["queen", "rook", "bishop", "knight"] as const) {
                    const move: NormalMove = { from: promotionFrom, to, promotion };
                    if (!next.isLegal(move)) continue;
                    const promoted = next.clone();
                    promoted.play(move);
                    if (promoted.isEnd() && !promoted.isCheckmate()) continue;
                    const gain = tacticalExchangeGain(next, move);
                    if (gain <= -VALUE.king) {
                        unknown = true;
                        continue;
                    }
                    best = Math.max(
                        best,
                        step.capture -
                            capturedValue(step.after, reply) -
                            (reply.promotion ? VALUE[reply.promotion] - VALUE.pawn : 0) +
                            gain,
                    );
                }
            }
        }
        if (best < 100 && allowMateAnswer) {
            for (const move of legalMoves(next)) {
                if (--mateNodes < 0) return { kind: "unknown" };
                const answer = next.clone();
                answer.play(move);
                if (answer.isCheckmate()) {
                    best = 10000;
                    break;
                }
            }
        }
        if (best < 100) {
            if (unknown) {
                incomplete = true;
                continue;
            }
            if (
                next.isCheck() &&
                !next.isCheckmate() &&
                !capturedValue(step.after, reply) &&
                !reply.promotion
            ) {
                checks.push(makeSan(step.after, reply));
                continue;
            }
            return {
                kind: "refuted",
                defence: makeSan(step.after, reply),
                checking: next.isCheck(),
            };
        }
        minimum = Math.min(minimum, best);
    }
    if (incomplete || !Number.isFinite(minimum)) return { kind: "unknown" };
    return checks.length
        ? { kind: "forcing", gain: minimum, checks }
        : { kind: "proven", gain: minimum };
}

function relevantRayTactics(step: TacticalReplayStep) {
    const before = rayTactics(step.before, step.before.turn);
    const moved = step.after.board.get(step.move.to)!;
    return rayTactics(step.after, step.before.turn).filter((ray) => {
        const created = !before.some(
            (r) => r.pinner === ray.pinner && r.front === ray.front && r.rear === ray.rear,
        );
        return (
            created ||
            ray.pinner === step.move.to ||
            attacks(moved, step.move.to, step.after.board.occupied).has(ray.front)
        );
    });
}

function rayMaterialEvidence(
    step: TacticalReplayStep,
    source: TacticalMotifEvidence["source"],
    allowCheckingReplies = false,
) {
    if (
        step.capture >= 320 &&
        tacticalExchangeGain(step.before, step.move) >= 100 &&
        !pinnedRecapturer(step)
    )
        return [];
    const motifs: TacticalMotifEvidence[] = [];
    for (const ray of relevantRayTactics(step)) {
        const proof = materialThreatProof(step, [ray.front, ray.rear], [ray.pinner, step.move.to]);
        if (proof.kind !== "proven" && !(allowCheckingReplies && proof.kind === "forcing"))
            continue;
        const gain = proof.gain;
        const pinner = step.after.board.get(ray.pinner)!;
        const front = step.after.board.get(ray.front)!;
        const rear = step.after.board.get(ray.rear)!;
        motifs.push({
            id: ray.kind,
            label: ray.kind === "pin" ? "Pin" : "Skewer",
            source,
            confidence: proof.kind === "proven" ? "high" : "medium",
            ply: 1,
            moveUci: step.uci,
            value: gain,
            evidence:
                ray.kind === "pin"
                    ? `${step.san} exploits the ${front.role} on ${makeSquare(ray.front)}, pinned to the ${rear.role} on ${makeSquare(ray.rear)} by the ${pinner.role} on ${makeSquare(ray.pinner)}. ${proof.kind === "proven" ? "No legal reply avoids material loss in the immediate exchange." : "Every non-checking reply allows material loss. Checking replies remain, so the capture is a threat, not a guaranteed immediate win."}`
                    : `${step.san} skewers the ${front.role} on ${makeSquare(ray.front)} and the ${rear.role} on ${makeSquare(ray.rear)}. ${proof.kind === "proven" ? "No legal reply saves the rear target without conceding material." : "Every non-checking reply concedes material, but checking defences still need to be met."}`,
        });
    }
    return motifs;
}

/** Board relationships come from the same legal geometry as the classifier,
 * never by parsing explanatory prose or pretending a PV reply is mandatory. */
export function tacticalBoardEvidence(
    fen: string,
    line: string[],
    motif: TacticalMotifEvidence | undefined,
) {
    if (
        !motif?.ply ||
        ![
            "fork",
            "pin",
            "skewer",
            "deflection",
            "interference",
            "trappedPiece",
            "capturingDefender",
            "tacticalPreparation",
            "intermezzo",
            ...DISCOVERED_THEMES,
        ].includes(motif.id)
    )
        return null;
    const step = replayTacticalLine(fen, line.slice(0, motif.ply))[motif.ply - 1];
    if (!step) return null;
    if (motif.id === "intermezzo") {
        const proof = intermediateCaptureProof(step);
        return proof
            ? {
                  square: makeSquare(step.move.to),
                  arrows: [
                      { from: makeSquare(proof.deferred.from), to: makeSquare(proof.deferred.to) },
                  ],
              }
            : null;
    }
    if (motif.id === "tacticalPreparation") {
        const suffix = replayTacticalLine(fen, line).slice(motif.ply - 1);
        const proof = proveQuietTacticalPreparation(suffix);
        if (!proof) return null;
        const check = suffix
            .slice(2)
            .find((next) => next.before.turn === step.before.turn && next.after.isCheck());
        return {
            square: makeSquare(step.move.to),
            arrows: check
                ? [{ from: makeSquare(check.move.from), to: makeSquare(check.move.to) }]
                : [],
        };
    }
    if (motif.id === "capturingDefender") {
        const proof = capturedDefenderProof(step, motif.source);
        if (!proof) return null;
        return {
            square: makeSquare(step.move.to),
            arrows: [
                { from: makeSquare(step.move.to), to: makeSquare(proof.target) },
                ...proof.capturers
                    .filter((from) => from !== step.move.to)
                    .map((from) => ({ from: makeSquare(from), to: makeSquare(proof.target) })),
            ],
        };
    }
    if (motif.id === "trappedPiece") {
        const proof = trappedPieceProof(step, motif.source);
        if (!proof) return null;
        return {
            square: makeSquare(proof.target),
            arrows: [{ from: makeSquare(step.move.to), to: makeSquare(proof.target) }],
        };
    }
    if (motif.id === "interference") {
        const proof = interferenceProof(step, motif.source);
        if (!proof) return null;
        return {
            square: makeSquare(step.move.to),
            arrows: [
                { from: makeSquare(proof.defender), to: makeSquare(step.move.to) },
                { from: makeSquare(proof.capturer), to: makeSquare(proof.target) },
                ...(proof.attacksDefender
                    ? [{ from: makeSquare(step.move.to), to: makeSquare(proof.defender) }]
                    : []),
            ],
        };
    }
    if (motif.id === "deflection") {
        const suffix = replayTacticalLine(fen, line).slice(motif.ply - 1);
        if (!deflectionEvidence(suffix, motif.source)) return null;
        return {
            square: makeSquare(step.move.to),
            arrows: [
                { from: makeSquare(suffix[1].move.from), to: makeSquare(suffix[1].move.to) },
                { from: makeSquare(suffix[2].move.from), to: makeSquare(suffix[2].move.to) },
            ],
        };
    }
    if (DISCOVERED_THEMES.has(motif.id)) {
        const rays = revealedRays(step);
        if (!rays.length) return null;
        const mover = step.after.board.get(step.move.to)!;
        const threats = attacks(mover, step.move.to, step.after.board.occupied).intersect(
            step.after.board[opposite(step.before.turn)],
        );
        return {
            square: makeSquare(step.move.to),
            arrows: [
                ...rays.map((r) => ({ from: makeSquare(r.from), to: makeSquare(r.target) })),
                ...[...threats]
                    .filter((to) => step.after.board.get(to)?.role !== "pawn")
                    .map((to) => ({ from: makeSquare(step.move.to), to: makeSquare(to) })),
            ],
        };
    }
    if (motif.id === "fork" && verifiedFork(step))
        return {
            square: makeSquare(step.move.to),
            arrows: winningTargets(step.after, step.move.to, step.before.turn).map((to) => ({
                from: makeSquare(step.move.to),
                to: makeSquare(to),
            })),
        };
    const ray =
        relevantRayTactics(step).find(
            (r) =>
                r.kind === motif.id &&
                ["proven", "forcing"].includes(
                    materialThreatProof(step, [r.front, r.rear], [r.pinner, step.move.to]).kind,
                ),
        ) ??
        rayTactics(step.after, step.before.turn).find(
            (r) =>
                r.kind === "pin" &&
                motif.id === "pin" &&
                step.after.ctx().blockers.has(r.front) &&
                attacks(step.after.board.get(r.front)!, r.front, step.after.board.occupied).has(
                    step.move.to,
                ),
        );
    if (!ray) return null;
    return {
        square: makeSquare(motif.id === "pin" ? ray.front : step.move.to),
        arrows: [{ from: makeSquare(ray.pinner), to: makeSquare(ray.rear) }],
    };
}

function pinnedRecapturer(step: TacticalReplayStep) {
    const ctx = step.after.ctx();
    return [...step.after.board[step.after.turn]].some((from) => {
        const piece = step.after.board.get(from)!;
        return (
            ctx.blockers.has(from) &&
            attacks(piece, from, step.after.board.occupied).has(step.move.to) &&
            !step.after.isLegal({ from, to: step.move.to })
        );
    });
}

function capturedDefenderProof(
    step: TacticalReplayStep,
    source: TacticalMotifEvidence["source"],
): {
    motif: TacticalMotifEvidence;
    target: Square;
    targets: Square[];
    capturers: Square[];
    gain: number;
    extended: boolean;
} | null {
    const defender = step.before.board.get(step.move.to);
    if (!defender || defender.color === step.before.turn || defender.role === "king") return null;
    const targets = attacks(defender, step.move.to, step.before.board.occupied).intersect(
        step.before.board[defender.color],
    );
    const afterProbe = withTurn(step.after, step.before.turn);
    for (const target of targets) {
        const victim = step.after.board.get(target);
        if (!victim || victim.role === "king" || VALUE[victim.role] < 320) continue;
        const capturers = [...step.after.board[step.before.turn]].filter((from) => {
            if (from === step.move.to || step.before.board.get(from)?.color !== step.before.turn)
                return false;
            const oldGain = tacticalExchangeGain(step.before, { from, to: target });
            const newGain = tacticalExchangeGain(afterProbe, { from, to: target });
            // A geometrical defender that was already pinned was not saving
            // the target. Removing it must improve the legal exchange itself.
            return oldGain > -VALUE.king && newGain - oldGain >= 100;
        });
        if (!capturers.length) continue;
        const directGain = materialThreatGain(step, [target], capturers);
        const relatedRays = rayTactics(step.after, step.before.turn).filter(
            (ray) => ray.front === target && capturers.includes(ray.pinner),
        );
        const moved = step.after.board.get(step.move.to)!;
        const additionalTargets = [
            ...attacks(moved, step.move.to, step.after.board.occupied).intersect(
                step.after.board[opposite(step.before.turn)],
            ),
        ].filter((to) => !["king", "pawn"].includes(step.after.board.get(to)!.role));
        const proofTargets = [
            ...new Set([target, ...relatedRays.map((ray) => ray.rear), ...additionalTargets]),
        ];
        const proofCapturers = [...new Set([...capturers, step.move.to])];
        const gain = directGain ?? proveDefenderCombination(step, proofTargets, proofCapturers);
        if (gain === null) continue;
        if (directGain === null && additionalTargets.length) {
            const independent = materialThreatGain(step, additionalTargets, [step.move.to]);
            if (independent !== null && independent >= gain) continue;
        }
        // Winning a loose queen may incidentally remove a rook's defender.
        // That relationship is not the cause if the capture already earns
        // at least the entire proved gain without exploiting the rook.
        if (tacticalExchangeGain(step.before, step.move) >= gain) continue;
        return {
            target,
            targets: directGain !== null ? [target] : proofTargets,
            capturers: directGain !== null ? capturers : proofCapturers,
            gain,
            extended: directGain === null,
            motif: {
                id: "capturingDefender",
                label: "Removing the Defender",
                source,
                confidence: "high",
                ply: 1,
                moveUci: step.uci,
                value: gain,
                evidence: `${step.san} removes the ${defender.role} on ${makeSquare(step.move.to)} that defended the ${victim.role} on ${makeSquare(target)}${step.after.isCheck() ? ", with check" : ""}. ${directGain !== null ? "Every legal reply allows a profitable capture of that target." : `${additionalTargets.length ? `It also attacks ${additionalTargets.map((to) => `the ${step.after.board.get(to)!.role} on ${makeSquare(to)}`).join(" and ")}. ` : ""}${relatedRays.length ? `Moving the defended piece exposes ${relatedRays.map((ray) => `the ${step.after.board.get(ray.rear)!.role} on ${makeSquare(ray.rear)}`).join(" and ")}. ` : ""}The short combination wins material against every legal reply, including a checking counterattack; captures and exposed attacking pieces are accounted for.`}`,
            },
        };
    }
    return null;
}

const defenderCombinationCache = new Map<string, number | null>();
/** The extra branches must belong to this removal: the defended target,
 * the piece behind it, or a simultaneous attack by the capturing piece.
 * One checking counterattack may be answered; never follow a cooperative PV.
 * Exchange leaves also debit an off-square capture of an attacking piece. */
export function proveDefenderCombination(
    step: TacticalReplayStep,
    targets: Square[],
    capturers: Square[],
    nodeLimit = 4096,
): number | null {
    const key = `${makeFen(step.before.toSetup())}:${step.uci}:${targets}:${capturers}`;
    if (nodeLimit === 4096 && defenderCombinationCache.has(key))
        return defenderCombinationCache.get(key)!;
    let nodes = nodeLimit;
    const delta = (pos: Chess, move: NormalMove) =>
        capturedValue(pos, move) + (move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0);
    const visit = (pos: Chess, move: NormalMove) => {
        if (--nodes < 0) throw new Error("Defender combination proof exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const answer = (
        pos: Chess,
        victims: Square[],
        pieces: Square[],
        balance: number,
        evasion: number,
    ): number | null => {
        if (pos.isEnd()) return null;
        let best = -VALUE.king;
        for (const move of legalMoves(pos)) {
            if (
                !victims.includes(move.to) ||
                !pieces.includes(move.from) ||
                !capturedValue(pos, move)
            )
                continue;
            const gain = tacticalExchangeGain(pos, move);
            if (gain <= -VALUE.king) continue;
            const next = visit(pos, move);
            if (next.isEnd() && !next.isCheckmate()) continue;
            let liability = 0;
            for (const reply of legalMoves(next)) {
                if (
                    reply.to === move.to ||
                    !pieces.includes(reply.to) ||
                    !capturedValue(next, reply)
                )
                    continue;
                if (--nodes < 0) throw new Error("Defender combination proof exhausted");
                const loss = tacticalExchangeGain(next, reply);
                if (loss <= -VALUE.king) throw new Error("Unknown defender combination exchange");
                liability = Math.max(liability, loss);
            }
            best = Math.max(
                best,
                balance + delta(pos, move) - Math.max(delta(pos, move) - gain, liability),
            );
        }
        // Bishop/knight exchange imbalance must not erase a genuine pawn gain.
        if (best >= 90) return best;
        if (!evasion || !pos.isCheck()) return null;
        for (const move of legalMoves(pos)) {
            const next = visit(pos, move);
            const gain = defend(
                next,
                victims.filter((to) => to !== move.to),
                [...new Set(pieces.map((sq) => (sq === move.from ? move.to : sq)))],
                balance + delta(pos, move),
                evasion - 1,
            );
            if (gain !== null) return gain;
        }
        return null;
    };
    const defend = (
        pos: Chess,
        victims: Square[],
        pieces: Square[],
        balance: number,
        evasion: number,
    ): number | null => {
        const replies = legalMoves(pos);
        if (!replies.length) return null;
        let minimum = Infinity;
        for (const reply of replies) {
            const next = visit(pos, reply);
            const movedTargets = victims.map((sq) => (sq === reply.from ? reply.to : sq));
            const movedPieces = pieces.filter((sq) => sq !== reply.to);
            if (delta(pos, reply) && pieces.includes(reply.to)) {
                movedTargets.push(reply.to);
                movedPieces.push(
                    ...legalMoves(next)
                        .filter((move) => move.to === reply.to)
                        .map((move) => move.from),
                );
            }
            const gain = answer(
                next,
                [...new Set(movedTargets)],
                [...new Set(movedPieces)],
                balance - delta(pos, reply),
                evasion,
            );
            if (gain === null) return null;
            minimum = Math.min(minimum, gain);
        }
        return minimum;
    };
    let result: number | null = null;
    try {
        result = defend(step.after, targets, capturers, delta(step.before, step.move), 1);
    } catch {
        /* A bounded incomplete search is not a tactical proof. */
    }
    if (nodeLimit === 4096) {
        defenderCombinationCache.set(key, result);
        if (defenderCombinationCache.size > 256)
            defenderCombinationCache.delete(defenderCombinationCache.keys().next().value!);
    }
    return result;
}

function capturedDefenderEvidence(
    step: TacticalReplayStep,
    source: TacticalMotifEvidence["source"],
) {
    return capturedDefenderProof(step, source)?.motif ?? null;
}

/** A checking capture is an in-between move only when ordering matters:
 * both captures are legal now, every check response preserves extra material,
 * and taking the other target first gives a concrete escape for this victim. */
export function intermediateCaptureProof(step: TacticalReplayStep, nodeLimit = 512) {
    let remaining = nodeLimit;
    if (!step.capture || !step.after.isCheck() || step.move.promotion) return null;
    const victim = step.before.board.get(step.move.to);
    if (!victim || victim.role === "king") return null;
    const rootGain = tacticalExchangeGain(step.before, step.move);
    if (rootGain <= -VALUE.king) return null;
    let best: {
        gain: number;
        extra: number;
        deferred: NormalMove;
        escape: NormalMove;
        evidence: string;
    } | null = null;
    for (const deferred of legalMoves(step.before)) {
        if (--remaining < 0) return null;
        if (
            deferred.from === step.move.from ||
            deferred.to === step.move.to ||
            !capturedValue(step.before, deferred) ||
            deferred.promotion
        )
            continue;
        const deferredGain = tacticalExchangeGain(step.before, deferred);
        if (deferredGain <= -VALUE.king) continue;
        // If the checking piece is taken, its capturer is a related payoff
        // too (e.g. Qxe7 Rxe7), not an arbitrary loose piece elsewhere.
        const gain = materialThreatProof(
            step,
            [deferred.to],
            [deferred.from, step.move.to],
            [step.move.to],
        );
        if (gain.kind !== "proven") continue;
        const extra = gain.gain - Math.max(rootGain, deferredGain);
        if (extra < 90 || (best && extra <= best.extra)) continue;
        const reversed = step.before.clone();
        reversed.play(deferred);
        let escape: NormalMove | undefined;
        for (const reply of legalMoves(reversed)) {
            if (--remaining < 0) return null;
            if (reply.from !== step.move.to && reply.to !== step.move.from) continue;
            const next = reversed.clone();
            next.play(reply);
            const target = reply.from === step.move.to ? reply.to : step.move.to;
            let saved = true;
            for (const take of legalMoves(next).filter(
                (move) => move.to === target && capturedValue(next, move),
            )) {
                if (--remaining < 0) return null;
                const laterGain = tacticalExchangeGain(next, take);
                if (laterGain <= -VALUE.king || laterGain >= 90) {
                    saved = false;
                    break;
                }
            }
            if (saved) {
                escape = reply;
                break;
            }
        }
        if (!escape) continue;
        best = {
            gain: gain.gain,
            extra,
            deferred,
            escape,
            evidence: `${step.san} takes the ${victim.role} with check before ${makeSan(step.before, deferred)}. Every legal answer to the check preserves extra material through the deferred capture or the piece taking the checker. Playing ${makeSan(step.before, deferred)} first allows ${makeSan(reversed, escape)}, preventing an immediate profitable capture of that ${victim.role}. The move order matters, not just the two captures.`,
        };
    }
    return best;
}

/** A capturing deflection needs a defender whose departure actually weakens
 * the named target. Restoring that defender is only a protection probe, not
 * a claimed legal variation. The real root is then checked against every
 * legal reply, including declining the bait and immediate mating answers. */
function deflectionEvidence(steps: TacticalReplayStep[], source: TacticalMotifEvidence["source"]) {
    const [bait, reply, payoff] = steps;
    if (
        !bait ||
        !reply ||
        !payoff ||
        !reply.capture ||
        reply.move.to !== bait.move.to ||
        reply.move.promotion ||
        payoff.capture < 320 ||
        payoff.before.turn !== bait.before.turn
    )
        return null;
    const defender = reply.before.board.get(reply.move.from);
    const victim = reply.before.board.get(payoff.move.to);
    if (
        !defender ||
        !victim ||
        defender.color !== victim.color ||
        victim.role === "king" ||
        !attacks(defender, reply.move.from, reply.before.board.occupied).has(payoff.move.to) ||
        attacks(defender, reply.move.to, reply.after.board.occupied).has(payoff.move.to)
    )
        return null;
    if (
        reply.after.board.get(payoff.move.to)?.role !== victim.role ||
        reply.after.board.get(payoff.move.to)?.color !== victim.color ||
        !reply.after.isLegal(payoff.move)
    )
        return null;
    const restored = reply.after.clone();
    restored.board.take(reply.move.to);
    restored.board.set(reply.move.from, defender);
    const withDefender = tacticalExchangeGain(restored, payoff.move);
    const withoutDefender = tacticalExchangeGain(reply.after, payoff.move);
    if (
        withDefender <= -VALUE.king ||
        withoutDefender <= -VALUE.king ||
        withoutDefender - withDefender < 100
    )
        return null;
    const proof = materialThreatProof(bait, [payoff.move.to], [payoff.move.from], [], true);
    if (
        proof.kind !== "proven" ||
        (bait.capture && tacticalExchangeGain(bait.before, bait.move) >= proof.gain)
    )
        return null;
    const motif: TacticalMotifEvidence = {
        id: "deflection",
        label: "Deflection",
        source,
        confidence: "high",
        ply: 1,
        moveUci: bait.uci,
        value: proof.gain,
        evidence: `${bait.san} draws the ${defender.role} from ${makeSquare(reply.move.from)} to ${makeSquare(reply.move.to)}, removing its protection of the ${victim.role} on ${makeSquare(payoff.move.to)}. In this line, ${reply.san} ${payoff.san} wins that target. Every legal defence concedes material or immediate mate.`,
    };
    return motif;
}

/** Cutting a defensive ray is a candidate, not proof. Removing only the
 * blocker is a protection probe (not a legal variation): the legal exchange
 * on the named target must improve. Then test EVERY real defence, including
 * capturing the blocker, using only that target and the blocking square. */
function interferenceProof(step: TacticalReplayStep, source: TacticalMotifEvidence["source"]) {
    const side = step.before.turn;
    const enemy = opposite(side);
    // An occupied landing square already interrupted this defensive ray.
    if (step.before.board.get(step.move.to)) return null;
    const probe = withTurn(step.after, side);
    const unblocked = probe.clone();
    unblocked.board.take(step.move.to);
    for (const defender of step.before.board[enemy]) {
        const piece = step.before.board.get(defender)!;
        if (!["rook", "bishop", "queen"].includes(piece.role)) continue;
        const targets = attacks(piece, defender, step.before.board.occupied).intersect(
            step.before.board[enemy],
        );
        for (const target of targets) {
            const victim = step.after.board.get(target)!;
            if (victim.role === "king" || VALUE[victim.role] < 320) continue;
            if (!between(defender, target).has(step.move.to)) continue;
            if (attacks(piece, defender, step.after.board.occupied).has(target)) continue;
            const attacksDefender = winningTargets(step.after, step.move.to, side).includes(
                defender,
            );
            const capturer = [...step.after.board[side]].find((from) => {
                if (from === step.move.to) {
                    // A bishop between queen and knight attacks BOTH. Taking
                    // the knight now reopens the queen's ray, but every real
                    // queen retreat can still lose a target. Establish the
                    // queen's actual protection before testing those replies.
                    if (!attacksDefender) return false;
                    const withoutDefender = probe.clone();
                    withoutDefender.board.take(defender);
                    const protectedGain = tacticalExchangeGain(probe, { from, to: target });
                    const exposedGain = tacticalExchangeGain(withoutDefender, { from, to: target });
                    return (
                        protectedGain > -VALUE.king &&
                        exposedGain >= 100 &&
                        exposedGain - protectedGain >= 100
                    );
                }
                const blockedGain = tacticalExchangeGain(probe, { from, to: target });
                const restoredGain = tacticalExchangeGain(unblocked, { from, to: target });
                return (
                    restoredGain > -VALUE.king &&
                    blockedGain >= 100 &&
                    blockedGain - restoredGain >= 100
                );
            });
            if (capturer === undefined) continue;
            const proof = materialThreatProof(
                step,
                [target, ...(attacksDefender ? [defender] : [])],
                [...step.after.board[side]],
                [step.move.to],
                false,
                step.after.board.get(step.move.to)?.role === "pawn" ? step.move.to : undefined,
            );
            if (proof.kind !== "proven") continue;
            if (step.capture && tacticalExchangeGain(step.before, step.move) >= proof.gain)
                continue;
            const motif: TacticalMotifEvidence = {
                id: "interference",
                label: "Interference",
                source,
                confidence: "high",
                ply: 1,
                moveUci: step.uci,
                value: proof.gain,
                evidence: `${step.san} blocks the ${piece.role} on ${makeSquare(defender)} from defending the ${victim.role} on ${makeSquare(target)}${step.after.isCheck() ? ", with check" : ""}.${attacksDefender ? ` It also attacks that ${piece.role}, forcing a choice between the threats.` : ""} Every legal reply allows material gain on these targets or the blocking square${step.after.board.get(step.move.to)?.role === "pawn" && (step.move.to < 16 || step.move.to >= 48) ? ", or through promotion of the blocking pawn" : ""}; legal recaptures are included.`,
            };
            return { motif, defender, target, capturer, attacksDefender };
        }
    }
    return null;
}

export function hasTacticalStart(fen: string, line: string[], allowConditional = true) {
    const steps = replayTacticalLine(fen, line.slice(0, 7));
    const root = steps[0];
    return Boolean(
        root &&
        (root.capture ||
            root.move.promotion ||
            root.after.isCheck() ||
            hasConcreteThreat(root) ||
            proveQuietMateThreat(root) ||
            quietPreparation(steps) ||
            (allowConditional
                ? proveQuietTacticalPreparation(steps)
                : proveQuietTacticalPreparation(steps)?.forced)),
    );
}

function episodeEnd(steps: TacticalReplayStep[], allowConditional = false) {
    for (let i = 0; i < steps.length; i += 2) {
        const step = steps[i];
        if (
            !step.capture &&
            !step.move.promotion &&
            !step.after.isCheck() &&
            !hasConcreteThreat(step) &&
            !proveQuietMateThreat(step) &&
            !quietPreparation(steps.slice(i, i + 5)) &&
            !(i === 0 && allowConditional
                ? proveQuietTacticalPreparation(steps.slice(i, i + 7))
                : proveQuietTacticalPreparation(steps.slice(i, i + 7))?.forced)
        )
            return i;
    }
    return steps.length;
}

function trapIsMainCause(motif: TacticalMotifEvidence, directGain: number) {
    return (
        motif.id === "trappedPiece" &&
        motif.ply === 1 &&
        motif.confidence === "high" &&
        (motif.value ?? 0) - directGain > directGain
    );
}

function causeRank(motif: TacticalMotifEvidence, directGain = 0) {
    // Concrete mechanisms explain why a gain/mate works. Capture, sacrifice,
    // weak-square and final mate tags describe its prerequisites or payoff.
    const mechanismPriority = [
        "deflection",
        "capturingDefender",
        "interference",
        "attraction",
        "fork",
        "pin",
        "skewer",
        "trappedPiece",
        "intermezzo",
        "doubleCheck",
        "discoveredCheck",
        "discoveredAttack",
        "clearance",
        "xRayAttack",
    ];
    const family =
        MECHANISMS.has(motif.id) || trapIsMainCause(motif, directGain)
            ? 0
            : MATE.test(motif.id)
              ? 1
              : 2;
    return (
        family * 1000 + (motif.ply ?? 100) * 20 + Math.max(0, mechanismPriority.indexOf(motif.id))
    );
}

/** A later detector tag must not be anchored to an arbitrary first move.
 * Clearance needs a DIFFERENT friendly piece to use the vacated square in
 * this connected episode for a check, sound capture or concrete threat. */
function hasClearanceFollowup(steps: TacticalReplayStep[], index: number) {
    const root = steps[index];
    let mover = root.move.to;
    for (const next of steps.slice(index + 1)) {
        if (next.before.turn !== root.before.turn) continue;
        if (next.move.from === mover) {
            mover = next.move.to;
            continue;
        }
        const piece = next.before.board.get(next.move.from)!;
        const usesSquare =
            next.move.to === root.move.from ||
            (["rook", "bishop", "queen"].includes(piece.role) &&
                between(next.move.from, next.move.to).has(root.move.from));
        if (
            usesSquare &&
            (next.after.isCheck() ||
                (next.capture > 0 && tacticalExchangeGain(next.before, next.move) >= 100) ||
                hasConcreteThreat(next))
        )
            return next;
    }
    return null;
}

export function auditTacticalMotifs(
    fen: string,
    line: string[],
    proposals: TacticalMotifEvidence[],
    rootCp?: number | null,
) {
    const steps = replayTacticalLine(fen, line);
    if (!steps.length) return [];
    const allowConditional = typeof rootCp === "number" && Number.isFinite(rootCp) && rootCp >= -30;
    const end = episodeEnd(steps, allowConditional);
    if (!end) return [];
    const episode = steps.slice(0, end);
    const attacker = steps[0].before.turn;
    const final = episode.at(-1)!;
    if (final.after.isCheckmate() && final.before.turn !== attacker) return [];
    const mate =
        final.after.isCheckmate() &&
        final.before.turn === attacker &&
        (episode.length !== 3 || Boolean(proveMateNextTurn(steps[0]))) &&
        (episode.length !== 5 || Boolean(proveMateWithinThree(steps)));
    // Settle the last capture; merely ending a PV before a recapture must not
    // turn an equal exchange into "hanging piece" or a winning combination.
    let settled = final.balance;
    try {
        settled -=
            final.after.turn !== attacker
                ? exchange(final.after, final.move.to, { nodes: 256 })
                : 0;
    } catch {
        settled = -VALUE.king;
    }
    const candidates: TacticalMotifEvidence[] = [];
    for (let index = 0; index < episode.length; index += 2) {
        // Later positions are classified separately by the conditional
        // timeline; they cannot rescue an unproved initiating move here.
        const intermediate = index === 0 ? intermediateCaptureProof(episode[index]) : null;
        if (intermediate)
            candidates.push({
                id: "intermezzo",
                label: "Intermediate Check",
                source: proposals[0]?.source ?? "available",
                confidence: "high",
                ply: index + 1,
                moveUci: episode[index].uci,
                value: intermediate.gain,
                evidence: intermediate.evidence,
            });
        const discovery = discoveredEvidence(
            episode.slice(index),
            proposals[0]?.source ?? "available",
        );
        if (discovery) candidates.push({ ...discovery.motif, ply: index + 1 });
        const deflection = deflectionEvidence(
            episode.slice(index),
            proposals[0]?.source ?? "available",
        );
        if (deflection) candidates.push({ ...deflection, ply: index + 1 });
        const interference = interferenceProof(episode[index], proposals[0]?.source ?? "available");
        if (interference) candidates.push({ ...interference.motif, ply: index + 1 });
        const trapped = trappedPieceProof(episode[index], proposals[0]?.source ?? "available");
        if (trapped) candidates.push({ ...trapped.motif, ply: index + 1 });
    }
    // Only the engine-evaluated root may admit a check-tempo threat; never
    // turn unevaluated later PV rows into speculative tactical headlines.
    const rayEvidence = rayMaterialEvidence(
        steps[0],
        proposals[0]?.source ?? "available",
        typeof rootCp === "number" && Number.isFinite(rootCp) && rootCp >= -30,
    );
    candidates.push(...rayEvidence);
    const defenderEvidence = capturedDefenderEvidence(
        steps[0],
        proposals[0]?.source ?? "available",
    );
    if (defenderEvidence) candidates.push(defenderEvidence);
    const quietMate = proveQuietMateThreat(steps[0]);
    const preparation = !quietMate ? quietPreparation(steps) : null;
    const tacticalPreparation =
        !quietMate && !preparation ? proveQuietTacticalPreparation(steps.slice(0, 7)) : null;
    if (tacticalPreparation && (tacticalPreparation.forced || allowConditional)) {
        const victim = steps[0].after.board.get(tacticalPreparation.target)!;
        candidates.push({
            id: "tacticalPreparation",
            label: "Quiet Preparation",
            source: proposals[0]?.source ?? "available",
            confidence: tacticalPreparation.forced ? "high" : "medium",
            ply: 1,
            moveUci: steps[0].uci,
            value: tacticalPreparation.gain,
            evidence: tacticalPreparation.forced
                ? `${steps[0].san} prepares a short forcing combination against the ${victim.role} on ${makeSquare(tacticalPreparation.target)}. Every legal reply allows material gain or mate; for example, ${tacticalPreparation.example.join(" ")}.`
                : `${steps[0].san} threatens ${tacticalPreparation.threat[0]}, leading to mate or winning the ${victim.role} on ${makeSquare(tacticalPreparation.target)}. After ${tacticalPreparation.example[0]}, the short continuation is verified: ${tacticalPreparation.example.slice(1).join(" ")}. Other replies can avoid this particular route; it is a threat, not a forced reply sequence.`,
        });
        const offer = steps[2],
            acceptance = steps[3];
        const offerExchange = offer ? tacticalExchangeGain(offer.before, offer.move) : -VALUE.king;
        if (
            offer &&
            acceptance &&
            offer.after.isCheck() &&
            acceptance.move.to === offer.move.to &&
            acceptance.capture > 0 &&
            tacticalPreparation.example[1] === offer.san &&
            tacticalPreparation.example[2] === acceptance.san &&
            offerExchange > -VALUE.king &&
            offerExchange <= -90
        ) {
            candidates.push({
                id: "sacrifice",
                label: "Sacrifice",
                source: proposals[0]?.source ?? "available",
                confidence: "high",
                ply: 3,
                moveUci: offer.uci,
                value: tacticalPreparation.gain,
                evidence: `${offer.san} offers the ${offer.after.board.get(offer.move.to)!.role}. In this verified continuation, ${acceptance.san} is met by ${tacticalPreparation.example.slice(3).join(" ")}; the sacrifice belongs to this checking move, not the later material capture.`,
            });
        }
    }
    if (quietMate) {
        candidates.push({
            id: "mateThreat",
            label: "Mate Threat",
            source: proposals[0]?.source ?? "available",
            confidence: "high",
            ply: 1,
            moveUci: steps[0].uci,
            evidence: `${steps[0].san} threatens ${quietMate.threat}. All ${quietMate.replyCount} legal ${attacker === "white" ? "Black" : "White"} replies allow mate on the next move; for example, ${quietMate.example.reply} ${quietMate.example.mate}.`,
        });
    }
    if (preparation) {
        candidates.push({
            id: "mateIn3",
            label: "Mating Preparation",
            source: proposals[0]?.source ?? "available",
            confidence: "high",
            ply: 1,
            moveUci: steps[0].uci,
            evidence: `${steps[0].san} is a quiet mating preparation. All ${preparation.replyCount} legal ${attacker === "white" ? "Black" : "White"} replies allow forced mate within two more moves; for example, ${preparation.example.join(" ")}.`,
        });
    }
    // Geometry plus legal replies also proves a fork when a fixed-depth PV is
    // too short for the puzzle classifier's sequence detector.
    if (verifiedFork(steps[0]) && !proposals.some((m) => m.id === "fork" && m.ply === 1)) {
        const targets = winningTargets(steps[0].after, steps[0].move.to, attacker);
        proposals = [
            ...proposals,
            {
                id: "fork",
                label: "Fork",
                source: proposals[0]?.source ?? "available",
                confidence: "high",
                ply: 1,
                moveUci: steps[0].uci,
                evidence: `${steps[0].san} forks the ${targets.map((sq) => `${steps[0].after.board.get(sq)!.role} on ${makeSquare(sq)}`).join(" and ")}; no legal reply saves both targets without conceding material.`,
            },
        ];
    }
    for (let proposal of proposals) {
        // These labels are reconstructed from the actual vacated blocker and
        // proved continuation, not inherited PV-level anchors or gain totals.
        if (
            DISCOVERED_THEMES.has(proposal.id) ||
            ["deflection", "interference", "trappedPiece", "intermezzo"].includes(proposal.id)
        )
            continue;
        if (proposal.id === "promotion" || proposal.id === "underPromotion") {
            const index = episode.findIndex(
                (s) =>
                    s.before.turn === attacker &&
                    s.move.promotion &&
                    (proposal.id !== "underPromotion" || s.move.promotion !== "queen"),
            );
            if (index < 0) continue;
            const promotion = episode[index];
            proposal = {
                ...proposal,
                ply: index + 1,
                moveUci: promotion.uci,
                evidence: `${promotion.san} promotes the pawn to a ${promotion.move.promotion}.`,
            };
        }
        if (proposal.ply === 1 && defenderEvidence && proposal.id === "capturingDefender") continue;
        if (proposal.ply === 1 && rayEvidence.some((m) => m.id === proposal.id)) continue;
        if (preparation && proposal.id === "mateIn3") continue;
        if (
            !MECHANISMS.has(proposal.id) &&
            !CONCRETE_THEMES.has(proposal.id) &&
            !MATE.test(proposal.id)
        )
            continue;
        if (proposal.id === "attraction" && mate) {
            const anchor = episode.findIndex(
                (s, i) =>
                    s.before.turn === attacker &&
                    episode[i + 1]?.before.board.get(episode[i + 1].move.from)?.role === "king" &&
                    episode[i + 1].move.to === s.move.to,
            );
            if (anchor >= 0) {
                const bait = episode[anchor];
                proposal = {
                    ...proposal,
                    ply: anchor + 1,
                    moveUci: bait.uci,
                    value: 10000,
                    evidence: `${bait.san} offers the ${bait.before.board.get(bait.move.from)!.role} on ${makeSquare(bait.move.to)}. After ${episode[anchor + 1].san}, ${final.san} delivers mate.`,
                };
            }
        }
        if (!proposal.ply || proposal.ply > end) continue;
        const step = steps[proposal.ply - 1];
        if (!step || step.before.turn !== attacker || proposal.moveUci !== step.uci) continue;
        if (proposal.id === "clearance") {
            const followup = hasClearanceFollowup(episode, proposal.ply - 1);
            if (!followup) continue;
            proposal = {
                ...proposal,
                label: "Clearance",
                evidence: `${step.san} vacates ${makeSquare(step.move.from)} for ${followup.san} by another piece in this continuation.`,
            };
        }
        // Capturing a free queen can incidentally pin a distant pawn. Only call
        // that capture a pin tactic when a pinned recapturer explains its gain.
        if (
            proposal.id === "pin" &&
            step.capture >= 320 &&
            tacticalExchangeGain(step.before, step.move) >= 100
        ) {
            if (!pinnedRecapturer(step)) continue;
        }
        // A PV cannot establish the all-moves counterfactual required by zugzwang.
        if (
            proposal.id === "zugzwang" ||
            proposal.id === "mateThreat" ||
            proposal.id === "backRank"
        )
            continue;
        let sound = false;
        if (MATE.test(proposal.id)) sound = mate;
        else if (proposal.id === "fork") sound = verifiedFork(step);
        else if (proposal.id === "skewer")
            sound =
                mate || rayMaterialEvidence(step, proposal.source).some((m) => m.id === "skewer");
        else if (proposal.id === "pin")
            sound =
                mate ||
                (pinnedRecapturer(step) && settled >= 100) ||
                rayMaterialEvidence(step, proposal.source).some((m) => m.id === "pin");
        else if (proposal.id === "capturingDefender")
            sound = Boolean(capturedDefenderEvidence(step, proposal.source));
        else if (proposal.id === "attackingF2F7")
            sound = step.capture > 0 && tacticalExchangeGain(step.before, step.move) >= 100;
        else if (proposal.id === "hangingPiece")
            sound = step.capture >= 320 && tacticalExchangeGain(step.before, step.move) >= 100;
        else if (proposal.id === "attacking_undefended_piece")
            sound =
                materialThreatGain(step, winningTargets(step.after, step.move.to, attacker), [
                    step.move.to,
                ]) !== null;
        else if (proposal.id === "sacrifice") {
            const exchangeGain = tacticalExchangeGain(step.before, step.move);
            sound = (mate || settled >= 100) && exchangeGain > -VALUE.king && exchangeGain <= -90;
        } else sound = mate || settled >= 100;
        if (!sound) continue;
        candidates.push({
            ...proposal,
            confidence:
                proposal.id === "fork" ||
                proposal.id === "hangingPiece" ||
                proposal.id === "attackingF2F7"
                    ? "high"
                    : "medium",
        });
    }
    // The loose piece is the cause even when the legacy detector missed it or
    // mapped the label to a later, unrelated capture.
    const root = steps[0];
    const directGain = root.capture ? Math.max(0, tacticalExchangeGain(root.before, root.move)) : 0;
    if (
        root.capture >= 320 &&
        tacticalExchangeGain(root.before, root.move) >= 100 &&
        !candidates.some((m) => m.id === "hangingPiece" && m.ply === 1)
    ) {
        const victim = root.before.board.get(root.move.to);
        if (victim)
            candidates.push({
                id: "hangingPiece",
                label: "Hanging Piece",
                source: proposals[0]?.source ?? "available",
                confidence: "high",
                ply: 1,
                moveUci: root.uci,
                evidence: `${root.san} wins the loose ${victim.role} on ${makeSquare(root.move.to)}.`,
            });
    }
    const specificMate = candidates.find((m) => /Mate$/.test(m.id));
    const fork = candidates.find((m) => m.id === "fork");
    const filtered = candidates
        .filter((m) => {
            if (
                m.id === "intermezzo" &&
                m.ply &&
                candidates.some((other) => other.id === "capturingDefender" && other.ply === m.ply)
            ) {
                const step = steps[m.ply - 1];
                const order = intermediateCaptureProof(step);
                const removal = capturedDefenderProof(step, m.source);
                if (
                    order &&
                    removal &&
                    order.deferred.to === removal.target &&
                    order.gain <= removal.gain
                )
                    return false;
            }
            if (
                m.id === "trappedPiece" &&
                m.ply &&
                candidates.some((other) => other.id === "pin" && other.ply === m.ply)
            ) {
                const step = steps[m.ply - 1];
                const trap = trappedPieceProof(step, m.source);
                if (
                    trap &&
                    relevantRayTactics(step).some(
                        (ray) => ray.kind === "pin" && ray.front === trap.target,
                    )
                )
                    return false;
            }
            if (
                m.id === "clearance" &&
                candidates.some(
                    (other) =>
                        other.ply === m.ply &&
                        (DISCOVERED_THEMES.has(other.id) || other.id === "tacticalPreparation"),
                )
            )
                return false;
            if (
                specificMate &&
                /^mate(?:In\d+)?$/.test(m.id) &&
                !(preparation && m.id === "mateIn3" && m.ply === 1)
            )
                return false;
            if (
                fork?.ply === m.ply &&
                ["clearance", "trappedPiece", "attacking_undefended_piece"].includes(m.id)
            )
                return false;
            if (
                m.id === "attacking_undefended_piece" &&
                candidates.some(
                    (other) => other.ply === m.ply && ["pin", "skewer"].includes(other.id),
                )
            )
                return false;
            if (
                m.id === "hangingPiece" &&
                candidates.some(
                    (other) =>
                        other.ply === m.ply &&
                        ["capturingDefender", "intermezzo"].includes(other.id),
                )
            )
                return false;
            if (
                m.id === "sacrifice" &&
                candidates.some((other) => MECHANISMS.has(other.id) && other.ply === m.ply)
            )
                return false;
            return true;
        })
        .sort((a, b) => {
            // A proved material side-effect does not explain an independent
            // forced mate. Only mechanisms with their own mating evidence
            // may outrank the mating payoff in such a line.
            const matingPriority = (m: TacticalMotifEvidence) =>
                mate && (m.value === 10000 || MATE.test(m.id)) ? 0 : 1;
            return (
                matingPriority(a) - matingPriority(b) ||
                causeRank(a, directGain) - causeRank(b, directGain)
            );
        });
    const immediateLoose = filtered.find((m) => m.id === "hangingPiece" && m.ply === 1);
    if (
        immediateLoose &&
        !filtered.some(
            (m) => m.ply === 1 && (MECHANISMS.has(m.id) || trapIsMainCause(m, directGain)),
        )
    ) {
        filtered.splice(filtered.indexOf(immediateLoose), 1);
        filtered.unshift(immediateLoose);
    }
    // The quiet threat explains the preparation; the final mating pattern is
    // its payoff and stays in the continuation rows.
    const quietCause = filtered.find(
        (m) =>
            (m.id === "mateThreat" ||
                m.id === "tacticalPreparation" ||
                (preparation && m.id === "mateIn3")) &&
            m.ply === 1,
    );
    if (quietCause) {
        filtered.splice(filtered.indexOf(quietCause), 1);
        filtered.unshift(quietCause);
    }
    // A sound exchange at the start of a combination is not a loose piece if
    // its gain depends on a later mechanism (the defender can recapture).
    return filtered.map((motif, index) => ({
        ...motif,
        relevance: index === 0 ? ("primary" as const) : ("secondary" as const),
        value:
            motif.value ??
            (mate || (motif.id === "mateThreat" && quietMate)
                ? 10000
                : motif.id === "hangingPiece" && motif.ply === 1
                  ? tacticalExchangeGain(root.before, root.move)
                  : Math.max(100, settled)),
    }));
}

/** Track the same piece across a choice, including castling's rook and king.
 * If identity is ambiguous, abstain instead of comparing a different target. */
function relocatedSquare(
    step: Pick<TacticalReplayStep, "before" | "after" | "move">,
    square: Square,
    reverse = false,
): Square | undefined {
    const before = reverse ? step.after : step.before;
    const after = reverse ? step.before : step.after;
    const piece = before.board.get(square);
    if (!piece) return undefined;
    if (step.move.promotion && square === (reverse ? step.move.to : step.move.from))
        return reverse ? step.move.from : step.move.to;
    const unchanged = after.board.get(square);
    if (unchanged?.role === piece.role && unchanged.color === piece.color) return square;
    const destinations = [...after.board[piece.color]].filter((to) => {
        const now = after.board.get(to)!,
            previous = before.board.get(to);
        return (
            now.role === piece.role &&
            (previous?.color !== piece.color || previous.role !== piece.role)
        );
    });
    return destinations.length === 1 ? destinations[0] : undefined;
}

function compareMaterialCause(
    actual: TacticalReplayStep[],
    better: TacticalReplayStep[],
    motif: TacticalMotifEvidence,
) {
    const step = actual[1],
        alternative = better[1];
    if (!alternative) return null;
    let targets: Square[] = [],
        capturers: Square[] = [],
        gain: number | null = null;
    let conditional = false;
    if (motif.id === "pin" || motif.id === "skewer") {
        for (const ray of relevantRayTactics(step).filter((r) => r.kind === motif.id)) {
            const proof = materialThreatProof(
                step,
                [ray.front, ray.rear],
                [ray.pinner, step.move.to],
            );
            if (proof.kind !== "proven" && proof.kind !== "forcing") continue;
            targets = [ray.front, ray.rear];
            capturers = [ray.pinner, step.move.to];
            gain = proof.gain;
            conditional = proof.kind === "forcing";
            break;
        }
    } else if (motif.id === "capturingDefender") {
        const proof = capturedDefenderProof(step, motif.source);
        if (proof) {
            // A failed immediate capture probe cannot refute this longer,
            // multi-target combination under an alternative user move.
            if (proof.extended) return null;
            targets = [proof.target];
            capturers = proof.capturers;
            gain = proof.gain;
        }
    } else if (motif.id === "trappedPiece") {
        const proof = trappedPieceProof(step, motif.source);
        if (proof) {
            targets = [proof.target];
            capturers = [...step.after.board[step.before.turn]];
            gain = proof.gain;
        }
    }
    if (gain === null) return null;
    const mapped: Square[] = [];
    for (const square of targets) {
        if (step.after.board.get(square)?.role === "king") continue;
        const original = relocatedSquare(actual[0], square, true);
        const target = original === undefined ? undefined : relocatedSquare(better[0], original);
        if (target === undefined) return null;
        if (alternative.after.board.get(target)?.color !== step.after.board.get(square)?.color)
            return null;
        mapped.push(target);
    }
    if (!mapped.length) return null;
    if (motif.id === "trappedPiece") {
        const trap = proveTrappedMaterial(alternative, mapped[0]);
        if (trap && trap.gain >= gain)
            return {
                comparison: "persists" as const,
                comparisonEvidence: `The same reply still forces material loss through the trapped ${alternative.after.board.get(mapped[0])!.role} after ${better[0].san}.`,
            };
        // A safe flight is positive evidence that this choice avoids the
        // trap. An unproved longer defence must not be called prevention.
        const flight = materialThreatProof(alternative, mapped, capturers);
        if (
            flight.kind === "refuted" &&
            legalMoves(alternative.after).some(
                (m) => m.from === mapped[0] && makeSan(alternative.after, m) === flight.defence,
            )
        )
            return {
                comparison: "prevented" as const,
                comparisonEvidence: `After ${better[0].san}, ${flight.defence} saves the ${alternative.after.board.get(mapped[0])!.role} from ${alternative.san}.`,
            };
        return null;
    }
    const proof = materialThreatProof(alternative, mapped, capturers);
    if (proof.kind === "refuted" && (!conditional || !proof.checking))
        return {
            comparison: "prevented" as const,
            comparisonEvidence: `After ${better[0].san}, ${proof.defence} answers ${alternative.san}; a profitable immediate follow-up capture of ${mapped.map((sq) => `the ${alternative.after.board.get(sq)!.role} on ${makeSquare(sq)}`).join(" or ")} is no longer forced.`,
        };
    if (proof.kind === "proven" && proof.gain >= gain)
        return {
            comparison: "persists" as const,
            comparisonEvidence: `The same reply still forces material loss on those targets after ${better[0].san}.`,
        };
    return null;
}

/** A lesson signature is a locally proved net gain on named enemy pieces,
 * not the PV endpoint's material total or a matching theme name. */
function materialLesson(steps: TacticalReplayStep[], motif: TacticalMotifEvidence) {
    const step = steps[0];
    if (!step || motif.ply !== 1 || motif.moveUci !== step.uci) return null;
    let targets: Square[] = [];
    let gain: number | null = null;
    if (["hangingPiece", "attackingF2F7"].includes(motif.id) && step.capture) {
        targets = [step.move.to];
        gain = tacticalExchangeGain(step.before, step.move);
    } else if (["pin", "skewer"].includes(motif.id)) {
        for (const ray of relevantRayTactics(step).filter((r) => r.kind === motif.id)) {
            const proof = materialThreatProof(
                step,
                [ray.front, ray.rear],
                [ray.pinner, step.move.to],
            );
            if (proof.kind !== "proven") continue;
            targets = [ray.front, ray.rear];
            gain = proof.gain;
            break;
        }
    } else if (motif.id === "capturingDefender") {
        const proof = capturedDefenderProof(step, motif.source);
        if (proof) {
            targets = proof.extended ? [...proof.targets, step.move.to] : [proof.target];
            gain = proof.gain;
        }
    } else if (motif.id === "fork") {
        targets = winningTargets(step.after, step.move.to, step.before.turn);
        gain = targets.length >= 2 ? materialThreatGain(step, targets, [step.move.to]) : null;
    } else if (motif.id === "trappedPiece") {
        const proof = trappedPieceProof(step, motif.source);
        if (proof) {
            targets = [proof.target, ...(step.capture ? [step.move.to] : [])];
            gain = proof.gain;
        }
    } else if (DISCOVERED_THEMES.has(motif.id)) {
        const proof = discoveredEvidence(steps, motif.source);
        if (proof) {
            targets = proof.targets;
            gain = proof.motif.value ?? null;
        }
    }
    targets = [...new Set(targets)].filter((sq) => {
        const victim = step.before.board.get(sq);
        return victim && victim.color === opposite(step.before.turn) && victim.role !== "king";
    });
    return gain !== null && gain >= 100 && gain < 10000 && targets.length
        ? { targets, gain }
        : null;
}

/** The proof's minimum gain can be only a lower bound. Do not dismiss a
 * larger observed loss on the named targets just because the alternative
 * proves that smaller amount. Settle the actual target capture, not a later
 * unrelated capture or the arbitrary end of the engine PV. */
function observedTargetGain(steps: TacticalReplayStep[], targets: Square[]) {
    const side = steps[0].before.turn;
    const remaining = new Set(targets);
    let gain = 0;
    for (const step of steps) {
        if (step.before.turn !== side && remaining.delete(step.move.from))
            remaining.add(step.move.to);
        if (step.before.turn !== side || !step.capture || !remaining.has(step.move.to)) continue;
        const exchangeGain = tacticalExchangeGain(step.before, step.move);
        if (exchangeGain <= -VALUE.king) return Infinity;
        gain = Math.max(
            gain,
            step.balance -
                step.capture -
                (step.move.promotion ? VALUE[step.move.promotion] - VALUE.pawn : 0) +
                exchangeGain,
        );
        remaining.delete(step.move.to);
        if (!remaining.size) break;
    }
    return gain;
}

/** The better choice may change the opponent's reply without saving the
 * threatened material. Use its own legal engine continuation, never replay
 * the actual refutation under a different move. Unknown proofs abstain. */
export function compareBestLineTacticalDefence(
    fen: string,
    playedMove: string | null,
    actualLine: string[],
    bestLine: string[],
    motifs: TacticalMotifEvidence[],
) {
    if (!motifs.length || !playedMove || !bestLine[0] || bestLine[0] === playedMove) return motifs;
    const actual = replayTacticalLine(fen, [playedMove, ...actualLine]);
    const better = replayTacticalLine(fen, bestLine);
    if (actual.length < 2 || better.length < 2) return motifs;
    const attackSteps = replayTacticalLine(
        makeFen(actual[1].before.toSetup()),
        actual.slice(1).map((s) => s.uci),
    );
    const alternativeSteps = replayTacticalLine(
        makeFen(better[1].before.toSetup()),
        better.slice(1).map((s) => s.uci),
    );
    const alternatives = auditTacticalMotifs(
        makeFen(alternativeSteps[0].before.toSetup()),
        alternativeSteps.map((s) => s.uci),
        [],
    )
        .filter((m) => m.ply === 1)
        .map((m) => materialLesson(alternativeSteps, m))
        .filter((proof): proof is NonNullable<typeof proof> => proof !== null);
    if (!alternatives.length) return motifs;
    return motifs.map((motif) => {
        const proof = materialLesson(attackSteps, motif);
        if (!proof) return motif;
        const actualGain = Math.max(proof.gain, observedTargetGain(attackSteps, proof.targets));
        const mapped: Square[] = [];
        for (const square of proof.targets) {
            const original = relocatedSquare(actual[0], square, true);
            const target =
                original === undefined ? undefined : relocatedSquare(better[0], original);
            const victim = actual[1].before.board.get(square)!;
            const alternativeVictim =
                target === undefined ? undefined : better[1].before.board.get(target);
            if (
                target === undefined ||
                alternativeVictim?.role !== victim.role ||
                alternativeVictim.color !== victim.color
            )
                return motif;
            mapped.push(target);
        }
        const identity = [...mapped].sort((a, b) => a - b).join(",");
        if (
            !alternatives.some(
                (other) =>
                    other.gain >= actualGain &&
                    [...other.targets].sort((a, b) => a - b).join(",") === identity,
            )
        )
            return motif;
        const names = mapped
            .map((sq) => `the ${better[1].before.board.get(sq)!.role} on ${makeSquare(sq)}`)
            .join(" and ");
        return {
            ...motif,
            comparison: "persists" as const,
            comparisonEvidence: `Even after ${better[0].san}, ${better[1].san} still forces at least the same net material gain on ${names}. The better move changes the continuation, not the existence of that material loss.`,
        };
    });
}

/** Compare the same immediate reply after the played and best moves. We only
 * make a causal statement where legality/geometry/exchange provides a witness;
 * replaying the old full PV after a different move would assume bad defence. */
export function compareImmediateTacticalDefence(
    fen: string,
    bestMove: string | null,
    playedMove: string | null,
    reply: string | undefined,
    motifs: TacticalMotifEvidence[],
) {
    if (!bestMove || !playedMove || !reply) return motifs;
    const actual = replayTacticalLine(fen, [playedMove, reply]);
    const better = replayTacticalLine(fen, [bestMove, reply]);
    if (actual.length < 2 || !better.length) return motifs;
    const step = actual[1];
    const alternative = better[1];
    const bestSan = better[0].san;
    return motifs.map((motif) => {
        if (motif.ply !== 1 || motif.moveUci !== reply) return motif;
        let comparison: "prevented" | "persists" | undefined;
        let comparisonEvidence = "";
        if (!alternative) {
            comparison = "prevented";
            comparisonEvidence = `${bestSan} makes the immediate reply ${step.san} illegal.`;
        } else if (["pin", "skewer", "capturingDefender", "trappedPiece"].includes(motif.id)) {
            const material = compareMaterialCause(actual, better, motif);
            if (material) return { ...motif, ...material };
        } else if (
            motif.id === "mateThreat" &&
            (alternative.after.isCheckmate() || proveMateNextTurn(alternative))
        ) {
            comparison = "persists";
            comparisonEvidence = `The same immediate reply still forces mate after ${bestSan}.`;
        } else if (
            (MATE.test(motif.id) || DISCOVERED_THEMES.has(motif.id)) &&
            step.after.isCheckmate()
        ) {
            if (!alternative.after.isCheckmate()) {
                const escape =
                    legalMoves(alternative.after).find(
                        (move) => alternative.after.board.get(move.from)?.role === "king",
                    ) ?? legalMoves(alternative.after)[0];
                comparison = "prevented";
                comparisonEvidence = escape
                    ? `After ${bestSan}, ${makeSan(alternative.after, escape)} is a legal answer to ${alternative.san}; it is no longer mate.`
                    : `After ${bestSan}, ${alternative.san} is no longer checkmate.`;
            } else {
                comparison = "persists";
                comparisonEvidence = `The same immediate mate remains after ${bestSan}.`;
            }
        } else if (["hangingPiece", "attackingF2F7"].includes(motif.id)) {
            const gain = tacticalExchangeGain(step.before, step.move);
            const otherGain = tacticalExchangeGain(alternative.before, alternative.move);
            if (gain > 0 && otherGain > -VALUE.king && otherGain <= 0) {
                comparison = "prevented";
                comparisonEvidence = `After ${bestSan}, ${alternative.san} no longer wins material in the exchange.`;
            } else if (gain > 0 && otherGain >= gain) {
                comparison = "persists";
                comparisonEvidence = `The same capture still wins material after ${bestSan}.`;
            }
        } else if (motif.id === "fork") {
            const targets = winningTargets(
                alternative.after,
                alternative.move.to,
                alternative.before.turn,
            );
            if (targets.length < 2) {
                comparison = "prevented";
                comparisonEvidence = `After ${bestSan}, ${alternative.san} no longer has two profitable fork targets.`;
            } else {
                const actualTargets = winningTargets(step.after, step.move.to, step.before.turn);
                if (targets.join(",") === actualTargets.join(",") && verifiedFork(alternative)) {
                    comparison = "persists";
                    comparisonEvidence = `The same immediate fork is still available after ${bestSan}.`;
                }
            }
        }
        return comparison ? { ...motif, comparison, comparisonEvidence } : motif;
    });
}
