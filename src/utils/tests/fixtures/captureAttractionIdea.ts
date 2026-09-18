// Constructed, reduced exchange/escape-concession layout; not an owner-game FEN.
export const captureAttractionIdeaFen = "r2qk3/pbp1p3/np6/3p4/1P6/2Q1P3/2P5/2KR1B2 w - - 0 1";
export const captureAttractionIdeaLine = ["f1a6", "b7a6", "c3c6", "e8f7", "b4b5", "a6b7", "c6b7"];

export const captureAttractionIdeaCases = [
    {id: "attraction", fen: captureAttractionIdeaFen, cp: 470, positive: true},
    {id: "extra-recapturer", fen: captureAttractionIdeaFen.replace("r2qk3", "rr1qk3"), cp: 300, positive: false},
    {id: "losing-offer", fen: captureAttractionIdeaFen.replace("pbp1p3", "1bp1p3").replace("np6", "n7"), cp: -340, positive: false},
    {id: "stronger-fork", fen: captureAttractionIdeaFen.replace("np6", "n7"), cp: 470, positive: false},
];
