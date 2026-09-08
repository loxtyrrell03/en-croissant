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
    "promotionCombination",
    "forcingAttack",
    "doubleThreat",
    "forkPreparation",
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

/** Apply the same exchange context at a newly viewed root as inside a PV.
 * Only trusted, replay-matching history can turn a loose-piece label into
 * an ordinary recapture; other real mechanisms and mating payoffs remain. */
export function filterCompensatedRootCaptures(
    fen: string,
    line: string[],
    motifs: TacticalMotifEvidence[],
    previousFen?: string | null,
    previousMove?: string | null,
) {
    if (!previousFen || !previousMove || !line.length) return motifs;
    const history = replayTacticalLine(previousFen, [previousMove, line[0]]);
    const root = replayTacticalLine(fen, [line[0]])[0];
    if (
        !root ||
        history.length !== 2 ||
        makeFen(history[0].after.toSetup()) !== makeFen(root.before.toSetup()) ||
        !isCompensatedContinuationCapture(history, 1)
    )
        return motifs;
    return motifs.filter((motif) => motif.id !== "hangingPiece" || motif.ply !== 1);
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

type PromotionCombinationProof = {
    gain: number;
    line: string[];
    pawns: Square[];
    controlled: Square[];
    replyCount: number;
    examinedMoves: number;
};
const PROMOTION_COMBINATION_NODE_LIMIT = 131072;
const promotionCombinationCache = new Map<string, PromotionCombinationProof | null>();

/** Nominate advanced passed pawns only after a material concession removes
 * a piece controlling their advance. Every defensive reply is searched;
 * the supplied PV is not used as a substitute for those replies. */
export function provePromotionCombination(
    root: TacticalReplayStep,
    nodeLimit = PROMOTION_COMBINATION_NODE_LIMIT,
): PromotionCombinationProof | null {
    if (
        !root.capture ||
        root.move.promotion ||
        tacticalExchangeGain(root.before, root.move) >= 100 ||
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0
    )
        return null;
    const side = root.before.turn,
        enemy = opposite(side),
        direction = side === "white" ? 8 : -8;
    const defender = root.before.board.get(root.move.to);
    if (!defender || defender.role === "pawn" || defender.role === "king") return null;
    const cacheKey = `${makeFen(root.before.toSetup())}:${root.uci}`;
    if (nodeLimit === PROMOTION_COMBINATION_NODE_LIMIT && promotionCombinationCache.has(cacheKey))
        return promotionCombinationCache.get(cacheKey)!;
    const pawns = [...root.after.board.pieces(side, "pawn")].filter((sq) => {
        const distance = side === "white" ? 7 - Math.floor(sq / 8) : Math.floor(sq / 8);
        return (
            distance >= 1 &&
            distance <= 3 &&
            ![...root.after.board.pieces(enemy, "pawn")].some(
                (other) =>
                    Math.abs((other % 8) - (sq % 8)) <= 1 &&
                    (side === "white" ? other > sq : other < sq),
            )
        );
    });
    if (!pawns.length || pawns.length > 3) return null;
    const controlled = pawns.flatMap((sq) => {
        const path: Square[] = [];
        for (let to = sq + direction; to >= 0 && to < 64; to += direction) {
            if (root.before.board.has(to)) continue;
            const probe = withTurn(root.before, enemy);
            probe.board.take(sq);
            probe.board.set(to, { color: side, role: "pawn" });
            if (probe.isLegal({ from: root.move.to, to })) path.push(to);
        }
        return path;
    });
    if (!controlled.length) return null;
    type Win = { gain: number; line: string[] };
    let nodes = nodeLimit;
    // Keep bounded search order invariant under rank/colour reflection.
    const orderedMoves = (pos: Chess) => {
        const moves = legalMoves(pos);
        return side === "black"
            ? moves
            : moves.sort((a, b) => (a.from ^ 56) - (b.from ^ 56) || (a.to ^ 56) - (b.to ^ 56));
    };
    const visit = (pos: Chess, move: NormalMove) => {
        if (--nodes < 0) throw new Error("Promotion combination budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const delta = (pos: Chess, move: NormalMove) =>
        capturedValue(pos, move) + (move.promotion ? VALUE[move.promotion] - 100 : 0);
    const safeGain = (pos: Chess, balance: number) => {
        if (pos.isEnd()) return pos.isCheckmate() ? 10000 : null;
        if (balance < 100) return null;
        let loss = 0;
        for (const reply of orderedMoves(pos)) {
            const after = visit(pos, reply);
            if (after.isCheckmate()) return null;
            if (!delta(pos, reply)) continue;
            const gain = tacticalExchangeGain(pos, reply);
            if (gain <= -VALUE.king) return null;
            loss = Math.max(loss, gain);
        }
        return balance - loss >= 100 ? balance - loss : null;
    };
    const memo = new Map<string, Win | null>();
    const attack = (
        pos: Chess,
        balance: number,
        pieces: Square[],
        remaining: number,
    ): Win | null => {
        if (remaining <= 0 || pos.isEnd()) return null;
        const key = `${makeFen(pos.toSetup())}:${balance}:${pieces}:${remaining}`;
        if (memo.has(key)) return memo.get(key)!;
        const candidates = orderedMoves(pos).filter(
            (move) =>
                pos.isCheck() ||
                pieces.includes(move.from) ||
                pos.board.get(move.from)?.role === "king",
        );
        // Try to settle a declined sacrifice before expanding a pawn race.
        const prepared = candidates.map((move) => ({ move, next: visit(pos, move) }));
        for (const { move, next } of prepared) {
            const gain = safeGain(next, balance + delta(pos, move));
            if (gain !== null) {
                const result = { gain, line: [makeSan(pos, move)] };
                memo.set(key, result);
                return result;
            }
        }
        prepared.sort(
            (a, b) =>
                Number(b.move.promotion !== undefined) - Number(a.move.promotion !== undefined) ||
                Number(pos.board.get(b.move.from)?.role === "pawn") -
                    Number(pos.board.get(a.move.from)?.role === "pawn"),
        );
        for (const { move, next } of prepared) {
            if (move.promotion && tacticalExchangeGain(pos, move) < 100 && !next.isCheckmate())
                continue;
            const tracked = pieces.map((sq) => (sq === move.from ? move.to : sq));
            const result = defend(next, balance + delta(pos, move), tracked, remaining - 1);
            if (result) {
                const proof = { gain: result.gain, line: [makeSan(pos, move), ...result.line] };
                memo.set(key, proof);
                return proof;
            }
        }
        memo.set(key, null);
        return null;
    };
    const defend = (
        pos: Chess,
        balance: number,
        pieces: Square[],
        remaining: number,
    ): Win | null => {
        if (pos.isEnd()) return pos.isCheckmate() ? { gain: 10000, line: [] } : null;
        let minimum = Infinity,
            example: string[] = [];
        const replies = orderedMoves(pos).sort((a, b) => delta(pos, b) - delta(pos, a));
        for (const reply of replies) {
            const next = visit(pos, reply);
            const tracked = pieces.filter((sq) => next.board.get(sq)?.color === side);
            const continuation = attack(next, balance - delta(pos, reply), tracked, remaining);
            if (!continuation) return null;
            minimum = Math.min(minimum, continuation.gain);
            const branch = [makeSan(pos, reply), ...continuation.line];
            if (branch.length > example.length) example = branch;
        }
        return Number.isFinite(minimum) ? { gain: minimum, line: example } : null;
    };
    let result: PromotionCombinationProof | null = null;
    try {
        const proof = defend(root.after, root.capture, [root.move.to, ...pawns], 8);
        result =
            proof && proof.line.some((san, index) => index % 2 === 1 && /=[QRBN]/.test(san))
                ? {
                      ...proof,
                      pawns,
                      controlled,
                      replyCount: legalMoves(root.after).length,
                      examinedMoves: nodeLimit - nodes,
                  }
                : null;
    } catch {
        // A bounded failure is not proof of a sound sacrifice.
    }
    if (nodeLimit === PROMOTION_COMBINATION_NODE_LIMIT) {
        promotionCombinationCache.set(cacheKey, result);
        if (promotionCombinationCache.size > 128)
            promotionCombinationCache.delete(promotionCombinationCache.keys().next().value!);
    }
    return result;
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

type CheckingMateProof = { maxMoves: number; replyCount: number; example: string[] };
const checkingMateCache = new Map<string, CheckingMateProof | null>();
const CHECKING_MATE_NODE_LIMIT = 65536;

/** A PV ending in mate is only a nomination. All legal defences must
 * lose. Besides checks, at most two PV-nominated quiet attacking moves may
 * be tried; each opens the full legal defensive tree. Unknown/exhausted
 * searches cannot certify the supplied line. */
export function proveCheckingMate(
    steps: TacticalReplayStep[],
    nodeLimit = CHECKING_MATE_NODE_LIMIT,
): CheckingMateProof | null {
    if (!Number.isSafeInteger(nodeLimit) || nodeLimit <= 0) return null;
    const root = steps[0];
    const terminal = steps.findIndex((step) => step.after.isEnd());
    if (
        !root ||
        !root.after.isCheck() ||
        terminal < 0 ||
        terminal > 12 ||
        !steps[terminal].after.isCheckmate() ||
        steps[terminal].before.turn !== root.before.turn
    )
        return null;
    const maxMoves = terminal / 2 + 1;
    const hints = steps
        .slice(0, terminal + 1)
        .filter((s) => s.before.turn === root.before.turn)
        .map((s) => s.uci);
    const quietHints = new Set(
        steps
            .slice(0, terminal + 1)
            .filter((s) => s.before.turn === root.before.turn && !s.after.isCheck())
            .map((s) => s.uci),
    );
    const quietLimit = Math.min(2, quietHints.size);
    const key = `${makeFen(root.after.toSetup())}:${maxMoves}:${hints}:${[...quietHints]}`;
    if (nodeLimit === CHECKING_MATE_NODE_LIMIT && checkingMateCache.has(key))
        return checkingMateCache.get(key)!;
    let nodes = nodeLimit;
    const visit = (pos: Chess, move: NormalMove) => {
        if (--nodes < 0) throw new Error("Checking mate budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const attackMemo = new Map<string, string[] | null>();
    const defendMemo = new Map<string, string[] | null>();
    const attack = (pos: Chess, remaining: number, quiet: number): string[] | null => {
        if (remaining <= 0 || pos.isInsufficientMaterial()) return null;
        const cacheKey = `${makeFen(pos.toSetup())}:${remaining}:${quiet}`;
        if (attackMemo.has(cacheKey)) return attackMemo.get(cacheKey)!;
        const moves = legalMoves(pos);
        const expected = hints[maxMoves - remaining];
        const king = pos.board.kingOf(opposite(pos.turn))!;
        // A legal move can check directly or uncover a friendly slider.
        // Retain all ray-unblocking moves (even blocked/wrong-role rays),
        // en passant and castling: this is only a safe candidate filter.
        const discoveryRays = [
            ...pos.board[pos.turn].intersect(
                pos.board.queen.union(pos.board.rook).union(pos.board.bishop),
            ),
        ].map((square) => between(king, square));
        moves.sort(
            (a, b) =>
                Number(makeUci(b) === expected) - Number(makeUci(a) === expected) ||
                Number(hints.includes(makeUci(b))) - Number(hints.includes(makeUci(a))),
        );
        for (const move of moves) {
            const piece = pos.board.get(move.from)!;
            if (
                !quietHints.has(makeUci(move)) &&
                move.to !== pos.epSquare &&
                !(piece.role === "king" && pos.board[pos.turn].has(move.to)) &&
                !discoveryRays.some((ray) => ray.has(move.from)) &&
                !attacks(
                    { color: pos.turn, role: move.promotion ?? piece.role },
                    move.to,
                    pos.board.occupied.without(move.from).with(move.to),
                ).has(king)
            )
                continue;
            const next = visit(pos, move);
            const isQuiet = !next.isCheck();
            if (isQuiet && (!quiet || !quietHints.has(makeUci(move)))) continue;
            const continuation = defend(next, remaining - 1, quiet - Number(isQuiet));
            if (continuation) {
                const line = [makeSan(pos, move), ...continuation];
                attackMemo.set(cacheKey, line);
                return line;
            }
        }
        attackMemo.set(cacheKey, null);
        return null;
    };
    const defend = (pos: Chess, remaining: number, quiet: number): string[] | null => {
        if (pos.isInsufficientMaterial()) return null;
        const cacheKey = `${makeFen(pos.toSetup())}:${remaining}:${quiet}`;
        if (defendMemo.has(cacheKey)) return defendMemo.get(cacheKey)!;
        const replies = legalMoves(pos);
        if (!replies.length) return pos.isCheck() ? [] : null;
        if (remaining <= 0) return null;
        let longest: string[] | null = null;
        for (const reply of replies) {
            const continuation = attack(visit(pos, reply), remaining, quiet);
            if (!continuation) {
                defendMemo.set(cacheKey, null);
                return null;
            }
            const line = [makeSan(pos, reply), ...continuation];
            if (!longest || line.length > longest.length) longest = line;
        }
        defendMemo.set(cacheKey, longest);
        return longest;
    };
    let proof: CheckingMateProof | null = null;
    try {
        if (root.after.isCheckmate() && nodeLimit > 0)
            proof = { maxMoves: 1, replyCount: 0, example: [root.san] };
        else {
            const continuation = defend(root.after, maxMoves - 1, quietLimit);
            if (continuation)
                proof = {
                    maxMoves,
                    replyCount: legalMoves(root.after).length,
                    example: [root.san, ...continuation],
                };
        }
    } catch {
        /* An incomplete proof cannot certify the supplied continuation. */
    }
    if (nodeLimit === CHECKING_MATE_NODE_LIMIT) {
        checkingMateCache.set(key, proof);
        if (checkingMateCache.size > 128)
            checkingMateCache.delete(checkingMateCache.keys().next().value!);
    }
    return proof;
}

/** One terminal event is one lesson. Conflicting legacy pattern names are
 * not independent tactics; use factual Checkmate until taxonomy is resolved.
 * A root mating preparation is not the terminal event and remains separate. */
export function normalizeMatingPayoffs(
    steps: TacticalReplayStep[],
    motifs: TacticalMotifEvidence[],
) {
    const groups = new Map<number, TacticalMotifEvidence[]>();
    for (const motif of motifs) {
        if (!MATE.test(motif.id) || !motif.ply || !steps[motif.ply - 1]?.after.isCheckmate())
            continue;
        const group = groups.get(motif.ply) ?? [];
        group.push(motif);
        groups.set(motif.ply, group);
    }
    const selected = new Map<number, TacticalMotifEvidence>();
    for (const [ply, group] of groups) {
        const named = [
            ...new Map(group.filter((m) => /Mate$/.test(m.id)).map((m) => [m.id, m])).values(),
        ];
        const motif =
            named.length === 1
                ? named[0]
                : (group.find((m) => m.relevance === "primary") ?? group[0]);
        const specific = named.length === 1;
        const genericId =
            named.length > 1
                ? "mateIn1"
                : (group.find((m) => /^mateIn\d+$/.test(m.id))?.id ?? "mateIn1");
        selected.set(ply, {
            ...motif,
            ...(!specific
                ? { id: genericId, label: "Checkmate", confidence: "high" as const }
                : {}),
            ...(group.some((m) => m.relevance === "primary")
                ? { relevance: "primary" as const }
                : {}),
            evidence: `${steps[ply - 1].san} is checkmate${specific ? ` (${motif.label})` : ""}: the king is in check and there is no legal reply.`,
        });
    }
    const emitted = new Set<number>();
    return motifs.flatMap((motif) => {
        // No material can be won after checkmate. A vacuous "every reply"
        // proof must not turn an irrelevant rook attack into another lesson.
        if (
            motif.ply &&
            steps[motif.ply - 1]?.after.isCheckmate() &&
            [
                "fork",
                "discoveredAttack",
                "hangingPiece",
                "attacking_undefended_piece",
                "skewer",
                "trappedPiece",
            ].includes(motif.id)
        )
            return [];
        if (!motif.ply || !groups.get(motif.ply)?.includes(motif)) return [motif];
        if (emitted.has(motif.ply)) return [];
        emitted.add(motif.ply);
        return [selected.get(motif.ply)!];
    });
}

type TacticalPreparationProof = {
    gain: number;
    example: string[];
    target: Square;
    forced: boolean;
    threat: string[];
    pin?: { pinner: Square; front: Square; rear: Square; checkingMove: NormalMove };
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
        .slice(2, 11)
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
    let moverRole = root.after.board.get(mover)!.role;
    let moverAlive = true;
    let participates = false;
    let pin: TacticalPreparationProof["pin"];
    const newPins = relevantRayTactics(root).filter(
        (ray) =>
            ray.kind === "pin" &&
            ray.pinner === root.move.to &&
            root.after.board.get(ray.rear)?.role === "king" &&
            root.after.ctx().blockers.has(ray.front),
    );
    for (const step of steps.slice(2, 11)) {
        if (step.before.turn !== root.before.turn) continue;
        if (
            step.before.board.get(mover)?.color !== root.before.turn ||
            step.before.board.get(mover)?.role !== moverRole
        )
            moverAlive = false;
        if (moverAlive && step.move.from === mover) {
            mover = step.move.to;
            moverRole = step.after.board.get(mover)!.role;
            if (step.after.isCheck()) participates = true;
        } else if (
            step.after.isCheck() &&
            between(step.move.from, step.move.to).has(root.move.from)
        )
            participates = true;
        // A stationary pinner/checking slider participates just as much as
        // the piece delivering a later moving check. Verify the pinned
        // recapture counterfactually; mere alignment is insufficient.
        if (moverAlive && step.after.ctx().checkers.has(mover)) participates = true;
        for (const ray of newPins) {
            if (!moverAlive) continue;
            if (!step.after.isCheck()) continue;
            const defender = step.after.board.get(ray.front);
            if (!defender || defender.color === root.before.turn) continue;
            const capture = { from: ray.front, to: step.move.to };
            if (
                !attacks(defender, ray.front, step.after.board.occupied).has(step.move.to) ||
                step.after.isLegal(capture)
            )
                continue;
            const unpinned = step.after.clone();
            unpinned.board.take(ray.pinner);
            if (!unpinned.isLegal(capture)) continue;
            participates = true;
            pin = { ...ray, checkingMove: step.move };
        }
    }
    if (!participates) return null;
    const checkLimit = Math.max(2, Math.min(4, steps.indexOf(payoff) / 2 - 1));
    const hints = steps
        .filter((step) => step.before.turn === root.before.turn && step.after.isCheck())
        .map((step) => step.uci);
    const key = `${makeFen(root.before.toSetup())}:${root.uci}:${steps[1]?.uci}:${target}:${hints}:${checkLimit}`;
    if (nodeLimit === 16384 && tacticalPreparationCache.has(key))
        return tacticalPreparationCache.get(key)!;
    const { attack, defend } = preparationSearch(hints, { nodes: nodeLimit });
    const delta = (pos: Chess, move: NormalMove) =>
        capturedValue(pos, move) + (move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0);
    let result: TacticalPreparationProof | null = null;
    try {
        const win = defend(root.after, target, 0, checkLimit);
        if (win)
            result = { gain: win.gain, example: win.line, target, forced: true, threat: [], pin };
        else if (steps[1]) {
            const threat = attack(
                withTurn(root.after, root.before.turn),
                target,
                0,
                checkLimit,
                true,
            );
            const reply = steps[1];
            const branch = threat
                ? attack(
                      reply.after,
                      reply.move.from === target ? reply.move.to : target,
                      -delta(reply.before, reply.move),
                      checkLimit,
                  )
                : null;
            if (threat && branch)
                result = {
                    gain: Math.min(threat.gain, branch.gain),
                    example: [reply.san, ...branch.line],
                    target,
                    forced: false,
                    threat: threat.line,
                    pin,
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

function preparationSearch(hints: string[], budget: { nodes: number }) {
    type Win = { gain: number; line: string[] };
    const delta = (pos: Chess, move: NormalMove) =>
        capturedValue(pos, move) + (move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0);
    const visit = (pos: Chess, move: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Tactical preparation budget exhausted");
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
    return { attack, defend };
}

type CheckingAttackProof = {
    gain: number;
    target: Square;
    branches: { reply: string; line: string[]; gain: number }[];
};
const checkingAttackCache = new Map<string, CheckingAttackProof | null>();

/** A PV only nominates the material target and move ordering. Every defensive
 * branch is independently checked; a branch may end in mate instead. */
export function proveCheckingMaterialAttack(
    steps: TacticalReplayStep[],
    nodeLimit = 16384,
): CheckingAttackProof | null {
    const root = steps[0];
    if (
        !root ||
        root.capture ||
        root.before.isCheck() ||
        !root.after.isCheck() ||
        root.after.isEnd()
    )
        return null;
    const side = root.before.turn;
    const checker = root.after.board.get(root.move.to);
    if (
        !checker ||
        checker.color !== side ||
        !attacks(checker, root.move.to, root.after.board.occupied).has(
            root.after.board.kingOf(opposite(side))!,
        )
    )
        return null;
    const payoffIndex = steps.findIndex(
        (step, i) => i >= 4 && step.before.turn === side && step.capture >= VALUE.knight,
    );
    let target: Square | undefined;
    if (
        payoffIndex >= 4 &&
        payoffIndex <= 8 &&
        !steps
            .slice(0, payoffIndex)
            .some((step) => step.before.turn === side && !step.after.isCheck())
    ) {
        target = steps[payoffIndex].move.to;
        for (const step of steps.slice(1, payoffIndex).reverse())
            if (step.before.turn !== side && step.move.to === target) target = step.move.from;
    } else {
        const piece = root.after.board.get(root.move.to);
        if (!piece || piece.color !== side) return null;
        target = [
            ...attacks(piece, root.move.to, root.after.board.occupied).intersect(
                root.after.board[opposite(side)],
            ),
        ]
            .filter((sq) =>
                ["knight", "bishop", "rook", "queen"].includes(root.after.board.get(sq)!.role),
            )
            .sort(
                (a, b) =>
                    VALUE[root.after.board.get(b)!.role] - VALUE[root.after.board.get(a)!.role],
            )[0];
    }
    if (target === undefined) return null;
    if (root.after.board.get(target)?.color !== opposite(side)) return null;
    const hints = steps
        .slice(0, payoffIndex < 0 ? 9 : payoffIndex)
        .filter((step) => step.before.turn === side)
        .map((step) => step.uci);
    const key = `${makeFen(root.before.toSetup())}:${root.uci}:${target}:${hints}`;
    if (nodeLimit === 16384 && checkingAttackCache.has(key)) return checkingAttackCache.get(key)!;
    const budget = { nodes: nodeLimit };
    const visit = (pos: Chess, move: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Checking attack budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const delta = (pos: Chess, move: NormalMove) =>
        capturedValue(pos, move) + (move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0);
    type Win = { gain: number; line: string[] };
    const attack = (
        pos: Chess,
        square: Square,
        balance: number,
        checks: number,
        pieces: Square[],
    ): Win | null => {
        if (pos.isEnd()) return null;
        const moves = legalMoves(pos).sort(
            (a, b) => Number(hints.includes(makeUci(b))) - Number(hints.includes(makeUci(a))),
        );
        for (const move of moves) {
            if (move.to !== square || !capturedValue(pos, move)) continue;
            const gain = participantCaptureGain(pos, move, [...pieces, move.to], budget);
            if (gain !== null && balance + gain >= 100)
                return { gain: balance + gain, line: [makeSan(pos, move)] };
        }
        if (!checks) return null;
        for (const move of moves) {
            const next = visit(pos, move);
            if (!next.isCheck()) continue;
            if (next.isCheckmate()) return { gain: 10000, line: [makeSan(pos, move)] };
            const win = defend(next, square, balance + delta(pos, move), checks - 1, [
                ...new Set([...pieces.map((sq) => (sq === move.from ? move.to : sq)), move.to]),
            ]);
            if (win) return { gain: win.gain, line: [makeSan(pos, move), ...win.line] };
        }
        return null;
    };
    const defend = (
        pos: Chess,
        square: Square,
        balance: number,
        checks: number,
        pieces: Square[],
    ): Win | null => {
        if (pos.isEnd()) return null;
        let minimum: Win | null = null;
        for (const move of legalMoves(pos)) {
            const next = visit(pos, move);
            const win = attack(
                next,
                move.from === square ? move.to : square,
                balance - delta(pos, move),
                checks,
                pieces.filter((sq) => sq !== move.to),
            );
            if (!win) return null;
            if (!minimum || win.gain < minimum.gain)
                minimum = { gain: win.gain, line: [makeSan(pos, move), ...win.line] };
        }
        return minimum;
    };
    let proof: CheckingAttackProof | null = null;
    try {
        const branches: CheckingAttackProof["branches"] = [];
        for (const reply of legalMoves(root.after)) {
            const next = visit(root.after, reply);
            const win = attack(
                next,
                reply.from === target ? reply.to : target,
                -delta(root.after, reply),
                3,
                reply.to === root.move.to ? [] : [root.move.to],
            );
            if (!win) throw new Error("Unproved checking attack reply");
            branches.push({ reply: makeSan(root.after, reply), ...win });
        }
        const gain = Math.min(...branches.map((branch) => branch.gain));
        // Do not inflate an immediately available material win into a longer
        // attack. Mate-only proofs belong to the existing mate classifier.
        if (
            gain < 10000 &&
            !legalMoves(root.before).some(
                (move) =>
                    move.to === target &&
                    capturedValue(root.before, move) &&
                    tacticalExchangeGain(root.before, move) >= gain,
            )
        )
            proof = { gain, target, branches };
    } catch {
        /* Unknown leaves and exhausted work must not prove an attack. */
    }
    if (nodeLimit === 16384) {
        checkingAttackCache.set(key, proof);
        if (checkingAttackCache.size > 128)
            checkingAttackCache.delete(checkingAttackCache.keys().next().value!);
    }
    return proof;
}

type ForcingClearanceProof = {
    gain: number;
    target: Square;
    branches: { reply: string; preparation: string; from: Square; to: Square }[];
};
const forcingClearanceCache = new Map<string, ForcingClearanceProof | null>();

/** Checking clearance may prepare different quiet slider moves against
 * different king replies. Verify each branch, not just the supplied line. */
export function proveForcingClearance(
    steps: TacticalReplayStep[],
    nodeLimit = 32768,
): ForcingClearanceProof | null {
    const root = steps[0];
    if (!root || root.capture || root.before.isCheck() || !root.after.isCheck()) return null;
    const side = root.before.turn;
    const payoff = steps
        .slice(2, 13)
        .find((s) => s.before.turn === side && s.capture >= VALUE.rook);
    if (!payoff) return null;
    let target = payoff.move.to;
    for (const step of steps.slice(1, steps.indexOf(payoff)).reverse())
        if (step.before.turn !== side && step.move.to === target) target = step.move.from;
    if (root.after.board.get(target)?.color !== opposite(side)) return null;
    const key = `${makeFen(root.before.toSetup())}:${root.uci}:${target}`;
    if (nodeLimit === 32768 && forcingClearanceCache.has(key))
        return forcingClearanceCache.get(key)!;
    const budget = { nodes: nodeLimit };
    const { attack, defend } = preparationSearch([], budget);
    let result: ForcingClearanceProof | null = null;
    try {
        const replies = legalMoves(root.after);
        const branches: ForcingClearanceProof["branches"] = [];
        let minimum = Infinity;
        for (const reply of replies) {
            if (--budget.nodes < 0) throw new Error("Clearance budget exhausted");
            const next = root.after.clone();
            next.play(reply);
            const baseline = attack(
                next,
                reply.from === target ? reply.to : target,
                -capturedValue(root.after, reply),
                4,
            );
            const king = next.board.kingOf(opposite(side))!;
            const candidates = legalMoves(next)
                .filter((move) => {
                    const piece = next.board.get(move.from)!;
                    return (
                        move.from !== root.move.to &&
                        ["bishop", "rook", "queen"].includes(piece.role) &&
                        root.before.board.get(move.from)?.role === piece.role &&
                        (move.to === root.move.from ||
                            between(move.from, move.to).has(root.move.from)) &&
                        !root.before.isLegal(move) &&
                        !capturedValue(next, move)
                    );
                })
                .sort((a, b) => Number(b.to % 8 === king % 8) - Number(a.to % 8 === king % 8));
            let won = false;
            for (const move of candidates) {
                if (--budget.nodes < 0) throw new Error("Clearance budget exhausted");
                const after = next.clone();
                after.play(move);
                if (after.isCheck()) continue;
                const win = defend(
                    after,
                    reply.from === target ? reply.to : target,
                    -capturedValue(root.after, reply),
                    4,
                );
                if (!win || (baseline && baseline.gain >= win.gain)) continue;
                minimum = Math.min(minimum, win.gain);
                branches.push({
                    reply: makeSan(root.after, reply),
                    preparation: makeSan(next, move),
                    from: move.from,
                    to: move.to,
                });
                won = true;
                break;
            }
            if (!won) throw new Error(`Unproved clearance defence ${makeSan(root.after, reply)}`);
        }
        if (branches.length && Number.isFinite(minimum))
            result = { gain: minimum, target, branches };
    } catch {
        // Bounded failure cannot certify a forcing clearance.
    }
    if (nodeLimit === 32768) {
        forcingClearanceCache.set(key, result);
        if (forcingClearanceCache.size > 128)
            forcingClearanceCache.delete(forcingClearanceCache.keys().next().value!);
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
    return immediateFork(step) || provePromotionBackedFork(step) !== null;
}

function checkingForkSearch(side: Color, budget: { nodes: number }) {
    const visit = (pos: Chess, move: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Fork preparation budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const delta = (pos: Chess, move: NormalMove) =>
        capturedValue(pos, move) + (move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0);
    const fork = (pos: Chess, move: NormalMove, pieces: Square[], excluded: Square[] = []) => {
        const after = visit(pos, move);
        const piece = after.board.get(move.to);
        if (!piece || piece.color !== side) return null;
        const targets = [
            ...attacks(piece, move.to, after.board.occupied).intersect(after.board[opposite(side)]),
        ];
        if (!after.isCheck() || !targets.some((sq) => after.board.get(sq)?.role === "king"))
            return null;
        const victims = targets.filter(
            (sq) => !excluded.includes(sq) && !["king", "pawn"].includes(after.board.get(sq)!.role),
        );
        if (!victims.length || after.isEnd()) return null;
        let minimum = Infinity;
        for (const reply of legalMoves(after)) {
            const next = visit(after, reply);
            if (next.isEnd()) return null;
            const capturedForker = reply.to === move.to && capturedValue(after, reply) > 0;
            const named = capturedForker
                ? [move.to]
                : victims.map((sq) => (reply.from === sq ? reply.to : sq));
            let best = -Infinity;
            for (const capture of legalMoves(next)) {
                if (
                    !named.includes(capture.to) ||
                    !capturedValue(next, capture) ||
                    (!capturedForker && capture.from !== move.to)
                )
                    continue;
                const gain = participantCaptureGain(next, capture, pieces, budget);
                if (gain !== null)
                    best = Math.max(best, delta(pos, move) - delta(after, reply) + gain);
            }
            if (best < 100) return null;
            minimum = Math.min(minimum, best);
        }
        return Number.isFinite(minimum)
            ? {
                  gain: minimum,
                  victims,
                  targets: targets
                      .filter((sq) => after.board.get(sq)!.role === "king" || victims.includes(sq))
                      .map((sq) => `${after.board.get(sq)!.role} on ${makeSquare(sq)}`),
              }
            : null;
    };
    return { visit, delta, fork };
}

type ForkPreparationProof = {
    gain: number;
    targets: Square[];
    branches: { reply: string; answer: string; kind: "fork" | "block"; targets: string[] }[];
};
const forkPreparationCache = new Map<string, ForkPreparationProof | null>();

type DoubleThreatProof = {
    gain: number;
    targets: Square[];
    directTargets: Square[];
    threat: NormalMove;
    threatTargets: string[];
    branches: { reply: string; answer: string; kind: "capture" | "fork" }[];
};
const doubleThreatCache = new Map<string, DoubleThreatProof | null>();

/** A fresh direct attack and a NEW checking fork against different material
 * must together defeat every legal reply. A null-move threat only nominates
 * the fork; it is never sufficient evidence on its own. */
export function proveQuietDoubleThreat(
    root: TacticalReplayStep,
    nodeLimit = 8192,
): DoubleThreatProof | null {
    if (
        root.capture ||
        root.move.promotion ||
        root.before.isCheck() ||
        root.after.isCheck() ||
        root.after.isEnd()
    )
        return null;
    const side = root.before.turn;
    const mover = root.after.board.get(root.move.to);
    const previous = root.before.board.get(root.move.from);
    if (!mover || !previous || mover.color !== side) return null;
    const directTargets = winningTargets(root.after, root.move.to, side).filter(
        (sq) => !attacks(previous, root.move.from, root.before.board.occupied).has(sq),
    );
    if (!directTargets.length) return null;
    const key = `${makeFen(root.before.toSetup())}:${root.uci}`;
    if (nodeLimit === 8192 && doubleThreatCache.has(key)) return doubleThreatCache.get(key)!;
    const budget = { nodes: nodeLimit };
    const { visit, delta, fork } = checkingForkSearch(side, budget);
    let proof: DoubleThreatProof | null = null;
    try {
        const probe = withTurn(root.after, side);
        const threats = [];
        for (const move of legalMoves(probe).filter((m) => m.from === root.move.to)) {
            const result = fork(probe, move, [move.to], directTargets);
            if (!result) continue;
            const direct = { ...move, from: root.move.from };
            const existing = root.before.isLegal(direct)
                ? fork(root.before, direct, [direct.to], directTargets)
                : null;
            if (existing && existing.gain >= result.gain) continue;
            threats.push({ move, ...result });
        }
        if (!threats.length) throw new Error("No distinct checking fork threat");
        const targets = [
            ...new Set([...directTargets, ...threats.flatMap((threat) => threat.victims)]),
        ];
        const branches: DoubleThreatProof["branches"] = [];
        let minimum = Infinity;
        let forkThreat: (typeof threats)[number] | undefined;
        for (const reply of legalMoves(root.after)) {
            const next = visit(root.after, reply);
            if (next.isEnd()) throw new Error("Terminal defensive resource");
            const balance = -delta(root.after, reply);
            const mapped = targets.map((sq) => (sq === reply.from ? reply.to : sq));
            let captureAnswer: NormalMove | undefined;
            let captureGain = -Infinity;
            for (const capture of legalMoves(next)) {
                if (!mapped.includes(capture.to) || !capturedValue(next, capture)) continue;
                // The prepared piece supplies ordinary captures. A checking
                // target or one that captures it can also be taken by an ally.
                if (
                    capture.from !== root.move.to &&
                    !(
                        targets.includes(reply.from) &&
                        (next.isCheck() ||
                            (reply.to === root.move.to && capturedValue(root.after, reply)))
                    )
                )
                    continue;
                const gain = participantCaptureGain(
                    next,
                    capture,
                    [root.move.to, capture.to],
                    budget,
                );
                if (gain !== null && balance + gain > captureGain) {
                    captureGain = balance + gain;
                    captureAnswer = capture;
                }
            }
            if (captureAnswer && captureGain >= 100) {
                minimum = Math.min(minimum, captureGain);
                branches.push({
                    reply: makeSan(root.after, reply),
                    answer: makeSan(next, captureAnswer),
                    kind: "capture",
                });
                continue;
            }
            let won = false;
            for (const threat of threats) {
                if (next.board.get(root.move.to)?.color !== side || !next.isLegal(threat.move))
                    continue;
                const result = fork(
                    next,
                    threat.move,
                    [threat.move.to],
                    directTargets.map((sq) => (sq === reply.from ? reply.to : sq)),
                );
                if (!result || balance + result.gain < 100) continue;
                minimum = Math.min(minimum, balance + result.gain);
                branches.push({
                    reply: makeSan(root.after, reply),
                    answer: makeSan(next, threat.move),
                    kind: "fork",
                });
                forkThreat ??= threat;
                won = true;
                break;
            }
            if (!won) throw new Error(`Unproved double-threat reply ${makeSan(root.after, reply)}`);
        }
        if (
            forkThreat &&
            branches.some((branch) => branch.kind === "capture") &&
            Number.isFinite(minimum)
        )
            proof = {
                gain: minimum,
                targets,
                directTargets,
                threat: forkThreat.move,
                threatTargets: forkThreat.targets,
                branches,
            };
    } catch {
        /* An unproved defence, including countercheck, remains unknown. */
    }
    if (nodeLimit === 8192) {
        doubleThreatCache.set(key, proof);
        if (doubleThreatCache.size > 128)
            doubleThreatCache.delete(doubleThreatCache.keys().next().value!);
    }
    return proof;
}

/** A preparatory check must force a profitable checking fork or win a
 * blocking piece on that checking ray. The supplied continuation is not used:
 * king evasions, captures and interpositions are all checked independently. */
export function proveCheckingForkPreparation(
    root: TacticalReplayStep,
    nodeLimit = 4096,
): ForkPreparationProof | null {
    if (root.capture || root.move.promotion || !root.after.isCheck() || root.after.isEnd())
        return null;
    const side = root.before.turn;
    const king = root.after.board.kingOf(opposite(side))!;
    const checker = root.after.board.get(root.move.to);
    // Castling can encode the rook's original square as the king's destination.
    if (
        !checker ||
        checker.color !== side ||
        !attacks(checker, root.move.to, root.after.board.occupied).has(king)
    )
        return null;
    const key = `${makeFen(root.before.toSetup())}:${root.uci}`;
    if (nodeLimit === 4096 && forkPreparationCache.has(key)) return forkPreparationCache.get(key)!;
    const budget = { nodes: nodeLimit };
    const { visit, delta, fork } = checkingForkSearch(side, budget);
    let proof: ForkPreparationProof | null = null;
    try {
        const branches: ForkPreparationProof["branches"] = [];
        const targets = new Set<Square>();
        let minimum = Infinity;
        let hasFork = false;
        for (const reply of legalMoves(root.after)) {
            const next = visit(root.after, reply);
            if (next.isEnd()) throw new Error("Terminal defensive resource");
            const balance = -delta(root.after, reply);
            const blockCapture = { from: root.move.to, to: reply.to };
            if (between(root.move.to, king).has(reply.to) && next.isLegal(blockCapture)) {
                const gain = participantCaptureGain(next, blockCapture, [root.move.to], budget);
                if (gain !== null && balance + gain >= 100) {
                    minimum = Math.min(minimum, balance + gain);
                    branches.push({
                        reply: makeSan(root.after, reply),
                        answer: makeSan(next, blockCapture),
                        kind: "block",
                        targets: [],
                    });
                    targets.add(reply.from);
                    continue;
                }
            }
            let won = false;
            for (const answer of legalMoves(next)) {
                const result = fork(next, answer, [root.move.to, answer.to]);
                if (!result || balance + result.gain < 100) continue;
                const direct = {
                    ...answer,
                    from: answer.from === root.move.to ? root.move.from : answer.from,
                };
                // If the same checking fork already worked without this move,
                // the preparatory check has not explained the gain.
                const baseline = root.before.isLegal(direct)
                    ? fork(root.before, direct, [root.move.from, direct.to])
                    : null;
                if (baseline && baseline.gain >= balance + result.gain) continue;
                minimum = Math.min(minimum, balance + result.gain);
                branches.push({
                    reply: makeSan(root.after, reply),
                    answer: makeSan(next, answer),
                    kind: "fork",
                    targets: result.targets,
                });
                for (const sq of result.victims) targets.add(sq === reply.to ? reply.from : sq);
                hasFork = true;
                won = true;
                break;
            }
            if (!won) throw new Error("A legal defence avoids the preparation");
        }
        if (hasFork && Number.isFinite(minimum))
            proof = { gain: minimum, targets: [...targets], branches };
    } catch {
        /* Unknown branches and exhausted budgets are not a tactical proof. */
    }
    if (nodeLimit === 4096) {
        forkPreparationCache.set(key, proof);
        if (forkPreparationCache.size > 128)
            forkPreparationCache.delete(forkPreparationCache.keys().next().value!);
    }
    return proof;
}

function immediateFork(step: TacticalReplayStep) {
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

type PromotionBackedFork = {
    gain: number;
    pawn: Square;
    promotion: Square;
    defenders: Square[];
    evidence: string;
};
const promotionForkCache = new Map<string, PromotionBackedFork | null>();

/** An attacked defender can take the forker yet abandon a promotion square.
 * Nominate only a pawn whose promotion is currently unprofitable and guarded
 * by a fork target. Every legal reply must then lose on the named fork targets
 * or through this same pawn, including promotion recaptures and stalemate.
 * This reuses the bounded local exchange proof, not a cooperative PV suffix. */
export function provePromotionBackedFork(step: TacticalReplayStep): PromotionBackedFork | null {
    if (step.move.promotion) return null;
    const key = `${makeFen(step.before.toSetup())}:${step.uci}`;
    if (promotionForkCache.has(key)) return promotionForkCache.get(key)!;
    const side = step.before.turn;
    const targets = winningTargets(step.after, step.move.to, side);
    let result: PromotionBackedFork | null = null;
    if (targets.length >= 2) {
        const probe = withTurn(step.after, side);
        for (const pawn of probe.board.pawn.intersect(probe.board[side])) {
            const promotion = pawn + (side === "white" ? 8 : -8);
            if (promotion < 0 || promotion >= 64 || (promotion >= 8 && promotion < 56)) continue;
            const move: NormalMove = { from: pawn, to: promotion, promotion: "queen" };
            // Test the independent promotion BEFORE the checking fork. A null
            // turn after check would wrongly forbid the defender's recapture.
            if (!step.before.isLegal(move)) continue;
            const immediateGains = (["queen", "rook", "bishop", "knight"] as const).map((role) =>
                tacticalExchangeGain(step.before, { ...move, promotion: role }),
            );
            if (immediateGains.some((gain) => gain <= -VALUE.king || gain >= 100)) continue;
            const defenders = targets.filter((target) => {
                const piece = probe.board.get(target)!;
                return (
                    piece.role !== "king" &&
                    attacks(piece, target, probe.board.occupied).has(promotion)
                );
            });
            if (!defenders.length) continue;
            const proof = materialThreatProof(step, targets, [step.move.to], [], false, pawn);
            if (proof.kind !== "proven") continue;
            const branch = legalMoves(step.after).flatMap((reply) => {
                if (!defenders.includes(reply.from) || reply.to !== step.move.to) return [];
                const next = step.after.clone();
                next.play(reply);
                if (!next.isLegal(move)) return [];
                const promoted = next.clone();
                promoted.play(move);
                if (promoted.isEnd() && !promoted.isCheckmate()) return [];
                const gain = tacticalExchangeGain(next, move);
                if (
                    gain <= -VALUE.king ||
                    step.capture - capturedValue(step.after, reply) + gain < 100
                )
                    return [];
                return [`${makeSan(step.after, reply)} ${makeSan(next, move)}`];
            });
            if (!branch.length) continue;
            result = {
                gain: proof.gain,
                pawn,
                promotion,
                defenders,
                evidence: `${step.san} forks the ${targets.map((sq) => `${step.after.board.get(sq)!.role} on ${makeSquare(sq)}`).join(" and ")}. The ${defenders.map((sq) => `${step.after.board.get(sq)!.role} on ${makeSquare(sq)}`).join(" and ")} also guards ${makeSquare(promotion)}: capturing the forking piece allows promotion (${branch[0]}). Every legal reply concedes material on the fork targets or through this pawn's promotion; legal recaptures are included.`,
            };
            break;
        }
    }
    promotionForkCache.set(key, result);
    if (promotionForkCache.size > 256)
        promotionForkCache.delete(promotionForkCache.keys().next().value!);
    return result;
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

type ExchangeDiscoveryProof = {
    gain: number;
    example: string[];
    exchangeFrom: Square;
    exchangeTarget: Square;
};
const exchangeDiscoveryCache = new Map<string, ExchangeDiscoveryProof | null>();

/** A newly opened battery and the moving piece can overload a shared defender.
 * If a target escapes while guarding another target, allow one capture of that
 * defender, with every subsequent reply checked by the defender-removal proof.
 * The complete outer/inner search shares one budget; PV replies nominate nothing. */
export function proveExchangeDiscovery(
    step: TacticalReplayStep,
    nodeLimit = 8192,
): ExchangeDiscoveryProof | null {
    const rays = revealedRays(step);
    if (!rays.length) return null;
    const key = `${makeFen(step.before.toSetup())}:${step.uci}`;
    if (nodeLimit === 8192 && exchangeDiscoveryCache.has(key))
        return exchangeDiscoveryCache.get(key)!;
    const side = step.before.turn;
    const pieces = [...new Set([step.move.to, ...rays.map((r) => r.from)])];
    const targets = [
        ...new Set(
            pieces.flatMap((from) => [
                ...attacks(step.after.board.get(from)!, from, step.after.board.occupied).intersect(
                    step.after.board[opposite(side)],
                ),
            ]),
        ),
    ];
    if (targets.length < 2) return null;
    const budget = { nodes: nodeLimit };
    const delta = (pos: Chess, move: NormalMove) =>
        capturedValue(pos, move) + (move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0);
    let result: ExchangeDiscoveryProof | null = null;
    try {
        const replies = legalMoves(step.after);
        let minimum = Infinity;
        let witness: Omit<ExchangeDiscoveryProof, "gain"> | null = null;
        for (const reply of replies) {
            if (--budget.nodes < 0) throw new Error("Exchange discovery proof exhausted");
            const pos = step.after.clone();
            pos.play(reply);
            if (pos.isEnd()) throw new Error("Terminal defence");
            const balance = delta(step.before, step.move) - delta(step.after, reply);
            const victims = targets
                .map((to) => (to === reply.from ? reply.to : to))
                .filter((to) => pos.board.get(to)?.color === opposite(side));
            if (pos.isCheck()) victims.push(...pos.ctx().checkers);
            let best = -VALUE.king;
            const moves = legalMoves(pos).filter(
                (m) => victims.includes(m.to) && capturedValue(pos, m),
            );
            for (const move of moves) {
                const gain = participantCaptureGain(pos, move, pieces, budget);
                if (gain !== null) best = Math.max(best, balance + gain);
            }
            if (best < 100) {
                for (const move of moves) {
                    const defender = pos.board.get(move.to)!;
                    const guarded = victims.filter(
                        (to) =>
                            to !== move.to &&
                            pos.board.get(to)?.role !== "king" &&
                            attacks(defender, move.to, pos.board.occupied).has(to),
                    );
                    if (!guarded.length) continue;
                    if (--budget.nodes < 0) throw new Error("Exchange discovery proof exhausted");
                    const after = pos.clone();
                    after.play(move);
                    const exchangeStep: TacticalReplayStep = {
                        before: pos,
                        after,
                        move,
                        uci: makeUci(move),
                        san: makeSan(pos, move),
                        capture: capturedValue(pos, move),
                        balance: delta(pos, move),
                    };
                    const gain = proveDefenderCombination(
                        exchangeStep,
                        victims.filter((to) => to !== move.to),
                        [...new Set([...pieces.filter((from) => from !== move.from), move.to])],
                        nodeLimit,
                        budget,
                        2,
                    );
                    if (gain === null || balance + gain < 100) continue;
                    best = balance + gain;
                    witness = {
                        example: [makeSan(step.after, reply), makeSan(pos, move)],
                        exchangeFrom: move.from,
                        exchangeTarget: move.to,
                    };
                    break;
                }
            }
            if (best < 100 || budget.nodes < 0)
                throw new Error(
                    `Unproved defensive branch ${makeSan(step.after, reply)} ${budget.nodes}`,
                );
            minimum = Math.min(minimum, best);
        }
        if (witness && Number.isFinite(minimum)) result = { gain: minimum, ...witness };
    } catch {
        // A missing branch or exhausted shared budget is unknown, never a proof.
    }
    if (nodeLimit === 8192) {
        exchangeDiscoveryCache.set(key, result);
        if (exchangeDiscoveryCache.size > 128)
            exchangeDiscoveryCache.delete(exchangeDiscoveryCache.keys().next().value!);
    }
    return result;
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
    const directGain =
        proof?.kind === "proven" ? proof.gain : !mate ? proveDiscoveredMaterial(step) : null;
    const exchange = !mate && directGain === null ? proveExchangeDiscovery(step) : null;
    const gain = directGain ?? exchange?.gain ?? null;
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
        (kingRay || exchange) && moverTargets.length
            ? ` The ${moved.role} on ${makeSquare(step.move.to)} also attacks ${moverTargets.map((to) => `the ${step.after.board.get(to)!.role} on ${makeSquare(to)}`).join(" and ")}.`
            : !kingRay && step.after.isCheck()
              ? ` The moving ${moved.role} gives check, so the opponent cannot simply ignore the exposed attack.`
              : "";
    const consequence = mate
        ? step.after.isCheckmate()
            ? "There is no legal defence: checkmate."
            : "Every legal defence allows the verified short forced mate."
        : exchange
          ? `The shared defence cannot save all these targets: after ${exchange.example[0]}, ${exchange.example[1]} removes the defender. Every legal reply permits a local material gain, including the defender exchange and up to two checking counterattacks; recaptures and exposed attacking pieces are included.`
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
    | { kind: "proven"; gain: number; complete: boolean; defence: string }
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
    let complete = true;
    let limitingDefence = "";
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
        if (unknown) complete = false;
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
        if (best < minimum) {
            minimum = best;
            limitingDefence = makeSan(step.after, reply);
        }
    }
    if (incomplete || !Number.isFinite(minimum)) return { kind: "unknown" };
    return checks.length
        ? { kind: "forcing", gain: minimum, checks }
        : { kind: "proven", gain: minimum, complete, defence: limitingDefence };
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

/** The pin must actually forbid capturing the checking/attacking piece.
 * An unrelated geometric pin elsewhere in a mating PV is not evidence. */
function pinRestrictsCapture(step: TacticalReplayStep) {
    return rayTactics(step.after, step.before.turn).find((ray) => {
        if (ray.kind !== "pin" || step.after.board.get(ray.rear)?.role !== "king") return false;
        const capture = { from: ray.front, to: step.move.to };
        if (step.after.isLegal(capture)) return false;
        const unpinned = step.after.clone();
        unpinned.board.take(ray.pinner);
        return unpinned.isLegal(capture);
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
            "promotionCombination",
            "forcingAttack",
            "doubleThreat",
            "forkPreparation",
            "fork",
            "pin",
            "skewer",
            "deflection",
            "interference",
            "trappedPiece",
            "capturingDefender",
            "tacticalPreparation",
            "clearance",
            "intermezzo",
            ...DISCOVERED_THEMES,
        ].includes(motif.id)
    )
        return null;
    const step = replayTacticalLine(fen, line.slice(0, motif.ply))[motif.ply - 1];
    if (!step) return null;
    if (motif.id === "promotionCombination") {
        const proof = provePromotionCombination(step);
        return proof
            ? {
                  square: makeSquare(step.move.to),
                  arrows: [
                      ...proof.pawns.map((from) => ({
                          from: makeSquare(from),
                          to: makeSquare(from + (step.before.turn === "white" ? 8 : -8)),
                      })),
                      ...proof.controlled.map((to) => ({
                          from: makeSquare(step.move.to),
                          to: makeSquare(to),
                      })),
                  ],
              }
            : null;
    }
    if (motif.id === "forcingAttack")
        return {
            square: makeSquare(step.move.to),
            arrows: [
                {
                    from: makeSquare(step.move.to),
                    to: makeSquare(step.after.board.kingOf(opposite(step.before.turn))!),
                },
            ],
        };
    if (motif.id === "doubleThreat") {
        const proof = proveQuietDoubleThreat(step);
        if (proof)
            return {
                square: makeSquare(step.move.to),
                // Only draw attacks present now. The next-move fork is
                // explained in words and gets its own actual-ply geometry.
                arrows: proof.directTargets.map((to) => ({
                    from: makeSquare(step.move.to),
                    to: makeSquare(to),
                })),
            };
    }
    if (motif.id === "forkPreparation" && proveCheckingForkPreparation(step))
        return {
            square: makeSquare(step.move.to),
            arrows: [
                {
                    from: makeSquare(step.move.to),
                    to: makeSquare(step.after.board.kingOf(opposite(step.before.turn))!),
                },
            ],
        };
    if (motif.id === "clearance") {
        const suffix = replayTacticalLine(fen, line).slice(motif.ply - 1);
        const proof = proveForcingClearance(suffix);
        if (proof)
            return {
                square: makeSquare(step.move.from),
                arrows: proof.branches
                    .filter((branch) => branch.reply === suffix[1]?.san)
                    .map((branch) => ({
                        from: makeSquare(branch.from),
                        to: makeSquare(branch.to),
                    })),
            };
    }
    if (motif.id === "pin") {
        const proof = proveQuietTacticalPreparation(
            replayTacticalLine(fen, line).slice(motif.ply - 1),
        );
        if (proof?.pin)
            return {
                square: makeSquare(proof.pin.front),
                arrows: [
                    { from: makeSquare(proof.pin.pinner), to: makeSquare(proof.pin.rear) },
                    {
                        from: makeSquare(proof.pin.checkingMove.from),
                        to: makeSquare(proof.pin.checkingMove.to),
                    },
                ],
            };
    }
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
    if (motif.id === "fork" && verifiedFork(step)) {
        const promotion = !immediateFork(step) ? provePromotionBackedFork(step) : null;
        const pin = pinRestrictsCapture(step);
        return {
            square: makeSquare(step.move.to),
            arrows: [
                ...winningTargets(step.after, step.move.to, step.before.turn).map((to) => ({
                    from: makeSquare(step.move.to),
                    to: makeSquare(to),
                })),
                ...(pin ? [{ from: makeSquare(pin.pinner), to: makeSquare(pin.rear) }] : []),
                ...(promotion
                    ? [
                          { from: makeSquare(promotion.pawn), to: makeSquare(promotion.promotion) },
                          ...promotion.defenders.map((from) => ({
                              from: makeSquare(from),
                              to: makeSquare(promotion.promotion),
                          })),
                      ]
                    : []),
            ],
        };
    }
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
type ProofBudget = { nodes: number };

function participantCaptureGain(
    pos: Chess,
    move: NormalMove,
    pieces: Square[],
    budget: ProofBudget,
) {
    if (--budget.nodes < 0) throw new Error("Participant capture proof exhausted");
    const gain = tacticalExchangeGain(pos, move);
    if (gain <= -VALUE.king) return null;
    const next = pos.clone();
    next.play(move);
    if (next.isEnd() && !next.isCheckmate()) return null;
    let liability = 0;
    for (const reply of legalMoves(next)) {
        if (reply.to === move.to || !pieces.includes(reply.to) || !capturedValue(next, reply))
            continue;
        if (--budget.nodes < 0) throw new Error("Participant capture proof exhausted");
        const loss = tacticalExchangeGain(next, reply);
        if (loss <= -VALUE.king) throw new Error("Unknown participant exchange");
        liability = Math.max(liability, loss);
    }
    const delta =
        capturedValue(pos, move) + (move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0);
    return delta - Math.max(delta - gain, liability);
}

/** The extra branches must belong to this removal: the defended target,
 * the piece behind it, or a simultaneous attack by the capturing piece.
 * One checking counterattack may be answered; never follow a cooperative PV.
 * Exchange leaves also debit an off-square capture of an attacking piece. */
export function proveDefenderCombination(
    step: TacticalReplayStep,
    targets: Square[],
    capturers: Square[],
    nodeLimit = 4096,
    sharedBudget?: ProofBudget,
    evasionLimit = 1,
): number | null {
    const key = `${makeFen(step.before.toSetup())}:${step.uci}:${targets}:${capturers}:${evasionLimit}`;
    if (!sharedBudget && nodeLimit === 4096 && defenderCombinationCache.has(key))
        return defenderCombinationCache.get(key)!;
    const budget = sharedBudget ?? { nodes: nodeLimit };
    const delta = (pos: Chess, move: NormalMove) =>
        capturedValue(pos, move) + (move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0);
    const visit = (pos: Chess, move: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Defender combination proof exhausted");
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
        retained: boolean,
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
            const gain = participantCaptureGain(pos, move, pieces, budget);
            if (gain !== null) best = Math.max(best, balance + gain);
        }
        // Bishop/knight exchange imbalance must not erase a genuine pawn gain.
        if (best >= 90) return best;
        // A checking sacrifice may already have donated a target. After the
        // next defence saves the other target, prove an actual safe move that
        // retains that earned gain instead of demanding another capture.
        if (retained && !pos.isCheck()) {
            for (const move of legalMoves(pos)) {
                if (capturedValue(pos, move) || move.promotion) continue;
                const gain = participantCaptureGain(pos, move, pieces, budget);
                if (gain !== null && balance + gain >= 90) return balance + gain;
            }
        }
        if (!evasion || !pos.isCheck()) return null;
        for (const move of legalMoves(pos)) {
            const next = visit(pos, move);
            const gain = defend(
                next,
                victims.filter((to) => to !== move.to),
                [...new Set([...pieces.map((sq) => (sq === move.from ? move.to : sq)), move.to])],
                balance + delta(pos, move),
                evasion - 1,
                retained || capturedValue(pos, move) > 0,
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
        retained = false,
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
                retained,
            );
            if (gain === null) return null;
            minimum = Math.min(minimum, gain);
        }
        return minimum;
    };
    let result: number | null = null;
    try {
        result = defend(
            step.after,
            targets,
            capturers,
            delta(step.before, step.move),
            evasionLimit,
        );
    } catch {
        /* A bounded incomplete search is not a tactical proof. */
    }
    if (!sharedBudget && nodeLimit === 4096) {
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
            const victim = step.after.board.get(target);
            // En passant removes a pre-move target from a different square.
            // Only a surviving enemy piece can still need this defence.
            if (
                !victim ||
                victim.color !== enemy ||
                victim.role === "king" ||
                VALUE[victim.role] < 320
            )
                continue;
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
    const steps = replayTacticalLine(fen, line.slice(0, 11));
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
                ? proveQuietTacticalPreparation(steps.slice(i, i + 11))
                : proveQuietTacticalPreparation(steps.slice(i, i + 11))?.forced)
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
        "promotionCombination",
        "deflection",
        "capturingDefender",
        "interference",
        "attraction",
        "fork",
        "forkPreparation",
        "doubleThreat",
        "pin",
        "skewer",
        "trappedPiece",
        "intermezzo",
        "doubleCheck",
        "discoveredCheck",
        "discoveredAttack",
        "clearance",
        "xRayAttack",
        "forcingAttack",
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
    const checkingMate = steps.length >= 3 ? proveCheckingMate(steps) : null;
    const promotionCombination = provePromotionCombination(steps[0]);
    const promotionPly = steps.findIndex(
        (step) => step.before.turn === steps[0].before.turn && step.move.promotion,
    );
    const end = checkingMate
        ? steps.findIndex((step) => step.after.isCheckmate()) + 1
        : promotionCombination && promotionPly >= 0 && promotionPly <= 16
          ? promotionPly + 1
          : episodeEnd(steps, allowConditional);
    if (!end) return [];
    const episode = steps.slice(0, end);
    const attacker = steps[0].before.turn;
    const final = episode.at(-1)!;
    if (final.after.isCheckmate() && final.before.turn !== attacker) return [];
    const mate =
        final.after.isCheckmate() &&
        final.before.turn === attacker &&
        (episode.length !== 3 || Boolean(proveMateNextTurn(steps[0]))) &&
        (episode.length !== 5 || Boolean(proveMateWithinThree(steps))) &&
        (episode.length < 7 || Boolean(checkingMate));
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
    if (promotionCombination) {
        const root = steps[0];
        candidates.push({
            id: "promotionCombination",
            label: "Promotion Combination",
            source: proposals[0]?.source ?? "available",
            confidence: "high",
            ply: 1,
            moveUci: root.uci,
            value: promotionCombination.gain,
            evidence: `${root.san} removes the ${root.before.board.get(root.move.to)!.role} on ${makeSquare(root.move.to)}, which controlled ${promotionCombination.controlled.map(makeSquare).join(" and ")}. ${promotionCombination.pawns.length === 1 ? "The passed pawn" : "The passed pawns"} on ${promotionCombination.pawns.map(makeSquare).join(" and ")} can advance. All ${promotionCombination.replyCount} legal replies permit a verified local material gain or mate, including recaptures and checking defences; one line is ${[root.san, ...promotionCombination.line].join(" ")}.`,
        });
    }
    const checkingAttack =
        !mate && !verifiedFork(steps[0]) ? proveCheckingMaterialAttack(steps) : null;
    if (checkingAttack) {
        const material =
            checkingAttack.branches.find(
                (branch) => branch.gain < 10000 && branch.reply === steps[1]?.san,
            ) ?? checkingAttack.branches.find((branch) => branch.gain < 10000)!;
        const mateBranch = checkingAttack.branches.find((branch) => branch.gain === 10000);
        candidates.push({
            id: "forcingAttack",
            label: "Forcing Attack",
            source: proposals[0]?.source ?? "available",
            confidence: "high",
            ply: 1,
            moveUci: steps[0].uci,
            value: checkingAttack.gain,
            evidence: `${steps[0].san} starts a checking attack that wins material or mates against every legal reply. After ${material.reply}, ${material.line.join(" ")} wins material.${mateBranch ? ` Instead, ${mateBranch.reply} allows ${mateBranch.line.join(" ")}, forcing mate.` : ""} The continuation depends on the defence; later pins and forks belong to their actual positions, not the opening check.`,
        });
    }
    const doubleThreat = !mate && !verifiedFork(steps[0]) ? proveQuietDoubleThreat(steps[0]) : null;
    if (doubleThreat) {
        const root = steps[0];
        const capture =
            doubleThreat.branches.find(
                (branch) => branch.kind === "capture" && branch.reply === steps[1]?.san,
            ) ?? doubleThreat.branches.find((branch) => branch.kind === "capture")!;
        const escapes = legalMoves(root.after)
            .filter(
                (move) =>
                    doubleThreat.directTargets.includes(move.from) &&
                    !capturedValue(root.after, move),
            )
            .map((move) => makeSan(root.after, move));
        const fork =
            doubleThreat.branches.find(
                (branch) => branch.kind === "fork" && escapes.includes(branch.reply),
            ) ?? doubleThreat.branches.find((branch) => branch.kind === "fork")!;
        const targets = doubleThreat.directTargets.map(
            (sq) => `${root.after.board.get(sq)!.role} on ${makeSquare(sq)}`,
        );
        const threat = makeSan(withTurn(root.after, attacker), doubleThreat.threat);
        candidates.push({
            id: "doubleThreat",
            label: "Double Threat",
            source: proposals[0]?.source ?? "available",
            confidence: "high",
            ply: 1,
            moveUci: root.uci,
            value: doubleThreat.gain,
            evidence: `${root.san} attacks the ${targets.join(" and ")} and threatens ${threat}, a checking fork of the ${doubleThreat.threatTargets.join(" and ")}. After ${capture.reply}, ${capture.answer} wins material; after ${fork.reply}, ${fork.answer} uses the fork instead. All ${doubleThreat.branches.length} legal replies allow a verified material gain, including captures and counterchecks. This is a double threat now; the fork occurs on the next move only if that branch is played.`,
        });
    }
    const forkPreparation =
        !mate && !verifiedFork(steps[0]) ? proveCheckingForkPreparation(steps[0]) : null;
    if (forkPreparation) {
        const fork = forkPreparation.branches.find((branch) => branch.kind === "fork")!;
        const block = forkPreparation.branches.find((branch) => branch.kind === "block");
        candidates.push({
            id: "forkPreparation",
            label: "Fork Preparation",
            source: proposals[0]?.source ?? "available",
            confidence: "high",
            ply: 1,
            moveUci: steps[0].uci,
            value: forkPreparation.gain,
            evidence: `${steps[0].san} prepares a checking fork. After ${fork.reply}, ${fork.answer} forks the ${fork.targets.join(" and ")}.${block ? ` Blocking with ${block.reply} instead allows ${block.answer}, winning the blocking piece.` : ""} All ${forkPreparation.branches.length} legal replies allow a verified gain; captures, interpositions and legal recaptures are included. The fork belongs to the next move, not this board position.`,
        });
    }
    if (checkingMate)
        candidates.push({
            id: `mateIn${checkingMate.maxMoves}`,
            label: "Forcing Mate",
            source: proposals[0]?.source ?? "available",
            confidence: "high",
            ply: 1,
            moveUci: steps[0].uci,
            value: 10000,
            evidence: `${steps[0].san} starts a forced mating attack. Every legal defence permits mate within ${checkingMate.maxMoves} moves; one verified line is ${checkingMate.example.join(" ")}. The exact continuation depends on the defence.`,
        });
    const clearance = proveForcingClearance(steps);
    if (clearance)
        candidates.push({
            id: "clearance",
            label: "Clearance",
            source: proposals[0]?.source ?? "available",
            confidence: "high",
            ply: 1,
            moveUci: steps[0].uci,
            value: clearance.gain,
            evidence: `${steps[0].san} clears ${makeSquare(steps[0].move.from)} for the ${steps[0].after.board.get(clearance.branches[0].from)!.role}: ${clearance.branches.map((branch) => `${branch.reply} is met by ${branch.preparation}`).join("; ")}. Every legal reply allows a verified quiet preparation followed by mate or material gain, with at most four checking moves before the payoff. The routes depend on the defence; no single reply is compulsory.`,
        });
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
        !quietMate && !preparation ? proveQuietTacticalPreparation(steps.slice(0, 11)) : null;
    if (tacticalPreparation && (tacticalPreparation.forced || allowConditional)) {
        const victim = steps[0].after.board.get(tacticalPreparation.target)!;
        candidates.push({
            id: tacticalPreparation.pin ? "pin" : "tacticalPreparation",
            label: tacticalPreparation.pin ? "Pin" : "Quiet Preparation",
            source: proposals[0]?.source ?? "available",
            confidence: tacticalPreparation.forced ? "high" : "medium",
            ply: 1,
            moveUci: steps[0].uci,
            value: tacticalPreparation.gain,
            evidence: tacticalPreparation.pin
                ? `${steps[0].san} pins the ${steps[0].after.board.get(tacticalPreparation.pin.front)!.role} on ${makeSquare(tacticalPreparation.pin.front)} to its king on ${makeSquare(tacticalPreparation.pin.rear)}. That defender cannot capture the checking piece on ${makeSquare(tacticalPreparation.pin.checkingMove.to)} without exposing its king. ${tacticalPreparation.forced ? "Every legal reply permits a verified forcing material gain or mate." : "The threat and displayed reply are verified, but other defences can change the route."}`
                : tacticalPreparation.forced
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
        // Legacy PV-level mate tags sometimes point at an earlier check or
        // capture. The pattern is a terminal payoff, not that earlier move.
        // A separate all-defences certificate owns the root attack label.
        if (MATE.test(proposal.id)) {
            if (!mate) continue;
            proposal = { ...proposal, ply: episode.length, moveUci: final.uci };
        }
        if (proposal.id === "enPassant") {
            const index = episode.findIndex(
                (s) =>
                    s.before.turn === attacker &&
                    s.before.board.get(s.move.from)?.role === "pawn" &&
                    s.move.to === s.before.epSquare &&
                    !s.before.board.get(s.move.to) &&
                    s.capture === VALUE.pawn,
            );
            if (index < 0) continue;
            const capture = episode[index];
            const victim = capture.move.to + (attacker === "white" ? -8 : 8);
            proposal = {
                ...proposal,
                ply: index + 1,
                moveUci: capture.uci,
                evidence: `${capture.san} captures the pawn on ${makeSquare(victim)} en passant, moving from ${makeSquare(capture.move.from)} to ${makeSquare(capture.move.to)}.`,
            };
        }
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
        if (proposal.id === "attraction") {
            // A cooperative endpoint does not prove a material attraction.
            // Only the verified mating branch currently supplies this proof.
            if (!mate) continue;
            const anchor = episode.findIndex(
                (s, i) =>
                    s.before.turn === attacker &&
                    episode[i + 1]?.before.board.get(episode[i + 1].move.from)?.role === "king" &&
                    episode[i + 1].move.to === s.move.to,
            );
            if (anchor < 0) continue;
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
        else if (proposal.id === "fork") {
            sound = verifiedFork(step);
            const promotion = sound && !immediateFork(step) ? provePromotionBackedFork(step) : null;
            if (promotion)
                proposal = { ...proposal, value: promotion.gain, evidence: promotion.evidence };
        } else if (proposal.id === "skewer")
            sound = rayMaterialEvidence(step, proposal.source).some((m) => m.id === "skewer");
        else if (proposal.id === "pin")
            sound =
                (mate && Boolean(pinRestrictsCapture(step))) ||
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
        if (proposal.id === "pin") {
            const ray = relevantRayTactics(step).find((ray) => ray.kind === "pin");
            if (ray) {
                const existed = rayTactics(step.before, step.before.turn).some(
                    (before) =>
                        before.pinner === ray.pinner &&
                        before.front === ray.front &&
                        before.rear === ray.rear,
                );
                proposal = {
                    ...proposal,
                    evidence: `${step.san} ${existed ? "continues the attack on" : "pins"} the ${step.after.board.get(ray.front)!.role} on ${makeSquare(ray.front)}${existed ? ", already pinned" : ""} to the ${step.after.board.get(ray.rear)!.role} on ${makeSquare(ray.rear)} by the ${step.after.board.get(ray.pinner)!.role} on ${makeSquare(ray.pinner)}.`,
                };
            }
        }
        if (proposal.id === "pin" || proposal.id === "fork") {
            const ray = pinRestrictsCapture(step);
            if (ray) {
                const existed = rayTactics(step.before, step.before.turn).some(
                    (before) =>
                        before.kind === "pin" &&
                        before.pinner === ray.pinner &&
                        before.front === ray.front &&
                        before.rear === ray.rear,
                );
                const restriction = `The ${step.after.board.get(ray.front)!.role} on ${makeSquare(ray.front)} cannot capture on ${makeSquare(step.move.to)} because it is pinned to its king on ${makeSquare(ray.rear)}.`;
                proposal = {
                    ...proposal,
                    evidence:
                        proposal.id === "pin"
                            ? `${step.san} ${existed ? "exploits an existing" : "creates a"} pin. ${restriction}`
                            : `${proposal.evidence} ${restriction}`,
                };
            }
        }
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
    if (root.after.isCheckmate() && !candidates.some((m) => MATE.test(m.id) && m.ply === 1)) {
        candidates.push({
            id: "mateIn1",
            label: "Checkmate",
            source: proposals[0]?.source ?? "available",
            confidence: "high",
            ply: 1,
            moveUci: root.uci,
            value: 10000,
            evidence: `${root.san} is checkmate: the king is in check and there is no legal reply.`,
        });
    }
    const normalizedCandidates = normalizeMatingPayoffs(steps, candidates);
    const specificMate = normalizedCandidates.find((m) => /Mate$/.test(m.id));
    const fork = candidates.find((m) => m.id === "fork");
    const filtered = normalizedCandidates
        .filter((m) => {
            if (
                m.id === "promotion" &&
                candidates.some((other) => other.id === "underPromotion" && other.ply === m.ply)
            )
                return false;
            if (
                m.ply &&
                steps[m.ply - 1]?.after.isCheckmate() &&
                ["hangingPiece", "skewer", "fork", "attacking_undefended_piece"].includes(m.id)
            )
                return false;
            if (
                m.id === "mate" &&
                candidates.some((other) => /^mateIn\d+$/.test(other.id) && other.ply === m.ply)
            )
                return false;
            if (m.id === "intermezzo" && m.ply) {
                const deflection = candidates.find(
                    (other) => other.id === "deflection" && other.ply === m.ply,
                );
                const order = deflection ? intermediateCaptureProof(steps[m.ply - 1]) : null;
                if (
                    order &&
                    (deflection?.value ?? 0) >= order.gain &&
                    steps[m.ply + 1]?.move.to === order.deferred.to
                )
                    return false;
            }
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
                !(checkingMate && m.ply === 1) &&
                !(preparation && m.id === "mateIn3" && m.ply === 1)
            )
                return false;
            if (
                fork?.ply === m.ply &&
                ["clearance", "trappedPiece", "attacking_undefended_piece"].includes(m.id)
            )
                return false;
            if (m.id === "attacking_undefended_piece" && checkingMate && m.ply === 1) return false;
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
            if (
                m.id === "forcingAttack" &&
                candidates.some(
                    (other) =>
                        other.ply === m.ply &&
                        other.id !== "forcingAttack" &&
                        MECHANISMS.has(other.id),
                )
            )
                return false;
            // An independently proved mating mechanism already explains the
            // root. Keep its named payoff, not another generic root badge.
            if (
                m.label === "Forcing Mate" &&
                candidates.some(
                    (other) =>
                        other.ply === m.ply && MECHANISMS.has(other.id) && other.value === 10000,
                )
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
            const rootMatingPriority = (m: TacticalMotifEvidence) =>
                checkingMate && m.ply === 1 && (m.value === 10000 || MATE.test(m.id)) ? 0 : 1;
            return (
                matingPriority(a) - matingPriority(b) ||
                rootMatingPriority(a) - rootMatingPriority(b) ||
                causeRank(a, directGain) - causeRank(b, directGain)
            );
        });
    const immediateLoose = filtered.find((m) => m.id === "hangingPiece" && m.ply === 1);
    if (
        immediateLoose &&
        !checkingMate &&
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
        ...(/^mate(?:In\d+)?$/.test(motif.id) &&
        motif.ply &&
        steps[motif.ply - 1]?.after.isCheckmate()
            ? {
                  label: "Checkmate",
                  confidence: "high" as const,
                  evidence: `${steps[motif.ply - 1].san} is checkmate: the king is in check and there is no legal reply.`,
              }
            : {}),
        relevance: index === 0 ? ("primary" as const) : ("secondary" as const),
        value:
            motif.value ??
            (motif.id === "hangingPiece" && motif.ply
                ? tacticalExchangeGain(steps[motif.ply - 1].before, steps[motif.ply - 1].move)
                : mate || (motif.id === "mateThreat" && quietMate)
                  ? 10000
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

/** Normalize already-audited timeline evidence. A repeated check is not a
 * new fork lesson when the same piece has kept
 * the same material victims under a profitable attack throughout. A capture,
 * promotion, changed attacker/target or interrupted threat starts a new event.
 * Keep pin creation, but fold a reused pin into the fork it makes possible. */
export function normalizeContinuingTactics(
    steps: TacticalReplayStep[],
    motifs: TacticalMotifEvidence[],
) {
    const ordered = [...motifs].sort((a, b) => (a.ply ?? 0) - (b.ply ?? 0));
    const keptForks: TacticalMotifEvidence[] = [];
    const suppressed = new Set<TacticalMotifEvidence>();
    const replacements = new Map<TacticalMotifEvidence, TacticalMotifEvidence>();
    const targetCache = new Map<string, Square[]>();
    const targetsAt = (index: number, from: Square) => {
        const key = `${index}:${from}`;
        const piece = steps[index]?.after.board.get(from);
        if (!piece) return [];
        if (!targetCache.has(key))
            targetCache.set(
                key,
                winningTargets(steps[index].after, from, piece.color).filter(
                    (square) => steps[index].after.board.get(square)?.role !== "king",
                ),
            );
        return targetCache.get(key)!;
    };
    const continuing = (previous: TacticalMotifEvidence, current: TacticalMotifEvidence) => {
        const start = (previous.ply ?? 0) - 1,
            end = (current.ply ?? 0) - 1;
        if (
            start < 0 ||
            !steps[start] ||
            end <= start ||
            current.relevance === "primary" ||
            !steps[end] ||
            steps[end].capture ||
            steps[end].move.promotion
        )
            return false;
        const first = steps[start],
            last = steps[end];
        if (first.before.turn !== last.before.turn) return false;
        let attacker: Square | undefined = first.move.to;
        let victims: (Square | undefined)[] = targetsAt(start, attacker);
        if (!victims.length) return false;
        const roles = victims.map((square) => first.after.board.get(square!)!.role);
        const attackerRole = first.after.board.get(attacker)!.role;
        for (let index = start + 1; index <= end; index++) {
            const step = steps[index];
            attacker = relocatedSquare(step, attacker);
            victims = victims.map((square) =>
                square === undefined ? undefined : relocatedSquare(step, square),
            );
            if (
                attacker === undefined ||
                step.after.board.get(attacker)?.role !== attackerRole ||
                victims.some(
                    (square, i) =>
                        square === undefined || step.after.board.get(square)?.role !== roles[i],
                )
            )
                return false;
            const targets = targetsAt(index, attacker);
            if (victims.some((square) => !targets.includes(square!))) return false;
        }
        const currentTargets = targetsAt(end, last.move.to);
        return (
            attacker === last.move.to &&
            currentTargets.length === victims.length &&
            currentTargets.every((square) => victims.includes(square))
        );
    };
    for (const motif of ordered) {
        if (motif.id !== "fork" || !motif.ply || !steps[motif.ply - 1]) continue;
        if (keptForks.some((previous) => continuing(previous, motif))) suppressed.add(motif);
        else keptForks.push(motif);
    }
    for (const motif of ordered) {
        if (motif.id !== "pin" || !motif.ply || motif.relevance === "primary") continue;
        const step = steps[motif.ply - 1];
        if (!step) continue;
        const fork = keptForks.find((candidate) => candidate.ply === motif.ply);
        if (!fork) continue;
        const ray = pinRestrictsCapture(step);
        const previous = rayTactics(step.before, step.before.turn);
        const existed = (candidate: { pinner: Square; front: Square; rear: Square }) =>
            previous.some(
                (old) =>
                    old.kind === "pin" &&
                    old.pinner === candidate.pinner &&
                    old.front === candidate.front &&
                    old.rear === candidate.rear,
            );
        if (
            !ray ||
            !existed(ray) ||
            relevantRayTactics(step).some(
                (candidate) => candidate.kind === "pin" && !existed(candidate),
            )
        )
            continue;
        const restriction = `The ${step.after.board.get(ray.front)!.role} on ${makeSquare(ray.front)} cannot capture on ${makeSquare(step.move.to)} because it is pinned to its king on ${makeSquare(ray.rear)}.`;
        replacements.set(fork, {
            ...fork,
            evidence: fork.evidence.includes(restriction)
                ? fork.evidence
                : `${fork.evidence} ${restriction}`,
        });
        suppressed.add(motif);
    }
    return motifs
        .filter((motif) => !suppressed.has(motif))
        .map((motif) => replacements.get(motif) ?? motif);
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
    } else if (motif.id === "forcingAttack") {
        const proof = proveCheckingMaterialAttack(steps);
        if (proof) {
            targets = [proof.target];
            gain = proof.gain;
        }
    } else if (motif.id === "forkPreparation" || motif.id === "doubleThreat") {
        const proof =
            motif.id === "doubleThreat"
                ? proveQuietDoubleThreat(step)
                : proveCheckingForkPreparation(step);
        if (proof) {
            targets = proof.targets;
            gain = proof.gain;
        }
    } else if (motif.id === "fork") {
        targets = winningTargets(step.after, step.move.to, step.before.turn);
        gain = targets.length >= 2 ? materialThreatGain(step, targets, [step.move.to]) : null;
        if (gain === null) gain = provePromotionBackedFork(step)?.gain ?? null;
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
 * threatened material or avoiding a certified mate. Use its own legal engine continuation, never replay
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
    const alternativeMotifs = auditTacticalMotifs(
        makeFen(alternativeSteps[0].before.toSetup()),
        alternativeSteps.map((s) => s.uci),
        [],
    ).filter((m) => m.ply === 1);
    const alternativeMate = alternativeMotifs.find(
        (m) => /^mateIn\d+$/.test(m.id) && m.value === 10000,
    );
    const alternatives = alternativeMotifs
        .map((m) => materialLesson(alternativeSteps, m))
        .filter((proof): proof is NonNullable<typeof proof> => proof !== null);
    if (!alternatives.length && !alternativeMate) return motifs;
    return motifs.map((motif) => {
        if (
            alternativeMate &&
            motif.ply === 1 &&
            /^mateIn\d+$/.test(motif.id) &&
            motif.value === 10000 &&
            Number(alternativeMate.id.slice(6)) <= Number(motif.id.slice(6))
        ) {
            return {
                ...motif,
                comparison: "persists" as const,
                comparisonEvidence: `Even after ${better[0].san}, ${better[1].san} still permits a verified forced mate within ${Number(alternativeMate.id.slice(6))} moves. The better move does not remove this mating danger.`,
            };
        }
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
    // Compare legal reached positions, not scores or just move strings.
    // Identical choices cannot have caused a difference, even when the two
    // engine searches return different mating branches or score estimates.
    if (makeFen(actual[0].after.toSetup()) === makeFen(better[0].after.toSetup())) {
        return motifs.map((motif) => ({
            ...motif,
            comparison: "persists" as const,
            comparisonEvidence: `${better[0].san} is also the analysed best move. The same position and tactical danger remain after either choice.`,
        }));
    }
    const step = actual[1];
    const alternative = better[1];
    const bestSan = better[0].san;
    return motifs.map((motif) => {
        if (motif.ply !== 1 || motif.moveUci !== reply) return motif;
        let comparison: TacticalMotifEvidence["comparison"];
        let comparisonEvidence = "";
        if (!alternative) {
            comparison = "prevented";
            comparisonEvidence = `${bestSan} makes the immediate reply ${step.san} illegal.`;
        } else if (motif.id === "promotionCombination") {
            if (!alternative.capture) {
                comparison = "prevented";
                comparisonEvidence = `After ${bestSan}, ${alternative.san} no longer captures the promotion-path defender.`;
            } else {
                const original = provePromotionCombination(step),
                    other = provePromotionCombination(alternative);
                if (
                    original &&
                    other &&
                    other.gain >= original.gain &&
                    original.pawns.join(",") === other.pawns.join(",") &&
                    step.before.board.get(step.move.to)?.role ===
                        alternative.before.board.get(alternative.move.to)?.role
                ) {
                    comparison = "persists";
                    comparisonEvidence = `The same defender-removal and passed-pawn combination remains available after ${bestSan}.`;
                }
            }
        } else if (motif.id === "forcingAttack" && step.after.isCheck()) {
            const escape = checkingAttackerCaptureEscape(alternative);
            if (escape) {
                comparison = "prevented";
                comparisonEvidence = `After ${bestSan}, ${alternative.san} is not check and ${escape.defence} captures the attacking ${alternative.after.board.get(alternative.move.to)!.role} on ${makeSquare(alternative.move.to)}. Legal immediate replies, recaptures and one countercheck cannot erase the local material gain. This refutes this checking sequence, not every possible later attack.`;
            }
        } else if (motif.id === "forkPreparation") {
            const original = proveCheckingForkPreparation(step);
            if (original) {
                const mapped: Square[] = [];
                for (const square of original.targets) {
                    const source = relocatedSquare(actual[0], square, true);
                    const target =
                        source === undefined ? undefined : relocatedSquare(better[0], source);
                    const victim = step.after.board.get(square);
                    if (
                        target === undefined ||
                        !victim ||
                        alternative.after.board.get(target)?.role !== victim.role ||
                        alternative.after.board.get(target)?.color !== victim.color
                    )
                        break;
                    mapped.push(target);
                }
                if (mapped.length === original.targets.length) {
                    const defence = checkingForkPreparationEscape(alternative, mapped);
                    if (defence) {
                        comparison = "prevented";
                        comparisonEvidence = `After ${bestSan}, ${defence} answers ${alternative.san} without permitting a checking fork or capture of ${mapped.map((sq) => `the ${alternative.after.board.get(sq)!.role} on ${makeSquare(sq)}`).join(" or ")} on the next move. This prevents this immediate preparation, not every possible later attack.`;
                    }
                }
            }
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
                if (targets.join(",") === actualTargets.join(",")) {
                    const original = materialThreatProof(step, actualTargets, [step.move.to]);
                    const other = materialThreatProof(alternative, targets, [alternative.move.to]);
                    if (original.kind === "proven" && other.kind === "proven") {
                        if (other.gain >= original.gain) {
                            comparison = "persists";
                            comparisonEvidence = `The same immediate fork is still available after ${bestSan}, with at least the same verified material gain.`;
                        } else if (original.complete && other.complete) {
                            comparison = "reduced";
                            comparisonEvidence = `The fork still exists after ${bestSan}, but ${other.defence} limits its immediate target-capture gain to ${(other.gain / 100).toFixed(1)} pawns rather than ${(original.gain / 100).toFixed(1)} after ${actual[0].san}. This compares the settled fork exchange, not the full position's evaluation.`;
                        }
                    } else {
                        const originalPromotion = provePromotionBackedFork(step);
                        const otherPromotion = provePromotionBackedFork(alternative);
                        if (
                            originalPromotion &&
                            otherPromotion &&
                            otherPromotion.gain >= originalPromotion.gain
                        ) {
                            comparison = "persists";
                            comparisonEvidence = `The same promotion-backed fork remains available after ${bestSan}, with at least the same verified material gain.`;
                        }
                    }
                }
            }
        }
        return comparison ? { ...motif, comparison, comparisonEvidence } : motif;
    });
}

/** Refute a formerly checking move by capturing its now-exposed attacker.
 * Check every immediate reply; a countercheck needs a legal king flight with
 * no further check or material-erasing capture. Longer counterchecks abstain.
 * This is a bounded local witness, never an inference from a failed attack proof. */
export function checkingAttackerCaptureEscape(
    root: TacticalReplayStep,
    nodeLimit = 4096,
): { defence: string; gain: number } | null {
    if (
        !Number.isFinite(nodeLimit) ||
        nodeLimit <= 0 ||
        root.capture ||
        root.move.promotion ||
        root.after.isCheck() ||
        root.after.isEnd()
    )
        return null;
    const attacker = root.after.board.get(root.move.to);
    if (!attacker || attacker.color !== root.before.turn || attacker.role === "king") return null;
    let nodes = nodeLimit;
    const visit = (pos: Chess, move: NormalMove) => {
        if (--nodes < 0) throw new Error("Checking attacker escape budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const delta = (pos: Chess, move: NormalMove) =>
        capturedValue(pos, move) + (move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0);
    // Reaching a quiet leaf alone is insufficient: include every immediate
    // capture of any friendly piece, not just a recapture on the old square.
    const quietGain = (pos: Chess, balance: number): number | null => {
        if (pos.isEnd()) return null;
        let minimum = balance;
        for (const reply of legalMoves(pos)) {
            const next = visit(pos, reply);
            if (next.isCheck() || next.isEnd()) return null;
            minimum = Math.min(minimum, balance - delta(pos, reply));
        }
        return minimum >= 100 ? minimum : null;
    };
    try {
        for (const capture of legalMoves(root.after)) {
            if (capture.to !== root.move.to || !capturedValue(root.after, capture)) continue;
            const gain = tacticalExchangeGain(root.after, capture);
            if (gain < 100) continue;
            const next = visit(root.after, capture);
            if (next.isEnd()) continue;
            const balance = delta(root.after, capture);
            let minimum = gain;
            let safe = true;
            for (const reply of legalMoves(next)) {
                const after = visit(next, reply);
                const remaining = balance - delta(next, reply);
                if (remaining < 100 || after.isEnd()) {
                    safe = false;
                    break;
                }
                if (!after.isCheck()) {
                    minimum = Math.min(minimum, remaining);
                    continue;
                }
                let escaped: number | null = null;
                for (const flight of legalMoves(after)) {
                    if (after.board.get(flight.from)?.role !== "king") continue;
                    const quiet = visit(after, flight);
                    const retained = quietGain(quiet, remaining + delta(after, flight));
                    if (retained !== null) {
                        escaped = retained;
                        break;
                    }
                }
                if (escaped === null) {
                    safe = false;
                    break;
                }
                minimum = Math.min(minimum, escaped);
            }
            if (safe) return { defence: makeSan(root.after, capture), gain: minimum };
        }
    } catch {
        return null;
    }
    return null;
}

/** A positive legal escape from this *one-move* preparation, not a failed
 * winning proof. King replies cannot be confused with capturable interposing
 * pieces. Any geometric checking fork, target capture or immediate mate makes
 * the branch inconclusive; we do not assume an unverified tactic is harmless. */
export function checkingForkPreparationEscape(
    root: TacticalReplayStep,
    targets: Square[],
    nodeLimit = 4096,
): string | null {
    if (
        !Number.isFinite(nodeLimit) ||
        nodeLimit <= 0 ||
        !targets.length ||
        root.capture ||
        root.move.promotion ||
        !root.after.isCheck() ||
        targets.some(
            (sq) =>
                root.after.board.get(sq)?.color !== root.after.turn ||
                root.after.board.get(sq)?.role === "king",
        )
    )
        return null;
    let nodes = nodeLimit;
    for (const reply of legalMoves(root.after)) {
        if (root.after.board.get(reply.from)?.role !== "king") continue;
        if (--nodes < 0) return null;
        const next = root.after.clone();
        next.play(reply);
        if (next.isEnd()) continue;
        let safe = true;
        for (const answer of legalMoves(next)) {
            if (--nodes < 0) return null;
            if (targets.includes(answer.to) && capturedValue(next, answer)) {
                safe = false;
                break;
            }
            const after = next.clone();
            after.play(answer);
            if (after.isCheckmate()) {
                safe = false;
                break;
            }
            const piece = after.board.get(answer.to);
            const king = after.board.kingOf(after.turn);
            if (!piece || king === undefined || !after.isCheck()) continue;
            const attacked = attacks(piece, answer.to, after.board.occupied).intersect(
                after.board[after.turn],
            );
            if (
                attacked.has(king) &&
                [...attacked].some((sq) => !["pawn", "king"].includes(after.board.get(sq)!.role))
            ) {
                safe = false;
                break;
            }
        }
        if (safe) return makeSan(root.after, reply);
    }
    return null;
}
