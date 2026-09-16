import { expect, test } from "vitest";
import { INITIAL_FEN, makeFen } from "chessops/fen";
import { parseUci, parseSquare } from "chessops/util";
import {
    appendTacticalHistory,
    MAX_TACTICAL_HISTORY_PLIES,
    persistentPawnExchangeContext,
    tacticalGameHistory,
    tacticalHistoryAtPath,
    verifiedTacticalHistory,
} from "../tacticalMotifs/gameHistory";
import {
    provePersistentPawnCapture,
    replayTacticalLine,
    tacticalCaptureGain,
} from "../tacticalMotifs/causalTactics";
import {
    buildLiveTacticalScan,
    getLiveTacticalScanCacheKey,
} from "../tacticalMotifs/liveTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { persistentPawnCases } from "./fixtures/persistentPawnCapture";

const olderPawnMoves = [
    "e2e4",
    "e7e5",
    "g1f3",
    "b8c6",
    "a2a3",
    "g8f6",
    "f1c4",
];
const recoveries = [
    ["e2e4", "e7e5", "g1f3", "g8f6", "f3e5", "d7d6", "e5f3", "f6e4"],
    [
        "d2d4",
        "d7d5",
        "c2c4",
        "e7e6",
        "g1f3",
        "g8f6",
        "g2g3",
        "d5c4",
        "d1a4",
        "b8c6",
        "a4c4",
    ],
    [
        "d2d4",
        "d7d5",
        "c2c4",
        "e7e6",
        "g1f3",
        "g8f6",
        "g2g3",
        "d5c4",
        "f1g2",
        "b8c6",
        "d1a4",
        "c8d7",
        "a4c4",
    ],
];
function reached(moves: string[], fen = INITIAL_FEN) {
    const steps = replayTacticalLine(fen, moves);
    expect(steps).toHaveLength(moves.length);
    return {
        steps,
        fen: steps.length ? makeFen(steps.at(-1)!.after.toSetup()) : fen,
    };
}

test("complete legal history retains identities across both castling notations", () => {
    for (const castle of ["e1g1", "e1h1"]) {
        const moves = ["e2e4", "e7e5", "g1f3", "b8c6", "f1e2", "g8f6", castle];
        const { fen } = reached(moves);
        const result = verifiedTacticalHistory(
            { fen: INITIAL_FEN, moves },
            fen,
        )!;
        expect(result).not.toBeNull();
        expect(result.locations[parseSquare("e1")!]).toBe(parseSquare("g1"));
        expect(result.locations[parseSquare("h1")!]).toBe(parseSquare("f1"));
        expect(result.frames.map((frame) => frame.capture)).toEqual(
            Array(7).fill(0),
        );
    }
});

test("en passant removes the actual pawn identity and promotions preserve the moving identity", () => {
    const moves = ["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"];
    const result = verifiedTacticalHistory(
        { fen: INITIAL_FEN, moves },
        reached(moves).fen,
    )!;
    expect(result.locations[parseSquare("d7")!]).toBe(-1);
    expect(result.locations[parseSquare("e2")!]).toBe(parseSquare("d6"));
    expect(result.frames.at(-1)?.capture).toBe(100);
    const fen = "rnbqkbnr/Pppppppp/8/8/8/p7/1PPPPPPP/RNBQKBNR w KQkq - 0 1";
    const promotion = verifiedTacticalHistory(
        { fen, moves: ["a7b8q"] },
        reached(["a7b8q"], fen).fen,
    )!;
    expect(promotion.frames[0].capture).toBe(320);
    expect(promotion.frames[0].promotionGain).toBe(800);
    expect(promotion.locations[parseSquare("a7")!]).toBe(parseSquare("b8"));
    expect(promotion.locations[parseSquare("b8")!]).toBe(-1);
});

test("older safe pawn opportunity is admitted with complete history, not future PV gains", () => {
    const { fen } = reached(olderPawnMoves);
    const root = replayTacticalLine(fen, ["f6e4"])[0];
    const history = { fen: INITIAL_FEN, moves: olderPawnMoves };
    expect(tacticalCaptureGain(root)).toBe(100);
    expect(
        persistentPawnExchangeContext(history, fen, root.move)?.balance,
    ).toBe(0);
    expect(provePersistentPawnCapture(root, history)?.gain).toBe(100);
    const input = {
        fen,
        pvUci: ["f6e4"],
        rootCp: 100,
        cp: 100,
        tacticalHistory: history,
    };
    expect(
        classifyPositionTacticalMotifs(input).motifs.map((m) => m.label),
    ).toContain("Hanging Pawn");
    expect(
        classifyPositionTacticalMotifs({ ...input, tacticalHistory: undefined })
            .motifs,
    ).toEqual([]);
    const scan = buildLiveTacticalScan({
        ...input,
        variations: [{ pvUci: input.pvUci, cp: 100 }],
        depth: 16,
        engineName: "Constructed",
    });
    expect(scan.motifs.map((m) => m.label)).toContain("Hanging Pawn");
    for (const rootCp of [null, 9000, -10000])
        expect(
            classifyPositionTacticalMotifs({ ...input, rootCp }).motifs,
        ).toEqual([]);
});

