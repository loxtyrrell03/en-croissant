import {
  Alert,
  Badge,
  Box,
  Button,
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
import { listen } from "@tauri-apps/api/event";
import { useAtomValue } from "jotai";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type {
  BestMoves,
  CoachChatMessage,
  CoachEngineLine,
  CoachGameAnalysisPoint,
  CoachOpeningContext,
  CoachReferenceContext,
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
  aiCoachPlannerModelAtom,
  aiCoachTimeoutSecsAtom,
  engineMovesFamily,
  enginesAtom,
  lichessOptionsAtom,
  moveStrengthSettingsAtom,
  sessionsAtom,
} from "@/state/atoms";
import { getPGN, getVariationLine, headersToPGN, uciNormalize } from "@/utils/chess";
import { buildAiCoachOpeningContext } from "@/utils/aiCoachOpeningContext";
import { positionFromFen } from "@/utils/chessops";
import type { Engine, LocalEngine } from "@/utils/engines";
import { formatScore } from "@/utils/score";
import { type TreeNode, treeIteratorMainLine } from "@/utils/treeReducer";
import { unwrap } from "@/utils/unwrap";

type CoachUiMessage = CoachChatMessage & {
  id: string;
  baseFen?: string;
  basePath?: number[];
  baseHalfMoves?: number;
  baseSanMoves?: string[];
};

type CoachMessageSegment = { type: "text"; text: string } | { type: "line"; text: string };

type MainlineMove = {
  san: string;
  path: number[];
  halfMoves: number;
};

type PreparedCoachMove = {
  san: string;
  prefix: string[];
  label: string;
};

type PreparedCoachLine = {
  basePath: number[];
  moves: PreparedCoachMove[];
};

type CoachProgressPayload = {
  requestId: string;
  stage: string;
  label: string;
  detail: string;
  progress: number;
  finished: boolean;
  elapsedMs: number;
};

function createCoachRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `coach-${crypto.randomUUID()}`;
  }
  return `coach-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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

function buildGameAnalysisContext(root: TreeNode): CoachGameAnalysisPoint[] {
  const mainline = [...treeIteratorMainLine(root)];
  return mainline
    .slice(1)
    .map(({ node }, index) => {
      const previousNode = mainline[index]?.node;
      const [beforePosition] = positionFromFen(previousNode?.fen ?? root.fen);
      const playedUci =
        beforePosition && node.move ? uciNormalize(beforePosition, node.move) : null;

      return {
        ply: node.halfMoves,
        move: node.san ?? `Ply ${node.halfMoves}`,
        beforeFen: previousNode?.fen ?? null,
        fen: node.fen,
        playedUci,
        playedSide: node.halfMoves % 2 === 1 ? "white" : "black",
        eval: node.score ? formatScore(node.score.value) : null,
        depth: node.depth,
        annotations: node.annotations,
      };
    })
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

function cleanMoveToken(token: string): string {
  return token
    .trim()
    .replace(/^\d+\.(\.\.)?/, "")
    .replace(/^[,;:()[\]{}]+|[,;:()[\]{}]+$/g, "")
    .replace(/[!?]+$/g, "");
}

function normalizeSanForCompare(move: string): string {
  return cleanMoveToken(move)
    .replace(/[+#]+$/g, "")
    .replace(/0/g, "O")
    .toLowerCase();
}

function tokenizePlayableLine(line: string): string[] {
  return line
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .split(/\s+/)
    .map(cleanMoveToken)
    .filter(
      (token) =>
        token.length > 0 &&
        token !== "*" &&
        token !== "1-0" &&
        token !== "0-1" &&
        token !== "1/2-1/2" &&
        !/^\d+\.*$/.test(token) &&
        !/^[+-]?\d+(?:\.\d+)?$/.test(token),
    );
}

function getSanVariationLine(root: TreeNode, path: number[]): string[] {
  const result: string[] = [];
  let node: TreeNode | undefined = root;

  for (const childIndex of path) {
    node = node.children[childIndex];
    if (!node) break;
    if (node.san) result.push(node.san);
  }

  return result;
}

function getMainlineMoves(root: TreeNode): MainlineMove[] {
  const moves: MainlineMove[] = [];
  let node: TreeNode | undefined = root;
  const path: number[] = [];

  while (node?.children[0]) {
    node = node.children[0];
    path.push(0);
    if (node.san) {
      moves.push({
        san: node.san,
        path: [...path],
        halfMoves: node.halfMoves,
      });
    }
  }

  return moves;
}

function formatReferenceMoveLabel(ply: number, san: string): string {
  if (ply % 2 === 1) {
    return `${Math.ceil(ply / 2)}.${san}`;
  }
  return `${Math.ceil(ply / 2)}...${san}`;
}

function lineBlocksFromCoachText(content: string): string[] {
  return splitCoachMessage(content)
    .filter((segment): segment is { type: "line"; text: string } => segment.type === "line")
    .map((segment) => segment.text);
}

function buildCoachReferenceContext({
  root,
  currentPath,
  messages,
  currentFen,
  currentHalfMoves,
  currentSanMoves,
}: {
  root: TreeNode;
  currentPath: number[];
  messages: CoachUiMessage[];
  currentFen: string;
  currentHalfMoves: number;
  currentSanMoves: string[];
}): CoachReferenceContext[] {
  const references: CoachReferenceContext[] = [];
  const seen = new Set<string>();

  const pushReference = (reference: CoachReferenceContext) => {
    const fen = reference.fen.trim();
    if (!fen) return;
    const key = `${reference.label}|${fen}|${reference.detail ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    references.push(reference);
  };

  let node: TreeNode | undefined = root;
  const sanLine: string[] = [];

  if (currentPath.length === 0) {
    pushReference({
      label: "Current position at game start",
      fen: currentFen,
      ply: currentHalfMoves,
      sanLine: currentSanMoves,
      source: "current line",
      detail: "Use this exact FEN for references to the current position.",
    });
  }

  for (const childIndex of currentPath) {
    node = node?.children[childIndex];
    if (!node) break;
    if (node.san) sanLine.push(node.san);
    const moveLabel = node.san
      ? formatReferenceMoveLabel(node.halfMoves, node.san)
      : `ply ${node.halfMoves}`;
    pushReference({
      label: `After ${moveLabel}`,
      fen: node.fen,
      ply: node.halfMoves,
      sanLine: [...sanLine],
      source: "current line",
      detail: `Use this exact FEN for phrases like "after ${moveLabel}".`,
    });
  }

  for (const message of messages.slice(-8)) {
    if (message.role !== "assistant" || !message.baseFen) continue;
    for (const line of lineBlocksFromCoachText(message.content).slice(0, 3)) {
      const moves = tokenizePlayableLine(line);
      if (moves.length === 0) continue;
      pushReference({
        label: `Discussed line: ${moves.slice(0, 6).join(" ")}`,
        fen: message.baseFen,
        ply: message.baseHalfMoves ?? 0,
        sanLine: message.baseSanMoves ?? [],
        source: "coach discussion",
        detail: `Discussed continuation from this FEN: ${moves.join(" ")}. For references to a move inside this line, request analyse_line from this FEN with the needed prefix.`,
      });
    }
  }

  return references.slice(-120);
}

