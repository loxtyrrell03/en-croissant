import {
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { useState } from "react";
import { TournamentHelp } from "@/features/tournaments/TournamentHelp";
import {
  GAME_ANALYSIS_PRESETS,
  gameAnalysisPreset,
  gameReportLimitLabel,
  presetGameReportLimit,
  type GameAnalysisPreset,
  type GameReportLimit,
} from "@/utils/gameAnalysisSettings";

export default function GameAnalysisLimitControls({
  value,
  onChange,
  error,
}: {
  value: GameReportLimit;
  onChange: (limit: GameReportLimit) => void;
  error?: React.ReactNode;
}) {
  const [custom, setCustom] = useState(false);
  const selected = custom ? "custom" : gameAnalysisPreset(value);
  return (
    <Stack gap="xs">
      <Group gap={5} wrap="nowrap">
        <Text size="sm" fw={500}>
          Analysis limit
        </Text>
        <TournamentHelp label="Game analysis limits">
          Low uses depth 8 and 50 ms, Medium uses depth 16 and 250 ms, and High uses depth 22 and 1
          second per position. The first limit reached stops the search; exact-score recovery shares
          the same time budget.
        </TournamentHelp>
      </Group>
      <SegmentedControl
        aria-label="Game analysis preset"
        fullWidth
        value={selected}
        styles={{
          root: { flexWrap: "wrap" },
          control: { flex: "1 0 auto" },
          label: { whiteSpace: "normal" },
        }}
        data={[
          ...Object.entries(GAME_ANALYSIS_PRESETS).map(([value, preset]) => ({
            value,
            label: preset.label,
          })),
          { value: "custom", label: "Custom" },
        ]}
        onChange={(next) => {
          setCustom(next === "custom");
          if (next !== "custom")
            onChange(presetGameReportLimit(next as Exclude<GameAnalysisPreset, "custom">));
        }}
      />
      <Text size="xs" c="dimmed">
        {gameReportLimitLabel(value)}
      </Text>
      {selected === "custom" && (
        <Stack gap="xs">
          <Select
            label="Limit type"
            allowDeselect={false}
            value={value.t}
            data={[
              { value: "Combined", label: "Depth and time" },
              { value: "Depth", label: "Depth" },
              { value: "Time", label: "Time" },
              { value: "Nodes", label: "Nodes" },
            ]}
            onChange={(type) => {
              if (type === "Combined")
                onChange({
                  t: type,
                  c: {
                    depth: value.t === "Depth" ? value.c : 16,
                    timeMs: value.t === "Time" ? value.c : 250,
                  },
                });
              else if (type === "Depth" || type === "Time" || type === "Nodes")
                onChange({
                  t: type,
                  c:
                    value.t === type
                      ? (value.c as number)
                      : value.t === "Combined" && type !== "Nodes"
                        ? value.c[type === "Depth" ? "depth" : "timeMs"]
                        : type === "Depth"
                          ? 16
                          : type === "Time"
                            ? 250
                            : 100000,
                });
            }}
          />
          {value.t === "Combined" ? (
            <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
              <NumberInput
                label="Depth"
                min={2}
                max={30}
                allowDecimal={false}
                value={value.c.depth}
                onChange={(next) =>
                  onChange({ t: "Combined", c: { ...value.c, depth: Number(next) || 2 } })
                }
              />
              <NumberInput
                label="Time per position (ms)"
                min={50}
                max={5000}
                step={50}
                allowDecimal={false}
                value={value.c.timeMs}
                onChange={(next) =>
                  onChange({ t: "Combined", c: { ...value.c, timeMs: Number(next) || 50 } })
                }
              />
            </SimpleGrid>
          ) : (
            <NumberInput
              min={1}
              allowDecimal={false}
              label={value.t === "Time" ? "Time per position (ms)" : `${value.t} per position`}
              value={value.c}
              onChange={(next) => onChange({ ...value, c: Number(next) || 1 })}
            />
          )}
        </Stack>
      )}
      {error && (
        <Text size="xs" c="red" role="alert">
          {error}
        </Text>
      )}
    </Stack>
  );
}
