import { makeFen } from "chessops/fen";
import type { Color } from "chessops/types";
import { replayTacticalLine } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import { extractPositionalBoardFacts, type SidePositionalFacts } from "./positionalEvidence";
import { extractStrategicRootEffects, type StrategicRootEffect } from "./strategicRootEffects";

export type PositionalTransition = {
    feature:
        | "pawn-stable-minor"
        | "open-rook-file"
        | "semi-open-rook-file"
        | "passed-pawn"
        | "bishop-pair"
        | "isolated-pawn"
        | "doubled-pawn";
    side: Color;
    squareOrFile: string;
    description: string;
    firstPly: number;
    lastConsecutivePly: number;
    support: "board-fact";
};

type ObservedFeature = Omit<PositionalTransition, "firstPly" | "lastConsecutivePly" | "support">;
function observations(facts: SidePositionalFacts, side: Color): ObservedFeature[] {
    const name = side === "white" ? "White" : "Black";
    return [
        ...facts.minorSquaresWithoutPawnChallengers.map((square) => ({
            feature: "pawn-stable-minor" as const,
            side,
            squareOrFile: square,
            description: `${name}'s minor piece on ${square} has pawn support and no opposing pawn able to advance to attack that square.`,
        })),
        ...facts.rooksOnOpenFiles.map((square) => ({
            feature: "open-rook-file" as const,
            side,
            squareOrFile: square[0],
            description: `${name}'s rook on ${square} occupies a file with no pawns.`,
        })),
        ...facts.rooksOnSemiOpenFiles.map((square) => ({
            feature: "semi-open-rook-file" as const,
            side,
            squareOrFile: square[0],
            description: `${name}'s rook on ${square} occupies a file with opposing pawns but no friendly pawns.`,
        })),
        ...facts.passedPawns.map((square) => ({
            feature: "passed-pawn" as const,
            side,
            squareOrFile: square[0],
            description: `${name}'s pawn on ${square} has no enemy pawn ahead on its file or either adjacent file.`,
        })),
        ...facts.isolatedPawns.map((square) => ({
            feature: "isolated-pawn" as const,
            side,
            squareOrFile: square[0],
            description: `${name}'s pawn on ${square} has no friendly pawn on either adjacent file.`,
        })),
        ...facts.doubledPawnFiles.map((file) => ({
            feature: "doubled-pawn" as const,
            side,
            squareOrFile: file,
            description: `${name} has more than one pawn on the ${file}-file.`,
        })),
        ...(facts.bishopPair
            ? [
                  {
                      feature: "bishop-pair" as const,
                      side,
                      squareOrFile: "both colours",
                      description: `${name} retains bishops on both colour complexes.`,
                  },
              ]
            : []),
    ];
}
const key = (feature: { side: Color; feature: string; squareOrFile: string }) =>
    `${feature.side}:${feature.feature}:${feature.squareOrFile}`;

/** Actual feature changes and their consecutive duration. Presence or duration
 * alone does not make the feature good, nor prove the move's strategic purpose. */
export function extractPositionalTransitions(
    fen: string,
    line: DecisionEngineLine,
): PositionalTransition[] {
    if (!measureDecisionLine(fen, line)) return [];
    const initial = extractPositionalBoardFacts(fen)!;
    const beforeKeys = new Set(
        [...observations(initial.white, "white"), ...observations(initial.black, "black")].map(key),
    );
    const found: PositionalTransition[] = [];
    const active = new Map<string, PositionalTransition>();
    const steps = replayTacticalLine(fen, line.pvUci);
    for (const [index, step] of steps.entries()) {
        const facts = extractPositionalBoardFacts(makeFen(step.after.toSetup()))!;
        const present = [
            ...observations(facts.white, "white"),
            ...observations(facts.black, "black"),
        ];
        const presentKeys = new Set(present.map(key));
        for (const id of active.keys()) if (!presentKeys.has(id)) active.delete(id);
        for (const item of present) {
            const id = key(item);
            if (beforeKeys.has(id)) continue;
            let change = active.get(id);
            if (!change) {
                change = {
                    ...item,
                    firstPly: index + 1,
                    lastConsecutivePly: index + 1,
                    support: "board-fact",
                };
                active.set(id, change);
                found.push(change);
            } else change.lastConsecutivePly = index + 1;
        }
    }
    return found;
}

