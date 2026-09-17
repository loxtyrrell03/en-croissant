import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {makeFen} from "chessops/fen";
import {attacks} from "chessops/attacks";
import {parseSquare,makeUci,opposite} from "chessops/util";
import {expect,test} from "vitest";
import {proveDefenderCombination,proveDiscoveredMaterial,proveImmediateFork,proveRecaptureBackedFork,proveDiscoveryBackedFork,proveCaptureCounterattack,replayTacticalLine} from "../tacticalMotifs/causalTactics";
import {classifyPositionTacticalMotifs,classifyMistakeReviewMotifs} from "../tacticalMotifs/mistakeReviewAdapter";
import {buildLiveTacticalScan} from "../tacticalMotifs/liveTactics";
import {discoveryRecaptureInput,discoveryRecaptureFen} from "./fixtures/discoveryRecapture";
import {reflectMixedForkFen,reflectMixedForkMove} from "./fixtures/mixedTargetFork";

test.each([false,true])("a discovery survives a checking exchange and connected pin (%s)",reflected=>{
    const input=discoveryRecaptureInput(reflected),root=replayTacticalLine(input.fen,input.pvUci)[0];
    expect(proveDiscoveredMaterial(root)).toBe(100);
    const short=classifyPositionTacticalMotifs({...input,pvUci:input.pvUci.slice(0,1)});
    const full=classifyPositionTacticalMotifs(input);
    expect(short.motifs[0]).toMatchObject({id:"discoveredAttack",ply:1,value:100});
    expect(full.motifs[0]).toEqual(short.motifs[0]);
    const scan=buildLiveTacticalScan({...input,depth:18,engineName:"Constructed discovery"});
    expect(scan.motifs[0]?.id).toBe("discoveredAttack");
    expect(scan.arrows.every(arrow=>arrow.ply===1)).toBe(true);
    const played=reflected?reflectMixedForkMove("c8b8"):"c8b8";
    expect(classifyMistakeReviewMotifs({...input,bestMoveUci:input.pvUci[0],playedMoveUci:played}).missedMotifs)
        .toContainEqual(expect.objectContaining({id:"discoveredAttack",ply:1}));
});

test.each([false,true])("missing pin support cannot borrow the original certificate (%s)",reflected=>{
    for(const control of [discoveryRecaptureFen.replace("2kr1b1r","2k2b1r"),
        discoveryRecaptureFen.replace("pppbqp2","ppp1qp2"),
        discoveryRecaptureFen.replace("7N","4Q2N").replace("R1BQK2R","R1B1K2R")]){
        const root=replayTacticalLine(reflected?reflectMixedForkFen(control):control,
            [reflected?reflectMixedForkMove("c6d4"):"c6d4"])[0];
        expect(proveDiscoveredMaterial(root)).toBeNull();
    }
});

test.each([false,true])("moving the queen to a newly attacked square is not a negative control (%s)",reflected=>{
    const fen=discoveryRecaptureFen.replace("7N","5Q1N").replace("R1BQK2R","R1B1K2R");
    const root=replayTacticalLine(reflected?reflectMixedForkFen(fen):fen,
        [reflected?reflectMixedForkMove("c6d4"):"c6d4"])[0];
    expect(proveDiscoveredMaterial(root)).toBe(100);
});

test.each([false,true])("countercheck settlement accounts for two pieces falling in sequence (%s)",reflected=>{
    const input=discoveryRecaptureInput(reflected);
    const root=replayTacticalLine(input.fen,input.pvUci)[0];
    const leaves: {counterchecks?: {fen:string;moveUci:string}[]}[]=[];
    expect(proveDiscoveredMaterial(root,4096,100,leaf=>leaves.push(leaf))).toBe(100);
    const line=["c6d4","a4d7","d8d7","h5g6","d5e4","c1g5","d4e2","d1d7"];
    const checked=replayTacticalLine(input.fen,reflected?line.map(reflectMixedForkMove):line).at(-1)!.after;
    const decisions=leaves.flatMap(leaf=>leaf.counterchecks??[]).filter(decision=>decision.fen===makeFen(checked.toSetup()));
    expect(decisions).toContainEqual({fen:makeFen(checked.toSetup()),moveUci:reflected?reflectMixedForkMove("e7d7"):"e7d7"});
    expect(decisions.some(decision=>decision.moveUci===(reflected?reflectMixedForkMove("f6d7"):"f6d7"))).toBe(false);
    // Nxd7 permits Bxe7, Bxe7, Kxe2: separate single-square maxima miss
    // the second knight loss. Qxd7 preserves a different, sound defence.
});

