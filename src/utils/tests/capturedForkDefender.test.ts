import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
    proveCaptureForkPreparation,
    replayTacticalLine,
    tacticalBoardEvidence,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { makeFen } from "chessops/fen";
import { parseSquare } from "chessops/util";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

const fen = "3r2k1/p5pp/8/7q/8/3N4/2P3PP/R3K3 b - - 0 1";
test("capturing the original fork defender prepares a checking fork of other pieces", () => {
    const errors: string[] = [];
    const proof = proveCaptureForkPreparation(replayTacticalLine(fen, ["d8d3"])[0], 8192, (r) =>
        errors.push(r),
    );
    expect({ proof, errors }).toMatchObject({ proof: expect.any(Object), errors: [] });
    expect(classifyPositionTacticalMotifs({ fen, pvUci: ["d8d3"] }).motifs[0]).toMatchObject({
        id: "forkPreparation",
    });
});

function privateRow(eligibleIndex: number) {
    const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_FOURTH_SAMPLE!, "utf8"));
    return sample.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === eligibleIndex);
}
test.skipIf(!process.env.TACTICAL_PRIVATE_FOURTH_SAMPLE)(
    "an unproved declining defence still prevents the real rook preparation certificate",
    () => {
        const row = privateRow(38);
        const errors: string[] = [];
        const proof = proveCaptureForkPreparation(
            replayTacticalLine(row.fen, row.sourceUci)[0],
            8192,
            (r) => errors.push(r),
        );
        expect({ proof, errors }).toEqual({
            proof: null,
            errors: ["Unproved defence to the offered capture: g4"],
        });
    },
);
test.skipIf(!process.env.TACTICAL_PRIVATE_FOURTH_SAMPLE)(
    "the real queen preparation uses a safe decline witness rather than losing two pieces",
    () => {
        const row = privateRow(89);
        const errors: string[] = [];
        const proof = proveCaptureForkPreparation(
            replayTacticalLine(row.fen, row.sourceUci)[0],
            8192,
            (r) => errors.push(r),
        );
        expect({ proof, errors }).toMatchObject({ proof: expect.any(Object), errors: [] });
        // Nxd3 appears to retain 100 cp only if the queen and knight's
        // losses are counted separately. Fresh engine validation exposed
        // dxe5 followed by Qxd3; the selected witness must save the queen.
        expect(proof!.declined.find((branch) => branch.reply === "Rd3")?.answer).not.toBe("Nxd3");
        expect(
            classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci }).motifs[0],
        ).toMatchObject({ id: "forkPreparation", ply: 1 });
    },
);

const line = ["d8d3", "c2d3", "h5e5", "e1d2", "e5a1"];
test.each([line, line.slice(0, 1)].map((pvUci) => ({ pvUci })))(
    "the initiating capture explains move order without borrowing the PV: $pvUci",
    ({ pvUci }) => {
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "forkPreparation", ply: 1 });
        expect(result.motifs[0].evidence).toContain("captures the defending knight on d3");
        expect(result.motifs[0].evidence).toContain(
            "Playing Qe5+ first lets that defender capture the forking piece with Nxe5",
        );
        expect(result.motifs[0].evidence).not.toContain("defending pawn");
        expect(tacticalBoardEvidence(fen, pvUci, result.motifs[0])).toEqual({
            square: "d3",
            arrows: [],
        });
        expect(
            buildLiveTacticalScan({ fen, pvUci, depth: 16, engineName: "Constructed" }).arrows.map(
                (a) => a.from + a.to,
            ),
        ).toEqual(["d8d3"]);
    },
);
test("the checking fork remains a continuation, not the root attack", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.timeline).toContainEqual(expect.objectContaining({ id: "fork", ply: 3 }));
    expect(result.motifs.some((m) => m.id === "fork" && m.ply === 1)).toBe(false);
});
test("the missed lesson is the defender capture, not a premature fork", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: line[0],
        playedMoveUci: line[2],
        pvUci: line,
        refutationUci: ["d3e5"],
    });
    expect(result.missedMotifs[0]).toMatchObject({ id: "forkPreparation", ply: 1 });
});
test.each(["h5", "a1"])(
    "a missing forker or material victim cannot certify preparation: %s",
    (square) => {
        const before = replayTacticalLine(fen, line)[0].before;
        before.board.take(parseSquare(square)!);
        expect(
            proveCaptureForkPreparation(
                replayTacticalLine(makeFen(before.toSetup()), [line[0]])[0],
            ),
        ).toBeNull();
    },
);
test("a second defender can capture the prepared checking fork", () => {
    const position = fen.replace("p5pp", "p4Npp");
    expect(replayTacticalLine(position, [...line.slice(0, 3), "f7e5"])).toHaveLength(4);
    expect(proveCaptureForkPreparation(replayTacticalLine(position, line)[0])).toBeNull();
});
test("a declining countercheck can remain outside the local proof", () => {
    const position = fen.replace("p5pp", "6pp");
    const errors: string[] = [];
    expect(
        proveCaptureForkPreparation(replayTacticalLine(position, line)[0], 8192, (r) =>
            errors.push(r),
        ),
    ).toBeNull();
    expect(errors).toContain("Unproved defence to the offered capture: Ra8+");
});
test("invalid and exhausted budgets cannot borrow a cached result", () => {
    const root = replayTacticalLine(fen, line)[0];
    expect(proveCaptureForkPreparation(root)).not.toBeNull();
    for (const limit of [0, -1, 1, 1.5, NaN, Infinity])
        expect(proveCaptureForkPreparation(root, limit)).toBeNull();
});
test("colour reflection retains the initiating defender removal", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "w";
    expect(
        classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: ["d1d6"] }).motifs[0],
    ).toMatchObject({ id: "forkPreparation", ply: 1 });
});
