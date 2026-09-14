import { readFileSync, writeFileSync } from "node:fs";
import { makeFen, parseFen } from "chessops/fen";
import { Chess } from "chessops/chess";
import { makeUci, parseUci } from "chessops/util";
import { expect, test } from "vitest";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
const read = (name: string) =>
    JSON.parse(readFileSync(`benchmarks/tactical-relevance/${name}.json`, "utf8"));
const fixture = read("cross-phase-development"),
    context = read("cross-phase-game-context"),
    receipt = read("cross-phase-stockfish-18");

test("the frozen stratified sample is disjoint from prior IDs and games", () => {
    expect(fixture.cases).toHaveLength(12);
    expect(context.cases).toHaveLength(11);
    expect(new Set(fixture.cases.map((r: { sourceGroup: string }) => r.sourceGroup)).size).toBe(12);
    for (const row of fixture.cases) {
        expect(fixture.excludedIds).not.toContain(row.id);
        expect(fixture.excludedGames).not.toContain(row.sourceGroup);
        expect(
            fixture.cases.filter((r: { stratum: string }) => r.stratum === row.stratum),
        ).toHaveLength(2);
        expect(replayTacticalLine(row.startFen, row.bestLine)).toHaveLength(row.bestLine.length);
    }
});

test("each full public game contains its nominated puzzle and every fixed context board", () => {
    for (const game of context.games) {
        const steps = replayTacticalLine(game.startFen, game.moves);
        expect(steps).toHaveLength(game.moves.length);
        const fens = [game.startFen, ...steps.map((s) => makeFen(s.after.toSetup()))];
        const puzzle = fixture.cases.find(
            (r: { sourceGroup: string }) => r.sourceGroup === `game:${game.id}`,
        );
        const normalized = makeFen(
            Chess.fromSetup(parseFen(puzzle.sourceFen).unwrap()).unwrap().toSetup(),
        );
        const ply = fens.indexOf(normalized);
        expect(ply).toBeGreaterThanOrEqual(0);
        expect(game.moves[ply]).toBe(puzzle.precedingMove);
        for (const row of context.cases.filter(
            (r: { sourceGameUrl: string }) => r.sourceGameUrl === game.sourceGameUrl,
        )) {
            expect([8, 24, 48, 80]).toContain(row.ply);
            expect(row.fen).toBe(fens[row.ply]);
            expect(row.previousFen).toBe(fens[row.ply - 1]);
            expect(row.previousMoveUci).toBe(game.moves[row.ply - 1]);
            expect(row.sourceUci).toEqual(game.moves.slice(row.ply, row.ply + 12));
        }
    }
    expect(context.omitted).toEqual([
        { id: "context:MHuRInPi:ply80", reason: "Game ended before this fixed sample" },
    ]);
});

