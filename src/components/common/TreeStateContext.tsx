import { createContext, useMemo, useRef } from "react";
import { createTreeStore, type TreeStore } from "@/state/store/tree";
import { getTabTreeStore } from "@/state/store/treeRegistry";
import type { TreeState } from "@/utils/treeReducer";

export const TreeStateContext = createContext<TreeStore | null>(null);

export function TreeStateProvider({
  id,
  initial,
  children,
}: {
  id?: string;
  initial?: TreeState;
  children: React.ReactNode;
}) {
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const store = useMemo(
    () =>
      id ? getTabTreeStore(id, initialRef.current) : createTreeStore(undefined, initialRef.current),
    [id],
  );

  return <TreeStateContext.Provider value={store}>{children}</TreeStateContext.Provider>;
}
