import { expect, test } from "vitest";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseSquare, parseUci } from "chessops/util";
import { intermediateCaptureProof, proveQuietIntermediateCapture, replayTacticalLine, tacticalBoardEvidence } from "../tacticalMotifs/causalTactics";
import { buildMistakeReviewTacticalExplanation, classifyMistakeReviewMotifs, classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import { quietIntermediateLine, quietIntermediatePreviousFen, quietIntermediatePreviousMove } from "./fixtures/quietIntermediate";

const position = (fen: string) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
const legalMoves = (board: Chess) => [...board.allDests()].flatMap(([from, dests]) =>
    [...dests].map(to => makeUci({ from, to }))).sort();

for (const reflected of [false, true]) {
    const flip = (uci: string) => reflected ? reflectMixedForkMove(uci) : uci;
    const previousFen = reflected ? reflectMixedForkFen(quietIntermediatePreviousFen) : quietIntermediatePreviousFen;
    const previousMoveUci = flip(quietIntermediatePreviousMove);
    const fen = makeFen(replayTacticalLine(previousFen, [previousMoveUci])[0].after.toSetup());
    const pvUci = quietIntermediateLine.map(flip);
    const root = replayTacticalLine(fen, pvUci)[0];

    test(`both orders bind their own material baseline and every legal reply; reflected=${reflected}`, () => {
        const proof = proveQuietIntermediateCapture(root)!;
        expect(proof).toMatchObject({ gain: 230, recovery: 330, extra: 230, reversedUpper: 0 });
        expect(proof.visits).toBeLessThanOrEqual(16384);
        expect(proof.collectionLeaves).toHaveLength(31);
        expect(proof.recoveryLeaves).toHaveLength(31);
        expect(proof.collectionLeaves.map(leaf => leaf.lineUci![0]).sort()).toEqual(legalMoves(root.after));
        const reversed = replayTacticalLine(fen, [makeUci(proof.deferred), makeUci(proof.escape)])[1];
        expect(proof.recoveryLeaves.map(leaf => leaf.lineUci![0]).sort()).toEqual(legalMoves(reversed.after));
        for (const leaf of [...proof.collectionLeaves, ...proof.recoveryLeaves]) {
            const step = replayTacticalLine(leaf.fen, [leaf.moveUci])[0];
            expect(step).toBeDefined();
            expect(step.after.isCheck()).toBe(false);
            for (const answer of leaf.counterchecks ?? []) {
                const counter = replayTacticalLine(answer.fen, [answer.moveUci])[0];
                expect(counter).toBeDefined();
                expect(counter.after.isCheck()).toBe(false);
            }
        }
        expect(intermediateCaptureProof(root)).toBeNull(); // checking path is not loosened
    });

    for (const length of [1, 3]) test(`quiet intermediate capture owns the root, not a false pin; plies=${length}, reflected=${reflected}`, () => {
        const result = classifyPositionTacticalMotifs({ fen, pvUci: pvUci.slice(0, length) });
        expect(result.motifs[0]).toMatchObject({ id: "intermezzo", label: "Intermediate Capture", ply: 1, value: 230 });
        expect(result.motifs.map(motif => motif.id)).not.toContain("pin");
        expect(result.motifs[0].evidence).not.toContain("with check");
        expect(result.motifs[0].evidence).toContain("not a forced reply");
    });

    test(`exact prior rook debt preserves ordering without a fresh profit or payoff; reflected=${reflected}`, () => {
        const result = classifyPositionTacticalMotifs({ fen, pvUci, previousFen, previousMoveUci,
            tacticalHistory: { fen: previousFen, moves: [previousMoveUci] } });
        expect(result.motifs[0]).toMatchObject({ id: "intermezzo", ply: 1, value: 0 });
        expect(result.motifs[0].evidence).toContain("earlier loss is 500");
        expect(result.motifs[0].evidence).toContain("-270");
        expect([...(result.timeline ?? []), ...result.motifs].filter(motif => motif.id === "hangingPiece")).toEqual([]);
    });

    test(`mismatched previous history cannot impose unrelated debt; reflected=${reflected}`, () => {
        const wrong = previousFen.replace("0 19", "2 19");
        const changed = position(wrong);
        changed.board.take(parseSquare(flip("a8"))!);
        const result = classifyPositionTacticalMotifs({ fen, pvUci, previousFen: makeFen(changed.toSetup()), previousMoveUci });
        expect(result.motifs[0]).toMatchObject({ id: "intermezzo", value: 230 });
    });

    test(`source recapture is neither compulsory nor always legal; reflected=${reflected}`, () => {
        const proof = proveQuietIntermediateCapture(root)!;
        const checked = replayTacticalLine(fen, [flip("d5e6"), flip("c1d2")])[1].after;
        expect(checked.isCheck()).toBe(true);
        expect(checked.isLegal(parseUci(flip("c2c1"))!)).toBe(false);
        expect(proof.collectionLeaves.find(leaf => leaf.lineUci![0] === flip("c1d2"))!.lineUci)
            .toContain(flip("f3d2"));
        const poison = proof.collectionLeaves.find(leaf => leaf.lineUci![0] === flip("a5a3"))!;
        expect(poison.moveUci).not.toBe(flip("c2c1"));
        expect(replayTacticalLine(fen, ["d5e6", "a5a3", "c2c1", "a3c1"].map(flip))).toHaveLength(4);
    });

    test(`removing Rc8 preserves quiet retention; it is not a required target; reflected=${reflected}`, () => {
        const board = position(fen);
        board.board.take(parseSquare(flip("c8"))!);
        const changed = makeFen(board.toSetup());
        expect(proveQuietIntermediateCapture(replayTacticalLine(changed, [pvUci[0]])[0])?.gain).toBe(230);
        expect(classifyPositionTacticalMotifs({ fen: changed, pvUci }).motifs[0]?.id).toBe("intermezzo");
    });

    for (const square of ["c1", "e6"])
        test(`missing ${square} cannot manufacture the move-order mechanism; reflected=${reflected}`, () => {
            const board = position(fen);
            board.board.take(parseSquare(flip(square))!);
            const step = replayTacticalLine(makeFen(board.toSetup()), [pvUci[0]])[0];
            expect(proveQuietIntermediateCapture(step)).toBeNull();
        });

    test(`off-square queen liability is not ignored; reflected=${reflected}`, () => {
        const board = position(fen);
        board.board.set(parseSquare(flip("c3"))!, { role: "rook", color: root.after.turn });
        expect(proveQuietIntermediateCapture(replayTacticalLine(makeFen(board.toSetup()), [pvUci[0]])[0])).toBeNull();
    });

    test(`an independently free capture is not renamed as a near-equal intermediate exchange; reflected=${reflected}`, () => {
        const board = position(fen);
        board.board.take(parseSquare(flip("f7"))!);
        expect(proveQuietIntermediateCapture(replayTacticalLine(makeFen(board.toSetup()), [pvUci[0]])[0])).toBeNull();
    });

    test(`checking instead does not alone prove the quiet opponent combination was prevented; reflected=${reflected}`, () => {
        const before = position(fen);
        before.turn = root.after.turn;
        const review = classifyMistakeReviewMotifs({ fen: makeFen(before.toSetup()),
            playedMoveUci: flip("a8b8"), bestMoveUci: flip("a5c3"),
            pvUci: ["a5c3", "c2c3"].map(flip), refutationUci: pvUci });
        const allowed = review.allowedMotifs.find(motif => motif.id === "intermezzo");
        expect(allowed).toBeDefined();
        expect(allowed?.comparison).toBeUndefined();
    });

    test(`the real move and deferred capture are shown, not an invented check; reflected=${reflected}`, () => {
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(tacticalBoardEvidence(fen, pvUci, result.motifs[0])).toEqual({
            square: flip("e6"), arrows: [{ from: flip("c2"), to: flip("c1") }],
        });
        const scan = buildLiveTacticalScan({ fen, pvUci, depth: 16, engineName: "Public order control" });
        expect(scan.motifs[0]).toMatchObject({ id: "intermezzo", label: "Intermediate Capture", value: 230 });
        expect(scan.arrows.map(arrow => arrow.from + arrow.to)).toEqual([flip("d5e6"), flip("c2c1")]);
    });

    test(`reverse played order misses the lesson but not a fictitious free bishop; reflected=${reflected}`, () => {
        const review = classifyMistakeReviewMotifs({ fen, previousFen, previousMoveUci,
            tacticalHistory: { fen: previousFen, moves: [previousMoveUci] },
            bestMoveUci: pvUci[0], playedMoveUci: flip("c2c1"), pvUci, refutationUci: [flip("e6d5")] });
        expect(review.missedMotifs.find(motif => motif.id === "intermezzo"))
            .toMatchObject({ label: "Intermediate Capture", value: 0 });
        expect(buildMistakeReviewTacticalExplanation(review)?.primary.id).toBe("intermezzo");
    });

    test(`automatic terminal roots, incomplete budgets and forged children abstain; reflected=${reflected}`, () => {
        for (const budget of [0, 1, 20, -1, 0.5, Infinity, 16385])
            expect(proveQuietIntermediateCapture(root, budget)).toBeNull();
        const board = position(fen);
        board.halfmoves = 150;
        expect(proveQuietIntermediateCapture(replayTacticalLine(makeFen(board.toSetup()), [pvUci[0]])[0])).toBeNull();
        expect(proveQuietIntermediateCapture({ ...root, after: root.before })).toBeNull();
        // An optional fifty-move claim does not invalidate an attacker's
        // actual capture, which resets the reversible clock immediately.
        board.halfmoves = 100;
        expect(proveQuietIntermediateCapture(replayTacticalLine(makeFen(board.toSetup()), [pvUci[0]])[0])?.gain).toBe(230);
    });

    test(`external mutations cannot poison cached proof or leaf evidence; reflected=${reflected}`, () => {
        const before = proveQuietIntermediateCapture(root)!;
        const changed = proveQuietIntermediateCapture(root)!;
        changed.gain = 900;
        changed.deferred.to = parseSquare(flip("h8"))!;
        changed.collectionLeaves[0].moveUci = "a1a8";
        expect(proveQuietIntermediateCapture(root)).toEqual(before);
    });
}

for (const reflected of [false, true]) {
    const flip = (uci: string) => reflected ? reflectMixedForkMove(uci) : uci;
    const source = "r4rk1/pp3pp1/2nb1n1p/3p4/3P2q1/2NBBQ2/PP3PPP/R3R1K1 w - - 2 15";
    const previousFen = reflected ? reflectMixedForkFen(source) : source;
    const previousMoveUci = flip("c3d5");
    const fen = makeFen(replayTacticalLine(previousFen, [previousMoveUci])[0].after.toSetup());
    const pvUci = ["g4f3", "g2f3", "f6d5"].map(flip);
    test(`independent Qq0JW pawn debt and deferred payoff are not double counted; reflected=${reflected}`, () => {
        expect(classifyPositionTacticalMotifs({ fen, pvUci }).motifs[0])
            .toMatchObject({ id: "intermezzo", label: "Intermediate Capture", value: 320 });
        const result = classifyPositionTacticalMotifs({ fen, pvUci, previousFen, previousMoveUci,
            tacticalHistory: { fen: previousFen, moves: [previousMoveUci] } });
        expect(result.motifs[0]).toMatchObject({ id: "intermezzo", value: 220 });
        const payoff = result.timeline?.find(motif => motif.ply === 3 && motif.moveUci === pvUci[2]);
        expect(payoff).toMatchObject({ label: "Intermediate Capture Payoff" });
        expect(payoff?.value).toBeUndefined();
    });
    test(`EpYOT reversed queen capture cannot hide its legal pawn recapture; reflected=${reflected}`, () => {
        const original = "r1b2r2/pp4bk/1q1Qp2p/4Npp1/8/2P3P1/PP2PPBP/1R1R2K1 b - - 0 19";
        const positionFen = reflected ? reflectMixedForkFen(original) : original;
        const reversed = replayTacticalLine(positionFen, ["g7e5", "d6b6", "a7b6"].map(flip));
        expect(reversed).toHaveLength(3);
        expect(reversed[1].capture).toBe(900);
        expect(reversed[2].capture).toBe(900);
        expect(proveQuietIntermediateCapture(replayTacticalLine(positionFen, [flip("b6d6")])[0])).toBeNull();
    });
}
