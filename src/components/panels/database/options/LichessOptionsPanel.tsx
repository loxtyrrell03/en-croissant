import { GameDateRangeControl } from "@/components/common/GameDateRangeControl";
import { applyExplorerGameDates, storedGameDateRange } from "@/utils/gameDateRange";
import { Group, Select, Stack, TextInput } from "@mantine/core";
import {
  IconChevronRight,
  IconChevronsRight,
  IconClockHour4,
  IconFlame,
  IconHourglassHigh,
  IconSend,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { match } from "ts-pattern";
import ToggleButtonGroup, {
  type ToggleButtonGroupOption,
} from "@/components/common/ToggleButtonGroup";
import { capitalize } from "@/utils/format";
import type {
  LichessGamesOptions,
  LichessGameSpeed,
  LichessRating,
} from "@/utils/lichess/explorer";

const LichessOptionsPanel = ({
  options,
  setOptions,
}: {
  options: LichessGamesOptions;
  setOptions: (
    value: LichessGamesOptions | ((current: LichessGamesOptions) => LichessGamesOptions),
  ) => void;
}) => {
  const { t } = useTranslation();

  const timeControls: LichessGameSpeed[] = [
    "ultraBullet",
    "bullet",
    "blitz",
    "rapid",
    "classical",
    "correspondence",
  ];
  const ratings: LichessRating[] = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];

  function mapTimeControl(speed: LichessGameSpeed): ToggleButtonGroupOption<LichessGameSpeed> {
    const name = `${speed.charAt(0).toUpperCase()}${speed.slice(1)}`;
    const icon = match(speed)
      .with("ultraBullet", () => <IconChevronsRight />)
      .with("bullet", () => <IconChevronRight />)
      .with("blitz", () => <IconFlame />)
      .with("rapid", () => <IconHourglassHigh />)
      .with("classical", () => <IconClockHour4 />)
      .with("correspondence", () => <IconSend />)
      .exhaustive();
    return {
      content: icon,
      name: t(`TimeControl.${capitalize(name)}`),
      value: speed,
      isToggled: (options.speeds ?? []).some((s) => s === speed),
    };
  }

  function mapRatingOption(rating: LichessRating): ToggleButtonGroupOption<LichessRating> {
    const name = rating === 0 ? "400" : rating.toString();
    return {
      content: <span>{name}</span>,
      name: name,
      value: rating,
      isToggled: (options.ratings ?? []).some((r) => r === rating),
    };
  }

  function toggleTimeControl(speed: LichessGameSpeed) {
    const selected = options.speeds ?? [];
    const newSelected = [...selected];
    const index = newSelected.indexOf(speed);
    if (index >= 0) {
      if (newSelected.length > 1) {
        newSelected.splice(index, 1);
      }
    } else {
      newSelected.push(speed);
    }
    setOptions({ ...options, speeds: newSelected });
  }

  function toggleRating(rating: LichessRating) {
    const selected = options.ratings ?? [];
    const newSelected = [...selected];
    const index = newSelected.indexOf(rating);
    if (index >= 0) {
      if (newSelected.length > 1) {
        newSelected.splice(index, 1);
      }
    } else {
      newSelected.push(rating);
    }
    setOptions({ ...options, ratings: newSelected });
  }

  return (
    <Stack justify="flex-start">
      <ToggleButtonGroup
        label={t("Board.Database.TimeControl")}
        options={timeControls.map(mapTimeControl)}
        toggleOption={toggleTimeControl}
        minButtonWidth="9ch"
        includeTooltips
      />
      <ToggleButtonGroup
        label={t("Board.Database.AverageRating")}
        options={ratings.map(mapRatingOption)}
        toggleOption={toggleRating}
        minButtonWidth="9ch"
      />
      <GameDateRangeControl
        value={storedGameDateRange(options.dateRange, options.since, options.until)}
        precision="month"
        onChange={(dateRange) =>
          setOptions((current) => applyExplorerGameDates({ ...current, dateRange }, "month"))
        }
      />
      <Group grow>
        <TextInput
          label="Player"
          placeholder="Player's username"
          value={options.player ?? ""}
          onChange={(e) => setOptions({ ...options, player: e.currentTarget.value })}
        />
        <Select
          label="Color"
          placeholder="Select color"
          data={[
            { label: "White", value: "white" },
            { label: "Black", value: "black" },
          ]}
          value={options.color}
          onChange={(v) => setOptions({ ...options, color: v as "white" | "black" })}
          clearable={false}
        />
      </Group>
    </Stack>
  );
};

export default LichessOptionsPanel;
