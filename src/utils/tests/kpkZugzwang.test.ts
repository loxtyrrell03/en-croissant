import { readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { expect, test } from "vitest";
import {
    proveKpkEntry,
    replayTacticalLine,
    tacticalBoardEvidence,
} from "../tacticalMotifs/causalTactics";
import { probeKingPawnEndgame, proveKpkZugzwang } from "../tacticalMotifs/kpkBitbase";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";

const fen = "8/8/8/5k2/8/4K3/5P2/8 w - - 1 69";
const line = ["e3f3"];
test("exact opposition is the immediate main lesson, not a future promotion badge", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.motifs.map((m) => m.id)).toEqual(["zugzwang"]);
    expect(result.motifs[0]).toMatchObject({ ply: 1, confidence: "high", value: 0 });
    expect(result.motifs[0].evidence).toContain("would be drawn");
    expect(tacticalBoardEvidence(fen, line, result.motifs[0])).toEqual({
        square: "f5",
        arrows: [{ from: "e3", to: "f3" }],
    });
});

test("missing the opposition retains the verified zugzwang opportunity", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: line[0],
        playedMoveUci: "e3d3",
        pvUci: line,
    });
    expect(review.missedMotifs[0]).toMatchObject({ id: "zugzwang", source: "missed", ply: 1 });
    expect(buildMistakeReviewTacticalExplanation(review)?.primary).toMatchObject({
        id: "zugzwang",
        source: "missed",
    });
});

test("the real course of play retains zugzwang at ply five without promoting it to the first move", () => {
    const row = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/kpk-zugzwang-development.json", "utf8"),
    ).cases[0];
    const result = classifyPositionTacticalMotifs({ fen: row.startFen, pvUci: row.bestLine });
    expect(result.motifs[0]).toMatchObject({
        id: "tacticalPreparation",
        label: "Winning Pawn Ending",
        ply: 1,
    });
    expect(result.motifs.some((m) => m.id === "zugzwang")).toBe(false);
    expect(result.timeline).toContainEqual(
        expect.objectContaining({ id: "zugzwang", ply: 5, actor: "white" }),
    );
});

test("giving up the opposition is a proved cause, while an already lost ending stays neutral", () => {
    const position = "8/2k5/8/8/2K5/2P5/8/8 b - - 0 1";
    const review = classifyMistakeReviewMotifs({
        fen: position,
        bestMoveUci: "c7c6",
        playedMoveUci: "c7d6",
        pvUci: ["c7c6"],
        refutationUci: ["c4d4"],
    });
    expect(review.allowedMotifs[0]).toMatchObject({ id: "zugzwang", comparison: "prevented" });
    expect(buildMistakeReviewTacticalExplanation(review)?.primary).toMatchObject({
        id: "zugzwang",
        source: "allowed",
    });
    const persisted = classifyMistakeReviewMotifs({
        fen: "8/8/6k1/8/8/4K3/5P2/8 b - - 0 68",
        bestMoveUci: "g6f6",
        playedMoveUci: "g6f5",
        pvUci: ["g6f6"],
        refutationUci: ["e3f3"],
    });
    expect(persisted.allowedMotifs[0]).toMatchObject({ id: "zugzwang", comparison: "persists" });
    expect(buildMistakeReviewTacticalExplanation(persisted)?.title).toBe(
        "Tactical danger in the position",
    );
});

test.each([
    ["8/8/8/8/3kp1K1/8/5P2/8 w - - 0 1", "g4f4", "the king can keep guarding the target"],
    ["8/8/6k1/8/4p1K1/8/7P/8 w - - 0 1", "g4f4", "the resulting rook-pawn ending can be held"],
    ["8/8/6k1/8/5K2/8/4pP2/8 w - - 0 1", "f4f3", "the target can promote"],
])("a pawn attack does not guarantee a winning ending: %s %s (%s)", (position, move, _reason) => {
    const steps = replayTacticalLine(position, [move]);
    expect(steps).toHaveLength(1);
    expect(proveKpkEntry(steps[0])).toBeNull();
});

