import templateData from "@/data/pawnStructureTemplates.v1.json";
import type {
    PawnStructureCandidate,
    PawnStructureDetection,
    PawnStructureImplementationStatus,
    PawnStructureSide,
    PawnStructureTemplate,
    PawnStructureTemplateFile,
    PawnStructureTemplateSide,
} from "./pawnStructureTypes";

const files = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
type FileName = (typeof files)[number];

type FenPawn = {
    side: PawnStructureSide;
    file: FileName;
    rank: number;
    square: string;
};

export type PawnStructureFenFeatures = {
    pawns: FenPawn[];
    pieceCount: {
        whiteNonKing: number;
        blackNonKing: number;
        totalNonKing: number;
    };
    totalPawns: number;
};

type NormalizedPawnBoard = {
    primarySide: PawnStructureSide;
    opposingSide: PawnStructureSide;
    fileMirrored: boolean;
    pawns: Record<PawnStructureTemplateSide, Set<string>>;
    files: Record<PawnStructureTemplateSide, Set<FileName>>;
    allFiles: Set<FileName>;
    totalPawns: number;
    pieceCount: PawnStructureFenFeatures["pieceCount"];
};

type FeatureEvaluation = {
    matched: boolean;
    evidence: string;
};

type DetectOptions = {
    includePartial?: boolean;
    includeScaffolded?: boolean;
};

const templateFile = templateData as PawnStructureTemplateFile;

const fullyImplementedStructures = new Set(templateFile.structures.map((structure) => structure.id));
const scaffoldedStructures = new Set<string>();
const partialStructures = new Set<string>();

const disambiguationPriority = new Map(
    [
        "hedgehog",
        "benko_structure",
        "closed_ruy_lopez",
        "french_type_iii",
        "kid_type_ii",
        "kid_type_i",
        "kid_type_iii",
        "scheveningen_structure",
        "maroczy",
        "dragon_formation",
        "panov_structure",
        "asymmetric_benoni",
        "symmetric_benoni",
        "isolani",
        "hanging_pawns",
        "carlsbad_formation",
        "slav_formation",
        "caro_kann_formation",
        "lopez_formation",
        "kid_complex",
        "open_kid",
    ].map((id, index) => [id, index]),
);

export function getPawnStructureTemplates() {
    return templateFile.structures;
}

export function getPawnStructureImplementationStatus(
    structureId: string,
): PawnStructureImplementationStatus {
    if (fullyImplementedStructures.has(structureId)) return "full";
    if (partialStructures.has(structureId)) return "partial";
    if (scaffoldedStructures.has(structureId)) return "scaffolded";
    return "disabled";
}

export function extractPawnStructureFeatures(fen: string): PawnStructureFenFeatures | null {
    const [boardPart] = fen.trim().split(/\s+/);
    const ranks = boardPart?.split("/");
    if (!ranks || ranks.length !== 8) return null;

    const pawns: FenPawn[] = [];
    let whiteNonKing = 0;
    let blackNonKing = 0;

    for (let rankIndex = 0; rankIndex < ranks.length; rankIndex++) {
        const rank = 8 - rankIndex;
        let fileIndex = 0;
        for (const char of ranks[rankIndex]) {
            if (/\d/.test(char)) {
                fileIndex += Number(char);
                continue;
            }

            const file = files[fileIndex];
            if (!file) return null;

            const side: PawnStructureSide = char === char.toUpperCase() ? "white" : "black";
            const role = char.toLowerCase();
            if (role !== "k") {
                if (side === "white") {
                    whiteNonKing++;
                } else {
                    blackNonKing++;
                }
            }
            if (role === "p") {
                pawns.push({
                    side,
                    file,
                    rank,
                    square: `${file}${rank}`,
                });
            }
            fileIndex++;
        }
        if (fileIndex !== 8) return null;
    }

    return {
        pawns,
        pieceCount: {
            whiteNonKing,
            blackNonKing,
            totalNonKing: whiteNonKing + blackNonKing,
        },
        totalPawns: pawns.length,
    };
}

export function detectPawnStructure(fen: string, options?: DetectOptions): PawnStructureDetection | null {
    return detectPawnStructureCandidates(fen, options)[0] ?? null;
}

