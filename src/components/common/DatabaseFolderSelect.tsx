import {
  Box,
  Button,
  Group,
  InputWrapper,
  Popover,
  ScrollArea,
  Stack,
  Text,
  UnstyledButton,
  type MantineSize,
} from "@mantine/core";
import { IconChevronDown, IconChevronLeft, IconDatabase, IconFolder } from "@tabler/icons-react";
import { useMemo, useState, type CSSProperties } from "react";
import type { DatabaseSelectGroup } from "@/utils/db";

type DatabaseFolderSelectProps = {
  data: DatabaseSelectGroup[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  size?: MantineSize;
  disabled?: boolean;
  allowDeselect?: boolean;
  label?: string;
  width?: string | number;
  minWidth?: string | number;
  maxWidth?: string | number;
  flex?: CSSProperties["flex"];
  style?: CSSProperties;
};

export default function DatabaseFolderSelect({
  data,
  value,
  onChange,
  placeholder = "Select database",
  size = "sm",
  disabled = false,
  allowDeselect = true,
  label,
  width,
  minWidth,
  maxWidth,
  flex,
  style,
}: DatabaseFolderSelectProps) {
  const [opened, setOpened] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const selectedItem = useMemo(
    () => data.flatMap((group) => group.items).find((item) => item.value === value) ?? null,
    [data, value],
  );
  const selectedGroup = useMemo(
    () => data.find((group) => group.items.some((item) => item.value === value)) ?? null,
    [data, value],
  );
  const visibleGroup = activeGroup ? data.find((group) => group.group === activeGroup) : null;
  const rootGroup = data.find((group) => group.group === "Unfiled") ?? null;
  const folderGroups = data.filter((group) => group.group !== "Unfiled");
  const buttonLabel = selectedItem?.label ?? placeholder;
  const control = (
    <Popover
      opened={opened}
      onChange={(next) => {
        setOpened(next);
        if (next) setActiveGroup(null);
      }}
      position="bottom-start"
      withinPortal
      shadow="md"
    >
      <Popover.Target>
        <Button
          variant="default"
          size={size}
          disabled={disabled}
          justify="space-between"
          leftSection={selectedItem ? <IconDatabase size="1rem" /> : <IconFolder size="1rem" />}
          rightSection={<IconChevronDown size="1rem" />}
          onClick={() => setOpened((current) => !current)}
          w={width}
          miw={minWidth}
          maw={maxWidth}
          flex={flex}
          style={{ ...style, minWidth }}
        >
          <Box miw={0} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {buttonLabel}
          </Box>
        </Button>
      </Popover.Target>

      <Popover.Dropdown p={6} miw={260} maw={420}>
        {!visibleGroup ? (
          <Stack gap={4}>
            {rootGroup?.items.map((item) => (
              <DatabaseRow
                key={item.value}
                item={item}
                selected={item.value === value}
                allowDeselect={allowDeselect}
                value={value}
                onChange={onChange}
                onClose={() => setOpened(false)}
              />
            ))}
            {rootGroup && folderGroups.length > 0 && (
              <Box h={1} my={2} style={{ background: "var(--mantine-color-default-border)" }} />
            )}
            {selectedGroup && selectedGroup.group !== "Unfiled" && (
              <FolderRow
                label={selectedGroup.group}
                detail="Selected folder"
                onClick={() => setActiveGroup(selectedGroup.group)}
              />
            )}
            {folderGroups
              .filter((group) => group.group !== selectedGroup?.group)
              .map((group) => (
                <FolderRow
                  key={group.group}
                  label={group.group}
                  detail={`${group.items.length} database${group.items.length === 1 ? "" : "s"}`}
                  onClick={() => setActiveGroup(group.group)}
                />
              ))}
          </Stack>
        ) : (
          <Stack gap={4}>
            <UnstyledButton
              onClick={() => setActiveGroup(null)}
              px={8}
              py={6}
              style={{ borderRadius: 6 }}
            >
              <Group gap={6} wrap="nowrap">
                <IconChevronLeft size="1rem" />
                <Text size="sm" fw={600}>
                  {visibleGroup.group}
                </Text>
              </Group>
            </UnstyledButton>
            <ScrollArea.Autosize mah={280} type="auto">
              <Stack gap={2}>
                {visibleGroup.items.map((item) => (
                  <DatabaseRow
                    key={item.value}
                    item={item}
                    selected={item.value === value}
                    allowDeselect={allowDeselect}
                    value={value}
                    onChange={onChange}
                    onClose={() => setOpened(false)}
                  />
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Stack>
        )}
      </Popover.Dropdown>
    </Popover>
  );

  if (!label) return control;

  return (
    <InputWrapper label={label} size={size} style={{ flex, minWidth }}>
      {control}
    </InputWrapper>
  );
}

function DatabaseRow({
  item,
  selected,
  allowDeselect,
  value,
  onChange,
  onClose,
}: {
  item: { value: string; label: string; disabled?: boolean };
  selected: boolean;
  allowDeselect: boolean;
  value: string | null;
  onChange: (value: string | null) => void;
  onClose: () => void;
}) {
  return (
    <UnstyledButton
      disabled={item.disabled}
      onClick={() => {
        if (item.disabled) return;
        if (allowDeselect && item.value === value) {
          onChange(null);
        } else {
          onChange(item.value);
        }
        onClose();
      }}
      px={8}
      py={6}
      style={{
        borderRadius: 6,
        opacity: item.disabled ? 0.45 : 1,
        background: selected ? "var(--mantine-color-default-hover)" : "transparent",
      }}
    >
      <Group gap={8} wrap="nowrap">
        <IconDatabase size="1rem" />
        <Text size="sm" truncate>
          {item.label}
        </Text>
      </Group>
    </UnstyledButton>
  );
}

function FolderRow({
  label,
  detail,
  onClick,
}: {
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <UnstyledButton onClick={onClick} px={8} py={7} style={{ borderRadius: 6 }}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap={8} wrap="nowrap" miw={0}>
          <IconFolder size="1rem" />
          <Text size="sm" fw={600} truncate>
            {label}
          </Text>
        </Group>
        <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
          {detail}
        </Text>
      </Group>
    </UnstyledButton>
  );
}
