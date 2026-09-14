import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { makeUci, parseSquare } from "chessops/util";
import { expect, test } from "vitest";
import { createEmptyCard } from "ts-fsrs";
import sample from "../../../benchmarks/tactical-relevance/discovered-capture-development.json";
import {
    proveDiscoveredCapture,
    replayTacticalLine,
    tacticalExchangeGain,
    tacticalBoardEvidence,
} from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { migrateMistakeReviewDeckMotifClassifications } from "../mistakeReview";
import { positionSchema } from "@/components/files/opening";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";

const fen = "5rk1/Q1RR1pp1/4p2p/8/4KP2/3rP3/P1q3PP/8 b - - 1 30";
const root = "d3d7";

const mirrorMove = (move: string) => move.replace(/[1-8]/g, (rank) => String(9 - Number(rank)));
const rows = sample.cases.flatMap((row) => {
    const fields = row.fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = fields[1] === "w" ? "b" : "w";
    return [
        row,
        {
            ...row,
            id: `${row.id}:reflected`,
            fen: fields.join(" "),
            root: mirrorMove(row.root),
            pvUci: row.pvUci.map(mirrorMove),
        },
    ];
});

test.each(rows)("$id covers the actual defenses", (row) => {
    const steps = replayTacticalLine(row.fen, row.pvUci);
    expect(steps).toHaveLength(row.pvUci.length);
    const failures: string[] = [];
    const proof = proveDiscoveredCapture(steps[0], 4096, (reason) => failures.push(reason));
    assert.equal(Boolean(proof), row.expectedProof, JSON.stringify({ proof, failures }));
    expect(failures.some((reason) => reason.includes("exhausted"))).toBe(false);
    if (proof) {
        assert(proof.visits <= 4096);
        assert.equal(
            proof.branches.length,
            [...steps[0].after.allDests().values()].reduce((n, squares) => n + squares.size(), 0),
        );
        for (const branch of proof.branches) {
            const reply = parseSan(steps[0].after, branch.reply)!;
            assert(reply);
            const pos = steps[0].after.clone();
            pos.play(reply);
            assert(parseSan(pos, branch.answer));
        }
    }
    for (const pvUci of [[row.root], row.pvUci]) {
        const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci });
        if (row.expectedProof) {
            assert.equal(result.motifs[0].id, "discoveredCheck");
            assert.equal(result.motifs[0].ply, 1);
            assert((result.motifs[0].value ?? 0) >= 500);
            assert(!result.motifs.some((m) => m.id === "hangingPiece" && m.ply === 1));
        }
    }
});

test("a real-game capture is protected by the newly discovered check", () => {
    const step = replayTacticalLine(fen, [root])[0];
    expect(tacticalExchangeGain(step.before, step.move)).toBe(500);
    const failures: string[] = [];
    const proof = proveDiscoveredCapture(step, 4096, (reason) => failures.push(reason));
    expect({ proof, failures }).toMatchObject({ proof: { gain: 500 }, failures: [] });
    expect(classifyPositionTacticalMotifs({ fen, pvUci: [root] }).motifs[0]).toMatchObject({
        id: "discoveredCheck",
        ply: 1,
        value: 500,
    });
    expect(proof?.branches.find((branch) => branch.reply === "Rxc2")).toMatchObject({
        answer: "Rxa7",
        gain: 500,
    });
});

test("without the defender, the same capture does not need the discovered check", () => {
    const pos = replayTacticalLine(fen, [root])[0].before.clone();
    pos.board.take(parseSquare("c7")!);
    pos.board.take(parseSquare("a7")!);
    const position = makeFen(pos.toSetup());
    expect(proveDiscoveredCapture(replayTacticalLine(position, [root])[0])).toBeNull();
});

test.each([0, -1, NaN, Infinity, 1, 1.5])("incomplete budget %s is not a certificate", (budget) => {
    const step = replayTacticalLine(fen, [root])[0];
    expect(proveDiscoveredCapture(step, budget)).toBeNull();
    expect(proveDiscoveredCapture(step)?.gain).toBe(500);
});

test("the board shows the current check, not a future queen-capture arrow", () => {
    const pvUci = sample.cases[0].pvUci;
    const result = classifyPositionTacticalMotifs({ fen, pvUci });
    expect(tacticalBoardEvidence(fen, pvUci, result.motifs[0])).toEqual({
        square: "d7",
        arrows: [{ from: "c2", to: "e4" }],
    });
    const scan = buildLiveTacticalScan({ fen, pvUci, depth: 16, engineName: "Development" });
    expect(scan.motifs[0]).toMatchObject({ id: "discoveredCheck", ply: 1 });
    expect(scan.arrows.some((a) => a.from === "d7" && a.to === "a7")).toBe(false);
});

