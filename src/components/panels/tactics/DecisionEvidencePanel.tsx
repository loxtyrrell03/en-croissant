import { Alert, Badge, Button, Group, Paper, ScrollArea, Select, Stack, Text } from "@mantine/core";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { useEffect, useRef, useState } from "react";
import { PerformanceHelp } from "@/shared/PerformanceHelp";
import type { LocalEngine } from "@/utils/engines";
import type { DecisionEndgameAssessment } from "@/utils/tacticalMotifs/decisionEndgame";
import type { CheckingOrderEvidence } from "@/utils/tacticalMotifs/decisionCheckingOrder";
import type {
  ChessDecisionReport,
  DecisionAssessment,
  DecisionCategory,
} from "@/utils/tacticalMotifs/decisionAssessment";
import type { DecisionTacticalRecovery } from "@/utils/tacticalMotifs/decisionTacticalRecovery";
import { DecisionEndgameCheck } from "./DecisionEndgameCheck";
import {
  DECISION_SEARCH_SESSION_MS,
  gatherCheckingDefence,
  gatherCheckingOrder,
  gatherQuietReply,
  gatherCaptureOrder,
  gatherCaptureRouteReply,
  gatherDecisionEvidence,
  gatherExtraPositionChoice,
  gatherPassedAdvance,
  gatherPreparedCheckpoint,
  gatherSiblingRefutation,
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
const endgameOutcome = { [-1]: "Loss", 0: "Draw", 1: "Win" } as const;

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

function recoveryLines(
  fen: string,
  recovery: DecisionTacticalRecovery | undefined,
  alternative: "played move" | "alternative",
  hasComparison = false,
) {
  if (!recovery) return [];
  const alternativeLabel = alternative === "played move" ? "Played line" : "Alternative line";
  const detail = hasComparison ? " for tactical recovery" : "";
  const lines = [
    [alternativeLabel + detail, recovery.playedLineUci],
    ["Better line" + detail, recovery.betterLineUci],
    [`Separate reply after ${alternative}`, recovery.confirmedPlayedLineUci],
    ["Separate reply after better move", recovery.confirmedBetterLineUci],
  ] as const;
  const evidence = lines.map(([label, line]) => ({ label, san: lineSan(fen, line) }));
  return evidence.filter(
    ({ san }, index) => san && evidence.findIndex((item) => item.san === san) === index,
  );
}

function EvidenceSummary({
  title,
  assessment,
  children,
  comparedLines,
  exactTactic,
  checkingOrder,
}: {
  title: string;
  assessment: DecisionAssessment;
  children?: React.ReactNode;
  comparedLines?: Array<{ label: string; san: string }>;
  exactTactic?: string;
  checkingOrder?: CheckingOrderEvidence;
}) {
  const [expanded, setExpanded] = useState(false);
  const tactical = { label: "Tactical", value: assessment.tactical };
  const positional = { label: "Positional", value: assessment.positional };
  const dimensions = exactTactic ? [positional, tactical] : [tactical, positional];
  const reasons = [
    ...(exactTactic ? [{ label: "Tactical", reason: exactTactic, basis: "Tablebase verified" }] : []),
    ...(checkingOrder ? [{
      label: "Tactical", reason: checkingOrder.explanation, basis: basisLabels["engine-supported"],
    }] : []),
    ...dimensions.flatMap(({ label, value }) =>
      value.support === "unestablished"
        ? []
        : value.reasons.filter((reason) => reason !== checkingOrder?.explanation)
            .map((reason) => ({ label, reason, basis: basisLabels[value.basis] })),
    ),
  ];
  const category = exactTactic
    ? assessment.positional.support === "supported" ? "mixed" : "tactical"
    : assessment.category;
  const summaryReasons = category === "mixed"
    ? reasons.filter(({ label }, index) => reasons.findIndex((item) => item.label === label) === index)
    : reasons.slice(0, 2);
  const resources = assessment.conditionalResources;
  const conditionalFork = assessment.conditionalFork;
  const forkConsequence = conditionalFork?.defenceConsequence?.description;
  const conditionalMate = assessment.conditionalMate;
  const matingLines = assessment.matingLines;
  const mateDefence = assessment.mateDefence;
  const quietThreat = assessment.quietMateThreat;
  return (
    <Paper withBorder p="xs">
      <Stack gap={6}>
        <Group gap="xs">
          <Text fw={600} size="sm">
            {title}
          </Text>
          <Badge size="sm" variant="light" color={categoryColors[category]}>
            {categoryLabels[category]}
          </Badge>
        </Group>
        {children}
        {reasons.length > 0 ? (
          (expanded ? reasons : summaryReasons).map(({ label, reason, basis }) => (
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
        {expanded && assessment.quietReply && (
          <Stack gap={4}>
            <Text size="xs" style={{ overflowWrap: "anywhere" }}>
              <Text component="span" fw={600} size="xs">
                If {assessment.quietReply.replySan}.{" "}
              </Text>
              {lineSan(assessment.quietReply.fen, assessment.quietReply.lineUci)}
            </Text>
            {assessment.quietReply.otherLineUci && (
              <Text size="xs" style={{ overflowWrap: "anywhere" }}>
                <Text component="span" fw={600} size="xs">Other response.{" "}</Text>
                {lineSan(assessment.quietReply.fen, assessment.quietReply.otherLineUci)}
              </Text>
            )}
          </Stack>
        )}
        {expanded && assessment.captureOrder && (
          <Stack gap={4}>
            <Text size="xs" style={{ overflowWrap: "anywhere" }}>
              <Text component="span" fw={600} size="xs">Defender first.{" "}</Text>
              {lineSan(assessment.captureOrder.fen, assessment.captureOrder.lineUci)}
            </Text>
            <Text size="xs" style={{ overflowWrap: "anywhere" }}>
              <Text component="span" fw={600} size="xs">Taking too early.{" "}</Text>
              {lineSan(assessment.captureOrder.fen, assessment.captureOrder.otherLineUci)}
            </Text>
          </Stack>
        )}
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
            {forkConsequence && !reasons.some(({ reason }) => reason === forkConsequence) && (
              <Text size="xs" style={{ overflowWrap: "anywhere" }}>
                {forkConsequence}
              </Text>
            )}
          </Stack>
        )}
        {expanded &&
          comparedLines?.map(({ label, san }) => (
            <Text key={`${label}:${san}`} size="xs" style={{ overflowWrap: "anywhere" }}>
              <Text component="span" fw={600} size="xs">
                {label}.{" "}
              </Text>
              {san}
            </Text>
          ))}
        {expanded && assessment.deferredPawnCapture && (
          <Text size="xs">{assessment.deferredPawnCapture.description}</Text>
        )}
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
        {expanded && quietThreat && (
          <Stack gap={4}>
            {quietThreat.defenceLinesUci.map((moves) => (
              <Text key={moves.join(" ")} size="xs" style={{ overflowWrap: "anywhere" }}>
                <Text component="span" fw={600} size="xs">
                  Defence.{" "}
                </Text>
                {lineSan(quietThreat.fen, moves)}
              </Text>
            ))}
            <Text size="xs" style={{ overflowWrap: "anywhere" }}>
              <Text component="span" fw={600} size="xs">
                {quietThreat.exampleWasSearched
                  ? "Searched reply that allows mate."
                  : "Example reply that allows mate."}{" "}
              </Text>
              {lineSan(quietThreat.fen, quietThreat.ignoredLineUci)}
            </Text>
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
          !!quietThreat ||
          !!mateDefence ||
          !!assessment.deferredPawnCapture ||
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

function checkingOrderLines(fen: string, proof?: CheckingOrderEvidence) {
  if (!proof) return [];
  return [
    { label: "Check first", san: lineSan(fen, proof.checkingLineUci) },
    { label: "Take immediately", san: lineSan(fen, proof.immediateCaptureLineUci) },
    ...(proof.defenceLineUci ? [{
      label: "Same reply after the better move", san: lineSan(fen, proof.defenceLineUci),
    }] : []),
    { label: "Better line", san: lineSan(fen, proof.betterLineUci) },
  ];
}

function DecisionReport({
  report,
  playedSan,
  target,
}: {
  report: ChessDecisionReport;
  playedSan?: string;
  target: DecisionSearchTarget;
}) {
  const [move, setMove] = useState(report.moves[0]?.moveUci);
  const [endgame, setEndgame] = useState<DecisionEndgameAssessment | null>(null);
  const listedMoves = report.playedMoveAssessment
    ? [...report.moves, report.playedMoveAssessment]
    : report.moves;
  const selected = listedMoves.find((item) => item.moveUci === move);
  const selectedOutcome = endgame?.moveOutcomes.find(({ uci }) => uci === move)?.outcome;
  const exactDefence = endgame?.defensiveTactic;
  const played = endgame?.played;
  const exactMistake = played && endgame && played.outcome < endgame.bestOutcome ? played : undefined;
  const exactMistakeTitle = exactMistake ? `What ${exactMistake.san} allows` : undefined;
  const exactMistakeDetails = exactMistake && endgame && (
    <EndgameMistakeOutcome result={endgame} played={exactMistake} />
  );
  const episode = report.mistake?.tacticalEpisode;
  const mate = report.mistake?.mateConsequence;
  const recovery = report.mistake?.tacticalRecovery;
  const mistakeComparison = report.mistake?.promotion ?? report.mistake?.sharedRay ?? episode;
  const rookPressure = report.mistake?.rookPressure;
  const pawnStructure = report.mistake?.pawnStructure;
  const passedAdvance = report.mistake?.passedAdvance;
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
                  label:
                    mate.mateIn === 1
                      ? "Move that avoids immediate mate"
                      : `Move that avoids mate in ${mate.mateIn}`,
                  san: lineSan(report.fen, mate.avoidingLineUci ?? [mate.avoidingMoveUci]),
                },
              ]
            : []),
        ]
      : [];
  for (const line of checkingOrderLines(report.fen, report.mistake?.checkingOrder)) {
    if (!mistakeLines.some(({ label }) => label === line.label)) mistakeLines.push(line);
  }
  for (const [comparison, detail] of [
    [rookPressure, "rook comparison"],
    [pawnStructure, "pawn structure"],
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
  for (const line of recoveryLines(report.fen, recovery, "played move", mistakeLines.length > 0))
    if (!mistakeLines.some(({ san }) => san === line.san)) mistakeLines.push(line);
  const castleDisplacement = report.mistake?.castleDisplacement;
  if (castleDisplacement) {
    mistakeLines.push({
      label: "Check after delaying castling",
      san: lineSan(report.fen, castleDisplacement.playedLineUci),
    });
    if (castleDisplacement.controlLineUci)
      mistakeLines.push({
        label: "Same check after castling first",
        san: lineSan(report.fen, castleDisplacement.controlLineUci),
      });
  }
  if (episode?.controlLineUci?.length) {
    mistakeLines.push({
      label: "Same attack after the better move",
      san: lineSan(report.fen, episode.controlLineUci),
    });
  }
  if (passedAdvance) {
    passedAdvance.testedAdvanceLines.forEach((moves, index) =>
      mistakeLines.push({
        label: `If the pawn advances in line ${index + 1}`,
        san: lineSan(report.fen, moves),
      }),
    );
  }
  const contrast = report.position.tacticalContrast;
  const checkpoint = report.position.preparedCheckpoint;
  const plan = report.position.strategicPlan;
  const promotion = report.position.promotionTactic;
  const pawnRole = report.position.sharedPassedPawn;
  const positionLines = [
    ...(plan?.linesUci ?? []), ...(promotion?.linesUci ?? []), ...(pawnRole?.linesUci ?? []),
    ...(report.position.retainedPawnSupport?.linesUci ?? []),
  ];
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
        exactTactic={exactDefence?.avoidingCapture}
        checkingOrder={report.position.checkingOrder}
        comparedLines={[
          ...(contrast
            ? [
                { label: "Better line", san: lineSan(report.fen, contrast.betterLineUci) },
                { label: "Refuted choice", san: lineSan(report.fen, contrast.playedLineUci) },
                ...(contrast.controlLineUci?.length ? [{
                  label: "Same capture after the better move",
                  san: lineSan(report.fen, contrast.controlLineUci),
                }] : []),
              ]
            : []),
          ...recoveryLines(report.fen, report.position.tacticalRecovery, "alternative"),
          ...checkingOrderLines(report.fen, report.position.checkingOrder),
          ...(checkpoint
            ? [
                { label: "Tactical continuation", san: lineSan(report.fen, checkpoint.lineUci) },
                { label: "Weaker continuation", san: lineSan(report.fen, checkpoint.alternativeUci) },
              ]
            : []),
          ...distinctPositionLines.map((moves) => ({
            label: `After ${lineSan(report.fen, moves.slice(0,
              promotion?.linesUci.includes(moves) || pawnRole?.linesUci.includes(moves) ? 2 : 1))}`,
            san: lineSan(report.fen, moves),
          })),
        ]}
      >
        <Text size="xs" c="dimmed">
          {report.position.examinedChoices} candidate moves examined
        </Text>
        {endgame ? (
          <EndgamePositionOutcome result={endgame} />
        ) : (
          <DecisionEndgameCheck target={target} onResult={setEndgame} />
        )}
      </EvidenceSummary>
      {selected && (
        <EvidenceSummary
          key={selected.moveUci}
          title="What the move achieves"
          assessment={selected}
          exactTactic={move && exactDefence?.safeMoves.includes(move)
            ? "The piece stays out of immediate capture and the draw holds."
            : undefined}
          comparedLines={[
            ...(selected.promotionTactic?.linesUci ?? []),
            ...(selected.passerFlight?.linesUci ?? []),
            ...(selected.settledExchangePlan?.linesUci ?? []),
            ...(selected.sharedPassedPawn?.linesUci ?? []),
            ...(selected.retainedPawnSupport?.linesUci ?? []),
            ...(selected.deferredPawnCapture?.linesUci.slice(1) ?? []),
          ]
            .filter(
              (moves, index, lines) =>
                lines.findIndex((other) => other.join(" ") === moves.join(" ")) === index,
            )
            .map((moves) => ({
              label: `After ${lineSan(report.fen, moves.slice(0, 2))}`,
              san: lineSan(report.fen, moves),
            }))}
        >
          <Select
            aria-label="Candidate move"
            size="xs"
            allowDeselect={false}
            value={selected.moveUci}
            onChange={(value) => {
              if (value) setMove(value);
            }}
            data={listedMoves.map((item, index) => ({
              value: item.moveUci,
              label: `${lineSan(report.fen, [item.moveUci]) || item.moveUci}${index === 0 ? " · Engine’s first choice" : item === report.playedMoveAssessment ? " · Played move" : ""}`,
            }))}
          />
          {selectedOutcome !== undefined && (
            <Text size="xs" c="dimmed">Tablebase · {endgameOutcome[selectedOutcome]}</Text>
          )}
        </EvidenceSummary>
      )}
      {report.mistake ? (
        <EvidenceSummary
          title={exactMistakeTitle ?? (playedSan ? `What ${playedSan} missed or allowed` : "Mistake mechanism")}
          assessment={report.mistake}
          checkingOrder={report.mistake.checkingOrder}
          comparedLines={mistakeLines}
          exactTactic={exactMistake?.reply?.cause}
        >
          {exactMistakeDetails}
          {played && !exactMistake && (
            <Text size="xs" c="dimmed">Tablebase · {played.san} keeps the same outcome.</Text>
          )}
          {report.mistake.evaluationLossCp !== null && (
            <Text size="xs" c="dimmed">
              Engine evaluation loss {(report.mistake.evaluationLossCp / 100).toFixed(2)} pawns
            </Text>
          )}
        </EvidenceSummary>
      ) : exactMistake && endgame ? (
        <ExactEndgameMistake result={endgame} played={exactMistake} />
      ) : played ? (
        <Text size="xs" c="dimmed">Tablebase · {played.san} keeps the same outcome.</Text>
      ) : report.mistakeStatus !== "not-requested" && report.mistakeStatus !== "assessed" ? (
        <Text size="xs" c="dimmed">
          {mistakeSummary[report.mistakeStatus]}
        </Text>
      ) : null}
    </Stack>
  );
}

function EndgamePositionOutcome({ result }: { result: DecisionEndgameAssessment }) {
  const count = result.bestMoves.length;
  return (
    <Text size="xs">
      Tablebase · {endgameOutcome[result.bestOutcome]} with best play.
      {result.bestOutcome >= 0 && (
        <>
          {" "}{count} of {result.legalMoveCount} legal moves {result.bestOutcome === 0 ? "draw" : "win"}.
          {count <= 6 && count < result.legalMoveCount &&
            ` ${result.bestMoves.map(({ san }) => san).join(", ")}.`}
        </>
      )}
    </Text>
  );
}

type EndgameMistakeProps = {
  result: DecisionEndgameAssessment;
  played: NonNullable<DecisionEndgameAssessment["played"]>;
};

function EndgameMistakeOutcome({ result, played }: EndgameMistakeProps) {
  return (
    <Text size="xs" c="dimmed">
      Tablebase · {endgameOutcome[result.bestOutcome]} → {endgameOutcome[played.outcome]}.
      {played.reply
        ? !played.reply.cause && ` Best reply ${played.reply.san}.`
        : " A reply could not be verified."}
    </Text>
  );
}

function ExactEndgameMistake({ result, played }: EndgameMistakeProps) {
  return (
    <Paper withBorder p="xs">
      <Stack gap={6}>
        <Group gap="xs">
          <Text fw={600} size="sm">What {played.san} allows</Text>
          {played.reply?.cause && <Badge variant="light" color="orange" size="sm">Tactical</Badge>}
        </Group>
        <EndgameMistakeOutcome result={result} played={played} />
        {played.reply?.cause && (
          <Text size="xs">Tablebase verified. {played.reply.cause}</Text>
        )}
      </Stack>
    </Paper>
  );
}

function EndgameFallback({ target }: { target: DecisionSearchTarget }) {
  const [result, setResult] = useState<DecisionEndgameAssessment | null>(null);
  if (!result) return <DecisionEndgameCheck target={target} onResult={setResult} />;
  return (
    <Stack gap={6}>
      <EndgamePositionOutcome result={result} />
      {result.defensiveTactic && (
        <Text size="xs">Tactical · Tablebase verified. {result.defensiveTactic.avoidingCapture}</Text>
      )}
      {result.played && (result.played.outcome < result.bestOutcome ? (
        <ExactEndgameMistake result={result} played={result.played} />
      ) : (
        <Text size="xs" c="dimmed">Tablebase · {result.played.san} keeps the same outcome.</Text>
      ))}
    </Stack>
  );
}

type RunState =
  | { status: "idle" }
  | { status: "running"; phase: string }
  | { status: "done"; report: ChessDecisionReport; target: DecisionSearchTarget; playedSan?: string }
  | { status: "error"; target: DecisionSearchTarget; message: string };

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
      setState({ status: "done", report: cached, target, playedSan });
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
      let input = await gatherDecisionEvidence(engine, target, owned.signal, progress, deadline);
      progress("Verifying the continuations…");
      let report = await classifyDecisionInWorker(
        { input, engineName: engine.name, history: target.history },
        owned.signal,
      );
      const checkDefence = report.mistake?.checkingDefenceRequest;
      if (checkDefence && active() && Date.now() < deadline) {
        progress("Comparing defensive replies…");
        const checkingDefence = await gatherCheckingDefence(
          engine,
          target,
          checkDefence,
          owned.signal,
          deadline,
        ).catch(() => null);
        if (checkingDefence && active()) {
          input = { ...input, checkingDefence };
          report = await classifyDecisionInWorker(
            { input, engineName: engine.name, history: target.history },
            owned.signal,
          ).catch(() => report);
        }
      }
      const pawn = report.mistake?.passedAdvanceRequest;
      if (pawn && active() && Date.now() < deadline) {
        progress("Checking whether the passed pawn can advance…");
        const passedAdvance = await gatherPassedAdvance(engine, target, pawn, owned.signal, deadline).catch(() => []);
        if (passedAdvance.length && active()) {
          input = { ...input, passedAdvance };
          report = await classifyDecisionInWorker(
            { input, engineName: engine.name, history: target.history },
            owned.signal,
          ).catch(() => report);
        }
      }
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
          input = { ...input, preparedCheckpoint };
          report = await classifyDecisionInWorker(
            {
              input,
              engineName: engine.name,
              history: target.history,
            },
            owned.signal,
          ).catch(() => report);
        }
      }
      if (active() && report.position.tactical.support !== "supported" && Date.now() < deadline) {
        const siblingRefutation = await gatherSiblingRefutation(
          engine, target, input, owned.signal, deadline, progress,
        );
        if (active() && siblingRefutation) {
          input = { ...input, siblingRefutation };
          report = await classifyDecisionInWorker(
            { input, engineName: engine.name, history: target.history },
            owned.signal,
          ).catch(() => report);
        }
      }
      const scopes = {
        mistake: !!report.mistake,
        position: report.position.tactical.support !== "supported",
      };
      const leadingMove = report.moves[0];
      if (leadingMove?.tactical.support === "supported" && leadingMove.positional.support !== "supported"
          && active() && Date.now() < deadline) {
        const captureRouteReply = await gatherCaptureRouteReply(engine, target, input, owned.signal, deadline, progress);
        if (active() && captureRouteReply) {
          input = { ...input, captureRouteReply };
          report = await classifyDecisionInWorker(
            { input, engineName: engine.name, history: target.history }, owned.signal,
          ).catch(() => report);
        }
      }
      if ((scopes.mistake || scopes.position) && active() && Date.now() < deadline) {
        const checkingOrder = await gatherCheckingOrder(
          engine, target, input, scopes, owned.signal, deadline, progress,
        );
        if (active() && checkingOrder) {
          input = { ...input, checkingOrder };
          report = await classifyDecisionInWorker(
            { input, engineName: engine.name, history: target.history },
            owned.signal,
          ).catch(() => report);
        }
      }
      if (active() && Date.now() < deadline) {
        const unproved = new Set(report.moves
          .filter(move => move.tactical.support !== "supported").map(move => move.moveUci));
        const quietReply = await gatherQuietReply(engine, target, input, unproved, owned.signal, deadline, progress);
        if (active() && quietReply) {
          input = { ...input, quietReply };
          report = await classifyDecisionInWorker(
            { input, engineName: engine.name, history: target.history },
            owned.signal,
          ).catch(() => report);
        }
      }
      if (active() && Date.now() < deadline) {
        const unproved = new Set(report.moves
          .filter(move => move.tactical.support !== "supported").map(move => move.moveUci));
        const captureOrder = await gatherCaptureOrder(engine, target, input, unproved, owned.signal, deadline, progress);
        if (active() && captureOrder) {
          input = { ...input, captureOrder };
          report = await classifyDecisionInWorker(
            { input, engineName: engine.name, history: target.history }, owned.signal,
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
      setState({ status: "done", report, target, playedSan });
    } catch (error) {
      if (active())
        setState({
          status: "error",
          target,
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
        <>
          <Alert color="orange" role="alert">{state.message}</Alert>
          <EndgameFallback key={JSON.stringify(state.target)} target={state.target} />
        </>
      )}
      {state.status === "done" && (
        <ScrollArea.Autosize mah={340} offsetScrollbars>
          <DecisionReport
            key={JSON.stringify(state.target)}
            report={state.report}
            playedSan={state.playedSan}
            target={state.target}
          />
        </ScrollArea.Autosize>
      )}
    </Stack>
  );
}
