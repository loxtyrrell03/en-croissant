import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Group,
  NumberInput,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import {
  IconChevronDown,
  IconChevronUp,
  IconPlayerStop,
  IconRefresh,
  IconRoute,
} from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import type { Piece } from "@lichess-org/chessground/types";
import {
  commands,
  events,
  type BestMoves,
  type EngineOption,
  type GoMode,
  type PlanExplorerLine,
  type PlanExplorerPiece,
} from "@/bindings";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr/immutable";
import { useStore } from "zustand";
import PieceComponent from "@/components/common/Piece";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  currentLocalOptionsAtom,
  currentPlanExplorerDataAtom,
  currentPlanExplorerEngineStrengthAtom,
  currentPlanExplorerPreviewLineAtom,
  currentTabAtom,
  enginesAtom,
  lichessOptionsAtom,
  masterOptionsAtom,
  planExplorerArrowLimitAtom,
  planExplorerEngineStrengthDepthAtom,
  planExplorerEngineStrengthEnabledAtom,
  planExplorerEngineStrengthMultipvAtom,
  planExplorerHoverEverywhereAtom,
  planExplorerSourceAtom,
  referenceDbAtom,
  sessionsAtom,
  showPlanExplorerArrowsAtom,
} from "@/state/atoms";
import {
  buildEnginePlanReport,
  enginePlanStrengthScore,
  getPlanExplorerLineEnginePlan,
  type EnginePlan,
  type EnginePlanReport,
  type PlanExplorerEnginePlanMatch,
} from "@/utils/enginePlanExplorer";
import {
  type EngineSettings,
  type LocalEngine,
  getBestMoves as getLocalBestMoves,
  stopEngine,
} from "@/utils/engines";
import {
  cancelDatabaseSearch,
  type DatabaseResultPerspective,
  getDatabases,
  getLocalResultPerspective,
  getPlanExplorer,
  type SuccessDatabaseInfo,
} from "@/utils/db";
import { formatNumber } from "@/utils/format";
import { getOnlinePlanExplorer, type OnlinePlanExplorerSource } from "@/utils/lichess/planExplorer";
import {
  formatPlanRoute,
  isPlanBrush,
  planLineToShapes,
  withPlanLineColor,
  type ColoredPlanExplorerLine,
} from "@/utils/planExplorer";
import { DatabasePerspectiveControls } from "../database/DatabasePerspectiveControls";
import NoDatabaseWarning from "../database/NoDatabaseWarning";

type SideFilter = "all" | "white" | "black";
type PlanExplorerSource = "local" | OnlinePlanExplorerSource;
type SortDirection = "asc" | "desc";
type PlanSortKey = "piece" | "routes" | "games" | "results" | "engine";
type PlanSort = {
  key: PlanSortKey;
  direction: SortDirection;
};
type PlanExplorerEngineRequest = {
  token: number;
  engine: LocalEngine;
  tab: string;
  fen: string;
  cacheKey: string;
  requestedMultipv: number;
  limitLabel: string;
};

