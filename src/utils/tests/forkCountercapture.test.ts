import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import {
    proveImmediateFork,
    replayTacticalLine,
    tacticalBoardEvidence,
    tacticalCaptureGain,
    proveForkCaptureDefence,
    proveCheckingForkCaptureDefence,
    compareImmediateTacticalDefence,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import {
    forkCountercaptureFen,
    forkCountercaptureLine,
    forkCountercapturePredecessor,
    forkCountercaptureCases,
} from "./fixtures/forkCountercapture";

test.each([false, true])(
    "fork collection survives a connected queen countercapture (%s)",
    (reflected) => {
        const fen = reflected ? reflectMixedForkFen(forkCountercaptureFen) : forkCountercaptureFen;
        const moves = reflected
            ? forkCountercaptureLine.map(reflectMixedForkMove)
            : forkCountercaptureLine;
        const steps = replayTacticalLine(fen, moves);
        expect(steps).toHaveLength(5);
        expect(tacticalCaptureGain(steps[2])).toBe(180);
        const diagnostics: [string, string?, number?][] = [];
        const proof = proveImmediateFork(steps[0], (...args) => diagnostics.push(args));
        expect(proof?.gain).toBeGreaterThanOrEqual(190);
        expect(proof!.branches).toHaveLength(
            [...steps[0].after.allDests()].reduce((n, [, tos]) => n + tos.size(), 0),
        );
        expect(diagnostics.at(-1)?.[0]).toBe("proved");
        expect(diagnostics.at(-1)?.[2]).toBeGreaterThanOrEqual(0);
        const collection = proof!.branches.find((branch) => branch.replyUci === moves[1]);
        expect(collection?.captureUci).toBe(moves[2]);
        expect(collection?.collection).toContainEqual(
            expect.objectContaining({
                fen: makeFen(steps[3].after.toSetup()),
                moveUci: moves[4],
                balance: -400,
                quiet: false,
            }),
        );
        for (const pvUci of [moves.slice(0, 1), moves]) {
            const result = classifyPositionTacticalMotifs({ fen, pvUci });
            expect(result.motifs[0]).toMatchObject({ id: "fork", ply: 1, value: proof!.gain });
            expect(result.motifs[0].evidence).toContain("connected follow-up");
            const board = tacticalBoardEvidence(fen, pvUci, result.motifs[0]);
            const squares = (sq: string) =>
                reflected ? reflectMixedForkMove(sq + sq).slice(0, 2) : sq;
            expect(board).toEqual({
                square: squares("f7"),
                arrows: [
                    { from: squares("f7"), to: squares("d8") },
                    { from: squares("f7"), to: squares("h8") },
                ],
            });
            expect(
                buildLiveTacticalScan({ fen, pvUci, depth: 16, engineName: "Constructed fork" })
                    .motifs[0]?.id,
            ).toBe("fork");
        }
    },
);

test.each([false, true])("a different queen cannot finance the fork (%s)", (reflected) => {
    const original = forkCountercaptureFen.replace("1q2pppp", "q3pppp");
    const fen = reflected ? reflectMixedForkFen(original) : original;
    const move = reflected ? reflectMixedForkMove("e5f7") : "e5f7";
    expect(proveImmediateFork(replayTacticalLine(fen, [move])[0])).toBeNull();
    expect(
        classifyPositionTacticalMotifs({ fen, pvUci: [move] }).motifs.some((m) => m.id === "fork"),
    ).toBe(false);
});

test("taking the other rook cannot borrow the queen countercapture", () => {
    const steps = replayTacticalLine(forkCountercaptureFen, ["e5f7", "e7e6", "f7h8"]);
    expect(tacticalCaptureGain(steps[2])).toBeLessThan(0);
    expect(
        classifyPositionTacticalMotifs({
            fen: makeFen(steps[1].after.toSetup()),
            pvUci: ["f7h8"],
        }).motifs.some((m) => m.id === "fork"),
    ).toBe(false);
    const unsafeLine = classifyPositionTacticalMotifs({
        fen: forkCountercaptureFen, pvUci: ["e5f7", "e7e6", "f7h8", "f8a3"],
    });
    expect(unsafeLine.motifs[0]?.id).toBe("fork");
    expect(unsafeLine.timeline?.some(m=>m.ply===3&&m.label==="Fork Payoff")).toBe(false);
});

test("the two queen captures are one connected fork exchange, not two extra material gains",()=>{
    const result=classifyPositionTacticalMotifs({fen:forkCountercaptureFen,pvUci:forkCountercaptureLine});
    expect(result.timeline).toContainEqual(expect.objectContaining({ply:4,label:"Countercapture",value:undefined}));
    expect(result.timeline).toContainEqual(expect.objectContaining({ply:5,label:"Fork Countercapture",value:undefined}));
});

test("playing the fork is not missing it", () => {
    const args = { fen: forkCountercaptureFen, bestMoveUci: "e5f7", pvUci: forkCountercaptureLine };
    const missed = classifyMistakeReviewMotifs({ ...args, playedMoveUci: "e5g4" });
    expect(missed.missedMotifs.some((m) => m.id === "fork" && m.source === "missed")).toBe(true);
    expect(classifyMistakeReviewMotifs({ ...args, playedMoveUci: "e5f7" }).missedMotifs).toEqual(
        [],
    );
});

test("a safe queen capture stops the quiet fork, with capture credit included", () => {
    const fen = forkCountercaptureFen.replace("2kr1b1r/1q2pppp", "2krqb1r/4pppp");
    const root = replayTacticalLine(fen, ["e5f7"])[0];
    expect(root.after.isCheck()).toBe(false);
    expect(proveForkCaptureDefence(root)).toMatchObject({ defence: "Qxf7", gain: 220 });
    expect(proveCheckingForkCaptureDefence(root)).toBeNull();
    for (const limit of [0, 1, -1, NaN, Infinity, 1.5])
        expect(proveForkCaptureDefence(root, limit)).toBeNull();
});

test.each([false, true])(
    "the preceding move's fork cause has a concrete prevention witness (%s)",
    (reflected) => {
        const fen = reflected
            ? reflectMixedForkFen(forkCountercapturePredecessor)
            : forkCountercapturePredecessor;
        const move = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
        const actual = replayTacticalLine(fen, [move("c6b7"), move("e5f7")]);
        expect(actual).toHaveLength(2);
        const motifs = classifyPositionTacticalMotifs({
            fen: makeFen(actual[0].after.toSetup()),
            pvUci: [move("e5f7")],
        }).motifs;
        const compared = compareImmediateTacticalDefence(
            fen,
            move("c6e8"),
            move("c6b7"),
            move("e5f7"),
            motifs,
        );
        expect(compared.find((m) => m.id === "fork")).toMatchObject({ comparison: "prevented" });
    },
);

test.each(forkCountercaptureCases)("$id has the same judgement in both colours", (item) => {
    for (const reflected of [false, true]) {
        const fen = reflected ? reflectMixedForkFen(item.fen) : item.fen;
        const pvUci = reflected ? item.pvUci.map(reflectMixedForkMove) : item.pvUci;
        expect(
            classifyPositionTacticalMotifs({ fen, pvUci }).motifs.some((m) => m.id === "fork"),
        ).toBe(item.fork);
    }
});
