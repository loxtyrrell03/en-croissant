import {
  Box,
  Button,
  Group,
  InputWrapper,
  Loader,
  Popover,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
  type MantineSize,
} from "@mantine/core";
import { IconChevronDown, IconChevronLeft, IconDatabase, IconFolder } from "@tabler/icons-react";
import { useMemo, useState, type CSSProperties } from "react";
import type { DatabaseSelectGroup } from "@/utils/db";

type DatabaseFolderSelectItem = DatabaseSelectGroup["items"][number] & {
  detail?: string;
  searchText?: string;
};

type DatabaseFolderSelectGroup = {
  group: string;
  items: DatabaseFolderSelectItem[];
};

type DatabaseFolderSelectProps = {
  data: DatabaseFolderSelectGroup[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  size?: MantineSize;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
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
  loading = false,
  loadingLabel,
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
  const [query, setQuery] = useState("");
  const openPicker = () => {
    setActiveGroup(null);
    setQuery("");
    setOpened(true);
  };
  const closePicker = () => {
    setActiveGroup(null);
    setQuery("");
    setOpened(false);
  };
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
  const totalItemCount = data.reduce((sum, group) => sum + group.items.length, 0);
  const showSearch = totalItemCount > 6 || folderGroups.length > 0;
  const searchMatches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];

    return data
      .flatMap((group) =>
        group.items.map((item) => ({
          item,
          group: group.group,
        })),
      )
      .filter(({ item, group }) =>
        [item.label, item.detail, item.searchText, group]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery),
      );
  }, [data, query]);
  const trimmedQuery = query.trim();
  const buttonLabel = loading ? loadingLabel ?? "Loading database" : selectedItem?.label ?? placeholder;
  const control = (
    <Popover
      opened={opened}
      onChange={(next) => {
        if (next) openPicker();
        else closePicker();
      }}
      position="bottom-start"
      withinPortal
      shadow="md"
    >
      <Popover.Target>
        <Button
          variant="default"
          size={size}
          disabled={disabled || loading}
          justify="space-between"
          leftSection={
            loading ? (
              <Loader size="xs" />
            ) : selectedItem ? (
              <IconDatabase size="1rem" />
            ) : (
              <IconFolder size="1rem" />
            )
          }
          rightSection={<IconChevronDown size="1rem" />}
          onClick={() => {
            if (opened) closePicker();
            else openPicker();
          }}
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
        <Stack gap={6}>
          {showSearch ? (
            <TextInput
              aria-label="Search databases"
              placeholder="Search databases"
              size={size}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          ) : null}
          {trimmedQuery ? (
            <ScrollArea.Autosize mah={320} type="auto">
              <Stack gap={2}>
                {searchMatches.length > 0 ? (
                  searchMatches.map(({ item, group }) => (
                    <DatabaseRow
                      key={`${group}-${item.value}`}
                      item={item}
                      groupLabel={group}
                      selected={item.value === value}
                      allowDeselect={allowDeselect}
                      value={value}
                      onChange={onChange}
                      onClose={closePicker}
                    />
                  ))
                ) : (
                  <Text size="xs" c="dimmed" px={8} py={6}>
                    No databases match "{trimmedQuery}".
                  </Text>
                )}
              </Stack>
            </ScrollArea.Autosize>
          ) : !visibleGroup ? (
            <Stack gap={4}>
              {rootGroup?.items.map((item) => (
                <DatabaseRow
                  key={item.value}
                  item={item}
                  selected={item.value === value}
                  allowDeselect={allowDeselect}
                  value={value}
                  onChange={onChange}
                  onClose={closePicker}
                />
              ))}
              {rootGroup && folderGroups.length > 0 && (
                <Box h={1} my={2} style={{ background: "var(--mantine-color-default-border)" }} />
              )}
              {selectedGroup && selectedGroup.group !== "Unfiled" && (
                <FolderRow
                  label={selectedGroup.group}
                  detail="Open current folder"
                  onClick={() => setActiveGroup(selectedGroup.group)}
                />
              )}
              {folderGroups
                .filter((group) => group.group !== selectedGroup?.group)
                .map((group) => (
                  <FolderRow
                    key={group.group}
                    label={group.group}
                    detail={`Open - ${group.items.length} database${group.items.length === 1 ? "" : "s"}`}
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
                      groupLabel={visibleGroup.group}
                      selected={item.value === value}
                      allowDeselect={allowDeselect}
                      value={value}
                      onChange={onChange}
                      onClose={closePicker}
                    />
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            </Stack>
          )}
        </Stack>
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
  groupLabel,
  selected,
  allowDeselect,
  value,
  onChange,
  onClose,
}: {
  item: DatabaseFolderSelectItem;
  groupLabel?: string;
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
      py={7}
      style={{
        borderRadius: 6,
        opacity: item.disabled ? 0.45 : 1,
        background: selected ? "var(--mantine-color-default-hover)" : "transparent",
      }}
    >
      <Group gap={8} wrap="nowrap" align="flex-start">
        <IconDatabase size="1rem" style={{ marginTop: 2, flexShrink: 0 }} />
        <Box miw={0}>
          <Text size="sm" fw={selected ? 600 : 400} truncate>
            {item.label}
          </Text>
          {item.detail || groupLabel ? (
            <Text size="xs" c="dimmed" truncate>
              {[groupLabel && groupLabel !== "Unfiled" ? groupLabel : null, item.detail]
                .filter(Boolean)
                .join(" - ")}
            </Text>
          ) : null}
        </Box>
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
