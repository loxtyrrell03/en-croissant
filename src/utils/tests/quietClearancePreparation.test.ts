import { expect, test } from "vitest";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import type { NormalMove } from "chessops/types";
import { parseSquare, parseUci } from "chessops/util";
import { proveQuietClearancePreparation, replayTacticalLine, tacticalBoardEvidence } from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import type { QuietClearanceNode } from "../tacticalMotifs/quietClearancePreparation";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

// Public wN37d, output-blind cohort v2. Source labels nominate an audit, not
// its answer. In particular Nb6 has the same apparent geometry but fails.
const initialFen = "8/2R3pp/5p2/4p3/rbNk4/6PP/5PK1/8 w - - 0 44";
const sourceLine = ["c4b2", "a4a1", "c7c4", "d4d5", "c4b4"];
const repairLine = ["c4b2", "b4d6", "c7c6", "d4d5", "c6d6", "d5d6", "b2a4"];
const position = (fen: string) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();

for (const reflected of [false, true]) {
    const flip = (move: string) => reflected ? reflectMixedForkMove(move) : move;
    const fen = reflected ? reflectMixedForkFen(initialFen) : initialFen;
    const root = replayTacticalLine(fen, [flip(sourceLine[0])])[0];

    test(`quiet clearance proves all 24 replies within one fixed budget; reflected=${reflected}`, () => {
        const proof = proveQuietClearancePreparation(root);
        expect(proof).not.toBeNull();
        expect(proof!.gain).toBe(180);
        expect(proof!.visits).toBeLessThanOrEqual(16384);
        expect(proof!.branches).toHaveLength(24);
        expect(proof!.entry).toEqual(parseUci(flip("c7c4")));
        expect(proof!.branches.find(branch => branch.replyUci === flip("a4a1"))!.node)
            .toMatchObject({ moveUci: flip("c7c4"), kind: "check" });
        expect(proof!.branches.find(branch => branch.replyUci === flip("b4d6"))!.node)
            .toMatchObject({ moveUci: flip("c7c6"), kind: "repair" });
        const replyCounts: [number, number][] = [], leaves: boolean[] = [], reached: [string, string][] = [];
        const verify = (node: QuietClearanceNode) => {
            const board = position(node.fen), move = parseUci(node.moveUci) as NormalMove;
            expect(board.isLegal(move)).toBe(true);
            board.play(move);
            if (node.replies) {
                replyCounts.push([[...board.allDests()].reduce((sum, [, destinations]) => sum + destinations.size(), 0),
                    node.replies.length]);
                for (const branch of node.replies) {
                    const next = board.clone(), reply = parseUci(branch.replyUci)!;
                    if (!next.isLegal(reply)) throw new Error(`Illegal certificate reply ${branch.replyUci}`);
                    next.play(reply);
                    reached.push([makeFen(next.toSetup()), branch.node.fen]);
                    verify(branch.node);
                }
            } else leaves.push(board.isCheck());
        };
        proof!.branches.forEach(branch => verify(branch.node));
        expect(replyCounts.length).toBeGreaterThan(0);
        expect(leaves.length).toBeGreaterThan(24);
        replyCounts.forEach(([legal, proved]) => expect(proved).toBe(legal));
        reached.forEach(([actual, claimed]) => expect(claimed).toBe(actual));
        expect(leaves.every(checked => !checked)).toBe(true);
    });

    for (const line of [[sourceLine[0]], sourceLine, repairLine])
        test(`root and supplied branches preserve the initiating mechanism; plies=${line.length}, reflected=${reflected}`, () => {
            const input = { fen, pvUci: line.map(flip) };
            const result = classifyPositionTacticalMotifs(input);
            expect(result.motifs[0]).toMatchObject({ id: "clearance", label: "Clearance Preparation", ply: 1,
                moveUci: flip("c4b2"), value: 180, verifiedCombination: true });
            expect(result.motifs.filter(motif => motif.ply === 1).map(motif => motif.id)).not.toContain("fork");
            expect(result.motifs[0].evidence).toContain("bounded material");
        });

    test(`live evidence stays on the initiating knight rather than a future fork; reflected=${reflected}`, () => {
        const input = { fen, pvUci: sourceLine.map(flip) };
        const motif = classifyPositionTacticalMotifs(input).motifs[0];
        expect(tacticalBoardEvidence(fen, input.pvUci, motif)).toEqual({
            square: flip("c4"), arrows: [{ from: flip("c4"), to: flip("b2") }],
        });
        expect(buildLiveTacticalScan({ ...input, depth: 16, engineName: "Public proof control" }).motifs[0])
            .toMatchObject({ id: "clearance", ply: 1, value: 180 });
    });

    test(`Nb6 cannot hide Rxb6 behind a checking sacrifice; reflected=${reflected}`, () => {
        const contrary = replayTacticalLine(fen, ["c4b6", "b4d6", "c7c6", "a4a6", "c6d6", "d4c5"].map(flip));
        expect(contrary).toHaveLength(6);
        const after = contrary[5].after.clone();
        after.turn = contrary[0].after.turn;
        expect(after.isLegal(parseUci(flip("a6b6"))!)).toBe(true);
        expect(proveQuietClearancePreparation(contrary[0])).toBeNull();
        expect(classifyPositionTacticalMotifs({ fen, pvUci: [flip("c4b6")] }).motifs
            .filter(motif => motif.label === "Clearance Preparation")).toEqual([]);
    });

    for (const square of ["a4", "b4", "c7"])
        test(`missing participant ${square} cannot borrow another attack; reflected=${reflected}`, () => {
            const board = position(fen);
            board.board.take(parseSquare(flip(square))!);
            const step = replayTacticalLine(makeFen(board.toSetup()), [flip("c4b2")])[0];
            expect(proveQuietClearancePreparation(step)).toBeNull();
        });

    test(`an unrelated quiet move cannot borrow the already open route; reflected=${reflected}`, () => {
        const board = root.after.clone();
        board.turn = root.before.turn;
        const step = replayTacticalLine(makeFen(board.toSetup()), [flip("g2f1")])[0];
        expect(step).toBeDefined();
        expect(proveQuietClearancePreparation(step)).toBeNull();
    });

    test(`clock claims and malformed or exhausted proof requests abstain; reflected=${reflected}`, () => {
        for (const clock of [98, 99, 100, 149, 150]) {
            const board = position(fen);
            board.halfmoves = clock;
            expect(proveQuietClearancePreparation(replayTacticalLine(makeFen(board.toSetup()), [flip("c4b2")])[0])).toBeNull();
        }
        for (const limit of [0, 1, 30, -1, NaN, Infinity, 16385])
            expect(proveQuietClearancePreparation(root, limit)).toBeNull();
        const mismatched = { ...root, after: root.before };
        expect(proveQuietClearancePreparation(mismatched)).toBeNull();
    });

    test(`mutating a returned certificate cannot poison cached classification; reflected=${reflected}`, () => {
        const original = proveQuietClearancePreparation(root)!;
        const altered = proveQuietClearancePreparation(root)!;
        altered.gain = 900;
        altered.entry.to = parseSquare(flip("h8"))!;
        altered.branches[0].node.moveUci = "a1a8";
        altered.branches.splice(1);
        expect(proveQuietClearancePreparation(root)).toEqual(original);
        expect(classifyPositionTacticalMotifs({ fen, pvUci: [flip("c4b2")] }).motifs[0].value).toBe(180);
    });
}
