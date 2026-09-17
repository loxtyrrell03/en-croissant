import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {makeFen} from "chessops/fen";
import {parseSquare} from "chessops/util";
import {expect,test} from "vitest";
import {proveDefenderCombination,proveImmediateFork,replayTacticalLine} from "../tacticalMotifs/causalTactics";
import {buildLiveTacticalScan} from "../tacticalMotifs/liveTactics";
import {classifyPositionTacticalMotifs,classifyMistakeReviewMotifs} from "../tacticalMotifs/mistakeReviewAdapter";
import {forkExchangeRetentionFen,forkExchangeRetentionInput} from "./fixtures/forkExchangeRetention";
import {reflectMixedForkFen,reflectMixedForkMove} from "./fixtures/mixedTargetFork";

test.each([false,true])("a connected fork can retain its original pawn through a break-even collection (%s)",reflected=>{
    const input=forkExchangeRetentionInput(reflected),root=replayTacticalLine(input.fen,input.pvUci)[0];
    const proof=proveImmediateFork(root);
    expect(proof?.gain).toBe(100);
    const move=(uci:string)=>reflected?reflectMixedForkMove(uci):uci;
    const branch=proof!.branches.find(b=>b.replyUci===move("a5c4"))!;
    expect(branch.gain).toBe(100);
    expect(branch.collection?.some(leaf=>leaf.gain===0)).toBe(true);
    expect(branch.collection?.flatMap(leaf=>leaf.counterchecks??[]))
        .toContainEqual(expect.objectContaining({moveUci:move("h1a1")}));
    const values={pawn:100,knight:320,bishop:330,rook:500,queen:900,king:0};
    const material=(pos:typeof root.before)=>[...pos.board.occupied].reduce((sum,square)=>{
        const piece=pos.board.get(square)!;
        return sum+(piece.color===root.before.turn?1:-1)*values[piece.role];
    },0);
    const final=replayTacticalLine(input.fen,input.pvUci).at(-1)!.after;
    expect(material(final)-material(root.before)).toBe(100);
    for(const pvUci of [[input.pvUci[0]],input.pvUci]){
        const result=classifyPositionTacticalMotifs({...input,pvUci});
        expect(result.motifs[0]).toMatchObject({id:"fork",ply:1,value:100});
        const scan=buildLiveTacticalScan({...input,pvUci,depth:18,engineName:"Constructed retention"});
        expect(scan.motifs[0]).toMatchObject({id:"fork",value:100});
        expect(scan.arrows.every(arrow=>arrow.ply===1)).toBe(true);
    }
});

test.each([false,true])("missing initial gain or recapture support cannot borrow the fork certificate (%s)",reflected=>{
    for(const fen of [forkExchangeRetentionFen.replace("1qp1pppp","1qp1p1pp"),
        forkExchangeRetentionFen.replace("R3K2R","R3K3").replace("w KQ","w Q"),
        forkExchangeRetentionFen.replace("2kr1bnr/1qp1pppp","1qkr1bnr/2p1pppp")]){
        const root=replayTacticalLine(reflected?reflectMixedForkFen(fen):fen,
            [reflected?reflectMixedForkMove("e5f7"):"e5f7"])[0];
        expect(proveImmediateFork(root)).toBeNull();
    }
});

test.each([false,true])("missed and allowed lessons use the retained fork, not a free rook (%s)",reflected=>{
    const input=forkExchangeRetentionInput(reflected);
    const move=(uci:string)=>reflected?reflectMixedForkMove(uci):uci;
    const missed=classifyMistakeReviewMotifs({...input,bestMoveUci:move("e5f7"),playedMoveUci:move("a1c1")});
    expect(missed.missedMotifs[0]).toMatchObject({id:"fork",value:100,ply:1});
    const played=classifyMistakeReviewMotifs({...input,bestMoveUci:move("e5f7"),playedMoveUci:move("e5f7")});
    expect(played.missedMotifs).toEqual([]);
    const before=forkExchangeRetentionFen.replace("1qp1pppp/pp6","2p1pppp/ppq5").replace("w KQ","b KQ");
    const allowed=classifyMistakeReviewMotifs({fen:reflected?reflectMixedForkFen(before):before,
        bestMoveUci:move("c6e8"),playedMoveUci:move("c6b7"),pvUci:[move("c6e8")],
        refutationUci:input.pvUci});
    expect(allowed.allowedMotifs[0]).toMatchObject({id:"fork",value:100,comparison:"prevented"});
    expect(allowed.allowedMotifs[0].comparisonEvidence).toContain("captures the forking knight");
});

