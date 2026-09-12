import { expect, test } from "vitest";
import {
    proveExchangeDiscovery,
    replayTacticalLine,
    proveDefenderCombination,
} from "@/utils/tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyPositionTacticalMotifs,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import type { TacticalMotifEvidence } from "@/utils/tacticalMotifs/types";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";

const fen = "2kr1br1/pp1n1p2/2p2p1p/q6b/2BNN3/P2Q3P/1PP2PP1/R3R1K1 b - - 0 15";
const line = ["d7e5", "d3c3", "a5c3", "b2c3", "e5c4"];

// The chess judgement remains: Ne5 is winning. Its old all-defence
// certificate used Nxc4 after b4 and ignored bxa5 winning the queen.
// Preserve the desired coverage as expected failures, not relabelled negatives.
test.fails.each([
    line,
    ["d7e5"],
    ["d7e5", "d3f1", "d8d4"],
    ["d7e5", "d3c3", "a5c3", "c4e6", "f7e6", "e4d6", "f8d6"],
])("the real overloaded-queen discovery does not depend on PV replies: %j", (...pvUci) => {
    const steps = replayTacticalLine(fen, pvUci);
    expect(steps).toHaveLength(pvUci.length);
    const proof = proveExchangeDiscovery(steps[0]);
    expect(proof).not.toBeNull();
    expect(proof?.gain).toBeGreaterThanOrEqual(100);
    const result = classifyPositionTacticalMotifs({ fen, pvUci });
    expect(result.motifs[0]).toMatchObject({ id: "discoveredAttack", ply: 1 });
    expect(result.motifs[0].evidence).toContain("rook on d8 against the knight on d4");
    expect(result.motifs[0].evidence).toContain("Qc3, Qxc3");
    expect(result.motifs.some((m) => m.id === "fork" && m.ply === 1)).toBe(false);
});

test.each([
    [
        "no rook behind the moving knight",
        "2k2br1/pp1n1p2/2p2p1p/q6b/2BNN3/P2Q3P/1PP2PP1/R3R1K1 b - - 0 15",
    ],
    [
        "no queen to exchange the shared defender",
        "2kr1br1/pp1n1p2/2p2p1p/7b/2BNN3/P2Q3P/1PP2PP1/R3R1K1 b - - 0 15",
    ],
])("withhold the root mechanism when a required participant is absent: %s", (_name, position) => {
    const step = replayTacticalLine(position, ["d7e5"])[0];
    expect(step).toBeDefined();
    expect(proveExchangeDiscovery(step)).toBeNull();
    const result = classifyPositionTacticalMotifs({ fen: position, pvUci: ["d7e5"] });
    expect(result.motifs.some((m) => m.id === "discoveredAttack" && m.ply === 1)).toBe(false);
});

test("the unsupported root cannot borrow the old incomplete proof or an invalid budget", () => {
    const step = replayTacticalLine(fen, line)[0];
    const failures: string[] = [];
    expect(proveExchangeDiscovery(step, 8192, (reason) => failures.push(reason))).toBeNull();
    expect(failures.some((reason) => reason.includes("b4"))).toBe(true);
    expect(proveExchangeDiscovery(step, 0)).toBeNull();
    expect(proveExchangeDiscovery(step, 1)).toBeNull();
});

test("checking sacrifices cannot erase already earned material when the next target escapes", () => {
    const exchange = replayTacticalLine(fen, line)[2];
    expect(proveDefenderCombination(exchange, [26, 27], [36, 59, 18])).toBeNull();
    expect(
        proveDefenderCombination(exchange, [26, 27], [36, 59, 18], 8192, undefined, 2),
    ).not.toBeNull();
});

test.fails("the board highlights the root discovery, not the future queen-exchange destination", () => {
    const scan = buildLiveTacticalScan({ fen, pvUci: line, engineName: "Regression", depth: 16 });
    expect(scan.motifs[0].id).toBe("discoveredAttack");
    expect(scan.arrows.map((a) => `${a.from}${a.to}`)).toEqual(
        expect.arrayContaining(["d7e5", "d8d4", "e5d3", "e5c4"]),
    );
    expect(scan.arrows.map((a) => `${a.from}${a.to}`)).not.toContain("a5c3");
});

const rootLesson: TacticalMotifEvidence = {
    id: "discoveredAttack",
    label: "Discovered Attack",
    source: "missed",
    ply: 1,
    moveUci: "d7e5",
    confidence: "high",
    evidence: "The rook and knight attack the queen's two responsibilities.",
    value: 150,
};
const lateFork: TacticalMotifEvidence = {
    id: "fork",
    label: "Fork",
    source: "allowed",
    ply: 5,
    moveUci: "d3f5",
    confidence: "high",
    evidence: "Qf5+ forks the king and bishop after the displayed replies.",
    value: 110,
};

test("the immediate missed cause outranks a smaller fork five plies into another line", () => {
    expect(
        buildMistakeReviewTacticalExplanation({
            missedMotifs: [rootLesson],
            allowedMotifs: [lateFork],
        }),
    ).toMatchObject({ source: "missed", primary: { id: "discoveredAttack", ply: 1 } });
});

test("a later material windfall cannot replace an actual root refutation", () => {
    expect(
        buildMistakeReviewTacticalExplanation({
            missedMotifs: [{ ...lateFork, source: "missed", value: 900 }],
            allowedMotifs: [{ ...rootLesson, source: "allowed" }],
        }),
    ).toMatchObject({ source: "allowed", primary: { id: "discoveredAttack", ply: 1 } });
});

test("a later-only motif is described as conditional rather than the cause of the mistake", () => {
    const result = buildMistakeReviewTacticalExplanation({
        missedMotifs: [],
        allowedMotifs: [lateFork],
    });
    expect(result?.title).toBe("Tactic in the continuation");
    expect(result?.text).toContain("not an immediate refutation");
});

test("a mating consequence still outranks a smaller immediate material gain", () => {
    expect(
        buildMistakeReviewTacticalExplanation({
            missedMotifs: [{ ...lateFork, id: "mateIn2", source: "missed", value: 10000, ply: 3 }],
            allowedMotifs: [{ ...rootLesson, source: "allowed" }],
        }),
    ).toMatchObject({ source: "missed", primary: { id: "mateIn2" } });
});