export function detectPawnStructureCandidates(
    fen: string,
    { includePartial = true, includeScaffolded = false }: DetectOptions = {},
): PawnStructureCandidate[] {
    const features = extractPawnStructureFeatures(fen);
    if (!features || features.totalPawns < 4) return [];

    const candidates: PawnStructureCandidate[] = [];

    for (const template of templateFile.structures) {
        const status = getPawnStructureImplementationStatus(template.id);
        if (status === "disabled") continue;
        if (status === "partial" && !includePartial) continue;
        if (status === "scaffolded" && !includeScaffolded) continue;

        const allowColourReverse = template.colourAndMirrorHandling?.allowColourReverse !== false;
        const sides: PawnStructureSide[] = allowColourReverse ? ["white", "black"] : ["white"];
        const mirrorValues = template.colourAndMirrorHandling?.allowFileMirror
            ? [false, true]
            : [false];

        for (const primarySide of sides) {
            for (const fileMirrored of mirrorValues) {
                const board = normalizePawns(features, primarySide, fileMirrored);
                const candidate = evaluateTemplate(template, board, status);
                if (candidate) candidates.push(candidate);
            }
        }
    }

    const bestByTemplate = new Map<string, PawnStructureCandidate>();
    for (const candidate of candidates) {
        const key = candidate.structureId;
        const current = bestByTemplate.get(key);
        if (!current || candidate.confidence > current.confidence) {
            bestByTemplate.set(key, candidate);
        }
    }

    const ranked = [...bestByTemplate.values()].sort(compareCandidates);
    const [top, second] = ranked;
    if (!top) return [];

    const minimum = templateMinimum(top.structureId);
    if (top.confidence < minimum) return [];

    if (second) {
        const ambiguityDelta = isBroadOrTransitional(top.structureId, second.structureId) ? 0.12 : 0.08;
        const close = top.confidence - second.confidence < ambiguityDelta;
        if (close && !isPreferredSibling(top, second)) {
            return [];
        }
    }

    return ranked.filter((candidate) => candidate.confidence >= templateMinimum(candidate.structureId));
}

function normalizePawns(
    features: PawnStructureFenFeatures,
    primarySide: PawnStructureSide,
    fileMirrored: boolean,
): NormalizedPawnBoard {
    const opposingSide: PawnStructureSide = primarySide === "white" ? "black" : "white";
    const pawns: NormalizedPawnBoard["pawns"] = {
        primary: new Set(),
        opposing: new Set(),
    };
    const boardFiles: NormalizedPawnBoard["files"] = {
        primary: new Set(),
        opposing: new Set(),
    };
    const allFiles = new Set<FileName>();

    for (const pawn of features.pawns) {
        const side: PawnStructureTemplateSide = pawn.side === primarySide ? "primary" : "opposing";
        const normalizedRank = primarySide === "white" ? pawn.rank : 9 - pawn.rank;
        const normalizedFile = fileMirrored ? mirrorFile(pawn.file) : pawn.file;
        const square = `${normalizedFile}${normalizedRank}`;
        pawns[side].add(square);
        boardFiles[side].add(normalizedFile);
        allFiles.add(normalizedFile);
    }

    return {
        primarySide,
        opposingSide,
        fileMirrored,
        pawns,
        files: boardFiles,
        allFiles,
        totalPawns: features.totalPawns,
        pieceCount: features.pieceCount,
    };
}

