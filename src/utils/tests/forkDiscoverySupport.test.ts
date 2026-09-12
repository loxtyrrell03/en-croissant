import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeUci, parseSquare } from "chessops/util";
import { makeSan } from "chessops/san";
import {
    replayTacticalLine,
    tacticalExchangeGain,
    proveDiscoveryBackedFork,
    counterCaptureMaterialDefence,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

const fen = "3r1nk1/2q3p1/2nppb1p/8/2P1PPQ1/2N5/1B4PP/5R1K w - - 0 1";
const line = ["c3d5", "e6d5", "b2f6"];

test.each([
    fen.replace("1B4PP", "6PP"),
    fen.replace("2P1PPQ1", "2P1PP2"),
    fen.replace("3r1nk1", "5nk1"),
    fen.replace("2nppb1p", "2n1pb1p"),
    fen.replace("5R1K", "7K"),
])("missing support or a real new defence cannot borrow the old proof: %s", (position) => {
    expect(proveDiscoveryBackedFork(replayTacticalLine(position, [line[0]])[0])).toBeNull();
});

test("removing the back-rank guard exposes a legal mating counterattack", () => {
    const steps = replayTacticalLine(fen.replace("5R1K", "7K"), [...line, "c7a5", "f6d8", "a5e1"]);
    expect(steps).toHaveLength(6);
    expect(steps.at(-1)?.after.isCheckmate()).toBe(true);
});

test.each([0, 1, -1, NaN, Infinity, 1.5])(
    "invalid or exhausted budget %s cannot borrow the cached proof",
    (budget) => {
        const root = replayTacticalLine(fen, line)[0];
        expect(proveDiscoveryBackedFork(root)).not.toBeNull();
        expect(proveDiscoveryBackedFork(root, budget)).toBeNull();
    },
);

test.each([["c3d5"], ["c3d5", "f6b2", "d5c7"]])(
    "the root proof does not depend on acceptance in the supplied PV: %j",
    (...pvUci) => {
        expect(replayTacticalLine(fen, pvUci)).toHaveLength(pvUci.length);
        expect(classifyPositionTacticalMotifs({ fen, pvUci }).motifs[0]).toMatchObject({
            id: "fork",
            ply: 1,
            value: 80,
        });
    },
);

test("a queen countercapture may be answered by capturing the related defending queen", () => {
    const steps = replayTacticalLine(fen, [...line, "h6h5", "f6d8", "h5g4", "d8c7"]);
    expect(steps).toHaveLength(7);
    expect(steps.at(-1)?.san).toBe("Bxc7");
});

test("the current board shows the fork, not future bishop captures", () => {
    const scan = buildLiveTacticalScan({ fen, pvUci: line, depth: 16, engineName: "Constructed" });
    expect(scan.arrows.map((a) => a.from + a.to)).toEqual(["c3d5", "d5f6", "d5c7", "g4g8"]);
    expect(scan.motifs[0].evidence).toContain("newly opened bishop line");
    expect(scan.motifs[0].evidence).toContain("pawn on g7 to the king on g8");
});

test("a missed discovery-protected fork remains an explicit opportunity", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        playedMoveUci: "h2h3",
        bestMoveUci: line[0],
        pvUci: line,
        refutationUci: [],
    });
    expect(buildMistakeReviewTacticalExplanation(review)?.primary).toMatchObject({
        id: "fork",
        source: "missed",
        value: 80,
    });
});

test("the fork target's best countercapture is compensation, not a newly hung bishop", () => {
    const pvUci = ["c3d5", "f6b2", "d5c7"];
    const result = classifyPositionTacticalMotifs({ fen, pvUci });
    expect(result.timeline?.find((m) => m.ply === 2 && m.id === "hangingPiece")).toMatchObject({
        label: "Countercapture",
    });
    const after = makeFen(replayTacticalLine(fen, pvUci)[0].after.toSetup());
    const contextual = classifyPositionTacticalMotifs({
        fen: after,
        pvUci: pvUci.slice(1),
        previousFen: fen,
        previousMoveUci: pvUci[0],
    });
    expect(contextual.motifs.find((m) => m.id === "hangingPiece")?.label).toBe("Countercapture");
    expect(
        counterCaptureMaterialDefence(replayTacticalLine(after, pvUci.slice(1))[0], 8192, 0, true)
            ?.defence,
    ).toBe("Nxc7");
    expect(
        classifyPositionTacticalMotifs({ fen: after, pvUci: pvUci.slice(1) }).motifs.some(
            (m) => m.id === "hangingPiece",
        ),
    ).toBe(false);
});

