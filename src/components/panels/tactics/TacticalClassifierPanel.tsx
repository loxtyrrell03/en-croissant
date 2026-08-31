import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Center,
  Code,
  Group,
  Loader,
  Paper,
  Progress,
  ScrollArea,
  Select,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { IconBolt, IconCpu, IconRefresh } from "@tabler/icons-react";
import { makeUci } from "chessops";
import { useAtomValue } from "jotai";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { events, type BestMoves } from "@/bindings";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { activeTabAtom, enginesAtom } from "@/state/atoms";
import { getNodeAtPath } from "@/utils/treeReducer";
import { getBestMoves, killEngine, type LocalEngine } from "@/utils/engines";
import {
  buildLiveTacticalScan,
  buildTacticalEngineOptions,
  getLiveTacticalScanCacheKey,
  hasUsableLiveTacticalFallback,
  isLiveTacticalScanTerminal,
  LIVE_TACTICAL_SCAN_MULTIPV,
  selectLiveTacticalScanLines,
  tacticalMotifDescription,
  type LiveTacticalScan,
} from "@/utils/tacticalMotifs/liveTactics";

const TACTICAL_SCAN_DEPTH = 16;
const TACTICAL_SCAN_DEBOUNCE_MS = 120;
const TACTICAL_SCAN_TIMEOUT_MS = 6_000;
const TACTICAL_SCAN_FALLBACK_MIN_DEPTH = 8;
const TACTICAL_SCAN_CACHE_LIMIT = 160;
const tacticalScanCache = new Map<string, LiveTacticalScan>();

