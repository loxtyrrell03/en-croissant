import {
  Badge,
  Box,
  Button,
  Combobox,
  Group,
  Highlight,
  Loader,
  Paper,
  Text,
  TextInput,
  useCombobox,
  type MantineSize,
} from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { describeFidePlayer, searchFidePlayers, type FidePlayer } from "@/utils/fideApi";

const DEBOUNCE_MS = 220;
const MIN_NAME_CHARS = 3;
const MIN_ID_DIGITS = 4;

function isNumeric(value: string): boolean {
  return /^\d+$/.test(value);
}

/**
 * Type-ahead FIDE player search: typing a surname (or a FIDE ID) opens a
 * suggestion list; picking a player pins the canonical FIDE spelling and lets
 * the parent auto-fill the FIDE ID. Mirrors the Outpost import dialog picker.
 */
export default function FidePlayerPicker({
  query,
  onQueryChange,
  selected,
  onSelect,
  onClearSelection,
  disabled = false,
  size,
  label = "Player",
  placeholder = "Surname, Firstname — or a FIDE ID",
  onSubmit,
  ...boxProps
}: {
  query: string;
  onQueryChange: (value: string) => void;
  selected: FidePlayer | null;
  onSelect: (player: FidePlayer) => void;
  onClearSelection: () => void;
  disabled?: boolean;
  size: MantineSize;
  label?: string;
  placeholder?: string;
  onSubmit?: () => void;
  w?: number;
  flex?: number;
  miw?: number;
}) {
  const [results, setResults] = useState<FidePlayer[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState("");
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });
  const ticket = useRef(0);

  const trimmed = query.trim();
  const settled = selected !== null && trimmed === selected.name;

  useEffect(() => {
    if (disabled || settled) {
      setSearching(false);
      return;
    }
    const ready = trimmed.length >= (isNumeric(trimmed) ? MIN_ID_DIGITS : MIN_NAME_CHARS);
    if (!ready) {
      setResults([]);
      setSearched("");
      setSearching(false);
      combobox.closeDropdown();
      return;
    }
    setSearching(true);
    const mine = ++ticket.current;
    const timer = setTimeout(() => {
      void searchFidePlayers(trimmed).then((players) => {
        if (mine !== ticket.current) return;
        setResults(players);
        setSearched(trimmed);
        setSearching(false);
        combobox.openDropdown();
        if (players.length) combobox.selectFirstOption();
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // combobox is a stable store handle; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, settled, trimmed]);

  const showEmpty = !searching && searched === trimmed && results.length === 0 && trimmed.length > 0;

  return (
    <Box {...boxProps}>
      <Combobox
        store={combobox}
        withinPortal
        onOptionSubmit={(value) => {
          const player = results.find((candidate) => String(candidate.id) === value);
          if (!player) return;
          ticket.current += 1;
          setResults([]);
          setSearching(false);
          combobox.closeDropdown();
          onSelect(player);
        }}
      >
        <Combobox.Target>
          <TextInput
            label={label}
            placeholder={placeholder}
            value={query}
            disabled={disabled}
            size={size}
            autoComplete="off"
            spellCheck={false}
            rightSection={searching ? <Loader size="xs" /> : undefined}
            onChange={(event) => {
              onQueryChange(event.currentTarget.value);
              if (selected) onClearSelection();
            }}
            onFocus={() => {
              if (results.length) combobox.openDropdown();
            }}
            onBlur={() => combobox.closeDropdown()}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !combobox.dropdownOpened) {
                event.preventDefault();
                onSubmit?.();
              }
            }}
          />
        </Combobox.Target>
        <Combobox.Dropdown>
          <Combobox.Options>
            {results.map((player) => (
              <Combobox.Option value={String(player.id)} key={player.id}>
                <Group gap="xs" wrap="nowrap" justify="space-between">
                  <Group gap={6} wrap="nowrap" miw={0}>
                    {player.title ? (
                      <Badge size="xs" variant="light" flex="none">
                        {player.title}
                      </Badge>
                    ) : null}
                    <Box miw={0}>
                      <Highlight
                        highlight={trimmed.split(/[\s,]+/).filter((term) => term.length > 1)}
                        size="sm"
                        fw={600}
                        truncate
                      >
                        {player.name}
                      </Highlight>
                      <Text size="xs" c="dimmed" truncate>
                        {describeFidePlayer(player)}
                      </Text>
                    </Box>
                  </Group>
                  <Text size="xs" c="dimmed" flex="none" ff="monospace">
                    {player.id}
                  </Text>
                </Group>
              </Combobox.Option>
            ))}
            {showEmpty ? (
              <Combobox.Empty>
                {isNumeric(trimmed)
                  ? `No FIDE player has ID ${trimmed}.`
                  : /[\s,]/.test(trimmed)
                    ? `No FIDE match — you can still search by name alone.`
                    : "Keep typing — suggestions appear once the surname is complete."}
              </Combobox.Empty>
            ) : null}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>

      {selected ? (
        <Paper withBorder radius="sm" px="sm" py={4} mt={6}>
          <Group gap="xs" wrap="nowrap" justify="space-between">
            <Group gap={6} wrap="nowrap" miw={0}>
              {selected.title ? (
                <Badge size="xs" variant="light" flex="none">
                  {selected.title}
                </Badge>
              ) : null}
              <Text size="sm" fw={600} truncate>
                {selected.name}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {describeFidePlayer(selected)}
              </Text>
            </Group>
            <Button
              size="compact-xs"
              variant="subtle"
              disabled={disabled}
              onClick={() => {
                onClearSelection();
                onQueryChange("");
              }}
            >
              Change
            </Button>
          </Group>
        </Paper>
      ) : null}
    </Box>
  );
}