test("discovery recovery respects the original finite allowance and cache identity",()=>{
    const input=discoveryRecaptureInput(),root=replayTacticalLine(input.fen,input.pvUci)[0];
    for(const limit of [0,1,32,Number.NaN]) expect(proveDiscoveredMaterial(root,limit)).toBeNull();
    expect(proveDiscoveredMaterial(root)).toBe(100);
    expect(proveDiscoveredMaterial(root,4096,100,()=>{})).toBe(100);
    expect(proveDiscoveredMaterial(root,4096,10000)).toBeNull();
    expect(proveDiscoveredMaterial(root)).toBe(100);
});

test("a fork keeps an already-earned pawn without demanding another exchange gain",()=>{
    const fen="r1bqrnk1/1p3ppp/p2p1n2/3P4/P1B1PB2/2P2N1P/2Q2PP1/R2R2K1 b - - 0 16";
    const root=replayTacticalLine(fen,["e8e4"])[0];
    const failures: string[]=[];
    const proof=proveImmediateFork(root,reason=>failures.push(reason));
    expect(proof?.gain).toBe(100);
    expect(proof?.branches).toContainEqual({replyUci:"d1d4",captureUci:"e4d4",gain:100});
    const result=classifyPositionTacticalMotifs({fen,pvUci:["e8e4","d1d4","e4d4"]});
    expect(result.motifs[0]).toMatchObject({id:"fork",value:100});
    expect(result.motifs[0].evidence).toContain("exchange pieces instead of losing a forked piece outright");
    expect(result.motifs[0].evidence).not.toContain("winning the rook");
    expect(failures).not.toContain("exhausted");
});

test("reflected discovery fixtures preserve castling and en-passant ownership",()=>{
    expect(discoveryRecaptureInput(true).fen.split(" ")[2]).toBe("kq");
    const fen="r3k2r/8/8/3Pp3/8/8/8/R3K2R w Kq e6 0 1";
    expect(reflectMixedForkFen(fen).split(" ").slice(1,4)).toEqual(["b","Qk","e3"]);
    expect(reflectMixedForkFen(reflectMixedForkFen(fen))).toBe(fen);
});

