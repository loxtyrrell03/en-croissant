import { Group, SegmentedControl, Tooltip } from "@mantine/core";
import { PlayerSearchInput } from "@/components/databases/PlayerSearchInput";

export type DatabasePerspectiveColor = "white" | "black";

export function DatabasePerspectiveControls({
  databasePath,
  player,
  playerName,
  color,
  onPlayerChange,
  onPlayerNameChange,
  onColorChange,
  size = "xs",
  playerWidth = 170,
  colorWidth = 132,
}: {
  databasePath: string | null | undefined;
  player: number | null;
  playerName?: string;
  color: DatabasePerspectiveColor;
  onPlayerChange: (player: number | null) => void;
  onPlayerNameChange: (playerName: string) => void;
  onColorChange: (color: DatabasePerspectiveColor) => void;
  size?: "xs" | "sm";
  playerWidth?: number;
  colorWidth?: number;
}) {
  if (!databasePath) return null;

  return (
    <Group gap={4} wrap="nowrap">
      <Tooltip label="Filter this database to one player's games">
        <div style={{ width: playerWidth }}>
          <PlayerSearchInput
            label="Username"
            value={player ?? undefined}
            file={databasePath}
            textValue={playerName ?? ""}
            setTextValue={onPlayerNameChange}
            setValue={(value) => onPlayerChange(value ?? null)}
            size={size}
          />
        </div>
      </Tooltip>
      <Tooltip label="Only games where that player had this color">
        <SegmentedControl
          aria-label="Database player color"
          size={size}
          data={[
            { value: "white", label: "White" },
            { value: "black", label: "Black" },
          ]}
          value={color}
          onChange={(value) => onColorChange(value as DatabasePerspectiveColor)}
          w={colorWidth}
        />
      </Tooltip>
    </Group>
  );
}
