import { expect, test } from "vitest";
import {
    extractTacticalSequenceWitnesses,
    mergeTacticalSequenceWitnesses,
} from "../tacticalMotifs/tacticalSequenceEvidence";

const inspect = (fen: string, pvUci: string[]) =>
    extractTacticalSequenceWitnesses(fen, { fen, pvUci, cp: 200, depth: 18 });

test("alternative replies share one motif label while retaining separate lines", () => {
    const fen = "3r4/4k3/8/8/1N6/8/8/6K1 w - - 0 1";
    const first = inspect(fen, ["b4c6", "e7f7", "c6d8"]);
    const second = inspect(fen, ["b4c6", "e7f6", "c6d8"]);
    const grouped = mergeTacticalSequenceWitnesses([...first, ...second, ...first]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].lineUci).toEqual(["b4c6", "e7f7", "c6d8"]);
    expect(grouped[0].alternatives).toHaveLength(1);
    expect(grouped[0].alternatives?.[0].lineUci).toEqual(["b4c6", "e7f6", "c6d8"]);
    expect(first[0].alternatives).toBeUndefined();
});

test("a fork requires a displaced target and a legal capture of the other target", () => {
    const fen = "3r4/4k3/8/8/1N6/8/8/6K1 w - - 0 1";
    expect(inspect(fen, ["b4c6", "e7f7", "c6d8"])).toEqual([
        expect.objectContaining({
            mechanism: "fork",
            mechanismPly: 1,
            payoffPly: 3,
            rootMoveInvolved: true,
            support: "legal-continuation",
        }),
    ]);
    expect(inspect(fen, ["b4c6", "e7f7", "c6d4"])).toEqual([]);
    expect(inspect(fen, ["b4c6", "e7e5", "c6d8"])).toEqual([]);
});

test("a geometric double attack on protected cheap targets is not labelled a meaningful fork", () => {
    const fen = "7k/8/1p3p2/p3p3/1N6/8/8/6K1 w - - 0 1";
    expect(inspect(fen, ["b4c6", "h8g8", "c6e5"]).some((item) => item.mechanism === "fork")).toBe(
        false,
    );
});

test("deflection requires a legal recapture duty before the defender moves", () => {
    const fen = "7k/8/8/8/8/5r2/1q3P2/2B2R1K b - - 0 1";
    const witnesses = inspect(fen, ["f3f2", "f1f2", "b2c1"]);
    expect(witnesses).toContainEqual(
        expect.objectContaining({ mechanism: "deflection", actor: "black" }),
    );
    // The original rook cannot recapture on c1 through its own pawn on e1.
    expect(
        inspect(fen.replace("2B2R1K", "2B1NR1K"), ["f3f2", "f1f2", "b2c1"]).some(
            (w) => w.mechanism === "deflection",
        ),
    ).toBe(false);
});

test("a discovered capture is tied to the actual slider and cleared line", () => {
    const fen = "6k1/8/8/8/8/1q6/1B6/1R4K1 w - - 0 1";
    const witnesses = inspect(fen, ["b2c3", "g8f8", "b1b3"]);
    expect(witnesses).toContainEqual(
        expect.objectContaining({ mechanism: "discoveredAttack", payoffPly: 3 }),
    );
    // The slider already had access to the target; a random bishop move is not a discovery.
    expect(
        inspect(fen.replace("1B6", "2B5"), ["c2d3", "g8f8", "b1b3"]).some(
            (w) => w.mechanism === "discoveredAttack",
        ),
    ).toBe(false);
});

test("later mechanisms retain their ply instead of becoming root diagnoses", () => {
    const fen = "7k/8/8/8/8/1q6/1B6/1R4K1 b - - 0 1";
    const witnesses = inspect(fen, ["h8g8", "b2c3", "g8f8", "b1b3"]);
    expect(witnesses).toContainEqual(
        expect.objectContaining({
            mechanism: "discoveredAttack",
            mechanismPly: 2,
            rootMoveInvolved: false,
        }),
    );
});

test("bound or wrong-position evidence cannot donate a mechanism", () => {
    const fen = "3r4/4k3/8/8/1N6/8/8/6K1 w - - 0 1";
    const line = { fen, pvUci: ["b4c6", "e7f7", "c6d8"], cp: 200, depth: 18 };
    expect(extractTacticalSequenceWitnesses(fen, { ...line, lowerbound: true })).toEqual([]);
    expect(
        extractTacticalSequenceWitnesses(fen, { ...line, fen: fen.replace("0 1", "2 5") }),
    ).toEqual([]);
});