function evaluateTemplate(
    template: PawnStructureTemplate,
    board: NormalizedPawnBoard,
    implementationStatus: PawnStructureImplementationStatus,
): PawnStructureCandidate | null {
    const required = template.canonicalPawnFeatures.required.map((feature) =>
        evaluateFeature(feature, board),
    );
    const requiredWeights = template.canonicalPawnFeatures.required.map(requiredFeatureWeight);
    const requiredWeightSum = requiredWeights.reduce((sum, weight) => sum + weight, 0);
    const matchedRequiredWeight = required.reduce(
        (sum, feature, index) => sum + (feature.matched ? requiredWeights[index] : 0),
        0,
    );
    const requiredRatio =
        requiredWeightSum > 0 ? matchedRequiredWeight / requiredWeightSum : 1;
    if (requiredRatio < minimumRequiredRatio(template)) return null;

    const anchorRequired = template.canonicalPawnFeatures.required
        .map((feature, index) => ({ feature, result: required[index] }))
        .filter((entry) => isPawnAnchorFeature(entry.feature));
    const matchedAnchors = anchorRequired.filter((entry) => entry.result.matched).length;
    if (anchorRequired.length > 0) {
        const anchorRatio = matchedAnchors / anchorRequired.length;
        if (anchorRatio < 1) return null;
    }

    const forbidden = template.canonicalPawnFeatures.forbidden
        .map((feature) => ({ feature, result: evaluateFeature(feature, board) }))
        .filter((entry) => entry.result.matched);
    if (forbidden.length > 0) return null;

    const optional = template.canonicalPawnFeatures.optional.map((feature) =>
        evaluateFeature(feature, board),
    );
    const matchedOptional = optional.filter((feature) => feature.matched);

    const requiredScore = 0.24 + requiredRatio * 0.48 + Math.min(0.06, required.length * 0.008);
    const optionalScore =
        optional.length === 0 ? 0.06 : Math.min(0.2, (matchedOptional.length / optional.length) * 0.2);
    const stabilityScore = stabilityBonus(template.stability);
    const statusScore =
        implementationStatus === "full" ? 0.03 : implementationStatus === "partial" ? -0.02 : -0.08;
    const simplificationPenalty =
        board.totalPawns < 6 && template.stability !== "endgame_sensitive" ? 0.1 : 0;
    const fuzzyPenalty = requiredRatio < 0.99 ? (1 - requiredRatio) * 0.08 : 0;
    const broadPenalty = template.stability === "broad_family" ? 0.04 : 0;
    const siblingAdjustment = getSiblingAdjustment(template.id, board);

    const confidence = clamp01(
        requiredScore +
            optionalScore +
            stabilityScore +
            statusScore -
            simplificationPenalty -
            fuzzyPenalty -
            broadPenalty +
            siblingAdjustment,
    );

    const requiredEvidence = required
        .filter((feature) => feature.matched)
        .map((feature) => feature.evidence);
    const missingRequiredEvidence = required
        .filter((feature) => !feature.matched)
        .map((feature) => `Missing or unclear: ${feature.evidence}`);
    const optionalEvidence = matchedOptional.slice(0, 4).map((feature) => feature.evidence);
    const matchedForbidden = forbidden.map((entry) => entry.result.evidence);

    return {
        structureId: template.id,
        canonicalName: template.canonicalName,
        confidence,
        sideRoles: {
            primarySide: board.primarySide,
            primaryRole: template.sideRoles?.primarySideRole,
            opposingSide: board.opposingSide,
            opposingRole: template.sideRoles?.opposingSideRole,
        },
        evidence: uniqueStrings([
            ...requiredEvidence,
            ...optionalEvidence,
            ...missingRequiredEvidence.slice(0, 2),
        ]).slice(0, 7),
        typicalPlans: template.templateLogic?.typicalPawnBreaks?.slice(0, 5),
        matchedTemplate: template.id,
        matchedOrientation: orientationLabel(board.primarySide, board.fileMirrored),
        fileMirrored: board.fileMirrored,
        implementationStatus,
        requiredEvidence,
        optionalEvidence,
        matchedForbidden,
        rawScore: confidence,
    };
}

