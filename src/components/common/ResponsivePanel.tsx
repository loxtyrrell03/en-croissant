import { Box } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import classes from "./ResponsivePanel.module.css";

export type PanelDensity = "regular" | "compact" | "dense";

const PanelDensityContext = createContext<PanelDensity>("regular");

export function getPanelDensity(width: number): PanelDensity {
  if (width > 0 && width < 560) return "dense";
  if (width > 0 && width < 820) return "compact";
  return "regular";
}

export function usePanelDensity() {
  return useContext(PanelDensityContext);
}

export function ResponsivePanel({
  children,
  className,
  density,
  style,
}: {
  children: ReactNode;
  className?: string;
  density?: PanelDensity;
  style?: CSSProperties;
}) {
  const { ref, width } = useElementSize();
  const panelDensity = density ?? getPanelDensity(width);

  return (
    <PanelDensityContext.Provider value={panelDensity}>
      <Box
        ref={ref}
        className={[classes.panel, className].filter(Boolean).join(" ")}
        data-panel-density={panelDensity}
        style={style}
      >
        {children}
      </Box>
    </PanelDensityContext.Provider>
  );
}
