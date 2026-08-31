import type { BestMoves, EngineOption } from "@/bindings";
import { engineSettingsToOptions, type EngineSettings } from "@/utils/engines";
import {
    classifyPositionTacticalMotifs,
    MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
    tacticalMotifColor,
} from "./mistakeReviewAdapter";
import type { TacticalMotifEvidence } from "./types";

const CORE_TACTICAL_THEME_IDS = new Set([
    "fork",
    "pin",
    "skewer",
    "discoveredAttack",
    "doubleCheck",
    "hangingPiece",
    "trappedPiece",
    "sacrifice",
    "backRank",
    "backRankMate",
    "promotion",
    "underPromotion",
    "enPassant",
    "mateThreat",
    "deflection",
    "attraction",
    "interference",
    "selfInterference",
    "intermezzo",
    "clearance",
    "xRayAttack",
    "discoveredCheck",
    "zugzwang",
    "capturingDefender",
    "attacking_undefended_piece",
    "attackingF2F7",
]);

const THEME_PRIORITY = [
    "backRankMate",
    "smotheredMate",
    "anastasiaMate",
    "hookMate",
    "arabianMate",
    "bodenMate",
    "doubleBishopMate",
    "dovetailMate",
    "balestraMate",
    "blindSwineMate",
    "cornerMate",
    "epauletteMate",
    "killBoxMate",
    "morphysMate",
    "operaMate",
    "pillsburysMate",
    "swallowstailMate",
    "triangleMate",
    "vukovicMate",
    "doubleCheck",
    "fork",
    "pin",
    "skewer",
    "deflection",
    "interference",
    "selfInterference",
    "attraction",
    "clearance",
    "intermezzo",
    "capturingDefender",
    "discoveredCheck",
    "discoveredAttack",
    "xRayAttack",
    "sacrifice",
    "trappedPiece",
    "hangingPiece",
    "attacking_undefended_piece",
    "attackingF2F7",
    "mateThreat",
    "backRank",
    "promotion",
    "underPromotion",
    "zugzwang",
    "enPassant",
];

const THEME_DESCRIPTIONS: Record<string, string> = {
    fork: "One piece attacks two or more important targets at the same time.",
    pin: "A piece cannot move safely because it exposes a more valuable piece or the king.",
    skewer: "The more valuable target is attacked first, exposing another target behind it.",
    discoveredAttack: "Moving one piece opens a line for another piece to attack.",
    discoveredCheck: "Moving one piece uncovers a check from another piece.",
    doubleCheck: "Two pieces give check together, sharply limiting the reply.",
    deflection: "A defender is forced away from the square or line it must protect.",
    attraction: "A forcing move draws a piece onto a vulnerable square.",
    interference: "A move cuts a defending piece off by blocking its line.",
    selfInterference: "A defending move blocks another defender's line.",
    intermezzo:
        "A forcing in-between move is played before the expected recapture or continuation.",
    clearance: "A square or line is cleared so another piece can use it with tactical force.",
    xRayAttack: "A long-range piece attacks through another piece along the same line.",
    capturingDefender: "A key defender is removed so the defended target can be won.",
    sacrifice: "Material is offered to gain a stronger forcing continuation.",
    trappedPiece: "A piece has no safe route away from the threat.",
    hangingPiece: "A piece is loose and can be taken without adequate compensation.",
    attacking_undefended_piece: "The line creates a direct threat against an undefended piece.",
    attackingF2F7:
        "The move exploits the king-side f-pawn, whose apparent king defence may not be a legal recapture.",
    mateThreat: "The forcing line creates a concrete checkmate threat.",
    backRank: "The king's restricted back rank creates a tactical weakness.",
    promotion: "A pawn promotes as the tactical payoff.",
    underPromotion: "Promoting to a piece other than a queen is the precise tactical move.",
    zugzwang: "Every legal move worsens the defender's position.",
    enPassant: "The special pawn capture is essential to the tactic.",
};

