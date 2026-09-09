import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import {
    normalizeMatingPayoffs,
    proveCheckingMate,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";

const fen = "1n5k/7p/5q2/8/8/6R1/8/4R1K1 w - - 0 1";
const line = ["e1e8", "f6f8", "e8f8"];

test("an independently proved mate does not borrow an irrelevant knight fork", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(replayTacticalLine(fen, line).at(-1)?.after.isCheckmate()).toBe(true);
    expect(result.motifs[0]).toMatchObject({ id: "mateIn2", ply: 1 });
    expect(result.timeline?.some((m) => m.id === "fork")).toBe(false);
    expect(result.timeline).toContainEqual(
        expect.objectContaining({ id: "mateIn1", ply: 3, label: "Checkmate" }),
    );
    expect(
        proveCheckingMate(replayTacticalLine(fen.replace("1n5k", "7k"), line), 4096),
    ).not.toBeNull();
});

test("a cooperating mating line cannot hide the fork when the king has a legal flight", () => {
    const position = fen.replace("6R1", "8");
    const steps = replayTacticalLine(position, line);
    expect(steps.at(-1)?.after.isCheckmate()).toBe(false);
    expect(proveCheckingMate(steps)).toBeNull();
    expect(
        classifyPositionTacticalMotifs({ fen: position, pvUci: ["e1e8", "h8g7", "e8b8"] }).motifs[0]
            ?.id,
    ).toBe("fork");
});

test("colour reflection retains the mate without its irrelevant fork", () => {
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
    expect(result.timeline?.some((m) => m.id === "fork")).toBe(false);
});

test("a terminal mate cannot retain a stale whole-line distance", () => {
    const steps = replayTacticalLine(fen, line);
    const source = {
        id: "mateIn7",
        label: "Mate in 7",
        ply: 3,
        moveUci: line[2],
        source: "available" as const,
        confidence: "medium" as const,
        evidence: "Old PV tag",
    };
    const result = normalizeMatingPayoffs(steps, [source]);
    expect(result[0]).toMatchObject({
        id: "mateIn1",
        label: "Checkmate",
        ply: 3,
        moveUci: line[2],
    });
    expect(source.id).toBe("mateIn7");
    expect(normalizeMatingPayoffs(steps, result)).toEqual(result);
});

test("a real material fork stays when no independent mate is established", () => {
    const position = "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5";
    expect(
        classifyPositionTacticalMotifs({ fen: position, pvUci: ["e5f7", "d8e8", "f7h8"] }).motifs[0]
            ?.id,
    ).toBe("fork");
});

test.skipIf(!process.env.TACTICAL_PRIVATE_DISJOINT_SAMPLE)(
    "the disjoint mating line has no incidental knight-fork lesson",
    () => {
        const sample = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_DISJOINT_SAMPLE!, "utf8"),
        );
        const row = sample.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 211);
        const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci });
        expect(result.motifs[0]?.id).toBe("mateIn3");
        expect(result.timeline?.some((m) => m.id === "fork")).toBe(false);
        expect(result.timeline).toContainEqual(expect.objectContaining({ id: "mateIn1", ply: 5 }));
    },
);
