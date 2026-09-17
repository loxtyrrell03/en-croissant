// Constructed geometry from the checking-promotion audit, not an owner game.
export const checkingPromotionThreatFen = "8/R7/4k3/2P5/4n3/3K3p/8/4r3 b - - 0 1";
export const checkingPromotionThreatCases = [
    {id:"guarded promotion after checks",fen:checkingPromotionThreatFen,move:"h3h2",gain:400},
    {id:"unguarded promotion can be exchanged",fen:"8/R7/4k3/2P5/4n3/3K3p/8/8 b - - 0 1",move:"h3h2",gain:null},
    {id:"pawn can be captured",fen:"8/8/4k3/2P5/4n3/3K3p/R7/4r3 b - - 0 1",move:"h3h2",gain:null},
];
