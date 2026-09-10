import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import {
    auditTacticalMotifs,
    proveCheckingMate,
    proveShortCheckingMate,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

// Constructed mating capture: the bishop's market value is not a separate
// lesson when taking it forces mate against every legal defence.
const fen = "4b2k/7p/5q2/8/8/6R1/8/4R1K1 w - - 0 1";
const line = ["e1e8", "f6f8", "e8f8"];

test("a mating capture is not a second hanging-piece lesson", () => {
    const steps = replayTacticalLine(fen, line);
    expect(steps).toHaveLength(line.length);
    expect(proveCheckingMate(steps)).not.toBeNull();
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.motifs[0]?.id).toMatch(/^mateIn/);
    expect(result.timeline?.some((m) => m.id === "hangingPiece" && m.ply === 1)).toBe(false);
    expect(result.motifs.some((m) => m.id === "hangingPiece" && m.ply === 1)).toBe(false);
    expect(result.timeline?.some((m) => m.id === "mateIn1" && m.ply === 3)).toBe(true);
});

test("without the mating proof, the genuine capture remains a material lesson", () => {
    const position = fen.replace("6R1", "8");
    expect(proveCheckingMate(replayTacticalLine(position, line))).toBeNull();
    expect(replayTacticalLine(position, ["e1e8", "h8g7"])).toHaveLength(2);
    const result = classifyPositionTacticalMotifs({ fen: position, pvUci: ["e1e8", "h8g7"] });
    expect(result.motifs.some((m) => m.id === "hangingPiece" && m.ply === 1)).toBe(true);
});

test("an unverified mate proposal cannot erase the material lesson", () => {
    const position = fen.replace("6R1", "8");
    expect(proveShortCheckingMate(replayTacticalLine(position, [line[0]])[0])).toBeNull();
    const result = auditTacticalMotifs(
        position,
        [line[0]],
        [
            {
                id: "mateIn2",
                label: "Forcing Mate",
                source: "available",
                confidence: "high",
                ply: 1,
                value: 10000,
                moveUci: line[0],
                evidence: "Unverified supplied tag",
            },
        ],
    );
    expect(result.some((m) => m.id === "hangingPiece" && m.ply === 1)).toBe(true);
});

test("a root-only input independently proves the short mate instead of borrowing a tag", () => {
    expect(proveCheckingMate(replayTacticalLine(fen, [line[0]]))).toBeNull();
    expect(proveShortCheckingMate(replayTacticalLine(fen, [line[0]])[0])?.maxMoves).toBe(2);
    const result = classifyPositionTacticalMotifs({ fen, pvUci: [line[0]] });
    expect(result.motifs[0]).toMatchObject({ id: "mateIn2", ply: 1, label: "Forcing Mate" });
    expect(result.motifs.some((m) => m.id === "hangingPiece")).toBe(false);
});

test("the board keeps the mating attack as its primary explanation", () => {
    const scan = buildLiveTacticalScan({ fen, pvUci: line, depth: 16, engineName: "Constructed" });
    expect(scan.motifs[0]?.id).toBe("mateIn2");
    expect(scan.motifs.some((m) => m.id === "hangingPiece")).toBe(false);
    expect(scan.arrows.some((a) => a.from === "e1" && a.to === "e8")).toBe(true);
});

test("missing the mating capture explains mate, not an independent missed bishop", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        playedMoveUci: "g1h2",
        bestMoveUci: line[0],
        pvUci: line,
        refutationUci: [],
    });
    expect(replayTacticalLine(fen, ["g1h2"])).toHaveLength(1);
    expect(buildMistakeReviewTacticalExplanation(review)?.primary.id).toBe("mateIn2");
    expect(review.missedTimeline?.some((m) => m.id === "hangingPiece" && m.ply === 1)).toBe(false);
});

test("colour reflection retains the mating lesson and its terminal payoff", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    const pvUci = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    const result = classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci });
    expect(result.motifs[0]?.id).toBe("mateIn2");
    expect(result.timeline?.some((m) => m.id === "hangingPiece")).toBe(false);
});

test.skipIf(!process.env.TACTICAL_PRIVATE_DISJOINT_SAMPLE)(
    "the real accepted rook fork leads to mate, not a hanging bishop lesson",
    () => {
        const sample = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_DISJOINT_SAMPLE!, "utf8"),
        );
        const row = sample.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 134);
        const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci });
        expect(result.motifs[0]?.id).toBe("fork");
        expect(result.timeline?.some((m) => m.id === "hangingPiece" && m.ply === 3)).toBe(false);
        expect(result.timeline?.some((m) => m.value === 10000 && m.ply === 3)).toBe(true);
        const reached = makeFen(replayTacticalLine(row.fen, row.sourceUci)[1].after.toSetup());
        const direct = classifyPositionTacticalMotifs({
            fen: reached,
            pvUci: row.sourceUci.slice(2),
        });
        expect(direct.motifs[0]?.id).toBe("mateIn2");
        expect(direct.motifs.some((m) => m.id === "hangingPiece")).toBe(false);
    },
);
