import { attacks, between } from "chessops/attacks";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
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

/** A profitable recapture is an exchange payoff, not a newly hung piece.
 * Subtract the immediately preceding loss from the settled local capture;
 * do not borrow earlier gains, future PV play or promotion bookkeeping. */
export function winningRecaptureEvidence(
    steps: TacticalReplayStep[],
    index: number,
    motif: TacticalMotifEvidence,
): TacticalMotifEvidence | null {
    const step = steps[index],
        previous = steps[index - 1];
    // An equal recapture can incidentally remove a guard or open a ray.
    // Do not call that a fresh material win when an independently checked
    // countercapture balances the exchange. A small lower bound alone is
    // not a refutation, and missing/mismatched history grants no credit.
    if (
        MECHANISMS.has(motif.id) &&
        (motif.value ?? Infinity) <= (previous?.capture ?? 0) &&
        step?.capture &&
        previous?.capture === step.capture &&
        previous.move.to === step.move.to &&
        !previous.move.promotion &&
        !step.move.promotion
    ) {
        const pair = replayTacticalLine(makeFen(previous.before.toSetup()), [
            previous.uci,
            step.uci,
        ]);
        if (
            pair.length === 2 &&
            [previous, step].every(
                (entry, i) =>
                    makeUci(entry.move) === entry.uci &&
                    entry.capture === pair[i].capture &&
                    makeFen(entry.before.toSetup()) === makeFen(pair[i].before.toSetup()) &&
                    makeFen(entry.after.toSetup()) === makeFen(pair[i].after.toSetup()),
            ) &&
            counterCaptureMaterialDefence(step, 8192, previous.capture)
        )
            return null;
    }
    // A countercheck can delay acceptance by one king move. Require the
    // complete, contiguous history and the independently proved branch;
    // an earlier sacrifice label or a cooperative PV cannot hide a capture.
    if (motif.id === "hangingPiece" && step?.capture && index >= 3) {
        const offer = steps[index - 3];
        const check = steps[index - 2];
        const context = [offer, check, previous, step];
        const replay = replayTacticalLine(
            makeFen(offer.before.toSetup()),
            context.map((entry) => entry.uci),
        );
        if (
            step.move.to === offer.move.to &&
            replay.length === context.length &&
            context.every(
                (entry, i) =>
                    replay[i].san === entry.san &&
                    makeUci(entry.move) === entry.uci &&
                    makeFen(replay[i].before.toSetup()) === makeFen(entry.before.toSetup()) &&
                    makeFen(replay[i].after.toSetup()) === makeFen(entry.after.toSetup()),
            ) &&
            provesDelayedForkAcceptance(offer, check, previous, step)
        )
            return null;
    }
    if (
        motif.id === "hangingPiece" &&
        step?.capture &&
        previous &&
        step.move.to === previous.move.to &&
        (proveExchangeDeflection(previous) || proveCombinedDefenderRemoval(previous))
    )
        return null;
    if (motif.id === "hangingPiece" && step?.capture && previous) {
        const combined = proveCombinedDefenderRemoval(previous);
        const branch = combined?.declined.find((b) => b.reply === step.san);
        const victim = step.before.board.get(step.move.to);
        if (branch && victim)
            return {
                ...motif,
                label: "Countercapture",
                evidence: `${step.san} takes the ${victim.role} on ${makeSquare(step.move.to)} as compensation, but ${branch.answer} preserves a material gain for the player who removed the defender. This does not refute the verified combination.`,
            };
        const fork = proveDiscoveryBackedFork(previous);
        if (fork) {
            if (step.move.to === previous.move.to) return null;
            if (fork.targets.includes(step.move.from)) {
                const target = fork.targets.find(
                    (sq) =>
                        sq !== step.move.from &&
                        step.after.board.get(sq)?.color === step.before.turn &&
                        tacticalExchangeGain(step.after, { from: previous.move.to, to: sq }) -
                            step.capture >=
                            70,
                );
                const victim = step.before.board.get(step.move.to);
                if (target !== undefined && victim)
                    return {
                        ...motif,
                        label: "Countercapture",
                        evidence: `${step.san} captures the ${victim.role} on ${makeSquare(step.move.to)} as compensation, but ${makeSan(step.after, { from: previous.move.to, to: target })} still wins the other fork target (${step.after.board.get(target)!.role} on ${makeSquare(target)}). This does not refute the verified fork.`,
                    };
            }
        }
        // A certified discovery covers every legal defence, including a
        // capture of its exposed slider. This may be the best compensation,
        // not a new material win against the player making the combination.
        const discovery = discoveredEvidence([previous], motif.source);
        if (discovery && (discovery.motif.value ?? 0) > 0) {
            if (step.move.to === previous.move.to) return null;
            const taken = step.before.board.get(step.move.to);
            if (taken)
                return {
                    ...motif,
                    label: "Countercapture",
                    evidence: `${step.san} takes the ${taken.role} on ${makeSquare(step.move.to)} as compensation. This legal reply is covered by the independently verified ${discovery.motif.label.toLowerCase()} after ${previous.san}; it does not refute that combination.`,
                };
        }
    }
    // Taking another piece to decline a proved mating offer is compensation,
    // not a separate win. The offer's all-defence proof must include this exact
    // legal reply; absent or mismatched history cannot hide a loose piece.
    if (
        motif.id === "hangingPiece" &&
        step?.capture &&
        previous?.capture &&
        proveMatingDeflection(previous)?.declined.some((branch) => branch.reply === step.san)
    )
        return null;
    if (
        motif.id !== "hangingPiece" ||
        !step?.capture ||
        !previous?.capture ||
        previous.move.to !== step.move.to ||
        previous.move.promotion ||
        step.move.promotion
    )
        return motif;
    const gain = tacticalExchangeGain(step.before, step.move);
    if (gain <= -VALUE.king || gain - previous.capture < 100) return null;
    // Same-square SEE cannot see a checking fork, compensation elsewhere,
    // or mate after accepting a sacrifice. Only independent legal proofs
    // may remove the gain label; neither a sacrifice tag nor a PV endpoint
    // is evidence. The move remains visible in the continuation without a
    // misleading hanging-piece / winning-recapture badge.
    if (
        proveMatingCaptureReply(step) ||
        proveMateBackedFork(previous) ||
        proveRecaptureBackedFork(previous) ||
        proveCaptureForkPreparation(previous) ||
        proveCaptureDiscoveryPreparation(previous) ||
        proveCaptureDeflection(previous) ||
        proveDiscoveryAttraction(previous) ||
        provePinnedCapture(previous) ||
        capturedDefenderProof(previous, motif.source)
    )
        return null;
    const victim = step.before.board.get(step.move.to);
    const traded = previous.before.board.get(previous.move.to);
    if (!victim || !traded) return motif;
    return {
        ...motif,
        label: "Winning Recapture",
        value: gain - previous.capture,
        evidence: `${step.san} wins the ${victim.role} on ${makeSquare(step.move.to)} in exchange for the ${traded.role} just captured there. The settled local exchange gains ${(gain - previous.capture) / 100} pawns of material; this is the payoff, not a newly hanging piece.`,
    };
}

/** The displayed king evasion need not be the first witness selected at the
 * root. Re-prove its actual accepted continuation, with all piece liabilities,
 * rather than suppressing only a move-order-dependent selected witness. */
