import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseSquare, parseUci, makeUci } from "chessops/util";
import inputs from "./rare-causal-cohort-v2-inputs.json";
import selection from "./rare-causal-cohort-v2-selection.json";
import { selectTacticalDevelopmentCases } from "../../scripts/benchmarks/tactical-sample-evidence.mjs";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
} from "../../src/utils/tacticalMotifs/mistakeReviewAdapter";
import {
    reflectMixedForkFen,
    reflectMixedForkMove,
} from "../../src/utils/tests/fixtures/mixedTargetFork";
const position = (fen: string) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
const legal = (pos: Chess) =>
    [...pos.allDests()].flatMap(([from, tos]) =>
        [...tos].flatMap((to) =>
            pos.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
                ? (["queen", "rook", "bishop", "knight"] as const).map((promotion) => ({
                      from,
                      to,
                      promotion,
                  }))
                : [{ from, to }],
        ),
    );
const play = (pos: Chess, uci: string) => {
    const move = parseUci(uci)!;
    expect(pos.isLegal(move)).toBe(true);
    pos.play(move);
};
const sourceFiles = [
    "src/utils/tacticalMotifs/causalTactics.ts",
    "src/utils/tacticalMotifs/mistakeReviewAdapter.ts",
    "src/utils/tacticalMotifs/historyAwareMate.ts",
    "src/utils/tacticalMotifs/continuationHistory.ts",
    "src/utils/tacticalMotifs/quietClearancePreparation.ts",
    "src/utils/tacticalMotifs/quietIntermediateCapture.ts",
    "src/utils/tacticalMotifs/repetitionHistory.ts",
    "src/utils/tacticalMotifs/types.ts",
    "src/utils/tacticalMotifs/liveTactics.ts",
    "benchmarks/tactical-relevance/rare-causal-cohort-v2-selection.json",
    "benchmarks/tactical-relevance/rare-causal-cohort-v2-inputs.json",
    "benchmarks/tactical-relevance/rare-causal-cohort-v2-hypotheses.json",
];
const hashes = () => {
    const ref = process.env.RARE_CAUSAL_COHORT_V2_REF;
    const committedFiles = ref
        ? new Set(
              execFileSync(
                  "git",
                  [
                      "-c",
                      "safe.directory=C:/Users/Lox/Desktop/repo/en-croissant",
                      "ls-tree",
                      "-r",
                      "--name-only",
                      ref,
                      "src/utils/tacticalMotifs",
                  ],
                  { encoding: "utf8" },
              )
                  .trim()
                  .split(/\r?\n/),
          )
        : null;
    return Object.fromEntries(
        sourceFiles.map((path) =>
            committedFiles && path.startsWith("src/") && !committedFiles.has(path)
                ? [path, null]
                : [
                      path,
                      createHash("sha256")
                          .update(
                              process.env.RARE_CAUSAL_COHORT_V2_REF && path.startsWith("src/")
                                  ? execFileSync("git", [
                                        "-c",
                                        "safe.directory=C:/Users/Lox/Desktop/repo/en-croissant",
                                        "show",
                                        `${process.env.RARE_CAUSAL_COHORT_V2_REF}:${path}`,
                                    ])
                                  : readFileSync(path),
                          )
                          .digest("hex"),
                  ],
        ),
    );
};

