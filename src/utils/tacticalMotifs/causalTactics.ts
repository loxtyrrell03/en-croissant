import { attacks } from "chessops/attacks";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import type { Color, NormalMove, Role, Square } from "chessops/types";
import { makeSquare, opposite, parseUci } from "chessops/util";
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

function winningTargets(pos: Chess, from: Square, side: Color) {
    const probe = withTurn(pos, side);
    const piece = probe.board.get(from);
    if (!piece || piece.color !== side) return [];
    return [
        ...attacks(piece, from, probe.board.occupied).intersect(probe.board[opposite(side)]),
    ].filter((to) => {
        const target = probe.board.get(to)!;
        if (target.role === "king") return true;
        return target.role !== "pawn" && tacticalExchangeGain(probe, { from, to }) >= 100;
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
    return winningTargets(step.after, step.move.to, step.before.turn).length > 0;
}

export function hasTacticalStart(fen: string, line: string[]) {
    const root = replayTacticalLine(fen, line.slice(0, 1))[0];
    return Boolean(
        root &&
        (root.capture || root.move.promotion || root.after.isCheck() || hasConcreteThreat(root)),
    );
}

function episodeEnd(steps: TacticalReplayStep[]) {
    for (let i = 0; i < steps.length; i += 2) {
        const step = steps[i];
        if (
            !step.capture &&
            !step.move.promotion &&
            !step.after.isCheck() &&
            !hasConcreteThreat(step)
        )
            return i;
    }
    return steps.length;
}

function causeRank(motif: TacticalMotifEvidence) {
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
        "intermezzo",
        "doubleCheck",
        "discoveredCheck",
        "discoveredAttack",
        "clearance",
        "xRayAttack",
    ];
    const family = MECHANISMS.has(motif.id) ? 0 : MATE.test(motif.id) ? 1 : 2;
    return (
        family * 1000 + (motif.ply ?? 100) * 20 + Math.max(0, mechanismPriority.indexOf(motif.id))
    );
}

export function auditTacticalMotifs(
    fen: string,
    line: string[],
    proposals: TacticalMotifEvidence[],
) {
    const steps = replayTacticalLine(fen, line);
    if (!steps.length) return [];
    const end = episodeEnd(steps);
    if (!end) return [];
    const episode = steps.slice(0, end);
    const attacker = steps[0].before.turn;
    const final = episode.at(-1)!;
    if (final.after.isCheckmate() && final.before.turn !== attacker) return [];
    const mate = final.after.isCheckmate() && final.before.turn === attacker;
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
                    evidence: `${bait.san} offers the ${bait.before.board.get(bait.move.from)!.role} on ${makeSquare(bait.move.to)}. After ${episode[anchor + 1].san}, ${final.san} delivers mate.`,
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
            const ctx = step.after.ctx();
            const pinnedRecapturer = [...step.after.board[step.after.turn]].some((from) => {
                const piece = step.after.board.get(from)!;
                return (
                    ctx.blockers.has(from) &&
                    attacks(piece, from, step.after.board.occupied).has(step.move.to) &&
                    !step.after.isLegal({ from, to: step.move.to })
                );
            });
            if (!pinnedRecapturer) continue;
        }
        if (proposal.id === "deflection") {
            const reply = episode[proposal.ply];
            const defender = reply?.before.board.get(reply.move.from);
            const payoff = episode
                .slice(proposal.ply + 1)
                .find((s) => s.before.turn === attacker && s.capture >= 320);
            const victim = payoff?.before.board.get(payoff.move.to);
            if (
                reply &&
                defender &&
                payoff &&
                victim &&
                attacks(defender, reply.move.from, reply.before.board.occupied).has(
                    payoff.move.to,
                ) &&
                !attacks(defender, reply.move.to, reply.after.board.occupied).has(payoff.move.to)
            ) {
                proposal = {
                    ...proposal,
                    evidence: `In this line, ${step.san} draws the ${defender.role} from ${makeSquare(reply.move.from)} to ${makeSquare(reply.move.to)}, leaving the ${victim.role} on ${makeSquare(payoff.move.to)} without that defender. ${payoff.san} wins it.`,
                };
            }
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
        else if (proposal.id === "attackingF2F7")
            sound = step.capture > 0 && tacticalExchangeGain(step.before, step.move) >= 100;
        else if (proposal.id === "hangingPiece")
            sound = step.capture >= 320 && tacticalExchangeGain(step.before, step.move) >= 100;
        else if (proposal.id === "attacking_undefended_piece")
            sound = hasConcreteThreat(step) && settled >= 100;
        else sound = mate || settled >= 100;
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
            if (specificMate && /^mate(?:In\d+)?$/.test(m.id)) return false;
            if (
                fork?.ply === m.ply &&
                ["clearance", "trappedPiece", "attacking_undefended_piece"].includes(m.id)
            )
                return false;
            if (
                m.id === "sacrifice" &&
                candidates.some((other) => MECHANISMS.has(other.id) && other.ply === m.ply)
            )
                return false;
            return true;
        })
        .sort((a, b) => causeRank(a) - causeRank(b));
    const immediateLoose = filtered.find((m) => m.id === "hangingPiece" && m.ply === 1);
    if (immediateLoose && !filtered.some((m) => MECHANISMS.has(m.id) && m.ply === 1)) {
        filtered.splice(filtered.indexOf(immediateLoose), 1);
        filtered.unshift(immediateLoose);
    }
    // A sound exchange at the start of a combination is not a loose piece if
    // its gain depends on a later mechanism (the defender can recapture).
    return filtered.map((motif, index) => ({
        ...motif,
        relevance: index === 0 ? ("primary" as const) : ("secondary" as const),
        value: mate
            ? 10000
            : motif.id === "hangingPiece" && motif.ply === 1
              ? tacticalExchangeGain(root.before, root.move)
              : Math.max(100, settled),
    }));
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
        } else if (MATE.test(motif.id) && step.after.isCheckmate()) {
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
