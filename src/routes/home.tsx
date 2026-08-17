import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/home")({
  component: lazyRouteComponent(() => import("@/components/tabs/NewTabHome")),
  loader: ({ context: { loadDirs } }) => loadDirs(),
});