test("the missed lesson names the root discovery, not its later queen capture", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        playedMoveUci: "f7f5",
        bestMoveUci: root,
        pvUci: sample.cases[0].pvUci,
        refutationUci: ["e4f3"],
    });
    const lesson = buildMistakeReviewTacticalExplanation(result);
    expect(lesson).toMatchObject({ source: "missed", primary: { id: "discoveredCheck", ply: 1 } });
    expect(lesson?.text).toContain("Rxd7+");
});

test("motif migration refreshes the stored current-version nature explanation too", async () => {
    const position = positionSchema.parse({
        fen,
        answer: "Rxd7+",
        answerUci: root,
        card: createEmptyCard(),
        sideToMove: "black",
        mistakeReview: {
            bestMoveUci: root,
            bestMoveSan: "Rxd7+",
            playedMoveUci: "f7f5",
            playedMoveSan: "f5+",
            cpLoss: 521,
            pvUci: sample.cases[0].pvUci,
            refutationUci: ["e4f3"],
            nature: "tactical",
            natureClassifierVersion: 4,
            natureReason: "Rxd7+ wins the loose rook on d7.",
            motifClassifierVersion: "site-55.adapter-106",
        },
    });
    const original = JSON.stringify(position);
    const result = await migrateMistakeReviewDeckMotifClassifications({
        positions: [position],
    } as any);
    expect(result.updatedCount).toBe(1);
    expect(JSON.stringify(position)).toBe(original);
    const stored = result.deck.positions[0].mistakeReview!;
    expect(stored.missedMotifs?.[0].id).toBe("discoveredCheck");
    expect(stored.natureReason).toContain("cannot recapture on d7");
    expect(stored.natureReason).not.toContain("loose rook");
    expect(stored.natureClassifierVersion).toBe(4);
});

test("the capture-retention proof does not borrow an unsupported causal comparison", () => {
    const before = "5rk1/Q1RR1pp1/4p2p/8/5P2/3rPK2/P1q3PP/8 w - - 0 30";
    expect(replayTacticalLine(before, ["f3g3", root])).toHaveLength(2);
    const result = classifyMistakeReviewMotifs({ fen: before,
        playedMoveUci: "f3e4", bestMoveUci: "f3g3", pvUci: ["f3g3"],
        refutationUci: sample.cases[0].pvUci });
    expect(result.allowedMotifs[0]).toMatchObject({ id: "discoveredCheck", ply: 1 });
    expect(result.allowedMotifs[0].comparison).toBeUndefined();
});

test.skipIf(!process.env.TACTICAL_DISCOVERED_CAPTURE_PROBES)(
    "export every actual defense and selected leaf for independent engine review",
    () => {
        const probes: { id: string; fen: string; moves?: string[]; searchMove?: string }[] = [];
        const certificates = [];
        for (const row of rows) {
            const step = replayTacticalLine(row.fen, [row.root])[0];
            const proof = proveDiscoveredCapture(step);
            probes.push(
                { id: `${row.id}:best`, fen: row.fen },
                { id: `${row.id}:held-root`, fen: row.fen, searchMove: row.root },
            );
            if (row.pvUci.length > 1)
                probes.push({
                    id: `${row.id}:specified-defence`,
                    fen: row.fen,
                    moves: [row.root],
                    searchMove: row.pvUci[1],
                });
            if (!proof) continue;
            certificates.push({ id: row.id, proof });
            for (const [index, branch] of proof.branches.entries()) {
                const reply = parseSan(step.after, branch.reply)!;
                const pos = step.after.clone();
                pos.play(reply);
                probes.push(
                    {
                        id: `${row.id}:defence-${index}`,
                        fen: row.fen,
                        moves: [row.root],
                        searchMove: makeUci(reply),
                    },
                    {
                        id: `${row.id}:leaf-${index}`,
                        fen: makeFen(pos.toSetup()),
                        searchMove: makeUci(parseSan(pos, branch.answer)!),
                    },
                );
            }
        }
        // Input is only this checked-in public set; no private course rows leak.
        expect(
            JSON.parse(
                readFileSync(
                    "benchmarks/tactical-relevance/discovered-capture-development.json",
                    "utf8",
                ),
            ),
        ).toEqual(sample);
        writeFileSync(
            process.env.TACTICAL_DISCOVERED_CAPTURE_PROBES!,
            JSON.stringify(
                {
                    samplePath: "benchmarks/tactical-relevance/discovered-capture-development.json",
                    probes,
                    certificates,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);
