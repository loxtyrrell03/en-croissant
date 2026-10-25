import type { DrawShape } from "@lichess-org/chessground/draw";
import type { PlanExplorerData } from "@/bindings";
import { type ColoredPlanExplorerLine, getAutoPlanLines, planLinesToShapes } from "./planExplorer";

export type PlanArrowKind = "plans" | "engine-plans";
export type PlanPreviewLines = ColoredPlanExplorerLine | ColoredPlanExplorerLine[];
export type PlanArrowSnapshot = {
    claims: readonly PlanArrowKind[];
    preview: { owner: symbol; fen: string; lines: PlanPreviewLines } | null;
    automatic?: readonly {
        owner: symbol;
        kind: PlanArrowKind;
        data: PlanExplorerData;
        limit?: number;
    }[];
};

export function createPlanArrowScope() {
    const claims = new Map<symbol, PlanArrowKind>();
    const listeners = new Set<() => void>();
    let snapshot: PlanArrowSnapshot = { claims: [], preview: null };
    function publish(next: PlanArrowSnapshot) {
        snapshot = next;
        for (const listener of listeners) listener();
    }
    return {
        getSnapshot: () => snapshot,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        claim(kind: PlanArrowKind) {
            const owner = Symbol();
            claims.set(owner, kind);
            publish({ ...snapshot, claims: [...claims.values()] });
            return () => {
                if (claims.delete(owner)) publish({ ...snapshot, claims: [...claims.values()] });
            };
        },
        setPreview(owner: symbol, fen: string, lines: PlanPreviewLines) {
            publish({ ...snapshot, preview: { owner, fen, lines } });
        },
        clearPreview(owner: symbol) {
            if (snapshot.preview?.owner === owner) publish({ ...snapshot, preview: null });
        },
        setAutomatic(owner: symbol, kind: PlanArrowKind, data: PlanExplorerData, limit?: number) {
            publish({
                ...snapshot,
                automatic: [
                    ...(snapshot.automatic ?? []).filter((layer) => layer.owner !== owner),
                    { owner, kind, data, limit },
                ],
            });
        },
        clearAutomatic(owner: symbol) {
            if (snapshot.automatic?.some((layer) => layer.owner === owner))
                publish({
                    ...snapshot,
                    automatic: snapshot.automatic.filter((layer) => layer.owner !== owner),
                });
        },
    };
}

export function engineArrowsAllowed(requested: boolean, hidden: boolean, state: PlanArrowSnapshot) {
    return requested && !hidden && state.claims.length === 0;
}
export function planOverlayShapes({
    state,
    fen,
    planData,
    engineData,
    autoEnabled,
    limit,
    saved = [],
}: {
    state: PlanArrowSnapshot;
    fen: string;
    planData: PlanExplorerData | null;
    engineData: PlanExplorerData | null;
    autoEnabled: boolean;
    limit: number;
    saved?: readonly DrawShape[];
}): DrawShape[] {
    const shapes: DrawShape[] = [];
    if (autoEnabled) {
        for (const kind of ["plans", "engine-plans"] as const) {
            if (!state.claims.includes(kind)) continue;
            const fallback = kind === "plans" ? planData : engineData;
            const layers = [
                ...(state.automatic ?? [])
                    .filter((layer) => layer.kind === kind)
                    .map((layer) => ({ data: layer.data, limit: layer.limit ?? limit })),
                ...(fallback ? [{ data: fallback, limit }] : []),
            ];
            for (const { data, limit: layerLimit } of layers)
                if (data.fen === fen)
                    shapes.push(
                        ...planLinesToShapes(
                            getAutoPlanLines(
                                data,
                                layerLimit,
                                kind === "engine-plans" ? { minGames: 1 } : {},
                            ),
                            layerLimit,
                        ),
                    );
        }
    }
    if (state.preview?.fen === fen)
        shapes.push(
            ...planLinesToShapes(
                Array.isArray(state.preview.lines) ? state.preview.lines : [state.preview.lines],
                16,
            ),
        );
    const shapeKey = (shape: DrawShape) =>
        JSON.stringify([
            shape.orig,
            shape.dest,
            shape.brush,
            shape.modifiers,
            shape.piece,
            shape.customSvg,
        ]);
    const seen = new Set(saved.map(shapeKey));
    return shapes.filter((shape) => {
        const key = shapeKey(shape);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// The existing native palette is shared with phone boards; saved drawing brushes
// remain Chessground's separate built-in palette.
export const PLAN_ARROW_BRUSHES = {
    plan: { key: "p", color: "#12b886", opacity: 0.9, lineWidth: 10 },
    planWhite: { key: "w", color: "#228be6", opacity: 0.9, lineWidth: 10 },
    planBlack: { key: "b", color: "#f08c00", opacity: 0.9, lineWidth: 10 },
};
