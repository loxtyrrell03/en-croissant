import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
  Textarea,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBook,
  IconChevronLeft,
  IconChevronRight,
  IconExternalLink,
  IconSparkles,
} from "@tabler/icons-react";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import { exit } from "@tauri-apps/plugin-process";
import { parseSan } from "chessops/san";
import { useAtomValue } from "jotai";
import {
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type {
  BestMoves,
  CoachAnalysisCoverage,
  CoachChatMessage,
  CoachBookPassage,
  CoachEngineLine,
  CoachGameAnalysisPoint,
  CoachOpeningContext,
  CoachReferenceContext,
  CoachTargetedResult,
} from "@/bindings";
import { commands } from "@/bindings";
import { Chessground } from "@/chessground/Chessground";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  AI_COACH_GEMINI_MODEL,
  activeTabAtom,
  aiCoachEnabledAtom,
  aiCoachGeminiCommandAtom,
  aiCoachMultipvAtom,
  aiCoachPlannerModelAtom,
  aiCoachTimeoutSecsAtom,
  currentTabAtom,
  engineMovesFamily,
  enginesAtom,
  lichessOptionsAtom,
  moveStrengthSettingsAtom,
  sessionsAtom,
} from "@/state/atoms";
import { getPGN, getVariationLine, uciNormalize } from "@/utils/chess";
import {
  createAiCoachPersistenceContext,
  createPersistedAiCoachReview,
  getAiCoachPersistenceTarget,
  loadPersistedAiCoachReview,
  persistedAiCoachReviewMatches,
  removePersistedAiCoachReview,
  savePersistedAiCoachReview,
  type AiCoachPersistenceContext,
  type AiCoachPersistenceTarget,
  type AiCoachPlayerColor,
  type PersistedAiCoachReview,
} from "@/utils/aiCoachPersistence";
import { buildAiCoachOpeningContext } from "@/utils/aiCoachOpeningContext";
import { beginAiCoachBackgroundJob, finishAiCoachBackgroundJob } from "@/utils/aiCoachBackground";
import { positionFromFen } from "@/utils/chessops";
import type { Engine, LocalEngine } from "@/utils/engines";
import { getBestMoves as getLichessCloudBestMoves } from "@/utils/lichess/api";
import { formatScore } from "@/utils/score";
import { getNodeAtPath, type TreeNode, treeIteratorMainLine } from "@/utils/treeReducer";
import { unwrap } from "@/utils/unwrap";

type CoachUiMessage = CoachChatMessage & {
  id: string;
  baseFen?: string;
  basePath?: number[];
  baseHalfMoves?: number;
  baseSanMoves?: string[];
  engineLines?: CoachEngineLine[];
  targetedResults?: CoachTargetedResult[];
  bookPassages?: CoachBookPassage[];
  overview?: string;
  categories?: CoachUiCategory[];
  analysisCoverage?: CoachAnalysisCoverage;
};

type CoachUiCategoryPosition = {
  ply: number;
  san: string;
  title: string;
  explanation: string;
  engineEvidence: string;
  betterPlan?: string;
};

type CoachUiCategoryBookReference = {
  chunkId: string;
  whyItMatters: string;
  positionPly: number | null;
};

type CoachUiCategory = {
  id: string;
  label: string;
  summary: string;
  explanation: string;
  positions: CoachUiCategoryPosition[];
  bookReferences: CoachUiCategoryBookReference[];
};

type CoachStructuredResponse = {
  overview?: unknown;
  categories?: unknown;
};

type CoachMessageSegment = { type: "text"; text: string } | { type: "line"; text: string };

