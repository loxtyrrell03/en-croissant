import type { Chess, Color } from "chessops";
import type { ScoreValue } from "@/bindings";
import { positionFromFen } from "@/utils/chessops";
import { getGamePhases, type GamePhases } from "@/utils/phase";
import { gameAnalysisEvidence } from "./gameAnalysisEvidence";
import {
    getCPLoss,
    getLichessGameAccuracy,
    getLichessJudgement,
    getWinningChances,
    scoreValueToCentipawns,
    type LichessJudgement,
} from "@/utils/score";
import { type GameHeaders, type TreeNode } from "@/utils/treeReducer";

export type GameAnalysisSideStats = {
    name: string;
    inaccuracies: number;
    mistakes: number;
    blunders: number;
    averageCentipawnLoss: number | null;
    accuracy: number | null;
    samples: number;
};

export type GameAnalysisChartPoint = {
    index: number;
    label: string;
    path: number[];
    y: number;
    scoreText: string;
    judgement: LichessJudgement | null;
};

export type GameAnalysisReport = {
    white: GameAnalysisSideStats;
    black: GameAnalysisSideStats;
    chart: GameAnalysisChartPoint[];
    phases: GamePhases;
    analysedPlies: number;
    totalPlies: number;
    hasAccuracy: boolean;
};

export function buildGameAnalysisReport(root: TreeNode, headers: GameHeaders): GameAnalysisReport {
    const whiteLosses: number[] = [];
    const blackLosses: number[] = [];
    const judgements: Record<Color, Record<LichessJudgement, number>> = {
        white: { inaccuracy: 0, mistake: 0, blunder: 0 },
        black: { inaccuracy: 0, mistake: 0, blunder: 0 },
    };
    const centipawns: (number | null)[] = [];
    const chart: GameAnalysisChartPoint[] = [];
    const { entries: mainline, initialScore, startColor, scores } = gameAnalysisEvidence(root);
    const boards = mainline
        .map((entry) => positionFromFen(entry.node.fen)[0])
        .filter((board): board is Chess => board !== null);

    let prevScore: ScoreValue | null = initialScore;

    for (const [index, entry] of mainline.entries()) {
        const node = entry.node;
        const color: Color = index % 2 === 0 ? startColor : startColor === "white" ? "black" : "white";
        const score = scores[index];
        const cp = score ? scoreValueToCentipawns(score) : null;
        centipawns.push(cp);

        if (score && prevScore) {
            const loss = getCPLoss(prevScore, score, color);
            if (color === "white") whiteLosses.push(loss);
            else blackLosses.push(loss);

            const judgement = getLichessJudgement(prevScore, score, color);
            if (judgement) judgements[color][judgement] += 1;
        }

        if (score && cp !== null) {
            chart.push({
                index,
                label: `${Math.ceil(node.halfMoves / 2)}.${color === "white" ? "" : ".."} ${
                    node.san ?? ""
                }`.trim(),
                path: entry.position,
                y: getWinningChances(cp),
                scoreText: score.type === "mate" ? positionFromFen(node.fen)[0]?.isCheckmate()
                    ? `${score.value > 0 ? "White" : "Black"} mates` : `${score.value > 0 ? "+" : "-"}M${Math.abs(score.value)}` : formatCentipawns(cp),
                judgement: prevScore ? getLichessJudgement(prevScore, score, color) : null,
            });
        }

        prevScore = score;
    }

    const accuracy = getLichessGameAccuracy(centipawns, startColor,
        initialScore ? scoreValueToCentipawns(initialScore) : null);

    return {
        white: {
            name: displayPlayerName(headers.white),
            inaccuracies: judgements.white.inaccuracy,
            mistakes: judgements.white.mistake,
            blunders: judgements.white.blunder,
            averageCentipawnLoss: average(whiteLosses),
            accuracy: accuracy?.white ?? null,
            samples: whiteLosses.length,
        },
        black: {
            name: displayPlayerName(headers.black),
            inaccuracies: judgements.black.inaccuracy,
            mistakes: judgements.black.mistake,
            blunders: judgements.black.blunder,
            averageCentipawnLoss: average(blackLosses),
            accuracy: accuracy?.black ?? null,
            samples: blackLosses.length,
        },
        chart,
        phases: getGamePhases(boards),
        analysedPlies: centipawns.filter((cp) => cp !== null).length,
        totalPlies: mainline.length,
        hasAccuracy: accuracy !== null,
    };
}

export function hasCompleteGameAnalysis(root: TreeNode): boolean {
    if (root.children.length === 0) return false;
    const { scores, initialScore, startColor } = gameAnalysisEvidence(root);
    return (
        getLichessGameAccuracy(
            scores.map(score => score ? scoreValueToCentipawns(score) : null),
            startColor,
            initialScore ? scoreValueToCentipawns(initialScore) : null,
        ) !== null
    );
}

function average(values: number[]): number | null {
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function displayPlayerName(value: string | null | undefined): string {
    const name = value?.trim();
    return name && name !== "?" ? name : "Anonymous";
}

function formatCentipawns(cp: number): string {
    if (cp === 0) return "0.00";
    return `${cp > 0 ? "+" : ""}${(cp / 100).toFixed(2)}`;
}
