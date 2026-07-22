import { parsePGN } from "./chess";
import { detectPawnStructure, getPawnStructureTemplates } from "./pawnStructureDetector";
import type {
    PawnStructureDetection,
    PawnStructureLineSample,
    PawnStructureTrajectory,
    PawnStructureTrajectoryOptions,
    StructureSegment,
} from "./pawnStructureTypes";
import type { TreeNode, TreeState } from "./treeReducer";

type SegmentScore = {
    segment: StructureSegment;
    score: number;
    detection: PawnStructureDetection | null;
};

const defaultOptions = {
    fromPly: 12,
    toPly: 80,
    minimumSegmentPlies: 3,
};

export async function analysePawnStructureTrajectory(
    pgnOrTree: string | TreeState | TreeNode,
    options?: PawnStructureTrajectoryOptions,
): Promise<PawnStructureTrajectory> {
    if (typeof pgnOrTree === "string") {
        const tree = await parsePGN(pgnOrTree);
        return analysePawnStructureTrajectoryFromTree(tree.root, options);
    }

    return analysePawnStructureTrajectoryFromTree(
        "root" in pgnOrTree ? pgnOrTree.root : pgnOrTree,
        options,
    );
}

export function analysePawnStructureTrajectoryFromTree(
    root: TreeNode,
    options?: PawnStructureTrajectoryOptions,
): PawnStructureTrajectory {
    const resolved = { ...defaultOptions, ...options };
    const samples = collectMainLineSamples(root, resolved);
    if (samples.length === 0) {
        return {
            primaryStructure: null,
            secondaryStructures: [],
            segments: [],
            transitions: [],
            story: "No stable pawn structure was detected in the analysed move range.",
        };
    }

    const labels = smoothSampleLabels(samples, resolved.minimumSegmentPlies);
    const segments = buildSegments(samples, labels);
    const transitions = buildTransitions(samples, segments);
    const scored = scoreSegments(segments, samples, transitions);
    const primary = choosePrimaryStructure(scored);
    const secondary = chooseSecondaryStructures(scored, primary);
    const story = buildTrajectoryStory(primary, secondary, segments, transitions);

    return {
        primaryStructure: primary?.detection ?? null,
        secondaryStructures: secondary.map((item) => item.detection).filter(nonNullable),
        segments,
        transitions,
        story,
    };
}

export function collectMainLineSamples(
    root: TreeNode,
    options?: PawnStructureTrajectoryOptions,
): PawnStructureLineSample[] {
    const resolved = { ...defaultOptions, ...options };
    const samples: PawnStructureLineSample[] = [];
    let node: TreeNode | undefined = root;
    let path: number[] = [];

    while (node) {
        const ply = node.halfMoves;
        if (ply >= resolved.fromPly && ply <= resolved.toPly) {
            samples.push({
                node,
                path: [...path],
                ply,
                moveNumber: plyToMove(ply),
                san: node.san ?? undefined,
                detection: detectPawnStructure(node.fen),
            });
        }

        if (ply > resolved.toPly || node.children.length === 0) break;
        node = node.children[0];
        path = [...path, 0];
    }

    return samples;
}

function smoothSampleLabels(samples: PawnStructureLineSample[], minimumSegmentPlies: number) {
    const labels = samples.map((sample) => sample.detection?.structureId ?? null);
    const rawSegments = groupLabelIndexes(labels);
    const smoothed = [...labels];

    for (const segment of rawSegments) {
        const length = segment.to - segment.from + 1;
        if (length >= minimumSegmentPlies) continue;

        const prev = rawSegments.find((candidate) => candidate.to === segment.from - 1);
        const next = rawSegments.find((candidate) => candidate.from === segment.to + 1);
        const label = segment.label;

        if (prev && next && prev.label === next.label) {
            fillLabels(smoothed, segment.from, segment.to, prev.label);
            continue;
        }

        if (label !== null) {
            const confidence = averageConfidence(samples, segment.from, segment.to);
            const strongTransformation = confidence >= 0.86 && length >= 2;
            if (!strongTransformation) {
                fillLabels(smoothed, segment.from, segment.to, null);
            }
        }
    }

    let merged = groupLabelIndexes(smoothed);
    for (const segment of merged) {
        if (segment.label !== null) continue;
        const length = segment.to - segment.from + 1;
        if (length >= 4) continue;

        const prev = merged.find((candidate) => candidate.to === segment.from - 1);
        const next = merged.find((candidate) => candidate.from === segment.to + 1);
        if (prev && next && prev.label === next.label) {
            fillLabels(smoothed, segment.from, segment.to, prev.label);
        }
    }

    merged = groupLabelIndexes(smoothed);
    return smoothed;
}

