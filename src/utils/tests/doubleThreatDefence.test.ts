import { expect, test } from "vitest";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";

// Independently replay the newly identified defence. These branches are not
// an all-replies proof and must not alone certify a causal comparison.
const fen = "r5k1/5pp1/Br2p3/1PNpPb1q/3P4/4P1Q1/5K1P/6R1 b - - 6 32";

test("Bg6 keeps the legal pawn capture against Nd7's checking fork", () => {
    const defended = replayTacticalLine(fen, ["f5g6", "c5d7", "a8a6", "d7f6", "g7f6"]);
    const exposed = replayTacticalLine(fen, ["g7g6", "c5d7", "a8a6", "d7f6", "g7f6"]);
    expect(defended).toHaveLength(5);
    expect(defended[2].san).toBe("Raxa6");
    expect(defended[3].san).toBe("Nf6+");
    expect(defended[4].san).toBe("gxf6");
    expect(exposed).toHaveLength(4);
});

test("Raxa6 supplies compensation, but bxa6 Rxa6 still concedes 70 cp locally", () => {
    const pawn = replayTacticalLine(fen, ["f5g6", "c5d7", "a8a6", "b5a6", "b6a6"]);
    const knight = replayTacticalLine(fen, ["f5g6", "c5d7", "a8a6", "d7b6", "a6b6"]);
    expect(pawn).toHaveLength(5);
    expect(knight).toHaveLength(5);
    // Balance is from the initial side (Black); bishop/knight = 330/320 cp.
    expect(pawn[4].balance).toBe(-70);
    expect(knight[4].balance).toBe(150);
});
