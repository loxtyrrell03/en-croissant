import { afterAll, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
    proveExchangeDiscovery,
    provePromotionCombination,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs, MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION } from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

// Independently constructed contrasts. Passing these engineering judgments
// does not measure accuracy over ordinary games or certify a positional move.
const cases = [
    {
        id: "forced rook deflection retains its actual mechanism",
        fen: "3r2k1/p4ppp/1p6/2pq4/4R3/1P2PQ2/P5PP/6K1 w - - 0 24",
        pvUci: ["e4e8", "d8e8", "f3d5"],
        primary: "deflection",
    },
    {
        id: "declining a deflection cannot fund a discovery with an old attack",
        fen: "3r2k1/p4pp1/1p5p/2pq4/4R3/1P2PQ2/P5PP/6K1 w - - 0 24",
        pvUci: ["e4e8", "d8e8", "f3d5"],
        primary: null,
        // ...Kh7 Rxd8 Qxd8 balances. Subsequent Qxf7 uses the queen's
        // previously open file, not the newly exposed Qf3-Qd5 diagonal.
    },
    {
        id: "removing the rook permits a capture-created passed pawn",
        fen: "6k1/p6r/1P6/8/8/8/8/6KR w - - 0 1",
        pvUci: ["h1h7", "g8h7", "b6a7", "h7g6", "a7a8q"],
        primary: "promotionCombination",
    },
    {
        id: "a second rook refutes the cooperative promotion",
        fen: "1r4k1/p6r/1P6/8/8/8/8/6KR w - - 0 1",
        pvUci: ["h1h7", "g8h7", "b6a7", "h7g6", "a7a8q", "b8a8"],
        primary: null,
    },
    {
        id: "declining the king bait preserves the forced mate lesson",
        fen: "rr6/p3p2k/3pNpp1/1pp5/2q1P3/5R2/P2Q2PP/6K1 w - - 0 27",
        pvUci: ["d2h6", "h7g8", "h6g7"],
        primary: "mateIn2",
    },
    {
        id: "accepting the king bait does not change the root mate lesson",
        fen: "rr6/p3p2k/3pNpp1/1pp5/2q1P3/5R2/P2Q2PP/6K1 w - - 0 27",
        pvUci: ["d2h6", "h7h6", "f3h3"],
        primary: "mateIn2",
    },
];

const report: { id: string; kind: string; fen: string; pvUci: string[]; expected: unknown; actual: unknown; pass: boolean }[] = [];
afterAll(() => {
    if (!process.env.TACTICAL_PROOF_ATTRIBUTION_REPORT) return;
    const source = readFileSync("src/utils/tacticalMotifs/causalTactics.ts", "utf8").replace(/\r\n/g, "\n");
    writeFileSync(process.env.TACTICAL_PROOF_ATTRIBUTION_REPORT, JSON.stringify({
        classifierVersion: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
        sourceSha256LF: createHash("sha256").update(source).digest("hex"),
        note: "Synthetic engineering judgments, not a population accuracy estimate. Existing checking-ray work is verified separately.",
        contracts: report.length, passed: report.filter(row => row.pass).length, cases: report,
    }, null, 2), { flag: "wx" });
});

function reflected(row: (typeof cases)[number], flip: boolean) {
    return {
        ...row,
        fen: flip ? reflectMixedForkFen(row.fen) : row.fen,
        pvUci: flip ? row.pvUci.map(reflectMixedForkMove) : row.pvUci,
    };
}

for (const row of cases) test.each([false, true])(`${row.id}, reflected=%s`, (flip) => {
    const input = reflected(row, flip);
    expect(replayTacticalLine(input.fen, input.pvUci)).toHaveLength(input.pvUci.length);
    const motifs = classifyPositionTacticalMotifs(input).motifs.filter(m => m.ply === 1);
    const pass = (motifs[0]?.id ?? null) === row.primary &&
        (row.primary !== "mateIn2" || !motifs.some(m => m.id === "attraction" || m.id === "anastasiaMate"));
    report.push({ id: `${row.id}:reflected=${flip}`, kind: "root-primary", fen: input.fen,
        pvUci: input.pvUci, expected: row.primary, actual: motifs.map(m => m.id), pass });
    expect(motifs[0]?.id ?? null).toBe(row.primary);
    expect(row.primary !== "mateIn2" || !motifs.some(m => m.id === "attraction" || m.id === "anastasiaMate")).toBe(true);
});

test.each([false, true])("promotion certificate checks every reply without needing the PV, reflected=%s", flip => {
    const input = reflected(cases[2], flip);
    const first = replayTacticalLine(input.fen, input.pvUci.slice(0, 1))[0];
    const proof = provePromotionCombination(first, 262144, undefined, true);
    const budgetExhausted = provePromotionCombination(first, 1) === null;
    const rootPrimary = classifyPositionTacticalMotifs({ ...input, pvUci: input.pvUci.slice(0, 1) }).motifs[0]?.id ?? null;
    const pass = !!proof && proof.gain >= 100 && proof.line.some(san => /=[QRBN]/.test(san)) &&
        proof.branches?.length === proof.replyCount && (proof.decisions?.length ?? 0) > 0 &&
        budgetExhausted && rootPrimary === "promotionCombination";
    report.push({ id: `promotion-proof:reflected=${flip}`, kind: "proof-and-budget", fen: input.fen,
        pvUci: input.pvUci.slice(0, 1), expected: "all replies, promotion witness, one-ply root, bounded cache",
        actual: { proof, budgetExhausted, rootPrimary }, pass });
    expect(proof).not.toBeNull();
    expect(proof!.gain).toBeGreaterThanOrEqual(100);
    expect(proof!.line.some(san => /=[QRBN]/.test(san))).toBe(true);
    expect(proof!.branches).toHaveLength(proof!.replyCount);
    expect(proof!.decisions?.length).toBeGreaterThan(0);
    expect(provePromotionCombination(first, 1)).toBeNull();
    expect(classifyPositionTacticalMotifs({ ...input, pvUci: input.pvUci.slice(0, 1) }).motifs[0]?.id)
        .toBe("promotionCombination");
});

test.each([false, true])("shared-defender discovery refuses the unrelated target even with spare budget, reflected=%s", flip => {
    const input = reflected(cases[1], flip);
    const first = replayTacticalLine(input.fen, input.pvUci)[0];
    const proofs = [proveExchangeDiscovery(first), proveExchangeDiscovery(first, 32768), proveExchangeDiscovery(first, 1)];
    report.push({ id: `discovery-target-scope:reflected=${flip}`, kind: "proof-and-budget", fen: input.fen,
        pvUci: input.pvUci, expected: [null, null, null], actual: proofs, pass: proofs.every(proof => proof === null) });
    for (const proof of proofs) expect(proof).toBeNull();
});