type TacticalPanelState =
  | { status: "idle"; progress: number; scan: null; error: null }
  | { status: "scanning"; progress: number; scan: null; error: null }
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

    const cached = tacticalScanCache.get(scanCacheKey);
    if (cached) {
      setState({ status: "complete", progress: 100, scan: cached, error: null });
      onScanChange(cached);
      return;
    }

    const requestToken = requestTokenRef.current + 1;
    requestTokenRef.current = requestToken;
    const requestTab = `tactical-classifier:${activeTab ?? "board"}:${requestToken}`;
    let cancelled = false;
    let settled = false;
    let unlisten: (() => void) | null = null;
    let searchStarted = false;
    let engineReleased = false;
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
      unlisten?.();
      unlisten = null;
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

      settled = true;
      clearScanTimeout();
      disposeListener();
      const scan = buildLiveTacticalScan({
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
        })),
      });
      rememberScan(scanCacheKey, scan);
      setState({ status: "complete", progress: 100, scan, error: null });
      onScanChange(scan);
      releaseEngine();
      return true;
    };

    const failScan = (caught: unknown) => {
      if (!isCurrentRequest()) return;
      settled = true;
      clearScanTimeout();
      disposeListener();
      setState({
        status: "error",
        progress: 0,
        scan: null,
        error: caught instanceof Error ? caught.message : String(caught),
      });
      onScanChange(null);
      releaseEngine();
    };

    const receiveLines = (lines: BestMoves[], progress: number) => {
      if (!isCurrentRequest()) return;
      if (lines.length > 0) {
        const nextDepth = Math.max(...lines.map((line) => line.depth));
        const latestDepth = Math.max(0, ...latestLines.map((line) => line.depth));
        if (nextDepth >= latestDepth) latestLines = lines;
      }
      setState((current) =>
        current.status === "scanning"
          ? { ...current, progress: Math.max(current.progress, progress) }
          : current,
      );
      if (isLiveTacticalScanTerminal(progress, latestLines, TACTICAL_SCAN_DEPTH)) {
        finishScan(latestLines, TACTICAL_SCAN_DEPTH);
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
      failScan(
        new Error(
          `${engine.name} did not return a usable tactical line within ${TACTICAL_SCAN_TIMEOUT_MS / 1000} seconds.`,
        ),
      );
    };

    const timer = window.setTimeout(() => {
      if (!isCurrentRequest()) return;
      scanTimeout = window.setTimeout(handleScanTimeout, TACTICAL_SCAN_TIMEOUT_MS);

      void (async () => {
        try {
          const dispose = await events.bestMovesPayload.listen(({ payload }) => {
            if (
              !isCurrentRequest() ||
              payload.engine !== engine.id ||
              payload.tab !== requestTab ||
              payload.fen !== position.fen ||
              payload.moves.length !== 0
            ) {
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
            .catch(failScan);
        } catch (caught) {
          failScan(caught);
        }
      })();
    }, TACTICAL_SCAN_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      requestTokenRef.current++;
      window.clearTimeout(timer);
      clearScanTimeout();
      disposeListener();
      releaseEngine();
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
          Depth {TACTICAL_SCAN_DEPTH} · {LIVE_TACTICAL_SCAN_MULTIPV} lines
        </Badge>
        <Tooltip label="Scan this position again">
          <ActionIcon
            aria-label="Scan this position again"
            variant="default"
            size="lg"
            disabled={!selectedEngine || state.status === "scanning"}
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
        value={state.status === "scanning" ? Math.min(99, state.progress) : state.progress}
        animated={state.status === "scanning"}
        size="xs"
      />

      {localEngines.length === 0 ? (
        <Alert color="orange" title="A local engine is required">
          Add a local engine in Engines. Tactical scans start only while this tab is open and the
          engine is released when each scan finishes.
        </Alert>
      ) : state.status === "error" ? (
        <Alert color="red" title="Tactical scan failed">
          {state.error}
        </Alert>
      ) : state.status === "scanning" ? (
        <Center flex={1}>
          <Stack align="center" gap="xs" ta="center">
            <Loader size="sm" />
            <Text fw={700}>Scanning the forcing line…</Text>
            <Text size="sm" c="dimmed" maw={360}>
              {`Checking the position${position.lastMoveSan ? ` after ${position.lastMoveSan}` : ""} with ${selectedEngine?.name}.`}
            </Text>
          </Stack>
        </Center>
      ) : state.status === "complete" ? (
        <TacticalScanResult scan={state.scan} lastMoveSan={position.lastMoveSan} />
      ) : null}
    </Stack>
  );
}

function TacticalScanResult({
  scan,
  lastMoveSan,
}: {
  scan: LiveTacticalScan;
  lastMoveSan: string | null;
}) {
  const sideLabel = scan.side === "white" ? "White" : "Black";
  const tacticalVariations = scan.variations.filter((variation) => variation.motifs.length > 0);
  const principalLine = scan.lineSan.length > 0 ? scan.lineSan : scan.lineUci;

  return (
    <ScrollArea flex={1} offsetScrollbars>
      <Stack gap="sm" aria-live="polite">
        {scan.motifs.length > 0 ? (
          <Alert
            color="orange"
            icon={<IconBolt size="1rem" />}
            title={`${scan.motifs.map((motif) => motif.label).join(" · ")} found`}
          >
            {sideLabel} has a forcing tactical line
            {lastMoveSan ? ` after ${lastMoveSan}` : ""}. The matching move arrows and theme labels
            are shown on the board.
          </Alert>
        ) : (
          <Center py="xl">
            <Stack align="center" gap="xs" ta="center">
              <ThemeIcon size="xl" radius="xl" variant="light" color="gray">
                <IconBolt size="1.25rem" />
              </ThemeIcon>
              <Text fw={700}>No forcing tactical theme found</Text>
              <Text size="sm" c="dimmed" maw={390}>
                The classifier found no specific fork, pin, interference, mating pattern, or related
                motif in the engine's candidate lines from this position.
              </Text>
            </Stack>
          </Center>
        )}

        {tacticalVariations.map((variation) => {
          const line = variation.lineSan.length > 0 ? variation.lineSan : variation.lineUci;
          const rootMove = line[0] ?? `PV ${variation.multipv}`;

          return (
            <Paper
              key={`${variation.multipv}:${variation.lineUci[0] ?? "line"}`}
              withBorder
              p="sm"
              radius="md"
            >
              <Stack gap={6}>
                <Group justify="space-between" gap="xs">
                  <Group gap={6}>
                    <Badge color="blue" variant="light">
                      {rootMove}
                    </Badge>
                    {variation.motifs.map((motif) => (
                      <Badge key={motif.id} color="orange" variant="filled">
                        {motif.label}
                      </Badge>
                    ))}
                  </Group>
                  <Badge variant="light">PV {variation.multipv}</Badge>
                </Group>
                {variation.motifs.map((motif) => (
                  <Stack key={motif.id} gap={2}>
                    <Text size="sm">{tacticalMotifDescription(motif)}</Text>
                    {motif.moveUci && (
                      <Text size="xs" c="dimmed">
                        Triggering move: <Code>{motif.moveUci}</Code> · {motif.confidence}{" "}
                        confidence
                      </Text>
                    )}
                  </Stack>
                ))}
                <Box>
                  <Code style={{ whiteSpace: "normal", lineHeight: 1.7 }}>{line.join("  ")}</Code>
                </Box>
              </Stack>
            </Paper>
          );
        })}

        {tacticalVariations.length === 0 && principalLine.length > 0 && (
          <Paper withBorder p="sm" radius="md">
            <Stack gap={6}>
              <Text fw={700} size="sm">
                Engine line
              </Text>
              <Box>
                <Code style={{ whiteSpace: "normal", lineHeight: 1.7 }}>
                  {principalLine.join("  ")}
                </Code>
              </Box>
            </Stack>
          </Paper>
        )}

        <Paper withBorder p="sm" radius="md">
          <Text size="xs" c="dimmed">
            {scan.engineName} · depth {scan.depth} · {scan.variations.length} candidate
            {scan.variations.length === 1 ? "" : "s"} · classifier {scan.motifClassifierVersion}
          </Text>
        </Paper>
      </Stack>
    </ScrollArea>
  );
}

export default TacticalClassifierPanel;
