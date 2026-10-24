import { expect, test } from "vitest";
import { classifyPositionTacticalMotifs, classifyMistakeReviewMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { replayTacticalLine, proveXRaySupport, proveCastlingDoubleAttack, tacticalBoardEvidence } from "../tacticalMotifs/causalTactics";
import { makeUci, parseUci } from "chessops/util";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

// Fixed public development nominations Vk1Ud / UohLn. Source tags did not
// supply these judgments: seven/29 complete legal reply sets were checked
// independently with python-chess, including every promotion role.
const castleFen = "r3k2r/pR2pp1p/2n3p1/8/4P3/5BP1/P2K1P1P/7R b kq - 0 16";
const xrayFen = "2Qr1k1r/3Pb1p1/5p2/2p1pq2/1PP4p/P2RR2P/3B2P1/7K b - - 0 37";
const flipUci = (move: string) => move.replace(/[1-8]/g, (rank) => String(9 - Number(rank)));
function reflected(fen: string, line: string[], mirror: boolean) {
    if (!mirror) return { fen, pvUci: line };
    const fields = fen.split(" ");
    const flipCase = (value: string) => value.replace(/[a-zA-Z]/g,
        (letter) => letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase());
    fields[0] = flipCase(fields[0].split("/").reverse().join("/"));
    fields[1] = fields[1] === "w" ? "b" : "w";
    fields[2] = flipCase(fields[2]);
    if (fields[3] !== "-") fields[3] = flipUci(fields[3]);
    return { fen: fields.join(" "), pvUci: line.map(flipUci) };
}

for (const mirror of [false, true]) {
    for (const castle of ["e8c8", "e8a8"]) {
        for (const full of [false, true]) {
            test(`checking castle wins the attacked rook, mirror=${mirror}, ${castle}, full=${full}`, () => {
                const row = reflected(castleFen, full ? [castle, "d2e3", "c8b7"] : [castle], mirror);
                const result = classifyPositionTacticalMotifs(row);
                expect(result.motifs[0]).toMatchObject({ id: "doubleThreat", ply: 1, value: 500 });
                expect(result.motifs.some((motif) => ["fork", "discoveredCheck", "discoveredAttack"].includes(motif.id))).toBe(false);
                expect(result.timeline?.some((motif) => motif.id === "doubleThreat" && motif.ply === 1)).toBe(true);
                expect(result.timeline?.some((motif) => motif.ply === 3 && motif.label === "Castling Payoff")).toBe(full);
                expect(result.timeline?.find((motif) => motif.ply === 3 && motif.label === "Castling Payoff")?.value).toBeUndefined();
                const scan = buildLiveTacticalScan({ ...row, depth: 16, engineName: "Fixed public control" });
                expect(scan.motifs[0]?.id).toBe("doubleThreat");
            });
        }
    }
    test(`castling certificates cover every actual reply and both moved pieces, mirror=${mirror}`, () => {
        const row = reflected(castleFen, ["e8c8"], mirror);
        const root = replayTacticalLine(row.fen, row.pvUci)[0];
        const proof = proveCastlingDoubleAttack(root)!;
        expect(proof).toMatchObject({ gain: 500 });
        expect(proof.branches).toHaveLength(7);
        const legalReplies = [...root.after.allDests()].flatMap(([from, tos]) => [...tos].map(to => makeUci({ from, to }))).sort();
        expect(proof.branches.map(branch => branch.replyUci).sort()).toEqual(legalReplies);
        for (const branch of proof.branches) {
            const steps = replayTacticalLine(row.fen, [...row.pvUci, branch.replyUci, branch.captureUci]);
            expect(steps).toHaveLength(3);
            expect(steps[2].capture).toBe(500);
            expect(branch.gain).toBe(500);
        }
        const result = classifyPositionTacticalMotifs(row);
        const evidence = tacticalBoardEvidence(row.fen, row.pvUci, result.motifs[0]);
        const square = (value: string) => mirror ? flipUci(value) : value;
        expect(evidence).toEqual({ square: square("c8"), arrows: [
            { from: square("c8"), to: square("b7") }, { from: square("d8"), to: square("d2") },
        ] });
        const sameCastle = classifyMistakeReviewMotifs({ ...row, playedMoveUci: square("e8a8"), bestMoveUci: row.pvUci[0] });
        expect(sameCastle.missedMotifs).toEqual([]);
    });
    test(`promotion certificate covers capture/noncapture and every promotion role, mirror=${mirror}`, () => {
        const row = reflected(xrayFen, ["d8c8"], mirror);
        const root = replayTacticalLine(row.fen, row.pvUci)[0];
        const proof = proveXRaySupport(root)!;
        expect(proof.promotionBranches).toHaveLength(8);
        const promotions = ["c", "d"].flatMap(file => ["q", "r", "b", "n"].map(role => `d7${file}8${role}`));
        expect(proof.promotionBranches!.map(branch => branch.replyUci).sort())
            .toEqual(promotions.map(move => mirror ? flipUci(move) : move).sort());
        for (const branch of proof.promotionBranches!) {
            const steps = replayTacticalLine(row.fen, [...row.pvUci, branch.replyUci, branch.captureUci]);
            expect(steps).toHaveLength(3);
            expect(steps[1].move.promotion).toBeTruthy();
            expect(steps[2].move.to).toBe(parseUci(branch.replyUci)!.to);
            expect(branch.gain).toBe(branch.replyUci.includes(mirror ? "c1" : "c8") ? 500 : 900);
        }
    });
    test(`short castling cannot borrow an already free Rxh7 capture, mirror=${mirror}`, () => {
        const fen = "r3k2r/p3p2R/6p1/8/4P3/6P1/P4K1P/7R b kq - 0 16";
        const row = reflected(fen, ["e8g8"], mirror);
        expect(replayTacticalLine(row.fen, row.pvUci)).toHaveLength(1);
        expect(proveCastlingDoubleAttack(replayTacticalLine(row.fen, row.pvUci)[0])).toBeNull();
        expect(classifyPositionTacticalMotifs(row).motifs.some(motif => motif.id === "doubleThreat")).toBe(false);
    });
    test(`a nonpromotion check cannot bypass the remaining promotion liability, mirror=${mirror}`, () => {
        const row = reflected(xrayFen.replace("2p1pq2", "2p2q2").replace("3Pb1p1", "3P2p1"), ["d8c8", "e3e8"], mirror);
        const steps = replayTacticalLine(row.fen, row.pvUci);
        expect(steps).toHaveLength(2);
        expect(steps[1].after.isCheck()).toBe(true);
        // This stronger board is deliberately unknown to this bounded proof,
        // not adjudicated as lost: answering the check must also settle Pd7.
        expect(proveXRaySupport(steps[0])).toBeNull();
    });
    for (const promotion of [null, "q", "r", "b", "n"]) {
        test(`promotion-aware x-ray counts exchange compensation, mirror=${mirror}, role=${promotion}`, () => {
            const line = promotion ? ["d8c8", `d7c8${promotion}`, "f5c8"] : ["d8c8"];
            const row = reflected(xrayFen, line, mirror);
            const result = classifyPositionTacticalMotifs(row);
            expect(result.motifs[0]).toMatchObject({ id: "xRayAttack", ply: 1, value: 500 });
            expect(result.motifs.filter((motif) => motif.ply === 1).map((motif) => motif.id)).toEqual(["xRayAttack"]);
            expect(result.timeline?.some((motif) => motif.ply === 3 && motif.id === "hangingPiece")).toBe(false);
            expect(proveXRaySupport(replayTacticalLine(row.fen, row.pvUci)[0])).toMatchObject({ gain: 500 });
        });
    }
    for (const [name, fen] of [
        ["missing victim", castleFen.replace("pR2pp1p", "p3pp1p")],
        ["guarded victim", castleFen.replace("2n3p1", "P1n3p1")],
        ["no check", castleFen.replace("P2K1P1P", "P3KP1P")],
        ["draw claim", castleFen.replace(" - 0 16", " - 99 16")],
    ]) {
        test(`castling is not a material double threat with ${name}, mirror=${mirror}`, () => {
            const row = reflected(fen, ["e8c8"], mirror);
            expect(replayTacticalLine(row.fen, row.pvUci)).toHaveLength(1);
            expect(classifyPositionTacticalMotifs(row).motifs.some((motif) => motif.id === "doubleThreat")).toBe(false);
        });
    }
    for (const [name, fen] of [
        ["missing supporting queen", xrayFen.replace("2p1pq2", "2p1p3")],
        ["unprofitable minor-piece exchange", xrayFen.replace("2Qr1k1r", "2Br1k1r")],
    ]) {
        test(`promotion x-ray abstains with ${name}, mirror=${mirror}`, () => {
            const row = reflected(fen, ["d8c8"], mirror);
            const root = replayTacticalLine(row.fen, row.pvUci)[0];
            expect(root).toBeDefined();
            expect(proveXRaySupport(root)).toBeNull();
            expect(classifyPositionTacticalMotifs(row).motifs.some((motif) => motif.id === "xRayAttack")).toBe(false);
        });
    }
}

test.each([0, 1, -1, NaN, Infinity, 1.5])("special-move proofs abstain on exhausted/invalid budget %s", (budget) => {
    expect(proveCastlingDoubleAttack(replayTacticalLine(castleFen, ["e8c8"])[0], budget)).toBeNull();
    expect(proveXRaySupport(replayTacticalLine(xrayFen, ["d8c8"])[0], budget)).toBeNull();
});
