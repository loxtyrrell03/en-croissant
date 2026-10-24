import { expect, test } from "vitest";
import { Chess } from "chessops/chess";
import { attacks } from "chessops/attacks";
import { makeFen, parseFen } from "chessops/fen";
import { parseSquare, parseUci } from "chessops/util";
import {
    proveTrappedMaterial, replayTacticalLine, tacticalBoardEvidence,
} from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

// Public Xg7Rd; hypotheses and the complete legal reply set were frozen before
// changing production. This is a local material certificate, not an evaluation.
const trapConfinementFen = "r3kb1r/2B2ppp/p4n2/n7/6b1/2P1P3/PP1N1PpP/R3KB1R w KQkq - 0 13";
const line = ["f1g2", "a8c8", "c7a5"];
const position = (fen: string) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();

for (const mirrored of [false, true]) {
    const flip = (uci: string) => mirrored ? reflectMixedForkMove(uci) : uci;
    const fen = mirrored ? reflectMixedForkFen(trapConfinementFen) : trapConfinementFen;
    const target = parseSquare(mirrored ? "a4" : "a5")!;
    const root = replayTacticalLine(fen, [flip(line[0])])[0];

    test(`closing former safe flights proves the separate attacked knight; mirrored=${mirrored}`, () => {
        const proof = proveTrappedMaterial(root, target);
        expect(proof?.branches).toHaveLength(34);
        expect(proof?.gain).toBe(320);
        expect(proof!.recoveryVisits).toBeLessThanOrEqual(4096);
        for (const reply of ["g4f3", "g4h3"]) {
            const branch = proof!.branches.find(b => b.replyUci === flip(reply));
            expect((reply === "g4f3" ? ["g2f3", "d2f3"] : ["g2h3"]).map(flip)).toContain(branch?.answerUci);
            expect(branch?.gain).toBe(430);
        }
        const guard = proof!.branches.find(b => b.replyUci === flip("f8b4"));
        expect(guard?.answerUci).toBe(flip("c3b4"));
    });

    for (const length of [1, 3]) test(`root and full evidence identify confinement, not promotion; length=${length}, mirrored=${mirrored}`, () => {
        const result = classifyPositionTacticalMotifs({ fen, pvUci: line.slice(0, length).map(flip) });
        expect(result.motifs[0]).toMatchObject({ id: "trappedPiece", label: "Trapped Knight", ply: 1, value: 320 });
        expect(result.motifs[0].evidence).toContain("escape");
        expect(result.motifs.map(m => m.id)).not.toContain("promotionThreat");
    });

    test(`board evidence shows the actual attacker and the new flight guards; mirrored=${mirrored}`, () => {
        const result = classifyPositionTacticalMotifs({ fen, pvUci: [flip(line[0])] });
        expect(result.motifs[0]?.id).toBe("trappedPiece");
        const board = result.motifs[0] && tacticalBoardEvidence(fen, [flip(line[0])], result.motifs[0]);
        expect(board).toEqual({ square: mirrored ? "a4" : "a5", arrows: [
            { from: flip("c7"), to: flip("a5") },
            { from: flip("g2"), to: flip("b7") },
            { from: flip("g2"), to: flip("c6") },
        ] });
    });

    test(`removing the knight guard permits a genuine safe escape; mirrored=${mirrored}`, () => {
        const board = position(fen);
        board.board.take(parseSquare(flip("d2"))!);
        const changed = makeFen(board.toSetup());
        const escaped = replayTacticalLine(changed, [flip("f1g2"), flip("a5c4")]);
        expect(escaped).toHaveLength(2);
        const after = escaped[1].after;
        expect([...after.board[root.before.turn]].some(from =>
            attacks(after.board.get(from)!, from, after.board.occupied).has(parseSquare(flip("c4"))!))).toBe(false);
        expect(proveTrappedMaterial(escaped[0], target)).toBeNull();
        expect(classifyPositionTacticalMotifs({ fen: changed, pvUci: [flip(line[0])] }).motifs.map(m => m.id)).not.toContain("trappedPiece");
    });

    test(`a move cannot borrow a trap whose flights were already closed; mirrored=${mirrored}`, () => {
        const changed = makeFen(root.after.toSetup()).replace(mirrored ? " w " : " b ", mirrored ? " b " : " w ");
        const quiet = flip("e1f1");
        expect(position(changed).isLegal(parseUci(quiet)!)).toBe(true);
        expect(classifyPositionTacticalMotifs({ fen: changed, pvUci: [quiet] }).motifs.map(m => m.id)).not.toContain("trappedPiece");
    });

    test(`capturing an unrelated counterattacker cannot fund this trap; mirrored=${mirrored}`, () => {
        const board = position(fen);
        board.board.set(parseSquare(flip("b2"))!, { color: root.before.turn, role: "queen" });
        const changed = makeFen(board.toSetup());
        const entry = replayTacticalLine(changed, [flip(line[0])])[0];
        // ...Ba3 attacks Qb2, not Bc7 or the newly placed flight guard Bg2.
        // Qxa3 may win material, but it is not this bounded trap certificate.
        const failures: string[] = [];
        expect(proveTrappedMaterial(entry, target, 256, 8, reason => failures.push(reason))).toBeNull();
        expect(failures.length).toBe(1);
        expect(classifyPositionTacticalMotifs({ fen: changed, pvUci: [flip(line[0])] }).motifs.map(m => m.id)).not.toContain("trappedPiece");
    });

    test(`missing attacker and exhausted budgets abstain; mirrored=${mirrored}`, () => {
        expect(proveTrappedMaterial(root, target, 0)).toBeNull();
        expect(proveTrappedMaterial(root, target, 1)).toBeNull();
        const board = position(fen);
        board.board.take(parseSquare(flip("c7"))!);
        expect(classifyPositionTacticalMotifs({ fen: makeFen(board.toSetup()), pvUci: [flip(line[0])] }).motifs.map(m => m.id)).not.toContain("trappedPiece");
    });
}