test("accepting the knight offer also has an independently proved countercapture without history", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.timeline?.some((m) => m.ply === 2 && m.id === "hangingPiece")).toBe(false);
    const after = makeFen(replayTacticalLine(fen, line)[0].after.toSetup());
    expect(
        classifyPositionTacticalMotifs({
            fen: after,
            pvUci: [line[1]],
            previousFen: fen,
            previousMoveUci: line[0],
        }).motifs.some((m) => m.id === "hangingPiece"),
    ).toBe(false);
    expect(
        counterCaptureMaterialDefence(replayTacticalLine(after, [line[1]])[0], 8192, 0, true)
            ?.defence,
    ).toBe("Bxf6");
    expect(
        classifyPositionTacticalMotifs({ fen: after, pvUci: [line[1]] }).motifs.some(
            (m) => m.id === "hangingPiece",
        ),
    ).toBe(false);
});

test("a move attacking only the queen cannot borrow the two-target fork certificate", () => {
    expect(proveDiscoveryBackedFork(replayTacticalLine(fen, ["c3b5"])[0])).toBeNull();
});

test("colour reflection retains the same local gain and conditional discovery", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    const pvUci = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    expect(
        classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci }).motifs[0],
    ).toMatchObject({ id: "fork", value: 80 });
});

test("a constructed fork is protected by its newly opened bishop attack", () => {
    const failures: string[] = [];
    const proof = proveDiscoveryBackedFork(replayTacticalLine(fen, line)[0], 32768, (r) =>
        failures.push(r),
    );
    expect({ proof, failures }).toMatchObject({ proof: { gain: 80 }, failures: [] });
    expect(classifyPositionTacticalMotifs({ fen, pvUci: line }).motifs[0]).toMatchObject({
        id: "fork",
        ply: 1,
        value: 80,
    });
});

test.skipIf(!process.env.TACTICAL_PRIVATE_DISJOINT_SAMPLE)(
    "diagnose the real fork and its legal defences",
    () => {
        const sample = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_DISJOINT_SAMPLE!, "utf8"),
        );
        const row = sample.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 155);
        const step = replayTacticalLine(row.fen, row.sourceUci)[0];
        const failures = [];
        for (const [from, dests] of step.after.allDests())
            for (const to of dests) {
                const reply = { from, to },
                    pos = step.after.clone();
                const captured = step.after.board.get(to)?.role;
                const replyGain = captured ? tacticalExchangeGain(step.after, reply) : 0;
                pos.play(reply);
                const gains = ["c7", "f6"].map((sq) => ({
                    target: sq,
                    gain: tacticalExchangeGain(pos, { from: step.move.to, to: parseSquare(sq)! }),
                }));
                if (replyGain <= -100) continue;
                if (!gains.some((g) => g.gain - Math.max(0, replyGain) >= 100))
                    failures.push({
                        reply: makeSan(step.after, reply),
                        uci: makeUci(reply),
                        replyGain,
                        gains,
                        fen: makeFen(pos.toSetup()),
                    });
            }
        expect(failures.map((f) => f.reply)).toEqual(["exd5"]);
        const diagnostics: string[] = [];
        const proof = proveDiscoveryBackedFork(step, 32768, (r) => diagnostics.push(r));
        expect({ proof, diagnostics }).toMatchObject({
            proof: { gain: expect.any(Number) },
            diagnostics: [],
        });
        expect(proof?.branches).toContainEqual(
            expect.objectContaining({ reply: "exd5", capture: "Bxf6" }),
        );
        expect(
            classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci }).motifs[0]?.id,
        ).toBe("fork");
    },
);
