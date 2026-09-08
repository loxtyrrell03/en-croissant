import {
  ActionIcon,
  Alert,
  Badge,
  Center,
  Group,
  Loader,
  Progress,
  Select,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconCpu, IconRefresh } from "@tabler/icons-react";
import { TacticalScanResult } from "./TacticalScanResult";
import { makeUci } from "chessops";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { useAtomValue } from "jotai";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { events, type BestMoves } from "@/bindings";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { activeTabAtom, enginesAtom } from "@/state/atoms";
import { getNodeAtPath } from "@/utils/treeReducer";
import { getBestMoves, killEngine, stopEngine, type LocalEngine } from "@/utils/engines";
import {
  buildTacticalEngineOptions,
  getLiveTacticalScanCacheKey,
  hasUsableLiveTacticalFallback,
  isLiveTacticalScanTerminal,
  LIVE_TACTICAL_SCAN_MULTIPV,
  selectLiveTacticalScanLines,
  type LiveTacticalScan,
} from "@/utils/tacticalMotifs/liveTactics";
import { classifyLiveTacticsInWorker } from "@/utils/tacticalMotifs/liveTacticsWorker";

const TACTICAL_SCAN_DEPTH = 16;
const TACTICAL_SCAN_DEBOUNCE_MS = 120;
const TACTICAL_SCAN_TIMEOUT_MS = 6_000;
const TACTICAL_STARTUP_TIMEOUT_MS = 12_000;
const TACTICAL_STOP_GRACE_MS = 600;
// Native UCI startup has two 15-second response timeouts. A cancelled
// invocation may register only after our first kill found no process yet.
const TACTICAL_CANCEL_CLEANUP_MS = 35_000;
const TACTICAL_SCAN_FALLBACK_MIN_DEPTH = 8;
const TACTICAL_SCAN_CACHE_LIMIT = 160;
const tacticalScanCache = new Map<string, LiveTacticalScan>();

type TacticalPanelState =
  | { status: "idle"; progress: number; scan: null; error: null }
  | { status: "scanning"; progress: number; scan: null; error: null }
  | { status: "classifying"; progress: number; scan: null; error: null }
  | { status: "finished"; progress: number; scan: null; error: null }
  | { status: "complete"; progress: number; scan: LiveTacticalScan; error: null }
  | { status: "error"; progress: number; scan: null; error: string };

const INITIAL_STATE: TacticalPanelState = {
  status: "idle",
  progress: 0,
  scan: null,
  error: null,
};

function rememberScan(key: string, scan: LiveTacticalScan) {
  tacticalScanCache.delete(key);
  tacticalScanCache.set(key, scan);
  while (tacticalScanCache.size > TACTICAL_SCAN_CACHE_LIMIT) {
    const oldest = tacticalScanCache.keys().next().value;
    if (!oldest) break;
    tacticalScanCache.delete(oldest);
  }
}

