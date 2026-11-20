import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import {
    assessDecisionEndgame,
    decisionEndgameFen,
    decisionEndgameReplyFens,
} from "../tacticalMotifs/decisionEndgame";
import { lookupDecisionEndgameEvidence } from "../tacticalMotifs/tablebaseLookup";
import type { TablebaseEvidence } from "../tacticalMotifs/tablebaseEvidence";

const { fen, evidence } = JSON.parse(
    readFileSync("benchmarks/decision-evidence/exact-endgame-decisions/witness.json", "utf8"),
) as { fen: string; evidence: TablebaseEvidence };
const [root, afterRg5, afterKf1, afterRd4] = evidence.records;
const fromRecords = (...records: TablebaseEvidence["records"]): TablebaseEvidence => ({
    provider: "lichess-syzygy",
    records,
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

test("three quiet replies draw, and the nearby losing rook move supplies the tactical contrast", () => {
    const proof = assessDecisionEndgame({ fen }, fromRecords(root, afterRg5));
    expect(proof?.bestOutcome).toBe(0);
    expect(proof?.legalMoveCount).toBe(19);
    expect(proof?.bestMoves.map(({ san }) => san)).toEqual(["Rg6", "Rg7", "Rg8"]);
    expect(proof?.defensiveTactic?.safeMoves).toEqual(["g4g6", "g4g7", "g4g8"]);
    expect(proof?.defensiveTactic?.avoidingCapture).toContain("Rg5 allows Rxg5");
    expect(proof?.played).toBeUndefined();
});

test("the played king move has its own losing mechanism", () => {
    const proof = assessDecisionEndgame({ fen, playedMoveUci: "e2f1" }, evidence);
    expect(proof?.played).toMatchObject({
        outcome: -1,
        san: "Kf1",
        reply: { san: "e2+", cause: "Kf1 leaves e2, allowing the pawn to advance with e2+." },
    });
});

test("the provider's winning king reply can be shown without a new tactical label", () => {
    const proof = assessDecisionEndgame(
        { fen, playedMoveUci: "g4d4" },
        fromRecords(root, afterRd4),
    );
    expect(proof?.played?.reply).toMatchObject({ san: "Kg3", cause: undefined });
    expect(proof?.defensiveTactic).toBeUndefined();
});

test("an equal rook trade can lose without dropping a rook", () => {
    const exchange = JSON.parse(
        readFileSync(
            "benchmarks/decision-evidence/exact-endgame-decisions/equal-exchange.json",
            "utf8",
        ),
    ) as { fen: string; evidence: TablebaseEvidence };
    const result = assessDecisionEndgame(
        { fen: exchange.fen, playedMoveUci: "g1d1" },
        exchange.evidence,
    );
    expect(result?.bestOutcome).toBe(0);
    expect(result?.played).toMatchObject({
        san: "Rxd1",
        outcome: -1,
        reply: { san: "Kxd1", cause: undefined, capturedMover: false },
    });
});

test("an equally good played move is not a mistake, even when another choice loses", () => {
    const target = { fen, playedMoveUci: "g4g8" };
    expect(decisionEndgameReplyFens(target, fromRecords(root))).toEqual([afterRg5.fen]);
    expect(assessDecisionEndgame(target, evidence)?.played).toEqual({
        san: "Rg8",
        outcome: 0,
        reply: undefined,
    });
    expect(decisionEndgameReplyFens({ fen, playedMoveUci: "g4g5" }, fromRecords(root))).toEqual([
        afterRg5.fen,
    ]);
});

test("partial, unrelated, or inconsistent replies never supply the missing explanation", () => {
    const target = { fen, playedMoveUci: "e2f1" };
    expect(
        assessDecisionEndgame(target, fromRecords(root, afterRd4))?.defensiveTactic,
    ).toBeUndefined();
    expect(
        assessDecisionEndgame(target, fromRecords(root, afterRd4))?.played?.reply,
    ).toBeUndefined();
    const altered = structuredClone(afterRg5) as {
        fen: string;
        result: { moves: Array<{ category: string }> };
    };
    altered.result.moves[0].category = "draw";
    expect(
        assessDecisionEndgame(target, fromRecords(root, altered))?.defensiveTactic,
    ).toBeUndefined();
    const incomplete = structuredClone(root) as { fen: string; result: { moves: unknown[] } };
    incomplete.result.moves.pop();
    expect(assessDecisionEndgame(target, fromRecords(incomplete, afterRg5))).toBeNull();
});

test("checks the exact board, move clock and available repetition history", () => {
    expect(decisionEndgameFen({ fen })).toBe(fen);
    expect(decisionEndgameFen({ fen: fen.replace("0 62", "99 62") })).toBeNull();
    expect(decisionEndgameFen({ fen, history: { fen, moves: ["g4g8"] } })).toBeNull();
    expect(decisionEndgameFen({ fen, history: { fen, moves: [] } })).toBe(fen);
    expect(
        decisionEndgameFen({
            fen: fen.replace("0 62", "4 64"),
            history: { fen, moves: ["g4g8", "e5e6", "g8g4", "e6e5"] },
        }),
    ).toBeNull();
});

test("the opt-in lookup fetches only the exact root, played reply and one lookalike", async () => {
    const fetcher = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(root.result)))
        .mockResolvedValueOnce(new Response(JSON.stringify(afterKf1.result)))
        .mockResolvedValueOnce(new Response(JSON.stringify(afterRg5.result)));
    vi.stubGlobal("fetch", fetcher);
    const result = await lookupDecisionEndgameEvidence(
        { fen, playedMoveUci: "e2f1" },
        new AbortController().signal,
    );
    expect(result.records).toEqual([root, afterKf1, afterRg5]);
    expect(fetcher.mock.calls.map(([url]) => new URL(url).searchParams.get("fen"))).toEqual([
        root.fen,
        afterKf1.fen,
        afterRg5.fen,
    ]);
});

test("provider failure on the optional reply keeps the verified outcomes", async () => {
    const fetcher = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(root.result)))
        .mockResolvedValueOnce(new Response("", { status: 429 }));
    vi.stubGlobal("fetch", fetcher);
    const result = await lookupDecisionEndgameEvidence(
        { fen, playedMoveUci: "e2f1" },
        new AbortController().signal,
    );
    expect(result.records).toEqual([root]);
    expect(assessDecisionEndgame({ fen }, result)?.bestOutcome).toBe(0);
    expect(assessDecisionEndgame({ fen }, result)?.defensiveTactic).toBeUndefined();
});
