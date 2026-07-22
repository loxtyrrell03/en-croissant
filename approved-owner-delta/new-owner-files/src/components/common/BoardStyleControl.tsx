import { SegmentedControl } from "@mantine/core";
import { useAtom } from "jotai";
import { boardStyleAtom } from "@/state/atoms";
import type { BoardStyle } from "@/utils/boardStyle";

export default function BoardStyleControl({
  fullWidth = false,
  size = "sm",
}: {
  fullWidth?: boolean;
  size?: "xs" | "sm" | "md";
}) {
  const [boardStyle, setBoardStyle] = useAtom(boardStyleAtom);

  return (
    <SegmentedControl
      size={size}
      fullWidth={fullWidth}
      value={boardStyle}
      onChange={(value) => setBoardStyle(value as BoardStyle)}
      data={[
        { label: "Default", value: "default" },
        { label: "Chess.com style", value: "chess-com" },
      ]}
    />
  );
}
