import { ActionIcon, Box, Menu, Portal, Text, Tooltip } from "@mantine/core";
import { useClickOutside } from "@mantine/hooks";
import {
  IconArrowsJoin,
  IconChevronsUp,
  IconChevronUp,
  IconCopy,
  IconFlag,
  IconPencil,
  IconX,
} from "@tabler/icons-react";
import equal from "fast-deep-equal";
import { useAtomValue } from "jotai";
import { memo, useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { useStoreWithEqualityFn } from "zustand/traditional";
import Comment from "@/components/common/Comment";
import MoveAnnotationPanel from "@/components/panels/annotation/MoveAnnotationPanel";
import { currentTabAtom } from "@/state/atoms";
import type { TreeStore } from "@/state/store/tree";
import type { Annotation } from "@/utils/annotation";
import { hasMorePriority, stripClock } from "@/utils/chess";
import { formatMoveThinkTime, getMoveThinkTime } from "@/utils/clock";
import { getTabFile } from "@/utils/tabs";
import { type TreeNode, treeIterator } from "@/utils/treeReducer";
import MoveCell from "./MoveCell";
import moveCellStyles from "./MoveCell.module.css";
import { TreeStateContext } from "./TreeStateContext";

const transpositionCache = new WeakMap<
  TreeStore,
  { structureVersion: number; map: Map<string, number[][]> }
>();

function getTranspositionMap(root: TreeNode, structureVersion: number, store: TreeStore) {
  const cached = transpositionCache.get(store);
  if (cached?.structureVersion === structureVersion) {
    return cached.map;
  }

  const map = new Map<string, number[][]>();
  const iterator = treeIterator(root);

  for (const item of iterator) {
    const strippedFen = stripClock(item.node.fen);
    if (!map.has(strippedFen)) {
      map.set(strippedFen, []);
    }
    map.get(strippedFen)!.push(item.position);
  }

  transpositionCache.set(store, { structureVersion, map });
  return map;
}

function getTranspositions(
  fen: string,
  position: number[],
  root: TreeNode,
  structureVersion: number,
  store: TreeStore,
) {
  if (position.length === 0 || position.every((v) => v === 0)) return [];

  const map = getTranspositionMap(root, structureVersion, store);
  const strippedFen = stripClock(fen);

  const matchingPositions = map.get(strippedFen) || [];

  return matchingPositions.filter((targetPosition) => !hasMorePriority(position, targetPosition));
}

function CompleteMoveCell({
  movePath,
  halfMoves,
  move,
  fen,
  comment,
  annotations,
  showComments,
  first,
  targetRef,
  tableLayout,
  scoreText,
}: {
  halfMoves: number;
  comment: string;
  annotations: Annotation[];
  showComments: boolean;
  move?: string | null;
  fen?: string;
  first?: boolean;
  movePath: number[];
  targetRef: React.RefObject<HTMLSpanElement | null>;
  tableLayout?: boolean;
  scoreText?: string;
}) {
  const store = useContext(TreeStateContext)!;
  const isStart = useStore(store, (s) => equal(movePath, s.headers.start));

  const isCurrentVariation = useStore(store, (s) => equal(s.position, movePath));
  const transpositions = useStoreWithEqualityFn(
    store,
    (s) => (fen ? getTranspositions(fen, movePath, s.root, s.structureVersion ?? 0, store) : []),
    (a, b) => equal(a, b),
  );
  const goToMove = useStore(store, (s) => s.goToMove);
  const deleteMove = useStore(store, (s) => s.deleteMove);
  const promoteVariation = useStore(store, (s) => s.promoteVariation);
  const promoteToMainline = useStore(store, (s) => s.promoteToMainline);
  const copyVariationPgn = useStore(store, (s) => s.copyVariationPgn);
  const setStart = useStore(store, (s) => s.setStart);

  const moveNumber = Math.ceil(halfMoves / 2);
  const isWhite = halfMoves % 2 === 1;
  const hasNumber = !tableLayout && halfMoves > 0 && (first || isWhite);
  const ref = useClickOutside(() => {
    setOpen(false);
  });
  const [open, setOpen] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const currentTab = useAtomValue(currentTabAtom);
  const tabFile = getTabFile(currentTab);
  const moveTiming = useStoreWithEqualityFn(
    store,
    (s) => getMoveThinkTime({ headers: s.headers, root: s.root, movePath }),
    equal,
  );
  const moveThinkTime = moveTiming ? formatMoveThinkTime(moveTiming.moveTimeSeconds) : null;
  const rightAccessory =
    scoreText || moveThinkTime ? (
      <>
        {scoreText && (
          <Text component="span" size="xs" c="dimmed">
            {scoreText}
          </Text>
        )}
        {moveThinkTime && (
          <Text
            component="span"
            className={moveCellStyles.thinkTime}
            title={`Spent ${moveThinkTime} on this move`}
          >
            {moveThinkTime}
          </Text>
        )}
      </>
    ) : undefined;

  const { t } = useTranslation();

  return (
    <>
      <Box
        ref={isCurrentVariation ? targetRef : undefined}
        component="span"
        style={{
          display: tableLayout ? "block" : "inline-block",
          marginLeft: hasNumber ? 6 : 0,
          fontSize: "80%",
          width: tableLayout ? "100%" : undefined,
        }}
      >
        {hasNumber && `${moveNumber.toString()}${isWhite ? "." : "..."}`}
        {move && (
          <Menu opened={open} width={200}>
            <Menu.Target>
              <MoveCell
                ref={ref}
                move={move}
                annotations={annotations}
                isStart={isStart}
                isCurrentVariation={isCurrentVariation}
                onClick={() => goToMove(movePath)}
                onContextMenu={(e: React.MouseEvent) => {
                  setOpen((v) => !v);
                  e.preventDefault();
                  e.stopPropagation();
                }}
                fullWidth={tableLayout}
                rightAccessory={rightAccessory}
              />
            </Menu.Target>

            <Portal>
              <Menu.Dropdown>
                {tabFile?.metadata.type === "repertoire" && (
                  <Menu.Item
                    leftSection={<IconFlag size="0.875rem" />}
                    onClick={() => setStart(movePath)}
                  >
                    {t("Menu.MarkAsStart")}
                  </Menu.Item>
                )}
                <Menu.Item
                  leftSection={<IconPencil size="0.875rem" />}
                  onClick={() => {
                    goToMove(movePath);
                    setAnnotating(true);
                    setOpen(false);
                  }}
                >
                  {t("Board.Tabs.Annotate")}
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconChevronsUp size="0.875rem" />}
                  onClick={() => promoteToMainline(movePath)}
                >
                  {t("Menu.PromoteToMainLine")}
                </Menu.Item>

                <Menu.Item
                  leftSection={<IconChevronUp size="0.875rem" />}
                  onClick={() => promoteVariation(movePath)}
                >
                  {t("Menu.PromoteVariation")}
                </Menu.Item>

                <Menu.Item
                  leftSection={<IconCopy size="0.875rem" />}
                  onClick={() => copyVariationPgn(movePath)}
                >
                  {t("Menu.CopyVariationPGN")}
                </Menu.Item>

                <Menu.Item
                  color="red"
                  leftSection={<IconX size="0.875rem" />}
                  onClick={() => deleteMove(movePath)}
                >
                  {t("Menu.DeleteMove")}
                </Menu.Item>
              </Menu.Dropdown>
            </Portal>
          </Menu>
        )}
        {transpositions.length > 0 && (
          <Tooltip label="Transposition">
            <ActionIcon size="xs" onClick={() => goToMove(transpositions[0])}>
              <IconArrowsJoin size="0.875rem" />
            </ActionIcon>
          </Tooltip>
        )}
      </Box>
      {annotating && move && (
        <MoveAnnotationPanel path={movePath} onClose={() => setAnnotating(false)} />
      )}
      {showComments && !tableLayout && comment && <Comment comment={comment} />}
    </>
  );
}

export default memo(CompleteMoveCell, (prev, next) => {
  return (
    prev.move === next.move &&
    prev.fen === next.fen &&
    prev.comment === next.comment &&
    equal(prev.annotations, next.annotations) &&
    prev.showComments === next.showComments &&
    prev.first === next.first &&
    equal(prev.movePath, next.movePath) &&
    prev.halfMoves === next.halfMoves &&
    prev.tableLayout === next.tableLayout &&
    prev.scoreText === next.scoreText
  );
});
