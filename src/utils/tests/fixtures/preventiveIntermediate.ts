// Shared with direct Node renderer/service harnesses as well as TypeScript.
// @ts-expect-error Node's native TypeScript loader requires the explicit extension.
import { reflectMixedForkFen, reflectMixedForkMove } from "./mixedTargetFork.ts";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";

// Constructed sparse exercise. Owner-game positions stay in private reports.
export const preventiveIntermediateFen = "1k6/8/8/5n1b/8/2bP1N1P/6P1/R2K4 b - - 0 1";
export const preventiveIntermediateLine = ["h5f3", "g2f3", "c3a1"];
export const preventiveIntermediateCases = [
    { id: "positive", fen: preventiveIntermediateFen, positive: true },
    { id: "missing-pawn", fen: preventiveIntermediateFen.replace("6P1", "8"), positive: false },
    { id: "missing-fork-victim", fen: preventiveIntermediateFen.replace("5n1b", "7b"), positive: false },
    { id: "missing-rook", fen: preventiveIntermediateFen.replace("R2K4", "3K4"), positive: false },
    { id: "nonchecking-exchange", fen: preventiveIntermediateFen.replace("R2K4", "R1K5"), positive: false },
    { id: "capturable-pawn-fork", fen: preventiveIntermediateFen.replace("1k6", "1k4r1").replace("2bP1N1P", "2bP1N2"), positive: false },
    // g4 is NOT a successful fork here, but Bxh5 is a different concrete
    // move-order resource. Do not turn failure of one mechanism into no tactic.
    { id: "capture-the-checker", fen: preventiveIntermediateFen.replace("2bP1N1P", "2bP1B1P"), positive: true },
];
export const preventiveIntermediateInputs = () => [...[false, true].flatMap(reflected =>
    preventiveIntermediateCases.map(row => ({ ...row, id: `${row.id}:${reflected ? "white" : "black"}`,
        fen: reflected ? reflectMixedForkFen(row.fen) : row.fen,
        pvUci: [reflected ? reflectMixedForkMove("h5f3") : "h5f3"],
        depth: 18, engineName: "Constructed move-order control",
    }))), ...preventiveIntermediateHistoryInputs()];

export function preventiveIntermediateHistoryInputs() {
    return [false,true].flatMap(reflected => [
        {id:"prior-loss",start:preventiveIntermediateFen.replace("R2K4","r1RK4").replace(" b "," w "),
            moves:["c1a1"],line:preventiveIntermediateLine,positive:true},
        {id:"settled-exchange",start:preventiveIntermediateFen.replace("6P1","r5P1").replace("R2K4","R1RK4"),
            moves:["a2a1","c1a1"],line:preventiveIntermediateLine,positive:true},
        {id:"delayed-recapture",start:"2k5/3q1r1p/8/8/Q6N/5R2/7P/7K b - - 0 1",
            moves:["f7f3"],line:["a4a6","d7b7","a6b7","c8b7","h4f3"],positive:false},
    ].map(row => {
        const flip=(move:string)=>reflected?reflectMixedForkMove(move):move;
        const start=reflected?reflectMixedForkFen(row.start):row.start;
        const position=Chess.fromSetup(parseFen(start).unwrap()).unwrap();
        const moves=row.moves.map(flip);let previousFen=start;
        for(const uci of moves) {
            previousFen=makeFen(position.toSetup());const move=parseUci(uci);
            if(!move || !position.isLegal(move)) throw Error(`Illegal constructed exchange: ${uci}`);
            position.play(move);
        }
        return {id:`${row.id}:${reflected?"white":"black"}`,positive:row.positive,fen:makeFen(position.toSetup()),
            previousFen,previousMoveUci:moves.at(-1)!,tacticalHistory:{fen:start,moves},pvUci:row.line.map(flip),
            depth:18,engineName:"Constructed exchange context"};
    }));
}
