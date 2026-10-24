import { useStore } from "jotai";
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from "react";
import { currentTabAtom, type OpponentPrepState } from "@/state/atoms";
import type { Tab } from "@/utils/tabs";
import { filePreferenceIdentity } from "@/utils/workspacePreferences";
import {
    loadFileBoardPreferences,
    reportFilePreferenceFailure,
    saveFileBoardPreferences,
    type FilePrepMode,
    type FilePrepScope,
    type FilePrepSource,
} from "@/utils/fileBoardPreferences";

export function useFilePrepSources({
    tab,
    scope,
    prep,
    setPrep,
    pristine,
}: {
    tab: Tab | undefined;
    scope: FilePrepScope;
    prep: OpponentPrepState;
    setPrep: Dispatch<SetStateAction<OpponentPrepState>>;
    pristine: boolean;
}) {
    const atoms = useStore();
    const tabId = tab?.value;
    const origin = tab?.gameOrigin;
    const path = origin?.kind === "file" || origin?.kind === "temp_file" ? origin.file.path : null;
    const key = path ? filePreferenceIdentity(path) : null;
    const context = key ? JSON.stringify([tab?.value, key, scope, prep.mode]) : null;
    const initialPristine = useRef(pristine);
    const previous = useRef<{ tab: string | undefined; path: string | null } | null>(null);
    const explicitSource = useRef<string | null>(null);
    const explicitMode = useRef(false);
    const [ready, setReady] = useState<string | null>(null);
    const isOwnerCurrent = useCallback(() => {
        if (!tabId) return true;
        const owner = atoms.get(currentTabAtom);
        const source = owner?.gameOrigin;
        const latestPath =
            source?.kind === "file" || source?.kind === "temp_file"
                ? filePreferenceIdentity(source.file.path)
                : null;
        return owner?.value === tabId && latestPath === key;
    }, [atoms, key, tabId]);

    useEffect(() => {
        if (!isOwnerCurrent()) return;
        if (!context || !path) {
            previous.current = { tab: tab?.value, path: key };
            setReady(null);
            return;
        }
        const first = previous.current === null;
        const rebound = previous.current?.tab === tab?.value && previous.current?.path !== key;
        const manual = explicitSource.current === context;
        previous.current = { tab: tab?.value, path: key };
        explicitSource.current = null;
        if (!rebound && !manual && (!first || initialPristine.current)) {
            try {
                const saved = loadFileBoardPreferences(path);
                const mode =
                    first && !explicitMode.current
                        ? (saved?.prepModes?.[scope] ?? prep.mode)
                        : prep.mode;
                const source = saved?.prepSources?.[`${scope}:${mode}`];
                setPrep((current) => {
                    if (!isOwnerCurrent() || current.mode !== prep.mode) return current;
                    const chosen: FilePrepSource | undefined =
                        source ??
                        (mode !== current.mode
                            ? {
                                  source: mode === "general" ? "lch_all" : "local",
                                  databasePath: null,
                                  databaseLabel: mode === "general" ? "Lichess All" : null,
                              }
                            : undefined);
                    if (
                        !chosen ||
                        (current.mode === mode &&
                            current.source === chosen.source &&
                            current.databasePath === chosen.databasePath &&
                            current.databaseLabel === chosen.databaseLabel)
                    )
                        return current;
                    return {
                        ...current,
                        ...chosen,
                        mode,
                        player: null,
                        playerName: "",
                        completedBranches: {},
                        skippedBranches: {},
                    };
                });
            } catch (error) {
                reportFilePreferenceFailure(error);
            }
        }
        setReady(context);
    }, [context, isOwnerCurrent, key, path, prep.mode, scope, setPrep, tab?.value]);

    useEffect(() => {
        if (!path || !context || ready !== context || !isOwnerCurrent()) return;
        try {
            saveFileBoardPreferences(path, {
                prepModes: { [scope]: prep.mode },
                prepSources: {
                    [`${scope}:${prep.mode}`]: {
                        source: prep.source,
                        databasePath: prep.databasePath,
                        databaseLabel: prep.databaseLabel,
                    },
                },
            });
        } catch (error) {
            reportFilePreferenceFailure(error);
        }
    }, [
        context,
        isOwnerCurrent,
        path,
        prep.databaseLabel,
        prep.databasePath,
        prep.mode,
        prep.source,
        ready,
        scope,
    ]);

    const markModeChoice = useCallback(() => {
        explicitMode.current = true;
        explicitSource.current = null;
    }, []);
    const markSourceChoice = useCallback(
        (mode: FilePrepMode) => {
            explicitMode.current = true;
            explicitSource.current = key ? JSON.stringify([tab?.value, key, scope, mode]) : null;
        },
        [key, scope, tab?.value],
    );
    return { markModeChoice, markSourceChoice, isOwnerCurrent };
}
