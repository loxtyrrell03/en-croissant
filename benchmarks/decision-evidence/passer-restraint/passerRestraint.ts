import { pawnAttacks } from "chessops/attacks";
import { makeFen } from "chessops/fen";
import type { Color, Square } from "chessops/types";
import { makeSan } from "chessops/san";
import { makeSquare, makeUci, opposite } from "chessops/util";
import {
    replayTacticalLine,
    tacticalExchangeGain,
    type TacticalReplayStep,
} from "@/utils/tacticalMotifs/causalTactics";
import {
    measureDecisionLine,
    type DecisionEngineLine,
} from "@/utils/tacticalMotifs/decisionEvidence";
import {
    exactInterceptionLine,
    hasInterceptionScores,
    interceptionTradeCost,
    isPassedPawn,
    noInterceptionDrawClaim,
    passerRank,
} from "@/utils/tacticalMotifs/decisionPawnInterception";
import {
    followPieceIdentities,
    initialPieceIdentities,
} from "@/utils/tacticalMotifs/decisionPieceIdentity";
import type { TacticalGameHistory } from "@/utils/tacticalMotifs/gameHistory";
import type { ComparativePositionalEvidence } from "@/utils/tacticalMotifs/positionalTransitions";
import type { TacticalMistakeEpisode } from "@/utils/tacticalMotifs/tacticalMistakeEpisode";

type Line = TacticalReplayStep[];
type Defence = { san: string; uci: string; gain: number };
type Frame = TacticalReplayStep & { identities: Map<Square, Square>; removed: Square | undefined };
export type RestraintCheck = { fen: string; prefix: string[]; captureUci: string };
type RestraintMethod = "advance" | "lasting" | "combined";
type PasserRestraint = {
    factor: ComparativePositionalEvidence;
    episode: TacticalMistakeEpisode | null;
    playedLineUci: string[];
    betterLineUci: string[];
    controlLineUci: string[];
    checks: RestraintCheck[];
};

function withIdentities(line: Line): Frame[] {
    const origins = initialPieceIdentities(line[0].before);
    return line.map((step) => {
        const removed = followPieceIdentities(origins, step);
        return { ...step, identities: new Map(origins), removed };
    });
}

function checkedAdvance(frame: Frame, origin: Square, target: Square, attacker: Color) {
    const { after, identities } = frame;
    const push = { from: origin, to: target };
    if (
        identities.get(origin) !== origin ||
        after.board.get(origin)?.role !== "pawn" ||
        after.turn !== attacker ||
        after.board.get(target) ||
        !after.isLegal(push)
    )
        return null;
    const attacked = after.clone();
    const san = makeSan(attacked, push);
    attacked.play(push);
    const defences = new Map<Square, Defence>();
    for (const from of attacked.board[attacked.turn]) {
        const original = identities.get(from);
        if (original === undefined) continue;
        const take = { from, to: target };
        const gain = tacticalExchangeGain(attacked, take);
        if (gain >= 0)
            defences.set(original, { san: makeSan(attacked, take), uci: makeUci(take), gain });
    }
    return { san, defences, fen: makeFen(attacked.toSetup()) };
}

function keepsPawn(line: Frame[], pawn: Square, start: number, end: number) {
    return (
        line.length >= end &&
        line
            .slice(start, end)
            .every(({ identities, after }) =>
                [...identities].some(
                    ([square, identity]) =>
                        identity === pawn && after.board.get(square)?.role === "pawn",
                ),
            )
    );
}

function keptLoss(worse: Frame[][], pawn: Square, target: Square, advance: number[]) {
    const first = interceptionTradeCost(worse[0], pawn);
    const second = interceptionTradeCost(worse[1], pawn);
    if (!first || !second || first.pawn !== target || second.pawn !== target) return null;
    if (
        worse[0][first.index].identities.get(first.step.move.to) !==
        worse[1][second.index].identities.get(second.step.move.to)
    )
        return null;
    const through = Math.max(first.end, second.end) + 2;
    const loss = Math.min(
        ...[first, second].map(
            (item, index) =>
                worse[index][advance[index] - 1].balance -
                Math.max(
                    ...worse[index].slice(item.end - 1, through).map(({ balance }) => balance),
                ),
        ),
    );
    return through <= Math.min(...worse.map((line) => line.length)) && loss >= 90
        ? {
              through,
              loss,
              sample: worse[0]
                  .slice(advance[0], first.end)
                  .map(({ san }) => san)
                  .join(" "),
          }
        : null;
}

