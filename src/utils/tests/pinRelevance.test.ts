import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import {
    auditTacticalMotifs,
    provePinEntry,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

// The pin makes Nh6+ legal to play safely, but the rook on c3 is unrelated
// and could already be captured. Cycling the checks cannot turn it into a
// pin payoff. Positions/continuations here are constructed, not course text.
const fen = "6k1/5Npp/8/8/8/2r3Q1/8/6K1 w - - 0 1";
const cycle = ["f7h6", "g8h8", "h6f7", "h8g8"];
const line = [...cycle, "g3c3", "g7g6"];
const entryFen = "2r2rk1/pp4pp/1n3p2/3p4/3qp1N1/6Q1/P1P3PP/1N2R2K w - - 4 21";

test("the checking entry has a connected material-or-mate proof without a PV", () => {
    const step = replayTacticalLine(entryFen, ["g4h6"])[0];
    expect(provePinEntry(step)).toMatchObject({
        branches: [{ reply: "Kh8", preparation: "Nf5", mate: "Qxg7#" }],
    });
    const result = classifyPositionTacticalMotifs({ fen: entryFen, pvUci: ["g4h6"] });
    expect(result.motifs[0]?.id).toBe("pin");
    expect(result.motifs[0]?.evidence).toContain("Nf5 attacks the queen on d4");
    const scan = buildLiveTacticalScan({
        fen: entryFen,
        pvUci: ["g4h6"],
        depth: 16,
        engineName: "Regression",
    });
    expect(scan.motifs[0]?.id).toBe("pin");
    expect(scan.arrows.some((a) => a.from === "f5" || a.to === "f5")).toBe(false);
});

test.each([0, 1, -1, NaN, Infinity, 1.5])(
    "pin entry abstains with budget %s even after a cached proof",
    (budget) => {
        const step = replayTacticalLine(entryFen, ["g4h6"])[0];
        expect(provePinEntry(step)).not.toBeNull();
        expect(provePinEntry(step, budget)).toBeNull();
    },
);

test.each([
    ["no pinner", entryFen.replace("6Q1", "8")],
    ["no queen target", entryFen.replace("3qp1N1", "4p1N1")],
    ["capture of the knight also stops the mate", entryFen.replace("3p4", "3p3r")],
])("pin entry rejects %s", (_name, position) => {
    expect(provePinEntry(replayTacticalLine(position, ["g4h6"])[0])).toBeNull();
});

test("both king replies must be proved when h7 is empty", () => {
    const position = entryFen.replace("pp4pp", "pp4p1");
    const proof = provePinEntry(replayTacticalLine(position, ["g4h6"])[0]);
    expect(proof?.branches.map((branch) => branch.reply).sort()).toEqual(["Kh7", "Kh8"]);
});

test("the rook control legally removes the knight's mating support", () => {
    const position = entryFen.replace("3p4", "3p3r");
    const moves = ["g4h6", "g8h8", "h6f5", "h5f5", "g3g7", "h8g7"];
    expect(replayTacticalLine(position, moves)).toHaveLength(moves.length);
});

test("colour reflection preserves the connected checking entry", () => {
    const fields = entryFen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    expect(provePinEntry(replayTacticalLine(fields.join(" "), ["g5h3"])[0])).toMatchObject({
        branches: [{ reply: "Kh1", preparation: "Nf4", mate: "Qxg2#" }],
    });
});

test("a repetition has no connected pin-entry proof", () => {
    expect(provePinEntry(replayTacticalLine(fen, line)[0])).toBeNull();
});

test("returning to the same position cannot borrow a later rook capture for a pin lesson", () => {
    const steps = replayTacticalLine(fen, line);
    expect(steps).toHaveLength(6);
    expect(makeFen(steps[3].after.toSetup()).split(" ").slice(0, 4)).toEqual(
        fen.split(" ").slice(0, 4),
    );
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.motifs.some((m) => m.id === "pin" && m.ply === 1)).toBe(false);
    expect((result.timeline ?? []).some((m) => m.id === "pin")).toBe(false);
    // With no root mechanism the bounded timeline does not borrow the late
    // gift either. At the actually reached capture, its material remains real.
    const reached = makeFen(steps[3].after.toSetup());
    expect(
        classifyPositionTacticalMotifs({ fen: reached, pvUci: line.slice(4) }).motifs[0]?.id,
    ).toBe("hangingPiece");
});

