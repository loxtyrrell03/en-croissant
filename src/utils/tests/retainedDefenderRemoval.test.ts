import { expect, test } from "vitest";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseSquare } from "chessops/util";
import { replayTacticalLine, tacticalBoardEvidence, tacticalExchangeGain } from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs, classifyMistakeReviewMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

const previous = "r1b2r2/pp4bk/1q1Qp2p/4ppp1/8/2P2NP1/PP2PPBP/1R1R2K1 w - - 2 19";
for (const reflected of [false, true]) {
    const flip = (value: string) => reflected ? reflectMixedForkMove(value) : value;
    const previousFen = reflected ? reflectMixedForkFen(previous) : previous;
    const previousMoveUci = flip("f3e5");
    const fen = makeFen(replayTacticalLine(previousFen, [previousMoveUci])[0].after.toSetup());
    const pvUci = ["b6d6", "d1d6", "g7e5"].map(flip);
    const context = { previousFen, previousMoveUci, tacticalHistory: { fen: previousFen, moves: [previousMoveUci] } };
    test(`accepted defender exchange is causal, not either pawn skewer; reflected=${reflected}`, () => {
        for (const length of [1, 3]) {
            const result = classifyPositionTacticalMotifs({ fen, pvUci: pvUci.slice(0, length) });
            expect(result.motifs[0]).toMatchObject({ id: "capturingDefender", label: "Removing the Defender", value: 320, ply: 1 });
            expect(result.motifs.some(m => m.id === "skewer")).toBe(false);
            expect(result.motifs[0].evidence).toContain("Declining permits connected captures or safe retention instead");
        }
        const before = replayTacticalLine(fen, [flip("g7e5")])[0];
        expect(tacticalExchangeGain(before.before, before.move)).toBe(-10);
        const accepted = replayTacticalLine(fen, pvUci)[2];
        expect(tacticalExchangeGain(accepted.before, accepted.move)).toBe(320);
    });
    test(`exact prior pawn debt and the collected knight are counted once; reflected=${reflected}`, () => {
        for (const length of [1, 3]) {
            const result = classifyPositionTacticalMotifs({ fen, pvUci: pvUci.slice(0, length), ...context });
            expect(result.motifs[0]).toMatchObject({ id: "capturingDefender", value: 220, ply: 1 });
            expect(result.motifs[0].evidence).toContain("local material bound is 2.2 pawns");
        }
        const result = classifyPositionTacticalMotifs({ fen, pvUci, ...context });
        const payoff = result.timeline?.find(m => m.ply === 3 && m.moveUci === pvUci[2]);
        expect(payoff).toMatchObject({ label: "Countercapture Payoff" });
        expect(payoff?.value).toBeUndefined();
        const mismatched = { ...context, previousMoveUci: flip("f3d4"), tacticalHistory: undefined };
        expect(classifyPositionTacticalMotifs({ fen, pvUci, ...mismatched }).motifs[0])
            .toMatchObject({ id: "capturingDefender", value: 320 });
    });
    test(`new removal needs the real collector and actual legal guard improvement; reflected=${reflected}`, () => {
        for (const kind of ["missing-bishop", "second-guard"]) {
            const board = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
            if (kind === "missing-bishop") board.board.take(parseSquare(flip("g7"))!);
            else board.board.set(parseSquare(flip("f4"))!, { role: "pawn", color: board.turn === "white" ? "black" : "white" });
            const result = classifyPositionTacticalMotifs({ fen: makeFen(board.toSetup()), pvUci: [pvUci[0]] });
            expect(result.motifs.some(m => m.id === "capturingDefender")).toBe(false);
        }
    });
    test(`root live arrows explain removal, not rear-pawn captures; reflected=${reflected}`, () => {
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(tacticalBoardEvidence(fen, pvUci, result.motifs[0])).toEqual({
            square: flip("d6"), arrows: [{ from: flip("d6"), to: flip("e5") }, { from: flip("g7"), to: flip("e5") }],
        });
        const scan = buildLiveTacticalScan({ fen, pvUci, depth: 16, engineName: "Public guarded-knight contrast" });
        expect(scan.motifs[0]).toMatchObject({ id: "capturingDefender", value: 320 });
        expect(scan.arrows.map(a => a.from + a.to)).toEqual([flip("b6d6"), flip("d6e5"), flip("g7e5")]);
    });
    test(`reversed collection misses the verified removal without inventing pawn skewers; reflected=${reflected}`, () => {
        const result = classifyMistakeReviewMotifs({ fen, ...context, bestMoveUci: pvUci[0],
            pvUci, playedMoveUci: flip("g7e5"), refutationUci: [flip("d6e5")] });
        expect(result.missedMotifs.find(m => m.id === "capturingDefender"))
            .toMatchObject({ label: "Removing the Defender", value: 220, ply: 1 });
        expect(result.missedMotifs.some(m => m.id === "skewer")).toBe(false);
    });
}
