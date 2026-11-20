import { expect, test } from "vitest";
import { measureTacticalEpisode } from "../tacticalMotifs/tacticalSequenceEvidence";
import {
    extractTacticalSequenceWitnesses,
    mergeTacticalSequenceWitnesses,
} from "../tacticalMotifs/tacticalSequenceEvidence";

import kenya from "../../../benchmarks/decision-evidence/promotion-intermezzo/kenya-fixture.json";
import promotionLines from "../../../benchmarks/decision-evidence/promotion-intermezzo/line-fixtures.json";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";

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

test("a rear-piece trade cannot borrow the payoff from a later pawn capture", () => {
    const fen = "3rr3/2q2pkp/2b3p1/2N1p3/1PQp1n2/1BP2P2/6PP/3RR1K1 b - - 2 27";
    const continuation = ["c6d5", "c4f1", "d5b3", "c5b3", "c7c3", "b3c5"];
    expect(inspect(fen, continuation)).not.toContainEqual(
        expect.objectContaining({ mechanism: "skewer", mechanismPly: 1 }),
    );
    const undefended = fen.replace("2N1p3", "4p3");
    expect(inspect(undefended, continuation.slice(0, 3))).toContainEqual(
        expect.objectContaining({ mechanism: "skewer", mechanismPly: 1, payoffPly: 3 }),
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

test("removing a defender can support a later fork after an intervening check", () => {
    const fen = "3r2k1/p2n4/8/1B2p3/8/5N2/P7/K6R w - - 0 1";
    const moves = ["b5d7", "d8d7", "h1h8", "g8f7", "f3e5", "f7g7", "e5d7", "g7f7"];
    const witnesses = inspect(fen, moves);
    expect(witnesses).toContainEqual(
        expect.objectContaining({
            mechanism: "capturingDefender",
            mechanismPly: 1,
            payoffPly: 5,
            rootMoveInvolved: true,
        }),
    );
    expect(witnesses).toContainEqual(
        expect.objectContaining({
            mechanism: "fork",
            mechanismPly: 5,
            payoffPly: 7,
            rootMoveInvolved: false,
        }),
    );
});

test("episode outcomes keep their bounded material claim separate from later play", () => {
    const fen = "3r4/4k2p/8/8/1N6/8/7P/6K1 w - - 0 1";
    const line = {
        fen,
        depth: 18,
        cp: 200,
        pvUci: ["b4c6", "e7f7", "c6d8", "f7g6", "g1f2", "g6f5", "f2e3", "f5e5", "d8e6", "e5e6"],
    };
    const witness = extractTacticalSequenceWitnesses(fen, line).find(
        (item) => item.mechanism === "fork",
    )!;
    expect(measureTacticalEpisode(fen, line, witness)).toMatchObject({
        materialGainPoints: 5,
        throughPly: 6,
    });
    expect(
        measureTacticalEpisode(fen, line, { ...witness, fen: fen.replace("0 1", "0 2") }),
    ).toBeNull();
});

test("a transient capture repaid by an immediate recapture is not a winning episode", () => {
    const fen = "r2b4/4k2p/8/8/1N6/8/7P/6K1 w - - 0 1";
    const line = {
        fen,
        depth: 18,
        cp: 0,
        pvUci: ["b4c6", "e7f7", "c6d8", "a8d8", "g1f2", "f7g6", "f2e3", "g6f5"],
    };
    const witness = extractTacticalSequenceWitnesses(fen, line).find(
        (item) => item.mechanism === "fork",
    )!;
    expect(witness).toBeDefined();
    expect(measureTacticalEpisode(fen, line, witness)).toBeNull();
});

test("links a promotion to the check that wins back the rook", () => {
    const report = assessChessDecision(kenya);
    expect(report?.position.category).toBe("tactical");
    expect(report?.moves[0].tactical.support).toBe("supported");
    expect(report?.moves[0].mechanisms).toContainEqual(expect.objectContaining({
        mechanism: "intermezzo",
        mechanismPly: 3,
        payoffPly: 5,
        rootMoveInvolved: true,
        description: expect.stringMatching(/f8=R.*immediate Rxf8 allows Kxf8.*Re1\+/),
    }));
});

function promotionIntermezzos(id: keyof typeof promotionLines) {
    const { fen, sourcePath } = promotionLines[id];
    return extractTacticalSequenceWitnesses(fen, { fen, depth: 1, cp: 0, pvUci: sourcePath })
        .filter((witness) => witness.mechanism === "intermezzo");
}

test("uses the SAN of the earlier board for the immediate recapture", () => {
    const [witness] = promotionIntermezzos("BLLWK");
    expect(witness).toMatchObject({
        rootMoveInvolved: true,
        description: expect.stringContaining("immediate Rxd1 allows Kxd1"),
    });
});

test("keeps the check as a line event when the king cannot take back immediately", () => {
    const witnesses = promotionIntermezzos("4GkfW");
    expect(witnesses).toHaveLength(1);
    expect(witnesses[0].rootMoveInvolved).toBe(false);
});
