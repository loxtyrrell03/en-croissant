import { Alert, Badge, Button, Group, Paper, ScrollArea, Select, Stack, Text } from "@mantine/core";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { useEffect, useRef, useState } from "react";
import { PerformanceHelp } from "@/shared/PerformanceHelp";
import type { LocalEngine } from "@/utils/engines";
import type {
  ChessDecisionReport,
  DecisionAssessment,
  DecisionCategory,
} from "@/utils/tacticalMotifs/decisionAssessment";
import { gatherDecisionEvidence, type DecisionSearchTarget } from "./decisionSearch";
import { classifyDecisionInWorker } from "./decisionReportWorker";

const categoryLabels: Record<DecisionCategory, string> = {
  mixed: "Mixed",
  positional: "Positional",
  tactical: "Tactical",
  unclear: "Unclear",
};
const categoryColors: Record<DecisionCategory, string> = {
  mixed: "violet",
  positional: "blue",
  tactical: "orange",
  unclear: "gray",
};
const basisLabels = {
  "engine-supported": "Engine supported",
  "bounded-proof": "Checked local proof",
  heuristic: "Strategic interpretation",
  insufficient: "Limited evidence",
};
const mistakeSummary = {
  "best-supplied-choice": "The played move was the engine’s first choice in this search.",
  "no-meaningful-loss-measured": "The engine found no meaningful loss in the paired search.",
  "comparison-unavailable": "A reliable comparison of the played move was unavailable.",
  "not-requested": "",
  assessed: "",
};

function lineSan(fen: string, moves: string[]) {
  const board = parseFen(fen).chain((setup) => Chess.fromSetup(setup));
  if (board.isErr) return "";
  const san: string[] = [];
  for (const uci of moves) {
    const move = parseUci(uci);
    if (!move || !board.value.isLegal(move)) return "";
    san.push(makeSan(board.value, move));
    board.value.play(move);
  }
  return san.join(" ");
}

