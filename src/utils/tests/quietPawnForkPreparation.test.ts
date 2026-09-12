import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { makeUci, parseUci } from "chessops/util";
import {
    proveQuietPawnFork,
    proveCaptureForkPreparation,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

const simple = "5bk1/5ppp/8/8/3pr3/8/2RRN3/7K b - - 0 1";
const line = ["e4e2", "d2e2", "d4d3"];
test("an independently constructed rook offer deflects the pawn's guard into a quiet fork", () => {
    const failures: string[] = [];
    const root = replayTacticalLine(simple, line)[0];
    const proof = proveCaptureForkPreparation(root, 8192, (f) => failures.push(f));
    expect({ proof, failures }).toMatchObject({
        proof: { gain: expect.any(Number) },
        failures: [],
    });
    expect(classifyPositionTacticalMotifs({ fen: simple, pvUci: line }).motifs[0]).toMatchObject({
        id: "forkPreparation",
        ply: 1,
    });
});

test("the actual quiet fork is shown at ply three, with no premature fork arrows", () => {
    const result = classifyPositionTacticalMotifs({ fen: simple, pvUci: line });
    expect(result.motifs.map((m) => m.id)).toEqual(["forkPreparation"]);
    expect(result.timeline?.filter((m) => m.id === "fork").map((m) => m.ply)).toEqual([3]);
    expect(result.timeline?.some((m) => m.ply === 2 && m.id === "hangingPiece")).toBe(false);
    const scan = buildLiveTacticalScan({
        fen: simple,
        pvUci: line,
        depth: 16,
        engineName: "Constructed",
    });
    expect(scan.arrows.map((a) => a.from + a.to)).toContain("d2e2");
    expect(scan.arrows.map((a) => a.from + a.to)).not.toContain("d3c2");
    const after = makeFen(replayTacticalLine(simple, line)[1].after.toSetup());
    const fork = buildLiveTacticalScan({
        fen: after,
        pvUci: [line[2]],
        depth: 16,
        engineName: "Constructed",
    });
    expect(fork.arrows.map((a) => a.from + a.to)).toEqual(expect.arrayContaining(["d3c2", "d3e2"]));
});

test("root-only, a declined offer and colour reflection preserve the preparation", () => {
    for (const pvUci of [[line[0]], [line[0], "h1g1"]])
        expect(classifyPositionTacticalMotifs({ fen: simple, pvUci }).motifs[0]).toMatchObject({
            id: "forkPreparation",
            ply: 1,
        });
    const reflected = "7k/2rrn3/8/3PR3/8/8/5PPP/5BK1 w - - 0 1";
    const moves = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    expect(
        classifyPositionTacticalMotifs({ fen: reflected, pvUci: moves }).motifs[0],
    ).toMatchObject({ id: "forkPreparation", ply: 1 });
});

test("playing the pawn too early misses the preparation rather than a future fork", () => {
    const review = classifyMistakeReviewMotifs({
        fen: simple,
        playedMoveUci: "d4d3",
        bestMoveUci: line[0],
        pvUci: line,
        refutationUci: ["d2d3"],
    });
    expect(review.missedMotifs[0]).toMatchObject({ id: "forkPreparation", ply: 1 });
    expect(review.missedMotifs[0].evidence).toContain("Playing d3 first instead allows Rxd3");
    expect(buildMistakeReviewTacticalExplanation(review)?.primary).toMatchObject({
        id: "forkPreparation",
        source: "missed",
    });
});

test.each([
    ["6k1/5ppp/8/8/3pr3/8/2RRN3/7K b - - 0 1", "a rook checkmates before the pawn can capture"],
    ["5bk1/5ppp/6B1/8/3pr3/8/2RRN3/7K b - - 0 1", "a separate bishop can capture the forking pawn"],
    ["5bk1/5ppp/8/8/4r3/8/2RRN3/7K b - - 0 1", "the missing pawn cannot fork"],
] as const)("abstains on a refuted preparation: %s (%s)", (fen, _reason) => {
    const steps = replayTacticalLine(fen, [line[0]]);
    expect(steps).toHaveLength(1);
    expect(proveCaptureForkPreparation(steps[0])).toBeNull();
    expect(
        classifyPositionTacticalMotifs({ fen, pvUci: [line[0]] }).motifs.some(
            (m) => m.id === "forkPreparation",
        ),
    ).toBe(false);
});

test("budget exhaustion never borrows a cached successful pawn proof", () => {
    const steps = replayTacticalLine(simple, line);
    expect(proveQuietPawnFork(steps[2])).not.toBeNull();
    for (const limit of [0, -1, 1, 1.5, NaN, Infinity]) {
        expect(proveQuietPawnFork(steps[2], limit)).toBeNull();
        expect(proveCaptureForkPreparation(steps[0], limit)).toBeNull();
    }
    expect(proveQuietPawnFork(steps[2])).not.toBeNull();
});

test("an unchanged quiet preparation is not blamed on an unrelated pawn move", () => {
    const before = "5bk1/5ppp/8/8/3pr3/8/P1RRN3/7K w - - 0 1";
    const result = classifyMistakeReviewMotifs({
        fen: before,
        playedMoveUci: "a2a3",
        bestMoveUci: "a2a4",
        pvUci: ["a2a4", ...line],
        refutationUci: line,
    });
    expect(result.allowedMotifs[0]).toMatchObject({ id: "forkPreparation", ply: 1 });
    expect(["prevented", "reduced"]).not.toContain(result.allowedMotifs[0].comparison);
});

test.skipIf(!process.env.TACTICAL_PRIVATE_THIRD_SAMPLE)(
    "the advanced pawn fork includes the rook countercapture and promotions",
    async () => {
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_THIRD_SAMPLE!, "utf8"));
        const row = sample.cases.find((r: { id: string }) => r.id === "private-easy:105");
        const step = replayTacticalLine(row.fen, row.sourceUci)[2];
        const failures: string[] = [];
        const leaves: { fen: string; moveUci: string; gain: number }[] = [];
        const proof = proveQuietPawnFork(
            step,
            16384,
            280,
            (f) => failures.push(f),
            (leaf) => leaves.push(leaf),
        );
        expect({ proof, failures }).toMatchObject({
            proof: { gain: expect.any(Number) },
            failures: [],
        });
        expect(proveQuietPawnFork(replayTacticalLine(row.fen, ["d4d3"])[0])).toBeNull();
        const rootFailures: string[] = [];
        const preparation = proveCaptureForkPreparation(
            replayTacticalLine(row.fen, row.sourceUci)[0],
            8192,
            (f) => rootFailures.push(f),
        );
        expect({ preparation, rootFailures }).toMatchObject({
            preparation: { gain: expect.any(Number) },
            rootFailures: [],
        });
        expect(
            classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.sourceUci[0]] }).motifs[0],
        ).toMatchObject({ id: "forkPreparation", ply: 1 });
        const standalone = proveQuietPawnFork(step, 16384, 100, undefined, (leaf) =>
            leaves.push(leaf),
        );
        expect(standalone).not.toBeNull();
        const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci });
        expect(result.motifs[0]).toMatchObject({ id: "forkPreparation", ply: 1, value: 220 });
        expect(result.timeline?.find((m) => m.id === "fork")).toMatchObject({ ply: 3 });
        expect(result.timeline?.find((m) => m.id === "discoveredCheck")).toMatchObject({ ply: 5 });
        expect(result.timeline?.some((m) => m.id === "intermezzo" && m.ply === 5)).toBe(false);
        const review = classifyMistakeReviewMotifs({
            fen: row.fen,
            playedMoveUci: "d4d3",
            bestMoveUci: row.sourceUci[0],
            pvUci: row.sourceUci,
            refutationUci: ["d2d3"],
        });
        expect(review.missedMotifs[0]).toMatchObject({ id: "forkPreparation", ply: 1 });
        const delayedLine = [row.sourceUci[0], "d7g4", "g8h7", row.sourceUci[1], row.sourceUci[2]];
        const delayedResult = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: delayedLine });
        expect(
            delayedResult.timeline?.filter((m) => m.ply === 4 && m.id === "hangingPiece"),
        ).toEqual([]);
        expect(delayedResult.timeline?.find((m) => m.id === "fork")).toMatchObject({ ply: 5 });
        if (process.env.TACTICAL_QUIET_PAWN_REPORT) {
            const { privateReportPath } =
                await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
            const probes: { id: string; fen: string; searchMove: string; localGain?: number }[] =
                [];
            const afterOffer = replayTacticalLine(row.fen, row.sourceUci)[0].after;
            const witness = (id: string, start: Chess, reply: string, answer: string) => {
                const pos = start.clone();
                const response = parseSan(pos, reply)!;
                if (!response) throw new Error(`Invalid defensive witness: ${reply}`);
                pos.play(response);
                const move = parseSan(pos, answer)!;
                if (!move) throw new Error(`Invalid attacking witness: ${answer}`);
                probes.push({ id, fen: makeFen(pos.toSetup()), searchMove: makeUci(move) });
                pos.play(move);
                return pos;
            };
            for (const branch of preparation!.branches)
                witness(`accept:${branch.reply}`, afterOffer, branch.reply, branch.answer);
            for (const branch of preparation!.declined) {
                const next = witness(
                    `decline:${branch.reply}`,
                    afterOffer,
                    branch.reply,
                    branch.answer,
                );
                for (const delayed of branch.delayedForks ?? []) {
                    const accepted = next.clone();
                    accepted.play(parseSan(accepted, delayed.acceptance)!);
                    const fork = parseSan(accepted, delayed.fork)!;
                    const steps = replayTacticalLine(makeFen(accepted.toSetup()), [makeUci(fork)]);
                    if (
                        !proveQuietPawnFork(steps[0], 16384, 280, undefined, (leaf) =>
                            leaves.push(leaf),
                        )
                    )
                        throw new Error("The delayed quiet-fork audit lost its proof");
                }
            }
            for (const branch of [...proof!.branches, ...standalone!.branches])
                witness(
                    `fork:${branch.reply}:${branch.gain}`,
                    step.after,
                    branch.reply,
                    branch.answer,
                );
            for (const leaf of leaves)
                probes.push({
                    id: `leaf:${probes.length}`,
                    fen: leaf.fen,
                    searchMove: leaf.moveUci,
                    localGain: leaf.gain,
                });
            for (const [name, fen, moves, searchMove] of [
                ["constructed-root", simple, [], line[0]],
                ["constructed-premature", simple, ["d4d3"], "d2d3"],
                ["checking-escape", "6k1/5ppp/8/8/3pr3/8/2RRN3/7K b - - 0 1", line, "e2e8"],
                ["extra-bishop", "5bk1/5ppp/6B1/8/3pr3/8/2RRN3/7K b - - 0 1", line, "g6d3"],
            ] as const) {
                const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
                for (const uci of moves) {
                    const move = parseUci(uci)!;
                    if (!pos.isLegal(move)) throw new Error(`Illegal control move: ${uci}`);
                    pos.play(move);
                }
                probes.push({ id: name, fen: makeFen(pos.toSetup()), searchMove });
            }
            const seen = new Set<string>();
            const unique = probes.filter((p) => {
                const key = p.fen + ":" + p.searchMove;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            writeFileSync(
                privateReportPath(process.env.TACTICAL_QUIET_PAWN_REPORT),
                JSON.stringify(
                    {
                        samplePath: process.env.TACTICAL_PRIVATE_THIRD_SAMPLE,
                        fen: row.fen,
                        line: row.sourceUci.slice(0, 3),
                        proof,
                        preparation,
                        leaves,
                        result,
                        probes: unique,
                    },
                    null,
                    2,
                ),
                { flag: "wx" },
            );
        }
    },
);
