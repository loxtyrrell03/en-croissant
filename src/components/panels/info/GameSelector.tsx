import type { PgnGameListEntry } from "@/utils/pgnGameList";
import { ActionIcon, Box, Button, Group, ScrollArea, Stack, Text } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import cx from "clsx";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pgnFiles } from "@/bindings/pgnFiles";
import { pgnGameListKey } from "@/utils/pgnGameList";
import ConfirmModal from "@/components/common/ConfirmModal";
import { fontSizeAtom } from "@/state/atoms";
import { parsePGN } from "@/utils/chess";
import { formatNumber } from "@/utils/format";
import { getGameName } from "@/utils/treeReducer";
import classes from "./GameSelector.module.css";

export default function GameSelector({
  games,
  setGames,
  setPage,
  total,
  path,
  activePage,
  deleteGame,
  version = 0,
  onCountChange,
}: {
  games: Map<number, PgnGameListEntry>;
  setGames: React.Dispatch<React.SetStateAction<Map<number, PgnGameListEntry>>>;
  setPage: (v: number, identity?: string) => void;
  total: number;
  path: string;
  activePage: number;
  deleteGame?: (index: number, identity: string) => Promise<boolean>;
  version?: string | number;
  onCountChange?: (count: number) => void;
}) {
  const [retry, setRetry] = useState(0);
  const sourceKey = pgnGameListKey(path, `${version}:${retry}`, total);
  const session = useMemo(
    () => ({ key: sourceKey, active: true, failed: false, pending: new Set<number>() }),
    [sourceKey],
  );
  const currentSession = useRef(session);
  currentSession.current = session;
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  useEffect(() => {
    session.active = true;
    return () => {
      session.active = false;
    };
  }, [session]);
  const owns = useCallback(() => session.active && currentSession.current === session, [session]);
  const entry = (index: number) =>
    games.get(index)?.sourceKey === sourceKey ? games.get(index) : undefined;
  const loadMoreRows = useCallback(
    async (startIndex: number, stopIndex: number) => {
      if (!owns() || session.failed || total <= 0) return;
      const needed: number[] = [];
      for (let index = Math.max(0, startIndex); index <= Math.min(total - 1, stopIndex); index++) {
        if (games.get(index)?.sourceKey !== sourceKey && !session.pending.has(index))
          needed.push(index);
      }
      const ranges: number[][] = [];
      for (const index of needed) {
        const last = ranges.at(-1);
        if (last && last.length < 4 && last.at(-1) === index - 1) last.push(index);
        else ranges.push([index]);
        session.pending.add(index);
      }
      await Promise.all(
        ranges.map(async (range) => {
          try {
            const batch = await pgnFiles.readBatch(path, range[0], range.at(-1)!);
            if (!owns()) return;
            if (batch.gameCount !== total && onCountChange) {
              onCountChange(batch.gameCount);
              return;
            }
            const rows = await Promise.all(
              batch.games.map(async (snapshot) => ({
                index: snapshot.index,
                identity: snapshot.identity,
                sourceKey,
                name: getGameName((await parsePGN(snapshot.pgn)).headers),
              })),
            );
            if (!owns()) return;
            if (rows.length !== range.length)
              throw new Error("The PGN changed. Reload the file's game list.");
            setGames((previous) => {
              if (!owns()) return previous;
              const next = new Map(previous);
              for (const row of rows)
                next.set(row.index, { name: row.name, identity: row.identity, sourceKey });
              return next;
            });
          } catch (error) {
            if (owns()) {
              session.failed = true;
              setError({ key: sourceKey, message: String(error) });
            }
          } finally {
            for (const index of range) session.pending.delete(index);
          }
        }),
      );
    },
    [games, onCountChange, owns, path, session, setGames, sourceKey, total],
  );

  const fontSize = useAtomValue(fontSizeAtom);

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: total,
    estimateSize: () => 30 * (fontSize / 100),
    getScrollElement: () => parentRef.current!,
  });

  const visible = rowVirtualizer.getVirtualItems();
  const first = visible[0]?.index ?? 0;
  const last = visible.at(-1)?.index ?? Math.min(10, total - 1);
  useEffect(() => {
    void loadMoreRows(first, last);
  }, [first, last, loadMoreRows, retry]);

  return (
    <Stack h="100%" gap={4} style={{ minHeight: 0 }}>
      {error?.key === sourceKey && (
        <Group gap="xs" wrap="nowrap" role="alert">
          <Text c="red" size="xs" style={{ overflowWrap: "anywhere" }}>
            {error.message}
          </Text>
          <Button
            size="compact-xs"
            variant="default"
            onClick={() => {
              session.failed = false;
              setError(null);
              setRetry((value) => value + 1);
            }}
          >
            Retry
          </Button>
        </Group>
      )}
      <ScrollArea viewportRef={parentRef} h="100%" style={{ flex: 1, minHeight: 0 }}>
        <Box
          style={{
            height: rowVirtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => (
            <GameRow
              key={`${sourceKey}:${virtualRow.index}`}
              index={virtualRow.index}
              game={entry(virtualRow.index)}
              setPage={setPage}
              deleteGame={deleteGame}
              activePage={activePage}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            />
          ))}
        </Box>
      </ScrollArea>
    </Stack>
  );
}

