import { Group, Text } from "@mantine/core";
import { useContext, useEffect, useState } from "react";
import { useStore } from "zustand";
import { TournamentHelp } from "@/features/tournaments/TournamentHelp";
import { gameReportLimitLabel } from "@/utils/gameAnalysisSettings";
import {
  GAME_REPORT_RUN_HEADER,
  type GameReportRun,
  readGameReportRun,
} from "@/utils/gameReportRun";
import type { TreeNode } from "@/utils/treeReducer";
import { TreeStateContext } from "./TreeStateContext";

export function GameReportRunLabel() {
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (state) => state.root);
  const raw = useStore(store, (state) => state.headers.other?.[GAME_REPORT_RUN_HEADER]);
  const [verified, setVerified] = useState<{
    root: TreeNode;
    raw: string | undefined;
    run: GameReportRun | null;
  }>();
  useEffect(() => {
    let current = true;
    void readGameReportRun(raw, root).then((run) => {
      if (current) setVerified({ root, raw, run });
    });
    return () => {
      current = false;
    };
  }, [raw, root]);
  const run = verified?.root === root && verified.raw === raw ? verified.run : null;
  return (
    <Group gap={4} wrap="wrap">
      <Text size="xs" c="dimmed">
        {run ? gameReportLimitLabel(run.limit) : "Analysis limits not recorded"}
      </Text>
      {run && (
        <TournamentHelp label="About this analysis run">
          {run.engine || "Analysis engine"} · {new Date(run.completedAt).toLocaleString()}. These
          are the limits used for this saved report.
        </TournamentHelp>
      )}
    </Group>
  );
}
