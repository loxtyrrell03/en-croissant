import { readFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { parseSquare } from "chessops/util";
import { expect, test } from "vitest";
import {
    proveMatingKingDeflection,
    replayTacticalLine,
    tacticalBoardEvidence,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";

const fixture = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/rare-theme-development.json", "utf8"),
);
const row = fixture.cases.find((r: { id: string }) => r.id === "lichess:om0GQ");
const steps = replayTacticalLine(row.startFen, row.bestLine);

test("the mate stays primary while the king deflection appears on the actual rook check", () => {
    const result = classifyPositionTacticalMotifs({ fen: row.startFen, pvUci: row.bestLine });
    expect(result.motifs[0]).toMatchObject({ id: "mateIn3", ply: 1 });
    expect(result.timeline?.find((m) => m.id === "deflection")).toMatchObject({
        label: "Mating Deflection",
        ply: 3,
        moveUci: "g1g7",
        actor: "white",
        relevance: "secondary",
    });
    expect(result.timeline?.filter((m) => m.id === "deflection")).toHaveLength(1);
    expect(result.timeline?.find((m) => m.id === "deflection")?.evidence).toContain(
        "Capturing on h6 first would allow the king to take that piece",
    );
    expect(
        tacticalBoardEvidence(
            row.startFen,
            row.bestLine,
            result.timeline?.find((m) => m.id === "deflection"),
        ),
    ).toEqual({
        square: "g7",
        arrows: [
            { from: "h7", to: "h8" },
            { from: "h5", to: "h6" },
        ],
    });
});

test("the local mechanism does not require the supplied accepting reply or mating PV", () => {
    const fen = makeFen(steps[2].before.toSetup());
    expect(proveMatingKingDeflection(steps[2])).toMatchObject({
        branches: [{ reply: "Kh8", mate: "Rxh6#" }],
    });
    const result = classifyPositionTacticalMotifs({ fen, pvUci: ["g1g7"] });
    expect(result.motifs[0]).toMatchObject({ id: "mateIn2", ply: 1 });
    expect(result.timeline?.find((m) => m.id === "deflection")).toMatchObject({
        ply: 1,
        relevance: "secondary",
    });
});

test.each(["remove-pawn", "bishop-capture"])(
    "every legal defensive resource matters: %s",
    (variant) => {
        const pos = steps[2].before.clone();
        if (variant === "remove-pawn") pos.board.take(parseSquare("f6")!);
        else pos.board.set(parseSquare("f8")!, { color: "black", role: "bishop" });
        const line = replayTacticalLine(makeFen(pos.toSetup()), ["g1g7"]);
        expect(line).toHaveLength(1);
        const reply = variant === "remove-pawn" ? "h7g7" : "f8g7";
        expect(replayTacticalLine(makeFen(pos.toSetup()), ["g1g7", reply])).toHaveLength(2);
        expect(proveMatingKingDeflection(line[0])).toBeNull();
        expect(
            classifyPositionTacticalMotifs({
                fen: makeFen(pos.toSetup()),
                pvUci: ["g1g7"],
            }).timeline?.some((m) => m.label === "Mating Deflection") ?? false,
        ).toBe(false);
    },
);

test("the king could legally capture the premature mating piece", () => {
    const line = replayTacticalLine(makeFen(steps[2].before.toSetup()), ["h5h6", "h7h6"]);
    expect(line).toHaveLength(2);
    expect(line[0].after.isCheckmate()).toBe(false);
    expect(line[1].capture).toBe(500);
});

test("protecting the mating queen is not deflection when the king still guards the same square", () => {
    const fen = "6k1/6pp/7Q/8/1B4R1/8/8/1K6 w - - 0 1";
    const line = replayTacticalLine(fen, ["g4g7", "g8h8", "h6h7"]);
    expect(line).toHaveLength(3);
    expect(line[2].after.isCheckmate()).toBe(true);
    expect(replayTacticalLine(fen, ["h6h7", "g8h7"])).toHaveLength(2);
    expect(proveMatingKingDeflection(line[0])).toBeNull();
    expect(
        classifyPositionTacticalMotifs({ fen, pvUci: ["g4g7"] }).timeline?.some(
            (m) => m.label === "Mating Deflection",
        ) ?? false,
    ).toBe(false);
});

test.each([0, 1, -1, 1.5, NaN, Infinity])(
    "invalid or exhausted budgets cannot reuse a completed deflection: %s",
    (limit) => {
        expect(proveMatingKingDeflection(steps[2])).not.toBeNull();
        expect(proveMatingKingDeflection(steps[2], limit)).toBeNull();
    },
);

test("a missed mate retains its secondary deflection without calling it the first move", () => {
    const review = classifyMistakeReviewMotifs({
        fen: row.startFen,
        bestMoveUci: row.bestLine[0],
        playedMoveUci: "g1g7",
        pvUci: row.bestLine,
    });
    expect(review.missedMotifs[0]).toMatchObject({ id: "mateIn3", ply: 1 });
    expect(review.missedTimeline?.find((m) => m.id === "deflection")).toMatchObject({
        ply: 3,
        source: "missed",
    });
});
