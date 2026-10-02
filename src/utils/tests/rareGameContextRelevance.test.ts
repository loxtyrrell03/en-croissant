import { expect, test } from "vitest";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import fixture from "../../../benchmarks/tactical-relevance/rare-game-context-v1.json";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

// Fixed public game contexts, selected before their classifier output.
// These scoped negative/ownership judgments are NOT labels for all 18 boards:
// unresolved deeper attacks and exact endgame outcomes remain unscored.
function context(id: string, mirror: boolean) {
    const row = fixture.selection.cases.find(c => c.id === id)!;
    const game = fixture.selection.games.find(g => row.sourceGameUrl.endsWith(`/${g.id}`))!;
    const fen = (f: string) => mirror ? reflectMixedForkFen(f) : f;
    const move = (m: string) => mirror ? reflectMixedForkMove(m) : m;
    const query = (kind: string) => fixture.engine.queries.find(q => q.identities.some(i => i.id === id && i.kind === kind))!;
    const root = query("root"), after = query("afterPlayed");
    const tacticalHistory = { fen: fen(game.startFen), moves: game.moves.slice(0, row.ply).map(move) };
    // A colour-reflected game starts with Black, so fullmove counters cannot
    // simply be copied from every original FEN. Rebuild both exact endpoints.
    const historyBoard = Chess.fromSetup(parseFen(tacticalHistory.fen).unwrap()).unwrap();
    let previousFen = makeFen(historyBoard.toSetup());
    for (const uci of tacticalHistory.moves) {
        previousFen = makeFen(historyBoard.toSetup());
        const next = parseUci(uci)!;
        expect(historyBoard.isLegal(next)).toBe(true);
        historyBoard.play(next);
    }
    const base = { fen: makeFen(historyBoard.toSetup()), previousFen,
        previousMoveUci: move(row.previousMoveUci), tacticalHistory };
    return { row, move, base,
        source: { ...base, pvUci: row.sourceUci.map(move) },
        best: { ...base, pvUci: root.candidates[0].pv.map(move),
            rootCp: root.candidates[0].cpWhite * (row.fen.split(" ")[1] === "w" ? 1 : -1) },
        review: { ...base, bestMoveUci: move(root.candidates[0].pv[0]), playedMoveUci: move(row.sourceUci[0]),
            pvUci: root.candidates[0].pv.map(move), refutationUci: after.candidates[0].pv.map(move),
            cpBefore: root.candidates[0].cpWhite * (mirror ? -1 : 1),
            cpAfter: after.candidates[0].cpWhite * (mirror ? -1 : 1), reachedDepth: root.candidates[0].depth },
    };
}

test("fixed source games, context boards and all bounded engine lines replay legally", () => {
    expect(fixture.selection.cases).toHaveLength(18);
    expect(fixture.selection.omitted).toHaveLength(6);
    expect(fixture.engine.queries).toHaveLength(36);
    for (const game of fixture.selection.games) {
        const board = Chess.fromSetup(parseFen(game.startFen).unwrap()).unwrap();
        const fens = [];
        for (const uci of game.moves) {
            fens.push(makeFen(board.toSetup()));
            const move = parseUci(uci)!;
            expect(board.isLegal(move)).toBe(true);
            board.play(move);
        }
        for (const sampled of fixture.selection.cases.filter(c => c.sourceGameUrl === game.sourceGameUrl))
            expect(fens[sampled.ply]).toBe(sampled.fen);
    }
    for (const query of fixture.engine.queries) for (const candidate of query.candidates) {
        const board = Chess.fromSetup(parseFen(query.fen).unwrap()).unwrap();
        for (const uci of candidate.pv) {
            const move = parseUci(uci)!;
            expect(board.isLegal(move)).toBe(true);
            board.play(move);
        }
    }
});

for (const mirror of [false, true]) {
    for (const game of ["lwOOWkJP", "x2Oo1BCm", "ugpVWplb"]) {
        test(`ordinary development is not a forcing theme: ${game}, mirror=${mirror}`, () => {
            const input = context(`context:${game}:ply8`, mirror);
            for (const row of [input.best, input.source]) {
                expect(classifyPositionTacticalMotifs(row).motifs).toEqual([]);
            }
        });
    }
    for (const id of ["context:x2Oo1BCm:ply80", "context:ugpVWplb:ply40", "context:I1scDAqN:ply8", "context:I1scDAqN:ply21"]) {
        test(`exchange recovery is not a free-piece win: ${id}, mirror=${mirror}`, () => {
            const input = context(id, mirror);
            const board = Chess.fromSetup(parseFen(input.base.previousFen).unwrap()).unwrap();
            const previous = parseUci(input.base.previousMoveUci)!;
            const lostRole = "to" in previous ? board.board.get(previous.to)?.role : undefined;
            board.play(previous);
            expect(makeFen(board.toSetup())).toBe(input.base.fen);
            const recapture = parseUci(input.best.pvUci[0])!;
            const recoveredRole = "to" in recapture ? board.board.get(recapture.to)?.role : undefined;
            expect(lostRole).toBeDefined();
            expect(recoveredRole).toBe(lostRole);
            for (const row of [input.best, input.source]) {
                const result = classifyPositionTacticalMotifs(row);
                expect(result.motifs.filter(m => m.ply === 1 && ["hangingPiece", "capturingDefender"].includes(m.id))).toEqual([]);
            }
        });
    }
    test(`an unavoidable trapped bishop is not blamed on playing the best recapture, mirror=${mirror}`, () => {
        const input = context("context:ugpVWplb:ply40", mirror);
        const result = classifyMistakeReviewMotifs(input.review);
        expect(result.allowedMotifs[0]).toMatchObject({ id: "trappedPiece", comparison: "persists", value: 100 });
        expect(result.missedMotifs).toEqual([]);
        const explanation = buildMistakeReviewTacticalExplanation(result);
        expect(explanation?.text).toContain("same position");
        expect(explanation?.text).not.toContain("Your move allowed");
    });
    test(`a parryable mate threat after the best recapture stays neutral, mirror=${mirror}`, () => {
        const input = context("context:I1scDAqN:ply21", mirror);
        const result = classifyMistakeReviewMotifs(input.review);
        expect(result.allowedMotifs[0]).toMatchObject({ id: "matingThreat", comparison: "persists", value: 0 });
        expect(buildMistakeReviewTacticalExplanation(result)?.text).toContain("does not establish why");
    });
    test(`single-target pawn tempo is not a fork or trapped piece, mirror=${mirror}`, () => {
        const input = context("context:I1scDAqN:ply40", mirror);
        const result = classifyPositionTacticalMotifs(input.source);
        expect(result.motifs.filter(m => m.ply === 1 && ["fork", "trappedPiece"].includes(m.id))).toEqual([]);
    });
}
