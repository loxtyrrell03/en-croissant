import { notifications } from "@mantine/notifications";
import { useAtomValue, useStore } from "jotai";
import { useCallback, useContext } from "react";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { enginesAtom } from "@/state/atoms";
import type { LocalEngine } from "@/utils/engines";
import { isLikelyPatriciaEngine } from "@/utils/practiceBot";
import { openPracticeTab, type PracticeMode } from "@/utils/practiceTabs";

export function useStartPracticeGame(mode: PracticeMode) {
    const tree = useContext(TreeStateContext)!;
    const atoms = useStore();
    const engines = useAtomValue(enginesAtom);
    return useCallback(() => {
        const engine = (engines ?? []).find(
            (item): item is LocalEngine => item.type === "local" && isLikelyPatriciaEngine(item),
        );
        return openPracticeTab({ atoms, tree, mode, engine }).catch((error) => {
            notifications.show({
                title: "Could not start practice",
                message: error instanceof Error ? error.message : String(error),
                color: "red",
            });
        });
    }, [atoms, tree, mode, engines]);
}
