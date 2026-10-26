import { useCallback, useEffect, useState } from "react";
import type { WebCompanionState } from "./model";
import { webStateSession } from "./webStateSession";

export type PhoneAnalysisView = "live" | "report" | "plans";
const sourceKey = (kind: "database" | "prep", id: string) => JSON.stringify([kind, id]);

function workspaceKey(state: WebCompanionState): string {
    const prep = state.prepWorkspaces.find((item) => item.id === state.activePrepId);
    if (prep) return sourceKey("prep", prep.id);
    const database = state.databases.find((item) => item.id === state.board.sourceDatabaseId);
    if (database) return sourceKey("database", database.id);
    const board = state.board;
    return JSON.stringify([
        "board",
        board.annotationOwnerId,
        board.sourceDatabaseId,
        board.sourceGameId,
    ]);
}

/** A report opens only by choice in this loaded workspace. This lives at the app
 * root so leaving Board preserves it, while a fresh app session starts on Live. */
export function usePhoneAnalysisView(state: WebCompanionState) {
    const key = workspaceKey(state);
    const [views, setViews] = useState<ReadonlyMap<string, PhoneAnalysisView>>(() => new Map());
    const select = useCallback(
        (value: string) => {
            if (value !== "live" && value !== "report" && value !== "plans") return;
            if (workspaceKey(webStateSession.getSnapshot().state) !== key) return;
            setViews((current) => {
                if ((current.get(key) ?? "live") === value) return current;
                const next = new Map(current);
                if (value === "live") next.delete(key);
                else next.set(key, value);
                return next;
            });
        },
        [key],
    );
    useEffect(() => {
        const retained = new Set([
            key,
            ...state.databases.map((item) => sourceKey("database", item.id)),
            ...state.prepWorkspaces.map((item) => sourceKey("prep", item.id)),
        ]);
        setViews((current) => {
            const entries = [...current].filter(([owner]) => retained.has(owner));
            return entries.length === current.size ? current : new Map(entries);
        });
    }, [key, state.databases, state.prepWorkspaces]);
    return [views.get(key) ?? "live", select] as const;
}
