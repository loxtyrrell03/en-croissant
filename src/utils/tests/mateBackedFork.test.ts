import { readFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { parseSquare } from "chessops/util";
import { expect, test } from "vitest";
import { proveMateBackedFork, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";

const fen = "3qkb1r/5p1b/4p1pp/4N3/2B5/6N1/4QPPP/6K1 w k - 0 1";
const line = ["e5f7", "e8f7", "e2e6", "f7g7", "g3f5", "g6f5", "e6f7"];

test("an all-mating queen offer cannot invent an independent material-fork lesson", () => {
    const position = "5q1k/7p/4Q3/8/8/6R1/8/4R1K1 w - - 0 1";
    const pvUci = ["e6f6", "f8f6", "e1e8", "f6f8", "e8f8"];
    const root = replayTacticalLine(position, pvUci)[0];
    expect(proveMateBackedFork(root)).toBeNull();
    const result = classifyPositionTacticalMotifs({ fen: position, pvUci });
    expect(result.motifs[0]?.id).toBe("mateIn3");
    expect(result.timeline?.some((m) => m.id === "fork")).toBe(false);
});

test("a mixed material-or-mate fork certificate cannot add noise to independently forced mate", () => {
    const position = "5q1k/3r3p/4Q3/8/8/6R1/8/4R1K1 w - - 0 1";
    const pvUci = ["e6f6", "f8f6", "e1e8", "f6f8", "e8f8"];
    expect(proveMateBackedFork(replayTacticalLine(position, pvUci)[0])).not.toBeNull();
    const result = classifyPositionTacticalMotifs({ fen: position, pvUci });
    expect(result.motifs[0]?.id).toBe("mateIn3");
    expect(result.timeline?.some((m) => m.id === "fork")).toBe(false);
});

test("the king cannot refute a real queen/rook fork by accepting forced mate", () => {
    const proof = proveMateBackedFork(replayTacticalLine(fen, line)[0]);
    expect(proof).not.toBeNull();
    expect(proof?.matingDefences).toContainEqual(expect.objectContaining({ defence: "Kxf7" }));
    expect(replayTacticalLine(fen, line).at(-1)?.after.isCheckmate()).toBe(true);
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.motifs[0]).toMatchObject({ id: "fork", ply: 1 });
    expect(result.motifs[0].evidence).toContain("conditional, not a forced mate");
    expect(result.motifs[0].value).toBeLessThan(10000);
});

test.each([["e5f7"], ["e5f7", "d8e7", "f7h8"]])(
    "root-only or declined PV still explains the same fork: %j",
    (...pvUci) => {
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]?.id).toBe("fork");
        expect(result.motifs[0].evidence).toContain("Kxf7 permits a forced mate");
    },
);

test("the board shows the real fork targets, not future mating arrows", () => {
    const scan = buildLiveTacticalScan({ fen, pvUci: line, depth: 16, engineName: "Constructed" });
    expect(scan.arrows.map((a) => a.from + a.to)).toEqual(["e5f7", "f7d8", "f7h8"]);
});

test("accepting the mate-backed fork is not displayed as winning a hanging knight", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line.slice(0, 3) });
    expect(result.timeline?.some((m) => m.id === "hangingPiece" && m.ply === 2)).toBe(false);
    const after = makeFen(replayTacticalLine(fen, line)[0].after.toSetup());
    const contextual = classifyPositionTacticalMotifs({
        fen: after,
        pvUci: ["e8f7"],
        previousFen: fen,
        previousMoveUci: "e5f7",
    });
    expect(contextual.motifs.some((m) => m.id === "hangingPiece")).toBe(false);
    expect(
        classifyPositionTacticalMotifs({ fen: after, pvUci: ["e8f7"] }).motifs.some(
            (m) => m.id === "hangingPiece",
        ),
    ).toBe(true);
});

test("without the mating bishop, accepting the offered knight retains its real material lesson", () => {
    const before = fen.replace("2B5", "8"),
        after = makeFen(replayTacticalLine(before, ["e5f7"])[0].after.toSetup());
    const result = classifyPositionTacticalMotifs({
        fen: after,
        pvUci: ["e8f7"],
        previousFen: before,
        previousMoveUci: "e5f7",
    });
    expect(result.motifs.some((m) => m.id === "hangingPiece")).toBe(true);
});