function GameRow({
  style,
  index,
  game,
  setPage,
  activePage,
  deleteGame,
}: {
  style?: React.CSSProperties;
  index: number;
  game: PgnGameListEntry | undefined;
  setPage: (v: number, identity?: string) => void;
  activePage: number;
  deleteGame?: (index: number, identity: string) => Promise<boolean>;
}) {
  const [deleting, setDeleting] = useState<{ index: number; game: PgnGameListEntry } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  return (
    <>
      {deleteGame && (
        <ConfirmModal
          title={"Remove game"}
          description={`Remove ${deleting?.game.name ?? "this game"} from this file? Open board edits will be kept.`}
          opened={deleting !== null}
          busy={busy}
          error={deleteError}
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
          onConfirm={async () => {
            if (!deleting || busyRef.current) return;
            busyRef.current = true;
            setBusy(true);
            setDeleteError(null);
            try {
              if (await deleteGame(deleting.index, deleting.game.identity)) setDeleting(null);
              else
                setDeleteError("The game was not removed. Reload the game list before retrying.");
            } catch (error) {
              setDeleteError(String(error));
            } finally {
              busyRef.current = false;
              setBusy(false);
            }
          }}
        />
      )}
      <Group
        role="button"
        tabIndex={game ? 0 : -1}
        aria-current={index === activePage ? "true" : undefined}
        onKeyDown={(event) => {
          if (
            event.target === event.currentTarget &&
            game &&
            (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            setPage(index, game.identity);
          }
        }}
        style={style}
        justify="space-between"
        wrap="nowrap"
        gap="xs"
        className={cx(classes.row, {
          [classes.active]: index === activePage,
        })}
        onClick={() => {
          if (game) setPage(index, game.identity);
        }}
      >
        <Text fz="xs" className={classes.index}>
          {formatNumber(index + 1)}
        </Text>
        <Text fz="sm" truncate flex={1} lh="sm">
          {game?.name || "Loading…"}
        </Text>
        {deleteGame && (
          <ActionIcon
            onClick={(e) => {
              e.stopPropagation();
              if (game) {
                setDeleteError(null);
                setDeleting({ index, game });
              }
            }}
            variant="subtle"
            disabled={!game || busy}
            aria-label={`Remove game ${index + 1}`}
            color="red"
            size="xs"
            mr="xs"
            className={classes.deleteBtn}
          >
            <IconX size={12} />
          </ActionIcon>
        )}
      </Group>
    </>
  );
}
