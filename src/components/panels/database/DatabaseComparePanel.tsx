import { findWorkspacePreference, setWorkspacePreference } from "@/utils/workspacePreferences";
import { GameDateRangeControl } from "@/components/common/GameDateRangeControl";
import { useCalendarDay } from "@/hooks/useCalendarDay";
import {
  applyExplorerGameDates,
  displayExplorerGameDates,
  displayLocalGameDates,
  isGameDateRange,
  applyLocalGameDates,
  storedGameDateRange,
  type GameDateRange,
} from "@/utils/gameDateRange";
import { reportFilePreferenceFailure } from "@/utils/fileBoardPreferences";
import {
  Alert,
  Box,
  Button,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconTarget } from "@tabler/icons-react";
import { useDebouncedValue, useElementSize } from "@mantine/hooks";
import { Link } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom, useStore as useAtomStore } from "jotai";
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr/immutable";
import equal from "fast-deep-equal";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import DatabaseFolderSelect from "@/components/common/LiveDatabaseFolderSelect";
import {
  comparePanelSettingsByFileAtom,
  type ComparePanelFileSettings,
  currentCompareDatabasesAtom,
  currentLocalOptionsAtom,
  currentOpponentPrepAtom,
  currentTabSelectedAtom,
  currentTabAtom,
  databaseMoveHealthSideAtom,
  defaultCompareDatabasesAtom as rememberedCompareDatabasesAtom,
  lichessOptionsAtom,
  masterOptionsAtom,
  referenceDbAtom,
  sessionsAtom,
  type StoredDatabaseLocalOptions,
} from "@/state/atoms";
import {
  cancelDatabaseSearch,
  getDatabases,
  getDatabaseFolderLabel,
  getDatabaseFolderPath,
  getLocalResultPerspective,
  type Opening,
  searchPosition,
  type SuccessDatabaseInfo,
} from "@/utils/db";
import { formatNumber } from "@/utils/format";
import { getLichessGames, getMasterGames } from "@/utils/lichess/api";
import type { LichessGamesOptions, MasterGamesOptions } from "@/utils/lichess/explorer";
import type { OpeningMoveHealthSidePreference } from "@/utils/openingMoveHealth";
import { getTabWorkspaceKey } from "@/utils/tabs";
import DatabaseLoader from "./DatabaseLoader";
import { DatabasePerspectiveControls } from "./DatabasePerspectiveControls";
import type { LocalOptions } from "./DatabasePanel";
import { MoveStrengthSettingsButton } from "./MoveStrengthSettingsButton";
import OpeningsTable, {
  openingMoveHealthSideOptions,
  type OpeningTableDensity,
  type OpeningSort,
  openingSortOptions,
} from "./OpeningsTable";

const LICHESS_ALL_SOURCE = "online:lichess-all";
const LICHESS_MASTER_SOURCE = "online:lichess-master";
const STACKED_COMPARE_WIDTH = 640;
const DENSE_COMPARE_WIDTH = 900;

type CompareSource =
  | {
      type: "local";
      value: string;
      label: string;
      folder: string;
      database: SuccessDatabaseInfo;
    }
  | {
      type: "lch_all" | "lch_master";
      value: string;
      label: string;
    };

const DEFAULT_COMPARE_LOCAL_OPTIONS: StoredDatabaseLocalOptions = {
  type: "exact",
  player: null,
  playerName: "",
  color: "white",
  result: "any",
};

function toStoredLocalOptions(options: LocalOptions): StoredDatabaseLocalOptions {
  return {
    dateRange: options.dateRange,
    type: options.type,
    player: options.player,
    playerName: options.playerName,
    color: options.color,
    start_date: options.start_date,
    end_date: options.end_date,
    result: options.result,
  };
}

function getDefaultCompareSlotOptions(baseOptions: LocalOptions): StoredDatabaseLocalOptions {
  return {
    ...DEFAULT_COMPARE_LOCAL_OPTIONS,
    ...toStoredLocalOptions(baseOptions),
  };
}

