import { expect, test } from "vitest";
import examples from "../../../benchmarks/decision-evidence/line-route-motifs/examples.json";
import { findLineRouteEvidence } from "../tacticalMotifs/lineRouteEvidence";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { isImmediateTacticalLesson } from "../tacticalMotifs/mistakeReviewAdapter";

const route = ({ fen, pvUci, cp, mate, depth }: typeof examples.longDeflection.frame) =>
    findLineRouteEvidence(fen, pvUci, cp, mate, depth);

test("follow the original displaced rook until the capture recovers the offer", () => {
    const frame = examples.longDeflection.frame;
    const [evidence] = route(frame);
    expect(evidence).toMatchObject({
        id: "deflection",
        moveUci: frame.pvUci[0],
        lineThroughPly: 7,
        evidence: expect.stringContaining("Rhxh7 takes the displaced rook"),
    });
    expect(isImmediateTacticalLesson(evidence)).toBe(false);
    expect(evidence.verifiedCombination).toBeUndefined();
    expect(route({ ...frame, pvUci: frame.pvUci.slice(0, 5) })).toEqual([]);
    expect(route({ ...frame, cp: -200 })).toEqual([]);
});

test("a mating clearance names the square that the second piece actually uses", () => {
    const { frame } = examples.clearanceMate;
    const scan = buildLiveTacticalScan({
        fen: frame.fen,
        depth: frame.depth,
        engineName: "Stockfish 19",
        pvUci: frame.pvUci,
        variations: [frame],
    });
    expect(scan.variations[0].motifs.filter(({ id }) => id === "clearance")).toEqual([
        expect.objectContaining({
            lineThroughPly: 3,
            evidence: expect.stringContaining("Rf7+ clears e7"),
        }),
    ]);
    expect(scan.variations[0].timeline).toContainEqual(
        expect.objectContaining({
            id: "clearance",
            ply: 1,
            lineThroughPly: 3,
        }),
    );
});

test("a scored clearance needs a concrete payoff through the new route", () => {
    const { frame } = examples.materialClearance;
    expect(route(frame)).toContainEqual(
        expect.objectContaining({
            id: "clearance",
            lineThroughPly: 3,
        }),
    );
    expect(route({ ...frame, pvUci: frame.pvUci.slice(0, 2) })).toEqual([]);
    expect(route(examples.quietControl.frame)).toEqual([]);
    expect(route({ ...frame, depth: 12 })).toEqual([]);
});

test("a conditional alternative never replaces the engine's first choice", () => {
    const { frame, otherRoot } = examples.acceptedDeflection;
    const principal = { ...frame, pvUci: [otherRoot] };
    const scan = buildLiveTacticalScan({
        fen: frame.fen,
        depth: frame.depth,
        engineName: "Stockfish 19",
        pvUci: principal.pvUci,
        variations: [principal, frame],
    });
    expect(scan.variations[1].motifs).toContainEqual(
        expect.objectContaining({
            id: "deflection",
            lineThroughPly: 3,
        }),
    );
    expect(scan.preferredMultipv).toBeUndefined();
    expect(scan.lineUci[0]).toBe(otherRoot);
});