const NAMED_MATE_PATTERN = /Mate$/;
const MATE_DISTANCE_PATTERN = /^mate(?:In[1-5])?$/;
const VALID_UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const FACT_RICH_THEME_IDS = new Set([
    "fork",
    "pin",
    "skewer",
    "hangingPiece",
    "attacking_undefended_piece",
    "attackingF2F7",
]);

export const LIVE_TACTICAL_SCAN_PIPELINE_VERSION = 2;
export const LIVE_TACTICAL_SCAN_MULTIPV = 3;

export type LiveTacticalBoardArrow = {
    from: string;
    to: string;
    ply: number;
    role: "attacker" | "reply" | "trigger";
};

export type LiveTacticalBoardLabel = {
    id: string;
    text: string;
    color: string;
    square: string | null;
};

export type LiveTacticalVariation = {
    multipv: number;
    depth: number;
    motifs: TacticalMotifEvidence[];
    lineUci: string[];
    lineSan: string[];
    arrows: LiveTacticalBoardArrow[];
    labels: LiveTacticalBoardLabel[];
};

export type LiveTacticalVariationInput = {
    multipv?: number;
    depth?: number;
    pvUci: string[];
    pvSan?: string[] | null;
};

export type LiveTacticalScan = {
    fen: string;
    side: "white" | "black";
    engineName: string;
    depth: number;
    motifs: TacticalMotifEvidence[];
    lineUci: string[];
    lineSan: string[];
    arrows: LiveTacticalBoardArrow[];
    labels: LiveTacticalBoardLabel[];
    variations: LiveTacticalVariation[];
    motifClassifierVersion: string;
};

export type LiveTacticalScanInput = {
    fen: string;
    pvUci: string[];
    pvSan?: string[] | null;
    engineName: string;
    depth: number;
    previousFen?: string | null;
    previousMoveUci?: string | null;
    variations?: LiveTacticalVariationInput[] | null;
};

export function selectLiveTacticalScanLine(lines: BestMoves[] | null | undefined) {
    return selectLiveTacticalScanLines(lines, 1)[0];
}

export function selectLiveTacticalScanLines(
    lines: BestMoves[] | null | undefined,
    limit = LIVE_TACTICAL_SCAN_MULTIPV,
    minimumDepth = 0,
) {
    const roots = new Set<string>();
    return [...(lines ?? [])]
        .filter((line) => line.depth >= minimumDepth && line.uciMoves.length > 0)
        .sort((left, right) => left.multipv - right.multipv || right.depth - left.depth)
        .filter((line) => {
            const root = line.uciMoves[0]?.trim().toLowerCase();
            if (!root || roots.has(root)) return false;
            roots.add(root);
            return true;
        })
        .slice(0, Math.max(0, limit));
}

export function isLiveTacticalScanTerminal(
    progress: number,
    lines: BestMoves[] | null | undefined,
    minimumDepth = 0,
) {
    return progress >= 100 && selectLiveTacticalScanLines(lines, 1, minimumDepth).length > 0;
}

export function hasUsableLiveTacticalFallback(
    lines: BestMoves[] | null | undefined,
    minimumDepth: number,
) {
    return selectLiveTacticalScanLines(lines, 1, minimumDepth).length > 0;
}

export function isLiveTacticalTheme(id: string) {
    return (
        CORE_TACTICAL_THEME_IDS.has(id) ||
        NAMED_MATE_PATTERN.test(id) ||
        MATE_DISTANCE_PATTERN.test(id)
    );
}

