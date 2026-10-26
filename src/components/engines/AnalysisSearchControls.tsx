import { Button, Group, Select, Stack, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import type { GoMode } from "@/bindings";
import { EngineSettingSlider } from "@/components/common/EngineSettingSlider";
import { PerformanceHelp } from "@/shared/PerformanceHelp";
import type { NativeAnalysisPatch, VerifiedEngineEdit } from "@/utils/nativeAnalysisEdits";
import {
  ANALYSIS_TIME_STOPS,
  ANALYSIS_TIME_UNITS,
  U32_MAX,
  analysisSearchSummary,
  type AnalysisTimeUnit,
} from "@/utils/nativeAnalysisSettings";

/** Verified analysis edits. Defaults retain native behavior; a phone adapter
 * supplies supported bounds. A field draft never changes an engine request. */
export function AnalysisSearchControls({
  go,
  lines,
  lineBounds = { min: 1, max: 8 },
  prepare,
  scope,
  successLabel,
  requestError,
  previous,
  disabled = false,
  limitsAvailable = true,
  limitBounds,
}: {
  go: GoMode;
  lines?: number;
  lineBounds?: { min: number; max: number } | null;
  prepare: (patch: NativeAnalysisPatch) => VerifiedEngineEdit;
  scope: string;
  successLabel: string;
  requestError?: string | null;
  previous?: NativeAnalysisPatch | null;
  disabled?: boolean;
  limitsAvailable?: boolean;
  limitBounds?: {
    depth: { min: number; max: number };
    timeMs: { min: number; max: number };
    nodes: { min: number; max: number };
  };
}) {
  const [state, setState] = useState({
    busy: false,
    error: null as string | null,
    notice: null as string | null,
  });
  const [version, setVersion] = useState(0),
    [timeUnit, setTimeUnit] = useState<AnalysisTimeUnit>("s");
  const edit = useRef<VerifiedEngineEdit | null>(null),
    mounted = useRef(true);
  const last = useRef<{
    Depth: number;
    Nodes: number;
    Time: number;
    PlayersTime?: Extract<GoMode, { t: "PlayersTime" }>;
  }>({ Depth: 24, Nodes: 1000000, Time: 10000 });
  // Only committed values update mode memory, including older custom values.
  if (
    (go.t === "Depth" || go.t === "Time" || go.t === "Nodes") &&
    Number.isInteger(go.c) &&
    go.c >= 1 &&
    go.c <= U32_MAX
  )
    last.current[go.t] = go.c;
  if (go.t === "PlayersTime") last.current.PlayersTime = go;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (state.error && !state.busy && edit.current?.isApplied?.()) {
      edit.current = null;
      setVersion((value) => value + 1);
      setState({ busy: false, error: null, notice: successLabel });
    }
  }, [go, lines, state.error, state.busy, successLabel]);
  async function run(restore = false) {
    const active = edit.current;
    if (!active) return;
    setState({ busy: true, error: null, notice: null });
    try {
      if (restore) await active.restore();
      else await active.save();
      edit.current = null;
      if (mounted.current) {
        setVersion((value) => value + 1);
        setState({
          busy: false,
          error: null,
          notice: restore ? "Previous settings restored." : successLabel,
        });
      }
    } catch (error) {
      if (!active.owns()) edit.current = null;
      if (mounted.current)
        setState({
          busy: false,
          error: error instanceof Error ? error.message : String(error),
          notice: null,
        });
    }
  }
  const locked = disabled || state.busy || Boolean(state.error);
  const limitLocked = locked || !limitsAvailable;
  const modeValue = (mode: "Depth" | "Time" | "Nodes") => {
    const bounds = limitBounds?.[mode === "Depth" ? "depth" : mode === "Time" ? "timeMs" : "nodes"];
    return bounds
      ? Math.max(bounds.min, Math.min(bounds.max, last.current[mode]))
      : last.current[mode];
  };
  function apply(patch: NativeAnalysisPatch) {
    if (locked || edit.current) return;
    try {
      edit.current = prepare(patch);
      void run();
    } catch (error) {
      setState({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
        notice: null,
      });
    }
  }
  const factor = ANALYSIS_TIME_UNITS[timeUnit];
  const modes = [
    { value: "Infinite", label: "Until stopped" },
    { value: "Depth", label: "At a depth" },
    { value: "Time", label: "After a time" },
    { value: "Nodes", label: "After a node count" },
    ...(last.current.PlayersTime ? [{ value: "PlayersTime", label: "Player clocks" }] : []),
  ];
  return (
    <Stack gap="xs">
      <Group gap={4}>
        <Text size="sm" fw="bold">
          Lines &amp; search limits
        </Text>
        <PerformanceHelp label="About search limits">
          Limits apply to each position. A completed edit changes the selected scope once;
          unfinished edits leave analysis unchanged.
        </PerformanceHelp>
      </Group>
      {lines !== undefined && lineBounds && (
        <EngineSettingSlider
          key={`lines-${version}`}
          label="Lines"
          value={lines}
          bounds={lineBounds}
          disabled={locked}
          help="Compare this many candidate moves. More lines share the available search time."
          onCommit={(value) => apply({ lines: value })}
        />
      )}
      {lines !== undefined && !lineBounds && (
        <Text size="xs">{lines} saved lines. Line controls are unavailable for this engine.</Text>
      )}
      <Select
        label="Stop analysis"
        aria-label="Stop analysis"
        data={modes}
        allowDeselect={false}
        value={go.t}
        disabled={limitLocked}
        onChange={(mode) => {
          if (!mode || mode === go.t) return;
          const next: GoMode =
            mode === "Depth"
              ? { t: "Depth", c: modeValue("Depth") }
              : mode === "Time"
                ? { t: "Time", c: modeValue("Time") }
                : mode === "Nodes"
                  ? { t: "Nodes", c: modeValue("Nodes") }
                  : mode === "PlayersTime" && last.current.PlayersTime
                    ? last.current.PlayersTime
                    : { t: "Infinite" };
          apply({ go: next });
        }}
      />
      {go.t === "Depth" && (
        <EngineSettingSlider
          key={`depth-${version}`}
          label="Depth"
          value={go.c}
          bounds={limitBounds?.depth ?? { min: 1, max: 60 }}
          disabled={limitLocked}
          help="Depth is a search level, not a fixed number of moves ahead. Analysis stops when this depth is reached."
          onCommit={(value) => apply({ go: { t: "Depth", c: value } })}
        />
      )}
      {go.t === "Nodes" && (
        <EngineSettingSlider
          key={`nodes-${version}`}
          label="Nodes per position"
          value={go.c}
          bounds={limitBounds?.nodes ?? { min: 1, max: U32_MAX }}
          disabled={limitLocked}
          stops={[1, 1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000, U32_MAX]}
          help="Nodes are positions examined during the search. The limit applies separately to each board position."
          onCommit={(value) => apply({ go: { t: "Nodes", c: value } })}
        />
      )}
      {go.t === "Time" && (
        <>
          <Select
            label="Time unit"
            aria-label="Time unit"
            data={[
              { value: "ms", label: "Milliseconds" },
              { value: "s", label: "Seconds" },
              { value: "m", label: "Minutes" },
              { value: "h", label: "Hours" },
            ]}
            value={timeUnit}
            disabled={limitLocked}
            allowDeselect={false}
            onChange={(unit) => {
              if (unit && unit in ANALYSIS_TIME_UNITS) setTimeUnit(unit as AnalysisTimeUnit);
            }}
          />
          <EngineSettingSlider
            key={`time-${timeUnit}-${version}`}
            label="Time per position"
            value={go.c / factor}
            bounds={{
              min: (limitBounds?.timeMs.min ?? 50) / factor,
              max: (limitBounds?.timeMs.max ?? 3600000) / factor,
            }}
            step={1 / factor}
            unit={timeUnit}
            stops={ANALYSIS_TIME_STOPS.map((ms) => ms / factor)}
            disabled={limitLocked}
            help="Time allowed for each position. Fractions are supported down to one millisecond. Changing the board starts a new search."
            onCommit={(value) => apply({ go: { t: "Time", c: Math.round(value * factor) } })}
          />
        </>
      )}
      {go.t === "PlayersTime" && (
        <Text size="xs">Uses both players' remaining clocks and increments.</Text>
      )}
      <Text size="xs" c="dimmed">
        {scope}
      </Text>
      {state.busy && (
        <Text size="xs" role="status">
          Saving search settings…
        </Text>
      )}
      {state.notice && (
        <Text size="xs" role="status">
          {state.notice}
        </Text>
      )}
      {state.error && (
        <Stack gap="xs">
          <Text size="sm" c="red" role="alert">
            {state.error}
          </Text>
          <Text size="xs">
            Current search: {lines !== undefined ? `${lines} lines · ` : ""}
            {analysisSearchSummary(go)}. This edit has not been applied.
          </Text>
          <Group gap="xs">
            <Button size="xs" disabled={!edit.current || state.busy} onClick={() => void run()}>
              Retry search save
            </Button>
            <Button
              size="xs"
              variant="default"
              disabled={!edit.current || state.busy}
              onClick={() => void run(true)}
            >
              Restore previous search save
            </Button>
            {!edit.current && (
              <Button
                size="xs"
                variant="default"
                onClick={() => {
                  setState({ busy: false, error: null, notice: null });
                  setVersion((value) => value + 1);
                }}
              >
                Dismiss search error
              </Button>
            )}
          </Group>
        </Stack>
      )}
      {requestError && previous && (
        <Button size="xs" variant="default" disabled={locked} onClick={() => apply(previous)}>
          Restore previous search settings
        </Button>
      )}
    </Stack>
  );
}
