import {
  Alert,
  Box,
  Button,
  Group,
  NumberInput,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { TournamentHelp } from "@/features/tournaments/TournamentHelp";
import { GAME_ANALYSIS_PRESETS } from "@/utils/gameAnalysisSettings";
import { gameReportGameKey } from "@/utils/gameReportOwnership";
import { treeIteratorMainLine } from "@/utils/treeReducer";
import {
  validReportSearchLimits,
  type ReportSearchLimits,
} from "../../scripts/uci-report-search.mjs";
import {
  analyzeWebGameReport,
  readWebGameReport,
  savedWebGameReport,
  webReportTree,
  type WebReportGame,
} from "./gameReport";
import { usePcServicesAvailability } from "./pcServices";
import { webStateSession, type createWebStateSession } from "./webStateSession";

const PREFS = "en-croissant-phone-game-report-limits";
const freshLimits = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS) ?? "null");
    if (validReportSearchLimits(saved)) return saved;
  } catch {
    /* In-memory defaults remain usable. */
  }
  return { depth: 16, timeMs: 250 };
};
type Restored = NonNullable<Awaited<ReturnType<typeof readWebGameReport>>>;
export default function WebGameReportPanel({
  game,
  onSelectPly,
  onBusy,
  blocked = false,
  session = webStateSession,
}: {
  game: WebReportGame;
  onSelectPly: (ply: number) => void;
  onBusy: (busy: boolean) => void;
  blocked?: boolean;
  session?: ReturnType<typeof createWebStateSession>;
}) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const availability = usePcServicesAvailability();
  const [limits, setLimits] = useState<ReportSearchLimits>(freshLimits);
  const [custom, setCustom] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [identity, setIdentity] = useState<{ raw: string; id: string } | null>(null);
  const [restored, setRestored] = useState<{
    raw: string;
    saved: Restored | null;
    pending: Restored | null;
  } | null>(null);
  const request = useRef<AbortController | null>(null);
  const gameIdentity = useMemo(() => {
    try {
      return { raw: gameReportGameKey(webReportTree(game).tree.root)!, error: "" };
    } catch (failure) {
      return {
        raw: "",
        error: failure instanceof Error ? failure.message : "Choose a replayable game.",
      };
    }
  }, [game]);
  const latest = useRef(gameIdentity.raw);
  latest.current = gameIdentity.raw;
  const busyRef = useRef(onBusy);
  busyRef.current = onBusy;

  useEffect(() => {
    let active = true;
    const old = request.current;
    if (old) {
      old.abort();
      request.current = null;
      setRunning(false);
      busyRef.current(false);
    }
    setError("");
    setNotice(old ? "Game changed. The previous analysis was cancelled." : "");
    setIdentity(null);
    setRestored(null);
    if (gameIdentity.raw)
      void crypto.subtle
        .digest("SHA-256", new TextEncoder().encode(gameIdentity.raw))
        .then((hash) => {
          if (active)
            setIdentity({
              raw: gameIdentity.raw,
              id: Array.from(new Uint8Array(hash), (byte) =>
                byte.toString(16).padStart(2, "0"),
              ).join(""),
            });
        })
        .catch(() => {
          if (active) setError("The game identity could not be verified. Reload and retry.");
        });
    return () => {
      active = false;
    };
  }, [gameIdentity.raw]);
  const key = identity?.raw === gameIdentity.raw ? identity.id : "";
  const saved = key ? snapshot.savedState?.gameReports?.[key] : undefined;
  const pending = key ? snapshot.state.gameReports?.[key] : undefined;
  useEffect(() => {
    let active = true;
    if (!key) return;
    void Promise.all([
      readWebGameReport(saved, game),
      pending !== saved ? readWebGameReport(pending, game) : Promise.resolve(null),
    ]).then(([savedReport, pendingReport]) => {
      if (active)
        setRestored({ raw: gameIdentity.raw, saved: savedReport, pending: pendingReport });
    });
    return () => {
      active = false;
    };
  }, [saved, pending, key, game, gameIdentity.raw]);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
      busyRef.current(false);
    },
    [],
  );
  useEffect(() => {
    if (availability === "off") request.current?.abort();
  }, [availability]);

  const updateLimits = (next: ReportSearchLimits) => {
    setLimits(next);
    try {
      localStorage.setItem(PREFS, JSON.stringify(next));
    } catch {
      /* Settings remain in memory. */
    }
  };
  const run = async () => {
    if (!key || request.current || blocked || availability === "off") return;
    const controller = new AbortController(),
      raw = gameIdentity.raw;
    request.current = controller;
    setRunning(true);
    busyRef.current(true);
    setError("");
    setNotice("");
    setProgress({ done: 0, total: game.line.length + 1 });
    const current = () =>
      request.current === controller && latest.current === raw && !controller.signal.aborted;
    try {
      const result = await analyzeWebGameReport(game, {
        limits,
        signal: controller.signal,
        isCurrent: current,
        onProgress: (done, total) => {
          if (current()) setProgress({ done, total });
        },
      });
      if (!current()) return;
      const value = savedWebGameReport(result);
      session.setState((state) => ({
        ...state,
        gameReports: { ...state.gameReports, [key]: value },
      }));
      try {
        await session.flush();
      } catch {
        /* The session retains both old durable evidence and the new unsaved result for retry. */
      }
    } catch (failure) {
      if (request.current !== controller || latest.current !== raw) return;
      if (controller.signal.aborted) setNotice("Analysis cancelled. Your previous report is kept.");
      else setError(failure instanceof Error ? failure.message : "The game could not be analyzed.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setRunning(false);
        busyRef.current(false);
      }
    }
  };
  const visible = restored?.raw === gameIdentity.raw ? restored : null;
  const result = visible?.saved ?? visible?.pending;
  const depths = result
    ? [...treeIteratorMainLine(result.root)]
        .map(({ node }) => node.depth)
        .filter((depth): depth is number => depth !== null)
    : [];
  const preset = custom
    ? "custom"
    : (Object.entries(GAME_ANALYSIS_PRESETS).find(
        ([, value]) => value.depth === limits.depth && value.timeMs === limits.timeMs,
      )?.[0] ?? "custom");
  return (
    <Stack gap="sm" p="sm" data-testid="phone-game-report">
      <Group gap={5}>
        <Text fw={700}>Game report</Text>
        <TournamentHelp label="Game accuracy">
          Accuracy uses the same calculation as the desktop report. It measures move quality; the
          Strength tab has separate calibrated playing-strength estimates.
        </TournamentHelp>
      </Group>
      <SegmentedControl
        aria-label="Game report preset"
        fullWidth
        disabled={running}
        value={preset}
        styles={{ root: { flexWrap: "wrap" }, control: { flex: "1 0 auto" } }}
        data={[
          ...Object.entries(GAME_ANALYSIS_PRESETS).map(([value, info]) => ({
            value,
            label: info.label,
          })),
          { value: "custom", label: "Custom" },
        ]}
        onChange={(value) => {
          setCustom(value === "custom");
          if (value !== "custom") {
            const { depth, timeMs } =
              GAME_ANALYSIS_PRESETS[value as keyof typeof GAME_ANALYSIS_PRESETS];
            updateLimits({ depth, timeMs });
          }
        }}
      />
      {preset === "custom" && (
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
          <NumberInput
            label="Report depth"
            min={2}
            max={30}
            allowDecimal={false}
            disabled={running}
            value={limits.depth}
            onChange={(value) => updateLimits({ ...limits, depth: Number(value) || 2 })}
          />
          <NumberInput
            label="Time per position (ms)"
            min={50}
            max={5000}
            step={50}
            allowDecimal={false}
            disabled={running}
            value={limits.timeMs}
            onChange={(value) => updateLimits({ ...limits, timeMs: Number(value) || 50 })}
          />
        </SimpleGrid>
      )}
      <Group gap={5}>
        <Text size="xs" c="dimmed">
          Depth {limits.depth} · up to {limits.timeMs / 1000} s per position
        </Text>
        <TournamentHelp label="Report limits">
          The first depth or time bound stops each search. Exact-score recovery shares that time
          budget. Completed reports keep the limits actually used.
        </TournamentHelp>
      </Group>
      {gameIdentity.error && (
        <Text size="sm" c="dimmed">
          {game.line.length
            ? gameIdentity.error
            : "Open a saved game or play a line to analyze it."}
        </Text>
      )}
      {availability === "off" && (
        <Text size="sm">PC services are off. Turn them on to analyze a game.</Text>
      )}
      {blocked && (
        <Text size="xs">Finish or cancel the other analysis before starting a game report.</Text>
      )}
      <Group>
        <Button
          disabled={
            !running &&
            (!key ||
              !validReportSearchLimits(limits) ||
              blocked ||
              availability === "off" ||
              (pending !== saved && !!pending))
          }
          color={running ? "red" : undefined}
          onClick={() => {
            if (running) request.current?.abort();
            else void run();
          }}
        >
          {running
            ? "Cancel analysis"
            : error
              ? "Retry analysis"
              : result
                ? "Analyze again"
                : "Analyze game"}
        </Button>
      </Group>
      {running && (
        <Box role="status">
          <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
          <Text size="xs" mt={4}>
            Position {progress.done} of {progress.total}
          </Text>
        </Box>
      )}
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      {notice && (
        <Text size="sm" role="status">
          {notice}
        </Text>
      )}
      {!running && !result && !error && !gameIdentity.error && (
        <Text size="sm" c="dimmed">
          No completed report for this game yet.
        </Text>
      )}
      {!!visible?.pending && (
        <Alert color={snapshot.saveError ? "red" : "blue"} role="status">
          {snapshot.saveError
            ? "Report ready; save failed. The previous saved report is kept."
            : "Saving the new report…"}
          {snapshot.saveError && (
            <Button mt="xs" size="xs" onClick={() => void session.flush().catch(() => {})}>
              Retry report save
            </Button>
          )}
        </Alert>
      )}
      {result && (
        <Stack gap="xs" aria-label={visible?.saved ? "Saved game report" : "Unsaved game report"}>
          <SimpleGrid cols={2} spacing="xs">
            {(["white", "black"] as const).map((side) => (
              <Box key={side} style={{ minWidth: 0 }}>
                <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                  {result.report[side].name} · {side === "white" ? "White" : "Black"} accuracy
                </Text>
                <Text size="xl" fw={700}>
                  {result.report[side].accuracy === null
                    ? "—"
                    : `${result.report[side].accuracy.toFixed(1)}%`}
                </Text>
                <Text size="xs" c="dimmed">
                  {result.report[side].samples} analyzed half-moves
                </Text>
              </Box>
            ))}
          </SimpleGrid>
          <Text size="xs" c="dimmed">
            {result.details.engine} · depth{" "}
            {result.details.limit.t === "Combined" ? result.details.limit.c.depth : "—"} · up to{" "}
            {result.details.limit.t === "Combined" ? result.details.limit.c.timeMs / 1000 : "—"} s
            per position
          </Text>
          <Text size="xs" c="dimmed">
            Actual search depth {Math.min(...depths)}–{Math.max(...depths)} · completed{" "}
            {new Date(result.details.completedAt).toLocaleString()}
          </Text>
          <Text fw={600} size="sm">
            Moves to review
          </Text>
          {result.report.chart
            .filter((point) => point.judgement)
            .map((point) => (
              <Button
                key={point.index}
                variant="light"
                fullWidth
                styles={{ label: { whiteSpace: "normal", overflowWrap: "anywhere" } }}
                onClick={() => onSelectPly(point.index + 1)}
              >
                {point.label} · {point.judgement}
              </Button>
            ))}
          {!result.report.chart.some((point) => point.judgement) && (
            <Text size="sm" c="dimmed">
              No inaccuracies, mistakes or blunders found.
            </Text>
          )}
        </Stack>
      )}
    </Stack>
  );
}
