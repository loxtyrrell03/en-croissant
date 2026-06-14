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
  type PlanExplorerSetup,
  type PlanExplorerSetupPlan,
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
import DatabaseFolderSelect from "@/components/common/DatabaseFolderSelect";
import {
  currentLocalOptionsAtom,
  currentPlanExplorerDataAtom,
  currentPlanExplorerEngineStrengthAtom,
  currentPlanExplorerPreviewLineAtom,
  currentTabAtom,
  enginesAtom,
  lichessOptionsAtom,
  masterOptionsAtom,
  moveStrengthSettingsAtom,
  planExplorerArrowLimitAtom,
  planExplorerEngineStrengthDepthAtom,
  planExplorerEngineStrengthEnabledAtom,
  planExplorerEngineStrengthMultipvAtom,
  planExplorerHoverEverywhereAtom,
  planExplorerSourceAtom,
  planExplorerViewAtom,
  referenceDbAtom,
  sessionsAtom,
  showPlanExplorerArrowsAtom,
} from "@/state/atoms";
import {
  buildEnginePlanReport,
  enginePlanStrengthScore,
  formatEvalCp,
  formatScoreValue,
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
  getDatabaseSelectData,
  getLocalResultPerspective,
  getPlanExplorer,
  type SuccessDatabaseInfo,
} from "@/utils/db";
import { formatNumber } from "@/utils/format";
import { getOnlinePlanExplorer, type OnlinePlanExplorerSource } from "@/utils/lichess/planExplorer";
import {
  formatPlanPieceRoute,
  isPlanBrush,
  planLineToShapes,
  planLinesToShapes,
  summarizePlanPiece,
  withPlanLineColor,
  type ColoredPlanExplorerLine,
} from "@/utils/planExplorer";
import {
  evaluateMoveStrength,
  getEngineScoreSpreadCp,
  getPracticalWdlRate,
  getUsageAwarePracticalWdlRate,
  normalizeMoveStrengthSettings,
  type MoveStrengthSettings,
} from "@/utils/moveStrength";
import { withLimitedRecordEntry } from "@/utils/boundedCache";
import { DatabasePerspectiveControls } from "../database/DatabasePerspectiveControls";
import type { LocalOptions } from "../database/DatabasePanel";
import { MoveStrengthSettingsButton } from "../database/MoveStrengthSettingsButton";
import NoDatabaseWarning from "../database/NoDatabaseWarning";
import PlanCoachInline, { type PlanCoachInlineRequest } from "./PlanCoachInline";
import resultClasses from "../database/OpeningsTable.module.css";

const MAX_ENGINE_STRENGTH_REPORT_CACHE_ENTRIES = 24;
const ENGINE_STRENGTH_WATCHDOG_MS = 15_000;

