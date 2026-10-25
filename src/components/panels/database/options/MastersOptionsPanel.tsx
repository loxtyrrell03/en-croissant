import { GameDateRangeControl } from "@/components/common/GameDateRangeControl";
import { applyExplorerGameDates, storedGameDateRange } from "@/utils/gameDateRange";
import { Stack, NumberInput } from "@mantine/core";
import type { MasterGamesOptions } from "@/utils/lichess/explorer";

const MasterOptionsPanel = ({
  options,
  setOptions,
}: {
  options: MasterGamesOptions;
  setOptions: (
    value: MasterGamesOptions | ((current: MasterGamesOptions) => MasterGamesOptions),
  ) => void;
}) => {
  return (
    <Stack>
      <GameDateRangeControl
        value={storedGameDateRange(options.dateRange, options.since, options.until)}
        precision="year"
        onChange={(dateRange) =>
          setOptions((current) => applyExplorerGameDates({ ...current, dateRange }, "year"))
        }
      />
      <NumberInput
        label="Top games"
        value={options.topGames ?? 15}
        min={1}
        max={15}
        step={1}
        onChange={(value) =>
          setOptions({ ...options, topGames: typeof value === "number" ? value : 15 })
        }
      />
    </Stack>
  );
};

export default MasterOptionsPanel;
