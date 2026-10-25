import { expect, it } from "vitest";
import type { PlanExplorerData } from "@/bindings";
import {
    createPlanArrowScope,
    engineArrowsAllowed,
    planOverlayShapes,
    type PlanArrowSnapshot,
} from "../planArrowLayers";

const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const line = (from: string, to: string) => ({
    squares: [from, to],
    san: [],
    uci: [from + to],
    games: 20,
    white: 10,
    draw: 5,
    black: 5,
    color: "white",
});
const data: PlanExplorerData = {
    fen,
    total_games: 100,
    sampled_games: 100,
    max_plies: 8,
    setups: [],
    pieces: [{ color: "white", role: "knight", from: "g1", total: 20, lines: [line("g1", "f3")] }],
};
const preview = { owner: Symbol(), fen, lines: line("b1", "c3") };
function shapes(state: PlanArrowSnapshot, displayedFen = fen) {
    return planOverlayShapes({
        state,
        fen: displayedFen,
        planData: data,
        engineData: null,
        autoEnabled: true,
        limit: 10,
    });
}
it("suppresses engine arrows when a mounted automatic plan control has no results", () => {
    expect(engineArrowsAllowed(true, false, { claims: ["plans"], preview: null })).toBe(false);
});
it("keeps automatic plans visible while hovering a different plan", () => {
    expect(shapes({ claims: ["plans"], preview }).map((shape) => [shape.orig, shape.dest])).toEqual(
        [
            ["g1", "f3"],
            ["b1", "c3"],
        ],
    );
});
it("does not draw another position's hover or automatic arrows", () => {
    expect(shapes({ claims: ["plans"], preview }, fen.replace("w KQkq", "b KQkq"))).toEqual([]);
});

it("keeps the engine-arrow preference effective when no plan owner is mounted", () => {
    const state = { claims: [], preview: null };
    expect(engineArrowsAllowed(true, false, state)).toBe(true);
    expect(engineArrowsAllowed(false, false, state)).toBe(false);
    expect(engineArrowsAllowed(true, true, state)).toBe(false);
    expect(shapes(state)).toEqual([]);
});
it("does not darken an identical automatic arrow while hovering it", () => {
    expect(
        shapes({ claims: ["plans"], preview: { ...preview, lines: line("g1", "f3") } }),
    ).toHaveLength(1);
});

it("keeps saved routes visible and avoids drawing the same automatic route twice", () => {
    const saved = shapes({ claims: ["plans"], preview: null });
    const before = JSON.stringify(saved);
    const overlays = planOverlayShapes({
        state: { claims: ["plans"], preview },
        fen,
        planData: data,
        engineData: null,
        autoEnabled: true,
        limit: 10,
        saved,
    });
    expect(overlays.map((shape) => [shape.orig, shape.dest])).toEqual([["b1", "c3"]]);
    expect(JSON.stringify(saved)).toBe(before);
});

it("owns automatic data separately from hover cleanup and filters it by position", () => {
    const scope = createPlanArrowScope(),
        owner = Symbol(),
        hover = Symbol();
    const release = scope.claim("engine-plans");
    scope.setAutomatic(owner, "engine-plans", data, 1);
    scope.setPreview(hover, fen, preview.lines);
    scope.clearPreview(hover);
    expect(
        planOverlayShapes({
            state: scope.getSnapshot(),
            fen,
            planData: null,
            engineData: null,
            autoEnabled: true,
            limit: 10,
        }),
    ).toHaveLength(1);
    expect(
        planOverlayShapes({
            state: scope.getSnapshot(),
            fen: "other",
            planData: null,
            engineData: null,
            autoEnabled: true,
            limit: 10,
        }),
    ).toEqual([]);
    release();
    expect(
        planOverlayShapes({
            state: scope.getSnapshot(),
            fen,
            planData: null,
            engineData: null,
            autoEnabled: true,
            limit: 10,
        }),
    ).toEqual([]);
    scope.clearAutomatic(Symbol());
    expect(scope.getSnapshot().automatic).toHaveLength(1);
    scope.clearAutomatic(owner);
    expect(scope.getSnapshot().automatic).toEqual([]);
});
it("draws hover previews independently when automatic arrows are off", () => {
    const result = planOverlayShapes({
        state: { claims: [], preview },
        fen,
        planData: data,
        engineData: null,
        autoEnabled: false,
        limit: 10,
    });
    expect(result.map((shape) => [shape.orig, shape.dest])).toEqual([["b1", "c3"]]);
});
it("combines independent plan panels and retains engine lines with one supporting PV", () => {
    const engineData = {
        ...data,
        pieces: [
            { ...data.pieces[0], from: "b1", total: 1, lines: [{ ...line("b1", "c3"), games: 1 }] },
        ],
    };
    const result = planOverlayShapes({
        state: { claims: ["plans", "engine-plans"], preview: null },
        fen,
        planData: data,
        engineData,
        autoEnabled: true,
        limit: 10,
    });
    expect(result.map((shape) => [shape.orig, shape.dest])).toEqual([
        ["g1", "f3"],
        ["b1", "c3"],
    ]);
});
it("releasing one control does not release another control, including a later mount", () => {
    const scope = createPlanArrowScope();
    const old = scope.claim("plans");
    const other = scope.claim("engine-plans");
    old();
    const current = scope.claim("plans");
    old();
    expect(scope.getSnapshot().claims).toEqual(["engine-plans", "plans"]);
    other();
    expect(scope.getSnapshot().claims).toEqual(["plans"]);
    current();
    expect(scope.getSnapshot().claims).toEqual([]);
});
it("old hover cleanup cannot remove another preview or an automatic claim", () => {
    const scope = createPlanArrowScope(),
        old = Symbol(),
        current = Symbol();
    scope.claim("plans");
    scope.setPreview(old, fen, line("g1", "f3"));
    scope.setPreview(current, fen, line("b1", "c3"));
    scope.clearPreview(old);
    expect(scope.getSnapshot().preview?.owner).toBe(current);
    scope.clearPreview(current);
    expect(scope.getSnapshot()).toEqual({ claims: ["plans"], preview: null });
});
it("keeps snapshots immutable for subscribed views and stops unsubscribed notifications", () => {
    const scope = createPlanArrowScope(),
        before = scope.getSnapshot();
    let calls = 0;
    const unsubscribe = scope.subscribe(() => calls++);
    const release = scope.claim("plans");
    expect(before).toEqual({ claims: [], preview: null });
    expect(calls).toBe(1);
    unsubscribe();
    release();
    expect(calls).toBe(1);
});