function evaluateFeature(feature: string, board: NormalizedPawnBoard): FeatureEvaluation {
    const normalizedFeature = feature.trim();
    const { kind, sidePart, descriptorPart } = splitFeature(normalizedFeature);
    const side = sidePart as PawnStructureTemplateSide | "both";
    const descriptor = descriptorPart.trim();

    if (kind === "pawn") {
        return featureResult(
            normalizedFeature,
            evaluatePawnDescriptor(side as PawnStructureTemplateSide, descriptor, board),
            board,
        );
    }
    if (kind === "noPawn") {
        return featureResult(
            normalizedFeature,
            !evaluatePawnDescriptor(side as PawnStructureTemplateSide, descriptor, board),
            board,
        );
    }
    if (kind === "noPawnOnFile") {
        return featureResult(
            normalizedFeature,
            evaluateFileAlternatives(side as PawnStructureTemplateSide, descriptor, board, (file) =>
                !board.files[side as PawnStructureTemplateSide].has(file),
            ),
            board,
        );
    }
    if (kind === "semiOpenFile") {
        return featureResult(
            normalizedFeature,
            evaluateFileAlternatives(side as PawnStructureTemplateSide, descriptor, board, (file) => {
                const role = side as PawnStructureTemplateSide;
                const other = oppositeRole(role);
                return !board.files[role].has(file) && board.files[other].has(file);
            }),
            board,
        );
    }
    if (kind === "openFile") {
        return featureResult(
            normalizedFeature,
            evaluateFileAlternatives("primary", sidePart, board, (file) => !board.allFiles.has(file)),
            board,
        );
    }
    if (kind === "openOrSemiOpenFile") {
        return featureResult(
            normalizedFeature,
            evaluateFileAlternatives(side as PawnStructureTemplateSide, descriptor, board, (file) => {
                const role = side as PawnStructureTemplateSide;
                return !board.files[role].has(file);
            }),
            board,
        );
    }
    if (kind === "adjacentPawnPair") {
        return featureResult(
            normalizedFeature,
            descriptor
                .split("+")
                .every((square) => hasPawn(side as PawnStructureTemplateSide, square, board)),
            board,
        );
    }
    if (kind === "onlyPawn") {
        const [square, without] = descriptor.split(/\s+without\s+/);
        return featureResult(
            normalizedFeature,
            hasPawn(side as PawnStructureTemplateSide, square, board) &&
                (!without || !hasPawn(side as PawnStructureTemplateSide, without, board)),
            board,
        );
    }
    if (kind === "breakCandidate") {
        return featureResult(
            normalizedFeature,
            evaluateBreakCandidate(side as PawnStructureTemplateSide, descriptor, board),
            board,
        );
    }
    if (kind === "captureCandidate") {
        return featureResult(
            normalizedFeature,
            evaluateCaptureCandidate(side as PawnStructureTemplateSide, descriptor, board),
            board,
        );
    }
    if (kind === "tension") {
        return featureResult(normalizedFeature, evaluateTension(descriptor, board), board);
    }
    if (kind === "locked") {
        return featureResult(normalizedFeature, evaluateLocked(descriptor, board), board);
    }
    if (kind === "outpost" || kind === "hole" || kind === "blockadeSquare" || kind === "pressureTarget") {
        return featureResult(
            normalizedFeature,
            evaluateStrategicSquare(kind, side as PawnStructureTemplateSide, descriptor, board),
            board,
        );
    }
    if (kind === "queensideMajority") {
        return featureResult(
            normalizedFeature,
            wingCount(side as PawnStructureTemplateSide, "queenside", board) >=
                wingCount(oppositeRole(side as PawnStructureTemplateSide), "queenside", board),
            board,
        );
    }
    if (kind === "pawnCountByWing") {
        return featureResult(normalizedFeature, evaluateWingCount(side, descriptor, board), board);
    }
    if (kind === "fewCentralPawns") {
        return featureResult(normalizedFeature, centralPawnCount(board) <= 4, board);
    }
    if (kind === "pieceCount") {
        return featureResult(normalizedFeature, board.pieceCount.totalNonKing <= 12, board);
    }
    if (kind === "openCentralFiles") {
        return featureResult(
            normalizedFeature,
            !board.allFiles.has("d") || !board.allFiles.has("e"),
            board,
        );
    }
    if (kind === "candidatePassedPawnRace") {
        return featureResult(
            normalizedFeature,
            Math.abs(
                wingCount("primary", "queenside", board) - wingCount("opposing", "queenside", board),
            ) >= 1 &&
                Math.abs(
                    wingCount("primary", "kingside", board) - wingCount("opposing", "kingside", board),
                ) >= 1,
            board,
        );
    }
    if (kind === "lockedChain") {
        return featureResult(normalizedFeature, hasFrenchOrKidLockedChain(board), board);
    }
    if (kind === "moreThanThreeCentralPawnsLocked") {
        return featureResult(normalizedFeature, centralPawnCount(board) > 3 && hasFrenchOrKidLockedChain(board), board);
    }

    return featureResult(normalizedFeature, false, board);
}

