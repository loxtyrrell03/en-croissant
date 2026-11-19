import { expect, test } from "vitest";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import type { DecisionEngineLine } from "../tacticalMotifs/decisionEvidence";
import { findSharedStructuralPlan } from "../tacticalMotifs/decisionSharedStructure";

const line = (fen: string, cp: number, moves: string): DecisionEngineLine => ({
    fen,
    cp,
    depth: 21,
    pvUci: moves.split(" "),
});

const f4 = "8/ppp4p/3n4/2p1k1p1/3N4/1P2KPP1/P1P4P/8 w - - 0 33";
const breakFirst = line(f4, 13, "f3f4 g5f4 g3f4 e5f6 d4e2 a7a5");
const developFirst = line(f4, 0, "d4e2 c5c4 f3f4 g5f4 g3f4 e5f5 e2d4 f5g4 b3c4");

test("recognizes a file-opening check that recurs after a different first move", () => {
    const result = assessChessDecision({ fen: f4, candidates: [breakFirst, developFirst] });
    expect(result?.position.positional).toMatchObject({ support: "supported", basis: "heuristic" });
    expect(result?.position.strategicPlan?.linesUci.map((pv) => pv[0])).toEqual(["f3f4", "d4e2"]);
    expect(result?.position.strategicPlan?.description).toContain("pawn break changes the g-file");
    expect(result?.moves[0].positional.support).toBe("unestablished");
    expect(result?.mistake).toBeNull();
});

test("withholds shared pawn evidence if a line does not reach the exchange", () => {
    expect(
        findSharedStructuralPlan(f4, [
            breakFirst,
            { ...developFirst, pvUci: developFirst.pvUci.slice(0, 3) },
        ]),
    ).toBeNull();
    expect(findSharedStructuralPlan(f4, [breakFirst, { ...developFirst, cp: -160 }])).toBeNull();
});

test("matches settled effects independently of the number of recaptures", () => {
    const fen = "1rr2bk1/3npp2/q1p1n1pp/p2pP3/P2P1P1B/1P2Q2P/3NN1P1/R1R3K1 b - - 0 27";
    const early = line(fen, 64, "c6c5 d2f3 e6d4 e2d4 c5d4 f3d4 d7c5 f4f5");
    const late = line(fen, 28, "e6g7 g2g4 c6c5 d2f3 g7e6 f4f5 c5d4 f3d4 e6d4 e2d4 e7e6 c1c8 b8c8");
    const proof = findSharedStructuralPlan(fen, [early, late]);
    expect(proof?.description).toMatch(/c5 pawn break.*cxd4 Nfxd4 Nxd4 Nxd4/);
    expect(proof?.linesUci[1].slice(-2)).toEqual(["c1c8", "b8c8"]);
});

test("matches an immediate rook trade with a preparatory rook move", () => {
    const fen = "3r2k1/1pq2pp1/p4b1p/8/1P2n3/1QP1BN1P/1P3PP1/3R2K1 b - - 2 21";
    const preparation = line(fen, -166, "d8d6 d1d6 e4d6 b3d5 d6c4");
    const trade = line(fen, -175, "d8d1 b3d1 c7c6 d1d3 b7b5");
    const proof = findSharedStructuralPlan(fen, [preparation, trade]);
    expect(proof?.description).toMatch(/rook contest on the d-file.*Rxd6 Nxd6.*Rxd1\+ Qxd1/);
    expect(proof?.linesUci).toEqual([
        ["d8d6", "d1d6", "e4d6"],
        ["d8d1", "b3d1"],
    ]);
});

test("rejects exchanges on different squares when neither choice starts the rook contest", () => {
    const fen = "r3r1k1/pp3pbp/2q3p1/4nb2/4NB2/2P3QP/PP3PP1/R3R1K1 w - - 8 22";
    const attacked = line(fen, -662, "e4d2 e5d3 e1e3 d3f4 g3f4 e8e3 f4e3 a8e8");
    const elsewhere = line(fen, -665, "e4g5 e5d3 e1e8 a8e8 g5f3 c6b6");
    expect(findSharedStructuralPlan(fen, [attacked, elsewhere])).toBeNull();
});