function buildSegments(
    samples: PawnStructureLineSample[],
    labels: (string | null)[],
): StructureSegment[] {
    const groups = groupLabelIndexes(labels);
    return groups.map((group) => {
        const groupSamples = samples.slice(group.from, group.to + 1);
        const detections = groupSamples.map((sample) => sample.detection).filter(nonNullable);
        const representative = chooseRepresentativeDetection(detections, group.label);
        const avgConfidence = representative
            ? average(
                  groupSamples
                      .filter((sample) => sample.detection?.structureId === group.label)
                      .map((sample) => sample.detection?.confidence ?? 0),
              )
            : 0;
        const evidence = representative
            ? uniqueStrings(detections.flatMap((detection) => detection.evidence)).slice(0, 5)
            : [];
        const segment: StructureSegment = {
            structureId: group.label,
            canonicalName: representative?.canonicalName ?? null,
            fromPly: groupSamples[0].ply,
            toPly: groupSamples[groupSamples.length - 1].ply,
            fromMove: groupSamples[0].moveNumber,
            toMove: groupSamples[groupSamples.length - 1].moveNumber,
            averageConfidence: Number(avgConfidence.toFixed(3)),
            evidence,
            fromPath: groupSamples[0].path,
            toPath: groupSamples[groupSamples.length - 1].path,
            implementationStatus: representative?.implementationStatus,
        };
        return {
            ...segment,
            story: buildSegmentStory(segment, representative),
        };
    });
}

function buildTransitions(samples: PawnStructureLineSample[], segments: StructureSegment[]) {
    const transitions: PawnStructureTrajectory["transitions"] = [];
    for (let index = 1; index < segments.length; index++) {
        const previous = segments[index - 1];
        const current = segments[index];
        if (previous.structureId === current.structureId) continue;

        const sample =
            samples.find((entry) => entry.ply >= current.fromPly) ?? samples[samples.length - 1];
        transitions.push({
            ply: current.fromPly,
            moveNumber: current.fromMove,
            san: sample?.san,
            fromStructureId: previous.structureId,
            toStructureId: current.structureId,
            reason: transitionReason(previous, current),
        });
    }
    return transitions;
}

function scoreSegments(
    segments: StructureSegment[],
    samples: PawnStructureLineSample[],
    transitions: PawnStructureTrajectory["transitions"],
): SegmentScore[] {
    return segments
        .filter((segment) => segment.structureId !== null)
        .map((segment) => {
            const detection = bestDetectionForSegment(segment, samples);
            const durationMoves = Math.max(1, (segment.toPly - segment.fromPly + 1) / 2);
            const durationWeight = Math.min(25, durationMoves * 1.2);
            const middlegameRelevanceWeight = middlegameOverlap(segment.fromPly, segment.toPly) * 20;
            const confidenceWeight = segment.averageConfidence * 20;
            const stabilityWeight = stabilityWeightFor(segment.structureId);
            const transformationWeight = transitions.some(
                (transition) =>
                    transition.fromStructureId === segment.structureId ||
                    transition.toStructureId === segment.structureId,
            )
                ? 6
                : 0;
            const flickerPenalty = durationMoves < 2 ? 8 : 0;
            const endgamePenalty = segment.fromPly > 70 && durationMoves < 6 ? 5 : 0;

            return {
                segment,
                detection,
                score:
                    durationWeight +
                    middlegameRelevanceWeight +
                    confidenceWeight +
                    stabilityWeight +
                    transformationWeight -
                    flickerPenalty -
                    endgamePenalty,
            };
        })
        .sort((a, b) => b.score - a.score);
}

