import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { attacks } from "chessops/attacks";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import type { NormalMove, Role } from "chessops/types";
import { makeUci } from "chessops/util";
import { expect, test } from "vitest";
import { proveImmediatePromotion, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

const value: Record<Role, number> = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 20000 };
function moves(pos: Chess): NormalMove[] {
    return [...pos.allDests()].flatMap(([from, dests]) => [...dests].flatMap(to =>
        pos.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
            ? (["queen", "rook", "bishop", "knight"] as const).map(promotion => ({from, to, promotion}))
            : [{from, to}]));
}
function delta(pos: Chess, move: NormalMove) {
    const victim = pos.board.get(move.to);
    return (victim && victim.color !== pos.turn ? value[victim.role] :
        pos.board.get(move.from)?.role === "pawn" && move.to === pos.epSquare ? 100 : 0) +
        (move.promotion ? value[move.promotion] - 100 : 0);
}
type Branch = { replyUci: string; fen: string; promotionUci?: string; promotionGain?: number; gain: number;
    evasionUci?: string; branches?: Branch[] };

// Diagnostic only. It deliberately does not alter admission or the UI. A
// complete result still needs independent legal-tree and fresh engine review.
function inspectCheckingPromotion(fen: string, move: string, checkDepth: number, nodeLimit = 32768) {
    const root = replayTacticalLine(fen, [move])[0];
    const side = root.before.turn;
    const squareOrder = (square: number) => side === "white" ? square : square ^ 56;
    const moveOrder = (a: NormalMove, b: NormalMove) =>
        squareOrder(a.from) - squareOrder(b.from) || squareOrder(a.to) - squareOrder(b.to);
    let remaining = nodeLimit;
    const failures: {fen: string; reason: string; depth: number}[] = [];
    const nested = new Map<string, ReturnType<typeof proveImmediatePromotion>>();
    const defend = (pos: Chess, balance: number, depth: number): Branch[] | null => {
        if (pos.isEnd() || pos.halfmoves >= 100) return null;
        const replies = moves(pos);
        // Geometry orders work, never certifies a defence. Test pawn capture,
        // blockade or promotion-square pressure before the checking tree, then
        // other quiet moves. Every legal reply still needs an actual proof.
        const priority = (move: NormalMove) => {
            const next = pos.clone(); next.play(move);
            if (move.to === root.move.to) return 4;
            const square = root.move.to + (side === "white" ? 8 : -8);
            if (move.promotion || move.to === square) return 3;
            const piece = next.board.get(move.to);
            const targets = piece && attacks(piece, move.to, next.board.occupied);
            return targets?.has(root.move.to) || targets?.has(square) ? 2 : next.isCheck() ? 1 : 0;
        };
        replies.sort((a,b) => priority(b)-priority(a) || delta(pos,b)-delta(pos,a) || moveOrder(a,b));
        const branches: Branch[] = [];
        for (const reply of replies) {
            if (remaining <= 0) return null;
            remaining--;
            const next = pos.clone(); next.play(reply);
            const nextFen = makeFen(next.toSetup());
            const debt = balance - delta(pos, reply);
            if (next.isEnd() || next.halfmoves >= 100 || next.board.get(root.move.to)?.role !== "pawn" ||
                next.board.get(root.move.to)?.color !== side) return null;
            let selected: Branch | null = null;
            const promotions = moves(next).filter(m => m.from === root.move.to && m.promotion).sort(moveOrder);
            for (const promotion of promotions) {
                if (remaining <= 0) return null;
                const key = `${nextFen}:${makeUci(promotion)}`;
                const allowance = Math.min(4096, remaining);
                let proof = nested.get(key);
                if (!nested.has(key)) {
                    proof = proveImmediatePromotion(replayTacticalLine(nextFen, [makeUci(promotion)])[0], allowance);
                    remaining -= proof ? proof.visits : allowance;
                    if (allowance === 4096) nested.set(key, proof);
                } else remaining--;
                if (!proof || Math.min(proof.gain, debt + proof.gain) < 100) continue;
                selected = {replyUci: makeUci(reply), fen: nextFen, promotionUci: makeUci(promotion),
                    promotionGain: proof.gain, gain: Math.min(proof.gain, debt + proof.gain)};
                break;
            }
            if (!selected && next.isCheck() && depth > 0) {
                for (const evasion of moves(next).sort(moveOrder)) {
                    if (remaining <= 0) return null;
                    remaining--;
                    if (evasion.from === root.move.to || evasion.promotion) continue;
                    const after = next.clone(); after.play(evasion);
                    const children = defend(after, debt + delta(next, evasion), depth - 1);
                    if (!children) continue;
                    selected = {replyUci: makeUci(reply), fen: nextFen,
                        evasionUci: makeUci(evasion), gain: Math.min(...children.map(c => c.gain)), branches: children};
                    break;
                }
            }
            if (!selected) {
                if (failures.length < 40) failures.push({fen: nextFen, reason: next.isCheck() ? "checking continuation" : "unretained promotion", depth});
                return null;
            }
            branches.push(selected);
        }
        return branches;
    };
    const branches = defend(root.after, 0, checkDepth);
    return {branches, gain: branches ? Math.min(...branches.map(b => b.gain)) : null,
        visits: nodeLimit - remaining, failures};
}

