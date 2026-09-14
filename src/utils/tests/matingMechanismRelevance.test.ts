import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen, parseFen } from "chessops/fen";
import type { Square } from "chessops/types";
import { parseSquare, parseUci, makeUci } from "chessops/util";
import { makeSan, parseSan } from "chessops/san";
import {
    replayTacticalLine,
    proveMatingSelfInterference,
    proveMatingDeflection,
    tacticalBoardEvidence,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    matingMechanismControls as controls,
    matingMechanismExamples as examples,
} from "./fixtures/matingMechanismRelevance";

const sample = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/cross-phase-development.json", "utf8"),
);
const interference = sample.cases.find((r: { id: string }) => r.id === "lichess:49h84");
const steps = replayTacticalLine(interference.startFen, interference.bestLine);
const deflection = sample.cases.find((r: { id: string }) => r.id === "lichess:qY3NM");

test("a king evasion blocks a real mating guard even though the prior position was already check", () => {
    expect(steps[1].before.isCheck()).toBe(true);
    expect(proveMatingSelfInterference(steps[1])).toMatchObject({
        defender: parseSquare("g4"),
        target: parseSquare("g7"),
        capturer: parseSquare("e7"),
        blocker: parseSquare("g5"),
        captureSan: "Rxg7#",
        mate: true,
        checkEvasion: true,
    });
    const result = classifyPositionTacticalMotifs({
        fen: interference.startFen,
        pvUci: interference.bestLine,
    });
    expect(result.motifs[0]).toMatchObject({ id: "mateIn2", ply: 1 });
    const detail = result.timeline!.find((m) => m.id === "selfInterference")!;
    expect(detail).toMatchObject({ ply: 2, actor: "black", relevance: "secondary" });
    expect(detail.evidence).toContain("only obstruction to a king-safe recapture");
    expect(detail.evidence).not.toContain("could legally recapture before");
    expect(tacticalBoardEvidence(interference.startFen, interference.bestLine, detail)).toEqual({
        square: "g5",
        arrows: [
            { from: "g4", to: "g5" },
            { from: "e7", to: "g7" },
        ],
    });
});

test("the queen deflection independently verifies the intervening rook block before mate", () => {
    const root = replayTacticalLine(deflection.startFen, deflection.bestLine)[0];
    const failures: string[] = [];
    const proof = proveMatingDeflection(root, 8192, (r) => failures.push(r));
    expect(proof).not.toBeNull();
    expect(failures).toEqual([]);
    expect(proof?.mating).toEqual([
        expect.objectContaining({
            reply: "Rxf6",
            mate: "Rxe8+",
            mode: "entry",
            continuation: [expect.objectContaining({ replySan: "Rf8", mateSan: "Rxf8#" })],
        }),
    ]);
    expect(proof?.declined).toEqual([{ reply: "Kg8", answer: "Qg7#", gain: 10000 }]);
    expect(proof?.forcingMate).toBe(true);
});

