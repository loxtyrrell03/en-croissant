import { readFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { parseSquare } from "chessops/util";
import { describe, expect, test } from "vitest";
import {
    proveCaptureDeflection,
    replayTacticalLine,
    tacticalBoardEvidence,
    tacticalExchangeGain,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

test("an already profitable exchange cannot borrow an unnecessary deflection label", () => {
    const fen = "3r2rk/6p1/8/3b4/7n/5P2/8/1R1B1qBK b - - 0 1";
    const root = replayTacticalLine(fen, ["h4f3"])[0];
    expect(root).toBeDefined();
    expect(tacticalExchangeGain(root.before, root.move)).toBeGreaterThanOrEqual(90);
    expect(proveCaptureDeflection(root)).toBeNull();
});

function privateRow() {
    return JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_PGN_SAMPLE!, "utf8")).cases.find(
        (r: { eligibleIndex: number }) => r.eligibleIndex === 193,
    ) as { fen: string; sourceUci: string[] };
}
test("accepting opens a queen ray while declining permits the offered knight's attack", () => {
    const fen = "3q3k/8/8/3B4/7n/5P2/3R4/7K b - - 0 1";
    const root = replayTacticalLine(fen, ["h4f3"])[0];
    expect(root).toBeDefined();
    const errors: string[] = [];
    expect({
        proof: proveCaptureDeflection(root, 16384, (r) => errors.push(r)),
        errors,
    }).toMatchObject({ proof: { gain: 100 }, errors: [] });
    const proof = proveCaptureDeflection(root)!;
    expect(proof.accepted).toEqual([
        expect.objectContaining({ reply: "Bxf3", answer: "Qxd2", mode: "ray" }),
    ]);
    expect(proof.declined).toContainEqual(
        expect.objectContaining({ reply: "Bc6", answer: "Nxd2" }),
    );
    expect(classifyPositionTacticalMotifs({ fen, pvUci: ["h4f3"] }).motifs[0]?.id).toBe(
        "deflection",
    );
});
test.each([
    "3q3k/8/8/3B4/7n/5P2/8/3R3K b - - 0 1", // The accepting bishop still guards d1.
    "3q3k/8/8/3B4/3b3n/5P2/3R4/7K b - - 0 1", // A second blocker remains.
    "3q3k/8/8/3B4/7n/5P2/3R4/2B4K b - - 0 1", // Another bishop recaptures the queen.
])("an opened-looking line is not enough without a profitable legal capture: %s", (fen) => {
    const root = replayTacticalLine(fen, ["h4f3"])[0];
    expect(root).toBeDefined();
    expect(proveCaptureDeflection(root)).toBeNull();
});
describe.skipIf(!process.env.TACTICAL_PRIVATE_PGN_SAMPLE)(
    "private mixed-recapture position",
    () => {
        test("all three receivers have independently checked, different material recoveries", () => {
            const row = privateRow(),
                root = replayTacticalLine(row.fen, row.sourceUci)[0];
            const errors: string[] = [];
            const proof = proveCaptureDeflection(root, 16384, (r) => errors.push(r));
            expect(errors).toEqual([]);
            expect(proof).toMatchObject({
                gain: 100,
                accepted: expect.arrayContaining([
                    expect.objectContaining({
                        reply: "Bxe3",
                        mode: "ray",
                        answer: "Qxa1",
                        gain: 280,
                    }),
                    expect.objectContaining({ reply: "Rxe3", mode: "pin" }),
                    expect.objectContaining({ reply: "Qxe3", mode: "capture" }),
                ]),
            });
            expect(proof!.accepted).toHaveLength(3);
            expect(proof!.declined.length).toBeGreaterThan(10);
        });

        test("source, principal engine reply and root-only views explain the same deflection", () => {
            const row = privateRow();
            for (const pvUci of [
                row.sourceUci.slice(0, 1),
                row.sourceUci,
                ["g4e3", "c1e3", "e1a1"],
                ["g4e3", "b3e3", "c5e3"],
            ]) {
                expect(replayTacticalLine(row.fen, pvUci)).toHaveLength(pvUci.length);
                const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci });
                expect(result.motifs[0]).toMatchObject({ id: "deflection", ply: 1 });
                expect(result.motifs[0].evidence).toContain("If Bxe3, Qxa1");
                expect(result.motifs[0].evidence).toContain("different recapture, Rxe3");
                expect(result.motifs[0].evidence).toContain("not every defence");
                expect(result.motifs.some((m) => m.id === "pin" && m.ply === 1)).toBe(false);
            }
        });

        test("the board shows the offer and blocker, not a future queen capture or branch pin", () => {
            const row = privateRow();
            const scan = buildLiveTacticalScan({
                fen: row.fen,
                pvUci: row.sourceUci,
                depth: 16,
                engineName: "Private fixture",
            });
            expect(scan.motifs[0]?.id).toBe("deflection");
            expect(tacticalBoardEvidence(row.fen, row.sourceUci, scan.motifs[0])).toEqual({
                square: "e3",
                arrows: [{ from: "c1", to: "e3" }],
            });
            expect(scan.arrows.map((a) => a.from + a.to)).toEqual(
                expect.arrayContaining(["g4e3", "c1e3"]),
            );
            expect(scan.arrows.map((a) => a.from + a.to)).not.toContain("e1a1");
        });

        test("a missed preparation remains the missed-opportunity lesson", () => {
            const row = privateRow();
            const result = classifyMistakeReviewMotifs({
                fen: row.fen,
                bestMoveUci: "g4e3",
                playedMoveUci: "g4f6",
                pvUci: row.sourceUci,
                refutationUci: [],
            });
            expect(result.missedMotifs[0]?.id).toBe("deflection");
            expect(buildMistakeReviewTacticalExplanation(result)).toMatchObject({
                source: "missed",
                primary: { id: "deflection" },
            });
        });

        test("the colour-reflected position has the same branches and value", () => {
            const row = privateRow(),
                fields = row.fen.split(" ");
            fields[0] = fields[0]
                .split("/")
                .reverse()
                .join("/")
                .replace(/[a-zA-Z]/g, (c) =>
                    c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase(),
                );
            fields[1] = "w";
            const line = row.sourceUci.map((move) =>
                move.replace(/[1-8]/g, (rank) => String(9 - Number(rank))),
            );
            expect(
                proveCaptureDeflection(replayTacticalLine(fields.join(" "), line)[0])?.gain,
            ).toBe(100);
            expect(
                classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: line }).motifs[0]
                    ?.id,
            ).toBe("deflection");
        });

        test("custom and exhausted budgets cannot borrow a cached success", () => {
            const row = privateRow(),
                root = replayTacticalLine(row.fen, row.sourceUci)[0];
            expect(proveCaptureDeflection(root)?.gain).toBe(100);
            for (const budget of [0, -1, 1, 20, NaN, Infinity, 1.5])
                expect(proveCaptureDeflection(root, budget)).toBeNull();
            expect(proveCaptureDeflection(root)?.gain).toBe(100);
        });

        test.each(["c5", "c8", "a1"])(
            "withholds the common lesson without its essential piece on %s",
            (square) => {
                const row = privateRow(),
                    root = replayTacticalLine(row.fen, row.sourceUci)[0];
                const pos = root.before.clone();
                pos.board.take(parseSquare(square)!);
                const modified = replayTacticalLine(makeFen(pos.toSetup()), [root.uci])[0];
                expect(modified).toBeDefined();
                expect(proveCaptureDeflection(modified)).toBeNull();
            },
        );

        test("a second blocker prevents borrowing the queen's unopened ray", () => {
            const row = privateRow(),
                root = replayTacticalLine(row.fen, row.sourceUci)[0];
            const pos = root.before.clone();
            pos.board.set(parseSquare("d1")!, { color: "white", role: "bishop" });
            const modified = replayTacticalLine(makeFen(pos.toSetup()), [root.uci])[0];
            expect(modified).toBeDefined();
            expect(proveCaptureDeflection(modified)).toBeNull();
        });
    },
);
