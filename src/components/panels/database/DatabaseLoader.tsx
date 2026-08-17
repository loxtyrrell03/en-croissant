import { Progress } from "@mantine/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

type ProgressPayload = {
  id: string;
  progress: number;
  finished: boolean;
};

function DatabaseLoader({ isLoading, tab }: { isLoading: boolean; tab: string | null }) {
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (!tab) return undefined;

    let disposed = false;
    let cleanup: (() => void) | null = null;

    async function getProgress() {
      const unlisten = await listen<ProgressPayload>("search_progress", async ({ payload }) => {
        if (payload.id !== tab) return;
        if (payload.finished) {
          setCompleted(true);
          setProgress(0);
          unlisten();
        } else {
          setProgress(payload.progress);
        }
      });

      if (disposed) {
        unlisten();
      } else {
        cleanup = unlisten;
      }
    }

    getProgress();

    return () => {
      disposed = true;
      cleanup?.();
      setProgress(0);
      setCompleted(false);
    };
  }, [tab]);

  const isLoadingFromMemory = isLoading && progress === 0;

  return (
    <Progress
      animated={isLoadingFromMemory}
      value={isLoadingFromMemory ? 100 : progress}
      size="xs"
      mt="xs"
    />
  );
}

export default DatabaseLoader;
