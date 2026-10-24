import { type Atom, useAtomValue } from "jotai";
import { createContext, useContext } from "react";

export const NotationViewContext = createContext({ readOnly: false, forceDetails: false });

export function useNotationDetail(preference: Atom<boolean>): boolean {
    const saved = useAtomValue(preference);
    return useContext(NotationViewContext).forceDetails || saved;
}
