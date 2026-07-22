import { Box, Group } from "@mantine/core";
import type { ReactNode } from "react";
import { usePanelDensity } from "@/components/common/ResponsivePanel";
import classes from "./GridLayout.module.css";

function GridLayout({
  search,
  table,
  preview,
}: {
  search: ReactNode;
  table: ReactNode;
  preview: ReactNode;
}) {
  const density = usePanelDensity();
  const stacked = density === "dense";
  const compact = density !== "regular";

  return (
    <Group
      grow
      h="100%"
      align="stretch"
      gap={compact ? 6 : "md"}
      wrap={stacked ? "wrap" : "nowrap"}
    >
      <Box
        style={{
          display: "flex",
          gap: compact ? 6 : "1rem",
          flexDirection: "column",
          height: stacked ? "50%" : "100%",
          flex: stacked ? "1 1 100%" : "1 1 0",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <Box className={classes.search}>{search}</Box>
        {table}
      </Box>

      <Box
        style={{
          display: "flex",
          gap: compact ? 6 : "1rem",
          flexDirection: "column",
          height: stacked ? "50%" : "100%",
          flex: stacked ? "1 1 100%" : "1 1 0",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        {preview}
      </Box>
    </Group>
  );
}

export default GridLayout;
