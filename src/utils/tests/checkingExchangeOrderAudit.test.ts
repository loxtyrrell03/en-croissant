import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci, parseUci } from "chessops/util";
import type { NormalMove } from "chessops/types";
import { attacks } from "chessops/attacks";
import { expect, test } from "vitest";
import { intermediateCaptureProof, proveDefenderCombination, proveImmediateFork,
    replayTacticalLine, tacticalCaptureGain, tacticalExchangeGain } from "../tacticalMotifs/causalTactics";

test.skipIf(!process.env.TACTICAL_CHECKING_ORDER_INPUT || !process.env.TACTICAL_CHECKING_ORDER_REPORT || !process.env.TACTICAL_CHECKING_ORDER_GAME_ID)(
    "inspect checking exchanges and every defence without borrowing a later rook capture", async () => {
        const { privateReportPath } = await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const destination = privateReportPath(process.env.TACTICAL_CHECKING_ORDER_REPORT!);
        expect(existsSync(destination)).toBe(false);
        const input = JSON.parse(readFileSync(privateReportPath(process.env.TACTICAL_CHECKING_ORDER_INPUT!), "utf8"));
        const probes: any[] = [], cases: any[] = [];
        const add = (id: string, fen: string, searchMove?: string) => {
            if (!probes.some(p => p.fen === fen && p.searchMove === searchMove))
                probes.push({ id, fen, searchMove, depth: 18 });
        };
        for (const ply of [35, 37, 39, 41, 43]) {
            const row = input.results.find((r: any) => r.id === `recall:${process.env.TACTICAL_CHECKING_ORDER_GAME_ID}:ply${ply}`);
            expect(row).toBeDefined();
            const root = replayTacticalLine(row.fen, ["h5f3"])[0];
            expect(root.after.isCheck()).toBe(true);
            add(`${row.id}:best`, row.fen); add(`${row.id}:held`, row.fen, root.uci);
            const replies = [...root.after.allDests()].flatMap(([from, dests]) => [...dests].map(to => {
                const move = {from, to};
                expect(root.after.board.get(from)?.role !== "pawn" || (to >= 8 && to < 56)).toBe(true);
                const next = root.after.clone(); next.play(move);
                const fen = makeFen(next.toSetup()), san = makeSan(root.after, move);
                add(`${row.id}:${san}:best`, fen);
                const captures = [...next.allDests()].flatMap(([a, ds]) => [...ds].flatMap(b => {
                    if (!next.board.get(b) || next.board.get(b)?.color === next.turn) return [];
                    const step = replayTacticalLine(fen, [makeUci({from:a,to:b})])[0];
                    return [{moveUci:step.uci,san:step.san,victim:next.board.get(b)?.role,
                        gain:tacticalCaptureGain(step),exchange:tacticalExchangeGain(next,step.move)}];
                }));
                return {moveUci:makeUci(move),san,fen,captures};
            }));
            const deferred: any[] = [];
            for (const uci of (ply === 37 ? ["c3a1", "c3e1"] : [39,41].includes(ply) ? ["a1e5"] : [])) {
                const move = parseUci(uci) as NormalMove;
                if (!root.before.isLegal(move)) continue;
                const leaves: any[] = [], trace: any[] = [];
                const gain = proveDefenderCombination(root,[move.to],[move.from,root.move.to],8192,undefined,
                    1,true,90,leaf=>leaves.push(leaf),true,reason=>trace.push(reason),true);
                const line = replayTacticalLine(row.fen,[uci,"g2g4"]);
                expect(line).toHaveLength(2);
                const forkTrace: any[] = [];
                const fork = proveImmediateFork(line[1],(reason,replyUci,remaining)=>forkTrace.push({reason,replyUci,remaining}));
                const repairLeaves: any[] = [], repairTrace: any[] = [];
                const pawn = line[1].after.board.get(line[1].move.to)!;
                const targets = [...attacks(pawn,line[1].move.to,line[1].after.board.occupied)]
                    .filter(square => {const piece=line[1].after.board.get(square);return piece && piece.color!==pawn.color && piece.role!=="king";});
                const forkRecovery = proveDefenderCombination(line[1],targets,[line[1].move.to],16384,undefined,
                    1,true,90,leaf=>repairLeaves.push(leaf),true,reason=>repairTrace.push(reason),true,1);
                if (forkRecovery !== null) {
                    for (const [kind, decisions] of [["root",leaves],["defensive-fork",repairLeaves]] as const) {
                        for (const [index, leaf] of decisions.entries()) {
                            add(`${row.id}:${uci}:${kind}:${index}:best`,leaf.fen);
                            add(`${row.id}:${uci}:${kind}:${index}:held`,leaf.fen,leaf.moveUci);
                            for (const [counterIndex,counter] of (leaf.counterchecks ?? []).entries())
                                add(`${row.id}:${uci}:${kind}:${index}:counter${counterIndex}`,counter.fen,counter.moveUci);
                        }
                    }
                }
                add(`${row.id}:${uci}:held`,row.fen,uci);
                add(`${row.id}:${uci}:reply-best`,makeFen(line[0].after.toSetup()));
                add(`${row.id}:${uci}:g4-held`,makeFen(line[0].after.toSetup()),"g2g4");
                add(`${row.id}:${uci}:after-g4`,makeFen(line[1].after.toSetup()));
                deferred.push({uci,gain,leaves,trace,fork,forkTrace,forkRecovery,repairLeaves,repairTrace,
                    exchange:tacticalExchangeGain(root.before,move),
                    immediateGain:tacticalCaptureGain(line[0])});
            }
            cases.push({id:row.id,fen:row.fen,rootMove:root.uci,rootCapture:root.capture,
                intermediate:intermediateCaptureProof(root),replies,deferred});
        }
        writeFileSync(destination,JSON.stringify({scope:"Private move-order development audit; no production admission or general accuracy claim.",cases,probes},null,2),{flag:"wx"});
        console.log(cases.map(c=>({id:c.id,replies:c.replies.length,intermediate:c.intermediate,
            deferred:c.deferred.map((d: any)=>({uci:d.uci,gain:d.gain,trace:d.trace,fork:d.fork,forkTrace:d.forkTrace,exchange:d.exchange,immediateGain:d.immediateGain}))})));
    },120000);
