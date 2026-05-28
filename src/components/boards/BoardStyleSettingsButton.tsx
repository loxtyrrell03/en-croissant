import { ActionIcon, Badge, Popover, Stack, Text } from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import BoardStyleControl from "@/components/common/BoardStyleControl";
import { boardStyleAtom } from "@/state/atoms";
import { isChessComBoardStyle } from "@/utils/boardStyle";
import classes from "@/styles/Chessboard.module.css";

export default function BoardStyleSettingsButton() {
  const boardStyle = useAtomValue(boardStyleAtom);
  const chessComStyle = isChessComBoardStyle(boardStyle);

  return (
    <Popover width={300} position="bottom-end" shadow="md" withinPortal>
      <Popover.Target>
        <ActionIcon
          className={classes.boardSettingsButton}
          data-active={chessComStyle || undefined}
          aria-label="Board style settings"
          title="Board style settings"
          variant="filled"
          color={chessComStyle ? "green" : "gray"}
          size="sm"
        >
          <IconSettings size={16} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <Stack gap={2}>
            <Text size="sm" fw={700}>
              Board style
            </Text>
            <Text size="xs" c="dimmed">
              Switch the board, pieces, arrows, highlights, and move sounds together.
            </Text>
          </Stack>
          <BoardStyleControl fullWidth size="xs" />
          {chessComStyle && (
            <Badge color="green" variant="light" w="fit-content">
              Chess.com style active
            </Badge>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
