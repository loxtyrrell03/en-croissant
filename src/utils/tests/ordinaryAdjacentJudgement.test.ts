import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";

const games = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/ordinary-games-development.json", "utf8"),
).games as { id: string; startFen: string; moves: string[] }[];
const rows = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/ordinary-adjacent-stockfish-18.json", "utf8"),
) as {
    id: string;
    ply: number;
    fen: string;
    beforeFen: string;
    after: { pvUci: string[]; pvSan: string[]; cp: number | null; depth: number }[];
}[];

test("the adjacent sample is the fixed disjoint stride, not selected tactical outputs", () => {
    const expected: string[] = [];
    for (const game of games) {
        const replay = replayTacticalLine(game.startFen, game.moves);
        for (let index = 8; index < Math.min(60, replay.length); index += 5) {
            if (replay[index].after.isEnd()) continue;
            const id = `${game.id}:ply${index + 1}`;
            expected.push(id);
            expect(rows.find((row) => row.id === id)).toMatchObject({
                fen: makeFen(replay[index].after.toSetup()),
                beforeFen: makeFen(replay[index].before.toSetup()),
            });
        }
    }
    expect(rows.map((row) => row.id)).toEqual(expected);
    expect(rows).toHaveLength(24);
    expect(rows.every((row) => (row.ply - 8) % 5 !== 0)).toBe(true);
});

function classify(id: string) {
    const row = rows.find((row) => row.id === id)!;
    const game = games.find((game) => id.startsWith(`${game.id}:`))!;
    return classifyPositionTacticalMotifs({
        fen: row.fen,
        pvUci: row.after[0].pvUci,
        pvSan: row.after[0].pvSan,
        rootCp: row.after[0].cp,
        previousFen: row.beforeFen,
        previousMoveUci: game.moves[row.ply - 1],
    });
}

test("the checking attack retains its queen-for-bishop recapture payoff", () => {
    const result = classify("ordinary-2:ply14");
    expect(result.motifs[0]).toMatchObject({ id: "forcingAttack", ply: 1 });
    expect(result.timeline).toContainEqual(
        expect.objectContaining({
            id: "hangingPiece",
            ply: 7,
            moveUci: "h5d5",
            label: "Winning Recapture",
            value: 570,
        }),
    );
    expect(result.timeline!.find((m) => m.ply === 7)?.evidence).toContain("bishop");
});

test("colour reflection retains the queen-for-bishop payoff", () => {
    const row = rows.find((row) => row.id === "ordinary-2:ply14")!;
    const reflected = "r1b1kbnr/pp2qppp/2n5/8/8/5p2/PPPP1KPP/RNBQ1BNR b kq - 1 8";
    const pvUci = row.after[0].pvUci.map((uci) =>
        uci.replace(/[1-8]/g, (rank) => String(9 - Number(rank))),
    );
    expect(replayTacticalLine(reflected, pvUci)).toHaveLength(pvUci.length);
    expect(classifyPositionTacticalMotifs({ fen: reflected, pvUci }).timeline).toContainEqual(
        expect.objectContaining({
            id: "hangingPiece",
            label: "Winning Recapture",
            ply: 7,
            value: 570,
        }),
    );
});

test("viewing the payoff as a new root preserves the trade context", () => {
    const row = rows.find((row) => row.id === "ordinary-2:ply14")!;
    const replay = replayTacticalLine(row.fen, row.after[0].pvUci);
    const result = classifyPositionTacticalMotifs({
        fen: makeFen(replay[6].before.toSetup()),
        previousFen: makeFen(replay[5].before.toSetup()),
        previousMoveUci: replay[5].uci,
        pvUci: [replay[6].uci],
    });
    expect(result.motifs[0]).toMatchObject({
        id: "hangingPiece",
        label: "Winning Recapture",
        value: 570,
    });
});

test("subtracts the earlier loss and the recapturing piece's liability", () => {
    const before = "3r2k1/8/3q4/3B3R/8/8/8/K7 b - - 0 1";
    const replay = replayTacticalLine(before, ["d6d5", "h5d5", "d8d5"]);
    expect(replay).toHaveLength(3);
    const result = classifyPositionTacticalMotifs({
        fen: makeFen(replay[0].after.toSetup()),
        previousFen: before,
        previousMoveUci: "d6d5",
        pvUci: ["h5d5", "d8d5"],
    });
    // Queen for rook and bishop nets only 70 cp in the local material model.
    expect(result.motifs.some((m) => m.id === "hangingPiece")).toBe(false);
});

test("winning an exchange is retained with its net value, not the whole rook", () => {
    const before = "6k1/8/3r4/3B3R/8/8/8/K7 b - - 0 1";
    const replay = replayTacticalLine(before, ["d6d5", "h5d5"]);
    expect(replay).toHaveLength(2);
    const result = classifyPositionTacticalMotifs({
        fen: makeFen(replay[0].after.toSetup()),
        previousFen: before,
        previousMoveUci: "d6d5",
        pvUci: ["h5d5"],
    });
    expect(result.motifs[0]).toMatchObject({
        id: "hangingPiece",
        label: "Winning Recapture",
        value: 170,
    });
});

test("record all adjacent results without accepting unresolved empty outputs as correct", () => {
    const report = rows.map((row) => ({ id: row.id, result: classify(row.id) }));
    expect(report).toHaveLength(24);
    if (process.env.TACTICAL_ADJACENT_REVIEW_REPORT)
        writeFileSync(process.env.TACTICAL_ADJACENT_REVIEW_REPORT, JSON.stringify(report, null, 2));
});
