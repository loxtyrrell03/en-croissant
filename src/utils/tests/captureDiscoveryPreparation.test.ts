import { readFileSync } from "node:fs";
import { test, expect } from "vitest";
import {
    proveCaptureDiscoveryPreparation,
    proveCaptureForkPreparation,
    replayTacticalLine,
    tacticalBoardEvidence,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";

const fen = "6r1/1p6/6k1/4R3/4Nr2/8/7P/6K1 b - - 0 1";
const line = ["f4e4", "e5e4", "g6f5", "g1f2", "f5e4"];
test("a capture draws the recapturer into a king-uncovered check", () => {
    const root = replayTacticalLine(fen, line)[0];
    const errors: string[] = [];
    const proof = proveCaptureDiscoveryPreparation(root, 8192, (r) => errors.push(r));
    expect({ proof, errors }).toMatchObject({ proof: expect.any(Object), errors: [] });
});

test.each([line, line.slice(0, 1)].map((pvUci) => ({ pvUci })))(
    "the root attraction is independent of the supplied acceptance: $pvUci",
    ({ pvUci }) => {
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "attraction", ply: 1 });
    },
);
test.each([
    fen.replace("6r1", "8"),
    fen.replace("1p6", "1p4p1"),
    fen.replace("4Nr2/8", "4Nr2/5P2"),
])("missing checking support or another recapturer prevents certification: %s", (position) => {
    expect(proveCaptureDiscoveryPreparation(replayTacticalLine(position, [line[0]])[0])).toBeNull();
});
test("mode and custom budgets cannot borrow another cached certificate", () => {
    const root = replayTacticalLine(fen, line)[0];
    expect(proveCaptureDiscoveryPreparation(root)).not.toBeNull();
    expect(proveCaptureForkPreparation(root)).toBeNull();
    for (const budget of [0, -1, 1, NaN, Infinity, 1.5])
        expect(proveCaptureDiscoveryPreparation(root, budget)).toBeNull();
});
test("colour reflection retains attraction rather than misnaming a king fork", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "w";
    const pvUci = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    expect(
        classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci }).motifs[0],
    ).toMatchObject({ id: "attraction", ply: 1 });
});
test("a missed opportunity retains the initiating attraction", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: line[0],
        playedMoveUci: "f4h4",
        pvUci: line,
    });
    expect(review.missedMotifs[0]).toMatchObject({ id: "attraction", ply: 1 });
});
test("a missing counterfactual proof cannot blame the move for an existing attraction", () => {
    const review = classifyMistakeReviewMotifs({
        fen: fen.replace(" b ", " w ").replace("7P", "P6P"),
        bestMoveUci: "a2a4",
        playedMoveUci: "a2a3",
        pvUci: ["a2a4"],
        refutationUci: line,
    });
    expect(review.allowedMotifs[0]).toMatchObject({ id: "attraction" });
    expect(review.allowedMotifs[0].comparison).not.toBe("prevented");
});
test("a bishop already defending the exchange does not invent preparation", () => {
    const position = fen.replace("6r1", "6rk").replace("6k1", "6b1");
    expect(proveCaptureDiscoveryPreparation(replayTacticalLine(position, [line[0]])[0])).toBeNull();
});
test("a receiver can block a bishop's discovered check and escape the double attack", () => {
    const position = "6rk/1p6/6b1/4R3/8/8/4Nr1P/6K1 b - - 0 1";
    const errors: string[] = [];
    const proof = proveCaptureDiscoveryPreparation(
        replayTacticalLine(position, ["f2e2"])[0],
        8192,
        (r) => errors.push(r),
    );
    expect({ proof, errors }).toMatchObject({
        proof: null,
        errors: ["Unproved defence to the offered capture: Rxe2"],
    });
    expect(replayTacticalLine(position, ["f2e2", "e5e2", "g6h5", "e2g2"])).toHaveLength(4);
});
test("the actual discovery and payoff remain later, without a false winning recapture", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.timeline).toContainEqual(
        expect.objectContaining({ id: "discoveredCheck", ply: 3 }),
    );
    expect(result.timeline?.some((m) => m.ply === 2 && m.label === "Winning Recapture")).toBe(
        false,
    );
    expect(tacticalBoardEvidence(fen, line, result.motifs[0])).toEqual({
        square: "e4",
        arrows: [{ from: "e5", to: "e4" }],
    });
});
test("a genuine checking counterattack can remain outside the bounded proof", () => {
    const position = "6r1/1p6/6k1/8/4Nr2/8/4R2P/6K1 b - - 0 1";
    const root = replayTacticalLine(position, [line[0]])[0];
    expect(proveCaptureDiscoveryPreparation(root)).toBeNull();
});

test.skipIf(!process.env.TACTICAL_PRIVATE_THIRD_SAMPLE)(
    "the real rook exchange prepares a king-uncovered check",
    () => {
        const row = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_THIRD_SAMPLE!, "utf8"),
        ).cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 69);
        const errors: string[] = [];
        const proof = proveCaptureDiscoveryPreparation(
            replayTacticalLine(row.fen, row.sourceUci)[0],
            8192,
            (r) => errors.push(r),
        );
        expect({ proof, errors }).toMatchObject({ proof: { gain: 220 }, errors: [] });
    },
);