test.each(recoveries.map((moves, index) => ({ index, moves })))(
    "gambit recovery $index is not a new pawn gain, even when delayed",
    ({ moves }) => {
        const { steps } = reached(moves);
        const root = steps.at(-1)!;
        const history = { fen: INITIAL_FEN, moves: moves.slice(0, -1) };
        expect(tacticalCaptureGain(root)).toBeGreaterThanOrEqual(100);
        expect(
            persistentPawnExchangeContext(
                history,
                makeFen(root.before.toSetup()),
                root.move,
            )?.balance,
        ).toBeLessThanOrEqual(-100);
        expect(provePersistentPawnCapture(root, history)).toBeNull();
    },
);

test("truncated Catalan history cannot hide its earlier pawn debt", () => {
    const moves = recoveries[1],
        { steps } = reached(moves),
        root = steps.at(-1)!;
    const shortened = {
        fen: makeFen(steps[7].after.toSetup()),
        moves: moves.slice(8, -1),
    };
    expect(
        verifiedTacticalHistory(shortened, makeFen(root.before.toSetup())),
    ).toBeNull();
    expect(provePersistentPawnCapture(root, shortened)).toBeNull();
});

test("a settled bishop-for-knight trade does not erase a separate pawn gain or inflate its displayed value", () => {
    const moves = ["d2d4", "b8c6", "g1f3", "d7d5", "b1c3", "e7e6", "e2e4", "f8b4", "h2h3", "b4c3", "b2c3"];
    const { fen } = reached(moves);
    const proof = provePersistentPawnCapture(replayTacticalLine(fen, ["d5e4"])[0], { fen: INITIAL_FEN, moves });
    expect(proof).toMatchObject({ gain: 100, exchangeBalance: -10 });
});

test("malformed, wrong-root, stale-clock, incomplete and overlong histories fail closed without slicing", () => {
    const { fen } = reached(olderPawnMoves);
    for (const history of [
        undefined,
        { fen: INITIAL_FEN, moves: [] },
        { fen: INITIAL_FEN, moves: ["e2e5"] },
        { fen: "invalid", moves: [] },
        { fen: INITIAL_FEN, moves: [...olderPawnMoves, ""] },
    ])
        expect(verifiedTacticalHistory(history, fen)).toBeNull();
    expect(
        verifiedTacticalHistory(
            { fen: INITIAL_FEN, moves: olderPawnMoves },
            fen.replace(/ \d+$/, " 99"),
        ),
    ).toBeNull();
    expect(tacticalGameHistory(INITIAL_FEN, [undefined])).toBeUndefined();
    expect(
        tacticalGameHistory(
            INITIAL_FEN,
            Array(MAX_TACTICAL_HISTORY_PLIES + 1).fill("e2e4"),
        ),
    ).toBeUndefined();
    expect(appendTacticalHistory(undefined, "e2e4")).toBeUndefined();
    const history = tacticalGameHistory(INITIAL_FEN, olderPawnMoves)!;
    const original = JSON.stringify(history);
    expect(appendTacticalHistory(history, "f6e4")?.moves).toHaveLength(8);
    expect(JSON.stringify(history)).toBe(original);
    expect(verifiedTacticalHistory(history, fen)).not.toBeNull();
    history.moves[0] = "e2e3";
    expect(verifiedTacticalHistory(history, fen)).toBeNull();
});

test("selected tree variations preserve the exact prefix and missing moves cannot be dropped", () => {
    const leaf = (move: string) => ({
        fen: "unused",
        move: parseUci(move)!,
        children: [],
    });
    const root = {
        fen: INITIAL_FEN,
        move: null,
        children: [leaf("e2e4"), { ...leaf("d2d4"), children: [leaf("d7d5")] }],
    };
    expect(tacticalHistoryAtPath(root, [1, 0])).toEqual({
        fen: INITIAL_FEN,
        moves: ["d2d4", "d7d5"],
    });
    expect(tacticalHistoryAtPath(root, [])).toEqual({
        fen: INITIAL_FEN,
        moves: [],
    });
    expect(tacticalHistoryAtPath(root, [0, 0])).toBeUndefined();
    expect(tacticalHistoryAtPath(root, [-1])).toBeUndefined();
    expect(
        tacticalHistoryAtPath(
            { ...root, children: [{ ...leaf("e2e4"), move: null }] },
            [0],
        ),
    ).toBeUndefined();
    const cache = { fen: INITIAL_FEN, engineId: "test", depth: 16, multipv: 3 };
    expect(getLiveTacticalScanCacheKey(cache)).not.toBe(
        getLiveTacticalScanCacheKey({
            ...cache,
            tacticalHistory: tacticalHistoryAtPath(root, []),
        }),
    );
});

test.each(persistentPawnCases)(
    "full histories preserve pawn lessons and exchange exclusions in both colours: $id",
    (row) => {
        const scan = buildLiveTacticalScan({
            ...row,
            depth: 16,
            engineName: "Constructed",
        });
        expect(scan.motifs.map((m) => m.label)).toEqual(
            row.positive ? ["Hanging Pawn"] : [],
        );
        expect(scan.arrows.every((arrow) => arrow.ply === 1)).toBe(true);
    },
);
