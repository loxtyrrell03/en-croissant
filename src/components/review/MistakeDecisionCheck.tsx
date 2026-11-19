import { useAtomValue } from "jotai";
import { makeUci, parseUci } from "chessops/util";
import { parseSan } from "chessops/san";
import { DecisionEvidencePanel } from "@/components/panels/tactics/DecisionEvidencePanel";
import type { Position } from "@/components/files/opening";
import { enginesAtom } from "@/state/atoms";
import { positionFromFen } from "@/utils/chessops";
import type { LocalEngine } from "@/utils/engines";

export function MistakeDecisionCheck({
  position,
  revealAnswer,
}: {
  position: Position | null;
  revealAnswer: boolean;
}) {
  if (!revealAnswer || !position?.mistakeReview) return null;
  return <RevealedMistakeDecisionCheck position={position} />;
}

function RevealedMistakeDecisionCheck({ position }: { position: Position }) {
  const engines = useAtomValue(enginesAtom);
  const mistake = position.mistakeReview!;
  const local = (engines ?? []).filter((engine): engine is LocalEngine => engine.type === "local");
  const engine =
    local.find((item) => item.path === mistake.enginePath) ??
    local.find((item) => /stockfish/i.test(item.name)) ??
    local[0];
  if (!engine) return null;
  const [board] = positionFromFen(position.fen);
  const played =
    board &&
    (mistake.playedMoveUci
      ? parseUci(mistake.playedMoveUci)
      : mistake.playedMoveSan
        ? parseSan(board, mistake.playedMoveSan)
        : undefined);
  if (!board || !played || !board.isLegal(played)) return null;
  const playedMoveUci = makeUci(played);
  const history = mistake.tacticalHistory;
  return (
    <DecisionEvidencePanel
      key={JSON.stringify([
        position.fen,
        playedMoveUci,
        history,
        mistake.gameId,
        engine.id,
        engine.path,
        engine.settings,
      ])}
      engine={engine}
      previous={{ fen: position.fen, playedMoveUci, history }}
      previousSan={mistake.playedMoveSan}
      moveActionLabel="Analyse this mistake"
    />
  );
}