test("zero is only a bounded retained exchange, never an unguarded generic win",()=>{
    const input=forkExchangeRetentionInput(),steps=replayTacticalLine(input.fen,input.pvUci);
    const capture=steps[2],target=parseSquare("b7")!,collector=parseSquare("d8")!;
    expect(proveDefenderCombination(capture,[target],[collector],4096,undefined,1,true,0,undefined,true)).toBe(0);
    expect(proveDefenderCombination(capture,[target],[collector],4096,undefined,1,false,0,undefined,true)).toBeNull();
    expect(proveDefenderCombination(capture,[target],[collector],4096,undefined,1,true,0,undefined,false)).toBeNull();
    expect(proveDefenderCombination(capture,[target],[collector],4096,undefined,1,true,-1,undefined,true)).toBeNull();
    expect(proveDefenderCombination(capture,[target],[collector],1,undefined,1,true,0,undefined,true)).toBeNull();
    const quiet=steps[6];
    expect(proveDefenderCombination(quiet,[target],[collector],4096,undefined,1,true,0,undefined,true)).toBeNull();
});

test.skipIf(!process.env.TACTICAL_FORK_RETENTION_REPLAY || !process.env.TACTICAL_FORK_RETENTION_PROBES)(
    "export real and constructed fork collection decisions for independent review",async()=>{
        const {privateReportPath}=await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output=privateReportPath(process.env.TACTICAL_FORK_RETENTION_PROBES!);
        expect(existsSync(output)).toBe(false);
        const sample=JSON.parse(readFileSync(process.env.TACTICAL_FORK_RETENTION_REPLAY!,"utf8"));
        const ids:string[]=JSON.parse(process.env.TACTICAL_FORK_RETENTION_IDS??"[]");
        const rows=sample.results.filter((r:any)=>ids.includes(r.id));
        expect(rows).toHaveLength(ids.length);
        const inputs=[...rows.map((r:any)=>({id:r.id,fen:r.fen,pvUci:r.before[0].pvUci})),
            ...[false,true].map(reflected=>({id:`constructed:${reflected}`,...forkExchangeRetentionInput(reflected)}))];
        const cases=inputs.map(input=>{
            const root=replayTacticalLine(input.fen,input.pvUci)[0],failures:any[]=[];
            const proof=proveImmediateFork(root,(reason,replyUci,remaining)=>failures.push({reason,replyUci,remaining}));
            expect(proof?.gain).toBe(100);
            const decisions=[{fen:input.fen,moveUci:root.uci},...proof!.branches.flatMap(branch=>{
                const after=replayTacticalLine(input.fen,[root.uci,branch.replyUci]).at(-1)!.after;
                return [...(branch.captureUci?[{fen:makeFen(after.toSetup()),moveUci:branch.captureUci}]:[]),
                    ...(branch.collection??[]).flatMap(leaf=>[
                        {fen:leaf.fen,moveUci:leaf.moveUci},...(leaf.counterchecks??[]),
                    ])];
            })];
            return {...input,proof,failures,decisions:[...new Map(decisions.map(d=>[`${d.fen}:${d.moveUci}`,d])).values()]};
        });
        const probes=cases.flatMap(row=>row.decisions.map((d:{fen:string;moveUci:string},i:number)=>({id:`${row.id}:${i}`,fen:d.fen,searchMove:d.moveUci,expectedSign:1})));
        writeFileSync(output,JSON.stringify({samplePath:process.env.TACTICAL_FORK_RETENTION_REPLAY,
            scope:"Selected fork decisions; overlapping branch searches, not independent puzzles.",cases,probes},null,2),{flag:"wx"});
        console.log({cases:cases.length,probes:probes.length});
    },120000,
);
