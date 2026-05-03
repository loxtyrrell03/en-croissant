import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useContext } from "react";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
    currentGameStateAtom,
    currentTabAtom,
    enginesAtom,
    gameInputColorAtom,
    gamePlayer1SettingsAtom,
    gamePlayer2SettingsAtom,
    gameSameTimeControlAtom,
} from "@/state/atoms";
import type { LocalEngine } from "@/utils/engines";
import {
    createDefaultHumanOpponent,
    createDefaultPracticeBotOpponent,
    isLikelyLc0Engine,
} from "@/utils/practiceBot";

function activeColorFromFen(fen: string): "white" | "black" {
    return fen.split(/\s+/)[1] === "b" ? "black" : "white";
}

function selectPracticeEngine(engines: LocalEngine[]) {
    return engines.find(isLikelyLc0Engine) ?? null;
}

export function usePracticeAgainstBot() {
    const store = useContext(TreeStateContext)!;
    const engines = useAtomValue(enginesAtom);
    const setCurrentTab = useSetAtom(currentTabAtom);
    const setGameState = useSetAtom(currentGameStateAtom);
    const setInputColor = useSetAtom(gameInputColorAtom);
    const setPlayer1Settings = useSetAtom(gamePlayer1SettingsAtom);
    const setPlayer2Settings = useSetAtom(gamePlayer2SettingsAtom);
    const setSameTimeControl = useSetAtom(gameSameTimeControlAtom);

    const currentNode = useStore(store, (state) => state.currentNode());
    const headers = useStore(store, (state) => state.headers);
    const setFen = useStore(store, (state) => state.setFen);
    const setHeaders = useStore(store, (state) => state.setHeaders);

    return useCallback(() => {
        const localEngines = (engines ?? []).filter(
            (engine): engine is LocalEngine => engine.type === "local",
        );
        const engine = selectPracticeEngine(localEngines);
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
        setPlayer2Settings(createDefaultPracticeBotOpponent(engine));
        setGameState("settingUp");
        setCurrentTab((tab) => {
            if (!tab) return tab;
            return {
                ...tab,
                type: "play",
                name: tab.type === "play" ? tab.name : `Practice: ${tab.name}`,
            };
        });
    }, [
        currentNode.fen,
        engines,
        headers,
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
