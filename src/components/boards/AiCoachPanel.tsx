import {
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Loader,
  Paper,
  Progress,
  ScrollArea,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { IconAlertTriangle, IconSparkles } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { useContext, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type {
  BestMoves,
  CoachChatMessage,
  CoachEngineLine,
  CoachGameAnalysisPoint,
  CoachOpeningContext,
  CoachTargetedResult,
} from "@/bindings";
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
  lichessOptionsAtom,
  moveStrengthSettingsAtom,
  sessionsAtom,
} from "@/state/atoms";
import { getPGN, getVariationLine, headersToPGN } from "@/utils/chess";
import { buildAiCoachOpeningContext } from "@/utils/aiCoachOpeningContext";
import { positionFromFen } from "@/utils/chessops";
import type { Engine, LocalEngine } from "@/utils/engines";
import { formatScore } from "@/utils/score";
import { type TreeNode, treeIteratorMainLine } from "@/utils/treeReducer";
import { unwrap } from "@/utils/unwrap";

type CoachUiMessage = CoachChatMessage & {
  id: string;
  basePath?: number[];
};

type CoachMessageSegment = { type: "text"; text: string } | { type: "line"; text: string };

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

function wantsWholeGameContext(question: string): boolean {
  return /\b(whole|entire|full)\s+game\b|\bwhat\s+went\s+wrong\b|\bwhere\s+did\s+i\s+go\s+wrong\b|\b(analy[sz]e|review)\s+(my\s+)?game\b|\bgame\s+review\b|\bmy\s+mistakes?\b|\bturning\s+point\b/i.test(
    question,
  );
}

function buildGameAnalysisContext(root: TreeNode): CoachGameAnalysisPoint[] {
  return [...treeIteratorMainLine(root)]
    .filter(({ position }) => position.length > 0)
    .map(({ node }) => ({
      ply: node.halfMoves,
      move: node.san ?? `Ply ${node.halfMoves}`,
      fen: node.fen,
      eval: node.score ? formatScore(node.score.value) : null,
      depth: node.depth,
      annotations: node.annotations,
    }))
    .filter((point) => point.eval || point.annotations.length > 0)
    .slice(0, 240);
}

function splitCoachMessage(content: string): CoachMessageSegment[] {
  const segments: CoachMessageSegment[] = [];
  const pattern = /<line>([\s\S]*?)<\/line>/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > cursor) {
      segments.push({ type: "text", text: content.slice(cursor, match.index) });
    }
    const line = match[1]?.trim();
    if (line) {
      segments.push({ type: "line", text: line });
    }
    cursor = pattern.lastIndex;
  }

  if (cursor < content.length) {
    segments.push({ type: "text", text: content.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ type: "text", text: content }];
}

