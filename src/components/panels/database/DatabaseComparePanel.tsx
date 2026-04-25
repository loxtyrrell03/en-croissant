import {
  ActionIcon,
  Alert,
  Box,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconStar, IconStarFilled } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { useAtom, useAtomValue } from "jotai";
import { memo, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr/immutable";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  currentCompareDatabasesAtom,
  currentLocalOptionsAtom,
  currentTabAtom,
  databaseMoveHealthSideAtom,
  defaultCompareDatabasesAtom,
  lichessOptionsAtom,
  masterOptionsAtom,
  referenceDbAtom,
  sessionsAtom,
} from "@/state/atoms";
import {
  cancelDatabaseSearch,
  getDatabases,
  type Opening,
  searchPosition,
  type SuccessDatabaseInfo,
} from "@/utils/db";
import { formatNumber } from "@/utils/format";
import { getLichessGames, getMasterGames } from "@/utils/lichess/api";
import type { LichessGamesOptions, MasterGamesOptions } from "@/utils/lichess/explorer";
import type { OpeningMoveHealthSidePreference } from "@/utils/openingMoveHealth";
import DatabaseLoader from "./DatabaseLoader";
import type { LocalOptions } from "./DatabasePanel";
import OpeningsTable, {
  openingMoveHealthSideOptions,
  type OpeningSort,
  openingSortOptions,
} from "./OpeningsTable";

const LICHESS_ALL_SOURCE = "online:lichess-all";
const LICHESS_MASTER_SOURCE = "online:lichess-master";

type CompareSource =
  | {
      type: "local";
      value: string;
      label: string;
      database: SuccessDatabaseInfo;
    }
  | {
      type: "lch_all" | "lch_master";
      value: string;
      label: string;
    };

