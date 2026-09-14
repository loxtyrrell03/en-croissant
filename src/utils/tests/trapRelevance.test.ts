import { readFileSync, writeFileSync } from "node:fs";
import { makeFen, parseFen } from "chessops/fen";
import type { Square } from "chessops/types";
import { makeUci, parseSquare, parseUci } from "chessops/util";
import { expect, test } from "vitest";
import {
    proveTrappedMaterial,
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
import { counterplayFen, counterplayLine } from "./fixtures/tacticalCounterplay";
import {
    trappedRookFen,
    trappedRookLine,
    trapControls,
    unrelatedPayoffTrap,
} from "./fixtures/trapRelevance";

const sq = (name: string) => parseSquare(name)!;
const root = () => replayTacticalLine(trappedRookFen, trappedRookLine)[0];

test("the defended rook trap covers every root reply and every connected recovery leaf", () => {
    const step = root(),
        proof = proveTrappedMaterial(step, sq("e3"))!;
    expect(proof).toMatchObject({ gain: 180, defenders: [{ reply: "Bg5", answer: "Nxg5" }] });
    expect(proof.branches).toHaveLength(37);
    expect(proof.recoveryVisits).toBeLessThanOrEqual(4096);
    expect(new Set(proof.branches.map((b) => b.replyUci))).toEqual(
        new Set(
            [...step.after.allDests()].flatMap(([from, tos]) =>
                [...tos].map((to) => makeUci({ from, to })),
            ),
        ),
    );
    for (const branch of proof.branches)
        expect(replayTacticalLine(branch.fen, [branch.answerUci])).toHaveLength(1);
    const branch = proof.branches.find((b) => b.replyUci === "e7g5")!;
    expect(branch.answerUci).toBe("e4g5");
    expect(branch.continuation).toHaveLength(32);
    const removed = replayTacticalLine(trappedRookFen, ["g1f2", "e7g5", "e4g5"])[2];
    expect(new Set(branch.continuation!.map((leaf) => leaf.fen))).toEqual(
        new Set(
            [...removed.after.allDests()].flatMap(([from, tos]) =>
                [...tos].map((to) => {
                    const next = removed.after.clone();
                    next.play({ from, to });
                    return makeFen(next.toSetup());
                }),
            ),
        ),
    );
    for (const leaf of branch.continuation!) {
        expect(replayTacticalLine(leaf.fen, [leaf.moveUci])).toHaveLength(1);
        expect(leaf.gain).toBeGreaterThanOrEqual(180);
    }
    expect(branch.continuation!.some((leaf) => leaf.quiet)).toBe(true);
});

test.each([true, false])(
    "the root trap does not depend on the cooperative PV (root-only %s)",
    (rootOnly) => {
        const pvUci = rootOnly ? trappedRookLine.slice(0, 1) : trappedRookLine;
        const result = classifyPositionTacticalMotifs({ fen: trappedRookFen, pvUci });
        expect(result.motifs[0]).toMatchObject({
            id: "trappedPiece",
            label: "Trapped Rook",
            ply: 1,
            value: 180,
        });
        expect(result.motifs[0].evidence).toContain("Bg5 is answered by Nxg5");
        expect(tacticalBoardEvidence(trappedRookFen, pvUci, result.motifs[0])).toEqual({
            square: "e3",
            arrows: [{ from: "f2", to: "e3" }],
        });
        const scan = buildLiveTacticalScan({
            fen: trappedRookFen,
            pvUci,
            engineName: "Regression",
            depth: 16,
        });
        expect(scan.motifs.map((m) => m.id)).toEqual(["trappedPiece"]);
        expect(scan.labels.map((m) => m.id)).toEqual(["trappedPiece"]);
        expect(scan.arrows.some((a) => a.to === "g5")).toBe(false);
    },
);

test.each(trapControls)("a concrete resource defeats the trap: $id", (control) => {
    const steps = replayTacticalLine(control.fen, ["g1f2", control.reply]);
    expect(steps).toHaveLength(2);
    expect(proveTrappedMaterial(steps[0], sq("e3"))).toBeNull();
    const result = classifyPositionTacticalMotifs({ fen: control.fen, pvUci: ["g1f2"] });
    expect(result.motifs.map((m) => m.id)).not.toContain("trappedPiece");
});

test("an unrelated loose queen cannot turn a safely escaping rook into a trapped piece", () => {
    const steps = replayTacticalLine(unrelatedPayoffTrap.fen, unrelatedPayoffTrap.pvUci);
    expect(steps).toHaveLength(3);
    expect(tacticalExchangeGain(steps[2].before, steps[2].move)).toBe(900);
    expect(proveTrappedMaterial(steps[0], sq("a1"))).toBeNull();
    expect(
        classifyPositionTacticalMotifs(unrelatedPayoffTrap).motifs.map((m) => m.id),
    ).not.toContain("trappedPiece");
});

test.each([0, 1, -1, 1.5, NaN, Infinity])(
    "partial or invalid trap budgets cannot reuse cached success: %s",
    (limit) => {
        expect(proveTrappedMaterial(root(), sq("e3"))?.gain).toBe(180);
        expect(proveTrappedMaterial(root(), sq("e3"), limit)).toBeNull();
    },
);
test.each([-1, 1.5, NaN, Infinity])("invalid pin nomination limits abstain: %s", (limit) => {
    expect(proveTrappedMaterial(root(), sq("e3"), 256, limit)).toBeNull();
});
test("a real defender-removal trap does not consume pin nominations", () => {
    expect(proveTrappedMaterial(root(), sq("e3"), 256, 0)?.gain).toBe(180);
});

test("a related countercapture preserves a real exchange-winning trap without claiming a won game", () => {
    const step = replayTacticalLine(counterplayFen, counterplayLine)[18];
    const proof = proveTrappedMaterial(step, sq("a8"))!;
    expect(proof).toMatchObject({
        gain: 170,
        countercaptures: [{ reply: "Qxb5", answer: "Qxb5" }],
    });
    expect(proof.branches).toHaveLength(24);
    expect(proof.branches.find((b) => b.replyUci === "b6b5")?.answerUci).toBe("d5b5");
    const result = classifyPositionTacticalMotifs({
        fen: makeFen(step.before.toSetup()),
        pvUci: [step.uci],
        rootCp: 0,
    });
    expect(result.motifs[0]).toMatchObject({ id: "trappedPiece", ply: 1, value: 170 });
    expect(result.motifs[0].evidence).toContain("Qxb5 is answered by Qxb5");
    // The originating move did not cause this much later trap.
    const original = classifyPositionTacticalMotifs({
        fen: counterplayFen,
        pvUci: counterplayLine,
    });
    expect(original.motifs.some((m) => m.id === "trappedPiece")).toBe(false);
    expect(original.timeline?.find((m) => m.id === "trappedPiece")).toMatchObject({
        ply: 19,
        value: 170,
    });
});

test("compensation elsewhere reduces the bound without erasing genuine trap mechanisms", () => {
    const cases = [
        {
            fen: "4k2r/3nbppp/8/4p3/4P3/4Q3/PBq2PPP/RN2K2R b KQk - 0 17",
            move: "c2b2",
            target: "a1",
            gain: 730,
        },
        {
            fen: "6k1/5p2/4p1pQ/7P/3b4/7r/2P3K1/8 b - - 3 36",
            move: "d4e3",
            target: "h6",
            gain: 300,
        },
        {
            fen: "5rk1/1qpn1ppp/2b1pn2/Q1b5/1P2pP2/P1N3N1/2PP2PP/R1B2R1K b - b3 0 16",
            move: "f8a8",
            target: "a5",
            gain: 170,
        },
    ];
    for (const item of cases) {
        const step = replayTacticalLine(item.fen, [item.move])[0];
        expect(step).toBeDefined();
        expect(proveTrappedMaterial(step, sq(item.target))?.gain).toBe(item.gain);
    }
});

test("mistake review explains the missed immediate trap rather than a future loose-piece capture", () => {
    const review = classifyMistakeReviewMotifs({
        fen: trappedRookFen,
        playedMoveUci: "f1e1",
        bestMoveUci: "g1f2",
        pvUci: trappedRookLine,
    });
    expect(review.missedMotifs[0]).toMatchObject({
        id: "trappedPiece",
        ply: 1,
        source: "missed",
        value: 180,
    });
    expect(buildMistakeReviewTacticalExplanation(review)?.primary).toMatchObject({
        id: "trappedPiece",
        source: "missed",
    });
});

function reflected(fen: string, moveUci: string, target: Square, flip: number) {
    const setup = parseFen(fen).unwrap(),
        board = setup.board;
    expect(setup.castlingRights.isEmpty()).toBe(true);
    setup.board = board.clone();
    setup.board.clear();
    for (const [square, piece] of board)
        setup.board.set((square ^ flip) as Square, {
            ...piece,
            color: flip & 56 ? (piece.color === "white" ? "black" : "white") : piece.color,
        });
    if (flip & 56) setup.turn = setup.turn === "white" ? "black" : "white";
    if (setup.epSquare !== undefined) setup.epSquare = (setup.epSquare ^ flip) as Square;
    const move = parseUci(moveUci)!;
    if (!("from" in move)) throw new Error("Unexpected drop");
    return {
        fen: makeFen(setup),
        move: makeUci({
            ...move,
            from: (move.from ^ flip) as Square,
            to: (move.to ^ flip) as Square,
        }),
        target: (target ^ flip) as Square,
    };
}
test.each([7, 56, 63])("root and countercapture proofs survive board reflection %s", (flip) => {
    const counter = replayTacticalLine(counterplayFen, counterplayLine)[18];
    for (const item of [
        { fen: trappedRookFen, move: "g1f2", target: sq("e3"), gain: 180 },
        { fen: makeFen(counter.before.toSetup()), move: counter.uci, target: sq("a8"), gain: 170 },
    ]) {
        const input = reflected(item.fen, item.move, item.target, flip),
            step = replayTacticalLine(input.fen, [input.move])[0];
        expect(proveTrappedMaterial(step, input.target)?.gain).toBe(item.gain);
        expect(
            classifyPositionTacticalMotifs({ fen: input.fen, pvUci: [input.move] }).motifs[0],
        ).toMatchObject({ id: "trappedPiece", ply: 1, value: item.gain });
    }
});

test.skipIf(!process.env.TACTICAL_TRAP_WITNESS_REPORT)(
    "export all-defence witnesses for an independent engine audit",
    () => {
        const step = root(),
            proof = proveTrappedMaterial(step, sq("e3"));
        expect(proof).toMatchObject({gain: 180});
        const oldFen = "4k2r/3nbppp/8/4p3/4P3/4Q3/PBq2PPP/RN2K2R b KQk - 0 17";
        const oldProof = proveTrappedMaterial(replayTacticalLine(oldFen, ["c2b2"])[0], sq("a1"));
        const secondary = JSON.parse(
            readFileSync("benchmarks/tactical-relevance/secondary-theme-stockfish-18.json", "utf8"),
        );
        const otherTraps = [
            {
                id: "counterplay",
                step: replayTacticalLine(counterplayFen, counterplayLine)[18],
                target: sq("a8"),
            },
            ...["j8Up4", "S9vEb"].map((id) => {
                const r = secondary.cases.find((r: { id: string }) => r.id === `lichess:${id}`);
                return {
                    id,
                    step: replayTacticalLine(r.fen, r.engineLines[0].pvUci)[id === "j8Up4" ? 2 : 0],
                    target: sq(id === "j8Up4" ? "h6" : "a5"),
                };
            }),
        ].map(({ id, step, target }) => ({
            id,
            fen: makeFen(step.before.toSetup()),
            move: step.uci,
            proof: proveTrappedMaterial(step, target),
        }));
        writeFileSync(
            process.env.TACTICAL_TRAP_WITNESS_REPORT!,
            JSON.stringify(
                { fen: trappedRookFen, move: step.uci, proof, oldFen, oldProof, otherTraps },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);