test.skipIf(!process.env.TACTICAL_DISCOVERY_OWNER_FORK_REPORT)("inspect owner fork collection defences", async()=>{
    const {privateReportPath}=await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
    const output=privateReportPath(process.env.TACTICAL_DISCOVERY_OWNER_FORK_REPORT!);
    expect(existsSync(output)).toBe(false);
    const source=JSON.parse(readFileSync(process.env.TACTICAL_DISCOVERY_RECAPTURE_REPLAY!,"utf8"));
    const ids:string[]=JSON.parse(process.env.TACTICAL_DISCOVERY_RECAPTURE_IDS!);
    const cases=source.results.filter((row:any)=>ids.includes(row.id)).map((row:any)=>{
        const root=replayTacticalLine(row.fen,row.before[0].pvUci)[0];
        const failures:any[]=[];
        const fork=proveImmediateFork(root,(reason,replyUci,remaining)=>failures.push({reason,replyUci,remaining}));
        const failure=failures.find(f=>f.replyUci);
        const trials:any[]=[];
        const collections:any[]=[];
        if(failure){
            const defence=replayTacticalLine(row.fen,[root.uci,failure.replyUci])[1];
            const pos=defence.after;
            const attacker=pos.board.get(defence.move.to)!;
            const threatened=attacks(attacker,defence.move.to,pos.board.occupied).intersect(pos.board[root.before.turn]);
            const targets=[...attacks(pos.board.get(root.move.to)!,root.move.to,pos.board.occupied).intersect(pos.board[opposite(root.before.turn)])];
            for(const to of pos.dests(root.move.to)){
                if(pos.board.get(to)?.color!==opposite(root.before.turn))continue;
                const capture=replayTacticalLine(makeFen(pos.toSetup()),[makeUci({from:root.move.to,to})])[0];
                const follow=[...attacks(capture.after.board.get(to)!,to,capture.after.board.occupied)
                    .intersect(capture.after.board[opposite(root.before.turn)])
                    .diff(attacks(pos.board.get(root.move.to)!,root.move.to,pos.board.occupied))];
                for(const limit of [4096,16384]){
                    const budget={nodes:limit},leaves:any[]=[],trace:any[]=[];
                    const gain=proveDefenderCombination(capture,follow,[to],limit,budget,1,true,90,
                        leaf=>leaves.push(leaf),true,f=>trace.push(f));
                    collections.push({uci:capture.uci,follow,gain,visits:limit-budget.nodes,limit,leaves,trace});
                }
            }
            for(const [from,dests] of pos.allDests()) for(const to of dests){
                if(!threatened.has(from)||pos.board.get(to)||from===root.move.to)continue;
                const repair=replayTacticalLine(makeFen(pos.toSetup()),[makeUci({from,to})])[0];
                if(!repair)continue;
                const budget={nodes:4096},leaves:any[]=[],trace:any[]=[];
                const gain=proveDefenderCombination(repair,targets,[root.move.to],4096,budget,1,true,100,
                    leaf=>leaves.push(leaf),true,f=>trace.push(f),true);
                trials.push({uci:repair.uci,gain,visits:4096-budget.nodes,leaves,trace});
            }
        }
        return {id:row.id,fen:row.fen,uci:root.uci,fork,failures,trials,collections};
    });
    expect(cases).toHaveLength(ids.length);
    writeFileSync(output,JSON.stringify({cases},null,2),{flag:"wx"});
    console.log(cases);
});

test.skipIf(!process.env.TACTICAL_DISCOVERY_FORK_REPORT)("inspect the older capture-fork continuation",()=>{
    const fen="r1bqrnk1/1p3ppp/p2p1n2/b1pP4/P3PB2/2NB1N1P/1PQ2PP1/R2R2K1 b - - 6 14";
    const line=["a5c3","b2c3","c5c4","d3c4","e8e4","d1d4","e4d4"];
    const root=replayTacticalLine(fen,line)[4];
    expect(root.uci).toBe("e8e4");
    const proof={fen:makeFen(root.before.toSetup()),uci:root.uci,immediate:proveImmediateFork(root),
        recapture:proveRecaptureBackedFork(root),discovery:proveDiscoveryBackedFork(root),
        counterattack:proveCaptureCounterattack(root),larger:proveCaptureCounterattack(root,16384)};
    writeFileSync(process.env.TACTICAL_DISCOVERY_FORK_REPORT!,JSON.stringify(proof,null,2),{flag:"wx"});
});