// Reduced, constructed geometry; not a reproduction of the owner's game.
const controls = [
    {id:"guarded promotion after checks",fen:"8/R7/4k3/2P5/4n3/3K3p/8/4r3 b - - 0 1",move:"h3h2",positive:true},
    {id:"unguarded promotion can be exchanged",fen:"8/R7/4k3/2P5/4n3/3K3p/8/8 b - - 0 1",move:"h3h2",positive:false},
    {id:"pawn can be captured",fen:"8/8/4k3/2P5/4n3/3K3p/R7/4r3 b - - 0 1",move:"h3h2",positive:false},
].flatMap(row=>[row,{...row,id:`${row.id}:reflected`,fen:reflectMixedForkFen(row.fen),move:reflectMixedForkMove(row.move)}]);

test.each(controls)("checking-promotion diagnostic: $id", row=>{
    const result=inspectCheckingPromotion(row.fen,row.move,2);
    expect(Boolean(result.branches)).toBe(row.positive);
    expect(result.visits).toBeLessThanOrEqual(32768);
});

test.each(controls.filter(row=>row.positive))("a tiny checking-promotion budget cannot reuse success: $id",row=>{
    expect(inspectCheckingPromotion(row.fen,row.move,2).branches).not.toBeNull();
    expect(inspectCheckingPromotion(row.fen,row.move,2,1).branches).toBeNull();
});

test.skipIf(!process.env.TACTICAL_PROMOTION_CHECK_PUBLIC_REPORT)("export constructed checking-promotion decisions",async()=>{
    const {privateReportPath}=await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
    const output=privateReportPath(process.env.TACTICAL_PROMOTION_CHECK_PUBLIC_REPORT!);
    expect(existsSync(output)).toBe(false);
    const probes:{id:string;fen:string;searchMove?:string}[]=[];
    const cases=controls.map(row=>{
        const result=inspectCheckingPromotion(row.fen,row.move,2);
        probes.push({id:`${row.id}:best`,fen:row.fen},{id:`${row.id}:held`,fen:row.fen,searchMove:row.move});
        const walk=(branches:Branch[])=>{for(const branch of branches){
            probes.push({id:`${row.id}:decision:${probes.length}`,fen:branch.fen,searchMove:branch.promotionUci??branch.evasionUci!});
            if(branch.branches)walk(branch.branches);
        }};
        if(result.branches)walk(result.branches);
        return {...row,attempts:[{depth:2,...result}]};
    });
    writeFileSync(output,JSON.stringify({scope:"Constructed checking-promotion diagnostic controls, not production admission.",cases,probes},null,2),{flag:"wx"});
});

test.skipIf(!process.env.TACTICAL_PROMOTION_CHECK_INPUT || !process.env.TACTICAL_PROMOTION_CHECK_REPORT)(
    "audit checking defences before promotion without changing classifier admission", async () => {
        const { privateReportPath } = await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_PROMOTION_CHECK_REPORT!);
        expect(existsSync(output)).toBe(false);
        const request = JSON.parse(readFileSync(process.env.TACTICAL_PROMOTION_CHECK_INPUT!, "utf8"));
        const ids: string[] = JSON.parse(process.env.TACTICAL_PROMOTION_CHECK_IDS ?? "[]");
        expect(ids.length).toBeGreaterThan(0);
        const inputs = request.cases.filter((row: {id: string}) => ids.includes(row.id));
        expect(inputs).toHaveLength(ids.length);
        const probes: {id: string; fen: string; searchMove?: string}[] = [];
        const cases = inputs.map((row: {id: string; fen: string; move: string}) => {
            const attempts = [1,2,3,4].map(depth => ({depth, ...inspectCheckingPromotion(row.fen, row.move, depth)}));
            const selected = attempts.find(a => a.branches);
            const seen = new Set<string>();
            const nominate = (branches: Branch[]) => {
                for (const b of branches) {
                    const selectedMove = b.promotionUci ?? b.evasionUci!;
                    const key = `${b.fen}:${selectedMove}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        probes.push({id:`${row.id}:decision:${seen.size}`,fen:b.fen,searchMove:selectedMove});
                    }
                    if (b.branches) nominate(b.branches);
                }
            };
            if (selected?.branches) nominate(selected.branches);
            console.log(JSON.stringify({id:row.id,attempts:attempts.map(a=>({depth:a.depth,gain:a.gain,visits:a.visits,
                failures:a.failures.slice(-3).map(f=>({...f,turn:Chess.fromSetup(parseFen(f.fen).unwrap()).unwrap().turn}))}))}));
            const first = replayTacticalLine(row.fen,[row.move])[0];
            return {...row, san:makeSan(first.before,first.move), attempts};
        });
        writeFileSync(output,JSON.stringify({scope:"Private bounded checking-promotion prototype; not a production certificate or accuracy estimate.",cases,probes},null,2),{flag:"wx"});
    }, 120000,
);
