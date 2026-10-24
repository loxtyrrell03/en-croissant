import type { createStore } from "jotai";
import {
    activeTabAtom,
    blindfoldGameSettingsFamily,
    DEFAULT_BLINDFOLD_GAME_SETTINGS,
    gameInputColorAtom,
    gamePlayer1SettingsAtom,
    gamePlayer2SettingsAtom,
    gameSameTimeControlAtom,
    tabsAtom,
} from "@/state/atoms";
import type { TreeStore } from "@/state/store/tree";
import { tabTreeOwner } from "@/state/store/treeOwner";
import type { LocalEngine } from "./engines";
import {
    createDefaultBlindfoldHumanOpponent,
    createDefaultBlindfoldMaiaOpponent,
    createDefaultHumanOpponent,
    createDefaultPracticeBotOpponent,
} from "./practiceBot";
import { createTab } from "./tabs";
import { defaultTree } from "./treeReducer";

export type PracticeMode = "standard" | "bot" | "blindfold";

export async function openPracticeTab({
    atoms,
    tree,
    mode,
    engine = null,
}: {
    atoms: ReturnType<typeof createStore>;
    tree: TreeStore;
    mode: PracticeMode;
    engine?: LocalEngine | null;
}) {
    const owner = tabTreeOwner(tree);
    const source = atoms.get(tabsAtom).find((tab) => tab.value === owner);
    if (!source) throw new Error("This analysis tab is no longer open.");
    const fen = tree.getState().currentNode().fen;
    const sideToMove = fen.split(/\s+/)[1] === "b" ? "black" : "white";
    const initial = defaultTree(fen);
    initial.headers.orientation =
        mode === "standard" ? tree.getState().headers.orientation : sideToMove;
    const label = mode === "blindfold" ? "Blindfold" : mode === "bot" ? "Practice" : "Play";
    const id = await createTab({
        tab: { name: `${label}: ${source.name}`, type: "play" },
        gameOrigin: { kind: "none" },
        initialState: initial,
        setTabs: (update) => atoms.set(tabsAtom, update),
        // Configure the new tab's keyed state before displaying it. Never write
        // through a current-tab atom after an await.
        setActiveTab: () => {},
    });
    atoms.set(blindfoldGameSettingsFamily(id), {
        ...DEFAULT_BLINDFOLD_GAME_SETTINGS,
        enabled: mode === "blindfold",
    });
    if (mode !== "standard") {
        atoms.set(gameInputColorAtom, sideToMove);
        atoms.set(gameSameTimeControlAtom, true);
        atoms.set(
            gamePlayer1SettingsAtom,
            mode === "blindfold"
                ? createDefaultBlindfoldHumanOpponent()
                : createDefaultHumanOpponent(),
        );
        atoms.set(
            gamePlayer2SettingsAtom,
            mode === "blindfold"
                ? createDefaultBlindfoldMaiaOpponent()
                : createDefaultPracticeBotOpponent(engine),
        );
    }
    atoms.set(activeTabAtom, (active) => (active === source.value ? id : active));
    return id;
}
