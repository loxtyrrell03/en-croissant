import {
  Alert,
  Button,
  Group,
  NumberInput,
  Progress,
  Select,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  EnginePlanEvaluation,
  EnginePlanHorizonControl,
} from "@/components/panels/enginePlan/EnginePlanPresentation";
import { TournamentHelp } from "@/features/tournaments/TournamentHelp";
import { positionFromFen } from "@/utils/chessops";
import { enginePlanDisplayForHorizon, type EnginePlanReport } from "@/utils/enginePlanExplorer";
import { PLAN_HORIZONS, type PlanHorizon } from "@/utils/planHorizon";
import { usePcServicesAvailability } from "./pcServices";
import { phoneEnginePlanReport } from "./phoneEnginePlans";
import { analyzeWithWebStockfish18 } from "./stockfishEngine";

const PREFS = "en-croissant-phone-engine-plans";
function preferences() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS) ?? "null");
    return {
      depth: Number.isSafeInteger(raw?.depth) && raw.depth >= 2 && raw.depth <= 40 ? raw.depth : 17,
      horizon: PLAN_HORIZONS.some((option) => option.value === raw?.horizon)
        ? (raw.horizon as PlanHorizon)
        : ("all" as PlanHorizon),
    };
  } catch {
    return { depth: 17, horizon: "all" as PlanHorizon };
  }
}
export default function PhoneEnginePlansPanel({
  fen,
  onBusy,
  onPlayLine,
  blocked = false,
}: {
  fen: string;
  onBusy: (busy: boolean) => void;
  onPlayLine: (fen: string, moves: string[]) => void;
  blocked?: boolean;
}) {
  const [settings, setSettings] = useState(preferences);
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
    if (availability === "off") request.current?.abort();
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
  const run = async () => {
    if (request.current || blocked || terminal || !validDepth || availability === "off") return;
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
      {availability === "off" && (
        <Text size="sm">PC services are off. Turn them on to explore plans.</Text>
      )}
      {blocked && <Text size="xs">Finish or cancel the game report before exploring plans.</Text>}
      <Button
        disabled={!running && (blocked || terminal || !validDepth || availability === "off")}
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
          key={plan.signature}
          onClick={() => setSelected(plan.signature)}
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
