import { readFileSync, writeFileSync } from "node:fs";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
import type { Square } from "chessops/types";
import { expect, test } from "vitest";
import {
    proveCheckingDiscovery,
    proveDiscoveredMaterial,
    proveExchangeDiscovery,
    replayTacticalLine,
    tacticalBoardEvidence,
} from "../tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

type Line = {
    cp: number | null;
    mate: number | null;
    depth: number;
    multipv: number;
    pvUci: string[];
    pvSan: string[];
};
type Row = {
    id: string;
    ply: number;
    fen: string;
    beforeFen: string;
    before: Line[];
    after: Line[];
    cpLoss: number;
    played: string;
};
const rows: Row[] = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/ordinary-early-stockfish-18.json", "utf8"),
);
const games: { id: string; startFen: string; moves: string[] }[] = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/ordinary-games-development.json", "utf8"),
).games;
const discovery = rows.find((row) => row.id === "ordinary-2:ply12")!;
const move = "e5f6";
const classify = (row: Row) =>
    classifyPositionTacticalMotifs({
        fen: row.fen,
        pvUci: row.after[0].pvUci,
        rootCp: row.after[0].cp,
        previousFen: row.beforeFen,
        previousMoveUci: games.find((game) => row.id.startsWith(`${game.id}:`))!.moves[row.ply - 1],
    });

test("all eighteen early positions are fixed before results and disjoint from prior samples", () => {
    const expected: string[] = [];
    const previous = [
        "ordinary-games-stockfish-18.json",
        "ordinary-adjacent-stockfish-18.json",
    ].flatMap(
        (file) =>
            JSON.parse(readFileSync(`benchmarks/tactical-relevance/${file}`, "utf8")) as Row[],
    );
    for (const game of games) {
        const steps = replayTacticalLine(game.startFen, game.moves);
        for (const ply of [2, 4, 6, 10, 11, 12]) {
            const id = `${game.id}:ply${ply}`;
            expected.push(id);
            expect(rows.find((row) => row.id === id)).toMatchObject({
                fen: makeFen(steps[ply - 1].after.toSetup()),
                beforeFen: makeFen(steps[ply - 1].before.toSetup()),
            });
        }
    }
    expect(rows.map((row) => row.id)).toEqual(expected);
    expect(rows).toHaveLength(18);
    const identity = (fen: string) => fen.split(" ").slice(0, 4).join(" ");
    expect(
        rows.every(
            (row) =>
                !previous.some(
                    (old) => old.id === row.id || identity(old.fen) === identity(row.fen),
                ),
        ),
    ).toBe(true);
});

for (const row of rows.filter((row) => !["ordinary-2:ply12", "ordinary-3:ply11"].includes(row.id)))
    test(`${row.id}: development, compensated recaptures and positional pressure are not tactics`, () => {
        expect(classify(row).motifs).toEqual([]);
        const scan = buildLiveTacticalScan({
            fen: row.fen,
            ...row.after[0],
            variations: row.after,
            engineName: "Frozen Stockfish 18",
            previousFen: row.beforeFen,
            previousMoveUci: games.find((game) => row.id.startsWith(`${game.id}:`))!.moves[
                row.ply - 1
            ],
        });
        expect(scan.motifs).toEqual([]);
        expect(scan.variations.every((variation) => !variation.timeline.length)).toBe(true);
    });

test("the opening discovery verifies every legal reply without a supplied PV", () => {
    const step = replayTacticalLine(discovery.fen, [move])[0];
    const failures: string[] = [];
    const proof = proveCheckingDiscovery(step, 8192, (reason) => failures.push(reason));
    if (process.env.TACTICAL_EARLY_DISCOVERY_TRACE)
        writeFileSync(
            process.env.TACTICAL_EARLY_DISCOVERY_TRACE,
            JSON.stringify({ fen: discovery.fen, move, proof, failures }, null, 2),
            { flag: "wx" },
        );
    expect(proveDiscoveredMaterial(step, 4096, 101)).toBeNull();
    expect(proveExchangeDiscovery(step)).toBeNull();
    expect(failures).toEqual([]);
    expect(proof).toMatchObject({ gain: 320 });
    expect(proof!.visits).toBeLessThanOrEqual(8192);
    expect(proof!.branches.map((branch) => branch.reply).sort()).toEqual([
        "Be7",
        "Kf7",
        "Ne7",
        "Qe7",
    ]);
    expect(proof!.decisions.some((decision) => decision.move === "c1g5")).toBe(true);
    for (const decision of proof!.decisions)
        expect(replayTacticalLine(decision.fen, [decision.move])).toHaveLength(1);
});

test.each([
    { pvUci: [move] },
    { pvUci: discovery.after[0].pvUci },
    { pvUci: [move, "e8f7", "e2h5", "g7g6", "f1c4"] },
])("the same discovery survives independent continuation $pvUci", ({ pvUci }) => {
    expect(classifyPositionTacticalMotifs({ fen: discovery.fen, pvUci }).motifs[0]).toMatchObject({
        id: "discoveredCheck",
        ply: 1,
        value: 320,
    });
});