function DatabaseComparePanel() {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const fen = useStore(store, (s) => s.currentNode().fen);
  const [debouncedFen] = useDebouncedValue(fen, 50);
  const tab = useAtomValue(currentTabAtom);
  const referenceDatabase = useAtomValue(referenceDbAtom);
  const localOptions = useAtomValue(currentLocalOptionsAtom);
  const lichessOptions = useAtomValue(lichessOptionsAtom);
  const masterOptions = useAtomValue(masterOptionsAtom);
  const sessions = useAtomValue(sessionsAtom);
  const [selectedDatabases, setSelectedDatabases] = useAtom(currentCompareDatabasesAtom);
  const [defaultCompareDatabases, setDefaultCompareDatabases] = useAtom(
    defaultCompareDatabasesAtom,
  );
  const [moveHealthSide, setMoveHealthSide] = useAtom(databaseMoveHealthSideAtom);
  const [openingsBySearchId, setOpeningsBySearchId] = useState<Record<string, Opening[]>>({});
  const explorerToken = sessions.find((session) => session.lichess?.accessToken)?.lichess
    ?.accessToken;

  const { data: databases } = useSWR("databases", () => getDatabases());
  const localDatabases = useMemo(
    () =>
      (databases ?? []).filter((database): database is SuccessDatabaseInfo => {
        return database.type === "success";
      }),
    [databases],
  );
  const compareSources = useMemo<CompareSource[]>(
    () => [
      ...localDatabases.map((database) => ({
        type: "local" as const,
        value: database.file,
        label: database.title || database.filename,
        database,
      })),
      {
        type: "lch_all",
        value: LICHESS_ALL_SOURCE,
        label: t("Board.Database.LichessAll"),
      },
      {
        type: "lch_master",
        value: LICHESS_MASTER_SOURCE,
        label: t("Board.Database.LichessMaster"),
      },
    ],
    [localDatabases, t],
  );

  useEffect(() => {
    if (compareSources.length === 0) return;

    setSelectedDatabases((current) => {
      const available = new Set(compareSources.map((source) => source.value));
      const currentPair = current.slice(0, 2).filter((path) => available.has(path));
      const defaults = [
        ...defaultCompareDatabases,
        referenceDatabase,
        ...compareSources.map((source) => source.value),
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
  }, [compareSources, defaultCompareDatabases, referenceDatabase, setSelectedDatabases]);

  const setDatabaseAt = (index: number, value: string | null) => {
    setSelectedDatabases((current) => {
      const next = current.slice(0, 2);
      if (value) next[index] = value;
      return [...new Set(next.filter(Boolean))];
    });
  };

  const setDefaultDatabaseAt = (index: number, value: string | null) => {
    setDefaultCompareDatabases((current) => {
      const next = current.slice(0, 2);
      next[index] = value;
      const otherIndex = index === 0 ? 1 : 0;
      if (value && next[otherIndex] === value) {
        next[otherIndex] = null;
      }
      return next;
    });
  };

  const selectedPair = [selectedDatabases[0] ?? null, selectedDatabases[1] ?? null] as const;
  const selectedSources = selectedPair.map(
    (sourceValue) => compareSources.find((item) => item.value === sourceValue) ?? null,
  );
  const searchIds = selectedSources.map((source) =>
    source
      ? getCompareSearchId(
          source,
          tab?.value ?? "compare",
          debouncedFen,
          localOptions,
          lichessOptions,
          masterOptions,
        )
      : null,
  );
  const rememberOpenings = useCallback((searchId: string, openings: Opening[]) => {
    setOpeningsBySearchId((current) => {
      if (current[searchId] === openings) return current;
      return {
        ...current,
        [searchId]: openings,
      };
    });
  }, []);

  return (
    <Stack h="100%" gap={6} style={{ overflow: "hidden" }}>
      {localDatabases.length === 0 && (
        <Alert color="blue" variant="light">
          Local databases are optional here; you can compare against Lichess All or Lichess Masters.
        </Alert>
      )}

      <Group justify="flex-end" wrap="nowrap">
        <Tooltip label="Evaluate move health for this side">
          <Select
            data={openingMoveHealthSideOptions}
            value={moveHealthSide}
            onChange={(value) =>
              setMoveHealthSide((value as OpeningMoveHealthSidePreference) ?? "sideToMove")
            }
            size="xs"
            w={140}
            allowDeselect={false}
          />
        </Tooltip>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" flex={1} style={{ minHeight: 0 }}>
        {selectedPair.map((databasePath, index) => (
          <CompareDatabaseTable
            key={index}
            label={`Database ${index + 1}`}
            sourceValue={databasePath}
            sources={compareSources}
            otherSourceValue={selectedPair[index === 0 ? 1 : 0]}
            fen={debouncedFen}
            localOptions={localOptions}
            lichessOptions={lichessOptions}
            masterOptions={masterOptions}
            explorerToken={explorerToken}
            defaultSourceValue={defaultCompareDatabases[index] ?? null}
            moveHealthSide={moveHealthSide}
            searchId={searchIds[index]}
            referenceOpenings={
              searchIds[index === 0 ? 1 : 0]
                ? openingsBySearchId[searchIds[index === 0 ? 1 : 0]!]
                : undefined
            }
            onChange={(value) => setDatabaseAt(index, value)}
            onMakeDefault={(value) => setDefaultDatabaseAt(index, value)}
            onOpeningsLoaded={rememberOpenings}
          />
        ))}
      </SimpleGrid>
    </Stack>
  );
}

function CompareDatabaseTable({
  label,
  sourceValue,
  sources,
  otherSourceValue,
  fen,
  localOptions,
  lichessOptions,
  masterOptions,
  explorerToken,
  defaultSourceValue,
  moveHealthSide,
  searchId,
  referenceOpenings,
  onChange,
  onMakeDefault,
  onOpeningsLoaded,
}: {
  label: string;
  sourceValue: string | null;
  sources: CompareSource[];
  otherSourceValue: string | null;
  fen: string;
  localOptions: LocalOptions;
  lichessOptions: LichessGamesOptions;
  masterOptions: MasterGamesOptions;
  explorerToken?: string;
  defaultSourceValue: string | null;
  moveHealthSide: OpeningMoveHealthSidePreference;
  searchId: string | null;
  referenceOpenings?: Opening[];
  onChange: (value: string | null) => void;
  onMakeDefault: (value: string | null) => void;
  onOpeningsLoaded: (searchId: string, openings: Opening[]) => void;
}) {
  const { t } = useTranslation();
  const [openingSort, setOpeningSort] = useState<OpeningSort>("games");
  const source = sources.find((item) => item.value === sourceValue) ?? null;
  const isOnlineSource = source?.type === "lch_all" || source?.type === "lch_master";
  const missingExplorerToken = isOnlineSource && !explorerToken;
  const searchKey =
    source && searchId && !missingExplorerToken
      ? ([
          "database-compare-table",
          {
            id: searchId,
            source,
          },
        ] as const)
      : null;
  const selectData = sources.map((item) => ({
    value: item.value,
    label: item.label,
    disabled: item.value === otherSourceValue,
  }));

  const {
    data: openingData,
    isLoading,
    error,
  } = useSWR(searchKey, async ([, { id, source }]) => {
    if (source.type === "local") {
      const [positionOpenings] = await searchPosition(
        {
          ...localOptions,
          fen,
          path: source.database.file,
        },
        id,
      );

      return sortOpenings(positionOpenings);
    }

    if (source.type === "lch_all") {
      const data = await getLichessGames(fen, { ...lichessOptions, moves: 12 }, explorerToken);
      return sortOpenings(lichessMovesToOpenings(data.moves));
    }

    if (source.type === "lch_master") {
      const data = await getMasterGames(fen, { ...masterOptions, moves: 12 }, explorerToken);
      return sortOpenings(lichessMovesToOpenings(data.moves));
    }
  });
  const openings = openingData ?? [];

  useEffect(() => {
    if (!searchId || !openingData) return;
    onOpeningsLoaded(searchId, openingData);
  }, [onOpeningsLoaded, openingData, searchId]);

  useEffect(() => {
    if (!searchId || source?.type !== "local") return undefined;

    return () => {
      void cancelDatabaseSearch(searchId);
    };
  }, [searchId, source?.type]);

  const total = getOpeningTotal(openings);

  return (
    <Paper
      withBorder
      p="xs"
      h="100%"
      style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}
    >
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
        <Tooltip label={source?.label || label}>
          <Select
            data={selectData}
            value={sourceValue}
            onChange={onChange}
            placeholder={label}
            size="xs"
            flex={1}
            allowDeselect={false}
            searchable
            comboboxProps={{ withinPortal: true }}
          />
        </Tooltip>
        <Tooltip
          label={
            defaultSourceValue === sourceValue
              ? "Default compare database"
              : "Make this the default compare database"
          }
        >
          <ActionIcon
            variant="default"
            size="sm"
            disabled={!sourceValue}
            onClick={() => onMakeDefault(sourceValue)}
          >
            {defaultSourceValue === sourceValue ? (
              <IconStarFilled size="0.875rem" />
            ) : (
              <IconStar size="0.875rem" />
            )}
          </ActionIcon>
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
      {missingExplorerToken ? (
        <Alert color="yellow" variant="light" mt="xs">
          {t("Board.Database.ExplorerAuthRequired1")} <Link to="/accounts">Users</Link>{" "}
          {t("Board.Database.ExplorerAuthRequired2")}
        </Alert>
      ) : error ? (
        <Alert color="yellow" variant="light" mt="xs">
          Could not search this source for the current position.
        </Alert>
      ) : (
        <Box mt={6} flex={1} style={{ minHeight: 0, overflow: "auto" }}>
          <OpeningsTable
            compact
            openings={openings}
            loading={isLoading}
            sortBy={openingSort}
            healthSidePreference={moveHealthSide}
            referenceOpenings={referenceOpenings}
          />
        </Box>
      )}
    </Paper>
  );
}

function sortOpenings(openings: Opening[]) {
  return [...openings].sort((a, b) => getOpeningTotal([b]) - getOpeningTotal([a]));
}

function getCompareSearchId(
  source: CompareSource,
  tabId: string,
  fen: string,
  localOptions: LocalOptions,
  lichessOptions: LichessGamesOptions,
  masterOptions: MasterGamesOptions,
) {
  return [
    "database-compare",
    tabId,
    source.value,
    fen,
    localOptions.type,
    localOptions.player ?? "",
    localOptions.color,
    localOptions.start_date ?? "",
    localOptions.end_date ?? "",
    localOptions.result,
    JSON.stringify(lichessOptions),
    JSON.stringify(masterOptions),
  ].join("|");
}

function lichessMovesToOpenings(
  moves: {
    san: string;
    white: number;
    black: number;
    draws: number;
  }[],
): Opening[] {
  return moves.map((move) => ({
    move: move.san,
    white: move.white,
    black: move.black,
    draw: move.draws,
  }));
}

function getOpeningTotal(openings: Opening[]) {
  return openings.reduce((sum, opening) => sum + opening.white + opening.draw + opening.black, 0);
}

export default memo(DatabaseComparePanel);
