import { expect, test } from "vitest";
import fixtures from "../../../benchmarks/decision-evidence/discovered-target-identity/fixtures.json";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import {
    extractTacticalSequenceWitnesses,
    sameTacticalMechanism,
} from "../tacticalMotifs/tacticalSequenceEvidence";

test("a rook recapturing on a cleared file does not attack a newly arrived target in advance", () => {
    const { fen, candidates } = fixtures.newYork;
    const shortLine = { ...candidates[0], pvUci: candidates[0].pvUci.slice(0, 3) };
    expect(extractTacticalSequenceWitnesses(fen, shortLine)).not.toContainEqual(
        expect.objectContaining({ mechanism: "discoveredAttack" }),
    );
    const report = assessChessDecision(fixtures.newYork);
    expect(report?.mistake?.category).toBe("tactical");
    expect(report?.mistake?.missed).toEqual([]);
    expect(report?.mistake?.tactical.reasons.join(" ")).toContain("Rxd5 removes the pawn on d5");
});

test("distinct revealed pieces attacking the same pawn remain distinct tactical mechanisms", () => {
    const probes = fixtures.reykjavik.replyProbes!;
    const [better, played] = probes.map((probe) =>
        extractTacticalSequenceWitnesses(probe.lines[0].fen, probe.lines[0]).find(
            (w) =>
                w.mechanism === "discoveredAttack" &&
                w.mechanismPly === 1 &&
                w.squares.includes("e4"),
        ),
    );
    expect(better?.squares).toEqual(["e5", "e8", "e4"]);
    expect(played?.squares).toEqual(["d4", "c4", "e4"]);
    expect(sameTacticalMechanism(played!, better!)).toBe(false);
    expect(sameTacticalMechanism(played!, played!)).toBe(true);
    const report = assessChessDecision(fixtures.reykjavik);
    expect(report?.mistake?.category).toBe("tactical");
    expect(report?.mistake?.tactical.reasons.join(" ")).toContain("Nf3+ uncovers the queen on c4");
});

test("a delayed capture keeps the ray and original victim through the intervening exchange", () => {
    const root = fixtures.prague;
    const probe = root.replyProbes!.find((p) => p.moveUci === "d4h4")!;
    const continuation = probe.lines.find(
        (line) => line.pvUci.slice(0, 4).join(" ") === "f1h1 h4h1 g2h1 c5f2",
    )!;
    const line = { ...continuation, fen: root.fen, pvUci: [probe.moveUci, ...continuation.pvUci] };
    expect(extractTacticalSequenceWitnesses(root.fen, line)).toContainEqual(
        expect.objectContaining({
            mechanism: "discoveredAttack",
            squares: ["d4", "c5", "f2"],
            mechanismPly: 1,
            payoffPly: 5,
        }),
    );
});

test("an intervening check can collect the recapturer of the discovered slider", () => {
    const fen = "r5k1/ppR2pp1/5q1p/3P1n2/3P1B2/5Q1P/P4PP1/6K1 b - - 2 23";
    const pvUci = ["f5d4", "f3e4", "f6f4", "e4f4", "d4e2", "g1h2", "e2f4"];
    const line = { fen, cp: 0, depth: 20, pvUci };
    expect(extractTacticalSequenceWitnesses(fen, line)).toContainEqual(
        expect.objectContaining({
            mechanism: "discoveredAttack",
            mechanismPly: 1,
            payoffPly: 7,
            lineUci: pvUci,
        }),
    );
});

test("an immediate opportunity keeps its tactical explanation when the target can otherwise escape", () => {
    const report = assessChessDecision(fixtures.boxHill);
    expect(report?.moves[0].tactical.reasons.join(" ")).toContain("exd4 takes the knight on d4");
    expect(report?.moves[0].tactical.reasons.join(" ")).toContain("Nf5");
    expect(report?.position.category).toBe("tactical");
    const mixed = assessChessDecision(fixtures.bavaria);
    expect(mixed?.position.category).toBe("mixed");
    expect(mixed?.position.tactical.reasons.join(" ")).toContain("Qxb1+ takes the rook on b1");
});
