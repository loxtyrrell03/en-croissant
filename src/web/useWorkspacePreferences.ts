import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { WebCompanionState, WebDatabasePreferenceKey } from "./model";
import {
    phoneWorkspaceKey,
    phoneWorkspaceOwner,
    setPhoneDatabasePreference,
} from "./workspacePreferences";

/** Legacy global settings seed new scopes; all subsequent choices use the
 * workspace writer, with a fresh source-owner check at commit time. */
export function usePhoneDatabasePreference(
    state: WebCompanionState,
    setState: Dispatch<SetStateAction<WebCompanionState>>,
    field: WebDatabasePreferenceKey,
    legacyKey: string,
    fallback: string,
) {
    const [initial] = useState(() => {
        try {
            return localStorage.getItem(legacyKey) ?? fallback;
        } catch {
            return fallback;
        }
    });
    const value =
        state.workspacePreferences?.[phoneWorkspaceKey(state)]?.database?.[field] ?? initial;
    const owner = phoneWorkspaceOwner(state);
    const setValue = useCallback(
        (update: SetStateAction<string>) => {
            setState((current) =>
                setPhoneDatabasePreference(current, owner, field, update, initial),
            );
        },
        [field, initial, owner, setState],
    );
    return [value, setValue] as const;
}
