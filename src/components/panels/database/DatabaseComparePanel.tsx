import { Alert, Box, Group, Paper, Select, SimpleGrid, Stack, Text, Tooltip } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useAtom, useAtomValue } from "jotai";
import { memo, useContext, useEffect, useMemo, useState } from "react";
import useSWR from "swr/immutable";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  currentCompareDatabasesAtom,
  currentLocalOptionsAtom,
  currentTabAtom,
  referenceDbAtom,
} from "@/state/atoms";
import {
  cancelDatabaseSearch,
  getDatabases,
  type Opening,
  searchPosition,
  type SuccessDatabaseInfo,
} from "@/utils/db";
import { formatNumber } from "@/utils/format";
import DatabaseLoader from "./DatabaseLoader";
import type { LocalOptions } from "./DatabasePanel";
import OpeningsTable, { type OpeningSort, openingSortOptions } from "./OpeningsTable";

function DatabaseComparePanel() {
  const store = useContext(TreeStateContext)!;
  const fen = useStore(store, (s) => s.currentNode().fen);
  const [debouncedFen] = useDebouncedValue(fen, 50);
  const tab = useAtomValue(currentTabAtom);
  const referenceDatabase = useAtomValue(referenceDbAtom);
  const localOptions = useAtomValue(currentLocalOptionsAtom);
  const [selectedDatabases, setSelectedDatabases] = useAtom(currentCompareDatabasesAtom);

  const { data: databases } = useSWR("databases", () => getDatabases());
  const localDatabases = useMemo(
    () =>
      (databases ?? []).filter((database): database is SuccessDatabaseInfo => {
        return database.type === "success";
      }),
    [databases],
  );

  useEffect(() => {
    if (localDatabases.length === 0) return;

    setSelectedDatabases((current) => {
      const available = new Set(localDatabases.map((database) => database.file));
      const currentPair = current.slice(0, 2).filter((path) => available.has(path));
      const defaults = [
        referenceDatabase,
        ...localDatabases.map((database) => database.file),
      ].filter((path): path is string => typeof path === "string" && available.has(path));

      const next: string[] = [];
      for (const path of [...currentPair, ...defaults]) {
        if (!next.includes(path)) next.push(path);
        if (next.length === 2) break;
      }

      if (next.length === current.length && next.every((path, index) => path === current[index])) {
        return current;
      }
      return next;
    });
  }, [localDatabases, referenceDatabase, setSelectedDatabases]);

  const setDatabaseAt = (index: number, value: string | null) => {
    setSelectedDatabases((current) => {
      const next = current.slice(0, 2);
      if (value) next[index] = value;
      return [...new Set(next.filter(Boolean))];
    });
  };

  const selectedPair = [selectedDatabases[0] ?? null, selectedDatabases[1] ?? null] as const;

  return (
    <Stack h="100%" gap={6} style={{ overflow: "hidden" }}>
      {localDatabases.length < 2 && (
        <Alert color="blue" variant="light">
          Add at least two local databases to compare move frequency side-by-side.
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" flex={1} style={{ minHeight: 0 }}>
        {selectedPair.map((databasePath, index) => (
          <CompareDatabaseTable
            key={index}
            label={`Database ${index + 1}`}
            databasePath={databasePath}
            databases={localDatabases}
            otherDatabasePath={selectedPair[index === 0 ? 1 : 0]}
            fen={debouncedFen}
            tabId={tab?.value ?? "compare"}
            localOptions={localOptions}
            onChange={(value) => setDatabaseAt(index, value)}
          />
        ))}
      </SimpleGrid>
    </Stack>
  );
}

function CompareDatabaseTable({
  label,
  databasePath,
  databases,
  otherDatabasePath,
  fen,
  tabId,
  localOptions,
  onChange,
}: {
  label: string;
  databasePath: string | null;
  databases: SuccessDatabaseInfo[];
  otherDatabasePath: string | null;
  fen: string;
  tabId: string;
  localOptions: LocalOptions;
  onChange: (value: string | null) => void;
}) {
  const [openingSort, setOpeningSort] = useState<OpeningSort>("games");
  const database = databases.find((item) => item.file === databasePath) ?? null;
  const searchId = database
    ? [
        "database-compare",
        tabId,
        database.filename,
        fen,
        localOptions.type,
        localOptions.player ?? "",
        localOptions.color,
        localOptions.start_date ?? "",
        localOptions.end_date ?? "",
        localOptions.result,
      ].join("|")
    : null;
  const searchKey =
    database && searchId
      ? ([
          "database-compare-table",
          {
            id: searchId,
            options: {
              ...localOptions,
              fen,
              path: database.file,
            },
          },
        ] as const)
      : null;
  const selectData = databases.map((item) => ({
    value: item.file,
    label: item.title || item.filename,
    disabled: item.file === otherDatabasePath,
  }));

  const {
    data: openings = [],
    isLoading,
    error,
  } = useSWR(searchKey, async ([, { id, options }]) => {
    const [positionOpenings] = await searchPosition(options, id);

    return sortOpenings(positionOpenings);
  });

  useEffect(() => {
    if (!searchId) return undefined;

    return () => {
      void cancelDatabaseSearch(searchId);
    };
  }, [searchId]);

  const total = getOpeningTotal(openings);

  return (
    <Paper
      withBorder
      p="xs"
      h="100%"
      style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}
    >
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
        <Tooltip label={database?.title || database?.filename || label}>
          <Select
            data={selectData}
            value={databasePath}
            onChange={onChange}
            placeholder={label}
            size="xs"
            flex={1}
            allowDeselect={false}
            searchable
            comboboxProps={{ withinPortal: true }}
          />
        </Tooltip>
        <Text fz="xs" style={{ whiteSpace: "nowrap" }}>
          {formatNumber(total)} matches
        </Text>
      </Group>
      <Select
        data={openingSortOptions}
        value={openingSort}
        onChange={(value) => setOpeningSort((value as OpeningSort) ?? "games")}
        size="xs"
        w={150}
        mt={6}
        allowDeselect={false}
      />
      <DatabaseLoader isLoading={isLoading} tab={searchId} />
      {error ? (
        <Alert color="yellow" variant="light" mt="xs">
          Could not search this database for the current position.
        </Alert>
      ) : (
        <Box mt={6} flex={1} style={{ minHeight: 0, overflow: "auto" }}>
          <OpeningsTable compact openings={openings} loading={isLoading} sortBy={openingSort} />
        </Box>
      )}
    </Paper>
  );
}

function sortOpenings(openings: Opening[]) {
  return [...openings].sort((a, b) => getOpeningTotal([b]) - getOpeningTotal([a]));
}

function getOpeningTotal(openings: Opening[]) {
  return openings.reduce((sum, opening) => sum + opening.white + opening.draw + opening.black, 0);
}

export default memo(DatabaseComparePanel);