test("a winning position with either side to move is not zugzwang", () => {
    const position = Chess.fromSetup(parseFen("2k5/8/2K5/2P5/8/8/8/8 b - - 0 1").unwrap()).unwrap();
    expect(probeKingPawnEndgame(position)?.win).toBe(true);
    const passed = position.clone();
    passed.turn = "white";
    expect(probeKingPawnEndgame(passed)?.win).toBe(true);
    expect(proveKpkZugzwang(position)).toBeNull();
});

test.each([[97, true], [98, false]] as const)("the fifty-move window must survive the quiet entry and defence: %i", (clock, expected) => {
    const position = `8/8/6k1/8/4p1K1/8/5P2/8 w - - ${clock} 67`;
    const step = replayTacticalLine(position, ["g4f4"])[0];
    expect(Boolean(proveKpkEntry(step))).toBe(expected);
    expect(classifyPositionTacticalMotifs({ fen: position, pvUci: ["g4f4"] }).motifs.some((motif) => motif.label === "Winning Pawn Ending")).toBe(expected);
});

test.each([false, true])(
    "colour and file reflection preserve the same pass distinction: %s",
    (files) => {
        const position = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
        const setup = position.toSetup();
        const board = setup.board.clone();
        board.clear();
        for (const [square, piece] of setup.board)
            board.set((square ^ 56 ^ (files ? 7 : 0)) as typeof square, {
                role: piece.role,
                color: piece.color === "white" ? "black" : "white",
            });
        setup.board = board;
        setup.turn = "black";
        const reflected = makeFen(setup);
        const pvUci = [files ? "d6c6" : "e6f6"];
        expect(classifyPositionTacticalMotifs({ fen: reflected, pvUci }).motifs[0]).toMatchObject({
            id: "zugzwang",
            ply: 1,
        });
    },
);

