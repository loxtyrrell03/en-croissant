import type { Color, Role, Square } from "chessops/types";
import { makeFen } from "chessops/fen";
import { makeSquare, opposite } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import type { PositionStrategicPlan } from "./decisionPositionPlans";
import { tacticalRepetitionKey } from "./repetitionHistory";

const WINDOW = 14;
const MIN_BLOCKADE = 5;
const relativeRank = (square: Square, side: Color) =>
    side === "white" ? 1 + (square >> 3) : 8 - (square >> 3);
const sideName = (side: Color) => (side === "white" ? "White" : "Black");

type Event = { through: number; contextThrough?: number; description: string };
type Promotion = Event & { square: Square; trade?: Event & { role: Role } };
type Trajectory = {
    promotion?: Promotion;
    blockade?: Event;
    removes?: Event;
    advance?: Event;
};

function promotionTrade(steps: TacticalReplayStep[], index: number, square: Square) {
    const take = steps[index + 1];
    const retake = steps[index + 2];
    const reply = steps[index + 3];
    const role = retake?.before.board.get(square)?.role;
    if (
        !take?.capture ||
        !retake?.capture ||
        take.move.to !== square ||
        retake.move.to !== square ||
        !reply ||
        (reply.move.to === square && reply.capture > 0) ||
        !role ||
        role === "pawn" ||
        role === "king"
    )
        return undefined;
    return {
        through: index + 3,
        role,
        description: `${steps[index].san} ${take.san} ${retake.san}`,
    };
}

function immediateCapture(steps: TacticalReplayStep[], i: number, square: Square) {
    const next = steps[i + 1];
    return next?.move.to === square && next.capture > 0 ? next : undefined;
}

/** Keep the starting pawn's identity across captures and promotions. The
 * first adverse occupant of its direct promotion square is a blockade only
 * after it remains there over several moves with the pawn still present. */
export function traceAdvancedPawn(
    steps: TacticalReplayStep[],
    start: Square,
    side: Color,
): Trajectory {
    const result: Trajectory = {};
    let square = start;
    let entry = relativeRank(start, side) === 7 ? 0 : -1;
    let blockade: { first: number; square: Square; role: Role } | undefined;
    for (const [i, step] of steps.entries()) {
        const ply = i + 1;
        if (step.before.turn === side && step.move.from === square) {
            square = step.move.to;
            blockade = undefined;
            if (step.move.promotion) {
                const recapture = immediateCapture(steps, i, square);
                result.promotion = {
                    square,
                    through: ply,
                    contextThrough: recapture ? ply + 1 : ply,
                    description: `${sideName(side)} promotes with ${step.san}${recapture ? ` and faces ${recapture.san}` : ""}`,
                    trade: promotionTrade(steps, i, square),
                };
                break;
            }
            entry = relativeRank(square, side) === 7 ? ply : -1;
        }
        if (!step.after.board.pawn.has(square) || !step.after.board[side].has(square)) {
            const recapture = immediateCapture(steps, i, step.move.to);
            result.removes = {
                through: ply,
                contextThrough: recapture ? ply + 1 : ply,
                description: `${step.san} takes the ${side} pawn${recapture ? ` before ${recapture.san}` : ""}`,
            };
            if (!result.blockade && blockade && ply - blockade.first >= MIN_BLOCKADE - 1) {
                result.blockade = {
                    through: ply,
                    contextThrough: result.removes.contextThrough,
                    description: `${sideName(opposite(side))}'s ${blockade.role} on ${makeSquare(blockade.square)} holds the pawn until ${step.san} takes it${recapture ? ` before ${recapture.san}` : ""}`,
                };
            }
            break;
        }
        if (entry < 0) continue;
        if (entry > 0 && ply === entry + 4) {
            result.advance = {
                through: ply,
                description: `${steps[entry - 1].san} leaves the pawn on ${makeSquare(square)} through ${step.san}`,
            };
        }
        const front = square + (side === "white" ? 8 : -8);
        const blocker = step.after.board.get(front);
        if (!blocker || blocker.color === side) {
            blockade = undefined;
            continue;
        }
        if (
            !blockade ||
            blockade.square !== front ||
            (step.move.to === front && step.move.from !== front)
        )
            blockade = { first: ply, square: front, role: blocker.role };
        if (!result.blockade && ply - blockade.first + 1 >= MIN_BLOCKADE) {
            result.blockade = {
                through: ply,
                description: `${sideName(opposite(side))}'s ${blockade.role} on ${makeSquare(front)} holds the pawn on ${makeSquare(square)} through ${step.san}`,
            };
        }
    }
    return result;
}

