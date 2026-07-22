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
  const hasNamedColorLabels = !!colorLabelName;
  const colorOptions = colorLabelName
    ? [
        { value: "white", label: <PlayerColorLabel playerName={colorLabelName} color="white" /> },
        { value: "black", label: <PlayerColorLabel playerName={colorLabelName} color="black" /> },
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
          styles={
            hasNamedColorLabels
              ? {
                  control: {
                    minHeight: size === "sm" ? 42 : 38,
                  },
                  label: {
                    alignItems: "center",
                    display: "flex",
                    height: "100%",
                    justifyContent: "center",
                    minHeight: size === "sm" ? 42 : 38,
                    paddingInline: 4,
                  },
                  innerLabel: {
                    minWidth: 0,
                    width: "100%",
                  },
                }
              : undefined
          }
        />
      </Tooltip>
    </Group>
  );
}

function PlayerColorLabel({
  playerName,
  color,
}: {
  playerName: string;
  color: DatabasePerspectiveColor;
}) {
  return (
    <span
      style={{
        alignItems: "center",
        display: "flex",
        flexDirection: "column",
        gap: 1,
        justifyContent: "center",
        lineHeight: 1.05,
        maxWidth: "100%",
        minWidth: 0,
        whiteSpace: "normal",
      }}
    >
      <span
        style={{
          fontSize: "0.82em",
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {playerName}
      </span>
      <span style={{ fontSize: "0.78em", opacity: 0.9, whiteSpace: "nowrap" }}>as {color}</span>
    </span>
  );
}
