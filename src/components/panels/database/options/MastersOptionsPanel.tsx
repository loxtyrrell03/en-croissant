import { Group, NumberInput } from "@mantine/core";
import { YearPickerInput } from "@mantine/dates";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { masterOptionsAtom } from "@/state/atoms";
import { MIN_DATE } from "@/utils/lichess/api";

const MasterOptionsPanel = () => {
  const { t } = useTranslation();
  const [options, setOptions] = useAtom(masterOptionsAtom);
  return (
    <Group grow>
      <YearPickerInput
        label={t("Common.Since")}
        placeholder={t("Common.PickDate")}
        value={options.since}
        minDate={MIN_DATE}
        maxDate={new Date()}
        onChange={(value) => setOptions({ ...options, since: value ? new Date(value) : undefined })}
        clearable
      />
      <YearPickerInput
        label={t("Common.Until")}
        placeholder={t("Common.PickDate")}
        value={options.until}
        minDate={MIN_DATE}
        maxDate={new Date()}
        onChange={(value) => setOptions({ ...options, until: value ? new Date(value) : undefined })}
        clearable
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
    </Group>
  );
};

export default MasterOptionsPanel;