function sacToKeepSupport(
    betterRoot: Frame,
    worse: Frame[][],
    advance: number[],
    target: Square,
    guard: Square,
    top: DecisionEngineLine,
    next: DecisionEngineLine | undefined,
) {
    if (
        advance.some((index) => index !== 3) ||
        worse[0][1].uci !== worse[1][1].uci ||
        worse[0][2].uci !== worse[1][2].uci ||
        !next ||
        measureDecisionLine(top.fen, next)?.drawnEnding !== false ||
        next.lowerbound ||
        next.upperbound ||
        next.depth !== top.depth ||
        next.cp == null ||
        top.cp! - next.cp < 100
    )
        return null;
    const attack = worse[0][1],
        recapture = worse[0][2];
    const support = betterRoot.removed;
    if (
        support === undefined ||
        betterRoot.before.board.get(support)?.role !== "pawn" ||
        attack.removed !== betterRoot.move.from ||
        !recapture.capture ||
        recapture.move.to !== attack.move.to ||
        recapture.balance - worse[0][0].balance < 150
    )
        return null;
    for (const line of worse) {
        const { after, identities } = line[3];
        const owner = opposite(after.turn);
        const response = { from: support, to: target };
        if (
            identities.get(support) !== support ||
            after.board.get(support)?.color !== owner ||
            !after.board.pawn.has(support) ||
            !pawnAttacks(owner, support).has(target)
        )
            return null;
        // Confirm that this exact original pawn can recapture on the
        // advance square after the same rook or other guardian takes.
        const from = [...identities].find(([, origin]) => origin === guard)?.[0];
        if (from === undefined) return null;
        const take = { from, to: target };
        if (!after.isLegal(take) || tacticalExchangeGain(after, take) >= 0) return null;
        const trial = after.clone();
        trial.play(take);
        if (!trial.isLegal(response) || tacticalExchangeGain(trial, response) < 100) return null;
    }
    return { attack: attack.san, recapture: recapture.san, advance: worse[0][3].san, support };
}

/** Trace an existing sixth-rank passer and test the same legal push after
 * each stronger continuation. The tactical episodes need distinct evidence:
 * a retained cost to stop the pawn, or a repeated exchange that keeps the
 * pawn's support and beats the other examined replies. */
