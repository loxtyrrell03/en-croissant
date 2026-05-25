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
  colorLabelPlayerName,
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
  colorLabelPlayerName?: string;
}) {
  if (!databasePath) return null;

  const colorLabelName = colorLabelPlayerName?.trim();
  const colorOptions = colorLabelName
    ? [
        { value: "white", label: `${colorLabelName} as white` },
        { value: "black", label: `${colorLabelName} as black` },
      ]
    : [
        { value: "white", label: "White" },
        { value: "black", label: "Black" },
      ];

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
      <Tooltip
        label={
          colorLabelName
            ? `Only games where ${colorLabelName} had this color`
            : "Only games where that player had this color"
        }
      >
        <SegmentedControl
          aria-label="Database player color"
          size={size}
          data={colorOptions}
          value={color}
          onChange={(value) => onColorChange(value as DatabasePerspectiveColor)}
          w={colorWidth}
        />
      </Tooltip>
    </Group>
  );
}