function viable(left: DecisionEngineLine, right: DecisionEngineLine) {
    if (left.cp === null || right.cp === null || left.depth !== right.depth) return false;
    return (
        left.cp - right.cp <= 50 ||
        (left.cp >= 350 && right.cp >= 350) ||
        (left.cp <= -350 && right.cp <= -350 && left.cp - right.cp <= 125)
    );
}

function independent(
    a: TacticalReplayStep[],
    b: TacticalReplayStep[],
    left: number,
    right: number,
) {
    const boards = new Set(a.slice(0, left).map((step) => tacticalRepetitionKey(step.after)));
    return !b.slice(0, right).some((step) => boards.has(tacticalRepetitionKey(step.after)));
}

function pair(a: TacticalReplayStep[], b: TacticalReplayStep[], left: Event, right: Event) {
    return [
        a.slice(0, left.contextThrough ?? left.through).map((step) => step.uci),
        b.slice(0, right.contextThrough ?? right.through).map((step) => step.uci),
    ] satisfies PositionStrategicPlan["linesUci"];
}

function describe(root: string, event: Event) {
    return event.description.startsWith(`${root} `)
        ? event.description
        : `After ${root}, ${event.description}`;
}

/** Follow the advanced pawn into a specific exchange after two separate
 * competitive replies. The same promotion reached by a transposition adds
 * no corroboration, and the gain must survive the immediate counterplay. */
export function findPromotionTradeAfterAdvance(
    fen: string,
    root: DecisionEngineLine,
    replies: DecisionEngineLine[],
): PositionStrategicPlan | undefined {
    const [advance] = replayTacticalLine(fen, root.pvUci.slice(0, 1));
    if (
        !advance ||
        advance.before.board.get(advance.move.from)?.role !== "pawn" ||
        relativeRank(advance.move.from, advance.before.turn) !== 6 ||
        relativeRank(advance.move.to, advance.before.turn) !== 7
    )
        return;
    const [leadingReply] = replies;
    const child = makeFen(advance.after.toSetup());
    if (
        !leadingReply ||
        replies.length < 2 ||
        root.depth < 18 ||
        root.cp === null ||
        root.mate != null ||
        leadingReply.depth < 16 ||
        leadingReply.cp === null ||
        leadingReply.mate != null ||
        Math.abs(root.cp + leadingReply.cp) > 90 ||
        !measureDecisionLine(fen, root) ||
        !measureDecisionLine(child, leadingReply)
    )
        return;
    const captures = [];
    for (const reply of replies.slice(0, 3)) {
        if (
            reply.cp === null ||
            reply.mate != null ||
            reply.depth !== leadingReply.depth ||
            reply.cp > leadingReply.cp ||
            leadingReply.cp - reply.cp > 50 ||
            !measureDecisionLine(child, reply)
        )
            continue;
        const maxPromotionPly = 9;
        const steps = replayTacticalLine(fen, [
            advance.uci,
            ...reply.pvUci.slice(0, maxPromotionPly + 3),
        ]);
        const { promotion } = traceAdvancedPawn(steps, advance.move.from, advance.before.turn);
        const trade = promotion?.trade;
        if (
            !promotion ||
            !trade ||
            promotion.through > maxPromotionPly ||
            promotion.square % 8 !== advance.move.to % 8 ||
            steps.length < trade.through + 2 ||
            steps.slice(trade.through - 1, trade.through + 2).some((step) => step.balance < 90)
        )
            continue;
        captures.push({ steps, promotion, trade });
    }
    for (const [index, first] of captures.entries()) {
        const second = captures
            .slice(index + 1)
            .find(
                (other) =>
                    other.steps[1].uci !== first.steps[1].uci &&
                    other.promotion.square === first.promotion.square &&
                    other.trade.role === first.trade.role &&
                    independent(
                        first.steps.slice(1),
                        other.steps.slice(1),
                        first.promotion.through - 2,
                        other.promotion.through - 2,
                    ),
            );
        if (!second) continue;
        const branches =
            first.trade.description === second.trade.description
                ? `After ${first.steps[1].san} or ${second.steps[1].san}, Stockfish finds ${first.trade.description}.`
                : `After ${first.steps[1].san}, Stockfish finds ${first.trade.description}. After ${second.steps[1].san}, it finds ${second.trade.description}.`;
        return {
            description: `After ${advance.san}, the pawn can be traded for a ${first.trade.role}. ${branches}`,
            linesUci: pair(first.steps, second.steps, first.trade, second.trade),
        };
    }
}