function PlanExplorerPanel() {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const fen = useStore(store, (s) => s.currentNode().fen);
  const currentNode = useStore(store, (s) => s.currentNode());
  const setShapes = useStore(store, (s) => s.setShapes);
  const [debouncedFen] = useDebouncedValue(fen, 50);
  const [referenceDatabase, setReferenceDatabase] = useAtom(referenceDbAtom);
  const [showPlanExplorerArrows, setShowPlanExplorerArrows] = useAtom(showPlanExplorerArrowsAtom);
  const [arrowLimit, setArrowLimit] = useAtom(planExplorerArrowLimitAtom);
  const [hoverEverywhere, setHoverEverywhere] = useAtom(planExplorerHoverEverywhereAtom);
  const [source, setSource] = useAtom(planExplorerSourceAtom);
  const currentTab = useAtomValue(currentTabAtom);
  const engines = useAtomValue(enginesAtom);
  const [localOptions, setLocalOptions] = useAtom(currentLocalOptionsAtom);
  const lichessOptions = useAtomValue(lichessOptionsAtom);
  const masterOptions = useAtomValue(masterOptionsAtom);
  const sessions = useAtomValue(sessionsAtom);
  const setPlanExplorerData = useSetAtom(currentPlanExplorerDataAtom);
  const setPreviewLine = useSetAtom(currentPlanExplorerPreviewLineAtom);
  const [engineStrengthEnabled, setEngineStrengthEnabled] = useAtom(
    planExplorerEngineStrengthEnabledAtom,
  );
  const [engineStrengthDepth, setEngineStrengthDepth] = useAtom(
    planExplorerEngineStrengthDepthAtom,
  );
  const [engineStrengthMultipv, setEngineStrengthMultipv] = useAtom(
    planExplorerEngineStrengthMultipvAtom,
  );
  const [engineStrengthState, setEngineStrengthState] = useAtom(
    currentPlanExplorerEngineStrengthAtom,
  );
  const [engineId, setEngineId] = useState<string | null>(null);
  const [sideFilter, setSideFilter] = useState<SideFilter>("all");
  const [maxPlies, setMaxPlies] = useState("8");
  const [sort, setSort] = useState<PlanSort>({ key: "engine", direction: "desc" });
  const engineRequestRef = useRef<PlanExplorerEngineRequest | null>(null);
  const engineUnlistenRef = useRef<(() => void) | null>(null);
  const engineTokenRef = useRef(0);
  const explorerToken = sessions.find((session) => session.lichess?.accessToken)?.lichess
    ?.accessToken;
  const lichessOptionsKey = JSON.stringify(lichessOptions);
  const masterOptionsKey = JSON.stringify(masterOptions);
  const isLocalSource = source === "local";
  const missingExplorerToken = !isLocalSource && !explorerToken;
  const clampedEngineDepth = clampNumber(engineStrengthDepth, 1, 40);
  const clampedEngineMultipv = clampNumber(engineStrengthMultipv, 1, 20);
  const localEngines = useMemo(
    () => (engines ?? []).filter((engine): engine is LocalEngine => engine.type === "local"),
    [engines],
  );
  const selectedEngine = useMemo(
    () => localEngines.find((engine) => engine.id === engineId) ?? localEngines[0] ?? null,
    [engineId, localEngines],
  );
  const cleanupEngineListener = useCallback(() => {
    engineUnlistenRef.current?.();
    engineUnlistenRef.current = null;
  }, []);

  useEffect(() => {
    if (localEngines.length === 0) {
      setEngineId(null);
      return;
    }
    if (!engineId || !localEngines.some((engine) => engine.id === engineId)) {
      setEngineId(localEngines[0].id);
    }
  }, [engineId, localEngines]);

  const engineStrengthCacheKey = useMemo(() => {
    if (!selectedEngine) return "";
    return [debouncedFen, selectedEngine.id, clampedEngineDepth, clampedEngineMultipv].join("|");
  }, [clampedEngineDepth, clampedEngineMultipv, debouncedFen, selectedEngine]);
  const cachedEngineReport = engineStrengthCacheKey
    ? engineStrengthState.cache[engineStrengthCacheKey]
    : null;
  const visibleEngineReport =
    engineStrengthEnabled &&
    engineStrengthState.reportCacheKey === engineStrengthCacheKey &&
    engineStrengthState.report?.fen === debouncedFen
      ? engineStrengthState.report
      : engineStrengthEnabled && cachedEngineReport?.fen === debouncedFen
        ? cachedEngineReport
        : null;

  const { data: databases } = useSWR("databases", () => getDatabases());
  const localDatabases = useMemo(
    () =>
      (databases ?? []).filter((database): database is SuccessDatabaseInfo => {
        return database.type === "success";
      }),
    [databases],
  );
  const dbSelectData = localDatabases.map((database) => ({
    value: database.file,
    label: database.title || database.filename,
  }));

  const requestId = useMemo(
    () =>
      [
        "plan-explorer",
        currentTab?.value ?? "tab",
        source,
        referenceDatabase ?? "none",
        debouncedFen,
        localOptions.type,
        localOptions.player ?? "",
        localOptions.playerName ?? "",
        localOptions.color,
        localOptions.start_date ?? "",
        localOptions.end_date ?? "",
        localOptions.result,
        lichessOptionsKey,
        masterOptionsKey,
        explorerToken ? "auth" : "no-auth",
        maxPlies,
      ].join("|"),
    [
      currentTab?.value,
      debouncedFen,
      explorerToken,
      lichessOptionsKey,
      localOptions,
      masterOptionsKey,
      maxPlies,
      referenceDatabase,
      source,
    ],
  );

  const canSearch = isLocalSource ? !!referenceDatabase : !!explorerToken;
  const searchKey = canSearch
    ? [
        "plan-explorer",
        requestId,
        source,
        referenceDatabase ?? "",
        debouncedFen,
        localOptions.type,
        localOptions.player ?? "",
        localOptions.playerName ?? "",
        localOptions.color,
        localOptions.start_date ?? "",
        localOptions.end_date ?? "",
        localOptions.result,
        lichessOptionsKey,
        masterOptionsKey,
        maxPlies,
      ]
    : null;

  const {
    data: planData,
    isLoading,
    error,
  } = useSWR(searchKey, async () => {
    if (source === "lch_all") {
      return getOnlinePlanExplorer(
        source,
        debouncedFen,
        lichessOptions,
        Number(maxPlies),
        explorerToken,
      );
    }

    if (source === "lch_master") {
      return getOnlinePlanExplorer(
        source,
        debouncedFen,
        masterOptions,
        Number(maxPlies),
        explorerToken,
      );
    }

    return getPlanExplorer(
      {
        ...localOptions,
        fen: debouncedFen,
        path: referenceDatabase,
      },
      Number(maxPlies),
      requestId,
    );
  });

  const visiblePlanData = useMemo(() => {
    if (!planData) return null;
    if (sideFilter === "all") return planData;
    return {
      ...planData,
      pieces: planData.pieces.filter((piece) => piece.color === sideFilter),
    };
  }, [planData, sideFilter]);
  const sortedVisiblePlanData = useMemo(() => {
    if (!visiblePlanData) return null;
    return {
      ...visiblePlanData,
      pieces: sortPlanPieces(
        visiblePlanData.pieces,
        sort,
        visibleEngineReport,
        isLocalSource ? getLocalResultPerspective(localOptions) : null,
      ),
    };
  }, [isLocalSource, localOptions, sort, visibleEngineReport, visiblePlanData]);

  const handleEngineLines = useCallback(
    (active: PlanExplorerEngineRequest, bestLines: BestMoves[], nextProgress: number) => {
      if (bestLines.length === 0) return;

      const nextClampedProgress = Math.min(100, Math.max(0, nextProgress));
      const nextReport = buildEnginePlanReport(active.fen, bestLines, {
        requestedMultipv: active.requestedMultipv,
        limitLabel: active.limitLabel,
      });

      setEngineStrengthState((current) => ({
        ...current,
        report: nextReport,
        reportCacheKey: active.cacheKey,
        cache: {
          ...current.cache,
          [active.cacheKey]: nextReport,
        },
        progress: nextClampedProgress,
        running: nextClampedProgress < 100,
        error: null,
        activeRequestKey: nextClampedProgress >= 100 ? null : active.cacheKey,
      }));

      if (nextClampedProgress >= 100) {
        engineRequestRef.current = null;
        cleanupEngineListener();
      }
    },
    [cleanupEngineListener, setEngineStrengthState],
  );

  const runEngineStrength = useCallback(
    async (forceRefresh = false) => {
      if (!selectedEngine || !engineStrengthCacheKey || !engineStrengthEnabled || !planData) {
        return;
      }

      const cached = forceRefresh ? null : engineStrengthState.cache[engineStrengthCacheKey];
      if (cached) {
        setEngineStrengthState((current) => ({
          ...current,
          report: cached,
          reportCacheKey: engineStrengthCacheKey,
          progress: 100,
          running: false,
          error: null,
          activeRequestKey: null,
        }));
        return;
      }

      const previous = engineRequestRef.current;
      if (previous) {
        void stopEngine(previous.engine, previous.tab);
      }
      cleanupEngineListener();

      const tab = `plan-explorer-engine:${currentTab?.value ?? "tab"}`;
      const active: PlanExplorerEngineRequest = {
        token: engineTokenRef.current + 1,
        engine: selectedEngine,
        tab,
        fen: debouncedFen,
        cacheKey: engineStrengthCacheKey,
        requestedMultipv: clampedEngineMultipv,
        limitLabel: `Depth ${clampedEngineDepth}`,
      };
      engineTokenRef.current = active.token;
      engineRequestRef.current = active;
      setEngineStrengthState((current) => ({
        ...current,
        report: null,
        reportCacheKey: engineStrengthCacheKey,
        progress: 0,
        running: true,
        error: null,
        activeRequestKey: engineStrengthCacheKey,
      }));

      let unlisten: () => void;
      try {
        unlisten = await events.bestMovesPayload.listen(({ payload }) => {
          const current = engineRequestRef.current;
          if (!current || current.token !== active.token) return;
          if (payload.engine !== current.engine.id || payload.tab !== current.tab) return;
          if (payload.fen !== current.fen || payload.moves.length !== 0) return;

          handleEngineLines(current, payload.bestLines, payload.progress);
        });
      } catch (caught) {
        if (engineRequestRef.current?.token === active.token) {
          setEngineStrengthState((current) => ({
            ...current,
            error: caught instanceof Error ? caught.message : String(caught),
            running: false,
            activeRequestKey: null,
          }));
          engineRequestRef.current = null;
        }
        return;
      }

      if (engineRequestRef.current?.token === active.token) {
        engineUnlistenRef.current = unlisten;
      } else {
        unlisten();
        return;
      }

      const goMode: GoMode = { t: "Depth", c: clampedEngineDepth };
      void getLocalBestMoves(selectedEngine, tab, goMode, {
        fen: debouncedFen,
        moves: [],
        extraOptions: buildEngineOptions(selectedEngine.settings, clampedEngineMultipv),
      })
        .then((result) => {
          const current = engineRequestRef.current;
          if (!result || !current || current.token !== active.token) return;
          handleEngineLines(current, result[1], result[0]);
        })
        .catch((caught) => {
          const current = engineRequestRef.current;
          if (!current || current.token !== active.token) return;
          setEngineStrengthState((state) => ({
            ...state,
            error: caught instanceof Error ? caught.message : String(caught),
            running: false,
            activeRequestKey: null,
          }));
          engineRequestRef.current = null;
          cleanupEngineListener();
        });
    },
    [
      cleanupEngineListener,
      clampedEngineDepth,
      clampedEngineMultipv,
      currentTab?.value,
      debouncedFen,
      engineStrengthCacheKey,
      engineStrengthEnabled,
      engineStrengthState.cache,
      handleEngineLines,
      planData,
      selectedEngine,
      setEngineStrengthState,
    ],
  );

  const stopEngineStrength = useCallback(() => {
    const active = engineRequestRef.current;
    engineRequestRef.current = null;
    cleanupEngineListener();
    setEngineStrengthState((current) => ({
      ...current,
      running: false,
      activeRequestKey: null,
    }));
    if (active) {
      void stopEngine(active.engine, active.tab);
    }
  }, [cleanupEngineListener, setEngineStrengthState]);

  useEffect(() => {
    if (!engineStrengthEnabled) {
      stopEngineStrength();
      return;
    }
    if (!selectedEngine || !planData || !engineStrengthCacheKey) return;
    if (visibleEngineReport || engineStrengthState.activeRequestKey === engineStrengthCacheKey) {
      return;
    }

    void runEngineStrength();
  }, [
    engineStrengthCacheKey,
    engineStrengthEnabled,
    engineStrengthState.activeRequestKey,
    planData,
    runEngineStrength,
    selectedEngine,
    stopEngineStrength,
    visibleEngineReport,
  ]);

  useEffect(() => {
    return () => {
      stopEngineStrength();
    };
  }, [stopEngineStrength]);

  useEffect(() => {
    setPlanExplorerData(null);
    setPreviewLine(null);
  }, [
    debouncedFen,
    lichessOptionsKey,
    localOptions.color,
    localOptions.player,
    localOptions.playerName,
    masterOptionsKey,
    maxPlies,
    referenceDatabase,
    setPlanExplorerData,
    setPreviewLine,
    source,
  ]);

  useEffect(() => {
    if (!isLocalSource || !referenceDatabase) return undefined;

    return () => {
      setPreviewLine(null);
      void cancelDatabaseSearch(requestId);
    };
  }, [isLocalSource, referenceDatabase, requestId, setPreviewLine]);

  useEffect(() => {
    setPlanExplorerData(sortedVisiblePlanData);
    setPreviewLine(null);
  }, [setPlanExplorerData, setPreviewLine, sortedVisiblePlanData]);

  const drawLine = useCallback(
    (line: ColoredPlanExplorerLine) => {
      const existing = currentNode.shapes.filter((shape) => !isPlanBrush(shape.brush));
      setShapes([...existing, ...planLineToShapes(line)]);
    },
    [currentNode.shapes, setShapes],
  );

  const pieces = useMemo(() => {
    return sortedVisiblePlanData?.pieces ?? [];
  }, [sortedVisiblePlanData?.pieces]);

  const content = (() => {
    if (isLocalSource && !referenceDatabase) {
      return <NoDatabaseWarning />;
    }

    if (missingExplorerToken) {
      return (
        <Alert color="yellow">
          {t("Board.Database.ExplorerAuthRequired1")} <Link to="/accounts">Users</Link>{" "}
          {t("Board.Database.ExplorerAuthRequired2")}
        </Alert>
      );
    }

    return (
      <ScrollArea flex={1} offsetScrollbars>
        <Table withTableBorder highlightOnHover stickyHeader>
          <Table.Thead>
            <Table.Tr>
              <SortableTh sortKey="piece" sort={sort} setSort={setSort} style={{ width: 150 }}>
                Piece
              </SortableTh>
              {engineStrengthEnabled && (
                <SortableTh sortKey="engine" sort={sort} setSort={setSort} style={{ width: 130 }}>
                  Engine
                </SortableTh>
              )}
              <SortableTh sortKey="routes" sort={sort} setSort={setSort}>
                Routes
              </SortableTh>
              <SortableTh sortKey="games" sort={sort} setSort={setSort} style={{ width: 110 }}>
                Games
              </SortableTh>
              <SortableTh sortKey="results" sort={sort} setSort={setSort} style={{ width: 150 }}>
                Results
              </SortableTh>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {pieces.length === 0 && !isLoading ? (
              <Table.Tr>
                <Table.Td colSpan={engineStrengthEnabled ? 5 : 4}>
                  <Text ta="center" c="dimmed" py="lg">
                    No piece routes found in the sampled continuations.
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              pieces.map((piece) => (
                <PieceRow
                  key={`${piece.color}-${piece.role}-${piece.from}`}
                  piece={piece}
                  drawLine={drawLine}
                  previewLine={setPreviewLine}
                  engineStrengthEnabled={engineStrengthEnabled}
                  engineReport={visibleEngineReport}
                  engineRunning={engineStrengthState.running}
                  resultPerspective={isLocalSource ? getLocalResultPerspective(localOptions) : null}
                />
              ))
            )}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    );
  })();

  return (
    <Stack h="100%" gap="xs" p="sm">
      <Stack gap="xs">
        <Group justify="space-between" align="center" wrap="wrap" gap="xs">
          <Group gap="xs" wrap="wrap" miw={0}>
            <SegmentedControl
              size="sm"
              value={source}
              onChange={(value) => setSource(value as PlanExplorerSource)}
              data={[
                { label: t("Board.Database.Local"), value: "local" },
                { label: t("Board.Database.LichessAll"), value: "lch_all" },
                { label: t("Board.Database.LichessMaster"), value: "lch_master" },
              ]}
            />
            {isLocalSource && (
              <>
                <DatabaseSelector
                  data={dbSelectData}
                  value={referenceDatabase}
                  onChange={setReferenceDatabase}
                />
                <DatabasePerspectiveControls
                  databasePath={referenceDatabase}
                  player={localOptions.player}
                  playerName={localOptions.playerName}
                  color={localOptions.color}
                  onPlayerChange={(player) => setLocalOptions((q) => ({ ...q, player }))}
                  onPlayerNameChange={(playerName) =>
                    setLocalOptions((q) => ({ ...q, playerName }))
                  }
                  onColorChange={(color) => setLocalOptions((q) => ({ ...q, color }))}
                  size="sm"
                />
              </>
            )}
          </Group>
          <Group gap="xs" wrap="nowrap">
            <AutoArrowControls
              checked={showPlanExplorerArrows}
              onChange={setShowPlanExplorerArrows}
              arrowLimit={arrowLimit}
              setArrowLimit={setArrowLimit}
              hoverEverywhere={hoverEverywhere}
              setHoverEverywhere={setHoverEverywhere}
            />
            <Text size="sm" style={{ whiteSpace: "nowrap" }}>
              {formatNumber(planData?.total_games ?? 0)} matches
            </Text>
            {!!planData && planData.sampled_games < planData.total_games && (
              <Badge variant="light">{formatNumber(planData.sampled_games)} sampled</Badge>
            )}
          </Group>
        </Group>

        <Group gap="xs" wrap="wrap">
          <SegmentedControl
            size="sm"
            value={maxPlies}
            onChange={setMaxPlies}
            data={[
              { label: "8 ply", value: "8" },
              { label: "12 ply", value: "12" },
              { label: "16 ply", value: "16" },
            ]}
          />
          <SegmentedControl
            size="sm"
            value={sideFilter}
            onChange={(value) => setSideFilter(value as SideFilter)}
            data={[
              { label: "All", value: "all" },
              { label: "White", value: "white" },
              { label: "Black", value: "black" },
            ]}
          />
          <Switch
            label="Engine strength"
            size="sm"
            checked={engineStrengthEnabled}
            onChange={(event) => setEngineStrengthEnabled(event.currentTarget.checked)}
            styles={{
              label: { whiteSpace: "nowrap" },
              track: { cursor: "pointer" },
            }}
          />
          {engineStrengthEnabled && (
            <>
              <Select
                aria-label="Plan Explorer engine"
                data={localEngines.map((engine) => ({
                  value: engine.id,
                  label: engine.name,
                }))}
                value={selectedEngine?.id ?? null}
                onChange={setEngineId}
                placeholder="Engine"
                size="sm"
                w={180}
                searchable
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
              />
              <NumberInput
                aria-label="Plan Explorer engine depth"
                value={clampedEngineDepth}
                onChange={(value) =>
                  setEngineStrengthDepth(clampNumber(Number(value) || 12, 1, 40))
                }
                min={1}
                max={40}
                clampBehavior="strict"
                size="sm"
                w={94}
                prefix="D "
              />
              <NumberInput
                aria-label="Plan Explorer engine PV"
                value={clampedEngineMultipv}
                onChange={(value) =>
                  setEngineStrengthMultipv(clampNumber(Number(value) || 5, 1, 20))
                }
                min={1}
                max={20}
                clampBehavior="strict"
                size="sm"
                w={94}
                prefix="PV "
              />
              <Tooltip
                label={
                  engineStrengthState.running ? "Stop engine strength" : "Refresh engine strength"
                }
              >
                <ActionIcon
                  size="lg"
                  variant="default"
                  disabled={!selectedEngine || !planData}
                  onClick={() => {
                    if (engineStrengthState.running) {
                      stopEngineStrength();
                      return;
                    }

                    setEngineStrengthState((current) => {
                      const nextCache = { ...current.cache };
                      delete nextCache[engineStrengthCacheKey];
                      return {
                        ...current,
                        report:
                          current.reportCacheKey === engineStrengthCacheKey ? null : current.report,
                        reportCacheKey:
                          current.reportCacheKey === engineStrengthCacheKey
                            ? null
                            : current.reportCacheKey,
                        cache: nextCache,
                      };
                    });
                    void runEngineStrength(true);
                  }}
                >
                  {engineStrengthState.running ? (
                    <IconPlayerStop size="1rem" />
                  ) : (
                    <IconRefresh size="1rem" />
                  )}
                </ActionIcon>
              </Tooltip>
              {engineStrengthState.running && (
                <Badge variant="light">{Math.round(engineStrengthState.progress)}%</Badge>
              )}
            </>
          )}
        </Group>
      </Stack>

      <Progress
        value={
          isLoading
            ? 100
            : engineStrengthEnabled && engineStrengthState.running
              ? engineStrengthState.progress
              : 0
        }
        animated={isLoading || (engineStrengthEnabled && engineStrengthState.running)}
        size="xs"
      />

      {error && (
        <Alert color="red" variant="light">
          {String(error)}
        </Alert>
      )}
      {engineStrengthEnabled && localEngines.length === 0 && (
        <Alert color="yellow" variant="light">
          No configured local Stockfish engine for Engine strength.
        </Alert>
      )}
      {engineStrengthEnabled && engineStrengthState.error && (
        <Alert color="red" variant="light">
          {engineStrengthState.error}
        </Alert>
      )}

      {content}
    </Stack>
  );
}

