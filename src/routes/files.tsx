import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/files")({
  component: lazyRouteComponent(() => import("@/components/files/FilesPage")),
  loader: ({ context: { loadDirs } }) => loadDirs(),
});