test.skipIf(!process.env.TACTICAL_MATING_MECHANISM_REPORT)(
    "export independent secondary mechanism witnesses",
    () => {
        expect(examples).toHaveLength(3);
        writeFileSync(
            process.env.TACTICAL_MATING_MECHANISM_REPORT!,
            JSON.stringify(
                {
                    cases: examples.map((row) => {
                        const line = replayTacticalLine(row.fen, row.pvUci);
                        return {
                            ...row,
                            proof:
                                row.id === "49h84"
                                    ? proveMatingSelfInterference(line[1])
                                    : proveMatingDeflection(line[0]),
                            result: classifyPositionTacticalMotifs(row),
                        };
                    }),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);

test.each(examples)(
    "every root keeps mate primary on both short and complete input: $id",
    (row) => {
        for (const pvUci of [[row.pvUci[0]], row.pvUci]) {
            const result = classifyPositionTacticalMotifs({ ...row, pvUci });
            const scan = buildLiveTacticalScan({
                ...row,
                pvUci,
                engineName: "Regression",
                depth: 16,
            });
            expect(result.motifs[0].id).toBe(row.id === "49h84" ? "mateIn2" : "mateIn3");
            expect(scan.motifs.map((m) => m.id)).toEqual([result.motifs[0].id]);
            expect(scan.labels.some((l) => l.id === "selfInterference")).toBe(false);
        }
    },
);

test("the deflected approach is drawn on this board without future rook-block or mate arrows", () => {
    const scan = buildLiveTacticalScan({
        fen: deflection.startFen,
        pvUci: deflection.bestLine,
        engineName: "Regression",
        depth: 16,
    });
    expect(scan.labels.map((l) => l.id)).toEqual(["mateIn3"]);
    expect(scan.arrows.map((a) => [a.from, a.to])).toEqual([
        ["f3", "f6"],
        ["e1", "e6"],
    ]);
    expect(scan.variations[0].timeline.find((m) => m.id === "deflection")).toMatchObject({
        ply: 1,
        label: "Mating Deflection",
        relevance: "secondary",
    });
});

test.each(examples.slice(1))(
    "all acceptances, declines and intervening evasions are covered: $id",
    (row) => {
        const root = replayTacticalLine(row.fen, row.pvUci)[0],
            proof = proveMatingDeflection(root)!;
        const legal = [...root.after.allDests()].flatMap(([from, tos]) =>
            [...tos].map((to) => makeSan(root.after, { from, to })),
        );
        expect(new Set([...proof.mating, ...proof.declined].map((b) => b.reply))).toEqual(
            new Set(legal),
        );
        expect(proof.visits).toBeLessThanOrEqual(8192);
        for (const branch of proof.mating) {
            const accepted = root.after.clone();
            accepted.play(parseSan(accepted, branch.reply)!);
            const entered = accepted.clone();
            entered.play(parseSan(entered, branch.mate)!);
            const replies = [...entered.allDests()].flatMap(([from, tos]) =>
                [...tos].map((to) => makeUci({ from, to })),
            );
            expect(new Set(branch.continuation!.map((b) => b.replyUci))).toEqual(new Set(replies));
            for (const reply of branch.continuation!) {
                const next = entered.clone();
                next.play(parseUci(reply.replyUci)!);
                expect(makeFen(next.toSetup())).toBe(reply.fen);
                expect(next.isLegal(parseUci(reply.mateUci)!)).toBe(true);
                next.play(parseUci(reply.mateUci)!);
                expect(next.isCheckmate()).toBe(true);
            }
        }
    },
);

test.each([0, 1, 64, -1, 1.5, NaN, Infinity])(
    "partial/invalid deflection budgets cannot borrow a complete proof: %s",
    (limit) => {
        const root = replayTacticalLine(deflection.startFen, deflection.bestLine)[0];
        expect(proveMatingDeflection(root)).not.toBeNull();
        expect(proveMatingDeflection(root, limit)).toBeNull();
    },
);

test.each([0, 1, -1, 1.5, NaN, Infinity])(
    "partial/invalid interference budgets abstain: %s",
    (limit) => {
        expect(proveMatingSelfInterference(steps[1], limit)).toBeNull();
    },
);

test.each([7, 56, 63])("mating mechanisms and primary ownership survive reflection %s", (flip) => {
    for (const row of examples) {
        const setup = parseFen(row.fen).unwrap(),
            original = setup.board;
        setup.board = original.clone();
        setup.board.clear();
        for (const [square, piece] of original)
            setup.board.set((square ^ flip) as Square, {
                ...piece,
                color: flip & 56 ? (piece.color === "white" ? "black" : "white") : piece.color,
            });
        if (flip & 56) setup.turn = setup.turn === "white" ? "black" : "white";
        const pvUci = row.pvUci.map((uci) => {
            const move = parseUci(uci)!;
            if (!("from" in move)) throw new Error("Unexpected drop");
            return makeUci({
                ...move,
                from: (move.from ^ flip) as Square,
                to: (move.to ^ flip) as Square,
            });
        });
        const result = classifyPositionTacticalMotifs({ fen: makeFen(setup), pvUci });
        expect(result.motifs[0].id).toBe(row.id === "49h84" ? "mateIn2" : "mateIn3");
        expect(result.timeline?.map((m) => [m.ply, m.id])).toEqual(
            classifyPositionTacticalMotifs(row).timeline?.map((m) => [m.ply, m.id]),
        );
    }
});

test.each(examples)(
    "missed mate retains its secondary mechanism rather than replacing the main lesson: $id",
    (row) => {
        const played = row.id === "49h84" ? "e1e3" : row.id === "qY3NM" ? "f3d3" : "d7a7";
        const review = classifyMistakeReviewMotifs({
            fen: row.fen,
            playedMoveUci: played,
            bestMoveUci: row.pvUci[0],
            pvUci: row.pvUci,
        });
        expect(review.missedMotifs[0].id).toBe(row.id === "49h84" ? "mateIn2" : "mateIn3");
        expect(
            review.missedTimeline?.some(
                (m) =>
                    m.id === (row.id === "49h84" ? "selfInterference" : "deflection") &&
                    m.ply === (row.id === "49h84" ? 2 : 1),
            ),
        ).toBe(true);
    },
);

test.each(controls.filter((c) => c.theme === "selfInterference"))(
    "the interference proof rejects an actual missing resource: $id",
    (control) => {
        const line = replayTacticalLine(control.fen, interference.bestLine);
        expect(line).toHaveLength(3);
        expect(proveMatingSelfInterference(line[1])).toBeNull();
    },
);

test("a pinned guard does not get credit even when the resulting capture is actually mate", () => {
    const line = replayTacticalLine(
        controls.find((c) => c.id === "pinned-guard")!.fen,
        interference.bestLine,
    );
    expect(line[2].after.isCheckmate()).toBe(true);
    const hypothetical = line[2].after.clone();
    const rook = hypothetical.board.take(parseSquare("g4")!)!;
    hypothetical.board.set(parseSquare("g7")!, rook);
    expect(hypothetical.isCheck()).toBe(true);
    expect(proveMatingSelfInterference(line[1])).toBeNull();
});

test.each(controls.filter((c) => c.theme === "deflection"))(
    "the deflection must survive the actual defensive resource: $id",
    (control) => {
        const root = replayTacticalLine(control.fen, [deflection.bestLine[0]])[0];
        expect(root).toBeDefined();
        expect(proveMatingDeflection(root)).toBeNull();
    },
);

test("the final knight recapture refutes the whole longer acceptance, not only immediate mate", () => {
    const line = replayTacticalLine(controls.find((c) => c.id === "guarded-finish")!.fen, [
        ...deflection.bestLine,
        "g6f8",
    ]);
    expect(line).toHaveLength(6);
    expect(line[4].after.isCheckmate()).toBe(false);
    expect(line[5].capture).toBe(500);
});
