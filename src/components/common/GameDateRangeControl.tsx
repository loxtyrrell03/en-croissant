import { Button, Group, Select, Stack, Text, TextInput } from "@mantine/core";
import { useState } from "react";
import { TournamentHelp } from "@/features/tournaments/TournamentHelp";
import styles from "./GameDateRangeControl.module.css";
import {
  expandGameDateBound,
  gameDateBounds,
  GAME_DATE_PERIODS,
  validCustomGameDates,
  isGameDateRange,
  ALL_GAME_DATES,
  type GameDatePeriod,
  type GameDatePrecision,
  type GameDateRange,
} from "@/utils/gameDateRange";

export function GameDateRangeControl({
  value,
  precision,
  onChange,
  disabled = false,
}: {
  value: GameDateRange;
  precision: GameDatePrecision;
  onChange: (range: GameDateRange) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const invalidSaved = !isGameDateRange(value);
  value = invalidSaved ? ALL_GAME_DATES : value;
  const length = precision === "year" ? 4 : precision === "month" ? 7 : 10;
  const start = expandGameDateBound(since),
    end = expandGameDateBound(until, true);
  const invalid =
    Boolean((since && !start) || (until && !end)) || !validCustomGameDates(start, end);
  const bounds = gameDateBounds(value, precision);
  const begin = () => {
    const dates = gameDateBounds(value, "day");
    setSince((dates.since ?? "").replaceAll(".", "-").slice(0, length));
    setUntil((dates.until ?? "").replaceAll(".", "-").slice(0, length));
    setEditing(true);
  };
  const apply = () => {
    if (disabled || invalid) return;
    onChange({ period: start || end ? "custom" : "all", since: start, until: end });
    setEditing(false);
  };
  return (
    <Stack className={styles.control} gap={5} style={{ minWidth: 0, flexShrink: 0 }}>
      {invalidSaved && (
        <Group gap={6}>
          <Text size="xs" c="red" role="alert">
            Saved dates are invalid. Choose a range before searching.
          </Text>
          <Button
            size="compact-xs"
            variant="light"
            disabled={disabled}
            onClick={() => onChange(ALL_GAME_DATES)}
          >
            Clear date filter
          </Button>
        </Group>
      )}
      <Group gap={6} wrap="wrap">
        <Text size="xs">Dates</Text>
        <TournamentHelp label="Game date range">
          Ranges include both endpoints and quick ranges count back from today.{" "}
          {precision === "month"
            ? "This source includes whole months touched by the range."
            : precision === "year"
              ? "Lichess Masters includes whole years touched by the range."
              : "Games without dates are excluded when filtering."}
        </TournamentHelp>
        <Select
          aria-label="Game date range"
          size="xs"
          w={155}
          maw="100%"
          maxDropdownHeight={240}
          value={editing ? "custom" : value.period}
          disabled={disabled}
          allowDeselect={false}
          data={GAME_DATE_PERIODS.filter(
            ([period]) => precision !== "year" || !/^\d+m$/.test(period) || period === value.period,
          ).map(([value, label]) => ({ value, label }))}
          onChange={(period) => {
            if (period === "custom") begin();
            else if (period) {
              setEditing(false);
              onChange({ period: period as GameDatePeriod, since: "", until: "" });
            }
          }}
        />
        {precision !== "day" && (
          <Text size="xs" c="dimmed">
            By {precision}
          </Text>
        )}
        {!editing && value.period === "custom" && (
          <Button size="compact-xs" variant="subtle" disabled={disabled} onClick={begin}>
            Edit dates
          </Button>
        )}
        {!editing && value.period !== "all" && (
          <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
            {bounds.since ?? "Any date"} – {bounds.until ?? "Any date"}
          </Text>
        )}
      </Group>
      {editing && (
        <Group gap={6} wrap="wrap" align="flex-end">
          {(["From", "To"] as const).map((label, index) => (
            <TextInput
              key={label}
              label={label}
              aria-label={`${label} date`}
              size="xs"
              type={precision === "year" ? "number" : precision === "month" ? "month" : "date"}
              min={precision === "year" ? 1 : undefined}
              max={precision === "year" ? 9999 : undefined}
              value={index ? until : since}
              disabled={disabled}
              style={{ flex: "1 1 135px", minWidth: 0, maxWidth: 190 }}
              onChange={(event) => (index ? setUntil : setSince)(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  apply();
                }
              }}
            />
          ))}
          <Button size="xs" disabled={disabled || invalid} onClick={apply}>
            Apply dates
          </Button>
          <Button size="xs" variant="subtle" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          {invalid && (
            <Text size="xs" c="red" role="alert" style={{ flexBasis: "100%" }}>
              Choose valid dates with From on or before To.
            </Text>
          )}
        </Group>
      )}
    </Stack>
  );
}
