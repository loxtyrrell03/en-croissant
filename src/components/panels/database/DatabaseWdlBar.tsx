import { WdlResultBar } from "@/components/common/WdlResultBar";
import type { DatabaseResultPerspective } from "@/utils/db";

export function DatabaseWdlBar({
  white,
  draw,
  black,
  perspective = null,
  compact = false,
  dense = false,
}: {
  white: number;
  draw: number;
  black: number;
  perspective?: DatabaseResultPerspective | null;
  compact?: boolean;
  dense?: boolean;
}) {
  return (
    <WdlResultBar
      white={white}
      draw={draw}
      black={black}
      perspective={perspective}
      compact={compact}
      dense={dense}
    />
  );
}
