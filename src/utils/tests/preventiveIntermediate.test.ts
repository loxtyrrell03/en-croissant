import { writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { provePreventiveIntermediateCapture, intermediateCaptureProof, replayTacticalLine, proveDefenderCombination } from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs, classifyMistakeReviewMotifs, buildMistakeReviewTacticalExplanation } from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import { preventiveIntermediateFen as fen, preventiveIntermediateCases, preventiveIntermediateInputs, preventiveIntermediateLine } from "./fixtures/preventiveIntermediate";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { parseSquare } from "chessops/util";
import { makeFen } from "chessops/fen";

test.each([false,true])("a checking equal exchange prevents a defensive fork: reflected=%s", reflected => {
    const board = reflected ? reflectMixedForkFen(fen) : fen;
    const move = reflected ? reflectMixedForkMove("h5f3") : "h5f3";
    const root = replayTacticalLine(board,[move])[0];
    expect(provePreventiveIntermediateCapture(root)).toMatchObject({gain:490});
    expect(intermediateCaptureProof(root)).toMatchObject({gain:490});
    expect(classifyPositionTacticalMotifs({fen:board,pvUci:[move]}).motifs[0]).toMatchObject({id:"intermezzo",ply:1,value:490});
});

test("inspect constructed positives and contrary controls", () => {
    const cases = preventiveIntermediateCases.map(row => { const root = replayTacticalLine(row.fen,["h5f3"])[0];
        const leaves: any[] = [];
        return {...row,proof:provePreventiveIntermediateCapture(root,16384,(kind,leaf)=>leaves.push({kind,...leaf})),leaves}; });
    if(process.env.TACTICAL_PREVENTIVE_INTERMEDIATE_REPORT)
        writeFileSync(process.env.TACTICAL_PREVENTIVE_INTERMEDIATE_REPORT,JSON.stringify(cases,null,2),{flag:"wx"});
    expect(cases[0].proof).not.toBeNull();
    for (const row of cases) expect({id:row.id,proved:!!row.proof}).toEqual({id:row.id,proved:row.positive});
});

test.each(preventiveIntermediateInputs().slice(0,14))("root-only public control $id", input => {
    const proof = provePreventiveIntermediateCapture(replayTacticalLine(input.fen,input.pvUci)[0]);
    expect(!!proof).toBe(input.positive);
    expect(classifyPositionTacticalMotifs(input).motifs.some(motif => motif.id === "intermezzo")).toBe(input.positive);
});

test("one equal exchange is checked against every decline, not assumed compulsory", () => {
    const fork = replayTacticalLine(fen,["c3a1","g2g4"])[1];
    const targets = [parseSquare("f5")!,parseSquare("h5")!], capturers = [parseSquare("g4")!];
    expect(proveDefenderCombination(fork,targets,capturers,16384,undefined,1,true,90,undefined,true,undefined,true)).toBeNull();
    expect(proveDefenderCombination(fork,targets,capturers,16384,undefined,1,true,90,undefined,true,undefined,true,1)).toBeGreaterThanOrEqual(90);
    for (const limit of [-1,0.5,2])
        expect(proveDefenderCombination(fork,targets,capturers,16384,undefined,1,true,90,undefined,true,undefined,true,limit)).toBeNull();
});

test("incomplete budgets cannot reuse the full proof", () => {
    const root = replayTacticalLine(fen,["h5f3"])[0];
    expect(provePreventiveIntermediateCapture(root)).not.toBeNull();
    for (const budget of [0,-1,0.5,1,20]) expect(provePreventiveIntermediateCapture(root,budget)).toBeNull();
    expect(intermediateCaptureProof(root,1)).toBeNull();
});

test.each([false,true])("blocking the check is not proof that the rook loss was prevented: reflected=%s", reflected => {
    const before = fen.replace("6P1", "P5P1").replace(" b ", " w ");
    const flip = (move: string) => reflected ? reflectMixedForkMove(move) : move;
    const review = classifyMistakeReviewMotifs({fen:reflected ? reflectMixedForkFen(before) : before,
        playedMoveUci:flip("a2a3"),bestMoveUci:flip("g2g4"),pvUci:[flip("g2g4"),flip("c3a1")],
        refutationUci:preventiveIntermediateLine.map(flip)});
    const motif = review.allowedMotifs.find(motif => motif.id === "intermezzo");
    expect(motif).toBeDefined();
    expect(motif?.comparison).not.toBe("prevented");
    expect(buildMistakeReviewTacticalExplanation(review)?.title).not.toBe("Why the move was tactically bad");
});

