import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { auditTacticalMotifs, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { makeFen } from "chessops/fen";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

const fen = "6k1/p6r/1P6/8/8/8/8/6KR w - - 0 1";
const line = ["h1h7", "g8h7", "b6a7", "h7g6", "a7a8q"];

test("mistake review cannot call a future promotion the missed root opportunity", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: line[0],
        playedMoveUci: "h1h2",
        pvUci: line,
    });
    expect(result.missedMotifs.some((m) => m.id === "promotion" || m.id === "underPromotion")).toBe(
        false,
    );
});
test("a later promotion cannot headline an earlier unproved exchange", () => {
    expect(replayTacticalLine(fen, line)).toHaveLength(line.length);
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.motifs.some((m) => m.id === "promotion" && m.ply !== 1)).toBe(false);
    expect(
        auditTacticalMotifs(fen, line, [
            {
                id: "promotion",
                label: "Promotion",
                confidence: "high",
                source: "available",
                ply: 5,
                moveUci: line[4],
                evidence: "Future promotion",
            },
        ]).some((m) => m.id === "promotion"),
    ).toBe(false);
});
test.each(["q", "r", "b", "n"])("the actual promotion remains classifiable: %s", (piece) => {
    const position = makeFen(replayTacticalLine(fen, line)[4].before.toSetup());
    const result = classifyPositionTacticalMotifs({ fen: position, pvUci: ["a7a8" + piece] });
    expect(
        result.motifs.some(
            (m) => (m.id === "promotion" || m.id === "underPromotion") && m.ply === 1,
        ),
    ).toBe(true);
});
test("a later underpromotion cannot relabel the preceding exchange", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: [...line.slice(0, 4), "a7a8n"] });
    expect(result.motifs.some((m) => m.id === "underPromotion")).toBe(false);
});
test("live board labels cannot borrow the future promotion", () => {
    const result = buildLiveTacticalScan({
        fen,
        pvUci: line,
        engineName: "Constructed",
        depth: 16,
    });
    expect(result.labels.some((l) => l.id === "promotion" || l.id === "underPromotion")).toBe(
        false,
    );
});
test("future en passant is not a cause of the earlier rook capture", () => {
    const position = "6k1/R2p3p/8/4P3/8/8/8/6KR w - - 0 1";
    const pvUci = ["h1h7", "d7d5", "e5d6"];
    expect(replayTacticalLine(position, pvUci)).toHaveLength(3);
    const result = auditTacticalMotifs(position, pvUci, [
        {
            id: "enPassant",
            label: "En Passant",
            confidence: "high",
            source: "available",
            ply: 3,
            moveUci: pvUci[2],
            evidence: "Later en passant",
        },
    ]);
    expect(result.some((m) => m.id === "enPassant")).toBe(false);
});
test("an actual en-passant capture is still identified", () => {
    const result = classifyPositionTacticalMotifs({
        fen: "6k1/8/8/3pP3/8/8/8/6K1 w - d6 0 1",
        pvUci: ["e5d6"],
    });
    expect(result.motifs).toContainEqual(
        expect.objectContaining({ id: "enPassant", ply: 1, moveUci: "e5d6" }),
    );
});
test("reflection also keeps the later promotion out of the root lesson", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    const pvUci = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    expect(
        classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci }).motifs.some(
            (m) => m.id === "promotion",
        ),
    ).toBe(false);
});
test.skipIf(!process.env.TACTICAL_PRIVATE_FOURTH_REPORT)(
    "a real sacrifice cannot borrow promotion from ply fifteen",
    () => {
        const row = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_FOURTH_REPORT!, "utf8"),
        ).cases.find((c: { eligibleIndex: number }) => c.eligibleIndex === 133);
        const result = classifyPositionTacticalMotifs({
            fen: row.fen,
            pvUci: row.engineLines[0].pvUci,
        });
        expect(result.motifs.some((m) => m.id === "promotion")).toBe(false);
    },
);