export type ComparativePositionalEvidence = (PositionalTransition | StrategicRootEffect) & {
    comparisonMoveUci: string | null;
    comparisonGapCp: number | null;
    supportInComparison: boolean | null;
    comparison: "alternative-choice" | "separate-reply-search";
    materialWindowPlies?: number;
    interpretation: "heuristic";
};

function rootFeatures(
    fen: string,
    line: DecisionEngineLine,
): Array<PositionalTransition | StrategicRootEffect> {
    const side: Color = fen.split(" ")[1] === "b" ? "black" : "white";
    return [
        ...extractPositionalTransitions(fen, line).filter(
            (item) =>
                item.firstPly === 1 &&
                item.lastConsecutivePly >= 6 &&
                (item.side === side
                    ? !["isolated-pawn", "doubled-pawn"].includes(item.feature)
                    : ["isolated-pawn", "doubled-pawn"].includes(item.feature)),
        ),
        ...extractStrategicRootEffects(fen, line),
    ];
}

/** A good strategic move need not beat another plausible plan by 30 cp. Check
 * whether its concrete root effect survives an independently searched best
 * response. This is still an interpretation of a verified feature, not an
 * engine attribution. Use a bounded window while the feature exists rather
 * than allowing an unrelated late PV capture to erase earlier evidence. */
export function corroboratePositionalEffects(
    fen: string,
    rootLine: DecisionEngineLine,
    separatelySearchedBestReply: DecisionEngineLine | undefined,
): ComparativePositionalEvidence[] {
    if (!separatelySearchedBestReply) return [];
    const root = measureDecisionLine(fen, rootLine);
    const reply = measureDecisionLine(fen, separatelySearchedBestReply);
    if (
        !root ||
        !reply ||
        root.drawnEnding ||
        reply.drawnEnding ||
        rootLine.depth < 16 ||
        separatelySearchedBestReply.depth < 16 ||
        rootLine.mate != null ||
        separatelySearchedBestReply.mate != null ||
        rootLine.pvUci[0] !== separatelySearchedBestReply.pvUci[0]
    )
        return [];
    const other = rootFeatures(fen, separatelySearchedBestReply);
    const materialWindow = (
        line: DecisionEngineLine,
        feature: PositionalTransition | StrategicRootEffect,
    ) => {
        for (
            let ply = Math.max(6, feature.firstPly + 4);
            ply <= Math.min(12, feature.lastConsecutivePly);
            ply++
        ) {
            const measured = measureDecisionLine(fen, { ...line, pvUci: line.pvUci.slice(0, ply) });
            if (
                measured &&
                !measured.drawnEnding &&
                measured.quietEndingPlies >= 2 &&
                measured.endingMaterialRangeCp[0] === measured.endingMaterialRangeCp[1] &&
                Math.abs(measured.materialChangeCp) <= 50
            )
                return ply;
        }
        return null;
    };
    return rootFeatures(fen, rootLine).flatMap((item): ComparativePositionalEvidence[] => {
        const corresponding = other.find((effect) => key(effect) === key(item));
        if (!corresponding) return [];
        const rootWindow = materialWindow(rootLine, item),
            replyWindow = materialWindow(separatelySearchedBestReply, corresponding);
        // A persistent structural change can be the compensation for a
        // sacrifice or the purpose of a combination. Requiring equal
        // material would systematically exclude precisely those mixed
        // decisions. General activity/space still needs the neutral window;
        // all interpretations remain explicitly heuristic, not score causes.
        const generalActivity = ["pawn-space", "piece-reach", "piece-restriction"].includes(
            item.feature,
        );
        if (generalActivity && (!rootWindow || !replyWindow)) return [];
        return [
            {
                ...item,
                comparisonMoveUci: null,
                comparisonGapCp: null,
                supportInComparison: true,
                comparison: "separate-reply-search",
                interpretation: "heuristic",
                ...(rootWindow && replyWindow
                    ? { materialWindowPlies: Math.max(rootWindow, replyWindow) }
                    : {}),
            },
        ];
    });
}