export function comparePasserRestraint(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    betterReply: DecisionEngineLine,
    playedReplies: DecisionEngineLine[],
    history?: TacticalGameHistory,
    method: RestraintMethod = "combined",
): PasserRestraint | null {
    const [playedReply, nextReply] = playedReplies;
    if (
        !playedReply ||
        better.depth < 16 ||
        !hasInterceptionScores(better, played, betterReply, playedReply)
    )
        return null;
    const [root] = replayTacticalLine(fen, played.pvUci.slice(0, 1));
    if (!root) return null;
    const board = root.before;
    const attacker = opposite(board.turn);
    const pawns = [...board.board.pawn.intersect(board.board[attacker])].filter(
        (square) => passerRank(square, attacker) === 6 && isPassedPawn(board, square, attacker),
    );
    if (!pawns.length) return null;
    const window = 16;
    const stronger = [
        exactInterceptionLine(fen, better, window),
        exactInterceptionLine(fen, better, window, betterReply),
    ];
    const weaker = [
        exactInterceptionLine(fen, played, window),
        exactInterceptionLine(fen, played, window, playedReply),
    ];
    if ([...stronger, ...weaker].some((line) => line.length < 5)) return null;
    const strong = stronger.map(withIdentities);
    const weak = weaker.map(withIdentities);
    for (const pawn of pawns) {
        const target = pawn + (attacker === "white" ? 8 : -8);
        const advance = weak.map((line) =>
            line
                .slice(0, 10)
                .findIndex(
                    ({ identities, move, capture }) =>
                        !capture &&
                        move.from === pawn &&
                        move.to === target &&
                        identities.get(target) === pawn,
                ),
        );
        if (advance.some((index) => index < 1 || index % 2 !== 1)) continue;
        if (
            weak.some(
                (line, index) =>
                    line[advance[index] - 1].balance < -50 ||
                    line[advance[index] - 1].identities.get(pawn) !== pawn,
            )
        )
            continue;
        const opening = checkedAdvance(strong[0][0], pawn, target, attacker);
        if (!opening) continue;
        const repeated = strong.map((line) => checkedAdvance(line[2], pawn, target, attacker));
        const failed = weak.map((line, index) =>
            checkedAdvance(line[advance[index] - 1], pawn, target, attacker),
        );
        if (failed.some((control) => !control || control.defences.size)) continue;
        const guarded = [...opening.defences].find(
            ([origin, defence]) =>
                defence.gain >= 90 &&
                repeated.every((test) => (test?.defences.get(origin)?.gain ?? 0) >= 90),
        );
        if (!guarded) continue;
        const [guard, defence] = guarded;
        const cost = method === "combined" ? keptLoss(weak, pawn, target, advance) : null;
        const lasting = method === "advance" ? 2 : 4;
        const holdingPly = Math.max(...advance.map((index) => index + lasting));
        const survives = weak.every(
            (line, index) =>
                keepsPawn(line, pawn, advance[index], advance[index] + lasting) &&
                line
                    .slice(advance[index], advance[index] + lasting)
                    .every(({ balance }) => balance >= -110),
        );
        if (!survives && !cost) continue;
        const through = Math.max(holdingPly, cost?.through ?? 0);
        if (
            strong.some(
                (line) =>
                    line.length < through ||
                    line.slice(0, holdingPly).some((frame) => frame.identities.get(pawn) !== pawn),
            )
        )
            continue;
        if (
            [...strong, ...weak].some(
                (line) =>
                    line.length < through || !noInterceptionDrawClaim(fen, line, through, history),
            )
        )
            continue;
        const minStrong = Math.min(
            ...strong.flatMap((line) =>
                line.slice(through - 2, through).map(({ balance }) => balance),
            ),
        );
        const maxWeak = Math.max(
            ...weak.flatMap((line) =>
                line.slice(through - 2, through).map(({ balance }) => balance),
            ),
        );
        const sacrifice =
            method === "combined" && !cost
                ? sacToKeepSupport(
                      strong[0][0],
                      weak,
                      advance,
                      target,
                      guard,
                      playedReply,
                      nextReply,
                  )
                : null;
        const chosen = stronger[0][0].san;
        const guardName = board.board.get(guard)!.role;
        const square = makeSquare(pawn);
        const tested = `After ${chosen}, ${opening.san} can be met by ${defence.san} without losing material in the exchange.`;
        const playedLineUci = weak[0].slice(0, through).map(({ uci }) => uci);
        const betterLineUci = strong[0].slice(0, through).map(({ uci }) => uci);
        const controlLineUci = [better.pvUci[0], makeUci({ from: pawn, to: target }), defence.uci];
        let episode: TacticalMistakeEpisode | null = null;
        if (cost && minStrong - maxWeak >= 90) {
            episode = {
                kind: "comparative",
                throughPly: through,
                materialDifferencePoints: (minStrong - maxWeak) / 100,
                mechanisms: [],
                playedLineUci,
                betterLineUci,
                controlLineUci,
                explanation: `After ${root.san}, stopping the ${square} pawn costs at least ${(cost.loss / 100).toFixed(1)} material points in both lines. One line shows ${cost.sample}. ${tested}`,
            };
        } else if (sacrifice) {
            episode = {
                kind: "forcing-attack",
                throughPly: through,
                mechanisms: [],
                playedLineUci,
                betterLineUci,
                controlLineUci,
                explanation: `After ${root.san}, both searches show ${sacrifice.attack} ${sacrifice.recapture} ${sacrifice.advance}. The exchange sacrifice keeps the pawn on ${makeSquare(sacrifice.support)} to defend the advancing pawn. ${chosen} takes that supporting pawn first. ${tested}`,
            };
        }
        if (!survives && !episode) continue;
        const push = makeUci({ from: pawn, to: target });
        const checkpoints = [
            { fen: opening.fen, prefix: [better.pvUci[0], push], captureUci: defence.uci },
            ...strong.map((line, index) => ({
                fen: repeated[index]!.fen,
                prefix: [...line.slice(0, 3).map(({ uci }) => uci), push],
                captureUci: repeated[index]!.defences.get(guard)!.uci,
            })),
        ];
        const checks = checkpoints.filter(
            (check, index) =>
                checkpoints.findIndex((other) => other.prefix.join() === check.prefix.join()) ===
                index,
        );
        return {
            factor: {
                feature: "passed-pawn",
                side: attacker,
                squareOrFile: square[0],
                description: `${chosen} keeps the ${guardName} from ${makeSquare(guard)} able to take on ${makeSquare(target)} at the first two checked opportunities. After ${root.san}, the pawn advances without that defence in both lines.`,
                firstPly: 1,
                lastConsecutivePly: 3,
                support: "board-fact",
                comparisonMoveUci: played.pvUci[0],
                comparisonGapCp: better.cp! - played.cp!,
                supportInComparison: false,
                comparison: "separate-reply-search",
                interpretation: "heuristic",
            },
            episode,
            playedLineUci,
            betterLineUci,
            controlLineUci,
            checks,
        };
    }
    return null;
}
