import {
  ActionIcon,
  Box,
  Divider,
  Group,
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
  IconCheck,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconLayoutList,
  IconList,
  IconMinus,
  IconPlus,
} from "@tabler/icons-react";
import { INITIAL_FEN } from "chessops/fen";
import equal from "fast-deep-equal";
import { useAtom, useAtomValue } from "jotai";
import React, { memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { useStoreWithEqualityFn } from "zustand/traditional";
import Comment from "@/components/common/Comment";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  currentInvisibleAtom,
  currentShowCommentsAtom,
  currentShowVariationsAtom,
  currentTabAtom,
  tableViewAtom,
} from "@/state/atoms";
import { keyMapAtom } from "@/state/keybinds";
import { commands } from "@/bindings";
import { getPGN } from "@/utils/chess";
import { formatScore } from "@/utils/score";
import { getTabFile, getTabGameNumber } from "@/utils/tabs";
import { getNodeAtPath, type TreeNode } from "@/utils/treeReducer";
import type { TreeStore } from "@/state/store/tree";
import CompleteMoveCell from "./CompleteMoveCell";
import styles from "./GameNotation.module.css";
import OpeningName from "./OpeningName";

function GameNotation({
  topBar,
  controls,
  className,
  compact = false,
  grow = true,
}: {
  topBar?: boolean;
  controls?: React.ReactNode;
  className?: string;
  compact?: boolean;
  grow?: boolean;
}) {
  const store = useContext(TreeStateContext)!;
  const currentFen = useStore(store, (s) => s.currentNode().fen);
  const headers = useStore(store, (s) => s.headers);
  const rootComment = useStore(store, (s) => s.root.comment);

  const viewport = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (viewport.current) {
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
    }
  }, [currentFen]);

  const [invisibleValue, setInvisible] = useAtom(currentInvisibleAtom);
  const invisible = topBar && invisibleValue;
  const showComments = useAtomValue(currentShowCommentsAtom);
  const tableView = useAtomValue(tableViewAtom);
  const colorScheme = useColorScheme();

  const keyMap = useAtomValue(keyMapAtom);
  useHotkeys(keyMap.TOGGLE_BLUR.keys, () => setInvisible((v) => !v));

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
            <ScrollArea type="never" py="md" mx="xs" style={{ flexShrink: 0 }}>
              {controls}
            </ScrollArea>
            <Divider orientation="vertical" />
          </>
        )}
        <Stack h="100%" gap={0} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          {topBar && <NotationHeader compact={compact} />}
          <ScrollArea
            flex={1}
            offsetScrollbars
            scrollbars="y"
            viewportRef={viewport}
            style={{ minHeight: 0 }}
          >
            <Stack gap="xs">
              <Box>
                {invisible && (
                  <Overlay
                    backgroundOpacity={0.6}
                    color={colorScheme === "dark" ? "#1a1b1e" : undefined}
                    blur={8}
                    zIndex={2}
                  />
                )}
                {showComments && rootComment && (
                  <Box p="sm" fz="sm">
                    <Comment comment={rootComment} />
                  </Box>
                )}
                {tableView ? (
                  <TableNotation targetRef={targetRef} />
                ) : (
                  <Box pt={compact ? 6 : "md"} px="sm">
                    <RenderVariationTree targetRef={targetRef} nodePath={[]} depth={0} first />
                  </Box>
                )}
              </Box>
              <Box pb={compact ? 6 : "md"}>
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
            </Stack>
          </ScrollArea>
        </Stack>
      </Group>
    </Paper>
  );
}

