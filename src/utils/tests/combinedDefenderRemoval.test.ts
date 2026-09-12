import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import {
    proveCombinedDefenderRemoval,
    replayTacticalLine,
    winningRecaptureEvidence,
    counterCaptureMaterialDefence,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

// Independently constructed two-guard geometry. The two guards of Rc7 are
// Nd5 and Qc6; White's queen sees c7 along g3-f4-e5-d6-c7.
const fen = "6k1/2r2ppp/2q5/3n4/8/6Q1/5PPP/3R1RK1 w - - 0 1";
const line = ["d1d5", "c6d5", "g3c7"];
test("a capture removes one guard and deflects the other from the same target", () => {
    const failures: string[] = [];
    const proof = proveCombinedDefenderRemoval(replayTacticalLine(fen, ["d1d5"])[0], 8192, (r) =>
        failures.push(r),
    );
    expect({ proof, failures }).toMatchObject({ proof: { acceptance: ["Qxd5", "Qxc7"] } });
});

test.each([["d1d5"], line])(
    "the connected removal is the root lesson without depending on future gifts: %j",
    (...pvUci) => {
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]).toMatchObject({
            id: "capturingDefender",
            label: "Removing the Defenders",
            ply: 1,
        });
        expect(result.motifs[0].evidence).toContain("Both guarded the rook on c7");
        expect(result.motifs[0].evidence).toContain("Qxd5 Qxc7");
    },
);

test("accepting the sacrifice is not a profitable recapture for the opponent", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect((result.timeline ?? []).some((m) => m.id === "hangingPiece" && m.ply === 2)).toBe(false);
    const accepted = replayTacticalLine(fen, line)[0];
    const viewed = classifyPositionTacticalMotifs({
        fen: makeFen(accepted.after.toSetup()),
        previousFen: fen,
        previousMoveUci: line[0],
        pvUci: [line[1]],
    });
    expect(viewed.motifs.some((m) => m.id === "hangingPiece")).toBe(false);
});

test("a standalone recapture has its own countercapture defence without borrowing history", () => {
    const accepted = replayTacticalLine(fen, line)[0];
    const viewed = classifyPositionTacticalMotifs({
        fen: makeFen(accepted.after.toSetup()),
        pvUci: [line[1]],
    });
    const step = replayTacticalLine(makeFen(accepted.after.toSetup()), [line[1]])[0];
    expect(counterCaptureMaterialDefence(step, 8192, 0, true)?.defence).toBe("Qxc7");
    expect(viewed.motifs.some((m) => m.id === "hangingPiece")).toBe(false);
});

test("current-board arrows show both guards of the actual target", () => {
    const scan = buildLiveTacticalScan({
        fen,
        pvUci: [line[0]],
        depth: 16,
        engineName: "Constructed",
    });
    expect(scan.labels).toHaveLength(1);
    expect(scan.motifs[0]?.id).toBe("capturingDefender");
    expect(scan.arrows.map((a) => `${a.from}${a.to}`)).toEqual(
        expect.arrayContaining(["d5c7", "c6c7", "g3c7"]),
    );
});

test.each([0, 1, -1, NaN, Infinity, 1.5])(
    "invalid or exhausted budget %s cannot reuse a success",
    (budget) => {
        const step = replayTacticalLine(fen, line)[0];
        expect(proveCombinedDefenderRemoval(step)).not.toBeNull();
        expect(proveCombinedDefenderRemoval(step, budget)).toBeNull();
    },
);

test.each([
    ["first guard no longer guards the target", fen.replace("3n4", "3p4")],
    ["no second guard", fen.replace("2q5", "8")],
    ["no original capturer", fen.replace("6Q1", "8")],
    ["a third guard still protects the rook", fen.replace("6k1", "2r3k1")],
    ["the missing back-rank rook permits mate after the payoff", fen.replace("3R1RK1", "3R2K1")],
])("no certificate when %s", (_name, position) => {
    expect(proveCombinedDefenderRemoval(replayTacticalLine(position, line)[0])).toBeNull();
});

test("a checking recapture cannot be ignored in the otherwise familiar combination", () => {
    const position = fen.replace("3R1RK1", "3R1R1K").replace("5PPP", "5P1P");
    const steps = replayTacticalLine(position, line);
    expect(steps).toHaveLength(2);
    expect(steps[1].san).toBe("Qxd5+");
    expect(proveCombinedDefenderRemoval(steps[0])).toBeNull();
});

test("colour reflection preserves the two-defender mechanism", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    const moves = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    expect(
        proveCombinedDefenderRemoval(replayTacticalLine(fields.join(" "), moves)[0]),
    ).toMatchObject({ acceptance: ["Qxd4", "Qxc2"] });
});