test("exact source and engine replay retains unrelated results across the twenty-three boards", () => {
    const clean = (value: unknown) =>
        JSON.stringify(value, (key, v) => (key === "motifClassifierVersion" ? undefined : v));
    const cases = receipt.cases.map((row: any) => {
        const sourceResult = classifyPositionTacticalMotifs({
            fen: row.fen,
            pvUci: row.sourceUci,
            pvSan: row.sourceSan,
            rootCp: row.sourceEngine.cp,
            previousFen: row.previousFen,
            previousMoveUci: row.previousMoveUci,
        });
        const scan = buildLiveTacticalScan({
            fen: row.fen,
            pvUci: row.engineLines[0].pvUci,
            variations: row.engineLines,
            depth: 16,
            engineName: "Stockfish 18",
            previousFen: row.previousFen,
            previousMoveUci: row.previousMoveUci,
        });
        return { ...row, sourceResult, scan };
    });
    const restored = cases.find((row: { id: string }) => row.id === "lichess:brn5j");
    expect(restored.sourceResult.motifs[0]).toMatchObject({ id: "clearance", ply: 1, value: 500 });
    expect(restored.scan.motifs[0]).toMatchObject({ id: "clearance", ply: 1, value: 500 });
    for (const id of ["lichess:kO37k", "lichess:qY3NM"]) {
        const row = cases.find((row: { id: string }) => row.id === id);
        expect(row.sourceResult.motifs[0]).toMatchObject({ id: "mateIn3", ply: 1 });
        expect(row.scan.motifs[0]).toMatchObject({ id: "mateIn3", ply: 1 });
        expect(
            row.sourceResult.timeline.find((m: { id: string }) => m.id === "deflection"),
        ).toMatchObject({ ply: 1, relevance: "secondary" });
    }
    const interrupted = cases.find((row: { id: string }) => row.id === "lichess:49h84");
    expect(interrupted.sourceResult.motifs[0]).toMatchObject({ id: "mateIn2", ply: 1 });
    expect(
        interrupted.sourceResult.timeline.find((m: { id: string }) => m.id === "selfInterference"),
    ).toMatchObject({ ply: 2, actor: "black", relevance: "secondary" });
    const changed = new Set(["lichess:brn5j", "lichess:kO37k", "lichess:qY3NM", "lichess:49h84"]);
    for (const row of cases.filter((row: { id: string }) => !changed.has(row.id))) {
        const before = receipt.cases.find((prior: { id: string }) => prior.id === row.id);
        expect({ id: row.id, result: clean(row.sourceResult), scan: clean(row.scan) }).toEqual({
            id: before.id,
            result: clean(before.sourceResult),
            scan: clean(before.scan),
        });
    }
    if (process.env.TACTICAL_CROSS_PHASE_REPORT)
        writeFileSync(
            process.env.TACTICAL_CROSS_PHASE_REPORT,
            JSON.stringify(
                {
                    scope: "Exact source/engine-input replay. Promotion clearance remains; two mating deflections and one actual-ply self-interference improve secondary explanations. All twenty-three primary IDs remain unchanged from adapter95, not certified accurate. Larger-ending and quiet-combination coverage gaps are retained.",
                    cases,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
});

test.each([
    "context:etolcQHz:ply8",
    "context:MHuRInPi:ply8",
    "context:xwAZeVkB:ply8",
    "context:xwAZeVkB:ply24",
])("ordinary development or a compensated recapture has no invented root tactic: %s", (id) => {
    const row = receipt.cases.find((r: { id: string }) => r.id === id);
    const scan = buildLiveTacticalScan({
        fen: row.fen,
        pvUci: row.engineLines[0].pvUci,
        variations: row.engineLines,
        depth: 16,
        engineName: "Regression",
        previousFen: row.previousFen,
        previousMoveUci: row.previousMoveUci,
    });
    expect(scan.motifs).toEqual([]);
    expect(scan.labels).toEqual([]);
});

test("immediate mates lead over loose pieces and the losing side does not own the opponent's mate", () => {
    for (const [id, expected] of [
        ["KRLot", "backRankMate"],
        ["30PgS", "doubleBishopMate"],
        ["I5Waq", "mateIn2"],
    ]) {
        const row = fixture.cases.find((r: { id: string }) => r.id === `lichess:${id}`);
        expect(
            classifyPositionTacticalMotifs({ fen: row.startFen, pvUci: row.bestLine }).motifs[0].id,
        ).toBe(expected);
    }
    const row = receipt.cases.find((r: { id: string }) => r.id === "context:etolcQHz:ply80");
    expect(row.engineLines.every((l: { mate: number }) => l.mate === -1)).toBe(true);
    expect(classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci }).motifs).toEqual(
        [],
    );
});

test("independent six-piece tablebase evidence distinguishes genuine zugzwang from a known coverage gap", () => {
    const audit = read("cross-phase-tablebase-verified");
    expect(audit.queries.map((q: any) => [q.id, q.result.category])).toEqual([
        ["root", "win"],
        ["after-Kf4", "loss"],
        ["pass-after-Kf4", "draw"],
        ["after-Kf3", "draw"],
    ]);
    for (const row of audit.queries) {
        const pos = Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap();
        const legal = [...pos.allDests()].flatMap(([from, tos]) =>
            [...tos].map((to) => makeUci({ from, to })),
        );
        expect(new Set(row.result.moves.map((m: { uci: string }) => m.uci))).toEqual(
            new Set(legal),
        );
        for (const move of row.result.moves) expect(pos.isLegal(parseUci(move.uci)!)).toBe(true);
    }
    expect(
        audit.queries[1].result.moves.every((m: { category: string }) => m.category === "win"),
    ).toBe(true);
    // Do not assert that an empty classifier result here is a correct negative.
});
