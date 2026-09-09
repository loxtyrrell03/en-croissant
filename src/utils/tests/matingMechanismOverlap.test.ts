import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import {
    proveMatingDeflection,
    proveMateBackedFork,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

const fen = "4r1rk/4q2p/5n1Q/8/3n4/3B3R/3K4/8 w - - 0 1";
const line = ["h6f6", "e7f6", "h3h7"];

test("the shared mating route is explained without a third duplicate badge", () => {
    const root = replayTacticalLine(fen, line)[0];
    expect(proveMatingDeflection(root)).not.toBeNull();
    expect(proveMateBackedFork(root)).not.toBeNull();
    expect(proveMateBackedFork(root)!.gain).toBe(640);
    expect(classifyPositionTacticalMotifs({ fen, pvUci: line }).motifs.map((m) => m.id)).toEqual([
        "deflection",
        "fork",
    ]);
});

test("a weaker fork certificate cannot absorb the larger joint discovery", () => {
    const position = fen.replace("4r1rk", "6rk");
    const root = replayTacticalLine(position, line)[0];
    expect(proveMateBackedFork(root)?.gain).toBe(320);
    const result = classifyPositionTacticalMotifs({ fen: position, pvUci: line });
    expect(result.motifs.find((m) => m.id === "discoveredAttack")).toMatchObject({ value: 420 });
});

test("an extra uncovered ray remains a distinct lesson", () => {
    const position = "5rkr/3q2pp/4n1Q1/8/2n1B3/2B3R1/8/1K6 w - - 0 1";
    const moves = ["g6e6", "d7e6", "g3g7"];
    expect(replayTacticalLine(position, moves)).toHaveLength(3);
    expect(proveMatingDeflection(replayTacticalLine(position, moves)[0])).not.toBeNull();
    expect(
        classifyPositionTacticalMotifs({ fen: position, pvUci: moves }).motifs.some(
            (m) => m.id === "discoveredAttack",
        ),
    ).toBe(true);
});

test.each([line, [line[0]], ["h6f6", "g8g7", "f6d4"]].map((pvUci) => ({ pvUci })))(
    "root-only and declined lines keep the independently proved choices: $pvUci",
    ({ pvUci }) => {
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "deflection", ply: 1 });
        expect(result.motifs[0].evidence).toContain(
            "opens the rook's line from h3 to h7 for Rxh7#",
        );
        expect(result.timeline?.some((m) => m.id === "discoveredAttack" && m.ply === 1)).toBe(
            false,
        );
        expect(result.timeline?.some((m) => m.id === "fork" && m.ply === 1)).toBe(true);
    },
);

test("acceptance keeps its actual mate and no false free-queen badge", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.timeline?.some((m) => m.id === "mateIn1" && m.ply === 3)).toBe(true);
    expect(result.timeline?.some((m) => m.id === "hangingPiece" && m.ply === 2)).toBe(false);
});

test("the missed lesson and board preview retain the mechanism instead of the duplicate", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        pvUci: line,
        bestMoveUci: line[0],
        playedMoveUci: "d2c1",
        refutationUci: [],
    });
    expect(review.missedMotifs[0]).toMatchObject({ id: "deflection", ply: 1 });
    expect(review.missedMotifs.some((m) => m.id === "discoveredAttack")).toBe(false);
    const scan = buildLiveTacticalScan({ fen, pvUci: line, engineName: "Constructed", depth: 16 });
    expect(scan.labels[0].text).toContain("Deflection");
    expect(scan.arrows.map((a) => a.from + a.to)).toContain("h6f6");
});

test("colour reflection preserves the same two lessons", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    const reflected = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    const result = classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: reflected });
    expect(result.motifs.map((m) => m.id)).toEqual(["deflection", "fork"]);
    expect(result.motifs[0].evidence).toContain("opens the rook's line from h6 to h2 for Rxh2#");
});

test("an already open rook line cannot be claimed as a new discovery", () => {
    const position = "4r1rk/4q2p/5n2/5Q2/3n4/3B3R/3K4/8 w - - 0 1";
    const moves = ["f5f6", "e7f6", "h3h7"];
    expect(replayTacticalLine(position, moves)).toHaveLength(3);
    const result = classifyPositionTacticalMotifs({ fen: position, pvUci: moves });
    expect(result.motifs[0]).toMatchObject({ id: "deflection" });
    expect(result.motifs[0].evidence).not.toContain("also opens");
    expect(result.motifs.some((m) => m.id === "discoveredAttack")).toBe(false);
});

test.skipIf(!process.env.TACTICAL_PRIVATE_THIRD_REPORT)(
    "inspect the real overlap's actual certificate",
    () => {
        const report = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_THIRD_REPORT!, "utf8"));
        const row = report.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 181);
        const root = replayTacticalLine(row.fen, row.sourceUci)[0];
        expect(proveMateBackedFork(root)!.gain).toBe(640);
        expect(
            classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci }).motifs.map(
                (m) => m.id,
            ),
        ).toEqual(["deflection", "fork"]);
    },
);