function requiredFeatureWeight(feature: string) {
    const { kind, descriptorPart } = splitFeature(feature);
    if (kind === "pawn" && /^[a-h][1-8](\|[a-h][1-8])*$/.test(descriptorPart)) return 1.15;
    if (kind === "pawn" && descriptorPart.includes("+")) return 1.2;
    if (kind === "noPawnOnFile") return 0.85;
    if (kind === "pawnCountByWing") return 0.9;
    return 1;
}

function minimumRequiredRatio(template: PawnStructureTemplate) {
    if (template.stability === "broad_family" || template.stability === "endgame_sensitive") {
        return 0.62;
    }
    if (template.stability === "transitional") return 0.66;
    const requiredCount = template.canonicalPawnFeatures.required.length;
    return requiredCount <= 3 ? 0.8 : 0.72;
}

function isPawnAnchorFeature(feature: string) {
    const { kind, descriptorPart } = splitFeature(feature);
    if (kind !== "pawn") return false;
    if (descriptorPart.endsWith("-file")) return false;
    if (descriptorPart.includes(" with ") || descriptorPart.includes(" without ")) return false;
    return /[a-h][1-8]/.test(descriptorPart);
}

function getSiblingAdjustment(structureId: string, board: NormalizedPawnBoard) {
    if (
        structureId === "caro_kann_formation" &&
        hasPawn("primary", "d4", board) &&
        !board.files.primary.has("c") &&
        !board.files.primary.has("e")
    ) {
        return -0.14;
    }
    if (
        structureId === "dragon_formation" &&
        hasPawn("primary", "c4", board) &&
        hasPawn("primary", "e4", board) &&
        !board.files.primary.has("d")
    ) {
        return -0.12;
    }
    if (
        structureId === "scheveningen_structure" &&
        hasPawn("primary", "c4", board) &&
        hasPawn("primary", "e4", board) &&
        !board.files.primary.has("d")
    ) {
        return -0.08;
    }
    if (
        structureId === "asymmetric_benoni" &&
        hasPawn("primary", "d5", board) &&
        hasPawn("primary", "e4", board) &&
        hasPawn("opposing", "c5", board) &&
        hasPawn("opposing", "d6", board) &&
        !hasPawn("opposing", "e5", board)
    ) {
        return 0.06;
    }
    if (
        structureId === "panov_structure" &&
        hasPawn("primary", "c5", board) &&
        hasPawn("primary", "d4", board) &&
        hasPawn("opposing", "d5", board)
    ) {
        return 0.05;
    }
    return 0;
}

function evaluatePawnDescriptor(
    side: PawnStructureTemplateSide,
    descriptor: string,
    board: NormalizedPawnBoard,
): boolean {
    const cleanDescriptor = descriptor
        .replace(/\s+with\s+no\s+central tension resolved$/, "")
        .replace(/\s+hanging pair$/, "");

    if (cleanDescriptor.includes(" with no ")) {
        const [base, missing] = cleanDescriptor.split(/\s+with no\s+/);
        return hasAnyPawnDescriptor(side, base, board) && !hasAnyPawnDescriptor(side, missing, board);
    }
    if (cleanDescriptor.includes(" without ")) {
        const [base, missing] = cleanDescriptor.split(/\s+without\s+/);
        return hasAnyPawnDescriptor(side, base, board) && !hasAnyPawnDescriptor(side, missing, board);
    }

    return hasAnyPawnDescriptor(side, cleanDescriptor, board);
}

function hasAnyPawnDescriptor(
    side: PawnStructureTemplateSide,
    descriptor: string,
    board: NormalizedPawnBoard,
): boolean {
    if (descriptor.includes("+")) {
        return descriptor.split("+").every((part) => hasAnyPawnDescriptor(side, part, board));
    }
    return descriptor.split("|").some((part) => hasPawn(side, part.trim(), board));
}

