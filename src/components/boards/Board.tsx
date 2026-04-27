import type { DrawBrushes, DrawShape } from "@lichess-org/chessground/draw";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Divider,
  Group,
  NumberInput,
  Paper,
  Popover,
  Stack,
  Switch,
  Text,
  ThemeIcon,
  useMantineTheme,
} from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconArrowBackUp,
  IconChevronRight,
  IconEye,
  IconPlayerPlay,
  IconRotate,
  IconSettings,
} from "@tabler/icons-react";
import {
  makeSquare,
  makeUci,
  type NormalMove,
  type Piece,
  parseSquare,
  parseUci,
  type SquareName,
} from "chessops";
import { chessgroundDests, chessgroundMove } from "chessops/compat";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { useAtom, useAtomValue } from "jotai";
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useTranslation } from "react-i18next";
import { match } from "ts-pattern";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { commands } from "@/bindings";
import { Chessground, type ChessgroundRef } from "@/chessground/Chessground";
import {
  boardManualSizeAtom,
  autoPromoteAtom,
  bestMovesFamily,
  currentBoardPreviewShapesAtom,
  currentEnginePlanExplorerDataAtom,
  currentEvalOpenAtom,
  currentPlanExplorerDataAtom,
  currentPlanExplorerPreviewLineAtom,
  currentShowCommentsAtom,
  currentTabAtom,
  currentTabSelectedAtom,
  deckAtomFamily,
  enableAllAtom,
  enableBoardScrollAtom,
  eraseDrawablesOnClickAtom,
  forcedEnPassantAtom,
  materialDisplayAtom,
  mistakeReviewAutoRevealBestAtom,
  mistakeReviewAutoPlayLineAtom,
  mistakeReviewEngineOffOnNavigationAtom,
  mistakeReviewEngineOnRevealAtom,
  mistakeReviewRevealDelayAtom,
  mistakeReviewSampleLinePliesAtom,
  mistakeReviewSampleLineSpeedAtom,
  moveHighlightAtom,
  moveInputAtom,
  planExplorerArrowLimitAtom,
  planExplorerHoverEverywhereAtom,
  practiceCardStartTimeAtom,
  practiceSessionStatsAtom,
  practiceStateAtom,
  showArrowsAtom,
  showConsecutiveArrowsAtom,
  showCoordinatesAtom,
  showDestsAtom,
  showPlanExplorerArrowsAtom,
  showVariationArrowsAtom,
  snapArrowsAtom,
} from "@/state/atoms";
import { keyMapAtom } from "@/state/keybinds";
import classes from "@/styles/Chessboard.module.css";
import { ANNOTATION_INFO, isBasicAnnotation } from "@/utils/annotation";
import { getVariationLine } from "@/utils/chess";
import { chessopsError, forceEnPassant, positionFromFen } from "@/utils/chessops";
import { queryChessDbMoves } from "@/utils/chessdb/api";
import { mistakeReviewSeverityLabel, type MistakeReviewAttemptLabel } from "@/utils/mistakeReview";
import { assessMistakeReviewMoveWithEngine } from "@/utils/mistakeReviewPractice";
import {
  assessOpeningReviewMove,
  isOpeningReviewEngineMove,
  isOpeningReviewSavedMove,
} from "@/utils/openingReviewPractice";
import {
  getAutoPlanLines,
  getPlanLineForSquare,
  isPlanBrush,
  PLAN_BRUSH,
  PLAN_BLACK_BRUSH,
  PLAN_WHITE_BRUSH,
  planLineToShapes,
  planLinesToShapes,
} from "@/utils/planExplorer";
import { getTabGameNumber, getTabPracticeKey } from "@/utils/tabs";
import { findFen } from "@/utils/treeReducer";
import ShowMaterial from "../common/ShowMaterial";
import { TreeStateContext } from "../common/TreeStateContext";
import FideInfo from "../databases/FideInfo";
import { updateCardPerformance, type Position as ReviewPosition } from "../files/opening";
import { arrowColors } from "../panels/analysis/BestMoves";
import AnnotationHint from "./AnnotationHint";
import { BoardBar } from "./BoardBar";
import Clock from "./Clock";
import EvalBar from "./EvalBar";
import MoveInput from "./MoveInput";
import PromotionModal from "./PromotionModal";

const LARGE_BRUSH = 11;
const MEDIUM_BRUSH = 7.5;
const SMALL_BRUSH = 4;
const BAR_HEIGHT = "1.9rem";
const BOARD_SIDE_BAR_WIDTH = 25;
const BOARD_ROW_GAP = 12;
const MIN_MANUAL_BOARD_SIZE = 280;
const MISTAKE_REVIEW_PANEL_MIN_HEIGHT = 108;
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

type BoardResizeCorner = "nw" | "ne" | "sw" | "se";

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function squareFromPointer(
  event: MouseEvent,
  board: HTMLDivElement,
  orientation: "white" | "black",
): SquareName | null {
  const rect = board.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) {
    return null;
  }

  let fileIndex = Math.floor((x / rect.width) * 8);
  let rankIndex = Math.floor((y / rect.height) * 8);

  if (orientation === "black") {
    fileIndex = 7 - fileIndex;
    rankIndex = 7 - rankIndex;
  }

  return `${FILES[fileIndex]}${8 - rankIndex}` as SquareName;
}

function uciArrowShape(uci: string | undefined, brush: string): DrawShape | null {
  if (!uci) return null;
  const move = parseUci(uci);
  if (!move || !("from" in move) || !("to" in move)) return null;
  const from = makeSquare(move.from);
  const to = makeSquare(move.to);
  if (!from || !to) return null;

  return {
    orig: from,
    dest: to,
    brush,
    modifiers: {
      lineWidth: LARGE_BRUSH,
    },
  };
}

type MistakeReviewRevealState = {
  fen: string;
  mode: "best" | "mistake";
  moveUci?: string;
};

function sameBoardPosition(a: string | undefined, b: string | undefined) {
  if (!a || !b) return false;
  return a.split(" ").slice(0, 4).join(" ") === b.split(" ").slice(0, 4).join(" ");
}

function mistakeReviewColor(severity: MistakeReviewAttemptLabel | undefined) {
  switch (severity) {
    case "best":
      return "green";
    case "good":
      return "teal";
    case "okay":
      return "blue";
    case "inaccuracy":
      return "yellow";
    case "mistake":
      return "orange";
    case "blunder":
      return "red";
    default:
      return "gray";
  }
}

function buildMistakeReviewLine(firstMove: string | undefined, pv?: string[]) {
  if (!firstMove) return [];
  if (!pv || pv.length === 0) return [firstMove];
  if (pv[0] === firstMove) return pv;
  return [firstMove, ...pv];
}

interface ChessboardProps {
  editingMode: boolean;
  viewOnly?: boolean;
  disableVariations?: boolean;
  movable?: "both" | "white" | "black" | "turn" | "none";
  boardRef: React.MutableRefObject<HTMLDivElement | null>;
  whiteTime?: number;
  blackTime?: number;
  practicing?: boolean;
  selectedPiece?: Piece | null;
  onMove?: (uci: string, fen: string, san: string) => void;
  cgRef?: React.Ref<ChessgroundRef>;
  enablePremoves?: boolean;
}

