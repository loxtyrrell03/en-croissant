import { createFileRoute, lazyRouteComponent, redirect } from "@tanstack/react-router";
import { activeDatabaseViewStore } from "@/state/store/database";

export const Route = createFileRoute("/databases/")({
  component: lazyRouteComponent(() => import("@/components/databases/DatabasesPage")),
  beforeLoad: async () => {
    const db = activeDatabaseViewStore.getState().database;

    if (db) {
      throw redirect({
        to: "/databases/$databaseId",
        params: { databaseId: db.title },
      });
    }
    return null;
  },
});