test.each(["c4", "e2"])(
    "removing mating support on %s makes the king capture a real defence",
    (square) => {
        const before = replayTacticalLine(fen, line)[0].before;
        before.board.take(parseSquare(square)!);
        const position = makeFen(before.toSetup());
        expect(replayTacticalLine(position, ["e5f7", "e8f7"])).toHaveLength(2);
        expect(proveMateBackedFork(replayTacticalLine(position, ["e5f7"])[0])).toBeNull();
    },
);

test("a new king flight prevents borrowing the old mating line", () => {
    const before = replayTacticalLine(fen, line)[0].before;
    before.board.take(parseSquare("h6")!);
    const position = makeFen(before.toSetup());
    expect(
        replayTacticalLine(position, [
            "e5f7",
            "e8f7",
            "e2e6",
            "f7g7",
            "g3f5",
            "g6f5",
            "e6f7",
            "g7h6",
        ]),
    ).toHaveLength(8);
    expect(proveMateBackedFork(replayTacticalLine(position, ["e5f7"])[0])).toBeNull();
});

test("the witness finishes immediate mate rather than inserting an unnecessary knight sacrifice", () => {
    const proof = proveMateBackedFork(replayTacticalLine(fen, line)[0]);
    expect(proof?.matingDefences).toEqual([{ defence: "Kxf7", mate: "Qxe6+ Kg7 Qf7#" }]);
    const position = fen.replace("6N1", "8");
    expect(proveMateBackedFork(replayTacticalLine(position, ["e5f7"])[0])).not.toBeNull();
});

test.each([0, 1, -1, NaN, Infinity, 1.5])(
    "invalid/exhausted budget %s cannot borrow a default proof",
    (budget) => {
        const root = replayTacticalLine(fen, line)[0];
        expect(proveMateBackedFork(root)).not.toBeNull();
        expect(proveMateBackedFork(root, budget)).toBeNull();
    },
);

test("missing a material fork target leaves no fork story to protect", () => {
    const position = fen.replace("3qkb1r", "4kb1r");
    expect(proveMateBackedFork(replayTacticalLine(position, ["e5f7"])[0])).toBeNull();
});

test("reflection preserves both material and conditional mate", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    fields[2] = "K";
    const reflected = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    const proof = proveMateBackedFork(replayTacticalLine(fields.join(" "), reflected)[0]);
    expect(proof?.gain).toBe(proveMateBackedFork(replayTacticalLine(fen, line)[0])?.gain);
    expect(
        classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: reflected }).motifs[0]?.id,
    ).toBe("fork");
});

test("a missed fork keeps its root lesson and actual-ply mating continuation", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        playedMoveUci: "h2h3",
        bestMoveUci: "e5f7",
        pvUci: line,
        refutationUci: [],
    });
    expect(review.missedMotifs[0]).toMatchObject({ id: "fork", ply: 1 });
    expect(buildMistakeReviewTacticalExplanation(review)?.primary.id).toBe("fork");
    expect(review.missedTimeline?.some((m) => m.ply! > 1 && m.value === 10000)).toBe(true);
});

test.skipIf(!process.env.TACTICAL_PRIVATE_DISJOINT_SAMPLE)(
    "a real previously empty fork is recovered; its countercheck variant remains unproved",
    () => {
        const sample = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_DISJOINT_SAMPLE!, "utf8"),
        );
        const row = sample.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 67);
        expect(proveMateBackedFork(replayTacticalLine(row.fen, row.sourceUci)[0])).toMatchObject({
            gain: 500,
        });
        expect(
            classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci }).motifs[0],
        ).toMatchObject({ id: "fork", ply: 1, value: 500 });
        const checking = sample.cases.find(
            (r: { eligibleIndex: number }) => r.eligibleIndex === 107,
        );
        expect(
            proveMateBackedFork(replayTacticalLine(checking.fen, checking.sourceUci)[0]),
        ).toBeNull();
        const rook = sample.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 134);
        expect(
            classifyPositionTacticalMotifs({ fen: rook.fen, pvUci: rook.sourceUci }).motifs[0],
        ).toMatchObject({ id: "fork", ply: 1, value: 900 });
    },
);
