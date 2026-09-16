import type { LiveTacticalScanInput } from "../../tacticalMotifs/liveTactics";

// Constructed transport/selection controls. Scores deliberately put a quiet
// move first; they are not Stockfish judgements of these positions.
export const immediateAlternativeInputs: LiveTacticalScanInput[] = [
    {
        fen: "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5",
        depth: 16, engineName: "Constructed selection", pvUci: ["h2h3"],
        variations: [
            { multipv: 1, depth: 16, pvUci: ["h2h3"], pvSan: ["h3"], cp: 450 },
            { multipv: 2, depth: 16, pvUci: ["e5f7"], pvSan: ["Nxf7"], cp: 400 },
        ],
    },
    {
        fen: "7k/8/8/3n4/2P5/8/7P/6K1 w - - 0 1",
        depth: 16, engineName: "Constructed selection", pvUci: ["h2h3"],
        variations: [
            { multipv: 1, depth: 16, pvUci: ["h2h3"], pvSan: ["h3"], cp: 250 },
            { multipv: 2, depth: 16, pvUci: ["h2h4"], pvSan: ["h4"], cp: 245 },
            { multipv: 3, depth: 16, pvUci: ["c4d5"], pvSan: ["cxd5"], cp: 240 },
        ],
    },
];