test.each([false,true])("the real check is primary; the hypothetical fork is not drawn: reflected=%s", reflected => {
    const flip = (move: string) => reflected ? reflectMixedForkMove(move) : move;
    const input = {fen:reflected ? reflectMixedForkFen(fen) : fen,pvUci:preventiveIntermediateLine.map(flip),depth:18,engineName:"Constructed"};
    const scan = buildLiveTacticalScan(input);
    expect(scan.motifs[0]).toMatchObject({id:"intermezzo",ply:1});
    expect(scan.arrows.map(arrow => arrow.from+arrow.to)).toEqual([flip("h5f3"),flip("c3a1")]);
    expect(scan.labels[0].text).toBe("Intermediate Check");
    expect(scan.variations[0].timeline.some(motif => motif.id === "fork")).toBe(false);
    const review = classifyMistakeReviewMotifs({fen:input.fen,playedMoveUci:flip("h5g6"),bestMoveUci:input.pvUci[0],pvUci:input.pvUci,refutationUci:[flip("a1a2")]});
    expect(review.missedMotifs.some(motif => motif.id === "intermezzo")).toBe(true);
    expect(buildMistakeReviewTacticalExplanation(review)?.primary.id).toBe("intermezzo");
    const played = classifyMistakeReviewMotifs({fen:input.fen,playedMoveUci:input.pvUci[0],bestMoveUci:input.pvUci[0],pvUci:input.pvUci,refutationUci:input.pvUci.slice(1)});
    expect(played.missedMotifs.some(motif => motif.id === "intermezzo")).toBe(false);
});

test.each([false,true])("a preceding rook loss cannot fund a new intermediate gain, but settled trades can: reflected=%s", reflected => {
    const flip=(move:string)=>reflected?reflectMixedForkMove(move):move;
    for (const settled of [false,true]) {
        const start=settled?fen.replace("6P1","r5P1").replace("R2K4","R1RK4"):
            fen.replace("R2K4","r1RK4").replace(" b "," w ");
        const before=reflected?reflectMixedForkFen(start):start;
        const moves=(settled?["a2a1","c1a1"]:["c1a1"]).map(flip);
        const frames=replayTacticalLine(before,moves);expect(frames).toHaveLength(moves.length);
        const previous=frames.at(-1)!;
        const result=classifyPositionTacticalMotifs({fen:makeFen(previous.after.toSetup()),
            pvUci:preventiveIntermediateLine.map(flip),previousFen:makeFen(previous.before.toSetup()),
            previousMoveUci:previous.uci,tacticalHistory:{fen:before,moves}});
        expect(result.motifs.find(motif=>motif.id==="intermezzo")?.value).toBe(settled?490:0);
        expect((result.timeline??[]).some(motif=>motif.id==="hangingPiece")).toBe(false);
    }
});

test.each([false,true])("an alternative queen exchange cannot invent profit from a delayed rook recapture: reflected=%s", reflected => {
    const start="2k5/3q1r1p/8/8/Q6N/5R2/7P/7K b - - 0 1";
    const flip=(move:string)=>reflected?reflectMixedForkMove(move):move;
    const before=reflected?reflectMixedForkFen(start):start;
    const previous=replayTacticalLine(before,[flip("f7f3")])[0];expect(previous).toBeDefined();
    const pvUci=["a4a6","d7b7","a6b7","c8b7","h4f3"].map(flip);
    const current=makeFen(previous.after.toSetup());
    expect(replayTacticalLine(current,pvUci)).toHaveLength(5);
    const result=classifyPositionTacticalMotifs({fen:current,pvUci,previousFen:before,previousMoveUci:previous.uci,
        tacticalHistory:{fen:before,moves:[previous.uci]}});
    expect(result.motifs).toEqual([]);
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline?.[0]).toMatchObject({id:"intermezzo",ply:3,value:0,relevance:"secondary"});
    expect(result.timeline?.[0].evidence).toContain("not a fresh material win");
});
