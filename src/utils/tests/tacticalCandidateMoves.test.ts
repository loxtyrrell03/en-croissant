import { expect, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { nominateTacticalCandidateMoves } from "../tacticalMotifs/tacticalCandidateMoves";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

const forkFen = "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5";
test("nomination includes a queen-rook fork and profitable f7 capture", () => {
    const candidates = nominateTacticalCandidateMoves(forkFen);
    expect(candidates.map((c) => c.moveUci)).toEqual(expect.arrayContaining(["e5f7", "c4f7"]));
    expect(candidates.length).toBeLessThanOrEqual(8);
    const position = Chess.fromSetup(parseFen(forkFen).unwrap()).unwrap();
    expect(candidates.every((c) => position.isLegal(parseUci(c.moveUci)!))).toBe(true);
    expect(nominateTacticalCandidateMoves(forkFen, ["e5f7"]).map((c) => c.moveUci)).not.toContain(
        "e5f7",
    );
});
test("loose major pieces remain nominations in both colours", () => {
    const fen = "r5k1/5ppp/8/8/Q7/8/5PPP/6K1 b - - 0 1";
    const normal = nominateTacticalCandidateMoves(fen);
    expect(normal[0].moveUci).toBe("a8a4");
    expect(nominateTacticalCandidateMoves(reflectMixedForkFen(fen))).toEqual(
        normal.map((c) => ({ ...c, moveUci: reflectMixedForkMove(c.moveUci) })),
    );
});
test("ordinary initial, terminal and invalid boards cannot invent candidates", () => {
    for (const fen of [
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        "7k/6Q1/5K2/8/8/8/8/8 b - - 0 1",
        "invalid",
    ])
        expect(nominateTacticalCandidateMoves(fen)).toEqual([]);
});
test("a rook move cutting a pawn's guard is nominated in both colours", () => {
    const fen = "6R1/5k2/8/5r1p/5p1K/5P2/6P1/8 w - - 10 50";
    for (const reflected of [false, true]) {
        const board = reflected ? reflectMixedForkFen(fen) : fen;
        expect(nominateTacticalCandidateMoves(board).map((c) => c.moveUci)).toContain(
            reflected ? reflectMixedForkMove("g8g5") : "g8g5",
        );
    }
});

test("fresh public probes match current nominations, reject inferior moves and retain honest qualifications", () => {
    const receipt = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/targeted-candidate-stockfish-18.json", "utf8"),
    );
    assert.equal(receipt.results.length, 10);
    for (const row of receipt.results) {
        assert.deepEqual(
            nominateTacticalCandidateMoves(
                row.fen,
                row.main.map((line: any) => line.pvUci[0]),
            ),
            row.nominations,
        );
        for (const line of [...row.main, ...row.extra]) {
            assert.equal(line.depth, 16);
            assert.equal(replayTacticalLine(row.fen, line.pvUci).length, line.pvUci.length);
        }
        for (const line of row.extra) {
            assert(row.nominations.some((candidate: any) => candidate.moveUci === line.pvUci[0]));
            const scan = buildLiveTacticalScan({
                fen: row.fen,
                engineName: "Frozen restricted probe",
                depth: 16,
                pvUci: row.main[0].pvUci,
                variations: [row.main[0], { ...line, multipv: 2 }],
            });
            const admitted = scan.variations.find(
                (candidate) => candidate.lineUci[0] === line.pvUci[0],
            );
            if (row.id === "Constructed discovery candidates") {
                // Removing both a-pawns opens ...Ra1+. A pin threat is not a
                // proof of material retention against those checking replies.
                assert.equal(admitted?.motifs[0]?.id, "pin");
                assert.equal(admitted?.motifs[0]?.confidence, "medium");
                assert.match(admitted?.motifs[0]?.evidence ?? "", /Checking replies remain/);
            } else assert.equal(admitted, undefined, row.id);
        }
    }
});
