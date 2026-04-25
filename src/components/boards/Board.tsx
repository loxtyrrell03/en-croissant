import type { DrawBrushes, DrawShape } from "@lichess-org/chessground/draw";
import { ActionIcon, Box, Center, Group, Text, useMantineTheme } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconChevronRight } from "@tabler/icons-react";
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
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useContext, useMemo, useRef, useState, type MouseEvent } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useTranslation } from "react-i18next";
import { match } from "ts-pattern";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { Chessground, type ChessgroundRef } from "@/chessground/Chessground";
import {
  autoPromoteAtom,
  bestMovesFamily,
  currentBoardPreviewShapesAtom,
  currentEvalOpenAtom,
  currentPlanExplorerDataAtom,
  currentPlanExplorerPreviewLineAtom,
  currentShowCommentsAtom,
  currentTabAtom,
  currentTabSelectedAtom,
  deckAtomFamily,
  enableBoardScrollAtom,
  eraseDrawablesOnClickAtom,
  forcedEnPassantAtom,
  materialDisplayAtom,
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
import ShowMaterial from "../common/ShowMaterial";
import { TreeStateContext } from "../common/TreeStateContext";
import FideInfo from "../databases/FideInfo";
import { updateCardPerformance } from "../files/opening";
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
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

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
  const storeMakeMove = useStore(store, (s) => s.makeMove);
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

  const setPracticeState = useSetAtom(practiceStateAtom);
  const [sessionStats, setSessionStats] = useAtom(practiceSessionStatsAtom);
  const cardStartTime = useAtomValue(practiceCardStartTimeAtom);

  async function makeMove(move: NormalMove) {
    if (!pos) return;
    const san = makeSan(pos, move);
    const uci = makeUci(move);
    if (practicing) {
      const c = deck.positions.find((c) => c.fen === currentNode.fen);
      if (!c) {
        return;
      }

      const i = deck.positions.indexOf(c);
      const timeTaken = Date.now() - cardStartTime;
      const isCorrect = san === c.answer || c.answerUci === uci;
      onMove?.(uci, c.fen, san);

      if (!isCorrect) {
        if (sessionStats.mode !== "full") {
          updateCardPerformance(setDeck, i, c.card, 1);
        }
        setPracticeState({
          phase: "incorrect",
          currentFen: c.fen,
          answer: c.answer,
          playedMove: san,
          playedMoveUci: uci,
          positionIndex: i,
          timeTaken,
        });
        setSessionStats((prev) => ({
          ...prev,
          incorrect: prev.incorrect + 1,
          streak: 0,
        }));
        notifications.show({
          title: t("Common.Incorrect"),
          message: t("Board.Practice.CorrectMoveWas", { move: c.answer }),
          color: "red",
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        goToNext();
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
          positionIndex: i,
          timeTaken,
        });
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

  if (showPlanExplorerArrows && activePlanExplorerData) {
    shapes = shapes.concat(
      planLinesToShapes(getAutoPlanLines(activePlanExplorerData), planExplorerArrowLimit),
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

      if (!boardRef.current || !pos || planExplorerData?.fen !== currentNode.fen) {
        return;
      }

      const squareName = squareFromPointer(event, boardRef.current, orientation);
      if (!squareName) return;

      const square = parseSquare(squareName);
      if (square === undefined || !pos.board.get(square)) return;

      const line = getPlanLineForSquare(planExplorerData, squareName);
      if (!line) return;

      const planShapes = planLineToShapes(line);
      if (planShapes.length === 0) return;

      event.preventDefault();
      event.stopPropagation();

      const existing = currentNode.shapes.filter((shape) => !isPlanBrush(shape.brush));
      setShapes([...existing, ...planShapes]);
    },
    [boardRef, currentNode.fen, currentNode.shapes, orientation, planExplorerData, pos, setShapes],
  );

  const previewPlanFromPointer = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (currentTabSelected !== "plan-explorer" && !planExplorerHoverEverywhere) {
        return;
      }

      const clearPreview = () => {
        hoveredPlanSquareRef.current = null;
        setPlanExplorerPreviewLine(null);
      };

      if (!boardRef.current || !pos || planExplorerData?.fen !== currentNode.fen) {
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

      setPlanExplorerPreviewLine(getPlanLineForSquare(planExplorerData, squareName));
    },
    [
      boardRef,
      currentNode.fen,
      currentTabSelected,
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
            maxWidth:
              //            topbar   bottompadding                tabs                                  bottomb    topbar   evalbar                                gaps    ???
              `calc(100vh - 2.25rem - var(--mantine-spacing-sm) - 2.5rem - var(--mantine-spacing-sm) - ${BAR_HEIGHT} - ${BAR_HEIGHT} + 1.563rem + var(--mantine-spacing-md) - 1rem  - 0.2rem)`,
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
          <Group
            style={{
              position: "relative",
              flexWrap: "nowrap",
            }}
            gap="sm"
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
                width: 25,
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
              {evalOpen && <EvalBar score={currentNode.score || null} orientation={orientation} />}
            </Box>
            <Box
              style={
                isBasicAnnotation(visualAnnotation)
                  ? {
                      "--light-color": lightColor,
                      "--dark-color": darkColor,
                    }
                  : undefined
              }
              className={classes.chessboard}
              ref={boardRef}
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
            </Box>
          </Group>
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
        </Box>
      </Box>
      <FideInfo opened={whiteFideOpen} setOpened={setWhiteFideOpen} name={headers.white} />
      <FideInfo opened={blackFideOpen} setOpened={setBlackFideOpen} name={headers.black} />
    </>
  );
}

export default memo(Board);
