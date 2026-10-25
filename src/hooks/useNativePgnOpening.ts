import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { installNativePgnOpening } from "@/utils/shellPgnOpening";

export function useNativePgnOpening(ready: boolean) {
    const setTabs = useSetAtom(tabsAtom);
    const setActiveTab = useSetAtom(activeTabAtom);
    useEffect(() => {
        if (ready) return installNativePgnOpening(setTabs, setActiveTab);
    }, [ready, setTabs, setActiveTab]);
}
