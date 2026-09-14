import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen, parseFen } from "chessops/fen";
import { Chess } from "chessops/chess";
import { makeSquare, parseUci } from "chessops/util";
import {
    replayTacticalLine,
    proveQuietTacticalPreparation,
    proveExchangeDeflection,
    proveReinforcedPin,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { castlingAliasCases, castlingCases } from "./fixtures/castlingRelevance";

test.each(castlingAliasCases)("$id replays without phantom captures or a missing mover", (row) => {
    const replay = replayTacticalLine(row.fen, row.pvUci);
    expect(replay).toHaveLength(row.pvUci.length);
    expect(replay[0].uci).toBe(row.pvUci[0]);
    expect(makeSquare(replay[0].move.to)).toBe(row.kingTo);
    expect(replay[0].capture).toBe(0);
    expect(replay[0].balance).toBe(0);
    expect(replay[0].after.isCheckmate()).toBe(row.mate);
    expect(() => proveQuietTacticalPreparation(replay)).not.toThrow();
    expect(() => proveExchangeDeflection(replay[0])).not.toThrow();
    expect(() => proveReinforcedPin(replay[0])).not.toThrow();
    expect(() => classifyPositionTacticalMotifs(row)).not.toThrow();
});

test.each(castlingAliasCases.filter((row) => row.mate))(
    "$id keeps mate primary and draws both actual piece moves",
    (row) => {
        const result = classifyPositionTacticalMotifs(row);
        const scan = buildLiveTacticalScan({ ...row, depth: 16, engineName: "Castling mate" });
        expect(result.motifs[0]).toMatchObject({ id: "mateIn1", ply: 1 });
        expect(result.motifs).toHaveLength(1);
        expect(scan.arrows.map((a) => [a.from, a.to])).toEqual([
            [row.pvUci[0].slice(0, 2), row.kingTo],
            [row.rookFrom, row.rookTo],
        ]);
        expect(scan.labels[0].square).toBe(row.kingTo);
        const playedMoveUci =
            row.pvUci[0].slice(0, 2) +
            (row.pvUci[0].endsWith(row.kingTo) ? row.rookFrom : row.kingTo);
        const sameCastle = classifyMistakeReviewMotifs({
            fen: row.fen,
            playedMoveUci,
            bestMoveUci: row.pvUci[0],
            pvUci: row.pvUci,
        });
        expect(sameCastle.missedMotifs).toEqual([]); // same best move, different encoding
    },
);

test.each(castlingAliasCases.filter((row) => row.id.includes("check-not-mate")))(
    "$id does not become a fake fork or sacrifice",
    (row) => {
        const result = classifyPositionTacticalMotifs(row);
        const scan = buildLiveTacticalScan({ ...row, depth: 16, engineName: "Single rook check" });
        expect(result.motifs).toEqual([]);
        expect(scan.arrows).toEqual([]);
        expect(scan.labels).toEqual([]);
    },
);

const context = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/castling-context-development.json", "utf8"),
) as {
    cases: { id: string; fen: string; rookUci: string; kingUci: string; afterFen: string }[];
};

test.each(context.cases)(
    "real context $id preserves identical position and classification for both UCI notations",
    (row) => {
        const a = replayTacticalLine(row.fen, [row.rookUci]),
            b = replayTacticalLine(row.fen, [row.kingUci]);
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(1);
        expect(makeFen(a[0].after.toSetup())).toBe(row.afterFen);
        expect(makeFen(b[0].after.toSetup())).toBe(row.afterFen);
        expect(a[0].move).toEqual(b[0].move);
        const first = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.rookUci] });
        const second = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.kingUci] });
        expect(JSON.stringify(first).replaceAll(row.rookUci, row.kingUci)).toBe(
            JSON.stringify(second),
        );
    },
);

test.each([
    { id: "through-check", fen: "k4r2/8/8/8/8/8/8/4K2R w K - 0 1", uci: "e1h1" },
    { id: "no-rights", fen: "k7/8/8/8/8/8/8/4K2R w - - 0 1", uci: "e1h1" },
    { id: "blocked", fen: "k7/8/8/8/8/8/8/4KB1R w K - 0 1", uci: "e1h1" },
    { id: "out-of-check", fen: "k3r3/8/8/8/8/8/8/4K2R w K - 0 1", uci: "e1h1" },
])("rejects $id castling before normalizing it", (row) => {
    for (const uci of [row.uci, "e1g1"]) {
        expect(replayTacticalLine(row.fen, [uci])).toEqual([]);
        const scan = buildLiveTacticalScan({
            fen: row.fen,
            pvUci: [uci],
            depth: 16,
            engineName: "Illegal control",
        });
        expect(scan.motifs).toEqual([]);
        expect(scan.arrows).toEqual([]);
    }
});