function hasPawn(
    side: PawnStructureTemplateSide,
    descriptor: string,
    board: NormalizedPawnBoard,
): boolean {
    const squareOrFile = descriptor.trim();
    if (squareOrFile.endsWith("-file")) {
        const file = parseFile(squareOrFile);
        return file ? board.files[side].has(file) : false;
    }
    if (/^[a-h][1-8]$/.test(squareOrFile)) {
        return board.pawns[side].has(squareOrFile);
    }
    return false;
}

function evaluateFileAlternatives(
    side: PawnStructureTemplateSide,
    descriptor: string,
    board: NormalizedPawnBoard,
    predicate: (file: FileName) => boolean,
) {
    return descriptor.split("|").some((part) => {
        const file = parseFile(part);
        return file ? predicate(file) : false;
    });
}

function evaluateBreakCandidate(
    side: PawnStructureTemplateSide,
    descriptor: string,
    board: NormalizedPawnBoard,
) {
    const steps = descriptor.split("-");
    if (steps.length < 2) return false;
    return steps.slice(0, -1).some((source) => hasPawn(side, source, board));
}

function evaluateCaptureCandidate(
    side: PawnStructureTemplateSide,
    descriptor: string,
    board: NormalizedPawnBoard,
) {
    const match = descriptor.match(/^([a-h][1-8])x([a-h][1-8])$/);
    if (!match) return false;
    return hasPawn(side, match[1], board) && hasPawn(oppositeRole(side), match[2], board);
}

function evaluateTension(descriptor: string, board: NormalizedPawnBoard) {
    const match = descriptor.match(/^(primary|opposing):([a-h][1-8])-vs-(primary|opposing):([a-h][1-8])$/);
    if (!match) return false;
    const leftSide = match[1] as PawnStructureTemplateSide;
    const rightSide = match[3] as PawnStructureTemplateSide;
    const leftSquare = match[2];
    const rightSquare = match[4];
    if (!hasPawn(leftSide, leftSquare, board) || !hasPawn(rightSide, rightSquare, board)) {
        return false;
    }
    const left = parseSquare(leftSquare);
    const right = parseSquare(rightSquare);
    if (!left || !right) return false;
    return Math.abs(fileIndex(left.file) - fileIndex(right.file)) === 1 && Math.abs(left.rank - right.rank) === 1;
}

function evaluateLocked(descriptor: string, board: NormalizedPawnBoard) {
    const match = descriptor.match(/^(primary|opposing):([a-h][1-8])-vs-(primary|opposing):([a-h][1-8])$/);
    if (!match) return false;
    const leftSide = match[1] as PawnStructureTemplateSide;
    const rightSide = match[3] as PawnStructureTemplateSide;
    const leftSquare = match[2];
    const rightSquare = match[4];
    if (!hasPawn(leftSide, leftSquare, board) || !hasPawn(rightSide, rightSquare, board)) {
        return false;
    }
    const left = parseSquare(leftSquare);
    const right = parseSquare(rightSquare);
    return !!left && !!right && left.file === right.file && Math.abs(left.rank - right.rank) === 1;
}

function evaluateStrategicSquare(
    kind: string,
    side: PawnStructureTemplateSide,
    square: string,
    board: NormalizedPawnBoard,
) {
    if (!/^[a-h][1-8]$/.test(square)) return false;
    const parsed = parseSquare(square);
    if (!parsed) return false;
    const other = oppositeRole(side);
    if (kind === "pressureTarget") {
        return hasPawn(side, square, board);
    }
    if (kind === "blockadeSquare") {
        const behindRank = side === "opposing" ? parsed.rank - 1 : parsed.rank + 1;
        return hasPawn(other, `${parsed.file}${behindRank}`, board) || !hasPawn(other, square, board);
    }
    const left = files[fileIndex(parsed.file) - 1];
    const right = files[fileIndex(parsed.file) + 1];
    const challengerRank = side === "primary" ? parsed.rank - 1 : parsed.rank + 1;
    const canBeChallenged =
        (left ? hasPawn(side, `${left}${challengerRank}`, board) : false) ||
        (right ? hasPawn(side, `${right}${challengerRank}`, board) : false);
    return !canBeChallenged;
}

