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
import { parseSan } from "chessops/san";
import { useAtomValue } from "jotai";
import { type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
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
import { getPGN, getVariationLine, uciNormalize } from "@/utils/chess";
import { buildAiCoachOpeningContext } from "@/utils/aiCoachOpeningContext";
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

function renderInlineMarkdown(text: string, context?: InlineMoveRenderContext) {
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g).filter((part) => part.length > 0);
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

function renderCoachText(text: string, context?: InlineMoveRenderContext) {
  return text
    .split(/\n+/)
    .map((rawLine) => rawLine.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      const heading = line.match(/^#{1,6}\s+(.+)$/);
      if (heading) {
        return (
          <Text key={`${line}-${index}`} size="sm" fw={700} mt={index === 0 ? 0 : "xs"}>
            {renderInlineMarkdown(heading[1], context)}
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
            <Text size="sm">{renderInlineMarkdown(bullet[1], context)}</Text>
          </Group>
        );
      }

      return (
        <Text key={`${line}-${index}`} size="sm">
          {renderInlineMarkdown(line, context)}
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
          question: trimmedQuestion,
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
          engineLines: response.stockfishLines,
          targetedResults: response.targetedResults,
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
                    root={root}
                    baseFen={message.baseFen}
                    basePath={message.basePath ?? []}
                    baseHalfMoves={message.baseHalfMoves ?? 0}
                    baseSanMoves={message.baseSanMoves ?? []}
                    mainlineMoves={mainlineMoves}
                    engineLines={message.engineLines ?? []}
                    targetedResults={message.targetedResults ?? []}
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
  root,
  baseFen,
  basePath,
  baseHalfMoves,
  baseSanMoves,
  mainlineMoves,
  engineLines,
  targetedResults,
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
            {renderCoachText(segment.text, inlineContext)}
          </Stack>
        );
      })}
    </Stack>
  );
}
