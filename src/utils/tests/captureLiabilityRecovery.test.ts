import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import { proveCaptureCounterattack, proveDefenderCombination, replayTacticalLine, tacticalBoardEvidence, tacticalCaptureGain } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { classifyMistakeReviewMotifs, classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { forkCountercaptureFen, forkCountercaptureLine } from "./fixtures/forkCountercapture";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import { captureLiabilityInput } from "./fixtures/captureLiabilityRecovery";

const opening = captureLiabilityInput().fen;

test.each([false, true])("a capture can retain its gain by removing an off-square attacker (%s)", reflected => {
    const {fen,pvUci,...context} = captureLiabilityInput(reflected);
    const move = pvUci[0];
    const root = replayTacticalLine(fen, [move])[0];
    const proof = proveCaptureCounterattack(root);
    expect(proof?.gain).toBe(100);
    expect(tacticalCaptureGain(root)).toBe(100);
    expect(proof?.leaves.some(leaf => leaf.moveUci === (reflected ? reflectMixedForkMove("f6h5") : "f6h5"))).toBe(true);
    for (const leaf of proof!.leaves) {
        expect(leaf.lineUci?.length).toBeGreaterThan(0);
        const branch = replayTacticalLine(makeFen(root.after.toSetup()),leaf.lineUci!);
        expect(branch).toHaveLength(leaf.lineUci!.length);
        expect(makeFen(branch.at(-1)!.before.toSetup())).toBe(leaf.fen);
        expect(branch.at(-1)!.uci).toBe(leaf.moveUci);
    }
    const result = classifyPositionTacticalMotifs({fen,pvUci:[move],...context});
    expect(result.motifs[0]).toMatchObject({id:"hangingPiece",label:"Material Gain",ply:1,value:100});
    const scan = buildLiveTacticalScan({fen,pvUci:[move],depth:16,engineName:"Constructed",...context});
    expect(scan.motifs[0]?.label).toBe("Material Gain");
    expect(tacticalBoardEvidence(fen,[move],result.motifs[0])?.arrows).toHaveLength(2);
    const played = reflected ? reflectMixedForkMove("d8e7") : "d8e7";
    const review = classifyMistakeReviewMotifs({fen,bestMoveUci:move,playedMoveUci:played,pvUci:[move],...context});
    expect(review.missedMotifs).toContainEqual(expect.objectContaining({id:"hangingPiece",ply:1,value:100}));
    expect(classifyMistakeReviewMotifs({fen,bestMoveUci:move,playedMoveUci:move,pvUci:[move]}).missedMotifs).toEqual([]);
});

test("recovering a just-captured knight does not turn an equal exchange into a new gain",()=>{
    const input={fen:"rn1q1rk1/5ppp/p3pn2/1pp2bB1/3P4/PBb1PN2/1P3PPP/2RQ1RK1 w - - 0 13",
        previousFen:"rn1q1rk1/5ppp/p3pn2/1pp2bB1/1b1P4/PBN1PN2/1P3PPP/2RQ1RK1 b - - 0 12",
        previousMoveUci:"b4c3",pvUci:["g5f6","d8f6","c1c3"]};
    const root=replayTacticalLine(input.fen,input.pvUci)[0];
    expect(proveCaptureCounterattack(root)).not.toBeNull();
    expect(classifyPositionTacticalMotifs(input).motifs).toEqual([]);
    expect(buildLiveTacticalScan({...input,depth:16,engineName:"Compensated exchange"}).motifs).toEqual([]);
});

test.each([false,true])("missing defensive participants cannot borrow unrelated captures (%s)",reflected=>{
    for (const control of [opening.replace("1B1pp1N1","3pp1N1").replace("3PP3","B2PP3"),opening.replace("2n2n2","2n5")]) {
        const fen = reflected ? reflectMixedForkFen(control) : control;
        const steps = replayTacticalLine(fen,[reflected ? reflectMixedForkMove("c6d4") : "c6d4"]);
        expect(steps).toHaveLength(1);
        const root = steps[0];
        expect(proveCaptureCounterattack(root)).toBeNull();
    }
});

test("the former candidate restriction stops at the queen's concrete mating threat",()=>{
    const root = replayTacticalLine(opening,["c6d4"])[0];
    const proof = proveCaptureCounterattack(root)!;
    const failures: {replyUci:string}[] = [];
    expect(proveDefenderCombination(root,proof.targets,[root.move.to],4096,{nodes:4096},1,true,90,
        undefined,true,failure=>failures.push(failure))).toBeNull();
    expect(failures.at(-1)?.replyUci).toBe("d1h5");
    expect(proof.leaves).toContainEqual(expect.objectContaining({moveUci:"f6h5",quiet:false}));
});

test("liability recovery shares the original budget and cannot pollute cached results",()=>{
    const root = replayTacticalLine(opening,["c6d4"])[0];
    for(const limit of [0,1,100,-1,NaN,Infinity,1.5]) expect(proveCaptureCounterattack(root,limit)).toBeNull();
    const budget = {nodes:4096};
    expect(proveCaptureCounterattack(root,4096,budget)?.gain).toBe(100);
    expect(budget.nodes).toBeGreaterThanOrEqual(0);
    expect(tacticalCaptureGain(root)).toBe(100);
});

test.skipIf(!process.env.TACTICAL_LIABILITY_CAPTURE_REPLAY || !process.env.TACTICAL_LIABILITY_CAPTURE_REPORT)(
    "export changed capture decisions without assuming the initial engine judgement",
    async () => {
        const { privateReportPath } = await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_LIABILITY_CAPTURE_REPORT!);
        expect(existsSync(output)).toBe(false);
        const input = JSON.parse(readFileSync(process.env.TACTICAL_LIABILITY_CAPTURE_REPLAY!, "utf8"));
        const row = input.results.find((row: any) => row.id === process.env.TACTICAL_LIABILITY_CAPTURE_ID);
        expect(row).toBeTruthy();
        const roots = [{id:"owner-opening",root:replayTacticalLine(row.fen,[row.before[0].pvUci[0]])[0]},
            {id:"constructed-opening",root:replayTacticalLine(opening,["c6d4"])[0]},
            {id:"constructed-opening-reflection",root:replayTacticalLine(captureLiabilityInput(true).fen,captureLiabilityInput(true).pvUci)[0]},
            {id:"previously-withheld-checking-flight",root:replayTacticalLine(forkCountercaptureFen.replace("Q1PPP3","Q3P3"),forkCountercaptureLine)[2]}];
        const cases = roots.map(({id,root}) => {
            const budget = {nodes:4096};
            return {id,fen:makeFen(root.before.toSetup()),uci:root.uci,
                proof:proveCaptureCounterattack(root,4096,budget),visits:4096-budget.nodes};
        });
        const probes = cases.flatMap(row => [{id:`${row.id}:root`,fen:row.fen,searchMove:row.uci,expectedSign:1},
            ...(row.proof?.leaves ?? []).flatMap((leaf,i) => [
                {id:`${row.id}:leaf-${i}`,fen:leaf.fen,searchMove:leaf.moveUci,expectedSign:1},
                ...(leaf.counterchecks ?? []).map((reply,j) => ({id:`${row.id}:check-${i}-${j}`,fen:reply.fen,searchMove:reply.moveUci,expectedSign:1})),
            ])]);
        writeFileSync(output,JSON.stringify({scope:"Draft local-proof choices for fresh independent review, not an accuracy claim.",samplePath:process.env.TACTICAL_LIABILITY_CAPTURE_REPLAY,cases,probes},null,2),{flag:"wx"});
        console.log(JSON.stringify({cases:cases.map(({proof,...row})=>({...row,gain:proof?.gain,leaves:proof?.leaves.length})),searches:probes.length}));
    },120000,
);
