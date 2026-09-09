import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { proveCaptureForkPreparation, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";

const fen = "2k5/1pq5/6Q1/P1n5/8/Rb6/5PPP/6K1 w - - 0 1";
const line = ["a3b3", "c5b3", "g6e6", "c8b8", "e6b3"];

test.each([
    [fen, 50],
    [fen.replace("P1n5", "2n5"), 150],
    [fen.replace("Rb6", "Rn6"), 40],
])("piece composition retains the actual local residual: %s", (position, gain) => {
    expect(proveCaptureForkPreparation(replayTacticalLine(position, line)[0])?.gain).toBe(gain);
});

test.each([
    fen.replace("P1n5", "R1n5"),
    fen.replace("P1n5", "Q1n5"),
    fen.replace("6Q1", "8"),
    fen.replace("Rb6", "Rp6"),
])("a missing mechanism or erasing countercapture cannot borrow the exception: %s", (position) => {
    expect(proveCaptureForkPreparation(replayTacticalLine(position, [line[0]])[0])).toBeNull();
});

test("the countercapture is legal and belongs to the local exchange", () => {
    const steps = replayTacticalLine(fen, [...line, "c7a5"]);
    expect(steps).toHaveLength(6);
    expect(steps.at(-1)?.san).toBe("Qxa5");
});

test.each([0, 1, -1, NaN, Infinity, 1.5])(
    "budget %s cannot reuse the default certificate",
    (budget) => {
        const root = replayTacticalLine(fen, line)[0];
        expect(proveCaptureForkPreparation(root)).not.toBeNull();
        expect(proveCaptureForkPreparation(root, budget)).toBeNull();
    },
);

test("root-only classification proves the preparation without borrowing the supplied continuation", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: [line[0]] });
    expect(result.motifs[0]).toMatchObject({ id: "forkPreparation", ply: 1, value: 50 });
    expect(result.motifs[0].evidence).toContain("a bishop and a knight for the rook");
    expect(result.motifs[0].evidence).toContain("at least 0.5 pawns");
    const knights = classifyPositionTacticalMotifs({
        fen: fen.replace("Rb6", "Rn6"),
        pvUci: [line[0]],
    });
    expect(knights.motifs[0].evidence).toContain("two knights for the rook");
});

test("the board separates the root offer from its later fork and the acceptance is not free material", () => {
    const scan = buildLiveTacticalScan({ fen, pvUci: line, depth: 16, engineName: "Constructed" });
    expect(scan.arrows.map((a) => a.from + a.to)).toEqual(["a3b3"]);
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.timeline?.some((m) => m.id === "fork" && m.ply === 3)).toBe(true);
    expect(result.timeline?.some((m) => m.id === "hangingPiece" && m.ply === 2)).toBe(false);
    const after = makeFen(replayTacticalLine(fen, line)[0].after.toSetup());
    const accepted = classifyPositionTacticalMotifs({
        fen: after,
        pvUci: [line[1]],
        previousFen: fen,
        previousMoveUci: line[0],
    });
    expect(accepted.motifs.some((m) => m.id === "hangingPiece")).toBe(false);
});

test("a missed preparation retains its lesson despite a sub-pawn residual", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        playedMoveUci: "h2h3",
        bestMoveUci: line[0],
        pvUci: line,
        refutationUci: [],
    });
    expect(review.missedMotifs[0]).toMatchObject({ id: "forkPreparation", ply: 1, value: 50 });
    expect(buildMistakeReviewTacticalExplanation(review)?.primary.id).toBe("forkPreparation");
});

test("reflection preserves the exchange and fork preparation", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    const reflected = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    expect(
        proveCaptureForkPreparation(replayTacticalLine(fields.join(" "), reflected)[0])?.gain,
    ).toBe(50);
    expect(
        classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: reflected }).motifs[0]?.id,
    ).toBe("forkPreparation");
});

test("two minors for a rook remains a forcing combination after a pawn countercapture", () => {
    const failures: string[] = [];
    const root = replayTacticalLine(fen, line)[0];
    const proof = proveCaptureForkPreparation(root, 8192, (r) => failures.push(r));
    expect(failures).toEqual([]);
    expect(proof).toMatchObject({ gain: 50 });
    expect(proof?.branches[0].exchange).toEqual({ given: "rook", received: ["bishop", "knight"] });
});

test.skipIf(!process.env.TACTICAL_PRIVATE_DISJOINT_SAMPLE)(
    "the rook offer prepares its actual checking fork",
    () => {
        const sample = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_DISJOINT_SAMPLE!, "utf8"),
        );
        const row = sample.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 182);
        const failures: string[] = [];
        const proof = proveCaptureForkPreparation(
            replayTacticalLine(row.fen, row.sourceUci)[0],
            8192,
            (reason) => failures.push(reason),
        );
        expect(failures).toEqual([]);
        expect(proof).toMatchObject({ gain: 50 });
        expect(
            classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci }).motifs[0],
        ).toMatchObject({ id: "forkPreparation", ply: 1, value: 50 });
        const review = classifyMistakeReviewMotifs({
            fen: row.fen,
            playedMoveUci: "c3e4",
            bestMoveUci: row.sourceUci[0],
            pvUci: row.sourceUci,
            refutationUci: ["c5e4", "a3b3", "e4f6", "g6c2"],
        });
        expect(buildMistakeReviewTacticalExplanation(review)).toMatchObject({
            source: "missed",
            primary: { id: "forkPreparation" },
        });
    },
);