function evaluateWingCount(
    side: PawnStructureTemplateSide | "both",
    descriptor: string,
    board: NormalizedPawnBoard,
) {
    if (side === "both") {
        return (
            wingCount("primary", "queenside", board) === wingCount("opposing", "queenside", board) &&
            wingCount("primary", "kingside", board) === wingCount("opposing", "kingside", board)
        );
    }
    const match = descriptor.match(/^(queenside|kingside)=(\d+)$/);
    if (!match) return false;
    return wingCount(side, match[1] as "queenside" | "kingside", board) === Number(match[2]);
}

function centralPawnCount(board: NormalizedPawnBoard) {
    let count = 0;
    for (const role of ["primary", "opposing"] as const) {
        for (const square of board.pawns[role]) {
            const parsed = parseSquare(square);
            if (parsed && ["c", "d", "e", "f"].includes(parsed.file)) count++;
        }
    }
    return count;
}

function hasFrenchOrKidLockedChain(board: NormalizedPawnBoard) {
    return (
        (hasPawn("primary", "d4", board) && hasPawn("opposing", "d5", board)) ||
        (hasPawn("primary", "d5", board) && hasPawn("opposing", "d6", board)) ||
        (hasPawn("primary", "e4", board) && hasPawn("opposing", "e5", board)) ||
        (hasPawn("primary", "e5", board) && hasPawn("opposing", "e6", board))
    );
}

function wingCount(
    side: PawnStructureTemplateSide,
    wing: "queenside" | "kingside",
    board: NormalizedPawnBoard,
) {
    const wingFiles = wing === "queenside" ? new Set(["a", "b", "c", "d"]) : new Set(["e", "f", "g", "h"]);
    let count = 0;
    for (const square of board.pawns[side]) {
        const parsed = parseSquare(square);
        if (parsed && wingFiles.has(parsed.file)) count++;
    }
    return count;
}

function featureResult(
    feature: string,
    matched: boolean,
    board: NormalizedPawnBoard,
): FeatureEvaluation {
    return {
        matched,
        evidence: describeFeature(feature, board),
    };
}

function describeFeature(feature: string, board: NormalizedPawnBoard) {
    const { kind, sidePart, descriptorPart } = splitFeature(feature);
    const role = sidePart === "opposing" ? "opposing" : "primary";
    const sideName = sideLabel(role, board);
    const descriptor = descriptorPart
        .replace(/\s+with\s+no\s+central tension resolved$/, "")
        .replace(/\s+hanging pair$/, "");

    if (kind === "pawn") {
        if (descriptor.includes("+")) {
            return `${sideName} pawns on ${descriptor
                .split("+")
                .map((square) => actualSquareLabel(square, role, board))
                .join(" and ")}`;
        }
        return `${sideName} pawn on ${actualDescriptorLabel(descriptor, role, board)}`;
    }
    if (kind === "noPawnOnFile") {
        return `${sideName} has no pawn on the ${actualDescriptorLabel(descriptor, role, board)}`;
    }
    if (kind === "noPawn") {
        return `${sideName} has no pawn on ${actualDescriptorLabel(descriptor, role, board)}`;
    }
    if (kind === "semiOpenFile") {
        return `${actualDescriptorLabel(descriptor, role, board)} is semi-open for ${sideName}`;
    }
    if (kind === "openFile") {
        return `${actualDescriptorLabel(sidePart, role, board)} is open`;
    }
    if (kind === "openOrSemiOpenFile") {
        return `${actualDescriptorLabel(descriptor, role, board)} is open or semi-open for ${sideName}`;
    }
    if (kind === "pawnCountByWing") {
        return `${sideName} wing pawn count matches ${descriptor}`;
    }
    if (kind === "breakCandidate" || kind === "captureCandidate") {
        return `${sideName} has structural ${descriptor.replaceAll("-", "-")}`;
    }
    if (kind === "tension") {
        return "Central pawn tension matches the template";
    }
    if (kind === "outpost" || kind === "hole" || kind === "blockadeSquare") {
        return `${sideName} has the ${actualSquareLabel(descriptor, role, board)} ${kind}`;
    }
    return feature;
}

