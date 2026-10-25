import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useCalendarDay } from "@/hooks/useCalendarDay";
import {
    ALL_GAME_DATES,
    gameDateBounds,
    isGameDateRange,
    type GameDateRange,
} from "@/utils/gameDateRange";
import type { WebCompanionState } from "./model";
import { phonePrepDateKey, type PhoneGameDateRanges, type PhoneGameDateScope } from "./gameDates";
import { phoneWorkspaceKey, phoneWorkspaceOwner } from "./workspacePreferences";

export function phoneGameDates(state: WebCompanionState, scope: PhoneGameDateScope) {
    const prep = state.prepWorkspaces.find((item) => item.id === state.activePrepId);
    return scope === "prep" && prep
        ? prep.dateRanges
        : state.workspacePreferences?.[phoneWorkspaceKey(state)]?.gameDates?.[scope];
}

export function rememberPhoneGameDates(
    state: WebCompanionState,
    owner: string,
    scope: PhoneGameDateScope,
    update: (current: PhoneGameDateRanges | undefined) => PhoneGameDateRanges | undefined,
): WebCompanionState {
    if (phoneWorkspaceOwner(state) !== owner) return state;
    const previous = phoneGameDates(state, scope),
        ranges = update(previous);
    if (previous === ranges) return state;
    const prep = state.prepWorkspaces.find((item) => item.id === state.activePrepId);
    if (scope === "prep" && prep)
        return {
            ...state,
            prepWorkspaces: state.prepWorkspaces.map((item) =>
                item.id === prep.id ? { ...item, dateRanges: ranges, updatedAt: Date.now() } : item,
            ),
        };
    const key = phoneWorkspaceKey(state),
        preferences = state.workspacePreferences?.[key];
    return {
        ...state,
        workspacePreferences: {
            ...state.workspacePreferences,
            [key]: { ...preferences, gameDates: { ...preferences?.gameDates, [scope]: ranges } },
        },
    };
}

/** Migrate each source/mode group once through the retained root workspace writer. */
export function usePhoneGameDates(
    state: WebCompanionState,
    setState: Dispatch<SetStateAction<WebCompanionState>>,
    scope: PhoneGameDateScope,
    slot: string,
    legacy: PhoneGameDateRanges,
) {
    const owner = phoneWorkspaceOwner(state);
    const context = `${owner}:${scope}:${slot}`;
    const currentContext = useRef<string | null>(context);
    currentContext.current = context;
    useEffect(() => {
        currentContext.current = context;
        return () => {
            currentContext.current = null;
        };
    }, [context]);
    const saved = phoneGameDates(state, scope),
        ranges = saved ?? legacy;
    useEffect(() => {
        if (saved !== undefined) return;
        setState((current) =>
            rememberPhoneGameDates(current, owner, scope, (existing) => existing ?? legacy),
        );
    }, [legacy, owner, saved, scope, setState]);
    const today = useCalendarDay();
    const value = ranges[slot] ?? ALL_GAME_DATES,
        valid = isGameDateRange(value);
    const bounds = valid ? gameDateBounds(value, "day", new Date(`${today}T12:00:00`)) : {};
    const setRange = (range: GameDateRange) => {
        if (currentContext.current !== context || !isGameDateRange(range)) return;
        setState((current) => {
            const prep = current.prepWorkspaces.find((item) => item.id === current.activePrepId);
            const preferences = current.workspacePreferences?.[phoneWorkspaceKey(current)];
            if (scope === "prep" && prep && phonePrepDateKey(prep.mode, prep.source) !== slot)
                return current;
            if (
                scope === "database" &&
                preferences?.database?.source &&
                ["local", "lichess-all", "lichess-masters"].includes(preferences.database.source) &&
                preferences.database.source !== slot
            )
                return current;
            if (
                scope === "prep" &&
                !prep &&
                !slot.endsWith(":temporary") &&
                preferences?.prep?.mode
            ) {
                const mode = preferences.prep.mode,
                    source = preferences.prep.sources?.[mode]?.source;
                if (
                    !slot.startsWith(`${mode}:`) ||
                    (source && slot !== phonePrepDateKey(mode, source))
                )
                    return current;
            }
            return rememberPhoneGameDates(current, owner, scope, (existing) => ({
                ...(existing ?? ranges),
                [slot]: range,
            }));
        });
    };
    return { value, ranges, bounds, valid, today, context, setRange };
}
