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
import {
  DECISION_SEARCH_SESSION_MS,
  gatherDecisionEvidence,
  gatherExtraPositionChoice,
  gatherPreparedCheckpoint,
  type DecisionSearchTarget,
} from "./decisionSearch";
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
  const conditionalFork = assessment.conditionalFork;
  const conditionalMate = assessment.conditionalMate;
  const matingLines = assessment.matingLines;
  const mateDefence = assessment.mateDefence;
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
        {expanded && conditionalFork && (
          <Stack gap={4}>
            <Text size="xs" style={{ overflowWrap: "anywhere" }}>
              <Text component="span" fw={600} size="xs">
                Fork if {conditionalFork.weakerReplySan}.{" "}
              </Text>
              {lineSan(conditionalFork.fen, conditionalFork.lineUci)}
            </Text>
            <Text size="xs" style={{ overflowWrap: "anywhere" }}>
              <Text component="span" fw={600} size="xs">
                Stockfish’s best reply.{" "}
              </Text>
              {lineSan(conditionalFork.fen, conditionalFork.bestReplyLineUci)}
            </Text>
          </Stack>
        )}
        {expanded &&
          comparedLines?.map(({ label, san }) => (
            <Text key={label} size="xs" style={{ overflowWrap: "anywhere" }}>
              <Text component="span" fw={600} size="xs">
                {label}.{" "}
              </Text>
              {san}
            </Text>
          ))}
        {expanded && mateDefence && (
          <Stack gap={4}>
            <Text size="xs" style={{ overflowWrap: "anywhere" }}>
              <Text component="span" fw={600} size="xs">
                Move that allows mate.{" "}
              </Text>
              {lineSan(mateDefence.fen, mateDefence.exampleLineUci)}
            </Text>
            {mateDefence.defendedLineUci && (
              <Text size="xs" style={{ overflowWrap: "anywhere" }}>
                <Text component="span" fw={600} size="xs">
                  How the mate is stopped.{" "}
                </Text>
                {lineSan(mateDefence.fen, mateDefence.defendedLineUci)}
              </Text>
            )}
          </Stack>
        )}
        {expanded && matingLines && (
          <Stack gap={4}>
            <Text size="xs" style={{ overflowWrap: "anywhere" }}>
              <Text component="span" fw={600} size="xs">
                Engine line.{" "}
              </Text>
              {lineSan(matingLines.fen, matingLines.rootLineUci)}
            </Text>
            {matingLines.rootLineUci.join(" ") !== matingLines.replyLineUci.join(" ") && (
              <Text size="xs" style={{ overflowWrap: "anywhere" }}>
                <Text component="span" fw={600} size="xs">
                  Separate reply search.{" "}
                </Text>
                {lineSan(matingLines.fen, matingLines.replyLineUci)}
              </Text>
            )}
          </Stack>
        )}
        {expanded && conditionalMate && (
          <Text size="xs" style={{ overflowWrap: "anywhere" }}>
            <Text component="span" fw={600} size="xs">
              Mating line.{" "}
            </Text>
            {lineSan(conditionalMate.fen, conditionalMate.lineUci)}
          </Text>
        )}
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
          !!conditionalFork ||
          !!conditionalMate ||
          !!matingLines ||
          !!mateDefence ||
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
  const recovery = report.mistake?.tacticalRecovery;
  const mistakeComparison = report.mistake?.promotion ?? episode;
  const rookPressure = report.mistake?.rookPressure;
  const pawnStructure = report.mistake?.pawnStructure;
  const mistakeLines = mistakeComparison
    ? [
        { label: "Played line", san: lineSan(report.fen, mistakeComparison.playedLineUci) },
        { label: "Better line", san: lineSan(report.fen, mistakeComparison.betterLineUci) },
      ]
    : mate
      ? [
          { label: "Mating line", san: lineSan(report.fen, mate.lineUci) },
          ...(mate.avoidingMoveUci
            ? [
                {
                  label: "Move that avoids immediate mate",
                  san: lineSan(report.fen, [mate.avoidingMoveUci]),
                },
              ]
            : []),
        ]
      : [];
  for (const [comparison, detail] of [
    [rookPressure, "rook comparison"],
    [pawnStructure, "pawn structure"],
    [recovery, "tactical recovery"],
  ] as const) {
    if (!comparison) continue;
    const played = lineSan(report.fen, comparison.playedLineUci);
    const better = lineSan(report.fen, comparison.betterLineUci);
    const hasOtherComparison = mistakeLines.length > 0;
    if (!mistakeLines.some((line) => line.san === played))
      mistakeLines.push({
        label: hasOtherComparison ? `Played line for ${detail}` : "Played line",
        san: played,
      });
    if (!mistakeLines.some((line) => line.san === better))
      mistakeLines.push({
        label: hasOtherComparison ? `Better line for ${detail}` : "Better line",
        san: better,
      });
  }
  if (recovery) {
    for (const [label, line] of [
      ["Separate reply after better move", recovery.confirmedBetterLineUci],
      ["Separate reply after played move", recovery.confirmedPlayedLineUci],
    ] as const) {
      const san = lineSan(report.fen, line);
      if (!mistakeLines.some((existing) => existing.san === san))
        mistakeLines.push({ label, san });
    }
  }
  const contrast = report.position.tacticalContrast;
  const checkpoint = report.position.preparedCheckpoint;
  const plan = report.position.strategicPlan;
  const promotion = report.position.promotionTactic;
  const positionLines = [...(plan?.linesUci ?? []), ...(promotion?.linesUci ?? [])];
  const distinctPositionLines = positionLines.filter(
    (line, index) =>
      !positionLines.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          (other.length > line.length || (other.length === line.length && otherIndex < index)) &&
          line.every((move, ply) => move === other[ply]),
      ),
  );
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
          ...(checkpoint
            ? [
                { label: "Tactical continuation", san: lineSan(report.fen, checkpoint.lineUci) },
                { label: "Weaker continuation", san: lineSan(report.fen, checkpoint.alternativeUci) },
              ]
            : []),
          ...distinctPositionLines.map((moves) => ({
            label: `After ${lineSan(report.fen, moves.slice(0, 1))}`,
            san: lineSan(report.fen, moves),
          })),
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
          comparedLines={mistakeLines}
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
    const identity = JSON.stringify([engine.id, engine.version, target]);
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
      const deadline = Date.now() + DECISION_SEARCH_SESSION_MS;
      const input = await gatherDecisionEvidence(engine, target, owned.signal, progress, deadline);
      progress("Verifying the continuations…");
      let report = await classifyDecisionInWorker(
        { input, engineName: engine.name, history: target.history },
        owned.signal,
      );
      const checkpoint = report.position.preparedCheckpointRequest;
      if (checkpoint && active() && Date.now() < deadline) {
        progress("Checking the critical move in the line…");
        const preparedCheckpoint = await gatherPreparedCheckpoint(
          engine,
          target,
          checkpoint,
          owned.signal,
          deadline,
        );
        if (active() && preparedCheckpoint.length) {
          report = await classifyDecisionInWorker(
            {
              input: { ...input, preparedCheckpoint },
              engineName: engine.name,
              history: target.history,
            },
            owned.signal,
          ).catch(() => report);
        }
      }
      if (active() && report.position.tactical.support !== "supported" && Date.now() < deadline) {
        progress("Checking one more candidate…");
        const extraPositionChoice = await gatherExtraPositionChoice(
          engine,
          target,
          input.candidates,
          owned.signal,
          deadline,
        );
        if (active() && extraPositionChoice) {
          progress("Verifying the extra candidate…");
          report = await classifyDecisionInWorker(
            {
              input: { ...input, extraPositionChoice },
              engineName: engine.name,
              history: target.history,
            },
            owned.signal,
          ).catch(() => report);
        }
      }
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