test("board evidence shows the opened queen check, not future bishops or payoff arrows", () => {
    const motif = classify(discovery).motifs[0];
    expect(tacticalBoardEvidence(discovery.fen, [move], motif)).toMatchObject({
        arrows: expect.arrayContaining([{ from: "e2", to: "e8" }]),
    });
    expect(
        tacticalBoardEvidence(discovery.fen, [move], motif)?.arrows.some(
            (arrow) => arrow.from === "c1" || arrow.from === "f1",
        ),
    ).toBe(false);
});

test("mistake review explains allowing the discovery and preserves a missed opportunity", () => {
    const allowed = classifyMistakeReviewMotifs({
        fen: discovery.beforeFen,
        playedMoveUci: "f7f6",
        bestMoveUci: "b8c6",
        pvUci: discovery.before[0].pvUci,
        refutationUci: discovery.after[0].pvUci,
        cpBefore: -14,
        cpAfter: 478,
        cpLoss: 492,
    });
    expect(allowed.allowedMotifs[0]).toMatchObject({
        id: "discoveredCheck",
        source: "allowed",
        comparison: "prevented",
        ply: 1,
    });
    expect(buildMistakeReviewTacticalExplanation(allowed)?.primary.id).toBe("discoveredCheck");
    const missed = classifyMistakeReviewMotifs({
        fen: discovery.fen,
        playedMoveUci: "g1f3",
        bestMoveUci: move,
        pvUci: discovery.after[0].pvUci,
        refutationUci: ["f8e7"],
        cpBefore: 478,
        cpAfter: 172,
        cpLoss: 306,
    });
    expect(missed.missedMotifs[0]).toMatchObject({
        id: "discoveredCheck",
        source: "missed",
        ply: 1,
    });
    expect(buildMistakeReviewTacticalExplanation(missed)?.primary.source).toBe("missed");
});

test("a hanging queen remains primary, net of the bishop it captured", () => {
    expect(classify(rows.find((row) => row.id === "ordinary-3:ply11")!).motifs[0]).toMatchObject({
        id: "hangingPiece",
        value: 570,
        label: "Winning Recapture",
    });
});

function reflect(fen: string, uci: string, flip: number) {
    const setup = parseFen(fen).unwrap();
    const original = setup.board;
    setup.board = original.clone();
    setup.board.clear();
    for (const [square, piece] of original)
        setup.board.set((square ^ flip) as Square, {
            ...piece,
            color: flip & 56 ? (piece.color === "white" ? "black" : "white") : piece.color,
        });
    if (flip & 56) setup.turn = setup.turn === "white" ? "black" : "white";
    const rooks = setup.castlingRights;
    setup.castlingRights = rooks.diff(rooks);
    for (const square of rooks)
        setup.castlingRights = setup.castlingRights.with((square ^ flip) as Square);
    if (setup.epSquare !== undefined) setup.epSquare = (setup.epSquare ^ flip) as Square;
    const parsed = parseUci(uci)!;
    if (!("from" in parsed)) throw new Error("Expected normal move");
    return {
        fen: makeFen(setup),
        move: makeUci({ from: (parsed.from ^ flip) as Square, to: (parsed.to ^ flip) as Square }),
    };
}

test.each([0, 7, 56, 63])("colour/file reflection %i preserves the primary discovery", (flip) => {
    const transformed = reflect(discovery.fen, move, flip);
    expect(
        classifyPositionTacticalMotifs({ fen: transformed.fen, pvUci: [transformed.move] })
            .motifs[0],
    ).toMatchObject({ id: "discoveredCheck", value: 320 });
});

test.each([0, 1, -1, NaN, Infinity])("insufficient or invalid budget %s abstains", (budget) => {
    expect(proveCheckingDiscovery(replayTacticalLine(discovery.fen, [move])[0], budget)).toBeNull();
});

test.each([
    {
        name: "a knight can capture the checking queen",
        fen: "rnbqkbnr/pppp2pp/5p2/4P3/3n4/2N5/PP2QPPP/R1B1KBNR w KQkq - 0 7",
        move,
    },
    {
        name: "another pawn blocks the queen file",
        fen: "rnbqkbnr/pppp2pp/4pp2/4P3/8/2N5/PP2QPPP/R1B1KBNR w KQkq - 0 7",
        move,
    },
    {
        name: "a checking battery has no material target",
        fen: "4k3/8/8/8/8/4N3/8/4R1K1 w - - 0 1",
        move: "e3c4",
    },
    { name: "ordinary development opens no checking ray", fen: games[0].startFen, move: "g1f3" },
])("abstains when $name", (row) => {
    const steps = replayTacticalLine(row.fen, [row.move]);
    expect(steps).toHaveLength(1);
    expect(proveCheckingDiscovery(steps[0])).toBeNull();
});

test("non-capturing discoveries respect a fifty-move counterclaim", () => {
    const step = replayTacticalLine("4k3/8/8/8/8/4N3/8/4R1K1 w - - 99 1", ["e3c4"])[0];
    expect(proveCheckingDiscovery(step)).toBeNull();
});

test("frozen early replay is an audit, not an agreement score", () => {
    const results = rows.map((row) => ({ id: row.id, result: classify(row) }));
    if (process.env.TACTICAL_EARLY_REPLAY_REPORT)
        writeFileSync(process.env.TACTICAL_EARLY_REPLAY_REPORT, JSON.stringify(results, null, 2), {
            flag: "wx",
        });
    expect(results).toHaveLength(18);
});
