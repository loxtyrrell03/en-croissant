import type { TreeNode } from "./treeReducer";

export type PawnStructureSide = "white" | "black";

export type PawnStructureImplementationStatus =
    | "full"
    | "partial"
    | "scaffolded"
    | "disabled";

export type PawnStructureDetection = {
    structureId: string;
    canonicalName: string;
    confidence: number;
    sideRoles: {
        primarySide?: PawnStructureSide;
        primaryRole?: string;
        opposingSide?: PawnStructureSide;
        opposingRole?: string;
    };
    evidence: string[];
    typicalPlans?: string[];
    matchedTemplate?: string;
    matchedOrientation?: string;
    fileMirrored?: boolean;
    implementationStatus?: PawnStructureImplementationStatus;
};

export type PawnStructureCandidate = PawnStructureDetection & {
    requiredEvidence: string[];
    optionalEvidence: string[];
    matchedForbidden: string[];
    rawScore: number;
};

export type PawnStructureTemplateSide = "primary" | "opposing";

export type PawnStructureTemplate = {
    id: string;
    canonicalName: string;
    bookSectionOrFamily: string;
    aliases?: string[];
    descriptionShort?: string;
    stability: "stable" | "transitional" | "broad_family" | "endgame_sensitive" | string;
    sideRoles?: {
        primarySideRole?: string;
        opposingSideRole?: string;
    };
    canonicalPawnFeatures: {
        required: string[];
        optional: string[];
        forbidden: string[];
    };
    templateLogic?: {
        corePawnSkeleton?: string[];
        typicalPawnBreaks?: string[];
        typicalTransformations?: string[];
    };
    colourAndMirrorHandling?: {
        allowColourReverse?: boolean;
        allowFileMirror?: boolean;
        allowRankMirror?: boolean;
    };
    confidenceRules?: {
        minimumConfidenceToShow?: number;
    };
    syntheticFenExamples?: {
        fen: string;
        expectedRole?: string;
        expectedDetection?: string;
        notes?: string;
    }[];
    antiExamples?: {
        fen: string;
        shouldNotDetectAs?: string;
        reason?: string;
    }[];
};

export type PawnStructureTemplateFile = {
    schemaVersion: string;
    structures: PawnStructureTemplate[];
};

export type StructureSegment = {
    structureId: string | null;
    canonicalName: string | null;
    fromPly: number;
    toPly: number;
    fromMove: number;
    toMove: number;
    averageConfidence: number;
    evidence: string[];
    story?: string;
    fromPath?: number[];
    toPath?: number[];
    implementationStatus?: PawnStructureImplementationStatus;
};

export type PawnStructureTransition = {
    ply: number;
    moveNumber: number;
    san?: string;
    fromStructureId: string | null;
    toStructureId: string | null;
    reason: string;
};

export type PawnStructureTrajectory = {
    primaryStructure: PawnStructureDetection | null;
    secondaryStructures: PawnStructureDetection[];
    segments: StructureSegment[];
    transitions: PawnStructureTransition[];
    story: string;
};

export type PawnStructureTrajectoryOptions = {
    fromPly?: number;
    toPly?: number;
    minimumSegmentPlies?: number;
};

export type PawnStructureLineSample = {
    node: TreeNode;
    path: number[];
    ply: number;
    moveNumber: number;
    san?: string;
    detection: PawnStructureDetection | null;
};