export function selectLiveTacticalMotifs(motifs: TacticalMotifEvidence[]) {
    const unique = new Map<string, TacticalMotifEvidence>();
    for (const motif of motifs) {
        if (isLiveTacticalTheme(motif.id) && !unique.has(motif.id)) {
            const weakSquare = motif.moveUci?.slice(2, 4);
            unique.set(
                motif.id,
                motif.id === "attackingF2F7"
                    ? {
                          ...motif,
                          label:
                              weakSquare === "f2" || weakSquare === "f7"
                                  ? `Weak ${weakSquare}`
                                  : "Weak f2/f7",
                      }
                    : motif,
            );
        }
    }

    const hasNamedMate = [...unique.keys()].some((id) => NAMED_MATE_PATTERN.test(id));
    const hasMateDistance = [...unique.keys()].some((id) => /^mateIn[1-5]$/.test(id));
    if (hasNamedMate || hasMateDistance) unique.delete("mate");
    if (unique.has("backRankMate")) unique.delete("backRank");

    const priority = new Map(THEME_PRIORITY.map((id, index) => [id, index]));
    return [...unique.values()].sort((left, right) => {
        const leftPriority = priority.get(left.id) ?? THEME_PRIORITY.length;
        const rightPriority = priority.get(right.id) ?? THEME_PRIORITY.length;
        return leftPriority - rightPriority || left.label.localeCompare(right.label);
    });
}

type ClassifiedLiveTacticalVariation = LiveTacticalVariation & {
    motifClassifierVersion: string;
};

function buildLiveTacticalVariation(
    input: LiveTacticalScanInput,
    variation: LiveTacticalVariationInput,
    fallbackMultipv: number,
): ClassifiedLiveTacticalVariation {
    const lineUci = variation.pvUci
        .map((move) => move.trim().toLowerCase())
        .filter((move) => VALID_UCI_PATTERN.test(move))
        .slice(0, 20);
    const classification = classifyPositionTacticalMotifs({
        fen: input.fen,
        pvUci: lineUci,
        pvSan: variation.pvSan,
        previousFen: input.previousFen,
        previousMoveUci: input.previousMoveUci,
    });
    const motifs = selectLiveTacticalMotifs(classification.motifs);
    const triggerPlies = new Set(
        motifs
            .map((motif) => motif.ply)
            .filter((ply): ply is number => typeof ply === "number" && ply > 0),
    );
    const furthestTrigger = Math.max(1, ...triggerPlies);
    const arrowLimit =
        motifs.length > 0 ? Math.min(lineUci.length, Math.max(3, furthestTrigger + 1), 6) : 0;
    const arrows = lineUci.slice(0, arrowLimit).map<LiveTacticalBoardArrow>((move, index) => ({
        from: move.slice(0, 2),
        to: move.slice(2, 4),
        ply: index + 1,
        role: triggerPlies.has(index + 1) ? "trigger" : index % 2 === 0 ? "attacker" : "reply",
    }));
    const labels = motifs.slice(0, 3).map<LiveTacticalBoardLabel>((motif) => ({
        id: motif.id,
        text: motif.label,
        color: tacticalMotifColor(motif.id),
        square:
            motif.moveUci?.slice(2, 4) ??
            (motif.id === "attackingF2F7" ? lineUci[0]?.slice(2, 4) : null) ??
            null,
    }));

    return {
        multipv: variation.multipv ?? fallbackMultipv,
        depth: variation.depth ?? input.depth,
        motifs,
        lineUci,
        lineSan: (variation.pvSan ?? []).slice(0, lineUci.length),
        arrows,
        labels,
        motifClassifierVersion: classification.motifClassifierVersion,
    };
}

function aggregateVariationArrows(variations: ClassifiedLiveTacticalVariation[]) {
    const arrows: LiveTacticalBoardArrow[] = [];
    const seen = new Set<string>();

    for (const variation of variations.filter((candidate) => candidate.motifs.length > 0)) {
        for (const arrow of variation.arrows) {
            const key = `${arrow.from}${arrow.to}`;
            if (seen.has(key)) continue;
            seen.add(key);
            arrows.push(arrow);
            if (arrows.length >= 9) return arrows;
        }
    }

    return arrows;
}