test("even a single check cannot borrow an unrelated later material gift", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: ["f7h6", "g8h8", "g3c3"] });
    expect(result.motifs.some((m) => m.id === "pin" && m.ply === 1)).toBe(false);
});

test("a proposed pin and invented value do not certify the move's benefit", () => {
    const motifs = auditTacticalMotifs(fen, line, [
        {
            id: "pin",
            label: "Pin",
            ply: 1,
            moveUci: line[0],
            value: 900,
            source: "available",
            confidence: "high",
            evidence: "Untrusted proposal",
        },
    ]);
    expect(motifs.some((m) => m.id === "pin")).toBe(false);
});

test("a pin which genuinely protects an immediate checking fork remains explained", () => {
    const position = "6k1/5Npp/8/5r2/8/6Q1/8/6K1 w - - 0 1";
    const result = classifyPositionTacticalMotifs({
        fen: position,
        pvUci: ["f7h6", "g8h8", "h6f5"],
    });
    expect(result.motifs[0]?.id).toBe("fork");
    expect(result.motifs[0]?.evidence).toContain("pinned to its king");
});

test("a real protected fork does not need a future payoff in the supplied line", () => {
    const position = "6k1/5Npp/8/5r2/8/6Q1/8/6K1 w - - 0 1";
    const result = classifyPositionTacticalMotifs({ fen: position, pvUci: ["f7h6"] });
    expect(result.motifs[0]?.id).toBe("fork");
    expect(result.motifs[0]?.evidence).toContain("pinned to its king");
});

test("a winning engine score cannot supply the missing pin mechanism", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line, rootCp: 2000 });
    expect(result.motifs.some((m) => m.id === "pin" && m.ply === 1)).toBe(false);
});

test("the board does not promote the incidental pin into its primary label", () => {
    const scan = buildLiveTacticalScan({ fen, pvUci: line, depth: 16, engineName: "Constructed" });
    expect(scan.labels.some((label) => label.id === "pin")).toBe(false);
});

test("missed-opportunity review does not teach an incidental repeated-check pin", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: line[0],
        playedMoveUci: "g1f1",
        pvUci: line,
        refutationUci: [],
    });
    expect(review.missedMotifs.some((m) => m.id === "pin" && m.ply === 1)).toBe(false);
});

test("reflection does not turn a black repeated check into a tactical pin", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    const moves = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    expect(replayTacticalLine(fields.join(" "), moves)).toHaveLength(moves.length);
    expect(
        classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: moves }).motifs.some(
            (m) => m.id === "pin" && m.ply === 1,
        ),
    ).toBe(false);
});

test.skipIf(!process.env.TACTICAL_PRIVATE_THIRD_REPORT)(
    "the real repetition cannot supply a primary pin from the later combination",
    () => {
        const report = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_THIRD_REPORT!, "utf8"));
        const row = report.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 172);
        const pvUci = row.engineLines[0].pvUci;
        const steps = replayTacticalLine(row.fen, pvUci);
        expect(makeFen(steps[3].after.toSetup()).split(" ").slice(0, 4)).toEqual(
            row.fen.split(" ").slice(0, 4),
        );
        expect(
            classifyPositionTacticalMotifs({
                fen: row.fen,
                pvUci,
                rootCp: row.engineLines[0].cp,
            }).motifs.some((m) => m.id === "pin" && m.ply === 1),
        ).toBe(false);
    },
);