function AutoArrowControls({
  checked,
  onChange,
  arrowLimit,
  setArrowLimit,
  hoverEverywhere,
  setHoverEverywhere,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  arrowLimit: number;
  setArrowLimit: (value: number) => void;
  hoverEverywhere: boolean;
  setHoverEverywhere: (value: boolean) => void;
}) {
  return (
    <Group gap="xs" wrap="nowrap">
      <Switch
        label="Auto arrows"
        size="sm"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        styles={{
          label: { whiteSpace: "nowrap" },
          track: { cursor: "pointer" },
        }}
      />
      <NumberInput
        aria-label="Auto arrow limit"
        value={arrowLimit}
        onChange={(value) => setArrowLimit(Math.max(1, Number(value) || 1))}
        min={1}
        max={64}
        clampBehavior="strict"
        size="xs"
        w={72}
        disabled={!checked}
      />
      <Switch
        label="Board hover"
        size="sm"
        checked={hoverEverywhere}
        onChange={(event) => setHoverEverywhere(event.currentTarget.checked)}
        styles={{
          label: { whiteSpace: "nowrap" },
          track: { cursor: "pointer" },
        }}
      />
    </Group>
  );
}

function DatabaseSelector({
  data,
  value,
  onChange,
}: {
  data: { value: string; label: string }[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const selectedLabel = data.find((item) => item.value === value)?.label ?? "Reference database";
  const widthCh = Math.min(Math.max(selectedLabel.length + 4, 18), 34);

  return (
    <Select
      data={data}
      value={value}
      onChange={async (next) => {
        await commands.clearGames();
        onChange(next);
      }}
      placeholder="Reference database"
      size="sm"
      w={`${widthCh}ch`}
      miw={180}
      maw="100%"
      searchable
      allowDeselect={false}
      comboboxProps={{ withinPortal: true }}
    />
  );
}

function SortableTh({
  sortKey,
  sort,
  setSort,
  children,
  style,
}: {
  sortKey: PlanSortKey;
  sort: PlanSort;
  setSort: Dispatch<SetStateAction<PlanSort>>;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const active = sort.key === sortKey;
  const Icon = sort.direction === "asc" ? IconChevronUp : IconChevronDown;

  return (
    <Table.Th style={style}>
      <UnstyledButton
        w="100%"
        onClick={() =>
          setSort((current) =>
            current.key === sortKey
              ? {
                  key: sortKey,
                  direction: current.direction === "asc" ? "desc" : "asc",
                }
              : {
                  key: sortKey,
                  direction: defaultPlanSortDirection(sortKey),
                },
          )
        }
      >
        <Group gap={4} wrap="nowrap">
          <Text size="sm" fw={700}>
            {children}
          </Text>
          {active && <Icon size="0.875rem" />}
        </Group>
      </UnstyledButton>
    </Table.Th>
  );
}

function sortPlanPieces(
  pieces: PlanExplorerPiece[],
  sort: PlanSort,
  engineReport: EnginePlanReport | null,
  resultPerspective: DatabaseResultPerspective | null,
) {
  const direction = sort.direction === "asc" ? 1 : -1;

  return [...pieces].sort((a, b) => {
    let diff = 0;
    switch (sort.key) {
      case "piece":
        diff =
          a.color.localeCompare(b.color) ||
          a.role.localeCompare(b.role) ||
          a.from.localeCompare(b.from);
        break;
      case "routes":
        diff = a.lines.length - b.lines.length || a.total - b.total;
        break;
      case "games":
        diff = a.total - b.total;
        break;
      case "results":
        diff =
          getPieceResultScore(a, resultPerspective) - getPieceResultScore(b, resultPerspective) ||
          a.total - b.total;
        break;
      case "engine":
        diff =
          getPieceEngineStrengthScore(a, engineReport) -
            getPieceEngineStrengthScore(b, engineReport) || a.total - b.total;
        break;
    }

    return direction * diff;
  });
}

function defaultPlanSortDirection(key: PlanSortKey): SortDirection {
  return key === "piece" ? "asc" : "desc";
}

function getPieceResultScore(
  piece: PlanExplorerPiece,
  resultPerspective: DatabaseResultPerspective | null,
) {
  const topLine = piece.lines[0];
  if (!topLine) return 0;

  return getLineResultScore(topLine, resultPerspective ?? piece.color);
}

function getLineResultScore(line: PlanExplorerLine, color: string) {
  const total = line.white + line.draw + line.black;
  if (total <= 0) return 0;

  const wins = color === "black" ? line.black : line.white;
  return (wins + line.draw * 0.5) / total;
}

function getPieceEngineMatch(
  piece: PlanExplorerPiece,
  engineReport: EnginePlanReport | null,
): PlanExplorerEnginePlanMatch | null {
  const matches = piece.lines
    .map((line) => getPlanExplorerLineEnginePlan(piece, line, engineReport))
    .filter((match): match is PlanExplorerEnginePlanMatch => !!match);

  return (
    matches
      .slice()
      .sort(
        (a, b) =>
          enginePlanStrengthScore(b.plan) - enginePlanStrengthScore(a.plan) ||
          b.plan.supportCount - a.plan.supportCount,
      )[0] ?? null
  );
}

function getPieceEngineStrengthScore(
  piece: PlanExplorerPiece,
  engineReport: EnginePlanReport | null,
) {
  return enginePlanStrengthScore(getPieceEngineMatch(piece, engineReport)?.plan);
}

function EngineStrengthCell({
  match,
  running,
}: {
  match: PlanExplorerEnginePlanMatch | null;
  running: boolean;
}) {
  if (!match) {
    return (
      <Text size="xs" c="dimmed">
        {running ? "Analyzing" : "No PV"}
      </Text>
    );
  }

  return (
    <Stack gap={2}>
      <Badge color={approvalColor(match.plan.approval)} variant="light">
        {match.plan.approval}
      </Badge>
      <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
        {match.plan.supportCount} PV{match.plan.supportCount === 1 ? "" : "s"}
      </Text>
    </Stack>
  );
}

function PieceRow({
  piece,
  drawLine,
  previewLine,
  engineStrengthEnabled,
  engineReport,
  engineRunning,
  resultPerspective,
}: {
  piece: PlanExplorerPiece;
  drawLine: (line: ColoredPlanExplorerLine) => void;
  previewLine: (line: ColoredPlanExplorerLine | null) => void;
  engineStrengthEnabled: boolean;
  engineReport: EnginePlanReport | null;
  engineRunning: boolean;
  resultPerspective: DatabaseResultPerspective | null;
}) {
  const topLine = piece.lines[0] ? withPlanLineColor(piece.lines[0], piece.color) : null;
  const engineMatch = useMemo(
    () => getPieceEngineMatch(piece, engineReport),
    [engineReport, piece],
  );

  return (
    <Table.Tr
      onMouseEnter={() => topLine && previewLine(topLine)}
      onMouseLeave={() => previewLine(null)}
      onClick={() => topLine && drawLine(topLine)}
      style={{ cursor: topLine ? "pointer" : "default" }}
    >
      <Table.Td>
        <Group gap="xs" wrap="nowrap">
          <Box w={24} h={24}>
            <PieceComponent piece={toChessgroundPiece(piece)} size={24} />
          </Box>
          <Box>
            <Text size="sm" fw={700}>
              {capitalize(piece.role)}
            </Text>
            <Text size="xs" c="dimmed">
              {piece.from}
            </Text>
          </Box>
        </Group>
      </Table.Td>
      {engineStrengthEnabled && (
        <Table.Td>
          <EngineStrengthCell match={engineMatch} running={engineRunning} />
        </Table.Td>
      )}
      <Table.Td>
        <Stack gap={4}>
          {piece.lines.slice(0, 4).map((rawLine) => {
            const line = withPlanLineColor(rawLine, piece.color);
            const lineMatch = engineStrengthEnabled
              ? getPlanExplorerLineEnginePlan(piece, rawLine, engineReport)
              : null;
            return (
              <Group
                key={line.squares.join("-")}
                gap="xs"
                wrap="nowrap"
                onMouseEnter={() => previewLine(line)}
                onMouseLeave={() => topLine && previewLine(topLine)}
              >
                <Tooltip label="Draw route">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    onClick={(event) => {
                      event.stopPropagation();
                      drawLine(line);
                    }}
                  >
                    <IconRoute size="1rem" />
                  </ActionIcon>
                </Tooltip>
                <Text size="sm" ff="monospace" truncate>
                  {formatPlanRoute(line.squares)}
                </Text>
                <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                  {formatNumber(line.games)}
                </Text>
                <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                  {piece.total > 0 ? `${((line.games / piece.total) * 100).toFixed(0)}%` : "0%"}
                </Text>
                {lineMatch && (
                  <Badge size="xs" color={approvalColor(lineMatch.plan.approval)} variant="light">
                    {lineMatch.plan.approval}
                  </Badge>
                )}
              </Group>
            );
          })}
        </Stack>
      </Table.Td>
      <Table.Td>
        <Badge variant="light">{formatNumber(piece.total)}</Badge>
      </Table.Td>
      <Table.Td>{topLine && <ResultBar line={topLine} perspective={resultPerspective} />}</Table.Td>
    </Table.Tr>
  );
}

function ResultBar({
  line,
  perspective,
}: {
  line: PlanExplorerLine;
  perspective: DatabaseResultPerspective | null;
}) {
  const total = line.white + line.draw + line.black;
  if (total === 0) {
    return (
      <Text size="sm" c="dimmed">
        -
      </Text>
    );
  }

  const first = perspective === "black" ? line.black : line.white;
  const third = perspective === "black" ? line.white : line.black;

  return (
    <Progress.Root size="sm">
      <Progress.Section value={(first / total) * 100} color="gray.3" />
      <Progress.Section value={(line.draw / total) * 100} color="gray" />
      <Progress.Section value={(third / total) * 100} color="dark" />
    </Progress.Root>
  );
}

function toChessgroundPiece(piece: PlanExplorerPiece): Piece {
  return {
    color: piece.color as Piece["color"],
    role: piece.role as Piece["role"],
  };
}

function buildEngineOptions(
  settings: EngineSettings | null | undefined,
  multipv: number,
): EngineOption[] {
  const options =
    settings
      ?.filter((option) => option.name !== "MultiPV" && option.value !== null)
      .map((option) => ({
        name: option.name,
        value: option.value?.toString() ?? "",
      })) ?? [];

  options.push({
    name: "MultiPV",
    value: multipv.toString(),
  });

  return options;
}

function approvalColor(approval: EnginePlan["approval"]) {
  switch (approval) {
    case "Strong":
      return "green";
    case "OK":
      return "blue";
    case "Weak":
      return "orange";
    case "Unclear":
      return "gray";
  }
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default memo(PlanExplorerPanel);
