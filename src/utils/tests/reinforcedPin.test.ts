import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import {
    proveReinforcedPin,
    replayTacticalLine,
    tacticalBoardEvidence,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";

const fen = "1r5k/6pp/8/3b4/8/2Q2R2/8/7K b - - 0 1";
test("a new rook attack exploits an existing bishop pin", () => {
    const root = replayTacticalLine(fen, ["b8f8"])[0];
    expect(root).toBeDefined();
    expect(proveReinforcedPin(root)?.gain).toBeGreaterThan(0);
    expect(classifyPositionTacticalMotifs({ fen, pvUci: ["b8f8"] }).motifs[0]?.id).toBe("pin");
});
test.each([
    "1r5k/6pp/8/3b4/8/2Q2R2/7K/8 b - - 0 1", // The king left the diagonal.
    "1r5k/6pp/8/8/8/2Q2R2/8/7K b - - 0 1", // No pinner.
    "1r5k/6pp/8/2Qb4/8/5N2/8/7K b - - 0 1", // Taking the bishop outweighs losing the knight.
    "kr6/8/8/3b4/8/2Q2R2/8/7K b - - 0 1", // Unresolved checking counterplay against the exposed king.
])("withholds a pin win when the mechanism or compensation is not proved: %s", (position) => {
    const root = replayTacticalLine(position, ["b8f8"])[0];
    expect(root).toBeDefined();
    expect(proveReinforcedPin(root)).toBeNull();
});
test("an already attacking rook cannot manufacture another reinforcing lesson", () => {
    const position = "7k/5rpp/8/3b4/8/2Q2R2/8/7K b - - 0 1";
    const root = replayTacticalLine(position, ["f7f8"])[0];
    expect(root).toBeDefined();
    expect(proveReinforcedPin(root)).toBeNull();
});
test("a rook move which does not add pressure is not a pin tactic", () => {
    expect(proveReinforcedPin(replayTacticalLine(fen, ["b8b7"])[0])).toBeNull();
});
test("custom and exhausted budgets cannot borrow the successful cached proof", () => {
    const root = replayTacticalLine(fen, ["b8f8"])[0];
    expect(proveReinforcedPin(root)).not.toBeNull();
    for (const limit of [0, -1, 1, NaN, Infinity, 1.5])
        expect(proveReinforcedPin(root, limit)).toBeNull();
    expect(proveReinforcedPin(root)).not.toBeNull();
});
test("the limiting line is legal and the board names the actual pinner and added attacker", () => {
    const root = replayTacticalLine(fen, ["b8f8"])[0],
        proof = proveReinforcedPin(root)!;
    const pos = root.after.clone();
    for (const san of proof.line) {
        const move = parseSan(pos, san);
        expect(move).toBeDefined();
        pos.play(move!);
    }
    const result = classifyPositionTacticalMotifs({ fen, pvUci: ["b8f8"] });
    expect(tacticalBoardEvidence(fen, ["b8f8"], result.motifs[0])).toEqual({
        square: "f3",
        arrows: [
            { from: "d5", to: "h1" },
            { from: "f8", to: "f3" },
        ],
    });
});
test("a colour reflection keeps the same local pin gain", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "w";
    const original = proveReinforcedPin(replayTacticalLine(fen, ["b8f8"])[0])!;
    expect(proveReinforcedPin(replayTacticalLine(fields.join(" "), ["b1f1"])[0])?.gain).toBe(
        original.gain,
    );
});
test.skipIf(!process.env.TACTICAL_PRIVATE_PGN_SAMPLE)(
    "both real rook reinforcements have independent material proofs",
    () => {
        const row = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_PGN_SAMPLE!, "utf8"),
        ).cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 193);
        for (const move of ["c8e8", "f8e8"]) {
            const steps = replayTacticalLine(row.fen, ["g4e3", "f3e3", move]);
            expect(steps).toHaveLength(3);
            expect(proveReinforcedPin(steps[2])?.gain).toBeGreaterThanOrEqual(400);
            expect(
                classifyPositionTacticalMotifs({ fen: row.fen, pvUci: ["g4e3", "f3e3", move] })
                    .timeline,
            ).toContainEqual(
                expect.objectContaining({ id: "pin", ply: 3, relevance: "secondary" }),
            );
            const isolatedFen = makeFen(steps[2].before.toSetup());
            const proof = proveReinforcedPin(steps[2])!,
                pos = steps[2].after.clone();
            const continuation = proof.line.map((san) => {
                const answer = parseSan(pos, san)!;
                expect(answer).toBeDefined();
                const uci = makeUci(answer);
                pos.play(answer);
                return uci;
            });
            expect(
                classifyPositionTacticalMotifs({ fen: isolatedFen, pvUci: [move, ...continuation] })
                    .motifs[0]?.id,
            ).toBe("pin");
            expect(
                classifyMistakeReviewMotifs({
                    fen: isolatedFen,
                    bestMoveUci: move,
                    playedMoveUci: "f8d8",
                    pvUci: [move, ...continuation],
                    refutationUci: [],
                }).missedMotifs[0]?.id,
            ).toBe("pin");
        }
        const declined = classifyPositionTacticalMotifs({
            fen: row.fen,
            pvUci: ["g4e3", "c1e3", "e1a1"],
        });
        expect(declined.timeline?.some((m) => m.id === "pin" && m.ply === 3)).toBe(false);
        expect(declined.motifs[0]?.id).toBe("deflection");
    },
);
