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
import { getBestMoves, stopEngine, type LocalEngine } from "@/utils/engines";
import {
  buildLiveTacticalScan,
  buildTacticalEngineOptions,
  getLiveTacticalScanCacheKey,
  tacticalMotifDescription,
  type LiveTacticalScan,
} from "@/utils/tacticalMotifs/liveTactics";

const TACTICAL_SCAN_DEPTH = 16;
const TACTICAL_SCAN_DEBOUNCE_MS = 120;
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
    let finished = false;
    let unlisten: (() => void) | null = null;
    let started = false;

    setState({ status: "scanning", progress: 0, scan: null, error: null });
    onScanChange(null);

    const timer = window.setTimeout(() => {
      if (cancelled || requestTokenRef.current !== requestToken) return;
      started = true;

      void events.bestMovesPayload
        .listen(({ payload }) => {
          if (
            cancelled ||
            requestTokenRef.current !== requestToken ||
            payload.engine !== engine.id ||
            payload.tab !== requestTab ||
            payload.fen !== position.fen ||
            payload.moves.length !== 0
          ) {
            return;
          }
          setState((current) =>
            current.status === "scanning"
              ? { ...current, progress: Math.max(current.progress, payload.progress) }
              : current,
          );
        })
        .then((dispose) => {
          if (finished || cancelled || requestTokenRef.current !== requestToken) {
            dispose();
          } else {
            unlisten = dispose;
          }
        })
        .catch(() => {
          // Completion from getBestMoves remains authoritative if progress events are unavailable.
        });

      void getBestMoves(
        engine,
        requestTab,
        { t: "Depth", c: TACTICAL_SCAN_DEPTH },
        {
          fen: position.fen,
          moves: [],
          extraOptions: buildTacticalEngineOptions(engine.settings),
        },
      )
        .then((result) => {
          if (cancelled || requestTokenRef.current !== requestToken) return;
          const bestLine = selectBestLine(result?.[1]);
          if (!bestLine) {
            throw new Error("The engine returned no principal variation for this position.");
          }
          const scan = buildLiveTacticalScan({
            fen: position.fen,
            pvUci: bestLine.uciMoves,
            pvSan: bestLine.sanMoves,
            engineName: engine.version ? `${engine.name} ${engine.version}` : engine.name,
            depth: bestLine.depth || TACTICAL_SCAN_DEPTH,
            previousFen: position.previousFen,
            previousMoveUci: position.previousMoveUci,
          });
          rememberScan(scanCacheKey, scan);
          setState({ status: "complete", progress: 100, scan, error: null });
          onScanChange(scan);
        })
        .catch((caught) => {
          if (cancelled || requestTokenRef.current !== requestToken) return;
          setState({
            status: "error",
            progress: 0,
            scan: null,
            error: caught instanceof Error ? caught.message : String(caught),
          });
          onScanChange(null);
        })
        .finally(() => {
          finished = true;
          unlisten?.();
          unlisten = null;
          void stopEngine(engine, requestTab).catch(() => {});
        });
    }, TACTICAL_SCAN_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      requestTokenRef.current++;
      window.clearTimeout(timer);
      unlisten?.();
      if (started) {
        void stopEngine(engine, requestTab).catch(() => {});
      }
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
        <Badge variant="light">Depth {TACTICAL_SCAN_DEPTH}</Badge>
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
              Checking the position{position.lastMoveSan ? ` after ${position.lastMoveSan}` : ""}
              with {selectedEngine?.name}.
            </Text>
          </Stack>
        </Center>
      ) : state.status === "complete" ? (
        <TacticalScanResult scan={state.scan} lastMoveSan={position.lastMoveSan} />
      ) : null}
    </Stack>
  );
}

function selectBestLine(lines: BestMoves[] | null | undefined) {
  return (lines ?? []).find((line) => line.multipv === 1 && line.uciMoves.length > 0) ?? lines?.[0];
}

function TacticalScanResult({
  scan,
  lastMoveSan,
}: {
  scan: LiveTacticalScan;
  lastMoveSan: string | null;
}) {
  const sideLabel = scan.side === "white" ? "White" : "Black";
  const line = scan.lineSan.length > 0 ? scan.lineSan : scan.lineUci;

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
                motif in the engine's best line from this position.
              </Text>
            </Stack>
          </Center>
        )}

        {scan.motifs.map((motif) => (
          <Paper key={motif.id} withBorder p="sm" radius="md">
            <Stack gap={6}>
              <Group justify="space-between" gap="xs">
                <Badge color="orange" variant="filled">
                  {motif.label}
                </Badge>
                <Group gap={6}>
                  {motif.ply && <Badge variant="light">Ply {motif.ply}</Badge>}
                  <Badge color={motif.confidence === "high" ? "green" : "yellow"} variant="light">
                    {motif.confidence} confidence
                  </Badge>
                </Group>
              </Group>
              <Text size="sm">{tacticalMotifDescription(motif)}</Text>
              {motif.moveUci && (
                <Text size="xs" c="dimmed">
                  Triggering move: <Code>{motif.moveUci}</Code>
                </Text>
              )}
            </Stack>
          </Paper>
        ))}

        <Paper withBorder p="sm" radius="md">
          <Stack gap={6}>
            <Text fw={700} size="sm">
              Forcing line
            </Text>
            <Box>
              <Code style={{ whiteSpace: "normal", lineHeight: 1.7 }}>{line.join("  ")}</Code>
            </Box>
            <Text size="xs" c="dimmed">
              {scan.engineName} · depth {scan.depth} · classifier {scan.motifClassifierVersion}
            </Text>
          </Stack>
        </Paper>
      </Stack>
    </ScrollArea>
  );
}

export default TacticalClassifierPanel;
