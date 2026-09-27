import {
  Box,
  Button,
  Combobox,
  Group,
  InputBase,
  Loader,
  ScrollArea,
  Stack,
  Text,
  UnstyledButton,
  useCombobox,
  type MantineSize,
} from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { describeFidePlayer, isFidePlayerSearchReady, type FidePlayer } from "@/utils/fidePlayer";
import classes from "./FidePlayerSearchInput.module.css";

const SEARCH_DEBOUNCE_MS = 220;

export function FidePlayerSearchInput({
  value,
  onChange,
  onSelect,
  searchPlayers,
  selected,
  disabled = false,
  label = "Player",
  mobileInline = false,
  size,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (player: FidePlayer) => void;
  searchPlayers: (query: string, signal?: AbortSignal) => Promise<FidePlayer[]>;
  selected: FidePlayer | null;
  disabled?: boolean;
  label?: string;
  mobileInline?: boolean;
  size?: MantineSize;
}) {
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });
  const comboboxRef = useRef(combobox);
  comboboxRef.current = combobox;
  const [results, setResults] = useState<FidePlayer[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const requestTicket = useRef(0);
  const trimmed = value.trim();
  const settled = selected !== null && selected.name === trimmed;

  useEffect(() => {
    setError(null);
    if (disabled || settled || !isFidePlayerSearchReady(trimmed)) {
      requestTicket.current += 1;
      setResults([]);
      setSearched("");
      setSearching(false);
      comboboxRef.current.closeDropdown();
      return;
    }
    const ticket = ++requestTicket.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setResults([]);
    setSearched("");
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchPlayers(trimmed, controller.signal)
        .then((players) => {
          if (ticket !== requestTicket.current) return;
          setResults(players);
          setSearched(trimmed);
          if (!mobileInline && document.activeElement === inputRef.current) {
            comboboxRef.current.openDropdown();
            comboboxRef.current.updateSelectedOptionIndex();
          }
        })
        .catch((error: unknown) => {
          if (ticket !== requestTicket.current) return;
          setResults([]);
          setSearched(trimmed);
          setError(
            error instanceof Error
              ? error.message
              : "FIDE lookup is unavailable. Retry the search.",
          );
          comboboxRef.current.closeDropdown();
        })
        .finally(() => {
          if (ticket === requestTicket.current) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      requestTicket.current += 1;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [disabled, mobileInline, retry, searchPlayers, settled, trimmed]);

  const current = !disabled && !settled && searched === trimmed;
  const currentResults = current ? results : [];
  const showEmpty =
    isFidePlayerSearchReady(trimmed) && !searching && current && !error && results.length === 0;
  const description = selected
    ? `FIDE ${selected.id}${describeFidePlayer(selected) ? ` · ${describeFidePlayer(selected)}` : ""}`
    : "Type a name or FIDE ID to autofill the verified identity.";

  function selectPlayer(player: FidePlayer) {
    requestTicket.current += 1;
    controllerRef.current?.abort();
    setResults([]);
    setSearching(false);
    onSelect(player);
    combobox.closeDropdown();
  }

  const failure =
    current && error ? (
      <Stack gap={4} role="alert">
        <Text c="red" size="sm">
          {error}
        </Text>
        <Button
          variant="subtle"
          size="xs"
          style={{ alignSelf: "flex-start" }}
          onClick={() => {
            inputRef.current?.focus();
            setRetry((value) => value + 1);
          }}
        >
          Retry search
        </Button>
      </Stack>
    ) : null;

  if (mobileInline) {
    const showInlineResults =
      !disabled && !settled && (searching || currentResults.length > 0 || showEmpty);
    return (
      <Stack className={classes.mobilePicker} gap={6}>
        <InputBase
          ref={inputRef}
          aria-expanded={showInlineResults}
          autoCapitalize="words"
          autoComplete="off"
          autoCorrect="off"
          description={description}
          disabled={disabled}
          enterKeyHint="search"
          label={label}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder="Surname, Firstname — or FIDE ID"
          rightSection={searching ? <Loader size={16} /> : null}
          rightSectionPointerEvents="none"
          role="combobox"
          size={size}
          spellCheck={false}
          value={value}
        />
        {failure}
        {showInlineResults ? (
          <Box
            aria-label="FIDE player suggestions"
            aria-live="polite"
            className={classes.mobileResults}
            role="listbox"
          >
            {currentResults.map((player) => (
              <UnstyledButton
                aria-selected={selected?.id === player.id}
                className={classes.mobileOption}
                key={player.id}
                onClick={() => selectPlayer(player)}
                role="option"
              >
                <PlayerOptionContent player={player} />
              </UnstyledButton>
            ))}
            {showEmpty ? (
              <Text c="dimmed" className={classes.mobileEmpty} size="sm">
                No FIDE match. You can still search using the full name without an ID.
              </Text>
            ) : null}
          </Box>
        ) : null}
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      <Combobox
        middlewares={{
          flip: true,
          shift: true,
          size: {
            apply: ({ availableHeight, elements }) => {
              elements.floating.style.setProperty(
                "--fide-available-height",
                `${Math.max(0, availableHeight - 16)}px`,
              );
            },
          },
        }}
        onOptionSubmit={(id) => {
          const player = currentResults.find((candidate) => String(candidate.id) === id);
          if (!player) return;
          selectPlayer(player);
        }}
        store={combobox}
        withinPortal
      >
        <Combobox.Target>
          <InputBase
            ref={inputRef}
            autoCapitalize="words"
            autoComplete="off"
            autoCorrect="off"
            description={description}
            disabled={disabled}
            enterKeyHint="search"
            label={label}
            onChange={(event) => {
              onChange(event.currentTarget.value);
              if (isFidePlayerSearchReady(event.currentTarget.value)) combobox.openDropdown();
            }}
            onClick={() => {
              if (currentResults.length || showEmpty) combobox.openDropdown();
            }}
            onFocus={() => {
              if (currentResults.length || showEmpty) combobox.openDropdown();
            }}
            onBlur={() => combobox.closeDropdown()}
            placeholder="Surname, Firstname — or FIDE ID"
            rightSection={searching ? <Loader size={16} /> : null}
            rightSectionPointerEvents="none"
            role="combobox"
            size={size}
            spellCheck={false}
            value={value}
          />
        </Combobox.Target>
        <Combobox.Dropdown>
          <Combobox.Options>
            <ScrollArea.Autosize
              mah="min(250px, var(--fide-available-height, 40dvh))"
              type="scroll"
            >
              {currentResults.map((player) => (
                <Combobox.Option key={player.id} value={String(player.id)}>
                  <PlayerOptionContent player={player} />
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
      {failure}
    </Stack>
  );
}

function PlayerOptionContent({ player }: { player: FidePlayer }) {
  return (
    <Group gap="xs" justify="space-between" wrap="wrap">
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Text fw={650} size="sm" style={{ overflowWrap: "anywhere" }}>
          {player.title ? `${player.title} ` : ""}
          {player.name}
        </Text>
        <Text c="dimmed" size="xs">
          {describeFidePlayer(player) || "FIDE player"}
        </Text>
      </Stack>
      <Text c="dimmed" ff="monospace" size="xs">
        FIDE {player.id}
      </Text>
    </Group>
  );
}
