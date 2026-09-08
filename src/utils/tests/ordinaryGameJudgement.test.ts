import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parsePgn, startingPosition } from "chessops/pgn";
import { parseSan } from "chessops/san";
import { makeFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import { replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";
import {
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";

const fixturePath = "benchmarks/tactical-relevance/ordinary-games-development.json";

test.skipIf(!process.env.TACTICAL_GAME_SOURCE)(
    "freeze ordinary games without selecting on mistakes or classifier output",
    async () => {
        const source = process.env.TACTICAL_GAME_SOURCE!;
        const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
        expect(response.ok).toBe(true);
        const body = await response.text();
        const archive = JSON.parse(body) as {
            games: { url: string; pgn: string; rules: string }[];
        };
        const games = archive.games
            .filter((game) => game.rules === "chess")
            .sort((a, b) => a.url.localeCompare(b.url));
        expect(games).toHaveLength(3);
        const cases = games.map((game, index) => {
            const parsed = parsePgn(game.pgn);
            expect(parsed).toHaveLength(1);
            const position = startingPosition(parsed[0].headers).unwrap();
            const startFen = makeFen(position.toSetup());
            const moves: string[] = [];
            for (const node of parsed[0].moves.mainline()) {
                const move = parseSan(position, node.san);
                expect(move).toBeDefined();
                moves.push(makeUci(move!));
                position.play(move!);
            }
            return { id: `ordinary-${index + 1}`, sourceGameUrl: game.url, startFen, moves };
        });
        writeFileSync(
            fixturePath,
            JSON.stringify(
                {
                    selection:
                        "All three standard-chess games in the complete August 2026 archive, sorted by URL. Sample every fifth reached ply from ply 8 through 60, alternating sides and excluding terminal chess positions. No result, rating, move-quality, theme or classifier-output filtering. Public game headers, identities and clocks are omitted. This small development diagnostic is not an accuracy estimate.",
                    source,
                    sourceSha256: createHash("sha256").update(body).digest("hex"),
                    games: cases,
                },
                null,
                2,
            ),
        );
    },
    40000,
);

test("the frozen sample retains complete legal game mainlines", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    expect(fixture.games).toHaveLength(3);
    expect(fixture.games.every((game: { moves: string[] }) => game.moves.length > 20)).toBe(true);
    for (const game of fixture.games)
        expect(replayTacticalLine(game.startFen, game.moves)).toHaveLength(game.moves.length);
});

const queenMateFen = "Q2qkb1r/p1p2ppp/1p1pp3/6B1/3P3P/2N2NPB/PPP1Pn2/2KR3R w k - 1 15";
const delayedMate = ["a8c6", "d8d7", "c6a8", "d7c8", "a8c8"];

test("a real mating continuation cannot borrow an incidental bishop skewer", () => {
    const result = classifyPositionTacticalMotifs({ fen: queenMateFen, pvUci: delayedMate });
    expect(result.timeline?.some((m) => m.id === "skewer")).toBe(false);
    expect(result.timeline?.some((m) => m.label === "Checkmate")).toBe(true);
});

test("mate in one does not display a slower mate's extra tactical stories", () => {
    const scan = buildLiveTacticalScan({
        fen: queenMateFen,
        pvUci: ["a8d8"],
        depth: 16,
        engineName: "Regression",
        variations: [
            { multipv: 1, depth: 16, pvUci: ["a8d8"], mate: 1 },
            { multipv: 2, depth: 16, pvUci: delayedMate, mate: 3 },
        ],
    });
    expect(scan.motifs[0]).toMatchObject({ id: "mateIn1", ply: 1 });
    expect(scan.variations).toHaveLength(1);
});

const exchangeBefore = "rn1qk2r/ppp1ppbp/3p1n2/5pB1/3P4/2N2N2/PPP1PPPP/R3KB1R w KQkq - 0 7";
const exchangeAfter = "rn1qk2r/ppp1ppbp/3p1B2/5p2/3P4/2N2N2/PPP1PPPP/R3KB1R b KQkq - 0 7";

test("recapturing an exchanged bishop is not hanging a piece", () => {
    const scan = buildLiveTacticalScan({
        fen: exchangeAfter,
        previousFen: exchangeBefore,
        previousMoveUci: "g5f6",
        pvUci: ["g7f6"],
        depth: 16,
        engineName: "Regression",
    });
    expect(scan.motifs).toEqual([]);
    const review = classifyMistakeReviewMotifs({
        fen: exchangeBefore,
        playedMoveUci: "g5f6",
        bestMoveUci: "g5h4",
        pvUci: ["g5h4"],
        refutationUci: ["g7f6"],
        cpLoss: 0,
    });
    expect(review.allowedMotifs).toEqual([]);
});

test("missing or mismatched history cannot hide a genuinely loose piece", () => {
    for (const previous of [{}, { previousFen: exchangeBefore, previousMoveUci: "g5h4" }]) {
        const result = classifyPositionTacticalMotifs({
            fen: exchangeAfter,
            pvUci: ["g7f6"],
            ...previous,
        });
        expect(result.motifs[0].id).toBe("hangingPiece");
    }
});

test("a mating recapture keeps its checkmate lesson", () => {
    const before = "R2Qkb1r/p1pq1ppp/1p1pp3/6B1/3P3P/2N2NPB/PPP1Pn2/2KR3R b k - 0 14";
    const steps = replayTacticalLine(before, ["d7d8", "a8d8"]);
    expect(steps).toHaveLength(2);
    expect(steps[1].after.isCheckmate()).toBe(true);
    const result = classifyPositionTacticalMotifs({
        fen: makeFen(steps[0].after.toSetup()),
        previousFen: before,
        previousMoveUci: "d7d8",
        pvUci: ["a8d8"],
    });
    expect(result.motifs[0]).toMatchObject({ value: 10000, ply: 1 });
    expect(result.motifs[0].evidence).toContain("mate");
    expect(result.timeline?.some((m) => m.id === "hangingPiece")).toBe(false);
});

// These judgements were made after the output-blind sample was frozen. The
// f7+ mate now has an independent all-defences proof, not a material-label oracle.
function frozenScan(id: string) {
    const rows = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/ordinary-games-stockfish-18.json", "utf8"),
    );
    const row = rows.find((entry: { id: string }) => entry.id === id);
    const gameId = id.split(":")[0];
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const game = fixture.games.find((entry: { id: string }) => entry.id === gameId);
    return buildLiveTacticalScan({
        fen: row.fen,
        ...row.after[0],
        variations: row.after,
        previousFen: row.beforeFen,
        previousMoveUci: game.moves[row.ply - 1],
        engineName: "Frozen Stockfish 18",
    });
}

test.each([
    "ordinary-1:ply8",
    "ordinary-1:ply13",
    "ordinary-1:ply23",
    "ordinary-1:ply33",
    "ordinary-1:ply38",
    "ordinary-1:ply43",
    "ordinary-2:ply8",
    "ordinary-2:ply13",
    "ordinary-2:ply23",
    "ordinary-2:ply28",
    "ordinary-2:ply33",
    "ordinary-2:ply38",
    "ordinary-2:ply43",
    "ordinary-2:ply58",
    "ordinary-3:ply8",
    "ordinary-3:ply13",
    "ordinary-3:ply23",
])("an audited ordinary root stays free of speculative tactical headlines: %s", (id) => {
    expect(frozenScan(id).motifs).toEqual([]);
});

test.each([
    ["ordinary-1:ply18", "hangingPiece"],
    ["ordinary-1:ply28", "mateIn1"],
    ["ordinary-2:ply48", "hangingPiece"],
    ["ordinary-2:ply18", "mateIn7"],
    ["ordinary-2:ply53", "mateIn3"],
    ["ordinary-3:ply18", "hangingPiece"],
    ["ordinary-3:ply28", "hangingPiece"],
])("the genuine immediate lesson remains: %s", (id, theme) => {
    expect(frozenScan(id).motifs[0]).toMatchObject({ id: theme, ply: 1 });
});
