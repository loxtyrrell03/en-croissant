import { attacks, pawnAttacks } from "chessops/attacks";
import type { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import type { Color, Piece, Square } from "chessops/types";
import { makeSquare, opposite } from "chessops/util";
import {
    replayTacticalLine,
    tacticalExchangeGain,
    type TacticalReplayStep,
} from "@/utils/tacticalMotifs/causalTactics";
import {
    measureDecisionLine,
    type DecisionEngineLine,
} from "@/utils/tacticalMotifs/decisionEvidence";
import type { ComparativePositionalEvidence } from "@/utils/tacticalMotifs/positionalTransitions";
import type { TacticalGameHistory } from "@/utils/tacticalMotifs/gameHistory";
import {
    advanceTacticalRepetitionContext,
    readTacticalRepetitionContext,
    tacticalRepetitionClaim,
} from "@/utils/tacticalMotifs/repetitionHistory";

const WINDOW = 10;
const DURATION = 4;
const MIN_DEPTH = 16;
const MAX_MATERIAL_GAP = 110;
const file = (square: Square) => square % 8;
const relativeRank = (square: Square, side: Color) =>
    side === "white" ? (square >> 3) + 1 : 8 - (square >> 3);
const pawns = (board: Chess, side: Color) => board.board.pawn.intersect(board.board[side]);

type Feature = "passed-pawn" | "pawn-stable-minor";
type Asset = {
    feature: Feature;
    origin: Square;
    square: Square;
    side: Color;
    role: Piece["role"];
};

type BoardTrace = {
    step: TacticalReplayStep;
    origins: Map<Square, Square>;
    facts: Asset[];
};

export type StrategicAssetEvidence = {
    factor: ComparativePositionalEvidence;
    betterLineUci: string[];
    playedLineUci: string[];
};

function opposingPawns(board: Chess, square: Square, side: Color, minOffset: number) {
    return [...pawns(board, opposite(side))].filter((other) => {
        const offset = Math.abs(file(other) - file(square));
        return (
            offset >= minOffset &&
            offset <= 1 &&
            relativeRank(other, side) > relativeRank(square, side)
        );
    });
}

function assetFacts(board: Chess, origins: Map<Square, Square>) {
    const facts: Asset[] = [];
    for (const [square, origin] of origins) {
        const piece = board.board.get(square);
        if (!piece || relativeRank(square, piece.color) < 5) continue;
        const { color: side, role } = piece;
        if (role === "pawn" && !opposingPawns(board, square, side, 0).length) {
            facts.push({ feature: "passed-pawn", origin, square, side, role });
        } else if (
            (role === "knight" || role === "bishop") &&
            !opposingPawns(board, square, side, 1).length &&
            [...pawns(board, side)].some((pawn) => pawnAttacks(side, pawn).has(square))
        ) {
            facts.push({ feature: "pawn-stable-minor", origin, square, side, role });
        }
    }
    return facts;
}

function assetOrigins(board: Chess) {
    return new Map(
        [...board.board.pawn.union(board.board.knight).union(board.board.bishop)].map((square) => [
            square,
            square,
        ]),
    );
}

function trace(steps: TacticalReplayStep[]) {
    const original = assetOrigins(steps[0].before);
    return steps.map((step) => {
        const { before, after, move, capture } = step;
        const there = original.get(move.from);
        const pawn = before.board.get(move.from)?.role === "pawn";
        if (capture && pawn && before.epSquare === move.to)
            original.delete((move.to + (before.turn === "white" ? -8 : 8)) as Square);
        original.delete(move.from);
        original.delete(move.to);
        if (there !== undefined && !move.promotion) original.set(move.to, there);
        const origins = new Map(original);
        return { step, origins, facts: assetFacts(after, origins) };
    });
}

const sameAsset = (a: Asset, b: Asset) =>
    a.feature === b.feature && a.side === b.side && a.origin === b.origin && a.square === b.square;

function hasComparableAsset(steps: BoardTrace[], asset: Asset) {
    return steps.some(({ facts }) =>
        facts.some((other) => {
            if (other.feature !== asset.feature || other.side !== asset.side) return false;
            if (asset.feature === "pawn-stable-minor") return other.square === asset.square;
            return (
                other.origin === asset.origin ||
                (file(other.square) === file(asset.square) &&
                    relativeRank(other.square, asset.side) >=
                        relativeRank(asset.square, asset.side))
            );
        }),
    );
}

function linkedPawn(trace: BoardTrace[], asset: Asset, first: number) {
    const [row, reply, answer] = trace;
    const root = row.step;
    if (root.move.from === asset.origin && root.before.turn === asset.side) return true;
    const blockers = new Set([
        ...opposingPawns(root.before, asset.origin, asset.side, 0),
        ...opposingPawns(root.before, asset.square, asset.side, 0),
    ]);
    if (
        (root.before.turn === asset.side && root.capture && blockers.has(root.move.to)) ||
        (root.before.turn !== asset.side &&
            blockers.has(root.move.from) &&
            !opposingPawns(root.after, asset.square, asset.side, 0).includes(root.move.to))
    )
        return true;
    if (first > 5) return false;
    if (root.before.turn !== asset.side) {
        const capturedRoot = trace
            .slice(1, first)
            .findIndex(
                ({ step, origins }) =>
                    step.capture > 0 &&
                    step.before.turn === asset.side &&
                    step.move.to === root.move.to &&
                    origins.get(step.move.to) === asset.origin,
            );
        if (capturedRoot < 0) return false;
        return trace
            .slice(1, capturedRoot + 1)
            .every(({ step }) => step.move.from !== root.move.to && step.move.to !== root.move.to);
    }
    return (
        reply.step.capture > 0 &&
        reply.step.move.to === root.move.to &&
        blockers.has(reply.step.move.from) &&
        answer.step.capture > 0 &&
        answer.step.move.to === root.move.to &&
        answer.origins.get(asset.square) === asset.origin
    );
}

function activeOutpost(line: BoardTrace[], asset: Asset, from: number, through: number) {
    const index = line.findIndex(({ facts }) => facts.some((item) => sameAsset(item, asset)));
    if (index < 0 || index > from) return false;
    const { step } = line[index];
    const directRetake =
        index === 3 &&
        step.move.to === line[0].step.move.to &&
        step.capture > 0 &&
        line
            .slice(1, index)
            .every(({ step }) => step.move.from !== asset.square && step.move.to !== asset.square);
    if (index > 2 && !directRetake) return false;
    const piece = step.after.board.get(asset.square);
    if (
        step.move.to !== asset.square ||
        step.before.turn !== asset.side ||
        !piece ||
        attacks(piece, asset.square, step.after.board.occupied)
            .intersect(step.after.board[opposite(asset.side)])
            .diff(step.after.board.king)
            .isEmpty()
    )
        return false;
    return line.slice(index, through).every(({ step }) => {
        if (step.after.turn === asset.side) return true;
        for (const [source, destinations] of step.after.allDests()) {
            if (!destinations.has(asset.square)) continue;
            const gain = tacticalExchangeGain(step.after, { from: source, to: asset.square });
            if (gain >= 90 || gain <= -20000) return false;
        }
        return true;
    });
}

function frame(fen: string, candidate: DecisionEngineLine, reply?: DecisionEngineLine) {
    const [root] = replayTacticalLine(fen, candidate.pvUci.slice(0, 1));
    if (
        !root ||
        (reply && measureDecisionLine(makeFen(root.after.toSetup()), reply)?.drawnEnding !== false)
    )
        return [];
    const line = reply ? { ...candidate, pvUci: [root.uci, ...reply.pvUci] } : candidate;
    return measureDecisionLine(fen, line)?.drawnEnding === false
        ? replayTacticalLine(fen, line.pvUci.slice(0, WINDOW))
        : [];
}

function protectedFromDraw(
    lines: TacticalReplayStep[][],
    through: number,
    fen: string,
    history?: TacticalGameHistory,
) {
    if (!history) return true;
    const start = readTacticalRepetitionContext(fen, history);
    if (!start || tacticalRepetitionClaim(start)) return false;
    return lines.every((line) => {
        let context = start;
        for (const step of line.slice(0, through)) {
            const next = advanceTacticalRepetitionContext(context, step.uci);
            if (!next || next.endedAtPly !== undefined || tacticalRepetitionClaim(next))
                return false;
            context = next;
        }
        return true;
    });
}

export function compareStrategicAssets(
    fen: string,
    better: DecisionEngineLine,
    played: DecisionEngineLine,
    betterReply: DecisionEngineLine,
    playedReply: DecisionEngineLine,
    history?: TacticalGameHistory,
    arm: "linked" | "repeated" = "linked",
): StrategicAssetEvidence | null {
    if (
        better.cp == null ||
        played.cp == null ||
        betterReply.cp == null ||
        playedReply.cp == null ||
        better.depth !== played.depth ||
        [better, played, betterReply, playedReply].some(
            (line) => line.depth < MIN_DEPTH || line.mate != null,
        ) ||
        better.cp - played.cp < 60 ||
        playedReply.cp - betterReply.cp < 40 ||
        Math.abs(better.cp + betterReply.cp) > 90 ||
        Math.abs(played.cp + playedReply.cp) > 90
    )
        return null;
    const lines = [
        frame(fen, better),
        frame(fen, better, betterReply),
        frame(fen, played),
        frame(fen, played, playedReply),
    ];
    const checkThrough = Math.min(...lines.map((line) => line.length));
    if (checkThrough < 5) return null;
    const start = lines[0][0].before;
    const traces = lines.map(trace);
    const rootFacts = assetFacts(start, assetOrigins(start));
    for (let end = 5; end <= checkThrough; end++) {
        const from = end - DURATION;
        const balances = lines.map((line) => line[end - 1].balance);
        if (
            Math.max(...balances) - Math.min(...balances) > MAX_MATERIAL_GAP ||
            lines.some(
                (line) =>
                    line[end - 1].after.isCheck() ||
                    line[end - 1].balance !== line[end - 2].balance,
            )
        )
            continue;
        for (const concession of [false, true]) {
            const first = concession ? 2 : 0;
            const side = concession ? opposite(start.turn) : start.turn;
            const favorable = traces.slice(first, first + 2);
            const contrast = traces.slice(concession ? 0 : 2, concession ? 2 : 4);
            const candidates = favorable[0][from].facts.filter((asset) => asset.side === side);
            for (const asset of candidates) {
                const wasPassed =
                    asset.feature === "passed-pawn" &&
                    !opposingPawns(start, asset.origin, side, 0).length;
                if (
                    wasPassed ||
                    rootFacts.some(
                        (item) =>
                            item.feature === asset.feature &&
                            item.side === side &&
                            item.square === asset.square,
                    ) ||
                    favorable.some((line) =>
                        line
                            .slice(from, end)
                            .some(({ facts }) => !facts.some((item) => sameAsset(item, asset))),
                    ) ||
                    contrast.some((line) => hasComparableAsset(line.slice(0, end), asset))
                )
                    continue;
                const takenByStronger =
                    concession &&
                    asset.feature === "passed-pawn" &&
                    contrast.every(
                        ([{ step }]) =>
                            step.capture > 0 &&
                            step.move.to === asset.origin &&
                            !step.after.board[asset.side].has(asset.origin),
                    );
                if (arm === "linked") {
                    const linked =
                        asset.feature === "pawn-stable-minor"
                            ? favorable.every((line) => activeOutpost(line, asset, from, end))
                            : takenByStronger ||
                              (favorable.every((line) =>
                                  linkedPawn(
                                      line,
                                      asset,
                                      line.findIndex(({ facts }) =>
                                          facts.some((item) => sameAsset(item, asset)),
                                      ) + 1,
                                  ),
                              ) &&
                                  contrast.every((line) =>
                                      [...line[end - 1].origins.values()].includes(asset.origin),
                                  ));
                    if (!linked) continue;
                }
                if (!protectedFromDraw(lines, end, fen, history)) continue;
                const betterSan = lines[0][0].san;
                const playedSan = lines[2][0].san;
                const reachedBy = concession ? playedSan : betterSan;
                const oppositeBy = concession ? betterSan : playedSan;
                const square = makeSquare(asset.square);
                const actor = side === "white" ? "White" : "Black";
                const entry = favorable[0].find(({ facts }) =>
                    facts.some((item) => sameAsset(item, asset)),
                )!.step;
                const enabling =
                    entry.san === reachedBy ? reachedBy : `${reachedBy} … ${entry.san}`;
                const avoided = takenByStronger
                    ? `${betterSan} takes the original pawn on ${makeSquare(asset.origin)} before it can advance.`
                    : `The same setup is absent after ${oppositeBy} through this window.`;
                const created =
                    asset.feature === "passed-pawn"
                        ? `${actor}'s pawn from ${makeSquare(asset.origin)} becomes a passed pawn on ${square}`
                        : `${actor}'s ${asset.role} occupies ${square}, supported by a pawn and beyond the reach of an opposing pawn`;
                return {
                    betterLineUci: better.pvUci.slice(0, end),
                    playedLineUci: played.pvUci.slice(0, end),
                    factor: {
                        feature: asset.feature,
                        side,
                        squareOrFile: asset.feature === "passed-pawn" ? square[0] : square,
                        description: `After ${enabling}, ${created}. Both searches retain this structure. ${avoided}`,
                        firstPly: from + 1,
                        lastConsecutivePly: end,
                        support: "board-fact",
                        comparisonMoveUci: (concession ? better : played).pvUci[0],
                        comparisonGapCp: better.cp - played.cp,
                        supportInComparison: false,
                        comparison: "separate-reply-search",
                        materialWindowPlies: end,
                        interpretation: "heuristic",
                    },
                };
            }
        }
    }
    return null;
}
