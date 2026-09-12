import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import type { NormalMove } from "chessops/types";
import { expect, test } from "vitest";
import {
    proveExchangeDiscovery,
    replayTacticalLine,
    mayGiveCheck,
} from "../tacticalMotifs/causalTactics";

const fen = "2kr1br1/pp1n1p2/2p2p1p/q6b/2BNN3/P2Q3P/1PP2PP1/R3R1K1 b - - 0 15";

test("the old bishop capture loses the queen; the connected rook recapture retains material", () => {
    const losing = replayTacticalLine(fen, ["d7e5", "b2b4", "e5c4", "b4a5"]);
    const winning = replayTacticalLine(fen, [
        "d7e5",
        "b2b4",
        "e5d3",
        "b4a5",
        "d3e1",
        "a1e1",
        "d8d4",
    ]);
    expect(losing).toHaveLength(4);
    expect(losing.at(-1)?.balance).toBe(-570);
    expect(winning).toHaveLength(7);
    expect(winning.at(-1)?.balance).toBe(500);
});

function checkNominations(pos: Chess) {
    const missed: string[] = [];
    let visited = 0;
    for (const [from, dests] of pos.allDests())
        for (const to of dests) {
            const promotions =
                pos.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
                    ? (["queen", "rook", "bishop", "knight"] as const)
                    : [undefined];
            for (const promotion of promotions) {
                const move: NormalMove = { from, to, promotion };
                const next = pos.clone();
                next.play(move);
                visited++;
                if (next.isCheck() && !mayGiveCheck(pos, move)) missed.push(makeUci(move));
            }
        }
    return { visited, missed };
}

test.each([
    ["battery and knight checks", fen],
    ["en-passant rook discovery", "8/8/8/R2pP2k/8/8/8/4K3 w - d6 0 1"],
    ["black en-passant discovery", "4k3/8/8/8/r2Pp2K/8/8/8 b - d3 0 1"],
    ["kingside castling rook check", "5k2/8/8/8/8/8/8/R3K2R w KQ - 0 1"],
    ["queenside castling rook check", "3k4/8/8/8/8/8/8/R3K2R w KQ - 0 1"],
    ["promotion checks", "7k/P7/8/8/8/8/8/4K3 w - - 0 1"],
    ["capturing underpromotions", "1r5k/P7/8/8/8/8/8/4K3 w - - 0 1"],
])("terminal-resource nomination cannot omit a legal check: %s", (_name, fen) => {
    const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    const result = checkNominations(pos);
    expect(result.visited).toBeGreaterThan(0);
    expect(result.missed).toEqual([]);
});

test.skipIf(!process.env.TACTICAL_PRIVATE_POSITIONAL_SAMPLE)(
    "check nomination covers all legal moves along the private development lines",
    async () => {
        const paths = [
            process.env.TACTICAL_PRIVATE_PGN_SAMPLE,
            process.env.TACTICAL_PRIVATE_DISJOINT_SAMPLE,
            process.env.TACTICAL_PRIVATE_THIRD_SAMPLE,
            process.env.TACTICAL_PRIVATE_FOURTH_SAMPLE,
            process.env.TACTICAL_PRIVATE_POSITIONAL_SAMPLE,
        ].filter((path): path is string => Boolean(path));
        const seen = new Set<string>();
        const misses: string[] = [];
        let visited = 0;
        for (const path of paths) {
            const sample = JSON.parse(readFileSync(path, "utf8"));
            for (const row of sample.cases) {
                const steps = replayTacticalLine(row.fen, row.sourceUci);
                for (const step of steps) {
                    const key = makeFen(step.before.toSetup());
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const result = checkNominations(step.before);
                    visited += result.visited;
                    misses.push(...result.missed.map((move) => `${row.id}:${move}`));
                }
            }
        }
        expect(visited).toBeGreaterThan(1000);
        expect(misses).toEqual([]);
        if (process.env.TACTICAL_CHECK_NOMINATION_REPORT) {
            const { privateReportPath } =
                await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
            writeFileSync(
                privateReportPath(process.env.TACTICAL_CHECK_NOMINATION_REPORT),
                JSON.stringify(
                    { positions: seen.size, legalMovesChecked: visited, omittedChecks: misses },
                    null,
                    2,
                ),
                { flag: "wx" },
            );
        }
    },
);

test("colour reflection keeps the recovery and its bounded work", () => {
    const step = replayTacticalLine(
        "r3r1k1/1pp2pp1/p2q3p/2bnn3/Q6B/2P2P1P/PP1N1P2/2KR1BR1 w - - 0 15",
        ["d2e4"],
    )[0];
    const failure: string[] = [];
    const proof = proveExchangeDiscovery(step, 8192, (message) => failure.push(message));
    expect({ gain: proof?.gain, failure }).toEqual({ gain: 100, failure: [] });
    expect(proof?.branches).toHaveLength(52);
});

test("the public recovery covers every reply under the unchanged budget", async () => {
    const step = replayTacticalLine(
        "2kr1br1/pp1n1p2/2p2p1p/q6b/2BNN3/P2Q3P/1PP2PP1/R3R1K1 b - - 0 15",
        ["d7e5"],
    )[0];
    const failure: string[] = [];
    const leaves: unknown[] = [];
    const proof = proveExchangeDiscovery(
        step,
        8192,
        (message) => failure.push(message),
        (leaf) => leaves.push(leaf),
    );
    expect(proof).toMatchObject({ gain: 100, example: ["Qc3", "Qxc3"] });
    expect(proof?.branches).toHaveLength(52);
    expect(failure).toEqual([]);
    expect(
        proof!.branches.reduce((total, branch) => total + branch.nodesUsed, 0),
    ).toBeLessThanOrEqual(8192);
    if (process.env.TACTICAL_DISCOVERY_PROOF_REPORT) {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        writeFileSync(
            privateReportPath(process.env.TACTICAL_DISCOVERY_PROOF_REPORT),
            JSON.stringify({ proof, leaves }, null, 2),
            { flag: "wx" },
        );
    }
});
