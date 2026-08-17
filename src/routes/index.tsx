import { createFileRoute, lazyRouteComponent, Navigate, redirect } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { tabsAtom } from "@/state/atoms";
import type { Tab } from "@/utils/tabs";

const BoardsPage = lazyRouteComponent(() => import("@/components/tabs/BoardsPage"));

export const Route = createFileRoute("/")({
  component: WorkspaceRoute,
  loader: ({ context: { loadDirs } }) => {
    if (!hasPersistedWorkspaceTabs()) {
      throw redirect({ to: "/home" });
    }
    return loadDirs();
  },
});

function WorkspaceRoute() {
  const tabs = useAtomValue(tabsAtom);
  const workspaceTabs = tabs.filter(isWorkspaceTab);

  if (workspaceTabs.length === 0) {
    return <Navigate to="/home" replace />;
  }

  return <BoardsPage />;
}

function isWorkspaceTab(tab: Tab) {
  return tab.type !== "new";
}

function hasPersistedWorkspaceTabs() {
  if (typeof sessionStorage === "undefined") return true;

  try {
    const raw = sessionStorage.getItem("tabs");
    if (!raw) return false;
    const tabs = JSON.parse(raw);
    return Array.isArray(tabs) && tabs.some((tab) => tab?.type && tab.type !== "new");
  } catch {
    return false;
  }
}
