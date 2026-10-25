import { GameDateRangeControl } from "@/components/common/GameDateRangeControl";
import { applyLocalGameDates, storedGameDateRange } from "@/utils/gameDateRange";
import {
  Box,
  Button,
  Group,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { type Piece, parseSquare } from "chessops";
import { EMPTY_BOARD_FEN, makeFen, parseFen } from "chessops/fen";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Chessground } from "@/chessground/Chessground";
import PiecesGrid from "@/components/boards/PiecesGrid";
import type { LocalOptions } from "../DatabasePanel";
import { DatabasePerspectiveControls } from "../DatabasePerspectiveControls";

function LocalOptionsPanel({
  boardFen,
  options,
  setOptions,
}: {
  boardFen: string;
  options: LocalOptions;
  setOptions: (value: LocalOptions | ((current: LocalOptions) => LocalOptions)) => void;
}) {
  const { t } = useTranslation();
  const boardRef = useRef(null);

  const setSimilarStructure = async (fen: string) => {
    const setup = parseFen(fen).unwrap();
    for (const square of setup.board.pawn.complement()) {
      setup.board.take(square);
    }
    const fenResult = makeFen(setup);
    setOptions((q) => ({ ...q, type: "partial", fen: fenResult }));
  };

  const [selectedPiece, setSelectedPiece] = useState<Piece | null>(null);

  return (
    <Stack>
      <GameDateRangeControl
        value={storedGameDateRange(options.dateRange, options.start_date, options.end_date)}
        precision="day"
        onChange={(dateRange) =>
          setOptions((current) => applyLocalGameDates({ ...current, dateRange }))
        }
      />
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Stack gap={4}>
          <Text fw="bold" fz="sm">
            Player perspective
          </Text>
          <DatabasePerspectiveControls
            databasePath={options.path}
            player={options.player}
            playerName={options.playerName}
            color={options.color}
            onPlayerChange={(player) => setOptions((q) => ({ ...q, player }))}
            onPlayerNameChange={(playerName) => setOptions((q) => ({ ...q, playerName }))}
            onColorChange={(color) => setOptions((q) => ({ ...q, color }))}
            size="sm"
            playerWidth={220}
            colorWidth={150}
          />
        </Stack>

        <Stack gap={4}>
          <Text fw="bold" fz="sm">
            {t("Board.Database.Local.Result")}
          </Text>
          <Select
            data={[
              { value: "any", label: t("Board.Database.Local.Result.Any") },
              {
                value: "whitewon",
                label: t("Board.Database.Local.Result.WhiteWon"),
              },
              { value: "draw", label: t("Board.Analysis.Tablebase.Draw") },
              {
                value: "blackwon",
                label: t("Board.Database.Local.Result.BlackWon"),
              },
            ]}
            value={options.result}
            onChange={(v) =>
              setOptions({
                ...options,
                result: v as "any" | "whitewon" | "draw" | "blackwon",
              })
            }
          />
        </Stack>
      </SimpleGrid>

      <Stack gap={4}>
        <Text fw="bold" fz="sm">
          {t("Board.Database.Local.Position")}
        </Text>
        <SegmentedControl
          data={[
            { value: "exact", label: t("Board.Database.Local.Exact") },
            { value: "partial", label: t("Board.Database.Local.Partial") },
          ]}
          value={options.type}
          onChange={(v) => setOptions({ ...options, type: v as "exact" | "partial" })}
        />
      </Stack>

      <Group>
        <Stack>
          <Box ref={boardRef}>
            <Chessground
              fen={options.fen}
              coordinates={false}
              lastMove={[]}
              movable={{
                free: true,
                color: "both",
                events: {
                  after: (orig, dest) => {
                    const setup = parseFen(options.fen).unwrap();
                    const p = setup.board.take(parseSquare(orig)!)!;
                    setup.board.set(parseSquare(dest)!, p);
                    setOptions((q) => ({ ...q, fen: makeFen(setup) }));
                  },
                },
              }}
              events={{
                select: (key) => {
                  const square = parseSquare(key);
                  if (square && selectedPiece) {
                    const setup = parseFen(options.fen).unwrap();
                    setup.board.set(square, selectedPiece);
                    setOptions((q) => ({ ...q, fen: makeFen(setup) }));
                  }
                },
              }}
            />
          </Box>

          <Group>
            <Button
              variant="default"
              onClick={() => {
                setOptions((q) => ({ ...q, type: "exact", fen: boardFen }));
              }}
            >
              {t("Board.Database.Local.CurrentPosition")}
            </Button>
            <Button
              variant="default"
              onClick={() => {
                setSimilarStructure(boardFen);
              }}
            >
              {t("Board.Database.Local.SimilarStructure")}
            </Button>
            <Button
              variant="default"
              onClick={() => {
                setOptions((q) => ({
                  ...q,
                  type: "partial",
                  fen: EMPTY_BOARD_FEN,
                }));
              }}
            >
              {t("Fen.Empty")}
            </Button>
          </Group>
        </Stack>

        <Box flex={1} style={{ display: "flex", flexDirection: "column" }} h="30rem">
          <PiecesGrid
            boardRef={boardRef}
            fen={options.fen}
            vertical
            onPut={(newFen) => {
              setOptions((q) => ({ ...q, fen: newFen }));
            }}
            onSelectPiece={setSelectedPiece}
            selectedPiece={selectedPiece}
          />
        </Box>
      </Group>
    </Stack>
  );
}

export default LocalOptionsPanel;
