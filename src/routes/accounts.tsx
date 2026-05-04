import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/accounts")({
  component: lazyRouteComponent(() => import("@/components/home/AccountsPage")),
});
