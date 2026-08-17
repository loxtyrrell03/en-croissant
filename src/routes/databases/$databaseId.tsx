import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/databases/$databaseId")({
  component: lazyRouteComponent(() => import("@/components/databases/DatabaseView")),
});
