import { expect, test } from "vitest";
import {
    auditTacticalMotifs,
    proveDirectMaterialThreat,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    directThreatFen as fen,
    directThreatLine,
    directThreatControls,
} from "./fixtures/directThreatRelevance";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import { trapControls } from "./fixtures/trapRelevance";

test("a claimable fifty-move draw cannot reuse the same direct-threat certificate", () => {
    const position = "k6n/1p6/8/8/8/7Q/1P6/6K1 w - - 0 1";
    expect(proveDirectMaterialThreat(replayTacticalLine(position, ["h3h7"])[0])?.gain).toBe(320);
    expect(
        proveDirectMaterialThreat(replayTacticalLine(position.replace("0 1", "99 1"), ["h3h7"])[0]),
    ).toBeNull();
});

test("winning a queen cannot fund a separate threat that concedes an exchange", () => {
    const position = "k6n/1p3R1q/8/8/8/7Q/1P6/6K1 w - - 0 1";
    const line = ["h3h7", "h8f7", "h7f7"];
    const steps = replayTacticalLine(position, line);
    expect(steps).toHaveLength(3);
    expect(steps.map((step) => step.capture)).toEqual([900, 500, 320]);
    expect(proveDirectMaterialThreat(steps[0])).toBeNull();
    const result = auditTacticalMotifs(position, line, [
        {
            id: "attacking_undefended_piece",
            label: "Threatening a Piece",
            source: "available",
            confidence: "high",
            ply: 1,
            moveUci: "h3h7",
            evidence: "Untrusted proposal",
            value: 900,
        },
    ]);
    expect(result.some((m) => m.id === "attacking_undefended_piece")).toBe(false);
});

test.each([false, true])(
    "discovered-check targets have one lesson and their own bound (reflected: %s)",
    (reflected) => {
        const position = reflected ? reflectMixedForkFen(fen) : fen;
        const line = reflected ? directThreatLine.map(reflectMixedForkMove) : directThreatLine;
        expect(proveDirectMaterialThreat(replayTacticalLine(position, line)[0])).toMatchObject({
            gain: 400,
            complete: true,
        });
        for (const length of [1, 3, 4]) {
            const result = classifyPositionTacticalMotifs({
                fen: position,
                pvUci: line.slice(0, length),
            });
            expect(result.motifs[0]).toMatchObject({ id: "discoveredCheck", ply: 1, value: 400 });
            expect(result.timeline?.some((m) => m.id === "attacking_undefended_piece")).toBe(false);
            expect(
                result.timeline?.filter((m) => m.id === "underPromotion").map((m) => m.ply),
            ).toEqual(length >= 3 ? [3] : []);
            expect(
                result.timeline
                    ?.filter((m) => m.id === "hangingPiece")
                    .map((m) => [m.ply, m.value]),
            ).toEqual(length >= 3 ? [[3, 400]] : []);
        }
    },
);
test.each([1, 600, 10000])(
    "a proposed threat value of %i cannot create an extra lesson or override the discovery",
    (value) => {
        const result = auditTacticalMotifs(fen, directThreatLine, [
            {
                id: "attacking_undefended_piece",
                label: "Threatening a Piece",
                source: "available",
                confidence: "high",
                ply: 1,
                moveUci: "e6e7",
                evidence: "Untrusted proposal",
                value,
            },
        ]);
        expect(result[0]).toMatchObject({ id: "discoveredCheck", value: 400 });
        expect(result.some((m) => m.id === "attacking_undefended_piece")).toBe(false);
    },
);
test.each(directThreatControls)(
    "$id cannot borrow the longer promotion line as a direct gain",
    (row) => {
        const step = replayTacticalLine(row.fen, ["e6e7"])[0];
        expect(step).toBeDefined();
        expect(proveDirectMaterialThreat(step)).toBeNull();
    },
);
test("the live board has one discovery label; the actual promotion keeps its later move", () => {
    const scan = buildLiveTacticalScan({
        fen,
        pvUci: directThreatLine,
        depth: 16,
        engineName: "Regression",
    });
    expect(scan.labels.map((m) => m.id)).toEqual(["discoveredCheck"]);
    expect(scan.motifs[0]).toMatchObject({ id: "discoveredCheck", value: 400 });
    expect(scan.variations[0].timeline.some((m) => m.id === "attacking_undefended_piece")).toBe(
        false,
    );
    expect(scan.arrows.some((a) => a.from === "e7" && a.to === "d8")).toBe(true);
    expect(scan.arrows.some((a) => a.from === "d8")).toBe(false);
});
test("the same target is explained by a trap, not another generic threat badge", () => {
    const trappedKnight = "k6n/1p6/8/8/8/7Q/1P6/6K1 w - - 0 1";
    const line = ["h3h7"];
    const step = replayTacticalLine(trappedKnight, line)[0];
    expect(proveDirectMaterialThreat(step)?.gain).toBeGreaterThan(0);
    const result = auditTacticalMotifs(trappedKnight, line, [
        {
            id: "attacking_undefended_piece",
            label: "Threatening a Piece",
            source: "available",
            confidence: "medium",
            ply: 1,
            moveUci: "h3h7",
            evidence: "Untrusted proposal",
            value: 1,
        },
    ]);
    expect(result[0]).toMatchObject({ id: "trappedPiece", ply: 1 });
    expect(result.some((m) => m.id === "attacking_undefended_piece")).toBe(false);
});
test.each(trapControls)(
    "$id cannot use the trapped-rook fixture as a direct-threat certificate",
    (row) => {
        expect(proveDirectMaterialThreat(replayTacticalLine(row.fen, ["g1f2"])[0])).toBeNull();
    },
);
test("review keeps the missed checking discovery, not its duplicate piece-threat badge", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        playedMoveUci: "g1h1",
        bestMoveUci: "e6e7",
        pvUci: directThreatLine,
        cpBefore: 463,
        cpAfter: -200,
        cpLoss: 663,
    });
    const lesson = buildMistakeReviewTacticalExplanation(result);
    expect(lesson?.primary).toMatchObject({ id: "discoveredCheck", source: "missed" });
    expect(JSON.stringify(lesson)).not.toContain("attacking_undefended_piece");
});
