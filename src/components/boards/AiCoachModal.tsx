import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { IconAlertTriangle, IconSparkles } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { useContext, useMemo, useState } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { BestMoves, CoachEngineLine } from "@/bindings";
import { commands } from "@/bindings";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  activeTabAtom,
  aiCoachEnabledAtom,
  aiCoachGeminiCommandAtom,
  aiCoachGeminiModelAtom,
  aiCoachMultipvAtom,
  aiCoachTimeoutSecsAtom,
  engineMovesFamily,
  enginesAtom,
} from "@/state/atoms";
import { getPGN, getVariationLine } from "@/utils/chess";
import { positionFromFen } from "@/utils/chessops";
import type { Engine, LocalEngine } from "@/utils/engines";
import { formatScore } from "@/utils/score";
import { unwrap } from "@/utils/unwrap";

function isLocalEngine(engine: Engine): engine is LocalEngine {
  return engine.type === "local";
}

function looksLikeStockfish(engine: LocalEngine): boolean {
  const haystack = `${engine.name} ${engine.path}`.toLowerCase();
  return haystack.includes("stockfish");
}

function pickCoachEngine(engines: Engine[] | null | undefined): LocalEngine | null {
  const localEngines = (engines ?? []).filter(isLocalEngine);
  return (
    localEngines.find((engine) => engine.loaded && looksLikeStockfish(engine)) ??
    localEngines.find((engine) => engine.loaded) ??
    localEngines.find(looksLikeStockfish) ??
    localEngines[0] ??
    null
  );
}

function toCoachLine(line: BestMoves): CoachEngineLine {
  return {
    multipv: line.multipv,
    depth: line.depth,
    eval: formatScore(line.score.value),
    uciMoves: line.uciMoves,
    sanMoves: line.sanMoves,
  };
}

export default function AiCoachModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (state) => state.root);
  const headers = useStore(store, (state) => state.headers);
  const currentNode = useStore(
    store,
    useShallow((state) => {
      const node = state.currentNode();
      return {
        fen: node.fen,
        halfMoves: node.halfMoves,
        san: node.san,
      };
    }),
  );
  const moves = useStore(
    store,
    useShallow((state) => getVariationLine(state.root, state.position)),
  );
  const movesKey = useMemo(() => moves.join(","), [moves]);
  const rootFen = root.fen;

  const enabled = useAtomValue(aiCoachEnabledAtom);
  const geminiCommand = useAtomValue(aiCoachGeminiCommandAtom);
  const geminiModel = useAtomValue(aiCoachGeminiModelAtom);
  const multipv = useAtomValue(aiCoachMultipvAtom);
  const timeoutSecs = useAtomValue(aiCoachTimeoutSecsAtom);
  const engines = useAtomValue(enginesAtom);
  const activeTab = useAtomValue(activeTabAtom);
  const coachEngine = useMemo(() => pickCoachEngine(engines), [engines]);
  const engineMoves = useAtomValue(
    engineMovesFamily({
      engine: coachEngine?.id ?? "__ai_coach_no_engine__",
      tab: activeTab ?? "__ai_coach_no_tab__",
    }),
  );
  const existingLines = useMemo(
    () =>
      (engineMoves.get(`${rootFen}:${movesKey}`) ?? [])
        .slice(0, Math.max(3, Math.min(5, multipv)))
        .map(toCoachLine),
    [engineMoves, movesKey, multipv, rootFen],
  );

  const [question, setQuestion] = useState("What is the plan here?");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [usedExistingAnalysis, setUsedExistingAnalysis] = useState(false);
  const [targetedCount, setTargetedCount] = useState(0);
  const [modelUsed, setModelUsed] = useState("");

  const [position] = useMemo(() => positionFromFen(currentNode.fen), [currentNode.fen]);
  const sideToMove =
    position?.turn ?? (currentNode.fen.split(/\s+/)[1] === "b" ? "black" : "white");
  const selectedMove = currentNode.san
    ? `${currentNode.san} at ply ${currentNode.halfMoves}`
    : "Game start";
  const pgn = useMemo(
    () =>
      getPGN(root, {
        headers,
        glyphs: true,
        comments: false,
        variations: true,
        extraMarkups: true,
      }),
    [headers, root],
  );

  const canSubmit = Boolean(enabled && coachEngine && question.trim().length > 0 && !loading);

  async function askCoach() {
    if (!enabled) {
      setError("AI Coach is disabled in Settings.");
      return;
    }
    if (!coachEngine) {
      setError(
        "No local Stockfish engine is configured. Add or load Stockfish from Engines first.",
      );
      return;
    }
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) return;

    setLoading(true);
    setError("");
    setAnswer("");
    setTargetedCount(0);
    setUsedExistingAnalysis(false);
    setModelUsed("");

    try {
      const response = unwrap(
        await commands.askAiCoach({
          fen: currentNode.fen,
          sideToMove,
          moveHistory: moves,
          pgn,
          selectedMove,
          question: trimmedQuestion,
          existingLines,
          enginePath: coachEngine.path,
          settings: {
            enabled,
            geminiCommand,
            geminiModel,
            multipv,
            timeoutSecs,
          },
        }),
      );
      setAnswer(response.answer);
      setUsedExistingAnalysis(response.usedExistingAnalysis);
      setTargetedCount(response.targetedResults.length);
      setModelUsed(response.model);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="AI Coach" size="lg" centered>
      <Stack gap="sm">
        <Group gap="xs">
          <Badge variant="light">{coachEngine?.name ?? "No Stockfish"}</Badge>
          <Badge variant="light">{modelUsed || geminiModel || "Gemini"}</Badge>
          {existingLines.length > 0 && <Badge variant="outline">cached lines</Badge>}
          {targetedCount > 0 && <Badge variant="outline">targeted Stockfish</Badge>}
          {usedExistingAnalysis && <Badge variant="outline">used current analysis</Badge>}
        </Group>

        {!enabled && (
          <Alert color="yellow" icon={<IconAlertTriangle size="1rem" />}>
            AI Coach is disabled in Settings.
          </Alert>
        )}
        {!coachEngine && (
          <Alert color="red" icon={<IconAlertTriangle size="1rem" />}>
            Add a local Stockfish engine in Engines before using Coach.
          </Alert>
        )}

        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            Current FEN
          </Text>
          <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {currentNode.fen}
          </Code>
        </Stack>

        <Textarea
          label="Question"
          autosize
          minRows={3}
          maxRows={7}
          value={question}
          spellCheck
          onChange={(event) => setQuestion(event.currentTarget.value)}
        />

        <Group justify="space-between" gap="xs">
          <Text size="xs" c="dimmed">
            Gemini explains; Stockfish supplies the chess truth.
          </Text>
          <Button
            leftSection={loading ? <Loader size="xs" /> : <IconSparkles size="1rem" />}
            loading={loading}
            disabled={!canSubmit}
            onClick={() => void askCoach()}
          >
            Ask Coach
          </Button>
        </Group>

        {error && (
          <Alert color="red" icon={<IconAlertTriangle size="1rem" />}>
            {error}
          </Alert>
        )}

        {answer && (
          <Paper withBorder p="sm">
            <ScrollArea.Autosize mah={360} offsetScrollbars>
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {answer}
              </Text>
            </ScrollArea.Autosize>
          </Paper>
        )}
      </Stack>
    </Modal>
  );
}