/** Two distinct legal choices have to show what actually happens to the
 * same pawn. A sustained blockade supplies strategic evidence. A specific
 * promotion and recapture can separately supply tactical evidence. */
export function findPromotionPressure(
    fen: string,
    candidates: DecisionEngineLine[],
    needTactics: boolean,
) {
    if (candidates.length < 2) return {};
    const [rootStep] = replayTacticalLine(fen, candidates[0].pvUci.slice(0, 1));
    if (!rootStep) return {};
    const pawns = [...rootStep.before.board.pawn].filter(
        (square) => relativeRank(square, rootStep.before.board.get(square)!.color) >= 5,
    );
    if (!pawns.length) return {};
    const lines = candidates.slice(0, 3);
    const paths = lines.map((line) => replayTacticalLine(fen, line.pvUci.slice(0, WINDOW)));
    let positional: PositionStrategicPlan | undefined;
    let tactical: PositionStrategicPlan | undefined;
    for (const pawn of pawns) {
        const side = rootStep.before.board.get(pawn)!.color;
        const ownerMoves = rootStep.before.turn === side;
        const title = `The ${side} pawn starting on ${makeSquare(pawn)} shapes both choices.`;
        const trajectories = paths.map((steps) => traceAdvancedPawn(steps, pawn, side));
        const best = trajectories[0];
        for (let i = 1; !positional && i < lines.length; i++) {
            const alt = trajectories[i];
            const comparable = viable(lines[0], lines[i]);
            const stopped =
                best.blockade ??
                (best.removes &&
                (best.removes.through === 1 ||
                    (relativeRank(pawn, side) >= 6 && alt.promotion && best.removes.through <= 4))
                    ? best.removes
                    : undefined);
            // A different conversion can highlight a weaker defence. A shared
            // plan requires two viable routes with distinct continuations.
            const defensive = !ownerMoves && (alt.promotion || (comparable && alt.blockade));
            const left = defensive && stopped ? stopped : (best.promotion ?? best.blockade);
            const right =
                defensive && stopped ? defensive : (alt.promotion ?? alt.blockade ?? alt.advance);
            if (!left || !right || (!comparable && !(defensive && stopped && alt.promotion)))
                continue;
            if (
                left === best.promotion &&
                right === alt.promotion &&
                Math.min(left.through, right.through) < 5
            )
                continue;
            if (!independent(paths[0], paths[i], left.through, right.through)) continue;
            positional = {
                description: `${title} ${describe(paths[0][0].san, left)}. ${describe(paths[i][0].san, right)}.`,
                linesUci: pair(paths[0], paths[i], left, right),
            };
        }
        if (!needTactics || tactical || ownerMoves || !best.blockade) continue;
        // Two different alternatives show the same concrete liquidation of
        // the defender's piece. A mere quiet promotion never supplies this.
        const a = trajectories[1]?.promotion;
        const b = trajectories[2]?.promotion;
        if (
            a?.trade &&
            b?.trade &&
            a.square === b.square &&
            a.trade.role === b.trade.role &&
            Math.max(a.through, b.through) <= 6 &&
            independent(paths[1], paths[2], a.trade.through, b.trade.through)
        ) {
            tactical = {
                description: `After ${paths[1][0].san}, ${a.trade.description} trades the promoting pawn for a ${a.trade.role}. After ${paths[2][0].san}, ${b.trade.description} shows the same exchange.`,
                linesUci: pair(paths[1], paths[2], a.trade, b.trade),
            };
        }
    }
    return { positional, tactical };
}
