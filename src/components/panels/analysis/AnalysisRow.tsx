import type { Key } from "@lichess-org/chessground/types";
import { ActionIcon, Box, CopyButton, Flex, Portal, rem, Table, Tooltip } from "@mantine/core";
import { IconCheck, IconChevronDown, IconCopy } from "@tabler/icons-react";
import { chessgroundMove } from "chessops/compat";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import equal from "fast-deep-equal";
import { useAtom, useAtomValue } from "jotai";
import { memo, useContext, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import type { BestMoveSource, Score } from "@/bindings";
import { Chessground } from "@/chessground/Chessground";
import MoveCell from "@/components/common/MoveCell";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { moveHighlightAtom, previewBoardOnHoverAtom, scoreTypeFamily } from "@/state/atoms";
import { getBestMoveSourceLabel } from "@/utils/analysisSource";
import { positionFromFen } from "@/utils/chessops";
import { formatScore } from "@/utils/score";
import ScoreBubble from "./ScoreBubble";

function AnalysisRow({
  engine,
  score,
  source,
  moves,
  halfMoves,
  threat,
  fen,
  orientation,
  compact = false,
}: {
  engine: string;
  score: Score;
  source?: BestMoveSource;
  moves: string[];
  halfMoves: number;
  threat: boolean;
  fen: string;
  orientation: "white" | "black";
  compact?: boolean;
}) {
  const [open, setOpen] = useState<boolean>(false);
  const { t } = useTranslation();

  const allMoves = moves;
  const engineOutputName = source ? `${engine} (${getBestMoveSourceLabel(source)})` : engine;
  const engineOutput = [engineOutputName, formatScore(score.value), allMoves.join(" ")]
    .filter(Boolean)
    .join(" ");

  const moveInfo = useMemo(() => {
    const visibleMoves = open ? allMoves : allMoves.slice(0, 12);
    const [pos] = positionFromFen(fen);
    const info = [];
    if (pos) {
      for (const san of visibleMoves) {
        const move = parseSan(pos, san);
        if (!move) break;
        pos.play(move);
        const fen = makeFen(pos.toSetup());
        const lastMove = chessgroundMove(move);
        const isCheck = pos.isCheck();
        info.push({ fen, san, lastMove, isCheck });
      }
    }
    return info;
  }, [allMoves, fen, open]);

  const ref = useRef<HTMLTableRowElement>(null);

  const [evalDisplay, setEvalDisplay] = useAtom(scoreTypeFamily(engine));
  const singleLine = compact && !open;

  return (
    <>
      <Table.Tr style={{ verticalAlign: "top" }}>
        <Table.Td
          width={compact ? 48 : 70}
          style={compact ? { padding: "0.15rem 0.2rem" } : undefined}
        >
          <ScoreBubble
            size={compact ? "sm" : "md"}
            score={score}
            evalDisplay={evalDisplay}
            setEvalDisplay={setEvalDisplay}
          />
        </Table.Td>
        <Table.Td style={compact ? { padding: "0.1rem 0.15rem" } : undefined}>
          <Flex
            direction="row"
            wrap={singleLine ? "nowrap" : "wrap"}
            style={{
              height: open ? "100%" : compact ? 25 : 35,
              overflow: "hidden",
              alignItems: "center",
              columnGap: compact ? 2 : undefined,
              fontSize: compact ? "0.78rem" : undefined,
              lineHeight: compact ? 1.15 : undefined,
              whiteSpace: singleLine ? "nowrap" : undefined,
            }}
          >
            {moveInfo.map(({ san, fen, lastMove, isCheck }, index) => (
              <BoardPopover
                anchorRef={ref}
                key={index}
                san={san}
                index={index}
                moves={allMoves}
                halfMoves={halfMoves}
                threat={threat}
                fen={fen}
                orientation={orientation}
                lastMove={lastMove}
                isCheck={isCheck}
                compact={compact}
              />
            ))}
          </Flex>
        </Table.Td>
        <Table.Th
          style={
            compact
              ? {
                  width: "1.8rem",
                  padding: "0.1rem 0.15rem",
                }
              : undefined
          }
        >
          <Flex direction="column" align="center" gap={compact ? 1 : 4}>
            <ActionIcon
              size={compact ? "xs" : "md"}
              style={{
                transition: "transform 200ms ease",
                transform: open ? "rotate(180deg)" : "none",
              }}
              onClick={() => setOpen(!open)}
            >
              <IconChevronDown size={compact ? 13 : 16} />
            </ActionIcon>
            {open && (
              <CopyButton value={engineOutput} timeout={2000}>
                {({ copied, copy }) => (
                  <Tooltip
                    label={copied ? t("Common.Copied") : t("Menu.Edit.Copy")}
                    withArrow
                    position="right"
                  >
                    <ActionIcon
                      color={copied ? "teal" : undefined}
                      variant="subtle"
                      onClick={copy}
                      aria-label={copied ? t("Common.Copied") : t("Menu.Edit.Copy")}
                      size={compact ? "xs" : "md"}
                    >
                      {copied ? (
                        <IconCheck style={{ width: rem(compact ? 13 : 16) }} />
                      ) : (
                        <IconCopy style={{ width: rem(compact ? 13 : 16) }} />
                      )}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            )}
          </Flex>
        </Table.Th>
      </Table.Tr>
      <Table.Tr ref={ref} />
    </>
  );
}

function BoardPopover({
  san,
  lastMove,
  isCheck,
  index,
  moves,
  halfMoves,
  threat,
  fen,
  orientation,
  anchorRef,
  compact = false,
}: {
  san: string;
  lastMove: Key[];
  isCheck: boolean;
  index: number;
  moves: string[];
  halfMoves: number;
  threat: boolean;
  fen: string;
  orientation: "white" | "black";
  anchorRef: React.RefObject<HTMLTableRowElement | null>;
  compact?: boolean;
}) {
  const total_moves = halfMoves + index + 1 + (threat ? 1 : 0);
  const is_white = total_moves % 2 === 1;
  const move_number = Math.ceil(total_moves / 2);
  const store = useContext(TreeStateContext)!;
  const makeMoves = useStore(store, (s) => s.makeMoves);
  const preview = useAtomValue(previewBoardOnHoverAtom);
  const moveHighlight = useAtomValue(moveHighlightAtom);

  const [hovering, setHovering] = useState(false);
  // Read the anchor position once when the hover starts instead of on every
  // render: getClientRects during render forces a synchronous layout for each
  // move cell, which makes the whole panel stutter while engines stream lines.
  const [position, setPosition] = useState({ left: 0, top: 0 });

  return (
    <>
      <Box
        onMouseEnter={() => {
          const rect = anchorRef.current?.getBoundingClientRect();
          setPosition({ left: rect?.left ?? 0, top: rect?.top ?? 0 });
          setHovering(true);
        }}
        onMouseLeave={() => setHovering(false)}
        style={
          compact
            ? {
                flex: "0 0 auto",
                fontSize: "0.72rem",
                lineHeight: 1.15,
                whiteSpace: "nowrap",
              }
            : undefined
        }
      >
        {(index === 0 || is_white) && `${move_number.toString()}${is_white ? "." : "..."}`}
        <MoveCell
          move={san}
          compact={compact}
          isCurrentVariation={false}
          annotations={[]}
          onContextMenu={() => undefined}
          isStart={false}
          onClick={() => {
            if (!threat) {
              makeMoves({ payload: moves.slice(0, index + 1) });
            }
          }}
        />
      </Box>
      {preview && hovering && (
        <Portal>
          <Box
            w={200}
            style={{
              top: position.top,
              left: position.left,
            }}
            pos="fixed"
          >
            <Chessground
              fen={fen}
              coordinates={false}
              viewOnly
              orientation={orientation}
              lastMove={moveHighlight ? lastMove : undefined}
              turnColor={is_white ? "black" : "white"}
              check={moveHighlight && isCheck}
              drawable={{
                enabled: true,
                visible: true,
                defaultSnapToValidMove: true,
                eraseOnMovablePieceClick: true,
              }}
            />
          </Box>
        </Portal>
      )}
    </>
  );
}

export default memo(AnalysisRow, (prev, next) => {
  return (
    prev.engine === next.engine &&
    prev.source === next.source &&
    prev.halfMoves === next.halfMoves &&
    prev.threat === next.threat &&
    prev.fen === next.fen &&
    prev.orientation === next.orientation &&
    prev.compact === next.compact &&
    equal(prev.score, next.score) &&
    equal(prev.moves, next.moves)
  );
});
