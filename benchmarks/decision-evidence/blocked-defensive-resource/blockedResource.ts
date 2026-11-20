import { between } from "chessops/attacks";
import type { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import type { Color, Square } from "chessops/types";
import { makeSquare, opposite } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import type { TacticalGameHistory } from "./gameHistory";
import {
    advanceTacticalRepetitionContext,
    readTacticalRepetitionContext,
    tacticalRepetitionClaim,
} from "./repetitionHistory";
import type { DecisionTacticalRecovery } from "./decisionTacticalRecovery";

const HORIZON = 12;
const MIN_CONTRAST = 90;
type Point = { fen: string; prefix: string[] };

export type BlockedResourceRequest = {
    better: Point;
    played: Point;
    resource: string;
    resourceSan: string;
    playedSan: string;
    betterSan: string;
    replySan: string[];
    blocker: { square: Square; role: string; kind: "landing" | "ray" };
    betterCp: number;
    playedCp: number;
};

export type BlockedResourceSearches = {
    better: DecisionEngineLine[];
    played: DecisionEngineLine[];
};

function samePiece(a: Chess, b: Chess, square: Square) {
    const left = a.board.get(square);
    const right = b.board.get(square);
    return left?.color === right?.color && left?.role === right?.role;
}

function noDraw(fen: string, line: string[], history?: TacticalGameHistory) {
    if (!history) return true;
    let context = readTacticalRepetitionContext(fen, history);
    for (const uci of line) {
        if (!context || tacticalRepetitionClaim(context) || context.endedAtPly !== undefined) return false;
        context = advanceTacticalRepetitionContext(context, uci);
    }
    return Boolean(context && !tacticalRepetitionClaim(context));
}

function blockage(better: TacticalReplayStep, played: Chess, occupied: Square) {
    const { move, before } = better;
    const moving = before.board.get(move.from);
    if (!moving || !samePiece(before, played, move.from)) return null;
    if (move.to === occupied && played.board.get(occupied)?.color === played.turn) {
        const shadow = played.clone();
        shadow.board.take(occupied);
        return shadow.isLegal(move) ? "landing" : null;
    }
    if (moving.role !== "rook" && moving.role !== "bishop" && moving.role !== "queen") return null;
    const blockers = between(move.from, move.to).intersect(played.board.occupied);
    if (!blockers.has(occupied) || blockers.size() !== 1) return null;
    const shadow = played.clone();
    shadow.board.take(occupied);
    return shadow.isLegal(move) ? "ray" : null;
}

function checkedReply(fen: string, choice: DecisionEngineLine, reply: DecisionEngineLine) {
    const measured = measureDecisionLine(fen, reply);
    return reply.cp !== null && reply.mate == null && reply.depth >= 16 &&
        choice.cp !== null && Math.abs(choice.cp + reply.cp) <= 120 &&
        measured && !measured.drawnEnding;
}

/** Nominate an exact comparison from a searched line. The played path is
 * inspected only while the same legal moves remain available on both boards. */
export function nominateBlockedResources(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    betterReplies: DecisionEngineLine[],
    playedReplies: DecisionEngineLine[],
    history?: TacticalGameHistory,
): BlockedResourceRequest[] {
    const lead = betterReplies[0];
    const opponent = playedReplies[0];
    if (
        better.cp === null || played.cp === null || better.mate != null || played.mate != null ||
        better.depth !== played.depth || better.depth < 16 ||
        better.cp - played.cp < MIN_CONTRAST ||
        !lead || !opponent || lead.cp === null || opponent.cp === null || opponent.cp - lead.cp < 70
    )
        return [];
    const [bestRoot] = replayTacticalLine(fen, better.pvUci.slice(0, 1));
    const [badRoot] = replayTacticalLine(fen, played.pvUci.slice(0, 1));
    if (!bestRoot || !badRoot || bestRoot.uci === badRoot.uci || badRoot.move.promotion) return [];
    const occupant = badRoot.before.board.get(badRoot.move.from);
    const occupied = badRoot.move.to;
    if (!occupant || occupant.role === "king" ||
        !checkedReply(makeFen(bestRoot.after.toSetup()), better, lead) ||
        !checkedReply(makeFen(badRoot.after.toSetup()), played, opponent)) return [];
    const paths = [better.pvUci.slice(1), ...betterReplies.filter(
        (reply) => reply.cp !== null && reply.depth === lead.depth && lead.cp! - reply.cp >= 0 &&
            lead.cp! - reply.cp <= 60 && checkedReply(makeFen(bestRoot.after.toSetup()), better, reply),
    ).map((reply) => reply.pvUci)];
    const results: BlockedResourceRequest[] = [];
    const seen = new Set<string>();
    for (const path of paths) {
        const prefix = path.slice(0, 9);
        const good = replayTacticalLine(fen, [bestRoot.uci, ...prefix]);
        const bad = replayTacticalLine(fen, [badRoot.uci, ...prefix]);
        const blockedAt = bad.length;
        const action = good[blockedAt];
        if (!action || blockedAt < 2 || blockedAt % 2 !== 0) continue;
        const reached = bad[blockedAt - 1].after;
        if (bad.slice(1).some((step, i) =>
            step.move.from === occupied || step.move.to === occupied ||
            step.uci !== good[i + 1].uci ||
            !samePiece(step.before, good[i + 1].before, step.move.from) ||
            !samePiece(step.before, good[i + 1].before, step.move.to) ||
            step.capture !== good[i + 1].capture
        )) continue;
        if (!samePiece(reached, badRoot.after, occupied) || reached.isEnd()) continue;
        const kind = blockage(action, reached, occupied);
        if (!kind) continue;
        const goodPrefix = good.slice(0, blockedAt).map((step) => step.uci);
        const badPrefix = bad.map((step) => step.uci);
        if (!noDraw(fen, goodPrefix, history) || !noDraw(fen, badPrefix, history)) continue;
        const entry = {
            better: { fen: makeFen(action.before.toSetup()), prefix: goodPrefix },
            played: { fen: makeFen(reached.toSetup()), prefix: badPrefix },
            resource: action.uci,
            resourceSan: action.san,
            playedSan: badRoot.san,
            betterSan: bestRoot.san,
            replySan: good.slice(1, blockedAt).map((step) => step.san),
            blocker: { square: occupied, role: occupant.role, kind },
            betterCp: better.cp,
            playedCp: played.cp,
        } satisfies BlockedResourceRequest;
        const key = JSON.stringify([entry.better.fen, entry.played.fen, entry.resource]);
        if (!seen.has(key)) results.push(entry);
        seen.add(key);
    }
    return results;
}

function score(line: DecisionEngineLine) {
    return line.mate != null ? (line.mate > 0 ? 8000 : -8000) : line.cp;
}

function events(steps: TacticalReplayStep[], defender: Color) {
    const origins = new Map([...steps[0].before.board].map(([square]) => [square, square]));
    const promotions = new Map<Square, { ply: number; san: string }>();
    const lost = new Map<Square, { ply: number; san: string }>();
    steps.forEach(({ before, move, capture, san }, index) => {
        const onTurn = before.turn;
        const from = origins.get(move.from);
        const target = origins.get(move.to);
        const victim = before.board.get(move.to);
        if (onTurn !== defender && from !== undefined && move.promotion)
            promotions.set(from, { ply: index + 1, san });
        if (onTurn !== defender && capture && target !== undefined && victim?.role !== "pawn")
            lost.set(target, { ply: index + 1, san });
        if (capture && before.epSquare === move.to && before.board.get(move.from)?.role === "pawn")
            origins.delete((move.to + (onTurn === "white" ? -8 : 8)) as Square);
        origins.delete(move.from);
        origins.delete(move.to);
        if (from !== undefined) origins.set(move.to, from);
    });
    return { promotions, lost };
}

function consequence(
    branches: TacticalReplayStep[][],
    lines: DecisionEngineLine[],
) {
    const [good, bad, control] = branches;
    const defender = good[0].before.turn;
    const forms = branches.map((branch) => events(branch, defender));
    const limit = Math.min(...branches.map((steps) => steps.length));
    for (const [origin, promotion] of forms[1].promotions) {
        const other = forms[2].promotions.get(origin);
        if (!other || forms[0].promotions.has(origin) || !samePiece(good[0].before, bad[0].before, origin))
            continue;
        if (good[0].before.board.get(origin)?.color !== opposite(defender)) continue;
        return {
            through: Math.max(promotion.ply, other.ply),
            text: `The opposing pawn from ${makeSquare(origin)} promotes in both lines without this defence, with ${promotion.san} after the played move and ${other.san} with the defence excluded.`,
        };
    }
    if ((lines[1].mate ?? 0) < 0 && (lines[2].mate ?? 0) < 0 && (lines[0].mate ?? 0) >= 0)
        return { through: Math.min(limit, 10), text: "Both searches without the defence find a forced mate for the opponent." };
    for (const [origin, loss] of forms[1].lost) {
        const other = forms[2].lost.get(origin);
        if (!other || forms[0].lost.has(origin) || !samePiece(good[0].before, bad[0].before, origin))
            continue;
        const piece = good[0].before.board.get(origin);
        if (!piece || piece.color !== defender) continue;
        for (let end = Math.max(loss.ply, other.ply) + 1; end <= limit; end++) {
            const positions = branches.map((steps) => steps[end - 1]);
            if (positions.some(({ after, balance }, index) =>
                after.isCheck() || balance !== branches[index][end - 2].balance)
            ) continue;
            if (good[end - 1].balance - Math.max(bad[end - 1].balance, control[end - 1].balance) < 90)
                continue;
            return {
                through: end,
                text: `Both lines without this defence give up the ${piece.role} from ${makeSquare(origin)} and retain less material after the exchange.`,
            };
        }
    }
    return null;
}

/** Verify the proposed defence on both reached boards. The runner-up from
 * the stronger MultiPV supplies the line where another move is tried. */
export function verifyBlockedResource(
    root: string,
    request: BlockedResourceRequest,
    probes: BlockedResourceSearches,
    history?: TacticalGameHistory,
): DecisionTacticalRecovery | null {
    const [good, control] = probes.better;
    const [bad] = probes.played;
    if (!good || !control || !bad || good.pvUci[0] !== request.resource ||
        good.depth !== control.depth || good.pvUci[0] === control.pvUci[0] ||
        Math.min(good.depth, control.depth, bad.depth) < 16)
        return null;
    const g = score(good), c = score(control), w = score(bad);
    if (g === null || c === null || w === null || g - Math.max(c,w) < MIN_CONTRAST ||
        Math.abs(g - request.betterCp) > 120 || Math.abs(w - request.playedCp) > 150)
        return null;
    const lines = [good, bad, control];
    const points = [request.better, request.played, request.better];
    if (lines.some((line, index) =>
        !measureDecisionLine(points[index].fen, line) ||
        !noDraw(root, [...points[index].prefix, ...line.pvUci.slice(0, HORIZON)], history)
    )) return null;
    const paths = lines.map((line, index) => replayTacticalLine(
        points[index].fen, line.pvUci.slice(0, HORIZON),
    ));
    if (paths.some((path) => !path.length)) return null;
    const payoff = consequence(paths, lines);
    if (!payoff) return null;
    const { square, role, kind } = request.blocker;
    const landed = kind === "landing" ? "occupies" : "blocks the path through";
    const expanded = (point: Point, path: TacticalReplayStep[]) =>
        [...point.prefix, ...path.slice(0, payoff.through).map((step) => step.uci)];
    return {
        explanation: `After ${request.replySan.join(" ")}, ${request.resourceSan} is available after ${request.betterSan}. After ${request.playedSan}, the ${role} ${landed} ${makeSquare(square)}. ${payoff.text}`,
        betterLineUci: expanded(request.better, paths[0]),
        playedLineUci: expanded(request.played, paths[1]),
        confirmedBetterLineUci: expanded(request.better, paths[2]),
        confirmedPlayedLineUci: [],
    };
}