function EvidenceSummary({
  title,
  assessment,
  children,
  comparedLines,
}: {
  title: string;
  assessment: DecisionAssessment;
  children?: React.ReactNode;
  comparedLines?: Array<{ label: string; san: string }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const dimensions = [
    { label: "Tactical", value: assessment.tactical },
    { label: "Positional", value: assessment.positional },
  ];
  const reasons = dimensions.flatMap(({ label, value }) =>
    value.support === "unestablished"
      ? []
      : value.reasons.map((reason) => ({ label, reason, basis: basisLabels[value.basis] })),
  );
  const resources = assessment.conditionalResources;
  return (
    <Paper withBorder p="xs">
      <Stack gap={6}>
        <Group gap="xs">
          <Text fw={600} size="sm">
            {title}
          </Text>
          <Badge size="sm" variant="light" color={categoryColors[assessment.category]}>
            {categoryLabels[assessment.category]}
          </Badge>
        </Group>
        {children}
        {reasons.length > 0 ? (
          reasons.slice(0, expanded ? reasons.length : 2).map(({ label, reason, basis }) => (
            <Text key={`${label}:${reason}`} size="xs" style={{ overflowWrap: "anywhere" }}>
              <Text component="span" fw={600} size="xs">
                {label} · {basis}.{" "}
              </Text>
              {reason}
            </Text>
          ))
        ) : (
          <Text size="xs" c="dimmed">
            The search did not establish a specific cause.
          </Text>
        )}
        {expanded &&
          resources.map((resource) => (
            <Text size="xs" key={resource.captureUci} style={{ overflowWrap: "anywhere" }}>
              If {resource.captureSan}
              {": "}
              {lineSan(resource.replyFen, resource.lineUci)}. {resource.limitation}
            </Text>
          ))}
        {expanded &&
          assessment.mechanisms.slice(0, 4).map((witness) => (
            <Text
              size="xs"
              key={JSON.stringify([witness.fen, witness.mechanism, witness.lineUci])}
              style={{ overflowWrap: "anywhere" }}
            >
              {witness.description} {lineSan(witness.fen, witness.lineUci)}
            </Text>
          ))}
        {expanded &&
          comparedLines?.map(({ label, san }) => (
            <Text key={label} size="xs" style={{ overflowWrap: "anywhere" }}>
              <Text component="span" fw={600} size="xs">
                {label}.{" "}
              </Text>
              {san}
            </Text>
          ))}
        {expanded &&
          assessment.verifiedMotifs.map((motif) => (
            <Badge key={motif.id} size="sm" variant="light" color="orange" w="fit-content">
              {motif.label}
            </Badge>
          ))}
        {expanded &&
          assessment.limitations.map((limitation) => (
            <Text key={limitation} size="xs" c="dimmed">
              {limitation}
            </Text>
          ))}
        {(reasons.length > 2 ||
          resources.length > 0 ||
          !!comparedLines?.length ||
          assessment.limitations.length > 0 ||
          assessment.verifiedMotifs.length > 0) && (
          <Button
            variant="subtle"
            size="xs"
            w="fit-content"
            aria-expanded={expanded}
            onClick={() => setExpanded((shown) => !shown)}
          >
            {expanded ? "Hide evidence" : "Show evidence"}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}

function DecisionReport({
  report,
  playedSan,
}: {
  report: ChessDecisionReport;
  playedSan?: string;
}) {
  const [move, setMove] = useState(report.moves[0]?.moveUci);
  const selected = report.moves.find((item) => item.moveUci === move);
  const episode = report.mistake?.tacticalEpisode;
  const mate = report.mistake?.mateConsequence;
  const contrast = report.position.tacticalContrast;
  const plan = report.position.strategicPlan;
  return (
    <Stack gap="xs">
      <EvidenceSummary
        title="Position character"
        assessment={report.position}
        comparedLines={[
          ...(contrast
            ? [
                { label: "Better line", san: lineSan(report.fen, contrast.betterLineUci) },
                { label: "Refuted choice", san: lineSan(report.fen, contrast.playedLineUci) },
              ]
            : []),
          ...(plan
            ? plan.linesUci.map((moves) => ({
                label: `Plan after ${lineSan(report.fen, moves.slice(0, 1))}`,
                san: lineSan(report.fen, moves),
              }))
            : []),
        ]}
      >
        <Text size="xs" c="dimmed">
          {report.position.examinedChoices} candidate moves examined
        </Text>
      </EvidenceSummary>
      {selected && (
        <EvidenceSummary
          key={selected.moveUci}
          title="What the move achieves"
          assessment={selected}
        >
          <Select
            aria-label="Candidate move"
            size="xs"
            allowDeselect={false}
            value={selected.moveUci}
            onChange={(value) => {
              if (value) setMove(value);
            }}
            data={report.moves.map((item, index) => ({
              value: item.moveUci,
              label: `${lineSan(report.fen, [item.moveUci]) || item.moveUci}${index === 0 ? " · Engine’s first choice" : ""}`,
            }))}
          />
        </EvidenceSummary>
      )}
      {report.mistake ? (
        <EvidenceSummary
          title={playedSan ? `What ${playedSan} missed or allowed` : "Mistake mechanism"}
          assessment={report.mistake}
          comparedLines={
            episode
              ? [
                  { label: "Played line", san: lineSan(report.fen, episode.playedLineUci) },
                  { label: "Better line", san: lineSan(report.fen, episode.betterLineUci) },
                ]
              : mate
                ? [{ label: "Mating line", san: lineSan(report.fen, mate.lineUci) }]
                : undefined
          }
        >
          {report.mistake.evaluationLossCp !== null && (
            <Text size="xs" c="dimmed">
              Engine evaluation loss {(report.mistake.evaluationLossCp / 100).toFixed(2)} pawns
            </Text>
          )}
        </EvidenceSummary>
      ) : report.mistakeStatus !== "not-requested" && report.mistakeStatus !== "assessed" ? (
        <Text size="xs" c="dimmed">
          {mistakeSummary[report.mistakeStatus]}
        </Text>
      ) : null}
    </Stack>
  );
}

type RunState =
  | { status: "idle" }
  | { status: "running"; phase: string }
  | { status: "done"; report: ChessDecisionReport; playedSan?: string }
  | { status: "error"; message: string };

// Results are local to a mounted board/engine identity. A small memo permits
// switching between this position and its previous move without a new search.
export function DecisionEvidencePanel({
  engine,
  current,
  previous,
  previousSan,
  moveActionLabel = "Analyse last move",
}: {
  engine: LocalEngine;
  current?: DecisionSearchTarget;
  previous?: DecisionSearchTarget;
  previousSan?: string | null;
  moveActionLabel?: string;
}) {
  const controller = useRef<AbortController | undefined>(undefined);
  const saved = useRef(new Map<DecisionSearchTarget["fen"], ChessDecisionReport>());
  const [state, setState] = useState<RunState>({ status: "idle" });
  useEffect(() => () => controller.current?.abort(), []);

  async function run(target: DecisionSearchTarget, playedSan?: string) {
    if (controller.current) return;
    const identity = JSON.stringify([target.fen, target.playedMoveUci]);
    const cached = saved.current.get(identity);
    if (cached) {
      setState({ status: "done", report: cached, playedSan });
      return;
    }
    const owned = new AbortController();
    controller.current = owned;
    const active = () => controller.current === owned && !owned.signal.aborted;
    const progress = (phase: string) => {
      if (active()) setState({ status: "running", phase });
    };
    try {
      const input = await gatherDecisionEvidence(engine, target, owned.signal, progress);
      progress("Verifying the continuations…");
      const report = await classifyDecisionInWorker(
        { input, engineName: engine.name, history: target.history },
        owned.signal,
      );
      if (!active()) return;
      saved.current.set(identity, report);
      setState({ status: "done", report, playedSan });
    } catch (error) {
      if (active())
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "The decision check failed.",
        });
    } finally {
      if (controller.current === owned) controller.current = undefined;
    }
  }

  const running = state.status === "running";
  return (
    <Stack gap={6} mih={0}>
      <Group gap="xs">
        {current && (
          <Button variant="light" size="xs" disabled={running} onClick={() => void run(current)}>
            Analyse position
          </Button>
        )}
        {previous && (
          <Button
            variant="subtle"
            size="xs"
            disabled={running}
            onClick={() => void run(previous, previousSan ?? undefined)}
          >
            {moveActionLabel}
          </Button>
        )}
        {running && (
          <Button
            variant="subtle"
            size="xs"
            onClick={() => {
              controller.current?.abort();
              controller.current = undefined;
              setState({ status: "idle" });
            }}
          >
            Cancel
          </Button>
        )}
        <PerformanceHelp label="About decision analysis">
          Checks whether tactics and lasting position changes explain the choice. An unclear result
          means the search could not establish a cause.
        </PerformanceHelp>
      </Group>
      {running && (
        <Text size="xs" role="status">
          {state.phase}
        </Text>
      )}
      {state.status === "error" && (
        <Alert color="orange" role="alert">
          {state.message}
        </Alert>
      )}
      {state.status === "done" && (
        <ScrollArea.Autosize mah={340} offsetScrollbars>
          <DecisionReport
            key={JSON.stringify([state.report.fen, state.playedSan])}
            report={state.report}
            playedSan={state.playedSan}
          />
        </ScrollArea.Autosize>
      )}
    </Stack>
  );
}
