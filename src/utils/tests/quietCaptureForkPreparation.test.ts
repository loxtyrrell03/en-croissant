import { readFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { parseSquare } from "chessops/util";
import { expect, test } from "vitest";
import { proveCaptureForkPreparation, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

const fen = "8/p7/7k/4p3/2n5/2B5/5Q1P/6K1 w - - 0 1";
const line = ["c3e5", "c4e5", "f2f4", "h6h7", "f4e5"];
test("a quiet bishop offer attracts the knight onto a checking-fork square", () => {
    const steps = replayTacticalLine(fen, line);
    expect(steps).toHaveLength(5);
    expect(steps[0].after.isCheck()).toBe(false);
    expect(steps[4].balance).toBe(90);
    expect(proveCaptureForkPreparation(steps[0])).toMatchObject({ gain: 90 });
    expect(classifyPositionTacticalMotifs({ fen, pvUci: line }).motifs[0]).toMatchObject({
        id: "forkPreparation",
        ply: 1,
        value: 90,
    });
});

test("the board draws the capture now, not a nonexistent check or later fork", () => {
    const scan = buildLiveTacticalScan({ fen, pvUci: line, depth: 16, engineName: "Constructed" });
    expect(scan.arrows.map((a) => a.from + a.to)).toEqual(["c3e5"]);
    expect(scan.motifs[0].evidence).toContain("attract the knight onto e5");
    expect(scan.motifs[0].evidence).not.toContain("attract the king");
});

test("a root-only scan proves the preparation without assuming a cooperative reply", () => {
    expect(classifyPositionTacticalMotifs({ fen, pvUci: [line[0]] }).motifs[0]).toMatchObject({
        id: "forkPreparation",
        ply: 1,
        value: 90,
    });
});

test("the missed opportunity keeps its pawn-minus-minor-piece-imbalance value", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        playedMoveUci: "g1f1",
        bestMoveUci: line[0],
        pvUci: line,
        refutationUci: [],
    });
    expect(review.missedMotifs[0]).toMatchObject({ id: "forkPreparation", value: 90 });
});

test.each(["8/p7/7k/4p3/2n5/2B5/7P/6K1 w - - 0 1", "8/p7/7k/4p1p1/2n5/2B2P2/5Q1P/6K1 w - - 0 1"])(
    "missing checking resources cannot be replaced by a geometric attraction: %s",
    (position) => {
        const step = replayTacticalLine(position, [line[0]])[0];
        expect(step).toBeDefined();
        expect(proveCaptureForkPreparation(step)).toBeNull();
    },
);

test("a free pawn with no recapturer is a direct gain, not fork preparation", () => {
    const position = fen.replace("2n5", "8");
    expect(proveCaptureForkPreparation(replayTacticalLine(position, [line[0]])[0])).toBeNull();
});

test("an independent fork against another victim cannot justify the offered capture", () => {
    const position = "8/7k/3pq3/4p3/4N3/2B5/8/K7 w - - 0 1";
    expect(classifyPositionTacticalMotifs({ fen: position, pvUci: ["e4g5"] }).motifs[0]?.id).toBe(
        "fork",
    );
    expect(replayTacticalLine(position, ["c3e5", "d6e5", "e4g5"])).toHaveLength(3);
    expect(proveCaptureForkPreparation(replayTacticalLine(position, ["c3e5"])[0])).toBeNull();
});

test("invalid or exhausted budgets cannot borrow the quiet preparation cache", () => {
    const step = replayTacticalLine(fen, line)[0];
    expect(proveCaptureForkPreparation(step)).not.toBeNull();
    for (const budget of [0, -1, NaN, Infinity, 1, 1.5])
        expect(proveCaptureForkPreparation(step, budget)).toBeNull();
    expect(proveCaptureForkPreparation(step)).not.toBeNull();
});

test("colour reflection preserves the nonchecking preparation and its balance", () => {
    const position = "6k1/5q1p/2b5/2N5/4P3/7K/P7/8 b - - 0 1";
    expect(
        classifyPositionTacticalMotifs({
            fen: position,
            pvUci: ["c6e4", "c5e4", "f7f5", "h3h2", "f5e4"],
        }).motifs[0],
    ).toMatchObject({ id: "forkPreparation", value: 90 });
});

test.skipIf(!process.env.TACTICAL_PRIVATE_PGN_SAMPLE)(
    "quiet captures prepare the private checking forks against every defence",
    () => {
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_PGN_SAMPLE!, "utf8"));
        for (const index of [87, 173]) {
            const row = sample.cases.find(
                (r: { eligibleIndex: number }) => r.eligibleIndex === index,
            );
            const failures: string[] = [];
            const proof = proveCaptureForkPreparation(
                replayTacticalLine(row.fen, row.sourceUci)[0],
                8192,
                (reason) => failures.push(reason),
            );
            expect(failures).toEqual([]);
            expect(proof).toMatchObject({ gain: index === 87 ? 90 : 100 });
            expect(
                classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci }).motifs[0],
            ).toMatchObject({ id: "forkPreparation", ply: 1, value: index === 87 ? 90 : 100 });
            expect(
                proveCaptureForkPreparation(replayTacticalLine(row.fen, row.sourceUci)[0]),
            ).toEqual(proof);
        }
    },
);

test.skipIf(!process.env.TACTICAL_PRIVATE_PGN_SAMPLE)(
    "a real countercapture needs the checking recovery and a queen-saving defence",
    () => {
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_PGN_SAMPLE!, "utf8"));
        const row = sample.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 173);
        const moves = ["f3c6", "b5c6", "f4c7", "f7g6", "c7c6", "f6b2", "c6e6"];
        const steps = replayTacticalLine(row.fen, moves);
        expect(steps).toHaveLength(moves.length);
        expect(steps[6].after.isCheck()).toBe(true);
        expect(steps[5].balance).toBe(0);
        expect(steps[6].balance).toBe(100);
        const proof = proveCaptureForkPreparation(steps[0])!;
        expect(proof.declined).toEqual(
            expect.arrayContaining([expect.objectContaining({ reply: "g5" })]),
        );
        const guarded = steps[0].before.clone();
        guarded.board.set(parseSquare("g7")!, { color: "black", role: "knight" });
        const changed = makeFen(guarded.toSetup());
        expect(replayTacticalLine(changed, [...moves, "g7e6"])).toHaveLength(8);
        expect(proveCaptureForkPreparation(replayTacticalLine(changed, moves)[0])).toBeNull();
        const failures: string[] = [];
        expect(proveCaptureForkPreparation(steps[0], 4096, (why) => failures.push(why))).toBeNull();
        expect(failures[0]).toContain("budget exhausted");
    },
);
