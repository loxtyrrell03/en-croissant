import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Portal,
  Progress,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { useToggle } from "@mantine/hooks";
import {
  IconArrowBack,
  IconBook,
  IconBulb,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconDatabase,
  IconGitCompare,
  IconEye,
  IconInfoCircle,
  IconPencil,
  IconRoute,
  IconTarget,
  IconTargetArrow,
  IconTrash,
  IconZoomCheck,
  IconX,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { makeUci, parseUci, type Move } from "chessops";
import { makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import dayjs from "dayjs";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { createEmptyCard, formatDate } from "ts-fsrs";
import { useStore } from "zustand";
import Board from "@/components/boards/Board";
import EvalListener from "@/components/boards/EvalListener";
import DetachedEval from "@/components/common/DetachedEval";
import GameNotation from "@/components/common/GameNotation";
import MoveControls from "@/components/common/MoveControls";
import { ResponsivePanel } from "@/components/common/ResponsivePanel";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  formatReviewInterval,
  getCardForReview,
  getNextReviewTimes,
  getStats,
  type Position,
  updateCardPerformance,
} from "@/components/files/opening";
import AnalysisPanel from "@/components/panels/analysis/AnalysisPanel";
import AnnotationPanel from "@/components/panels/annotation/AnnotationPanel";
import ComparePanel from "@/components/panels/compare/ComparePanel";
import DatabasePanel from "@/components/panels/database/DatabasePanel";
import EnginePlanExplorerPanel from "@/components/panels/enginePlan/EnginePlanExplorerPanel";
import RepertoireGapsPanel from "@/components/panels/gaps/RepertoireGapsPanel";
import InfoPanel from "@/components/panels/info/InfoPanel";
import PlanExplorerPanel from "@/components/panels/plan/PlanExplorerPanel";
import {
  currentTabSelectedAtom,
  currentEvalOpenAtom,
  currentInvisibleAtom,
  currentShowCommentsAtom,
  deckAtomFamily,
  openingReviewHideMovesDuringPracticeAtom,
  practiceAutoDifficultyAtom,
  practiceCardStartTimeAtom,
  practiceSessionStatsAtom,
  practiceStateAtom,
} from "@/state/atoms";
import type { TreeStore } from "@/state/store/tree";
import type { Tab } from "@/utils/tabs";
import { getTabPracticeKey } from "@/utils/tabs";
import { positionFromFen } from "@/utils/chessops";
import {
  createNode,
  defaultTree,
  findFen,
  getNodeAtPath,
  type GameHeaders,
  type TreeNode,
  type TreeState,
} from "@/utils/treeReducer";
import {
  readOpeningReviewDeck,
  type OpeningReviewDeck,
  writeOpeningReviewDeck,
} from "@/utils/openingReview";

const scrollablePanelStyle = {
  minHeight: 0,
  overflowX: "hidden",
  overflowY: "auto",
} as const;

const reviewWorkspaceTabs = new Set([
  "review",
  "analysis",
  "database",
  "plan-explorer",
  "engine-plans",
  "compare",
  "info",
]);

type ReviewBoardMoveCandidate = {
  fen: string;
  san: string;
  uci: string;
};

type OpeningReviewPanelView = "review" | "analyze";

export default function OpeningReviewWorkspace({ tab }: { tab: Tab }) {
  const boardRef = useRef(null);
  const deckPath = getTabPracticeKey(tab);
  const [deck, setDeck] = useAtom(deckAtomFamily({ file: deckPath, game: 0 }));
  const [deckInfo, setDeckInfo] = useState<OpeningReviewDeck | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [boardMoveCandidate, setBoardMoveCandidate] = useState<ReviewBoardMoveCandidate | null>(
    null,
  );
  const [currentTabSelected, setCurrentTabSelected] = useAtom(currentTabSelectedAtom);
  const [practiceState, setPracticeState] = useAtom(practiceStateAtom);
  const practicing = currentTabSelected === "review" && practiceState.phase !== "idle";
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const headers = useStore(store, (s) => s.headers);
  const positionPath = useStore(store, (s) => s.position);
  const treeDirty = useStore(store, (s) => s.dirty);
  const goToNext = useStore(store, (s) => s.goToNext);
  const goToPrevious = useStore(store, (s) => s.goToPrevious);
  const goToMove = useStore(store, (s) => s.goToMove);
  const setHeaders = useStore(store, (s) => s.setHeaders);
  const setPracticePath = useStore(store, (s) => s.setPracticePath);
  const setState = useStore(store, (s) => s.setState);
  const setInvisible = useSetAtom(currentInvisibleAtom);
  const setShowComments = useSetAtom(currentShowCommentsAtom);
  const setEvalOpen = useSetAtom(currentEvalOpenAtom);

  const activeReviewPositions = useMemo(
    () => getReviewPositionsForPath(deck.positions, root, positionPath),
    [deck.positions, positionPath, root],
  );
  const activeReviewPosition = activeReviewPositions[activeReviewPositions.length - 1] ?? null;
  const activeReviewIndex = activeReviewPosition?.positionIndex ?? -1;
  const canGoPrevious = loaded && !loadError && activeReviewIndex > 0;
  const canGoNext =
    loaded &&
    !loadError &&
    deck.positions.length > 0 &&
    activeReviewIndex < deck.positions.length - 1;

  const loadDeckPosition = useCallback(
    (positionIndex: number) => {
      const position = deck.positions[positionIndex];
      if (!position) return;

      loadReviewPositionOnBoard({
        position,
        headers,
        root,
        store,
        goToMove,
        setHeaders,
        setState,
      });
      setPracticePath(null);
      setPracticeState({ phase: "idle" });
      setInvisible(false);
      setShowComments(true);
      setEvalOpen(true);
      setBoardMoveCandidate(null);
    },
    [
      deck.positions,
      goToMove,
      headers,
      root,
      setEvalOpen,
      setHeaders,
      setInvisible,
      setPracticePath,
      setPracticeState,
      setShowComments,
      setState,
      store,
    ],
  );

  const goToPreviousReviewPosition = useCallback(() => {
    if (!canGoPrevious) return;
    loadDeckPosition(activeReviewIndex - 1);
  }, [activeReviewIndex, canGoPrevious, loadDeckPosition]);

  const goToNextReviewPosition = useCallback(() => {
    if (!canGoNext) return;
    loadDeckPosition(activeReviewIndex === -1 ? 0 : activeReviewIndex + 1);
  }, [activeReviewIndex, canGoNext, loadDeckPosition]);

  useEffect(() => {
    const navigateWithArrowKeys = (event: KeyboardEvent) => {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.key !== "ArrowRight" && event.key !== "ArrowLeft")
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      if (event.key === "ArrowRight") {
        goToNext();
      } else {
        goToPrevious();
      }
    };

    window.addEventListener("keydown", navigateWithArrowKeys, { capture: true });
    return () => window.removeEventListener("keydown", navigateWithArrowKeys, { capture: true });
  }, [goToNext, goToPrevious]);

  useEffect(() => {
    const initialTab = tab.gameOrigin.kind === "opening_review" ? tab.gameOrigin.initialTab : null;
    setCurrentTabSelected(
      initialTab && reviewWorkspaceTabs.has(initialTab) ? initialTab : "review",
    );
  }, [setCurrentTabSelected, tab.gameOrigin]);

  useEffect(() => {
    let disposed = false;
    setLoaded(false);
    setLoadError(null);

    async function loadDeck() {
      try {
        const nextDeck = await readOpeningReviewDeck(deckPath);
        if (disposed) return;
        setDeckInfo(nextDeck);
        setDeck({ positions: nextDeck.positions, logs: nextDeck.logs });
        setLoaded(true);
      } catch (error) {
        if (disposed) return;
        setLoadError(error instanceof Error ? error.message : String(error));
        setLoaded(true);
      }
    }

    void loadDeck();
    return () => {
      disposed = true;
    };
  }, [deckPath, setDeck]);

  useEffect(() => {
    if (!loaded || !deckInfo || loadError) return undefined;

    const timeout = window.setTimeout(() => {
      void writeOpeningReviewDeck(deckPath, {
        ...deckInfo,
        positions: deck.positions,
        logs: deck.logs,
      }).catch((error) => {
        notifications.show({
          title: "Could not save review progress",
          message: error instanceof Error ? error.message : String(error),
          color: "red",
        });
      });
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [deck, deckInfo, deckPath, loadError, loaded]);

  const selectedToolTab = reviewWorkspaceTabs.has(currentTabSelected)
    ? currentTabSelected
    : "review";

  useEffect(() => {
    if (selectedToolTab !== currentTabSelected) {
      setCurrentTabSelected(selectedToolTab);
    }
  }, [currentTabSelected, selectedToolTab, setCurrentTabSelected]);

  useEffect(() => {
    if (!loaded || loadError || !treeDirty || activeReviewPositions.length === 0) return;

    const nextReviewTrees = activeReviewPositions.map((reviewPosition) => ({
      ...reviewPosition,
      reviewTree: cloneReviewTreeNode(reviewPosition.node),
    }));

    setDeck((current) => {
      let positions = current.positions;
      let changed = false;

      for (const reviewPosition of nextReviewTrees) {
        const position = positions[reviewPosition.positionIndex];
        if (!position || !sameReviewPosition(position.fen, reviewPosition.node.fen)) {
          continue;
        }

        const nextPosition = withReviewTree(position, reviewPosition.reviewTree);
        if (sameReviewPersistence(position, nextPosition)) continue;

        if (!changed) {
          positions = [...positions];
          changed = true;
        }
        positions[reviewPosition.positionIndex] = nextPosition;
      }

      return changed ? { ...current, positions } : current;
    });
  }, [activeReviewPositions, loadError, loaded, setDeck, treeDirty]);

  return (
    <>
      <EvalListener active={selectedToolTab === "analysis" || selectedToolTab === "compare"} />
      <Portal target="#left" style={{ height: "100%" }}>
        <Stack h="100%" gap="xs" style={{ minHeight: 0, overflow: "hidden" }}>
          <Stack flex={1} style={{ minHeight: 0, overflow: "hidden" }}>
            <Board
              practicing={practicing}
              editingMode={false}
              boardRef={boardRef}
              onMove={(uci, fen, san) => setBoardMoveCandidate({ fen, san, uci })}
            />
          </Stack>
          <OpeningReviewBoardNavigation
            positionIndex={activeReviewIndex}
            total={deck.positions.length}
            canGoPrevious={canGoPrevious}
            canGoNext={canGoNext}
            onPrevious={goToPreviousReviewPosition}
            onNext={goToNextReviewPosition}
          />
          <Paper
            withBorder
            h="15rem"
            mah="35%"
            style={{ minHeight: "10rem", overflow: "hidden", flexShrink: 0 }}
          >
            <AnnotationPanel />
          </Paper>
        </Stack>
      </Portal>
      <Portal target="#topRight" style={{ height: "100%" }}>
        <Paper withBorder h="100%" pos="relative">
          <ResponsivePanel>
            <Tabs
              w="100%"
              h="100%"
              value={selectedToolTab}
              onChange={(value) => setCurrentTabSelected(value || "review")}
              keepMounted={false}
              activateTabWithKeyboard={false}
              style={{
                display: "flex",
                flexDirection: "column",
              }}
              styles={{
                tabLabel: {
                  flex: 0,
                },
                tab: {
                  display: "flex",
                  justifyContent: "center",
                  gap: "0.3rem",
                },
              }}
            >
              <Tabs.List grow>
                <Tabs.Tab value="review" leftSection={<IconTargetArrow size="1rem" />}>
                  Review
                </Tabs.Tab>
                <Tabs.Tab value="analysis" leftSection={<IconZoomCheck size="1rem" />}>
                  Analysis
                </Tabs.Tab>
                <Tabs.Tab value="database" leftSection={<IconDatabase size="1rem" />}>
                  Database
                </Tabs.Tab>
                <Tabs.Tab value="plan-explorer" leftSection={<IconRoute size="1rem" />}>
                  Plan Explorer
                </Tabs.Tab>
                <Tabs.Tab value="engine-plans" leftSection={<IconBulb size="1rem" />}>
                  Engine Plans
                </Tabs.Tab>
                <Tabs.Tab value="compare" leftSection={<IconGitCompare size="1rem" />}>
                  Compare
                </Tabs.Tab>
                <Tabs.Tab value="info" leftSection={<IconInfoCircle size="1rem" />}>
                  Info
                </Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="review" flex={1} p="sm" style={scrollablePanelStyle}>
                <OpeningReviewPanel
                  deckName={deckInfo?.name ?? tab.name}
                  deckPath={deckPath}
                  deckMode={deckInfo?.mode}
                  initialView={
                    tab.gameOrigin.kind === "opening_review" && tab.gameOrigin.initialTab === "gaps"
                      ? "analyze"
                      : "review"
                  }
                  boardMoveCandidate={boardMoveCandidate}
                  onClearBoardMoveCandidate={() => setBoardMoveCandidate(null)}
                  loadError={loadError}
                  loaded={loaded}
                />
              </Tabs.Panel>
              <Tabs.Panel value="analysis" flex={1} style={scrollablePanelStyle}>
                <AnalysisPanel />
              </Tabs.Panel>
              <Tabs.Panel value="database" flex={1} style={scrollablePanelStyle}>
                <DatabasePanel />
              </Tabs.Panel>
              <Tabs.Panel value="plan-explorer" flex={1} style={scrollablePanelStyle}>
                <PlanExplorerPanel />
              </Tabs.Panel>
              <Tabs.Panel value="engine-plans" flex={1} style={scrollablePanelStyle}>
                <EnginePlanExplorerPanel />
              </Tabs.Panel>
              <Tabs.Panel value="compare" flex={1} style={scrollablePanelStyle}>
                <ComparePanel />
              </Tabs.Panel>
              <Tabs.Panel value="info" flex={1} style={scrollablePanelStyle}>
                <InfoPanel />
              </Tabs.Panel>
            </Tabs>
          </ResponsivePanel>
        </Paper>
      </Portal>
      <Portal target="#bottomRight" style={{ height: "100%" }}>
        <Stack h="100%" gap="xs">
          <DetachedEval />
          <GameNotation topBar />
          <MoveControls />
        </Stack>
      </Portal>
    </>
  );
}

function OpeningReviewBoardNavigation({
  positionIndex,
  total,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
}: {
  positionIndex: number;
  total: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const label =
    total === 0
      ? "No review positions"
      : positionIndex >= 0
        ? `Position ${positionIndex + 1} / ${total}`
        : `${total} review position${total === 1 ? "" : "s"}`;

  return (
    <Group justify="space-between" gap="xs" wrap="nowrap" px="xs" style={{ flexShrink: 0 }}>
      <Button
        size="xs"
        variant="default"
        leftSection={<IconChevronLeft size={14} />}
        disabled={!canGoPrevious}
        onClick={onPrevious}
      >
        Back
      </Button>
      <Text size="xs" c="dimmed" ta="center" lineClamp={1}>
        {label}
      </Text>
      <Button
        size="xs"
        variant="default"
        rightSection={<IconChevronRight size={14} />}
        disabled={!canGoNext}
        onClick={onNext}
      >
        Next
      </Button>
    </Group>
  );
}

function loadReviewPositionOnBoard({
  position,
  headers,
  root,
  store,
  goToMove,
  setHeaders,
  setState,
}: {
  position: Position;
  headers: GameHeaders;
  root: TreeNode;
  store: TreeStore;
  goToMove: (move: number[]) => void;
  setHeaders: (headers: GameHeaders) => void;
  setState: (state: TreeState) => void;
}) {
  const reviewLine = createReviewPositionLineState(position, headers);
  if (reviewLine) {
    setState(reviewLine.state);
    return reviewLine.path;
  }

  const path = findFen(position.fen, root);
  if (path.length === 0 && !sameReviewPosition(root.fen, position.fen)) {
    setHeaders({
      ...headers,
      fen: position.fen,
      orientation: position.sideToMove ?? headers.orientation ?? "white",
      result: "*",
    });
    applyReviewPositionMetadata(store, position);
    return [];
  }

  goToMove(path);
  applyReviewPositionMetadata(store, position);
  return path;
}

function getReviewPositionsForPath(positions: Position[], root: TreeNode, path: number[]) {
  const matches: { positionIndex: number; node: TreeNode; path: number[] }[] = [];

  for (let depth = 0; depth <= path.length; depth += 1) {
    const nodePath = path.slice(0, depth);
    const node = getNodeAtPath(root, nodePath);
    const positionIndex = positions.findIndex((position) =>
      sameReviewPosition(position.fen, node.fen),
    );
    if (positionIndex !== -1) {
      matches.push({ positionIndex, node, path: nodePath });
    }
  }

  return matches;
}

function applyReviewPositionMetadata(store: TreeStore, position: Position) {
  const state = store.getState();
  const nextState = cloneTreeState(state);
  const node = getNodeAtPath(nextState.root, nextState.position);
  applyReviewPositionToNode(node, position);
  state.setState(nextState);
}

function createReviewPositionLineState(position: Position, headers: GameHeaders) {
  const moveSequence = position.moveSequence?.trim();
  if (!moveSequence) {
    const tree = defaultTree(position.fen);
    tree.headers = {
      ...headers,
      fen: tree.root.fen,
      orientation: position.sideToMove ?? headers.orientation ?? "white",
      result: "*",
    };
    tree.dirty = false;
    applyReviewPositionToNode(tree.root, position);
    return { state: tree, path: [] };
  }

  const tree = defaultTree();
  tree.headers = {
    ...headers,
    fen: tree.root.fen,
    orientation: position.sideToMove ?? headers.orientation ?? "white",
    result: "*",
  };
  tree.dirty = false;

  const [chess] = positionFromFen(tree.root.fen);
  if (!chess) return null;

  let currentNode = tree.root;
  const path: number[] = [];
  for (const token of tokenizeReviewMoveSequence(moveSequence)) {
    const move = parseSan(chess, token);
    if (!move) return null;
    const san = makeSan(chess, move);
    chess.play(move);
    const node = createNode({
      fen: makeFen(chess.toSetup()),
      move,
      san,
      halfMoves: currentNode.halfMoves + 1,
    });
    currentNode.children = [node];
    currentNode = node;
    path.push(0);
  }

  if (!sameReviewPosition(currentNode.fen, position.fen)) return null;

  currentNode.fen = position.fen;
  applyReviewPositionToNode(currentNode, position);
  tree.position = path;
  return { state: tree, path };
}

function applyReviewPositionToNode(node: TreeNode, position: Position) {
  const reviewTree = position.reviewTree ? cloneReviewTreeNode(position.reviewTree) : null;
  if (reviewTree) {
    node.children = reviewTree.children;
    node.score = reviewTree.score;
    node.depth = reviewTree.depth;
    node.annotations = reviewTree.annotations;
    node.comment = reviewTree.comment;
    node.shapes = reviewTree.shapes;
    if (reviewTree.clock !== undefined) {
      node.clock = reviewTree.clock;
    } else {
      delete node.clock;
    }
    return;
  }

  node.annotations = position.annotations ?? [];
  node.comment = position.comment ?? "";
  node.shapes = position.shapes ?? [];
}

function withReviewTree(position: Position, reviewTree: TreeNode): Position {
  const hasContent = hasReviewTreeContent(reviewTree);
  return {
    ...position,
    comment: reviewTree.comment || undefined,
    annotations: reviewTree.annotations.length > 0 ? reviewTree.annotations : undefined,
    shapes: reviewTree.shapes.length > 0 ? reviewTree.shapes : undefined,
    reviewTree: hasContent ? reviewTree : undefined,
  };
}

function hasReviewTreeContent(node: TreeNode) {
  return (
    node.children.length > 0 ||
    node.annotations.length > 0 ||
    node.shapes.length > 0 ||
    node.comment.trim().length > 0
  );
}

function sameReviewPersistence(left: Position, right: Position) {
  return (
    JSON.stringify(reviewPersistenceSnapshot(left)) ===
    JSON.stringify(reviewPersistenceSnapshot(right))
  );
}

function reviewPersistenceSnapshot(position: Position) {
  return {
    comment: position.comment || undefined,
    annotations: position.annotations?.length ? position.annotations : undefined,
    shapes: position.shapes?.length ? position.shapes : undefined,
    reviewTree: position.reviewTree ? cloneReviewTreeNode(position.reviewTree) : undefined,
  };
}

function cloneTreeState(state: TreeState): TreeState {
  return {
    root: cloneReviewTreeNode(state.root),
    headers: {
      ...state.headers,
      start: state.headers.start ? [...state.headers.start] : undefined,
      other: state.headers.other ? { ...state.headers.other } : undefined,
    },
    position: [...state.position],
    dirty: state.dirty,
    report: { ...state.report },
  };
}

function cloneReviewTreeNode(node: TreeNode): TreeNode {
  return {
    fen: node.fen,
    move: cloneJson(node.move) ?? null,
    san: node.san ?? null,
    children: node.children.map(cloneReviewTreeNode),
    score: cloneJson(node.score) ?? null,
    depth: node.depth ?? null,
    halfMoves: node.halfMoves,
    shapes: cloneJson(node.shapes ?? []),
    annotations: [...(node.annotations ?? [])],
    comment: node.comment ?? "",
    ...(node.clock !== undefined ? { clock: node.clock } : {}),
  };
}

function cloneJson<T>(value: T): T {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function tokenizeReviewMoveSequence(moveSequence: string) {
  return moveSequence
    .split(/\s+/)
    .map((token) => token.replace(/^\d+\.(\.\.)?/, "").trim())
    .filter(
      (token) =>
        token && !/^\d+\.(\.\.)?$/.test(token) && !["1-0", "0-1", "1/2-1/2", "*"].includes(token),
    );
}

function sameReviewPosition(a: string, b: string) {
  return a.split(" ").slice(0, 4).join(" ") === b.split(" ").slice(0, 4).join(" ");
}

function parseReviewCorrectMove(position: Position, value: string) {
  const input = value.trim();
  if (!input) return null;

  const [pos] = positionFromFen(position.fen);
  if (!pos) return null;

  let move: Move | undefined | null = parseSan(pos, input);
  if (!move) {
    const uciMove = parseUci(input);
    if (uciMove && pos.isLegal(uciMove)) {
      move = uciMove;
    }
  }
  if (!move || !pos.isLegal(move)) return null;

  return {
    san: makeSan(pos, move),
    uci: makeUci(move),
  };
}

function OpeningReviewPanel({
  deckName,
  deckPath,
  deckMode,
  initialView,
  boardMoveCandidate,
  onClearBoardMoveCandidate,
  loadError,
  loaded,
}: {
  deckName: string;
  deckPath: string;
  deckMode?: "self" | "opponent";
  initialView: OpeningReviewPanelView;
  boardMoveCandidate: ReviewBoardMoveCandidate | null;
  onClearBoardMoveCandidate: () => void;
  loadError: string | null;
  loaded: boolean;
}) {
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const headers = useStore(store, (s) => s.headers);
  const goToMove = useStore(store, (s) => s.goToMove);
  const setHeaders = useStore(store, (s) => s.setHeaders);
  const setPracticePath = useStore(store, (s) => s.setPracticePath);
  const setState = useStore(store, (s) => s.setState);
  const currentFen = useStore(store, (s) => s.currentNode().fen);

  const [deck, setDeck] = useAtom(deckAtomFamily({ file: deckPath, game: 0 }));
  const stats = getStats(deck.positions);
  const setInvisible = useSetAtom(currentInvisibleAtom);
  const setShowComments = useSetAtom(currentShowCommentsAtom);
  const setEvalOpen = useSetAtom(currentEvalOpenAtom);
  const [practiceState, setPracticeState] = useAtom(practiceStateAtom);
  const [sessionStats, setSessionStats] = useAtom(practiceSessionStatsAtom);
  const setCardStartTime = useSetAtom(practiceCardStartTimeAtom);
  const practiceAutoDifficulty = useAtomValue(practiceAutoDifficultyAtom);
  const hideMovesDuringPractice = useAtomValue(openingReviewHideMovesDuringPracticeAtom);
  const [positionsOpen, setPositionsOpen] = useToggle();
  const [panelView, setPanelView] = useState<OpeningReviewPanelView>(initialView);
  const playedOverrideCandidate = useMemo(() => {
    if (
      practiceState.positionIndex !== undefined &&
      practiceState.currentFen &&
      practiceState.playedMove &&
      practiceState.playedMoveUci
    ) {
      return {
        positionIndex: practiceState.positionIndex,
        fen: practiceState.currentFen,
        san: practiceState.playedMove,
        uci: practiceState.playedMoveUci,
      };
    }

    if (!boardMoveCandidate) return null;
    const positionIndex = deck.positions.findIndex(
      (position) => position.fen === boardMoveCandidate.fen,
    );
    if (positionIndex === -1) return null;

    return {
      positionIndex,
      ...boardMoveCandidate,
    };
  }, [
    boardMoveCandidate,
    deck.positions,
    practiceState.currentFen,
    practiceState.playedMove,
    practiceState.playedMoveUci,
    practiceState.positionIndex,
  ]);
  const playedOverridePosition =
    playedOverrideCandidate && deck.positions[playedOverrideCandidate.positionIndex]
      ? deck.positions[playedOverrideCandidate.positionIndex]
      : null;
  const canOverridePlayedMove =
    playedOverrideCandidate &&
    playedOverridePosition &&
    playedOverridePosition.answerUci !== playedOverrideCandidate.uci &&
    playedOverridePosition.answer !== playedOverrideCandidate.san;
  const attemptPosition =
    (practiceState.phase === "correct" || practiceState.phase === "incorrect") &&
    practiceState.positionIndex !== undefined
      ? (deck.positions[practiceState.positionIndex] ?? null)
      : null;
  const attemptPlayedMove = practiceState.playedMove ?? null;

  const updateCorrectMove = useCallback(
    (positionIndex: number, move: { san: string; uci: string }) => {
      setDeck((current) => {
        const position = current.positions[positionIndex];
        if (!position) return current;
        const sameMove =
          (position.answerUci && position.answerUci === move.uci) ||
          (!position.answerUci && position.answer === move.san);
        const positions = [...current.positions];
        positions[positionIndex] = {
          ...position,
          answer: move.san,
          answerUci: move.uci,
          reviewKey: `${position.fen}|${move.uci || move.san}`,
          card: sameMove ? position.card : createEmptyCard(),
        };
        return {
          ...current,
          positions,
        };
      });

      if (practiceState.phase === "incorrect" && practiceState.positionIndex === positionIndex) {
        setSessionStats((current) => ({
          ...current,
          incorrect: Math.max(0, current.incorrect - 1),
        }));
        setPracticeState((current) => ({
          ...current,
          phase: "correct",
          answer: move.san,
          playedMove: move.san,
          playedMoveUci: move.uci,
        }));
      }

      onClearBoardMoveCandidate();
      notifications.show({
        title: "Correct move updated",
        message: `${move.san} is now the move trained for this position.`,
        color: "green",
      });
    },
    [
      onClearBoardMoveCandidate,
      practiceState.phase,
      practiceState.positionIndex,
      setDeck,
      setPracticeState,
      setSessionStats,
    ],
  );

  const stopPractice = useCallback(() => {
    setPracticeState({ phase: "idle" });
    setPracticePath(null);
    setInvisible(false);
    setShowComments(true);
    setEvalOpen(true);
    onClearBoardMoveCandidate();
  }, [
    onClearBoardMoveCandidate,
    setEvalOpen,
    setInvisible,
    setPracticePath,
    setPracticeState,
    setShowComments,
  ]);

  const newPractice = useCallback(
    (nextStats?: Partial<typeof sessionStats>) => {
      if (deck.positions.length === 0) return;

      const mode = nextStats?.mode ?? sessionStats.mode;
      const remaining = nextStats?.remainingPositions ?? sessionStats.remainingPositions;
      const position =
        mode === "full"
          ? remaining.length > 0
            ? deck.positions[remaining[0]]
            : null
          : getCardForReview(deck.positions);

      if (!position) {
        stopPractice();
        return;
      }
      onClearBoardMoveCandidate();

      const path = loadReviewPositionOnBoard({
        position,
        headers,
        root,
        store,
        goToMove,
        setHeaders,
        setState,
      });
      setPracticePath(path);
      setInvisible(hideMovesDuringPractice);
      setShowComments(false);
      setEvalOpen(false);
      setCardStartTime(Date.now());
      setPracticeState({ phase: "waiting", currentFen: position.fen });
    },
    [
      deck.positions,
      goToMove,
      headers,
      root,
      sessionStats.mode,
      sessionStats.remainingPositions,
      setCardStartTime,
      setEvalOpen,
      setHeaders,
      setInvisible,
      setPracticePath,
      setPracticeState,
      setState,
      setShowComments,
      store,
      onClearBoardMoveCandidate,
      stopPractice,
      hideMovesDuringPractice,
    ],
  );

  function startDuePractice() {
    const nextStats = {
      mode: "anki" as const,
      remainingPositions: [],
      correct: 0,
      incorrect: 0,
      streak: 0,
      bestStreak: 0,
    };
    setSessionStats((current) => ({ ...current, ...nextStats }));
    newPractice(nextStats);
  }

  function startFullPractice() {
    const nextStats = {
      mode: "full" as const,
      remainingPositions: deck.positions.map((_, index) => index),
      correct: 0,
      incorrect: 0,
      streak: 0,
      bestStreak: 0,
    };
    setSessionStats((current) => ({ ...current, ...nextStats }));
    newPractice(nextStats);
  }

  function handleQualityRating(grade: 1 | 2 | 3 | 4) {
    if (practiceState.phase !== "correct" || practiceState.positionIndex === undefined) return;

    const positionIndex = practiceState.positionIndex;
    updateCardPerformance(setDeck, positionIndex, deck.positions[positionIndex].card, grade);
    setSessionStats((current) => ({
      ...current,
      correct: current.correct + 1,
      streak: current.streak + 1,
      bestStreak: Math.max(current.bestStreak, current.streak + 1),
    }));
    newPractice();
  }

  function skipCard() {
    if (sessionStats.mode === "full" && sessionStats.remainingPositions.length > 0) {
      const remainingPositions = sessionStats.remainingPositions.slice(1);
      setSessionStats((current) => ({ ...current, remainingPositions }));
      newPractice({ remainingPositions, mode: "full" });
      return;
    }
    newPractice();
  }

  const advanceFullPracticeCorrect = useCallback(() => {
    const remainingPositions = sessionStats.remainingPositions.slice(1);
    setSessionStats((current) => ({
      ...current,
      remainingPositions,
      correct: current.correct + 1,
      streak: current.streak + 1,
      bestStreak: Math.max(current.bestStreak, current.streak + 1),
    }));
    newPractice({ remainingPositions, mode: "full" });
  }, [newPractice, sessionStats.remainingPositions, setSessionStats]);

  useEffect(() => {
    if (practiceState.phase !== "correct") return undefined;

    if (sessionStats.mode === "full") {
      return undefined;
    }

    if (practiceAutoDifficulty !== "none" && practiceState.positionIndex !== undefined) {
      const positionIndex = practiceState.positionIndex;
      const timer = window.setTimeout(() => {
        updateCardPerformance(
          setDeck,
          positionIndex,
          deck.positions[positionIndex].card,
          Number(practiceAutoDifficulty) as 1 | 2 | 3 | 4,
        );
        setSessionStats((current) => ({
          ...current,
          correct: current.correct + 1,
          streak: current.streak + 1,
          bestStreak: Math.max(current.bestStreak, current.streak + 1),
        }));
        newPractice();
      }, 300);
      return () => window.clearTimeout(timer);
    }

    return undefined;
  }, [
    deck.positions,
    newPractice,
    practiceAutoDifficulty,
    practiceState.phase,
    practiceState.positionIndex,
    sessionStats.mode,
    sessionStats.remainingPositions,
    setDeck,
    setSessionStats,
  ]);

  useHotkeys("1", () => handleQualityRating(1), { enabled: practiceState.phase === "correct" });
  useHotkeys("2", () => handleQualityRating(2), { enabled: practiceState.phase === "correct" });
  useHotkeys("3", () => handleQualityRating(3), { enabled: practiceState.phase === "correct" });
  useHotkeys("4", () => handleQualityRating(4), { enabled: practiceState.phase === "correct" });
  useHotkeys("space", () => skipCard(), { enabled: practiceState.phase === "incorrect" });
  useHotkeys("space", () => advanceFullPracticeCorrect(), {
    enabled: practiceState.phase === "correct" && sessionStats.mode === "full",
  });

  useEffect(() => {
    if (practiceState.phase === "correct" || practiceState.phase === "incorrect") {
      setInvisible(false);
      setShowComments(true);
    }
  }, [practiceState.phase, setInvisible, setShowComments]);

  if (!loaded) {
    return <Alert color="blue">Loading review deck...</Alert>;
  }

  if (loadError) {
    return (
      <Alert color="red" title="Could not open review deck">
        {loadError}
      </Alert>
    );
  }

  const panelModeControl = (
    <Group justify="space-between" align="center" wrap="nowrap">
      <SegmentedControl
        value={panelView}
        onChange={(value) => setPanelView(value as OpeningReviewPanelView)}
        data={[
          { value: "review", label: "Review positions" },
          { value: "analyze", label: "Analyze repertoire" },
        ]}
      />
      <Text size="xs" c="dimmed">
        Analyze lines, save what matters, then train them here.
      </Text>
    </Group>
  );

  if (panelView === "analyze") {
    return (
      <Stack h="100%" gap="sm">
        {panelModeControl}
        <RepertoireGapsPanel />
      </Stack>
    );
  }

  return (
    <>
      <Stack h="100%" gap="sm">
        {panelModeControl}
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Text fw={700}>{deckName}</Text>
            <Text size="xs" c="dimmed">
              {deck.positions.length} saved position{deck.positions.length === 1 ? "" : "s"}
            </Text>
          </Stack>
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconEye size={14} />}
            onClick={() => setPositionsOpen(true)}
          >
            Positions
          </Button>
        </Group>

        <Stack gap={4}>
          <Group justify="space-between">
            <Text size="xs" fw={600}>
              Review progress
            </Text>
            <Text size="xs" c="dimmed">
              {stats.total > 0 ? Math.round((stats.practiced / stats.total) * 100) : 0}%
            </Text>
          </Group>
          <Progress.Root size="sm">
            <Progress.Section
              value={stats.total ? (stats.practiced / stats.total) * 100 : 0}
              color="blue"
            />
            <Progress.Section
              value={stats.total ? (stats.due / stats.total) * 100 : 0}
              color="yellow"
            />
            <Progress.Section
              value={stats.total ? (stats.unseen / stats.total) * 100 : 0}
              color="gray"
            />
          </Progress.Root>
        </Stack>

        <SimpleGrid cols={3} spacing="xs">
          <ReviewStat label="Due" value={stats.due} color="yellow" />
          <ReviewStat label="Unseen" value={stats.unseen} color="gray" />
          <ReviewStat label="Done" value={stats.practiced} color="blue" />
        </SimpleGrid>

        {practiceState.phase === "idle" && (
          <Stack gap="xs">
            {stats.due === 0 && stats.unseen === 0 ? (
              <Paper p="sm" withBorder>
                <Stack gap="xs" align="center">
                  <ThemeIcon size="xl" radius="xl" color="green" variant="light">
                    <IconCheck size={24} />
                  </ThemeIcon>
                  <Text ta="center" fw={600}>
                    Everything due is done
                  </Text>
                  {stats.nextDue && (
                    <Text ta="center" size="sm" c="dimmed">
                      Next review {dayjs(stats.nextDue).format("MMM D, HH:mm")}
                    </Text>
                  )}
                </Stack>
              </Paper>
            ) : (
              <Button
                fullWidth
                variant="light"
                leftSection={<IconTarget size={18} />}
                onClick={startDuePractice}
                justify="space-between"
                rightSection={<Badge variant="white">{stats.due + stats.unseen}</Badge>}
              >
                Train due positions
              </Button>
            )}
            <Button
              fullWidth
              variant="light"
              color="gray"
              leftSection={<IconBook size={18} />}
              onClick={startFullPractice}
              justify="space-between"
              rightSection={<Badge variant="white">{deck.positions.length}</Badge>}
            >
              Train all positions
            </Button>
          </Stack>
        )}

        {practiceState.phase === "waiting" && (
          <Paper p="sm" withBorder>
            {practiceState.currentFen && currentFen !== practiceState.currentFen ? (
              <Stack gap="xs" align="center">
                <Text ta="center" size="sm" c="dimmed">
                  Return to the review position before moving.
                </Text>
                <Button
                  variant="light"
                  size="xs"
                  leftSection={<IconArrowBack size={14} />}
                  onClick={() => {
                    if (!practiceState.currentFen) return;
                    const position = deck.positions.find(
                      (deckPosition) => deckPosition.fen === practiceState.currentFen,
                    );
                    if (position) {
                      const path = loadReviewPositionOnBoard({
                        position,
                        headers,
                        root,
                        store,
                        goToMove,
                        setHeaders,
                        setState,
                      });
                      setPracticePath(path);
                    } else if (
                      findFen(practiceState.currentFen, root).length === 0 &&
                      !sameReviewPosition(root.fen, practiceState.currentFen)
                    ) {
                      setHeaders({ ...headers, fen: practiceState.currentFen, result: "*" });
                      setPracticePath([]);
                    } else {
                      const path = findFen(practiceState.currentFen, root);
                      goToMove(path);
                      setPracticePath(path);
                    }
                    setInvisible(hideMovesDuringPractice);
                  }}
                >
                  Go back
                </Button>
              </Stack>
            ) : (
              <Group justify="center" gap="xs">
                <Text size="sm" c="dimmed">
                  Play the move you want to remember.
                </Text>
                <Button size="compact-xs" variant="light" color="red" onClick={stopPractice}>
                  Stop
                </Button>
              </Group>
            )}
          </Paper>
        )}

        {practiceState.phase === "correct" && sessionStats.mode !== "full" && (
          <ReviewQualityPanel
            onRate={handleQualityRating}
            card={
              practiceState.positionIndex !== undefined
                ? deck.positions[practiceState.positionIndex].card
                : undefined
            }
            timeTaken={practiceState.timeTaken}
          />
        )}

        {practiceState.phase === "correct" && sessionStats.mode === "full" && (
          <Paper p="sm" withBorder>
            <Stack gap="xs" align="center">
              <Group gap="xs">
                <ThemeIcon size="md" color="green" variant="light" radius="xl">
                  <IconCheck size={16} />
                </ThemeIcon>
                <Text fw={600} c="green">
                  Correct
                </Text>
              </Group>
              <Button variant="light" size="sm" onClick={advanceFullPracticeCorrect}>
                Next position
              </Button>
            </Stack>
          </Paper>
        )}

        {practiceState.phase === "incorrect" && (
          <Paper p="sm" withBorder>
            <Stack gap="xs" align="center">
              <Group gap="xs">
                <ThemeIcon size="md" color="red" variant="light" radius="xl">
                  <IconX size={16} />
                </ThemeIcon>
                <Text fw={600} c="red">
                  Incorrect
                </Text>
              </Group>
              <Text size="sm" c="dimmed">
                Correct move: {practiceState.answer}
              </Text>
              {practiceState.playedMove && (
                <Text size="sm" c="dimmed">
                  You played: {practiceState.playedMove}
                </Text>
              )}
              <Button variant="light" size="sm" onClick={skipCard}>
                Next position
              </Button>
            </Stack>
          </Paper>
        )}

        {canOverridePlayedMove && playedOverrideCandidate && (
          <Paper p="sm" withBorder>
            <Group justify="space-between" gap="sm" align="center">
              <Stack gap={2}>
                <Text size="sm" fw={700}>
                  Make {playedOverrideCandidate.san} the correct move?
                </Text>
                <Text size="xs" c="dimmed">
                  This replaces the saved answer for this review card.
                </Text>
              </Stack>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPencil size={14} />}
                onClick={() =>
                  updateCorrectMove(playedOverrideCandidate.positionIndex, {
                    san: playedOverrideCandidate.san,
                    uci: playedOverrideCandidate.uci,
                  })
                }
              >
                Use my move
              </Button>
            </Group>
          </Paper>
        )}

        {attemptPosition && (
          <OpeningReviewAttemptDetails
            position={attemptPosition}
            deckMode={deckMode}
            playedMove={attemptPlayedMove}
          />
        )}

        <Group gap="xs">
          <SessionBadge label="Correct" value={sessionStats.correct} color="green" />
          <SessionBadge label="Incorrect" value={sessionStats.incorrect} color="red" />
          <SessionBadge label="Streak" value={sessionStats.streak} color="orange" />
        </Group>
      </Stack>

      <OpeningReviewPositionsModal
        opened={positionsOpen}
        onClose={() => setPositionsOpen(false)}
        deckPath={deckPath}
      />
    </>
  );
}

function ReviewStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Paper p="xs" withBorder radius="sm">
      <Text size="xs" c="dimmed" fw={600}>
        {label}
      </Text>
      <Text size="lg" fw={700} c={color}>
        {value}
      </Text>
    </Paper>
  );
}

function SessionBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Badge color={color} variant="light">
      {label} {value}
    </Badge>
  );
}