test.skipIf(!process.env.TACTICAL_KPK_ENGINE_INPUT)(
    "prepare independent engine probes for entry, pass, all king defences and contrary choices",
    () => {
        const row = JSON.parse(
            readFileSync("benchmarks/tactical-relevance/kpk-zugzwang-development.json", "utf8"),
        ).cases[0];
        const steps = replayTacticalLine(row.startFen, row.bestLine);
        const entry = proveKpkEntry(steps[0])!;
        const zugzwang = proveKpkZugzwang(steps[4].after)!;
        expect(entry).not.toBeNull();
        expect(zugzwang).not.toBeNull();
        const probes: { id: string; fen: string; searchMove?: string }[] = [
            { id: "real:best", fen: row.startFen },
            { id: "real:entry", fen: row.startFen, searchMove: row.bestLine[0] },
            ...entry.branches.map((branch, index) => ({
                id: `real:entry-defence-${index}:${branch.reply}`,
                fen: branch.fen,
                searchMove: branch.captureUci,
            })),
            { id: "real:zugzwang-best", fen },
            { id: "real:zugzwang-Kf3", fen, searchMove: "e3f3" },
            { id: "real:missed-Kd3", fen, searchMove: "e3d3" },
            {
                id: "constructed:hold-opposition",
                fen: "8/2k5/8/8/2K5/2P5/8/8 b - - 0 1",
                searchMove: "c7c6",
            },
            {
                id: "constructed:give-up-opposition",
                fen: "8/2k5/8/8/2K5/2P5/8/8 b - - 0 1",
                searchMove: "c7d6",
            },
            {
                id: "constructed:exploit-opposition",
                fen: "8/8/3k4/8/2K5/2P5/8/8 w - - 1 1",
                searchMove: "c4d4",
            },
            {
                id: "real:existing-loss-Kf5",
                fen: "8/8/6k1/8/8/4K3/5P2/8 b - - 0 68",
                searchMove: "g6f5",
            },
            {
                id: "real:existing-loss-Kf6",
                fen: "8/8/6k1/8/8/4K3/5P2/8 b - - 0 68",
                searchMove: "g6f6",
            },
            {
                id: "control:guarded-pawn",
                fen: "8/8/8/8/3kp1K1/8/5P2/8 w - - 0 1",
                searchMove: "g4f4",
            },
            {
                id: "control:rook-pawn",
                fen: "8/8/6k1/8/4p1K1/8/7P/8 w - - 0 1",
                searchMove: "g4f4",
            },
            {
                id: "control:promotion-escape",
                fen: "8/8/6k1/8/5K2/8/4pP2/8 w - - 0 1",
                searchMove: "f4f3",
            },
            { id: "control:win-with-either-turn", fen: "2k5/8/2K5/2P5/8/8/8/8 b - - 0 1" },
            ...["e4d3", "e4e3", "e4f3"].map((searchMove) => ({
                id: `larger-pawn:${searchMove}`,
                fen: "8/8/3pk3/2p3p1/1pP1K1Pp/1P5P/1P6/8 w - - 1 56",
                searchMove,
            })),
        ];
        for (const [index, move] of zugzwang.replies.entries()) {
            const after = steps[4].after.clone();
            after.play(move);
            probes.push({ id: `real:zugzwang-defence-${index}`, fen: makeFen(after.toSetup()) });
        }
        const passed = steps[4].after.clone();
        passed.turn = "white";
        probes.push({
            id: "counterfactual:pass-is-not-a-legal-move",
            fen: makeFen(passed.toSetup()),
        });
        writeFileSync(
            process.env.TACTICAL_KPK_ENGINE_INPUT!,
            JSON.stringify(
                {
                    samplePath: "benchmarks/tactical-relevance/kpk-zugzwang-development.json",
                    entry,
                    zugzwang,
                    result: classifyPositionTacticalMotifs({
                        fen: row.startFen,
                        pvUci: row.bestLine,
                    }),
                    probes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);

test.each([
    ["k7/8/P7/1K6/8/8/8/8 b - - 0 1", "drawn rook pawn", false],
    ["8/8/8/8/8/8/2P5/K1k5 b - - 0 1", "the pawn can be captured", false],
    ["k7/P7/K7/8/8/8/8/8 b - - 0 1", "stalemate is not an obligation to concede", false],
    ["8/8/3pk3/2p3p1/1pP1K1Pp/1P5P/1P6/8 w - - 1 56", "larger pawn endings remain unsupported", null],
] as const)("no certificate for %s (%s)", (position, _reason, expectedWin) => {
    const parsed = Chess.fromSetup(parseFen(position).unwrap()).unwrap();
    expect(probeKingPawnEndgame(parsed)?.win ?? null).toBe(expectedWin);
    expect(proveKpkZugzwang(parsed)).toBeNull();
});

test.skipIf(!process.env.TACTICAL_KPK_CORPUS_REPORT)(
    "inspect every development continuation entering KPK without selecting by output",
    () => {
        const source =
            "C:/Users/Lox/Desktop/repo/chessmistaketrainer/benchmarks/tactical-classifier/lichess-2026-08-02-fixture-v1.jsonl";
        const rows = readFileSync(source, "utf8")
            .trim()
            .split(/\r?\n/)
            .map((row) => JSON.parse(row))
            .filter((row) => row.split === "development");
        const cases = rows.flatMap((row) =>
            replayTacticalLine(row.startFen, row.bestLine).flatMap((step, index) => {
                if (step.after.board.occupied.size() !== 3 || step.after.board.pawn.size() !== 1)
                    return [];
                const proof = proveKpkZugzwang(step.after);
                return [
                    {
                        id: row.id,
                        sourceGameUrl: row.sourceGameUrl,
                        sourceThemes: row.sourceThemes,
                        root: row.startFen,
                        bestLine: row.bestLine,
                        ply: index + 1,
                        fen: makeFen(step.after.toSetup()),
                        proof,
                        result: classifyPositionTacticalMotifs({
                            fen: row.startFen,
                            pvUci: row.bestLine,
                        }),
                    },
                ];
            }),
        );
        expect(cases.length).toBeGreaterThan(0);
        writeFileSync(
            process.env.TACTICAL_KPK_CORPUS_REPORT!,
            JSON.stringify(
                {
                    scope: "All material-qualified development continuations; source tags are not expected labels",
                    cases,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);