function choosePrimaryStructure(scored: SegmentScore[]) {
    const [first, second] = scored;
    if (!first) return null;
    if (!second) return first;

    if (first.score >= second.score * 1.1) return first;
    if (isParentChildPair(first.segment.structureId, second.segment.structureId)) {
        return moreSpecific(first, second);
    }
    return first;
}

function chooseSecondaryStructures(scored: SegmentScore[], primary: SegmentScore | null) {
    if (!primary) return [];
    const seen = new Set([primary.segment.structureId]);
    return scored
        .filter((item) => {
            if (!item.detection || seen.has(item.segment.structureId)) return false;
            if (item.score < primary.score * 0.3) return false;
            seen.add(item.segment.structureId);
            return true;
        })
        .slice(0, 3);
}

function buildTrajectoryStory(
    primary: SegmentScore | null,
    secondary: SegmentScore[],
    segments: StructureSegment[],
    transitions: PawnStructureTrajectory["transitions"],
) {
    if (!primary?.detection) {
        return "No stable pawn structure dominated the analysed middlegame; the centre stayed unresolved, liquidated early, or did not match a reliable template.";
    }

    const primarySegment = primary.segment;
    const roleText = formatStructureRole(primary.detection);
    const openingSegment = segments.find((segment) => segment.structureId !== null);
    const transition = transitions.find(
        (item) =>
            item.fromStructureId === primarySegment.structureId ||
            item.toStructureId === primarySegment.structureId,
    );
    const secondaryText =
        secondary.length > 0
            ? ` Secondary phases included ${secondary
                  .map((item) => item.detection?.canonicalName)
                  .filter(Boolean)
                  .join(", ")}.`
            : "";
    const transitionText = transition?.san
        ? ` The key structural change came around ${transition.moveNumber}${transition.ply % 2 === 0 ? "..." : "."} ${transition.san}.`
        : transition
          ? ` The key structural change came around move ${transition.moveNumber}.`
          : "";
    const startText =
        openingSegment && openingSegment.structureId !== primarySegment.structureId
            ? `The game first showed ${openingSegment.canonicalName} from moves ${openingSegment.fromMove}-${openingSegment.toMove}, then settled into ${primary.detection.canonicalName}.`
            : `Primary structure: ${primary.detection.canonicalName}.`;

    return `${startText} ${roleText} shaped the main phase from moves ${primarySegment.fromMove}-${primarySegment.toMove}.${transitionText}${secondaryText}`.replace(
        /\s+/g,
        " ",
    );
}

export function formatStructureRole(detection: PawnStructureDetection | null) {
    if (!detection?.sideRoles.primarySide) return "The structural roles are unclear";
    const side = detection.sideRoles.primarySide === "white" ? "White" : "Black";
    const role = formatPrimaryRole(detection.sideRoles.primaryRole);
    if (!role) return `${side} has the primary structural role`;
    return `${side} ${role}`;
}

function formatPrimaryRole(role?: string) {
    if (!role) return "";
    const labels: Record<string, string> = {
        side_with_iqp: "has the IQP",
        side_with_hanging_pawns: "has the hanging pawns",
        side_with_three_three_split: "has the 3-3 split",
        side_with_maroczy_bind: "has the Maroczy bind",
        side_playing_against_dragon_shell: "plays against the Dragon shell",
        side_attacking_scheveningen_centre: "attacks the Scheveningen centre",
        side_with_stonewall_chain: "has the Stonewall chain",
        side_with_broad_centre: "has the broad centre",
        side_with_space_after_c_file_exchange: "has the KID Type I space",
        side_with_benko_centre: "has the Benko centre",
        side_with_closed_spanish_space: "has the closed Spanish space",
        side_with_mobile_spanish_centre: "has the mobile Spanish centre",
        side_with_c4_e4_open_kid_centre: "has the open KID centre",
    };
    if (labels[role]) return labels[role];
    if (role.startsWith("side_with_")) {
        return `has the ${role.slice("side_with_".length).replaceAll("_", " ")}`;
    }
    if (role.startsWith("side_playing_")) {
        return role.slice("side_playing_".length).replaceAll("_", " ").replace(/^/, "plays ");
    }
    if (role.startsWith("side_attacking_")) {
        return `attacks the ${role.slice("side_attacking_".length).replaceAll("_", " ")}`;
    }
    return role.replace(/^side_/, "").replaceAll("_", " ");
}

