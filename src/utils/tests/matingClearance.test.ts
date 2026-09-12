import { readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { expect, test } from "vitest";
import {
    matingClearanceEvidence,
    proveCheckingMate,
    proveMatingClearance,
    proveShortCheckingMate,
    replayTacticalLine,
    tacticalBoardEvidence,
} from "../tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan, previewLiveTacticalVariation } from "../tacticalMotifs/liveTactics";

const fixture = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/rare-theme-development.json", "utf8"),
);
const example = fixture.cases.find((row: { id: string }) => row.id === "lichess:NrHkx");

test("the real bishop check clears a rook route to mate against every defence", () => {
    const root = replayTacticalLine(example.startFen, example.bestLine)[0];
    const proof = proveMatingClearance(root);
    if (process.env.TACTICAL_MATING_CLEARANCE_REPORT)
        writeFileSync(
            process.env.TACTICAL_MATING_CLEARANCE_REPORT,
            JSON.stringify(
                {
                    fen: example.startFen,
                    root: root.uci,
                    proof,
                    replies: [...root.after.allDests()].flatMap(([from, targets]) =>
                        [...targets].map((to) => makeSan(root.after, { from, to })),
                    ),
                    after: makeFen(root.after.toSetup()),
                    diagnostic: [...root.after.allDests()].flatMap(([from, targets]) =>
                        [...targets].map((to) => {
                            const next = root.after.clone();
                            next.play({ from, to });
                            const entered = replayTacticalLine(makeFen(next.toSetup()), [
                                "h5c5",
                            ])[0];
                            return {
                                reply: makeSan(root.after, { from, to }),
                                legal: Boolean(entered),
                                mate: entered && proveShortCheckingMate(entered),
                            };
                        }),
                    ),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    expect(proof).not.toBeNull();
    expect(proof).toMatchObject({ square: 34, slider: 39, maxMoves: 4 });
    expect(proof?.branches).toHaveLength(2);
    expect(proof?.branches.find((branch) => branch.reply === "Kb1")).toMatchObject({
        line: ["Kb1", "Bd3#"],
    });
    expect(proof?.branches.find((branch) => branch.reply === "Kb1")?.entryUci).toBeUndefined();
    expect(proof?.branches.find((branch) => branch.reply === "fxe3")?.entryUci).toBe("h5c5");
});

test("the forced mate remains primary and the used clearance is a single supporting mechanism", () => {
    const result = classifyPositionTacticalMotifs({
        fen: example.startFen,
        pvUci: example.bestLine,
    });
    expect(result.motifs[0]).toMatchObject({ id: "mateIn4", ply: 1 });
    const clearance = result.timeline?.filter((m) => m.id === "clearance");
    expect(clearance).toHaveLength(1);
    expect(clearance![0]).toMatchObject({
        label: "Mating Clearance",
        ply: 1,
        relevance: "secondary",
        actor: "black",
    });
    expect(clearance![0].evidence).toContain("Kb1 instead permits Bd3#");
    expect(clearance![0].evidence).toContain("not a compulsory reply");
    expect(tacticalBoardEvidence(example.startFen, example.bestLine, clearance![0])).toEqual({
        square: "c5",
        arrows: [{ from: "h5", to: "c5" }],
    });
    const scan = buildLiveTacticalScan({
        fen: example.startFen,
        pvUci: example.bestLine,
        depth: 16,
        engineName: "Source",
    });
    expect(scan.motifs).toHaveLength(1);
    expect(scan.motifs[0].id).toBe("mateIn4");
    expect(scan.labels.map((label) => ({ id: label.id, square: label.square }))).toEqual([
        { id: "mateIn4", square: "e3" },
        { id: "clearance", square: "c5" },
    ]);
    expect(scan.arrows).toEqual([
        { from: "c5", to: "e3", ply: 1, role: "trigger" },
        { from: "h5", to: "c5", ply: 1, role: "attacker" },
    ]);
    const before = JSON.stringify(scan);
    const preview = previewLiveTacticalVariation(scan, 1);
    expect(preview.labels).toEqual(scan.labels);
    expect(preview.arrows).toEqual(scan.arrows);
    expect(JSON.stringify(scan)).toBe(before);
});

test("the checking root has its own complete mate proof without a terminal PV", () => {
    const result = classifyPositionTacticalMotifs({
        fen: example.startFen,
        pvUci: [example.bestLine[0]],
    });
    expect(result.motifs[0]).toMatchObject({ id: "mateIn4", ply: 1 });
    expect(result.timeline?.some((m) => m.id === "clearance")).toBe(false);
});

test.each([
    ["c5e3", "c1b1", "e2d3"],
    ["c5e3", "f2e3", "h5h1"],
])("a different continuation cannot borrow the cleared rook route: %s %s %s", (...line) => {
    const steps = replayTacticalLine(example.startFen, line);
    expect(steps).toHaveLength(3);
    expect(matingClearanceEvidence(steps, "available")).toBeNull();
    const result = classifyPositionTacticalMotifs({ fen: example.startFen, pvUci: line });
    expect(result.timeline?.some((m) => m.label === "Mating Clearance")).toBe(false);
});

test.each([
    [
        "8/8/2k1B3/2b2p1r/p7/Pp4B1/1P2bPP1/R1K1R3 b - - 3 34",
        "another friendly piece still blocks the rook route",
    ],
    ["8/8/2k1B3/2b5/p7/Pp4B1/1P2bPP1/R1K1R3 b - - 3 34", "the required rook is missing"],
    [
        "8/8/2k1B3/2b4r/p7/P5B1/1P2bPP1/R1K1R3 b - - 3 34",
        "a king flight invalidates the mating proof",
    ],
    [
        "8/8/2k1B3/2b4r/p7/Pp4B1/1P2bPP1/R1K1R3 b - - 98 34",
        "a defender may claim a draw before the checking continuation",
    ],
])("a clearance geometry alone is not a forced mating mechanism: %s (%s)", (fen, _reason) => {
    const steps = replayTacticalLine(fen, ["c5e3"]);
    expect(steps).toHaveLength(1);
    expect(proveMatingClearance(steps[0])).toBeNull();
});

test.each([0, 1, -1, 1.5, NaN, Infinity])(
    "an invalid or exhausted shared search budget cannot certify mate: %s",
    (nodes) => {
        const root = replayTacticalLine(example.startFen, ["c5e3"])[0];
        expect(proveMatingClearance(root, nodes)).toBeNull();
    },
);

test("missing the mating move retains the clearance only in the better continuation", () => {
    const review = classifyMistakeReviewMotifs({
        fen: example.startFen,
        bestMoveUci: "c5e3",
        playedMoveUci: "h5h6",
        pvUci: example.bestLine,
    });
    expect(buildMistakeReviewTacticalExplanation(review)?.primary).toMatchObject({
        id: "mateIn4",
        source: "missed",
    });
    expect(review.missedTimeline).toContainEqual(
        expect.objectContaining({
            id: "clearance",
            ply: 1,
            relevance: "secondary",
            source: "missed",
        }),
    );
});

test("an announced fifty-move claim refutes the root mate even with a mating PV", () => {
    const fen = example.startFen.replace("3 34", "98 34");
    const steps = replayTacticalLine(fen, example.bestLine);
    expect(proveCheckingMate(steps)).toBeNull();
    const result = classifyPositionTacticalMotifs({ fen, pvUci: example.bestLine });
    expect(result.motifs.some((m) => m.ply === 1 && m.label === "Forcing Mate")).toBe(false);
    expect(result.timeline?.some((m) => m.label === "Mating Clearance")).toBe(false);
});

test("a timely resetting capture and immediate checkmate remain valid at the boundary", () => {
    const fen = example.startFen.replace("3 34", "97 34");
    expect(proveMatingClearance(replayTacticalLine(fen, example.bestLine)[0])).not.toBeNull();
    const reached = replayTacticalLine(example.startFen, ["c5e3", "c1b1"])[1].after;
    reached.halfmoves = 99;
    const steps = replayTacticalLine(makeFen(reached.toSetup()), ["e2d3"]);
    expect(steps[0].after.isCheckmate()).toBe(true);
    expect(proveCheckingMate(steps)).not.toBeNull();
    expect(
        classifyPositionTacticalMotifs({ fen: makeFen(reached.toSetup()), pvUci: ["e2d3"] })
            .motifs[0],
    ).toMatchObject({ id: "doubleBishopMate", value: 10000 });
});

const lineClearanceFen = "8/8/8/8/3b3r/1p1k4/1Bb5/KR1n4 b - - 0 1";
test("attraction and clearance do not acquire a third generic mate badge at the same move", () => {
    const fen = "r6r/6k1/1b6/8/4nn2/8/7P/7K b - - 0 1";
    const pvUci = ["h8h2", "h1h2", "a8h8"];
    const steps = replayTacticalLine(fen, pvUci);
    expect(steps).toHaveLength(3);
    expect(steps[2].after.isCheckmate()).toBe(true);
    const result = classifyPositionTacticalMotifs({ fen, pvUci });
    expect(result.motifs[0]).toMatchObject({ id: "attraction", relevance: "primary" });
    const immediate = result.timeline?.filter((m) => m.ply === 1);
    expect(immediate?.map((m) => m.id)).toEqual(["attraction", "clearance"]);
});
const lineClearance = ["d4b2", "b1b2", "h4a4", "b2a2", "a4a2"];
test("capture clearance can open a rook route through the vacated square, not only onto it", () => {
    const steps = replayTacticalLine(lineClearanceFen, lineClearance);
    expect(steps).toHaveLength(5);
    expect(steps[4].after.isCheckmate()).toBe(true);
    const proof = proveMatingClearance(steps[0]);
    expect(proof).toMatchObject({ square: 27, slider: 31 });
    expect(proof?.branches.every((branch) => branch.entryUci === "h4a4")).toBe(true);
    expect(matingClearanceEvidence(steps, "available")?.evidence).toContain("clears d4");
});

test("a queen can use the cleared square, without changing the meaning of the label", () => {
    const fen = example.startFen.replace("2b4r", "2b4q");
    const steps = replayTacticalLine(fen, example.bestLine);
    expect(steps).toHaveLength(7);
    expect(proveMatingClearance(steps[0])).not.toBeNull();
    expect(matingClearanceEvidence(steps, "available")?.evidence).toContain("queen on h5");
});

test("colour reflection preserves the all-defence branches, timing and geometry", () => {
    const [placement, turn, castling, ep, halfmoves, fullmoves] = example.startFen.split(" ");
    const reflected = [
        placement
            .split("/")
            .reverse()
            .join("/")
            .replace(/[a-z]/gi, (piece: string) =>
                piece === piece.toUpperCase() ? piece.toLowerCase() : piece.toUpperCase(),
            ),
        turn === "w" ? "b" : "w",
        castling,
        ep,
        halfmoves,
        fullmoves,
    ].join(" ");
    const moves = example.bestLine.map((move: string) =>
        move.replace(/[1-8]/g, (rank) => String(9 - Number(rank))),
    );
    const proof = proveMatingClearance(replayTacticalLine(reflected, moves)[0]);
    const original = proveMatingClearance(
        replayTacticalLine(example.startFen, example.bestLine)[0],
    );
    expect(proof?.maxMoves).toBe(original?.maxMoves);
    expect(proof?.visits).toBe(original?.visits);
    const result = classifyPositionTacticalMotifs({ fen: reflected, pvUci: moves });
    const clearance = result.timeline?.find((m) => m.label === "Mating Clearance");
    expect(clearance).toMatchObject({ ply: 1, actor: "white", relevance: "secondary" });
    expect(tacticalBoardEvidence(reflected, moves, clearance)).toEqual({
        square: "c4",
        arrows: [{ from: "h4", to: "c4" }],
    });
});

test.each([
    ["6bk/6p1/6P1/8/2B4B/8/8/K6R w - - 0 1", ["h4f6", "g8h7", "h1h7"], "discoveredCheck"],
    ["7k/5b2/6P1/8/7B/8/8/K6R w - - 0 1", ["h4f6", "h8g8", "h1h8"], "doubleCheck"],
] as const)(
    "an opened checking ray takes its precise name, not a duplicate clearance: %s",
    (fen, line, id) => {
        const steps = replayTacticalLine(fen, [...line]);
        expect(steps).toHaveLength(3);
        expect(steps[2].after.isCheckmate()).toBe(true);
        const motif = matingClearanceEvidence(steps, "available");
        expect(motif?.id).toBe(id);
        const geometry = tacticalBoardEvidence(fen, [...line], {
            ...motif!,
            relevance: "secondary",
        });
        expect(geometry?.arrows).toContainEqual({ from: "h1", to: "h8" });
        expect(geometry?.arrows).toHaveLength(id === "doubleCheck" ? 2 : 1);
        expect(
            classifyPositionTacticalMotifs({ fen, pvUci: [...line] }).timeline?.some(
                (m) => m.id === "clearance",
            ),
        ).toBe(false);
    },
);

test.skipIf(
    !process.env.TACTICAL_MATING_CLEARANCE_PRIVATE_INPUT ||
        !process.env.TACTICAL_MATING_CLEARANCE_PRIVATE_PROBES,
)("audit every newly reached private mating mechanism without exporting paid positions", () => {
    const input = JSON.parse(
        readFileSync(process.env.TACTICAL_MATING_CLEARANCE_PRIVATE_INPUT!, "utf8"),
    );
    const seen = new Set<string>();
    const cases: unknown[] = [];
    const probes: { id: string; fen: string; searchMove?: string; mateWithin: number }[] = [];
    for (const group of input.results)
        for (const row of group.cases) {
            for (const line of [
                row.sourceUci,
                ...row.engineLines.map((line: { pvUci: string[] }) => line.pvUci),
            ]) {
                const steps = replayTacticalLine(row.fen, line);
                for (let index = 0; index < steps.length; index++) {
                    const motif = matingClearanceEvidence(steps.slice(index), "available");
                    if (!motif) continue;
                    const root = steps[index];
                    const key = `${makeFen(root.before.toSetup())}:${root.uci}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const proof = proveMatingClearance(root)!;
                    const prefix = `${row.id}:ply-${index + 1}`;
                    cases.push({ id: prefix, motif, proof });
                    probes.push({
                        id: `${prefix}:root`,
                        fen: makeFen(root.before.toSetup()),
                        searchMove: root.uci,
                        mateWithin: proof.maxMoves,
                    });
                    proof.witnesses.forEach((witness, index) =>
                        probes.push({
                            id: `${prefix}:witness-${index + 1}`,
                            fen: witness.fen,
                            searchMove: witness.move,
                            mateWithin: 3,
                        }),
                    );
                }
            }
        }
    expect(cases.length).toBeGreaterThanOrEqual(6);
    writeFileSync(
        process.env.TACTICAL_MATING_CLEARANCE_PRIVATE_PROBES!,
        JSON.stringify(
            {
                samplePath: "benchmarks/tactical-relevance/rare-theme-development.json",
                cases,
                probes,
            },
            null,
            2,
        ),
        { flag: "wx" },
    );
});

test.skipIf(!process.env.TACTICAL_MATING_CLEARANCE_PRIVATE_INPUT)("nearby same-rank board labels retain the main badge without losing the clearance arrow", () => {
    const input = JSON.parse(readFileSync(process.env.TACTICAL_MATING_CLEARANCE_PRIVATE_INPUT!, "utf8"));
    const row = input.results.flatMap((group: {cases: {id: string}[]}) => group.cases).find((row: {id: string}) => row.id === "private-easy:211");
    expect(row).toBeDefined();
    const scan = buildLiveTacticalScan({fen: row.fen, pvUci: row.sourceUci, depth: 16, engineName: "Private source"});
    expect(scan.motifs[0].id).toBe("mateIn3");
    expect(scan.labels).toHaveLength(1);
    expect(scan.variations[0].timeline).toContainEqual(expect.objectContaining({id: "clearance", ply: 1}));
    expect(scan.arrows).toHaveLength(2);
    expect(previewLiveTacticalVariation(scan, 1).labels).toEqual(scan.labels);
});

test.skipIf(!process.env.TACTICAL_MATING_CLEARANCE_PROBES)(
    "record every selected mating answer for fresh engine review",
    () => {
        const probes: { id: string; fen: string; searchMove?: string; mateWithin?: number }[] = [];
        for (const [id, fen, move] of [
            ["real", example.startFen, "c5e3"],
            ["line-clearance", lineClearanceFen, "d4b2"],
            ["queen-clearance", example.startFen.replace("2b4r", "2b4q"), "c5e3"],
            ["discovered-check", "6bk/6p1/6P1/8/2B4B/8/8/K6R w - - 0 1", "h4f6"],
            ["double-check", "7k/5b2/6P1/8/7B/8/8/K6R w - - 0 1", "h4f6"],
        ]) {
            const proof = proveMatingClearance(replayTacticalLine(fen, [move])[0]);
            expect(proof).not.toBeNull();
            probes.push(
                { id: `${id}:best`, fen, mateWithin: 4 },
                { id: `${id}:root`, fen, searchMove: move, mateWithin: 4 },
            );
            proof!.witnesses.forEach((witness, index) =>
                probes.push({
                    id: `${id}:witness-${index + 1}`,
                    fen: witness.fen,
                    searchMove: witness.move,
                    mateWithin: 3,
                }),
            );
        }
        const declined = replayTacticalLine(example.startFen, ["c5e3", "c1b1"])[1];
        probes.push({
            id: "declined:premature-rook-entry",
            fen: makeFen(declined.after.toSetup()),
            searchMove: "h5c5",
        });
        for (const [id, fen, move] of [
            ["blocked-route", example.startFen.replace("2b4r", "2b2p1r"), "c5e3"],
            ["king-flight", example.startFen.replace("Pp4B1", "P5B1"), "c5e3"],
            ["missed-mate", example.startFen, "h5h6"],
        ])
            probes.push({ id, fen, searchMove: move });
        writeFileSync(
            process.env.TACTICAL_MATING_CLEARANCE_PROBES!,
            JSON.stringify(
                { samplePath: "benchmarks/tactical-relevance/rare-theme-development.json", probes },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);