function countMatchingSanPrefix(lineMoves: string[], prefixMoves: string[]): number {
  let count = 0;
  while (
    count < lineMoves.length &&
    count < prefixMoves.length &&
    normalizeSanForCompare(lineMoves[count]) === normalizeSanForCompare(prefixMoves[count])
  ) {
    count++;
  }
  return count;
}

function findGamePrefixTrim(lineMoves: string[], mainlineMoves: MainlineMove[]) {
  let matched = 0;
  while (
    matched < lineMoves.length &&
    matched < mainlineMoves.length &&
    normalizeSanForCompare(lineMoves[matched]) ===
      normalizeSanForCompare(mainlineMoves[matched].san)
  ) {
    matched++;
  }

  if (matched >= 4 && matched < lineMoves.length) {
    const branchPoint = mainlineMoves[matched - 1];
    return {
      trimCount: matched,
      basePath: branchPoint.path,
      baseHalfMoves: branchPoint.halfMoves,
    };
  }

  return null;
}

function formatMoveLabel(nextPly: number, isFirstMove: boolean): string {
  if (nextPly % 2 === 1) {
    return `${Math.ceil(nextPly / 2)}.`;
  }
  return isFirstMove ? `${Math.ceil(nextPly / 2)}...` : "";
}

function prepareCoachLine({
  line,
  defaultBasePath,
  defaultBaseHalfMoves,
  defaultBaseSanMoves,
  mainlineMoves,
}: {
  line: string;
  defaultBasePath: number[];
  defaultBaseHalfMoves: number;
  defaultBaseSanMoves: string[];
  mainlineMoves: MainlineMove[];
}): PreparedCoachLine | null {
  const originalMoves = tokenizePlayableLine(line);
  if (originalMoves.length === 0) return null;

  let basePath = defaultBasePath;
  let baseHalfMoves = defaultBaseHalfMoves;
  let trimCount = 0;

  const defaultPrefixCount = countMatchingSanPrefix(originalMoves, defaultBaseSanMoves);
  if (defaultPrefixCount === defaultBaseSanMoves.length && defaultPrefixCount > 0) {
    trimCount = defaultPrefixCount;
  }

  const gamePrefix = findGamePrefixTrim(originalMoves, mainlineMoves);
  if (gamePrefix && gamePrefix.trimCount > trimCount) {
    trimCount = gamePrefix.trimCount;
    basePath = gamePrefix.basePath;
    baseHalfMoves = gamePrefix.baseHalfMoves;
  }

  const moves = originalMoves.slice(trimCount);
  if (moves.length === 0) return null;

  return {
    basePath,
    moves: moves.map((san, index) => ({
      san,
      prefix: moves.slice(0, index + 1),
      label: formatMoveLabel(baseHalfMoves + index + 1, index === 0),
    })),
  };
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((part) => part.length > 0);
  return parts.map((part, index) => {
    const bold = part.startsWith("**") && part.endsWith("**");
    const content = bold ? part.slice(2, -2) : part;
    return (
      <Text key={`${content}-${index}`} span fw={bold ? 700 : undefined}>
        {content}
      </Text>
    );
  });
}

