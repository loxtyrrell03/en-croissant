import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
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
import {
  IconChevronDown,
  IconChevronUp,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconRoute,
} from "@tabler/icons-react";
import {
  events,
  type BestMoves,
  type EngineOption,
  type GoMode,
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
import useSWR from "swr/immutable";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import MoveCell from "@/components/common/MoveCell";
import {
  activeTabAtom,
  currentBoardPreviewShapesAtom,
  currentEnginePlanExplorerDataAtom,
  currentEnginePlanReportAtom,
  currentPlanExplorerPreviewLineAtom,
  enginePlanDepthAtom,
  enginePlanLimitModeAtom,
  enginePlanMultipvAtom,
  enginePlanSideFilterAtom,
  enginePlanTimeMsAtom,
  enginePlanViewAtom,
  enginesAtom,
  lichessOptionsAtom,
  moveStrengthSettingsAtom,
  planExplorerArrowLimitAtom,
  sessionsAtom,
  showPlanExplorerArrowsAtom,
} from "@/state/atoms";
import {
  buildEnginePlanReport,
  categoryLabel,
  engineReportToPlanExplorerData,
  formatEvalCp,
  formatScoreValue,
  getPvMovePreviews,
  type EnginePlan,
  type EnginePlanMovePreview,
  type EnginePlanReport,
  type EnginePlanSetup,
} from "@/utils/enginePlanExplorer";
import {
  type EngineSettings,
  type LocalEngine,
  getBestMoves as getLocalBestMoves,
  stopEngine,
} from "@/utils/engines";
import {
  detectPlanCastling,
  isPlanBrush,
  planLineToShapes,
  planLinesToShapes,
  type ColoredPlanExplorerLine,
  type PlanExplorerSegment,
} from "@/utils/planExplorer";
import { getOnlinePlanExplorer } from "@/utils/lichess/planExplorer";
import {
  evaluateMoveStrength,
  getEngineScoreSpreadCp,
  getPracticalWdlRate,
  getUsageAwarePracticalWdlRate,
  normalizeMoveStrengthSettings,
  type MoveStrengthSettings,
} from "@/utils/moveStrength";
import { withLimitedRecordEntry } from "@/utils/boundedCache";
import { positionFromFen } from "@/utils/chessops";
import PlanCoachInline, { type PlanCoachInlineRequest } from "../plan/PlanCoachInline";

const MAX_ENGINE_PLAN_REPORT_CACHE_ENTRIES = 24;
const ENGINE_SETUP_PRACTICAL_MAX_PLIES = 8;

type ActiveRequest = {
  token: number;
  engine: LocalEngine;
  tab: string;
  fen: string;
  cacheKey: string;
  requestedMultipv: number;
  limitLabel: string;
};

type SortDirection = "asc" | "desc";
type EnginePlanSortKey = "plan" | "blend" | "strength" | "eval" | "confidence";
type EnginePlanSort = {
  key: EnginePlanSortKey;
  direction: SortDirection;
};
type EnginePlanSideFilter = "all" | "white" | "black";
type EnginePlanView = "plans" | "setups";
type EngineSetupPracticalMatch = {
  setup: PlanExplorerSetup;
  matchedComponents: number;
  totalComponents: number;
  rowComponents: number;
  anchorMatches: number;
};
type EngineSetupBlend = {
  score: number;
  label: string;
  detail: string;
  databaseScore: number | null;
  databaseWdlLoss: number | null;
  engineCpLoss: number | null;
  engineUnsafe: boolean;
  practical: EngineSetupPracticalMatch | null;
};
type EngineSetupVerdict = {
  label: string;
  color: string;
  detail: string;
};

function EnginePlanExplorerPanel() {
  const store = useContext(TreeStateContext)!;
  const fen = useStore(store, (s) => s.currentNode().fen);
  const currentNode = useStore(store, (s) => s.currentNode());
  const currentPosition = useStore(store, (s) => s.position);
  const setShapes = useStore(store, (s) => s.setShapes);
  const makeMoves = useStore(store, (s) => s.makeMoves);
  const goToMove = useStore(store, (s) => s.goToMove);
  const engines = useAtomValue(enginesAtom);
  const sessions = useAtomValue(sessionsAtom);
  const lichessOptions = useAtomValue(lichessOptionsAtom);
  const moveStrengthSettings = useAtomValue(moveStrengthSettingsAtom);
  const activeTab = useAtomValue(activeTabAtom);
  const setBoardPreviewShapes = useSetAtom(currentBoardPreviewShapesAtom);
  const setEnginePlanData = useSetAtom(currentEnginePlanExplorerDataAtom);
  const setPreviewLine = useSetAtom(currentPlanExplorerPreviewLineAtom);
  const [multipv, setMultipv] = useAtom(enginePlanMultipvAtom);
  const [limitMode, setLimitMode] = useAtom(enginePlanLimitModeAtom);
  const [depth, setDepth] = useAtom(enginePlanDepthAtom);
  const [timeMs, setTimeMs] = useAtom(enginePlanTimeMsAtom);
  const [sideFilter, setSideFilter] = useAtom(enginePlanSideFilterAtom);
  const [view, setView] = useAtom(enginePlanViewAtom);
  const [showPlanArrows, setShowPlanArrows] = useAtom(showPlanExplorerArrowsAtom);
  const [arrowLimit, setArrowLimit] = useAtom(planExplorerArrowLimitAtom);
  const [planState, setPlanState] = useAtom(currentEnginePlanReportAtom);
  const [engineId, setEngineId] = useState<string | null>(null);
  const [planSort, setPlanSort] = useState<EnginePlanSort>({
    key: "strength",
    direction: "desc",
  });
  const requestRef = useRef<ActiveRequest | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const pinnedPreviewRef = useRef(false);
  const returnPathRef = useRef<number[] | null>(null);
  const tokenRef = useRef(0);
  const { progress, running, error } = planState;
  const explorerToken = sessions.find((session) => session.lichess?.accessToken)?.lichess
    ?.accessToken;
  const lichessOptionsKey = JSON.stringify({
    ...lichessOptions,
    player: undefined,
  });

  const cleanupListener = useCallback(() => {
    unlistenRef.current?.();
    unlistenRef.current = null;
  }, []);

  const localEngines = useMemo(
    () => (engines ?? []).filter((engine): engine is LocalEngine => engine.type === "local"),
    [engines],
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

  useEffect(() => {
    pinnedPreviewRef.current = false;
    setPreviewLine(null);
    setBoardPreviewShapes(null);
    setEnginePlanData(null);

    const active = requestRef.current;
    if (active && active.fen !== fen) {
      requestRef.current = null;
      cleanupListener();
      void stopEngine(active.engine, active.tab);
      setPlanState((current) => ({
        ...current,
        progress: 0,
        running: false,
        activeRequestKey: null,
      }));
    }
  }, [
    cleanupListener,
    fen,
    setBoardPreviewShapes,
    setEnginePlanData,
    setPlanState,
    setPreviewLine,
  ]);

  useEffect(() => {
    return () => {
      cleanupListener();
      const active = requestRef.current;
      requestRef.current = null;
      if (active) {
        void stopEngine(active.engine, active.tab);
        setPlanState((current) => ({
          ...current,
          running: false,
          activeRequestKey: null,
        }));
      }
      setBoardPreviewShapes(null);
      setEnginePlanData(null);
      setPreviewLine(null);
    };
  }, [cleanupListener, setBoardPreviewShapes, setEnginePlanData, setPlanState, setPreviewLine]);

  const selectedEngine = useMemo(
    () => localEngines.find((engine) => engine.id === engineId) ?? localEngines[0] ?? null,
    [engineId, localEngines],
  );

  const clampedMultipv = clampNumber(multipv, 1, 10);
  const clampedDepth = clampNumber(depth, 1, 40);
  const clampedTimeMs = clampNumber(timeMs, 250, 30000);
  const movablePieceCount = useMemo(() => countMovablePieces(fen), [fen]);
  const analysisMultipv = Math.max(clampedMultipv, movablePieceCount);
  const limitLabel = limitMode === "depth" ? `Depth ${clampedDepth}` : `${clampedTimeMs} ms`;
  const analysisCacheKey = useMemo(() => {
    if (!selectedEngine) return "";
    return [
      fen,
      selectedEngine.id,
      analysisMultipv,
      limitMode,
      limitMode === "depth" ? clampedDepth : clampedTimeMs,
    ].join("|");
  }, [analysisMultipv, clampedDepth, clampedTimeMs, fen, limitMode, selectedEngine]);
  const cachedReport = analysisCacheKey ? planState.cache[analysisCacheKey] : null;
  const visibleReport =
    planState.reportCacheKey === analysisCacheKey && planState.report?.fen === fen
      ? planState.report
      : cachedReport?.fen === fen
        ? cachedReport
        : null;
  const filteredReport = useMemo(() => {
    if (!visibleReport || sideFilter === "all") return visibleReport;

    return {
      ...visibleReport,
      plans: visibleReport.plans.filter((plan) => plan.color === sideFilter),
      setups: visibleReport.setups.filter((setup) => setup.color === sideFilter),
    };
  }, [sideFilter, visibleReport]);
  const practicalLichessOptions = useMemo(
    () => ({
      ...lichessOptions,
      player: undefined,
      topGames: 0,
      recentGames: 0,
    }),
    [lichessOptions],
  );
  const practicalSetupKey =
    view === "setups" && visibleReport && explorerToken
      ? [
          "engine-plan-setup-practical",
          visibleReport.fen,
          lichessOptionsKey,
          ENGINE_SETUP_PRACTICAL_MAX_PLIES,
          "auth",
        ]
      : null;
  const {
    data: practicalSetupData,
    isLoading: practicalSetupLoading,
    error: practicalSetupError,
  } = useSWR(practicalSetupKey, () =>
    getOnlinePlanExplorer(
      "lch_all",
      visibleReport!.fen,
      practicalLichessOptions,
      ENGINE_SETUP_PRACTICAL_MAX_PLIES,
      explorerToken,
    ),
  );
  const practicalSetupBlends = useMemo(
    () =>
      buildEngineSetupBlendBySignature(
        filteredReport?.setups ?? [],
        practicalSetupData?.setups ?? [],
        moveStrengthSettings,
      ),
    [filteredReport?.setups, moveStrengthSettings, practicalSetupData?.setups],
  );

  useEffect(() => {
    setEnginePlanData(filteredReport ? engineReportToPlanExplorerData(filteredReport) : null);
    setPreviewLine(null);
  }, [filteredReport, setEnginePlanData, setPreviewLine]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowUp") return;

      if (returnPathRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const returnPath = returnPathRef.current;
        returnPathRef.current = null;
        pinnedPreviewRef.current = false;
        setBoardPreviewShapes(null);
        goToMove(returnPath);
        return;
      }

      if (!pinnedPreviewRef.current) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      pinnedPreviewRef.current = false;
      setBoardPreviewShapes(null);
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [goToMove, setBoardPreviewShapes]);

  const handleLines = useCallback(
    (active: ActiveRequest, bestLines: BestMoves[], nextProgress: number) => {
      if (bestLines.length === 0) return;

      const nextClampedProgress = Math.min(100, Math.max(0, nextProgress));
      const nextReport = buildEnginePlanReport(active.fen, bestLines, {
        requestedMultipv: active.requestedMultipv,
        limitLabel: active.limitLabel,
      });
      setPlanState((current) => ({
        ...current,
        report: nextReport,
        reportCacheKey: active.cacheKey,
        cache: withLimitedRecordEntry(
          current.cache,
          active.cacheKey,
          nextReport,
          MAX_ENGINE_PLAN_REPORT_CACHE_ENTRIES,
        ),
        progress: nextClampedProgress,
        running: nextClampedProgress < 100,
        error: null,
        activeRequestKey: nextClampedProgress >= 100 ? null : active.cacheKey,
      }));

      if (nextClampedProgress >= 100) {
        requestRef.current = null;
        cleanupListener();
      }
    },
    [cleanupListener, setPlanState],
  );

  const runAnalysis = useCallback(
    async (forceRefresh = false) => {
      if (!selectedEngine || !analysisCacheKey) return;

      const tab = `engine-plans:${activeTab ?? "tab"}`;
      const goMode: GoMode =
        limitMode === "depth" ? { t: "Depth", c: clampedDepth } : { t: "Time", c: clampedTimeMs };
      const cached = forceRefresh ? null : planState.cache[analysisCacheKey];
      if (cached) {
        setPlanState((current) => ({
          ...current,
          report: cached,
          reportCacheKey: analysisCacheKey,
          progress: 100,
          running: false,
          error: null,
          activeRequestKey: null,
        }));
        return;
      }

      const previous = requestRef.current;
      if (previous) {
        void stopEngine(previous.engine, previous.tab);
      }
      cleanupListener();

      const active: ActiveRequest = {
        token: tokenRef.current + 1,
        engine: selectedEngine,
        tab,
        fen,
        cacheKey: analysisCacheKey,
        requestedMultipv: analysisMultipv,
        limitLabel,
      };
      tokenRef.current = active.token;
      requestRef.current = active;
      setPlanState((current) => ({
        ...current,
        report: null,
        reportCacheKey: analysisCacheKey,
        error: null,
        progress: 0,
        running: true,
        activeRequestKey: analysisCacheKey,
      }));

      let unlisten: () => void;
      try {
        unlisten = await events.bestMovesPayload.listen(({ payload }) => {
          const current = requestRef.current;
          if (!current || current.token !== active.token) return;
          if (payload.engine !== current.engine.id || payload.tab !== current.tab) return;
          if (payload.fen !== current.fen || payload.moves.length !== 0) return;

          handleLines(current, payload.bestLines, payload.progress);
        });
      } catch (caught) {
        if (requestRef.current?.token === active.token) {
          setPlanState((current) => ({
            ...current,
            error: caught instanceof Error ? caught.message : String(caught),
            running: false,
            activeRequestKey: null,
          }));
          requestRef.current = null;
        }
        return;
      }

      if (requestRef.current?.token === active.token) {
        unlistenRef.current = unlisten;
      } else {
        unlisten();
        return;
      }

      void getLocalBestMoves(selectedEngine, tab, goMode, {
        fen,
        moves: [],
        extraOptions: buildEngineOptions(selectedEngine.settings, analysisMultipv),
      })
        .then((result) => {
          const current = requestRef.current;
          if (!result || !current || current.token !== active.token) return;
          handleLines(current, result[1], result[0]);
        })
        .catch((caught) => {
          const current = requestRef.current;
          if (!current || current.token !== active.token) return;
          setPlanState((state) => ({
            ...state,
            error: caught instanceof Error ? caught.message : String(caught),
            running: false,
            activeRequestKey: null,
          }));
          requestRef.current = null;
          cleanupListener();
        });
    },
    [
      activeTab,
      analysisCacheKey,
      analysisMultipv,
      clampedDepth,
      clampedTimeMs,
      cleanupListener,
      fen,
      handleLines,
      limitLabel,
      limitMode,
      planState.cache,
      selectedEngine,
      setPlanState,
    ],
  );

  const stopAnalysis = useCallback(() => {
    const active = requestRef.current;
    requestRef.current = null;
    cleanupListener();
    setPlanState((current) => ({
      ...current,
      running: false,
      activeRequestKey: null,
    }));
    if (active) {
      void stopEngine(active.engine, active.tab);
    }
  }, [cleanupListener, setPlanState]);

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

  const previewBoardMove = useCallback(
    (move: EnginePlanMovePreview, pinned = false) => {
      if (!pinned && pinnedPreviewRef.current) return;

      pinnedPreviewRef.current = pinned;
      setBoardPreviewShapes({
        fen,
        shapes: [
          {
            orig: move.from,
            dest: move.to,
            brush: "preview",
            modifiers: {
              lineWidth: 10,
            },
          },
        ],
      });
    },
    [fen, setBoardPreviewShapes],
  );

  const clearBoardMovePreview = useCallback(() => {
    if (pinnedPreviewRef.current) return;
    setBoardPreviewShapes(null);
  }, [setBoardPreviewShapes]);

  const loadPvMove = useCallback(
    (uciMoves: string[], moveIndex: number) => {
      const line = uciMoves.slice(0, moveIndex + 1);
      if (line.length === 0) return;

      returnPathRef.current = currentPosition.slice();
      pinnedPreviewRef.current = false;
      setBoardPreviewShapes(null);
      makeMoves({ payload: line, changeHeaders: false });
    },
    [currentPosition, makeMoves, setBoardPreviewShapes],
  );

  const content = (() => {
    if (localEngines.length === 0) {
      return (
        <Alert color="yellow" variant="light">
          No configured local Stockfish engine.
        </Alert>
      );
    }

    if (!visibleReport && !running) {
      return (
        <Text ta="center" c="dimmed" py="xl">
          Run Engine Plans for the current board position.
        </Text>
      );
    }

    if (!visibleReport) {
      return (
        <Text ta="center" c="dimmed" py="xl">
          Waiting for Stockfish PVs...
        </Text>
      );
    }

    return (
      <ScrollArea flex={1} offsetScrollbars>
        <Stack gap="sm" pb="sm">
          <Group justify="space-between" align="center" wrap="wrap" gap="xs">
            <Group gap="xs">
              <Badge variant="light">{visibleReport.totalPvs} PVs</Badge>
              <Badge variant="light">{visibleReport.limitLabel}</Badge>
              <Badge variant="light">{sideFilterLabel(sideFilter)}</Badge>
              {view === "setups" && (
                <Badge
                  variant="light"
                  color={
                    practicalSetupLoading
                      ? "blue"
                      : practicalSetupError
                        ? "orange"
                        : explorerToken
                          ? "teal"
                          : "gray"
                  }
                >
                  {practicalSetupLoading
                    ? "Lichess All loading"
                    : practicalSetupError
                      ? "Lichess All unavailable"
                      : explorerToken
                        ? "Lichess All blend"
                        : "Link Lichess for blend"}
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              Raw eval details are kept inside each row.
            </Text>
          </Group>

          {view === "plans" && (!filteredReport || filteredReport.plans.length === 0) ? (
            <Text ta="center" c="dimmed" py="xl">
              {sideFilter === "all"
                ? "No plan signals found in the PVs."
                : `No ${sideFilter} plan signals found in the PVs.`}
            </Text>
          ) : view === "plans" && filteredReport ? (
            <PlansTable
              plans={filteredReport.plans}
              rootFen={visibleReport.fen}
              totalPvs={visibleReport.totalPvs}
              sort={planSort}
              setSort={setPlanSort}
              drawLine={drawLine}
              previewLine={setPreviewLine}
              previewMove={previewBoardMove}
              loadPvMove={loadPvMove}
              clearPreview={clearBoardMovePreview}
            />
          ) : !filteredReport || filteredReport.setups.length === 0 ? (
            <Text ta="center" c="dimmed" py="xl">
              {sideFilter === "all"
                ? "No engine setup families found in the PVs."
                : `No ${sideFilter} engine setup families found in the PVs.`}
            </Text>
          ) : (
            <SetupsTable
              setups={filteredReport.setups}
              rootFen={visibleReport.fen}
              totalPvs={visibleReport.totalPvs}
              sort={planSort}
              setSort={setPlanSort}
              blendBySetupSignature={practicalSetupBlends}
              practicalLoading={practicalSetupLoading}
              practicalError={practicalSetupError}
              hasExplorerToken={!!explorerToken}
              drawLines={drawLines}
              previewLine={setPreviewLine}
              previewMove={previewBoardMove}
              loadPvMove={loadPvMove}
              clearPreview={clearBoardMovePreview}
            />
          )}

          <RawPvs
            report={visibleReport}
            previewMove={previewBoardMove}
            loadPvMove={loadPvMove}
            clearPreview={clearBoardMovePreview}
          />
        </Stack>
      </ScrollArea>
    );
  })();

  return (
    <Stack h="100%" gap="xs" p="sm">
      <Stack gap="xs">
        <Group justify="space-between" align="center" wrap="wrap" gap="xs">
          <Group gap="xs" wrap="wrap" miw={0}>
            <Select
              aria-label="Engine"
              data={localEngines.map((engine) => ({
                value: engine.id,
                label: engine.name,
              }))}
              value={selectedEngine?.id ?? null}
              onChange={setEngineId}
              placeholder="Engine"
              size="sm"
              w={220}
              searchable
              allowDeselect={false}
              comboboxProps={{ withinPortal: true }}
            />
            <SegmentedControl
              size="sm"
              value={limitMode}
              onChange={(value) => setLimitMode(value as "depth" | "time")}
              data={[
                { label: "Depth", value: "depth" },
                { label: "Time", value: "time" },
              ]}
            />
            {limitMode === "depth" ? (
              <NumberInput
                aria-label="Depth"
                value={clampedDepth}
                onChange={(value) => setDepth(clampNumber(Number(value) || 12, 1, 40))}
                min={1}
                max={40}
                clampBehavior="strict"
                size="sm"
                w={90}
              />
            ) : (
              <NumberInput
                aria-label="Time in milliseconds"
                value={clampedTimeMs}
                onChange={(value) => setTimeMs(clampNumber(Number(value) || 2000, 250, 30000))}
                min={250}
                max={30000}
                step={250}
                clampBehavior="strict"
                size="sm"
                w={115}
              />
            )}
            <NumberInput
              aria-label="MultiPV"
              value={clampedMultipv}
              onChange={(value) => setMultipv(clampNumber(Number(value) || 5, 1, 10))}
              min={1}
              max={10}
              clampBehavior="strict"
              size="sm"
              w={88}
              prefix="PV "
            />
            <SegmentedControl
              aria-label="Plan side filter"
              size="sm"
              value={sideFilter}
              onChange={(value) => setSideFilter(value as EnginePlanSideFilter)}
              data={[
                { label: "All", value: "all" },
                { label: "White", value: "white" },
                { label: "Black", value: "black" },
              ]}
            />
            <SegmentedControl
              aria-label="Engine plan view"
              size="sm"
              value={view}
              onChange={(value) => setView(value as EnginePlanView)}
              data={[
                { label: "Plans", value: "plans" },
                { label: "Setups", value: "setups" },
              ]}
            />
            <Switch
              label="Auto arrows"
              size="sm"
              checked={showPlanArrows}
              onChange={(event) => setShowPlanArrows(event.currentTarget.checked)}
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
              size="sm"
              w={76}
              disabled={!showPlanArrows}
            />
            {analysisMultipv > clampedMultipv && (
              <Badge variant="light">{analysisMultipv} coverage PVs</Badge>
            )}
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Tooltip label={running ? "Stop analysis" : "Run Engine Plans"}>
              <Button
                size="sm"
                variant={running ? "default" : "filled"}
                leftSection={
                  running ? <IconPlayerStop size="1rem" /> : <IconPlayerPlay size="1rem" />
                }
                onClick={running ? stopAnalysis : () => void runAnalysis()}
                disabled={!selectedEngine}
              >
                {running ? "Stop" : "Run"}
              </Button>
            </Tooltip>
            <Tooltip label="Refresh">
              <ActionIcon
                size="lg"
                variant="default"
                disabled={!selectedEngine || running}
                onClick={() => {
                  if (!selectedEngine) return;
                  setPlanState((current) => {
                    const nextCache = { ...current.cache };
                    delete nextCache[analysisCacheKey];
                    return {
                      ...current,
                      report: current.reportCacheKey === analysisCacheKey ? null : current.report,
                      reportCacheKey:
                        current.reportCacheKey === analysisCacheKey ? null : current.reportCacheKey,
                      cache: nextCache,
                    };
                  });
                  void runAnalysis(true);
                }}
              >
                <IconRefresh size="1rem" />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Stack>

      <Progress value={running ? progress : visibleReport ? 100 : 0} animated={running} size="xs" />

      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      {content}
    </Stack>
  );
}

function PlansTable({
  plans,
  rootFen,
  totalPvs,
  sort,
  setSort,
  drawLine,
  previewLine,
  previewMove,
  loadPvMove,
  clearPreview,
}: {
  plans: EnginePlan[];
  rootFen: string;
  totalPvs: number;
  sort: EnginePlanSort;
  setSort: Dispatch<SetStateAction<EnginePlanSort>>;
  drawLine: (line: ColoredPlanExplorerLine) => void;
  previewLine: (line: ColoredPlanExplorerLine | null) => void;
  previewMove: (move: EnginePlanMovePreview, pinned?: boolean) => void;
  loadPvMove: (uciMoves: string[], moveIndex: number) => void;
  clearPreview: () => void;
}) {
  const sortedPlans = useMemo(() => sortEnginePlans(plans, sort).slice(0, 30), [plans, sort]);

  return (
    <Table withTableBorder highlightOnHover stickyHeader>
      <Table.Thead>
        <Table.Tr>
          <SortableEngineTh sortKey="plan" sort={sort} setSort={setSort}>
            Plan
          </SortableEngineTh>
          <SortableEngineTh sortKey="strength" sort={sort} setSort={setSort} style={{ width: 140 }}>
            Engine Strength
          </SortableEngineTh>
          <SortableEngineTh sortKey="eval" sort={sort} setSort={setSort} style={{ width: 96 }}>
            Eval
          </SortableEngineTh>
          <SortableEngineTh
            sortKey="confidence"
            sort={sort}
            setSort={setSort}
            style={{ width: 118 }}
          >
            Confidence
          </SortableEngineTh>
          <Table.Th style={{ width: 54 }} />
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {sortedPlans.map((plan) => (
          <PlanRow
            key={plan.signature}
            plan={plan}
            rootFen={rootFen}
            totalPvs={totalPvs}
            drawLine={drawLine}
            previewLine={previewLine}
            previewMove={previewMove}
            loadPvMove={loadPvMove}
            clearPreview={clearPreview}
          />
        ))}
      </Table.Tbody>
    </Table>
  );
}

function SetupsTable({
  setups,
  rootFen,
  totalPvs,
  sort,
  setSort,
  blendBySetupSignature,
  practicalLoading,
  practicalError,
  hasExplorerToken,
  drawLines,
  previewLine,
  previewMove,
  loadPvMove,
  clearPreview,
}: {
  setups: EnginePlanSetup[];
  rootFen: string;
  totalPvs: number;
  sort: EnginePlanSort;
  setSort: Dispatch<SetStateAction<EnginePlanSort>>;
  blendBySetupSignature: Map<string, EngineSetupBlend>;
  practicalLoading: boolean;
  practicalError: unknown;
  hasExplorerToken: boolean;
  drawLines: (lines: ColoredPlanExplorerLine[]) => void;
  previewLine: (line: ColoredPlanExplorerLine | ColoredPlanExplorerLine[] | null) => void;
  previewMove: (move: EnginePlanMovePreview, pinned?: boolean) => void;
  loadPvMove: (uciMoves: string[], moveIndex: number) => void;
  clearPreview: () => void;
}) {
  const sortedSetups = useMemo(
    () => sortEngineSetups(setups, sort, blendBySetupSignature).slice(0, 30),
    [blendBySetupSignature, setups, sort],
  );

  return (
    <Table withTableBorder highlightOnHover stickyHeader>
      <Table.Thead>
        <Table.Tr>
          <SortableEngineTh sortKey="plan" sort={sort} setSort={setSort}>
            Setup
          </SortableEngineTh>
          <SortableEngineTh sortKey="blend" sort={sort} setSort={setSort} style={{ width: 122 }}>
            Blend
          </SortableEngineTh>
          <SortableEngineTh sortKey="strength" sort={sort} setSort={setSort} style={{ width: 140 }}>
            Engine Strength
          </SortableEngineTh>
          <SortableEngineTh sortKey="eval" sort={sort} setSort={setSort} style={{ width: 96 }}>
            Eval
          </SortableEngineTh>
          <SortableEngineTh
            sortKey="confidence"
            sort={sort}
            setSort={setSort}
            style={{ width: 118 }}
          >
            Confidence
          </SortableEngineTh>
          <Table.Th style={{ width: 54 }} />
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {sortedSetups.map((setup) => (
          <SetupRow
            key={setup.signature}
            setup={setup}
            rootFen={rootFen}
            totalPvs={totalPvs}
            blend={blendBySetupSignature.get(setup.signature) ?? null}
            practicalLoading={practicalLoading}
            practicalError={practicalError}
            hasExplorerToken={hasExplorerToken}
            drawLines={drawLines}
            previewLine={previewLine}
            previewMove={previewMove}
            loadPvMove={loadPvMove}
            clearPreview={clearPreview}
          />
        ))}
      </Table.Tbody>
    </Table>
  );
}

function SetupRow({
  setup,
  rootFen,
  totalPvs,
  blend,
  practicalLoading,
  practicalError,
  hasExplorerToken,
  drawLines,
  previewLine,
  previewMove,
  loadPvMove,
  clearPreview,
}: {
  setup: EnginePlanSetup;
  rootFen: string;
  totalPvs: number;
  blend: EngineSetupBlend | null;
  practicalLoading: boolean;
  practicalError: unknown;
  hasExplorerToken: boolean;
  drawLines: (lines: ColoredPlanExplorerLine[]) => void;
  previewLine: (line: ColoredPlanExplorerLine | ColoredPlanExplorerLine[] | null) => void;
  previewMove: (move: EnginePlanMovePreview, pinned?: boolean) => void;
  loadPvMove: (uciMoves: string[], moveIndex: number) => void;
  clearPreview: () => void;
}) {
  const routeLines = useMemo(
    () => setup.plans.map(planToLine).filter((line): line is ColoredPlanExplorerLine => !!line),
    [setup.plans],
  );
  const verdict = useMemo(
    () => getEngineSetupVerdict(setup, totalPvs, blend),
    [blend, setup, totalPvs],
  );
  const coachRequest = useMemo(
    () => buildEngineSetupCoachRequest(setup, rootFen, totalPvs, blend, verdict),
    [blend, rootFen, setup, totalPvs, verdict],
  );
  const coachCacheKey = useMemo(
    () =>
      [
        "engine-plan-setup",
        rootFen,
        setup.signature,
        setup.approval,
        setup.supportCount,
        setup.weightedEvalCp ?? "mate-or-none",
        blend?.score ?? "no-blend",
        blend?.practical?.setup.games ?? "no-practical",
        verdict.label,
      ].join("|"),
    [blend, rootFen, setup, verdict],
  );

  return (
    <Table.Tr onMouseEnter={() => previewLine(routeLines)} onMouseLeave={() => previewLine(null)}>
      <Table.Td>
        <Stack gap={4}>
          <Group gap="xs" wrap="wrap">
            <Badge variant="light">{setup.plans.length} plans</Badge>
            <Tooltip label={verdict.detail} multiline w={320} withArrow>
              <Badge color={verdict.color} variant="light">
                {verdict.label}
              </Badge>
            </Tooltip>
            {setup.archetype && <Badge variant="filled">{setup.archetype}</Badge>}
            <Badge variant="outline">{setup.appearsInTopPv ? "PV1" : "Side PV"}</Badge>
          </Group>
          <Text fw={700} size="sm">
            {setup.label}
          </Text>
          <Group gap={4} wrap="wrap">
            {setup.plans.map((plan) => (
              <Badge key={plan.signature} size="xs" variant="light">
                {categoryLabel(plan.category)}: {compactEnginePlanLabel(plan)}
              </Badge>
            ))}
          </Group>
          <Text size="sm" c="dimmed" lineClamp={2}>
            {setup.explanation}
          </Text>
          <PlanCoachInline request={coachRequest} cacheKey={coachCacheKey} />
          <details>
            <summary>Evidence</summary>
            <Table withRowBorders={false} mt="xs">
              <Table.Tbody>
                {setup.evidence.map((line) => (
                  <Table.Tr key={line.rank}>
                    <Table.Td w={48}>
                      <Badge size="sm" variant="light">
                        PV{line.rank}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <PvMoveLine
                        rootFen={rootFen}
                        uciMoves={line.uciMoves}
                        sanMoves={line.sanMoves}
                        previewMove={previewMove}
                        loadPvMove={loadPvMove}
                        clearPreview={clearPreview}
                      />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </details>
        </Stack>
      </Table.Td>
      <Table.Td>
        <SetupBlendCell
          blend={blend}
          loading={practicalLoading}
          error={practicalError}
          hasExplorerToken={hasExplorerToken}
        />
      </Table.Td>
      <Table.Td>
        <EngineStrengthCell target={setup} totalPvs={totalPvs} />
      </Table.Td>
      <Table.Td>{formatEvalCp(setup.weightedEvalCp)}</Table.Td>
      <Table.Td>
        <Badge variant="outline">{setup.confidence}</Badge>
      </Table.Td>
      <Table.Td>
        {routeLines.length > 0 && (
          <Tooltip label="Draw setup">
            <ActionIcon
              size="sm"
              variant="subtle"
              onClick={() => drawLines(routeLines)}
              aria-label="Draw setup"
            >
              <IconRoute size="1rem" />
            </ActionIcon>
          </Tooltip>
        )}
      </Table.Td>
    </Table.Tr>
  );
}

function SetupBlendCell({
  blend,
  loading,
  error,
  hasExplorerToken,
}: {
  blend: EngineSetupBlend | null;
  loading: boolean;
  error: unknown;
  hasExplorerToken: boolean;
}) {
  if (!hasExplorerToken) {
    return (
      <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
        Link Lichess
      </Text>
    );
  }

  if (loading && !blend) {
    return (
      <Text size="xs" c="dimmed">
        Loading
      </Text>
    );
  }

  if (error && !blend) {
    return (
      <Text size="xs" c="orange">
        Unavailable
      </Text>
    );
  }

  if (!blend) {
    return (
      <Text size="xs" c="dimmed">
        No match
      </Text>
    );
  }

  return (
    <Tooltip label={blend.detail} multiline w={330} withArrow>
      <Stack gap={3}>
        <Badge color={blend.engineUnsafe ? "yellow" : "teal"} variant="light">
          {blend.label}
        </Badge>
        <Progress value={blend.score} color={blend.engineUnsafe ? "yellow" : "teal"} size={3} />
        {blend.practical && (
          <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
            {blend.practical.setup.games.toLocaleString()} games
          </Text>
        )}
      </Stack>
    </Tooltip>
  );
}

function EngineStrengthCell({
  target,
  totalPvs,
}: {
  target: EnginePlan | EnginePlanSetup;
  totalPvs: number;
}) {
  const cpLoss = target.bestCpLoss ?? target.weightedCpLoss;
  const cpLossLabel = cpLoss === null ? "CP n/a" : `${formatEngineCpLoss(cpLoss)} loss`;
  const supportLabel = `${target.supportCount}/${totalPvs} PVs`;
  const detail = [
    `Engine strength: ${target.approval}`,
    `PV support ${supportLabel} (${(target.supportRatio * 100).toFixed(0)}%)`,
    cpLoss === null ? "CP loss unavailable" : `Best-line CP loss ${formatEngineCpLoss(cpLoss)}`,
    target.weightedCpLoss !== null
      ? `weighted CP loss ${formatEngineCpLoss(target.weightedCpLoss)}`
      : null,
    target.bestQualityCp !== null
      ? `best supporting quality ${Math.round(target.bestQualityCp)} cp`
      : null,
  ]
    .filter((part): part is string => !!part)
    .join(". ");

  return (
    <Tooltip label={detail} multiline w={280} withArrow>
      <Stack gap={2}>
        <Badge color={approvalColor(target.approval)} variant="light">
          {target.approval}
        </Badge>
        <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
          {`${cpLossLabel} - ${supportLabel}`}
        </Text>
      </Stack>
    </Tooltip>
  );
}

function PlanRow({
  plan,
  rootFen,
  totalPvs,
  drawLine,
  previewLine,
  previewMove,
  loadPvMove,
  clearPreview,
}: {
  plan: EnginePlan;
  rootFen: string;
  totalPvs: number;
  drawLine: (line: ColoredPlanExplorerLine) => void;
  previewLine: (line: ColoredPlanExplorerLine | null) => void;
  previewMove: (move: EnginePlanMovePreview, pinned?: boolean) => void;
  loadPvMove: (uciMoves: string[], moveIndex: number) => void;
  clearPreview: () => void;
}) {
  const routeLine = useMemo(() => planToLine(plan), [plan]);
  const coachRequest = useMemo(
    () => buildEnginePlanCoachRequest(plan, rootFen, totalPvs),
    [plan, rootFen, totalPvs],
  );
  const coachCacheKey = useMemo(
    () =>
      [
        "engine-plan",
        rootFen,
        plan.signature,
        plan.approval,
        plan.supportCount,
        plan.weightedEvalCp ?? "mate-or-none",
      ].join("|"),
    [plan, rootFen],
  );

  return (
    <Table.Tr
      onMouseEnter={() => routeLine && previewLine(routeLine)}
      onMouseLeave={() => previewLine(null)}
    >
      <Table.Td>
        <Stack gap={4}>
          <Group gap="xs" wrap="wrap">
            <Badge variant="light">{categoryLabel(plan.category)}</Badge>
            <Badge variant="outline">{plan.appearsInTopPv ? "PV1" : "Side PV"}</Badge>
          </Group>
          <Text fw={700} size="sm">
            {plan.label}
          </Text>
          <Text size="sm" c="dimmed" lineClamp={2}>
            {plan.explanation}
          </Text>
          <PlanCoachInline request={coachRequest} cacheKey={coachCacheKey} />
          <details>
            <summary>Evidence</summary>
            <Table withRowBorders={false} mt="xs">
              <Table.Tbody>
                {plan.evidence.map((line) => (
                  <Table.Tr key={line.rank}>
                    <Table.Td w={48}>
                      <Badge size="sm" variant="light">
                        PV{line.rank}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <PvMoveLine
                        rootFen={rootFen}
                        uciMoves={line.uciMoves}
                        sanMoves={line.sanMoves}
                        previewMove={previewMove}
                        loadPvMove={loadPvMove}
                        clearPreview={clearPreview}
                      />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </details>
        </Stack>
      </Table.Td>
      <Table.Td>
        <EngineStrengthCell target={plan} totalPvs={totalPvs} />
      </Table.Td>
      <Table.Td>{formatEvalCp(plan.weightedEvalCp)}</Table.Td>
      <Table.Td>
        <Badge variant="outline">{plan.confidence}</Badge>
      </Table.Td>
      <Table.Td>
        {routeLine && (
          <Tooltip label="Draw route">
            <ActionIcon
              size="sm"
              variant="subtle"
              onClick={() => drawLine(routeLine)}
              aria-label="Draw route"
            >
              <IconRoute size="1rem" />
            </ActionIcon>
          </Tooltip>
        )}
      </Table.Td>
    </Table.Tr>
  );
}

function SortableEngineTh({
  sortKey,
  sort,
  setSort,
  children,
  style,
}: {
  sortKey: EnginePlanSortKey;
  sort: EnginePlanSort;
  setSort: Dispatch<SetStateAction<EnginePlanSort>>;
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
                  direction: defaultEnginePlanSortDirection(sortKey),
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

function PvMoveLine({
  rootFen,
  uciMoves,
  sanMoves,
  previewMove,
  loadPvMove,
  clearPreview,
}: {
  rootFen: string;
  uciMoves: string[];
  sanMoves: string[];
  previewMove: (move: EnginePlanMovePreview, pinned?: boolean) => void;
  loadPvMove: (uciMoves: string[], moveIndex: number) => void;
  clearPreview: () => void;
}) {
  const moves = useMemo(
    () => getPvMovePreviews(rootFen, uciMoves, sanMoves),
    [rootFen, sanMoves, uciMoves],
  );

  if (moves.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        -
      </Text>
    );
  }

  return (
    <Box component="span" style={{ display: "inline", lineHeight: 1.8 }}>
      {moves.map((move) => (
        <Box
          key={`${move.index}-${move.uci}`}
          component="span"
          onMouseEnter={() => previewMove(move)}
          onMouseLeave={clearPreview}
          style={{ display: "inline-flex", alignItems: "center", gap: 2, marginRight: 4 }}
        >
          {(move.index === 0 || move.color === "white") && (
            <Text component="span" size="xs" c="dimmed">
              {move.moveNumber}
              {move.color === "white" ? "." : "..."}
            </Text>
          )}
          <MoveCell
            move={move.san}
            annotations={[]}
            isStart={false}
            isCurrentVariation={false}
            onClick={() => loadPvMove(uciMoves, move.index)}
            onContextMenu={(event) => event.preventDefault()}
          />
        </Box>
      ))}
    </Box>
  );
}

function RawPvs({
  report,
  previewMove,
  loadPvMove,
  clearPreview,
}: {
  report: EnginePlanReport;
  previewMove: (move: EnginePlanMovePreview, pinned?: boolean) => void;
  loadPvMove: (uciMoves: string[], moveIndex: number) => void;
  clearPreview: () => void;
}) {
  return (
    <details>
      <summary>Raw PVs</summary>
      <Table withTableBorder highlightOnHover mt="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={64}>PV</Table.Th>
            <Table.Th w={90}>First</Table.Th>
            <Table.Th w={90}>Eval</Table.Th>
            <Table.Th w={76}>Depth</Table.Th>
            <Table.Th>SAN line</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {report.pvs.map((line) => (
            <Table.Tr key={line.rank}>
              <Table.Td>PV{line.rank}</Table.Td>
              <Table.Td>{line.sanMoves[0] ?? line.uciMoves[0] ?? "-"}</Table.Td>
              <Table.Td>{formatScoreValue(line.score.value)}</Table.Td>
              <Table.Td>{line.depth}</Table.Td>
              <Table.Td>
                <PvMoveLine
                  rootFen={report.fen}
                  uciMoves={line.uciMoves}
                  sanMoves={line.sanMoves}
                  previewMove={previewMove}
                  loadPvMove={loadPvMove}
                  clearPreview={clearPreview}
                />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </details>
  );
}

function sortEnginePlans(plans: EnginePlan[], sort: EnginePlanSort) {
  const direction = sort.direction === "asc" ? 1 : -1;

  return [...plans].sort((a, b) => {
    let diff = 0;
    switch (sort.key) {
      case "plan":
        diff = a.label.localeCompare(b.label);
        break;
      case "strength":
      case "blend":
        diff = engineStrengthSortScore(a) - engineStrengthSortScore(b);
        break;
      case "eval":
        diff = nullableEvalSortScore(a.weightedEvalCp) - nullableEvalSortScore(b.weightedEvalCp);
        break;
      case "confidence":
        diff =
          engineConfidenceScore(a.confidence) - engineConfidenceScore(b.confidence) ||
          a.supportCount - b.supportCount;
        break;
    }

    return direction * (diff || a.label.localeCompare(b.label));
  });
}

function sortEngineSetups(
  setups: EnginePlanSetup[],
  sort: EnginePlanSort,
  blendBySetupSignature: Map<string, EngineSetupBlend>,
) {
  const direction = sort.direction === "asc" ? 1 : -1;

  return [...setups].sort((a, b) => {
    let diff = 0;
    switch (sort.key) {
      case "plan":
        diff = a.label.localeCompare(b.label);
        break;
      case "blend":
        diff =
          (blendBySetupSignature.get(a.signature)?.score ?? -1) -
            (blendBySetupSignature.get(b.signature)?.score ?? -1) ||
          engineStrengthSortScore(a) - engineStrengthSortScore(b) ||
          a.plans.length - b.plans.length;
        break;
      case "strength":
        diff =
          engineStrengthSortScore(a) - engineStrengthSortScore(b) ||
          a.plans.length - b.plans.length;
        break;
      case "eval":
        diff = nullableEvalSortScore(a.weightedEvalCp) - nullableEvalSortScore(b.weightedEvalCp);
        break;
      case "confidence":
        diff =
          engineConfidenceScore(a.confidence) - engineConfidenceScore(b.confidence) ||
          a.supportCount - b.supportCount;
        break;
    }

    return direction * (diff || a.label.localeCompare(b.label));
  });
}

function defaultEnginePlanSortDirection(key: EnginePlanSortKey): SortDirection {
  return key === "plan" ? "asc" : "desc";
}

function engineApprovalScore(approval: EnginePlan["approval"]) {
  switch (approval) {
    case "Strong":
      return 3;
    case "OK":
      return 2;
    case "Unclear":
      return 1;
    case "Weak":
      return 0;
  }
}

function engineConfidenceScore(confidence: EnginePlan["confidence"]) {
  switch (confidence) {
    case "High":
      return 3;
    case "Medium":
      return 2;
    case "Low":
      return 1;
  }
}

function nullableEvalSortScore(value: number | null) {
  return value ?? Number.NEGATIVE_INFINITY;
}

function engineStrengthSortScore(target: EnginePlan | EnginePlanSetup) {
  const cpLoss = target.bestCpLoss ?? target.weightedCpLoss;
  const cpPenalty = cpLoss === null ? 500 : Math.min(500, Math.max(0, cpLoss));
  return (
    engineApprovalScore(target.approval) * 100_000 +
    engineConfidenceScore(target.confidence) * 10_000 +
    target.supportCount * 100 +
    target.supportRatio * 10 +
    (target.appearsInTopPv ? 50 : 0) -
    cpPenalty
  );
}

function getEngineSetupVerdict(
  setup: EnginePlanSetup,
  totalPvs: number,
  blend: EngineSetupBlend | null,
): EngineSetupVerdict {
  const inferredComponents = setup.plans.filter((plan) => plan.origin === "template").length;
  const pvComponents = setup.plans.filter((plan) => plan.origin === "pv").length;
  const rootComponents = setup.plans.filter((plan) => plan.origin === "root").length;
  const supportLabel = `${setup.supportCount}/${totalPvs} PVs`;

  if (setup.approval === "Weak" || blend?.engineUnsafe) {
    return {
      label: "Engine risk",
      color: "yellow",
      detail: [
        "The engine evidence does not safely support this setup.",
        `${supportLabel} support.`,
        inferredComponents > 0 ? `${inferredComponents} template components.` : null,
      ]
        .filter((part): part is string => !!part)
        .join(" "),
    };
  }

  if (inferredComponents > 0) {
    return {
      label: "Template candidate",
      color: setup.approval === "Strong" ? "blue" : "gray",
      detail: [
        "Some setup arrows are inferred from the named setup template rather than directly shown in engine PVs.",
        `${pvComponents} PV-backed, ${rootComponents} already on board, ${inferredComponents} inferred.`,
        `${supportLabel} support.`,
      ].join(" "),
    };
  }

  if (
    blend?.practical &&
    blend.practical.matchedComponents >= Math.max(3, Math.ceil(setup.plans.length * 0.67)) &&
    setup.supportRatio >= 0.5
  ) {
    return {
      label: "Verified setup",
      color: "teal",
      detail: [
        "The setup is directly supported by engine PVs and has a tight practical database match.",
        `${blend.practical.matchedComponents}/${setup.plans.length} components matched.`,
        `${supportLabel} support.`,
      ].join(" "),
    };
  }

  if (setup.approval === "Strong" || setup.approval === "OK") {
    return {
      label: "Engine line",
      color: setup.approval === "Strong" ? "teal" : "blue",
      detail: [
        "Engine PVs contain this setup pattern, but the full final setup still needs practical or deeper-line confirmation.",
        `${supportLabel} support.`,
      ].join(" "),
    };
  }

  return {
    label: "Needs check",
    color: "gray",
    detail: [
      "The available engine evidence is not clear enough to recommend this as a setup.",
      `${supportLabel} support.`,
    ].join(" "),
  };
}

function buildEngineSetupBlendBySignature(
  setups: EnginePlanSetup[],
  practicalSetups: PlanExplorerSetup[],
  strengthSettings: Partial<MoveStrengthSettings> | null | undefined,
) {
  const settings = normalizeMoveStrengthSettings(strengthSettings);
  if (setups.length === 0 || practicalSetups.length === 0) {
    return new Map<string, EngineSetupBlend>();
  }

  const candidates = setups.map((setup) => {
    const practical = findPracticalSetupMatch(setup, practicalSetups);
    const games = practical?.setup.games ?? 0;
    const databaseScore =
      practical && games > 0
        ? getPracticalWdlRate(
            {
              white: practical.setup.white,
              draw: practical.setup.draw,
              black: practical.setup.black,
            },
            setup.color,
          )
        : null;

    return {
      setup,
      practical,
      perspective: setup.color,
      games,
      databaseScore,
      engineCpLoss: getEngineSetupCpLoss(setup, settings),
    };
  });
  const baselines = getEngineSetupBlendBaselines(candidates);
  const engineSpread = getEngineScoreSpreadCp(
    candidates.map((candidate) =>
      candidate.engineCpLoss === null ? null : -candidate.engineCpLoss,
    ),
  );
  const entries: [string, EngineSetupBlend][] = [];

  for (const candidate of candidates) {
    if (!candidate.practical) continue;

    const baseline = baselines.get(candidate.perspective);
    const databaseScore = getUsageAwarePracticalWdlRate({
      score: candidate.databaseScore,
      total: candidate.games,
      usageShare:
        baseline && baseline.totalGames > 0 ? candidate.games / baseline.totalGames : null,
      baseline: baseline?.average ?? null,
      mode: settings.mode,
    });
    const databaseWdlLoss =
      databaseScore === null || baseline?.best === null || baseline?.best === undefined
        ? null
        : Math.max(0, baseline.best - databaseScore);
    const blended = evaluateMoveStrength({
      settings,
      engineCpLoss: candidate.engineCpLoss,
      hasEngineMoves: true,
      databaseWdlLoss,
      engineScoreSpreadCp: engineSpread,
    });

    entries.push([
      candidate.setup.signature,
      {
        score: blended.score,
        label: blended.score.toString(),
        detail: formatEngineSetupBlendDetail({
          settings,
          score: blended.score,
          engineCpLoss: candidate.engineCpLoss,
          engineUnsafe: blended.engineUnsafe,
          databaseScore,
          databaseWdlLoss,
          practical: candidate.practical,
          perspective: candidate.perspective,
        }),
        databaseScore,
        databaseWdlLoss,
        engineCpLoss: candidate.engineCpLoss,
        engineUnsafe: blended.engineUnsafe,
        practical: candidate.practical,
      },
    ]);
  }

  return new Map(entries);
}

function findPracticalSetupMatch(
  setup: EnginePlanSetup,
  practicalSetups: PlanExplorerSetup[],
): EngineSetupPracticalMatch | null {
  const engineComponents = new Set(setup.plans.map((plan) => plan.signature));
  const engineAnchors = [...engineComponents].filter(isSetupAnchorSignature);
  let best:
    | (EngineSetupPracticalMatch & {
        rankScore: number;
      })
    | null = null;

  for (const practical of practicalSetups) {
    if (practicalSetupSide(practical) !== setup.color) continue;

    const practicalComponents = practicalSetupComponentSignatures(practical);
    if (practicalComponents.size === 0) continue;

    const overlap = [...practicalComponents].filter((signature) => engineComponents.has(signature));
    const matchedComponents = overlap.length;
    if (matchedComponents < 3) continue;

    const anchorMatches = overlap.filter(isSetupAnchorSignature).length;
    if (engineAnchors.length > 0 && anchorMatches === 0) continue;
    if (!overlap.some(isSetupStructuralSignature)) continue;

    const rowShare = matchedComponents / Math.max(1, practicalComponents.size);
    const engineShare = matchedComponents / Math.max(1, engineComponents.size);
    if (rowShare < 0.6 || engineShare < 0.4) continue;

    const rankScore =
      matchedComponents * 100 +
      anchorMatches * 30 +
      rowShare * 20 +
      engineShare * 10 +
      Math.log10(practical.games + 1);
    if (!best || rankScore > best.rankScore) {
      best = {
        setup: practical,
        matchedComponents,
        totalComponents: engineComponents.size,
        rowComponents: practicalComponents.size,
        anchorMatches,
        rankScore,
      };
    }
  }

  if (!best) return null;
  const { rankScore: _rankScore, ...match } = best;
  return match;
}

function practicalSetupComponentSignatures(setup: PlanExplorerSetup) {
  return new Set(
    setup.plans
      .map(practicalSetupPlanSignature)
      .filter((signature): signature is string => !!signature),
  );
}

function practicalSetupPlanSignature(plan: PlanExplorerSetupPlan) {
  const color = plan.color === "black" ? "black" : "white";
  const to = plan.line.squares.at(-1);
  if (!to) return null;

  const castling = plan.role === "king" ? detectPlanCastling(plan.line, color) : null;
  if (castling) {
    return `castling:${color}:${castling.side}`;
  }

  switch (plan.role) {
    case "pawn":
      return `pawn_setup:${color}:${to}`;
    case "bishop":
    case "knight":
    case "rook":
    case "queen":
    case "king":
      return `piece_destination:${color}:${plan.role}:${to}`;
    default:
      return null;
  }
}

function practicalSetupSide(setup: PlanExplorerSetup) {
  const colors = new Set(setup.plans.map((plan) => plan.color));
  if (colors.size !== 1) return null;

  const color = setup.plans[0]?.color;
  return color === "black" || color === "white" ? color : null;
}

function isSetupAnchorSignature(signature: string) {
  if (signature.startsWith("castling:")) return true;
  if (/^piece_destination:(white|black):(bishop|knight):/.test(signature)) return true;
  return (
    signature === "pawn_setup:white:b3" ||
    signature === "pawn_setup:white:g3" ||
    signature === "pawn_setup:black:b6" ||
    signature === "pawn_setup:black:g6"
  );
}

function isSetupStructuralSignature(signature: string) {
  return signature.startsWith("pawn_setup:");
}

function getEngineSetupCpLoss(setup: EnginePlanSetup, settings: MoveStrengthSettings) {
  const setupCpLoss = setup.bestCpLoss ?? setup.weightedCpLoss;
  const planCpLosses = setup.plans
    .map((plan) => plan.bestCpLoss ?? plan.weightedCpLoss)
    .filter((value): value is number => value !== null);

  if (setupCpLoss !== null) {
    if (planCpLosses.length === 0) return setupCpLoss;

    const average = planCpLosses.reduce((sum, loss) => sum + loss, 0) / planCpLosses.length;
    const worst = Math.max(...planCpLosses);
    return setupCpLoss * 0.65 + average * 0.2 + worst * 0.15;
  }

  const maxLoss = Math.max(1, settings.maxEngineCpLoss);
  const setupLoss = getEngineEvidenceCpLoss({
    approval: setup.approval,
    confidence: setup.confidence,
    supportCount: setup.supportCount,
    appearsInTopPv: setup.appearsInTopPv,
    maxLoss,
  });
  const planLosses = setup.plans.map(
    (plan) =>
      plan.bestCpLoss ??
      plan.weightedCpLoss ??
      getEngineEvidenceCpLoss({
        approval: plan.approval,
        confidence: plan.confidence,
        supportCount: plan.supportCount,
        appearsInTopPv: plan.appearsInTopPv,
        maxLoss,
      }),
  );
  if (planLosses.length === 0) return setupLoss;

  const average = planLosses.reduce((sum, loss) => sum + loss, 0) / planLosses.length;
  const worst = Math.max(...planLosses);
  return setupLoss * 0.5 + average * 0.25 + worst * 0.25;
}

function getEngineEvidenceCpLoss({
  approval,
  confidence,
  supportCount,
  appearsInTopPv,
  maxLoss,
}: {
  approval: EnginePlan["approval"];
  confidence: EnginePlan["confidence"];
  supportCount: number;
  appearsInTopPv: boolean;
  maxLoss: number;
}) {
  const approvalLoss = (() => {
    switch (approval) {
      case "Strong":
        return appearsInTopPv ? 0 : maxLoss * 0.12;
      case "OK":
        return maxLoss * 0.38;
      case "Unclear":
        return maxLoss * 0.72;
      case "Weak":
        return maxLoss * 1.15;
    }
  })();
  const confidencePenalty =
    confidence === "High" ? 0 : confidence === "Medium" ? maxLoss * 0.08 : maxLoss * 0.16;
  const supportBonus = Math.min(maxLoss * 0.18, Math.max(0, supportCount - 1) * maxLoss * 0.05);

  return Math.max(0, approvalLoss + confidencePenalty - supportBonus);
}

function getEngineSetupBlendBaselines<
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

function formatEngineSetupBlendDetail({
  settings,
  score,
  engineCpLoss,
  engineUnsafe,
  databaseScore,
  databaseWdlLoss,
  practical,
  perspective,
}: {
  settings: MoveStrengthSettings;
  score: number;
  engineCpLoss: number | null;
  engineUnsafe: boolean;
  databaseScore: number | null;
  databaseWdlLoss: number | null;
  practical: EngineSetupPracticalMatch;
  perspective: "white" | "black";
}) {
  const parts = [`Blended strength ${score}`];
  parts.push(
    `${formatMoveStrengthMode(settings.mode)} mode, ${settings.engineWeight}% engine blend, max ${settings.maxEngineCpLoss} cp drop`,
  );
  parts.push(
    engineCpLoss === null
      ? "No engine CP-loss score"
      : `${formatEngineCpLoss(engineCpLoss)} engine CP loss versus the strongest available PV`,
  );
  parts.push(
    `Lichess All match ${practical.matchedComponents}/${practical.totalComponents} setup components (${practical.setup.games.toLocaleString()} games)`,
  );
  if (databaseScore === null) {
    parts.push("Practical WDL unavailable");
  } else {
    parts.push(`Practical WDL ${formatPercent(databaseScore)} for ${formatSideName(perspective)}`);
  }
  if (databaseWdlLoss !== null && databaseWdlLoss > 0) {
    parts.push(`${formatWdlPointLoss(databaseWdlLoss)} WDL points behind best matched setup`);
  }
  if (engineUnsafe) {
    parts.push("Over the configured CP-drop limit");
  }
  return parts.join(". ");
}

function formatMoveStrengthMode(mode: MoveStrengthSettings["mode"]) {
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

function formatSideName(side: "white" | "black") {
  return side === "white" ? "White" : "Black";
}

function formatEngineCpLoss(value: number) {
  return value <= 0 ? "0 cp" : `${Math.round(value)} cp`;
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

function planToLine(plan: EnginePlan): ColoredPlanExplorerLine | null {
  const segments = toPlanLineSegments(plan.routeSegments);
  if (segments.length > 0) {
    return {
      color: plan.color,
      squares: segments.flatMap(([from, to]) => [from, to]),
      segments,
      san: [],
      uci: [],
      games: plan.supportCount,
      white: 0,
      draw: 0,
      black: 0,
    };
  }

  if (!plan.routeSquares || plan.routeSquares.length < 2) return null;
  return {
    color: plan.color,
    squares: plan.routeSquares,
    san: [],
    uci: [],
    games: plan.supportCount,
    white: 0,
    draw: 0,
    black: 0,
  };
}

function compactEnginePlanLabel(plan: EnginePlan) {
  if (plan.routeSquares?.length) {
    const last = plan.routeSquares[plan.routeSquares.length - 1];
    switch (plan.category) {
      case "castling":
        return plan.label.replace(/^White |^Black /, "");
      case "pawnSetup":
      case "pawnBreak":
        return plan.color === "black" ? `...${last}` : last;
      case "pieceDestination":
        return plan.role ? `${pieceSymbol(plan.role)}${last}` : last;
      case "pieceRoute":
        return plan.role ? `${pieceSymbol(plan.role)}${plan.routeSquares.join("-")}` : last;
      case "sideExpansion":
        return plan.label.replace(/^White |^Black /, "");
    }
  }

  return plan.label.replace(/^White |^Black /, "");
}

function pieceSymbol(role: EnginePlan["role"]) {
  switch (role) {
    case "knight":
      return "N";
    case "bishop":
      return "B";
    case "rook":
      return "R";
    case "queen":
      return "Q";
    case "king":
      return "K";
    case "pawn":
    case undefined:
      return "";
  }
}

function buildEnginePlanCoachRequest(
  plan: EnginePlan,
  rootFen: string,
  totalPvs: number,
): PlanCoachInlineRequest {
  return {
    fen: rootFen,
    sideToMove: sideToMoveLabel(rootFen),
    surface: "Engine Plans",
    subjectKind: "plan",
    title: plan.label,
    summary: `${plan.label}. ${plan.explanation} If this resembles a named chess setup or structure, name it only when the position and route evidence support that label.`,
    planLines: [formatEnginePlanForCoach(plan, totalPvs)],
    stats: [
      "Source: local Stockfish PV plan extraction",
      `Position: ${sideToMoveLabel(rootFen)} to move`,
      `Category: ${categoryLabel(plan.category)}`,
      `Color: ${plan.color}`,
      plan.role ? `Piece: ${plan.role}` : null,
      `Engine approval: ${plan.approval}`,
      `Confidence: ${plan.confidence}`,
      `Support: ${plan.supportCount}/${totalPvs} PVs (${(plan.supportRatio * 100).toFixed(0)}%)`,
      `Top PV: ${plan.appearsInTopPv ? "yes" : "no"}`,
      `Best-line CP loss: ${formatNullableEngineCpLoss(plan.bestCpLoss)}`,
      `Weighted CP loss: ${formatNullableEngineCpLoss(plan.weightedCpLoss)}`,
      `Weighted eval: ${formatNullableEvalCp(plan.weightedEvalCp)}`,
      `Best supporting eval: ${formatNullableEvalCp(plan.bestEvalCp)}`,
      "Database stats: not present in this engine-only panel; use Plan Explorer rows for database WDL evidence.",
    ].filter((item): item is string => !!item),
    evidence: formatEngineEvidenceForCoach(plan.evidence),
  };
}

function buildEngineSetupCoachRequest(
  setup: EnginePlanSetup,
  rootFen: string,
  totalPvs: number,
  blend: EngineSetupBlend | null,
  verdict: EngineSetupVerdict,
): PlanCoachInlineRequest {
  return {
    fen: rootFen,
    sideToMove: sideToMoveLabel(rootFen),
    surface: "Engine Plans",
    subjectKind: "setup",
    title: setup.label,
    summary: `${setup.label}. Component plans: ${setup.plans
      .map(compactEnginePlanLabel)
      .join(
        ", ",
      )}. Explain whether this has features of a named setup, such as a King's Indian setup, Hedgehog, fianchetto setup, minority attack, or other standard structure, only when the supplied facts justify it.`,
    planLines: setup.plans.map((plan) => formatEnginePlanForCoach(plan, totalPvs)),
    stats: [
      blend
        ? "Source: local Stockfish PV setup extraction plus Lichess All practical setup match"
        : "Source: local Stockfish PV setup extraction",
      `Position: ${sideToMoveLabel(rootFen)} to move`,
      `Color: ${setup.color}`,
      `Engine approval: ${setup.approval}`,
      `Setup verdict: ${verdict.label}. ${verdict.detail}`,
      `Confidence: ${setup.confidence}`,
      `Support: ${setup.supportCount}/${totalPvs} PVs (${(setup.supportRatio * 100).toFixed(0)}%)`,
      `Top PV: ${setup.appearsInTopPv ? "yes" : "no"}`,
      `Best-line CP loss: ${formatNullableEngineCpLoss(setup.bestCpLoss)}`,
      `Weighted CP loss: ${formatNullableEngineCpLoss(setup.weightedCpLoss)}`,
      `Weighted eval: ${formatNullableEvalCp(setup.weightedEvalCp)}`,
      `Best supporting eval: ${formatNullableEvalCp(setup.bestEvalCp)}`,
      `Setup size: ${setup.plans.length} component plans`,
      blend
        ? `Blended strength: ${blend.label}. ${blend.detail}`
        : "Lichess All practical stats: no matching setup row available.",
    ].filter((item): item is string => !!item),
    evidence: [
      ...setup.plans.flatMap((plan) => formatEngineEvidenceForCoach(plan.evidence).slice(0, 2)),
      ...formatEngineEvidenceForCoach(setup.evidence).slice(0, 4),
    ],
  };
}

function formatEnginePlanForCoach(plan: EnginePlan, totalPvs: number) {
  return [
    `${categoryLabel(plan.category)}: ${plan.label}`,
    `route: ${formatEnginePlanRoute(plan)}`,
    `approval ${plan.approval}`,
    `confidence ${plan.confidence}`,
    `support ${plan.supportCount}/${totalPvs} PVs`,
    `CP loss ${formatNullableEngineCpLoss(plan.bestCpLoss)}`,
    `weighted eval ${formatNullableEvalCp(plan.weightedEvalCp)}`,
    plan.explanation,
  ].join("; ");
}

function formatEnginePlanRoute(plan: EnginePlan) {
  if (plan.routeSegments?.length) {
    return plan.routeSegments.map(([from, to]) => `${from}-${to}`).join(", ");
  }
  if (plan.routeSquares?.length) {
    return plan.routeSquares.join("-");
  }
  return "no route squares";
}

function formatEngineEvidenceForCoach(evidence: EnginePlan["evidence"]) {
  return evidence.slice(0, 4).map((line) => {
    const san = line.sanMoves.slice(0, 10).join(" ");
    return `PV${line.rank}: ${formatScoreValue(line.score.value)}, depth ${line.depth}, first move ${line.firstMove || "-"}, line ${san || "-"}.`;
  });
}

function formatNullableEvalCp(value: number | null) {
  return value === null ? "unavailable" : formatEvalCp(value);
}

function formatNullableEngineCpLoss(value: number | null) {
  return value === null ? "unavailable" : formatEngineCpLoss(value);
}

function sideToMoveLabel(fen: string) {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

function toPlanLineSegments(segments: [string, string][] | undefined) {
  return (
    segments
      ?.filter(
        (segment): segment is PlanExplorerSegment =>
          isSquareName(segment[0]) && isSquareName(segment[1]),
      )
      .map(([from, to]) => [from, to] as PlanExplorerSegment) ?? []
  );
}

function isSquareName(square: string) {
  return /^[a-h][1-8]$/.test(square);
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

function sideFilterLabel(filter: EnginePlanSideFilter) {
  switch (filter) {
    case "all":
      return "All plans";
    case "white":
      return "White plans";
    case "black":
      return "Black plans";
  }
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function countMovablePieces(fen: string) {
  const [pos] = positionFromFen(fen);
  return pos?.allDests().size ?? 0;
}

export default memo(EnginePlanExplorerPanel);
