import { Box, Group, Stack } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { useContext } from "react";
import useSWRImmutable from "swr/immutable";
import { useStore } from "zustand";
import { Chessground } from "@/chessground/Chessground";
import { parsePGN } from "@/utils/chess";
import { pgnOrientation } from "@/utils/pgnOrientation";
import { type GameHeaders, getNodeAtPath, type TreeState } from "@/utils/treeReducer";
import GameNotation from "../common/GameNotation";
import MoveControls from "../common/MoveControls";
import OpeningName from "../common/OpeningName";
import { TreeStateContext, TreeStateProvider } from "../common/TreeStateContext";

function GamePreviewWrapper({
  pgn,
  headers,
  hideControls,
  showOpening,
}: {
  pgn: string;
  headers?: GameHeaders;
  hideControls?: boolean;
  showOpening?: boolean;
}) {
  const { data: parsedGame } = useSWRImmutable([pgn, headers?.fen], async ([pgn, fen]) => {
    return await parsePGN(pgn, fen);
  });

  return (
    <>
      {parsedGame && (
        <GamePreview
          key={pgn}
          game={parsedGame}
          hideControls={hideControls}
          showOpening={showOpening}
          orientation={headers?.orientation}
        />
      )}
    </>
  );
}

export function GamePreview({
  game,
  hideControls,
  showOpening,
  orientation,
}: {
  game: TreeState;
  hideControls?: boolean;
  showOpening?: boolean;
  orientation?: "white" | "black";
}) {
  const { ref, width, height } = useElementSize();
  const narrow = !hideControls && width > 0 && width < 560;
  const boardSize =
    width > 0 && height > 0
      ? Math.min(narrow ? height / 2 : height, hideControls || narrow ? width : width / 2)
      : undefined;

  return (
    <TreeStateProvider initial={game}>
      {showOpening && <OpeningName />}
      <Group
        ref={ref}
        align={narrow ? "stretch" : "end"}
        wrap="nowrap"
        justify={narrow ? "start" : hideControls ? "center" : undefined}
        style={{
          overflow: "hidden",
          height: "100%",
          minHeight: 0,
          width: "100%",
          flexDirection: narrow ? "column" : "row",
        }}
      >
        <Box
          style={{
            width: boardSize ?? (hideControls ? "100%" : "50%"),
            flexShrink: 0,
            alignSelf: narrow ? "center" : undefined,
          }}
        >
          <PreviewBoard orientation={orientation} />
        </Box>
        {!hideControls && (
          <Stack
            style={{ height: narrow ? undefined : boardSize, flex: 1, minWidth: 0, minHeight: 0 }}
            gap="xs"
          >
            <GameNotation readOnly forceDetails />
            <MoveControls readOnly isolated compact={narrow} />
          </Stack>
        )}
      </Group>
    </TreeStateProvider>
  );
}

function PreviewBoard({ orientation }: { orientation?: "white" | "black" }) {
  const store = useContext(TreeStateContext)!;
  const goToNext = useStore(store, (s) => s.goToNext);
  const goToPrevious = useStore(store, (s) => s.goToPrevious);
  const root = useStore(store, (s) => s.root);
  const position = useStore(store, (s) => s.position);
  const headers = useStore(store, (s) => s.headers);
  const node = getNodeAtPath(root, position);
  const fen = node.fen;

  return (
    <Box
      onWheel={(e) => {
        if (e.deltaY > 0) {
          goToNext();
        } else {
          goToPrevious();
        }
      }}
    >
      <Chessground
        coordinates={false}
        viewOnly={true}
        fen={fen}
        orientation={pgnOrientation(root.fen, orientation ?? headers.orientation)}
        drawable={{ enabled: false, visible: true, shapes: node.shapes }}
      />
    </Box>
  );
}

export default GamePreviewWrapper;
