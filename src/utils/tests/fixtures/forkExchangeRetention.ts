import {reflectMixedForkFen,reflectMixedForkMove} from "./mixedTargetFork";

// Constructed variant: the black a-pawn is on a6, not its owner-game square.
export const forkExchangeRetentionFen =
    "2kr1bnr/1qp1pppp/pp6/n2pN3/3P2P1/Q1NPP2P/PP1B1P2/R3K2R w KQ - 0 1";
export const forkExchangeRetentionLine =
    ["e5f7","a5c4","f7d8","c4a3","d8b7","a3c2","e1e2","c2a1","h1a1","c8b7"];
export function forkExchangeRetentionInput(reflected=false) {
    return {fen:reflected?reflectMixedForkFen(forkExchangeRetentionFen):forkExchangeRetentionFen,
        pvUci:reflected?forkExchangeRetentionLine.map(reflectMixedForkMove):forkExchangeRetentionLine};
}
