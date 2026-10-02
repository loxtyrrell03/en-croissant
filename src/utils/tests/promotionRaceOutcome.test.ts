import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { validateTablebaseRecord } from "../tacticalMotifs/tablebaseEvidence";
import { reflectMixedForkMove } from "./fixtures/mixedTargetFork";

type Query = {
    stage: string;
    reflected: boolean;
    fen: string;
    result: { category: string; moves: { uci: string; category: string }[] };
};
const receipt = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/promotion-race-outcome-tablebase.json", "utf8"),
) as { sourceId: string; sourceSha256: string; requests: unknown[]; queries: Query[] };
const source = readFileSync("benchmarks/tactical-relevance/secondary-theme-development.json");

function record(stage: string, reflected: boolean) {
    const rows = receipt.queries.filter((row) => row.stage === stage && row.reflected === reflected);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    const verified = validateTablebaseRecord(row, row.fen);
    expect(verified).not.toBeNull();
    return verified!;
}

test("the public pawn-race outcome audit remains tied to its exact retained source", () => {
    expect(receipt.sourceId).toBe("lichess:i2SLh");
    expect(createHash("sha256").update(source).digest("hex")).toBe(receipt.sourceSha256);
    expect(receipt.requests).toHaveLength(8);
    expect(receipt.queries).toHaveLength(8);
    expect(receipt.queries.map(({ stage, reflected, fen }) => ({ stage, reflected, fen }))).toEqual(
        receipt.requests,
    );
});

test.each(receipt.queries)(
    "validate the complete legal move set and outcomes: $stage reflected=$reflected",
    (row) => {
        expect(validateTablebaseRecord(row, row.fen)).not.toBeNull();
    },
);

for (const reflected of [false, true]) {
    const move = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
    test(`the first pawn push is the only outcome-preserving win: reflected=${reflected}`, () => {
        const root = record("race-root", reflected);
        expect(root.outcome).toBe(1);
        // A move's outcome belongs to the child side to move.
        expect(root.moves.filter((row) => row.outcome === -1).map((row) => row.uci)).toEqual([
            move("a4a5"),
        ]);
        expect(root.moves.filter((row) => row.outcome === 0).map((row) => row.uci)).toEqual([
            move("e7d7"),
        ]);
        expect(root.moves.filter((row) => row.outcome === 1)).toHaveLength(4);
        const after = record("after-first-push", reflected);
        expect(after.outcome).toBe(-1);
        expect(after.moves).toHaveLength(5);
        expect(after.moves.every((row) => row.outcome === 1)).toBe(true);
    });

    test(`the later opponent promotion is not a saving win or draw: reflected=${reflected}`, () => {
        const before = record("before-opponent-promotion", reflected);
        expect(before.outcome).toBe(-1);
        expect(before.moves).toHaveLength(9);
        expect(before.moves.every((row) => row.outcome === 1)).toBe(true);
        for (const role of ["q", "r", "b", "n"])
            expect(before.moves).toContainEqual({ uci: move(`d2d1${role}`), outcome: 1 });
        // This says nothing about a bounded local material-retention proof.
        // A locally useful move can still occur in a lost game.
        const after = record("after-opponent-promotion", reflected);
        expect(after.outcome).toBe(1);
        expect(after.moves).toHaveLength(19);
        expect(after.moves.filter((row) => row.outcome === -1).map((row) => row.uci).sort()).toEqual(
            [move("a8c6"), move("a8b8")].sort(),
        );
        expect(after.moves.filter((row) => row.outcome === 0)).toHaveLength(11);
        expect(after.moves.filter((row) => row.outcome === 1)).toHaveLength(6);
    });

    test(`a missing underpromotion invalidates the full outcome certificate: reflected=${reflected}`, () => {
        const row = structuredClone(
            receipt.queries.find((item) => item.stage === "before-opponent-promotion" && item.reflected === reflected)!,
        );
        row.result.moves = row.result.moves.filter((item) => item.uci !== move("d2d1n"));
        expect(validateTablebaseRecord(row, row.fen)).toBeNull();
    });

    test(`a false winning parent cannot reuse losing continuation outcomes: reflected=${reflected}`, () => {
        const row = structuredClone(
            receipt.queries.find((item) => item.stage === "before-opponent-promotion" && item.reflected === reflected)!,
        );
        row.result.category = "win";
        expect(validateTablebaseRecord(row, row.fen)).toBeNull();
    });
}
