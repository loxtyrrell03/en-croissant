import {
  Alert,
  Button,
  Group,
  NumberInput,
  Progress,
  Select,
  Stack,
  Switch,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  useAutoPlanArrowClaim,
  useAutoPlanArrowData,
  usePlanArrowPreview,
} from "@/hooks/usePlanArrows";
import {
  EnginePlanEvaluation,
  EnginePlanHorizonControl,
} from "@/components/panels/enginePlan/EnginePlanPresentation";
import { TournamentHelp } from "@/features/tournaments/TournamentHelp";
import { positionFromFen } from "@/utils/chessops";
import {
  enginePlanDisplayForHorizon,
  engineReportToPlanExplorerData,
  type EnginePlanReport,
} from "@/utils/enginePlanExplorer";
import type { PlanPreviewLines } from "@/utils/planArrowLayers";
import { PLAN_HORIZONS, type PlanHorizon } from "@/utils/planHorizon";
import { usePcServicesAvailability } from "./pcServices";
import { phoneEnginePlanReport } from "./phoneEnginePlans";
import { analyzeWithWebStockfish18 } from "./stockfishEngine";
import { capturePcCpuResources } from "./pcCpuResources";
import {
  PhoneCpuResourceControls,
  usePhonePcCpuCapability,
  type PhoneCpuStore,
} from "./PhoneCpuResourceControls";
import {
  PHONE_CPU_RESOURCES_KEY,
  DEFAULT_PHONE_CPU_PREFERENCES,
  normalizePhoneCpuPreferences,
} from "./phoneCpuPreferences";
import { useVerifiedJsonPreference } from "./useVerifiedJsonPreference";

