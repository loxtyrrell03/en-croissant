import {
  ActionIcon,
  Box,
  Divider,
  Group,
  Menu,
  Overlay,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { useColorScheme } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconArrowRight,
  IconArrowsSplit,
  IconArticle,
  IconArticleOff,
  IconChartBar,
  IconCheck,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconFocus,
  IconLayoutList,
  IconList,
  IconMinus,
  IconPencil,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { useLoaderData } from "@tanstack/react-router";
import { INITIAL_FEN } from "chessops/fen";
import equal from "fast-deep-equal";
import { useAtom, useAtomValue } from "jotai";
import React, { memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { commands, type GoMode } from "@/bindings";
import Comment from "@/components/common/Comment";
import GameAnalysisReport from "@/components/common/GameAnalysisReport";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  currentEvalOpenAtom,
  currentInvisibleAtom,
  currentShowCommentsAtom,
  currentShowMoveAnnotationsAtom,
  currentShowVariationsAtom,
  currentTabAtom,
  enginesAtom,
  tableViewAtom,
} from "@/state/atoms";
import { keyMapAtom } from "@/state/keybinds";
import { getMainLine, getPGN } from "@/utils/chess";
import { hideMoveQualityComments } from "@/utils/commentAnnotations";
import type { Engine, LocalEngine } from "@/utils/engines";
import { hasCompleteGameAnalysis } from "@/utils/gameAnalysisReport";
import { formatScore } from "@/utils/score";
import { getTabFile, getTabGameNumber, saveToFile } from "@/utils/tabs";
import { getNodeAtPath, type TreeNode } from "@/utils/treeReducer";
import type { TreeStore } from "@/state/store/tree";
import AnnotationEditor from "../panels/annotation/AnnotationEditor";
import CompleteMoveCell from "./CompleteMoveCell";
import styles from "./GameNotation.module.css";
import OpeningName from "./OpeningName";

function GameNotation({
  topBar,
  controls,
  headerActions,
  content,
  className,
  compact = false,
  grow = true,
}: {
  topBar?: boolean;
  controls?: React.ReactNode;
  headerActions?: React.ReactNode;
  content?: React.ReactNode;
  className?: string;
  compact?: boolean;
  grow?: boolean;
}) {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const currentFen = useStore(store, (s) => s.currentNode().fen);
  const headers = useStore(store, (s) => s.headers);
  const rootComment = useStore(store, (s) => s.root.comment);
  const reportInProgress = useStore(store, (s) => s.report.inProgress);
  const [reportVisible, setReportVisible] = useState(false);
  const [rootContextMenuPosition, setRootContextMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [rootAnnotating, setRootAnnotating] = useState(false);

  const viewport = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // Defer the scroll to the next frame: getBoundingClientRect forces a
    // synchronous layout, which would otherwise land in the middle of the
    // commit for every move played.
    const frame = window.requestAnimationFrame(() => {
      if (!viewport.current) return;
      if (currentFen === INITIAL_FEN) {
        viewport.current.scrollTo({ top: 0, behavior: "auto" });
      } else if (targetRef.current) {
        const viewportEl = viewport.current;
        const targetEl = targetRef.current;
        const viewportRect = viewportEl.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const offsetInViewport = targetRect.top - viewportRect.top + viewportEl.scrollTop;
        viewportEl.scrollTo({
          top: offsetInViewport - 65,
          behavior: "auto",
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentFen]);

  const [invisibleValue, setInvisible] = useAtom(currentInvisibleAtom);
  const invisible = topBar && invisibleValue;
  const showComments = useAtomValue(currentShowCommentsAtom);
  const tableView = useAtomValue(tableViewAtom);
  const colorScheme = useColorScheme();

  const keyMap = useAtomValue(keyMapAtom);
  useHotkeys(keyMap.TOGGLE_BLUR.keys, () => setInvisible((v) => !v));

  function handleNotationContextMenu(event: React.MouseEvent) {
    if (reportVisible) return;
    event.preventDefault();
    setRootContextMenuPosition({ x: event.clientX, y: event.clientY });
  }

  return (
    <Paper
      data-testid="game-notation"
      withBorder
      flex={grow ? 1 : undefined}
      className={className}
      style={{ position: "relative", overflow: "hidden", minHeight: 0 }}
    >
      <Group h="100%" wrap="nowrap" align="stretch" gap={0} style={{ minHeight: 0 }}>
        {controls && (
          <>
            <ScrollArea
              type="never"
              py={compact ? 6 : "md"}
              mx={compact ? 4 : "xs"}
              style={{ flexShrink: 0 }}
            >
              {controls}
            </ScrollArea>
            <Divider orientation="vertical" />
          </>
        )}
        <Stack h="100%" gap={0} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          {topBar && (
            <NotationHeader
              compact={compact}
              headerActions={headerActions}
              reportVisible={reportVisible}
              setReportVisible={setReportVisible}
            />
          )}
          {content ? (
            <Box flex={1} style={{ minHeight: 0, overflow: "hidden" }}>
              {content}
            </Box>
          ) : (
            <ScrollArea
              flex={1}
              offsetScrollbars
              scrollbars="y"
              viewportRef={viewport}
              style={{ minHeight: 0 }}
            >
              <Stack gap="xs">
                {reportVisible ? (
                  <GameAnalysisReport isAnalysing={reportInProgress} />
                ) : (
                  <>
                    <Box onContextMenu={handleNotationContextMenu} style={{ minHeight: 80 }}>
                      <Menu
                        opened={rootContextMenuPosition !== null}
                        onChange={(opened) => {
                          if (!opened) setRootContextMenuPosition(null);
                        }}
                        width={200}
                        shadow="md"
                      >
                        <Menu.Target>
                          <Box
                            style={{
                              position: "fixed",
                              left: rootContextMenuPosition?.x ?? -1000,
                              top: rootContextMenuPosition?.y ?? -1000,
                              width: 1,
                              height: 1,
                              pointerEvents: "none",
                            }}
                          />
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item
                            leftSection={<IconPencil size="0.875rem" />}
                            onClick={() => {
                              setRootAnnotating(true);
                              setRootContextMenuPosition(null);
                            }}
                          >
                            {t("Board.Tabs.Annotate")}
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                      {invisible && (
                        <Overlay
                          backgroundOpacity={0.6}
                          color={colorScheme === "dark" ? "#1a1b1e" : undefined}
                          blur={8}
                          zIndex={2}
                        />
                      )}
                      {rootAnnotating && (
                        <RootAnnotationPanel onClose={() => setRootAnnotating(false)} />
                      )}
                      {showComments && rootComment && (
                        <Box p="sm" fz="sm">
                          <Comment comment={rootComment} />
                        </Box>
                      )}
                      {tableView ? (
                        <TableNotation targetRef={targetRef} compact={compact} />
                      ) : (
                        <Box pt={compact ? 3 : "md"} px={compact ? 8 : "sm"}>
                          <RenderVariationTree
                            targetRef={targetRef}
                            nodePath={[]}
                            depth={0}
                            first
                            compact={compact}
                          />
                        </Box>
                      )}
                    </Box>
                    <Box pb={compact ? 4 : "md"}>
                      {headers.result !== "*" && (
                        <Text ta="center">
                          {headers.result}
                          <br />
                          <Text span fs="italic">
                            {headers.result === "1/2-1/2"
                              ? "Draw"
                              : headers.result === "1-0"
                                ? "White wins"
                                : "Black wins"}
                          </Text>
                        </Text>
                      )}
                    </Box>
                  </>
                )}
              </Stack>
            </ScrollArea>
          )}
        </Stack>
      </Group>
    </Paper>
  );
}

function RootAnnotationPanel({ onClose }: { onClose: () => void }) {
  return (
    <Box
      data-testid="root-annotation-panel"
      p="sm"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <Group justify="space-between" mb={6} wrap="nowrap">
        <Text size="xs" fw={600} c="dimmed">
          Starting position annotation
        </Text>
        <Tooltip label="Close annotations">
          <ActionIcon size="sm" variant="subtle" onClick={onClose}>
            <IconX size="0.875rem" />
          </ActionIcon>
        </Tooltip>
      </Group>
      <AnnotationEditor path={[]} compact />
    </Box>
  );
}

function NotationHeader({
  compact = false,
  headerActions,
  reportVisible,
  setReportVisible,
}: {
  compact?: boolean;
  headerActions?: React.ReactNode;
  reportVisible: boolean;
  setReportVisible: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const { t } = useTranslation();
  const { documentDir } = useLoaderData({ from: "/" });
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const headers = useStore(store, (s) => s.headers);
  const dirty = useStore(store, (s) => s.dirty);
  const addAnalysis = useStore(store, (s) => s.addAnalysis);
  const reportInProgress = useStore(store, (s) => s.report.inProgress);
  const setReportInProgress = useStore(store, (s) => s.setReportInProgress);
  const [currentTab, setCurrentTab] = useAtom(currentTabAtom);
  const engines = useAtomValue(enginesAtom);
  const [evalOpen, setEvalOpen] = useAtom(currentEvalOpenAtom);
  const [invisible, setInvisible] = useAtom(currentInvisibleAtom);
  const [showComments, setShowComments] = useAtom(currentShowCommentsAtom);
  const [showMoveAnnotations, setShowMoveAnnotations] = useAtom(currentShowMoveAnnotationsAtom);
  const [showVariations, setShowVariations] = useAtom(currentShowVariationsAtom);
  const [tableView, setTableView] = useAtom(tableViewAtom);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimeout = useRef<number | null>(null);
  // Walks the whole mainline and computes accuracies — memoize per tree
  // revision so it doesn't run twice on every header render.
  const hasGameAnalysis = useMemo(() => hasCompleteGameAnalysis(root), [root]);

  useEffect(() => {
    return () => {
      if (copiedTimeout.current !== null) {
        window.clearTimeout(copiedTimeout.current);
      }
    };
  }, []);

  async function getCompletePgn() {
    const tabFile = getTabFile(currentTab);
    const gameNumber = getTabGameNumber(currentTab);

    if (tabFile && !dirty) {
      try {
        const result = await commands.readGames(tabFile.path, gameNumber, gameNumber);
        if (result.status === "ok" && result.data[0]) {
          return result.data[0];
        }
      } catch {
        // Fall back to the parsed tree below so copy still works outside the Tauri file backend.
      }
    }

    return getPGN(root, {
      headers,
      glyphs: true,
      comments: true,
      variations: true,
      extraMarkups: true,
    });
  }

  async function copyCompletePgn() {
    try {
      setCopying(true);
      await navigator.clipboard.writeText(await getCompletePgn());
      setCopied(true);
      if (copiedTimeout.current !== null) {
        window.clearTimeout(copiedTimeout.current);
      }
      copiedTimeout.current = window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      notifications.show({
        title: "Could not copy PGN",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setCopying(false);
    }
  }

  async function analyzeGame() {
    if (reportVisible) {
      setReportVisible(false);
      return;
    }

    if (hasGameAnalysis) {
      setReportVisible(true);
      return;
    }

    const engine = selectLocalAnalysisEngine(engines ?? []);
    if (!engine) {
      notifications.show({
        title: "Choose an analysis engine",
        message: "Add or load a local UCI engine before analyzing this game.",
        color: "yellow",
      });
      return;
    }

    setReportInProgress(true);
    try {
      const analysis = await commands.analyzeGame(
        `report_${currentTab?.value ?? "notation"}`,
        engine.path,
        getReportGoMode(engine),
        {
          annotateNovelties: false,
          fen: root.fen,
          referenceDb: null,
          reversed: true,
          moves: getMainLine(root),
        },
        (engine.settings ?? []).map((setting) => ({
          name: setting.name,
          value: setting.value?.toString() ?? "",
        })),
      );

      if (analysis.status === "ok") {
        addAnalysis(analysis.data, { showVariations: true });
        await saveAnalysisIfPersistent();
        setReportVisible(true);
      } else {
        notifications.show({
          title: "Could not analyze game",
          message: analysis.error,
          color: "red",
        });
      }
    } catch (error) {
      notifications.show({
        title: "Could not analyze game",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setReportInProgress(false);
    }
  }

  async function saveAnalysisIfPersistent() {
    const origin = currentTab?.gameOrigin;
    if (!origin || (origin.kind !== "file" && origin.kind !== "database")) return;

    try {
      await saveToFile({
        dir: documentDir,
        setCurrentTab,
        tab: currentTab,
        store,
      });
    } catch (error) {
      notifications.show({
        title: "Analysis was not saved",
        message:
          error instanceof Error
            ? error.message
            : "The report is available now, but it could not be written to the source game.",
        color: "yellow",
      });
    }
  }

  const copyPgnLabel = copied ? t("Common.Copied") : `${t("Menu.Edit.Copy") || "Copy"} PGN`;
  const analyzeLabel = reportVisible
    ? "Show moves"
    : hasGameAnalysis
      ? "Show game report"
      : "Analyze game with local engine";
  const notationDetailsHidden = !evalOpen || !showComments || !showMoveAnnotations;
  const focusNotationLabel = notationDetailsHidden
    ? "Show eval bar and move-quality annotations"
    : "Hide eval bar and move-quality annotations";
  const toggleNotationDetails = () => {
    if (notationDetailsHidden) {
      setEvalOpen(true);
      setShowComments(true);
      setShowMoveAnnotations(true);
    } else {
      setEvalOpen(false);
      setShowComments(true);
      setShowMoveAnnotations(false);
    }
  };
  const actionIconSize = compact ? "sm" : "md";
  const iconSize = compact ? "0.9rem" : "1rem";

  return (
    <Stack gap={compact ? 2 : "xs"} pt={compact ? 3 : "xs"}>
      <Group justify="space-between" px={compact ? 8 : "sm"} gap={compact ? 4 : "sm"}>
        <Box miw={0} style={{ flex: "1 1 11rem" }}>
          <OpeningName compact={compact} />
        </Box>
        <Group gap={compact ? 4 : "sm"} wrap="nowrap" style={{ flex: "0 0 auto" }}>
          {headerActions}
          <Tooltip label={focusNotationLabel}>
            <ActionIcon
              aria-label={focusNotationLabel}
              size={actionIconSize}
              variant={notationDetailsHidden ? "filled" : undefined}
              onClick={toggleNotationDetails}
            >
              <IconFocus size={iconSize} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={copyPgnLabel}>
            <ActionIcon
              aria-label={copyPgnLabel}
              size={actionIconSize}
              loading={copying}
              onClick={() => void copyCompletePgn()}
            >
              {copied ? <IconCheck size={iconSize} /> : <IconCopy size={iconSize} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={analyzeLabel}>
            <ActionIcon
              aria-label={analyzeLabel}
              size={actionIconSize}
              loading={reportInProgress}
              disabled={root.children.length === 0}
              onClick={() => void analyzeGame()}
            >
              {reportVisible ? <IconList size={iconSize} /> : <IconChartBar size={iconSize} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={invisible ? t("Notation.ShowMoves") : t("Notation.HideMoves")}>
            <ActionIcon size={actionIconSize} onClick={() => setInvisible((v) => !v)}>
              {invisible ? <IconEyeOff size={iconSize} /> : <IconEye size={iconSize} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={tableView ? t("Notation.NormalView") : t("Notation.TableView")}>
            <ActionIcon size={actionIconSize} onClick={() => setTableView((v) => !v)}>
              {tableView ? <IconList size={iconSize} /> : <IconLayoutList size={iconSize} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={showComments ? t("Notation.HideComments") : t("Notation.ShowComments")}>
            <ActionIcon size={actionIconSize} onClick={() => setShowComments((v) => !v)}>
              {showComments ? <IconArticle size={iconSize} /> : <IconArticleOff size={iconSize} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip
            label={showVariations ? t("Notation.HideVariations") : t("Notation.ShowVariations")}
          >
            <ActionIcon size={actionIconSize} onClick={() => setShowVariations((v) => !v)}>
              {showVariations ? (
                <IconArrowsSplit size={iconSize} />
              ) : (
                <IconArrowRight size={iconSize} />
              )}
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <Divider />
    </Stack>
  );
}

function selectLocalAnalysisEngine(engines: Engine[]): LocalEngine | null {
  const loadedLocal = engines.filter(
    (engine): engine is LocalEngine => engine.type === "local" && Boolean(engine.loaded),
  );
  return loadedLocal[0] ?? null;
}

function getReportGoMode(engine: LocalEngine): Exclude<GoMode, { t: "Infinite" | "PlayersTime" }> {
  const go = engine.go;
  if (go?.t === "Depth" || go?.t === "Time" || go?.t === "Nodes") return go;
  return { t: "Time", c: 500 };
}

const RenderVariationTree = memo(
  function RenderVariationTree({
    nodePath,
    depth,
    first,
    targetRef,
    compact = false,
  }: {
    nodePath: number[];
    depth: number;
    first?: boolean;
    targetRef: React.RefObject<HTMLSpanElement | null>;
    compact?: boolean;
  }) {
    const store = useContext(TreeStateContext)!;
    const showVariations = useAtomValue(currentShowVariationsAtom);
    const showComments = useAtomValue(currentShowCommentsAtom);
    const node = useStore(store, (s) => getNodeAtPath(s.root, nodePath));
    const variations = node.children;

    const variationNodes = showVariations
      ? variations.slice(1).map((variation, idx) => {
          const variationIndex = idx + 1;
          const newPath = [...nodePath, variationIndex];
          return (
            <React.Fragment key={variation.fen}>
              <CompleteMoveCell
                targetRef={targetRef}
                annotations={variation.annotations}
                comment={variation.comment}
                halfMoves={variation.halfMoves}
                move={variation.san}
                fen={variation.fen}
                movePath={newPath}
                showComments={showComments}
                first
                compact={compact}
              />
              <RenderVariationTree
                targetRef={targetRef}
                nodePath={newPath}
                depth={depth + 2}
                compact={compact}
              />
            </React.Fragment>
          );
        })
      : [];

    const mainLinePath = [...nodePath, 0];
    return (
      <>
        {variations.length > 0 && (
          <CompleteMoveCell
            targetRef={targetRef}
            annotations={variations[0].annotations}
            comment={variations[0].comment}
            halfMoves={variations[0].halfMoves}
            move={variations[0].san}
            fen={variations[0].fen}
            movePath={mainLinePath}
            showComments={showComments}
            first={first}
            compact={compact}
          />
        )}

        <VariationCell moveNodes={variationNodes} />

        {node.children.length > 0 && (
          <RenderVariationTree
            targetRef={targetRef}
            nodePath={mainLinePath}
            depth={depth + 1}
            compact={compact}
          />
        )}
      </>
    );
  },
  (prev, next) => {
    return (
      equal(prev.nodePath, next.nodePath) &&
      prev.depth === next.depth &&
      prev.first === next.first &&
      prev.compact === next.compact
    );
  },
);

type RowItem = {
  type: "row";
  moveNumber: number;
  whitePathStr: string;
  blackPathStr: string;
  splitRow?: boolean;
};
type VariationItem = {
  type: "variations";
  variationPathStrs: string[];
};
type CommentItem = {
  type: "comment";
  comment: string;
};
type Segment = RowItem | VariationItem | CommentItem;

const tableNotationSegmentCache = new WeakMap<TreeStore, { key: string; segments: Segment[] }>();

function pathKey(path: number[]) {
  return path.join(",");
}

function buildVariationPathStrs(parentPath: number[], count: number) {
  return Array.from({ length: count }, (_, idx) => pathKey([...parentPath, idx + 1]));
}

function getTableNotationSegments({
  store,
  root,
  structureVersion,
  commentVersion,
  showVariations,
  showComments,
  showMoveAnnotations,
}: {
  store: TreeStore;
  root: TreeNode;
  structureVersion: number;
  commentVersion: number;
  showVariations: boolean;
  showComments: boolean;
  showMoveAnnotations: boolean;
}) {
  const key = [
    structureVersion,
    showComments ? commentVersion : 0,
    showVariations ? "vars" : "main",
    showComments ? "comments" : "quiet",
    showMoveAnnotations ? "move-annotations" : "quiet-move-annotations",
  ].join(":");
  const cached = tableNotationSegmentCache.get(store);
  if (cached?.key === key) return cached.segments;

  const segments: Segment[] = [];
  let current = root;
  let path: number[] = [];

  while (current.children.length > 0) {
    const child = current.children[0];
    const childPath = [...path, 0];
    const childPathStr = pathKey(childPath);
    const isWhite = child.halfMoves % 2 === 1;
    const moveNum = Math.ceil(child.halfMoves / 2);
    const whiteVariationCount = Math.max(0, current.children.length - 1);

    if (isWhite) {
      const whiteComment = showMoveAnnotations
        ? child.comment
        : hideMoveQualityComments(child.comment);
      const hasWhiteVars = showVariations && whiteVariationCount > 0;
      const hasWhiteComment = showComments && !!whiteComment;

      let blackNode: TreeNode | null = null;
      let blackPath: number[] = [];
      let blackPathStr = "";
      let blackVariationCount = 0;

      if (child.children.length > 0) {
        const blackChild = child.children[0];
        const bPath = [...childPath, 0];
        if (blackChild.halfMoves % 2 === 0) {
          blackNode = blackChild;
          blackPath = bPath;
          blackPathStr = pathKey(bPath);
          blackVariationCount = Math.max(0, child.children.length - 1);
        }
      }

      const blackComment = blackNode
        ? showMoveAnnotations
          ? blackNode.comment
          : hideMoveQualityComments(blackNode.comment)
        : "";
      const hasBlackVars = showVariations && blackVariationCount > 0;
      const hasBlackComment = showComments && !!blackComment;
      const splitWhite = hasWhiteVars || hasWhiteComment;

      if (splitWhite) {
        segments.push({
          type: "row",
          moveNumber: moveNum,
          whitePathStr: childPathStr,
          blackPathStr: "",
          splitRow: !!blackNode,
        });
        if (hasWhiteComment) {
          segments.push({ type: "comment", comment: whiteComment });
        }
        if (hasWhiteVars) {
          segments.push({
            type: "variations",
            variationPathStrs: buildVariationPathStrs(path, whiteVariationCount),
          });
        }

        if (blackNode) {
          if (hasBlackVars || hasBlackComment) {
            segments.push({
              type: "row",
              moveNumber: moveNum,
              whitePathStr: "",
              blackPathStr,
            });
            if (hasBlackComment) {
              segments.push({ type: "comment", comment: blackComment });
            }
            if (hasBlackVars) {
              segments.push({
                type: "variations",
                variationPathStrs: buildVariationPathStrs(childPath, blackVariationCount),
              });
            }
          } else {
            segments.push({
              type: "row",
              moveNumber: moveNum,
              whitePathStr: "",
              blackPathStr,
            });
          }
          current = blackNode;
          path = blackPath;
        } else {
          current = child;
          path = childPath;
        }
      } else if (hasBlackVars || hasBlackComment) {
        segments.push({
          type: "row",
          moveNumber: moveNum,
          whitePathStr: childPathStr,
          blackPathStr,
        });
        if (hasBlackComment) {
          segments.push({ type: "comment", comment: blackComment });
        }
        if (hasBlackVars) {
          segments.push({
            type: "variations",
            variationPathStrs: buildVariationPathStrs(childPath, blackVariationCount),
          });
        }
        current = blackNode!;
        path = blackPath;
      } else {
        segments.push({
          type: "row",
          moveNumber: moveNum,
          whitePathStr: childPathStr,
          blackPathStr,
        });
        if (blackNode) {
          current = blackNode;
          path = blackPath;
        } else {
          current = child;
          path = childPath;
        }
      }
    } else {
      const blackComment = showMoveAnnotations
        ? child.comment
        : hideMoveQualityComments(child.comment);
      const hasBlackVars = showVariations && whiteVariationCount > 0;
      const hasBlackComment = showComments && !!blackComment;
      segments.push({
        type: "row",
        moveNumber: moveNum,
        whitePathStr: "",
        blackPathStr: childPathStr,
      });
      if (hasBlackComment) {
        segments.push({ type: "comment", comment: blackComment });
      }
      if (hasBlackVars) {
        segments.push({
          type: "variations",
          variationPathStrs: buildVariationPathStrs(path, whiteVariationCount),
        });
      }
      current = child;
      path = childPath;
    }
  }

  tableNotationSegmentCache.set(store, { key, segments });
  return segments;
}

const TableNotation = memo(function TableNotation({
  targetRef,
  compact = false,
}: {
  targetRef: React.RefObject<HTMLSpanElement | null>;
  compact?: boolean;
}) {
  const store = useContext(TreeStateContext)!;
  const showVariations = useAtomValue(currentShowVariationsAtom);
  const showComments = useAtomValue(currentShowCommentsAtom);
  const showMoveAnnotations = useAtomValue(currentShowMoveAnnotationsAtom);
  const segments = useStoreWithEqualityFn(
    store,
    (s) =>
      getTableNotationSegments({
        store,
        root: s.root,
        structureVersion: s.structureVersion ?? 0,
        commentVersion: s.commentVersion ?? 0,
        showVariations,
        showComments,
        showMoveAnnotations,
      }),
    Object.is,
  );

  return (
    <Table layout="fixed">
      <Table.Tbody>
        {segments.map((seg, idx) => {
          if (seg.type === "comment") {
            return (
              <tr key={`comment-${idx}`}>
                <td colSpan={3}>
                  <Box pl="sm" pt="xs">
                    <Comment comment={seg.comment} />
                  </Box>
                </td>
              </tr>
            );
          }

          if (seg.type === "variations") {
            return (
              <tr key={`var-${idx}`}>
                <td colSpan={3}>
                  <Box pl="sm" pt="xs">
                    {seg.variationPathStrs.map((variationPathStr) => (
                      <VariationTableTree
                        key={variationPathStr}
                        targetRef={targetRef}
                        pathStr={variationPathStr}
                        showComments={showComments}
                        compact={compact}
                      />
                    ))}
                  </Box>
                </td>
              </tr>
            );
          }

          return (
            <RowSegment
              key={`row-${idx}`}
              targetRef={targetRef}
              moveNumber={seg.moveNumber}
              whitePathStr={seg.whitePathStr}
              blackPathStr={seg.blackPathStr}
              splitRow={seg.splitRow}
              compact={compact}
            />
          );
        })}
      </Table.Tbody>
    </Table>
  );
});

type MoveNodeView = Pick<
  TreeNode,
  "annotations" | "comment" | "fen" | "halfMoves" | "san" | "score"
>;

function parsePathStr(pathStr: string) {
  return pathStr ? pathStr.split(",").map(Number) : [];
}

function selectMoveNodeView(root: TreeNode, path: number[]): MoveNodeView | null {
  if (path.length === 0) return null;
  const node = getNodeAtPath(root, path);
  if (!node) return null;
  return {
    annotations: node.annotations,
    comment: node.comment,
    fen: node.fen,
    halfMoves: node.halfMoves,
    san: node.san,
    score: node.score,
  };
}

function VariationTableTree({
  pathStr,
  targetRef,
  showComments,
  compact = false,
}: {
  pathStr: string;
  targetRef: React.RefObject<HTMLSpanElement | null>;
  showComments: boolean;
  compact?: boolean;
}) {
  const store = useContext(TreeStateContext)!;
  const variationPath = useMemo(() => parsePathStr(pathStr), [pathStr]);
  const variation = useStoreWithEqualityFn(
    store,
    (s) => selectMoveNodeView(s.root, variationPath),
    equal,
  );

  if (!variation) return null;

  return (
    <Box className={styles.variationBorder} mb={4}>
      <CompleteMoveCell
        targetRef={targetRef}
        annotations={variation.annotations}
        comment={variation.comment}
        halfMoves={variation.halfMoves}
        move={variation.san}
        fen={variation.fen}
        movePath={variationPath}
        showComments={showComments}
        first
        compact={compact}
      />
      <RenderVariationTree
        targetRef={targetRef}
        nodePath={variationPath}
        depth={1}
        compact={compact}
      />
    </Box>
  );
}

function RowSegment({
  moveNumber,
  whitePathStr,
  blackPathStr,
  splitRow,
  targetRef,
  compact = false,
}: {
  moveNumber: number;
  whitePathStr: string;
  blackPathStr: string;
  splitRow?: boolean;
  targetRef: React.RefObject<HTMLSpanElement | null>;
  compact?: boolean;
}) {
  const store = useContext(TreeStateContext)!;
  const showComments = useAtomValue(currentShowCommentsAtom);
  const showMoveAnnotations = useAtomValue(currentShowMoveAnnotationsAtom);
  const whitePath = useMemo(() => parsePathStr(whitePathStr), [whitePathStr]);
  const white = useStoreWithEqualityFn(store, (s) => selectMoveNodeView(s.root, whitePath), equal);
  const blackPath = useMemo(() => parsePathStr(blackPathStr), [blackPathStr]);
  const black = useStoreWithEqualityFn(store, (s) => selectMoveNodeView(s.root, blackPath), equal);
  return (
    <Table.Tr>
      <Table.Td className={styles.moveTableMoveNumber}>{moveNumber}</Table.Td>
      <Table.Td className={styles.moveTableCell}>
        {white ? (
          <CompleteMoveCell
            targetRef={targetRef}
            annotations={white.annotations}
            comment={white.comment}
            halfMoves={white.halfMoves}
            move={white.san}
            fen={white.fen}
            movePath={whitePath}
            showComments={showComments}
            tableLayout
            scoreText={
              showMoveAnnotations && white.score ? formatScore(white.score.value, 1) : undefined
            }
            compact={compact}
          />
        ) : (
          <Text c="dimmed" style={{ padding: "5px 8px" }}>
            ...
          </Text>
        )}
      </Table.Td>
      <Table.Td className={styles.moveTableCell}>
        {black ? (
          <CompleteMoveCell
            targetRef={targetRef}
            annotations={black.annotations}
            comment={black.comment}
            halfMoves={black.halfMoves}
            move={black.san}
            fen={black.fen}
            movePath={blackPath}
            showComments={showComments}
            tableLayout
            scoreText={
              showMoveAnnotations && black.score ? formatScore(black.score.value, 1) : undefined
            }
            compact={compact}
          />
        ) : splitRow ? (
          <Text c="dimmed" style={{ padding: "5px 8px" }}>
            ...
          </Text>
        ) : null}
      </Table.Td>
    </Table.Tr>
  );
}

function VariationCell({ moveNodes }: { moveNodes: React.ReactNode[] }) {
  const [expanded, setExpanded] = useState(true);
  if (moveNodes.length === 0) return null;
  return (
    <Box className={styles.variationBorder}>
      <ActionIcon size="xs" onClick={() => setExpanded((v) => !v)}>
        {expanded ? <IconMinus size="0.5rem" /> : <IconPlus size="0.5rem" />}
      </ActionIcon>
      {expanded &&
        moveNodes.map((node, i) => (
          <Box key={i} className={styles.lineBeforeVariation}>
            {node}
          </Box>
        ))}
    </Box>
  );
}

export default memo(GameNotation);