function aggregateVariationLabels(variations: ClassifiedLiveTacticalVariation[]) {
    const tacticalVariations = variations.filter((candidate) => candidate.motifs.length > 0);
    const includeMove = tacticalVariations.length > 1;
    const labels: LiveTacticalBoardLabel[] = [];
    const seen = new Set<string>();

    for (const variation of tacticalVariations) {
        const rootMove = variation.lineSan[0] ?? variation.lineUci[0] ?? "";
        for (const label of variation.labels) {
            const key = `${label.id}:${label.square ?? ""}:${variation.lineUci[0] ?? ""}`;
            if (seen.has(key)) continue;
            seen.add(key);
            labels.push({
                ...label,
                id: includeMove ? `${label.id}:pv${variation.multipv}` : label.id,
                text: includeMove && rootMove ? `${rootMove} · ${label.text}` : label.text,
            });
            if (labels.length >= 6) return labels;
        }
    }

    return labels;
}

export function buildLiveTacticalScan(input: LiveTacticalScanInput): LiveTacticalScan {
    const candidateInputs =
        input.variations && input.variations.length > 0
            ? input.variations.slice(0, LIVE_TACTICAL_SCAN_MULTIPV)
            : [
                  {
                      multipv: 1,
                      depth: input.depth,
                      pvUci: input.pvUci,
                      pvSan: input.pvSan,
                  },
              ];
    const variations = candidateInputs.map((variation, index) =>
        buildLiveTacticalVariation(input, variation, index + 1),
    );
    const primary =
        variations.find((variation) => variation.multipv === 1) ??
        variations[0] ??
        buildLiveTacticalVariation(
            input,
            { multipv: 1, depth: input.depth, pvUci: input.pvUci, pvSan: input.pvSan },
            1,
        );
    const motifs = selectLiveTacticalMotifs(variations.flatMap((variation) => variation.motifs));
    const publicVariations = variations.map<LiveTacticalVariation>(
        ({ motifClassifierVersion: _version, ...variation }) => variation,
    );

    return {
        fen: input.fen,
        side: input.fen.trim().split(/\s+/)[1] === "b" ? "black" : "white",
        engineName: input.engineName,
        depth: primary.depth,
        motifs,
        lineUci: primary.lineUci,
        lineSan: primary.lineSan,
        arrows: aggregateVariationArrows(variations),
        labels: aggregateVariationLabels(variations),
        variations: publicVariations,
        motifClassifierVersion: primary.motifClassifierVersion,
    };
}

export function tacticalMotifDescription(motif: TacticalMotifEvidence) {
    if (FACT_RICH_THEME_IDS.has(motif.id) && motif.evidence.trim()) return motif.evidence;
    if (THEME_DESCRIPTIONS[motif.id]) return THEME_DESCRIPTIONS[motif.id];
    if (NAMED_MATE_PATTERN.test(motif.id)) {
        return `${motif.label} is the mating pattern found in the forcing line.`;
    }
    if (MATE_DISTANCE_PATTERN.test(motif.id)) {
        return `${motif.label} is forced in the engine's principal variation.`;
    }
    return motif.evidence;
}

export function buildTacticalEngineOptions(
    settings: EngineSettings | null | undefined,
    multipv = LIVE_TACTICAL_SCAN_MULTIPV,
) {
    const options = engineSettingsToOptions(settings).filter(
        (option) => option.name.trim().toLowerCase() !== "multipv",
    );
    return [
        ...options,
        { name: "MultiPV", value: String(Math.max(1, Math.trunc(multipv))) },
    ] satisfies EngineOption[];
}

export function getLiveTacticalScanCacheKey({
    fen,
    engineId,
    depth,
    multipv = LIVE_TACTICAL_SCAN_MULTIPV,
    previousFen,
    previousMoveUci,
}: {
    fen: string;
    engineId: string;
    depth: number;
    multipv?: number;
    previousFen?: string | null;
    previousMoveUci?: string | null;
}) {
    return JSON.stringify([
        LIVE_TACTICAL_SCAN_PIPELINE_VERSION,
        MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
        fen,
        engineId,
        depth,
        multipv,
        previousFen ?? "",
        previousMoveUci ?? "",
    ]);
}