test.each([
    { id: "stationary-king", fen: "k7/8/8/8/8/8/8/6KR w H - 0 1", uci: "g1h1" },
    { id: "ambiguous-landing", fen: "7k/8/8/8/8/8/8/R2K4 w A - 0 1", uci: "d1a1" },
    { id: "overlapping-rook", fen: "k7/8/8/8/8/8/8/5KR1 w G - 0 1", uci: "f1g1" },
])("keeps the actual Chess960 $id action without inventing a different king move", (row) => {
    const pos = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
    const move = parseUci(row.uci)!;
    expect(pos.isLegal(move)).toBe(true);
    pos.play(move);
    const replay = replayTacticalLine(row.fen, [row.uci]);
    expect(replay).toHaveLength(1);
    expect(makeFen(replay[0].after.toSetup())).toBe(makeFen(pos.toSetup()));
    expect(() => proveQuietTacticalPreparation(replay)).not.toThrow();
    expect(() => proveReinforcedPin(replay[0])).not.toThrow();
    expect(() => classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.uci] })).not.toThrow();
});

test("missing a castling mate keeps mate as the lesson, not a rook capture or corner-square fork", () => {
    const row = castlingCases[2];
    const result = classifyMistakeReviewMotifs({
        fen: row.fen,
        playedMoveUci: "e2e3",
        bestMoveUci: row.pvUci[0],
        pvUci: row.pvUci,
        refutationUci: ["f8f7"],
    });
    expect(result.missedMotifs[0]).toMatchObject({ id: "mateIn1", ply: 1, source: "missed" });
    expect(result.missedMotifs).toHaveLength(1);
});

// Eighteen games in both notations plus mistake/reply paths. The aggregate
// test allowance is separate from the unchanged per-scan worker deadline.
test("audits full castling continuations and mistake causes without importing their later noise", () => {
    const data = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/castling-stockfish-18.json", "utf8"),
    ) as {
        cases: {
            id: string;
            fen: string;
            rookUci: string;
            kingUci: string;
            engineLines: { pvUci: string[]; cp: number }[];
            castleLine: { pvUci: string[]; cp: number };
        }[];
    };
    const report = data.cases.map((row) => {
        const line = row.castleLine.pvUci;
        const result = classifyPositionTacticalMotifs({
            fen: row.fen,
            pvUci: line,
            rootCp: row.castleLine.cp,
        });
        const alias = classifyPositionTacticalMotifs({
            fen: row.fen,
            pvUci: [row.kingUci, ...line.slice(1)],
            rootCp: row.castleLine.cp,
        });
        expect(JSON.stringify(result).replaceAll(row.rookUci, row.kingUci)).toBe(
            JSON.stringify(alias),
        );
        const review = classifyMistakeReviewMotifs({
            fen: row.fen,
            playedMoveUci: row.rookUci,
            bestMoveUci: row.engineLines[0].pvUci[0],
            pvUci: row.engineLines[0].pvUci,
            refutationUci: line.slice(1),
        });
        const afterFen = makeFen(replayTacticalLine(row.fen, line)[0].after.toSetup());
        const replyScan = buildLiveTacticalScan({
            fen: afterFen,
            pvUci: line.slice(1),
            previousFen: row.fen,
            previousMoveUci: row.rookUci,
            depth: 16,
            engineName: "Stockfish continuation",
        });
        return { id: row.id, result, review, replyScan };
    });
    const missed = report.find((row) => row.id === "castle:zJqoVvf1:24:a")!;
    expect(missed.review.missedMotifs[0]).toMatchObject({
        id: "fork",
        ply: 1,
        source: "missed",
        moveUci: "e5c6",
    });
    const looseBishop = report.find((row) => row.id === "castle:MHuRInPi:10:h")!;
    expect(looseBishop.replyScan.motifs[0]).toMatchObject({
        id: "hangingPiece",
        ply: 1,
        moveUci: "a5c4",
    });
    expect(looseBishop.review.allowedMotifs[0]).toMatchObject({
        id: "hangingPiece",
        ply: 1,
        source: "allowed",
        moveUci: "a5c4",
        value: 330,
        comparison: "prevented",
    });
    // These explicitly inspected development castles must not acquire the
    // pre-existing pins or a distant exchange from their supplied continuation.
    for (const id of ["castle:T675oRjx:16:h", "castle:mD14jttw:8:h", "castle:etolcQHz:9:h"]) {
        expect(report.find((row) => row.id === id)!.result.motifs).toEqual([]);
    }
    if (process.env.TACTICAL_CASTLING_REVIEW_REPORT)
        writeFileSync(
            process.env.TACTICAL_CASTLING_REVIEW_REPORT,
            JSON.stringify(
                {
                    scope: "Full-line and mistake-review development audit. Empty output is not an accuracy claim; castle alternatives may be best, inferior, or losing.",
                    cases: report,
                },
                null,
                2,
            ) + "\n",
            { flag: "wx" },
        );
}, 15000);
