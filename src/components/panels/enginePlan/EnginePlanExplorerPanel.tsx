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
import { events, type BestMoves, type EngineOption, type GoMode } from "@/bindings";
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
  enginesAtom,
  planExplorerArrowLimitAtom,
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
} from "@/utils/enginePlanExplorer";
import {
  type EngineSettings,
  type LocalEngine,
  getBestMoves as getLocalBestMoves,
  stopEngine,
} from "@/utils/engines";
import {
  isPlanBrush,
  planLineToShapes,
  type ColoredPlanExplorerLine,
  type PlanExplorerSegment,
} from "@/utils/planExplorer";
import { positionFromFen } from "@/utils/chessops";

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
type EnginePlanSortKey = "plan" | "strength" | "support" | "eval" | "confidence";
type EnginePlanSort = {
  key: EnginePlanSortKey;
  direction: SortDirection;
};
type EnginePlanSideFilter = "all" | "white" | "black";

function EnginePlanExplorerPanel() {
  const store = useContext(TreeStateContext)!;
  const fen = useStore(store, (s) => s.currentNode().fen);
  const currentNode = useStore(store, (s) => s.currentNode());
  const currentPosition = useStore(store, (s) => s.position);
  const setShapes = useStore(store, (s) => s.setShapes);
  const makeMoves = useStore(store, (s) => s.makeMoves);
  const goToMove = useStore(store, (s) => s.goToMove);
  const engines = useAtomValue(enginesAtom);
  const activeTab = useAtomValue(activeTabAtom);
  const setBoardPreviewShapes = useSetAtom(currentBoardPreviewShapesAtom);
  const setEnginePlanData = useSetAtom(currentEnginePlanExplorerDataAtom);
  const setPreviewLine = useSetAtom(currentPlanExplorerPreviewLineAtom);
  const [multipv, setMultipv] = useAtom(enginePlanMultipvAtom);
  const [limitMode, setLimitMode] = useAtom(enginePlanLimitModeAtom);
  const [depth, setDepth] = useAtom(enginePlanDepthAtom);
  const [timeMs, setTimeMs] = useAtom(enginePlanTimeMsAtom);
  const [sideFilter, setSideFilter] = useAtom(enginePlanSideFilterAtom);
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

  const cleanupListener = useCallback(() => {
    unlistenRef.current?.();
    unlistenRef.current = null;
  }, []);

  const localEngines = useMemo(
    () =>
      (engines ?? []).filter(
        (engine): engine is LocalEngine => engine.type === "local",
      ),
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
    };
  }, [sideFilter, visibleReport]);

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
        requestRef.current = null;
        cleanupListener();
      }
    },
    [cleanupListener, setPlanState],
  );

  const runAnalysis = useCallback(async (forceRefresh = false) => {
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
  }, [
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
  ]);

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
            </Group>
            <Text size="xs" c="dimmed">
              Raw eval details are kept inside each plan.
            </Text>
          </Group>

          {!filteredReport || filteredReport.plans.length === 0 ? (
            <Text ta="center" c="dimmed" py="xl">
              {sideFilter === "all"
                ? "No plan signals found in the PVs."
                : `No ${sideFilter} plan signals found in the PVs.`}
            </Text>
          ) : (
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
                      report:
                        current.reportCacheKey === analysisCacheKey ? null : current.report,
                      reportCacheKey:
                        current.reportCacheKey === analysisCacheKey
                          ? null
                          : current.reportCacheKey,
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
          <SortableEngineTh
            sortKey="strength"
            sort={sort}
            setSort={setSort}
            style={{ width: 118 }}
          >
            Strength
          </SortableEngineTh>
          <SortableEngineTh
            sortKey="support"
            sort={sort}
            setSort={setSort}
            style={{ width: 110 }}
          >
            Support
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
        <Badge color={approvalColor(plan.approval)} variant="light">
          {plan.approval}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Stack gap={0}>
          <Text size="sm">{`${plan.supportCount}/${totalPvs}`}</Text>
          <Text size="xs" c="dimmed">
            {`${(plan.supportRatio * 100).toFixed(0)}%`}
          </Text>
        </Stack>
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
        diff =
          engineApprovalScore(a.approval) - engineApprovalScore(b.approval) ||
          a.supportCount - b.supportCount;
        break;
      case "support":
        diff = a.supportCount - b.supportCount || a.supportRatio - b.supportRatio;
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

function toPlanLineSegments(segments: [string, string][] | undefined) {
  return (
    segments
      ?.filter((segment): segment is PlanExplorerSegment =>
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