const PREFS = "en-croissant-phone-engine-plans";
function preferences() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS) ?? "null");
    return {
      depth: Number.isSafeInteger(raw?.depth) && raw.depth >= 2 && raw.depth <= 40 ? raw.depth : 17,
      horizon: PLAN_HORIZONS.some((option) => option.value === raw?.horizon)
        ? (raw.horizon as PlanHorizon)
        : ("all" as PlanHorizon),
      autoArrows: raw?.autoArrows !== false,
      arrowLimit:
        Number.isSafeInteger(raw?.arrowLimit) && raw.arrowLimit >= 1 && raw.arrowLimit <= 32
          ? raw.arrowLimit
          : 10,
    };
  } catch {
    return { depth: 17, horizon: "all" as PlanHorizon, autoArrows: true, arrowLimit: 10 };
  }
}
export default function PhoneEnginePlansPanel({
  fen,
  onBusy,
  onPlayLine,
  blocked = false,
  arrowBoard,
  active = true,
  cpuPreferenceStore,
}: {
  fen: string;
  onBusy: (busy: boolean) => void;
  onPlayLine: (fen: string, moves: string[]) => void;
  blocked?: boolean;
  arrowBoard?: object;
  active?: boolean;
  cpuPreferenceStore?: PhoneCpuStore;
}) {
  const [settings, setSettings] = useState(preferences);
  const ownArrowBoard = useMemo(() => ({}), []);
  const boardOwner = arrowBoard ?? ownArrowBoard;
  useAutoPlanArrowClaim(boardOwner, "engine-plans", active && settings.autoArrows);
  const preview = usePlanArrowPreview(boardOwner, fen, active);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [report, setReport] = useState<EnginePlanReport | null>(null);
  const [reachedDepth, setReachedDepth] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [side, setSide] = useState("all");
  const request = useRef<AbortController | null>(null),
    cache = useRef(new Map<string, EnginePlanReport>());
  const latest = useRef(fen);
  latest.current = fen;
  const busy = useRef(onBusy);
  busy.current = onBusy;
  const availability = usePcServicesAvailability();
  const unavailable = availability === "off" || availability === "starting";
  const [cpuPreferences, , cpuError, retryCpu, cpuStore, cpuSnapshot] = useVerifiedJsonPreference(
    PHONE_CPU_RESOURCES_KEY,
    DEFAULT_PHONE_CPU_PREFERENCES,
    normalizePhoneCpuPreferences,
    cpuPreferenceStore,
  );
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const resourceControlsId = useId();
  const pcCapability = usePhonePcCpuCapability(active && resourcesOpen && !unavailable);
  const key = `${fen}|${settings.depth}`;
  const keyRef = useRef(key);
  keyRef.current = key;
  const [position] = positionFromFen(fen);
  const terminal = !position || position.isEnd();
  const validDepth =
    Number.isSafeInteger(settings.depth) && settings.depth >= 2 && settings.depth <= 40;
  useEffect(() => {
    request.current?.abort();
    request.current = null;
    setRunning(false);
    busy.current(false);
    setReport(cache.current.get(key) ?? null);
    setError("");
    setNotice("");
    setSelected(null);
    setReachedDepth(0);
  }, [key]);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
      busy.current(false);
    },
    [],
  );
  useEffect(() => {
    if (availability === "off" || availability === "starting") request.current?.abort();
  }, [availability]);
  const update = (next: typeof settings) => {
    setSettings(next);
    try {
      localStorage.setItem(PREFS, JSON.stringify(next));
    } catch {
      /* In-memory preferences remain usable. */
    }
  };
  const plans = useMemo(
    () =>
      report?.fen === fen
        ? enginePlanDisplayForHorizon(report, settings.horizon).filter(
            (plan) => side === "all" || plan.color === side,
          )
        : [],
    [report, fen, settings.horizon, side],
  );
  const detail = plans.find((plan) => plan.signature === selected);
  const arrowData = useMemo(
    () => (report?.fen === fen ? engineReportToPlanExplorerData({ ...report, plans }) : null),
    [report, fen, plans],
  );
  useAutoPlanArrowData(
    boardOwner,
    "engine-plans",
    arrowData,
    active && settings.autoArrows,
    settings.arrowLimit,
  );
  function previewLines(plan: (typeof plans)[number]): PlanPreviewLines | null {
    if (report?.fen !== fen) return null;
    const data = engineReportToPlanExplorerData({ ...report, plans: [plan] });
    const lines = data.pieces.flatMap((piece) =>
      piece.lines.map((line) => ({ ...line, color: piece.color })),
    );
    return lines.length ? lines : null;
  }
  const detailLines = detail ? previewLines(detail) : null;
  const detailPreview = useRef<PlanPreviewLines | null>(null);
  detailPreview.current = detailLines;
  useEffect(() => {
    preview(detailPreview.current);
    return () => preview(null);
  }, [selected, arrowData, preview]);
  const run = async () => {
    if (request.current || blocked || terminal || !validDepth || unavailable) return;
    // Capture the verified shared choice once. Live edits during this job apply
    // to a later search, without cancelling or retuning this owned request.
    const snapshot = cpuStore.getSnapshot();
    if (snapshot.phase === "unreadable") return;
    const cpuResources = snapshot.value.cpuResources
      ? capturePcCpuResources(snapshot.value.cpuResources)
      : undefined;
    const controller = new AbortController(),
      sourceKey = key;
    request.current = controller;
    setRunning(true);
    busy.current(true);
    setError("");
    setNotice("");
    setReachedDepth(0);
    const current = () =>
      request.current === controller && keyRef.current === sourceKey && !controller.signal.aborted;
    try {
      const lines = await analyzeWithWebStockfish18({
        fen,
        depth: settings.depth,
        multipv: 8,
        planSearch: true,
        cpuResources,
        signal: controller.signal,
        onUpdate: (lines) => {
          if (current()) setReachedDepth(Math.max(0, ...lines.map((line) => line.depth)));
        },
      });
      if (!current()) return;
      const result = phoneEnginePlanReport(fen, lines, settings.depth, 8);
      if (!result.totalPvs)
        throw new Error("The engine returned no exact legal plan lines. Try again.");
      cache.current.delete(sourceKey);
      cache.current.set(sourceKey, result);
      if (cache.current.size > 12) cache.current.delete(cache.current.keys().next().value!);
      setReport(result);
      setSelected(null);
    } catch (failure) {
      if (request.current !== controller || keyRef.current !== sourceKey) return;
      if (controller.signal.aborted)
        setNotice("Plan analysis cancelled. Previous results are kept.");
      else setError(failure instanceof Error ? failure.message : "Plans could not be analyzed.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setRunning(false);
        busy.current(false);
      }
    }
  };
  return (
    <Stack gap="sm" p="sm" data-testid="phone-engine-plans">
      <Group gap={5}>
        <Text fw={700}>Engine Plans</Text>
        <TournamentHelp label="Engine Plans">
          Ideas come from exact legal engine lines for this position. Later ideas depend on their
          supporting line; they are not independently evaluated setups.
        </TournamentHelp>
      </Group>
      <Group align="end" gap="xs">
        <NumberInput
          label="Plan depth"
          min={2}
          max={40}
          allowDecimal={false}
          w={110}
          disabled={running}
          value={settings.depth}
          onChange={(value) => update({ ...settings, depth: Number(value) || 2 })}
        />
        <EnginePlanHorizonControl
          value={settings.horizon}
          onChange={(horizon) => update({ ...settings, horizon })}
        />
        <Select
          aria-label="Plan side"
          label="Side"
          w={130}
          value={side}
          allowDeselect={false}
          data={[
            { value: "all", label: "Both sides" },
            { value: "white", label: "White" },
            { value: "black", label: "Black" },
          ]}
          onChange={(value) => setSide(value ?? "all")}
        />
      </Group>
      <Group gap="xs" align="end">
        <Switch
          label="Auto arrows"
          aria-label="Auto plan arrows"
          checked={settings.autoArrows}
          onChange={(event) => update({ ...settings, autoArrows: event.currentTarget.checked })}
        />
        {settings.autoArrows && (
          <NumberInput
            label="Max arrows"
            aria-label="Max plan arrows"
            min={1}
            max={32}
            allowDecimal={false}
            w={110}
            value={settings.arrowLimit}
            onChange={(value) =>
              update({ ...settings, arrowLimit: Math.max(1, Math.min(32, Number(value) || 1)) })
            }
          />
        )}
        <TournamentHelp label="Plan arrows">
          Automatic plan arrows stay on the board while you preview another plan. Turn them off to
          show live engine arrows.
        </TournamentHelp>
      </Group>
      <Group gap="xs" justify="space-between">
        <Text size="xs">
          {cpuSnapshot.phase === "unreadable"
            ? "Could not read saved PC resources."
            : cpuPreferences.cpuResources
              ? `PC resources: ${cpuPreferences.cpuResources.threads} threads · ${cpuPreferences.cpuResources.hashMb} MiB hash`
              : "PC resources: fixed Good preset"}
        </Text>
        <Button
          size="compact-xs"
          variant="subtle"
          aria-controls={resourceControlsId}
          aria-expanded={resourcesOpen}
          onClick={() => setResourcesOpen((value) => !value)}
        >
          PC resource settings
        </Button>
      </Group>
      {resourcesOpen && (
        <Stack id={resourceControlsId} gap="xs" role="group" aria-label="Plan PC resources">
          <PhoneCpuResourceControls
            store={cpuStore}
            state={pcCapability}
            fixedPreset="good"
            unavailable={unavailable}
            starting={availability === "starting"}
            requestError={error}
            fixedPresetActionLabel="Use fixed presets for Live and Plans"
          />
          <Text size="xs" c="dimmed">
            Changes apply to the next plan search. Fixed presets restore each view’s previous
            choice.
          </Text>
        </Stack>
      )}
      {cpuError && (
        <Group gap="xs" align="start">
          <Text size="xs" c="red" role="alert">
            PC resources: {cpuError}
          </Text>
          <Button size="compact-xs" variant="default" onClick={retryCpu}>
            Retry PC settings
          </Button>
        </Group>
      )}
      {unavailable && (
        <Text size="sm">
          {availability === "starting"
            ? "PC services are starting. Saved resources are kept."
            : "PC services are off. Turn them on to explore plans."}
        </Text>
      )}
      {blocked && <Text size="xs">Finish or cancel the game report before exploring plans.</Text>}
      <Button
        disabled={
          !running &&
          (blocked || terminal || !validDepth || unavailable || cpuSnapshot.phase === "unreadable")
        }
        color={running ? "red" : undefined}
        onClick={() => {
          if (running) request.current?.abort();
          else void run();
        }}
      >
        {running
          ? "Cancel plan analysis"
          : error
            ? "Retry plans"
            : report
              ? "Refresh plans"
              : "Explore plans"}
      </Button>
      {terminal && (
        <Text size="sm" c="dimmed">
          Choose a nonterminal board position to explore plans.
        </Text>
      )}
      {running && (
        <Stack gap={4} role="status">
          <Progress value={Math.min(100, (reachedDepth / settings.depth) * 100)} />
          <Text size="xs">
            Depth reached {reachedDepth} · target {settings.depth}
          </Text>
        </Stack>
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
      {report?.fen === fen && (
        <Text size="xs" c="dimmed">
          {report.totalPvs} evaluated root choices · {report.limitLabel}
        </Text>
      )}
      {plans.map((plan) => (
        <UnstyledButton
          data-plan-detail
          key={plan.signature}
          onClick={() => setSelected(plan.signature)}
          onMouseEnter={() => preview(previewLines(plan))}
          onMouseLeave={() => preview(detailPreview.current)}
          onFocus={() => preview(previewLines(plan))}
          onBlur={() => preview(detailPreview.current)}
          style={{ padding: 10, border: "1px solid var(--mantine-color-dark-4)", borderRadius: 6 }}
          aria-expanded={detail?.signature === plan.signature}
        >
          <Group justify="space-between" wrap="nowrap" align="start">
            <Stack gap={3} style={{ minWidth: 0 }}>
              <Text size="sm" fw={600} style={{ overflowWrap: "anywhere" }}>
                {plan.label}
              </Text>
              <Text size="xs" c="dimmed">
                {plan.color === "white" ? "White" : "Black"} · {plan.supportCount} supporting{" "}
                {plan.supportCount === 1 ? "line" : "lines"}
              </Text>
            </Stack>
            <Text size="xs">Details</Text>
          </Group>
        </UnstyledButton>
      ))}
      {report && !plans.length && (
        <Text size="sm" c="dimmed">
          No plans match this side and horizon. Try All horizons or Both sides.
        </Text>
      )}
      {detail && (
        <Stack
          gap="xs"
          p="xs"
          style={{ border: "1px solid var(--mantine-color-dark-4)", borderRadius: 6 }}
        >
          <Group justify="space-between">
            <Text fw={600} size="sm">
              {detail.label}
            </Text>
            <Button size="compact-xs" variant="subtle" onClick={() => setSelected(null)}>
              Close details
            </Button>
          </Group>
          <Text size="sm">{detail.explanation}</Text>
          <EnginePlanEvaluation plan={detail} />
          {detail.evidence.map((evidence) => (
            <Stack key={`${evidence.rank}:${evidence.completionPly}`} gap={4}>
              <Text size="xs" c="dimmed">
                Supporting PV{evidence.rank} · depth {evidence.depth} · White perspective
              </Text>
              <Text size="sm" style={{ overflowWrap: "anywhere" }}>
                {evidence.sanMoves.join(" ")}
              </Text>
              <Button size="xs" variant="light" onClick={() => onPlayLine(fen, evidence.uciMoves)}>
                Play this line
              </Button>
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
