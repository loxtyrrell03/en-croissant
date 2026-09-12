import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    replayTacticalLine,
    tacticalExchangeGain,
    counterCaptureMaterialDefence,
    winningRecaptureEvidence,
} from "../tacticalMotifs/causalTactics";

// Constructed positions; no course FEN or annotations are embedded here.
const exchangeFen = "3q2k1/4bppp/5n2/3p2B1/8/2N2N2/2Q2PPP/6K1 b - - 0 1";
const exchangeLine = ["f6e4", "c3e4", "d5e4", "g5e7", "d8e7"];
const discoveryFen = "2r2rk1/p2n2pp/B7/2p5/3P4/Q4b2/6PP/2R1K2R w - - 0 1";
const discoveryLine = ["a6c8", "f8c8", "a3a7"];
const steps = replayTacticalLine(exchangeFen, exchangeLine);
const reached = makeFen(steps[2].before.toSetup());
const history = { previousFen: makeFen(steps[1].before.toSetup()), previousMoveUci: steps[1].uci };

test("an equal recapture has a concrete exchange-balancing defence", () => {
    expect(steps).toHaveLength(5);
    expect(steps[4].balance).toBe(0);
    expect(counterCaptureMaterialDefence(steps[2], 8192, 320)?.defence).toBe("Bxe7");
    expect(
        classifyPositionTacticalMotifs({ fen: exchangeFen, pvUci: exchangeLine }).timeline ?? [],
    ).toEqual([]);
});

test.each([exchangeLine.slice(2), [exchangeLine[2]]])(
    "matching history removes the recapture-funded guard label: %j",
    (...pvUci) => {
        const raw = classifyPositionTacticalMotifs({ fen: reached, pvUci });
        expect(raw.motifs[0]).toMatchObject({ id: "capturingDefender", value: 320 });
        const contextual = classifyPositionTacticalMotifs({ fen: reached, pvUci, ...history });
        expect(contextual.motifs).toEqual([]);
        expect(contextual.timeline ?? []).toEqual([]);
    },
);

test("mismatched history and forged capture cost cannot hide the local mechanism", () => {
    const raw = classifyPositionTacticalMotifs({ fen: reached, pvUci: exchangeLine.slice(2) })
        .motifs[0];
    expect(
        classifyPositionTacticalMotifs({
            fen: reached,
            pvUci: exchangeLine.slice(2),
            previousFen: exchangeFen,
            previousMoveUci: exchangeLine[0],
        }).motifs[0],
    ).toMatchObject({ id: "capturingDefender" });
    const altered = [...steps];
    altered[1] = { ...altered[1], capture: 900 };
    expect(winningRecaptureEvidence(altered, 2, raw)).toEqual(raw);
    expect(counterCaptureMaterialDefence(steps[2], 8192, 900)).toBeNull();
});

test.each([0, 1, -1, NaN, Infinity])(
    "an incomplete defensive search grants no exchange credit: %s",
    (limit) => {
        expect(counterCaptureMaterialDefence(steps[2], limit, 320)).toBeNull();
    },
);

test("a later checked material gain cannot become a missed root opportunity", () => {
    const result = classifyMistakeReviewMotifs({
        fen: exchangeFen,
        playedMoveUci: "h7h6",
        bestMoveUci: exchangeLine[0],
        pvUci: exchangeLine,
    });
    expect(result.missedMotifs).toEqual([]);
    expect(result.missedTimeline ?? []).toEqual([]);
});

test("colour reflection retains exchange accounting", () => {
    const flip = (text: string) =>
        text.replace(/[a-zA-Z]/g, (c) =>
            c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase(),
        );
    const fields = exchangeFen.split(" ");
    fields[0] = flip(fields[0].split("/").reverse().join("/"));
    fields[1] = "w";
    const pvUci = exchangeLine.map((move) =>
        move.replace(/[1-8]/g, (rank) => String(9 - Number(rank))),
    );
    expect(replayTacticalLine(fields.join(" "), pvUci)).toHaveLength(5);
    expect(classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci }).timeline ?? []).toEqual(
        [],
    );
});

test("a small reported bound alone cannot suppress a genuinely winning removal", () => {
    const position = exchangeFen.replace("3p2B1", "3p2Q1").replace("2Q2PPP", "2R2PPP");
    const history = replayTacticalLine(position, exchangeLine.slice(0, 3));
    expect(history).toHaveLength(3);
    const currentFen = makeFen(history[2].before.toSetup());
    const raw = classifyPositionTacticalMotifs({ fen: currentFen, pvUci: ["d5e4"] }).motifs[0];
    expect(raw).toMatchObject({ id: "capturingDefender" });
    expect(counterCaptureMaterialDefence(history[2], 8192, 320)).toBeNull();
    const smallBound = { ...raw, value: 100 };
    expect(winningRecaptureEvidence(history, 2, smallBound)).toEqual(smallBound);
});

test.each([discoveryLine, [discoveryLine[0]]])(
    "incidental pawn pressure cannot inflate the rook capture: %j",
    (...pvUci) => {
        const result = classifyPositionTacticalMotifs({ fen: discoveryFen, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "hangingPiece", value: 170 });
        expect(result.motifs.some((m) => m.id === "discoveredAttack")).toBe(false);
        const liability = replayTacticalLine(discoveryFen, [...discoveryLine, "f3g2"]);
        expect(liability).toHaveLength(4);
        expect(tacticalExchangeGain(liability[3].before, liability[3].move)).toBe(100);
        const scan = buildLiveTacticalScan({
            fen: discoveryFen,
            pvUci,
            engineName: "Constructed",
            depth: 16,
        });
        expect(
            scan.arrows.some(
                (arrow) => arrow.ply === 1 && arrow.from === "a3" && arrow.to === "a7",
            ),
        ).toBe(false);
    },
);

test.skipIf(!process.env.TACTICAL_PRIVATE_POSITIONAL_SAMPLE)(
    "the fixed positional examples lose their two unsupported mechanisms",
    () => {
        const sample = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_POSITIONAL_SAMPLE!, "utf8"),
        );
        for (const id of [201, 785]) {
            const row = sample.cases.find(
                (item: { id: string }) => item.id === `private-corpus:${id}`,
            );
            expect(row).toBeDefined();
            const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci });
            expect(result.motifs).toEqual([]);
            expect(result.timeline ?? []).toEqual([]);
            const scan = buildLiveTacticalScan({
                fen: row.fen,
                pvUci: row.sourceUci,
                engineName: "Private regression",
                depth: 16,
            });
            expect(scan.labels).toEqual([]);
            expect(scan.arrows).toEqual([]);
        }
    },
);
