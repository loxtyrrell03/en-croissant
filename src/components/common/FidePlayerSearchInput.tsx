import {
  Combobox,
  Group,
  InputBase,
  Loader,
  ScrollArea,
  Stack,
  Text,
  useCombobox,
  type MantineSize,
} from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { describeFidePlayer, isFidePlayerSearchReady, type FidePlayer } from "@/utils/fidePlayer";

const SEARCH_DEBOUNCE_MS = 220;

export function FidePlayerSearchInput({
  value,
  onChange,
  onSelect,
  searchPlayers,
  selected,
  disabled = false,
  label = "Player",
  size,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (player: FidePlayer) => void;
  searchPlayers: (query: string) => Promise<FidePlayer[]>;
  selected: FidePlayer | null;
  disabled?: boolean;
  label?: string;
  size?: MantineSize;
}) {
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });
  const [results, setResults] = useState<FidePlayer[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState("");
  const requestTicket = useRef(0);
  const trimmed = value.trim();
  const settled = selected !== null && selected.name === trimmed;

  useEffect(() => {
    if (disabled || settled || !isFidePlayerSearchReady(trimmed)) {
      requestTicket.current += 1;
      setResults([]);
      setSearched("");
      setSearching(false);
      combobox.closeDropdown();
      return;
    }
    const ticket = ++requestTicket.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchPlayers(trimmed)
        .then((players) => {
          if (ticket !== requestTicket.current) return;
          setResults(players);
          setSearched(trimmed);
          combobox.openDropdown();
          combobox.updateSelectedOptionIndex();
        })
        .catch(() => {
          if (ticket !== requestTicket.current) return;
          setResults([]);
          setSearched(trimmed);
          combobox.openDropdown();
        })
        .finally(() => {
          if (ticket === requestTicket.current) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [combobox, disabled, searchPlayers, settled, trimmed]);

  const showEmpty = !searching && searched === trimmed && results.length === 0;

  return (
    <Combobox
      onOptionSubmit={(id) => {
        const player = results.find((candidate) => String(candidate.id) === id);
        if (!player) return;
        requestTicket.current += 1;
        setResults([]);
        setSearching(false);
        onSelect(player);
        combobox.closeDropdown();
      }}
      store={combobox}
      withinPortal
    >
      <Combobox.Target>
        <InputBase
          autoCapitalize="words"
          autoComplete="off"
          description={
            selected
              ? `FIDE ${selected.id}${describeFidePlayer(selected) ? ` · ${describeFidePlayer(selected)}` : ""}`
              : "Type a name or FIDE ID to autofill the verified identity."
          }
          disabled={disabled}
          label={label}
          onChange={(event) => {
            onChange(event.currentTarget.value);
            if (isFidePlayerSearchReady(event.currentTarget.value)) combobox.openDropdown();
          }}
          onClick={() => {
            if (results.length || showEmpty) combobox.openDropdown();
          }}
          onFocus={() => {
            if (results.length || showEmpty) combobox.openDropdown();
          }}
          placeholder="Surname, Firstname — or FIDE ID"
          rightSection={searching ? <Loader size={16} /> : null}
          rightSectionPointerEvents="none"
          role="combobox"
          size={size}
          value={value}
        />
      </Combobox.Target>
      <Combobox.Dropdown>
        <Combobox.Options>
          <ScrollArea.Autosize mah={250} type="scroll">
            {results.map((player) => (
              <Combobox.Option key={player.id} value={String(player.id)}>
                <Group gap="xs" justify="space-between" wrap="nowrap">
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Text fw={650} size="sm" truncate>
                      {player.title ? `${player.title} ` : ""}
                      {player.name}
                    </Text>
                    <Text c="dimmed" size="xs" truncate>
                      {describeFidePlayer(player) || "FIDE player"}
                    </Text>
                  </Stack>
                  <Text c="dimmed" ff="monospace" size="xs">
                    {player.id}
                  </Text>
                </Group>
              </Combobox.Option>
            ))}
            {showEmpty ? (
              <Combobox.Empty>
                No FIDE match. You can still search using the full name without an ID.
              </Combobox.Empty>
            ) : null}
          </ScrollArea.Autosize>
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
