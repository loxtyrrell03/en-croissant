import {
  ActionIcon,
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
  Tooltip,
  UnstyledButton,
  type MantineSize,
} from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronLeft,
  IconDatabase,
  IconFolder,
  IconPinned,
  IconPinnedOff,
} from "@tabler/icons-react";
import { useCallback, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
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

type DatabasePickerPreferences = {
  pinnedValues: string[];
  manualOrder: Record<string, string[]>;
};

const DATABASE_PICKER_PREFERENCES_KEY = "database-picker-preferences";
const DEFAULT_DATABASE_PICKER_PREFERENCES: DatabasePickerPreferences = {
  pinnedValues: [],
  manualOrder: {},
};
const databasePickerPreferenceListeners = new Set<() => void>();
let cachedDatabasePickerPreferencesRaw: string | null | undefined;
let cachedDatabasePickerPreferences: DatabasePickerPreferences =
  DEFAULT_DATABASE_PICKER_PREFERENCES;

function getLocalStorage() {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeDatabasePickerPreferences(value: unknown): DatabasePickerPreferences {
  if (!value || typeof value !== "object") return DEFAULT_DATABASE_PICKER_PREFERENCES;

  const record = value as Partial<DatabasePickerPreferences>;
  const pinnedValues = Array.isArray(record.pinnedValues)
    ? record.pinnedValues.filter((item): item is string => typeof item === "string")
    : [];
  const rawManualOrder = record.manualOrder as Record<string, unknown> | undefined;
  const manualOrder =
    rawManualOrder && typeof rawManualOrder === "object"
      ? Object.fromEntries(
          Object.entries(rawManualOrder)
            .filter(([, order]) => Array.isArray(order))
            .map(([group, order]) => [
              group,
              (order as unknown[]).filter((item): item is string => typeof item === "string"),
            ]),
        )
      : {};

  return {
    pinnedValues: Array.from(new Set(pinnedValues)),
    manualOrder,
  };
}

function readDatabasePickerPreferences() {
  const storage = getLocalStorage();
  if (!storage) return DEFAULT_DATABASE_PICKER_PREFERENCES;

  const raw = storage.getItem(DATABASE_PICKER_PREFERENCES_KEY);
  if (raw === cachedDatabasePickerPreferencesRaw) return cachedDatabasePickerPreferences;

  cachedDatabasePickerPreferencesRaw = raw;
  if (!raw) {
    cachedDatabasePickerPreferences = DEFAULT_DATABASE_PICKER_PREFERENCES;
    return cachedDatabasePickerPreferences;
  }

  try {
    cachedDatabasePickerPreferences = normalizeDatabasePickerPreferences(JSON.parse(raw));
  } catch {
    cachedDatabasePickerPreferences = DEFAULT_DATABASE_PICKER_PREFERENCES;
  }

  return cachedDatabasePickerPreferences;
}

function subscribeDatabasePickerPreferences(listener: () => void) {
  databasePickerPreferenceListeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key === DATABASE_PICKER_PREFERENCES_KEY || event.key === null) {
      cachedDatabasePickerPreferencesRaw = undefined;
      listener();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }

  return () => {
    databasePickerPreferenceListeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

function writeDatabasePickerPreferences(
  updater: (current: DatabasePickerPreferences) => DatabasePickerPreferences,
) {
  const next = normalizeDatabasePickerPreferences(updater(readDatabasePickerPreferences()));
  const storage = getLocalStorage();
  const raw = JSON.stringify(next);

  cachedDatabasePickerPreferences = next;
  cachedDatabasePickerPreferencesRaw = raw;
  try {
    storage?.setItem(DATABASE_PICKER_PREFERENCES_KEY, raw);
  } catch {
    // Keep the in-memory preference update for this session if storage is unavailable.
  }
  databasePickerPreferenceListeners.forEach((listener) => listener());
}

function useDatabasePickerPreferences() {
  const preferences = useSyncExternalStore(
    subscribeDatabasePickerPreferences,
    readDatabasePickerPreferences,
    () => DEFAULT_DATABASE_PICKER_PREFERENCES,
  );

  const updatePreferences = useCallback(
    (updater: (current: DatabasePickerPreferences) => DatabasePickerPreferences) => {
      writeDatabasePickerPreferences(updater);
    },
    [],
  );

  return [preferences, updatePreferences] as const;
}

function orderDatabaseItems(
  items: DatabaseFolderSelectItem[],
  group: string,
  preferences: DatabasePickerPreferences,
) {
  const originalIndex = new Map(items.map((item, index) => [item.value, index]));
  const pinnedValues = new Set(preferences.pinnedValues);
  const pinnedIndex = new Map(preferences.pinnedValues.map((value, index) => [value, index]));
  const manualIndex = new Map(
    (preferences.manualOrder[group] ?? []).map((value, index) => [value, index]),
  );

  return [...items].sort((a, b) => {
    const pinnedDifference = Number(pinnedValues.has(b.value)) - Number(pinnedValues.has(a.value));
    if (pinnedDifference !== 0) return pinnedDifference;

    const aManualIndex = manualIndex.get(a.value);
    const bManualIndex = manualIndex.get(b.value);
    if (aManualIndex !== undefined && bManualIndex !== undefined) {
      return aManualIndex - bManualIndex;
    }
    if (aManualIndex !== undefined) return -1;
    if (bManualIndex !== undefined) return 1;

    if (pinnedValues.has(a.value) && pinnedValues.has(b.value)) {
      const pinnedDifference =
        (pinnedIndex.get(a.value) ?? Number.MAX_SAFE_INTEGER) -
        (pinnedIndex.get(b.value) ?? Number.MAX_SAFE_INTEGER);
      if (pinnedDifference !== 0) return pinnedDifference;
    }

    return (originalIndex.get(a.value) ?? 0) - (originalIndex.get(b.value) ?? 0);
  });
}

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
  const [preferences, updatePreferences] = useDatabasePickerPreferences();
  const [opened, setOpened] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const pinnedValueSet = useMemo(() => new Set(preferences.pinnedValues), [preferences]);
  const orderedData = useMemo(
    () =>
      data.map((group) => ({
        ...group,
        items: orderDatabaseItems(group.items, group.group, preferences),
      })),
    [data, preferences],
  );
  const allItems = useMemo(
    () =>
      orderedData.flatMap((group) =>
        group.items.map((item) => ({
          item,
          group: group.group,
        })),
      ),
    [orderedData],
  );
  const pinnedItems = useMemo(() => {
    const seen = new Set<string>();
    const pinnedIndex = new Map(preferences.pinnedValues.map((item, index) => [item, index]));

    return allItems
      .filter(({ item }) => {
        if (!pinnedValueSet.has(item.value) || seen.has(item.value)) return false;
        seen.add(item.value);
        return true;
      })
      .sort(
        (a, b) =>
          (pinnedIndex.get(a.item.value) ?? Number.MAX_SAFE_INTEGER) -
          (pinnedIndex.get(b.item.value) ?? Number.MAX_SAFE_INTEGER),
      );
  }, [allItems, pinnedValueSet, preferences.pinnedValues]);
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
    () => allItems.find(({ item }) => item.value === value)?.item ?? null,
    [allItems, value],
  );
  const selectedGroup = useMemo(
    () => orderedData.find((group) => group.items.some((item) => item.value === value)) ?? null,
    [orderedData, value],
  );
  const visibleGroup = activeGroup
    ? orderedData.find((group) => group.group === activeGroup)
    : null;
  const rootGroup = orderedData.find((group) => group.group === "Unfiled") ?? null;
  const rootItems = rootGroup?.items.filter((item) => !pinnedValueSet.has(item.value)) ?? [];
  const folderGroups = orderedData.filter((group) => group.group !== "Unfiled");
  const totalItemCount = orderedData.reduce((sum, group) => sum + group.items.length, 0);
  const showSearch = totalItemCount > 6 || folderGroups.length > 0;
  const searchMatches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];

    return allItems.filter(({ item, group }) =>
      [item.label, item.detail, item.searchText, group]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [allItems, query]);
  const trimmedQuery = query.trim();
  const buttonLabel = loading
    ? (loadingLabel ?? "Loading database")
    : (selectedItem?.label ?? placeholder);
  const togglePinned = useCallback(
    (itemValue: string) => {
      updatePreferences((current) => {
        const isPinned = current.pinnedValues.includes(itemValue);
        return {
          ...current,
          pinnedValues: isPinned
            ? current.pinnedValues.filter((value) => value !== itemValue)
            : [...current.pinnedValues, itemValue],
        };
      });
    },
    [updatePreferences],
  );
  const movePinned = useCallback(
    (itemValue: string, direction: "up" | "down") => {
      const visiblePinnedValues = pinnedItems.map(({ item }) => item.value);
      const currentIndex = visiblePinnedValues.indexOf(itemValue);
      const targetIndex = currentIndex + (direction === "up" ? -1 : 1);
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= visiblePinnedValues.length) return;

      const nextVisiblePinnedValues = [...visiblePinnedValues];
      [nextVisiblePinnedValues[currentIndex], nextVisiblePinnedValues[targetIndex]] = [
        nextVisiblePinnedValues[targetIndex],
        nextVisiblePinnedValues[currentIndex],
      ];
      const visiblePinnedValueSet = new Set(visiblePinnedValues);

      updatePreferences((current) => ({
        ...current,
        pinnedValues: [
          ...nextVisiblePinnedValues,
          ...current.pinnedValues.filter((value) => !visiblePinnedValueSet.has(value)),
        ],
      }));
    },
    [pinnedItems, updatePreferences],
  );
  const moveWithinGroup = useCallback(
    (group: string, itemValue: string, direction: "up" | "down") => {
      const items = orderedData.find((candidate) => candidate.group === group)?.items ?? [];
      const currentIndex = items.findIndex((item) => item.value === itemValue);
      const targetIndex = currentIndex + (direction === "up" ? -1 : 1);
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= items.length) return;

      const currentPinned = pinnedValueSet.has(itemValue);
      if (pinnedValueSet.has(items[targetIndex].value) !== currentPinned) return;

      const nextOrder = items.map((item) => item.value);
      [nextOrder[currentIndex], nextOrder[targetIndex]] = [
        nextOrder[targetIndex],
        nextOrder[currentIndex],
      ];

      updatePreferences((current) => ({
        ...current,
        manualOrder: {
          ...current.manualOrder,
          [group]: nextOrder,
        },
      }));
    },
    [orderedData, pinnedValueSet, updatePreferences],
  );
  const getGroupMoveState = useCallback(
    (group: string, itemValue: string) => {
      const items = orderedData.find((candidate) => candidate.group === group)?.items ?? [];
      const index = items.findIndex((item) => item.value === itemValue);
      const isPinned = pinnedValueSet.has(itemValue);

      return {
        canMoveUp: index > 0 && pinnedValueSet.has(items[index - 1].value) === isPinned,
        canMoveDown:
          index >= 0 &&
          index < items.length - 1 &&
          pinnedValueSet.has(items[index + 1].value) === isPinned,
      };
    },
    [orderedData, pinnedValueSet],
  );
  const getPinnedMoveState = useCallback(
    (itemValue: string) => {
      const index = pinnedItems.findIndex(({ item }) => item.value === itemValue);
      return {
        canMoveUp: index > 0,
        canMoveDown: index >= 0 && index < pinnedItems.length - 1,
      };
    },
    [pinnedItems],
  );
  const preferencePropsFor = useCallback(
    (item: DatabaseFolderSelectItem, group: string, mode: "group" | "pinned" | "search") => {
      const pinned = pinnedValueSet.has(item.value);
      const moveState =
        mode === "pinned" ? getPinnedMoveState(item.value) : getGroupMoveState(group, item.value);

      return {
        isPinned: pinned,
        canMoveUp: mode !== "search" && moveState.canMoveUp,
        canMoveDown: mode !== "search" && moveState.canMoveDown,
        showMoveControls: mode !== "search" && totalItemCount > 1,
        onTogglePin: () => togglePinned(item.value),
        onMoveUp: () =>
          mode === "pinned"
            ? movePinned(item.value, "up")
            : moveWithinGroup(group, item.value, "up"),
        onMoveDown: () =>
          mode === "pinned"
            ? movePinned(item.value, "down")
            : moveWithinGroup(group, item.value, "down"),
      };
    },
    [
      getGroupMoveState,
      getPinnedMoveState,
      movePinned,
      moveWithinGroup,
      pinnedValueSet,
      togglePinned,
      totalItemCount,
    ],
  );
  const hasRowsAfterPinned = rootItems.length > 0 || folderGroups.length > 0;
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
                      preferences={preferencePropsFor(item, group, "search")}
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
              {pinnedItems.map(({ item, group }) => (
                <DatabaseRow
                  key={`pinned-${item.value}`}
                  item={item}
                  groupLabel={group}
                  selected={item.value === value}
                  allowDeselect={allowDeselect}
                  value={value}
                  onChange={onChange}
                  onClose={closePicker}
                  preferences={preferencePropsFor(item, group, "pinned")}
                />
              ))}
              {pinnedItems.length > 0 && hasRowsAfterPinned && (
                <Box h={1} my={2} style={{ background: "var(--mantine-color-default-border)" }} />
              )}
              {rootItems.map((item) => (
                <DatabaseRow
                  key={item.value}
                  item={item}
                  selected={item.value === value}
                  allowDeselect={allowDeselect}
                  value={value}
                  onChange={onChange}
                  onClose={closePicker}
                  preferences={preferencePropsFor(item, rootGroup?.group ?? "Unfiled", "group")}
                />
              ))}
              {rootItems.length > 0 && folderGroups.length > 0 && (
                <Box h={1} my={2} style={{ background: "var(--mantine-color-default-border)" }} />
              )}
              {selectedGroup && selectedGroup.group !== "Unfiled" && (
                <FolderRow
                  label={selectedGroup.group}
                  detail="Current"
                  onClick={() => setActiveGroup(selectedGroup.group)}
                />
              )}
              {folderGroups
                .filter((group) => group.group !== selectedGroup?.group)
                .map((group) => (
                  <FolderRow
                    key={group.group}
                    label={group.group}
                    detail={`${group.items.length} db${group.items.length === 1 ? "" : "s"}`}
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
                      preferences={preferencePropsFor(item, visibleGroup.group, "group")}
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
  preferences,
}: {
  item: DatabaseFolderSelectItem;
  groupLabel?: string;
  selected: boolean;
  allowDeselect: boolean;
  value: string | null;
  onChange: (value: string | null) => void;
  onClose: () => void;
  preferences: {
    isPinned: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    showMoveControls: boolean;
    onTogglePin: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
  };
}) {
  const detail = [groupLabel && groupLabel !== "Unfiled" ? groupLabel : null, item.detail]
    .filter(Boolean)
    .join(" - ");

  return (
    <Box
      px={4}
      py={2}
      style={{
        width: "100%",
        borderRadius: 6,
        background: selected ? "var(--mantine-color-default-hover)" : "transparent",
      }}
    >
      <Group gap={4} wrap="nowrap" align="center">
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
          px={4}
          py={4}
          style={{
            flex: 1,
            minWidth: 0,
            borderRadius: 4,
            opacity: item.disabled ? 0.45 : 1,
          }}
        >
          <Group gap={8} wrap="nowrap" align="flex-start">
            <IconDatabase size="1rem" style={{ marginTop: 2, flexShrink: 0 }} />
            <Box miw={0} style={{ flex: 1 }}>
              <Group gap={4} wrap="nowrap" align="center">
                <Text size="sm" fw={selected ? 600 : 400} truncate>
                  {item.label}
                </Text>
                {preferences.isPinned ? (
                  <IconPinned size={12} style={{ flexShrink: 0, opacity: 0.72 }} />
                ) : null}
              </Group>
              {detail ? (
                <Text size="xs" c="dimmed" truncate>
                  {detail}
                </Text>
              ) : null}
            </Box>
          </Group>
        </UnstyledButton>
        <Group gap={0} wrap="nowrap" style={{ flexShrink: 0 }}>
          {preferences.showMoveControls ? (
            <>
              <Tooltip label="Move up">
                <ActionIcon
                  aria-label={`Move ${item.label} up`}
                  size="compact-xs"
                  variant="subtle"
                  disabled={!preferences.canMoveUp}
                  onClick={preferences.onMoveUp}
                >
                  <IconArrowUp size={13} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Move down">
                <ActionIcon
                  aria-label={`Move ${item.label} down`}
                  size="compact-xs"
                  variant="subtle"
                  disabled={!preferences.canMoveDown}
                  onClick={preferences.onMoveDown}
                >
                  <IconArrowDown size={13} />
                </ActionIcon>
              </Tooltip>
            </>
          ) : null}
          <Tooltip label={preferences.isPinned ? "Unpin database" : "Pin database"}>
            <ActionIcon
              aria-label={`${preferences.isPinned ? "Unpin" : "Pin"} ${item.label}`}
              size="compact-xs"
              variant="subtle"
              onClick={preferences.onTogglePin}
            >
              {preferences.isPinned ? <IconPinnedOff size={13} /> : <IconPinned size={13} />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </Box>
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
  const displayLabel = label.split(" / ").at(-1) ?? label;

  return (
    <UnstyledButton onClick={onClick} px={8} py={6} style={{ width: "100%", borderRadius: 6 }}>
      <Group gap={8} wrap="nowrap" align="flex-start">
        <IconFolder size="1rem" style={{ marginTop: 2, flexShrink: 0 }} />
        <Box miw={0} style={{ flex: 1 }}>
          <Text size="sm" fw={600} truncate>
            {displayLabel}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {detail}
          </Text>
        </Box>
      </Group>
    </UnstyledButton>
  );
}