function renderCoachText(text: string) {
  return text
    .split(/\n+/)
    .map((rawLine) => rawLine.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      const heading = line.match(/^#{1,6}\s+(.+)$/);
      if (heading) {
        return (
          <Text key={`${line}-${index}`} size="sm" fw={700} mt={index === 0 ? 0 : "xs"}>
            {renderInlineMarkdown(heading[1])}
          </Text>
        );
      }

      const bullet = line.match(/^[-*]\s+(.+)$/);
      if (bullet) {
        return (
          <Group key={`${line}-${index}`} gap={6} align="flex-start" wrap="nowrap">
            <Text size="sm" c="dimmed" aria-hidden>
              •
            </Text>
            <Text size="sm">{renderInlineMarkdown(bullet[1])}</Text>
          </Group>
        );
      }

      return (
        <Text key={`${line}-${index}`} size="sm">
          {renderInlineMarkdown(line)}
        </Text>
      );
    });
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${secs}s`;
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
  const plannerModel = useAtomValue(aiCoachPlannerModelAtom);
  const multipv = useAtomValue(aiCoachMultipvAtom);
  const timeoutSecs = useAtomValue(aiCoachTimeoutSecsAtom);
  const effectiveTimeoutSecs = Math.max(150, Math.min(240, timeoutSecs));
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

  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<CoachUiMessage[]>([]);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [usedExistingAnalysis, setUsedExistingAnalysis] = useState(false);
  const [targetedCount, setTargetedCount] = useState(0);
  const [targetedMemory, setTargetedMemory] = useState<CoachTargetedResult[]>([]);
  const [openingContextStatus, setOpeningContextStatus] = useState<
    "idle" | "loading" | "ready" | "unavailable" | "error"
  >("idle");
  const [openingMoveCount, setOpeningMoveCount] = useState(0);
  const [modelUsed, setModelUsed] = useState("");
  const [requestStartedAt, setRequestStartedAt] = useState<number | null>(null);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [requestProgress, setRequestProgress] = useState<CoachProgressPayload | null>(null);
  const [progressLog, setProgressLog] = useState<CoachProgressPayload[]>([]);
  const activeRequestIdRef = useRef("");

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
  const mainlineMoves = useMemo(() => getMainlineMoves(root), [root]);
  const canSubmit = Boolean(enabled && coachEngine && question.trim().length > 0 && !loading);
  const activeProgressStep = requestProgress ?? {
    requestId: activeRequestIdRef.current,
    stage: "idle",
    label: "Preparing coach request",
    detail: "Collecting board state and opening context before the backend starts.",
    progress: loading ? 4 : 0,
    finished: false,
    elapsedMs: 0,
  };
  const progressValue = loading
    ? Math.min(98, Math.max(6, activeProgressStep.progress))
    : answer
      ? 100
      : 0;

  useEffect(() => {
    let disposed = false;
    const unlisten = listen<CoachProgressPayload>("ai-coach-progress", ({ payload }) => {
      if (payload.requestId !== activeRequestIdRef.current) return;
      setRequestProgress(payload);
      setProgressLog((current) => [...current, payload].slice(-12));
    });

    return () => {
      disposed = true;
      void unlisten.then((cleanup) => {
        if (disposed) cleanup();
      });
    };
  }, []);

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
    const requestPath = [...currentPath];
    const requestBaseSanMoves = getSanVariationLine(root, requestPath);
    const requestBaseHalfMoves = currentNode.halfMoves;
    const referenceContext = buildCoachReferenceContext({
      root,
      currentPath: requestPath,
      messages,
      currentFen: currentNode.fen,
      currentHalfMoves: requestBaseHalfMoves,
      currentSanMoves: requestBaseSanMoves,
    });

    const userMessage: CoachUiMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmedQuestion,
      baseFen: currentNode.fen,
      basePath: requestPath,
      baseHalfMoves: requestBaseHalfMoves,
      baseSanMoves: requestBaseSanMoves,
    };
    const chatHistory = messages.map(({ role, content }) => ({ role, content }));
    const priorTargetedResults = targetedMemory;
    const requestId = createCoachRequestId();
    const startedAt = Date.now();
    const initialProgress: CoachProgressPayload = {
      requestId,
      stage: "frontend_context",
      label: "Collecting position",
      detail: "Gathering FEN, side to move, both PGN scopes, engine cache, and chat history.",
      progress: 2,
      finished: false,
      elapsedMs: 0,
    };

    activeRequestIdRef.current = requestId;
    setLoading(true);
    setError("");
    setAnswer("");
    setTargetedCount(0);
    setUsedExistingAnalysis(false);
    setModelUsed("");
    setOpeningContextStatus("loading");
    setOpeningMoveCount(0);
    setElapsedSecs(0);
    setRequestStartedAt(startedAt);
    setRequestProgress(initialProgress);
    setProgressLog([initialProgress]);
    setQuestion("");
    setMessages((current) => [...current, userMessage]);

    try {
      let openingContext: CoachOpeningContext | null = null;
      let openingContextError: string | null = null;
      try {
        const openingProgress: CoachProgressPayload = {
          requestId,
          stage: explorerToken ? "opening_context" : "opening_context_skip",
          label: explorerToken ? "Fetching Lichess All stats" : "Skipping Lichess All stats",
          detail: explorerToken
            ? "Pulling explorer move counts and blended strength for this FEN."
            : "No Lichess session token is available for explorer context.",
          progress: 5,
          finished: false,
          elapsedMs: Date.now() - startedAt,
        };
        setRequestProgress(openingProgress);
        setProgressLog((current) => [...current, openingProgress].slice(-12));
        openingContext = await buildAiCoachOpeningContext({
          fen: currentNode.fen,
          sideToMove,
          lichessOptions,
          token: explorerToken,
          strengthSettings: moveStrengthSettings,
        });
        setOpeningContextStatus(openingContext ? "ready" : "unavailable");
        setOpeningMoveCount(openingContext?.moves.length ?? 0);
        const openingDoneProgress: CoachProgressPayload = {
          requestId,
          stage: openingContext ? "opening_context_done" : "opening_context_unavailable",
          label: openingContext ? "Lichess All stats ready" : "No Lichess All stats",
          detail: openingContext
            ? `Collected ${openingContext.moves.length} explorer move(s).`
            : "Continuing with Stockfish-only position context.",
          progress: 8,
          finished: false,
          elapsedMs: Date.now() - startedAt,
        };
        setRequestProgress(openingDoneProgress);
        setProgressLog((current) => [...current, openingDoneProgress].slice(-12));
      } catch (err) {
        openingContextError = err instanceof Error ? err.message : String(err);
        setOpeningContextStatus("error");
        const openingErrorProgress: CoachProgressPayload = {
          requestId,
          stage: "opening_context_error",
          label: "Lichess All stats unavailable",
          detail: openingContextError,
          progress: 8,
          finished: false,
          elapsedMs: Date.now() - startedAt,
        };
        setRequestProgress(openingErrorProgress);
        setProgressLog((current) => [...current, openingErrorProgress].slice(-12));
      }

      const response = unwrap(
        await commands.askAiCoach({
          requestId,
          fen: currentNode.fen,
          sideToMove,
          moveHistory: moves,
          pgn: currentLinePgn,
          pgnScope: "auto",
          currentLinePgn,
          wholeGamePgn,
          gameAnalysis,
          selectedMove,
          question: trimmedQuestion,
          chatHistory,
          referenceContext,
          existingLines,
          priorTargetedResults,
          openingContext,
          openingContextError,
          enginePath: coachEngine.path,
          settings: {
            enabled,
            geminiCommand,
            geminiModel,
            plannerModel,
            multipv,
            timeoutSecs: effectiveTimeoutSecs,
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
          baseFen: currentNode.fen,
          basePath: requestPath,
          baseHalfMoves: requestBaseHalfMoves,
          baseSanMoves: requestBaseSanMoves,
        },
      ]);
      setUsedExistingAnalysis(response.usedExistingAnalysis);
      setTargetedCount(response.targetedResults.length);
      setTargetedMemory((current) => {
        const merged = [...current, ...response.targetedResults];
        const seen = new Set<string>();
        return merged
          .filter((result) => {
            const key = `${result.requestType}|${result.fen}|${result.moves.join(",")}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(-24);
      });
      setModelUsed(response.model);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRequestStartedAt(null);
    }
  }

  function playCoachMoves(payload: string[], basePath?: number[]) {
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
    setOpeningContextStatus("idle");
    setOpeningMoveCount(0);
  }

  return (
    <Stack h="100%" gap="sm" style={{ minHeight: 0 }}>
      <Group justify="space-between" gap="xs" wrap="wrap">
        <Group gap="xs" wrap="wrap">
          <Text fw={700}>AI Coach</Text>
          <Badge variant="light">{coachEngine?.name ?? "No Stockfish"}</Badge>
          <Badge variant="light">{plannerModel || "Gemini Flash planner"}</Badge>
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

      <Box style={{ flex: "1 1 0", minHeight: 0, overflow: "hidden" }}>
        <ScrollArea h="100%" offsetScrollbars type="auto">
          <Stack gap="xs" pr="xs">
            {messages.length === 0 && !loading && (
              <Paper withBorder p="sm">
                <Text size="sm" c="dimmed">
                  Ask about the current position. The planner chooses Stockfish lines up front when
                  your question names a move, line, or what-if.
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
                    basePath={message.basePath ?? []}
                    baseHalfMoves={message.baseHalfMoves ?? 0}
                    baseSanMoves={message.baseSanMoves ?? []}
                    mainlineMoves={mainlineMoves}
                    onPlayMoves={playCoachMoves}
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
                    {progressLog.map((step, index) => {
                      const active = index === progressLog.length - 1;
                      return (
                        <Group
                          key={`${step.stage}-${step.elapsedMs}-${index}`}
                          gap="xs"
                          wrap="nowrap"
                        >
                          <Badge
                            size="xs"
                            variant={active ? "filled" : step.finished ? "light" : "outline"}
                            color={active ? "blue" : step.finished ? "green" : "gray"}
                          >
                            {step.finished ? "done" : "step"}
                          </Badge>
                          <Text size="xs" fw={active ? 600 : 400} lineClamp={2}>
                            {step.label}{" "}
                            <Text span c="dimmed">
                              {formatElapsed(Math.floor(step.elapsedMs / 1000))}
                            </Text>
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
      </Box>

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
              if (event.key === "Enter" && !event.shiftKey) {
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
          Gemini explains; Stockfish supplies the chess truth. Enter sends; Shift+Enter adds a line.
        </Text>
      </Box>
    </Stack>
  );
}

function CoachMessageContent({
  content,
  basePath,
  baseHalfMoves,
  baseSanMoves,
  mainlineMoves,
  onPlayMoves,
}: {
  content: string;
  basePath: number[];
  baseHalfMoves: number;
  baseSanMoves: string[];
  mainlineMoves: MainlineMove[];
  onPlayMoves: (moves: string[], basePath?: number[]) => void;
}) {
  return (
    <Stack gap={6}>
      {splitCoachMessage(content).map((segment, index) => {
        if (segment.type === "line") {
          const preparedLine = prepareCoachLine({
            line: segment.text,
            defaultBasePath: basePath,
            defaultBaseHalfMoves: baseHalfMoves,
            defaultBaseSanMoves: baseSanMoves,
            mainlineMoves,
          });

          if (!preparedLine) return null;

          return (
            <Paper
              key={`${segment.type}-${index}-${segment.text}`}
              withBorder
              p={6}
              bg="var(--mantine-color-blue-light)"
              style={{ alignSelf: "stretch" }}
            >
              <Group gap={4} wrap="wrap">
                <IconSparkles size="0.85rem" />
                {preparedLine.moves.map((move, moveIndex) => (
                  <Group key={`${move.san}-${moveIndex}`} gap={3} wrap="nowrap">
                    {move.label && (
                      <Text size="sm" c="blue.2" fw={700}>
                        {move.label}
                      </Text>
                    )}
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="blue"
                      px={4}
                      onClick={() => onPlayMoves(move.prefix, preparedLine.basePath)}
                    >
                      {move.san}
                    </Button>
                  </Group>
                ))}
              </Group>
            </Paper>
          );
        }

        return (
          <Stack key={`${segment.type}-${index}`} gap={4}>
            {renderCoachText(segment.text)}
          </Stack>
        );
      })}
    </Stack>
  );
}