function provesDelayedForkAcceptance(
    offer: TacticalReplayStep,
    check: TacticalReplayStep,
    evasion: TacticalReplayStep,
    acceptance: TacticalReplayStep,
) {
    if (
        check.capture ||
        !check.after.isCheck() ||
        evasion.capture ||
        evasion.before.board.get(evasion.move.from)?.role !== "king" ||
        acceptance.move.promotion ||
        acceptance.after.isEnd()
    )
        return false;
    const proof = proveCaptureForkPreparation(offer);
    if (!proof?.declined.some((branch) => branch.reply === check.san)) return false;
    const forkers = new Set<Square>();
    for (const branch of proof.branches) {
        const pos = offer.after.clone();
        const take = parseSan(pos, branch.reply);
        if (!take) continue;
        pos.play(take);
        const follow = parseSan(pos, branch.answer);
        if (follow && "from" in follow) forkers.add(follow.from);
    }
    const side = offer.before.turn;
    const enemy = opposite(side);
    const { fork } = checkingForkSearch(side, { nodes: 8192 }, true);
    try {
        for (const move of legalMoves(acceptance.after)) {
            if (!forkers.has(move.from) || move.promotion) continue;
            const result = fork(
                acceptance.after,
                move,
                [...acceptance.after.board[side], move.to],
                acceptance.after.board.get(acceptance.move.to)?.role === "king"
                    ? []
                    : [...acceptance.after.board[enemy]].filter((sq) => sq !== acceptance.move.to),
                100 - offer.capture + acceptance.capture,
                !offer.after.isCheck(),
            );
            if (result) return true;
        }
    } catch {
        /* An exhausted continuation cannot hide a hanging-piece label. */
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
        makeFen(history[0].after.toSetup()) !== makeFen(root.before.toSetup())
    )
        return motifs;
    const compensated = isCompensatedContinuationCapture(history, 1);
    return motifs.flatMap((motif) => {
        if (compensated && motif.id === "hangingPiece" && motif.ply === 1) return [];
        const contextual = motif.ply === 1 ? winningRecaptureEvidence(history, 1, motif) : motif;
        return contextual ? [contextual] : [];
    });
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

const matingCaptureReplyCache = new Map<string, string[] | null>();

/** A material recapture cannot be called a win when its actual reached board
 * permits forced mate in at most two checking moves. No supplied continuation
 * or sacrifice tag is needed. Every legal defence is included, and incomplete
 * searches abstain. This does not prove the preceding offer against declines. */
export function proveMatingCaptureReply(
    step: TacticalReplayStep,
    nodeLimit = 4096,
    sharedBudget?: ProofBudget,
): string[] | null {
    if (!step.capture || !Number.isSafeInteger(nodeLimit) || nodeLimit <= 0) return null;
    const key = makeFen(step.after.toSetup());
    if (!sharedBudget && nodeLimit === 4096 && matingCaptureReplyCache.has(key))
        return matingCaptureReplyCache.get(key)!;
    const budget = sharedBudget ?? { nodes: nodeLimit };
    const visit = (position: Chess, move: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Mating capture reply budget exhausted");
        const next = position.clone();
        next.play(move);
        return next;
    };
    const attack = (position: Chess, remaining: number): string[] | null => {
        if (position.isEnd()) return null;
        const checks: { move: NormalMove; next: Chess }[] = [];
        // Finish an immediate mate before considering an unnecessary sacrifice.
        for (const move of legalMoves(position)) {
            if (sharedBudget && !mayGiveCheck(position, move)) continue;
            const next = visit(position, move);
            if (next.isCheckmate()) return [makeSan(position, move)];
            if (remaining > 1 && next.isCheck()) checks.push({ move, next });
        }
        for (const { move, next } of checks) {
            let witness: string[] | null = null;
            let complete = true;
            for (const reply of legalMoves(next)) {
                const continuation = attack(visit(next, reply), remaining - 1);
                if (!continuation) {
                    complete = false;
                    break;
                }
                witness ??= [makeSan(position, move), makeSan(next, reply), ...continuation];
            }
            if (complete && witness) return witness;
        }
        return null;
    };
    let proof: string[] | null = null;
    try {
        proof = attack(step.after, 2);
    } catch {
        // A budget failure cannot erase a material lesson.
    }
    if (!sharedBudget && nodeLimit === 4096) {
        matingCaptureReplyCache.set(key, proof);
        if (matingCaptureReplyCache.size > 128)
            matingCaptureReplyCache.delete(matingCaptureReplyCache.keys().next().value!);
    }
    return proof;
}

type PerpetualCheckProof = { line: string[]; cycle: string[]; replyCount: number };
const perpetualCheckCache = new Map<string, PerpetualCheckProof | null>();

/** A repeated-looking PV is not proof. Search checking moves only, with all
 * legal defences, and close a branch only on the same board, turn, castling
 * rights and legal en-passant state along that branch. Such a strategy can
 * repeat until a draw is claimable; it does not mean a draw has already occurred.
 * Mate may replace a draw in another defence, but at least one cycle is required. */
export function provePerpetualCheck(
    steps: TacticalReplayStep[],
    nodeLimit = 4096,
): PerpetualCheckProof | null {
    const root = steps[0];
    if (
        !root ||
        !root.after.isCheck() ||
        root.after.isEnd() ||
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0
    )
        return null;
    const hints = steps
        .filter((s) => s.before.turn === root.before.turn && s.after.isCheck())
        .map((s) => s.uci);
    // Returning the checker to its previous square is a useful nomination,
    // never a proof: legal king captures and every other evasion still count.
    hints.push(makeUci({ from: root.move.to, to: root.move.from }));
    const key = `${makeFen(root.before.toSetup())}:${root.uci}:${hints}`;
    if (nodeLimit === 4096 && perpetualCheckCache.has(key)) return perpetualCheckCache.get(key)!;
    let nodes = nodeLimit;
    const visit = (pos: Chess, move: NormalMove) => {
        if (--nodes < 0) throw new Error("Perpetual check budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const positionKey = (pos: Chess) => makeFen(pos.toSetup()).split(" ").slice(0, 4).join(" ");
    type Proof = { line: string[]; cycle: string[] };
    const path = new Map<string, number>();
    const defend = (pos: Chess, remaining: number, line: string[]): Proof | null => {
        if (pos.isCheckmate()) return { line, cycle: [] };
        if (pos.isEnd() || !pos.isCheck()) return null;
        const position = positionKey(pos),
            previous = path.get(position);
        if (previous !== undefined) return { line, cycle: line.slice(previous) };
        if (!remaining) return null;
        path.set(position, line.length);
        try {
            let example: Proof | null = null;
            for (const reply of legalMoves(pos)) {
                const proof = attack(visit(pos, reply), remaining, [...line, makeSan(pos, reply)]);
                if (!proof) return null;
                if (!example || (!example.cycle.length && proof.cycle.length)) example = proof;
            }
            return example;
        } finally {
            path.delete(position);
        }
    };
    const attack = (pos: Chess, remaining: number, line: string[]): Proof | null => {
        if (pos.isEnd()) return null;
        const relative = (square: Square) => (root.before.turn === "white" ? square : square ^ 56);
        const moves = legalMoves(pos).sort(
            (a, b) =>
                Number(hints.includes(makeUci(b))) - Number(hints.includes(makeUci(a))) ||
                relative(a.from) - relative(b.from) ||
                relative(a.to) - relative(b.to),
        );
        for (const move of moves) {
            const next = visit(pos, move);
            if (!next.isCheck()) continue;
            const proof = defend(next, remaining - 1, [...line, makeSan(pos, move)]);
            if (proof) return proof;
        }
        return null;
    };
    let result: PerpetualCheckProof | null = null;
    try {
        const proof = defend(root.after, 5, [root.san]);
        if (proof?.cycle.length) result = { ...proof, replyCount: legalMoves(root.after).length };
    } catch {
        /* Unknown/exhausted branches cannot establish a drawing resource. */
    }
    if (nodeLimit === 4096) {
        perpetualCheckCache.set(key, result);
        if (perpetualCheckCache.size > 128)
            perpetualCheckCache.delete(perpetualCheckCache.keys().next().value!);
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

const shortCheckingMateCache = new Map<string, CheckingMateProof | null>();

/** Root mate-in-two/three does not depend on a PV ending in mate. Search
 * only legal checks, shortest distance first, and all defensive replies.
 * Quiet/longer mates still need the existing separately nominated proof. */
export function proveShortCheckingMate(
    root: TacticalReplayStep,
    nodeLimit = 4096,
): CheckingMateProof | null {
    if (
        !root ||
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0 ||
        !root.after.isCheck() ||
        root.after.isEnd()
    )
        return null;
    const key = `${makeFen(root.before.toSetup())}:${root.uci}`;
    if (nodeLimit === 4096 && shortCheckingMateCache.has(key))
        return shortCheckingMateCache.get(key)!;
    let nodes = nodeLimit;
    const visit = (pos: Chess, move: NormalMove) => {
        if (--nodes < 0) throw new Error("Short root mate budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const moves = (pos: Chess) => {
        const flip = root.before.turn === "white" ? 0 : 56;
        return legalMoves(pos).sort(
            (a, b) => (a.from ^ flip) - (b.from ^ flip) || (a.to ^ flip) - (b.to ^ flip),
        );
    };
    const attack = (pos: Chess, remaining: number): string[] | null => {
        if (!remaining || pos.isEnd()) return null;
        for (const move of moves(pos)) {
            const next = visit(pos, move);
            if (!next.isCheck()) continue;
            const win = defend(next, remaining - 1);
            if (win) return [makeSan(pos, move), ...win];
        }
        return null;
    };
    const defend = (pos: Chess, remaining: number): string[] | null => {
        if (pos.isCheckmate()) return [];
        if (!remaining || pos.isEnd()) return null;
        let longest: string[] | null = null;
        for (const reply of moves(pos)) {
            const win = attack(visit(pos, reply), remaining);
            if (!win) return null;
            const line = [makeSan(pos, reply), ...win];
            if (!longest || line.length > longest.length) longest = line;
        }
        return longest;
    };
    let proof: CheckingMateProof | null = null;
    try {
        for (const remaining of [1, 2]) {
            const win = defend(root.after, remaining);
            if (win) {
                proof = {
                    maxMoves: remaining + 1,
                    replyCount: moves(root.after).length,
                    example: [root.san, ...win],
                };
                break;
            }
        }
    } catch {
        /* Exhaustion is unknown, never forced mate. */
    }
    if (nodeLimit === 4096) {
        shortCheckingMateCache.set(key, proof);
        if (shortCheckingMateCache.size > 256)
            shortCheckingMateCache.delete(shortCheckingMateCache.keys().next().value!);
    }
    return proof;
}

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
        selected.set(ply, {
            ...motif,
            ...(!specific
                ? { id: "mateIn1", label: "Checkmate", confidence: "high" as const }
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
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0 ||
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
    const skewerRay = relevantRayTactics(root).find(
        (ray) =>
            ray.kind === "skewer" &&
            ray.pinner === root.move.to &&
            root.after.board.get(ray.front)?.role === "king",
    );
    const orderedMoves = (pos: Chess) => {
        const list = legalMoves(pos);
        if (!checkingSkewer) return list;
        const flip = side === "black" ? 0 : 56;
        return list.sort(
            (a, b) => (a.from ^ flip) - (b.from ^ flip) || (a.to ^ flip) - (b.to ^ flip),
        );
    };
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
        target =
            [
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
                )[0] ?? skewerRay?.rear;
    }
    if (target === undefined) return null;
    if (root.after.board.get(target)?.color !== opposite(side)) return null;
    // Only the rear-target certificate uses skewer traversal and liabilities.
    // An incidental ray must not change a separate nominated checking attack.
    const checkingSkewer = target === skewerRay?.rear ? skewerRay : undefined;
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
        const moves = orderedMoves(pos).sort(
            (a, b) => Number(hints.includes(makeUci(b))) - Number(hints.includes(makeUci(a))),
        );
        for (const move of moves) {
            if (move.to !== square || !capturedValue(pos, move)) continue;
            if (checkingSkewer) {
                const leaf = visit(pos, move);
                if (leaf.isEnd()) continue;
                let safe = true;
                for (const resource of orderedMoves(leaf)) {
                    if (resource.promotion || visit(leaf, resource).isCheckmate()) {
                        safe = false;
                        break;
                    }
                }
                if (!safe) continue;
            }
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
        for (const move of orderedMoves(pos)) {
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
        for (const reply of orderedMoves(root.after)) {
            const next = visit(root.after, reply);
            const win = attack(
                next,
                reply.from === target ? reply.to : target,
                -delta(root.after, reply),
                3,
                checkingSkewer
                    ? [...root.after.board[side]].filter((sq) => sq !== reply.to)
                    : reply.to === root.move.to
                      ? []
                      : [root.move.to],
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

type MixedCheckingAttackProof = {
    gain: number;
    branches: { reply: string; line: string[]; gain: number }[];
    decisions: { fen: string; move: string }[];
};
const mixedCheckingAttackCache = new Map<string, MixedCheckingAttackProof | null>();

/** A checking offer may have different material victims in different replies.
 * No supplied PV nominates a victim or supplies a leaf evaluation. This local
 * proof is deliberately separate from the single-target causal comparison. */
export function proveMixedCheckingAttack(
    root: TacticalReplayStep,
    nodeLimit = 32768,
): MixedCheckingAttackProof | null {
    if (!root || !Number.isSafeInteger(nodeLimit) || nodeLimit <= 0) return null;
    const key = `${makeFen(root.before.toSetup())}:${root.uci}`;
    if (nodeLimit === 32768 && mixedCheckingAttackCache.has(key))
        return mixedCheckingAttackCache.get(key)!;
    const proof = computeMixedCheckingAttack(root, nodeLimit);
    if (nodeLimit === 32768) {
        mixedCheckingAttackCache.set(key, proof);
        if (mixedCheckingAttackCache.size > 128)
            mixedCheckingAttackCache.delete(mixedCheckingAttackCache.keys().next().value!);
    }
    return proof;
}

function computeMixedCheckingAttack(
    root: TacticalReplayStep,
    nodeLimit: number,
): MixedCheckingAttackProof | null {
    if (
        !root ||
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0 ||
        root.capture ||
        root.move.promotion ||
        root.before.isCheck() ||
        !root.after.isCheck() ||
        root.after.isEnd()
    )
        return null;
    const side = root.before.turn;
    if (!root.after.ctx().checkers.has(root.move.to)) return null;
    const replies = legalMoves(root.after);
    if (!replies.some((move) => move.to === root.move.to && capturedValue(root.after, move)))
        return null;
    const budget = { nodes: nodeLimit };
    const ordered = (pos: Chess) => {
        const flip = side === "white" ? 0 : 56;
        return legalMoves(pos).sort(
            (a, b) =>
                capturedValue(pos, b) - capturedValue(pos, a) ||
                (a.from ^ flip) - (b.from ^ flip) ||
                (a.to ^ flip) - (b.to ^ flip),
        );
    };
    const visit = (pos: Chess, move: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Mixed checking attack budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    type Win = { gain: number; line: string[]; decisions: MixedCheckingAttackProof["decisions"] };
    const decision = (pos: Chess, move: NormalMove) => ({
        fen: makeFen(pos.toSetup()),
        move: makeUci(move),
    });
    // A material leaf cannot stop just before a forcing counterattack. A
    // countercheck needs a concrete answer retaining the gain and leaving no
    // further immediate check/promotion. Unknown longer king hunts abstain.
    const answerCountercheck = (
        pos: Chess,
        balance: number,
    ): { gain: number; decision: { fen: string; move: string } } | null => {
        for (const answer of ordered(pos)) {
            if (answer.promotion) continue;
            const next = visit(pos, answer);
            if (next.isCheckmate()) return { gain: 10000, decision: decision(pos, answer) };
            if (next.isEnd()) continue;
            let safe = true;
            for (const response of ordered(next)) {
                if (response.promotion || visit(next, response).isCheck()) {
                    safe = false;
                    break;
                }
            }
            if (!safe) continue;
            const gain = participantCaptureGain(
                pos,
                answer,
                [...pos.board[side], answer.to],
                budget,
            );
            if (gain !== null && balance + gain >= 300)
                return { gain: balance + gain, decision: decision(pos, answer) };
        }
        return null;
    };
    const attack = (pos: Chess, balance: number, checks: number): Win | null => {
        if (pos.isEnd()) return null;
        const moves = ordered(pos);
        // Prefer an available mate over longer optional sacrifices.
        for (const move of moves) {
            if (move.promotion) continue;
            if (visit(pos, move).isCheckmate())
                return {
                    gain: 10000,
                    line: [makeSan(pos, move)],
                    decisions: [decision(pos, move)],
                };
        }
        for (const move of moves) {
            if (move.promotion || !capturedValue(pos, move)) continue;
            const next = visit(pos, move);
            if (next.isEnd()) continue;
            let gain = participantCaptureGain(pos, move, [...pos.board[side], move.to], budget);
            if (gain === null || balance + gain < 300) continue;
            const countercheckAnswers: MixedCheckingAttackProof["decisions"] = [];
            let safe = true;
            for (const resource of ordered(next)) {
                const reply = visit(next, resource);
                if (resource.promotion || reply.isCheckmate()) {
                    safe = false;
                    break;
                }
                if (reply.isCheck()) {
                    const retained = answerCountercheck(
                        reply,
                        balance + capturedValue(pos, move) - capturedValue(next, resource),
                    );
                    if (retained === null) {
                        safe = false;
                        break;
                    }
                    gain = Math.min(gain, retained.gain - balance);
                    countercheckAnswers.push(retained.decision);
                }
            }
            if (!safe) continue;
            if (gain !== null && balance + gain >= 300)
                return {
                    gain: balance + gain,
                    line: [makeSan(pos, move)],
                    decisions: [decision(pos, move), ...countercheckAnswers],
                };
        }
        if (!checks) return null;
        for (const move of moves) {
            if (move.promotion) continue;
            const next = visit(pos, move);
            if (!next.isCheck()) continue;
            const win = defend(next, balance + capturedValue(pos, move), checks - 1);
            if (win)
                return {
                    gain: win.gain,
                    line: [makeSan(pos, move), ...win.line],
                    decisions: [decision(pos, move), ...win.decisions],
                };
        }
        return null;
    };
    const defend = (pos: Chess, balance: number, checks: number): Win | null => {
        if (pos.isEnd()) return null;
        let minimum: Win | null = null;
        const decisions: MixedCheckingAttackProof["decisions"] = [];
        for (const move of ordered(pos)) {
            if (move.promotion) return null;
            const win = attack(visit(pos, move), balance - capturedValue(pos, move), checks);
            if (!win) return null;
            decisions.push(...win.decisions);
            if (!minimum || win.gain < minimum.gain)
                minimum = { gain: win.gain, line: [makeSan(pos, move), ...win.line], decisions };
        }
        return minimum;
    };
    try {
        const branches: MixedCheckingAttackProof["branches"] = [];
        const decisions: MixedCheckingAttackProof["decisions"] = [];
        for (const reply of ordered(root.after)) {
            if (reply.promotion) return null;
            const win = attack(visit(root.after, reply), -capturedValue(root.after, reply), 5);
            if (!win) return null;
            decisions.push(...win.decisions);
            branches.push({ reply: makeSan(root.after, reply), gain: win.gain, line: win.line });
        }
        const gain = Math.min(...branches.map((b) => b.gain));
        if (gain >= 10000 || !branches.some((b) => b.gain === 10000)) return null;
        // An already available equally valuable capture is not explained by
        // adding an unnecessary check first.
        if (
            ordered(root.before).some(
                (move) =>
                    capturedValue(root.before, move) &&
                    tacticalExchangeGain(root.before, move) >= gain,
            )
        )
            return null;
        return {
            gain,
            branches,
            decisions: [...new Map(decisions.map((d) => [`${d.fen}:${d.move}`, d])).values()],
        };
    } catch {
        return null;
    }
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

/** Retain only the supplied branch of a proved clearance, through its actual
 * profitable target capture. A different preparation or extra quiet attacking
 * move cannot borrow the proof to extend an arbitrary engine continuation. */
export function forcingClearanceEpisodeLength(steps: TacticalReplayStep[]): number | null {
    const proof = proveForcingClearance(steps);
    if (!proof || steps.length < 5) return null;
    const branch = proof.branches.find((candidate) => candidate.reply === steps[1].san);
    if (
        !branch ||
        steps[2].move.from !== branch.from ||
        steps[2].move.to !== branch.to ||
        steps[2].capture ||
        steps[2].after.isCheck()
    )
        return null;
    let target = proof.target;
    let checks = 0;
    for (let index = 1; index < Math.min(13, steps.length); index++) {
        const step = steps[index];
        if (step.before.turn !== steps[0].before.turn) {
            if (step.move.from === target) target = step.move.to;
            continue;
        }
        if (index === 2) continue;
        if (step.move.to === target && step.capture >= VALUE.rook)
            return step.balance >= 90 ? index + 1 : null;
        if (!step.after.isCheck() || ++checks > 4) return null;
    }
    return null;
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
    return (
        immediateFork(step) ||
        proveRecaptureBackedFork(step) !== null ||
        proveExchangeForPawnFork(step) !== null ||
        provePromotionBackedFork(step) !== null ||
        proveMateBackedFork(step) !== null ||
        proveDiscoveryBackedFork(step) !== null ||
        proveQuietPawnFork(step) !== null
    );
}

type DiscoveryBackedForkProof = {
    gain: number;
    targets: Square[];
    branches: {
        reply: string;
        capture: string;
        slider: Role;
        followups: string[];
        pin?: RayTactic;
        pinEvidence?: string;
    }[];
};
const discoveryBackedForkCache = new Map<string, DiscoveryBackedForkProof | null>();
const DISCOVERY_BACKED_FORK_BUDGET = 32768;

/** A forker may vacate a battery: capturing it permits the revealed slider
 * to take the SAME fork victim and create a second material attack. A quiet
 * escape by a threatened pinning supporter may preserve that attack; every
 * reply still needs a concrete capture of its nominated targets. */
export function proveDiscoveryBackedFork(
    root: TacticalReplayStep,
    nodeLimit = DISCOVERY_BACKED_FORK_BUDGET,
    onFailure?: (reason: string) => void,
): DiscoveryBackedForkProof | null {
    if (
        root.move.promotion ||
        root.after.isEnd() ||
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0
    )
        return null;
    const side = root.before.turn;
    const offered = root.before.board.get(root.move.from)!.role;
    const exchangeFloor = ["knight", "bishop"].includes(offered)
        ? VALUE.rook - VALUE[offered] - VALUE.pawn
        : 100;
    const targets = winningTargets(root.after, root.move.to, side);
    const rays = revealedRays(root).filter((ray) => targets.includes(ray.target));
    if (targets.length < 2 || !rays.length) return null;
    const key = `${makeFen(root.before.toSetup())}:${root.uci}`;
    if (
        !onFailure &&
        nodeLimit === DISCOVERY_BACKED_FORK_BUDGET &&
        discoveryBackedForkCache.has(key)
    )
        return discoveryBackedForkCache.get(key)!;
    const budget = { nodes: nodeLimit };
    const visit = (pos: Chess, move: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Discovery-backed fork budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const settled = (pos: Chess, move: NormalMove, requiredGain?: number): number | null => {
        if (move.promotion) return null;
        const next = visit(pos, move);
        if (next.isEnd()) return null;
        for (const reply of legalMoves(next))
            if (reply.promotion || visit(next, reply).isCheckmate()) return null;
        const direct = participantCaptureGain(pos, move, [...pos.board[side], move.to], budget);
        if (
            requiredGain === undefined ||
            direct === null ||
            direct >= requiredGain ||
            !capturedValue(pos, move)
        )
            return direct;
        const defenders = legalMoves(next)
            .filter((m) => m.to === move.to && capturedValue(next, m))
            .map((m) => m.from);
        if (!defenders.length) return direct;
        let minimum = Infinity;
        for (const response of legalMoves(next)) {
            if (response.promotion) return null;
            const leaf = visit(next, response);
            if (leaf.isEnd()) return null;
            const retained = capturedValue(pos, move) - capturedValue(next, response);
            const mapped = defenders.map((sq) => (sq === response.from ? response.to : sq));
            let best = -Infinity;
            const attackers = withTurn(leaf, opposite(side));
            const threatened = new Set(
                legalMoves(attackers)
                    .filter((m) => capturedValue(attackers, m) > 0)
                    .map((m) => m.to),
            );
            const answers = legalMoves(leaf).sort(
                (a, b) =>
                    Number(capturedValue(leaf, b) > 0) - Number(capturedValue(leaf, a) > 0) ||
                    Number(threatened.has(b.from)) * VALUE[leaf.board.get(b.from)!.role] -
                        Number(threatened.has(a.from)) * VALUE[leaf.board.get(a.from)!.role],
            );
            for (const answer of answers) {
                if (answer.promotion) continue;
                if (
                    capturedValue(leaf, answer) &&
                    !(
                        (answer.from === move.to && mapped.includes(answer.to)) ||
                        (capturedValue(next, response) && answer.to === response.to)
                    )
                )
                    continue;
                const upper = participantCaptureGain(
                    leaf,
                    answer,
                    [...leaf.board[side], answer.to],
                    budget,
                );
                if (upper === null || retained + upper < requiredGain) continue;
                const gain = settled(leaf, answer);
                if (gain !== null) best = Math.max(best, retained + gain);
                if (best >= requiredGain) break;
            }
            if (best < requiredGain) return direct;
            minimum = Math.min(minimum, best);
        }
        return Number.isFinite(minimum) ? minimum : direct;
    };
    const captureTarget = (
        pos: Chess,
        from: Square,
        victims: Square[],
        balance: number,
        receiver?: Square,
    ) => {
        const moves = legalMoves(pos).filter(
            (move) =>
                (move.from === from || move.to === receiver) &&
                victims.includes(move.to) &&
                capturedValue(pos, move),
        );
        for (const recovery of [false, true])
            for (const move of moves) {
                const gain = settled(pos, move, recovery ? exchangeFloor - balance : undefined);
                if (
                    gain !== null &&
                    (balance + gain >= 100 ||
                        (VALUE[pos.board.get(move.to)!.role] >= VALUE.rook &&
                            balance + gain >= exchangeFloor))
                )
                    return balance + gain;
            }
        return -Infinity;
    };
    let result: DiscoveryBackedForkProof | null = null;
    try {
        let minimum = Infinity;
        const branches: DiscoveryBackedForkProof["branches"] = [];
        for (const reply of legalMoves(root.after)) {
            const pos = visit(root.after, reply);
            if (pos.isEnd() || reply.promotion) throw new Error("Terminal or promotion defence");
            const balance = root.capture - capturedValue(root.after, reply);
            const victims = targets.map((sq) => (sq === reply.from ? reply.to : sq));
            let best = captureTarget(pos, root.move.to, victims, balance);
            if (
                best < exchangeFloor &&
                reply.to === root.move.to &&
                capturedValue(root.after, reply)
            ) {
                for (const ray of rays) {
                    const target = ray.target === reply.from ? reply.to : ray.target;
                    const capture = { from: ray.from, to: target };
                    if (!pos.isLegal(capture) || !capturedValue(pos, capture)) continue;
                    const after = visit(pos, capture);
                    if (after.isEnd() || after.isCheck()) continue;
                    const piece = after.board.get(capture.to)!;
                    const followTargets = [
                        ...attacks(piece, capture.to, after.board.occupied).intersect(
                            after.board[opposite(side)],
                        ),
                    ].filter((sq) => after.board.get(sq)?.role !== "king");
                    if (followTargets.length < 2) continue;
                    // Recovering the actual piece which captured the forker
                    // is part of the same exchange, not an unrelated target.
                    if (
                        after.board.get(reply.to)?.color === opposite(side) &&
                        !followTargets.includes(reply.to)
                    )
                        followTargets.push(reply.to);
                    const pins = rayTactics(after, side).filter(
                        (pin) =>
                            pin.kind === "pin" &&
                            after.board.get(pin.rear)?.role === "king" &&
                            followTargets.includes(pin.front),
                    );
                    let gain = Infinity;
                    const followups: string[] = [];
                    for (const defence of legalMoves(after)) {
                        if (defence.promotion) {
                            gain = -Infinity;
                            break;
                        }
                        const next = visit(after, defence);
                        if (next.isEnd()) {
                            gain = -Infinity;
                            break;
                        }
                        const subtotal =
                            balance + capturedValue(pos, capture) - capturedValue(after, defence);
                        const tracked = followTargets.map((sq) =>
                            sq === defence.from ? defence.to : sq,
                        );
                        if (
                            followTargets.some(
                                (sq) => sq !== reply.to && between(capture.to, sq).has(defence.to),
                            )
                        )
                            tracked.push(defence.to);
                        const receiver = defence.from === reply.to ? defence.to : reply.to;
                        let earned = captureTarget(next, capture.to, tracked, subtotal, receiver);
                        if (earned < exchangeFloor && !next.isCheck()) {
                            // Only a currently threatened pinner may move, and
                            // only while preserving the same victim/king pin.
                            for (const pin of pins) {
                                if (next.board.get(pin.pinner)?.color !== side) continue;
                                const opponent = withTurn(next, opposite(side));
                                const threatened = legalMoves(opponent).some(
                                    (m) =>
                                        m.to === pin.pinner &&
                                        tacticalExchangeGain(opponent, m) >= 100,
                                );
                                if (!threatened) continue;
                                // The actual counterattacker can itself be
                                // captured (for example fxe5 answers ...Ne5's
                                // attack on the pinning queen). This is not
                                // permission to harvest an unrelated victim.
                                if (opponent.isLegal({ from: defence.to, to: pin.pinner })) {
                                    for (const answer of legalMoves(next)) {
                                        if (
                                            answer.to !== defence.to ||
                                            !capturedValue(next, answer)
                                        )
                                            continue;
                                        const local = settled(next, answer);
                                        if (local !== null && subtotal + local >= 100) {
                                            earned = subtotal + local;
                                            followups.push(
                                                `${makeSan(after, defence)} ${makeSan(next, answer)}`,
                                            );
                                            break;
                                        }
                                    }
                                    if (earned >= exchangeFloor) break;
                                }
                                for (const escape of legalMoves(next)) {
                                    if (
                                        escape.from !== pin.pinner ||
                                        escape.promotion ||
                                        capturedValue(next, escape)
                                    )
                                        continue;
                                    const saved = visit(next, escape);
                                    if (
                                        saved.isEnd() ||
                                        saved.isCheck() ||
                                        !rayTactics(saved, side).some(
                                            (p) =>
                                                p.kind === "pin" &&
                                                p.pinner === escape.to &&
                                                p.front === pin.front &&
                                                p.rear === pin.rear,
                                        )
                                    )
                                        continue;
                                    let held = Infinity;
                                    for (const answer of legalMoves(saved)) {
                                        if (answer.promotion) {
                                            held = -Infinity;
                                            break;
                                        }
                                        const leaf = visit(saved, answer);
                                        if (leaf.isEnd()) {
                                            held = -Infinity;
                                            break;
                                        }
                                        const relocated = tracked.map((sq) =>
                                            sq === answer.from ? answer.to : sq,
                                        );
                                        if (
                                            tracked.some(
                                                (sq) =>
                                                    sq !== receiver &&
                                                    between(capture.to, sq).has(answer.to),
                                            )
                                        )
                                            relocated.push(answer.to);
                                        const local = captureTarget(
                                            leaf,
                                            capture.to,
                                            relocated,
                                            subtotal - capturedValue(saved, answer),
                                            answer.from === receiver ? answer.to : receiver,
                                        );
                                        held = Math.min(held, local);
                                        if (held < exchangeFloor) {
                                            onFailure?.(
                                                `Escape ${makeSan(after, defence)} ${makeSan(next, escape)} fails ${makeSan(saved, answer)}`,
                                            );
                                            break;
                                        }
                                    }
                                    if (held >= exchangeFloor) {
                                        earned = held;
                                        followups.push(
                                            `${makeSan(after, defence)} ${makeSan(next, escape)}`,
                                        );
                                        break;
                                    }
                                }
                                if (earned >= exchangeFloor) break;
                            }
                        }
                        gain = Math.min(gain, earned);
                        if (gain < exchangeFloor) {
                            onFailure?.(`Follow-up defence ${makeSan(after, defence)}`);
                            break;
                        }
                    }
                    if (gain >= exchangeFloor && Number.isFinite(gain)) {
                        best = gain;
                        const pin = pinRestrictsCapture({
                            before: pos,
                            after,
                            move: capture,
                            uci: makeUci(capture),
                            san: makeSan(pos, capture),
                            capture: capturedValue(pos, capture),
                            balance: 0,
                        });
                        branches.push({
                            reply: makeSan(root.after, reply),
                            capture: makeSan(pos, capture),
                            slider: piece.role,
                            followups,
                            ...(pin
                                ? {
                                      pin,
                                      pinEvidence: `The ${after.board.get(pin.pinner)!.role} on ${makeSquare(pin.pinner)} pins the ${after.board.get(pin.front)!.role} on ${makeSquare(pin.front)} to the king on ${makeSquare(pin.rear)}, preventing it from capturing the ${piece.role} on ${makeSquare(capture.to)}.`,
                                  }
                                : {}),
                        });
                        break;
                    }
                }
            }
            if (best < exchangeFloor)
                throw new Error(`Unproved root defence ${makeSan(root.after, reply)}`);
            minimum = Math.min(minimum, best);
        }
        if (branches.length && Number.isFinite(minimum))
            result = { gain: minimum, targets, branches };
    } catch (error) {
        onFailure?.(error instanceof Error ? error.message : String(error));
    }
    if (nodeLimit === DISCOVERY_BACKED_FORK_BUDGET) {
        discoveryBackedForkCache.set(key, result);
        if (discoveryBackedForkCache.size > 128)
            discoveryBackedForkCache.delete(discoveryBackedForkCache.keys().next().value!);
    }
    return result;
}

type RecaptureBackedForkProof = {
    gain: number;
    targets: Square[];
    limitingDefence: { reply: string; answer: string };
    recaptures: { reply: string; answer: string; continuation: string[] }[];
};
const recaptureBackedForkCache = new Map<string, RecaptureBackedForkProof | null>();

/** Taking a forker can permit a checking recapture by its supporter. Verify
 * all root replies and all replies to that check. Only the recapturing piece's
 * real targets and checking interpositions may repay the original sacrifice;
 * an unrelated attack elsewhere cannot justify a Fork headline. */
export function proveRecaptureBackedFork(
    root: TacticalReplayStep,
    nodeLimit = 8192,
    onFailure?: (reason: string) => void,
): RecaptureBackedForkProof | null {
    if (
        root.move.promotion ||
        root.after.isEnd() ||
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0
    )
        return null;
    const side = root.before.turn;
    const targets = winningTargets(root.after, root.move.to, side);
    if (targets.length < 2) return null;
    const key = `${makeFen(root.before.toSetup())}:${root.uci}`;
    if (!onFailure && nodeLimit === 8192 && recaptureBackedForkCache.has(key))
        return recaptureBackedForkCache.get(key)!;
    const budget = { nodes: nodeLimit };
    const visit = (pos: Chess, move: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Checking recapture budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const settled = (pos: Chess, move: NormalMove) => {
        if (move.promotion) return null;
        const next = visit(pos, move);
        if (next.isEnd() && !next.isCheckmate()) return null;
        for (const resource of legalMoves(next))
            if (resource.promotion || visit(next, resource).isCheckmate()) return null;
        return participantCaptureGain(pos, move, [...pos.board[side], move.to], budget);
    };
    const checkingRecapture = (pos: Chess, move: NormalMove, minimumGain: number) => {
        const after = visit(pos, move);
        if (after.isCheckmate()) return { gain: 10000, continuation: [] as string[] };
        if (!after.ctx().checkers.has(move.to) || after.isEnd()) return null;
        const piece = after.board.get(move.to)!;
        const victims = [
            ...attacks(piece, move.to, after.board.occupied).intersect(after.board[opposite(side)]),
        ].filter((to) => !["king", "pawn"].includes(after.board.get(to)!.role));
        if (!victims.length) return null;
        const king = after.board.kingOf(opposite(side))!;
        const blocks = between(move.to, king);
        let minimum = Infinity,
            continuation: string[] = [];
        for (const reply of legalMoves(after)) {
            if (reply.promotion) return null;
            const next = visit(after, reply);
            if (next.isEnd()) return null;
            const takesChecker = reply.to === move.to && capturedValue(after, reply) > 0;
            const named = takesChecker
                ? [move.to]
                : victims.map((sq) => (sq === reply.from ? reply.to : sq));
            if (blocks.has(reply.to)) named.push(reply.to);
            let best = -Infinity,
                answer = "";
            for (const capture of legalMoves(next)) {
                if (
                    !named.includes(capture.to) ||
                    !capturedValue(next, capture) ||
                    (!takesChecker && capture.from !== move.to)
                )
                    continue;
                const gain = settled(next, capture);
                if (gain === null) continue;
                const value = capturedValue(pos, move) - capturedValue(after, reply) + gain;
                if (value > best) {
                    best = value;
                    answer = makeSan(next, capture);
                }
            }
            if (best < minimumGain) return null;
            if (best < minimum) {
                minimum = best;
                continuation = [makeSan(after, reply), answer];
            }
        }
        return Number.isFinite(minimum) ? { gain: minimum, continuation } : null;
    };
    let result: RecaptureBackedForkProof | null = null;
    try {
        let minimum = Infinity;
        let limitingDefence = { reply: "", answer: "" };
        const recaptures: RecaptureBackedForkProof["recaptures"] = [];
        for (const reply of legalMoves(root.after)) {
            if (reply.promotion) throw new Error("Promoting defence");
            const next = visit(root.after, reply);
            if (next.isEnd()) throw new Error("Terminal defence");
            const balance = root.capture - capturedValue(root.after, reply);
            const takesForker = reply.to === root.move.to && capturedValue(root.after, reply) > 0;
            const named = takesForker
                ? [root.move.to]
                : targets.map((sq) => (sq === reply.from ? reply.to : sq));
            let best = -Infinity;
            let answer = "";
            for (const move of legalMoves(next)) {
                if (
                    !named.includes(move.to) ||
                    !capturedValue(next, move) ||
                    (!takesForker && move.from !== root.move.to)
                )
                    continue;
                const gain = settled(next, move);
                if (gain !== null && balance + gain > best) {
                    best = balance + gain;
                    answer = makeSan(next, move);
                }
            }
            if (best < 100 && takesForker) {
                for (const move of legalMoves(next)) {
                    if (move.to !== root.move.to || move.promotion || !capturedValue(next, move))
                        continue;
                    const proof = checkingRecapture(next, move, 100 - balance);
                    if (!proof) continue;
                    best = balance + proof.gain;
                    answer = makeSan(next, move);
                    recaptures.push({
                        reply: makeSan(root.after, reply),
                        answer: makeSan(next, move),
                        continuation: proof.continuation,
                    });
                    break;
                }
            }
            if (best < 100) throw new Error(`Unproved fork defence: ${makeSan(root.after, reply)}`);
            if (best < minimum) {
                minimum = best;
                limitingDefence = { reply: makeSan(root.after, reply), answer };
            }
        }
        if (recaptures.length && Number.isFinite(minimum))
            result = { gain: minimum, targets, recaptures, limitingDefence };
    } catch (error) {
        onFailure?.(error instanceof Error ? error.message : "Unproved checking recapture");
    }
    if (nodeLimit === 8192) {
        recaptureBackedForkCache.set(key, result);
        if (recaptureBackedForkCache.size > 128)
            recaptureBackedForkCache.delete(recaptureBackedForkCache.keys().next().value!);
    }
    return result;
}

function checkingForkSearch(
    side: Color,
    budget: { nodes: number },
    strictLeaves = false,
    discoveryChecks = false,
) {
    const visit = (pos: Chess, move: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Fork preparation budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const delta = (pos: Chess, move: NormalMove) =>
        capturedValue(pos, move) + (move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0);
    const fork = (
        pos: Chess,
        move: NormalMove,
        pieces: Square[],
        excluded: Square[] = [],
        minimumGain = 100,
        recovery = false,
    ) => {
        const after = visit(pos, move);
        const piece = after.board.get(move.to);
        if (!piece || piece.color !== side) return null;
        const targets = [
            ...attacks(piece, move.to, after.board.occupied).intersect(after.board[opposite(side)]),
        ];
        let discovery: { slider: Square; king: Square } | undefined;
        if (discoveryChecks) {
            if (!after.isCheck() || targets.some((sq) => after.board.get(sq)?.role === "king"))
                return null;
            const step = replayTacticalLine(makeFen(pos.toSetup()), [makeUci(move)])[0];
            const ray =
                step && revealedRays(step).find((r) => after.board.get(r.target)?.role === "king");
            if (!ray) return null;
            discovery = { slider: ray.from, king: ray.target };
            targets.push(ray.target);
        } else if (!after.isCheck() || !targets.some((sq) => after.board.get(sq)?.role === "king"))
            return null;
        const victims = targets.filter(
            (sq) => !excluded.includes(sq) && !["king", "pawn"].includes(after.board.get(sq)!.role),
        );
        if (!victims.length || after.isEnd()) return null;
        const blockingSquares =
            !discoveryChecks && strictLeaves && ["bishop", "rook", "queen"].includes(piece.role)
                ? between(move.to, after.board.kingOf(opposite(side))!)
                : undefined;
        let minimum = Infinity;
        const payoffVictims = new Set<Square>();
        for (const reply of legalMoves(after)) {
            const next = visit(after, reply);
            if (next.isEnd()) return null;
            const capturedForker = reply.to === move.to && capturedValue(after, reply) > 0;
            const named = capturedForker
                ? [move.to]
                : victims.map((sq) => (reply.from === sq ? reply.to : sq));
            // Interposing a valuable piece can concede the fork's material
            // gain instead of moving its victims. The checker or an ally
            // may capture this real blocking square; normal liability and
            // every legal recapture still have to meet the same gain floor.
            if (blockingSquares?.has(reply.to)) named.push(reply.to);
            let best = -Infinity;
            let bestVictim: Square | undefined;
            for (const capture of legalMoves(next)) {
                if (
                    !named.includes(capture.to) ||
                    !capturedValue(next, capture) ||
                    (!capturedForker &&
                        capture.from !== move.to &&
                        !blockingSquares?.has(capture.to))
                )
                    continue;
                if (strictLeaves) {
                    const leaf = visit(next, capture);
                    let unresolved = false;
                    for (const resource of legalMoves(leaf)) {
                        if (resource.promotion || visit(leaf, resource).isCheckmate()) {
                            unresolved = true;
                            break;
                        }
                    }
                    if (unresolved) continue;
                }
                let gain = participantCaptureGain(next, capture, pieces, budget);
                if (
                    recovery &&
                    gain !== null &&
                    delta(pos, move) - delta(after, reply) + gain < minimumGain
                )
                    gain = checkingCaptureRecoveryGain(
                        next,
                        capture,
                        budget,
                        minimumGain - delta(pos, move) + delta(after, reply),
                    );
                if (gain !== null) {
                    const value = delta(pos, move) - delta(after, reply) + gain;
                    if (value > best) {
                        best = value;
                        bestVictim = capturedForker
                            ? undefined
                            : victims.find(
                                  (sq) => (reply.from === sq ? reply.to : sq) === capture.to,
                              );
                    }
                }
            }
            if (best < minimumGain) return null;
            if (bestVictim !== undefined) payoffVictims.add(bestVictim);
            minimum = Math.min(minimum, best);
        }
        return Number.isFinite(minimum)
            ? {
                  gain: minimum,
                  victims: strictLeaves ? [...payoffVictims] : victims,
                  ...(discovery ? { discovery } : {}),
                  targets: targets
                      .filter(
                          (sq) =>
                              after.board.get(sq)!.role === "king" ||
                              (strictLeaves ? payoffVictims.has(sq) : victims.includes(sq)),
                      )
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

type QuietPawnForkProof = {
    gain: number;
    targets: Square[];
    branches: { reply: string; answer: string; line: string[]; gain: number }[];
    examinedMoves: number;
};
const quietPawnForkCache = new Map<string, QuietPawnForkProof | null>();

/** An advanced pawn's quiet double attack can need a checking capture or
 * promotion to recover a countercaptured piece. Search every legal defence;
 * attacking continuations stay with those targets, that pawn, checks and
 * real check evasions. Quiet retention cannot invent earned material. */
export function proveQuietPawnFork(
    root: TacticalReplayStep,
    nodeLimit = 16384,
    minimumGain = 100,
    onFailure?: (reason: string) => void,
    onLeaf?: (leaf: MaterialRecoveryLeaf) => void,
    sharedBudget?: ProofBudget,
): QuietPawnForkProof | null {
    const piece = root.after.board.get(root.move.to);
    const side = root.before.turn;
    const enemy = opposite(side);
    const distance =
        side === "white" ? 7 - Math.floor(root.move.to / 8) : Math.floor(root.move.to / 8);
    if (
        !piece ||
        piece.role !== "pawn" ||
        root.capture ||
        root.move.promotion ||
        root.after.isCheck() ||
        distance < 1 ||
        distance > 3 ||
        root.after.isEnd() ||
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0 ||
        !Number.isSafeInteger(minimumGain) ||
        minimumGain <= 0
    )
        return null;
    const targets = [
        ...attacks(piece, root.move.to, root.after.board.occupied).intersect(
            root.after.board[enemy],
        ),
    ].filter((to) => !["king", "pawn"].includes(root.after.board.get(to)!.role));
    if (targets.length !== 2) return null;
    const cacheKey = `${makeFen(root.before.toSetup())}:${root.uci}:${minimumGain}`;
    const cacheable = !sharedBudget && !onFailure && !onLeaf && nodeLimit === 16384;
    if (cacheable && quietPawnForkCache.has(cacheKey)) return quietPawnForkCache.get(cacheKey)!;
    const budget = sharedBudget ?? { nodes: nodeLimit };
    const initialNodes = budget.nodes;
    const visit = (pos: Chess, move: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Quiet pawn fork budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const delta = (pos: Chess, move: NormalMove) =>
        capturedValue(pos, move) + (move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0);
    type Win = { gain: number; line: string[] };
    const memo = new Map<string, Win | null>();
    const attack = (
        pos: Chess,
        balance: number,
        victims: Square[],
        pawn: Square | null,
        remaining: number,
    ): Win | null => {
        if (!remaining || pos.isEnd()) return null;
        const key = `${makeFen(pos.toSetup())}:${balance}:${victims}:${pawn}:${remaining}`;
        if (memo.has(key)) return memo.get(key)!;
        const candidates = recoveryMoves(pos, side).filter(
            (move) =>
                // Recovery begins by taking a fork victim or its actual
                // countercapturer, not an unrelated check or passed-pawn advance.
                (remaining < 5 ||
                    pos.isCheck() ||
                    (capturedValue(pos, move) && victims.includes(move.to))) &&
                (pos.isCheck() ||
                    move.from === pawn ||
                    (capturedValue(pos, move) && victims.includes(move.to)) ||
                    mayGiveCheck(pos, move) ||
                    (balance >= minimumGain && !capturedValue(pos, move) && !move.promotion)),
        );
        candidates.sort(
            (a, b) =>
                delta(pos, b) - delta(pos, a) || Number(b.from === pawn) - Number(a.from === pawn),
        );
        const prepared = candidates.map((move) => ({ move, next: visit(pos, move) }));
        for (const { move, next } of prepared) {
            if (next.isCheckmate()) return { gain: 10000, line: [makeSan(pos, move)] };
            if (next.isEnd() || balance + delta(pos, move) < minimumGain) continue;
            const gain = participantCaptureGain(pos, move, [...pos.board[side], move.to], budget);
            if (
                gain === null ||
                balance + gain < minimumGain ||
                !noImmediateTerminalRefutation(pos, move, budget)
            )
                continue;
            onLeaf?.({
                fen: makeFen(pos.toSetup()),
                moveUci: makeUci(move),
                balance,
                gain: balance + gain,
                quiet: !capturedValue(pos, move) && !move.promotion,
            });
            const result = { gain: balance + gain, line: [makeSan(pos, move)] };
            memo.set(key, result);
            return result;
        }
        for (const { move, next } of prepared) {
            // Outside check, only the nominated pawn, related captures or
            // actual checks may extend an unproved combination.
            if (
                next.isEnd() ||
                (!pos.isCheck() &&
                    move.from !== pawn &&
                    !next.isCheck() &&
                    !(capturedValue(pos, move) && victims.includes(move.to)))
            )
                continue;
            const result = defend(
                next,
                balance + delta(pos, move),
                victims.filter((to) => to !== move.to),
                pawn === move.from ? move.to : pawn,
                remaining - 1,
            );
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
        victims: Square[],
        pawn: Square | null,
        remaining: number,
    ): Win | null => {
        if (pos.isEnd()) return pos.isCheckmate() ? { gain: 10000, line: [] } : null;
        let minimum = Infinity,
            example: string[] = [];
        const replies = recoveryMoves(pos, side).sort((a, b) => delta(pos, b) - delta(pos, a));
        for (const reply of replies) {
            const next = visit(pos, reply);
            if (reply.promotion || next.isEnd()) return null;
            const named = victims.map((to) => (to === reply.from ? reply.to : to));
            if (capturedValue(pos, reply)) named.push(reply.to);
            const result = attack(
                next,
                balance - delta(pos, reply),
                [...new Set(named)],
                reply.to === pawn ? null : pawn,
                remaining,
            );
            if (!result) return null;
            minimum = Math.min(minimum, result.gain);
            const line = [makeSan(pos, reply), ...result.line];
            if (line.length > example.length) example = line;
        }
        return Number.isFinite(minimum) ? { gain: minimum, line: example } : null;
    };
    let proof: QuietPawnForkProof | null = null;
    try {
        const branches: QuietPawnForkProof["branches"] = [];
        let minimum = Infinity;
        for (const reply of recoveryMoves(root.after, side).sort(
            (a, b) => delta(root.after, b) - delta(root.after, a),
        )) {
            const next = visit(root.after, reply);
            if (reply.promotion || next.isEnd())
                throw new Error("Terminal or promoting fork defence");
            const named = targets.map((to) => (to === reply.from ? reply.to : to));
            if (capturedValue(root.after, reply)) named.push(reply.to);
            const result = attack(
                next,
                -delta(root.after, reply),
                [...new Set(named)],
                reply.to === root.move.to ? null : root.move.to,
                5,
            );
            if (!result)
                throw new Error(`Unproved quiet fork defence ${makeSan(root.after, reply)}`);
            minimum = Math.min(minimum, result.gain);
            branches.push({
                reply: makeSan(root.after, reply),
                answer: result.line[0],
                line: result.line,
                gain: result.gain,
            });
        }
        if (Number.isFinite(minimum))
            proof = {
                gain: minimum,
                targets,
                branches,
                examinedMoves: initialNodes - budget.nodes,
            };
    } catch (error) {
        onFailure?.(error instanceof Error ? error.message : String(error));
    }
    if (cacheable) {
        quietPawnForkCache.set(cacheKey, proof);
        if (quietPawnForkCache.size > 128)
            quietPawnForkCache.delete(quietPawnForkCache.keys().next().value!);
    }
    return proof;
}
const forkPreparationCache = new Map<string, ForkPreparationProof | null>();

type CaptureForkPreparationProof = Omit<ForkPreparationProof, "branches"> & {
    branches: (Omit<ForkPreparationProof["branches"][number], "kind"> & {
        kind: "fork" | "block" | "discovery";
        receiver: Role;
        removedDefender?: { square: Square; premature: string; defence: string };
        clearedForkSquare?: Square;
        vacatedForkSquare?: Square;
        exchange?: { given: "rook"; received: [Role, Role] };
        discovery?: { slider: Square; king: Square };
        quietForkGuard?: { square: Square; premature: string; defence: string };
    })[];
    declined: {
        reply: string;
        answer: string;
        mate?: true;
        countercaptured?: Role;
        delayedForks?: { acceptance: string; fork: string }[];
    }[];
    otherCaptures?: { reply: string; answer: string; gain: number }[];
};
const captureForkPreparationCache = new Map<string, CaptureForkPreparationProof | null>();

/** Settle one off-square countercapture after the fork's target is taken.
 * A legal recapture or a checking capture by the forker may restore material;
 * unrelated captures and arbitrary quiet continuations cannot rescue it.
 * Every opponent reply is inspected, then recovery leaves use bounded legal
 * exchange plus off-square liability and immediate-mate/promotion checks. */
function checkingCaptureRecoveryGain(
    pos: Chess,
    move: NormalMove,
    budget: { nodes: number },
    requiredGain: number,
): number | null {
    const side = pos.turn;
    const visit = (board: Chess, action: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Checking capture recovery budget exhausted");
        const next = board.clone();
        next.play(action);
        return next;
    };
    const after = visit(pos, move);
    if (after.isEnd()) return null;
    const earned = capturedValue(pos, move);
    let minimum = Infinity;
    for (const resource of legalMoves(after)) {
        const next = visit(after, resource);
        if (next.isEnd() || resource.promotion) return null;
        const capture = capturedValue(after, resource);
        if (!capture) {
            minimum = Math.min(minimum, earned);
            continue;
        }
        const loss = tacticalExchangeGain(after, resource);
        if (loss <= -VALUE.king) return null;
        let best = earned - Math.max(0, loss);
        if (best < requiredGain) {
            for (const answer of legalMoves(next)) {
                if (!capturedValue(next, answer) || answer.promotion) continue;
                const leaf = visit(next, answer);
                if (answer.to !== resource.to && !(answer.from === move.to && leaf.isCheck()))
                    continue;
                if (leaf.isEnd()) continue;
                let safe = true;
                for (const response of legalMoves(leaf)) {
                    if (response.promotion || visit(leaf, response).isCheckmate()) {
                        safe = false;
                        break;
                    }
                }
                if (!safe) continue;
                const gain = participantCaptureGain(
                    next,
                    answer,
                    [...next.board[side], answer.to],
                    budget,
                );
                if (gain !== null) best = Math.max(best, earned - capture + gain);
                if (best >= requiredGain) break;
            }
        }
        if (best < requiredGain) return null;
        minimum = Math.min(minimum, best);
    }
    return Number.isFinite(minimum) ? minimum : null;
}

/** A capture can attract its recapturer onto a checking fork, or draw away
 * the guard which could capture a premature quiet pawn fork.
 * Acceptance must recover the sacrifice against every fork defence. Declining
 * must leave a concrete safe continuation retaining the captured material.
 * This local proof does not search arbitrary quiet combinations. */
export function proveCaptureForkPreparation(
    root: TacticalReplayStep,
    nodeLimit = root.after.isCheck() ? 4096 : 8192,
    onFailure?: (reason: string) => void,
): CaptureForkPreparationProof | null {
    const failures: string[] | undefined = onFailure ? [] : undefined;
    const checking = proveCaptureCheckPreparation(
        root,
        nodeLimit,
        failures ? (reason) => failures.push(reason) : undefined,
    );
    if (checking) return checking;
    if (
        !root.after.isCheck() &&
        root.capture &&
        !root.move.promotion &&
        legalMoves(root.after).some((reply) => {
            if (reply.to !== root.move.to || !capturedValue(root.after, reply)) return false;
            const next = root.after.clone();
            next.play(reply);
            return legalMoves(next).some(
                (move) =>
                    next.board.get(move.from)?.role === "pawn" &&
                    !move.promotion &&
                    !capturedValue(next, move) &&
                    attacks(
                        { color: root.before.turn, role: "pawn" },
                        move.to,
                        next.board.occupied,
                    ).has(root.move.to),
            );
        })
    )
        return proveCaptureCheckPreparation(root, nodeLimit, onFailure, false, true);
    for (const failure of failures ?? []) onFailure?.(failure);
    return null;
}

export function proveCaptureDiscoveryPreparation(
    root: TacticalReplayStep,
    nodeLimit = root.after.isCheck() ? 4096 : 8192,
    onFailure?: (reason: string) => void,
): CaptureForkPreparationProof | null {
    return proveCaptureCheckPreparation(root, nodeLimit, onFailure, true);
}

function proveCaptureCheckPreparation(
    root: TacticalReplayStep,
    nodeLimit: number,
    onFailure?: (reason: string) => void,
    discoveryChecks = false,
    quietPawnForks = false,
): CaptureForkPreparationProof | null {
    if (
        !root.capture ||
        !root.before.board.get(root.move.to) ||
        root.move.promotion ||
        root.after.isEnd() ||
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0 ||
        tacticalExchangeGain(root.before, root.move) >= 100
    )
        return null;
    const side = root.before.turn;
    const enemy = opposite(side);
    const offered = root.after.board.get(root.move.to);
    const king = root.after.board.kingOf(enemy);
    if (
        !offered ||
        king === undefined ||
        (root.after.isCheck() &&
            !attacks(offered, root.move.to, root.after.board.occupied).has(king))
    )
        return null;
    const key = `${makeFen(root.before.toSetup())}:${root.uci}:${discoveryChecks}:${quietPawnForks}`;
    const defaultBudget = root.after.isCheck() ? 4096 : 8192;
    if (!onFailure && nodeLimit === defaultBudget && captureForkPreparationCache.has(key))
        return captureForkPreparationCache.get(key)!;
    const budget = { nodes: nodeLimit };
    const checking = checkingForkSearch(side, budget, true, discoveryChecks);
    const { visit, delta } = checking;
    const fork: typeof checking.fork = quietPawnForks
        ? (pos, move, _pieces, _excluded, minimumGain = 100) => {
              const step = replayTacticalLine(makeFen(pos.toSetup()), [makeUci(move)])[0];
              const result =
                  step &&
                  proveQuietPawnFork(
                      step,
                      16384,
                      Math.max(100, minimumGain),
                      undefined,
                      undefined,
                      budget,
                  );
              if (budget.nodes < 0) throw new Error("Quiet fork preparation budget exhausted");
              return result
                  ? {
                        gain: result.gain,
                        victims: result.targets,
                        targets: result.targets.map(
                            (to) => `${step.after.board.get(to)!.role} on ${makeSquare(to)}`,
                        ),
                    }
                  : null;
          }
        : checking.fork;
    let proof: CaptureForkPreparationProof | null = null;
    try {
        const branches: CaptureForkPreparationProof["branches"] = [];
        const declined: CaptureForkPreparationProof["declined"] = [];
        const otherCaptures: NonNullable<CaptureForkPreparationProof["otherCaptures"]> = [];
        const targets = new Set<Square>();
        const forkers = new Set<Square>();
        const preparedForks = new Set<string>();
        let minimum = Infinity;
        const replies = legalMoves(root.after).sort(
            (a, b) => Number(b.to === root.move.to) - Number(a.to === root.move.to),
        );
        for (const reply of replies) {
            const next = visit(root.after, reply);
            if (next.isEnd()) throw new Error("Terminal defence");
            const balance = root.capture - delta(root.after, reply);
            let won = false;
            if (reply.to === root.move.to && capturedValue(root.after, reply)) {
                const receiver = root.after.board.get(reply.from)!.role;
                const captured = root.before.board.get(root.move.to)!.role;
                const twoMinors =
                    offered.role === "rook" &&
                    ["knight", "bishop"].includes(captured) &&
                    ["knight", "bishop"].includes(receiver);
                // Preserve the actual residual of these specific exchanges.
                // Ordinary trades and declined offers retain the pawn floor.
                const minimumGain = twoMinors
                    ? // Two minors for a rook is a substantive exchange,
                      // even if the defender recovers one pawn elsewhere.
                      // Retain the actual positive residual gain; this does
                      // not relax ordinary pawn/trade or declined branches.
                      VALUE[captured] + VALUE[receiver] - VALUE.rook - VALUE.pawn
                    : offered.role === "bishop" && receiver === "knight"
                      ? VALUE.pawn - (VALUE.bishop - VALUE.knight)
                      : VALUE.pawn;
                // A more valuable receiver may simply lose the exchange.
                // This is an alternative defence, not evidence of a fork;
                // at least one separate verified fork branch is still required.
                let captureAlternative:
                    | NonNullable<CaptureForkPreparationProof["otherCaptures"]>[number]
                    | null = null;
                for (const answer of legalMoves(next)) {
                    if (
                        answer.to !== root.move.to ||
                        answer.promotion ||
                        !capturedValue(next, answer)
                    )
                        continue;
                    const leaf = visit(next, answer);
                    if (leaf.isEnd()) continue;
                    let safe = true;
                    for (const resource of legalMoves(leaf)) {
                        if (resource.promotion || visit(leaf, resource).isCheckmate()) {
                            safe = false;
                            break;
                        }
                    }
                    if (!safe) continue;
                    const gain = participantCaptureGain(
                        next,
                        answer,
                        [...next.board[side], answer.to],
                        budget,
                    );
                    if (gain === null || balance + gain < minimumGain) continue;
                    captureAlternative = {
                        reply: makeSan(root.after, reply),
                        answer: makeSan(next, answer),
                        gain: balance + gain,
                    };
                    break;
                }
                for (const answer of legalMoves(next)) {
                    if (answer.promotion) continue;
                    let quietForkGuard: CaptureForkPreparationProof["branches"][number]["quietForkGuard"];
                    if (quietPawnForks) {
                        if (
                            next.board.get(answer.from)?.role !== "pawn" ||
                            capturedValue(next, answer) ||
                            !attacks(
                                { role: "pawn", color: side },
                                answer.to,
                                next.board.occupied,
                            ).has(root.move.to) ||
                            !root.before.isLegal(answer)
                        )
                            continue;
                        const premature = visit(root.before, answer);
                        const defence = { from: reply.from, to: answer.to };
                        if (!premature.isLegal(defence) || !capturedValue(premature, defence))
                            continue;
                        const gain = participantCaptureGain(
                            premature,
                            defence,
                            [...premature.board[enemy], defence.to],
                            budget,
                        );
                        if (
                            gain === null ||
                            gain < 0 ||
                            !noImmediateTerminalRefutation(premature, defence, budget)
                        )
                            continue;
                        quietForkGuard = {
                            square: reply.from,
                            premature: makeSan(root.before, answer),
                            defence: makeSan(premature, defence),
                        };
                    }
                    // Sometimes the checking forker CAPTURES the recapturer
                    // instead of attacking it as a second target. Require a
                    // concrete earlier defence: the same defender could take
                    // the premature forker before the offered exchange.
                    let removedDefender: CaptureForkPreparationProof["branches"][number]["removedDefender"];
                    // A recapturing piece can vacate the square needed for a
                    // pawn's checking fork. This is clearance, not a fork of
                    // the recapturer: the straight pawn advance was blocked
                    // on the original board and is legal only after it moves.
                    const clearedForkSquare =
                        answer.to === reply.from &&
                        next.board.get(answer.from)?.role === "pawn" &&
                        answer.from % 8 === answer.to % 8 &&
                        !capturedValue(next, answer) &&
                        root.before.board.get(answer.to)?.color === enemy &&
                        !root.before.isLegal(answer)
                            ? answer.to
                            : undefined;
                    // The offer itself can vacate a square that its own
                    // checking forker needs. The fork must be blocked by
                    // that actual piece before the offer, not merely absent
                    // from the supplied PV. All acceptance/decline material
                    // checks below still apply independently.
                    const vacatedForkSquare =
                        !discoveryChecks &&
                        answer.to === root.move.from &&
                        !root.before.isLegal(answer) &&
                        next.isLegal(answer)
                            ? answer.to
                            : undefined;
                    const defenderSquare =
                        receiver !== "king" &&
                        answer.to === root.move.to &&
                        capturedValue(next, answer)
                            ? reply.from
                            : // The first capture can itself remove the defender
                              // of a checking fork of two OTHER pieces. Do not
                              // alter the established recapturer-target route.
                              !discoveryChecks &&
                                receiver !== "king" &&
                                answer.to !== root.move.to &&
                                !attacks(
                                    next.board.get(answer.from)!,
                                    answer.to,
                                    next.board.occupied.without(answer.from).with(answer.to),
                                ).has(root.move.to) &&
                                attacks(
                                    next.board.get(answer.from)!,
                                    answer.to,
                                    next.board.occupied.without(answer.from).with(answer.to),
                                ).has(king) &&
                                attacks(
                                    root.before.board.get(root.move.to)!,
                                    root.move.to,
                                    root.before.board.occupied.without(answer.from).with(answer.to),
                                ).has(answer.to)
                              ? root.move.to
                              : undefined;
                    if (defenderSquare !== undefined) {
                        if (!root.before.isLegal(answer)) continue;
                        const premature = visit(root.before, answer);
                        const defence = { from: defenderSquare, to: answer.to };
                        if (!premature.isLegal(defence) || !capturedValue(premature, defence))
                            continue;
                        const defended = visit(premature, defence);
                        if (defended.isEnd()) continue;
                        let safe = true;
                        for (const resource of legalMoves(defended)) {
                            if (resource.promotion || visit(defended, resource).isCheckmate()) {
                                safe = false;
                                break;
                            }
                        }
                        if (!safe) continue;
                        const gain = participantCaptureGain(
                            premature,
                            defence,
                            [...premature.board[enemy], defence.to],
                            budget,
                        );
                        if (gain === null || capturedValue(root.before, answer) - gain >= 100)
                            continue;
                        removedDefender = {
                            square: defenderSquare,
                            premature: makeSan(root.before, answer),
                            defence: makeSan(premature, defence),
                        };
                    }
                    // Include every remaining friendly piece, not only the
                    // forker: an off-square countercapture can erase the gain.
                    const result = fork(
                        next,
                        answer,
                        [...next.board[side], answer.to],
                        !discoveryChecks &&
                            (receiver === "king" ||
                                removedDefender ||
                                clearedForkSquare !== undefined ||
                                vacatedForkSquare !== undefined)
                            ? []
                            : [...next.board[enemy]].filter((sq) => sq !== root.move.to),
                        minimumGain - balance,
                        !root.after.isCheck(),
                    );
                    if (!result || balance + result.gain < minimumGain) continue;
                    branches.push({
                        reply: makeSan(root.after, reply),
                        answer: makeSan(next, answer),
                        kind: result.discovery ? "discovery" : "fork",
                        targets: result.targets,
                        receiver,
                        ...(quietForkGuard ? { quietForkGuard } : {}),
                        ...(result.discovery ? { discovery: result.discovery } : {}),
                        ...(twoMinors
                            ? {
                                  exchange: {
                                      given: "rook" as const,
                                      received: [captured, receiver] as [Role, Role],
                                  },
                              }
                            : {}),
                        ...(removedDefender ? { removedDefender } : {}),
                        ...(clearedForkSquare !== undefined ? { clearedForkSquare } : {}),
                        ...(vacatedForkSquare !== undefined ? { vacatedForkSquare } : {}),
                    });
                    for (const victim of result.victims) targets.add(victim);
                    forkers.add(answer.from);
                    if (
                        quietForkGuard ||
                        removedDefender?.square === root.move.to ||
                        vacatedForkSquare !== undefined
                    )
                        preparedForks.add(makeUci(answer));
                    minimum = Math.min(minimum, balance + result.gain);
                    won = true;
                    break;
                }
                if (!won && captureAlternative) {
                    otherCaptures.push(captureAlternative);
                    minimum = Math.min(minimum, captureAlternative.gain);
                    won = true;
                }
            } else {
                // Declining can permit the SAME prepared checking fork. Use
                // the reached board and mapped victims, never a borrowed PV.
                if (!discoveryChecks && preparedForks.size) {
                    const mapped = [...targets].map((sq) => (sq === reply.from ? reply.to : sq));
                    for (const answer of legalMoves(next)) {
                        if (!preparedForks.has(makeUci(answer)) || answer.promotion) continue;
                        const result = fork(
                            next,
                            answer,
                            [...next.board[side], answer.to],
                            [...next.board[enemy]].filter((sq) => !mapped.includes(sq)),
                            100 - balance,
                            !root.after.isCheck(),
                        );
                        if (!result || balance + result.gain < 100) continue;
                        declined.push({
                            reply: makeSan(root.after, reply),
                            answer: makeSan(next, answer),
                        });
                        minimum = Math.min(minimum, balance + result.gain);
                        won = true;
                        break;
                    }
                }
                // Declining cannot be waved away as compulsory acceptance.
                // Save the offer, let its verified forker support it while
                // escaping a counterattack, or make a necessary king evasion.
                // No unrelated quiet move can lend this preparation a win.
                for (const answer of legalMoves(next)) {
                    if (won) break;
                    const directCountercapture =
                        preparedForks.size > 0 &&
                        capturedValue(next, answer) > 0 &&
                        ((capturedValue(root.after, reply) > 0 && answer.to === reply.to) ||
                            next.ctx().checkers.has(answer.to));
                    if (
                        answer.promotion ||
                        (answer.from !== root.move.to &&
                            !forkers.has(answer.from) &&
                            !directCountercapture &&
                            !(next.ctx().checkers.has(answer.to) && capturedValue(next, answer)) &&
                            !(next.isCheck() && next.board.get(answer.from)?.role === "king"))
                    )
                        continue;
                    const after = visit(next, answer);
                    if (after.isCheckmate()) {
                        // Declining a material preparation may permit mate.
                        // This proves only that defence, not a mating root.
                        minimum = Math.min(minimum, 10000);
                        declined.push({
                            reply: makeSan(root.after, reply),
                            answer: makeSan(next, answer),
                            mate: true,
                        });
                        won = true;
                        break;
                    }
                    if (after.isEnd()) continue;
                    const countercaptured =
                        forkers.has(answer.from) &&
                        capturedValue(next, answer) &&
                        (attacks(next.board.get(answer.to)!, answer.to, next.board.occupied).has(
                            root.move.to,
                        ) ||
                            (answer.to === reply.to &&
                                attacks(
                                    next.board.get(answer.to)!,
                                    answer.to,
                                    next.board.occupied,
                                ).has(answer.from)))
                            ? next.board.get(answer.to)!.role
                            : undefined;
                    if (
                        forkers.has(answer.from) &&
                        answer.from !== root.move.to &&
                        !countercaptured &&
                        !attacks(after.board.get(answer.to)!, answer.to, after.board.occupied).has(
                            root.move.to,
                        )
                    )
                        continue;
                    const material = balance + delta(next, answer);
                    if (material < 100) continue;
                    let loss = 0;
                    const delayedForks: { acceptance: string; fork: string }[] = [];
                    for (const defence of legalMoves(after)) {
                        const leaf = visit(after, defence);
                        if (leaf.isCheckmate()) {
                            loss = VALUE.king;
                            break;
                        }
                        // Supporting the offer from behind is not safe if
                        // the opponent can line up a pin/skewer against both
                        // pieces. A quiet pin cannot be ignored just because
                        // it has not captured material yet.
                        if (
                            forkers.has(answer.from) &&
                            answer.from !== root.move.to &&
                            rayTactics(leaf, enemy).some(
                                (ray) => ray.front === root.move.to && ray.rear === answer.to,
                            )
                        ) {
                            loss = VALUE.king;
                            break;
                        }
                        if (!capturedValue(after, defence) && !defence.promotion) continue;
                        // A direct countercapture can compensate the offer,
                        // but not if its own capturing piece then falls too.
                        // Reject that unsettled two-square loss rather than
                        // combining independent single-exchange maxima.
                        if (directCountercapture && defence.to !== answer.to) {
                            const probe = withTurn(leaf, enemy);
                            let exposed = false;
                            for (const resource of legalMoves(probe)) {
                                if (resource.to !== answer.to || !capturedValue(probe, resource))
                                    continue;
                                visit(probe, resource);
                                const liability = tacticalExchangeGain(probe, resource);
                                if (liability > 0 || liability <= -VALUE.king) {
                                    exposed = true;
                                    break;
                                }
                            }
                            if (exposed) {
                                loss = VALUE.king;
                                break;
                            }
                        }
                        let gain = tacticalExchangeGain(after, defence);
                        if (gain <= -VALUE.king) {
                            loss = VALUE.king;
                            break;
                        }
                        // A forced king evasion can leave the SAME offered
                        // piece and checking forker in place. If the offer is
                        // accepted now, certify the delayed fork independently
                        // instead of treating the piece as simply hanging.
                        if (
                            material - gain < 100 &&
                            next.isCheck() &&
                            next.board.get(answer.from)?.role === "king" &&
                            !capturedValue(next, answer) &&
                            defence.to === root.move.to &&
                            capturedValue(after, defence) &&
                            !defence.promotion &&
                            !leaf.isEnd()
                        ) {
                            for (const follow of legalMoves(leaf)) {
                                if (!forkers.has(follow.from) || follow.promotion) continue;
                                const mapped = [...targets].map((sq) => {
                                    const afterReply = sq === reply.from ? reply.to : sq;
                                    return afterReply === defence.from ? defence.to : afterReply;
                                });
                                const result = fork(
                                    leaf,
                                    follow,
                                    [...leaf.board[side], follow.to],
                                    !discoveryChecks && preparedForks.has(makeUci(follow))
                                        ? [...leaf.board[enemy]].filter(
                                              (sq) => !mapped.includes(sq),
                                          )
                                        : !discoveryChecks &&
                                            leaf.board.get(defence.to)?.role === "king"
                                          ? []
                                          : [...leaf.board[enemy]].filter(
                                                (sq) => sq !== defence.to,
                                            ),
                                    100 - material + delta(after, defence),
                                    !root.after.isCheck(),
                                );
                                if (!result) continue;
                                gain = delta(after, defence) - result.gain;
                                delayedForks.push({
                                    acceptance: makeSan(after, defence),
                                    fork: makeSan(leaf, follow),
                                });
                                break;
                            }
                        }
                        loss = Math.max(loss, gain);
                    }
                    if (material - loss < 100) continue;
                    // For a captured-defender preparation, a different
                    // piece's capture cannot subsidise abandoning the offer:
                    // the offer and its supporter may BOTH fall on separate
                    // squares. The older one-exchange maximum does not prove
                    // that sequence safe. Require retention of the original
                    // gain here; a safe escape by the offer remains eligible.
                    if (
                        answer.from !== root.move.to &&
                        !directCountercapture &&
                        branches.some(
                            (branch) => branch.removedDefender?.square === root.move.to,
                        ) &&
                        balance - loss < 100
                    )
                        continue;
                    minimum = Math.min(minimum, material - loss);
                    declined.push({
                        reply: makeSan(root.after, reply),
                        answer: makeSan(next, answer),
                        ...(countercaptured ? { countercaptured } : {}),
                        ...(delayedForks.length ? { delayedForks } : {}),
                    });
                    won = true;
                    break;
                }
            }
            if (!won)
                throw new Error(
                    `Unproved defence to the offered capture: ${makeSan(root.after, reply)}`,
                );
        }
        if (branches.length && Number.isFinite(minimum))
            proof = {
                gain: minimum,
                targets: [...targets],
                branches,
                declined,
                ...(otherCaptures.length ? { otherCaptures } : {}),
            };
    } catch (error) {
        // Exhaustion and unsupported branches abstain, never borrow a PV.
        onFailure?.(error instanceof Error ? error.message : "Unproved capture preparation");
    }
    if (nodeLimit === defaultBudget) {
        captureForkPreparationCache.set(key, proof);
        if (captureForkPreparationCache.size > 128)
            captureForkPreparationCache.delete(captureForkPreparationCache.keys().next().value!);
    }
    return proof;
}

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

/** A material fork may be protected by a forced mating reply rather than by
 * an ordinary recapture. Only a complete all-defence certificate can use it. */
export function proveMateBackedFork(step: TacticalReplayStep, nodeLimit = 4096) {
    if (!Number.isSafeInteger(nodeLimit) || nodeLimit <= 0 || step.move.promotion) return null;
    const targets = winningTargets(step.after, step.move.to, step.before.turn);
    if (targets.length < 2) return null;
    const capturesForker = new Set(
        legalMoves(step.after)
            .filter((reply) => reply.to === step.move.to && capturedValue(step.after, reply))
            .map((reply) => makeSan(step.after, reply)),
    );
    if (!capturesForker.size) return null;
    const proof = materialThreatProof(step, targets, [step.move.to], [], true, undefined, {
        minimumGain: 100,
        mateAnswerMoves: 4,
        mateNodeLimit: nodeLimit,
        allPiecesAtLeaf: true,
    });
    return proof.kind === "proven" &&
        proof.complete &&
        proof.gain < 10000 &&
        proof.matingDefences?.some((branch) => capturesForker.has(branch.defence))
        ? {
              ...proof,
              targets,
              matingDefences: proof.matingDefences.filter((branch) =>
                  capturesForker.has(branch.defence),
              ),
          }
        : null;
}

/** A minor-piece fork of major pieces can win an exchange for a pawn while
 * falling below the generic one-pawn gate. Require the actual heavy victims
 * and complete all-defence exchange leaves; near-equal minor trades do not
 * qualify. This is a local material certificate, not a position evaluation. */
export function proveExchangeForPawnFork(step: TacticalReplayStep, nodeLimit = 4096) {
    if (!Number.isSafeInteger(nodeLimit) || nodeLimit <= 0) return null;
    const role = step.after.board.get(step.move.to)?.role;
    if (step.capture || step.move.promotion || (role !== "knight" && role !== "bishop"))
        return null;
    const targets = winningTargets(step.after, step.move.to, step.before.turn);
    if (targets.length < 2) return null;
    const material = targets.filter((target) => step.after.board.get(target)?.role !== "king");
    if (
        !material.length ||
        material.some((target) => VALUE[step.after.board.get(target)!.role] < VALUE.rook)
    )
        return null;
    const proof = materialThreatProof(step, targets, [step.move.to], [], true, undefined, {
        minimumGain: VALUE.rook - VALUE[role] - VALUE.pawn,
        mateAnswerMoves: 4,
        mateNodeLimit: nodeLimit,
    });
    return proof.kind === "proven" && proof.complete ? { ...proof, targets } : null;
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
 * Leaves debit immediate captures of any friendly piece, not just the battery.
 * The PV is not a defence list. A budget failure is unknown, not a proof. */
export function proveDiscoveredMaterial(
    step: TacticalReplayStep,
    nodeLimit = DISCOVERY_NODE_LIMIT,
    minimumGain = 100,
    onLeaf?: (leaf: MaterialRecoveryLeaf) => void,
    onFailure?: (reason: string) => void,
) {
    if (
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0 ||
        !Number.isSafeInteger(minimumGain) ||
        minimumGain <= 0
    )
        return null;
    const rays = revealedRays(step);
    if (!rays.length) return null;
    const key = `${makeFen(step.before.toSetup())}:${step.uci}:${minimumGain}`;
    if (!onFailure && !onLeaf && nodeLimit === DISCOVERY_NODE_LIMIT && discoveryProofCache.has(key))
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
                    const budget = { nodes };
                    const matingReplies: MatingLiability[] = [];
                    const gain = discoveryCaptureGain(
                        pos,
                        move,
                        minimumGain - balance,
                        budget,
                        (reply) => matingReplies.push(reply),
                    );
                    nodes = budget.nodes;
                    if (gain === null) continue;
                    best = Math.max(best, balance + gain);
                    if (balance + gain >= minimumGain)
                        onLeaf?.({
                            fen: makeFen(pos.toSetup()),
                            moveUci: makeUci(move),
                            balance,
                            gain: balance + gain,
                            quiet: false,
                            ...(matingReplies.length ? { matingReplies } : {}),
                        });
                }
            }
        }
        if (best >= minimumGain) return best;
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
            if (gain === null) {
                if (pos === step.after)
                    onFailure?.(`Unproved reply ${makeSan(pos, reply)} (${nodes})`);
                return null;
            }
            minimum = Math.min(minimum, gain);
        }
        return Number.isFinite(minimum) ? minimum : null;
    };
    let proof: number | null = null;
    try {
        proof = defend(step.after, targets, capturers, delta(step.before, step.move), true);
    } catch (error) {
        onFailure?.(error instanceof Error ? error.message : String(error));
        // Incomplete bounded search cannot certify a tactical gain.
    }
    if (!onFailure && !onLeaf && nodeLimit === DISCOVERY_NODE_LIMIT) {
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
    branches: {
        reply: string;
        answer: string;
        gain: number;
        extended: boolean;
        nodesUsed: number;
    }[];
};
const exchangeDiscoveryCache = new Map<string, ExchangeDiscoveryProof | null>();

/** A newly opened battery and the moving piece can overload a shared defender.
 * If a target escapes while guarding another target, allow one capture of that
 * defender, with every subsequent reply checked by the defender-removal proof.
 * A concrete countercapture by that same capturer may supply a new target;
 * a safe quiet move may retain material actually captured, never fund a win.
 * The complete outer/inner search shares one budget and accounts for all friendly
 * pieces and immediate terminal resources at leaves; PV replies nominate nothing. */
export function proveExchangeDiscovery(
    step: TacticalReplayStep,
    nodeLimit = 8192,
    onFailure?: (reason: string) => void,
    onLeaf?: (leaf: MaterialRecoveryLeaf) => void,
): ExchangeDiscoveryProof | null {
    if (!Number.isSafeInteger(nodeLimit) || nodeLimit <= 0) return null;
    const rays = revealedRays(step);
    if (!rays.length) return null;
    const key = `${makeFen(step.before.toSetup())}:${step.uci}`;
    if (!onFailure && !onLeaf && nodeLimit === 8192 && exchangeDiscoveryCache.has(key))
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
    let defensiveBranch = "";
    try {
        const replies = recoveryMoves(step.after, side);
        const branches: ExchangeDiscoveryProof["branches"] = [];
        let minimum = Infinity;
        let witness: Omit<ExchangeDiscoveryProof, "gain" | "branches"> | null = null;
        for (const reply of replies) {
            defensiveBranch = makeSan(step.after, reply);
            const startingNodes = budget.nodes;
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
            let answer = "";
            let extended = false;
            const moves = recoveryMoves(pos, side).filter(
                (m) => victims.includes(m.to) && capturedValue(pos, m),
            );
            for (const move of moves) {
                const gain = participantCaptureGain(
                    pos,
                    move,
                    [...pos.board[side], move.to],
                    budget,
                );
                if (
                    gain !== null &&
                    balance + gain > best &&
                    balance + gain >= 100 &&
                    noImmediateTerminalRefutation(pos, move, budget)
                ) {
                    best = balance + gain;
                    answer = makeSan(pos, move);
                }
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
                        [
                            ...new Set([
                                ...victims.filter((to) => to !== move.to),
                                ...attacks(
                                    after.board.get(move.to)!,
                                    move.to,
                                    after.board.occupied,
                                ).intersect(after.board[opposite(side)]),
                            ]),
                        ],
                        [...new Set([...pieces.filter((from) => from !== move.from), move.to])],
                        nodeLimit,
                        budget,
                        2,
                        true,
                        Math.max(90, 100 - balance),
                        onLeaf,
                    );
                    if (gain === null || balance + gain < 100) continue;
                    best = balance + gain;
                    answer = makeSan(pos, move);
                    extended = true;
                    // Prefer the actual defender exchange over a branch
                    // which simply takes the queen left en prise.
                    if (!witness || VALUE[pos.board.get(move.from)!.role] === VALUE[defender.role])
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
            branches.push({
                reply: defensiveBranch,
                answer,
                gain: best,
                extended,
                nodesUsed: startingNodes - budget.nodes,
            });
        }
        if (witness && Number.isFinite(minimum)) result = { gain: minimum, ...witness, branches };
    } catch (error) {
        onFailure?.(
            `${error instanceof Error ? error.message : String(error)} (${defensiveBranch})`,
        );
        // A missing branch or exhausted shared budget is unknown, never a proof.
    }
    if (!onFailure && !onLeaf && nodeLimit === 8192) {
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
    const immediate = mate
        ? null
        : materialThreatProof(
              step,
              targets,
              capturers,
              kingRay ? [...between(kingRay.from, kingRay.target)] : [],
          );
    const complete =
        immediate?.kind === "proven"
            ? materialThreatProof(
                  step,
                  targets,
                  capturers,
                  kingRay ? [...between(kingRay.from, kingRay.target)] : [],
                  false,
                  undefined,
                  { allPiecesAtLeaf: true },
              )
            : null;
    // A stricter liability check is not a reason to increase the lesson's
    // value by selecting a different (possibly mating) leaf.
    const proof =
        complete?.kind === "proven" && immediate?.kind === "proven"
            ? { ...complete, gain: Math.min(complete.gain, immediate.gain) }
            : (complete ?? immediate);
    const minimumGain = step.capture
        ? Math.max(100, tacticalExchangeGain(step.before, step.move) + 1)
        : 100;
    const immediateEnough = proof?.kind === "proven" && proof.gain >= minimumGain;
    const directGain = immediateEnough
        ? proof.gain
        : !mate
          ? proveDiscoveredMaterial(step, DISCOVERY_NODE_LIMIT, minimumGain)
          : null;
    const exchange = !mate && directGain === null ? proveExchangeDiscovery(step) : null;
    const gain = directGain ?? exchange?.gain ?? null;
    if (!mate && gain === null) return null;
    // When the only newly opened ray gives check, an independently proved
    // intermediate capture can already explain the same material gain and
    // why move order matters. Keep its lesson and describe the discovery in
    // its explanation instead of adding another badge for that same check.
    if (
        !mate &&
        kingRay &&
        gain !== null &&
        rays.length === 1 &&
        step.after.ctx().checkers.size() === 1
    ) {
        const order = intermediateCaptureProof(step);
        if (
            order &&
            order.gain === gain &&
            targets.every((to) => to === kingRay.target || to === order.deferred.to)
        )
            return null;
    }
    // A mating deflection can already explain this exact opened mating
    // route, while a separately certified fork explains the material decline.
    // Do not count their shared route as a third independent lesson. Keep
    // discoveries with another ray, a checking battery, a larger gain, or
    // incomplete material/mating certificates.
    if (!kingRay && gain !== null) {
        const fork = proveMateBackedFork(step);
        const deflection = fork && fork.gain >= gain ? proveMatingDeflection(step) : null;
        const covered = deflection ? matingDeflectionRays(step, deflection) : [];
        if (
            covered.length &&
            rays.every((ray) =>
                covered.some((other) => other.from === ray.from && other.target === ray.target),
            )
        )
            return null;
    }
    // A pawn ray uncovered incidentally by a winning knight fork does not
    // explain that fork's payoff. Non-king discoveries need a contribution
    // beyond what the moving piece already forces on its own targets.
    if (!kingRay && gain !== null && verifiedFork(step)) {
        const independentGain =
            materialThreatGain(step, winningTargets(step.after, step.move.to, step.before.turn), [
                step.move.to,
            ]) ??
            proveRecaptureBackedFork(step)?.gain ??
            null;
        if (independentGain !== null && independentGain >= gain) return null;
        // A tiny difference between two bounded searches is not evidence of
        // an extra pawn-winning lesson. Keep the independently proved fork
        // and omit secondary pawn pressure unless its joint bound is at least
        // a pawn larger. King/material-piece rays retain the stricter rule.
        if (
            independentGain !== null &&
            gain < independentGain + VALUE.pawn &&
            rays.every((ray) => step.after.board.get(ray.target)?.role === "pawn")
        )
            return null;
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
    const materialRays = rays.filter((ray) => step.after.board.get(ray.target)?.role !== "pawn");
    const describedRays = kingRay
        ? [kingRay]
        : (materialRays.length ? materialRays : rays).slice(0, 2);
    const opened = describedRays.map(
        (ray) =>
            `the ${step.after.board.get(ray.from)!.role} on ${makeSquare(ray.from)} against the ${step.after.board.get(ray.target)!.role} on ${makeSquare(ray.target)}`,
    );
    const action = `${step.san} vacates ${makeSquare(step.move.from)}, uncovering ${opened.join(" and ")}.`;
    const moverTargets = targets.filter(
        (to) => !rays.some((r) => r.target === to) && step.after.board.get(to)?.role !== "king",
    );
    // For a non-checking material discovery, explain meaningful joint
    // targets rather than append incidental pawn pressure to every check.
    const profitableTargets =
        !kingRay && !exchange ? winningTargets(step.after, step.move.to, step.before.turn) : null;
    const supportingTargets = profitableTargets
        ? moverTargets.filter((to) => profitableTargets.includes(to))
        : moverTargets;
    const accompaniment =
        (!kingRay && step.after.isCheck()
            ? ` The moving ${moved.role} gives check, so the opponent cannot simply ignore the exposed attack.`
            : "") +
        (supportingTargets.length
            ? ` The ${moved.role} on ${makeSquare(step.move.to)} also attacks ${supportingTargets.map((to) => `the ${step.after.board.get(to)!.role} on ${makeSquare(to)}`).join(" and ")}.`
            : "");
    const consequence = mate
        ? step.after.isCheckmate()
            ? "There is no legal defence: checkmate."
            : "Every legal defence allows the verified short forced mate."
        : exchange
          ? `The shared defence cannot save all these targets: after ${exchange.example[0]}, ${exchange.example[1]} removes the defender. Every legal reply permits a local material gain, including exchanges and up to two checking counterattacks; immediate losses elsewhere on the board, mate and promotion replies are checked.`
          : `Every legal ${kingRay ? "answer to the discovered check" : "reply"} ${immediateEnough ? "concedes material" : "allows material gain or a short forced mate, including checking answers to countercaptures"}. Captures and interpositions are included in this check.`;
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

function rayMaterialProof(step: TacticalReplayStep, ray: RayTactic) {
    const blocks =
        ray.kind === "skewer" && step.after.board.get(ray.front)?.role === "king"
            ? [...between(ray.pinner, ray.front)]
            : [];
    let proof = materialThreatProof(step, [ray.front, ray.rear], [ray.pinner, step.move.to]);
    if (proof.kind === "proven") return proof;
    if (blocks.length)
        proof = materialThreatProof(
            step,
            [ray.front, ray.rear],
            [ray.pinner, step.move.to],
            blocks,
            false,
            undefined,
            { allPiecesAtLeaf: true },
        );
    if (proof.kind === "proven" && blocks.length) return { ...proof, blockingProof: true as const };
    if (proof.kind !== "proven" && blocks.length) {
        const continuation = proveCheckingMaterialAttack([step]);
        if (continuation?.target === ray.rear) {
            const branch =
                continuation.branches.find((b) => {
                    const reply = parseSan(step.after, b.reply);
                    return reply && "from" in reply && blocks.includes(reply.to);
                }) ?? continuation.branches[0];
            const limiting = continuation.branches.reduce((a, b) => (a.gain <= b.gain ? a : b));
            return {
                kind: "proven" as const,
                complete: true,
                gain: continuation.gain,
                defence: limiting.reply,
                checkingLine: [branch.reply, ...branch.line],
            };
        }
    }
    return proof;
}

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
    | {
          kind: "proven";
          gain: number;
          complete: boolean;
          defence: string;
          matingDefences?: { defence: string; mate: string }[];
      }
    | { kind: "forcing"; gain: number; checks: string[] }
    | { kind: "refuted"; defence: string; checking: boolean }
    | { kind: "unknown" };
const materialProofCache = new Map<string, MaterialThreatProof>();
type MaterialProofOptions = {
    minimumGain?: number;
    mateAnswerMoves?: 1 | 4;
    mateNodeLimit?: number;
    allPiecesAtLeaf?: boolean;
};
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
    options: MaterialProofOptions = {},
) {
    const key = `${makeFen(step.after.toSetup())}:${step.capture}:${step.move.promotion}:${targets}:${capturers}:${interpositions}:${allowMateAnswer}:${promotionFrom}:${options.minimumGain ?? 100}:${options.mateAnswerMoves ?? 1}:${options.mateNodeLimit ?? 4096}:${Boolean(options.allPiecesAtLeaf)}`;
    if (materialProofCache.has(key)) return materialProofCache.get(key)!;
    const proof = computeMaterialThreatGain(
        step,
        targets,
        capturers,
        interpositions,
        allowMateAnswer,
        promotionFrom,
        options,
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
    options: MaterialProofOptions = {},
): MaterialThreatProof {
    const { minimumGain = 100, mateAnswerMoves = 1, mateNodeLimit = 4096 } = options;
    const replies = legalMoves(step.after);
    if (!replies.length) return { kind: "unknown" };
    let minimum = Infinity;
    let incomplete = false;
    let complete = true;
    let limitingDefence = "";
    const checks: string[] = [];
    let mateNodes = mateNodeLimit;
    const matingDefences: { defence: string; mate: string }[] = [];
    const checkingMateAnswer = (position: Chess, remaining: number): string[] | null => {
        const checks: { move: NormalMove; answer: Chess }[] = [];
        for (const move of legalMoves(position)) {
            if (--mateNodes < 0) return null;
            const answer = position.clone();
            answer.play(move);
            if (answer.isCheckmate()) return [makeSan(position, move)];
            if (remaining > 1 && answer.isCheck()) checks.push({ move, answer });
        }
        // Finish an available mate before exploring optional extra checking
        // sacrifices. Such detours can be sound yet teach the wrong mechanism.
        for (const { move, answer } of checks) {
            const evasions = legalMoves(answer);
            let example: string[] | null = null;
            let allMated = evasions.length > 0;
            for (const evasion of evasions) {
                if (--mateNodes < 0) return null;
                const escaped = answer.clone();
                escaped.play(evasion);
                const mate = checkingMateAnswer(escaped, remaining - 1);
                if (!mate) {
                    allMated = false;
                    break;
                }
                example ??= [makeSan(position, move), makeSan(answer, evasion), ...mate];
            }
            if (allMated && example) return example;
        }
        return null;
    };
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
                    let exchangeGain = tacticalExchangeGain(next, move);
                    if (options.allPiecesAtLeaf) {
                        const budget = { nodes: mateNodes };
                        try {
                            const leaf = next.clone();
                            leaf.play(move);
                            if (leaf.isCheckmate()) {
                                // Winning the target by mate is a mating
                                // branch, not independent material evidence
                                // for a fork inside an all-mating combination.
                                best = 10000;
                                matingDefences.push({
                                    defence: makeSan(step.after, reply),
                                    mate: makeSan(next, move),
                                });
                                continue;
                            }
                            if (leaf.isEnd() && !leaf.isCheckmate()) continue;
                            let unsafe = false;
                            for (const resource of legalMoves(leaf)) {
                                if (--budget.nodes < 0)
                                    throw new Error("Fork leaf budget exhausted");
                                const after = leaf.clone();
                                after.play(resource);
                                if (resource.promotion || after.isCheckmate()) {
                                    unsafe = true;
                                    break;
                                }
                            }
                            if (unsafe) {
                                mateNodes = budget.nodes;
                                continue;
                            }
                            const gain = participantCaptureGain(
                                next,
                                move,
                                [...next.board[step.before.turn], move.to],
                                budget,
                            );
                            if (gain === null) {
                                unknown = true;
                                mateNodes = budget.nodes;
                                continue;
                            }
                            exchangeGain = gain;
                        } catch {
                            return { kind: "unknown" };
                        }
                        mateNodes = budget.nodes;
                    }
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
            best < minimumGain &&
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
        if (best < minimumGain && allowMateAnswer) {
            const mate = checkingMateAnswer(next, mateAnswerMoves);
            if (mateNodes < 0) return { kind: "unknown" };
            if (mate) {
                best = 10000;
                matingDefences.push({ defence: makeSan(step.after, reply), mate: mate.join(" ") });
            }
        }
        if (unknown) complete = false;
        if (best < minimumGain) {
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
        : {
              kind: "proven",
              gain: minimum,
              complete,
              defence: limitingDefence,
              ...(matingDefences.length ? { matingDefences } : {}),
          };
}

type PinEntryProof = {
    gain: number;
    branches: {
        reply: string;
        preparation: string;
        target: Square;
        targetRole: Role;
        mate: string;
    }[];
};
const pinEntryCache = new Map<string, PinEntryProof | null>();

/** The pin protects a checking entry, then that same piece attacks material
 * while enabling its pinner's mate. Every reply at both stages is checked;
 * neither a later PV gift nor a cycle can certify this connection. */
export function provePinEntry(root: TacticalReplayStep, nodeLimit = 8192): PinEntryProof | null {
    if (
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0 ||
        root.capture ||
        root.move.promotion ||
        root.before.isCheck() ||
        !root.after.isCheck() ||
        root.after.isEnd()
    )
        return null;
    const ray = pinRestrictsCapture(root);
    if (!ray || ray.pinner === root.move.to) return null;
    const key = `${makeFen(root.before.toSetup())}:${root.uci}`;
    if (nodeLimit === 8192 && pinEntryCache.has(key)) return pinEntryCache.get(key)!;
    const side = root.before.turn;
    const budget = { nodes: nodeLimit };
    const visit = (pos: Chess, move: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Pin entry budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    let proof: PinEntryProof | null = null;
    try {
        const branches: PinEntryProof["branches"] = [];
        let minimum = Infinity;
        for (const reply of legalMoves(root.after)) {
            if (reply.promotion || capturedValue(root.after, reply))
                throw new Error("Unsupported entry capture");
            const next = visit(root.after, reply);
            if (next.isEnd()) throw new Error("Terminal entry reply");
            let found = false;
            for (const preparation of legalMoves(next).filter((m) => m.from === root.move.to)) {
                if (preparation.promotion || capturedValue(next, preparation)) continue;
                const prepared = visit(next, preparation);
                if (prepared.isCheck() || prepared.isEnd()) continue;
                const mover = prepared.board.get(preparation.to)!;
                const targets = winningTargets(prepared, preparation.to, side).filter(
                    (sq) =>
                        VALUE[prepared.board.get(sq)!.role] >= VALUE.rook &&
                        !attacks(
                            next.board.get(preparation.from)!,
                            preparation.from,
                            next.board.occupied,
                        ).has(sq),
                );
                if (!targets.length) continue;
                const probe = withTurn(prepared, side);
                const mates = legalMoves(probe).filter(
                    (m) =>
                        m.from === ray.pinner &&
                        attacks(mover, preparation.to, prepared.board.occupied).has(m.to) &&
                        visit(probe, m).isCheckmate() &&
                        (!next.isLegal(m) || !visit(next, m).isCheckmate()),
                );
                if (!mates.length) continue;
                let gain = Infinity,
                    sawMaterial = false,
                    sawMate = false,
                    complete = true;
                for (const defence of legalMoves(prepared)) {
                    if (defence.promotion) {
                        complete = false;
                        break;
                    }
                    const answer = visit(prepared, defence);
                    if (answer.isEnd()) {
                        complete = false;
                        break;
                    }
                    if (
                        mates.some(
                            (m) =>
                                answer.board.get(m.from)?.color === side &&
                                answer.isLegal(m) &&
                                visit(answer, m).isCheckmate(),
                        )
                    ) {
                        sawMate = true;
                        continue;
                    }
                    let best = -Infinity;
                    for (const capture of legalMoves(answer)) {
                        if (
                            capture.promotion ||
                            !capturedValue(answer, capture) ||
                            !targets.some(
                                (sq) => capture.to === (defence.from === sq ? defence.to : sq),
                            ) ||
                            (capture.from !== preparation.to &&
                                !answer.isCheck() &&
                                defence.to !== preparation.to)
                        )
                            continue;
                        const leaf = visit(answer, capture);
                        if (leaf.isEnd()) continue;
                        if (
                            legalMoves(leaf).some(
                                (m) => m.promotion || visit(leaf, m).isCheckmate(),
                            )
                        )
                            continue;
                        const settled = participantCaptureGain(
                            answer,
                            capture,
                            [...answer.board[side], capture.to],
                            budget,
                        );
                        if (settled !== null)
                            best = Math.max(best, settled - capturedValue(prepared, defence));
                    }
                    if (best < 100) {
                        complete = false;
                        break;
                    }
                    gain = Math.min(gain, best);
                    sawMaterial = true;
                }
                if (!complete || !sawMaterial || !sawMate || !Number.isFinite(gain)) continue;
                minimum = Math.min(minimum, gain);
                branches.push({
                    reply: makeSan(root.after, reply),
                    preparation: makeSan(next, preparation),
                    target: targets[0],
                    targetRole: prepared.board.get(targets[0])!.role,
                    mate: makeSan(probe, mates[0]),
                });
                found = true;
                break;
            }
            if (!found) throw new Error("Unproved pin entry reply");
        }
        if (branches.length && Number.isFinite(minimum)) proof = { gain: minimum, branches };
    } catch {
        /* Unknown branches and exhausted work abstain. */
    }
    if (nodeLimit === 8192) {
        pinEntryCache.set(key, proof);
        if (pinEntryCache.size > 128) pinEntryCache.delete(pinEntryCache.keys().next().value!);
    }
    return proof;
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

/** A profitable capture can exploit an existing pin without attacking the
 * pinned piece next. Require the forbidden recapture to erase that profit.
 * Removing the pinner is only a local recapture counterfactual: abstain when
 * that removal could change support on the exchange square or own-king rays. */
export function provePinnedCapture(step: TacticalReplayStep, nodeLimit = 4096) {
    if (!Number.isSafeInteger(nodeLimit) || nodeLimit <= 0) return null;
    const victim = step.before.board.get(step.move.to);
    if (!step.capture || step.move.promotion || !victim || victim.color === step.before.turn)
        return null;
    const immediate = tacticalExchangeGain(step.before, step.move);
    const ray = pinRestrictsCapture(step);
    if (!ray) return null;
    const pinner = step.after.board.get(ray.pinner)!;
    const aligned = (square: Square, diagonalOnly = false) => {
        const file = Math.abs((ray.pinner % 8) - (square % 8));
        const rank = Math.abs(Math.floor(ray.pinner / 8) - Math.floor(square / 8));
        return file === rank || (!diagonalOnly && (!file || !rank));
    };
    const ownKing = step.after.board.kingOf(step.before.turn);
    if (ownKing === undefined) return null;
    // A shared rank alone is harmless. Reject only a real enemy sliding ray
    // through the pinner, including rays currently blocked by other pieces.
    for (const from of step.after.board[step.after.turn]) {
        if (!between(ownKing, from).has(ray.pinner)) continue;
        const piece = step.after.board.get(from)!;
        const file = Math.abs((ownKing % 8) - (from % 8));
        const rank = Math.abs(Math.floor(ownKing / 8) - Math.floor(from / 8));
        if (
            piece.role === "queen" ||
            (piece.role === "rook" && (!file || !rank)) ||
            (piece.role === "bishop" && file === rank)
        )
            return null;
    }
    const file = Math.abs((ray.pinner % 8) - (step.move.to % 8));
    const rank = Math.abs(Math.floor(ray.pinner / 8) - Math.floor(step.move.to / 8));
    if (
        (pinner.role === "queen" && aligned(step.move.to)) ||
        (pinner.role === "bishop" && aligned(step.move.to, true)) ||
        (pinner.role === "rook" && (!file || !rank))
    )
        return null;
    const unpinned = step.after.clone();
    unpinned.board.take(ray.pinner);
    const recapture = { from: ray.front, to: step.move.to };
    const replyGain = tacticalExchangeGain(unpinned, recapture);
    if (replyGain < step.capture) return null;
    const combination =
        immediate < 100 ? pinnedCaptureCombination(step, ray.front, nodeLimit) : null;
    const gain = combination?.gain ?? immediate;
    if (gain < 100) return null;
    return { gain, ray, victim: victim.role, compensation: combination?.compensation };
}

/** Capturing a piece defended by a pinned pawn may also invite a different
 * recapturer. Only that recapturer and material it actually guards belong to
 * the combination. Verify every reply against a bounded related capture or
 * safe flight, subtracting all immediate capture liabilities at the leaf. */
type PinnedCaptureCombination = {
    gain: number;
    compensation?: { reply: string; answer: string; victim?: Role; target?: Square };
};
const pinnedCaptureCombinationCache = new Map<string, PinnedCaptureCombination | null>();
function pinnedCaptureCombination(
    step: TacticalReplayStep,
    pinned: Square,
    nodeLimit: number,
): PinnedCaptureCombination | null {
    const key = `${makeFen(step.before.toSetup())}:${step.uci}:${pinned}`;
    if (nodeLimit === 4096 && pinnedCaptureCombinationCache.has(key))
        return pinnedCaptureCombinationCache.get(key)!;
    const proof = computePinnedCaptureCombination(step, pinned, nodeLimit);
    if (nodeLimit === 4096) {
        pinnedCaptureCombinationCache.set(key, proof);
        if (pinnedCaptureCombinationCache.size > 128)
            pinnedCaptureCombinationCache.delete(
                pinnedCaptureCombinationCache.keys().next().value!,
            );
    }
    return proof;
}
function computePinnedCaptureCombination(
    step: TacticalReplayStep,
    pinned: Square,
    nodeLimit: number,
): PinnedCaptureCombination | null {
    const side = step.before.turn;
    const enemy = opposite(side);
    const targets = new Set<Square>([pinned]);
    for (const from of step.after.board[enemy]) {
        const piece = step.after.board.get(from)!;
        if (!attacks(piece, from, step.after.board.occupied).has(step.move.to)) continue;
        targets.add(from);
        for (const target of attacks(piece, from, step.before.board.occupied).intersect(
            step.before.board[enemy],
        )) {
            if (
                step.after.board.get(target)?.color !== enemy ||
                step.after.board.get(target)?.role === "king"
            )
                continue;
            if (
                [...step.after.board[side]].some((attacker) =>
                    attacks(
                        step.after.board.get(attacker)!,
                        attacker,
                        step.after.board.occupied,
                    ).has(target),
                )
            )
                targets.add(target);
        }
    }
    let nodes = nodeLimit;
    let minimum = Infinity;
    let compensation: PinnedCaptureCombination["compensation"];
    for (const reply of legalMoves(step.after)) {
        if (--nodes < 0) return null;
        const next = step.after.clone();
        next.play(reply);
        const balance =
            step.capture -
            capturedValue(step.after, reply) -
            (reply.promotion ? VALUE[reply.promotion] - VALUE.pawn : 0);
        const mapped = new Set(
            [...targets].map((target) => (target === reply.from ? reply.to : target)),
        );
        let best = -VALUE.king;
        let answer: string | undefined;
        let payoff: { victim?: Role; target?: Square } = {};
        for (const move of legalMoves(next)) {
            const capture = capturedValue(next, move);
            const relatedCapture = capture > 0 && mapped.has(move.to);
            const flight =
                !capture &&
                !move.promotion &&
                (move.from === step.move.to ||
                    (next.isCheck() && next.board.get(move.from)?.role === "king"));
            if (!relatedCapture && !flight) continue;
            if (--nodes < 0) return null;
            const material =
                balance +
                capturedValue(next, move) +
                (move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0);
            if (material < 100) continue;
            const after = next.clone();
            after.play(move);
            if (after.isEnd()) continue;
            let loss = 0;
            let resolved = true;
            for (const capture of legalMoves(after)) {
                if (--nodes < 0) return null;
                const threat = after.clone();
                threat.play(capture);
                if (threat.isCheckmate()) {
                    resolved = false;
                    break;
                }
                if (!capturedValue(after, capture) && !capture.promotion) continue;
                const gain = tacticalExchangeGain(after, capture);
                if (gain <= -VALUE.king) {
                    resolved = false;
                    break;
                }
                loss = Math.max(loss, gain);
            }
            if (!resolved) continue;
            const gain = material - loss;
            if (gain > best) {
                best = gain;
                answer = makeSan(next, move);
                payoff = capture ? { victim: next.board.get(move.to)?.role, target: move.to } : {};
            }
            if (best >= 100) break;
        }
        if (best < 100) return null;
        minimum = Math.min(minimum, best);
        if (reply.to === step.move.to && answer)
            compensation = { reply: makeSan(step.after, reply), answer, ...payoff };
    }
    return Number.isFinite(minimum) ? { gain: minimum, compensation } : null;
}

function pinnedCaptureEvidence(step: TacticalReplayStep, source: TacticalMotifEvidence["source"]) {
    const proof = provePinnedCapture(step);
    if (!proof) return null;
    const { ray } = proof;
    return {
        id: "pin",
        label: "Pin",
        source,
        confidence: "high",
        ply: 1,
        moveUci: step.uci,
        value: proof.gain,
        evidence: `${step.san} wins the ${proof.victim} on ${makeSquare(step.move.to)} by exploiting a pin. The ${step.after.board.get(ray.front)!.role} on ${makeSquare(ray.front)} cannot recapture on ${makeSquare(step.move.to)} because it would expose the king on ${makeSquare(ray.rear)} to the ${step.after.board.get(ray.pinner)!.role} on ${makeSquare(ray.pinner)}.${proof.compensation ? ` One alternative, ${proof.compensation.reply}, permits ${proof.compensation.answer}${proof.compensation.victim && proof.compensation.target !== undefined ? `, taking the ${proof.compensation.victim} on ${makeSquare(proof.compensation.target)}` : ""}.` : ""}`,
    } satisfies TacticalMotifEvidence;
}

function rayMaterialEvidence(
    step: TacticalReplayStep,
    source: TacticalMotifEvidence["source"],
    allowCheckingReplies = false,
) {
    if (
        step.capture >= 320 &&
        tacticalExchangeGain(step.before, step.move) >= 100 &&
        !provePinnedCapture(step)
    )
        return [];
    const motifs: TacticalMotifEvidence[] = [];
    for (const ray of relevantRayTactics(step)) {
        const proof = rayMaterialProof(step, ray);
        const reinforcement =
            proof.kind !== "proven" && ray.kind === "pin" ? proveReinforcedPin(step) : null;
        const extended =
            reinforcement?.ray.front === ray.front && reinforcement.ray.pinner === ray.pinner
                ? reinforcement
                : null;
        if (
            proof.kind !== "proven" &&
            !(allowCheckingReplies && proof.kind === "forcing") &&
            !extended
        )
            continue;
        const gain = extended?.gain ?? ("gain" in proof ? proof.gain : 0);
        const pinner = step.after.board.get(ray.pinner)!;
        const front = step.after.board.get(ray.front)!;
        const rear = step.after.board.get(ray.rear)!;
        if (ray.kind === "pin") {
            const existing = rayTactics(step.before, step.before.turn).some(
                (old) =>
                    old.kind === "pin" &&
                    old.pinner === ray.pinner &&
                    old.front === ray.front &&
                    old.rear === ray.rear,
            );
            const forkTargets = winningTargets(step.after, step.move.to, step.before.turn);
            // A smaller attack on a different, already pinned victim is not
            // another lesson when this move independently wins more by a fork.
            // Keep newly created pins, shared victims and pins protecting the
            // forker from the front piece's recapture.
            if (
                existing &&
                forkTargets.length >= 2 &&
                !forkTargets.includes(ray.front) &&
                !forkTargets.includes(ray.rear) &&
                !attacks(front, ray.front, step.after.board.occupied).has(step.move.to)
            ) {
                const forkGain = materialThreatGain(step, forkTargets, [step.move.to]);
                if (forkGain !== null && forkGain > gain) continue;
            }
        }
        motifs.push({
            id: ray.kind,
            label: ray.kind === "pin" ? "Pin" : "Skewer",
            source,
            confidence: extended || proof.kind === "proven" ? "high" : "medium",
            ply: 1,
            moveUci: step.uci,
            value: gain,
            evidence:
                ray.kind === "pin"
                    ? extended
                        ? `${step.san} adds an attack on the ${front.role} on ${makeSquare(ray.front)}, pinned to its king on ${makeSquare(ray.rear)} by the ${pinner.role} on ${makeSquare(ray.pinner)}. Every legal reply permits material recovery in the checked short exchanges, including checking counterattacks; one line is ${extended.line.join(" ")}.`
                        : `${step.san} exploits the ${front.role} on ${makeSquare(ray.front)}, pinned to the ${rear.role} on ${makeSquare(ray.rear)} by the ${pinner.role} on ${makeSquare(ray.pinner)}. ${proof.kind === "proven" ? "No legal reply avoids material loss in the immediate exchange." : "Every non-checking reply allows material loss. Checking replies remain, so the capture is a threat, not a guaranteed immediate win."}`
                    : `${step.san} skewers the ${front.role} on ${makeSquare(ray.front)} and the ${rear.role} on ${makeSquare(ray.rear)}. ${"checkingLine" in proof && proof.checkingLine ? `Blocking the check also allows a verified continuation: ${proof.checkingLine.join(" ")}. Every legal defence concedes material or mate; this is not a forced-mate claim.` : proof.kind === "proven" ? "No legal reply saves the rear target without conceding material." : "Every non-checking reply concedes material, but checking defences still need to be met."}`,
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
            "perpetualCheck",
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
    if (motif.id === "perpetualCheck") {
        const king = step.after.board.kingOf(opposite(step.before.turn))!;
        return {
            square: makeSquare(step.move.to),
            arrows: [...step.after.board[step.before.turn]]
                .filter((from) =>
                    attacks(step.after.board.get(from)!, from, step.after.board.occupied).has(king),
                )
                .map((from) => ({ from: makeSquare(from), to: makeSquare(king) })),
        };
    }
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
    if (motif.id === "forkPreparation") {
        const capture = proveCaptureForkPreparation(step);
        const checking = !capture && proveCheckingForkPreparation(step);
        if (capture || checking)
            return {
                square: makeSquare(step.move.to),
                arrows: step.after.isCheck()
                    ? [
                          {
                              from: makeSquare(step.move.to),
                              to: makeSquare(step.after.board.kingOf(opposite(step.before.turn))!),
                          },
                      ]
                    : (capture?.branches.flatMap((branch) =>
                          branch.quietForkGuard
                              ? [
                                    {
                                        from: makeSquare(branch.quietForkGuard.square),
                                        to: makeSquare(step.move.to),
                                    },
                                ]
                              : [],
                      ) ?? []),
            };
    }
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
        const reinforced = proveReinforcedPin(step);
        if (reinforced)
            return {
                square: makeSquare(reinforced.ray.front),
                arrows: [
                    {
                        from: makeSquare(reinforced.ray.pinner),
                        to: makeSquare(reinforced.ray.rear),
                    },
                    { from: makeSquare(step.move.to), to: makeSquare(reinforced.ray.front) },
                ],
            };
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
        const combined = proveCombinedDefenderRemoval(step);
        return {
            square: makeSquare(step.move.to),
            arrows: [
                { from: makeSquare(step.move.to), to: makeSquare(proof.target) },
                ...proof.capturers
                    .filter((from) => from !== step.move.to)
                    .map((from) => ({ from: makeSquare(from), to: makeSquare(proof.target) })),
                ...(combined
                    ? [{ from: makeSquare(combined.receiver), to: makeSquare(combined.target) }]
                    : []),
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
        if (!proof) {
            const forced = proveForcedSelfInterference(step)?.branches[0];
            if (!forced) return null;
            const evasion = parseUci(forced.replyUci) as NormalMove;
            return {
                square: makeSquare(step.move.to),
                arrows: [
                    { from: makeSquare(evasion.from), to: makeSquare(evasion.to) },
                    { from: makeSquare(forced.proof.defender), to: makeSquare(evasion.to) },
                    {
                        from: makeSquare(forced.proof.capturer),
                        to: makeSquare(forced.proof.target),
                    },
                ],
            };
        }
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
    if (motif.id === "selfInterference") {
        const proof = proveSelfInterference(step);
        return proof
            ? {
                  square: makeSquare(proof.blocker),
                  arrows: [
                      { from: makeSquare(proof.defender), to: makeSquare(proof.blocker) },
                      { from: makeSquare(proof.capturer), to: makeSquare(proof.target) },
                  ],
              }
            : null;
    }
    if (motif.id === "deflection") {
        const kingDeflection =
            motif.label === "Mating Deflection" && proveMatingKingDeflection(step);
        if (kingDeflection) {
            const reply = parseUci(kingDeflection.branches[0].replyUci) as NormalMove;
            return {
                square: makeSquare(step.move.to),
                arrows: [
                    { from: makeSquare(kingDeflection.king), to: makeSquare(reply.to) },
                    {
                        from: makeSquare(kingDeflection.capturer),
                        to: makeSquare(kingDeflection.target),
                    },
                ],
            };
        }
        const exchange = proveExchangeDeflection(step);
        if (exchange)
            return {
                square: makeSquare(step.move.to),
                arrows: [
                    { from: makeSquare(exchange.defender), to: makeSquare(step.move.to) },
                    { from: makeSquare(exchange.defender), to: makeSquare(exchange.target) },
                ],
            };
        const suffix = replayTacticalLine(fen, line).slice(motif.ply - 1);
        const mating = proveMatingDeflection(step);
        if (mating)
            return {
                square: makeSquare(step.move.to),
                // Show the actual offer and its possible acceptance, not a mating
                // move on a board where the opponent has not accepted the offer.
                arrows: mating.mating.map((branch) => ({
                    from: makeSquare(branch.defender),
                    to: makeSquare(step.move.to),
                })),
            };
        const capture = proveCaptureDeflection(step);
        if (capture)
            return {
                square: makeSquare(step.move.to),
                // These are possible acceptances, not already opened queen rays
                // or a pin which exists only after a particular recapture.
                arrows: capture.accepted
                    .filter((branch) => branch.mode === "ray")
                    .map((branch) => ({
                        from: makeSquare(branch.receiver),
                        to: makeSquare(step.move.to),
                    })),
            };
        if (!deflectionEvidence(suffix, motif.source)) return null;
        return {
            square: makeSquare(step.move.to),
            arrows: [
                { from: makeSquare(suffix[1].move.from), to: makeSquare(suffix[1].move.to) },
                { from: makeSquare(suffix[2].move.from), to: makeSquare(suffix[2].move.to) },
            ],
        };
    }
    if (motif.id === "attraction") {
        const proof = proveDiscoveryAttraction(step);
        if (proof)
            return {
                square: makeSquare(step.move.to),
                arrows: proof.accepted.map((branch) => ({
                    from: makeSquare(branch.receiver),
                    to: makeSquare(branch.target),
                })),
            };
        const checking = proveCaptureDiscoveryPreparation(step);
        if (checking)
            return {
                square: makeSquare(step.move.to),
                arrows: checking.branches.flatMap((branch) => {
                    const reply = parseSan(step.after, branch.reply);
                    return reply && "from" in reply
                        ? [{ from: makeSquare(reply.from), to: makeSquare(step.move.to) }]
                        : [];
                }),
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
        const conditionalPin = !immediateFork(step)
            ? proveDiscoveryBackedFork(step)?.branches[0].pin
            : undefined;
        const support =
            conditionalPin &&
            rayTactics(step.before, step.before.turn).some(
                (ray) =>
                    ray.kind === "pin" &&
                    ray.pinner === conditionalPin.pinner &&
                    ray.front === conditionalPin.front &&
                    ray.rear === conditionalPin.rear,
            )
                ? conditionalPin
                : undefined;
        return {
            square: makeSquare(step.move.to),
            arrows: [
                ...winningTargets(step.after, step.move.to, step.before.turn).map((to) => ({
                    from: makeSquare(step.move.to),
                    to: makeSquare(to),
                })),
                ...(pin ? [{ from: makeSquare(pin.pinner), to: makeSquare(pin.rear) }] : []),
                ...(!pin && support
                    ? [{ from: makeSquare(support.pinner), to: makeSquare(support.rear) }]
                    : []),
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

type CombinedRemovalProof = {
    gain: number;
    target: Square;
    receiver: Square;
    capturer: Square;
    acceptance: string[];
    declined: { reply: string; answer: string; gain: number }[];
};
const combinedRemovalCache = new Map<string, CombinedRemovalProof | null>();

/** Capture one real guard and offer the capturing piece to a second guard of
 * the same target. Neither single-guard exchange probe need improve: the
 * accepted combination removes both. Declines must retain earned material or
 * win a connected target, never borrow arbitrary future PV captures. */
export function proveCombinedDefenderRemoval(
    root: TacticalReplayStep,
    nodeLimit = 8192,
    onFailure?: (reason: string) => void,
): CombinedRemovalProof | null {
    if (
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0 ||
        !root.capture ||
        root.move.promotion ||
        root.after.isEnd() ||
        root.before.isCheck()
    )
        return null;
    const key = `${makeFen(root.before.toSetup())}:${root.uci}`;
    if (!onFailure && nodeLimit === 8192 && combinedRemovalCache.has(key))
        return combinedRemovalCache.get(key)!;
    const side = root.before.turn,
        removed = root.before.board.get(root.move.to);
    if (!removed || removed.color === side || removed.role === "king") return null;
    const directGain = tacticalExchangeGain(root.before, root.move);
    if (directGain <= -VALUE.king) return null;
    const budget = { nodes: nodeLimit };
    const visit = (pos: Chess, move: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Combined removal budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const settled = (pos: Chess, move: NormalMove) => {
        if (move.promotion) return null;
        const leaf = visit(pos, move);
        if (leaf.isEnd()) return null;
        for (const resource of legalMoves(leaf)) {
            const next = visit(leaf, resource);
            if (resource.promotion || next.isCheckmate()) return null;
            // A checking capture cannot be settled by material-only SEE.
            // Require a direct safe capture of the checker which recovers
            // its cost; blocking sequences and unresolved rechecks abstain.
            if (capturedValue(leaf, resource) > 0 && next.isCheck()) {
                let answered = false;
                for (const response of legalMoves(next)) {
                    if (response.to !== resource.to || response.promotion) continue;
                    const recovered = visit(next, response);
                    if (recovered.isEnd()) continue;
                    const unsafe = legalMoves(recovered).some((m) => {
                        const after = visit(recovered, m);
                        return (
                            m.promotion ||
                            after.isCheckmate() ||
                            (capturedValue(recovered, m) > 0 && after.isCheck())
                        );
                    });
                    if (unsafe) continue;
                    const gain = participantCaptureGain(
                        next,
                        response,
                        [...next.board[side], response.to],
                        budget,
                    );
                    if (gain !== null && gain >= capturedValue(leaf, resource)) {
                        answered = true;
                        break;
                    }
                }
                if (!answered) return null;
            }
        }
        return participantCaptureGain(pos, move, [...pos.board[side], move.to], budget);
    };
    let proof: CombinedRemovalProof | null = null;
    try {
        const candidates: {
            target: Square;
            receiver: Square;
            capturer: Square;
            acceptance: string[];
        }[] = [];
        for (const target of attacks(removed, root.move.to, root.before.board.occupied)) {
            const victim = root.before.board.get(target);
            if (
                !victim ||
                victim.color === side ||
                !["knight", "bishop", "rook", "queen"].includes(victim.role)
            )
                continue;
            for (const capture of legalMoves(root.before).filter(
                (m) => m.to === target && m.from !== root.move.from && !m.promotion,
            )) {
                const premature = visit(root.before, capture);
                const oldGain = tacticalExchangeGain(root.before, capture);
                if (
                    !premature.isLegal({ from: root.move.to, to: target }) ||
                    oldGain <= -VALUE.king ||
                    oldGain >= 100
                )
                    continue;
                const singlyRemoved = withTurn(root.after, side);
                if (!singlyRemoved.isLegal(capture)) continue;
                const singleGain = tacticalExchangeGain(singlyRemoved, capture);
                if (singleGain <= -VALUE.king || singleGain >= 100) continue;
                const stillGuarded = visit(singlyRemoved, capture);
                for (const reply of legalMoves(root.after)) {
                    if (
                        reply.to !== root.move.to ||
                        reply.promotion ||
                        !capturedValue(root.after, reply)
                    )
                        continue;
                    const receiver = root.after.board.get(reply.from)!;
                    if (
                        receiver.role === "king" ||
                        !attacks(receiver, reply.from, root.after.board.occupied).has(target) ||
                        !stillGuarded.isLegal({ from: reply.from, to: target })
                    )
                        continue;
                    const accepted = visit(root.after, reply);
                    if (
                        attacks(receiver, reply.to, accepted.board.occupied).has(target) ||
                        !accepted.isLegal(capture)
                    )
                        continue;
                    const gain = settled(accepted, capture);
                    if (
                        gain === null ||
                        root.capture - capturedValue(root.after, reply) + gain < 100
                    )
                        continue;
                    candidates.push({
                        target,
                        receiver: reply.from,
                        capturer: capture.from,
                        acceptance: [makeSan(root.after, reply), makeSan(accepted, capture)],
                    });
                }
            }
        }
        for (const candidate of candidates) {
            let minimum = Infinity,
                complete = true;
            const declined: CombinedRemovalProof["declined"] = [];
            for (const reply of legalMoves(root.after)) {
                if (reply.promotion) {
                    complete = false;
                    break;
                }
                const next = visit(root.after, reply);
                if (next.isEnd()) {
                    complete = false;
                    break;
                }
                const balance = root.capture - capturedValue(root.after, reply);
                const target = reply.from === candidate.target ? reply.to : candidate.target;
                const receiver = reply.from === candidate.receiver ? reply.to : candidate.receiver;
                let best = -Infinity,
                    answer = "";
                for (const move of legalMoves(next)) {
                    const takes = capturedValue(next, move);
                    const connected =
                        takes &&
                        ((move.to === target &&
                            [candidate.capturer, root.move.to].includes(move.from)) ||
                            move.to === receiver ||
                            (capturedValue(root.after, reply) > 0 && move.to === reply.to));
                    // A real quiet move can preserve the piece already won;
                    // its liability check includes every friendly piece.
                    if (!connected && (takes || balance < 100 || move.from !== root.move.to))
                        continue;
                    const gain = settled(next, move);
                    if (gain !== null && balance + gain > best) {
                        best = balance + gain;
                        answer = makeSan(next, move);
                    }
                    if (best >= 100) break;
                }
                if (best < 100) {
                    onFailure?.(`Unproved reply ${makeSan(root.after, reply)}`);
                    complete = false;
                    break;
                }
                minimum = Math.min(minimum, best);
                if (reply.from !== candidate.receiver || reply.to !== root.move.to)
                    declined.push({ reply: makeSan(root.after, reply), answer, gain: best });
            }
            if (complete && declined.length && Number.isFinite(minimum) && directGain < minimum) {
                proof = { ...candidate, gain: minimum, declined };
                break;
            }
        }
    } catch (error) {
        onFailure?.(error instanceof Error ? error.message : String(error));
    }
    if (!onFailure && nodeLimit === 8192) {
        combinedRemovalCache.set(key, proof);
        if (combinedRemovalCache.size > 128)
            combinedRemovalCache.delete(combinedRemovalCache.keys().next().value!);
    }
    return proof;
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
    const combined = proveCombinedDefenderRemoval(step);
    if (combined) {
        const victim = step.before.board.get(combined.target)!;
        const receiver = step.before.board.get(combined.receiver)!;
        const declined = combined.declined.reduce((a, b) => (a.gain <= b.gain ? a : b));
        return {
            target: combined.target,
            targets: [combined.target, combined.receiver],
            capturers: [combined.capturer],
            gain: combined.gain,
            extended: true,
            motif: {
                id: "capturingDefender",
                label: "Removing the Defenders",
                source,
                confidence: "high",
                ply: 1,
                moveUci: step.uci,
                value: combined.gain,
                evidence: `${step.san} removes the ${defender.role} on ${makeSquare(step.move.to)} and offers the ${step.before.board.get(step.move.from)!.role} to draw the ${receiver.role} off ${makeSquare(combined.receiver)}. Both guarded the ${victim.role} on ${makeSquare(combined.target)}. After ${combined.acceptance.join(" ")}, neither still guards that target and it is won. Declining with ${declined.reply} can be met by ${declined.answer}, retaining material instead. Every legal reply is checked, including captures of other pieces; accepting the offer is not a free gain for the defender.`,
            },
        };
    }
    return null;
}

const defenderCombinationCache = new Map<string, number | null>();
type ProofBudget = { nodes: number };
type MatingLiability = { replyUci: string; mate: string[] };
type MaterialRecoveryLeaf = {
    fen: string;
    moveUci: string;
    balance: number;
    gain: number;
    quiet: boolean;
    matingReplies?: MatingLiability[];
};

/** Stable board order from the defending side's home rank. Reflection must
 * not change which branch uses the finite recovery budget first. */
function recoveryMoves(pos: Chess, side: Color) {
    const flip = side === "white" ? 56 : 0;
    return legalMoves(pos).sort(
        (a, b) => (a.from ^ flip) - (b.from ^ flip) || (a.to ^ flip) - (b.to ^ flip),
    );
}

/** Cheap, conservative check nomination for an already-legal move. Castling
 * is always nominated; en-passant removes the off-square captured pawn too.
 * The caller still replays nominated moves before accepting a mate. */
export function mayGiveCheck(pos: Chess, move: NormalMove): boolean {
    const side = pos.turn;
    const piece = pos.board.get(move.from)!;
    const king = pos.board.kingOf(opposite(side));
    if (king === undefined || move.promotion) return true;
    if (piece.role === "king" && pos.board.get(move.to)?.color === side) return true;
    let occupied = pos.board.occupied.without(move.from).with(move.to);
    if (piece.role === "pawn" && move.to === pos.epSquare)
        occupied = occupied.without(move.to + (side === "white" ? -8 : 8));
    if (attacks(piece, move.to, occupied).has(king)) return true;
    for (const from of pos.board[side]) {
        if (from === move.from) continue;
        const other = pos.board.get(from)!;
        if (
            ["bishop", "rook", "queen"].includes(other.role) &&
            attacks(other, from, occupied).has(king)
        )
            return true;
    }
    return false;
}

/** Material arithmetic cannot settle a branch which stalemates or allows
 * an immediate mate/promotion. Longer quiet play is outside this local proof. */
function noImmediateTerminalRefutation(pos: Chess, move: NormalMove, budget: ProofBudget) {
    if (--budget.nodes < 0) throw new Error("Material leaf proof exhausted");
    const leaf = pos.clone();
    leaf.play(move);
    if (leaf.isEnd()) return leaf.isCheckmate();
    for (const reply of recoveryMoves(leaf, pos.turn)) {
        if (reply.promotion) return false;
        if (!mayGiveCheck(leaf, reply)) continue;
        if (--budget.nodes < 0) throw new Error("Material leaf proof exhausted");
        const next = leaf.clone();
        next.play(reply);
        if (next.isCheckmate()) return false;
    }
    return true;
}

/** An off-square countercapture is not a material defence when accepting
 * it is independently mated in at most two checks. The same-square exchange
 * bound still applies, and every such mating proof consumes the shared budget. */
function discoveryCaptureGain(
    pos: Chess,
    move: NormalMove,
    required: number,
    budget: ProofBudget,
    onMate?: (reply: MatingLiability) => void,
): number | null {
    const side = pos.turn;
    const pieces = [...pos.board[side], move.to];
    const direct = participantCaptureGain(pos, move, pieces, budget);
    if (direct === null) return null;
    if (direct >= required) return noImmediateTerminalRefutation(pos, move, budget) ? direct : null;
    const exchange = tacticalExchangeGain(pos, move);
    if (exchange < required) return null;
    const next = pos.clone();
    next.play(move);
    if (next.isEnd() || !noImmediateTerminalRefutation(pos, move, budget)) return null;
    const capture =
        capturedValue(pos, move) + (move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0);
    let liability = 0;
    for (const reply of recoveryMoves(next, side)) {
        if (reply.to === move.to || !pieces.includes(reply.to) || !capturedValue(next, reply))
            continue;
        if (--budget.nodes < 0) throw new Error("Discovery liability proof exhausted");
        const loss = tacticalExchangeGain(next, reply);
        if (loss <= -VALUE.king) return null;
        if (capture - Math.max(capture - exchange, loss) < required) {
            const after = next.clone();
            after.play(reply);
            const replyStep: TacticalReplayStep = {
                before: next,
                after,
                move: reply,
                uci: makeUci(reply),
                san: makeSan(next, reply),
                capture: capturedValue(next, reply),
                balance: 0,
            };
            const mate = proveMatingCaptureReply(replyStep, 4096, budget);
            if (budget.nodes < 0) throw new Error("Discovery mating liability budget exhausted");
            if (mate) {
                onMate?.({ replyUci: makeUci(reply), mate });
                continue;
            }
        }
        liability = Math.max(liability, loss);
    }
    return capture - Math.max(capture - exchange, liability);
}

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
    allPiecesAtLeaf = false,
    minimumGain = 90,
    onLeaf?: (leaf: MaterialRecoveryLeaf) => void,
): number | null {
    if (
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0 ||
        !Number.isSafeInteger(minimumGain) ||
        minimumGain <= 0 ||
        !Number.isSafeInteger(evasionLimit) ||
        evasionLimit < 0
    )
        return null;
    const key = `${makeFen(step.before.toSetup())}:${step.uci}:${targets}:${capturers}:${evasionLimit}:${allPiecesAtLeaf}:${minimumGain}`;
    if (!onLeaf && !sharedBudget && nodeLimit === 4096 && defenderCombinationCache.has(key))
        return defenderCombinationCache.get(key)!;
    const side = step.before.turn;
    const budget = sharedBudget ?? { nodes: nodeLimit };
    const delta = (pos: Chess, move: NormalMove) =>
        capturedValue(pos, move) + (move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0);
    const visit = (pos: Chess, move: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Defender combination proof exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const moves = (pos: Chess) => (allPiecesAtLeaf ? recoveryMoves(pos, side) : legalMoves(pos));
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
        for (const move of moves(pos)) {
            if (
                !victims.includes(move.to) ||
                !pieces.includes(move.from) ||
                !capturedValue(pos, move)
            )
                continue;
            const gain = participantCaptureGain(
                pos,
                move,
                allPiecesAtLeaf ? [...pos.board[side], move.to] : pieces,
                budget,
            );
            if (
                gain !== null &&
                (!allPiecesAtLeaf ||
                    balance + gain < minimumGain ||
                    noImmediateTerminalRefutation(pos, move, budget))
            ) {
                best = Math.max(best, balance + gain);
                if (allPiecesAtLeaf && best >= minimumGain) {
                    onLeaf?.({
                        fen: makeFen(pos.toSetup()),
                        moveUci: makeUci(move),
                        balance,
                        gain: best,
                        quiet: false,
                    });
                    return best;
                }
            }
        }
        // Bishop/knight exchange imbalance must not erase a genuine pawn gain.
        if (best >= minimumGain) return best;
        // A checking sacrifice may already have donated a target. After the
        // next defence saves the other target, prove an actual safe move that
        // retains that earned gain instead of demanding another capture.
        if (retained && balance >= minimumGain && !pos.isCheck()) {
            for (const move of moves(pos)) {
                if (capturedValue(pos, move) || move.promotion) continue;
                const gain = participantCaptureGain(
                    pos,
                    move,
                    allPiecesAtLeaf ? [...pos.board[side], move.to] : pieces,
                    budget,
                );
                if (
                    gain !== null &&
                    balance + gain >= minimumGain &&
                    (!allPiecesAtLeaf || noImmediateTerminalRefutation(pos, move, budget))
                ) {
                    onLeaf?.({
                        fen: makeFen(pos.toSetup()),
                        moveUci: makeUci(move),
                        balance,
                        gain: balance + gain,
                        quiet: true,
                    });
                    return balance + gain;
                }
            }
        }
        if (!evasion || !pos.isCheck()) return null;
        const evasions = moves(pos);
        if (allPiecesAtLeaf)
            evasions.sort(
                (a, b) =>
                    delta(pos, b) - delta(pos, a) ||
                    VALUE[pos.board.get(a.from)!.role] - VALUE[pos.board.get(b.from)!.role],
            );
        for (const move of evasions) {
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
        const replies = moves(pos);
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
            allPiecesAtLeaf && step.capture > 0,
        );
    } catch {
        /* A bounded incomplete search is not a tactical proof. */
    }
    if (!onLeaf && !sharedBudget && nodeLimit === 4096) {
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
            evidence: `${step.san} takes the ${victim.role} with check before ${makeSan(step.before, deferred)}.${revealedRays(
                step,
            )
                .filter((ray) => step.after.board.get(ray.target)?.role === "king")
                .map(
                    (ray) =>
                        ` Moving off ${makeSquare(step.move.from)} uncovers check from the ${step.after.board.get(ray.from)!.role} on ${makeSquare(ray.from)}.`,
                )
                .join(
                    "",
                )} Every legal answer to the check preserves extra material through the deferred capture or the piece taking the checker. Playing ${makeSan(step.before, deferred)} first allows ${makeSan(reversed, escape)}, preventing an immediate profitable capture of that ${victim.role}. The move order matters, not just the two captures.`,
        };
    }
    return best;
}

type CaptureDeflectionProof = {
    gain: number;
    accepted: {
        reply: string;
        answer: string;
        gain: number;
        mode: "ray" | "pin" | "capture";
        receiver: Square;
        from: Square;
        target: Square;
        pinner?: Square;
    }[];
    declined: { reply: string; answer: string; gain: number }[];
};

type DiscoveryAttractionProof = {
    gain: number;
    accepted: {
        reply: string;
        preparation: string;
        receiver: Square;
        slider: Square;
        blocker: Square;
        target: Square;
        priorDefence: string;
        gain: number;
        line: string[];
    }[];
    declined: { reply: string; answer: string; gain: number }[];
};
const discoveryAttractionCache = new Map<string, DiscoveryAttractionProof | null>();

/** An exchange replaces a mobile victim with a receiver vulnerable to a
 * quiet discovery. Prove every root defence and every reply to that discovery.
 * Earlier, the original victim must have a concrete capture of the preparing
 * piece which defeats the immediate material threats. No PV is a defence list. */
export function proveDiscoveryAttraction(
    root: TacticalReplayStep,
    nodeLimit = 16384,
    onFailure?: (reason: string) => void,
): DiscoveryAttractionProof | null {
    if (
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0 ||
        !root.capture ||
        root.move.promotion ||
        root.after.isCheck() ||
        root.after.isEnd() ||
        !root.before.board.get(root.move.to) ||
        tacticalExchangeGain(root.before, root.move) >= 90
    )
        return null;
    const key = `${makeFen(root.before.toSetup())}:${root.uci}`;
    if (!onFailure && nodeLimit === 16384 && discoveryAttractionCache.has(key))
        return discoveryAttractionCache.get(key)!;
    const side = root.before.turn,
        budget = { nodes: nodeLimit };
    const moves = (pos: Chess) =>
        legalMoves(pos).sort((a, b) => {
            const flip = pos.turn === "white" ? 0 : 56;
            return (
                VALUE[pos.board.get(a.from)!.role] - VALUE[pos.board.get(b.from)!.role] ||
                (a.from ^ flip) - (b.from ^ flip) ||
                (a.to ^ flip) - (b.to ^ flip)
            );
        });
    const visit = (pos: Chess, move: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Discovery attraction budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const settled = (pos: Chess, move: NormalMove) => {
        if (move.promotion) return null;
        const next = visit(pos, move);
        if (next.isEnd()) return null;
        for (const resource of moves(next))
            if (resource.promotion || visit(next, resource).isCheckmate()) return null;
        return participantCaptureGain(pos, move, [...pos.board[side], move.to], budget);
    };
    const discoveryWin = (step: TacticalReplayStep, balance: number) => {
        const rays = revealedRays(step);
        const capturers = [...new Set([step.move.to, ...rays.map((ray) => ray.from)])];
        const targets = [
            ...new Set([
                ...rays.map((ray) => ray.target),
                ...attacks(
                    step.after.board.get(step.move.to)!,
                    step.move.to,
                    step.after.board.occupied,
                ).intersect(step.after.board[opposite(side)]),
            ]),
        ];
        let minimum = Infinity;
        let line: string[] = [];
        for (const reply of moves(step.after)) {
            if (reply.promotion) return null;
            const next = visit(step.after, reply);
            if (next.isEnd()) return null;
            const mapped = targets.map((sq) => (sq === reply.from ? reply.to : sq));
            const takesAttacker =
                capturers.includes(reply.to) && capturedValue(step.after, reply) > 0;
            if (takesAttacker) mapped.push(reply.to);
            let best = -Infinity;
            let answer = "";
            for (const move of moves(next)) {
                if (
                    !capturedValue(next, move) ||
                    !mapped.includes(move.to) ||
                    (!capturers.includes(move.from) && !(takesAttacker && move.to === reply.to))
                )
                    continue;
                const gain = settled(next, move);
                const recovered =
                    gain === null ? -Infinity : balance - capturedValue(step.after, reply) + gain;
                if (recovered > best) {
                    best = recovered;
                    answer = makeSan(next, move);
                }
            }
            if (best < 90) return null;
            if (best < minimum) {
                minimum = best;
                line = [makeSan(step.after, reply), answer];
            }
        }
        return Number.isFinite(minimum) ? { gain: minimum, line } : null;
    };
    const priorDefence = (preparation: NormalMove) => {
        if (!root.before.isLegal(preparation)) return null;
        const offered = visit(root.before, preparation);
        if (offered.isCheck() || offered.isEnd()) return null;
        const capture = { from: root.move.to, to: preparation.to };
        if (!offered.isLegal(capture) || !capturedValue(offered, capture)) return null;
        const defended = visit(offered, capture);
        if (defended.isEnd() || defended.isCheck()) return null;
        // This is a positive local defence, not a claim about all later quiet play.
        for (const move of moves(defended)) {
            if (move.promotion || visit(defended, move).isCheckmate()) return null;
            if (!capturedValue(defended, move)) continue;
            const gain = tacticalExchangeGain(defended, move);
            if (gain <= -VALUE.king || gain - capturedValue(offered, capture) >= 90) return null;
        }
        return makeSan(offered, capture);
    };
    let proof: DiscoveryAttractionProof | null = null;
    try {
        const replies = moves(root.after),
            receivers = replies.filter(
                (move) => move.to === root.move.to && capturedValue(root.after, move),
            );
        if (!receivers.length) throw new Error("No receiving piece");
        const accepted: DiscoveryAttractionProof["accepted"] = [],
            declined: DiscoveryAttractionProof["declined"] = [];
        let minimum = root.capture;
        for (const reply of receivers) {
            if (reply.promotion || root.after.board.get(reply.from)?.role === "king")
                throw new Error("Unsupported receiver");
            const pos = visit(root.after, reply);
            if (pos.isEnd()) throw new Error("Terminal acceptance");
            const balance = root.capture - capturedValue(root.after, reply);
            let branch: DiscoveryAttractionProof["accepted"][number] | null = null;
            for (const move of moves(pos)) {
                if (capturedValue(pos, move) || move.promotion) continue;
                const after = visit(pos, move);
                if (after.isCheck() || after.isEnd()) continue;
                const step = replayTacticalLine(makeFen(pos.toSetup()), [makeUci(move)])[0];
                const ray = step && revealedRays(step).find((ray) => ray.target === reply.to);
                if (!ray) continue;
                const defence = priorDefence(move);
                if (!defence) continue;
                const win = discoveryWin(step, balance);
                if (win === null) continue;
                branch = {
                    reply: makeSan(root.after, reply),
                    preparation: step.san,
                    receiver: reply.from,
                    slider: ray.from,
                    blocker: move.from,
                    target: ray.target,
                    priorDefence: defence,
                    ...win,
                };
                break;
            }
            if (!branch) throw new Error(`Unproved acceptance: ${makeSan(root.after, reply)}`);
            accepted.push(branch);
            minimum = Math.min(minimum, branch.gain);
        }
        for (const reply of replies) {
            if (receivers.includes(reply)) continue;
            if (reply.promotion) throw new Error("Promoting decline");
            const next = visit(root.after, reply);
            if (next.isEnd()) throw new Error("Terminal decline");
            let gain: number | null = null;
            let answer = "";
            for (const move of moves(next)) {
                if (
                    move.from !== root.move.to &&
                    !(move.to === reply.to && capturedValue(next, move)) &&
                    !(
                        next.isCheck() &&
                        next.ctx().checkers.has(move.to) &&
                        capturedValue(next, move)
                    )
                )
                    continue;
                const settledGain = settled(next, move);
                if (settledGain === null) continue;
                const retained = root.capture - capturedValue(root.after, reply) + settledGain;
                if (retained >= 90) {
                    gain = retained;
                    answer = makeSan(next, move);
                    break;
                }
            }
            if (gain === null) throw new Error(`Unproved decline: ${makeSan(root.after, reply)}`);
            minimum = Math.min(minimum, gain);
            declined.push({ reply: makeSan(root.after, reply), answer, gain });
        }
        proof = { gain: minimum, accepted, declined };
    } catch (error) {
        onFailure?.(error instanceof Error ? error.message : "Unproved discovery attraction");
    }
    if (!onFailure && nodeLimit === 16384) {
        discoveryAttractionCache.set(key, proof);
        if (discoveryAttractionCache.size > 128)
            discoveryAttractionCache.delete(discoveryAttractionCache.keys().next().value!);
    }
    return proof;
}
const captureDeflectionCache = new Map<string, CaptureDeflectionProof | null>();

type PinPressureWin = { gain: number; line: string[] };

/** Enumerate defences to a quiet attack on a pinned victim, retaining actual
 * replies as witnesses. One checking counterattack may be answered. Leaves
 * include same-square exchanges, all off-square captures and immediate mate. */
function pinPressureAfterMove(
    position: Chess,
    target: Square,
    pieces: Square[],
    balance: number,
    budget: ProofBudget,
): PinPressureWin | null {
    const side = opposite(position.turn);
    // Prefer the cheaper capturing participant, then colour-relative squares.
    // Early successful witnesses must not depend on absolute board orientation.
    const moves = (pos: Chess) =>
        legalMoves(pos).sort((a, b) => {
            const flip = pos.turn === "white" ? 0 : 56;
            return (
                VALUE[pos.board.get(a.from)!.role] - VALUE[pos.board.get(b.from)!.role] ||
                (a.from ^ flip) - (b.from ^ flip) ||
                (a.to ^ flip) - (b.to ^ flip)
            );
        });
    const visit = (pos: Chess, move: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Pin pressure budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const settled = (pos: Chess, move: NormalMove) => {
        if (move.promotion) return null;
        const next = visit(pos, move);
        if (next.isEnd()) return null;
        for (const resource of moves(next))
            if (resource.promotion || visit(next, resource).isCheckmate()) return null;
        return participantCaptureGain(pos, move, [...pos.board[side], move.to], budget);
    };
    const attack = (
        pos: Chess,
        square: Square,
        participants: Square[],
        accumulated: number,
        evasion: number,
    ): PinPressureWin | null => {
        if (pos.isEnd()) return null;
        for (const move of moves(pos)) {
            if (
                move.to !== square ||
                !participants.includes(move.from) ||
                !capturedValue(pos, move)
            )
                continue;
            const gain = settled(pos, move);
            if (gain !== null && accumulated + gain >= 90)
                return { gain: accumulated + gain, line: [makeSan(pos, move)] };
        }
        if (!evasion || !pos.isCheck()) return null;
        for (const move of moves(pos)) {
            if (move.promotion) continue;
            if (pos.ctx().checkers.has(move.to) && capturedValue(pos, move)) {
                const gain = settled(pos, move);
                if (gain !== null && accumulated + gain >= 90)
                    return { gain: accumulated + gain, line: [makeSan(pos, move)] };
            }
            const next = visit(pos, move);
            const win = defend(
                next,
                square,
                participants.map((sq) => (sq === move.from ? move.to : sq)),
                accumulated + capturedValue(pos, move),
                evasion - 1,
            );
            if (win) return { gain: win.gain, line: [makeSan(pos, move), ...win.line] };
        }
        return null;
    };
    const defend = (
        pos: Chess,
        square: Square,
        participants: Square[],
        accumulated: number,
        evasion: number,
    ): PinPressureWin | null => {
        if (pos.isEnd()) return null;
        let minimum: PinPressureWin | null = null;
        for (const reply of moves(pos)) {
            if (reply.promotion) return null;
            const next = visit(pos, reply);
            const win = attack(
                next,
                reply.from === square ? reply.to : square,
                participants.filter((sq) => sq !== reply.to),
                accumulated - capturedValue(pos, reply),
                evasion,
            );
            if (!win) return null;
            if (!minimum || win.gain < minimum.gain)
                minimum = { gain: win.gain, line: [makeSan(pos, reply), ...win.line] };
        }
        return minimum;
    };
    return defend(position, target, pieces, balance, 1);
}

type ReinforcedPinProof = PinPressureWin & { ray: RayTactic };
const reinforcedPinCache = new Map<string, ReinforcedPinProof | null>();

/** A new attacker exploiting an existing absolute pin. Quiet positional
 * pressure is insufficient: all replies must concede material in the bounded
 * search. The root pinner must remain in place and the mover must add attack. */
export function proveReinforcedPin(
    root: TacticalReplayStep,
    nodeLimit = 8192,
): ReinforcedPinProof | null {
    if (
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0 ||
        root.capture ||
        root.move.promotion ||
        root.before.isCheck() ||
        root.after.isCheck() ||
        root.after.isEnd()
    )
        return null;
    const key = `${makeFen(root.before.toSetup())}:${root.uci}`;
    if (nodeLimit === 8192 && reinforcedPinCache.has(key)) return reinforcedPinCache.get(key)!;
    const mover = root.after.board.get(root.move.to)!;
    const before = rayTactics(root.before, root.before.turn);
    const candidates = rayTactics(root.after, root.before.turn).filter(
        (ray) =>
            ray.kind === "pin" &&
            ray.pinner !== root.move.to &&
            root.after.board.get(ray.rear)?.role === "king" &&
            root.after.ctx().blockers.has(ray.front) &&
            before.some(
                (old) =>
                    old.kind === "pin" &&
                    old.pinner === ray.pinner &&
                    old.front === ray.front &&
                    old.rear === ray.rear,
            ) &&
            attacks(mover, root.move.to, root.after.board.occupied).has(ray.front) &&
            !attacks(mover, root.move.from, root.before.board.occupied).has(ray.front),
    );
    let proof: ReinforcedPinProof | null = null;
    const budget = { nodes: nodeLimit };
    try {
        for (const ray of candidates) {
            const win = pinPressureAfterMove(
                root.after,
                ray.front,
                [ray.pinner, root.move.to],
                0,
                budget,
            );
            if (win) {
                proof = { ...win, ray };
                break;
            }
        }
    } catch {
        /* Exhausted or unresolved exchanges cannot certify a pin. */
    }
    if (nodeLimit === 8192) {
        reinforcedPinCache.set(key, proof);
        if (reinforcedPinCache.size > 128)
            reinforcedPinCache.delete(reinforcedPinCache.keys().next().value!);
    }
    return proof;
}

/** Different receivers need not lose by the same mechanism. A receiver can
 * vacate a blocking square or enter an absolute pin; a quiet reinforcement
 * of that pin is checked against every reply. Other branches must retain the
 * captured material through the offered piece or an answer to check. */
export function proveCaptureDeflection(
    root: TacticalReplayStep,
    nodeLimit = 16384,
    onFailure?: (reason: string) => void,
): CaptureDeflectionProof | null {
    if (
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0 ||
        !root.capture ||
        root.move.promotion ||
        root.after.isCheck() ||
        root.after.isEnd() ||
        !root.before.board.get(root.move.to) ||
        tacticalExchangeGain(root.before, root.move) >= 90
    )
        return null;
    const side = root.before.turn,
        enemy = opposite(side);
    const replies = legalMoves(root.after);
    const receivers = replies.filter(
        (move) => move.to === root.move.to && capturedValue(root.after, move),
    );
    if (
        !receivers.length ||
        receivers.some((move) => move.promotion || root.after.board.get(move.from)?.role === "king")
    )
        return null;
    const key = `${makeFen(root.before.toSetup())}:${root.uci}`;
    if (!onFailure && nodeLimit === 16384 && captureDeflectionCache.has(key))
        return captureDeflectionCache.get(key)!;
    const budget = { nodes: nodeLimit };
    const visit = (pos: Chess, move: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Capture deflection budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const settled = (pos: Chess, move: NormalMove) => {
        if (move.promotion) return null;
        const next = visit(pos, move);
        if (next.isEnd()) return null;
        for (const resource of legalMoves(next))
            if (resource.promotion || visit(next, resource).isCheckmate()) return null;
        return participantCaptureGain(pos, move, [...pos.board[side], move.to], budget);
    };
    let proof: CaptureDeflectionProof | null = null;
    try {
        const accepted: CaptureDeflectionProof["accepted"] = [],
            declined: CaptureDeflectionProof["declined"] = [];
        let minimum = root.capture;
        // Verify the causal acceptance mechanisms before spending work on flights.
        for (const reply of receivers) {
            const next = visit(root.after, reply);
            if (next.isEnd()) throw new Error("Terminal acceptance");
            const balance = root.capture - capturedValue(root.after, reply);
            let branch: CaptureDeflectionProof["accepted"][number] | undefined;
            for (const move of legalMoves(next)) {
                const piece = next.board.get(move.from)!;
                if (
                    !capturedValue(next, move) ||
                    !["bishop", "rook", "queen"].includes(piece.role) ||
                    !between(move.from, move.to).has(reply.from)
                )
                    continue;
                const gain = settled(next, move);
                if (gain !== null && balance + gain >= 90) {
                    branch = {
                        reply: makeSan(root.after, reply),
                        answer: makeSan(next, move),
                        gain: balance + gain,
                        mode: "ray",
                        receiver: reply.from,
                        from: move.from,
                        target: move.to,
                    };
                    break;
                }
            }
            if (!branch)
                for (const move of legalMoves(next)) {
                    if (move.to !== reply.to || !capturedValue(next, move)) continue;
                    const gain = settled(next, move);
                    if (gain !== null && balance + gain >= 90) {
                        branch = {
                            reply: makeSan(root.after, reply),
                            answer: makeSan(next, move),
                            gain: balance + gain,
                            mode: "capture",
                            receiver: reply.from,
                            from: move.from,
                            target: move.to,
                        };
                        break;
                    }
                }
            if (!branch) {
                const ray = rayTactics(next, side).find(
                    (ray) =>
                        ray.kind === "pin" &&
                        ray.front === reply.to &&
                        next.board.get(ray.rear)?.role === "king" &&
                        withTurn(next, enemy).ctx().blockers.has(ray.front),
                );
                if (ray)
                    for (const move of legalMoves(next)) {
                        if (capturedValue(next, move) || move.promotion) continue;
                        const piece = next.board.get(move.from)!;
                        if (attacks(piece, move.from, next.board.occupied).has(reply.to)) continue;
                        const after = visit(next, move);
                        if (
                            after.isCheck() ||
                            !attacks(piece, move.to, after.board.occupied).has(reply.to)
                        )
                            continue;
                        const gain =
                            pinPressureAfterMove(
                                after,
                                reply.to,
                                [ray.pinner, move.to],
                                balance,
                                budget,
                            )?.gain ?? null;
                        if (gain !== null && gain >= 90) {
                            branch = {
                                reply: makeSan(root.after, reply),
                                answer: makeSan(next, move),
                                gain,
                                mode: "pin",
                                receiver: reply.from,
                                from: move.from,
                                target: reply.to,
                                pinner: ray.pinner,
                            };
                            break;
                        }
                    }
            }
            if (!branch) throw new Error(`Unproved acceptance: ${makeSan(root.after, reply)}`);
            minimum = Math.min(minimum, branch.gain);
            accepted.push(branch);
        }
        if (!accepted.some((branch) => branch.mode === "ray"))
            throw new Error("No blocking defender deflected");
        for (const reply of replies) {
            if (receivers.includes(reply)) continue;
            if (reply.promotion) throw new Error("Promoting defence");
            const next = visit(root.after, reply);
            if (next.isEnd()) throw new Error("Terminal decline");
            const balance = root.capture - capturedValue(root.after, reply);
            let branch: CaptureDeflectionProof["declined"][number] | undefined;
            for (const move of legalMoves(next)) {
                if (
                    move.from !== root.move.to &&
                    !(
                        next.isCheck() &&
                        next.ctx().checkers.has(move.to) &&
                        capturedValue(next, move)
                    )
                )
                    continue;
                const gain = settled(next, move);
                if (gain === null || balance + gain < 90) continue;
                branch = {
                    reply: makeSan(root.after, reply),
                    answer: makeSan(next, move),
                    gain: balance + gain,
                };
                break;
            }
            if (!branch) throw new Error(`Unproved decline: ${makeSan(root.after, reply)}`);
            minimum = Math.min(minimum, branch.gain);
            declined.push(branch);
        }
        proof = { gain: minimum, accepted, declined };
    } catch (error) {
        onFailure?.(error instanceof Error ? error.message : "Unproved capture deflection");
    }
    if (!onFailure && nodeLimit === 16384) {
        captureDeflectionCache.set(key, proof);
        if (captureDeflectionCache.size > 128)
            captureDeflectionCache.delete(captureDeflectionCache.keys().next().value!);
    }
    return proof;
}

type ExchangeDeflectionProof = {
    gain: number;
    defender: Square;
    target: Square;
    secondary: Square;
    capturer: Square;
    acceptance: string[];
    recovery: string[];
};
const exchangeDeflectionCache = new Map<string, ExchangeDeflectionProof | null>();

/** A checking slider overloads a defender which also blocks its route to a
 * second victim. Accepting the offer abandons the first target; declining may
 * allow an exchange of that target which draws the same defender off the ray.
 * All replies are checked. Only these two connected captures earn new credit;
 * quiet leaf moves may preserve material already won, never invent a payoff. */
export function proveExchangeDeflection(
    root: TacticalReplayStep,
    nodeLimit = 8192,
    onFailure?: (reason: string) => void,
): ExchangeDeflectionProof | null {
    if (
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0 ||
        root.move.promotion ||
        !root.after.isCheck() ||
        root.after.isEnd()
    )
        return null;
    const piece = root.after.board.get(root.move.to)!;
    if (!["bishop", "rook", "queen"].includes(piece.role)) return null;
    const key = `${makeFen(root.before.toSetup())}:${root.uci}`;
    if (!onFailure && nodeLimit === 8192 && exchangeDeflectionCache.has(key))
        return exchangeDeflectionCache.get(key)!;
    const side = root.before.turn,
        enemy = opposite(side);
    const budget = { nodes: nodeLimit };
    const visit = (pos: Chess, move: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Exchange deflection budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const settled = (pos: Chess, move: NormalMove) => {
        if (move.promotion) return null;
        const next = visit(pos, move);
        if (next.isEnd()) return null;
        for (const reply of legalMoves(next))
            if (reply.promotion || visit(next, reply).isCheckmate()) return null;
        return participantCaptureGain(pos, move, [...pos.board[side], move.to], budget);
    };
    let proof: ExchangeDeflectionProof | null = null;
    try {
        const replies = legalMoves(root.after);
        for (const acceptance of replies) {
            if (
                acceptance.to !== root.move.to ||
                acceptance.promotion ||
                !capturedValue(root.after, acceptance)
            )
                continue;
            const defender = root.after.board.get(acceptance.from)!;
            if (defender.role === "king") continue;
            const opened = attacks(
                piece,
                root.move.to,
                root.after.board.occupied.without(acceptance.from),
            ).intersect(root.after.board[enemy]);
            const secondaries = [...opened].filter(
                (sq) =>
                    between(root.move.to, sq).has(acceptance.from) &&
                    !["king", "pawn"].includes(root.after.board.get(sq)!.role),
            );
            if (!secondaries.length) continue;
            const targets = [
                ...attacks(defender, acceptance.from, root.after.board.occupied).intersect(
                    root.after.board[enemy],
                ),
            ].filter((sq) => !["king", "pawn"].includes(root.after.board.get(sq)!.role));
            for (const target of targets)
                for (const secondary of secondaries) {
                    if (target === secondary) continue;
                    const accepted = visit(root.after, acceptance);
                    if (
                        accepted.isEnd() ||
                        attacks(defender, acceptance.to, accepted.board.occupied).has(target)
                    )
                        continue;
                    for (const capture of legalMoves(accepted)) {
                        if (
                            capture.to !== target ||
                            capture.promotion ||
                            !capturedValue(accepted, capture)
                        )
                            continue;
                        // Use the real pre-offer board. Restoring a guard while
                        // leaving the new check in place wrongly makes its
                        // recapture illegal and calls an already won queen loose.
                        const defendedGain = tacticalExchangeGain(root.before, capture);
                        const acceptedGain = settled(accepted, capture);
                        const initial = root.capture - capturedValue(root.after, acceptance);
                        if (
                            defendedGain <= -VALUE.king ||
                            defendedGain >= 100 ||
                            acceptedGain === null ||
                            initial + acceptedGain < 100 ||
                            acceptedGain - defendedGain < 100
                        )
                            continue;
                        let minimum = Infinity;
                        let recovery: string[] | null = null;
                        let all = true;
                        for (const reply of replies) {
                            const pos = visit(root.after, reply);
                            if (pos.isEnd() || reply.promotion) {
                                all = false;
                                break;
                            }
                            const mappedTarget = reply.from === target ? reply.to : target;
                            const mappedSecondary = reply.from === secondary ? reply.to : secondary;
                            const main = { from: capture.from, to: mappedTarget };
                            const balance = root.capture - capturedValue(root.after, reply);
                            if (!pos.isLegal(main) || !capturedValue(pos, main)) {
                                all = false;
                                break;
                            }
                            const direct = settled(pos, main);
                            if (direct !== null && balance + direct >= 100) {
                                minimum = Math.min(minimum, balance + direct);
                                continue;
                            }
                            const after = visit(pos, main);
                            if (after.isEnd()) {
                                all = false;
                                break;
                            }
                            let branch = Infinity;
                            for (const response of legalMoves(after)) {
                                const leaf = visit(after, response);
                                if (leaf.isEnd() || response.promotion) {
                                    all = false;
                                    break;
                                }
                                const retained =
                                    balance +
                                    capturedValue(pos, main) -
                                    capturedValue(after, response);
                                const second =
                                    response.from === mappedSecondary
                                        ? response.to
                                        : mappedSecondary;
                                let best = -Infinity;
                                const take = { from: root.move.to, to: second };
                                // The actual original defender must vacate the ray;
                                // no unrelated rook/queen elsewhere can be borrowed.
                                if (
                                    response.from === acceptance.from &&
                                    response.to === main.to &&
                                    capturedValue(after, response) &&
                                    leaf.isLegal(take) &&
                                    capturedValue(leaf, take)
                                ) {
                                    const gain = settled(leaf, take);
                                    if (gain !== null && retained + gain >= 100) {
                                        best = retained + gain;
                                        recovery = [
                                            makeSan(root.after, reply),
                                            makeSan(pos, main),
                                            makeSan(after, response),
                                            makeSan(leaf, take),
                                        ];
                                    }
                                }
                                if (best < 100 && retained >= 100) {
                                    for (const save of legalMoves(leaf)) {
                                        if (save.promotion || capturedValue(leaf, save)) continue;
                                        const gain = settled(leaf, save);
                                        if (gain !== null && retained + gain >= 100) {
                                            best = retained + gain;
                                            break;
                                        }
                                    }
                                }
                                if (best < 100) {
                                    onFailure?.(
                                        `Unproved ${makeSan(root.after, reply)} ${makeSan(pos, main)} ${makeSan(after, response)} retained ${retained}`,
                                    );
                                    all = false;
                                    break;
                                }
                                branch = Math.min(branch, best);
                            }
                            if (!all) break;
                            minimum = Math.min(minimum, branch);
                        }
                        if (all && recovery && Number.isFinite(minimum)) {
                            proof = {
                                gain: minimum,
                                defender: acceptance.from,
                                target,
                                secondary,
                                capturer: capture.from,
                                acceptance: [
                                    makeSan(root.after, acceptance),
                                    makeSan(accepted, capture),
                                ],
                                recovery,
                            };
                            break;
                        }
                    }
                    if (proof) break;
                }
            if (proof) break;
        }
    } catch (error) {
        onFailure?.(error instanceof Error ? error.message : "Unproved exchange deflection");
    }
    if (!onFailure && nodeLimit === 8192) {
        exchangeDeflectionCache.set(key, proof);
        if (exchangeDeflectionCache.size > 128)
            exchangeDeflectionCache.delete(exchangeDeflectionCache.keys().next().value!);
    }
    return proof;
}

/** Select a verified acceptance mechanism. The legacy guarded-target route
 * uses a restoration probe; the blocking-defender route proves the newly
 * opened legal capture and permits different receivers to lose differently. */
function deflectionEvidence(steps: TacticalReplayStep[], source: TacticalMotifEvidence["source"]) {
    const [bait, reply, payoff] = steps;
    const exchange = bait && proveExchangeDeflection(bait);
    if (exchange)
        return {
            id: "deflection",
            label: "Deflection",
            source,
            confidence: "high",
            ply: 1,
            moveUci: bait.uci,
            value: exchange.gain,
            evidence: `${bait.san} overloads the ${bait.after.board.get(exchange.defender)!.role} on ${makeSquare(exchange.defender)}. Accepting the offer abandons the ${bait.after.board.get(exchange.target)!.role} on ${makeSquare(exchange.target)}: ${exchange.acceptance.join(" ")}. Declining does not save both targets: ${exchange.recovery.join(" ")} draws the same defender away and wins the ${bait.after.board.get(exchange.secondary)!.role} on ${makeSquare(exchange.secondary)}. Every legal reply retains a verified local material gain, including exchange costs and immediate countercaptures. The continuation depends on the defence.`,
        } satisfies TacticalMotifEvidence;
    const mating = bait && proveMatingDeflection(bait);
    if (mating) {
        const branch = mating.mating[0];
        const defender = bait.after.board.get(branch.defender)!;
        const decline =
            mating.declined.find((branch) => branch.continuation?.length) ?? mating.declined[0];
        const opening = matingDeflectionRays(bait, mating)
            .map(
                (ray) =>
                    ` The move also opens the ${bait.after.board.get(ray.from)!.role}'s line from ${makeSquare(ray.from)} to ${makeSquare(ray.target)} for ${ray.mate}.`,
            )
            .join("");
        return {
            id: "deflection",
            label: "Deflection",
            source,
            confidence: "high",
            ply: 1,
            moveUci: bait.uci,
            value: mating.gain,
            evidence: `${bait.san} offers the ${bait.after.board.get(bait.move.to)!.role} to deflect the ${defender.role} from ${makeSquare(branch.defender)}. Accepting with ${branch.reply} allows ${branch.mate}: ${branch.mode === "block" ? `the ${defender.role} no longer blocks the mating line from ${makeSquare(branch.target)} to ${makeSquare(bait.after.board.kingOf(opposite(bait.before.turn))!)}` : `the defender no longer guards ${makeSquare(branch.target)}`}.${opening} ${decline ? `Declining can avoid this mate, but every legal decline has a checked material win or immediate mate. ${decline.continuation ? `After ${decline.reply}, ${decline.answer} forces an answer to check before the material recovery; ${decline.continuation.join(" ")} is one checked continuation.` : `For example, ${decline.reply} ${decline.answer}.`} This is not a forced-mate claim.` : "Every legal reply accepts the offer and allows immediate mate."}`,
        } satisfies TacticalMotifEvidence;
    }
    const capture = bait && proveCaptureDeflection(bait);
    if (capture) {
        const branch = capture.accepted.find((branch) => branch.mode === "ray")!;
        const pin = capture.accepted.find((branch) => branch.mode === "pin");
        return {
            id: "deflection",
            label: "Deflection",
            source,
            confidence: "high",
            ply: 1,
            moveUci: bait.uci,
            value: capture.gain,
            evidence: `${bait.san} offers the ${bait.after.board.get(bait.move.to)!.role} to deflect the ${bait.after.board.get(branch.receiver)!.role} from ${makeSquare(branch.receiver)}. If ${branch.reply}, ${branch.answer} exploits the opened line to the ${bait.after.board.get(branch.target)!.role} on ${makeSquare(branch.target)}.${pin ? ` A different recapture, ${pin.reply}, puts the ${bait.after.board.get(pin.receiver)!.role} in a pin to its king; ${pin.answer} adds an attack on it. That pin belongs to this branch, not every defence.` : ""} All legal recaptures and declined offers retain extra material in the checked short exchanges; the continuation depends on the defence.`,
        } satisfies TacticalMotifEvidence;
    }
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

/** A checking exchange can preserve an already opened capture after an offer
 * is declined. Every check response must still allow the nominated capture;
 * the PV does not provide the defence list and this is not a move-order claim. */
function checkingExchangeRecovery(
    pos: Chess,
    move: NormalMove,
    payoffs: NormalMove[],
    balance: number,
    budget: ProofBudget,
): { gain: number; continuation: string[] } | null {
    if (move.promotion || !capturedValue(pos, move) || !payoffs.length) return null;
    const side = pos.turn;
    const moves = (p: Chess) =>
        legalMoves(p).sort((a, b) => {
            const flip = side === "black" ? 0 : 56;
            return (a.from ^ flip) - (b.from ^ flip) || (a.to ^ flip) - (b.to ^ flip);
        });
    const visit = (p: Chess, m: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Checking exchange budget exhausted");
        const next = p.clone();
        next.play(m);
        return next;
    };
    const after = visit(pos, move);
    if (!after.ctx().checkers.has(move.to) || after.isEnd()) return null;
    let minimum = Infinity,
        continuation: string[] = [];
    for (const reply of moves(after)) {
        if (reply.promotion) return null;
        const next = visit(after, reply);
        if (next.isEnd()) return null;
        let best = -Infinity,
            answer = "";
        for (const payoff of payoffs) {
            const capture = {
                from: payoff.from,
                to: reply.from === payoff.to ? reply.to : payoff.to,
            };
            if (!next.isLegal(capture) || !capturedValue(next, capture)) continue;
            const leaf = visit(next, capture);
            if (leaf.isEnd()) continue;
            let safe = true;
            for (const resource of moves(leaf))
                if (resource.promotion || visit(leaf, resource).isCheckmate()) {
                    safe = false;
                    break;
                }
            if (!safe) continue;
            const gain = participantCaptureGain(
                next,
                capture,
                [...next.board[side], capture.to],
                budget,
            );
            if (gain === null) continue;
            const recovered =
                balance + capturedValue(pos, move) - capturedValue(after, reply) + gain;
            if (recovered > best) {
                best = recovered;
                answer = makeSan(next, capture);
            }
        }
        if (best < 100) return null;
        if (best < minimum) {
            minimum = best;
            continuation = [makeSan(after, reply), answer];
        }
    }
    return Number.isFinite(minimum) ? { gain: minimum, continuation } : null;
}

type MatingDeflectionProof = {
    gain: number;
    mating: {
        reply: string;
        mate: string;
        defender: Square;
        target: Square;
        mode: "guard" | "block";
    }[];
    declined: { reply: string; answer: string; gain: number; continuation?: string[] }[];
};
const matingDeflectionCache = new Map<string, MatingDeflectionProof | null>();

/** Only a genuinely newly uncovered slider that plays the certified mate
 * belongs to this explanation. A similar square or a later PV ray does not. */
function matingDeflectionRays(root: TacticalReplayStep, proof: MatingDeflectionProof) {
    return revealedRays(root).flatMap((ray) => {
        for (const branch of proof.mating) {
            if (branch.target !== ray.target) continue;
            const pos = root.after.clone();
            const reply = parseSan(pos, branch.reply);
            if (!reply) continue;
            pos.play(reply);
            const mate = parseSan(pos, branch.mate);
            if (mate && "from" in mate && mate.from === ray.from && mate.to === ray.target)
                return [{ ...ray, mate: branch.mate }];
        }
        return [];
    });
}

/** A normal capture can offer its mover to a mating-square defender or a
 * blocker of the mating ray. Every acceptance must allow immediate mate,
 * and every declined offer must retain material through a related move.
 * Restoring the receiver is a causal geometry probe, never a legal PV. */
export function proveMatingDeflection(
    root: TacticalReplayStep,
    nodeLimit = 8192,
    onFailure?: (reason: string) => void,
): MatingDeflectionProof | null {
    if (
        !root.capture ||
        !root.before.board.get(root.move.to) ||
        root.move.promotion ||
        root.after.isEnd() ||
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0 ||
        tacticalExchangeGain(root.before, root.move) >= 100
    )
        return null;
    const key = `${makeFen(root.before.toSetup())}:${root.uci}`;
    if (!onFailure && nodeLimit === 8192 && matingDeflectionCache.has(key))
        return matingDeflectionCache.get(key)!;
    const budget = { nodes: nodeLimit };
    const visit = (pos: Chess, move: NormalMove) => {
        if (--budget.nodes < 0) throw new Error("Mating deflection budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const side = root.before.turn,
        enemy = opposite(side);
    const king = root.after.board.kingOf(enemy)!;
    // Quiet offers have more defences than checks. Keep their bounded traversal
    // identical under colour reflection without changing older checking proofs.
    const moves = (pos: Chess) => {
        const list = legalMoves(pos);
        if (root.after.isCheck()) return list;
        const flip = side === "black" ? 0 : 56;
        return list.sort(
            (a, b) => (a.from ^ flip) - (b.from ^ flip) || (a.to ^ flip) - (b.to ^ flip),
        );
    };
    let proof: MatingDeflectionProof | null = null;
    try {
        const mating: MatingDeflectionProof["mating"] = [],
            declined: MatingDeflectionProof["declined"] = [];
        let minimum = 10000;
        for (const reply of moves(root.after)) {
            const next = visit(root.after, reply);
            if (next.isEnd() || reply.promotion) throw new Error("Terminal or promoting defence");
            if (reply.to === root.move.to && capturedValue(root.after, reply)) {
                const defender = root.after.board.get(reply.from)!;
                if (defender.role === "king")
                    throw new Error("King attraction is not defender deflection");
                let found = false;
                for (const mate of moves(next)) {
                    if (mate.promotion || !visit(next, mate).isCheckmate()) continue;
                    const restored = next.clone();
                    restored.board.take(reply.to);
                    restored.board.set(reply.from, defender);
                    if (!restored.isLegal(mate)) continue;
                    const defended = visit(restored, mate);
                    const checker = defended.board.get(mate.to)!;
                    const guard = defended.isLegal({ from: reply.from, to: mate.to });
                    const block =
                        ["bishop", "rook", "queen"].includes(checker.role) &&
                        between(mate.to, king).has(reply.from) &&
                        !defended.isCheck();
                    if (defended.isCheckmate() || (!guard && !block)) continue;
                    mating.push({
                        reply: makeSan(root.after, reply),
                        mate: makeSan(next, mate),
                        defender: reply.from,
                        target: mate.to,
                        mode: guard ? "guard" : "block",
                    });
                    found = true;
                    break;
                }
                if (!found) throw new Error(`Unproved acceptance: ${makeSan(root.after, reply)}`);
                continue;
            }
            const balance = root.capture - capturedValue(root.after, reply);
            let best: MatingDeflectionProof["declined"][number] | null = null;
            for (const answer of moves(next)) {
                const takesBlock =
                    root.after.isCheck() &&
                    between(root.move.to, king).has(reply.to) &&
                    answer.to === reply.to &&
                    capturedValue(next, answer) > 0;
                if (answer.promotion || (answer.from !== root.move.to && !takesBlock)) continue;
                const leaf = visit(next, answer);
                if (leaf.isCheckmate()) {
                    best = {
                        reply: makeSan(root.after, reply),
                        answer: makeSan(next, answer),
                        gain: 10000,
                    };
                    break;
                }
                if (leaf.isEnd()) continue;
                let safe = true;
                for (const resource of moves(leaf)) {
                    if (resource.promotion || visit(leaf, resource).isCheckmate()) {
                        safe = false;
                        break;
                    }
                }
                if (!safe) continue;
                const gain = participantCaptureGain(
                    next,
                    answer,
                    [...next.board[side], answer.to],
                    budget,
                );
                if (gain === null || balance + gain < 100) continue;
                if (!best || balance + gain > best.gain)
                    best = {
                        reply: makeSan(root.after, reply),
                        answer: makeSan(next, answer),
                        gain: balance + gain,
                    };
                if (best.gain >= root.capture) break;
            }
            if (
                !best &&
                !root.after.isCheck() &&
                root.after.isLegal({ from: reply.from, to: root.move.to })
            ) {
                // The declining receiver may vacate a second defensive line.
                // Nominate only legal sliding captures through that exact square
                // or a capture of the declining receiver itself.
                const payoffs = moves(next).filter(
                    (move) =>
                        capturedValue(next, move) &&
                        (move.to === reply.to ||
                            (["bishop", "rook", "queen"].includes(
                                next.board.get(move.from)!.role,
                            ) &&
                                between(move.from, move.to).has(reply.from))),
                );
                for (const answer of moves(next)) {
                    if (answer.from !== root.move.to) continue;
                    const recovery = checkingExchangeRecovery(
                        next,
                        answer,
                        payoffs,
                        balance,
                        budget,
                    );
                    if (!recovery) continue;
                    best = {
                        reply: makeSan(root.after, reply),
                        answer: makeSan(next, answer),
                        ...recovery,
                    };
                    break;
                }
            }
            if (!best) throw new Error(`Unproved declined offer: ${makeSan(root.after, reply)}`);
            minimum = Math.min(minimum, best.gain, root.capture);
            declined.push(best);
        }
        if (mating.length) proof = { gain: minimum, mating, declined };
    } catch (error) {
        onFailure?.(error instanceof Error ? error.message : "Unproved mating deflection");
    }
    if (nodeLimit === 8192) {
        matingDeflectionCache.set(key, proof);
        if (matingDeflectionCache.size > 128)
            matingDeflectionCache.delete(matingDeflectionCache.keys().next().value!);
    }
    return proof;
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

type SelfInterferenceProof = {
    defender: Square;
    target: Square;
    capturer: Square;
    blocker: Square;
    gain: number;
    captureUci: string;
    captureSan: string;
};

/** A defending move can cut its OWN guard's ray. Require a legal recapture
 * by that exact guard before the move, and a newly profitable capture after
 * it. The pre-move turn swap only tests protection, never a playable line.
 * Actual capture leaves debit all friendly-piece liabilities and reject
 * immediate mate/promotion refutations. A PV or a supplied tag grants no proof. */
export function proveSelfInterference(
    step: TacticalReplayStep,
    nodeLimit = 4096,
    sharedBudget?: { nodes: number },
): SelfInterferenceProof | null {
    if (
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0 ||
        step.move.promotion ||
        step.after.isEnd()
    )
        return null;
    const side = step.before.turn;
    const budget = sharedBudget ?? { nodes: nodeLimit };
    const beforeProbe = withTurn(step.before, opposite(side));
    try {
        for (const defender of step.before.board[side]) {
            const guard = step.before.board.get(defender)!;
            if (defender === step.move.from || !["bishop", "rook", "queen"].includes(guard.role))
                continue;
            for (const target of attacks(guard, defender, step.before.board.occupied).intersect(
                step.before.board[side],
            )) {
                const victim = step.after.board.get(target);
                if (
                    !victim ||
                    victim.color !== side ||
                    VALUE[victim.role] < 320 ||
                    victim.role === "king" ||
                    target === step.move.to ||
                    !between(defender, target).has(step.move.to)
                )
                    continue;
                if (attacks(guard, defender, step.after.board.occupied).has(target)) continue;
                for (const capturer of step.after.board[opposite(side)]) {
                    const capture = { from: capturer, to: target };
                    if (!step.after.isLegal(capture) || !beforeProbe.isLegal(capture)) continue;
                    if (--budget.nodes < 0) return null;
                    const oldCapture = beforeProbe.clone();
                    oldCapture.play(capture);
                    if (!oldCapture.isLegal({ from: defender, to: target })) continue;
                    const oldGain = tacticalExchangeGain(beforeProbe, capture);
                    if (oldGain <= -VALUE.king || oldGain >= 100) continue;
                    const gain = participantCaptureGain(
                        step.after,
                        capture,
                        [...step.after.board[opposite(side)], target],
                        budget,
                    );
                    if (
                        gain === null ||
                        gain - step.capture < 100 ||
                        !noImmediateTerminalRefutation(step.after, capture, budget)
                    )
                        continue;
                    const leaf = step.after.clone();
                    leaf.play(capture);
                    // This certificate describes material, not a mate whose
                    // target happens to be occupied by a valuable piece.
                    if (leaf.isEnd()) continue;
                    return {
                        defender,
                        target,
                        capturer,
                        blocker: step.move.to,
                        gain: gain - step.capture,
                        captureUci: makeUci(capture),
                        captureSan: makeSan(step.after, capture),
                    };
                }
            }
        }
    } catch {
        // An incomplete local exchange cannot establish a new loss.
    }
    return null;
}

type ForcedInterferenceProof = {
    gain: number;
    branches: { reply: string; replyUci: string; proof: SelfInterferenceProof }[];
};
const forcedInterferenceCache = new Map<string, ForcedInterferenceProof | null>();

/** Promote the mechanism to a root lesson only when EVERY legal check
 * evasion cuts the same real guard-target connection and loses material.
 * Otherwise a verified occurrence may still be shown at its actual ply. */
export function proveForcedSelfInterference(
    root: TacticalReplayStep,
    nodeLimit = 4096,
): ForcedInterferenceProof | null {
    if (
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0 ||
        !root.after.isCheck() ||
        root.after.isEnd() ||
        root.move.promotion
    )
        return null;
    const key = `${makeFen(root.before.toSetup())}:${root.uci}`;
    if (nodeLimit === 4096 && forcedInterferenceCache.has(key))
        return forcedInterferenceCache.get(key)!;
    const budget = { nodes: nodeLimit };
    const branches: ForcedInterferenceProof["branches"] = [];
    const replies = legalMoves(root.after);
    for (const reply of replies) {
        if (--budget.nodes < 0) break;
        const after = root.after.clone();
        after.play(reply);
        const step = {
            before: root.after,
            after,
            move: reply,
            uci: makeUci(reply),
            san: makeSan(root.after, reply),
            capture: capturedValue(root.after, reply),
            balance: 0,
        };
        const proof = proveSelfInterference(step, nodeLimit, budget);
        if (
            !proof ||
            (branches.length &&
                (branches[0].proof.defender !== proof.defender ||
                    branches[0].proof.target !== proof.target))
        )
            break;
        branches.push({ reply: step.san, replyUci: step.uci, proof });
    }
    const proof =
        replies.length && branches.length === replies.length
            ? { gain: root.capture + Math.min(...branches.map((b) => b.proof.gain)), branches }
            : null;
    if (nodeLimit === 4096) {
        forcedInterferenceCache.set(key, proof);
        if (forcedInterferenceCache.size > 128)
            forcedInterferenceCache.delete(forcedInterferenceCache.keys().next().value!);
    }
    return proof;
}

export function selfInterferenceEvidence(
    step: TacticalReplayStep,
    source: TacticalMotifEvidence["source"],
): TacticalMotifEvidence | null {
    const proof = proveSelfInterference(step);
    if (!proof) return null;
    const side = step.before.turn === "white" ? "White" : "Black";
    return {
        id: "selfInterference",
        label: "Self-Interference",
        source,
        confidence: "high",
        ply: 1,
        moveUci: step.uci,
        value: proof.gain,
        evidence: `${step.san} blocks ${side}'s ${step.before.board.get(proof.defender)!.role} on ${makeSquare(proof.defender)} from defending the ${step.after.board.get(proof.target)!.role} on ${makeSquare(proof.target)}. ${proof.captureSan} now wins material; the guard could legally recapture before this blocking move. This explains the concession, not a tactic won by ${side}.`,
    };
}

type MatingKingDeflectionProof = {
    king: Square;
    target: Square;
    capturer: Square;
    branches: { reply: string; replyUci: string; mate: string; mateUci: string }[];
};
const matingKingDeflectionCache = new Map<string, MatingKingDeflectionProof | null>();

/** The checking move draws the king away from a guarded mating square.
 * Every legal reply must move that king and allow a legal mating capture
 * on the same square. Before the check, the exact premature capture must
 * allow Kx(capturer). This is a complete mate-in-two mechanism, not a
 * sacrifice/PV tag; other defences or an exhausted budget abstain. */
export function proveMatingKingDeflection(
    root: TacticalReplayStep,
    nodeLimit = 4096,
): MatingKingDeflectionProof | null {
    if (
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0 ||
        root.move.promotion ||
        !root.after.isCheck() ||
        root.after.isEnd()
    )
        return null;
    const key = `${makeFen(root.before.toSetup())}:${root.uci}`;
    if (nodeLimit === 4096 && matingKingDeflectionCache.has(key))
        return matingKingDeflectionCache.get(key)!;
    const king = root.after.board.kingOf(root.after.turn)!;
    const replies = legalMoves(root.after);
    let nodes = nodeLimit;
    const visit = (pos: Chess, move: NormalMove) => {
        if (--nodes < 0) throw new Error("Mating king deflection budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    let proof: MatingKingDeflectionProof | null = null;
    try {
        if (replies.length && replies.every((reply) => reply.from === king)) {
            for (const target of attacks(
                { color: root.after.turn, role: "king" },
                king,
                root.after.board.occupied,
            ).intersect(root.after.board[root.after.turn])) {
                if (target === root.move.to || !root.before.board.get(target)) continue;
                for (const capturer of root.before.board[root.before.turn]) {
                    if (capturer === root.move.from) continue;
                    const capture = { from: capturer, to: target };
                    if (!root.before.isLegal(capture)) continue;
                    const premature = visit(root.before, capture);
                    if (!premature.isLegal({ from: king, to: target })) continue;
                    const branches: MatingKingDeflectionProof["branches"] = [];
                    for (const reply of replies) {
                        const next = visit(root.after, reply);
                        // A king still adjacent to the square has not been
                        // drawn away from it. A newly protected mating piece
                        // alone is a different mechanism.
                        if (
                            attacks(
                                { color: root.after.turn, role: "king" },
                                reply.to,
                                next.board.occupied,
                            ).has(target) ||
                            !next.isLegal(capture) ||
                            !visit(next, capture).isCheckmate()
                        )
                            break;
                        branches.push({
                            reply: makeSan(root.after, reply),
                            replyUci: makeUci(reply),
                            mate: makeSan(next, capture),
                            mateUci: makeUci(capture),
                        });
                    }
                    if (branches.length === replies.length) {
                        proof = { king, target, capturer, branches };
                        break;
                    }
                }
                if (proof) break;
            }
        }
    } catch {
        // The tag is withheld unless every real defence was covered.
    }
    if (nodeLimit === 4096) {
        matingKingDeflectionCache.set(key, proof);
        if (matingKingDeflectionCache.size > 128)
            matingKingDeflectionCache.delete(matingKingDeflectionCache.keys().next().value!);
    }
    return proof;
}

export function matingKingDeflectionEvidence(
    step: TacticalReplayStep,
    source: TacticalMotifEvidence["source"],
): TacticalMotifEvidence | null {
    const proof = proveMatingKingDeflection(step);
    if (!proof) return null;
    const branch = proof.branches[0];
    return {
        id: "deflection",
        label: "Mating Deflection",
        source,
        confidence: "high",
        ply: 1,
        moveUci: step.uci,
        value: 10000,
        evidence: `${step.san} draws the king away from defending ${makeSquare(proof.target)}. After ${branch.reply}, ${branch.mate} is checkmate. Capturing on ${makeSquare(proof.target)} first would allow the king to take that piece. Every legal reply allows this mating capture; this is the mechanism at this move, not a separate material win.`,
    };
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
            proveReinforcedPin(root) ||
            proveQuietMateThreat(root) ||
            quietPreparation(steps) ||
            (allowConditional
                ? proveQuietTacticalPreparation(steps)
                : proveQuietTacticalPreparation(steps)?.forced)),
    );
}

export function episodeEnd(steps: TacticalReplayStep[], allowConditional = false) {
    for (let i = 0; i < steps.length; i += 2) {
        const step = steps[i];
        if (
            !step.capture &&
            !step.move.promotion &&
            !step.before.isCheck() &&
            !step.after.isCheck() &&
            !hasConcreteThreat(step) &&
            !proveReinforcedPin(step) &&
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

export function auditTacticalMotifs(
    fen: string,
    line: string[],
    proposals: TacticalMotifEvidence[],
    rootCp?: number | null,
    context?: { previousFen?: string | null; previousMoveUci?: string | null },
) {
    const steps = replayTacticalLine(fen, line);
    if (!steps.length) return [];
    const allowConditional = typeof rootCp === "number" && Number.isFinite(rootCp) && rootCp >= -30;
    const checkingMate =
        proveShortCheckingMate(steps[0]) ?? (steps.length >= 3 ? proveCheckingMate(steps) : null);
    const promotionCombination = provePromotionCombination(steps[0]);
    const promotionPly = steps.findIndex(
        (step) => step.before.turn === steps[0].before.turn && step.move.promotion,
    );
    const clearanceEnd = forcingClearanceEpisodeLength(steps);
    const end =
        checkingMate && steps.some((step) => step.after.isCheckmate())
            ? steps.findIndex((step) => step.after.isCheckmate()) + 1
            : clearanceEnd !== null
              ? clearanceEnd
              : promotionCombination && promotionPly >= 0 && promotionPly <= 16
                ? promotionPly + 1
                : episodeEnd(steps, allowConditional);
    if (!end) return [];
    const episode = steps.slice(0, end);
    const attacker = steps[0].before.turn;
    const final = episode.at(-1)!;
    if (final.after.isCheckmate() && final.before.turn !== attacker && !checkingMate) return [];
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
    const mixedCheckingAttack =
        !mate && !checkingAttack && !verifiedFork(steps[0])
            ? proveMixedCheckingAttack(steps[0])
            : null;
    const forcingAttack = checkingAttack ?? mixedCheckingAttack;
    if (forcingAttack) {
        const material =
            forcingAttack.branches.find(
                (branch) => branch.gain < 10000 && branch.reply === steps[1]?.san,
            ) ?? forcingAttack.branches.find((branch) => branch.gain < 10000)!;
        const mateBranch = forcingAttack.branches.find((branch) => branch.gain === 10000);
        candidates.push({
            id: "forcingAttack",
            label: "Forcing Attack",
            source: proposals[0]?.source ?? "available",
            confidence: "high",
            ply: 1,
            moveUci: steps[0].uci,
            value: forcingAttack.gain,
            evidence: `${steps[0].san} ${mixedCheckingAttack ? `offers the ${steps[0].before.board.get(steps[0].move.from)!.role} with check` : "starts a checking attack"} that wins material or mates against every legal reply. After ${material.reply}, ${material.line.join(" ")} wins material.${mateBranch ? ` Instead, ${mateBranch.reply} allows ${mateBranch.line.join(" ")}, forcing mate.` : ""} The continuation depends on the defence; later pins and forks belong to their actual positions, not the opening check.`,
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
    const capturePreparation =
        !mate && !verifiedFork(steps[0]) ? proveCaptureForkPreparation(steps[0]) : null;
    if (capturePreparation) {
        const root = steps[0];
        const fork = capturePreparation.branches[0];
        const declined = capturePreparation.declined[0];
        const removed = fork.removedDefender;
        const introduction = fork.quietForkGuard
            ? `${root.san} captures the ${root.before.board.get(root.move.to)!.role} and offers the ${root.before.board.get(root.move.from)!.role}, drawing the ${fork.receiver} off ${makeSquare(fork.quietForkGuard.square)} onto ${makeSquare(root.move.to)}. After ${fork.reply}, ${fork.answer} forks the ${fork.targets.join(" and ")}. Playing ${fork.quietForkGuard.premature} first instead allows ${fork.quietForkGuard.defence}, capturing the pawn. The prepared fork recovers the sacrifice, including checking counterattacks and this pawn's possible promotion.`
            : removed
              ? `${removed.square === root.move.to ? `${root.san} captures the defending ${root.before.board.get(removed.square)!.role} on ${makeSquare(removed.square)}. After ${fork.reply}, ${fork.answer} forks the ${fork.targets.join(" and ")}, recovering the sacrifice.` : `${root.san} offers the ${root.before.board.get(root.move.from)!.role} to draw the defending ${fork.receiver} off ${makeSquare(removed.square)}. After ${fork.reply}, ${fork.answer} removes it and forks the ${fork.targets.join(" and ")}.`} Playing ${removed.premature} first lets that defender capture the forking piece with ${removed.defence}.`
              : fork.vacatedForkSquare !== undefined
                ? `${root.san} captures the ${root.before.board.get(root.move.to)!.role} while clearing ${makeSquare(fork.vacatedForkSquare)} for a checking fork. The offered ${root.before.board.get(root.move.from)!.role} occupied that square, so the fork could not be played first. After ${fork.reply}, ${fork.answer} forks the ${fork.targets.join(" and ")}, recovering the sacrifice with a net material gain.`
                : fork.clearedForkSquare !== undefined
                  ? `${root.san} captures the ${root.before.board.get(root.move.to)!.role} and offers the ${root.before.board.get(root.move.from)!.role} to draw the ${fork.receiver} off ${makeSquare(fork.clearedForkSquare)}, clearing that square for the pawn fork. After ${fork.reply}, ${fork.answer} forks the ${fork.targets.join(" and ")}, recovering the sacrifice with a net material gain.`
                  : `${root.san} captures the ${root.before.board.get(root.move.to)!.role} and offers the ${root.before.board.get(root.move.from)!.role} to attract the ${fork.receiver} onto ${makeSquare(root.move.to)}. After ${fork.reply}, ${fork.answer} forks the ${fork.targets.join(" and ")}, recovering the sacrifice with a net material gain.${fork.exchange ? ` This wins ${fork.exchange.received[0] === fork.exchange.received[1] ? `two ${fork.exchange.received[0]}s` : `a ${fork.exchange.received.join(" and a ")}`} for the rook; after legal countercaptures, the verified local net gain is at least ${capturePreparation.gain / 100} pawns, not a full-position evaluation.` : ""}`;
        const otherCapture = capturePreparation.otherCaptures?.[0];
        candidates.push({
            id: "forkPreparation",
            label: "Fork Preparation",
            source: proposals[0]?.source ?? "available",
            confidence: "high",
            ply: 1,
            moveUci: root.uci,
            value: capturePreparation.gain,
            verifiedCombination: true,
            evidence: `${introduction}${otherCapture ? ` Taking with ${otherCapture.reply} instead allows ${otherCapture.answer}, retaining material without needing that fork.` : ""}${declined ? ` Declining with ${declined.reply} instead permits ${declined.answer}${declined.mate ? ", checkmate." : declined.countercaptured ? `, capturing the attacking ${declined.countercaptured} while retaining a material gain.` : ", retaining a material gain."}` : ""} Every legal reply has a verified local continuation, including recaptures and immediate countercaptures. The fork is a continuation, not an attack on this board.`,
        });
    }
    const discoveryPreparation =
        !mate && !capturePreparation ? proveCaptureDiscoveryPreparation(steps[0]) : null;
    if (discoveryPreparation) {
        const root = steps[0],
            branch = discoveryPreparation.branches[0];
        const ray = branch.discovery!;
        const declined = discoveryPreparation.declined[0];
        candidates.push({
            id: "attraction",
            label: "Attraction",
            source: proposals[0]?.source ?? "available",
            confidence: "high",
            ply: 1,
            moveUci: root.uci,
            value: discoveryPreparation.gain,
            verifiedCombination: true,
            evidence: `${root.san} offers the ${root.before.board.get(root.move.from)!.role} to draw the ${branch.receiver} onto ${makeSquare(root.move.to)}. After ${branch.reply}, ${branch.answer} uncovers check from the ${root.after.board.get(ray.slider)!.role} on ${makeSquare(ray.slider)} while attacking that recapturer. The discovered check recovers the sacrifice with a net material gain.${declined ? ` Declining with ${declined.reply} instead permits ${declined.answer}${declined.mate ? ", checkmate." : ", retaining a material gain."}` : ""} Every legal reply has a verified local continuation, including recaptures and immediate countercaptures. The discovered check belongs to the continuation, not this board.`,
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
        const attraction = proveDiscoveryAttraction(episode[index]);
        if (attraction) {
            const root = episode[index],
                branch = attraction.accepted[0];
            candidates.push({
                id: "attraction",
                label: "Attraction",
                source: proposals[0]?.source ?? "available",
                confidence: "high",
                ply: index + 1,
                moveUci: root.uci,
                value: attraction.gain,
                evidence: `${root.san} invites ${branch.reply}, drawing the ${root.after.board.get(branch.receiver)!.role} from ${makeSquare(branch.receiver)} onto ${makeSquare(branch.target)}. Then ${branch.preparation} uncovers the ${root.after.board.get(branch.slider)!.role}'s attack on that piece. Playing ${branch.preparation} first instead permits ${branch.priorDefence}: the original ${root.before.board.get(root.move.to)!.role} captures the preparing piece, limiting any immediate material gain to less than a pawn. Every legal acceptance and declined offer has a checked short material recovery; the discovery belongs to the later move, not the initial exchange.`,
            });
        }
        const interference = interferenceProof(episode[index], proposals[0]?.source ?? "available");
        if (interference) candidates.push({ ...interference.motif, ply: index + 1 });
        const forcedInterference = !interference && proveForcedSelfInterference(episode[index]);
        if (forcedInterference) {
            const branch = forcedInterference.branches[0],
                root = episode[index];
            candidates.push({
                id: "interference",
                label: "Forced Interference",
                source: proposals[0]?.source ?? "available",
                confidence: "high",
                ply: index + 1,
                moveUci: root.uci,
                value: forcedInterference.gain,
                evidence: `${root.san} forces the defender to block its own ${root.after.board.get(branch.proof.defender)!.role}'s protection of the ${root.after.board.get(branch.proof.target)!.role} on ${makeSquare(branch.proof.target)}. After ${branch.reply}, ${branch.proof.captureSan} wins material. Every legal check evasion cuts this same defensive connection; the blocking move belongs to the next ply.`,
            });
        }
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
    const pinnedCapture = pinnedCaptureEvidence(steps[0], proposals[0]?.source ?? "available");
    if (pinnedCapture) candidates.push(pinnedCapture);
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
        // Only the certificates below may issue this ranking metadata.
        // A supplied PV label must not smuggle in a proof assertion.
        proposal = { ...proposal };
        delete proposal.verifiedCombination;
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
            // Special-move labels describe this move, not a causal proof of
            // a preceding sequence. Per-ply timeline classification will
            // recover the actual en-passant capture in its own position.
            if (index !== 0) continue;
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
            ["deflection", "interference", "trappedPiece", "intermezzo", "clearance"].includes(
                proposal.id,
            )
        )
            continue;
        if (proposal.id === "promotion" || proposal.id === "underPromotion") {
            const index = episode.findIndex(
                (s) =>
                    s.before.turn === attacker &&
                    s.move.promotion &&
                    (proposal.id !== "underPromotion" || s.move.promotion !== "queen"),
            );
            // A future promotion needs its own root preparation certificate;
            // the PV endpoint alone cannot headline an earlier move. The
            // independent per-ply classifier still names the actual promotion.
            if (index !== 0) continue;
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
                    evidence: `${bait.san} offers the ${bait.before.board.get(bait.move.from)!.role} on ${makeSquare(bait.move.to)}. Accepting with ${episode[anchor + 1].san} permits the mating continuation ${episode
                        .slice(anchor + 1)
                        .map((step) => step.san)
                        .join(" ")}.`,
                };
            }
        }
        if (!proposal.ply || proposal.ply > end) continue;
        const step = steps[proposal.ply - 1];
        if (!step || step.before.turn !== attacker || proposal.moveUci !== step.uci) continue;
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
        // An illegal recapture merely makes this move safe. A later PV gain
        // cannot establish that exploiting the pin achieves anything now.
        const supportedPin =
            proposal.id === "pin" && !step.capture && pinnedRecapturer(step)
                ? materialThreatProof(
                      step,
                      winningTargets(step.after, step.move.to, attacker),
                      [step.move.to],
                      [],
                      false,
                      undefined,
                      { allPiecesAtLeaf: true },
                  )
                : null;
        const pinEntry = proposal.id === "pin" ? provePinEntry(step) : null;
        let sound = false;
        if (MATE.test(proposal.id)) sound = mate;
        else if (proposal.id === "fork") {
            sound = verifiedFork(step);
            const mating = sound && !immediateFork(step) ? proveMateBackedFork(step) : null;
            // This proof borrows a mating continuation to rescue the fork.
            // If the initiating move already has an independent all-defence
            // mate certificate, that is not another material-fork lesson.
            if (mating && proposal.ply === 1 && checkingMate) continue;
            const exchange = sound && !immediateFork(step) ? proveExchangeForPawnFork(step) : null;
            const promotion = sound && !immediateFork(step) ? provePromotionBackedFork(step) : null;
            const recapture = sound && !immediateFork(step) ? proveRecaptureBackedFork(step) : null;
            const discovery = sound && !immediateFork(step) ? proveDiscoveryBackedFork(step) : null;
            const pawn = sound && !immediateFork(step) ? proveQuietPawnFork(step) : null;
            if (mating) {
                proposal = {
                    ...proposal,
                    value: mating.gain,
                    evidence: `${step.san} forks the ${mating.targets.map((sq) => `${step.after.board.get(sq)!.role} on ${makeSquare(sq)}`).join(" and ")}. Capturing the forking piece does not escape: ${mating.matingDefences.map((branch) => `${branch.defence} permits a forced mate (${branch.mate})`).join("; ")}. Other defences concede a verified local material gain on the fork targets or mate; legal recaptures and immediate off-square losses are included. The mating continuation is conditional, not a forced mate from this position.`,
                };
            } else if (discovery) {
                const branch = discovery.branches[0];
                proposal = {
                    ...proposal,
                    value: discovery.gain,
                    verifiedCombination: true,
                    evidence: `${step.san} forks the ${discovery.targets.map((sq) => `${step.after.board.get(sq)!.role} on ${makeSquare(sq)}`).join(" and ")}. Capturing the forker with ${branch.reply} instead permits ${branch.capture} through the newly opened ${branch.slider} line, followed by another material attack.${branch.pinEvidence ? ` ${branch.pinEvidence}` : ""} Every legal defence has a verified local continuation, including connected countercaptures and exposed attacking pieces.${branch.followups.length ? ` For example, ${branch.followups[0]} preserves the pin while meeting a counterattack.` : ""} The local material bound is at least ${discovery.gain / 100} pawns, not a full-position evaluation.`,
                };
            } else if (exchange)
                proposal = {
                    ...proposal,
                    value: exchange.gain,
                    verifiedCombination: true,
                    evidence: `${step.san} forks the ${exchange.targets.map((sq) => `${step.after.board.get(sq)!.role} on ${makeSquare(sq)}`).join(" and ")}; every legal defence concedes material${exchange.matingDefences?.length ? " or mate" : ""}.${
                        exchange.matingDefences
                            ?.slice(0, 2)
                            .map(
                                (line) =>
                                    ` ${line.defence} instead permits a forced mate; for example, ${line.mate}.`,
                            )
                            .join("") ?? ""
                    }`,
                };
            else if (promotion)
                proposal = { ...proposal, value: promotion.gain, evidence: promotion.evidence };
            else if (recapture) {
                const branch = recapture.recaptures[0];
                proposal = {
                    ...proposal,
                    value: recapture.gain,
                    evidence: `${step.san} forks the ${recapture.targets.map((sq) => `${step.after.board.get(sq)!.role} on ${makeSquare(sq)}`).join(" and ")}. Taking the forker with ${branch.reply} instead allows ${branch.answer}${branch.continuation.length ? `, with the verified continuation ${branch.continuation.join(" ")}` : " and immediate mate"}. Every legal defence concedes material or mate; the checking recapture, interpositions and legal exchanges are checked. The follow-up check is conditional, not already on this board.`,
                };
            } else if (pawn) {
                const branch =
                    pawn.branches.find((candidate) => candidate.line.length > 1) ??
                    pawn.branches[0];
                proposal = {
                    ...proposal,
                    value: pawn.gain,
                    verifiedCombination: true,
                    evidence: `${step.san} forks the ${pawn.targets.map((to) => `${step.after.board.get(to)!.role} on ${makeSquare(to)}`).join(" and ")}. The pawn's connected continuation recovers material against every legal defence, including captures of the pawn and checking counterattacks. For example, ${branch.reply} ${branch.line.join(" ")}. This is a fork now; any later check or promotion belongs to its actual move.`,
                };
            }
        } else if (proposal.id === "skewer")
            sound = rayMaterialEvidence(step, proposal.source).some((m) => m.id === "skewer");
        else if (proposal.id === "pin")
            sound =
                (mate && Boolean(pinRestrictsCapture(step))) ||
                Boolean(provePinnedCapture(step)) ||
                Boolean(pinEntry) ||
                (supportedPin?.kind === "proven" && supportedPin.complete) ||
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
            // Material recovered in one cooperative PV does not establish
            // compensation for an offer. Specific material preparations are
            // supplied by their own certificates above. A generic sacrifice
            // is retained only at an independently verified mating root;
            // later offers are checked in their own timeline position.
            const localMate =
                proposal.ply === 1
                    ? checkingMate || quietMate || preparation
                    : proveShortCheckingMate(step) ||
                      proveCheckingMate(episode.slice(proposal.ply - 1)) ||
                      proveQuietMateThreat(step) ||
                      quietPreparation(episode.slice(proposal.ply - 1));
            sound = Boolean(localMate) && exchangeGain > -VALUE.king && exchangeGain <= -90;
            if (sound)
                proposal = {
                    ...proposal,
                    value: 10000,
                    evidence: `${step.san} offers the ${step.after.board.get(step.move.to)!.role} on ${makeSquare(step.move.to)} as part of an independently verified forced mating attack.`,
                };
        } else sound = mate || settled >= 100;
        if (!sound) continue;
        if (proposal.id === "capturingDefender") {
            const verified = capturedDefenderEvidence(step, proposal.source);
            if (verified) proposal = { ...proposal, ...verified, ply: proposal.ply };
        }
        if (!mate && supportedPin?.kind === "proven" && supportedPin.complete)
            proposal = { ...proposal, value: supportedPin.gain };
        if (pinEntry) proposal = { ...proposal, value: pinEntry.gain };
        // A later reinforcement may originate in the legacy PV proposals.
        // Keep its independently verified explanation, not a generic sentence
        // about the pinned piece being unable to capture the arriving attacker.
        if (proposal.id === "pin" && proveReinforcedPin(step)) {
            const reinforced = rayMaterialEvidence(step, proposal.source).find(
                (m) => m.id === "pin",
            );
            if (reinforced) {
                candidates.push({ ...reinforced, ply: proposal.ply });
                continue;
            }
        }
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
            const capture =
                proposal.id === "pin" ? pinnedCaptureEvidence(step, proposal.source) : null;
            if (capture) proposal = { ...proposal, ...capture, ply: proposal.ply };
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
        if (pinEntry) {
            proposal = {
                ...proposal,
                evidence: `${proposal.evidence} ${pinEntry.branches.map((branch) => `After ${branch.reply}, ${branch.preparation} attacks the ${branch.targetRole} on ${makeSquare(branch.target)} and enables ${branch.mate}.`).join(" ")} Every legal reply then concedes verified material or that mate; the later attack is a continuation, not a fork on this move.`,
            };
        }
        candidates.push({
            ...proposal,
            confidence:
                proposal.id === "fork" ||
                proposal.id === "capturingDefender" ||
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
    const countercapture = candidates.some((m) => m.id === "hangingPiece" && m.ply === 1)
        ? compensatedLooseCapture(root)
        : null;
    const normalizedCandidates = normalizeMatingPayoffs(
        steps,
        candidates.flatMap((m) => {
            if (!countercapture || m.id !== "hangingPiece" || m.ply !== 1) return [m];
            // A proved compensation capture is still useful in a combination's
            // continuation, but it is not a free-piece win. Only replay-matching
            // history and its own combination certificate may retain that label.
            return filterCompensatedRootCaptures(
                fen,
                line,
                [m],
                context?.previousFen,
                context?.previousMoveUci,
            ).filter((entry) => entry.label === "Countercapture");
        }),
    );
    // A fork/skewer in a proved mate must not turn an irrelevant attacked piece into a
    // second lesson. Only suppress it when the SAME legal mating continuation
    // has an all-defence proof after removing the non-king fork victims or
    // rear skewer targets.
    // This board probe is not a playable variation. Exhaustion or a capture
    // of a removed victim leaves the motif intact; a mating PV alone is not proof.
    const incidentalMatingMechanisms = new Set<string>();
    for (const kind of ["fork", "skewer"]) {
        if (!checkingMate || !candidates.some((m) => m.id === kind && m.ply === 1)) continue;
        const victims =
            kind === "fork"
                ? winningTargets(root.after, root.move.to, attacker).filter(
                      (sq) => root.after.board.get(sq)?.role !== "king",
                  )
                : relevantRayTactics(root)
                      .filter(
                          (ray) =>
                              ray.kind === "skewer" &&
                              root.after.board.get(ray.front)?.role === "king",
                      )
                      .map((ray) => ray.rear);
        if (victims.length) {
            const probe = root.before.clone();
            for (const square of victims) probe.board.take(square);
            const replay = replayTacticalLine(
                makeFen(probe.toSetup()),
                steps.map((s) => s.uci),
            );
            if (replay.length === steps.length && proveCheckingMate(replay, 4096))
                incidentalMatingMechanisms.add(kind);
        }
    }
    const specificMate = normalizedCandidates.find((m) => /Mate$/.test(m.id));
    const fork = candidates.find((m) => m.id === "fork");
    const filtered = normalizedCandidates
        .filter((m) => {
            if (incidentalMatingMechanisms.has(m.id) && m.ply === 1) return false;
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
            // A stronger jointly verified discovery subsumes a smaller trap
            // on one of its actual targets. Do not let the taxonomy's rank
            // replace the complete two-piece attack with its lesser payoff.
            // Equal gains and unrelated victims retain their separate lesson.
            if (m.id === "trappedPiece" && m.ply) {
                const discovery = candidates.find(
                    (other) =>
                        DISCOVERED_THEMES.has(other.id) &&
                        other.ply === m.ply &&
                        other.confidence === "high" &&
                        (other.value ?? 0) > (m.value ?? Infinity),
                );
                if (discovery) {
                    const step = steps[m.ply - 1];
                    const trap = trappedPieceProof(step, m.source);
                    const proof = discoveredEvidence(steps.slice(m.ply - 1), discovery.source);
                    if (trap && proof?.targets.includes(trap.target)) return false;
                }
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
            // A capture starting an independently proved forced mate is not
            // also a generic material-win lesson. This applies only at the
            // current root: later material gains and specific mechanisms
            // (removing a defender, interference, etc.) remain distinct.
            // A mate tag or cooperating PV without this proof cannot hide it.
            if (m.id === "hangingPiece" && checkingMate && m.ply === 1) return false;
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
    // Do not displace an independently verified winning mechanism with a draw.
    // A lone capture in an engine-equal position with material still missing
    // may instead be the entry to a perpetual. A draw is not a material gain.
    const rootMaterial = [...steps[0].after.board.occupied].reduce((sum, square) => {
        const piece = steps[0].after.board.get(square)!;
        return sum + (piece.color === attacker ? 1 : -1) * VALUE[piece.role];
    }, 0);
    const onlyDrawingCapture =
        typeof rootCp === "number" &&
        Math.abs(rootCp) <= 50 &&
        filtered.every((motif) => motif.id === "hangingPiece" && motif.ply === 1);
    const perpetual =
        (!filtered.length || onlyDrawingCapture) &&
        rootMaterial <= -100 &&
        !(typeof rootCp === "number" && rootCp > 100)
            ? provePerpetualCheck(steps)
            : null;
    if (perpetual) {
        if (onlyDrawingCapture) filtered.splice(0);
        filtered.push({
            id: "perpetualCheck",
            label: "Perpetual Check",
            source: proposals[0]?.source ?? "available",
            confidence: "high",
            ply: 1,
            moveUci: steps[0].uci,
            value: 0,
            evidence: `${steps[0].san} can force at least a draw through repeated checks. Every legal defence was checked; one verified continuation is ${perpetual.line.join(" ")}. The cycle ${perpetual.cycle.join(" ")} returns to the same position and can be repeated until a draw is claimable. This is an available drawing resource, not a draw already claimed or a material win.`,
        });
    }
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
            const proof = rayMaterialProof(step, ray);
            if (proof.kind !== "proven" && proof.kind !== "forcing") continue;
            if ("checkingLine" in proof || "blockingProof" in proof) {
                // A block can refute an immediate capture without refuting
                // this longer checking continuation. Re-prove the same ray;
                // a failed or smaller lower-bound proof cannot certify safety
                // or reduced severity under the alternative move.
                const sameRay = relevantRayTactics(alternative).find(
                    (other) =>
                        other.kind === ray.kind &&
                        other.pinner === ray.pinner &&
                        other.front === ray.front &&
                        other.rear === ray.rear &&
                        [ray.pinner, ray.front, ray.rear].every((square) => {
                            const piece = step.after.board.get(square);
                            const otherPiece = alternative.after.board.get(square);
                            return (
                                piece?.role === otherPiece?.role &&
                                piece?.color === otherPiece?.color
                            );
                        }),
                );
                const otherProof = sameRay ? rayMaterialProof(alternative, sameRay) : null;
                return otherProof?.kind === "proven" && otherProof.gain >= proof.gain
                    ? {
                          comparison: "persists" as const,
                          comparisonEvidence: `After ${better[0].san}, the same ${alternative.san} skewer still has a verified continuation against every legal defence, including blocks.`,
                      }
                    : null;
            }
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
            const proof = rayMaterialProof(step, ray);
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
        if (gain === null) gain = proveExchangeForPawnFork(step)?.gain ?? null;
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
    return gain !== null &&
        gain >= (motif.id === "fork" ? 70 : 100) &&
        gain < 10000 &&
        targets.length
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

/** A severity comparison needs completed immediate exchange leaves, not
 * merely a lower bound from an extended discovered-attack proof. Include
 * every original target and slider; equal values on different victims do
 * not certify the same danger. User-move captures are excluded by the caller. */
function checkingDiscoveryExchange(step: TacticalReplayStep) {
    if (!step.after.isCheck() || step.move.promotion || step.before.isCheck()) return null;
    const discovery = discoveredEvidence([step], "available");
    if (!discovery || discovery.motif.id !== "discoveredAttack") return null;
    const capturers = [...new Set([...discovery.rays.map((ray) => ray.from), step.move.to])];
    const proof = materialThreatProof(step, discovery.targets, capturers);
    if (proof.kind !== "proven" || !proof.complete || proof.gain >= 10000) return null;
    const participant = (square: Square) => {
        const piece = step.after.board.get(square)!;
        return `${square}:${piece.color}:${piece.role}`;
    };
    const identity = JSON.stringify([
        discovery.rays.map((ray) => `${participant(ray.from)}>${participant(ray.target)}`).sort(),
        discovery.targets.map(participant).sort(),
        participant(step.move.to),
    ]);
    return { proof, identity };
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
        } else if (
            motif.id === "discoveredAttack" &&
            step.after.isCheck() &&
            alternative.after.isCheck() &&
            !actual[0].capture &&
            !better[0].capture
        ) {
            const original = checkingDiscoveryExchange(step);
            const other = checkingDiscoveryExchange(alternative);
            if (original && other && original.identity === other.identity) {
                if (other.proof.gain >= original.proof.gain) {
                    comparison = "persists";
                    comparisonEvidence = `After ${bestSan}, ${alternative.san} still uncovers the same material attack with check and at least the same verified immediate exchange gain.`;
                } else {
                    comparison = "reduced";
                    comparisonEvidence = `After ${bestSan}, ${alternative.san} still uncovers the same material attack with check, but ${other.proof.defence} limits its immediate exchange gain to ${(other.proof.gain / 100).toFixed(1)} pawns rather than ${(original.proof.gain / 100).toFixed(1)} after ${actual[0].san}. Initial captures and legal recaptures are included. This compares the local checking-discovery exchange, not the full position's evaluation.`;
                }
            }
        } else if (
            motif.id === "discoveredAttack" &&
            !step.capture &&
            !step.after.isCheck() &&
            revealedRays(step).length > 0 &&
            revealedRays(alternative).length === 0
        ) {
            const defence = quietMaterialDefence(alternative);
            if (defence) {
                comparison = "prevented";
                comparisonEvidence = `After ${bestSan}, ${alternative.san} no longer uncovers an attack on an enemy piece. ${defence} answers the remaining immediate threats; legal captures, a defender exchange and checking forks do not force a local material gain. This prevents this discovered-attack mechanism, not every possible later combination.`;
            }
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
        } else if (
            motif.id === "forcingAttack" &&
            step.after.isCheck() &&
            !proveMixedCheckingAttack(step)
        ) {
            const escape = checkingAttackerCaptureEscape(alternative);
            if (escape) {
                comparison = "prevented";
                comparisonEvidence = `After ${bestSan}, ${alternative.san} is not check and ${escape.defence} captures the attacking ${alternative.after.board.get(alternative.move.to)!.role} on ${makeSquare(alternative.move.to)}. Legal immediate replies, recaptures and one countercheck cannot erase the local material gain. This refutes this checking sequence, not every possible later attack.`;
            }
        } else if (motif.id === "clearance" && !step.capture && step.after.isCheck()) {
            const escape = clearanceKingDefence(alternative);
            if (escape) {
                comparison = "prevented";
                comparisonEvidence = `${alternative.after.isCheck() ? `After ${bestSan}, ${escape.defence} answers ${alternative.san}.` : `After ${bestSan}, ${alternative.san} is not check, so ${escape.defence} lets the king escape before the cleared slider routes are used.`} Each of the ${escape.routes.length} newly opened routes has a legal defence against the immediate captures and checking continuation. This prevents this forcing clearance, not every possible later quiet combination.`;
            }
        } else if (motif.id === "doubleThreat" && proveQuietDoubleThreat(step)) {
            const escape = counterCaptureMaterialDefence(alternative);
            if (escape) {
                comparison = "prevented";
                comparisonEvidence = `After ${bestSan}, ${escape.defence} answers ${alternative.san} with a countercapture. Including that captured material and legal recaptures, the immediate threats cannot force a pawn's worth of material gain.${escape.checkingDefences.length ? ` The immediate checks have concrete answers: ${escape.checkingDefences.join("; ")}.` : ""} This prevents this local winning double threat, not every possible later combination or positional loss.`;
            }
        } else if (motif.id === "forkPreparation") {
            const capture = proveCaptureForkPreparation(step);
            const acceptance =
                capture &&
                !capture.branches.some((branch) => branch.quietForkGuard) &&
                capturePreparationAcceptanceDefence(alternative);
            if (acceptance) {
                const relevantCheck =
                    acceptance.checkingDefences.find((line) =>
                        capture?.branches.some((branch) => line.startsWith(`${branch.answer} `)),
                    ) ?? acceptance.checkingDefences[0];
                comparison = "prevented";
                comparisonEvidence = `After ${bestSan}, ${acceptance.defence} answers ${alternative.san} by accepting the offer. Including the initial capture and legal recaptures, immediate captures and up to two further checks cannot force a net material gain for the attacker.${relevantCheck ? ` One checked defence is ${relevantCheck}.` : ""} This refutes this local fork preparation, not every possible later quiet combination.`;
            }
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
            const quietPawn = !immediateFork(step) && proveQuietPawnFork(step);
            if (quietPawn) {
                // A failed shallow material exchange cannot refute a longer
                // pawn recovery. Only a fresh matching proof establishes persistence.
                const other = proveQuietPawnFork(alternative);
                return other &&
                    other.targets.join(",") === quietPawn.targets.join(",") &&
                    other.gain >= quietPawn.gain
                    ? {
                          ...motif,
                          comparison: "persists" as const,
                          comparisonEvidence: `The same pawn fork remains available after ${bestSan}, with at least the same verified local material gain.`,
                      }
                    : motif;
            }
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
                    const original =
                        proveExchangeForPawnFork(step) ??
                        materialThreatProof(step, actualTargets, [step.move.to]);
                    const other =
                        proveExchangeForPawnFork(alternative) ??
                        materialThreatProof(alternative, targets, [alternative.move.to]);
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

/** Positive quiet defence to immediate material threats. Enumerate captures
 * through a defender exchange, with settled exchange leaves; checking forks
 * must have an explicit non-checking material refutation. Other checks abstain.
 * The caller must independently establish that the original mechanism vanished. */
export function quietMaterialDefence(root: TacticalReplayStep, nodeLimit = 8192): string | null {
    if (
        !Number.isFinite(nodeLimit) ||
        nodeLimit <= 0 ||
        root.capture ||
        root.move.promotion ||
        root.after.isCheck() ||
        root.after.isEnd()
    )
        return null;
    let nodes = nodeLimit;
    const visit = (pos: Chess, move: NormalMove) => {
        if (--nodes < 0) throw new Error("Quiet defence budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const delta = (pos: Chess, move: NormalMove) =>
        capturedValue(pos, move) + (move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0);
    const safe = (pos: Chess, balance: number, exchanges: number): boolean => {
        if (pos.isEnd() || balance >= 100) return false;
        for (const move of legalMoves(pos)) {
            const next = visit(pos, move);
            if (next.isEnd()) return false;
            const capture = delta(pos, move);
            if (!capture && !next.isCheck()) continue;
            if (!capture) {
                if (balance > 0) return false;
                const targets = winningTargets(next, move.to, pos.turn);
                if (
                    targets.length < 2 ||
                    !targets.some((sq) => next.board.get(sq)?.role === "king")
                )
                    return false;
                const step: TacticalReplayStep = {
                    before: pos,
                    after: next,
                    move,
                    uci: makeUci(move),
                    san: makeSan(pos, move),
                    capture: 0,
                    balance: 0,
                };
                const proof = materialThreatProof(step, targets, [move.to]);
                if (proof.kind !== "refuted" || proof.checking) return false;
                continue;
            }
            if (!exchanges) {
                const gain = tacticalExchangeGain(pos, move);
                if (gain <= -VALUE.king || balance + gain >= 100) return false;
                continue;
            }
            let answered = false;
            for (const recapture of legalMoves(next)) {
                if (recapture.to !== move.to || !capturedValue(next, recapture)) continue;
                const after = visit(next, recapture);
                if (after.isCheck()) continue;
                if (safe(after, balance + capture - delta(next, recapture), exchanges - 1)) {
                    answered = true;
                    break;
                }
            }
            if (!answered) return false;
        }
        return true;
    };
    try {
        for (const move of legalMoves(root.after)) {
            if (capturedValue(root.after, move) || move.promotion) continue;
            const next = visit(root.after, move);
            if (next.isCheck() || next.isEnd()) continue;
            if (safe(next, 0, 2)) return makeSan(root.after, move);
        }
    } catch {
        return null;
    }
    return null;
}

/** A formerly checking clearance may be answered by a king escape before the
 * newly opened slider routes are used. Verify each such route independently. */
export function clearanceKingDefence(
    root: TacticalReplayStep,
    nodeLimit = 32768,
): { defence: string; routes: { preparation: string; reply: string }[] } | null {
    if (
        !Number.isFinite(nodeLimit) ||
        nodeLimit <= 0 ||
        root.capture ||
        root.move.promotion ||
        root.before.isCheck() ||
        root.after.isEnd()
    )
        return null;
    let nodes = nodeLimit;
    const attackMemo = new Map<string, boolean>();
    const defenceMemo = new Map<string, string | null>();
    const visit = (pos: Chess, move: NormalMove) => {
        if (--nodes < 0) throw new Error("Clearance defence budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const delta = (pos: Chess, move: NormalMove) =>
        capturedValue(pos, move) + (move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0);
    const safeAttack = (pos: Chess, balance: number, checks: number): boolean => {
        if (pos.isEnd() || balance >= 90) return false;
        const key = `${makeFen(pos.toSetup())}:${balance}:${checks}`;
        if (attackMemo.has(key)) return attackMemo.get(key)!;
        for (const move of legalMoves(pos)) {
            const next = visit(pos, move);
            if (next.isCheckmate()) {
                attackMemo.set(key, false);
                return false;
            }
            if (delta(pos, move)) {
                const gain = tacticalExchangeGain(pos, move);
                if (gain <= -VALUE.king || balance + gain >= 90) {
                    attackMemo.set(key, false);
                    return false;
                }
            }
            if (!next.isCheck()) continue;
            // A surviving check at the frontier is inconclusive, never an
            // inferred escape merely because the search stopped looking.
            if (!checks || !safeDefence(next, balance + delta(pos, move), checks - 1)) {
                attackMemo.set(key, false);
                return false;
            }
        }
        attackMemo.set(key, true);
        return true;
    };
    const safeDefence = (pos: Chess, balance: number, checks: number): string | null => {
        const key = `${makeFen(pos.toSetup())}:${balance}:${checks}`;
        if (defenceMemo.has(key)) return defenceMemo.get(key)!;
        for (const reply of legalMoves(pos)) {
            const next = visit(pos, reply);
            if (next.isCheck() || next.isEnd()) continue;
            if (safeAttack(next, balance - delta(pos, reply), checks)) {
                const san = makeSan(pos, reply);
                defenceMemo.set(key, san);
                return san;
            }
        }
        defenceMemo.set(key, null);
        return null;
    };
    try {
        for (const flight of legalMoves(root.after)) {
            if (
                root.after.board.get(flight.from)?.role !== "king" ||
                capturedValue(root.after, flight)
            )
                continue;
            const next = visit(root.after, flight);
            if (next.isCheck() || !safeAttack(next, 0, 4)) continue;
            const candidates = legalMoves(next).filter((move) => {
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
            });
            if (!candidates.length) continue;
            const routes: { preparation: string; reply: string }[] = [];
            for (const move of candidates) {
                const after = visit(next, move);
                const reply = safeDefence(after, 0, 4);
                if (!reply) break;
                routes.push({ preparation: makeSan(next, move), reply });
            }
            if (routes.length === candidates.length)
                return { defence: makeSan(root.after, flight), routes };
        }
    } catch {
        return null;
    }
    return null;
}

/** Positive local defence starting with a countercapture. Enumerate all immediate
 * captures through two legal recapture rounds, then use bounded exchange leaves.
 * Non-capturing checks require a real non-checking reply whose every recovery
 * capture stays below the material threshold. Carry the original compensation
 * through those leaves; named fork victims alone miss captures of the forker's
 * captor. Optional equal-recapture credit is supplied only after validating the
 * actual preceding capture. The separate capture-offset mode counts the
 * current root capture without prior exchange credit and requires an
 * off-square, non-checking defensive capture. Quiet preparations and longer checks are outside
 * this local witness; failure cannot establish either safety or a tactical win. */
export function counterCaptureMaterialDefence(
    root: TacticalReplayStep,
    nodeLimit = 8192,
    previousCaptureCost = 0,
    captureOffsetMode = false,
): { defence: string; defenceUci: string; checkingDefences: string[] } | null {
    if (
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0 ||
        (!captureOffsetMode && root.capture !== previousCaptureCost) ||
        (captureOffsetMode && (!root.capture || previousCaptureCost !== 0)) ||
        !Number.isSafeInteger(previousCaptureCost) ||
        previousCaptureCost < 0 ||
        root.move.promotion ||
        root.after.isCheck() ||
        root.after.isEnd()
    )
        return null;
    let nodes = nodeLimit;
    const visit = (pos: Chess, move: NormalMove) => {
        if (--nodes < 0) throw new Error("Countercapture defence budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const delta = (pos: Chess, move: NormalMove) =>
        capturedValue(pos, move) + (move.promotion ? VALUE[move.promotion] - VALUE.pawn : 0);
    const safe = (pos: Chess, balance: number, rounds: number): string[] | null => {
        if (pos.isEnd() || balance >= 100) return null;
        const witnesses: string[] = [];
        for (const move of legalMoves(pos)) {
            const next = visit(pos, move);
            if (next.isEnd()) return null;
            const capture = delta(pos, move);
            if (!capture && !next.isCheck()) continue;
            if (!capture) {
                let answer: string | null = null;
                for (const reply of legalMoves(next)) {
                    const after = visit(next, reply);
                    const remaining = balance - delta(next, reply);
                    if (after.isCheck() || after.isEnd() || remaining >= 100) continue;
                    let resolved = true;
                    for (const recovery of legalMoves(after)) {
                        const leaf = visit(after, recovery);
                        if (leaf.isEnd()) {
                            resolved = false;
                            break;
                        }
                        if (!delta(after, recovery)) continue;
                        const gain = tacticalExchangeGain(after, recovery);
                        if (gain <= -VALUE.king || remaining + gain >= 100) {
                            resolved = false;
                            break;
                        }
                    }
                    if (resolved) {
                        answer = makeSan(next, reply);
                        break;
                    }
                }
                if (!answer) return null;
                if (rounds === 2) witnesses.push(`${makeSan(pos, move)} ${answer}`);
                continue;
            }
            if (!rounds) {
                const gain = tacticalExchangeGain(pos, move);
                if (gain <= -VALUE.king || balance + gain >= 100) return null;
                continue;
            }
            // In the equal-recapture mode, an uncapturable return of the
            // material just lost is not an extra win. Checks still require
            // a real answer; this does not certify later quiet play as safe.
            if (
                (previousCaptureCost || captureOffsetMode) &&
                !next.isCheck() &&
                balance + capture < 100
            )
                continue;
            let answered = false;
            for (const reply of legalMoves(next)) {
                if (reply.to !== move.to || !capturedValue(next, reply)) continue;
                const after = visit(next, reply);
                if (after.isCheck()) continue;
                const branch = safe(after, balance + capture - delta(next, reply), rounds - 1);
                if (branch) {
                    answered = true;
                    break;
                }
            }
            if (!answered) return null;
        }
        return [...new Set(witnesses)];
    };
    try {
        for (const defence of legalMoves(root.after)) {
            if (!capturedValue(root.after, defence) || defence.promotion) continue;
            if (captureOffsetMode && defence.to === root.move.to) continue;
            const next = visit(root.after, defence);
            if (next.isCheck() || next.isEnd()) continue;
            const checkingDefences = safe(
                next,
                root.capture - previousCaptureCost - delta(root.after, defence),
                2,
            );
            if (checkingDefences)
                return {
                    defence: makeSan(root.after, defence),
                    defenceUci: makeUci(defence),
                    checkingDefences,
                };
        }
    } catch {
        return null;
    }
    return null;
}

const compensatedLooseCaptureCache = new Map<
    string,
    ReturnType<typeof counterCaptureMaterialDefence>
>();

/** A free-piece headline must not count only the first capture when a
 * concrete off-square countercapture removes that gain. This is a positive
 * bounded defence, not an inference from an engine score or a failed attack. */
function compensatedLooseCapture(root: TacticalReplayStep) {
    if (!root.capture || root.move.promotion || root.after.isCheck() || root.after.isEnd())
        return null;
    if (
        !legalMoves(root.after).some(
            (move) => move.to !== root.move.to && capturedValue(root.after, move) >= root.capture,
        )
    )
        return null;
    const key = `${makeFen(root.before.toSetup())}:${root.uci}`;
    if (compensatedLooseCaptureCache.has(key)) return compensatedLooseCaptureCache.get(key)!;
    const proof = counterCaptureMaterialDefence(root, 8192, 0, true);
    compensatedLooseCaptureCache.set(key, proof);
    if (compensatedLooseCaptureCache.size > 256)
        compensatedLooseCaptureCache.delete(compensatedLooseCaptureCache.keys().next().value!);
    return proof;
}

/** Accept a capture offer and positively retain its material cost. This is
 * separate from a failed attacking proof: every immediate capture/check is
 * enumerated, checking lines get up to two real non-counterchecking replies,
 * and material-erasing captures require an actual safe same-square recapture.
 * No null move, borrowed SEE recapture, or supplied PV proves the defence. */
export function capturePreparationAcceptanceDefence(
    root: TacticalReplayStep,
    nodeLimit = 8192,
): { defence: string; checkingDefences: string[] } | null {
    if (
        !Number.isSafeInteger(nodeLimit) ||
        nodeLimit <= 0 ||
        !root.capture ||
        root.move.promotion ||
        root.after.isEnd()
    )
        return null;
    let nodes = nodeLimit;
    const visit = (pos: Chess, move: NormalMove) => {
        if (--nodes < 0) throw new Error("Capture acceptance defence budget exhausted");
        const next = pos.clone();
        next.play(move);
        return next;
    };
    const safe = (
        pos: Chess,
        balance: number,
        checks: number,
        recaptures: number,
    ): string[] | null => {
        if (pos.isEnd() || pos.isCheck() || balance > 0) return null;
        const witnesses: string[] = [];
        for (const move of legalMoves(pos)) {
            const next = visit(pos, move);
            if (move.promotion || next.isEnd()) return null;
            const earned = capturedValue(pos, move);
            if (!earned && !next.isCheck()) {
                // Losing the check must not turn an unexamined quiet fork
                // into a safety certificate. Geometric double attacks need
                // a separate defence even when their profitability is unknown.
                const piece = next.board.get(move.to)!;
                const threats = attacks(piece, move.to, next.board.occupied).intersect(
                    next.board[next.turn],
                );
                if (
                    [...threats].filter(
                        (square) => !["king", "pawn"].includes(next.board.get(square)!.role),
                    ).length >= 2
                )
                    return null;
                continue;
            }
            if (next.isCheck()) {
                if (!checks) return null;
                let answers: string[] | null = null;
                for (const reply of legalMoves(next)) {
                    if (reply.promotion) continue;
                    const after = visit(next, reply);
                    const continuation = safe(
                        after,
                        balance + earned - capturedValue(next, reply),
                        checks - 1,
                        recaptures,
                    );
                    if (continuation) {
                        const stem = `${makeSan(pos, move)} ${makeSan(next, reply)}`;
                        answers = continuation.length
                            ? continuation.map((tail) => `${stem} ${tail}`)
                            : [stem];
                        break;
                    }
                }
                if (answers === null) return null;
                witnesses.push(...answers);
                continue;
            }
            // An immediate non-checking capture smaller than the already
            // retained compensation cannot recover the offer on this move.
            if (balance + earned <= 0) continue;
            if (!recaptures) return null;
            let answered = false;
            for (const reply of legalMoves(next)) {
                if (reply.to !== move.to || reply.promotion || !capturedValue(next, reply))
                    continue;
                const after = visit(next, reply);
                if (
                    safe(
                        after,
                        balance + earned - capturedValue(next, reply),
                        checks,
                        recaptures - 1,
                    )
                ) {
                    answered = true;
                    break;
                }
            }
            if (!answered) return null;
        }
        return [...new Set(witnesses)];
    };
    try {
        for (const defence of legalMoves(root.after)) {
            if (
                defence.to !== root.move.to ||
                defence.promotion ||
                !capturedValue(root.after, defence)
            )
                continue;
            const next = visit(root.after, defence);
            const checkingDefences = safe(
                next,
                root.capture - capturedValue(root.after, defence),
                2,
                2,
            );
            if (checkingDefences)
                return { defence: makeSan(root.after, defence), checkingDefences };
        }
    } catch {
        return null;
    }
    return null;
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
