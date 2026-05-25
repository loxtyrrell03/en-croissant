import {
  ActionIcon,
  NumberInput,
  Popover,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";
import { useAtom } from "jotai";
import { moveStrengthSettingsAtom } from "@/state/atoms";
import { normalizeMoveStrengthSettings, type MoveStrengthSettings } from "@/utils/moveStrength";

export function MoveStrengthSettingsButton({ size = "sm" }: { size?: "xs" | "sm" | "md" | "lg" }) {
  const [settings, setSettings] = useAtom(moveStrengthSettingsAtom);
  const normalized = normalizeMoveStrengthSettings(settings);
  const updateSettings = (patch: Partial<MoveStrengthSettings>) => {
    setSettings((current) => normalizeMoveStrengthSettings({ ...current, ...patch }));
  };

  return (
    <Popover width={260} position="bottom-end" shadow="md">
      <Popover.Target>
        <ActionIcon
          variant="default"
          size={size}
          aria-label="Strength settings"
          title="Strength settings"
        >
          <IconSettings size="1rem" />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="sm" fw={700}>
            Strength settings
          </Text>
          <SegmentedControl
            aria-label="Move strength mode"
            data={[
              { value: "smart", label: "Smart" },
              { value: "engine", label: "Engine" },
              { value: "practical", label: "Practical" },
            ]}
            value={normalized.mode}
            onChange={(value) => updateSettings({ mode: value as MoveStrengthSettings["mode"] })}
            size="xs"
          />
          <Tooltip label="In Smart mode, 0 is database WDL only and 100 is cloud engine only">
            <NumberInput
              label="Engine blend"
              suffix="%"
              value={normalized.engineWeight}
              onChange={(value) =>
                updateSettings({ engineWeight: Math.max(0, Math.min(100, Number(value) || 0)) })
              }
              min={0}
              max={100}
              step={5}
              size="xs"
            />
          </Tooltip>
          <Tooltip label="Moves worse than this cloud-engine drop are treated as unsafe">
            <NumberInput
              label="Max CP drop"
              suffix=" cp"
              value={normalized.maxEngineCpLoss}
              onChange={(value) =>
                updateSettings({ maxEngineCpLoss: Math.max(0, Math.min(300, Number(value) || 0)) })
              }
              min={0}
              max={300}
              step={5}
              size="xs"
            />
          </Tooltip>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