function OpeningReviewAttemptDetails({
  position,
  deckMode,
  playedMove,
}: {
  position: Position;
  deckMode?: "self" | "opponent";
  playedMove: string | null;
}) {
  const health = position.openingHealth;
  const mode = health?.mode ?? deckMode ?? "self";
  const side = health?.sideToMove ?? position.sideToMove ?? "white";
  const ownerLabel = mode === "opponent" ? "Opponent games" : "My games";
  const usualMoveLabel = mode === "opponent" ? "They usually played" : "I usually played";
  const strongHasBreakdown =
    health?.strongWhite !== null &&
    health?.strongWhite !== undefined &&
    health?.strongDraw !== null &&
    health?.strongDraw !== undefined &&
    health?.strongBlack !== null &&
    health?.strongBlack !== undefined;

  return (
    <Paper p="sm" withBorder>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Text size="sm" fw={700}>
              Position evidence
            </Text>
            <Text size="xs" c="dimmed">
              {position.moveSequence || "Starting position"}
            </Text>
          </Stack>
          <Badge variant="light">{side === "white" ? "White to move" : "Black to move"}</Badge>
        </Group>

        <SimpleGrid cols={3} spacing="xs">
          <ReviewDetail label="You played" value={playedMove || "-"} />
          <ReviewDetail label="Correct move" value={position.answer} />
          <ReviewDetail label={usualMoveLabel} value={health?.usualMoveSan ?? "-"} />
        </SimpleGrid>

        {health ? (
          <>
            <OpeningReviewResultBars
              label={`${ownerLabel} (${formatReviewNumber(health.games ?? 0)} games)`}
              white={health.white ?? 0}
              draw={health.draw ?? 0}
              black={health.black ?? 0}
              score={health.score}
              side={side}
            />
            {strongHasBreakdown ? (
              <OpeningReviewResultBars
                label={`Strong games (${formatReviewNumber(health.strongGames ?? 0)} games)`}
                white={health.strongWhite ?? 0}
                draw={health.strongDraw ?? 0}
                black={health.strongBlack ?? 0}
                score={health.strongScore}
                side={side}
              />
            ) : (
              <Text size="xs" c="dimmed">
                Strong games:{" "}
                {health.strongScore === null || health.strongScore === undefined
                  ? "-"
                  : formatReviewPercent(health.strongScore)}
                {health.strongGames
                  ? ` across ${formatReviewNumber(health.strongGames)} games`
                  : ""}
              </Text>
            )}
            <SimpleGrid cols={2} spacing="xs">
              <ReviewDetail label="Most common strong move" value={health.topMoveSan ?? "-"} />
              <ReviewDetail label="Last seen" value={health.lastPlayed ?? "Unknown"} />
            </SimpleGrid>
            {position.engine && (
              <ReviewDetail
                label="Validation"
                value={`${reviewEngineSourceLabel(position.engine.source)}${position.engine.depth ? ` depth ${position.engine.depth}` : ""}${
                  position.engine.lossCp !== undefined
                    ? `, ${Math.round(position.engine.lossCp)} cp drop`
                    : ""
                }`}
              />
            )}
          </>
        ) : (
          <Text size="sm" c="dimmed">
            {position.reason ||
              position.evidence ||
              "No Analyze Repertoire evidence was saved for this card."}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

function ReviewDetail({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={1}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={700}>
        {value}
      </Text>
    </Stack>
  );
}

function OpeningReviewResultBars({
  label,
  white,
  draw,
  black,
  score,
  side,
}: {
  label: string;
  white: number;
  draw: number;
  black: number;
  score?: number | null;
  side: "white" | "black";
}) {
  const total = white + draw + black;
  const whitePercent = total > 0 ? (white / total) * 100 : 0;
  const drawPercent = total > 0 ? (draw / total) * 100 : 0;
  const blackPercent = total > 0 ? (black / total) * 100 : 0;
  const scoreLabel =
    score === null || score === undefined
      ? "-"
      : `${side === "white" ? "White" : "Black"} score ${formatReviewPercent(score)}`;

  return (
    <Stack gap={3}>
      <Group justify="space-between" gap="xs">
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        <Text size="xs" fw={700}>
          {scoreLabel}
        </Text>
      </Group>
      <Tooltip
        withArrow
        label={`White ${whitePercent.toFixed(1)}% / Draw ${drawPercent.toFixed(
          1,
        )}% / Black ${blackPercent.toFixed(1)}%`}
      >
        <Progress.Root size="lg">
          <Progress.Section value={whitePercent} color="gray.2">
            <Progress.Label c="black">
              {whitePercent > 18 ? `${whitePercent.toFixed(0)}%` : ""}
            </Progress.Label>
          </Progress.Section>
          <Progress.Section value={drawPercent} color="gray">
            <Progress.Label>{drawPercent > 18 ? `${drawPercent.toFixed(0)}%` : ""}</Progress.Label>
          </Progress.Section>
          <Progress.Section value={blackPercent} color="dark">
            <Progress.Label>
              {blackPercent > 18 ? `${blackPercent.toFixed(0)}%` : ""}
            </Progress.Label>
          </Progress.Section>
        </Progress.Root>
      </Tooltip>
    </Stack>
  );
}

function formatReviewPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatReviewNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function reviewEngineSourceLabel(source: NonNullable<Position["engine"]>["source"] | undefined) {
  switch (source) {
    case "lichess":
      return "Lichess Cloud";
    case "chessdb":
    case "cloud":
      return "ChessDB";
    case "local":
      return "Stockfish";
    default:
      return "Engine";
  }
}

function ReviewQualityPanel({
  onRate,
  card,
  timeTaken,
}: {
  onRate: (grade: 1 | 2 | 3 | 4) => void;
  card?: import("ts-fsrs").Card;
  timeTaken?: number;
}) {
  const reviewTimes = card ? getNextReviewTimes(card) : null;

  return (
    <Paper p="sm" withBorder>
      <Stack gap="sm" align="center">
        <Group gap="xs">
          <ThemeIcon size="md" color="green" variant="light" radius="xl">
            <IconCheck size={16} />
          </ThemeIcon>
          <Text fw={600} c="green">
            Correct
          </Text>
          {timeTaken !== undefined && (
            <Text size="xs" c="dimmed">
              ({(timeTaken / 1000).toFixed(1)}s)
            </Text>
          )}
        </Group>
        <SimpleGrid cols={4} spacing="xs" w="100%">
          {[
            { grade: 1 as const, label: "Again", color: "red" },
            { grade: 2 as const, label: "Hard", color: "orange" },
            { grade: 3 as const, label: "Good", color: "blue" },
            { grade: 4 as const, label: "Easy", color: "green" },
          ].map((item) => (
            <Button
              key={item.grade}
              color={item.color}
              variant="light"
              size="compact-md"
              onClick={() => onRate(item.grade)}
              style={{ height: "auto", padding: "4px 0" }}
            >
              <Stack gap={0} align="center">
                <Text size="xs" fw={600}>
                  {item.label}
                </Text>
                <Text size="xs" c="dimmed">
                  {reviewTimes ? formatReviewInterval(reviewTimes[item.grade]) : ""}
                </Text>
              </Stack>
            </Button>
          ))}
        </SimpleGrid>
        <Text size="xs" c="dimmed">
          Use 1-4 to rate difficulty.
        </Text>
      </Stack>
    </Paper>
  );
}

function OpeningReviewPositionsModal({
  opened,
  onClose,
  deckPath,
}: {
  opened: boolean;
  onClose: () => void;
  deckPath: string;
}) {
  const [deck, setDeck] = useAtom(deckAtomFamily({ file: deckPath, game: 0 }));
  const store = useContext(TreeStateContext)!;
  const goToMove = useStore(store, (s) => s.goToMove);
  const setHeaders = useStore(store, (s) => s.setHeaders);
  const setPracticePath = useStore(store, (s) => s.setPracticePath);
  const setState = useStore(store, (s) => s.setState);
  const headers = useStore(store, (s) => s.headers);
  const root = useStore(store, (s) => s.root);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [moveInput, setMoveInput] = useState("");
  const editingPosition = useMemo(
    () => (editingIndex === null ? null : (deck.positions[editingIndex] ?? null)),
    [deck.positions, editingIndex],
  );

  useEffect(() => {
    setMoveInput(editingPosition?.answer ?? "");
  }, [editingPosition]);

  const loadReviewPosition = useCallback(
    (position: Position) => {
      loadReviewPositionOnBoard({
        position,
        headers,
        root,
        store,
        goToMove,
        setHeaders,
        setState,
      });
      setPracticePath(null);
      onClose();
    },
    [goToMove, headers, onClose, root, setHeaders, setPracticePath, setState, store],
  );

  const deleteReviewPosition = useCallback(
    (index: number) => {
      const position = deck.positions[index];
      setDeck((current) => ({
        ...current,
        positions: current.positions.filter((_, positionIndex) => positionIndex !== index),
      }));
      notifications.show({
        title: "Position removed",
        message: position ? `${position.answer} was removed from this review deck.` : undefined,
        color: "blue",
      });
      if (editingIndex === index) {
        setEditingIndex(null);
      }
    },
    [deck.positions, editingIndex, setDeck],
  );

  const saveEditedMove = useCallback(() => {
    if (editingIndex === null || !editingPosition) return;
    const parsed = parseReviewCorrectMove(editingPosition, moveInput);
    if (!parsed) {
      notifications.show({
        title: "Move not recognised",
        message: "Type a legal move from this position, for example Nf3 or g1f3.",
        color: "red",
      });
      return;
    }

    setDeck((current) => {
      const position = current.positions[editingIndex];
      if (!position) return current;
      const sameMove =
        (position.answerUci && position.answerUci === parsed.uci) ||
        (!position.answerUci && position.answer === parsed.san);
      const positions = [...current.positions];
      positions[editingIndex] = {
        ...position,
        answer: parsed.san,
        answerUci: parsed.uci,
        reviewKey: `${position.fen}|${parsed.uci || parsed.san}`,
        card: sameMove ? position.card : createEmptyCard(),
      };
      return {
        ...current,
        positions,
      };
    });
    setEditingIndex(null);
    notifications.show({
      title: "Correct move updated",
      message: `${parsed.san} is now the move trained for this position.`,
      color: "green",
    });
  }, [editingIndex, editingPosition, moveInput, setDeck]);

  return (
    <Modal opened={opened} onClose={onClose} title={<b>Review positions</b>} size="xl">
      <ScrollArea.Autosize mah={520}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Correct move</Table.Th>
              <Table.Th>Why</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {deck.positions.map((position, index) => {
              const due = new Date(position.card.due);
              const status =
                position.card.reps === 0 ? "Unseen" : due <= new Date() ? "Due" : "Scheduled";
              return (
                <Table.Tr key={`${position.reviewKey ?? position.fen}-${index}`}>
                  <Table.Td>
                    <Stack gap={0}>
                      <Text fw={700}>{position.answer}</Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {position.moveSequence || "Starting position"}
                      </Text>
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" lineClamp={2}>
                      {position.reason || position.evidence || "Saved from Analyze Repertoire"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Stack gap={2}>
                      <Badge variant="light">{status}</Badge>
                      <Text size="xs" c="dimmed">
                        Due {formatDate(due)}
                      </Text>
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Tooltip label="Load on board">
                        <ActionIcon
                          aria-label="Load position on board"
                          size="sm"
                          variant="subtle"
                          onClick={() => loadReviewPosition(position)}
                        >
                          <IconTarget size="1rem" />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Edit correct move">
                        <ActionIcon
                          aria-label="Edit correct move"
                          size="sm"
                          variant="subtle"
                          onClick={() => setEditingIndex(index)}
                        >
                          <IconPencil size="1rem" />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Delete from deck">
                        <ActionIcon
                          aria-label="Delete from deck"
                          size="sm"
                          variant="subtle"
                          color="red"
                          onClick={() => deleteReviewPosition(index)}
                        >
                          <IconTrash size="1rem" />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea.Autosize>
      <Group gap={4} mt="sm">
        <IconInfoCircle size={14} />
        <Text size="xs" c="dimmed">
          Deck progress, notes, arrows, and move edits are saved back to the review file
          automatically.
        </Text>
      </Group>

      <Modal
        opened={editingIndex !== null}
        onClose={() => setEditingIndex(null)}
        title={<b>Edit correct move</b>}
        size="sm"
        centered
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Type the move you want this card to train from the saved position.
          </Text>
          <TextInput
            label="Correct move"
            value={moveInput}
            onChange={(event) => setMoveInput(event.currentTarget.value)}
            placeholder="Nf3"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                saveEditedMove();
              }
            }}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setEditingIndex(null)}>
              Cancel
            </Button>
            <Button onClick={saveEditedMove} disabled={!moveInput.trim()}>
              Save move
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Modal>
  );
}
