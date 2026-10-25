import { atomWithDebouncedStorage } from "./debouncedLocalStorage";

export interface WorkspaceLayoutState {
  rightWidthPercent: number;
  topRightHeight: number | null;
  bottomRightHeight: number | null;
}

// Pane drags retain the existing buffered writes; reset/restore shares this atom.
export const workspaceLayoutAtom = atomWithDebouncedStorage<WorkspaceLayoutState>(
  "boardWorkspaceLayout",
  {
    rightWidthPercent: 54,
    topRightHeight: null,
    bottomRightHeight: null,
  },
);
