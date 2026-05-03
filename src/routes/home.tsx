import { createFileRoute } from "@tanstack/react-router";
import NewTabHome from "@/components/tabs/NewTabHome";

export const Route = createFileRoute("/home")({
  component: NewTabHome,
  loader: ({ context: { loadDirs } }) => loadDirs(),
});