test("all selected public roots and both complete game exports replay legally", () => {
    expect(inputs.puzzles).toHaveLength(8);
    expect(inputs.contexts).toHaveLength(6);
    for (const row of inputs.puzzles) {
        const pos = position(row.sourceFen);
        play(pos, row.precedingMove);
        expect(makeFen(pos.toSetup())).toBe(row.startFen);
        for (const move of row.bestLine) play(pos, move);
    }
    for (const game of inputs.games) {
        const pos = position(game.startFen),
            fens = [makeFen(pos.toSetup())];
        for (const move of game.moves) {
            play(pos, move);
            fens.push(makeFen(pos.toSetup()));
        }
        for (const row of inputs.contexts.filter((r) => r.gameId === game.gameId))
            expect(row.fen).toBe(fens[row.ply]);
    }
});
test("frozen selection remains disjoint from its recorded prior public review", () => {
    const games = [
        ...selection.cases.map((r) => r.sourceGroup),
        ...selection.controlGames.map((r) => r.sourceGroup),
    ];
    expect(new Set(games).size).toBe(10);
    for (const game of games) expect(selection.excludedGames).not.toContain(game);
    for (const row of selection.cases) {
        expect(selection.excludedIds).not.toContain(row.id);
        expect(row.selectionHash).toBe(
            createHash("sha256").update(`${selection.seed}:${row.id}`).digest("hex"),
        );
    }
    expect(selection.controlReachedPlies).toEqual([12, 20, 28]);
    expect(hashes()["benchmarks/tactical-relevance/rare-causal-cohort-v2-inputs.json"]).toBe(
        "1e9b386c37d03eb28c1a6044d8da4f4bfe2dbd926b916c91e33ebb6ed2e58d5f",
    );
    expect(hashes()["benchmarks/tactical-relevance/rare-causal-cohort-v2-hypotheses.json"]).toBe(
        "bfaff5a0db65e6cbb1a33a4bdbf320455d97ad07a698a4981403fd948d9b8131",
    );
});
const publicFixturePath = process.env.RARE_CAUSAL_SOURCE_FIXTURE ?? `../${selection.sourceFixture}`;
test.skipIf(!existsSync(publicFixturePath))(
    "frozen development selection is reproducible without running any holdout position",
    () => {
        const raw = readFileSync(publicFixturePath, "utf8");
        expect(createHash("sha256").update(raw).digest("hex")).toBe(selection.sourceSha256);
        const rows = raw
            .trim()
            .split(/\r?\n/)
            .map((line) => JSON.parse(line));
        const exclusions = {
            excludedIds: new Set(selection.excludedIds),
            excludedGames: new Set(selection.excludedGames),
        };
        const chosen = selectTacticalDevelopmentCases(rows, exclusions, selection);
        expect(chosen).toEqual(selection.cases);
        const used = new Set(chosen.map((row) => row.sourceGroup));
        const eligibleGames = new Set<string>(
            rows
                .filter(
                    (row) =>
                        row.split === "development" &&
                        !exclusions.excludedIds.has(row.id) &&
                        !exclusions.excludedGames.has(row.sourceGroup) &&
                        !used.has(row.sourceGroup),
                )
                .map((row) => row.sourceGroup),
        );
        const controls = [...eligibleGames]
            .map((sourceGroup) => ({
                sourceGroup,
                hash: createHash("sha256")
                    .update(`${selection.seed}:controls:${sourceGroup}`)
                    .digest("hex"),
            }))
            .sort((a, b) => a.hash.localeCompare(b.hash))
            .slice(0, 2);
        expect(controls.map((row) => row.sourceGroup)).toEqual(
            selection.controlGames.map((row) => row.sourceGroup),
        );
    },
);
for (const reflected of [false, true]) {
    test(`YvGsE forces the same mate without either incidental target, reflected=${reflected}`, () => {
        const row = inputs.puzzles.find((r) => r.id === "lichess:YvGsE")!;
        for (const removed of [[], ["c8"], ["c1"], ["c8", "c1"]]) {
            const pos = position(reflected ? reflectMixedForkFen(row.startFen) : row.startFen);
            for (const square of removed)
                pos.board.take(
                    parseSquare(reflected ? `${square[0]}${9 - Number(square[1])}` : square)!,
                );
            const line = row.bestLine.map((m) => (reflected ? reflectMixedForkMove(m) : m));
            const defences: string[][] = [];
            for (let i = 0; i < line.length; i++) {
                if (i % 2 === 1) defences.push(legal(pos).map(makeUci));
                play(pos, line[i]);
            }
            expect(defences).toEqual([[line[1]], [line[3]]]);
            expect(pos.isCheckmate()).toBe(true);
        }
    });
    test(`ySzc4 checks and recovers the knight after every legal defence, reflected=${reflected}`, () => {
        const row = inputs.puzzles.find((r) => r.id === "lichess:ySzc4")!;
        const pos = position(reflected ? reflectMixedForkFen(row.startFen) : row.startFen);
        play(pos, reflected ? reflectMixedForkMove(row.bestLine[0]) : row.bestLine[0]);
        expect(pos.isCheck()).toBe(true);
        const replies = legal(pos);
        expect(replies).toHaveLength(7);
        for (const reply of replies) {
            const after = pos.clone();
            after.play(reply);
            const capture = parseUci(reflected ? "e3f2" : "e6f7")!;
            expect("to" in capture && after.board.get(capture.to)?.role).toBe("knight");
            expect(after.isLegal(capture)).toBe(true);
        }
    });
    test(`Xg7Rd trap hypothesis loses a covered escape when its knight guard is removed, reflected=${reflected}`, () => {
        const row = inputs.puzzles.find((r) => r.id === "lichess:Xg7Rd")!;
        const pos = position(reflected ? reflectMixedForkFen(row.startFen) : row.startFen);
        pos.board.take(parseSquare(reflected ? "d7" : "d2")!);
        play(pos, reflected ? "f8g7" : "f1g2");
        play(pos, reflected ? "a4c5" : "a5c4");
        expect(
            pos
                .kingAttackers(parseSquare(reflected ? "c5" : "c4")!, pos.turn, pos.board.occupied)
                .isEmpty(),
        ).toBe(true);
    });
    test(`ordinary single-piece attacks have concrete safe retreats, reflected=${reflected}`, () => {
        const f = (fen: string) => (reflected ? reflectMixedForkFen(fen) : fen);
        const m = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
        for (const [id, replies] of [
            ["context:QZDg7vtX:ply20", ["b4e7"]],
            ["context:Z1Tw5YR3:ply20", ["b4a6", "b4c6"]],
        ] as const) {
            const row = inputs.contexts.find((r) => r.id === id)!;
            for (const reply of replies) {
                const pos = position(f(row.fen));
                play(pos, m(row.playedMoveUci));
                play(pos, m(reply));
                const target = parseUci(m(reply))!;
                expect(
                    "to" in target &&
                        pos.kingAttackers(target.to, pos.turn, pos.board.occupied).isEmpty(),
                ).toBe(true);
            }
        }
        const row = inputs.contexts.find((r) => r.id === "context:Z1Tw5YR3:ply20")!;
        const pos = position(f(row.fen));
        for (const uci of ["a2a3", "b4c2", "e2c2"]) play(pos, m(uci));
        expect(pos.board.get(parseSquare(reflected ? "c7" : "c2")!)?.role).toBe("queen");
    });
    test(`ordinary ply28 misses a free queen rather than proving a quiet position, reflected=${reflected}`, () => {
        const row = inputs.contexts.find((r) => r.id === "context:Z1Tw5YR3:ply28")!;
        const f = (fen: string) => (reflected ? reflectMixedForkFen(fen) : fen);
        const m = (uci: string) => (reflected ? reflectMixedForkMove(uci) : uci);
        const best = position(f(row.fen));
        expect(best.board.get(parseSquare(reflected ? "c2" : "c7")!)?.role).toBe("queen");
        play(best, m("f4c7"));
        expect(
            best
                .kingAttackers(
                    parseSquare(reflected ? "c2" : "c7")!,
                    best.turn,
                    best.board.occupied,
                )
                .isEmpty(),
        ).toBe(true);
        const actual = position(f(row.fen));
        play(actual, m("f1d3"));
        play(actual, m("c7f4"));
        expect(
            actual
                .kingAttackers(
                    parseSquare(reflected ? "f5" : "f4")!,
                    actual.turn,
                    actual.board.occupied,
                )
                .isEmpty(),
        ).toBe(true);
        const common = {
            fen: f(row.fen),
            bestMoveUci: m("f4c7"),
            playedMoveUci: m("f1d3"),
            pvUci: [m("f4c7")],
            refutationUci: [m("c7f4")],
        };
        const result = classifyMistakeReviewMotifs(common);
        expect(
            result.missedMotifs.some((motif) => motif.id === "hangingPiece" && motif.ply === 1),
        ).toBe(true);
    });
}