function toSlotLocalOptions(
  source: CompareSource | null,
  fen: string,
  options: StoredDatabaseLocalOptions,
): LocalOptions {
  return {
    ...DEFAULT_COMPARE_LOCAL_OPTIONS,
    ...options,
    fen,
    path: source?.type === "local" ? source.database.file : null,
  };
}

function DatabaseComparePanel() {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const fen = useStore(store, (s) => s.currentNode().fen);
  const currentPath = useStore(store, (s) => s.position);
  const [debouncedFen] = useDebouncedValue(fen, 50);
  const tab = useAtomValue(currentTabAtom);
  const settingsKey = useMemo(() => getTabWorkspaceKey(tab), [tab]);
  const atoms = useAtomStore();
  const hydrationContext = JSON.stringify([tab?.value, settingsKey]);
  const [hydratedContext, setHydratedContext] = useState("");
  const ownsDateControls = useCallback(() => {
    const current = atoms.get(currentTabAtom);
    return current?.value === tab?.value && getTabWorkspaceKey(current) === settingsKey;
  }, [atoms, settingsKey, tab?.value]);
  const referenceDatabase = useAtomValue(referenceDbAtom);
  const baseLocalOptions = useAtomValue(currentLocalOptionsAtom);
  const [rawLichessOptions, setLichessOptions] = useAtom(lichessOptionsAtom);
  const [rawMasterOptions, setMasterOptions] = useAtom(masterOptionsAtom);
  const today = useCalendarDay();
  const lichessOptions = useMemo(
    () => displayExplorerGameDates(rawLichessOptions, "month", new Date(`${today}T12:00:00`)),
    [rawLichessOptions, today],
  );
  const masterOptions = useMemo(
    () => displayExplorerGameDates(rawMasterOptions, "year", new Date(`${today}T12:00:00`)),
    [rawMasterOptions, today],
  );
  const sessions = useAtomValue(sessionsAtom);
  const [selectedDatabases, setSelectedDatabases] = useAtom(currentCompareDatabasesAtom);
  const [rememberedCompareDatabases, setRememberedCompareDatabases] = useAtom(
    rememberedCompareDatabasesAtom,
  );
  const [compareSettingsByFile, setCompareSettingsByFile] = useAtom(comparePanelSettingsByFileAtom);
  const savedCompareSettings = findWorkspacePreference(compareSettingsByFile, settingsKey);
  const [moveHealthSide, setMoveHealthSide] = useAtom(databaseMoveHealthSideAtom);
  const [slotLocalOptions, setSlotLocalOptions] = useState<StoredDatabaseLocalOptions[]>(() => [
    getDefaultCompareSlotOptions(baseLocalOptions),
    getDefaultCompareSlotOptions(baseLocalOptions),
  ]);
  const [openingsBySearchId, setOpeningsBySearchId] = useState<Record<string, Opening[]>>({});
  const appliedSettingsKeyRef = useRef<string | null>(null);
  const appliedOwnerRef = useRef<string | null>(null);
  const skipNextPersistKeyRef = useRef<string | null>(null);
  const explorerToken = sessions.find((session) => session.lichess?.accessToken)?.lichess
    ?.accessToken;
  const { ref: panelRef, width: panelWidth } = useElementSize();
  const isStacked = panelWidth > 0 && panelWidth < STACKED_COMPARE_WIDTH;
  const tableDensity: OpeningTableDensity =
    panelWidth > 0 && panelWidth < DENSE_COMPARE_WIDTH ? "dense" : "compact";
  const sideMoveSelectWidth = tableDensity === "dense" ? 126 : 140;

  const { data: databases } = useSWR("databases", () => getDatabases());
  const localDatabases = useMemo(
    () =>
      (databases ?? []).filter((database): database is SuccessDatabaseInfo => {
        return database.type === "success";
      }),
    [databases],
  );
  const databasesLoaded = databases !== undefined;
  const compareSources = useMemo<CompareSource[]>(
    () => [
      ...localDatabases.map((database) => ({
        type: "local" as const,
        value: database.file,
        label: database.title || database.filename,
        folder: getDatabaseFolderPath(database),
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
    const hydrationKey = settingsKey ?? "__default-compare-settings__";
    if (
      appliedSettingsKeyRef.current === hydrationKey &&
      appliedOwnerRef.current === (tab?.value ?? null)
    )
      return;

    if (!savedCompareSettings && !databasesLoaded) return;
    const rebind =
      appliedSettingsKeyRef.current !== null && appliedOwnerRef.current === (tab?.value ?? null);
    appliedSettingsKeyRef.current = hydrationKey;
    appliedOwnerRef.current = tab?.value ?? null;
    skipNextPersistKeyRef.current = rebind ? null : settingsKey;
    setHydratedContext(hydrationContext);
    if (rebind) return;

    const defaultSlotOptions = getDefaultCompareSlotOptions(baseLocalOptions);
    if (savedCompareSettings) {
      setSelectedDatabases(
        savedCompareSettings.slots
          .map((slot) => slot.sourceValue)
          .filter((sourceValue): sourceValue is string => Boolean(sourceValue))
          .slice(0, 2),
      );
      setSlotLocalOptions(
        [0, 1].map((index) => ({
          ...defaultSlotOptions,
          ...savedCompareSettings.slots[index]?.localOptions,
        })),
      );
      setLichessOptions(savedCompareSettings.lichessOptions);
      setMasterOptions(savedCompareSettings.masterOptions);
      setMoveHealthSide(savedCompareSettings.moveHealthSide);
      return;
    }

    setSlotLocalOptions([defaultSlotOptions, defaultSlotOptions]);
    setSelectedDatabases((current) =>
      getFilledCompareSelection(
        current,
        compareSources,
        rememberedCompareDatabases,
        referenceDatabase,
      ),
    );
  }, [
    baseLocalOptions,
    compareSources,
    databasesLoaded,
    referenceDatabase,
    rememberedCompareDatabases,
    savedCompareSettings,
    setLichessOptions,
    setMasterOptions,
    setMoveHealthSide,
    setSelectedDatabases,
    settingsKey,
    tab?.value,
    hydrationContext,
  ]);

  useEffect(() => {
    if (!databasesLoaded || appliedSettingsKeyRef.current === null) return;
    if (settingsKey && skipNextPersistKeyRef.current === settingsKey) return;

    setSelectedDatabases((current) =>
      getFilledCompareSelection(
        current,
        compareSources,
        rememberedCompareDatabases,
        referenceDatabase,
      ),
    );
  }, [
    compareSources,
    databasesLoaded,
    referenceDatabase,
    rememberedCompareDatabases,
    setSelectedDatabases,
    settingsKey,
  ]);

  const setDatabaseAt = (index: number, value: string | null) => {
    const next = getNextSelectedDatabases(selectedDatabases, index, value);
    setSelectedDatabases(next);
    setRememberedCompareDatabases(next);
  };

  const setSlotLocalOptionsAt = (
    index: number,
    updater:
      | StoredDatabaseLocalOptions
      | ((current: StoredDatabaseLocalOptions) => StoredDatabaseLocalOptions),
  ) => {
    setSlotLocalOptions((current) => {
      const fallback = getDefaultCompareSlotOptions(baseLocalOptions);
      const next = [current[0] ?? fallback, current[1] ?? fallback];
      const currentOptions = next[index] ?? fallback;
      next[index] = typeof updater === "function" ? updater(currentOptions) : updater;
      return next;
    });
  };

  const selectedPair = [selectedDatabases[0] ?? null, selectedDatabases[1] ?? null] as const;
  const selectedSources = selectedPair.map(
    (sourceValue) => compareSources.find((item) => item.value === sourceValue) ?? null,
  );
  const slotOptions = [0, 1].map((index) =>
    displayLocalGameDates(
      toSlotLocalOptions(
        selectedSources[index],
        debouncedFen,
        slotLocalOptions[index] ?? getDefaultCompareSlotOptions(baseLocalOptions),
      ),
      new Date(`${today}T12:00:00`),
    ),
  ) as [LocalOptions, LocalOptions];
  const searchIds = selectedSources.map((source, index) =>
    source &&
    hydratedContext === hydrationContext &&
    isGameDateRange(compareGameDates(source, slotOptions[index], lichessOptions, masterOptions))
      ? getCompareSearchId(
          source,
          tab?.value ?? "compare",
          debouncedFen,
          slotOptions[index],
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

  useEffect(() => {
    if (!settingsKey || appliedSettingsKeyRef.current !== settingsKey) return;
    if (skipNextPersistKeyRef.current === settingsKey) {
      skipNextPersistKeyRef.current = null;
      return;
    }

    const defaultSlotOptions = getDefaultCompareSlotOptions(baseLocalOptions);
    const nextSettings: ComparePanelFileSettings = {
      slots: [0, 1].map((index) => ({
        sourceValue: selectedDatabases[index] ?? null,
        localOptions: slotLocalOptions[index] ?? defaultSlotOptions,
      })),
      lichessOptions,
      masterOptions,
      moveHealthSide,
    };

    try {
      setCompareSettingsByFile((current) =>
        equal(findWorkspacePreference(current, settingsKey), nextSettings)
          ? current
          : setWorkspacePreference(current, settingsKey, nextSettings),
      );
    } catch (error) {
      reportFilePreferenceFailure(error);
    }
  }, [
    baseLocalOptions,
    lichessOptions,
    masterOptions,
    moveHealthSide,
    selectedDatabases,
    setCompareSettingsByFile,
    settingsKey,
    slotLocalOptions,
  ]);

  return (
    <Stack
      ref={panelRef}
      h="100%"
      gap={tableDensity === "dense" ? 4 : 6}
      style={{ overflow: "hidden" }}
    >
      <Group
        justify="space-between"
        align="center"
        wrap={isStacked ? "wrap" : "nowrap"}
        gap={tableDensity === "dense" ? 4 : "xs"}
        style={{ flexShrink: 0 }}
      >
        <Text fw={700} fz={tableDensity === "dense" ? "xs" : "sm"}>
          Database comparison
        </Text>
        <Group gap={tableDensity === "dense" ? 4 : "xs"} wrap="wrap" justify="flex-end">
          <Tooltip label="Evaluate move strength for this side">
            <Select
              data={openingMoveHealthSideOptions}
              value={moveHealthSide}
              onChange={(value) =>
                setMoveHealthSide((value as OpeningMoveHealthSidePreference) ?? "sideToMove")
              }
              size="xs"
              w={isStacked ? "100%" : sideMoveSelectWidth}
              allowDeselect={false}
            />
          </Tooltip>
          <MoveStrengthSettingsButton size="sm" />
        </Group>
      </Group>

      {localDatabases.length === 0 && (
        <Alert color="blue" variant="light">
          Local databases are optional here; you can compare against Lichess All or Lichess Masters.
        </Alert>
      )}

      <SimpleGrid
        cols={isStacked ? 1 : 2}
        spacing={tableDensity === "dense" ? 6 : "xs"}
        flex={1}
        style={{ minHeight: 0, gridAutoRows: isStacked ? "minmax(0, 1fr)" : undefined }}
      >
        {selectedPair.map((databasePath, index) => (
          <CompareDatabaseTable
            key={index}
            label={`Database ${index + 1}`}
            sourceValue={databasePath}
            sources={compareSources}
            otherSourceValue={selectedPair[index === 0 ? 1 : 0]}
            fen={debouncedFen}
            localOptions={slotOptions[index]}
            lichessOptions={lichessOptions}
            masterOptions={masterOptions}
            explorerToken={explorerToken}
            moveHealthSide={moveHealthSide}
            resultPerspective={
              selectedSources[index]?.type === "local"
                ? getLocalResultPerspective(slotOptions[index])
                : null
            }
            density={tableDensity}
            searchId={searchIds[index]}
            currentPath={currentPath}
            referenceOpenings={
              searchIds[index === 0 ? 1 : 0]
                ? openingsBySearchId[searchIds[index === 0 ? 1 : 0]!]
                : undefined
            }
            onChange={(value) => setDatabaseAt(index, value)}
            onLocalOptionsChange={(updater) => setSlotLocalOptionsAt(index, updater)}
            dateContext={`${settingsKey ?? tab?.value}:${index}:${databasePath}`}
            onDateRangeChange={(dateRange) => {
              if (
                !ownsDateControls() ||
                atoms.get(currentCompareDatabasesAtom)[index] !== databasePath
              )
                return;
              const source = selectedSources[index];
              if (source?.type === "local")
                setSlotLocalOptionsAt(index, (current) =>
                  applyLocalGameDates({ ...current, dateRange }),
                );
              else if (source?.type === "lch_all")
                setLichessOptions((current) =>
                  applyExplorerGameDates({ ...current, dateRange }, "month"),
                );
              else if (source?.type === "lch_master")
                setMasterOptions((current) =>
                  applyExplorerGameDates({ ...current, dateRange }, "year"),
                );
            }}
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
  moveHealthSide,
  resultPerspective,
  density,
  searchId,
  currentPath,
  referenceOpenings,
  onChange,
  onLocalOptionsChange,
  dateContext,
  onDateRangeChange,
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
  moveHealthSide: OpeningMoveHealthSidePreference;
  resultPerspective: ReturnType<typeof getLocalResultPerspective>;
  density: OpeningTableDensity;
  searchId: string | null;
  currentPath: number[];
  referenceOpenings?: Opening[];
  onChange: (value: string | null) => void;
  dateContext: string;
  onDateRangeChange: (range: GameDateRange) => void;
  onLocalOptionsChange: (
    updater:
      | StoredDatabaseLocalOptions
      | ((current: StoredDatabaseLocalOptions) => StoredDatabaseLocalOptions),
  ) => void;
  onOpeningsLoaded: (searchId: string, openings: Opening[]) => void;
}) {
  const { t } = useTranslation();
  const setOpponentPrep = useSetAtom(currentOpponentPrepAtom);
  const setCurrentTabSelected = useSetAtom(currentTabSelectedAtom);
  const [openingSort, setOpeningSort] = useState<OpeningSort>("games");
  const source = sources.find((item) => item.value === sourceValue) ?? null;
  const isOnlineSource = source?.type === "lch_all" || source?.type === "lch_master";
  const missingExplorerToken = isOnlineSource && !explorerToken;
  const selectedDates = compareGameDates(source, localOptions, lichessOptions, masterOptions);
  const searchKey =
    source && searchId && !missingExplorerToken && isGameDateRange(selectedDates)
      ? ([
          "database-compare-table",
          {
            id: searchId,
            source,
          },
        ] as const)
      : null;
  const localGroups = new Map<string, CompareSource[]>();
  for (const item of sources) {
    if (item.type !== "local") continue;
    const folder = item.folder;
    localGroups.set(folder, [...(localGroups.get(folder) ?? []), item]);
  }
  const selectData = [
    ...Array.from(localGroups.entries())
      .sort(([a], [b]) => {
        if (a === "" && b !== "") return -1;
        if (a !== "" && b === "") return 1;
        return a.localeCompare(b, undefined, { sensitivity: "base" });
      })
      .map(([folder, items]) => ({
        group: getDatabaseFolderLabel(folder),
        items: items
          .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }))
          .map((item) => ({
            value: item.value,
            label: item.label,
            disabled: item.value === otherSourceValue,
          })),
      })),
    {
      group: "Online",
      items: sources
        .filter((item) => item.type !== "local")
        .map((item) => ({
          value: item.value,
          label: item.label,
          disabled: item.value === otherSourceValue,
        })),
    },
  ];
  const dense = density === "dense";
  const controlGap = dense ? 4 : "xs";
  const cardPadding = dense ? 6 : "xs";
  const selectWidth = dense ? 118 : 150;
  const sourceSelectWidth = dense ? 220 : 320;
  const canStartPrep =
    source?.type === "local" && Boolean(localOptions.player || localOptions.playerName?.trim());

  const startOpponentPrep = () => {
    if (source?.type !== "local") return;

    setOpponentPrep((current) => ({
      ...current,
      mode: "player",
      source: "local",
      databasePath: source.database.file,
      databaseLabel: source.label,
      player: localOptions.player,
      playerName: localOptions.playerName ?? "",
      color: localOptions.color,
      start_date: localOptions.start_date,
      end_date: localOptions.end_date,
      dateRanges: localOptions.dateRange ? { "player:local": localOptions.dateRange } : undefined,
      result: localOptions.result,
      rootPath: [...currentPath],
      completedBranches: {},
      skippedBranches: {},
    }));
    setCurrentTabSelected("prep");
  };

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
      data-game-date-source={source?.type}
      withBorder
      p={cardPadding}
      h="100%"
      style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}
    >
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap={controlGap}>
        <Tooltip label={source?.label || label}>
          <DatabaseFolderSelect
            data={selectData}
            value={sourceValue}
            onChange={onChange}
            placeholder={label}
            size="xs"
            width={sourceSelectWidth}
            maxWidth="100%"
            minWidth={0}
            allowDeselect={false}
            style={{ flex: `0 1 ${sourceSelectWidth}px` }}
          />
        </Tooltip>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          {source?.type === "local" ? (
            <Tooltip
              label={
                canStartPrep
                  ? "Build prep against this player and colour"
                  : "Choose a player before starting prep"
              }
            >
              <Button
                variant="default"
                size="xs"
                leftSection={<IconTarget size="0.9rem" />}
                disabled={!canStartPrep}
                onClick={startOpponentPrep}
              >
                Prep
              </Button>
            </Tooltip>
          ) : null}
          <Text fz={dense ? "0.68rem" : "xs"} style={{ whiteSpace: "nowrap" }}>
            {formatNumber(total)} matches
          </Text>
        </Group>
      </Group>
      {source?.type === "local" && (
        <Box mt={dense ? 4 : 6}>
          <DatabasePerspectiveControls
            databasePath={source.database.file}
            player={localOptions.player}
            playerName={localOptions.playerName}
            color={localOptions.color}
            onPlayerChange={(player) => onLocalOptionsChange((current) => ({ ...current, player }))}
            onPlayerNameChange={(playerName) =>
              onLocalOptionsChange((current) => ({ ...current, playerName }))
            }
            onColorChange={(color) => onLocalOptionsChange((current) => ({ ...current, color }))}
            size="xs"
            playerWidth={dense ? 132 : 170}
            colorWidth={dense ? 112 : 126}
          />
        </Box>
      )}
      {source && (
        <Box mt={dense ? 4 : 6}>
          <GameDateRangeControl
            key={dateContext}
            value={selectedDates}
            precision={
              source.type === "local" ? "day" : source.type === "lch_all" ? "month" : "year"
            }
            onChange={onDateRangeChange}
          />
        </Box>
      )}
      <Select
        data={openingSortOptions}
        value={openingSort}
        onChange={(value) => setOpeningSort((value as OpeningSort) ?? "games")}
        size="xs"
        w={selectWidth}
        mt={dense ? 4 : 6}
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
        <Box mt={dense ? 4 : 6} flex={1} style={{ minHeight: 0, overflow: "auto" }}>
          <OpeningsTable
            compact
            density={density}
            openings={openings}
            loading={isLoading}
            sortBy={openingSort}
            onSortChange={setOpeningSort}
            healthSidePreference={moveHealthSide}
            resultPerspective={resultPerspective}
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

function getNextSelectedDatabases(current: string[], index: number, value: string | null) {
  const next = current.slice(0, 2);
  if (value) {
    next[index] = value;
  } else {
    next.splice(index, 1);
  }

  return [...new Set(next.filter((path): path is string => Boolean(path)))];
}

function getFilledCompareSelection(
  current: string[],
  compareSources: CompareSource[],
  rememberedCompareDatabases: (string | null)[],
  referenceDatabase: string | null,
) {
  const available = new Set(compareSources.map((source) => source.value));
  const currentPair = current.slice(0, 2).filter((path) => available.has(path));
  const defaults = [
    ...rememberedCompareDatabases,
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
}

function compareGameDates(
  source: CompareSource | null,
  local: LocalOptions,
  lichess: LichessGamesOptions,
  masters: MasterGamesOptions,
) {
  if (source?.type === "local")
    return storedGameDateRange(local.dateRange, local.start_date, local.end_date);
  if (source?.type === "lch_all")
    return storedGameDateRange(lichess.dateRange, lichess.since, lichess.until);
  return storedGameDateRange(masters.dateRange, masters.since, masters.until);
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
    localOptions.playerName ?? "",
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