type SideFilter = "all" | "white" | "black";
type PlanExplorerSource = "local" | OnlinePlanExplorerSource;
type PlanExplorerView = "plans" | "setups";
type SortDirection = "asc" | "desc";
type PlanSortKey = "piece" | "blend" | "routes" | "games" | "results" | "engine";
type PlanSort = {
  key: PlanSortKey;
  direction: SortDirection;
};
type PlanStrength = {
  score: number;
  loss: number;
  label: string;
  databaseScore: number | null;
  databaseWdlLoss: number | null;
  engineCpLoss: number | null;
  engineUnsafe: boolean;
  usingEngine: boolean;
  detail: string;
};
type SetupVerdict = {
  label: string;
  color: string;
  detail: string;
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
  const [view, setView] = useAtom(planExplorerViewAtom);
  const moveStrengthSettings = useAtomValue(moveStrengthSettingsAtom);
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
  const engineWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const cleanupEngineWatchdog = useCallback(() => {
    if (engineWatchdogRef.current) {
      clearTimeout(engineWatchdogRef.current);
      engineWatchdogRef.current = null;
    }
  }, []);
  const startEngineWatchdog = useCallback(
    (active: PlanExplorerEngineRequest) => {
      cleanupEngineWatchdog();
      engineWatchdogRef.current = setTimeout(() => {
        const current = engineRequestRef.current;
        if (!current || current.token !== active.token) return;

        engineWatchdogRef.current = null;
        engineRequestRef.current = null;
        cleanupEngineListener();
        setEngineStrengthState((state) => ({
          ...state,
          running: false,
          activeRequestKey: null,
          error: "Engine strength timed out before returning Plan Explorer PVs.",
        }));
        void stopEngine(current.engine, current.tab);
      }, ENGINE_STRENGTH_WATCHDOG_MS);
    },
    [cleanupEngineListener, cleanupEngineWatchdog, setEngineStrengthState],
  );

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
    return [
      debouncedFen,
      selectedEngine.id,
      clampedEngineDepth,
      clampedEngineMultipv,
      view,
      sideFilter,
    ].join("|");
  }, [clampedEngineDepth, clampedEngineMultipv, debouncedFen, selectedEngine, sideFilter, view]);
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
  const dbSelectData = getDatabaseSelectData(localDatabases);
  const handleLocalColorChange = useCallback(
    (color: LocalOptions["color"]) => {
      setLocalOptions((current) => ({ ...current, color }));
      if (view === "setups") {
        setSideFilter(color);
      }
    },
    [setLocalOptions, view],
  );

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
        view,
        sideFilter,
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
      sideFilter,
      source,
      view,
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
        view,
        sideFilter,
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
  const visibleError = isExpectedPlanExplorerCancellation(error) ? null : error;

  const visiblePlanData = useMemo(() => {
    if (!planData) return null;
    if (sideFilter === "all") return planData;
    return {
      ...planData,
      pieces: planData.pieces.filter((piece) => piece.color === sideFilter),
      setups: (planData.setups ?? []).filter((setup) => setupSide(setup) === sideFilter),
    };
  }, [planData, sideFilter]);
  const setupSideCounts = useMemo(
    () => countSetupSides(planData?.setups ?? []),
    [planData?.setups],
  );
  const resultPerspective = isLocalSource ? getLocalResultPerspective(localOptions) : null;
  const coachSourceLabel = useMemo(
    () =>
      planExplorerCoachSourceLabel({
        source,
        referenceDatabase,
        localOptions,
      }),
    [localOptions, referenceDatabase, source],
  );
  const planStrengthByKey = useMemo(
    () =>
      buildPlanStrengthByKey(
        visiblePlanData?.pieces ?? [],
        visibleEngineReport,
        resultPerspective,
        moveStrengthSettings,
      ),
    [moveStrengthSettings, resultPerspective, visibleEngineReport, visiblePlanData?.pieces],
  );
  const setupStrengthByKey = useMemo(
    () =>
      buildSetupStrengthByKey(
        visiblePlanData?.setups ?? [],
        visibleEngineReport,
        resultPerspective,
        sideFilter,
        debouncedFen,
        moveStrengthSettings,
      ),
    [
      debouncedFen,
      moveStrengthSettings,
      resultPerspective,
      sideFilter,
      visibleEngineReport,
      visiblePlanData?.setups,
    ],
  );
  const sortedVisiblePlanData = useMemo(() => {
    if (!visiblePlanData) return null;
    return {
      ...visiblePlanData,
      pieces: sortPlanPieces(
        visiblePlanData.pieces,
        sort,
        visibleEngineReport,
        resultPerspective,
        planStrengthByKey,
      ),
    };
  }, [planStrengthByKey, resultPerspective, sort, visibleEngineReport, visiblePlanData]);
  const sortedVisibleSetups = useMemo(() => {
    const setups = visiblePlanData?.setups ?? [];
    return sortPlanSetups(setups, sort, visibleEngineReport, resultPerspective, setupStrengthByKey);
  }, [resultPerspective, setupStrengthByKey, sort, visibleEngineReport, visiblePlanData?.setups]);

  const handleEngineLines = useCallback(
    (active: PlanExplorerEngineRequest, bestLines: BestMoves[], nextProgress: number) => {
      const nextClampedProgress = Math.min(100, Math.max(0, nextProgress));
      if (bestLines.length === 0) {
        if (nextClampedProgress >= 100) {
          setEngineStrengthState((current) => ({
            ...current,
            progress: 100,
            running: false,
            activeRequestKey: null,
          }));
          engineRequestRef.current = null;
          cleanupEngineListener();
          cleanupEngineWatchdog();
        }
        return;
      }

      const nextReport = buildEnginePlanReport(active.fen, bestLines, {
        requestedMultipv: active.requestedMultipv,
        limitLabel: active.limitLabel,
      });

      setEngineStrengthState((current) => ({
        ...current,
        report: nextReport,
        reportCacheKey: active.cacheKey,
        cache: withLimitedRecordEntry(
          current.cache,
          active.cacheKey,
          nextReport,
          MAX_ENGINE_STRENGTH_REPORT_CACHE_ENTRIES,
        ),
        progress: nextClampedProgress,
        running: nextClampedProgress < 100,
        error: null,
        activeRequestKey: nextClampedProgress >= 100 ? null : active.cacheKey,
      }));

      if (nextClampedProgress >= 100) {
        engineRequestRef.current = null;
        cleanupEngineListener();
        cleanupEngineWatchdog();
      } else {
        startEngineWatchdog(active);
      }
    },
    [cleanupEngineListener, cleanupEngineWatchdog, setEngineStrengthState, startEngineWatchdog],
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
      startEngineWatchdog(active);

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
          cleanupEngineWatchdog();
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
          cleanupEngineWatchdog();
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
      cleanupEngineWatchdog,
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
      startEngineWatchdog,
    ],
  );

  const stopEngineStrength = useCallback(() => {
    const active = engineRequestRef.current;
    engineRequestRef.current = null;
    cleanupEngineListener();
    cleanupEngineWatchdog();
    setEngineStrengthState((current) => ({
      ...current,
      running: false,
      activeRequestKey: null,
    }));
    if (active) {
      void stopEngine(active.engine, active.tab);
    }
  }, [cleanupEngineListener, cleanupEngineWatchdog, setEngineStrengthState]);

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
    stopEngineStrength();
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
    sideFilter,
    source,
    stopEngineStrength,
    view,
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
  }, [setPlanExplorerData, sortedVisiblePlanData]);

  useEffect(() => {
    setPreviewLine(null);
  }, [setPreviewLine, sideFilter, view]);

  const drawLine = useCallback(
    (line: ColoredPlanExplorerLine) => {
      const existing = currentNode.shapes.filter((shape) => !isPlanBrush(shape.brush));
      setShapes([...existing, ...planLineToShapes(line)]);
    },
    [currentNode.shapes, setShapes],
  );
  const drawLines = useCallback(
    (lines: ColoredPlanExplorerLine[]) => {
      const existing = currentNode.shapes.filter((shape) => !isPlanBrush(shape.brush));
      setShapes([...existing, ...planLinesToShapes(lines, 16)]);
    },
    [currentNode.shapes, setShapes],
  );

  const pieces = useMemo(() => {
    return sortedVisiblePlanData?.pieces ?? [];
  }, [sortedVisiblePlanData?.pieces]);
  const setups = sortedVisibleSetups;
  const waitingForFirstEngineReport =
    engineStrengthState.running &&
    engineStrengthState.activeRequestKey === engineStrengthCacheKey &&
    !visibleEngineReport;

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
          {view === "plans" ? (
            <>
              <Table.Thead>
                <Table.Tr>
                  <SortableTh sortKey="piece" sort={sort} setSort={setSort} style={{ width: 150 }}>
                    Piece
                  </SortableTh>
                  <SortableTh sortKey="blend" sort={sort} setSort={setSort} style={{ width: 120 }}>
                    Blend
                  </SortableTh>
                  {engineStrengthEnabled && (
                    <SortableTh
                      sortKey="engine"
                      sort={sort}
                      setSort={setSort}
                      style={{ width: 130 }}
                    >
                      Engine
                    </SortableTh>
                  )}
                  <SortableTh sortKey="routes" sort={sort} setSort={setSort}>
                    Routes
                  </SortableTh>
                  <SortableTh sortKey="games" sort={sort} setSort={setSort} style={{ width: 110 }}>
                    Games
                  </SortableTh>
                  <SortableTh
                    sortKey="results"
                    sort={sort}
                    setSort={setSort}
                    style={{ width: 150 }}
                  >
                    Results
                  </SortableTh>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pieces.length === 0 && !isLoading ? (
                  <Table.Tr>
                    <Table.Td colSpan={engineStrengthEnabled ? 6 : 5}>
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
                      fen={debouncedFen}
                      sourceLabel={coachSourceLabel}
                      totalGames={planData?.total_games ?? 0}
                      sampledGames={planData?.sampled_games ?? 0}
                      drawLine={drawLine}
                      previewLine={setPreviewLine}
                      engineStrengthEnabled={engineStrengthEnabled}
                      engineReport={visibleEngineReport}
                      engineRunning={waitingForFirstEngineReport}
                      resultPerspective={resultPerspective}
                      strength={getPieceStrength(piece, planStrengthByKey)}
                    />
                  ))
                )}
              </Table.Tbody>
            </>
          ) : (
            <>
              <Table.Thead>
                <Table.Tr>
                  <SortableTh sortKey="piece" sort={sort} setSort={setSort} style={{ width: 170 }}>
                    Setup
                  </SortableTh>
                  <SortableTh sortKey="blend" sort={sort} setSort={setSort} style={{ width: 120 }}>
                    Blend
                  </SortableTh>
                  {engineStrengthEnabled && (
                    <SortableTh
                      sortKey="engine"
                      sort={sort}
                      setSort={setSort}
                      style={{ width: 130 }}
                    >
                      Engine
                    </SortableTh>
                  )}
                  <SortableTh sortKey="routes" sort={sort} setSort={setSort}>
                    Plans
                  </SortableTh>
                  <SortableTh sortKey="games" sort={sort} setSort={setSort} style={{ width: 110 }}>
                    Games
                  </SortableTh>
                  <SortableTh
                    sortKey="results"
                    sort={sort}
                    setSort={setSort}
                    style={{ width: 150 }}
                  >
                    Results
                  </SortableTh>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {setups.length === 0 && !isLoading ? (
                  <Table.Tr>
                    <Table.Td colSpan={engineStrengthEnabled ? 6 : 5}>
                      <Text ta="center" c="dimmed" py="lg">
                        {sideFilter === "all"
                          ? "No recurring setups found in the sampled continuations."
                          : `No ${sideFilter} setup rows found. Switch to All to see every setup side.`}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  setups.map((setup) => (
                    <SetupRow
                      key={planSetupKey(setup)}
                      setup={setup}
                      fen={debouncedFen}
                      sourceLabel={coachSourceLabel}
                      totalGames={planData?.total_games ?? 0}
                      sampledGames={planData?.sampled_games ?? 0}
                      drawLines={drawLines}
                      previewLine={setPreviewLine}
                      engineStrengthEnabled={engineStrengthEnabled}
                      engineReport={visibleEngineReport}
                      engineRunning={waitingForFirstEngineReport}
                      resultPerspective={resultPerspective}
                      sideFilter={sideFilter}
                      strength={setupStrengthByKey.get(planSetupKey(setup))}
                    />
                  ))
                )}
              </Table.Tbody>
            </>
          )}
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
                  onColorChange={handleLocalColorChange}
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
            value={view}
            onChange={(value) => setView(value as PlanExplorerView)}
            data={[
              { label: "Plans", value: "plans" },
              { label: "Setups", value: "setups" },
            ]}
          />
          <SegmentedControl
            size="sm"
            value={sideFilter}
            onChange={(value) => setSideFilter(value as SideFilter)}
            data={sideFilterOptions(view, setupSideCounts)}
          />
          <Tooltip label="Tune blended strength for plan and setup rows">
            <Box>
              <MoveStrengthSettingsButton size="lg" />
            </Box>
          </Tooltip>
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

      {visibleError && (
        <Alert color="red" variant="light">
          {String(visibleError)}
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
  data: ReturnType<typeof getDatabaseSelectData>;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const selectedLabel =
    data.flatMap((group) => group.items).find((item) => item.value === value)?.label ??
    "Reference database";
  const widthCh = Math.min(Math.max(selectedLabel.length + 4, 18), 34);

  return (
    <DatabaseFolderSelect
      data={data}
      value={value}
      onChange={async (next) => {
        await commands.clearGames();
        onChange(next);
      }}
      placeholder="Reference database"
      size="sm"
      width={`${widthCh}ch`}
      minWidth={180}
      maxWidth="100%"
      allowDeselect={false}
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
  strengthByKey: Map<string, PlanStrength>,
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
      case "blend":
        diff =
          (getPieceStrength(a, strengthByKey)?.score ?? -1) -
            (getPieceStrength(b, strengthByKey)?.score ?? -1) || a.total - b.total;
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

function sortPlanSetups(
  setups: PlanExplorerSetup[],
  sort: PlanSort,
  engineReport: EnginePlanReport | null,
  resultPerspective: DatabaseResultPerspective | null,
  strengthByKey: Map<string, PlanStrength>,
) {
  const direction = sort.direction === "asc" ? 1 : -1;

  return [...setups].sort((a, b) => {
    let diff = 0;
    switch (sort.key) {
      case "piece":
        diff =
          setupTitle(a).localeCompare(setupTitle(b)) ||
          planSetupKey(a).localeCompare(planSetupKey(b));
        break;
      case "routes":
        diff = a.plans.length - b.plans.length || a.games - b.games;
        break;
      case "games":
        diff = a.games - b.games;
        break;
      case "results":
        diff =
          getSetupResultScore(a, resultPerspective, "all", null) -
            getSetupResultScore(b, resultPerspective, "all", null) || a.games - b.games;
        break;
      case "blend":
        diff =
          (strengthByKey.get(planSetupKey(a))?.score ?? -1) -
            (strengthByKey.get(planSetupKey(b))?.score ?? -1) || a.games - b.games;
        break;
      case "engine":
        diff =
          getSetupEngineStrengthScore(a, engineReport) -
            getSetupEngineStrengthScore(b, engineReport) || a.games - b.games;
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

  return getLineResultScore(topLine, resultPerspective ?? toResultSide(piece.color));
}

function getLineResultScore(
  line: Pick<PlanExplorerLine, "white" | "draw" | "black">,
  color: string,
) {
  const total = line.white + line.draw + line.black;
  if (total <= 0) return 0;

  const wins = color === "black" ? line.black : line.white;
  return (wins + line.draw * 0.5) / total;
}

function buildPlanStrengthByKey(
  pieces: PlanExplorerPiece[],
  engineReport: EnginePlanReport | null,
  resultPerspective: DatabaseResultPerspective | null,
  strengthSettings: Partial<MoveStrengthSettings> | null | undefined,
) {
  const settings = normalizeMoveStrengthSettings(strengthSettings);
  const usingEngine = !!engineReport;
  const effectiveSettings = usingEngine ? settings : { ...settings, mode: "practical" as const };
  const candidates = pieces.flatMap((piece) =>
    piece.lines.map((line) => {
      const perspective = resultPerspective ?? piece.color;
      const games = line.white + line.draw + line.black;
      return {
        key: planLineKey(piece, line),
        piece,
        line,
        perspective,
        games,
        databaseScore:
          games > 0
            ? getPracticalWdlRate(
                { white: line.white, draw: line.draw, black: line.black },
                perspective === "black" ? "black" : "white",
              )
            : null,
        engineCpLoss: getPlanLineEngineCpLoss(piece, line, engineReport, effectiveSettings),
      };
    }),
  );
  const baselines = getStrengthBaselines(candidates);
  const engineSpread = getEngineScoreSpreadCp(
    candidates.map((candidate) =>
      candidate.engineCpLoss === null ? null : -candidate.engineCpLoss,
    ),
  );

  return new Map(
    candidates.map((candidate) => {
      const baseline = baselines.get(candidate.perspective);
      const databaseScore = getUsageAwarePracticalWdlRate({
        score: candidate.databaseScore,
        total: candidate.games,
        usageShare:
          baseline && baseline.totalGames > 0 ? candidate.games / baseline.totalGames : null,
        baseline: baseline?.average ?? null,
        mode: effectiveSettings.mode,
      });
      const databaseWdlLoss =
        databaseScore === null || baseline?.best === null || baseline?.best === undefined
          ? null
          : Math.max(0, baseline.best - databaseScore);
      const strength = evaluatePlanStrength({
        settings: effectiveSettings,
        usingEngine,
        engineCpLoss: candidate.engineCpLoss,
        databaseScore,
        databaseWdlLoss,
        engineScoreSpreadCp: engineSpread,
      });
      return [candidate.key, strength] as const;
    }),
  );
}

function buildSetupStrengthByKey(
  setups: PlanExplorerSetup[],
  engineReport: EnginePlanReport | null,
  resultPerspective: DatabaseResultPerspective | null,
  sideFilter: SideFilter,
  fen: string,
  strengthSettings: Partial<MoveStrengthSettings> | null | undefined,
) {
  const settings = normalizeMoveStrengthSettings(strengthSettings);
  const usingEngine = !!engineReport;
  const effectiveSettings = usingEngine ? settings : { ...settings, mode: "practical" as const };
  const candidates = setups.map((setup) => {
    const perspective = getSetupPerspective(setup, resultPerspective, sideFilter, fen);
    const games = setup.white + setup.draw + setup.black;
    return {
      key: planSetupKey(setup),
      setup,
      perspective,
      games,
      databaseScore:
        games > 0
          ? getPracticalWdlRate(
              { white: setup.white, draw: setup.draw, black: setup.black },
              perspective,
            )
          : null,
      engineCpLoss: getSetupEngineCpLoss(setup, engineReport, effectiveSettings),
    };
  });
  const baselines = getStrengthBaselines(candidates);
  const engineSpread = getEngineScoreSpreadCp(
    candidates.map((candidate) =>
      candidate.engineCpLoss === null ? null : -candidate.engineCpLoss,
    ),
  );

  return new Map(
    candidates.map((candidate) => {
      const baseline = baselines.get(candidate.perspective);
      const databaseScore = getUsageAwarePracticalWdlRate({
        score: candidate.databaseScore,
        total: candidate.games,
        usageShare:
          baseline && baseline.totalGames > 0 ? candidate.games / baseline.totalGames : null,
        baseline: baseline?.average ?? null,
        mode: effectiveSettings.mode,
      });
      const databaseWdlLoss =
        databaseScore === null || baseline?.best === null || baseline?.best === undefined
          ? null
          : Math.max(0, baseline.best - databaseScore);
      const strength = evaluatePlanStrength({
        settings: effectiveSettings,
        usingEngine,
        engineCpLoss: candidate.engineCpLoss,
        databaseScore,
        databaseWdlLoss,
        engineScoreSpreadCp: engineSpread,
      });
      return [candidate.key, strength] as const;
    }),
  );
}

function getStrengthBaselines<
  T extends { perspective: string; games: number; databaseScore: number | null },
>(candidates: T[]) {
  const grouped = new Map<
    string,
    { totalGames: number; weightedScore: number; best: number | null }
  >();
  for (const candidate of candidates) {
    const current = grouped.get(candidate.perspective) ?? {
      totalGames: 0,
      weightedScore: 0,
      best: null,
    };
    current.totalGames += candidate.games;
    if (candidate.databaseScore !== null) {
      current.weightedScore += candidate.databaseScore * candidate.games;
      current.best =
        current.best === null
          ? candidate.databaseScore
          : Math.max(current.best, candidate.databaseScore);
    }
    grouped.set(candidate.perspective, current);
  }

  return new Map(
    [...grouped.entries()].map(([perspective, value]) => [
      perspective,
      {
        totalGames: value.totalGames,
        average: value.totalGames > 0 ? value.weightedScore / value.totalGames : 0.5,
        best: value.best,
      },
    ]),
  );
}

function evaluatePlanStrength({
  settings,
  usingEngine,
  engineCpLoss,
  databaseScore,
  databaseWdlLoss,
  engineScoreSpreadCp,
}: {
  settings: MoveStrengthSettings;
  usingEngine: boolean;
  engineCpLoss: number | null;
  databaseScore: number | null;
  databaseWdlLoss: number | null;
  engineScoreSpreadCp: number | null;
}) {
  const blended = evaluateMoveStrength({
    settings,
    engineCpLoss,
    hasEngineMoves: usingEngine,
    databaseWdlLoss,
    engineScoreSpreadCp,
  });

  return {
    score: blended.score,
    loss: blended.loss,
    label: blended.score.toString(),
    databaseScore,
    databaseWdlLoss,
    engineCpLoss: usingEngine ? engineCpLoss : null,
    engineUnsafe: blended.engineUnsafe,
    usingEngine,
    detail: formatPlanStrengthDetail({
      settings,
      usingEngine,
      engineCpLoss: usingEngine ? engineCpLoss : null,
      databaseScore,
      databaseWdlLoss,
      engineUnsafe: blended.engineUnsafe,
      score: blended.score,
    }),
  };
}

function getPlanLineEngineCpLoss(
  piece: Pick<PlanExplorerPiece, "color" | "role">,
  line: PlanExplorerLine,
  engineReport: EnginePlanReport | null,
  settings: MoveStrengthSettings,
) {
  const match = getPlanExplorerLineEnginePlan(piece, line, engineReport);
  return getEnginePlanCpLoss(match?.plan ?? null, settings);
}

function getSetupEngineCpLoss(
  setup: PlanExplorerSetup,
  engineReport: EnginePlanReport | null,
  settings: MoveStrengthSettings,
) {
  if (!engineReport) return null;

  const losses = setup.plans.map((plan) =>
    getPlanLineEngineCpLoss(plan, plan.line, engineReport, settings),
  );
  const finiteLosses = losses.filter((loss): loss is number => typeof loss === "number");
  if (finiteLosses.length === 0) return null;
  const average = finiteLosses.reduce((sum, loss) => sum + loss, 0) / finiteLosses.length;
  const worst = Math.max(...finiteLosses);

  return average * 0.45 + worst * 0.55;
}

function getEnginePlanCpLoss(plan: EnginePlan | null, settings: MoveStrengthSettings) {
  if (!plan) return null;

  const maxLoss = Math.max(1, settings.maxEngineCpLoss);
  const approvalLoss = (() => {
    switch (plan.approval) {
      case "Strong":
        return plan.appearsInTopPv ? 0 : maxLoss * 0.12;
      case "OK":
        return maxLoss * 0.38;
      case "Unclear":
        return maxLoss * 0.72;
      case "Weak":
        return maxLoss * 1.15;
    }
  })();
  const confidencePenalty =
    plan.confidence === "High" ? 0 : plan.confidence === "Medium" ? maxLoss * 0.08 : maxLoss * 0.16;
  const supportBonus = Math.min(
    maxLoss * 0.18,
    Math.max(0, plan.supportCount - 1) * maxLoss * 0.05,
  );

  return Math.max(0, approvalLoss + confidencePenalty - supportBonus);
}

function getPieceStrength(piece: PlanExplorerPiece, strengthByKey: Map<string, PlanStrength>) {
  const topLine = piece.lines[0];
  if (!topLine) return null;
  return strengthByKey.get(planLineKey(piece, topLine)) ?? null;
}

function planLineKey(
  piece: Pick<PlanExplorerPiece, "color" | "role" | "from">,
  line: PlanExplorerLine,
) {
  return `${piece.color}|${piece.role}|${piece.from}|${line.squares.join("-")}`;
}

function planSetupKey(setup: PlanExplorerSetup) {
  return setup.plans.map((plan) => planLineKey(plan, plan.line)).join("||");
}

function setupSide(setup: PlanExplorerSetup): "white" | "black" | null {
  const colors = new Set(setup.plans.map((plan) => plan.color));
  if (colors.size !== 1) return null;

  const color = setup.plans[0]?.color;
  return color === "white" || color === "black" ? color : null;
}

function countSetupSides(setups: PlanExplorerSetup[]) {
  return setups.reduce(
    (counts, setup) => {
      const side = setupSide(setup);
      if (side) counts[side] += 1;
      return counts;
    },
    { white: 0, black: 0 },
  );
}

function sideFilterOptions(
  view: PlanExplorerView,
  setupSideCounts: ReturnType<typeof countSetupSides>,
) {
  if (view !== "setups") {
    return [
      { label: "All", value: "all" },
      { label: "White", value: "white" },
      { label: "Black", value: "black" },
    ];
  }

  const total = setupSideCounts.white + setupSideCounts.black;
  return [
    { label: `All ${total}`, value: "all" },
    { label: `White ${setupSideCounts.white}`, value: "white" },
    { label: `Black ${setupSideCounts.black}`, value: "black" },
  ];
}

function getSetupPerspective(
  setup: PlanExplorerSetup,
  resultPerspective: DatabaseResultPerspective | null,
  sideFilter: SideFilter,
  fen: string | null,
): "white" | "black" {
  if (resultPerspective === "white" || resultPerspective === "black") return resultPerspective;
  if (sideFilter === "white" || sideFilter === "black") return sideFilter;

  const setupColor = setupSide(setup);
  if (setupColor) return setupColor;

  return fen?.split(" ")[1] === "b" ? "black" : "white";
}

function toResultSide(color: string): "white" | "black" {
  return color === "black" ? "black" : "white";
}

function getSetupResultScore(
  setup: PlanExplorerSetup,
  resultPerspective: DatabaseResultPerspective | null,
  sideFilter: SideFilter,
  fen: string | null,
) {
  return getLineResultScore(setup, getSetupPerspective(setup, resultPerspective, sideFilter, fen));
}

function formatPlanStrengthDetail({
  settings,
  usingEngine,
  engineCpLoss,
  databaseScore,
  databaseWdlLoss,
  engineUnsafe,
  score,
}: {
  settings: MoveStrengthSettings;
  usingEngine: boolean;
  engineCpLoss: number | null;
  databaseScore: number | null;
  databaseWdlLoss: number | null;
  engineUnsafe: boolean;
  score: number;
}) {
  const parts = [`Blended strength ${score}`];
  parts.push(
    usingEngine
      ? `${formatMoveStrengthMode(settings.mode)} mode, ${settings.engineWeight}% engine blend, max ${settings.maxEngineCpLoss} cp drop`
      : "Practical WDL only until engine strength is available",
  );
  if (usingEngine) {
    parts.push(
      engineCpLoss === null
        ? "No matching engine plan"
        : `${Math.round(engineCpLoss)} cp-equivalent behind the matched engine plan best`,
    );
  }
  if (databaseScore === null) {
    parts.push("WDL unavailable");
  } else {
    const scoreText = formatPercent(databaseScore);
    parts.push(
      databaseWdlLoss !== null && databaseWdlLoss > 0
        ? `WDL ${formatWdlPointLoss(databaseWdlLoss)} pts behind the best comparable row (${scoreText})`
        : `WDL best comparable row (${scoreText})`,
    );
  }
  if (engineUnsafe) {
    parts.push("Over the configured CP-drop limit");
  }
  return parts.join(". ");
}

function formatMoveStrengthMode(mode: "smart" | "engine" | "practical") {
  switch (mode) {
    case "smart":
      return "Smart";
    case "engine":
      return "Engine";
    case "practical":
      return "Practical";
  }
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

function formatWdlPointLoss(value: number) {
  return (value * 100).toFixed(1).replace(/\.0$/, "");
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

function getSetupEngineMatches(
  setup: PlanExplorerSetup,
  engineReport: EnginePlanReport | null,
): PlanExplorerEnginePlanMatch[] {
  return setup.plans
    .map((plan) => getPlanExplorerLineEnginePlan(plan, plan.line, engineReport))
    .filter((match): match is PlanExplorerEnginePlanMatch => !!match);
}

function getSetupEngineStrengthScore(
  setup: PlanExplorerSetup,
  engineReport: EnginePlanReport | null,
) {
  const matches = getSetupEngineMatches(setup, engineReport);
  if (matches.length === 0) return -1;

  const average =
    matches.reduce((sum, match) => sum + enginePlanStrengthScore(match.plan), 0) / matches.length;
  const coverage = matches.length / Math.max(1, setup.plans.length);

  return average + coverage * 10_000;
}

function getDatabaseSetupVerdict({
  setup,
  sampledGames,
  engineStrengthEnabled,
  engineReport,
  engineRunning,
  engineMatches,
  strength,
}: {
  setup: PlanExplorerSetup;
  sampledGames: number;
  engineStrengthEnabled: boolean;
  engineReport: EnginePlanReport | null;
  engineRunning: boolean;
  engineMatches: PlanExplorerEnginePlanMatch[];
  strength: PlanStrength | null;
}): SetupVerdict {
  const components = setup.plans.length;
  const structuralComponents = setup.plans.filter(isSetupStructuralPlan).length;
  const anchorComponents = setup.plans.filter(isSetupAnchorComponent).length;
  const strictMatches = engineMatches.filter(isStrictSetupEngineMatch).length;
  const looseMatches = engineMatches.length;
  const strictCoverage = strictMatches / Math.max(1, components);
  const looseCoverage = looseMatches / Math.max(1, components);
  const sampleShare = sampledGames > 0 ? setup.games / sampledGames : null;
  const sampleDetail =
    sampleShare === null ? null : `${formatPercent(sampleShare)} of sampled continuations`;

  if (engineStrengthEnabled && engineRunning && !engineReport) {
    return {
      label: "Checking",
      color: "gray",
      detail: "Engine setup safety is still being checked.",
    };
  }

  if (engineStrengthEnabled && engineReport) {
    if (strength?.engineUnsafe) {
      return {
        label: "Engine risk",
        color: "yellow",
        detail: [
          "The observed setup has at least one component over the configured engine safety limit.",
          `${strictMatches}/${components} components have strict engine matches.`,
          sampleDetail,
        ]
          .filter((part): part is string => !!part)
          .join(" "),
      };
    }

    if (
      components >= 3 &&
      structuralComponents > 0 &&
      anchorComponents > 0 &&
      strictCoverage >= 0.67
    ) {
      return {
        label: "Verified setup",
        color: "teal",
        detail: [
          "A coherent database setup with structural and development evidence matches the engine plan directly.",
          `${strictMatches}/${components} components are strict matches.`,
          sampleDetail,
        ]
          .filter((part): part is string => !!part)
          .join(" "),
      };
    }

    if (looseCoverage >= 0.5) {
      return {
        label: "Loose match",
        color: "blue",
        detail: [
          "Some components overlap engine plans, but the whole setup is not directly verified.",
          `${looseMatches}/${components} components match, ${strictMatches} strictly.`,
          sampleDetail,
        ]
          .filter((part): part is string => !!part)
          .join(" "),
      };
    }

    return {
      label: "Observed only",
      color: "gray",
      detail: [
        "This setup appears in the database sample, but the current engine report does not verify it as a setup.",
        sampleDetail,
      ]
        .filter((part): part is string => !!part)
        .join(" "),
    };
  }

  if (components >= 3 && structuralComponents > 0 && anchorComponents > 0) {
    return {
      label: "Observed setup",
      color: "blue",
      detail: [
        "A coherent structure-plus-development pattern found in the sampled games.",
        "Run engine strength before treating it as a recommendation.",
        sampleDetail,
      ]
        .filter((part): part is string => !!part)
        .join(" "),
    };
  }

  return {
    label: "Loose pattern",
    color: "gray",
    detail: [
      "This row has limited setup evidence and should be treated as a pattern, not a recommendation.",
      sampleDetail,
    ]
      .filter((part): part is string => !!part)
      .join(" "),
  };
}

function isStrictSetupEngineMatch(match: PlanExplorerEnginePlanMatch) {
  return (
    match.match === "route" ||
    match.match === "routePrefix" ||
    match.match === "pawnSetup" ||
    match.match === "castling"
  );
}

function isSetupStructuralPlan(plan: PlanExplorerSetupPlan) {
  return plan.role === "pawn";
}

function isSetupAnchorComponent(plan: PlanExplorerSetupPlan) {
  return (
    plan.role === "knight" ||
    plan.role === "bishop" ||
    (plan.role === "king" &&
      plan.line.san.some((san) => san.startsWith("O-O") || san.startsWith("0-0")))
  );
}

function setupPlanToColoredLine(plan: PlanExplorerSetupPlan): ColoredPlanExplorerLine {
  return withPlanLineColor(plan.line, plan.color);
}

function setupTitle(setup: PlanExplorerSetup) {
  const color = setup.plans[0]?.color;
  const singleColor = color && setup.plans.every((plan) => plan.color === color);
  const side = singleColor ? `${capitalize(color)} ` : "";
  return `${side}setup (${setup.plans.length} plans)`;
}

function buildPiecePlanCoachRequest({
  piece,
  fen,
  sourceLabel,
  totalGames,
  sampledGames,
  resultPerspective,
  strength,
  engineStrengthEnabled,
  engineReport,
  engineRunning,
  engineMatch,
}: {
  piece: PlanExplorerPiece;
  fen: string;
  sourceLabel: string;
  totalGames: number;
  sampledGames: number;
  resultPerspective: DatabaseResultPerspective | null;
  strength: PlanStrength | null;
  engineStrengthEnabled: boolean;
  engineReport: EnginePlanReport | null;
  engineRunning: boolean;
  engineMatch: PlanExplorerEnginePlanMatch | null;
}): PlanCoachInlineRequest {
  const perspective = resultPerspective ?? toResultSide(piece.color);
  const title = `${capitalize(piece.color)} ${piece.role} plan from ${piece.from}`;
  const planLines = piece.lines.slice(0, 6).map((line, index) => {
    const match = engineStrengthEnabled
      ? getPlanExplorerLineEnginePlan(piece, line, engineReport)
      : null;
    return [
      `${index + 1}. ${formatPlanPieceRoute(piece, line)}`,
      `${formatNumber(line.games)} games`,
      formatPlanCoachResult(line, perspective),
      match ? formatEngineMatchForCoach(match, engineReport) : null,
    ]
      .filter((part): part is string => !!part)
      .join("; ");
  });

  return {
    fen,
    sideToMove: sideToMoveLabel(fen),
    surface: "Plan Explorer",
    subjectKind: "plan",
    title,
    summary: `${summaryWithNamedSetupCue(summarizePlanPiece(piece))} Explain the route family as a practical plan for ${piece.color}.`,
    planLines,
    stats: [
      `Source: ${sourceLabel}`,
      `Position: ${sideToMoveLabel(fen)} to move`,
      `Matches: ${formatPlanCoachMatchCount(totalGames, sampledGames)}`,
      `Piece route games: ${formatNumber(piece.total)}`,
      `Result perspective: ${capitalize(perspective)}`,
      strength
        ? `Blended strength: ${strength.label}. ${strength.detail}`
        : "Blended strength: unavailable",
      formatPlanCoachEngineStatus(engineStrengthEnabled, engineRunning, engineReport),
      engineMatch
        ? `Best engine match: ${formatEngineMatchForCoach(engineMatch, engineReport)}`
        : null,
    ].filter((item): item is string => !!item),
    evidence: [
      ...piece.lines
        .slice(0, 4)
        .map(
          (line) =>
            `Database route ${formatPlanPieceRoute(piece, line)}: ${formatPlanCoachResult(line, perspective)} from ${formatNumber(line.games)} games.`,
        ),
      ...(engineMatch ? formatEnginePlanEvidenceForCoach(engineMatch.plan) : []),
    ],
  };
}

function buildSetupPlanCoachRequest({
  setup,
  fen,
  sourceLabel,
  totalGames,
  sampledGames,
  perspective,
  strength,
  engineStrengthEnabled,
  engineReport,
  engineRunning,
  engineMatches,
  verdict,
}: {
  setup: PlanExplorerSetup;
  fen: string;
  sourceLabel: string;
  totalGames: number;
  sampledGames: number;
  perspective: DatabaseResultPerspective;
  strength: PlanStrength | null;
  engineStrengthEnabled: boolean;
  engineReport: EnginePlanReport | null;
  engineRunning: boolean;
  engineMatches: PlanExplorerEnginePlanMatch[];
  verdict: SetupVerdict;
}): PlanCoachInlineRequest {
  const title = setupTitle(setup);
  const setupRoutes = setup.plans.map((plan) => formatPlanPieceRoute(plan, plan.line));
  const strongestMatch = engineMatches
    .slice()
    .sort((a, b) => enginePlanStrengthScore(b.plan) - enginePlanStrengthScore(a.plan))[0];

  return {
    fen,
    sideToMove: sideToMoveLabel(fen),
    surface: "Plan Explorer",
    subjectKind: "setup",
    title,
    summary: `${title}: coordinated routes ${setupRoutes.join(", ")}. Consider whether this matches a named chess setup or structure, but only name one when the routes and position justify it.`,
    planLines: setup.plans.slice(0, 8).map((plan, index) => {
      const match = engineStrengthEnabled
        ? getPlanExplorerLineEnginePlan(plan, plan.line, engineReport)
        : null;
      return [
        `${index + 1}. ${capitalize(plan.color)} ${plan.role} from ${plan.from}: ${formatPlanPieceRoute(plan, plan.line)}`,
        `${formatNumber(plan.line.games)} games`,
        formatPlanCoachResult(plan.line, perspective),
        match ? formatEngineMatchForCoach(match, engineReport) : null,
      ]
        .filter((part): part is string => !!part)
        .join("; ");
    }),
    stats: [
      `Source: ${sourceLabel}`,
      `Position: ${sideToMoveLabel(fen)} to move`,
      `Matches: ${formatPlanCoachMatchCount(totalGames, sampledGames)}`,
      `Setup games: ${formatNumber(setup.games)}`,
      `Setup result: ${formatPlanCoachResult(setup, perspective)}`,
      `Result perspective: ${capitalize(perspective)}`,
      `Setup verdict: ${verdict.label}. ${verdict.detail}`,
      strength
        ? `Blended strength: ${strength.label}. ${strength.detail}`
        : "Blended strength: unavailable",
      formatPlanCoachEngineStatus(engineStrengthEnabled, engineRunning, engineReport),
      engineStrengthEnabled
        ? `Engine coverage: ${engineMatches.length}/${setup.plans.length} routes matched engine plans.`
        : null,
      strongestMatch
        ? `Strongest engine match: ${formatEngineMatchForCoach(strongestMatch, engineReport)}`
        : null,
    ].filter((item): item is string => !!item),
    evidence: [
      ...setup.plans
        .slice(0, 6)
        .map(
          (plan) =>
            `Database setup route ${capitalize(plan.color)} ${plan.role} ${plan.from}: ${formatPlanPieceRoute(plan, plan.line)}; ${formatPlanCoachResult(plan.line, perspective)} from ${formatNumber(plan.line.games)} games.`,
        ),
      ...engineMatches.flatMap((match) => formatEnginePlanEvidenceForCoach(match.plan).slice(0, 2)),
    ],
  };
}

function planExplorerCoachSourceLabel({
  source,
  referenceDatabase,
  localOptions,
}: {
  source: PlanExplorerSource;
  referenceDatabase: string | null;
  localOptions: LocalOptions;
}) {
  if (source === "lch_all") return "Lichess All explorer";
  if (source === "lch_master") return "Lichess Masters explorer";

  const filters = [
    localOptions.type === "partial" ? "partial position" : "exact position",
    localOptions.playerName
      ? `player ${localOptions.playerName}`
      : localOptions.player
        ? `player id ${localOptions.player}`
        : null,
    `as ${localOptions.color}`,
    localOptions.start_date ? `from ${localOptions.start_date}` : null,
    localOptions.end_date ? `to ${localOptions.end_date}` : null,
    localOptions.result !== "any" ? `result ${formatLocalResultFilter(localOptions.result)}` : null,
  ].filter((item): item is string => !!item);
  const databaseName = referenceDatabase ? pathFileName(referenceDatabase) : "no database selected";
  return `Local database ${databaseName}; filters: ${filters.join(", ")}`;
}

function isExpectedPlanExplorerCancellation(error: unknown) {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return message === "Request canceled" || message === "Search stopped";
}

function formatLocalResultFilter(result: LocalOptions["result"]) {
  switch (result) {
    case "whitewon":
      return "white won";
    case "blackwon":
      return "black won";
    case "draw":
      return "draw";
    case "any":
      return "any";
  }
}

function pathFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function sideToMoveLabel(fen: string) {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

function formatPlanCoachMatchCount(totalGames: number, sampledGames: number) {
  if (sampledGames > 0 && sampledGames < totalGames) {
    return `${formatNumber(totalGames)} total, ${formatNumber(sampledGames)} sampled`;
  }
  return formatNumber(totalGames);
}

function formatPlanCoachResult(
  line: Pick<PlanExplorerLine, "white" | "draw" | "black">,
  perspective: DatabaseResultPerspective,
) {
  const total = line.white + line.draw + line.black;
  if (total <= 0) return "WDL unavailable";
  return `WDL ${formatNumber(line.white)}-${formatNumber(line.draw)}-${formatNumber(line.black)}, ${formatPercent(getLineResultScore(line, perspective))} score for ${perspective}`;
}

function formatPlanCoachEngineStatus(
  enabled: boolean,
  running: boolean,
  report: EnginePlanReport | null,
) {
  if (!enabled) return "Engine strength: off";
  if (report) return `Engine strength: ${report.limitLabel}, ${report.totalPvs} PVs`;
  return running ? "Engine strength: running" : "Engine strength: no report loaded";
}

function formatEngineMatchForCoach(
  match: PlanExplorerEnginePlanMatch,
  report: EnginePlanReport | null,
) {
  const totalPvs = report?.totalPvs ?? match.plan.supportCount;
  return `${match.plan.label}: ${match.plan.approval}, ${match.plan.confidence} confidence, ${match.plan.supportCount}/${totalPvs} PV support, ${formatEngineCoachEval(match.plan.weightedEvalCp)}, match ${match.match}`;
}

function formatEnginePlanEvidenceForCoach(plan: EnginePlan) {
  return [
    `Engine plan summary: ${plan.label}. ${plan.approval}, ${plan.confidence} confidence, ${formatEngineCoachEval(plan.weightedEvalCp)}. ${plan.explanation}`,
    ...plan.evidence.slice(0, 3).map((line) => {
      const san = line.sanMoves.slice(0, 10).join(" ");
      return `Engine PV${line.rank}: ${formatScoreValue(line.score.value)}, depth ${line.depth}, first move ${line.firstMove || "-"}, line ${san || "-"}.`;
    }),
  ];
}

function formatEngineCoachEval(evalCp: number | null) {
  return evalCp === null ? "eval unavailable" : `weighted eval ${formatEvalCp(evalCp)}`;
}

function summaryWithNamedSetupCue(summary: string) {
  return `${summary} If the route resembles a known setup or structure, name it only when the position and route evidence support that label.`;
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
  fen,
  sourceLabel,
  totalGames,
  sampledGames,
  drawLine,
  previewLine,
  engineStrengthEnabled,
  engineReport,
  engineRunning,
  resultPerspective,
  strength,
}: {
  piece: PlanExplorerPiece;
  fen: string;
  sourceLabel: string;
  totalGames: number;
  sampledGames: number;
  drawLine: (line: ColoredPlanExplorerLine) => void;
  previewLine: (line: ColoredPlanExplorerLine | null) => void;
  engineStrengthEnabled: boolean;
  engineReport: EnginePlanReport | null;
  engineRunning: boolean;
  resultPerspective: DatabaseResultPerspective | null;
  strength: PlanStrength | null;
}) {
  const topLine = piece.lines[0] ? withPlanLineColor(piece.lines[0], piece.color) : null;
  const summary = summarizePlanPiece(piece);
  const engineMatch = useMemo(
    () => getPieceEngineMatch(piece, engineReport),
    [engineReport, piece],
  );
  const coachRequest = useMemo(
    () =>
      buildPiecePlanCoachRequest({
        piece,
        fen,
        sourceLabel,
        totalGames,
        sampledGames,
        resultPerspective,
        strength,
        engineStrengthEnabled,
        engineReport,
        engineRunning,
        engineMatch,
      }),
    [
      engineMatch,
      engineReport,
      engineRunning,
      engineStrengthEnabled,
      fen,
      piece,
      resultPerspective,
      sampledGames,
      sourceLabel,
      strength,
      totalGames,
    ],
  );
  const coachCacheKey = useMemo(
    () =>
      [
        "plan-explorer-piece",
        fen,
        sourceLabel,
        piece.color,
        piece.role,
        piece.from,
        piece.total,
        piece.lines.map((line) => line.squares.join("-")).join(","),
        strength?.score ?? "no-strength",
        engineMatch?.plan.signature ?? "no-engine",
      ].join("|"),
    [engineMatch, fen, piece, sourceLabel, strength],
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
            <Text size="xs" c="dimmed" lineClamp={2}>
              {summary}
            </Text>
          </Box>
        </Group>
      </Table.Td>
      <Table.Td>
        <PlanStrengthCell strength={strength} />
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
                  {formatPlanPieceRoute(piece, line)}
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
          <PlanCoachInline request={coachRequest} cacheKey={coachCacheKey} />
        </Stack>
      </Table.Td>
      <Table.Td>
        <Badge variant="light">{formatNumber(piece.total)}</Badge>
      </Table.Td>
      <Table.Td>
        {topLine && (
          <ResultBar line={topLine} perspective={resultPerspective ?? toResultSide(piece.color)} />
        )}
      </Table.Td>
    </Table.Tr>
  );
}

function SetupRow({
  setup,
  fen,
  sourceLabel,
  totalGames,
  sampledGames,
  drawLines,
  previewLine,
  engineStrengthEnabled,
  engineReport,
  engineRunning,
  resultPerspective,
  sideFilter,
  strength,
}: {
  setup: PlanExplorerSetup;
  fen: string;
  sourceLabel: string;
  totalGames: number;
  sampledGames: number;
  drawLines: (lines: ColoredPlanExplorerLine[]) => void;
  previewLine: (line: ColoredPlanExplorerLine | ColoredPlanExplorerLine[] | null) => void;
  engineStrengthEnabled: boolean;
  engineReport: EnginePlanReport | null;
  engineRunning: boolean;
  resultPerspective: DatabaseResultPerspective | null;
  sideFilter: SideFilter;
  strength: PlanStrength | undefined;
}) {
  const lines = useMemo(() => setup.plans.map(setupPlanToColoredLine), [setup.plans]);
  const perspective = getSetupPerspective(setup, resultPerspective, sideFilter, fen);
  const engineMatches = useMemo(
    () => getSetupEngineMatches(setup, engineReport),
    [engineReport, setup],
  );
  const verdict = useMemo(
    () =>
      getDatabaseSetupVerdict({
        setup,
        sampledGames,
        engineStrengthEnabled,
        engineReport,
        engineRunning,
        engineMatches,
        strength: strength ?? null,
      }),
    [
      engineMatches,
      engineReport,
      engineRunning,
      engineStrengthEnabled,
      sampledGames,
      setup,
      strength,
    ],
  );
  const coachRequest = useMemo(
    () =>
      buildSetupPlanCoachRequest({
        setup,
        fen,
        sourceLabel,
        totalGames,
        sampledGames,
        perspective,
        strength: strength ?? null,
        engineStrengthEnabled,
        engineReport,
        engineRunning,
        engineMatches,
        verdict,
      }),
    [
      engineMatches,
      engineReport,
      engineRunning,
      engineStrengthEnabled,
      fen,
      perspective,
      sampledGames,
      setup,
      sourceLabel,
      strength,
      totalGames,
      verdict,
    ],
  );
  const coachCacheKey = useMemo(
    () =>
      [
        "plan-explorer-setup",
        fen,
        sourceLabel,
        planSetupKey(setup),
        setup.games,
        strength?.score ?? "no-strength",
        engineMatches.map((match) => match.plan.signature).join(",") || "no-engine",
      ].join("|"),
    [engineMatches, fen, setup, sourceLabel, strength],
  );

  return (
    <Table.Tr
      onMouseEnter={() => lines.length > 0 && previewLine(lines)}
      onMouseLeave={() => previewLine(null)}
      onClick={() => drawLines(lines)}
      style={{ cursor: lines.length > 0 ? "pointer" : "default" }}
    >
      <Table.Td>
        <Stack gap={2}>
          <Group gap="xs" wrap="wrap">
            <Text size="sm" fw={700}>
              {setupTitle(setup)}
            </Text>
            <Tooltip label={verdict.detail} multiline w={300} withArrow>
              <Badge size="xs" color={verdict.color} variant="light">
                {verdict.label}
              </Badge>
            </Tooltip>
          </Group>
          <Text size="xs" c="dimmed">
            WDL for {capitalize(perspective)}
          </Text>
        </Stack>
      </Table.Td>
      <Table.Td>
        <PlanStrengthCell strength={strength ?? null} />
      </Table.Td>
      {engineStrengthEnabled && (
        <Table.Td>
          <SetupEngineStrengthCell
            setup={setup}
            engineReport={engineReport}
            running={engineRunning}
          />
        </Table.Td>
      )}
      <Table.Td>
        <Stack gap={4}>
          {setup.plans.map((plan) => {
            const line = setupPlanToColoredLine(plan);
            const match = engineStrengthEnabled
              ? getPlanExplorerLineEnginePlan(plan, plan.line, engineReport)
              : null;

            return (
              <Group key={planLineKey(plan, plan.line)} gap="xs" wrap="nowrap">
                <Tooltip label="Draw route">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    onClick={(event) => {
                      event.stopPropagation();
                      drawLines([line]);
                    }}
                  >
                    <IconRoute size="1rem" />
                  </ActionIcon>
                </Tooltip>
                <Text size="sm" ff="monospace" truncate>
                  {formatPlanPieceRoute(plan, plan.line)}
                </Text>
                <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                  {capitalize(plan.role)} {plan.from}
                </Text>
                {match && (
                  <Badge size="xs" color={approvalColor(match.plan.approval)} variant="light">
                    {match.plan.approval}
                  </Badge>
                )}
              </Group>
            );
          })}
          <PlanCoachInline request={coachRequest} cacheKey={coachCacheKey} />
        </Stack>
      </Table.Td>
      <Table.Td>
        <Badge variant="light">{formatNumber(setup.games)}</Badge>
      </Table.Td>
      <Table.Td>
        <ResultBar line={setup} perspective={perspective} />
      </Table.Td>
    </Table.Tr>
  );
}

function PlanStrengthCell({ strength }: { strength: PlanStrength | null }) {
  if (!strength) {
    return (
      <Text size="xs" c="dimmed">
        -
      </Text>
    );
  }

  return (
    <Tooltip label={strength.detail} multiline w={300} withArrow>
      <Stack gap={3}>
        <Badge color={strength.engineUnsafe ? "yellow" : "teal"} variant="light">
          {strength.label}
        </Badge>
        <Progress
          value={strength.score}
          color={strength.engineUnsafe ? "yellow" : "teal"}
          size={3}
        />
      </Stack>
    </Tooltip>
  );
}

function SetupEngineStrengthCell({
  setup,
  engineReport,
  running,
}: {
  setup: PlanExplorerSetup;
  engineReport: EnginePlanReport | null;
  running: boolean;
}) {
  const matches = getSetupEngineMatches(setup, engineReport);
  if (matches.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        {running ? "Analyzing" : "No PV"}
      </Text>
    );
  }

  const strongest = matches
    .slice()
    .sort((a, b) => enginePlanStrengthScore(b.plan) - enginePlanStrengthScore(a.plan))[0];

  return (
    <Stack gap={2}>
      <Badge color={approvalColor(strongest.plan.approval)} variant="light">
        {strongest.plan.approval}
      </Badge>
      <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
        {matches.length}/{setup.plans.length} matched
      </Text>
    </Stack>
  );
}

function ResultBar({
  line,
  perspective,
}: {
  line: Pick<PlanExplorerLine, "white" | "draw" | "black">;
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

  const scoredSide = perspective === "black" ? "black" : "white";
  const opponentSide = scoredSide === "black" ? "white" : "black";
  const scoredWins = scoredSide === "black" ? line.black : line.white;
  const opponentWins = scoredSide === "black" ? line.white : line.black;
  const scoredPercent = (scoredWins / total) * 100;
  const drawPercent = (line.draw / total) * 100;
  const opponentPercent = (opponentWins / total) * 100;
  const showLabelThreshold = 10;
  const scoredSideLabel = capitalize(scoredSide);
  const opponentSideLabel = capitalize(opponentSide);

  return (
    <Tooltip
      withArrow
      label={`${scoredSideLabel} ${scoredPercent.toFixed(1)}% / Draw ${drawPercent.toFixed(
        1,
      )}% / ${opponentSideLabel} ${opponentPercent.toFixed(1)}%`}
    >
      <Progress.Root
        size="xl"
        className={resultClasses.result}
        aria-label={`WDL scored for ${scoredSideLabel}`}
      >
        <Progress.Section value={scoredPercent} {...resultSectionProps(scoredSide)}>
          <Progress.Label c={resultLabelColor(scoredSide)}>
            {scoredPercent > showLabelThreshold ? `${scoredPercent.toFixed(1)}%` : ""}
          </Progress.Label>
        </Progress.Section>
        <Progress.Section value={drawPercent} color="gray">
          <Progress.Label>
            {drawPercent > showLabelThreshold ? `${drawPercent.toFixed(1)}%` : ""}
          </Progress.Label>
        </Progress.Section>
        <Progress.Section value={opponentPercent} {...resultSectionProps(opponentSide)}>
          <Progress.Label c={resultLabelColor(opponentSide)}>
            {opponentPercent > showLabelThreshold ? `${opponentPercent.toFixed(1)}%` : ""}
          </Progress.Label>
        </Progress.Section>
      </Progress.Root>
    </Tooltip>
  );
}

function resultSectionProps(side: "white" | "black") {
  return side === "white" ? { className: resultClasses.whiteResultsSection } : { color: "black" };
}

function resultLabelColor(side: "white" | "black") {
  return side === "white" ? "black" : undefined;
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
