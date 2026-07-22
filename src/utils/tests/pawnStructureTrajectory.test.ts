import { describe, expect, test } from "vitest";
import templateData from "@/data/pawnStructureTemplates.v1.json";
import {
    analysePawnStructureTrajectoryFromTree,
    collectMainLineSamples,
} from "@/utils/pawnStructureTrajectory";
import type { PawnStructureTemplateFile } from "@/utils/pawnStructureTypes";
import type { TreeNode } from "@/utils/treeReducer";

const templates = templateData as PawnStructureTemplateFile;

const fenById = new Map(
    templates.structures.map((structure) => [structure.id, structure.syntheticFenExamples![0].fen]),
);

describe("pawn structure trajectory", () => {
    test("collects main-line samples from the configured move range", () => {
        const root = line([
            fenById.get("carlsbad_formation")!,
            fenById.get("carlsbad_formation")!,
            fenById.get("isolani")!,
        ]);

        const samples = collectMainLineSamples(root, { fromPly: 12, toPly: 14 });

        expect(samples).toHaveLength(3);
        expect(samples.map((sample) => sample.detection?.structureId)).toEqual([
            "carlsbad_formation",
            "carlsbad_formation",
            "isolani",
        ]);
    });

    test("groups consecutive detections into trajectory segments", () => {
        const root = line([
            ...repeatFen("carlsbad_formation", 5),
            ...repeatFen("isolani", 5),
        ]);

        const trajectory = analysePawnStructureTrajectoryFromTree(root, {
            fromPly: 12,
            toPly: 21,
        });

        expect(trajectory.segments.map((segment) => segment.structureId)).toEqual([
            "carlsbad_formation",
            "isolani",
        ]);
        expect(trajectory.transitions).toHaveLength(1);
        expect(trajectory.primaryStructure?.structureId).toBeTruthy();
        expect(trajectory.story).toContain("shaped");
    });

    test("suppresses one-ply structural flicker", () => {
        const root = line([
            ...repeatFen("carlsbad_formation", 4),
            fenById.get("isolani")!,
            ...repeatFen("carlsbad_formation", 4),
        ]);

        const trajectory = analysePawnStructureTrajectoryFromTree(root, {
            fromPly: 12,
            toPly: 20,
        });

        expect(trajectory.segments).toHaveLength(1);
        expect(trajectory.segments[0].structureId).toBe("carlsbad_formation");
        expect(trajectory.transitions).toHaveLength(0);
    });

    test("keeps secondary structures when they explain a meaningful phase", () => {
        const root = line([
            ...repeatFen("lopez_formation", 4),
            ...repeatFen("closed_ruy_lopez", 10),
            ...repeatFen("open_kid", 4),
        ]);

        const trajectory = analysePawnStructureTrajectoryFromTree(root, {
            fromPly: 12,
            toPly: 29,
        });

        expect(trajectory.primaryStructure?.structureId).toBe("closed_ruy_lopez");
        expect(trajectory.secondaryStructures.map((structure) => structure.structureId)).toEqual(
            expect.arrayContaining(["lopez_formation", "open_kid"]),
        );
        expect(trajectory.transitions.length).toBeGreaterThanOrEqual(2);
    });
});

function repeatFen(structureId: string, count: number) {
    return Array.from({ length: count }, () => fenById.get(structureId)!);
}

function line(fens: string[], startPly = 12): TreeNode {
    const root = node(fens[0], startPly, null);
    let current = root;
    for (let index = 1; index < fens.length; index++) {
        const child = node(fens[index], startPly + index, index % 2 === 0 ? "d5" : "...d5");
        current.children.push(child);
        current = child;
    }
    return root;
}

function node(fen: string, halfMoves: number, san: string | null): TreeNode {
    return {
        fen,
        move: null,
        san,
        children: [],
        score: null,
        depth: null,
        halfMoves,
        shapes: [],
        annotations: [],
        comment: "",
    };
}
