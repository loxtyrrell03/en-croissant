import { makeFen } from "chessops/fen";
import type { Color } from "chessops/types";
import { replayTacticalLine } from "./causalTactics";
import { measureDecisionLine, type DecisionEngineLine } from "./decisionEvidence";
import { extractPositionalBoardFacts, type SidePositionalFacts } from "./positionalEvidence";

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
const key = (feature: ObservedFeature) =>
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

export type ComparativePositionalEvidence = PositionalTransition & {
    comparisonMoveUci: string;
    comparisonGapCp: number;
    supportInComparison: boolean;
    interpretation: "heuristic";
};

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
    const side: Color = fen.split(" ")[1] === "b" ? "black" : "white";
    const preferable = (item: PositionalTransition) =>
        item.side === side
            ? !["isolated-pawn", "doubled-pawn"].includes(item.feature)
            : ["isolated-pawn", "doubled-pawn"].includes(item.feature);
    const candidates = extractPositionalTransitions(fen, best).filter(
        (item) => item.firstPly === 1 && item.lastConsecutivePly >= 6 && preferable(item),
    );
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
        if (
            !settled(bestEvidence) ||
            !settled(evidence) ||
            Math.abs(bestEvidence.materialChangeCp - evidence.materialChangeCp) > 50
        )
            continue;
        const alternativeChanges = extractPositionalTransitions(fen, alternative);
        for (const item of candidates) {
            const occurs = alternativeChanges.some(
                (other) =>
                    key(other) === key(item) &&
                    other.firstPly <= 3 &&
                    other.lastConsecutivePly >= 6,
            );
            if (occurs) continue;
            if (result.some((other) => key(other) === key(item))) continue;
            result.push({
                ...item,
                comparisonMoveUci: alternative.pvUci[0],
                comparisonGapCp: best.cp - alternative.cp,
                supportInComparison: false,
                interpretation: "heuristic",
            });
        }
    }
    return result;
}