test("record frozen output-blind cohort observations without scoring source labels", () => {
    const before = hashes();
    const observations = [];
    for (const reflected of [false, true]) {
        const f = (fen: string) => (reflected ? reflectMixedForkFen(fen) : fen);
        const m = (move: string) => (reflected ? reflectMixedForkMove(move) : move);
        for (const row of inputs.puzzles) {
            const board = position(f(row.sourceFen));
            play(board, m(row.precedingMove));
            const common = {
                fen: makeFen(board.toSetup()),
                previousFen: f(row.sourceFen),
                previousMoveUci: m(row.precedingMove),
            };
            for (const scope of ["root-only", "source-line"] as const) {
                const started = performance.now();
                const input = {
                    ...common,
                    pvUci: (scope === "root-only" ? row.bestLine.slice(0, 1) : row.bestLine).map(m),
                };
                observations.push({
                    id: row.id,
                    reflected,
                    scope,
                    input,
                    result: classifyPositionTacticalMotifs(input),
                    elapsedMs: performance.now() - started,
                });
            }
        }
        for (const row of inputs.contexts) {
            const game = inputs.games.find((g) => g.gameId === row.gameId)!;
            const history = { fen: f(game.startFen), moves: game.moves.slice(0, row.ply).map(m) };
            const board = position(history.fen);
            let previousFen = history.fen;
            for (const move of history.moves) {
                previousFen = makeFen(board.toSetup());
                play(board, move);
            }
            for (const scope of ["root-only", "actual-line"] as const) {
                const input = {
                    fen: makeFen(board.toSetup()),
                    previousFen,
                    previousMoveUci: m(row.previousMoveUci),
                    tacticalHistory: history,
                    pvUci: (scope === "root-only"
                        ? row.actualContinuation.slice(0, 1)
                        : row.actualContinuation
                    ).map(m),
                };
                const started = performance.now();
                observations.push({
                    id: row.id,
                    reflected,
                    scope,
                    input,
                    result: classifyPositionTacticalMotifs(input),
                    elapsedMs: performance.now() - started,
                });
            }
        }
    }
    expect(observations).toHaveLength(56);
    expect(hashes()).toEqual(before);
    if (process.env.RARE_CAUSAL_COHORT_V2_REPORT)
        writeFileSync(
            process.env.RARE_CAUSAL_COHORT_V2_REPORT,
            JSON.stringify(
                {
                    schemaVersion: 1,
                    version: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
                    productionRef: process.env.RARE_CAUSAL_COHORT_V2_REF ?? "working-source",
                    scope: "56 exact-input observations, not56correctanswers; source/root/colour are paired, not independent cases",
                    sourceHashes: before,
                    observations,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
}, 30000);
