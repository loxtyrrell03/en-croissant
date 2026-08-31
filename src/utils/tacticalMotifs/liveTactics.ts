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
    "deflection",
    "interference",
    "selfInterference",
    "attraction",
    "clearance",
    "intermezzo",
    "capturingDefender",
    "discoveredCheck",
    "discoveredAttack",
    "fork",
    "skewer",
    "pin",
    "xRayAttack",
    "sacrifice",
    "trappedPiece",
    "hangingPiece",
    "attacking_undefended_piece",
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
};

export function selectLiveTacticalScanLine(lines: BestMoves[] | null | undefined) {
    const available = (lines ?? []).filter((line) => line.uciMoves.length > 0);
    return available.find((line) => line.multipv === 1) ?? available[0];
}

export function isLiveTacticalScanTerminal(
    progress: number,
    lines: BestMoves[] | null | undefined,
) {
    return progress >= 100 && Boolean(selectLiveTacticalScanLine(lines));
}

export function hasUsableLiveTacticalFallback(
    lines: BestMoves[] | null | undefined,
    minimumDepth: number,
) {
    const line = selectLiveTacticalScanLine(lines);
    return Boolean(line && line.depth >= minimumDepth);
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
            unique.set(motif.id, motif);
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

export function buildLiveTacticalScan(input: LiveTacticalScanInput): LiveTacticalScan {
    const lineUci = input.pvUci
        .map((move) => move.trim().toLowerCase())
        .filter((move) => VALID_UCI_PATTERN.test(move))
        .slice(0, 20);
    const classification = classifyPositionTacticalMotifs({
        fen: input.fen,
        pvUci: lineUci,
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
        square: motif.moveUci?.slice(2, 4) ?? null,
    }));

    return {
        fen: input.fen,
        side: input.fen.trim().split(/\s+/)[1] === "b" ? "black" : "white",
        engineName: input.engineName,
        depth: input.depth,
        motifs,
        lineUci,
        lineSan: (input.pvSan ?? []).slice(0, lineUci.length),
        arrows,
        labels,
        motifClassifierVersion: classification.motifClassifierVersion,
    };
}

export function tacticalMotifDescription(motif: TacticalMotifEvidence) {
    if (THEME_DESCRIPTIONS[motif.id]) return THEME_DESCRIPTIONS[motif.id];
    if (NAMED_MATE_PATTERN.test(motif.id)) {
        return `${motif.label} is the mating pattern found in the forcing line.`;
    }
    if (MATE_DISTANCE_PATTERN.test(motif.id)) {
        return `${motif.label} is forced in the engine's principal variation.`;
    }
    return motif.evidence;
}

export function buildTacticalEngineOptions(settings: EngineSettings | null | undefined) {
    const options = engineSettingsToOptions(settings).filter(
        (option) => option.name.trim().toLowerCase() !== "multipv",
    );
    return [...options, { name: "MultiPV", value: "1" }] satisfies EngineOption[];
}

export function getLiveTacticalScanCacheKey({
    fen,
    engineId,
    depth,
    previousFen,
    previousMoveUci,
}: {
    fen: string;
    engineId: string;
    depth: number;
    previousFen?: string | null;
    previousMoveUci?: string | null;
}) {
    return JSON.stringify([
        MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
        fen,
        engineId,
        depth,
        previousFen ?? "",
        previousMoveUci ?? "",
    ]);
}
