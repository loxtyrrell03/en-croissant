import { Box } from "@mantine/core";
import { useAtomValue } from "jotai";
import { sessionsAtom } from "@/state/atoms";
import StatsWorkspace from "@/web/StatsWorkspace";
import classes from "./StatsPage.module.css";

export default function StatsPage() {
  const sessions = useAtomValue(sessionsAtom);
  const lichessToken =
    sessions.find((session) => session.lichess?.accessToken)?.lichess?.accessToken ?? "";

  return (
    <Box className={classes.page}>
      <StatsWorkspace lichessToken={lichessToken} />
    </Box>
  );
}