test.skipIf(!process.env.TACTICAL_DISCOVERY_RECAPTURE_REPLAY || !process.env.TACTICAL_DISCOVERY_RECAPTURE_PROBES)(
    "export selected discovery preparations and leaves for independent engine review",async()=>{
        const {privateReportPath}=await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output=privateReportPath(process.env.TACTICAL_DISCOVERY_RECAPTURE_PROBES!);
        expect(existsSync(output)).toBe(false);
        const sample=JSON.parse(readFileSync(process.env.TACTICAL_DISCOVERY_RECAPTURE_REPLAY!,"utf8"));
        const selected:string[]=JSON.parse(process.env.TACTICAL_DISCOVERY_RECAPTURE_IDS??"[]");
        const ownerRows=sample.results.flatMap((row:any)=>row.cases??[row]).filter((row:any)=>selected.includes(row.id));
        expect(ownerRows).toHaveLength(selected.length);
        const ply=Number(process.env.TACTICAL_DISCOVERY_RECAPTURE_PLY??1);
        expect(Number.isSafeInteger(ply)&&ply>0).toBe(true);
        const rows=[...ownerRows.map((row:any)=>{
            const line=(row.before??row.engineLines)[0].pvUci;
            const root=replayTacticalLine(row.fen,line)[ply-1];
            expect(root).toBeDefined();
            return {id:row.id,fen:makeFen(root.before.toSetup()),pvUci:line.slice(ply-1)};
        }),
            ...(process.env.TACTICAL_DISCOVERY_RECAPTURE_CONTROLS === "0" ? [] : [false,true])
                .map(reflected=>({id:`constructed:${reflected}`, ...discoveryRecaptureInput(reflected)}))];
        const cases=rows.map(row=>{
            const leaves:any[]=[],failures:string[]=[];
            const root=replayTacticalLine(row.fen,row.pvUci)[0];
            const gain=proveDiscoveredMaterial(root,4096,100,(leaf:any)=>leaves.push(leaf),reason=>failures.push(reason));
            const result=classifyPositionTacticalMotifs({fen:row.fen,pvUci:row.pvUci});
            return {...row,gain,leaves,failures,result};
        });
        expect(cases.every(row=>typeof row.gain === "number" && row.gain>=100)).toBe(true);
        const expectations=JSON.parse(process.env.TACTICAL_DISCOVERY_PROBE_EXPECTATIONS??"{}");
        const probes=cases.flatMap(row=>{
            const decisions=[{fen:row.fen,moveUci:row.pvUci[0]},...row.leaves.flatMap((leaf:any)=>[
                {fen:leaf.fen,moveUci:leaf.moveUci},...(leaf.preparations??[]),...(leaf.counterchecks??[]),
            ])];
            return [...new Map(decisions.map(decision=>[`${decision.fen}:${decision.moveUci}`,decision])).values()]
                .map((decision,i)=>({id:`${row.id}:${i}`,fen:decision.fen,searchMove:decision.moveUci,
                    ...(expectations[row.id]??{expectedSign:1})}));
        });
        writeFileSync(output,JSON.stringify({samplePath:process.env.TACTICAL_DISCOVERY_RECAPTURE_REPLAY,
            scope:"Selected connected preparations and leaves; overlapping branch searches, not independent puzzles.",cases,probes},null,2),{flag:"wx"});
        console.log({cases:cases.map(({leaves,...row})=>({id:row.id,gain:row.gain,leaves:leaves.length})),searches:probes.length});
    },120000);

test.skipIf(!process.env.TACTICAL_DISCOVERY_RECAPTURE_REPLAY || !process.env.TACTICAL_DISCOVERY_RECAPTURE_REPORT)(
    "inspect connected pin preparations after checking exchanges",async()=>{
        const {privateReportPath}=await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output=privateReportPath(process.env.TACTICAL_DISCOVERY_RECAPTURE_REPORT!);
        expect(existsSync(output)).toBe(false);
        const sample=JSON.parse(readFileSync(process.env.TACTICAL_DISCOVERY_RECAPTURE_REPLAY!,"utf8"));
        const selected:string[]=JSON.parse(process.env.TACTICAL_DISCOVERY_RECAPTURE_IDS??"[]");
        const rows=sample.results.filter((row:any)=>selected.includes(row.id));
        expect(rows).toHaveLength(selected.length);
        const cases=rows.flatMap((row:any)=>{
            const bishop=row.before[0].pvUci[1];
            return ["d8d7","e7d7"].map(recapture=>{
                const steps=replayTacticalLine(row.fen,["c6d4",bishop,recapture,"e2d4","d5e4"]);
                expect(steps).toHaveLength(5);
                const step=steps[4],failures:any[]=[],leaves:any[]=[],budget={nodes:8192};
                const gain=proveDefenderCombination(step,[parseSquare("d4")!,parseSquare("d1")!],
                    [parseSquare("d7")!,parseSquare("e5")!,parseSquare("e4")!],8192,budget,1,true,320,
                    leaf=>leaves.push(leaf),true,failure=>failures.push(failure),true);
                return {id:row.id,recapture,fen:makeFen(step.before.toSetup()),gain,visits:8192-budget.nodes,failures,leaves,
                    discovery:proveDiscoveredMaterial(step,4096,320)};
            });
        });
        writeFileSync(output,JSON.stringify({cases},null,2),{flag:"wx"});
        console.log(cases.map(({leaves,...row}:any)=>({...row,leaves:leaves.length})));
    },120000);