type MainlineMove = {
  san: string;
  uci: string | null;
  fenBefore: string;
  fenAfter: string;
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

type CoachLineAnchor = {
  basePath: number[];
  baseHalfMoves: number;
  moves: string[];
  source: "root" | "targeted";
};

type MoveClickTarget = {
  basePath: number[];
  moves: string[];
};

type InlineMoveRenderContext = {
  root: TreeNode;
  basePath: number[];
  mainlineMoves: MainlineMove[];
  lineAnchors: CoachLineAnchor[];
  onPlayMoves: (moves: string[], basePath?: number[]) => void;
};

type InlineMoveToken = {
  label: string;
  san: string;
  moveNumber?: number;
  blackMove?: boolean;
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

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalPly(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizeCoachCategories(response: CoachStructuredResponse): {
  overview: string;
  categories: CoachUiCategory[];
} {
  const rawCategories = Array.isArray(response.categories) ? response.categories : [];
  const usedIds = new Set<string>();
  const categories = rawCategories.flatMap((value, index): CoachUiCategory[] => {
    const category = objectValue(value);
    if (!category) return [];

    const label = stringValue(category.label);
    const summary = stringValue(category.summary);
    const explanation = stringValue(category.explanation);
    const rawPositions = Array.isArray(category.positions) ? category.positions : [];
    const positions = rawPositions.flatMap((positionValue): CoachUiCategoryPosition[] => {
      const position = objectValue(positionValue);
      const ply = optionalPly(position?.ply);
      if (!position || ply === null) return [];

      const normalized = {
        ply,
        san: stringValue(position.san),
        title: stringValue(position.title),
        explanation: stringValue(position.explanation),
        engineEvidence: stringValue(position.engineEvidence),
        betterPlan: stringValue(position.betterPlan) || undefined,
      };
      if (
        !normalized.san &&
        !normalized.title &&
        !normalized.explanation &&
        !normalized.engineEvidence &&
        !normalized.betterPlan
      ) {
        return [];
      }
      return [normalized];
    });
    const rawBookReferences = Array.isArray(category.bookReferences) ? category.bookReferences : [];
    const bookReferences = rawBookReferences.flatMap(
      (referenceValue): CoachUiCategoryBookReference[] => {
        const reference = objectValue(referenceValue);
        if (!reference) return [];
        const chunkId = stringValue(reference.chunkId);
        if (!chunkId) return [];
        return [
          {
            chunkId,
            whyItMatters: stringValue(reference.whyItMatters),
            positionPly: optionalPly(reference.positionPly),
          },
        ];
      },
    );

    if (!label || (!summary && !explanation && positions.length === 0)) {
      return [];
    }

    const requestedId = stringValue(category.id) || `category-${index + 1}`;
    let id = requestedId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${requestedId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);

    return [
      {
        id,
        label,
        summary,
        explanation,
        positions,
        bookReferences,
      },
    ];
  });

  return {
    overview: stringValue(response.overview),
    categories,
  };
}

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

function toCoachMovetextOnly(pgn: string): string {
  const movetext = pgn
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("["))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return movetext || "*";
}

async function getCoachCloudLines(fen: string, multipv: number): Promise<CoachEngineLine[]> {
  const requestedMultipv = Math.max(1, Math.min(8, Math.round(multipv) || 1));
  const result = await getLichessCloudBestMoves(
    "ai-coach",
    { t: "Depth", c: 17 },
    {
      fen,
      moves: [],
      extraOptions: [{ name: "MultiPV", value: requestedMultipv.toString() }],
    },
  );

  return (result?.[1] ?? []).slice(0, requestedMultipv).map(toCoachLine);
}

function buildGameAnalysisContext(root: TreeNode): CoachGameAnalysisPoint[] {
  const mainline = [...treeIteratorMainLine(root)];
  return mainline.slice(1).map(({ node }, index) => {
    const previousNode = mainline[index]?.node;
    const [beforePosition] = positionFromFen(previousNode?.fen ?? root.fen);
    const playedUci = beforePosition && node.move ? uciNormalize(beforePosition, node.move) : null;

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
  });
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

function cleanInlineSan(move: string): string {
  return cleanMoveToken(move)
    .replace(/^`+|`+$/g, "")
    .replace(/[.!?,;:]+$/g, "")
    .replace(/[!?]+$/g, "");
}

function parseInlineMoveToken(raw: string): InlineMoveToken | null {
  const match = raw.match(
    /^`?(?:(\d+)\.(\.\.)?\s*)?((?:O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?[!?]*)`?$/i,
  );
  if (!match) return null;

  const san = cleanInlineSan(match[3] ?? "");
  if (!san) return null;

  return {
    label: raw.replace(/`/g, ""),
    san,
    moveNumber: match[1] ? Number(match[1]) : undefined,
    blackMove: Boolean(match[2]),
  };
}

function findMainlineBasePathForNumberedMove(
  token: InlineMoveToken,
  mainlineMoves: MainlineMove[],
) {
  if (!token.moveNumber) return null;

  const targetPly = token.blackMove ? token.moveNumber * 2 : token.moveNumber * 2 - 1;
  const previousPly = targetPly - 1;
  if (previousPly <= 0) return [];

  const previousMove = mainlineMoves.find((move) => move.halfMoves === previousPly);
  return previousMove?.path ?? null;
}

function resolveExistingMovePath(root: TreeNode, basePath: number[], moves: string[]) {
  const path = [...basePath];
  let node: TreeNode | undefined = getNodeAtPath(root, basePath);
  if (!node) return null;

  for (const move of moves) {
    const childIndex: number = node.children.findIndex(
      (child) => child.san && normalizeSanForCompare(child.san) === normalizeSanForCompare(move),
    );
    if (childIndex === -1) return null;
    path.push(childIndex);
    node = node.children[childIndex];
  }

  return path;
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

function pathKey(path: number[]) {
  return path.join(",");
}

function findFirstPathByFen(root: TreeNode, fen: string): number[] | null {
  const target = fen.trim();
  const queue: { node: TreeNode; path: number[] }[] = [{ node: root, path: [] }];

  while (queue.length > 0) {
    const { node, path } = queue.shift()!;
    if (node.fen.trim() === target) return path;
    node.children.forEach((child, index) => queue.push({ node: child, path: [...path, index] }));
  }

  return null;
}

function canPlaySanMoves(root: TreeNode, basePath: number[], moves: string[]) {
  if (moves.length === 0) return true;

  const baseNode = getNodeAtPath(root, basePath);
  const [position] = positionFromFen(baseNode.fen);
  if (!position) return false;

  for (const san of moves) {
    const move = parseSan(position, san);
    if (!move) return false;
    position.play(move);
  }

  return true;
}

function getNodeHalfMoves(root: TreeNode, path: number[]) {
  return getNodeAtPath(root, path).halfMoves;
}

function buildCoachLineAnchors({
  root,
  baseFen,
  basePath,
  baseHalfMoves,
  engineLines,
  targetedResults,
}: {
  root: TreeNode;
  baseFen?: string;
  basePath: number[];
  baseHalfMoves: number;
  engineLines: CoachEngineLine[];
  targetedResults: CoachTargetedResult[];
}): CoachLineAnchor[] {
  const anchors: CoachLineAnchor[] = [];
  const seen = new Set<string>();

  const pushAnchor = (
    source: CoachLineAnchor["source"],
    anchorBasePath: number[],
    anchorBaseHalfMoves: number,
    moves: string[],
  ) => {
    const cleanedMoves = moves.map(cleanMoveToken).filter(Boolean);
    if (cleanedMoves.length === 0) return;
    if (!canPlaySanMoves(root, anchorBasePath, cleanedMoves)) return;
    const key = `${source}|${pathKey(anchorBasePath)}|${cleanedMoves.join(" ")}`;
    if (seen.has(key)) return;
    seen.add(key);
    anchors.push({
      source,
      basePath: anchorBasePath,
      baseHalfMoves: anchorBaseHalfMoves,
      moves: cleanedMoves,
    });
  };

  for (const line of engineLines) {
    pushAnchor("root", basePath, baseHalfMoves, line.sanMoves);
  }

  for (const result of targetedResults) {
    const resultPath =
      result.fen.trim() === baseFen?.trim() ? basePath : findFirstPathByFen(root, result.fen);
    if (!resultPath) continue;
    const resultHalfMoves = getNodeHalfMoves(root, resultPath);
    for (const line of result.lines) {
      pushAnchor("targeted", resultPath, resultHalfMoves, line.sanMoves);
    }
  }

  return anchors;
}

function getMainlineMoves(root: TreeNode): MainlineMove[] {
  const moves: MainlineMove[] = [];
  let node: TreeNode | undefined = root;
  const path: number[] = [];

  while (node && node.children.length > 0) {
    const parent: TreeNode = node;
    const child: TreeNode = parent.children[0];
    node = child;
    path.push(0);
    if (child.san) {
      const [beforePosition] = positionFromFen(parent.fen);
      moves.push({
        san: child.san,
        uci: beforePosition && child.move ? uciNormalize(beforePosition, child.move) : null,
        fenBefore: parent.fen,
        fenAfter: child.fen,
        path: [...path],
        halfMoves: child.halfMoves,
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

    for (const result of (message.targetedResults ?? []).slice(-4)) {
      const messageBasePath = message.basePath ?? [];
      const resultPath =
        result.fen.trim() === message.baseFen.trim()
          ? messageBasePath
          : (findFirstPathByFen(root, result.fen) ?? messageBasePath);
      const resultNode = getNodeAtPath(root, resultPath);
      const fixedMoves = result.moves.length > 0 ? result.moves.join(" ") : "none";
      const sampleLines = result.lines
        .slice(0, 3)
        .map((line, index) => {
          const sanLine = line.sanMoves.join(" ").trim() || line.uciMoves.join(" ").trim();
          return `${index + 1}. eval ${line.eval}, depth ${line.depth}: ${sanLine}`;
        })
        .filter(Boolean)
        .join(" | ");
      pushReference({
        label: `Recent Stockfish evidence: ${result.label}`,
        fen: result.fen,
        ply: resultNode.halfMoves,
        sanLine: getSanVariationLine(root, resultPath),
        source: "coach targeted stockfish",
        detail: `Use this exact FEN for conversational references such as "that sequence", "that line", or "where I can win a piece" when they match this recent evidence. Fixed prefix: ${fixedMoves}. Reason: ${result.reason}. Lines: ${sampleLines || "none"}.`,
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

function expectedPlyForToken(token: InlineMoveToken) {
  if (!token.moveNumber) return null;
  return token.blackMove ? token.moveNumber * 2 : token.moveNumber * 2 - 1;
}

function moveTargetKey(target: MoveClickTarget) {
  return `${pathKey(target.basePath)}|${target.moves.join(" ")}`;
}

function uniqueMoveTarget(candidates: MoveClickTarget[]): MoveClickTarget | null {
  const unique = new Map<string, MoveClickTarget>();
  for (const candidate of candidates) {
    unique.set(moveTargetKey(candidate), candidate);
  }
  return unique.size === 1 ? [...unique.values()][0] : null;
}

function appendMoveTarget(
  root: TreeNode,
  target: MoveClickTarget | null | undefined,
  san: string,
): MoveClickTarget | null {
  if (!target) return null;
  const moves = [...target.moves, san];
  if (!canPlaySanMoves(root, target.basePath, moves)) return null;
  return { basePath: target.basePath, moves };
}

function sameAsTargetLastMove(target: MoveClickTarget | null | undefined, san: string) {
  const lastMove = target?.moves.at(-1);
  return Boolean(lastMove && normalizeSanForCompare(lastMove) === normalizeSanForCompare(san));
}

function findAnchorTargetForToken(
  token: InlineMoveToken,
  context: InlineMoveRenderContext,
): MoveClickTarget | null {
  const expectedPly = expectedPlyForToken(token);
  const candidates: MoveClickTarget[] = [];

  for (const anchor of context.lineAnchors) {
    anchor.moves.forEach((move, index) => {
      if (normalizeSanForCompare(move) !== normalizeSanForCompare(token.san)) return;
      if (expectedPly !== null && anchor.baseHalfMoves + index + 1 !== expectedPly) return;
      candidates.push({
        basePath: anchor.basePath,
        moves: anchor.moves.slice(0, index + 1),
      });
    });
  }

  return uniqueMoveTarget(candidates);
}

function findNumberedMoveTarget(
  token: InlineMoveToken,
  context: InlineMoveRenderContext,
): MoveClickTarget | null {
  const expectedPly = expectedPlyForToken(token);
  if (expectedPly === null) return null;
  const mainlineMove = context.mainlineMoves.find(
    (move) =>
      move.halfMoves === expectedPly &&
      normalizeSanForCompare(move.san) === normalizeSanForCompare(token.san),
  );
  if (!mainlineMove) return null;
  const basePath = findMainlineBasePathForNumberedMove(token, context.mainlineMoves);
  if (!basePath) return null;
  if (!canPlaySanMoves(context.root, basePath, [token.san])) return null;
  return { basePath, moves: [token.san] };
}

function resolveInlineMoveTarget(
  token: InlineMoveToken,
  context: InlineMoveRenderContext,
  sequenceTarget: MoveClickTarget | null,
  ambientTarget: MoveClickTarget | null,
): MoveClickTarget | null {
  return (
    appendMoveTarget(context.root, sequenceTarget, token.san) ??
    (sameAsTargetLastMove(sequenceTarget, token.san) ? sequenceTarget : null) ??
    appendMoveTarget(context.root, ambientTarget, token.san) ??
    (sameAsTargetLastMove(ambientTarget, token.san) ? ambientTarget : null) ??
    findAnchorTargetForToken(token, context) ??
    findNumberedMoveTarget(token, context)
  );
}

function renderMoveToken(
  token: InlineMoveToken,
  context?: InlineMoveRenderContext,
  target?: MoveClickTarget | null,
) {
  if (!context) return token.label;
  if (!target) return token.label;
  const handleClick = () => {
    context.onPlayMoves(target.moves, target.basePath);
  };

  return (
    <Text
      key={`${token.label}-${token.san}`}
      component="button"
      type="button"
      c="blue.2"
      fw={600}
      td="underline"
      onClick={handleClick}
      style={{
        background: "transparent",
        border: 0,
        cursor: "pointer",
        display: "inline",
        font: "inherit",
        padding: 0,
      }}
    >
      {token.label}
    </Text>
  );
}

function renderInlineMoves(text: string, context?: InlineMoveRenderContext): ReactNode[] {
  const pieces: ReactNode[] = [];
  const pattern =
    /`?(?:(?:\d+)\.(?:\.\.)?\s*)?(?:O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?[!?]*`?/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let sequenceTarget: MoveClickTarget | null = null;
  let ambientTarget: MoveClickTarget | null = null;

  while ((match = pattern.exec(text)) !== null) {
    const between = text.slice(cursor, match.index);
    if (match.index > cursor) {
      pieces.push(between);
    }

    if (!/^[\s,;:()]*$/.test(between)) {
      sequenceTarget = null;
    }

    const raw = match[0];
    const token = parseInlineMoveToken(raw);
    const target: MoveClickTarget | null =
      token && context
        ? resolveInlineMoveTarget(token, context, sequenceTarget, ambientTarget)
        : null;

    if (!token) {
      pieces.push(raw);
    } else {
      pieces.push(renderMoveToken(token, context, target));
      if (target) {
        sequenceTarget = target;
        ambientTarget = target;
      }
    }
    cursor = pattern.lastIndex;
  }

  if (cursor < text.length) {
    pieces.push(text.slice(cursor));
  }

  return pieces;
}

function formatBookReferenceLabel(passage: CoachBookPassage): string {
  const chapter = passage.chapterTitle.trim();
  const author = passage.author.trim();
  return [passage.title.trim(), chapter, author].filter(Boolean).join(" - ");
}

function expandBookReferenceLabels(text: string, passages: CoachBookPassage[]): string {
  if (passages.length === 0) return text;
  return text.replace(/\[Book\s+(\d+)\]/gi, (match, rawIndex: string) => {
    const passage = passages[Number(rawIndex) - 1];
    return passage ? formatBookReferenceLabel(passage) : match;
  });
}

function renderInlineMarkdown(
  text: string,
  context?: InlineMoveRenderContext,
  bookPassages: CoachBookPassage[] = [],
) {
  const expandedText = expandBookReferenceLabels(text, bookPassages);
  const parts = expandedText
    .split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g)
    .filter((part) => part.length > 0);
  return parts.map((part, index) => {
    const doubleBold = part.startsWith("**") && part.endsWith("**");
    const singleBold = !doubleBold && part.startsWith("*") && part.endsWith("*");
    const bold = doubleBold || singleBold;
    const content = doubleBold ? part.slice(2, -2) : singleBold ? part.slice(1, -1) : part;
    return (
      <Text key={`${content}-${index}`} span fw={bold ? 700 : undefined}>
        {renderInlineMoves(content, context)}
      </Text>
    );
  });
}

function renderCoachText(
  text: string,
  context?: InlineMoveRenderContext,
  bookPassages: CoachBookPassage[] = [],
) {
  return text
    .split(/\n+/)
    .map((rawLine) => rawLine.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      const heading = line.match(/^#{1,6}\s+(.+)$/);
      if (heading) {
        return (
          <Text key={`${line}-${index}`} size="sm" fw={700} mt={index === 0 ? 0 : "xs"}>
            {renderInlineMarkdown(heading[1], context, bookPassages)}
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
            <Text size="sm">{renderInlineMarkdown(bullet[1], context, bookPassages)}</Text>
          </Group>
        );
      }

      return (
        <Text key={`${line}-${index}`} size="sm">
          {renderInlineMarkdown(line, context, bookPassages)}
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
  const geminiModel = AI_COACH_GEMINI_MODEL;
  const plannerModel = useAtomValue(aiCoachPlannerModelAtom);
  const multipv = useAtomValue(aiCoachMultipvAtom);
  const timeoutSecs = useAtomValue(aiCoachTimeoutSecsAtom);
  const effectiveTimeoutSecs = Math.max(150, Math.min(240, timeoutSecs));
  const engines = useAtomValue(enginesAtom);
  const activeTab = useAtomValue(activeTabAtom);
  const currentTab = useAtomValue(currentTabAtom);
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
  const [playerColor, setPlayerColor] = useState<AiCoachPlayerColor>("white");
  const [messages, setMessages] = useState<CoachUiMessage[]>([]);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [usedExistingAnalysis, setUsedExistingAnalysis] = useState(false);
  const [targetedCount, setTargetedCount] = useState(0);
  const [bookPassageCount, setBookPassageCount] = useState(0);
  const [bookCorpusAvailable, setBookCorpusAvailable] = useState<boolean | null>(null);
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
  const [persistenceCue, setPersistenceCue] = useState<{
    kind: "saved" | "restored";
    savedAt: string;
  } | null>(null);
  const [persistenceNotice, setPersistenceNotice] = useState("");
  const activeRequestIdRef = useRef("");
  const persistenceLoadGenerationRef = useRef(0);
  const savedReviewRef = useRef<PersistedAiCoachReview | null>(null);
  const displayedReviewRef = useRef<PersistedAiCoachReview | null>(null);
  const activeContextKeyRef = useRef("");
  const persistenceContextRef = useRef<AiCoachPersistenceContext | null>(null);

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
  const currentLinePgn = useMemo(() => {
    if (currentPath.length === 0) {
      return "*";
    }

    return toCoachMovetextOnly(
      getPGN(root, {
        headers: null,
        glyphs: false,
        comments: false,
        variations: false,
        extraMarkups: false,
        path: currentPath,
      }),
    );
  }, [currentPath, root]);
  const wholeGamePgn = useMemo(() => {
    return toCoachMovetextOnly(
      getPGN(root, {
        headers: null,
        glyphs: false,
        comments: false,
        variations: false,
        extraMarkups: false,
      }),
    );
  }, [root]);
  const persistenceTarget = useMemo(() => getAiCoachPersistenceTarget(currentTab), [currentTab]);
  const persistenceContext = useMemo(
    () =>
      createAiCoachPersistenceContext({
        rootFen,
        wholeGamePgn,
        currentFen: currentNode.fen,
        currentPath,
        currentLinePgn,
      }),
    [currentLinePgn, currentNode.fen, currentPath, rootFen, wholeGamePgn],
  );
  const persistenceTargetIdentity = persistenceTarget
    ? `${persistenceTarget.sidecarPath}\u0000${persistenceTarget.recordKey}`
    : `unsaved:${activeTab ?? "none"}`;
  const activeContextKey = JSON.stringify([
    persistenceTargetIdentity,
    persistenceContext.gameFingerprint,
    persistenceContext.currentFen,
    persistenceContext.currentPath,
    persistenceContext.currentLineFingerprint,
    playerColor,
  ]);
  persistenceContextRef.current = persistenceContext;
  activeContextKeyRef.current = activeContextKey;
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

  const resetCoachDisplay = useCallback(() => {
    displayedReviewRef.current = null;
    setMessages([]);
    setAnswer("");
    setError("");
    setUsedExistingAnalysis(false);
    setTargetedCount(0);
    setBookPassageCount(0);
    setBookCorpusAvailable(null);
    setTargetedMemory([]);
    setOpeningContextStatus("idle");
    setOpeningMoveCount(0);
    setModelUsed("");
    setRequestProgress(null);
    setProgressLog([]);
    setPersistenceCue(null);
  }, []);

  const applyPersistedReview = useCallback((review: PersistedAiCoachReview) => {
    const response = review.response;
    const structuredAnswer = normalizeCoachCategories(
      response as unknown as CoachStructuredResponse,
    );
    displayedReviewRef.current = review;
    setMessages([
      {
        id: `saved-user-${review.savedAt}`,
        role: "user",
        content: review.question,
        baseFen: review.base.fen,
        basePath: [...review.base.path],
        baseHalfMoves: review.base.halfMoves,
        baseSanMoves: [...review.base.sanMoves],
      },
      {
        id: `saved-assistant-${review.savedAt}`,
        role: "assistant",
        content: response.answer,
        baseFen: review.base.fen,
        basePath: [...review.base.path],
        baseHalfMoves: review.base.halfMoves,
        baseSanMoves: [...review.base.sanMoves],
        engineLines: response.stockfishLines,
        targetedResults: response.targetedResults,
        bookPassages: response.bookPassages,
        overview: structuredAnswer.overview || undefined,
        categories:
          structuredAnswer.categories.length > 0 ? structuredAnswer.categories : undefined,
        analysisCoverage: response.analysisCoverage ?? undefined,
      },
    ]);
    setQuestion("");
    setAnswer(response.answer);
    setError("");
    setLoading(false);
    setUsedExistingAnalysis(response.usedExistingAnalysis);
    setTargetedCount(response.targetedResults.length);
    setBookPassageCount(response.bookPassages.length);
    setBookCorpusAvailable(response.bookCorpusAvailable);
    setTargetedMemory(response.targetedResults.slice(-24));
    setOpeningContextStatus("idle");
    setOpeningMoveCount(0);
    setModelUsed(response.model);
    setRequestStartedAt(null);
    setRequestProgress(null);
    setProgressLog([]);
    setPersistenceNotice("");
    setPersistenceCue({ kind: "restored", savedAt: review.savedAt });
  }, []);

  useEffect(() => {
    const generation = ++persistenceLoadGenerationRef.current;
    activeRequestIdRef.current = "";
    savedReviewRef.current = null;
    resetCoachDisplay();
    setLoading(false);
    setRequestStartedAt(null);
    setPersistenceNotice("");

    if (!persistenceTarget) return;
    const target: AiCoachPersistenceTarget = persistenceTarget;
    void loadPersistedAiCoachReview(target)
      .then((review) => {
        if (generation !== persistenceLoadGenerationRef.current || !review) return;
        const currentContext = persistenceContextRef.current;
        if (!currentContext || review.gameFingerprint !== currentContext.gameFingerprint) return;
        savedReviewRef.current = review;
        setPlayerColor(review.playerColor);
        if (persistedAiCoachReviewMatches(review, currentContext)) {
          applyPersistedReview(review);
        }
      })
      .catch((loadError) => {
        if (generation !== persistenceLoadGenerationRef.current) return;
        setPersistenceNotice(
          `The saved coach review could not be read: ${
            loadError instanceof Error ? loadError.message : String(loadError)
          }`,
        );
      });
  }, [
    applyPersistedReview,
    persistenceContext.gameFingerprint,
    persistenceTargetIdentity,
    resetCoachDisplay,
  ]);

  useEffect(() => {
    const displayed = displayedReviewRef.current;
    if (displayed && !persistedAiCoachReviewMatches(displayed, persistenceContext, playerColor)) {
      resetCoachDisplay();
    }
    if (
      !displayedReviewRef.current &&
      savedReviewRef.current &&
      persistedAiCoachReviewMatches(savedReviewRef.current, persistenceContext, playerColor)
    ) {
      applyPersistedReview(savedReviewRef.current);
    }
  }, [applyPersistedReview, persistenceContext, playerColor, resetCoachDisplay]);

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
    const requestPlayerColor = playerColor;
    const groundedQuestion = `I am ${requestPlayerColor === "black" ? "Black" : "White"} in this game or position. ${trimmedQuestion}`;
    const requestPath = [...currentPath];
    const requestBaseSanMoves = getSanVariationLine(root, requestPath);
    const requestBaseHalfMoves = currentNode.halfMoves;
    const requestPersistenceTarget = persistenceTarget ? { ...persistenceTarget } : null;
    const requestPersistenceContext: AiCoachPersistenceContext = {
      ...persistenceContext,
      currentPath: [...persistenceContext.currentPath],
    };
    const requestContextKey = activeContextKey;
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
    persistenceLoadGenerationRef.current += 1;
    setLoading(true);
    setError("");
    setPersistenceNotice("");
    setAnswer("");
    setTargetedCount(0);
    setBookPassageCount(0);
    setBookCorpusAvailable(null);
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
    beginAiCoachBackgroundJob(requestId);

    try {
      let openingContext: CoachOpeningContext | null = null;
      let openingContextError: string | null = null;
      let requestExistingLines = existingLines;
      let existingLinesSource = existingLines.length > 0 ? "local" : "";
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

      try {
        const cloudProgress: CoachProgressPayload = {
          requestId,
          stage: "cloud_root",
          label: "Fetching Lichess Cloud evals",
          detail: "Checking for high-depth cloud PVs for the current opening position.",
          progress: 10,
          finished: false,
          elapsedMs: Date.now() - startedAt,
        };
        setRequestProgress(cloudProgress);
        setProgressLog((current) => [...current, cloudProgress].slice(-12));

        const cloudLines = await getCoachCloudLines(currentNode.fen, multipv);
        if (cloudLines.length > 0) {
          requestExistingLines = cloudLines;
          existingLinesSource = "lichessCloud";
        }

        const cloudDoneProgress: CoachProgressPayload = {
          requestId,
          stage: cloudLines.length > 0 ? "cloud_root_done" : "cloud_root_unavailable",
          label: cloudLines.length > 0 ? "Lichess Cloud evals ready" : "No Lichess Cloud evals",
          detail:
            cloudLines.length > 0
              ? `Using ${cloudLines.length} cloud line(s) at depth ${cloudLines[0]?.depth ?? "?"}.`
              : "Continuing with cached local lines or depth-17 Stockfish fallback.",
          progress: 12,
          finished: false,
          elapsedMs: Date.now() - startedAt,
        };
        setRequestProgress(cloudDoneProgress);
        setProgressLog((current) => [...current, cloudDoneProgress].slice(-12));
      } catch (err) {
        const cloudErrorProgress: CoachProgressPayload = {
          requestId,
          stage: "cloud_root_error",
          label: "Lichess Cloud evals unavailable",
          detail: err instanceof Error ? err.message : String(err),
          progress: 12,
          finished: false,
          elapsedMs: Date.now() - startedAt,
        };
        setRequestProgress(cloudErrorProgress);
        setProgressLog((current) => [...current, cloudErrorProgress].slice(-12));
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
          question: groundedQuestion,
          chatHistory,
          referenceContext,
          existingLines: requestExistingLines,
          existingLinesSource,
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
      const structuredAnswer = normalizeCoachCategories(
        response as unknown as CoachStructuredResponse,
      );
      const requestStillCurrent =
        activeRequestIdRef.current === requestId &&
        activeContextKeyRef.current === requestContextKey;
      if (requestStillCurrent) {
        setAnswer(response.answer);
        setMessages((current) => [
          ...current,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: response.answer,
            baseFen: requestPersistenceContext.currentFen,
            basePath: requestPath,
            baseHalfMoves: requestBaseHalfMoves,
            baseSanMoves: requestBaseSanMoves,
            engineLines: response.stockfishLines,
            targetedResults: response.targetedResults,
            bookPassages: response.bookPassages,
            overview: structuredAnswer.overview || undefined,
            categories:
              structuredAnswer.categories.length > 0 ? structuredAnswer.categories : undefined,
            analysisCoverage: response.analysisCoverage ?? undefined,
          },
        ]);
        setUsedExistingAnalysis(response.usedExistingAnalysis);
        setTargetedCount(response.targetedResults.length);
        setBookPassageCount(response.bookPassages.length);
        setBookCorpusAvailable(response.bookCorpusAvailable);
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
        setPersistenceCue(null);
      }

      if (structuredAnswer.categories.length > 0) {
        try {
          const persistedReview = createPersistedAiCoachReview({
            question: trimmedQuestion,
            playerColor: requestPlayerColor,
            response,
            context: requestPersistenceContext,
            baseHalfMoves: requestBaseHalfMoves,
            baseSanMoves: requestBaseSanMoves,
          });
          if (requestStillCurrent) {
            displayedReviewRef.current = persistedReview;
          }
          if (requestPersistenceTarget) {
            await savePersistedAiCoachReview(requestPersistenceTarget, persistedReview);
            if (
              activeRequestIdRef.current === requestId &&
              activeContextKeyRef.current === requestContextKey
            ) {
              savedReviewRef.current = persistedReview;
              displayedReviewRef.current = persistedReview;
              setPersistenceCue({ kind: "saved", savedAt: persistedReview.savedAt });
            }
          }
        } catch (saveError) {
          if (
            activeRequestIdRef.current === requestId &&
            activeContextKeyRef.current === requestContextKey
          ) {
            setPersistenceNotice(
              `The review is shown, but could not be saved with this game: ${
                saveError instanceof Error ? saveError.message : String(saveError)
              }`,
            );
          }
        }
      } else if (requestStillCurrent && requestPersistenceTarget) {
        setPersistenceNotice(
          "The review is shown, but was not saved because it did not contain structured coaching categories.",
        );
      }
    } catch (err) {
      if (
        activeRequestIdRef.current === requestId &&
        activeContextKeyRef.current === requestContextKey
      ) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (activeRequestIdRef.current === requestId) {
        setLoading(false);
        setRequestStartedAt(null);
      }
      if (finishAiCoachBackgroundJob(requestId)) await exit(0);
    }
  }

  function playCoachMoves(payload: string[], basePath?: number[]) {
    const targetPath = [...(basePath ?? currentPath)];
    if (payload.length === 0) {
      store.getState().goToMove(targetPath);
      return;
    }

    const existingPath = resolveExistingMovePath(root, targetPath, payload);
    if (existingPath) {
      store.getState().goToMove(existingPath);
      return;
    }

    store.getState().goToMove(targetPath);
    store.getState().makeMoves({
      payload,
      mainline: false,
      changeHeaders: false,
    });
  }

  async function clearChat() {
    const target = persistenceTarget ? { ...persistenceTarget } : null;
    persistenceLoadGenerationRef.current += 1;
    activeRequestIdRef.current = "";
    savedReviewRef.current = null;
    resetCoachDisplay();
    setPersistenceNotice("");
    if (!target) return;
    try {
      await removePersistedAiCoachReview(target);
    } catch (removeError) {
      setPersistenceNotice(
        `The review was cleared here, but its saved copy could not be removed: ${
          removeError instanceof Error ? removeError.message : String(removeError)
        }`,
      );
    }
  }

  return (
    <Stack h="100%" gap="sm" style={{ minHeight: 0 }}>
      <Group justify="space-between" gap="xs" wrap="wrap">
        <Group gap="xs" wrap="wrap">
          <Text fw={700}>AI Coach</Text>
          <Badge variant="light">{coachEngine?.name ?? "No Stockfish"}</Badge>
          <Badge variant="light">{plannerModel || "GPT-5.6 Sol planner"}</Badge>
          <Badge variant="light">{modelUsed || geminiModel || "GPT-5.6 Sol"}</Badge>
          {existingLines.length > 0 && <Badge variant="outline">cached lines</Badge>}
          {targetedCount > 0 && <Badge variant="outline">targeted Stockfish</Badge>}
          {bookPassageCount > 0 && (
            <Badge color="teal" variant="outline">
              {bookPassageCount} book passages
            </Badge>
          )}
          {bookCorpusAvailable === false && (
            <Badge color="yellow" variant="outline">
              book corpus unavailable
            </Badge>
          )}
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
          {persistenceCue && (
            <Badge
              color="teal"
              variant="light"
              title={`Saved ${new Date(persistenceCue.savedAt).toLocaleString()}`}
            >
              {persistenceCue.kind === "saved" ? "saved with game" : "restored saved review"}
            </Badge>
          )}
        </Group>
        {messages.length > 0 && (
          <Button size="xs" variant="subtle" disabled={loading} onClick={() => void clearChat()}>
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
                  Ask about the current position or request a whole-game review. For a loaded game,
                  the PC checks every unique position—cloud store first, then live PC Stockfish for
                  misses—before AI chooses exact chapters and writes the cited coaching tabs.
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
                    root={root}
                    baseFen={message.baseFen}
                    basePath={message.basePath ?? []}
                    baseHalfMoves={message.baseHalfMoves ?? 0}
                    baseSanMoves={message.baseSanMoves ?? []}
                    mainlineMoves={mainlineMoves}
                    engineLines={message.engineLines ?? []}
                    targetedResults={message.targetedResults ?? []}
                    bookPassages={message.bookPassages ?? []}
                    overview={message.overview}
                    categories={message.categories ?? []}
                    analysisCoverage={message.analysisCoverage}
                    playerColor={playerColor}
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
                    Showing the local pipeline; model private reasoning is not exposed.
                  </Text>
                  <Text size="xs" c="dimmed">
                    You can close the fork; this PC will finish the review, save it, then exit.
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
      {persistenceNotice && (
        <Alert color="yellow" icon={<IconAlertTriangle size="1rem" />}>
          {persistenceNotice}
        </Alert>
      )}

      <Box>
        <Group justify="space-between" align="center" gap="xs" mb="xs" wrap="wrap">
          <Text size="xs" c="dimmed" fw={600}>
            Coach my side
          </Text>
          <SegmentedControl
            size="xs"
            value={playerColor}
            disabled={loading}
            onChange={(value) => setPlayerColor(value === "black" ? "black" : "white")}
            data={[
              { value: "white", label: "I'm White" },
              { value: "black", label: "I'm Black" },
            ]}
          />
        </Group>
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
          GPT-5.6 Sol explains; Stockfish supplies the chess truth. Enter sends; Shift+Enter adds a
          line.
        </Text>
      </Box>
    </Stack>
  );
}

function CoachMessageContent({
  content,
  root,
  baseFen,
  basePath,
  baseHalfMoves,
  baseSanMoves,
  mainlineMoves,
  engineLines,
  targetedResults,
  bookPassages,
  overview,
  categories,
  analysisCoverage,
  playerColor,
  onPlayMoves,
}: {
  content: string;
  root: TreeNode;
  baseFen?: string;
  basePath: number[];
  baseHalfMoves: number;
  baseSanMoves: string[];
  mainlineMoves: MainlineMove[];
  engineLines: CoachEngineLine[];
  targetedResults: CoachTargetedResult[];
  bookPassages: CoachBookPassage[];
  overview?: string;
  categories: CoachUiCategory[];
  analysisCoverage?: CoachAnalysisCoverage;
  playerColor: AiCoachPlayerColor;
  onPlayMoves: (moves: string[], basePath?: number[]) => void;
}) {
  const lineAnchors = useMemo(
    () =>
      buildCoachLineAnchors({
        root,
        baseFen,
        basePath,
        baseHalfMoves,
        engineLines,
        targetedResults,
      }),
    [baseFen, baseHalfMoves, basePath, engineLines, root, targetedResults],
  );
  const inlineContext: InlineMoveRenderContext = {
    root,
    basePath,
    mainlineMoves,
    lineAnchors,
    onPlayMoves,
  };

  if (categories.length > 0) {
    return (
      <Stack gap="sm">
        {analysisCoverage ? (
          <Paper withBorder p="xs">
            <Stack gap={6}>
              <Group justify="space-between" gap="xs">
                <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                  PC analysis coverage
                </Text>
                <Badge
                  size="sm"
                  color={
                    analysisCoverage.complete && analysisCoverage.failed === 0 ? "teal" : "red"
                  }
                  variant="light"
                >
                  {analysisCoverage.complete && analysisCoverage.failed === 0
                    ? "Complete"
                    : "Incomplete"}
                </Badge>
              </Group>
              <Group gap={6} wrap="wrap">
                <Badge variant="outline">{analysisCoverage.totalPositions} positions</Badge>
                <Badge variant="outline">{analysisCoverage.uniquePositions} unique</Badge>
                <Badge variant="outline" color="cyan">
                  {analysisCoverage.cloudHits} PC cloud
                </Badge>
                <Badge variant="outline" color="blue">
                  {analysisCoverage.liveAnalyses} PC live
                </Badge>
                <Badge variant="outline" color={analysisCoverage.failed === 0 ? "gray" : "red"}>
                  {analysisCoverage.failed} failed
                </Badge>
              </Group>
            </Stack>
          </Paper>
        ) : null}
        {overview ? (
          <Paper withBorder p="sm" bg="var(--mantine-color-blue-light)">
            <Stack gap={4}>
              <Text size="xs" c="blue.2" tt="uppercase" fw={700}>
                Game overview
              </Text>
              <CoachAnswerContent
                content={overview}
                basePath={basePath}
                baseHalfMoves={baseHalfMoves}
                baseSanMoves={baseSanMoves}
                mainlineMoves={mainlineMoves}
                bookPassages={bookPassages}
                inlineContext={inlineContext}
                onPlayMoves={onPlayMoves}
              />
            </Stack>
          </Paper>
        ) : null}
        <CoachCategoryTabs
          categories={categories}
          basePath={basePath}
          baseHalfMoves={baseHalfMoves}
          baseSanMoves={baseSanMoves}
          mainlineMoves={mainlineMoves}
          bookPassages={bookPassages}
          inlineContext={inlineContext}
          orientation={playerColor}
          onPlayMoves={onPlayMoves}
        />
      </Stack>
    );
  }

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
            {renderCoachText(segment.text, inlineContext, bookPassages)}
          </Stack>
        );
      })}
      {bookPassages.length > 0 && <CoachBookSources passages={bookPassages} />}
    </Stack>
  );
}

function CoachAnswerContent({
  content,
  basePath,
  baseHalfMoves,
  baseSanMoves,
  mainlineMoves,
  bookPassages,
  inlineContext,
  onPlayMoves,
}: {
  content: string;
  basePath: number[];
  baseHalfMoves: number;
  baseSanMoves: string[];
  mainlineMoves: MainlineMove[];
  bookPassages: CoachBookPassage[];
  inlineContext: InlineMoveRenderContext;
  onPlayMoves: (moves: string[], basePath?: number[]) => void;
}) {
  return splitCoachMessage(content).map((segment, index) => {
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
        {renderCoachText(segment.text, inlineContext, bookPassages)}
      </Stack>
    );
  });
}

function mainlinePathAtPly(mainlineMoves: MainlineMove[], ply: number): number[] | null {
  if (ply === 0) return [];
  return mainlineMoves.find((move) => move.halfMoves === ply)?.path ?? null;
}

function positionMoveLabel(position: Pick<CoachUiCategoryPosition, "ply" | "san">): string {
  if (position.ply === 0) return "Game start";
  return position.san
    ? formatReferenceMoveLabel(position.ply, position.san)
    : `Ply ${position.ply}`;
}

function CoachCategoryTabs({
  categories,
  basePath,
  baseHalfMoves,
  baseSanMoves,
  mainlineMoves,
  bookPassages,
  inlineContext,
  orientation,
  onPlayMoves,
}: {
  categories: CoachUiCategory[];
  basePath: number[];
  baseHalfMoves: number;
  baseSanMoves: string[];
  mainlineMoves: MainlineMove[];
  bookPassages: CoachBookPassage[];
  inlineContext: InlineMoveRenderContext;
  orientation: AiCoachPlayerColor;
  onPlayMoves: (moves: string[], basePath?: number[]) => void;
}) {
  return (
    <Tabs defaultValue={categories[0].id} variant="pills" keepMounted={false}>
      <Box style={{ overflowX: "auto", paddingBottom: 2 }}>
        <Tabs.List style={{ flexWrap: "nowrap", minWidth: "100%", width: "max-content" }}>
          {categories.map((category) => (
            <Tabs.Tab key={category.id} value={category.id} style={{ whiteSpace: "nowrap" }}>
              {category.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Box>

      {categories.map((category) => (
        <Tabs.Panel key={category.id} value={category.id} pt="sm">
          <Stack gap="sm">
            {category.summary ? (
              <Text size="sm" fw={650}>
                {renderInlineMarkdown(category.summary, inlineContext, bookPassages)}
              </Text>
            ) : null}
            {category.explanation ? (
              <CoachAnswerContent
                content={category.explanation}
                basePath={basePath}
                baseHalfMoves={baseHalfMoves}
                baseSanMoves={baseSanMoves}
                mainlineMoves={mainlineMoves}
                bookPassages={bookPassages}
                inlineContext={inlineContext}
                onPlayMoves={onPlayMoves}
              />
            ) : null}
            {category.positions.length > 0 ? (
              <CoachCategoryPositions
                positions={category.positions}
                basePath={basePath}
                baseHalfMoves={baseHalfMoves}
                baseSanMoves={baseSanMoves}
                mainlineMoves={mainlineMoves}
                bookPassages={bookPassages}
                inlineContext={inlineContext}
                orientation={orientation}
                onPlayMoves={onPlayMoves}
              />
            ) : null}
            {category.bookReferences.length > 0 ? (
              <CoachBookSources
                passages={bookPassages}
                references={category.bookReferences}
                mainlineMoves={mainlineMoves}
                inlineContext={inlineContext}
                orientation={orientation}
                onPlayMoves={onPlayMoves}
              />
            ) : null}
          </Stack>
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}

function CoachCategoryPositions({
  positions,
  basePath,
  baseHalfMoves,
  baseSanMoves,
  mainlineMoves,
  bookPassages,
  inlineContext,
  orientation,
  onPlayMoves,
}: {
  positions: CoachUiCategoryPosition[];
  basePath: number[];
  baseHalfMoves: number;
  baseSanMoves: string[];
  mainlineMoves: MainlineMove[];
  bookPassages: CoachBookPassage[];
  inlineContext: InlineMoveRenderContext;
  orientation: AiCoachPlayerColor;
  onPlayMoves: (moves: string[], basePath?: number[]) => void;
}) {
  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        Positions from your game
      </Text>
      {positions.map((position, index) => {
        const positionPath = mainlinePathAtPly(mainlineMoves, position.ply);
        const moveLabel = positionMoveLabel(position);
        return (
          <Paper key={`${position.ply}-${position.san}-${index}`} withBorder p="sm">
            <Stack gap={6}>
              <Group justify="space-between" align="flex-start" gap="xs" wrap="nowrap">
                <Box miw={0}>
                  <Text size="sm" fw={650}>
                    {position.title || moveLabel}
                  </Text>
                  {position.title && (
                    <Text size="xs" c="dimmed">
                      {moveLabel}
                    </Text>
                  )}
                </Box>
                <Button
                  size="compact-xs"
                  variant="light"
                  disabled={!positionPath}
                  onClick={() => positionPath && onPlayMoves([], positionPath)}
                >
                  Show position
                </Button>
              </Group>
              {position.explanation ? (
                <CoachAnswerContent
                  content={position.explanation}
                  basePath={basePath}
                  baseHalfMoves={baseHalfMoves}
                  baseSanMoves={baseSanMoves}
                  mainlineMoves={mainlineMoves}
                  bookPassages={bookPassages}
                  inlineContext={inlineContext}
                  onPlayMoves={onPlayMoves}
                />
              ) : null}
              {position.engineEvidence ? (
                <Box>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={2}>
                    Engine evidence
                  </Text>
                  <CoachAnswerContent
                    content={position.engineEvidence}
                    basePath={basePath}
                    baseHalfMoves={baseHalfMoves}
                    baseSanMoves={baseSanMoves}
                    mainlineMoves={mainlineMoves}
                    bookPassages={bookPassages}
                    inlineContext={inlineContext}
                    onPlayMoves={onPlayMoves}
                  />
                </Box>
              ) : null}
              {position.betterPlan ? (
                <Box>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={2}>
                    Better plan
                  </Text>
                  <CoachAnswerContent
                    content={position.betterPlan}
                    basePath={basePath}
                    baseHalfMoves={baseHalfMoves}
                    baseSanMoves={baseSanMoves}
                    mainlineMoves={mainlineMoves}
                    bookPassages={bookPassages}
                    inlineContext={inlineContext}
                    onPlayMoves={onPlayMoves}
                  />
                </Box>
              ) : null}
              <CoachLineDiagram
                moves={mainlineMoves}
                initialCursor={Math.max(
                  0,
                  mainlineMoves.findIndex((move) => move.halfMoves === position.ply) + 1,
                )}
                orientation={orientation}
                label={`Game position after ${moveLabel}`}
              />
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}

type CoachDiagramMove = {
  san: string;
  uci: string | null;
  fenBefore: string;
  fenAfter: string;
};

function CoachLineDiagram({
  moves,
  initialCursor,
  orientation,
  label,
}: {
  moves: CoachDiagramMove[];
  initialCursor: number;
  orientation: AiCoachPlayerColor;
  label: string;
}) {
  const [cursor, setCursor] = useState(() => Math.max(0, Math.min(initialCursor, moves.length)));
  useEffect(() => {
    setCursor(Math.max(0, Math.min(initialCursor, moves.length)));
  }, [initialCursor, moves]);

  if (moves.length === 0) return null;
  const boundedCursor = Math.max(0, Math.min(cursor, moves.length));
  const fen = boundedCursor === 0 ? moves[0].fenBefore : moves[boundedCursor - 1].fenAfter;
  const currentMove = boundedCursor > 0 ? moves[boundedCursor - 1] : null;
  const nextMove = boundedCursor < moves.length ? moves[boundedCursor] : null;
  const lastMove = coachDiagramSquares(currentMove?.uci ?? null);
  const nextArrow = coachDiagramArrow(nextMove?.uci ?? null);

  return (
    <Paper withBorder p="xs" mt={6} mx="auto" w="min(100%, 19rem)" bg="var(--mantine-color-dark-7)">
      <Text size="xs" c="dimmed" mb={5} lineClamp={2}>
        {label}
      </Text>
      <Box style={{ overflow: "hidden", borderRadius: 6 }}>
        <Chessground
          coordinates
          viewOnly
          fen={fen}
          orientation={orientation}
          lastMove={lastMove}
          drawable={{ enabled: false, visible: true, autoShapes: nextArrow }}
        />
      </Box>
      <Group justify="center" gap="xs" mt={7} wrap="nowrap">
        <ActionIcon
          variant="light"
          aria-label="Previous diagram move"
          disabled={boundedCursor === 0}
          onClick={() => setCursor((value) => Math.max(0, value - 1))}
        >
          <IconChevronLeft size={17} />
        </ActionIcon>
        <Text size="xs" ta="center" style={{ minWidth: 0, flex: 1 }}>
          {currentMove ? `${boundedCursor}. ${currentMove.san}` : "Starting position"}
          {nextMove ? ` · next ${nextMove.san}` : " · end of line"}
        </Text>
        <ActionIcon
          variant="light"
          aria-label="Next diagram move"
          disabled={boundedCursor >= moves.length}
          onClick={() => setCursor((value) => Math.min(moves.length, value + 1))}
        >
          <IconChevronRight size={17} />
        </ActionIcon>
      </Group>
    </Paper>
  );
}

function coachDiagramSquares(uci: string | null): Key[] | undefined {
  if (!uci || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return undefined;
  return [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key];
}

function coachDiagramArrow(uci: string | null): DrawShape[] {
  const squares = coachDiagramSquares(uci);
  return squares ? [{ orig: squares[0], dest: squares[1], brush: "blue" }] : [];
}

function CoachBookSources({
  passages,
  references = [],
  mainlineMoves = [],
  inlineContext,
  orientation = "white",
  onPlayMoves,
}: {
  passages: CoachBookPassage[];
  references?: CoachUiCategoryBookReference[];
  mainlineMoves?: MainlineMove[];
  inlineContext?: InlineMoveRenderContext;
  orientation?: AiCoachPlayerColor;
  onPlayMoves?: (moves: string[], basePath?: number[]) => void;
}) {
  const passageByChunkId = new Map(passages.map((passage) => [passage.chunkId, passage]));
  const sourceItems =
    references.length > 0
      ? references.flatMap((reference) => {
          const passage = passageByChunkId.get(reference.chunkId);
          return passage ? [{ passage, reference }] : [];
        })
      : passages.map((passage) => ({ passage, reference: undefined }));

  if (sourceItems.length === 0) return null;

  return (
    <Paper withBorder p="sm" mt={4} bg="var(--mantine-color-teal-light)">
      <Stack gap="xs">
        <Group gap="xs">
          <IconBook size="1rem" />
          <Text size="sm" fw={700}>
            Book references
          </Text>
          <Badge size="xs" variant="light" color="teal">
            {sourceItems.length}
          </Badge>
        </Group>
        {sourceItems.map(({ passage, reference }) => {
          const positionPath =
            reference?.positionPly !== null && reference?.positionPly !== undefined
              ? mainlinePathAtPly(mainlineMoves, reference.positionPly)
              : null;
          return (
            <Paper key={passage.chunkId} withBorder p="xs">
              <Stack gap={4}>
                <Group justify="space-between" align="flex-start" gap="xs" wrap="nowrap">
                  <Box miw={0}>
                    <Text size="sm" fw={650}>
                      {passage.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {[passage.author, passage.chapterTitle].filter(Boolean).join(" · ")}
                    </Text>
                  </Box>
                  <Group gap={4} wrap="nowrap">
                    {positionPath && onPlayMoves ? (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        onClick={() => onPlayMoves([], positionPath)}
                      >
                        Position
                      </Button>
                    ) : null}
                    {passage.localPath ? (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="teal"
                        leftSection={<IconExternalLink size="0.8rem" />}
                        onClick={() => void openPath(passage.localPath)}
                      >
                        PDF
                      </Button>
                    ) : null}
                  </Group>
                </Group>
                {reference?.whyItMatters ? (
                  <Box>
                    <Text size="xs" c="teal.3" fw={700}>
                      Why this matters here
                    </Text>
                    <Text size="xs">
                      {renderInlineMarkdown(reference.whyItMatters, inlineContext, passages)}
                    </Text>
                  </Box>
                ) : null}
                <Text size="xs" lineClamp={4}>
                  {passage.excerpt}
                </Text>
                <Text size="xs" c="dimmed">
                  {passage.citation}
                </Text>
                {passage.openingLines.map((line) => (
                  <Box
                    key={line.lineId}
                    mt={6}
                    pt={6}
                    style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
                  >
                    <Text size="xs" fw={650}>
                      Exact book line ·{" "}
                      {line.playedMoveMatched
                        ? `your ${line.playedSan || line.playedUci} follows the cited line`
                        : `the book gives ${line.bookMoveSan} where you played ${
                            line.playedSan || line.playedUci
                          }`}
                      {line.sharedPlies > 1 ? ` · ${line.sharedPlies} matching plies` : ""}
                    </Text>
                    <Text size="xs" c="dimmed" mt={3}>
                      {line.pgn}
                    </Text>
                    <CoachLineDiagram
                      moves={line.moves}
                      initialCursor={Math.min(line.matchedBookMoveIndex + 1, line.moves.length)}
                      orientation={orientation}
                      label={`${passage.title} · ${line.citation || passage.citation}`}
                    />
                  </Box>
                ))}
              </Stack>
            </Paper>
          );
        })}
      </Stack>
    </Paper>
  );
}
