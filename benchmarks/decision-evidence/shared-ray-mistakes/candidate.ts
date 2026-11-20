import { attacks, between } from "chessops/attacks";
import type { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { SquareSet } from "chessops/squareSet";
import type { Role, Square } from "chessops/types";
import { makeSquare } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "@/utils/tacticalMotifs/causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "@/utils/tacticalMotifs/decisionEvidence";
import type { DecisionSharedReplyProbe } from "@/utils/tacticalMotifs/decisionSharedReply";
import type { TacticalMistakeEpisode } from "@/utils/tacticalMotifs/tacticalMistakeEpisode";

const isSlider = (role: Role) => role === "bishop" || role === "rook" || role === "queen";
const eligibleTarget = (role: Role) => role !== "pawn" && role !== "king";
type Targets = readonly [Square, Square];

function rayPairs(board: Chess, from: Square) {
    const piece = board.board.get(from);
    if (!piece || !isSlider(piece.role) || piece.color === board.turn) return [];
    const opposing = board.board[board.turn];
    const directlyAttacked = attacks(piece, from, board.board.occupied).intersect(opposing);
    const candidates: Targets[] = [];
    for (const rear of attacks(piece, from, SquareSet.empty()).intersect(opposing)) {
        if (!eligibleTarget(board.board.get(rear)!.role)) continue;
        const [front, obstruction] = between(from, rear).intersect(board.board.occupied);
        if (front !== undefined && obstruction === undefined && directlyAttacked.has(front)
            && eligibleTarget(board.board.get(front)!.role))
            candidates.push([front, rear]);
    }
    return candidates;
}

function newlyAligned(
    actual: TacticalReplayStep, attack: TacticalReplayStep, choice: TacticalReplayStep, control: TacticalReplayStep,
) {
    const attacker = attack.before.board.get(attack.move.from)!;
    const alternative = choice.after.board.get(control.move.from);
    if (!alternative || alternative.role !== attacker.role || alternative.color !== attacker.color)
        return [];
    const oldPairs = rayPairs(control.after, control.move.to);
    const next = attack.after.clone();
    next.turn = attacker.color;
    next.epSquare = undefined;
    return rayPairs(attack.after, attack.move.to).filter(([front, rear]) => {
        if (actual.move.to !== front && actual.move.to !== rear) return false;
        if (!next.isLegal({ from: attack.move.to, to: front })) return false;
        const saved: Square[] = [];
        for (const square of [front, rear]) {
            const origin = square === actual.move.to ? actual.move.from : square;
            const destination = choice.move.from === origin ? choice.move.to : origin;
            const original = actual.before.board.get(origin);
            const piece = control.after.board.get(destination);
            if (!original || !piece || piece.role !== original.role || piece.color !== original.color) return false;
            saved.push(destination);
        }
        return !oldPairs.some(([first, second]) => saved.includes(first) && saved.includes(second));
    });
}

type Payment = { square: Square; capture: TacticalReplayStep; through: number };

function payments(line: TacticalReplayStep[], pair: Targets) {
    const result: Payment[] = [];
    const attacker = line[1].before.turn;
    const available = new Set(pair);
    let slider: Square | undefined = line[1].move.to;
    for (let index = 2; index < line.length - 1; index++) {
        const step = line[index];
        const next = line[index + 1];
        if (step.before.turn === attacker && step.move.from === slider) {
            if (step.capture && available.has(step.move.to) && line[index - 1].balance - next.balance >= 100) {
                for (const horizon of [index + 1, index + 3]) {
                    const end = line[horizon];
                    if (end && !end.after.isCheck() && end.balance <= -100
                        && line[index - 1].balance - end.balance >= 100)
                        result.push({ square: step.move.to, capture: step, through: horizon + 1 });
                }
            }
            slider = step.move.to;
        } else if (step.capture && step.move.to === slider) {
            slider = undefined;
        }
        available.delete(step.move.from);
        available.delete(step.move.to);
    }
    return result;
}

function replyContext(
    fen: string,
    best: DecisionEngineLine,
    played: DecisionEngineLine,
    opponent: DecisionEngineLine,
) {
    if (best.cp === null || played.cp === null || opponent.cp === null
        || best.mate != null || played.mate != null || opponent.mate != null
        || best.depth !== played.depth || best.depth < 16 || opponent.depth < 16
        || best.cp - played.cp < 100 || Math.abs(played.cp + opponent.cp) > 90
        || played.pvUci[1] !== opponent.pvUci[0])
        return null;
    const first = replayTacticalLine(fen, played.pvUci.slice(0, 9));
    const [actual, attack] = first;
    const [choice, control] = replayTacticalLine(fen, [best.pvUci[0], opponent.pvUci[0]]);
    if (!actual || !attack || !choice || !control || actual.before.isCheck()
        || actual.capture || actual.move.promotion || attack.move.promotion || attack.capture
        || attack.after.isCheck() || !eligibleTarget(actual.before.board.get(actual.move.from)!.role))
        return null;
    const targets = newlyAligned(actual, attack, choice, control);
    if (!targets.length) return null;
    const opponentFen = makeFen(actual.after.toSetup());
    if (measureDecisionLine(opponentFen, opponent)?.drawnEnding !== false
        || measureDecisionLine(fen, played)?.drawnEnding !== false
        || measureDecisionLine(fen, best)?.drawnEnding !== false)
        return null;
    const second = replayTacticalLine(fen, [actual.uci, ...opponent.pvUci.slice(0, 8)]);
    const witnesses = targets.flatMap(pair => {
        const other = payments(second, pair);
        return payments(first, pair).flatMap(a => other.map(b => ({ pair, a, b })));
    });
    if (!witnesses.length) return null;
    return { first, second, actual, attack, choice, control, witnesses };
}

export function nominateSharedRay(fen: string, best: DecisionEngineLine, played: DecisionEngineLine, opponent: DecisionEngineLine) {
    const context = replyContext(fen, best, played, opponent);
    if (!context) return null;
    return {
        betterMoveUci: context.choice.uci,
        playedMoveUci: context.actual.uci,
        replyUci: context.attack.uci,
        fen: makeFen(context.choice.after.toSetup()),
    };
}

export function compareSharedRay(
    fen: string, best: DecisionEngineLine, played: DecisionEngineLine, opponent: DecisionEngineLine,
    probe: DecisionSharedReplyProbe | undefined,
): TacticalMistakeEpisode | null {
    if (!probe || probe.betterMoveUci !== best.pvUci[0] || probe.playedMoveUci !== played.pvUci[0]
        || probe.line.pvUci[0] !== opponent.pvUci[0])
        return null;
    const context = replyContext(fen, best, played, opponent);
    if (!context) return null;
    const { actual, attack, choice, control, second, witnesses } = context;
    const checked = probe.line;
    if (checked.depth < 16 || checked.cp === null || checked.mate != null
        || opponent.cp! - checked.cp < 100 || checked.cp + best.cp! > 100
        || measureDecisionLine(makeFen(choice.after.toSetup()), checked)?.drawnEnding !== false)
        return null;
    const betterLine = [choice.uci, ...checked.pvUci.slice(0, 8)];
    const steps = replayTacticalLine(fen, betterLine);
    for (const { pair, a, b } of witnesses) {
        const throughPly = Math.max(a.through, b.through);
        const checkpoint = steps[throughPly - 1];
        if (!checkpoint || checkpoint.after.isCheck() || checkpoint.balance < -40) continue;
        const roles = pair.map(square => `the ${attack.after.board.get(square)!.role} on ${makeSquare(square)}`);
        const exchange = a.square === b.square
            ? `Both searches show ${b.capture.san} winning material from that alignment.`
            : `The two searches show ${a.capture.san} and ${b.capture.san} winning different pieces.`;
        const safer = steps[2].san;
        return {
            kind: "forcing-attack",
            throughPly,
            playedLineUci: second.slice(0, b.through).map(step => step.uci),
            betterLineUci: betterLine.slice(0, throughPly),
            mechanisms: [],
            explanation: `${actual.san} lets ${attack.san} line up ${roles[0]} and ${roles[1]}. ${exchange} After ${choice.san}, ${control.san} ${safer} keeps the material balance in the compared line.`,
        };
    }
    return null;
}
