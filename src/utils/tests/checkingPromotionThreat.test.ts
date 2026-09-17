import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import { provePromotionThreat, promotionThreatContinuations, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { buildMistakeReviewTacticalExplanation, classifyMistakeReviewMotifs, classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { checkingPromotionThreatCases, checkingPromotionThreatFen } from "./fixtures/checkingPromotionThreat";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

const cases = checkingPromotionThreatCases.flatMap(row=>[row,{...row,id:`${row.id}:reflected`,
    fen:reflectMixedForkFen(row.fen),move:reflectMixedForkMove(row.move)}]);

test.each(cases)("promotion through checks: $id",row=>{
    const proof=provePromotionThreat(replayTacticalLine(row.fen,[row.move])[0]);
    expect(proof?.gain??null).toBe(row.gain);
    const scan=buildLiveTacticalScan({fen:row.fen,pvUci:[row.move],depth:16,engineName:"Constructed"});
    expect(scan.motifs.some(m=>m.id==="promotionThreat")).toBe(row.gain!==null);
    if(!proof)return;
    expect(proof.visits).toBeLessThanOrEqual(32768);
    expect(proof.branches.some(b=>b.evasionUci)).toBe(true);
    expect(scan.motifs[0]).toMatchObject({id:"promotionThreat",value:row.gain,ply:1});
    expect(scan.motifs[0].evidence).toContain("including legal answers to checking defences");
    expect(scan.motifs[0].evidence).toContain("not a guaranteed next-move promotion");
    expect(scan.arrows.map(a=>a.from+a.to)).toEqual([row.move,
        row.move.slice(2,4)+(row.move.endsWith("h2")?"h1":"h8")]);
    for(const path of promotionThreatContinuations(proof)) {
        const replay=replayTacticalLine(row.fen,[row.move,...path]);
        expect(replay).toHaveLength(path.length+1);
        expect(path.length).toBeLessThanOrEqual(6);
        expect(replay.at(-1)?.move.promotion).toBeDefined();
        expect(replay.at(-1)?.move.from).toBe(replay[0].move.to);
        for(let i=2;i<path.length;i+=2)expect(replay[i].before.isCheck()).toBe(true);
    }
});

test.each(cases.filter(row=>row.gain!==null))("checked preparations cannot borrow a cached larger budget: $id",row=>{
    const root=replayTacticalLine(row.fen,[row.move])[0];
    expect(provePromotionThreat(root)).not.toBeNull();
    for(const budget of[0,1,-1,NaN,Infinity,0.5])expect(provePromotionThreat(root,budget)).toBeNull();
});

test.each([false,true])("checked promotion payoff stays on its certified ply (%s)",reflected=>{
    const fen=reflected?reflectMixedForkFen(checkingPromotionThreatFen):checkingPromotionThreatFen;
    const move=reflected?reflectMixedForkMove("h3h2"):"h3h2";
    const proof=provePromotionThreat(replayTacticalLine(fen,[move])[0])!;
    const path=promotionThreatContinuations(proof).find(path=>path.length===6)!;
    expect(path).toBeDefined();
    const line=[move,...path];
    const result=classifyPositionTacticalMotifs({fen,pvUci:line});
    expect(result.motifs[0]?.id).toBe("promotionThreat");
    expect(result.timeline).toContainEqual(expect.objectContaining({id:"promotion",ply:7,label:"Promotion Payoff",value:undefined}));
    expect(result.timeline?.filter(m=>m.id==="promotionThreat")).toHaveLength(1);
    const invalid=classifyPositionTacticalMotifs({fen,pvUci:[move,path[0],"a1a8",...path.slice(2)]});
    expect(invalid.timeline?.some(m=>m.label==="Promotion Payoff")).toBe(false);
});

test.each([false,true])("missed promotion preparation is secondary to losing its supporting rook (%s)",reflected=>{
    const fen=reflected?reflectMixedForkFen(checkingPromotionThreatFen):checkingPromotionThreatFen;
    const flip=(move:string)=>reflected?reflectMixedForkMove(move):move;
    const input={fen,bestMoveUci:flip("h3h2"),playedMoveUci:flip("e1a1"),
        pvUci:[flip("h3h2")],refutationUci:[flip("a7a1")]};
    const result=classifyMistakeReviewMotifs(input);
    expect(result.missedMotifs).toContainEqual(expect.objectContaining({id:"promotionThreat",value:400,ply:1}));
    expect(buildMistakeReviewTacticalExplanation(result)?.primary.id).toBe("hangingPiece");
    expect(classifyMistakeReviewMotifs({...input,playedMoveUci:input.bestMoveUci}).missedMotifs).toEqual([]);
});

test.each([false,true])("capturing the pawn prevents a checked promotion threat (%s)",reflected=>{
    const base=checkingPromotionThreatFen.replace("R7","7R").replace(" b "," w ");
    const fen=reflected?reflectMixedForkFen(base):base;
    const flip=(move:string)=>reflected?reflectMixedForkMove(move):move;
    const result=classifyMistakeReviewMotifs({fen,bestMoveUci:flip("h7h3"),playedMoveUci:flip("h7a7"),
        pvUci:[flip("h7h3")],refutationUci:[flip("h3h2")]});
    expect(result.allowedMotifs).toContainEqual(expect.objectContaining({id:"promotionThreat",comparison:"prevented"}));
});

test.skipIf(!process.env.TACTICAL_CHECKING_PROMOTION_REPORT)("export actual production promotion trees and decision probes",async()=>{
    const {privateReportPath}=await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
    const output=privateReportPath(process.env.TACTICAL_CHECKING_PROMOTION_REPORT!);
    expect(existsSync(output)).toBe(false);
    const inputs=[...cases];
    if(process.env.TACTICAL_CHECKING_PROMOTION_OWNER_REPLAY){
        const report=JSON.parse(readFileSync(process.env.TACTICAL_CHECKING_PROMOTION_OWNER_REPLAY,"utf8"));
        const owner=report.results.find((r:any)=>r.id==="recall:169988038936:ply71");
        if(!owner)throw new Error("Missing frozen owner promotion position");
        inputs.push({id:"owner h2",fen:owner.fen,move:owner.before[0].pvUci[0],gain:380},
            {id:"owner h2:reflected",fen:reflectMixedForkFen(owner.fen),move:reflectMixedForkMove(owner.before[0].pvUci[0]),gain:380});
    }
    const probes:{id:string;fen:string;searchMove?:string}[]=[];
    const reports=inputs.map(row=>{
        const threat=provePromotionThreat(replayTacticalLine(row.fen,[row.move])[0]);
        expect(threat?.gain??null).toBe(row.gain);
        probes.push({id:`${row.id}:best`,fen:row.fen},{id:`${row.id}:held`,fen:row.fen,searchMove:row.move});
        const seen=new Set<string>();
        if(threat)for(const path of promotionThreatContinuations(threat)){
            const replay=replayTacticalLine(row.fen,[row.move,...path]);
            for(let index=2;index<replay.length;index+=2){
                const step=replay[index],fen=makeFen(step.before.toSetup()),key=`${fen}:${step.uci}`;
                if(seen.has(key))continue;seen.add(key);
                probes.push({id:`${row.id}:decision:${seen.size}`,fen,searchMove:step.uci});
            }
        }
        const path=threat?promotionThreatContinuations(threat).sort((a,b)=>b.length-a.length)[0]:undefined;
        return{...row,threat,scan:buildLiveTacticalScan({fen:row.fen,pvUci:[row.move],depth:16,engineName:"Audit"}),
            certifiedContinuation:path?classifyPositionTacticalMotifs({fen:row.fen,pvUci:[row.move,...path]}):null};
    });
    for(const reflected of[false,true]){
        const flip=(move:string)=>reflected?reflectMixedForkMove(move):move;
        const fen=reflected?reflectMixedForkFen(checkingPromotionThreatFen):checkingPromotionThreatFen;
        const after=makeFen(replayTacticalLine(fen,[flip("e1a1")])[0].after.toSetup());
        const priorBase=checkingPromotionThreatFen.replace("R7","7R").replace(" b "," w ");
        const prior=reflected?reflectMixedForkFen(priorBase):priorBase;
        probes.push({id:`missed:${reflected}:played`,fen,searchMove:flip("e1a1")},
            {id:`missed:${reflected}:reply-best`,fen:after},
            {id:`missed:${reflected}:reply-held`,fen:after,searchMove:flip("a7a1")},
            {id:`prevent:${reflected}:best`,fen:prior},
            {id:`prevent:${reflected}:capture`,fen:prior,searchMove:flip("h7h3")},
            {id:`prevent:${reflected}:played`,fen:prior,searchMove:flip("h7a7")});
    }
    writeFileSync(output,JSON.stringify({scope:"Actual production trees and fresh probe requests; not an accuracy rate.",cases:reports,probes},null,2),{flag:"wx"});
});