function Board({
  editingMode,
  viewOnly,
  disableVariations,
  movable = "turn",
  boardRef,
  whiteTime,
  blackTime,
  practicing,
  selectedPiece,
  onMove,
  cgRef,
  enablePremoves = false,
}: ChessboardProps) {
  const { t } = useTranslation();

  const store = useContext(TreeStateContext)!;

  const root = useStore(store, (s) => s.root);
  const rootFen = useStore(store, (s) => s.root.fen);
  const moves = useStore(
    store,
    useShallow((s) => getVariationLine(s.root, s.position)),
  );
  const headers = useStore(store, (s) => s.headers);
  const currentNode = useStore(store, (s) => s.currentNode());

  const arrows = useAtomValue(
    bestMovesFamily({
      fen: rootFen,
      gameMoves: moves,
    }),
  );

  const goToNext = useStore(store, (s) => s.goToNext);
  const goToPrevious = useStore(store, (s) => s.goToPrevious);
  const goToMove = useStore(store, (s) => s.goToMove);
  const storeMakeMove = useStore(store, (s) => s.makeMove);
  const setPracticePath = useStore(store, (s) => s.setPracticePath);
  const setHeaders = useStore(store, (s) => s.setHeaders);
  const clearShapes = useStore(store, (s) => s.clearShapes);
  const setShapes = useStore(store, (s) => s.setShapes);
  const setFen = useStore(store, (s) => s.setFen);

  const [pos, error] = positionFromFen(currentNode.fen);
  const [whiteFideOpen, setWhiteFideOpen] = useState(false);
  const [blackFideOpen, setBlackFideOpen] = useState(false);

  const moveInput = useAtomValue(moveInputAtom);
  const showDests = useAtomValue(showDestsAtom);
  const moveHighlight = useAtomValue(moveHighlightAtom);
  const showArrows = useAtomValue(showArrowsAtom);
  const showVariationArrows = useAtomValue(showVariationArrowsAtom);
  const showConsecutiveArrows = useAtomValue(showConsecutiveArrowsAtom);
  const eraseDrawablesOnClick = useAtomValue(eraseDrawablesOnClickAtom);
  const autoPromote = useAtomValue(autoPromoteAtom);
  const forcedEP = useAtomValue(forcedEnPassantAtom);
  const showCoordinates = useAtomValue(showCoordinatesAtom);
  const materialDisplay = useAtomValue(materialDisplayAtom);
  const boardPreviewShapes = useAtomValue(currentBoardPreviewShapesAtom);
  const boardFen = boardPreviewShapes?.displayFen ?? currentNode.fen;
  const [boardPreviewPos] = boardPreviewShapes?.displayFen
    ? positionFromFen(boardPreviewShapes.displayFen)
    : [null];
  const planExplorerData = useAtomValue(currentPlanExplorerDataAtom);
  const enginePlanExplorerData = useAtomValue(currentEnginePlanExplorerDataAtom);
  const [planExplorerPreviewLine, setPlanExplorerPreviewLine] = useAtom(
    currentPlanExplorerPreviewLineAtom,
  );
  const showPlanExplorerArrows = useAtomValue(showPlanExplorerArrowsAtom);
  const planExplorerArrowLimit = useAtomValue(planExplorerArrowLimitAtom);
  const planExplorerHoverEverywhere = useAtomValue(planExplorerHoverEverywhereAtom);
  const currentTabSelected = useAtomValue(currentTabSelectedAtom);
  const hoveredPlanSquareRef = useRef<SquareName | null>(null);

  let dests: Map<SquareName, SquareName[]> = pos ? chessgroundDests(pos) : new Map();
  if (forcedEP && pos) {
    dests = forceEnPassant(dests, pos);
  }

  const [pendingMove, setPendingMove] = useState<NormalMove | null>(null);

  const turn = pos?.turn || "white";
  const orientation = headers.orientation || "white";
  const toggleOrientation = () =>
    setHeaders({
      ...headers,
      fen: root.fen,
      orientation: orientation === "black" ? "white" : "black",
    });

  const keyMap = useAtomValue(keyMapAtom);
  useHotkeys(keyMap.SWAP_ORIENTATION.keys, () => toggleOrientation());
  const currentTab = useAtomValue(currentTabAtom);
  const [evalOpen, setEvalOpen] = useAtom(currentEvalOpenAtom);

  const [deck, setDeck] = useAtom(
    deckAtomFamily({
      file: getTabPracticeKey(currentTab),
      game: getTabGameNumber(currentTab),
    }),
  );

  const [practiceState, setPracticeState] = useAtom(practiceStateAtom);
  const [sessionStats, setSessionStats] = useAtom(practiceSessionStatsAtom);
  const cardStartTime = useAtomValue(practiceCardStartTimeAtom);
  const [mistakeReviewAutoPlayLine, setMistakeReviewAutoPlayLine] = useAtom(
    mistakeReviewAutoPlayLineAtom,
  );
  const [mistakeReviewRevealDelay, setMistakeReviewRevealDelay] = useAtom(
    mistakeReviewRevealDelayAtom,
  );
  const [mistakeReviewAutoRevealBest, setMistakeReviewAutoRevealBest] = useAtom(
    mistakeReviewAutoRevealBestAtom,
  );
  const [mistakeReviewSampleLinePlies, setMistakeReviewSampleLinePlies] = useAtom(
    mistakeReviewSampleLinePliesAtom,
  );
  const [mistakeReviewSampleLineSpeed, setMistakeReviewSampleLineSpeed] = useAtom(
    mistakeReviewSampleLineSpeedAtom,
  );
  const [mistakeReviewEngineOnReveal, setMistakeReviewEngineOnReveal] = useAtom(
    mistakeReviewEngineOnRevealAtom,
  );
  const [mistakeReviewEngineOffOnNavigation, setMistakeReviewEngineOffOnNavigation] = useAtom(
    mistakeReviewEngineOffOnNavigationAtom,
  );
  const [, setAllEnginesEnabled] = useAtom(enableAllAtom);
  const [mistakeReviewRevealState, setMistakeReviewRevealState] =
    useState<MistakeReviewRevealState | null>(null);
  const [mistakeReviewLineBusy, setMistakeReviewLineBusy] = useState(false);
  const [mistakeReviewRevealRemaining, setMistakeReviewRevealRemaining] = useState(0);
  const [activeMistakeReviewPosition, setActiveMistakeReviewPosition] =
    useState<ReviewPosition | null>(null);
  const mistakeReviewLineTimers = useRef<number[]>([]);
  const autoRevealKeyRef = useRef<string | null>(null);
  const previousMistakeReviewIndexRef = useRef<number | null>(null);

  const clearMistakeReviewLine = useCallback(() => {
    for (const timer of mistakeReviewLineTimers.current) {
      window.clearTimeout(timer);
    }
    mistakeReviewLineTimers.current = [];
  }, []);

  useEffect(() => clearMistakeReviewLine, [clearMistakeReviewLine]);

  const isMistakeReviewTab = currentTab?.gameOrigin.kind === "mistake_review";
  const currentMistakeReviewIndex = useMemo(() => {
    if (!isMistakeReviewTab) return -1;
    if (practiceState.positionIndex !== undefined && deck.positions[practiceState.positionIndex]) {
      return practiceState.positionIndex;
    }
    if (practiceState.currentFen) {
      const index = deck.positions.findIndex((position) =>
        sameBoardPosition(position.fen, practiceState.currentFen),
      );
      if (index !== -1) return index;
    }
    return deck.positions.findIndex((position) => sameBoardPosition(position.fen, currentNode.fen));
  }, [
    currentNode.fen,
    deck.positions,
    isMistakeReviewTab,
    practiceState.currentFen,
    practiceState.positionIndex,
  ]);
  const currentMistakeReviewPosition =
    currentMistakeReviewIndex >= 0 ? deck.positions[currentMistakeReviewIndex] : null;
  useEffect(() => {
    if (!isMistakeReviewTab) {
      setActiveMistakeReviewPosition(null);
      previousMistakeReviewIndexRef.current = null;
      return;
    }

    if (currentMistakeReviewPosition?.mistakeReview) {
      setActiveMistakeReviewPosition(currentMistakeReviewPosition);
    }
  }, [currentMistakeReviewPosition, isMistakeReviewTab]);

  const trainerMistakeReviewPosition = currentMistakeReviewPosition?.mistakeReview
    ? currentMistakeReviewPosition
    : activeMistakeReviewPosition;
  const trainerMistakeReviewIndex = useMemo(() => {
    if (currentMistakeReviewPosition?.mistakeReview) return currentMistakeReviewIndex;
    if (!activeMistakeReviewPosition) return -1;
    return deck.positions.findIndex((position) =>
      sameBoardPosition(position.fen, activeMistakeReviewPosition.fen),
    );
  }, [
    activeMistakeReviewPosition,
    currentMistakeReviewIndex,
    currentMistakeReviewPosition,
    deck.positions,
  ]);

  const returnToMistakeReviewPosition = useCallback(
    (options: { clearReveal?: boolean; resetPractice?: boolean } = {}) => {
      if (!trainerMistakeReviewPosition) return false;
      clearMistakeReviewLine();
      setMistakeReviewLineBusy(false);
      if (options.clearReveal !== false) {
        setMistakeReviewRevealState(null);
      }

      const state = store.getState();
      const path = findFen(trainerMistakeReviewPosition.fen, state.root);
      if (
        path.length === 0 &&
        !sameBoardPosition(state.root.fen, trainerMistakeReviewPosition.fen)
      ) {
        setHeaders({
          ...state.headers,
          fen: trainerMistakeReviewPosition.fen,
          orientation:
            trainerMistakeReviewPosition.mistakeReview?.playerColor ??
            trainerMistakeReviewPosition.sideToMove ??
            state.headers.orientation ??
            "white",
          result: "*",
        });
        setPracticePath([]);
      } else {
        goToMove(path);
        setPracticePath(path);
      }

      if (practicing && options.resetPractice !== false) {
        setPracticeState({
          phase: "waiting",
          currentFen: trainerMistakeReviewPosition.fen,
          positionIndex: trainerMistakeReviewIndex,
        });
      }

      return true;
    },
    [
      clearMistakeReviewLine,
      goToMove,
      practicing,
      setHeaders,
      setPracticePath,
      setPracticeState,
      store,
      trainerMistakeReviewIndex,
      trainerMistakeReviewPosition,
    ],
  );

  const playMistakeReviewLine = useCallback(
    (line: string[]) => {
      clearMistakeReviewLine();
      if (!mistakeReviewAutoPlayLine) {
        setMistakeReviewLineBusy(false);
        return;
      }

      const maxPlies = Math.round(clampNumber(mistakeReviewSampleLinePlies, 0, 20));
      if (maxPlies === 0) {
        setMistakeReviewLineBusy(false);
        return;
      }

      const intervalMs = Math.round(clampNumber(mistakeReviewSampleLineSpeed, 200, 3000));
      const legalLine = line.filter((move) => parseUci(move)).slice(0, maxPlies);
      if (legalLine.length === 0) {
        setMistakeReviewLineBusy(false);
        return;
      }

      setMistakeReviewLineBusy(true);
      for (const [index, moveUci] of legalLine.entries()) {
        const timer = window.setTimeout(
          () => {
            const move = parseUci(moveUci);
            if (move) {
              store.getState().makeMove({ payload: move, changeHeaders: false });
            }
          },
          index === 0 ? 180 : 180 + index * intervalMs,
        );
        mistakeReviewLineTimers.current.push(timer);
      }
      const finishedTimer = window.setTimeout(
        () => setMistakeReviewLineBusy(false),
        180 + legalLine.length * intervalMs,
      );
      mistakeReviewLineTimers.current.push(finishedTimer);
    },
    [
      clearMistakeReviewLine,
      mistakeReviewAutoPlayLine,
      mistakeReviewSampleLinePlies,
      mistakeReviewSampleLineSpeed,
      store,
    ],
  );

  const resolveMistakeReviewSampleLine = useCallback(
    async (position: ReviewPosition, firstMoveUci: string, fallbackPv?: string[]) => {
      const maxPlies = Math.round(clampNumber(mistakeReviewSampleLinePlies, 0, 20));
      if (maxPlies === 0) return [];

      const metadata = position.mistakeReview;
      if (metadata?.enginePath) {
        try {
          const result = await commands.getMistakeReviewSampleLine({
            fen: position.fen,
            firstMoveUci,
            enginePath: metadata.enginePath,
            engineName: metadata.engineName ?? null,
            depth: 12,
            maxPlies,
          });

          if (result.status === "ok" && result.data.moves.length > 0) {
            return result.data.moves;
          }
        } catch {
          // Fall back to the stored PV if a live sample-line probe fails.
        }
      }

      return buildMistakeReviewLine(firstMoveUci, fallbackPv).slice(0, maxPlies);
    },
    [mistakeReviewSampleLinePlies],
  );

  const revealMistakeReviewBest = useCallback(async () => {
    if (mistakeReviewRevealRemaining > 0) return;
    const metadata = trainerMistakeReviewPosition?.mistakeReview;
    const bestMoveUci =
      metadata?.bestMoveUci ||
      trainerMistakeReviewPosition?.engine?.bestMoveUci ||
      trainerMistakeReviewPosition?.answerUci;
    if (!trainerMistakeReviewPosition || !bestMoveUci) return;
    if (!returnToMistakeReviewPosition({ clearReveal: false, resetPractice: false })) return;

    setMistakeReviewRevealState({
      fen: trainerMistakeReviewPosition.fen,
      mode: "best",
      moveUci: bestMoveUci,
    });
    if (mistakeReviewEngineOnReveal) {
      setAllEnginesEnabled(true);
    }
    setMistakeReviewLineBusy(true);
    const sampleLine = await resolveMistakeReviewSampleLine(
      trainerMistakeReviewPosition,
      bestMoveUci,
      metadata?.pvUci,
    );
    playMistakeReviewLine(sampleLine);
  }, [
    mistakeReviewEngineOnReveal,
    mistakeReviewRevealRemaining,
    playMistakeReviewLine,
    resolveMistakeReviewSampleLine,
    returnToMistakeReviewPosition,
    setAllEnginesEnabled,
    trainerMistakeReviewPosition,
  ]);

  const showMistakeReviewMove = useCallback(async () => {
    if (mistakeReviewRevealRemaining > 0) return;
    const metadata = trainerMistakeReviewPosition?.mistakeReview;
    const playedMoveUci = metadata?.playedMoveUci;
    if (!trainerMistakeReviewPosition || !playedMoveUci) return;
    if (!returnToMistakeReviewPosition({ clearReveal: false, resetPractice: false })) return;

    setMistakeReviewRevealState({
      fen: trainerMistakeReviewPosition.fen,
      mode: "mistake",
      moveUci: playedMoveUci,
    });
    if (mistakeReviewEngineOnReveal) {
      setAllEnginesEnabled(true);
    }
    setMistakeReviewLineBusy(true);
    const sampleLine = await resolveMistakeReviewSampleLine(
      trainerMistakeReviewPosition,
      playedMoveUci,
    );
    playMistakeReviewLine(sampleLine);
  }, [
    mistakeReviewEngineOnReveal,
    mistakeReviewRevealRemaining,
    playMistakeReviewLine,
    resolveMistakeReviewSampleLine,
    returnToMistakeReviewPosition,
    setAllEnginesEnabled,
    trainerMistakeReviewPosition,
  ]);

  const trainerMistakeReviewKey = trainerMistakeReviewPosition
    ? `${trainerMistakeReviewPosition.reviewKey ?? trainerMistakeReviewPosition.fen}|${
        trainerMistakeReviewPosition.mistakeReview?.playedMoveUci ?? ""
      }`
    : null;

  useEffect(() => {
    if (!isMistakeReviewTab || !trainerMistakeReviewKey) {
      setMistakeReviewRevealRemaining(0);
      return;
    }

    const delaySeconds = clampNumber(mistakeReviewRevealDelay, 0, 60);
    if (delaySeconds === 0) {
      setMistakeReviewRevealRemaining(0);
      return;
    }

    const revealAt = Date.now() + delaySeconds * 1000;
    const updateRemaining = () => {
      setMistakeReviewRevealRemaining(Math.max(0, Math.ceil((revealAt - Date.now()) / 1000)));
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 250);
    return () => window.clearInterval(timer);
  }, [isMistakeReviewTab, mistakeReviewRevealDelay, trainerMistakeReviewKey]);

  useEffect(() => {
    if (!isMistakeReviewTab) return;

    const currentIndex = trainerMistakeReviewIndex >= 0 ? trainerMistakeReviewIndex : null;
    if (!mistakeReviewEngineOffOnNavigation) {
      previousMistakeReviewIndexRef.current = currentIndex;
      return;
    }

    const previousIndex = previousMistakeReviewIndexRef.current;
    if (previousIndex !== null && currentIndex !== null && previousIndex !== currentIndex) {
      setAllEnginesEnabled(false);
    }
    previousMistakeReviewIndexRef.current = currentIndex;
  }, [
    isMistakeReviewTab,
    mistakeReviewEngineOffOnNavigation,
    setAllEnginesEnabled,
    trainerMistakeReviewIndex,
  ]);

  useEffect(() => {
    if (
      !mistakeReviewAutoRevealBest ||
      !isMistakeReviewTab ||
      !trainerMistakeReviewPosition ||
      mistakeReviewRevealRemaining > 0 ||
      (practiceState.phase !== "correct" && practiceState.phase !== "incorrect")
    ) {
      return;
    }

    const key = `${trainerMistakeReviewKey}|${practiceState.phase}|${
      practiceState.playedMoveUci ?? ""
    }`;
    if (autoRevealKeyRef.current === key) return;
    autoRevealKeyRef.current = key;
    void revealMistakeReviewBest();
  }, [
    isMistakeReviewTab,
    mistakeReviewAutoRevealBest,
    mistakeReviewRevealRemaining,
    practiceState.phase,
    practiceState.playedMoveUci,
    revealMistakeReviewBest,
    trainerMistakeReviewKey,
    trainerMistakeReviewPosition,
  ]);

  async function makeMove(move: NormalMove) {
    if (!pos) return;
    const san = makeSan(pos, move);
    const uci = makeUci(move);
    clearMistakeReviewLine();
    setMistakeReviewLineBusy(false);
    setMistakeReviewRevealState(null);
    if (practicing) {
      const c = deck.positions.find((c) => c.fen === currentNode.fen);
      if (!c) {
        return;
      }

      const i = deck.positions.indexOf(c);
      const timeTaken = Date.now() - cardStartTime;
      const isMistakeReview = currentTab?.gameOrigin.kind === "mistake_review";
      const isOpeningReview = currentTab?.gameOrigin.kind === "opening_review";
      const isEngineCorrect = isOpeningReview && isOpeningReviewEngineMove(c, { san, uci });
      const isCorrect = isOpeningReviewSavedMove(c, { san, uci }) || isEngineCorrect;
      onMove?.(uci, c.fen, san);

      if (!isCorrect) {
        storeMakeMove({
          payload: move,
        });
        setPendingMove(null);

        if (isMistakeReview) {
          const moveAssessment = await assessMistakeReviewMoveWithEngine(c, { san, uci });
          const feedbackTitle =
            moveAssessment.label.charAt(0).toUpperCase() + moveAssessment.label.slice(1);

          if (sessionStats.mode !== "full") {
            updateCardPerformance(setDeck, i, c.card, moveAssessment.passed ? 3 : 1);
          }
          setPracticeState({
            phase: moveAssessment.passed ? "correct" : "incorrect",
            currentFen: c.fen,
            answer: moveAssessment.bestMoveSan,
            playedMove: san,
            playedMoveUci: uci,
            moveAssessment:
              moveAssessment.label === "best"
                ? "best"
                : moveAssessment.label === "good"
                  ? "ok"
                  : "incorrect",
            mistakeReviewLabel: moveAssessment.label,
            bestMove: moveAssessment.bestMoveSan,
            bestMoveUci: moveAssessment.bestMoveUci,
            moveLossCp: moveAssessment.moveLossCp,
            winProbabilityDrop: moveAssessment.winProbabilityDrop,
            requestedDepth: moveAssessment.requestedDepth,
            reachedDepth: moveAssessment.reachedDepth,
            engineName: moveAssessment.engineName,
            positionIndex: i,
            timeTaken,
            resultRecorded: moveAssessment.passed,
          });
          setSessionStats((prev) => ({
            ...prev,
            correct: moveAssessment.passed ? prev.correct + 1 : prev.correct,
            incorrect: moveAssessment.passed ? prev.incorrect : prev.incorrect + 1,
            streak: moveAssessment.passed ? prev.streak + 1 : 0,
            bestStreak: moveAssessment.passed
              ? Math.max(prev.bestStreak, prev.streak + 1)
              : prev.bestStreak,
          }));
          notifications.show({
            title: feedbackTitle,
            message: `${moveAssessment.bestMoveSan} was the engine move to remember.`,
            color: moveAssessment.passed ? "green" : "red",
          });
          if (!moveAssessment.passed && !mistakeReviewAutoRevealBest) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            goToNext();
          }
          return;
        }

        const moveAssessment =
          currentTab?.gameOrigin.kind === "opening_review"
            ? assessOpeningReviewMove(
                c,
                { san, uci },
                await queryChessDbMoves(c.fen).catch(() => null),
              )
            : assessOpeningReviewMove(c, { san, uci }, null);
        const isBestAlternative = moveAssessment.quality === "best";
        const isOkAlternative = moveAssessment.quality === "ok";
        const isAcceptedAlternative = isBestAlternative || isOkAlternative;
        const bestMove = moveAssessment.bestMoveSan || c.answer;
        const bestSource =
          c.engine?.bestMoveUci === uci || c.engine?.bestMoveSan === san ? "Engine" : "ChessDB";

        setPracticeState({
          phase: isAcceptedAlternative ? "correct" : "incorrect",
          currentFen: c.fen,
          answer: bestMove,
          playedMove: san,
          playedMoveUci: uci,
          moveAssessment: isBestAlternative ? "best" : isOkAlternative ? "ok" : "incorrect",
          bestMove,
          bestMoveUci: moveAssessment.bestMoveUci,
          moveLossCp: moveAssessment.moveLossCp,
          chessDbRank: moveAssessment.chessDbRank,
          positionIndex: i,
          timeTaken,
        });
        if (isAcceptedAlternative) {
          notifications.show({
            title: isBestAlternative ? "Best move" : "OK move",
            message: isBestAlternative
              ? `${bestSource} has ${san} as best.`
              : `${san} is OK; ${bestMove} is best.`,
            color: isBestAlternative ? "green" : "blue",
          });
          return;
        }

        if (sessionStats.mode !== "full") {
          updateCardPerformance(setDeck, i, c.card, 1);
        }
        setSessionStats((prev) => ({
          ...prev,
          incorrect: prev.incorrect + 1,
          streak: 0,
        }));
        notifications.show({
          title: t("Common.Incorrect"),
          message: t("Board.Practice.CorrectMoveWas", { move: bestMove }),
          color: "red",
        });
      } else {
        storeMakeMove({
          payload: move,
        });
        setPendingMove(null);
        setPracticeState({
          phase: "correct",
          currentFen: c.fen,
          answer: c.answer,
          playedMove: san,
          playedMoveUci: uci,
          moveAssessment: isMistakeReview || isEngineCorrect ? "best" : undefined,
          mistakeReviewLabel: isMistakeReview ? "best" : undefined,
          bestMove: isMistakeReview
            ? c.mistakeReview?.bestMoveSan || c.answer
            : isEngineCorrect
              ? c.engine?.bestMoveSan || c.answer
              : undefined,
          bestMoveUci: isMistakeReview
            ? c.mistakeReview?.bestMoveUci || c.answerUci
            : isEngineCorrect
              ? c.engine?.bestMoveUci || c.answerUci
              : undefined,
          moveLossCp: isMistakeReview ? 0 : undefined,
          winProbabilityDrop: isMistakeReview ? 0 : undefined,
          requestedDepth: isMistakeReview ? c.mistakeReview?.requestedDepth : undefined,
          reachedDepth: isMistakeReview ? c.mistakeReview?.reachedDepth : undefined,
          engineName: isMistakeReview ? c.mistakeReview?.engineName : undefined,
          positionIndex: i,
          timeTaken,
          resultRecorded: isMistakeReview ? true : undefined,
        });
        if (isMistakeReview) {
          if (sessionStats.mode !== "full") {
            updateCardPerformance(setDeck, i, c.card, 3);
          }
          setSessionStats((prev) => ({
            ...prev,
            correct: prev.correct + 1,
            streak: prev.streak + 1,
            bestStreak: Math.max(prev.bestStreak, prev.streak + 1),
          }));
        }
      }
    } else {
      storeMakeMove({
        payload: move,
        clock: pos.turn === "white" ? whiteTime : blackTime,
      });
      setPendingMove(null);

      onMove?.(uci, currentNode.fen, san);
    }
  }

  let shapes: DrawShape[] = [];
  if (showArrows && evalOpen && arrows.size > 0 && pos) {
    const entries = Array.from(arrows.entries()).sort((a, b) => a[0] - b[0]);
    for (const [i, moves] of entries) {
      if (i < 4) {
        const bestWinChance = moves[0].winChance;
        for (const [j, { pv, winChance }] of moves.entries()) {
          const posClone = pos.clone();
          let prevSquare = null;
          for (const [ii, uci] of pv.entries()) {
            const m = parseUci(uci)! as NormalMove;

            posClone.play(m);
            const from = makeSquare(m.from)!;
            const to = makeSquare(m.to)!;
            if (prevSquare === null) {
              prevSquare = from;
            }
            const brushSize = match(bestWinChance - winChance)
              .when(
                (d) => d < 2.5,
                () => LARGE_BRUSH,
              )
              .when(
                (d) => d < 5,
                () => MEDIUM_BRUSH,
              )
              .otherwise(() => SMALL_BRUSH);

            if (ii === 0 || (showConsecutiveArrows && j === 0 && ii % 2 === 0)) {
              if (
                ii < 5 && // max 3 arrows
                !shapes.find((s) => s.orig === from && s.dest === to) &&
                prevSquare === from
              ) {
                shapes.push({
                  orig: from,
                  dest: to,
                  brush: j === 0 ? arrowColors[i].strong : arrowColors[i].pale,
                  modifiers: {
                    lineWidth: brushSize,
                  },
                });
                prevSquare = to;
              } else {
                break;
              }
            }
          }
        }
      }
    }
  }

  // Variation arrows: show all children moves when there are alternatives
  if (showVariationArrows && currentNode.children.length > 1) {
    for (const child of currentNode.children) {
      if (child.move) {
        const m = child.move as NormalMove;
        const from = makeSquare(m.from);
        const to = makeSquare(m.to);
        if (from && to && !shapes.find((s) => s.orig === from && s.dest === to)) {
          shapes.push({
            orig: from,
            dest: to,
            brush: "variation",
            modifiers: {
              lineWidth: MEDIUM_BRUSH,
            },
          });
        }
      }
    }
  }

  const activePlanExplorerData =
    planExplorerData?.fen === currentNode.fen ? planExplorerData : null;
  const activeEnginePlanExplorerData =
    enginePlanExplorerData?.fen === currentNode.fen ? enginePlanExplorerData : null;

  if (
    showPlanExplorerArrows &&
    currentTabSelected === "engine-plans" &&
    activeEnginePlanExplorerData
  ) {
    shapes = shapes.concat(
      planLinesToShapes(
        getAutoPlanLines(activeEnginePlanExplorerData, planExplorerArrowLimit),
        planExplorerArrowLimit,
      ),
    );
  } else if (showPlanExplorerArrows && activePlanExplorerData) {
    shapes = shapes.concat(
      planLinesToShapes(
        getAutoPlanLines(activePlanExplorerData, planExplorerArrowLimit),
        planExplorerArrowLimit,
      ),
    );
  }

  if (planExplorerPreviewLine) {
    shapes = shapes.concat(planLineToShapes(planExplorerPreviewLine));
  }

  if (boardPreviewShapes?.fen === boardFen) {
    shapes = shapes.concat(boardPreviewShapes.shapes);
  }

  if (currentNode.shapes.length > 0) {
    shapes = shapes.concat(currentNode.shapes);
  }

  const mistakeReviewPanelReveal =
    mistakeReviewRevealState &&
    trainerMistakeReviewPosition &&
    sameBoardPosition(mistakeReviewRevealState.fen, trainerMistakeReviewPosition.fen)
      ? mistakeReviewRevealState
      : null;
  const activeMistakeReviewReveal =
    mistakeReviewPanelReveal &&
    sameBoardPosition(mistakeReviewPanelReveal.fen, currentNode.fen) &&
    !boardPreviewShapes?.displayFen
      ? mistakeReviewPanelReveal
      : null;

  if (activeMistakeReviewReveal) {
    const revealShape = uciArrowShape(
      activeMistakeReviewReveal.moveUci,
      activeMistakeReviewReveal.mode === "best" ? "green" : "red",
    );
    if (revealShape) {
      shapes.push(revealShape);
    }
  } else if (
    practicing &&
    (practiceState.phase === "incorrect" || practiceState.phase === "correct") &&
    !boardPreviewShapes?.displayFen
  ) {
    const bestShape = uciArrowShape(
      practiceState.bestMoveUci ??
        (practiceState.phase === "correct" ? practiceState.playedMoveUci : undefined),
      "green",
    );
    const playedShape =
      practiceState.phase === "incorrect" && practiceState.moveAssessment !== "best"
        ? uciArrowShape(practiceState.playedMoveUci, "red")
        : null;
    const sameMove =
      playedShape &&
      bestShape &&
      playedShape.orig === bestShape.orig &&
      playedShape.dest === bestShape.dest;

    if (playedShape && !sameMove) {
      shapes.push(playedShape);
    }
    if (bestShape) {
      shapes.push(bestShape);
    }
  }

  const hasClock =
    !!whiteTime ||
    !!blackTime ||
    !!headers.time_control ||
    !!headers.white_time_control ||
    !!headers.black_time_control;

  const practiceLock = !!practicing && !deck.positions.find((c) => c.fen === currentNode.fen);

  const movableColor: "white" | "black" | "both" | undefined = useMemo(() => {
    return practiceLock
      ? undefined
      : editingMode
        ? "both"
        : match(movable)
            .with("white", () => "white" as const)
            .with("black", () => "black" as const)
            .with("turn", () => turn)
            .with("both", () => "both" as const)
            .with("none", () => undefined)
            .exhaustive();
  }, [practiceLock, editingMode, movable, turn]);

  const theme = useMantineTheme();
  const color = ANNOTATION_INFO[currentNode.annotations[0]]?.color || "gray";
  const lightColor = theme.colors[color][6];
  const darkColor = theme.colors[color][8];

  const [enableBoardScroll] = useAtom(enableBoardScrollAtom);
  const [snapArrows] = useAtom(snapArrowsAtom);
  const showComments = useAtomValue(currentShowCommentsAtom);
  const visualAnnotation = showComments ? currentNode.annotations[0] : "";
  const { ref: boardAreaRef, width: boardAreaWidth, height: boardAreaHeight } = useElementSize();
  const [manualBoardSize, setManualBoardSize] = useAtom(boardManualSizeAtom);
  const maxBoardSize = Math.max(
    0,
    Math.floor(
      Math.min(boardAreaHeight, Math.max(0, boardAreaWidth - BOARD_SIDE_BAR_WIDTH - BOARD_ROW_GAP)),
    ),
  );
  const minBoardSize = Math.min(MIN_MANUAL_BOARD_SIZE, maxBoardSize);
  const boardSize = Math.floor(
    manualBoardSize === null
      ? maxBoardSize
      : clampNumber(manualBoardSize, minBoardSize, maxBoardSize),
  );

  const startBoardResize = useCallback(
    (corner: BoardResizeCorner, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (maxBoardSize <= 0) return;

      const startX = event.clientX;
      const startY = event.clientY;
      const startSize = boardSize || maxBoardSize;
      const cursor = corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize";
      event.currentTarget.setPointerCapture?.(event.pointerId);
      document.body.style.cursor = cursor;
      document.body.style.userSelect = "none";

      const onPointerMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();
        const dx = corner.includes("e") ? moveEvent.clientX - startX : startX - moveEvent.clientX;
        const dy = corner.includes("s") ? moveEvent.clientY - startY : startY - moveEvent.clientY;
        const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
        setManualBoardSize(Math.round(clampNumber(startSize + delta, minBoardSize, maxBoardSize)));
      };

      const stop = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", stop, { once: true });
      window.addEventListener("pointercancel", stop, { once: true });
    },
    [boardSize, maxBoardSize, minBoardSize, setManualBoardSize],
  );

  const setBoardFen = useCallback(
    (fen: string) => {
      if (!fen || !editingMode) {
        return;
      }
      const newFen = `${fen} ${currentNode.fen.split(" ").slice(1).join(" ")}`;

      if (newFen !== currentNode.fen) {
        setFen(newFen);
      }
    },
    [editingMode, currentNode, setFen],
  );

  const drawPlanFromContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!event.ctrlKey) {
        return;
      }

      const routeData =
        currentTabSelected === "engine-plans" ? enginePlanExplorerData : planExplorerData;

      if (!boardRef.current || !pos || routeData?.fen !== currentNode.fen) {
        return;
      }

      const squareName = squareFromPointer(event, boardRef.current, orientation);
      if (!squareName) return;

      const square = parseSquare(squareName);
      if (square === undefined || !pos.board.get(square)) return;

      const line = getPlanLineForSquare(routeData, squareName);
      if (!line) return;

      const planShapes = planLineToShapes(line);
      if (planShapes.length === 0) return;

      event.preventDefault();
      event.stopPropagation();

      const existing = currentNode.shapes.filter((shape) => !isPlanBrush(shape.brush));
      setShapes([...existing, ...planShapes]);
    },
    [
      boardRef,
      currentNode.fen,
      currentNode.shapes,
      currentTabSelected,
      enginePlanExplorerData,
      orientation,
      planExplorerData,
      pos,
      setShapes,
    ],
  );

  const previewPlanFromPointer = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (
        currentTabSelected !== "plan-explorer" &&
        currentTabSelected !== "engine-plans" &&
        !planExplorerHoverEverywhere
      ) {
        return;
      }

      const clearPreview = () => {
        hoveredPlanSquareRef.current = null;
        setPlanExplorerPreviewLine(null);
      };

      const routeData =
        currentTabSelected === "engine-plans" ? enginePlanExplorerData : planExplorerData;

      if (!boardRef.current || !pos || routeData?.fen !== currentNode.fen) {
        clearPreview();
        return;
      }

      const squareName = squareFromPointer(event, boardRef.current, orientation);
      if (squareName === hoveredPlanSquareRef.current) {
        return;
      }

      hoveredPlanSquareRef.current = squareName;

      if (!squareName) {
        setPlanExplorerPreviewLine(null);
        return;
      }

      const square = parseSquare(squareName);
      if (square === undefined || !pos.board.get(square)) {
        setPlanExplorerPreviewLine(null);
        return;
      }

      setPlanExplorerPreviewLine(getPlanLineForSquare(routeData, squareName));
    },
    [
      boardRef,
      currentNode.fen,
      currentTabSelected,
      enginePlanExplorerData,
      orientation,
      planExplorerData,
      planExplorerHoverEverywhere,
      pos,
      setPlanExplorerPreviewLine,
    ],
  );

  const clearPlanHoverPreview = useCallback(() => {
    hoveredPlanSquareRef.current = null;
    setPlanExplorerPreviewLine(null);
  }, [setPlanExplorerPreviewLine]);

  useHotkeys(keyMap.TOGGLE_EVAL_BAR.keys, () => setEvalOpen((e) => !e));

  const square = match(currentNode)
    .with({ san: "O-O" }, ({ halfMoves }) => parseSquare(halfMoves % 2 === 1 ? "g1" : "g8"))
    .with({ san: "O-O-O" }, ({ halfMoves }) => parseSquare(halfMoves % 2 === 1 ? "c1" : "c8"))
    .otherwise((node) => node.move?.to);

  const lastMove =
    currentNode.move && square !== undefined
      ? [chessgroundMove(currentNode.move)[0], makeSquare(square)!]
      : undefined;

  const topPlayer = orientation === "white" ? headers.black : headers.white;
  const bottomPlayer = orientation === "white" ? headers.white : headers.black;
  const mistakeReviewMetadata = trainerMistakeReviewPosition?.mistakeReview;
  const mistakeReviewAttemptActive =
    (practiceState.phase === "correct" || practiceState.phase === "incorrect") &&
    sameBoardPosition(practiceState.currentFen, trainerMistakeReviewPosition?.fen);
  const mistakeReviewSeverity = ((mistakeReviewAttemptActive
    ? practiceState.mistakeReviewLabel
    : undefined) ??
    mistakeReviewMetadata?.severity) as MistakeReviewAttemptLabel | undefined;
  const mistakeReviewPanelColor = mistakeReviewPanelReveal
    ? mistakeReviewPanelReveal.mode === "best"
      ? "green"
      : "red"
    : mistakeReviewColor(mistakeReviewSeverity);
  const mistakeReviewLoss =
    (mistakeReviewAttemptActive ? practiceState.moveLossCp : undefined) ??
    mistakeReviewMetadata?.cpLoss ??
    trainerMistakeReviewPosition?.engine?.lossCp;
  const mistakeReviewWinProbabilityDrop =
    (mistakeReviewAttemptActive ? practiceState.winProbabilityDrop : undefined) ??
    mistakeReviewMetadata?.winProbabilityDrop;
  const mistakeReviewBestMove =
    (mistakeReviewAttemptActive ? practiceState.bestMove : undefined) ||
    mistakeReviewMetadata?.bestMoveSan ||
    trainerMistakeReviewPosition?.engine?.bestMoveSan ||
    trainerMistakeReviewPosition?.answer;
  const mistakeReviewBestMoveUci =
    (mistakeReviewAttemptActive ? practiceState.bestMoveUci : undefined) ||
    mistakeReviewMetadata?.bestMoveUci ||
    trainerMistakeReviewPosition?.engine?.bestMoveUci ||
    trainerMistakeReviewPosition?.answerUci;
  const mistakeReviewPlayedMove =
    (mistakeReviewAttemptActive ? practiceState.playedMove : undefined) ||
    mistakeReviewMetadata?.playedMoveSan ||
    undefined;
  const mistakeReviewPlayedMoveLabel = mistakeReviewAttemptActive ? "Played" : "Mistake";
  const showMistakeReviewControls = isMistakeReviewTab && Boolean(mistakeReviewMetadata);

  return (
    <>
      <Box w="100%" h="100%">
        <Box
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            gap: "0.5rem",
            flexWrap: "nowrap",
            overflow: "hidden",
            minHeight: 0,
          }}
        >
          <BoardBar
            name={topPlayer}
            rating={orientation === "white" ? headers.black_elo : headers.white_elo}
            onNameClick={() => {
              if (orientation === "white") {
                setBlackFideOpen(true);
              } else {
                setWhiteFideOpen(true);
              }
            }}
            height={BAR_HEIGHT}
          >
            <ShowMaterial
              fen={boardFen}
              color={orientation === "white" ? "black" : "white"}
              mode={materialDisplay}
            />
            {hasClock && (
              <Clock
                color={orientation === "black" ? "white" : "black"}
                turn={turn}
                whiteTime={whiteTime}
                blackTime={blackTime}
              />
            )}
          </BoardBar>
          <Box
            ref={boardAreaRef}
            style={{
              flex: "1 1 0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 0,
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            <Group
              style={{
                position: "relative",
                flexWrap: "nowrap",
                width: boardSize ? boardSize + BOARD_SIDE_BAR_WIDTH + BOARD_ROW_GAP : "100%",
                height: boardSize || "100%",
                minWidth: 0,
                minHeight: 0,
              }}
              gap={BOARD_ROW_GAP}
            >
              {showComments &&
                currentNode.annotations.length > 0 &&
                currentNode.move &&
                square !== undefined && (
                  <Box pl="2.5rem" w="100%" h="100%" pos="absolute">
                    <Box pos="relative" w="100%" h="100%">
                      <AnnotationHint
                        orientation={orientation}
                        square={square}
                        annotation={currentNode.annotations[0]}
                      />
                    </Box>
                  </Box>
                )}
              <Box
                h="100%"
                style={{
                  width: BOARD_SIDE_BAR_WIDTH,
                  flex: `0 0 ${BOARD_SIDE_BAR_WIDTH}px`,
                }}
              >
                {!evalOpen && (
                  <Center h="100%" w="100%">
                    <ActionIcon
                      size="1rem"
                      onClick={() => setEvalOpen(true)}
                      onContextMenu={(e) => {
                        setEvalOpen(true);
                        e.preventDefault();
                      }}
                    >
                      <IconChevronRight />
                    </ActionIcon>
                  </Center>
                )}
                {evalOpen && (
                  <EvalBar score={currentNode.score || null} orientation={orientation} />
                )}
              </Box>
              <Box
                style={
                  isBasicAnnotation(visualAnnotation)
                    ? {
                        position: "relative",
                        "--light-color": lightColor,
                        "--dark-color": darkColor,
                        flex: "0 0 auto",
                        minWidth: 0,
                        minHeight: 0,
                      }
                    : {
                        position: "relative",
                        flex: "0 0 auto",
                        minWidth: 0,
                        minHeight: 0,
                      }
                }
                className={classes.chessboard}
                ref={boardRef}
                w={boardSize || undefined}
                h={boardSize || undefined}
                onContextMenu={drawPlanFromContextMenu}
                onClick={() => {
                  if (eraseDrawablesOnClick) {
                    clearShapes();
                  }
                }}
                onMouseMove={previewPlanFromPointer}
                onMouseLeave={clearPlanHoverPreview}
                onWheel={(e) => {
                  if (enableBoardScroll) {
                    if (e.deltaY > 0) {
                      goToNext();
                    } else {
                      goToPrevious();
                    }
                  }
                }}
              >
                <PromotionModal
                  pendingMove={pendingMove}
                  cancelMove={() => setPendingMove(null)}
                  confirmMove={(p) => {
                    if (pendingMove) {
                      makeMove({
                        from: pendingMove.from,
                        to: pendingMove.to,
                        promotion: p,
                      });
                    }
                  }}
                  turn={turn}
                  orientation={orientation}
                />

                <Chessground
                  ref={cgRef}
                  setBoardFen={setBoardFen}
                  orientation={orientation}
                  fen={boardFen}
                  animation={{ enabled: !editingMode }}
                  coordinates={showCoordinates !== "no"}
                  coordinatesOnSquares={showCoordinates === "all"}
                  movable={{
                    free: editingMode,
                    color: boardPreviewShapes?.displayFen ? undefined : movableColor,
                    dests:
                      boardPreviewShapes?.displayFen || editingMode || viewOnly
                        ? undefined
                        : disableVariations && currentNode.children.length > 0
                          ? undefined
                          : dests,
                    showDests,
                    events: {
                      after(orig, dest, metadata) {
                        if (!editingMode) {
                          const from = parseSquare(orig)!;
                          const to = parseSquare(dest)!;

                          if (pos) {
                            if (
                              pos.board.get(from)?.role === "pawn" &&
                              ((dest[1] === "8" && turn === "white") ||
                                (dest[1] === "1" && turn === "black"))
                            ) {
                              if (autoPromote && !metadata.ctrlKey) {
                                makeMove({
                                  from,
                                  to,
                                  promotion: "queen",
                                });
                              } else {
                                setPendingMove({
                                  from,
                                  to,
                                });
                              }
                            } else {
                              makeMove({
                                from,
                                to,
                              });
                            }
                          }
                        }
                      },
                    },
                  }}
                  events={{
                    select: (key) => {
                      if (editingMode && selectedPiece) {
                        const square = parseSquare(key);
                        if (square) {
                          const setup = parseFen(currentNode.fen).unwrap();
                          setup.board.set(square, selectedPiece);
                          setFen(makeFen(setup));
                        }
                      }
                    },
                  }}
                  turnColor={boardPreviewPos?.turn ?? turn}
                  check={moveHighlight && (boardPreviewPos ?? pos)?.isCheck()}
                  lastMove={
                    moveHighlight && !editingMode && !boardPreviewShapes?.displayFen
                      ? lastMove
                      : undefined
                  }
                  premovable={{
                    enabled: enablePremoves && !editingMode && !viewOnly,
                  }}
                  draggable={{
                    enabled: true,
                    deleteOnDropOff: editingMode,
                  }}
                  drawable={{
                    enabled: true,
                    visible: true,
                    defaultSnapToValidMove: snapArrows,
                    autoShapes: shapes,
                    brushes: {
                      variation: {
                        key: "v",
                        color: "#9b59b6",
                        opacity: 0.8,
                        lineWidth: 10,
                      },
                      [PLAN_BRUSH]: {
                        key: "p",
                        color: "#12b886",
                        opacity: 0.9,
                        lineWidth: 10,
                      },
                      [PLAN_WHITE_BRUSH]: {
                        key: "w",
                        color: "#228be6",
                        opacity: 0.9,
                        lineWidth: 10,
                      },
                      [PLAN_BLACK_BRUSH]: {
                        key: "b",
                        color: "#f08c00",
                        opacity: 0.9,
                        lineWidth: 10,
                      },
                      preview: {
                        key: "x",
                        color: "#4dabf7",
                        opacity: 0.95,
                        lineWidth: 10,
                      },
                    } as unknown as DrawBrushes,
                    onChange: (shapes) => {
                      setShapes(shapes);
                    },
                  }}
                />
                {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                  <Box
                    key={corner}
                    aria-label="Resize board"
                    title="Drag to resize board. Double-click to reset."
                    role="separator"
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setManualBoardSize(null);
                    }}
                    onPointerDown={(event) => startBoardResize(corner, event)}
                    style={{
                      position: "absolute",
                      zIndex: 50,
                      width: 32,
                      height: 32,
                      top: corner.includes("n") ? -8 : undefined,
                      bottom: corner.includes("s") ? -8 : undefined,
                      left: corner.includes("w") ? -8 : undefined,
                      right: corner.includes("e") ? -8 : undefined,
                      cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
                      touchAction: "none",
                      userSelect: "none",
                      pointerEvents: "auto",
                      backgroundColor: "transparent",
                    }}
                  />
                ))}
              </Box>
            </Group>
          </Box>
          <BoardBar
            name={bottomPlayer}
            rating={orientation === "white" ? headers.white_elo : headers.black_elo}
            onNameClick={() => {
              if (orientation === "white") {
                setWhiteFideOpen(true);
              } else {
                setBlackFideOpen(true);
              }
            }}
            height={BAR_HEIGHT}
          >
            {error && (
              <Text ta="center" c="red">
                {t(chessopsError(error))}
              </Text>
            )}

            {moveInput && <MoveInput currentNode={currentNode} />}

            <ShowMaterial fen={boardFen} color={orientation} mode={materialDisplay} />
            {hasClock && (
              <Clock color={orientation} turn={turn} whiteTime={whiteTime} blackTime={blackTime} />
            )}
          </BoardBar>
          {showMistakeReviewControls && (
            <Paper
              withBorder
              p="xs"
              radius="sm"
              mih={MISTAKE_REVIEW_PANEL_MIN_HEIGHT}
              style={{ flexShrink: 0 }}
            >
              <Stack gap="xs">
                <Group justify="space-between" gap="xs" align="flex-start">
                  <Group gap="xs" wrap="nowrap" align="center">
                    <ThemeIcon color={mistakeReviewPanelColor} variant="light" radius="xl">
                      {mistakeReviewPanelReveal?.mode === "best" ? (
                        <IconPlayerPlay size={16} />
                      ) : mistakeReviewPanelReveal?.mode === "mistake" ? (
                        <IconEye size={16} />
                      ) : (
                        <IconRotate size={16} />
                      )}
                    </ThemeIcon>
                    <Stack gap={1}>
                      <Group gap={6} align="center">
                        <Text size="sm" fw={700} c={mistakeReviewPanelColor}>
                          {mistakeReviewPanelReveal?.mode === "best"
                            ? "Best move revealed"
                            : mistakeReviewPanelReveal?.mode === "mistake"
                              ? "Mistake shown"
                              : "Mistake review"}
                        </Text>
                        {mistakeReviewSeverity && (
                          <Badge color={mistakeReviewColor(mistakeReviewSeverity)} variant="light">
                            {mistakeReviewSeverityLabel(mistakeReviewSeverity)}
                          </Badge>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed">
                        {mistakeReviewPlayedMove
                          ? `${mistakeReviewPlayedMoveLabel}: ${mistakeReviewPlayedMove}. `
                          : ""}
                        Best: {mistakeReviewBestMove || "-"}
                        {mistakeReviewLoss !== undefined
                          ? `, ${Math.round(mistakeReviewLoss)} cp loss`
                          : ""}
                        {mistakeReviewWinProbabilityDrop !== undefined
                          ? `, ${mistakeReviewWinProbabilityDrop.toFixed(1)}% win-prob drop`
                          : ""}
                        {mistakeReviewRevealRemaining > 0
                          ? `, reveal in ${mistakeReviewRevealRemaining}s`
                          : ""}
                        {mistakeReviewLineBusy ? ", playing engine line" : ""}
                      </Text>
                    </Stack>
                  </Group>
                  <Group gap={4} wrap="nowrap">
                    <Popover width={340} position="top-end" shadow="md" withinPortal>
                      <Popover.Target>
                        <ActionIcon
                          variant="subtle"
                          aria-label="Train settings"
                          title="Train settings"
                        >
                          <IconSettings size={16} />
                        </ActionIcon>
                      </Popover.Target>
                      <Popover.Dropdown>
                        <Stack gap="sm">
                          <Text size="sm" fw={700}>
                            Train settings
                          </Text>
                          <Group justify="space-between" gap="md" wrap="nowrap">
                            <Box>
                              <Text size="sm">Reveal delay</Text>
                              <Text size="xs" c="dimmed">
                                Seconds before reveal buttons work
                              </Text>
                            </Box>
                            <NumberInput
                              value={mistakeReviewRevealDelay}
                              min={0}
                              max={60}
                              step={1}
                              w={104}
                              onChange={(value) =>
                                setMistakeReviewRevealDelay(clampNumber(Number(value) || 0, 0, 60))
                              }
                            />
                          </Group>
                          <Group justify="space-between" gap="md" wrap="nowrap">
                            <Box>
                              <Text size="sm">Sample line plies</Text>
                              <Text size="xs" c="dimmed">
                                Half-moves to play after reveal
                              </Text>
                            </Box>
                            <NumberInput
                              value={mistakeReviewSampleLinePlies}
                              min={0}
                              max={20}
                              step={1}
                              w={104}
                              onChange={(value) =>
                                setMistakeReviewSampleLinePlies(
                                  Math.round(clampNumber(Number(value) || 0, 0, 20)),
                                )
                              }
                            />
                          </Group>
                          <Group justify="space-between" gap="md" wrap="nowrap">
                            <Box>
                              <Text size="sm">Sample line speed</Text>
                              <Text size="xs" c="dimmed">
                                Milliseconds between moves
                              </Text>
                            </Box>
                            <NumberInput
                              value={mistakeReviewSampleLineSpeed}
                              min={200}
                              max={3000}
                              step={100}
                              w={104}
                              onChange={(value) =>
                                setMistakeReviewSampleLineSpeed(
                                  Math.round(clampNumber(Number(value) || 1000, 200, 3000)),
                                )
                              }
                            />
                          </Group>
                          <Divider />
                          <Switch
                            checked={mistakeReviewAutoPlayLine}
                            label="Play sample line on reveal"
                            onChange={(event) =>
                              setMistakeReviewAutoPlayLine(event.currentTarget.checked)
                            }
                          />
                          <Switch
                            checked={mistakeReviewAutoRevealBest}
                            label="Auto-reveal best move"
                            onChange={(event) =>
                              setMistakeReviewAutoRevealBest(event.currentTarget.checked)
                            }
                          />
                          <Switch
                            checked={mistakeReviewEngineOnReveal}
                            label="Turn engine on when revealing"
                            onChange={(event) =>
                              setMistakeReviewEngineOnReveal(event.currentTarget.checked)
                            }
                          />
                          <Switch
                            checked={mistakeReviewEngineOffOnNavigation}
                            label="Turn engine off on navigation"
                            onChange={(event) =>
                              setMistakeReviewEngineOffOnNavigation(event.currentTarget.checked)
                            }
                          />
                        </Stack>
                      </Popover.Dropdown>
                    </Popover>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      leftSection={<IconArrowBackUp size={14} />}
                      onClick={() => returnToMistakeReviewPosition()}
                    >
                      Reset
                    </Button>
                  </Group>
                </Group>
                <Group gap="xs" grow>
                  <Button
                    size="xs"
                    variant="light"
                    color="red"
                    leftSection={<IconEye size={14} />}
                    onClick={() => void showMistakeReviewMove()}
                    disabled={
                      mistakeReviewRevealRemaining > 0 || !mistakeReviewMetadata?.playedMoveUci
                    }
                    loading={mistakeReviewLineBusy && mistakeReviewPanelReveal?.mode === "mistake"}
                  >
                    Show mistake
                  </Button>
                  <Button
                    size="xs"
                    variant="light"
                    color="green"
                    leftSection={<IconPlayerPlay size={14} />}
                    onClick={() => void revealMistakeReviewBest()}
                    disabled={mistakeReviewRevealRemaining > 0 || !mistakeReviewBestMoveUci}
                    loading={mistakeReviewLineBusy && mistakeReviewPanelReveal?.mode === "best"}
                  >
                    Reveal best
                  </Button>
                </Group>
              </Stack>
            </Paper>
          )}
        </Box>
      </Box>
      <FideInfo opened={whiteFideOpen} setOpened={setWhiteFideOpen} name={headers.white} />
      <FideInfo opened={blackFideOpen} setOpened={setBlackFideOpen} name={headers.black} />
    </>
  );
}

export default memo(Board);