function buildSegmentStory(
    segment: StructureSegment,
    detection: PawnStructureDetection | null,
) {
    if (!detection) {
        return `Unknown or messy structure from moves ${segment.fromMove}-${segment.toMove}.`;
    }
    return `${detection.canonicalName} from moves ${segment.fromMove}-${segment.toMove}; ${formatStructureRole(
        detection,
    ).toLowerCase()}.`;
}

function transitionReason(previous: StructureSegment, current: StructureSegment) {
    const from = previous.canonicalName ?? "unknown structure";
    const to = current.canonicalName ?? "unknown structure";
    if (current.structureId === null) {
        return `The ${from} pawn skeleton dissolved or became too ambiguous to label confidently.`;
    }
    if (previous.structureId === null) {
        return `A stable ${to} pawn skeleton emerged from an earlier unclear phase.`;
    }
    return `The dominant pawn skeleton changed from ${from} to ${to}.`;
}

function bestDetectionForSegment(segment: StructureSegment, samples: PawnStructureLineSample[]) {
    return samples
        .filter(
            (sample) =>
                sample.ply >= segment.fromPly &&
                sample.ply <= segment.toPly &&
                sample.detection?.structureId === segment.structureId,
        )
        .map((sample) => sample.detection)
        .filter(nonNullable)
        .sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

function chooseRepresentativeDetection(
    detections: PawnStructureDetection[],
    structureId: string | null,
) {
    if (!structureId) return null;
    return detections
        .filter((detection) => detection.structureId === structureId)
        .sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

function groupLabelIndexes(labels: (string | null)[]) {
    const groups: { label: string | null; from: number; to: number }[] = [];
    for (let index = 0; index < labels.length; index++) {
        const label = labels[index];
        const last = groups[groups.length - 1];
        if (last && last.label === label) {
            last.to = index;
        } else {
            groups.push({ label, from: index, to: index });
        }
    }
    return groups;
}

function fillLabels(
    labels: (string | null)[],
    from: number,
    to: number,
    label: string | null,
) {
    for (let index = from; index <= to; index++) {
        labels[index] = label;
    }
}

function averageConfidence(samples: PawnStructureLineSample[], from: number, to: number) {
    return average(samples.slice(from, to + 1).map((sample) => sample.detection?.confidence ?? 0));
}

function average(values: number[]) {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function plyToMove(ply: number) {
    return Math.max(1, Math.ceil(ply / 2));
}

function middlegameOverlap(fromPly: number, toPly: number) {
    const from = Math.max(fromPly, 16);
    const to = Math.min(toPly, 70);
    if (to < from) return 0.2;
    const segmentLength = Math.max(1, toPly - fromPly + 1);
    return Math.min(1, (to - from + 1) / segmentLength);
}

function stabilityWeightFor(structureId: string | null) {
    const template = getPawnStructureTemplates().find((item) => item.id === structureId);
    if (template?.stability === "stable") return 8;
    if (template?.stability === "endgame_sensitive") return 6;
    if (template?.stability === "transitional") return 3;
    return 1;
}

function isParentChildPair(first: string | null, second: string | null) {
    return (
        (first === "kid_complex" && second?.startsWith("kid_type_")) ||
        (second === "kid_complex" && first?.startsWith("kid_type_")) ||
        (first === "lopez_formation" && second === "closed_ruy_lopez") ||
        (second === "lopez_formation" && first === "closed_ruy_lopez")
    );
}

function moreSpecific(first: SegmentScore, second: SegmentScore) {
    if (first.segment.structureId === "kid_complex" || first.segment.structureId === "lopez_formation") {
        return second;
    }
    return first;
}

function uniqueStrings(values: string[]) {
    return [...new Set(values.filter(Boolean))];
}

function nonNullable<T>(value: T | null | undefined): value is T {
    return value !== null && value !== undefined;
}