test("a quiet retention moves the capturing piece, not an unrelated back-rank guard", () => {
    const bad = [...line.slice(0, 1), "c6c4", "f1d1", "c4d5", "d1d5", "c7c1", "d5d1", "c1d1"];
    const steps = replayTacticalLine(fen, bad);
    expect(steps).toHaveLength(bad.length);
    expect(steps.at(-1)!.after.isCheckmate()).toBe(true);
    const root = replayTacticalLine(fen, line)[0];
    const proof = proveCombinedDefenderRemoval(root)!;
    for (const branch of proof.declined) {
        const next = root.after.clone();
        next.play(parseSan(next, branch.reply)!);
        const move = parseSan(next, branch.answer)!;
        expect(
            Boolean(next.board.get(move.to)) || ("from" in move && move.from === root.move.to),
        ).toBe(true);
    }
});

test("an offered queen cannot lure the back-rank guard into a checking recapture", () => {
    const trap = ["d1d5", "c6c1", "f1c1", "c7c1", "d5d1", "c1d1"];
    const steps = replayTacticalLine(fen, trap);
    expect(steps).toHaveLength(trap.length);
    expect(steps.at(-1)!.after.isCheckmate()).toBe(true);
    const proof = proveCombinedDefenderRemoval(steps[0])!;
    expect(proof.declined.find((b) => b.reply === "Qc1")?.answer).not.toBe("Rxc1");
});

test("premature queen capture retains the missed removal lesson", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: line[0],
        playedMoveUci: line[2],
        pvUci: line,
        refutationUci: ["d5c7"],
    });
    expect(result.missedMotifs[0]?.id).toBe("capturingDefender");
    const explanation = buildMistakeReviewTacticalExplanation(result);
    expect(explanation?.primary).toMatchObject({
        id: "hangingPiece",
        label: "Winning Recapture",
        source: "allowed",
    });
    expect(explanation?.secondary).toMatchObject({ id: "capturingDefender", source: "missed" });
});

test("an uncompared opponent combination does not acquire a causal accusation", () => {
    const result = classifyMistakeReviewMotifs({
        fen: fen.replace(" w ", " b "),
        bestMoveUci: "g7g6",
        playedMoveUci: "h7h6",
        pvUci: ["g7g6", ...line],
        refutationUci: line,
    });
    expect(result.allowedMotifs[0]?.id).toBe("capturingDefender");
    expect(result.allowedMotifs[0]?.comparison).not.toBe("prevented");
    expect(result.allowedMotifs[0]?.comparison).not.toBe("reduced");
    expect(buildMistakeReviewTacticalExplanation(result)?.text).not.toContain("Your move allowed");
});

test.skipIf(!process.env.TACTICAL_PRIVATE_THIRD_SAMPLE)(
    "the actual course sacrifice survives every bounded defensive reply",
    () => {
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_THIRD_SAMPLE!, "utf8"));
        const row = sample.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 172);
        const failures: string[] = [];
        const proof = proveCombinedDefenderRemoval(
            replayTacticalLine(row.fen, row.sourceUci)[0],
            8192,
            (r) => failures.push(r),
        );
        expect({ proof, failures }).toMatchObject({ proof: { acceptance: ["Qxd5", "Qxc7"] } });
        expect(
            classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.sourceUci[0]] }).motifs[0]
                ?.id,
        ).toBe("capturingDefender");
        const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci });
        expect(result.motifs[0]?.label).toBe("Removing the Defenders");
        const cycle = ["f7h6", "g8h8", "h6f7", "h8g8", ...row.sourceUci];
        expect(replayTacticalLine(row.fen, cycle)).toHaveLength(cycle.length);
        const delayed = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: cycle });
        expect(delayed.motifs[0]).toMatchObject({
            id: "capturingDefender",
            label: "Removing the Defenders",
            ply: 5,
            moveUci: row.sourceUci[0],
        });
        expect(delayed.motifs[0].evidence).toContain("Both guarded the rook on c7");
        expect((result.timeline ?? []).some((m) => m.ply === 2 && m.id === "hangingPiece")).toBe(
            false,
        );
        const counter = classifyPositionTacticalMotifs({
            fen: row.fen,
            pvUci: [row.sourceUci[0], "f8f7", "e6f7"],
        });
        expect(
            counter.timeline?.find((m) => m.ply === 2 && m.id === "hangingPiece")?.label,
        ).not.toBe("Winning Recapture");
        const counterSteps = replayTacticalLine(row.fen, [row.sourceUci[0], "f8f7", "e6f7"]);
        expect(
            winningRecaptureEvidence(counterSteps, 1, {
                id: "hangingPiece",
                label: "Hanging Piece",
                ply: 2,
                moveUci: "f8f7",
                source: "available",
                confidence: "high",
                value: 320,
                evidence: "Untrusted material badge",
            }),
        ).toMatchObject({ label: "Countercapture", evidence: expect.stringContaining("exf7+") });
    },
);
