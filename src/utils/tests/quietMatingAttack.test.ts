import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    proveQuietMatingAttack,
    proveCheckingDeflection,
    replayTacticalLine,
    tacticalBoardEvidence,
    intermediateCaptureProof,
    provePinnedCapture,
    tacticalExchangeGain,
    winningRecaptureEvidence,
} from "../tacticalMotifs/causalTactics";

const fixture = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/rare-theme-development.json", "utf8"),
);
const example = fixture.cases.find((row: { id: string }) => row.id === "lichess:nBrWE");

test("the pinned queen can capture its pinner: a remote pawn is not a profitable pin tactic", () => {
    const steps = replayTacticalLine(example.startFen, [
        ...example.bestLine,
        "g1g2",
        "e5b2",
        "g2e4",
    ]);
    expect(steps).toHaveLength(8);
    expect(steps[7].san).toBe("Qxe4");
    expect(provePinnedCapture(steps[6])).toBeNull();
    const result = classifyPositionTacticalMotifs({
        fen: makeFen(steps[6].before.toSetup()),
        pvUci: ["e5b2", "g2e4"],
    });
    expect(result.motifs.some((m) => m.id === "pin")).toBe(false);
});

test("the quiet bishop move has a new mating threat and independently checked material defences", () => {
    const root = replayTacticalLine(example.startFen, example.bestLine)[0];
    const failures: string[] = [];
    const proof = proveQuietMatingAttack(root, 8192, (reason) => failures.push(reason));
    if (process.env.TACTICAL_QUIET_MATING_ATTACK_REPORT)
        writeFileSync(
            process.env.TACTICAL_QUIET_MATING_ATTACK_REPORT,
            JSON.stringify(
                {
                    fen: example.startFen,
                    move: root.uci,
                    proof,
                    classification: classifyPositionTacticalMotifs({
                        fen: example.startFen,
                        pvUci: example.bestLine,
                    }),
                    checkingDeflection: proveCheckingDeflection(
                        replayTacticalLine(example.startFen, example.bestLine)[2],
                    ),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    expect({ proof, failures }).toMatchObject({ proof: expect.any(Object), failures: [] });
    expect(proof).toMatchObject({ threatSan: "Qh2#", gain: 330 });
    expect(proof?.branches).toContainEqual(expect.objectContaining({ reply: "Qg2", gain: 330 }));
    expect(proof?.branches).toHaveLength(32);
    expect(proof?.branches).toContainEqual({ reply: "Qf8+", gain: 800, line: ["Kxf8"] });
    expect(proof?.visits).toBeLessThan(8192);
});

test.each([
    ["bishop cannot support the mating square", example.startFen, "d4c5"],
    ["the threatened queen can be captured", example.startFen.replace("PP6", "PP4R1"), "d4e5"],
    ["a rook can take the mating partner", example.startFen.replace("5Q1K", "5QRK"), "d4e5"],
    [
        "there is no new piece to win; retaining an existing extra bishop is not a fresh gain",
        example.startFen.replace("2PbB2p", "2Pb3p"),
        "d4e5",
    ],
    [
        "an announced fifty-move claim is available",
        example.startFen.replace("0 35", "98 35"),
        "d4e5",
    ],
])("geometry alone cannot prove a quiet mating attack: %s", (_name, fen, move) => {
    const steps = replayTacticalLine(fen, [move]);
    expect(steps).toHaveLength(1);
    expect(proveQuietMatingAttack(steps[0])).toBeNull();
});

test("an already existing mate cannot justify an unrelated quiet move", () => {
    const after = replayTacticalLine(example.startFen, ["d4e5"])[0].after.clone();
    after.turn = "black";
    const root = replayTacticalLine(makeFen(after.toSetup()), ["a7a6"])[0];
    expect(root).toBeDefined();
    expect(proveQuietMatingAttack(root)).toBeNull();
});

test("colour reflection preserves the fresh threat and bounded all-defence gain", () => {
    const fields = example.startFen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c: string) =>
            c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase(),
        );
    fields[1] = "w";
    const move = "d5e4";
    const root = replayTacticalLine(fields.join(" "), [move])[0];
    const proof = proveQuietMatingAttack(root);
    expect(proof).toMatchObject({ gain: 330, threatSan: "Qh7#" });
    expect(proof?.branches).toHaveLength(32);
});

test("invalid and exhausted budgets cannot borrow a cached success", () => {
    const root = replayTacticalLine(example.startFen, example.bestLine)[0];
    expect(proveQuietMatingAttack(root)).not.toBeNull();
    for (const nodes of [0, 1, 50, -1, 1.5, NaN, Infinity])
        expect(proveQuietMatingAttack(root, nodes)).toBeNull();
});

test("the quiet threat explains the first move without borrowing a later capture or forced mate", () => {
    for (const pvUci of [example.bestLine, [example.bestLine[0]], ["d4e5", "b2b3", "g3h2"]]) {
        const result = classifyPositionTacticalMotifs({ fen: example.startFen, pvUci });
        expect(result.motifs[0]).toMatchObject({
            id: "forcingAttack",
            label: "Mating Attack",
            ply: 1,
            value: 330,
        });
        expect(result.motifs[0].evidence).toContain("not a forced-mate claim");
        expect(result.motifs[0].evidence).toContain("Qg2, Qe1+ Qg1 Qxe4+");
        expect(result.motifs.some((m) => m.ply === 1 && m.value === 10000)).toBe(false);
    }
    const scan = buildLiveTacticalScan({
        fen: example.startFen,
        pvUci: example.bestLine,
        depth: 16,
        engineName: "Source",
    });
    expect(scan.labels).toHaveLength(1);
    expect(scan.arrows).toEqual([
        { from: "d4", to: "e5", ply: 1, role: "trigger" },
        { from: "g3", to: "h2", ply: 1, role: "attacker" },
    ]);
    const review = classifyMistakeReviewMotifs({
        fen: example.startFen,
        bestMoveUci: "d4e5",
        playedMoveUci: "b7b6",
        pvUci: example.bestLine,
    });
    expect(buildMistakeReviewTacticalExplanation(review)?.primary).toMatchObject({
        id: "forcingAttack",
        source: "missed",
        ply: 1,
    });
});

test("the subsequent queen check, not the quiet bishop move, deflects the bishop's guard", () => {
    const steps = replayTacticalLine(example.startFen, example.bestLine);
    expect(proveCheckingDeflection(steps[0])).toBeNull();
    const proof = proveCheckingDeflection(steps[2]);
    expect(proof).toMatchObject({ guard: 14, target: 28, gain: 330 });
    expect(proof?.branches).toEqual([
        { reply: "Qf1", replyUci: "g2f1", capture: "Qxe4+", captureUci: "e1e4", gain: 330 },
        { reply: "Qg1", replyUci: "g2g1", capture: "Qxe4+", captureUci: "e1e4", gain: 330 },
    ]);
    const result = classifyPositionTacticalMotifs({
        fen: example.startFen,
        pvUci: example.bestLine,
    });
    expect(result.motifs[0]).toMatchObject({ label: "Mating Attack", ply: 1 });
    expect(result.timeline).toContainEqual(
        expect.objectContaining({
            id: "deflection",
            ply: 3,
            relevance: "secondary",
            moveUci: "g3e1",
        }),
    );
    const reached = classifyPositionTacticalMotifs({
        fen: makeFen(steps[2].before.toSetup()),
        pvUci: example.bestLine.slice(2),
    });
    expect(reached.motifs[0]).toMatchObject({ id: "deflection", ply: 1, value: 330 });
    const rootOnly = classifyPositionTacticalMotifs({
        fen: makeFen(steps[2].before.toSetup()),
        pvUci: ["g3e1"],
    });
    expect(rootOnly.motifs[0]).toMatchObject({ id: "deflection", ply: 1, value: 330 });
    expect(
        tacticalBoardEvidence(makeFen(steps[2].before.toSetup()), ["g3e1"], rootOnly.motifs[0]),
    ).toEqual({ square: "g2", arrows: [{ from: "g2", to: "e4" }] });
});

test.each(["other-interposer", "pinned-guard", "countercheck", "missing-target"])(
    "a checking-deflection proof must establish real loss of protection: %s",
    (kind) => {
        const before = replayTacticalLine(example.startFen, example.bestLine)[2].before;
        const fen = makeFen(before.toSetup());
        const modified =
            kind === "other-interposer"
                ? fen.replace("2P1B2p", "2P1BR1p")
                : kind === "pinned-guard"
                  ? fen.replace("6qP", "5bqP")
                  : kind === "countercheck"
                    ? fen.replace("pp4k1", "pp3k2")
                    : fen.replace("2P1B2p", "2P4p");
        expect(modified).not.toBe(fen);
        const steps = replayTacticalLine(modified, ["g3e1"]);
        expect(steps).toHaveLength(1);
        expect(proveCheckingDeflection(steps[0])).toBeNull();
    },
);

test("checking-deflection proof preserves its guard and gain under colour reflection", () => {
    const before = replayTacticalLine(example.startFen, example.bestLine)[2].before;
    const fields = makeFen(before.toSetup()).split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "w";
    const root = replayTacticalLine(fields.join(" "), ["g6e8"])[0];
    expect(proveCheckingDeflection(root)).toMatchObject({ guard: 54, target: 36, gain: 330 });
    for (const limit of [0, 1, -1, NaN, Infinity, 1.5])
        expect(proveCheckingDeflection(root, limit)).toBeNull();
});

test("a deflection payoff cannot borrow a remote pawn capture which leaves the queen hanging", () => {
    const steps = replayTacticalLine(example.startFen, [
        ...example.bestLine,
        "g1g2",
        "e5b2",
        "g2e4",
    ]);
    expect(steps).toHaveLength(8);
    expect(steps[7].san).toBe("Qxe4");
    expect(tacticalExchangeGain(steps[7].before, steps[7].move)).toBe(900);
    expect(intermediateCaptureProof(steps[4])).toBeNull();
    const result = classifyPositionTacticalMotifs({
        fen: example.startFen,
        pvUci: example.bestLine,
    });
    expect(result.timeline?.some((m) => m.id === "intermezzo")).toBe(false);
    expect(result.timeline).toContainEqual(
        expect.objectContaining({ label: "Deflection Payoff", ply: 5, value: 330 }),
    );
    const standalone = classifyPositionTacticalMotifs({
        fen: makeFen(steps[4].before.toSetup()),
        pvUci: [steps[4].uci],
    });
    expect(standalone.motifs[0]).toMatchObject({
        id: "hangingPiece",
        label: "Hanging Piece",
        value: 330,
    });
    const unrelated = replayTacticalLine(example.startFen, [
        "d4e5",
        "f1g1",
        "g3e1",
        "g1f1",
        "e1e4",
    ]);
    expect(unrelated).toHaveLength(5);
    expect(winningRecaptureEvidence(unrelated, 4, standalone.motifs[0])?.label).not.toBe(
        "Deflection Payoff",
    );
});
