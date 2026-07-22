import { Autocomplete, type AutocompleteProps } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { commands, type Player } from "@/bindings";
import { query_players } from "@/utils/db";
import { unwrap } from "@/utils/unwrap";

export function PlayerSearchInput({
  label,
  value,
  file,
  rightSection,
  textValue,
  setTextValue,
  size,
  setValue,
}: {
  label: string;
  value?: number;
  file: string;
  rightSection?: ReactNode;
  textValue?: string;
  setTextValue?: (val: string) => void;
  size?: AutocompleteProps["size"];
  setValue: (val: number | undefined) => void;
}) {
  const [tempValue, setTempValue] = useState("");
  const [data, setData] = useState<Player[]>([]);
  const displayedValue = textValue ?? tempValue;

  const setDisplayedValue = useCallback(
    (val: string) => {
      if (textValue !== undefined) {
        setTextValue?.(val);
        return;
      }

      setTempValue(val);
    },
    [setTextValue, textValue],
  );

  useEffect(() => {
    if (value !== undefined) {
      commands.getPlayer(file, value).then((res) => {
        const player = unwrap(res);
        if (player?.name && (textValue === undefined || textValue.trim().length === 0)) {
          setDisplayedValue(player.name);
        }
      });
    }
  }, [file, setDisplayedValue, textValue, value]);

  async function handleChange(val: string) {
    setDisplayedValue(val);
    if (val.trim().length === 0) {
      setValue(undefined);
      setData([]);
      return;
    }
    const player = data.find((player) => player.name === val);
    if (player) {
      setValue(player.id);
    } else {
      setValue(undefined);
    }

    const res = await query_players(file, {
      name: val,
      options: {
        page: 1,
        pageSize: 5,
        skipCount: true,
        sort: "elo",
        direction: "asc",
      },
    });
    setData(res.data);

    const fetchedPlayer = res.data.find((player) => player.name === val);
    if (fetchedPlayer) {
      setValue(fetchedPlayer.id);
    }
  }
  return (
    <Autocomplete
      value={displayedValue}
      data={data.map((player) => player.name!)}
      onChange={handleChange}
      rightSection={rightSection}
      leftSection={<IconSearch size="1rem" />}
      placeholder={label}
      size={size}
    />
  );
}
