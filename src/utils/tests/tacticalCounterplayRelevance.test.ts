import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { replayTacticalLine, proveMatingCaptureReply } from "../tacticalMotifs/causalTactics";
import { parseSquare } from "chessops/util";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    counterplayFen as fen,
    counterplayPreviousFen as previousFen,
    counterplayLine as pvUci,
} from "./fixtures/tacticalCounterplay";

// Output-blind sample from the user's generated engine games, not a human
// game or an accuracy label. Qxb4+ is a recapture. The later rook trap comes
// after Black has independently started a checking double attack.

test.each([false, true])(
    "a recapture does not borrow a headline from subsequent counterplay (history=%s)",
    (history) => {
        const input = { fen, pvUci, ...(history ? { previousFen, previousMoveUci: "d6b4" } : {}) };
        const result = classifyPositionTacticalMotifs(input);
        expect(result.motifs.map((motif) => motif.id)).toEqual(history ? [] : ["hangingPiece"]);
        // These events really exist on the supplied continuation's reached boards.
        expect(result.timeline).toContainEqual(
            expect.objectContaining({ id: "forkPreparation", actor: "black", ply: 10 }),
        );
        expect(result.timeline).toContainEqual(
            expect.objectContaining({ id: "trappedPiece", actor: "white", ply: 19 }),
        );
        const scan = buildLiveTacticalScan({ ...input, engineName: "Regression", depth: 16 });
        expect(scan.motifs.map((motif) => motif.id)).toEqual(history ? [] : ["hangingPiece"]);
        expect(scan.arrows).toHaveLength(history ? 0 : 3);
        expect(scan.labels).toHaveLength(history ? 0 : 1);
        expect(scan.arrows.every((arrow) => arrow.ply < 19)).toBe(true);
        expect(scan.variations[0].timeline).toEqual(result.timeline);
    },
);

test("colour reflection has the same relevance boundary and retains White's actual counterplay", () => {
    const swap = (char: string) =>
        char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase();
    const reflect = (position: string) => {
        const fields = position.split(" ");
        fields[0] = fields[0].split("/").reverse().join("/").replace(/[a-z]/gi, swap);
        fields[1] = fields[1] === "w" ? "b" : "w";
        fields[2] = fields[2].replace(/[kq]/gi, swap);
        return fields.join(" ");
    };
    const mirrorMove = (move: string) => move.replace(/[1-8]/g, (rank) => String(9 - Number(rank)));
    const prior = reflect(previousFen);
    const previousMoveUci = mirrorMove("d6b4");
    // White's reflected previous move does not increment the fullmove counter.
    const reached = makeFen(replayTacticalLine(prior, [previousMoveUci])[0].after.toSetup());
    const result = classifyPositionTacticalMotifs({
        fen: reached,
        previousFen: prior,
        previousMoveUci,
        pvUci: pvUci.map(mirrorMove),
    });
    expect(result.motifs).toEqual([]);
    expect(result.timeline?.some((motif) => motif.id === "skewer")).toBe(false);
    expect(result.timeline).toContainEqual(
        expect.objectContaining({ id: "forkPreparation", actor: "white", ply: 10 }),
    );
    expect(result.timeline).toContainEqual(
        expect.objectContaining({ id: "trappedPiece", actor: "black", ply: 19 }),
    );
});

test("the reached counterattack and rook trap are still recognised in their own positions", () => {
    const steps = replayTacticalLine(fen, pvUci);
    for (const [index, id] of [
        [9, "forkPreparation"],
        [18, "trappedPiece"],
    ] as const) {
        const result = classifyPositionTacticalMotifs({
            fen: makeFen(steps[index].before.toSetup()),
            pvUci: pvUci.slice(index),
        });
        expect(result.motifs).toContainEqual(expect.objectContaining({ id, ply: 1 }));
    }
});

test("a geometric skewer cannot be funded by a capture allowing mate in three", () => {
    const steps = replayTacticalLine(fen, [...pvUci.slice(0, 11), "c1h1"]);
    const capture = steps.at(-1)!;
    expect(capture.san).toBe("Qxh1");
    expect(proveMatingCaptureReply(capture)).toBeNull();
    expect(proveMatingCaptureReply(capture, 4096, undefined, 3)).toEqual([
        "Ne7+",
        "Kh7",
        "Qf5+",
        "g6",
        "Qxf7#",
    ]);
    const root = makeFen(steps[9].before.toSetup());
    const result = classifyPositionTacticalMotifs({ fen: root, pvUci: pvUci.slice(9) });
    expect(result.motifs[0]).toMatchObject({ id: "forkPreparation", ply: 1 });
    expect(result.motifs.some((motif) => motif.id === "skewer")).toBe(false);
    expect(result.timeline?.some((motif) => motif.id === "skewer")).toBe(false);
});

test("removing the mating knight restores the ordinary skewer", () => {
    const before = replayTacticalLine(fen, pvUci)[9].before.clone();
    before.board.take(parseSquare("g6")!);
    const result = classifyPositionTacticalMotifs({
        fen: makeFen(before.toSetup()),
        pvUci: ["c8c1", "e1f2", "c1h1"],
    });
    expect(result.motifs[0]).toMatchObject({ id: "skewer", ply: 1 });
});

test("the longer mate refutation cannot reuse a shorter or exhausted search as proof", () => {
    const capture = replayTacticalLine(fen, [...pvUci.slice(0, 11), "c1h1"]).at(-1)!;
    expect(proveMatingCaptureReply(capture, 4096, undefined, 3)).not.toBeNull();
    expect(proveMatingCaptureReply(capture)).toBeNull();
    expect(proveMatingCaptureReply(capture, 1, undefined, 3)).toBeNull();
});

test("mistake review does not turn remote counterplay into an overlooked or missed root tactic", () => {
    const missed = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: "b3b4",
        playedMoveUci: "b3c3",
        pvUci,
    });
    // Without the preceding move, the missed capture is still meaningful;
    // the unrelated trap cannot be added as a secondary root lesson.
    expect(missed.missedMotifs.map((motif) => motif.id)).toEqual(["hangingPiece"]);
    expect(missed.missedTimeline).toContainEqual(
        expect.objectContaining({ id: "trappedPiece", ply: 19 }),
    );
    const allowed = classifyMistakeReviewMotifs({
        fen: previousFen,
        bestMoveUci: "e4f6",
        playedMoveUci: "d6b4",
        refutationUci: pvUci,
    });
    expect(allowed.allowedMotifs).toEqual([]);
    expect(allowed.allowedTimeline).toContainEqual(
        expect.objectContaining({ id: "trappedPiece", ply: 19 }),
    );
});