/** Compare legal choices rather than labelling every quiet continuation
 * positional. These matched observations remain heuristic interpretations:
 * an engine score cannot assign its value to one particular feature. */
export function comparePositionalTransitions(
    fen: string,
    best: DecisionEngineLine,
    alternatives: DecisionEngineLine[],
): ComparativePositionalEvidence[] {
    const bestEvidence = measureDecisionLine(fen, best);
    if (
        !bestEvidence ||
        bestEvidence.drawnEnding ||
        best.depth < 16 ||
        best.cp === null ||
        best.mate != null
    )
        return [];
    const candidates = rootFeatures(fen, best);
    const result: ComparativePositionalEvidence[] = [];
    for (const alternative of alternatives) {
        const evidence = measureDecisionLine(fen, alternative);
        if (
            !evidence ||
            alternative.pvUci[0] === best.pvUci[0] ||
            alternative.depth !== best.depth ||
            alternative.cp === null ||
            alternative.mate != null ||
            best.cp - alternative.cp < 30 ||
            evidence.plies < 6 ||
            evidence.drawnEnding
        )
            continue;
        // Reduce incidental structure labels during material combinations.
        // Compare settled branches with similar material, then require the
        // explicit persistent feature below. Similar material alone is not
        // positional evidence and never generates a label.
        const settled = (measurement: typeof evidence) =>
            measurement.quietEndingPlies >= 2 &&
            measurement.endingMaterialRangeCp[0] === measurement.endingMaterialRangeCp[1];
        const alternativeChanges = [
            ...extractPositionalTransitions(fen, alternative),
            ...extractStrategicRootEffects(fen, alternative),
        ];
        // A different move order can reach the same plan before the chosen
        // comparison point. Record effects initiated by the next two moves
        // of the original side, without assigning them to the root.
        const alternativeSteps = replayTacticalLine(fen, alternative.pvUci.slice(0, 4));
        for (const offset of [2, 4]) {
            if (alternativeSteps.length < offset || alternative.pvUci.length < offset + 6) continue;
            const laterFen = makeFen(alternativeSteps[offset - 1].after.toSetup());
            alternativeChanges.push(
                ...extractStrategicRootEffects(laterFen, {
                    ...alternative,
                    fen: laterFen,
                    pvUci: alternative.pvUci.slice(offset),
                }).map((item) => ({
                    ...item,
                    firstPly: item.firstPly + offset,
                    lastConsecutivePly: item.lastConsecutivePly + offset,
                })),
            );
        }
        for (const item of candidates) {
            let comparableWindow: number | undefined;
            for (
                let ply = Math.max(6, item.firstPly + 4);
                ply <=
                Math.min(12, item.lastConsecutivePly, best.pvUci.length, alternative.pvUci.length);
                ply++
            ) {
                const bestWindow = measureDecisionLine(fen, {
                    ...best,
                    pvUci: best.pvUci.slice(0, ply),
                });
                const otherWindow = measureDecisionLine(fen, {
                    ...alternative,
                    pvUci: alternative.pvUci.slice(0, ply),
                });
                if (
                    !bestWindow ||
                    !otherWindow ||
                    bestWindow.drawnEnding ||
                    otherWindow.drawnEnding ||
                    !settled(bestWindow) ||
                    !settled(otherWindow) ||
                    Math.abs(bestWindow.materialChangeCp - otherWindow.materialChangeCp) > 50
                )
                    continue;
                comparableWindow = ply;
                break;
            }
            if (comparableWindow === undefined) continue;
            const occurs = alternativeChanges.some(
                (other) =>
                    key(other) === key(item) &&
                    other.firstPly <= comparableWindow &&
                    other.lastConsecutivePly >= comparableWindow,
            );
            if (occurs) continue;
            if (result.some((other) => key(other) === key(item))) continue;
            result.push({
                ...item,
                comparisonMoveUci: alternative.pvUci[0],
                comparisonGapCp: best.cp - alternative.cp,
                supportInComparison: false,
                comparison: "alternative-choice",
                materialWindowPlies: comparableWindow,
                interpretation: "heuristic",
            });
        }
    }
    return result;
}