function NotationHeader({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const headers = useStore(store, (s) => s.headers);
  const dirty = useStore(store, (s) => s.dirty);
  const currentTab = useAtomValue(currentTabAtom);
  const [invisible, setInvisible] = useAtom(currentInvisibleAtom);
  const [showComments, setShowComments] = useAtom(currentShowCommentsAtom);
  const [showVariations, setShowVariations] = useAtom(currentShowVariationsAtom);
  const [tableView, setTableView] = useAtom(tableViewAtom);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimeout = useRef<number | null>(null);

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

  const copyPgnLabel = copied ? t("Common.Copied") : `${t("Menu.Edit.Copy") || "Copy"} PGN`;

  return (
    <Stack gap={compact ? 4 : "xs"} pt={compact ? 5 : "xs"}>
      <Group justify="space-between" px="sm">
        <OpeningName />
        <Group gap="sm">
          <Tooltip label={copyPgnLabel}>
            <ActionIcon
              aria-label={copyPgnLabel}
              loading={copying}
              onClick={() => void copyCompletePgn()}
            >
              {copied ? <IconCheck size="1rem" /> : <IconCopy size="1rem" />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={invisible ? t("Notation.ShowMoves") : t("Notation.HideMoves")}>
            <ActionIcon onClick={() => setInvisible((v) => !v)}>
              {invisible ? <IconEyeOff size="1rem" /> : <IconEye size="1rem" />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={tableView ? t("Notation.NormalView") : t("Notation.TableView")}>
            <ActionIcon onClick={() => setTableView((v) => !v)}>
              {tableView ? <IconList size="1rem" /> : <IconLayoutList size="1rem" />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={showComments ? t("Notation.HideComments") : t("Notation.ShowComments")}>
            <ActionIcon onClick={() => setShowComments((v) => !v)}>
              {showComments ? <IconArticle size="1rem" /> : <IconArticleOff size="1rem" />}
            </ActionIcon>
          </Tooltip>
          <Tooltip
            label={showVariations ? t("Notation.HideVariations") : t("Notation.ShowVariations")}
          >
            <ActionIcon onClick={() => setShowVariations((v) => !v)}>
              {showVariations ? <IconArrowsSplit size="1rem" /> : <IconArrowRight size="1rem" />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <Divider />
    </Stack>
  );
}

const RenderVariationTree = memo(
  function RenderVariationTree({
    nodePath,
    depth,
    first,
    targetRef,
  }: {
    nodePath: number[];
    depth: number;
    first?: boolean;
    targetRef: React.RefObject<HTMLSpanElement | null>;
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
              />
              <RenderVariationTree targetRef={targetRef} nodePath={newPath} depth={depth + 2} />
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
          />
        )}

        <VariationCell moveNodes={variationNodes} />

        {node.children.length > 0 && (
          <RenderVariationTree targetRef={targetRef} nodePath={mainLinePath} depth={depth + 1} />
        )}
      </>
    );
  },
  (prev, next) => {
    return (
      equal(prev.nodePath, next.nodePath) && prev.depth === next.depth && prev.first === next.first
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
}: {
  store: TreeStore;
  root: TreeNode;
  structureVersion: number;
  commentVersion: number;
  showVariations: boolean;
  showComments: boolean;
}) {
  const key = [
    structureVersion,
    showComments ? commentVersion : 0,
    showVariations ? "vars" : "main",
    showComments ? "comments" : "quiet",
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
      const hasWhiteVars = showVariations && whiteVariationCount > 0;
      const hasWhiteComment = showComments && !!child.comment;

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

      const hasBlackVars = showVariations && blackVariationCount > 0;
      const hasBlackComment = showComments && !!blackNode?.comment;
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
          segments.push({ type: "comment", comment: child.comment });
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
              segments.push({ type: "comment", comment: blackNode.comment });
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
          segments.push({ type: "comment", comment: blackNode!.comment });
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
      const hasBlackVars = showVariations && whiteVariationCount > 0;
      const hasBlackComment = showComments && !!child.comment;
      segments.push({
        type: "row",
        moveNumber: moveNum,
        whitePathStr: "",
        blackPathStr: childPathStr,
      });
      if (hasBlackComment) {
        segments.push({ type: "comment", comment: child.comment });
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
}: {
  targetRef: React.RefObject<HTMLSpanElement | null>;
}) {
  const store = useContext(TreeStateContext)!;
  const showVariations = useAtomValue(currentShowVariationsAtom);
  const showComments = useAtomValue(currentShowCommentsAtom);
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
}: {
  pathStr: string;
  targetRef: React.RefObject<HTMLSpanElement | null>;
  showComments: boolean;
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
      />
      <RenderVariationTree targetRef={targetRef} nodePath={variationPath} depth={1} />
    </Box>
  );
}

function RowSegment({
  moveNumber,
  whitePathStr,
  blackPathStr,
  splitRow,
  targetRef,
}: {
  moveNumber: number;
  whitePathStr: string;
  blackPathStr: string;
  splitRow?: boolean;
  targetRef: React.RefObject<HTMLSpanElement | null>;
}) {
  const store = useContext(TreeStateContext)!;
  const showComments = useAtomValue(currentShowCommentsAtom);
  const whitePath = useMemo(() => parsePathStr(whitePathStr), [whitePathStr]);
  const white = useStoreWithEqualityFn(
    store,
    (s) => selectMoveNodeView(s.root, whitePath),
    equal,
  );
  const blackPath = useMemo(() => parsePathStr(blackPathStr), [blackPathStr]);
  const black = useStoreWithEqualityFn(
    store,
    (s) => selectMoveNodeView(s.root, blackPath),
    equal,
  );
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
            scoreText={showComments && white.score ? formatScore(white.score.value, 1) : undefined}
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
            scoreText={showComments && black.score ? formatScore(black.score.value, 1) : undefined}
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
