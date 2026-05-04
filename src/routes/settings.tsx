import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { getVersion } from "@tauri-apps/api/app";

export const Route = createFileRoute("/settings")({
  component: lazyRouteComponent(() => import("@/components/settings/SettingsPage")),
  loader: async ({ context: { loadDirs } }) => ({
    dirs: await loadDirs(),
    version: await getVersion(),
  }),
});