function tokenizePlayableLine(line: string): string[] {
  return line
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .map((token) =>
      token
        .trim()
        .replace(/^\d+\.(\.\.)?/, "")
        .replace(/^[,;:]+|[,;:]+$/g, ""),
    )
    .filter(
      (token) =>
        token.length > 0 &&
        token !== "*" &&
        token !== "1-0" &&
        token !== "0-1" &&
        token !== "1/2-1/2" &&
        !/^\d+\.*$/.test(token),
    );
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${secs}s`;
}

function getCoachProgressSteps({
  elapsedSecs,
  hasCachedLines,
  hasLichessToken,
  model,
  timeoutSecs,
}: {
  elapsedSecs: number;
  hasCachedLines: boolean;
  hasLichessToken: boolean;
  model: string;
  timeoutSecs: number;
}) {
  const nearTimeoutAt = Math.max(20, timeoutSecs - 15);
  return [
    {
      at: 0,
      label: "Collecting position",
      detail: "Gathering FEN, side to move, current-line PGN, and chat history.",
    },
    {
      at: 1,
      label: hasLichessToken ? "Fetching Lichess All stats" : "Skipping Lichess All stats",
      detail: hasLichessToken
        ? "Pulling opening move counts and blended strength for this FEN."
        : "No Lichess session token is available for explorer context.",
    },
    {
      at: hasLichessToken ? 4 : 2,
      label: hasCachedLines ? "Using current Stockfish lines" : "Running Stockfish MultiPV",
      detail: hasCachedLines
        ? "Reusing the analysis already shown for this board."
        : "Asking the local engine for 3-8 principal variations.",
    },
    {
      at: hasCachedLines ? 5 : 8,
      label: "Building coach prompt",
      detail: "Packaging Stockfish truth, opening stats, and the chat thread for Gemini.",
    },
    {
      at: hasCachedLines ? 6 : 10,
      label: `Asking ${model || "Gemini"}`,
      detail: "Waiting for the local Gemini CLI response.",
    },
    {
      at: 25,
      label: "Still waiting on Gemini",
      detail: "Longer chess prompts can take a while, especially on the first request.",
    },
    {
      at: 45,
      label: "Checking for follow-up analysis",
      detail: "If Gemini asks for legal targeted Stockfish checks, the app will run them and ask again.",
    },
    {
      at: nearTimeoutAt,
      label: "Near timeout",
      detail: "The local request will stop soon if Gemini does not answer.",
    },
  ].filter((step) => step.at <= nearTimeoutAt || elapsedSecs >= step.at);
}

export default function AiCoachPanel() {
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
  const sessions = useAtomValue(sessionsAtom);
  const lichessOptions = useAtomValue(lichessOptionsAtom);
  const moveStrengthSettings = useAtomValue(moveStrengthSettingsAtom);
  const explorerToken = sessions.find((session) => session.lichess?.accessToken)?.lichess
    ?.accessToken;
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
        .slice(0, Math.max(3, Math.min(8, multipv)))
        .map(toCoachLine),
    [engineMoves, movesKey, multipv, rootFen],
  );

  const [question, setQuestion] = useState("What is the plan here?");
  const [messages, setMessages] = useState<CoachUiMessage[]>([]);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [usedExistingAnalysis, setUsedExistingAnalysis] = useState(false);
  const [targetedCount, setTargetedCount] = useState(0);
  const [targetedMemory, setTargetedMemory] = useState<CoachTargetedResult[]>([]);
  const [targetedMemoryFen, setTargetedMemoryFen] = useState("");
  const [openingContextStatus, setOpeningContextStatus] = useState<
    "idle" | "loading" | "ready" | "unavailable" | "error"
  >("idle");
  const [openingMoveCount, setOpeningMoveCount] = useState(0);
  const [modelUsed, setModelUsed] = useState("");
  const [requestStartedAt, setRequestStartedAt] = useState<number | null>(null);
  const [elapsedSecs, setElapsedSecs] = useState(0);

  const [position] = useMemo(() => positionFromFen(currentNode.fen), [currentNode.fen]);
  const sideToMove =
    position?.turn ?? (currentNode.fen.split(/\s+/)[1] === "b" ? "black" : "white");
  const selectedMove = currentNode.san
    ? `${currentNode.san} at ply ${currentNode.halfMoves}`
    : "Game start";
  const currentPath = useStore(
    store,
    useShallow((state) => state.position),
  );
  const coachHeaders = useMemo(
    () =>
      headers
        ? {
            ...headers,
            result: "*" as const,
            white_elo: undefined,
            black_elo: undefined,
          }
        : null,
    [headers],
  );
  const currentLinePgn = useMemo(() => {
    if (currentPath.length === 0) {
      return coachHeaders ? `${headersToPGN(coachHeaders)}\n*`.trim() : "*";
    }

    return getPGN(root, {
      headers: coachHeaders,
      glyphs: true,
      comments: true,
      variations: false,
      extraMarkups: true,
      path: currentPath,
    });
  }, [coachHeaders, currentPath, root]);
  const wholeGamePgn = useMemo(() => {
    return getPGN(root, {
      headers: coachHeaders,
      glyphs: true,
      comments: true,
      variations: false,
      extraMarkups: true,
    });
  }, [coachHeaders, root]);
  const gameAnalysis = useMemo(() => buildGameAnalysisContext(root), [root]);
  const canSubmit = Boolean(enabled && coachEngine && question.trim().length > 0 && !loading);
  const clampedMultipv = Math.max(3, Math.min(8, multipv));
  const hasCachedLines = existingLines.length >= clampedMultipv;
  const progressSteps = useMemo(
    () =>
      getCoachProgressSteps({
        elapsedSecs,
        hasCachedLines,
        hasLichessToken: Boolean(explorerToken),
        model: geminiModel,
        timeoutSecs,
      }),
    [elapsedSecs, explorerToken, geminiModel, hasCachedLines, timeoutSecs],
  );
  const activeProgressStep =
    [...progressSteps].reverse().find((step) => elapsedSecs >= step.at) ?? progressSteps[0];
  const progressValue = loading
    ? Math.min(96, Math.max(8, (elapsedSecs / Math.max(1, timeoutSecs)) * 100))
    : answer
      ? 100
      : 0;

  useEffect(() => {
    if (!loading || requestStartedAt === null) return;

    const updateElapsed = () =>
      setElapsedSecs(Math.max(0, Math.floor((Date.now() - requestStartedAt) / 1000)));
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 500);
    return () => window.clearInterval(interval);
  }, [loading, requestStartedAt]);

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
    const pgnScope = wantsWholeGameContext(trimmedQuestion) ? "whole_game" : "current_line";
    const requestPgn = pgnScope === "whole_game" ? wholeGamePgn : currentLinePgn;
    const requestGameAnalysis = pgnScope === "whole_game" ? gameAnalysis : [];

    const userMessage: CoachUiMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmedQuestion,
      basePath: currentPath,
    };
    const chatHistory = messages.map(({ role, content }) => ({ role, content }));
    const priorTargetedResults = targetedMemoryFen === currentNode.fen ? targetedMemory : [];

    setLoading(true);
    setError("");
    setAnswer("");
    setTargetedCount(0);
    setUsedExistingAnalysis(false);
    setModelUsed("");
    setOpeningContextStatus("loading");
    setOpeningMoveCount(0);
    setElapsedSecs(0);
    setRequestStartedAt(Date.now());
    setQuestion("");
    setMessages((current) => [...current, userMessage]);

    try {
      let openingContext: CoachOpeningContext | null = null;
      let openingContextError: string | null = null;
      try {
        openingContext = await buildAiCoachOpeningContext({
          fen: currentNode.fen,
          sideToMove,
          lichessOptions,
          token: explorerToken,
          strengthSettings: moveStrengthSettings,
        });
        setOpeningContextStatus(openingContext ? "ready" : "unavailable");
        setOpeningMoveCount(openingContext?.moves.length ?? 0);
      } catch (err) {
        openingContextError = err instanceof Error ? err.message : String(err);
        setOpeningContextStatus("error");
      }

      const response = unwrap(
        await commands.askAiCoach({
          fen: currentNode.fen,
          sideToMove,
          moveHistory: moves,
          pgn: requestPgn,
          pgnScope,
          gameAnalysis: requestGameAnalysis,
          selectedMove,
          question: trimmedQuestion,
          chatHistory,
          existingLines,
          priorTargetedResults,
          openingContext,
          openingContextError,
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
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: response.answer,
          basePath: currentPath,
        },
      ]);
      setUsedExistingAnalysis(response.usedExistingAnalysis);
      setTargetedCount(response.targetedResults.length);
      setTargetedMemory(response.targetedResults);
      setTargetedMemoryFen(currentNode.fen);
      setModelUsed(response.model);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRequestStartedAt(null);
    }
  }

  function playCoachLine(line: string, basePath?: number[]) {
    const payload = tokenizePlayableLine(line);
    if (payload.length === 0) return;

    const targetPath = [...(basePath ?? currentPath)];
    store.getState().goToMove(targetPath);
    window.setTimeout(() => {
      store.getState().makeMoves({
        payload,
        mainline: false,
        changeHeaders: false,
      });
    }, 0);
  }

  function clearChat() {
    setMessages([]);
    setAnswer("");
    setError("");
    setTargetedCount(0);
    setTargetedMemory([]);
    setTargetedMemoryFen("");
    setOpeningContextStatus("idle");
    setOpeningMoveCount(0);
  }

  return (
    <Stack h="100%" gap="sm" style={{ minHeight: 0 }}>
      <Group justify="space-between" gap="xs" wrap="wrap">
        <Group gap="xs" wrap="wrap">
          <Text fw={700}>AI Coach</Text>
          <Badge variant="light">{coachEngine?.name ?? "No Stockfish"}</Badge>
          <Badge variant="light">{modelUsed || geminiModel || "Gemini"}</Badge>
          {existingLines.length > 0 && <Badge variant="outline">cached lines</Badge>}
          {targetedCount > 0 && <Badge variant="outline">targeted Stockfish</Badge>}
          {openingContextStatus === "ready" && (
            <Badge variant="outline">Lichess All {openingMoveCount} moves</Badge>
          )}
          {openingContextStatus === "loading" && <Badge variant="outline">Lichess All...</Badge>}
          {openingContextStatus === "error" && (
            <Badge color="yellow" variant="outline">
              Lichess All unavailable
            </Badge>
          )}
          {usedExistingAnalysis && <Badge variant="outline">used current analysis</Badge>}
        </Group>
        {messages.length > 0 && (
          <Button size="xs" variant="subtle" disabled={loading} onClick={clearChat}>
            Clear chat
          </Button>
        )}
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

      <Paper withBorder p="xs">
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            Current FEN
          </Text>
          <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {currentNode.fen}
          </Code>
        </Stack>
      </Paper>

      <ScrollArea flex={1} offsetScrollbars style={{ minHeight: 0 }}>
        <Stack gap="xs" pr="xs">
          {messages.length === 0 && !loading && (
            <Paper withBorder p="sm">
              <Text size="sm" c="dimmed">
                Ask about the current position. The coach can request more Stockfish analysis when
                your follow-up names a move, line, or what-if.
              </Text>
            </Paper>
          )}
          {messages.map((message) => (
            <Paper
              key={message.id}
              withBorder
              p="sm"
              bg={message.role === "user" ? "var(--mantine-color-dark-6)" : undefined}
            >
              <Stack gap={6}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  {message.role === "user" ? "You" : "Coach"}
                </Text>
                <CoachMessageContent
                  content={message.content}
                  onPlayLine={(line) => playCoachLine(line, message.basePath)}
                />
              </Stack>
            </Paper>
          ))}
          {loading && (
            <Paper withBorder p="sm">
              <Stack gap="xs">
                <Group justify="space-between" gap="xs">
                  <Stack gap={2}>
                    <Text size="sm" fw={600}>
                      {activeProgressStep.label}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {activeProgressStep.detail}
                    </Text>
                  </Stack>
                  <Badge variant="light">{formatElapsed(elapsedSecs)}</Badge>
                </Group>
                <Progress value={progressValue} animated size="sm" radius="xl" />
                <Stack gap={4}>
                  {progressSteps.map((step) => {
                    const complete = elapsedSecs >= step.at;
                    const active = step === activeProgressStep;
                    return (
                      <Group key={step.label} gap="xs" wrap="nowrap">
                        <Badge
                          size="xs"
                          variant={active ? "filled" : complete ? "light" : "outline"}
                          color={active ? "blue" : complete ? "green" : "gray"}
                        >
                          {complete ? "done" : "next"}
                        </Badge>
                        <Text size="xs" fw={active ? 600 : 400}>
                          {step.label}
                        </Text>
                      </Group>
                    );
                  })}
                </Stack>
                <Text size="xs" c="dimmed">
                  Showing the local pipeline; Gemini private reasoning is not exposed.
                </Text>
              </Stack>
            </Paper>
          )}
        </Stack>
      </ScrollArea>

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size="1rem" />}>
          {error}
        </Alert>
      )}

      <Box>
        <Group align="flex-end" gap="xs" wrap="nowrap">
          <Textarea
            flex={1}
            autosize
            minRows={2}
            maxRows={5}
            placeholder="Ask a follow-up about this position..."
            value={question}
            spellCheck
            disabled={loading}
            onChange={(event) => setQuestion(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void askCoach();
              }
            }}
          />
          <Button
            leftSection={loading ? <Loader size="xs" /> : <IconSparkles size="1rem" />}
            loading={loading}
            disabled={!canSubmit}
            onClick={() => void askCoach()}
          >
            Ask
          </Button>
        </Group>
        <Text size="xs" c="dimmed" mt={4}>
          Gemini explains; Stockfish supplies the chess truth. Use Ctrl+Enter to send.
        </Text>
      </Box>
    </Stack>
  );
}

function CoachMessageContent({
  content,
  onPlayLine,
}: {
  content: string;
  onPlayLine: (line: string) => void;
}) {
  return (
    <Stack gap={6}>
      {splitCoachMessage(content).map((segment, index) =>
        segment.type === "line" ? (
          <Button
            key={`${segment.type}-${index}-${segment.text}`}
            size="compact-xs"
            variant="light"
            leftSection={<IconSparkles size="0.85rem" />}
            style={{ alignSelf: "flex-start", whiteSpace: "normal", height: "auto" }}
            onClick={() => onPlayLine(segment.text)}
          >
            {segment.text}
          </Button>
        ) : (
          <Text key={`${segment.type}-${index}`} size="sm" style={{ whiteSpace: "pre-wrap" }}>
            {segment.text}
          </Text>
        ),
      )}
    </Stack>
  );
}
