import {reflectMixedForkFen,reflectMixedForkMove} from "./mixedTargetFork";

// Constructed variant: the a-pawn remains on a7. Not an owner-game record.
export const discoveryRecaptureFen =
    "2kr1b1r/pppbqp2/2n2npp/3pp2P/B2PP3/7N/PPP1NPP1/R1BQK2R b KQ - 1 1";
export const discoveryRecaptureLine = ["c6d4","a4d7","d8d7","e2d4","d5e4","h5g6","f7g6","c2c3","e5d4","c3d4"];
export function discoveryRecaptureInput(reflected = false) {
    return {fen:reflected?reflectMixedForkFen(discoveryRecaptureFen):discoveryRecaptureFen,
        pvUci:reflected?discoveryRecaptureLine.map(reflectMixedForkMove):discoveryRecaptureLine};
}