function actualDescriptorLabel(
    descriptor: string,
    role: PawnStructureTemplateSide,
    board: NormalizedPawnBoard,
): string {
    if (descriptor.includes("|")) {
        return descriptor
            .split("|")
            .map((part) => actualDescriptorLabel(part, role, board))
            .join(" or ");
    }
    if (descriptor.endsWith("-file")) {
        const file = parseFile(descriptor);
        return file ? `${actualFile(file, board)}-file` : descriptor;
    }
    if (/^[a-h][1-8]$/.test(descriptor)) {
        return actualSquareLabel(descriptor, role, board);
    }
    return descriptor;
}

function actualSquareLabel(
    square: string,
    _role: PawnStructureTemplateSide,
    board: NormalizedPawnBoard,
) {
    const parsed = parseSquare(square);
    if (!parsed) return square;
    const file = actualFile(parsed.file, board);
    const rank = board.primarySide === "white" ? parsed.rank : 9 - parsed.rank;
    return `${file}${rank}`;
}

function actualFile(file: FileName, board: NormalizedPawnBoard) {
    return board.fileMirrored ? mirrorFile(file) : file;
}

function splitFeature(feature: string) {
    const parts = feature.split(":");
    return {
        kind: parts[0] ?? "",
        sidePart: parts[1] ?? "",
        descriptorPart: parts.slice(2).join(":"),
    };
}

function sideLabel(role: PawnStructureTemplateSide, board: NormalizedPawnBoard) {
    const side = role === "primary" ? board.primarySide : board.opposingSide;
    return side === "white" ? "White" : "Black";
}

function compareCandidates(a: PawnStructureCandidate, b: PawnStructureCandidate) {
    const confidenceDelta = b.confidence - a.confidence;
    if (Math.abs(confidenceDelta) > 0.0001) return confidenceDelta;
    return (disambiguationPriority.get(a.structureId) ?? 100) - (disambiguationPriority.get(b.structureId) ?? 100);
}

function isPreferredSibling(top: PawnStructureCandidate, second: PawnStructureCandidate) {
    const topPriority = disambiguationPriority.get(top.structureId) ?? 100;
    const secondPriority = disambiguationPriority.get(second.structureId) ?? 100;
    return topPriority < secondPriority && top.requiredEvidence.length >= second.requiredEvidence.length - 1;
}

function templateMinimum(structureId: string) {
    const template = templateFile.structures.find((item) => item.id === structureId);
    return template?.confidenceRules?.minimumConfidenceToShow ?? 0.7;
}

function isBroadOrTransitional(...structureIds: string[]) {
    return structureIds.some((id) => {
        const template = templateFile.structures.find((item) => item.id === id);
        return template?.stability === "broad_family" || template?.stability === "transitional";
    });
}

function stabilityBonus(stability: string) {
    if (stability === "stable") return 0.04;
    if (stability === "endgame_sensitive") return 0.02;
    if (stability === "transitional") return 0.01;
    return 0;
}

function orientationLabel(primarySide: PawnStructureSide, fileMirrored: boolean) {
    const colour = primarySide === "white" ? "canonical_white_primary" : "black_primary_colour_reversed";
    return fileMirrored ? `${colour}_file_mirrored` : colour;
}

function oppositeRole(side: PawnStructureTemplateSide): PawnStructureTemplateSide {
    return side === "primary" ? "opposing" : "primary";
}

function parseFile(value: string): FileName | null {
    const file = value.trim()[0] as FileName | undefined;
    return file && files.includes(file) ? file : null;
}

function parseSquare(value: string): { file: FileName; rank: number } | null {
    const match = value.match(/^([a-h])([1-8])$/);
    if (!match) return null;
    return {
        file: match[1] as FileName,
        rank: Number(match[2]),
    };
}

function fileIndex(file: FileName) {
    return files.indexOf(file);
}

function mirrorFile(file: FileName): FileName {
    return files[7 - fileIndex(file)];
}

function uniqueStrings(values: string[]) {
    return [...new Set(values.filter(Boolean))];
}

function clamp01(value: number) {
    return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}
