import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useContext } from "react";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
    currentBlindfoldGameSettingsAtom,
    currentGameStateAtom,
    currentTabAtom,
    DEFAULT_BLINDFOLD_GAME_SETTINGS,
    enginesAtom,
    gameInputColorAtom,
    gamePlayer1SettingsAtom,
    gamePlayer2SettingsAtom,
    gameSameTimeControlAtom,
} from "@/state/atoms";
import type { LocalEngine } from "@/utils/engines";
import {
    createDefaultHumanOpponent,
    createDefaultMaiaOpponent,
    DEFAULT_BLINDFOLD_MAIA_ELO,
    isLikelyMaiaEngine,
} from "@/utils/practiceBot";

function activeColorFromFen(fen: string): "white" | "black" {
    return fen.split(/\s+/)[1] === "b" ? "black" : "white";
}

function selectMaiaEngine(engines: LocalEngine[]) {
    return engines.find(isLikelyMaiaEngine) ?? null;
}

export function useBlindfoldMaiaTrainer() {
    const store = useContext(TreeStateContext)!;
    const engines = useAtomValue(enginesAtom);
    const setCurrentTab = useSetAtom(currentTabAtom);
    const setGameState = useSetAtom(currentGameStateAtom);
    const setInputColor = useSetAtom(gameInputColorAtom);
    const setPlayer1Settings = useSetAtom(gamePlayer1SettingsAtom);
    const setPlayer2Settings = useSetAtom(gamePlayer2SettingsAtom);
    const setSameTimeControl = useSetAtom(gameSameTimeControlAtom);
    const setBlindfoldSettings = useSetAtom(currentBlindfoldGameSettingsAtom);

    const currentNode = useStore(store, (state) => state.currentNode());
    const headers = useStore(store, (state) => state.headers);
    const setFen = useStore(store, (state) => state.setFen);
    const setHeaders = useStore(store, (state) => state.setHeaders);

    return useCallback(() => {
        const localEngines = (engines ?? []).filter(
            (engine): engine is LocalEngine => engine.type === "local",
        );
        const engine = selectMaiaEngine(localEngines);
        const sideToMove = activeColorFromFen(currentNode.fen);

        setFen(currentNode.fen);
        setHeaders({
            ...headers,
            fen: currentNode.fen,
            orientation: sideToMove,
            result: "*",
        });
        setInputColor(sideToMove);
        setSameTimeControl(true);
        setPlayer1Settings(createDefaultHumanOpponent());
        setPlayer2Settings(createDefaultMaiaOpponent(engine, DEFAULT_BLINDFOLD_MAIA_ELO));
        setBlindfoldSettings({
            ...DEFAULT_BLINDFOLD_GAME_SETTINGS,
            enabled: true,
        });
        setGameState("settingUp");
        setCurrentTab((tab) => {
            if (!tab) return tab;
            return {
                ...tab,
                type: "play",
                name: tab.type === "play" ? tab.name : `Blindfold: ${tab.name}`,
            };
        });
    }, [
        currentNode.fen,
        engines,
        headers,
        setBlindfoldSettings,
        setCurrentTab,
        setFen,
        setGameState,
        setHeaders,
        setInputColor,
        setPlayer1Settings,
        setPlayer2Settings,
        setSameTimeControl,
    ]);
}