function TacticalClassifierPanel({
  onScanChange,
}: {
  onScanChange: (scan: LiveTacticalScan | null) => void;
}) {
  const store = useContext(TreeStateContext)!;
  const activeTab = useAtomValue(activeTabAtom);
  const engines = useAtomValue(enginesAtom);
  const [engineId, setEngineId] = useState<string | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [state, setState] = useState<TacticalPanelState>(INITIAL_STATE);
  const requestTokenRef = useRef(0);

  const position = useStore(
    store,
    useShallow((tree) => {
      const node = tree.currentNode();
      const parent = tree.position.length
        ? getNodeAtPath(tree.root, tree.position.slice(0, -1))
        : null;
      return {
        fen: node.fen,
        lastMoveSan: node.san,
        previousFen: parent?.fen ?? null,
        previousMoveUci: node.move ? makeUci(node.move) : null,
      };
    }),
  );

  const localEngines = useMemo(
    () => (engines ?? []).filter((engine): engine is LocalEngine => engine.type === "local"),
    [engines],
  );
  const selectedEngine = useMemo(
    () => localEngines.find((engine) => engine.id === engineId) ?? localEngines[0] ?? null,
    [engineId, localEngines],
  );
  const scanCacheKey = useMemo(
    () =>
      selectedEngine
        ? getLiveTacticalScanCacheKey({
            fen: position.fen,
            engineId: selectedEngine.id,
            depth: TACTICAL_SCAN_DEPTH,
            multipv: LIVE_TACTICAL_SCAN_MULTIPV,
            previousFen: position.previousFen,
            previousMoveUci: position.previousMoveUci,
          })
        : "",
    [position.fen, position.previousFen, position.previousMoveUci, selectedEngine],
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
    const engine = selectedEngine;
    if (!engine) {
      setState(INITIAL_STATE);
      onScanChange(null);
      return;
    }

    const chess = parseFen(position.fen).chain((setup) => Chess.fromSetup(setup));
    if (chess.isErr) {
      setState({
        status: "error",
        progress: 0,
        scan: null,
        error: "This position is not legal and cannot be analysed.",
      });
      onScanChange(null);
      return;
    }
    if (chess.value.isEnd()) {
      setState({ status: "finished", progress: 100, scan: null, error: null });
      onScanChange(null);
      return;
    }

    const cached = tacticalScanCache.get(scanCacheKey);
    if (cached) {
      setState({ status: "complete", progress: 100, scan: cached, error: null });
      onScanChange(cached);
      return;
    }

    const requestToken = requestTokenRef.current + 1;
    requestTokenRef.current = requestToken;
    const requestTab = `tactical-classifier:${activeTab ?? "board"}:${crypto.randomUUID()}`;
    let cancelled = false;
    let settled = false;
    let classifying = false;
    const classificationController = new AbortController();
    let unlisten: (() => void) | null = null;
    let searchStarted = false;
    let engineReleased = false;
    let engineResponded = false;
    let engineCommandEnded = false;
    let stopping = false;
    let cleanupTimeout: number | null = null;
    let scanTimeout: number | null = null;
    let latestLines: BestMoves[] = [];

    setState({ status: "scanning", progress: 0, scan: null, error: null });
    onScanChange(null);

    const isCurrentRequest = () =>
      !cancelled && requestTokenRef.current === requestToken && !settled;

    const clearScanTimeout = () => {
      if (scanTimeout !== null) {
        window.clearTimeout(scanTimeout);
        scanTimeout = null;
      }
    };

    const releaseEngine = () => {
      if (!searchStarted || engineReleased) return;
      engineReleased = true;
      void killEngine(engine, requestTab).catch(() => {});
    };

    const disposeListener = () => {
      if (cleanupTimeout !== null) window.clearTimeout(cleanupTimeout);
      cleanupTimeout = null;
      unlisten?.();
      unlisten = null;
    };

    const cleanupEngine = () => {
      releaseEngine();
      if (!searchStarted || engineResponded || engineCommandEnded) {
        disposeListener();
        return;
      }
      // Retain a cleanup-only listener across cancellation during startup.
      // Its first late event proves native registration and triggers another
      // kill, never classification or a board update.
      cleanupTimeout ??= window.setTimeout(() => {
        void killEngine(engine, requestTab).catch(() => {});
        disposeListener();
      }, TACTICAL_CANCEL_CLEANUP_MS);
    };

    const finishScan = (lines: BestMoves[], minimumDepth: number) => {
      if (!isCurrentRequest()) return false;
      const usableLines = selectLiveTacticalScanLines(
        lines,
        LIVE_TACTICAL_SCAN_MULTIPV,
        minimumDepth,
      );
      const bestLine = usableLines[0];
      if (!bestLine) return false;

      if (classifying) return false;
      classifying = true;
      clearScanTimeout();
      disposeListener();
      releaseEngine();
      setState({ status: "classifying", progress: 99, scan: null, error: null });
      void classifyLiveTacticsInWorker(
        {
          fen: position.fen,
          pvUci: bestLine.uciMoves,
          pvSan: bestLine.sanMoves,
          engineName: engine.version ? `${engine.name} ${engine.version}` : engine.name,
          depth: bestLine.depth || TACTICAL_SCAN_DEPTH,
          previousFen: position.previousFen,
          previousMoveUci: position.previousMoveUci,
          variations: usableLines.map((line) => ({
            multipv: line.multipv,
            depth: line.depth,
            pvUci: line.uciMoves,
            pvSan: line.sanMoves,
            cp:
              line.score.value.type === "cp"
                ? line.score.value.value * (position.fen.split(" ")[1] === "b" ? -1 : 1)
                : null,
            mate:
              line.score.value.type === "mate"
                ? line.score.value.value * (position.fen.split(" ")[1] === "b" ? -1 : 1)
                : null,
          })),
        },
        classificationController.signal,
      )
        .then((scan) => {
          if (!isCurrentRequest()) return;
          settled = true;
          rememberScan(scanCacheKey, scan);
          setState({ status: "complete", progress: 100, scan, error: null });
          onScanChange(scan);
        })
        .catch(failScan);
      return true;
    };

    const failScan = (caught: unknown) => {
      if (!isCurrentRequest()) return;
      settled = true;
      clearScanTimeout();
      setState({
        status: "error",
        progress: 0,
        scan: null,
        error: caught instanceof Error ? caught.message : String(caught),
      });
      onScanChange(null);
      cleanupEngine();
    };

    const receiveLines = (lines: BestMoves[], progress: number) => {
      if (!isCurrentRequest() || classifying) return;
      if (!engineResponded && lines.some((line) => line.uciMoves.length > 0)) {
        engineResponded = true;
        clearScanTimeout();
        scanTimeout = window.setTimeout(handleScanTimeout, TACTICAL_SCAN_TIMEOUT_MS);
      }
      const usableSnapshot = selectLiveTacticalScanLines(lines);
      if (usableSnapshot.length > 0) {
        const nextDepth = Math.max(...usableSnapshot.map((line) => line.depth));
        const latestDepth = Math.max(0, ...latestLines.map((line) => line.depth));
        if (nextDepth >= latestDepth) latestLines = usableSnapshot;
      }
      setState((current) =>
        current.status === "scanning"
          ? { ...current, progress: Math.max(current.progress, progress) }
          : current,
      );
      const minimumDepth = stopping ? TACTICAL_SCAN_FALLBACK_MIN_DEPTH : TACTICAL_SCAN_DEPTH;
      if (isLiveTacticalScanTerminal(progress, latestLines, minimumDepth)) {
        finishScan(latestLines, minimumDepth);
      }
    };

    const handleScanTimeout = () => {
      if (!isCurrentRequest()) return;
      if (
        hasUsableLiveTacticalFallback(latestLines, TACTICAL_SCAN_FALLBACK_MIN_DEPTH) &&
        finishScan(latestLines, TACTICAL_SCAN_FALLBACK_MIN_DEPTH)
      ) {
        return;
      }
      if (engineResponded && !stopping) {
        stopping = true;
        // `stop` flushes the unthrottled final snapshot. Do not discard a
        // completed depth merely because its intermediate event was throttled.
        scanTimeout = window.setTimeout(handleScanTimeout, TACTICAL_STOP_GRACE_MS);
        void stopEngine(engine, requestTab).catch((error) => {
          if (!classifying) failScan(error);
        });
        return;
      }
      failScan(
        new Error(
          engineResponded
            ? `${engine.name} stopped before reaching a usable depth. Try scanning again when other engine searches have finished.`
            : `${engine.name} did not start returning analysis within ${TACTICAL_STARTUP_TIMEOUT_MS / 1000} seconds. Check that the engine can start, then retry.`,
        ),
      );
    };

    const timer = window.setTimeout(() => {
      if (!isCurrentRequest()) return;
      scanTimeout = window.setTimeout(handleScanTimeout, TACTICAL_STARTUP_TIMEOUT_MS);

      void (async () => {
        try {
          const dispose = await events.bestMovesPayload.listen(({ payload }) => {
            if (
              payload.engine !== engine.id ||
              payload.tab !== requestTab ||
              payload.fen !== position.fen ||
              payload.moves.length !== 0
            ) {
              return;
            }
            if (!isCurrentRequest()) {
              void killEngine(engine, requestTab).catch(() => {});
              disposeListener();
              return;
            }
            receiveLines(payload.bestLines, payload.progress);
          });

          if (!isCurrentRequest()) {
            dispose();
            return;
          }
          unlisten = dispose;

          searchStarted = true;
          void getBestMoves(
            engine,
            requestTab,
            { t: "Depth", c: TACTICAL_SCAN_DEPTH },
            {
              fen: position.fen,
              moves: [],
              extraOptions: buildTacticalEngineOptions(engine.settings, LIVE_TACTICAL_SCAN_MULTIPV),
            },
          )
            .then((result) => {
              if (result) receiveLines(result[1], result[0]);
            })
            .catch((error) => {
              // Releasing the native engine after a complete snapshot can reject
              // its outstanding request. It cannot invalidate worker verification.
              if (!classifying) failScan(error);
            })
            .finally(() => {
              engineCommandEnded = true;
              if (!isCurrentRequest()) disposeListener();
            });
        } catch (caught) {
          failScan(caught);
        }
      })();
    }, TACTICAL_SCAN_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      classificationController.abort();
      requestTokenRef.current++;
      window.clearTimeout(timer);
      clearScanTimeout();
      cleanupEngine();
    };
  }, [
    activeTab,
    onScanChange,
    position.fen,
    position.previousFen,
    position.previousMoveUci,
    refreshRevision,
    scanCacheKey,
    selectedEngine,
  ]);

  return (
    <Stack h="100%" gap="xs" p="sm">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Select
          aria-label="Tactical scan engine"
          data={localEngines.map((engine) => ({ value: engine.id, label: engine.name }))}
          value={selectedEngine?.id ?? null}
          onChange={setEngineId}
          placeholder="Local engine"
          searchable
          allowDeselect={false}
          leftSection={<IconCpu size="1rem" />}
          disabled={localEngines.length === 0}
          style={{ flex: 1 }}
          comboboxProps={{ withinPortal: true }}
        />
        <Badge variant="light">
          Depth {state.status === "complete" ? state.scan.depth : TACTICAL_SCAN_DEPTH} ·{" "}
          {state.status === "complete" ? state.scan.variations.length : LIVE_TACTICAL_SCAN_MULTIPV}{" "}
          lines
        </Badge>
        <Tooltip label="Scan this position again">
          <ActionIcon
            aria-label="Scan this position again"
            variant="default"
            size="lg"
            disabled={
              !selectedEngine || state.status === "scanning" || state.status === "classifying"
            }
            onClick={() => {
              tacticalScanCache.delete(scanCacheKey);
              setRefreshRevision((value) => value + 1);
            }}
          >
            <IconRefresh size="1rem" />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Progress
        value={
          state.status === "scanning" || state.status === "classifying"
            ? Math.min(99, state.progress)
            : state.progress
        }
        animated={state.status === "scanning" || state.status === "classifying"}
        size="xs"
      />

      {localEngines.length === 0 ? (
        <Alert color="orange" title="A local engine is required">
          Add a local engine in Engines. Tactical scans start only while this tab is open and the
          engine is released when each scan finishes.
        </Alert>
      ) : state.status === "finished" ? (
        <Alert title="Position finished">
          This position is already finished; no tactical scan is needed.
        </Alert>
      ) : state.status === "error" ? (
        <Alert color="red" title="Tactical scan failed">
          {state.error}
        </Alert>
      ) : state.status === "scanning" || state.status === "classifying" ? (
        <Center flex={1}>
          <Stack align="center" gap="xs" ta="center">
            <Loader size="sm" />
            <Text fw={700}>
              {state.status === "classifying"
                ? "Verifying tactical themes…"
                : "Scanning the forcing line…"}
            </Text>
            <Text size="sm" c="dimmed" maw={360}>
              {state.status === "classifying"
                ? "Checking legal defences and choosing the main lesson."
                : `Checking the position${position.lastMoveSan ? ` after ${position.lastMoveSan}` : ""} with ${selectedEngine?.name}.`}
            </Text>
          </Stack>
        </Center>
      ) : state.status === "complete" ? (
        <>
          {state.scan.depth < TACTICAL_SCAN_DEPTH && (
            <Text size="xs" c="dimmed">
              Time-limited scan at depth {state.scan.depth}; candidate coverage may be incomplete.
            </Text>
          )}
          <TacticalScanResult
            scan={state.scan}
            lastMoveSan={position.lastMoveSan}
            onPreviewChange={onScanChange}
          />
        </>
      ) : null}
    </Stack>
  );
}

export default TacticalClassifierPanel;
