import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import type { PlanExplorerData } from "@/bindings";
import {
    createPlanArrowScope,
    type PlanArrowKind,
    type PlanPreviewLines,
} from "@/utils/planArrowLayers";

// Tree stores identify actual boards, independently of a global active-tab atom.
// Weak ownership permits closed boards and their transient layers to be collected.
const scopes = new WeakMap<object, ReturnType<typeof createPlanArrowScope>>();
function scopeFor(board: object) {
    let scope = scopes.get(board);
    if (!scope) {
        scope = createPlanArrowScope();
        scopes.set(board, scope);
    }
    return scope;
}
export function usePlanArrowSnapshot(board: object) {
    const scope = useMemo(() => scopeFor(board), [board]);
    return useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getSnapshot);
}
export function useAutoPlanArrowClaim(board: object, kind: PlanArrowKind, enabled: boolean) {
    const scope = useMemo(() => scopeFor(board), [board]);
    useLayoutEffect(() => (enabled ? scope.claim(kind) : undefined), [enabled, kind, scope]);
}
export function usePlanArrowPreview(board: object, fen: string, enabled = true) {
    const scope = useMemo(() => scopeFor(board), [board]);
    const lifetime = useMemo(
        () => ({ scope, fen, enabled, owner: Symbol(), active: false }),
        [scope, fen, enabled],
    );
    useLayoutEffect(() => {
        if (!lifetime.enabled) return;
        lifetime.active = true;
        return () => {
            lifetime.active = false;
            lifetime.scope.clearPreview(lifetime.owner);
        };
    }, [scope, lifetime]);
    return useCallback(
        (lines: PlanPreviewLines | null) => {
            if (!lifetime.active) return;
            if (lines) lifetime.scope.setPreview(lifetime.owner, lifetime.fen, lines);
            else lifetime.scope.clearPreview(lifetime.owner);
        },
        [lifetime],
    );
}

export function useAutoPlanArrowData(
    board: object,
    kind: PlanArrowKind,
    data: PlanExplorerData | null,
    enabled: boolean,
    limit = 10,
) {
    const scope = useMemo(() => scopeFor(board), [board]);
    const owner = useMemo(() => ({ scope, kind, id: Symbol() }), [scope, kind]);
    useLayoutEffect(() => {
        if (enabled && data) owner.scope.setAutomatic(owner.id, owner.kind, data, limit);
        return () => owner.scope.clearAutomatic(owner.id);
    }, [owner, data, enabled, limit]);
}
