import { describe, expect, test } from "vitest";
import templateData from "@/data/pawnStructureTemplates.v1.json";
import {
    detectPawnStructure,
    extractPawnStructureFeatures,
    getPawnStructureImplementationStatus,
} from "@/utils/pawnStructureDetector";
import type { PawnStructureTemplateFile } from "@/utils/pawnStructureTypes";

const templates = templateData as PawnStructureTemplateFile;

describe("pawn structure detector", () => {
    test("extracts pawns from FEN by colour, file, and rank", () => {
        const features = extractPawnStructureFeatures(
            "6k1/pp3ppp/2p1p3/8/3P4/8/PP3PPP/6K1 w - - 0 1",
        );

        expect(features?.pawns).toEqual(
            expect.arrayContaining([
                { side: "white", file: "d", rank: 4, square: "d4" },
                { side: "black", file: "c", rank: 6, square: "c6" },
                { side: "black", file: "e", rank: 6, square: "e6" },
            ]),
        );
    });

    test.each(templates.structures.map((structure) => [structure.id, structure] as const))(
        "detects canonical %s skeleton",
        (_id, structure) => {
            const example = structure.syntheticFenExamples?.[0];
            expect(example).toBeTruthy();

            const detection = detectPawnStructure(example!.fen);
            expect(detection?.structureId).toBe(structure.id);
            expect(detection?.confidence ?? 0).toBeGreaterThanOrEqual(
                structure.confidenceRules?.minimumConfidenceToShow ?? 0.7,
            );
            expect(detection?.implementationStatus).toBe("full");
            expect(getPawnStructureImplementationStatus(structure.id)).toBe("full");
            expect(detection?.evidence.length ?? 0).toBeGreaterThan(0);
        },
    );

    test.each(templates.structures.map((structure) => [structure.id, structure] as const))(
        "detects colour-reversed %s skeleton",
        (_id, structure) => {
            const example = structure.syntheticFenExamples?.[0];
            expect(example).toBeTruthy();

            const detection = detectPawnStructure(colourReverseFen(example!.fen));
            expect(detection?.structureId).toBe(structure.id);
            expect(detection?.sideRoles.primarySide).toBe("black");
            expect(detection?.matchedOrientation).toContain("black_primary_colour_reversed");
        },
    );

    test("detects file-mirrored IQP when the template allows file mirroring", () => {
        const detection = detectPawnStructure(
            "6k1/pp3ppp/3p1p2/8/4P3/8/PP4PP/6K1 w - - 0 1",
        );

        expect(detection?.structureId).toBe("isolani");
        expect(detection?.fileMirrored).toBe(true);
    });

    test("detects the Open KID after ...exd4 leaves the d6 residue", () => {
        const detection = detectPawnStructure(
            "4k3/ppp2ppp/3p4/8/2P1P3/8/PP3PPP/4K3 w - - 0 1",
        );

        expect(detection?.structureId).toBe("open_kid");
        expect(detection?.sideRoles.primarySide).toBe("white");
        expect(detection?.confidence ?? 0).toBeGreaterThanOrEqual(0.72);
        expect(detection?.evidence.join(" ")).toContain("d6");
    });

    test("detects colour-reversed Open KID after the central exchange", () => {
        const detection = detectPawnStructure(
            colourReverseFen("4k3/ppp2ppp/3p4/8/2P1P3/8/PP3PPP/4K3 w - - 0 1"),
        );

        expect(detection?.structureId).toBe("open_kid");
        expect(detection?.sideRoles.primarySide).toBe("black");
    });

    test("does not pull a Maroczy/Sicilian shell into Open KID without the KID c-pawn context", () => {
        const detection = detectPawnStructure(
            "6k1/pp3ppp/3p4/8/2P1P3/8/PP3PPP/6K1 w - - 0 1",
        );

        expect(detection?.structureId).not.toBe("open_kid");
    });

    test("detects KID Type I only after the c-file exchange has happened", () => {
        const detection = detectPawnStructure(
            "4k3/pp3ppp/3p4/3Pp3/4P3/8/PP3PPP/4K3 w - - 0 1",
        );

        expect(detection?.structureId).toBe("kid_type_i");
        expect(detection?.sideRoles.primarySide).toBe("white");
        expect(detection?.evidence.join(" ")).toContain("c-file");
    });

    test("detects colour-reversed KID Type I after the c-file exchange", () => {
        const detection = detectPawnStructure(
            colourReverseFen("4k3/pp3ppp/3p4/3Pp3/4P3/8/PP3PPP/4K3 w - - 0 1"),
        );

        expect(detection?.structureId).toBe("kid_type_i");
        expect(detection?.sideRoles.primarySide).toBe("black");
    });

    test("does not call the pre-exchange ...c6 KID position Type I", () => {
        const detection = detectPawnStructure(
            "4k3/pp3ppp/2pp4/3Pp3/2P1P3/8/PP3PPP/4K3 w - - 0 1",
        );

        expect(detection?.structureId).not.toBe("kid_type_i");
    });

    test.each([
        [
            "symmetric_benoni",
            "4k3/pp3ppp/3p4/2pP4/2P5/8/PP3PPP/4K3 w - - 0 1",
        ],
        [
            "kid_complex",
            "4k3/pp3ppp/2pp4/4p3/2PPP3/8/PP3PPP/4K3 w - - 0 1",
        ],
        [
            "benko_structure",
            "4k3/4pp1p/3p2p1/2pP4/4P3/8/PP3PPP/4K3 w - - 0 1",
        ],
    ] as const)("detects calibrated %s skeleton", (structureId, fen) => {
        expect(detectPawnStructure(fen)?.structureId).toBe(structureId);
    });

    test("detects the c-pawn-exchanged Asymmetric Benoni skeleton", () => {
        const detection = detectPawnStructure(
            "4k3/pp3ppp/3p4/2pP4/4P3/8/PP3PPP/4K3 w - - 0 1",
        );

        expect(detection?.structureId).toBe("asymmetric_benoni");
        expect(detection?.sideRoles.primarySide).toBe("white");
        expect(detection?.evidence.join(" ")).toContain("c-file");
    });

    test("does not call the c4 Benoni skeleton Asymmetric Benoni", () => {
        const detection = detectPawnStructure(
            "4k3/pp3ppp/3p4/2pP4/2P1P3/8/PP3PPP/4K3 w - - 0 1",
        );

        expect(detection?.structureId).not.toBe("asymmetric_benoni");
    });

    test.each([
        [
            "french_type_i",
            "4k3/ppp3pp/4p3/3p4/3P4/8/PPP2PPP/4K3 w - - 0 1",
        ],
        [
            "french_type_ii",
            "4k3/pp3ppp/4p3/3pP3/8/2P5/PP3PPP/4K3 w - - 0 1",
        ],
        [
            "french_type_iii",
            "4k3/ppp2ppp/4p3/3pP3/3P4/8/PPP2PPP/4K3 w - - 0 1",
        ],
        [
            "scheveningen_structure",
            "4k3/pp3ppp/3pp3/8/4P3/8/PPP2PPP/4K3 w - - 0 1",
        ],
        [
            "dragon_formation",
            "4k3/pp2pp1p/3p2p1/8/4P3/8/PPP2PPP/4K3 w - - 0 1",
        ],
        [
            "hedgehog",
            "4k3/5ppp/pp1pp3/8/2P1P3/8/PP3PPP/4K3 w - - 0 1",
        ],
        [
            "maroczy",
            "4k3/pp2pp1p/3p2p1/8/2P1P3/8/PP3PPP/4K3 w - - 0 1",
        ],
        [
            "grunfeld_centre",
            "4k3/pp2pppp/8/2p5/3PP3/2P5/P4PPP/4K3 w - - 0 1",
        ],
        [
            "kid_complex",
            "4k3/pp3ppp/2pp4/4p3/2PPP3/8/PP3PPP/4K3 w - - 0 1",
        ],
        [
            "caro_kann_formation",
            "4k3/pp3ppp/2p1p3/8/3P4/2P5/PP3PPP/4K3 w - - 0 1",
        ],
        [
            "slav_formation",
            "4k3/pp3ppp/2p1p3/8/3P4/4P3/PP3PPP/4K3 w - - 0 1",
        ],
        [
            "panov_structure",
            "4k3/pp2pppp/8/2Pp4/3P4/8/PP3PPP/4K3 w - - 0 1",
        ],
    ] as const)("detects user supplied %s reference skeleton", (structureId, fen) => {
        expect(detectPawnStructure(fen)?.structureId).toBe(structureId);
    });

    test("detects file-mirrored 3-3 vs 4-2 majority structure", () => {
        const detection = detectPawnStructure(
            "4k3/pp3ppp/4p3/8/8/2P5/PP3PPP/4K3 w - - 0 1",
        );

        expect(detection?.structureId).toBe("three_three_vs_four_two");
        expect(detection?.sideRoles.primarySide).toBe("white");
        expect(detection?.fileMirrored).toBe(true);
    });

    test("detects colour-reversed file-mirrored 3-3 vs 4-2 majority structure", () => {
        const detection = detectPawnStructure(
            colourReverseFen("4k3/pp3ppp/4p3/8/8/2P5/PP3PPP/4K3 w - - 0 1"),
        );

        expect(detection?.structureId).toBe("three_three_vs_four_two");
        expect(detection?.sideRoles.primarySide).toBe("black");
    });

    test("rejects 3-3 vs 4-2 wing counts when the file pattern is wrong", () => {
        const detection = detectPawnStructure(
            "2rkr2r/4pp2/R2p2pp/1p2n3/1P5B/2P5/P4PPP/R2R2K1 w - - 0 1",
        );

        expect(detection?.structureId).not.toBe("three_three_vs_four_two");
    });

    test("keeps ambiguous or messy positions unknown", () => {
        const detection = detectPawnStructure(
            "6k1/pppppppp/8/8/8/8/PPPPPPPP/6K1 w - - 0 1",
        );

        expect(detection).toBeNull();
    });

    test.each(
        templates.structures.flatMap((structure) =>
            (structure.antiExamples ?? []).map((anti) => [structure.id, anti.fen] as const),
        ),
    )("does not force anti-example into %s", (structureId, fen) => {
        expect(detectPawnStructure(fen)?.structureId).not.toBe(structureId);
    });
});

function colourReverseFen(fen: string) {
    const [board, turn = "w"] = fen.trim().split(/\s+/);
    const squares = new Map<string, string>();
    const ranks = board.split("/");

    for (let rankIndex = 0; rankIndex < ranks.length; rankIndex++) {
        const rank = 8 - rankIndex;
        let fileIndex = 0;
        for (const char of ranks[rankIndex]) {
            if (/\d/.test(char)) {
                fileIndex += Number(char);
                continue;
            }
            const file = "abcdefgh"[fileIndex];
            const nextRank = 9 - rank;
            const nextPiece = char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase();
            squares.set(`${file}${nextRank}`, nextPiece);
            fileIndex++;
        }
    }

    const nextRanks: string[] = [];
    for (let rank = 8; rank >= 1; rank--) {
        let empty = 0;
        let row = "";
        for (const file of "abcdefgh") {
            const piece = squares.get(`${file}${rank}`);
            if (!piece) {
                empty++;
                continue;
            }
            if (empty > 0) {
                row += empty;
                empty = 0;
            }
            row += piece;
        }
        if (empty > 0) row += empty;
        nextRanks.push(row);
    }

    return `${nextRanks.join("/")} ${turn === "w" ? "b" : "w"} - - 0 1`;
}
