import {
  ActionIcon,
  Button,
  Drawer,
  Group,
  Menu,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import {
  IconArrowBackUp,
  IconChess,
  IconDots,
  IconFilePlus,
  IconPlus,
  IconSwitchVertical,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { TournamentHelp } from "@/features/tournaments/TournamentHelp";
import { INITIAL_FEN } from "chessops/fen";
import { NewBoardSaveError, startNewPhoneBoard } from "./newBoard";
import { webStateSession } from "./webStateSession";
import { phoneDrawingSeat } from "./phoneDrawings";
import { phoneWorkspaceOwner } from "./workspacePreferences";
import classes from "./PhoneNewBoardActions.module.css";

export default function PhoneNewBoardActions({
  onCreated,
  onBeforeCreate,
  onFlip,
  onMainline,
}: {
  onCreated: () => void;
  onBeforeCreate?: () => void;
  onFlip?: () => void;
  onMainline?: () => void;
}) {
  const [dialog, setDialog] = useState<"position" | "file" | "board">("board");
  const [opened, setOpened] = useState(false);
  const [name, setName] = useState("");
  const [fen, setFen] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const owner = useRef("");
  const currentFen = useRef(INITIAL_FEN);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function open(kind: "position" | "file") {
    owner.current = phoneWorkspaceOwner(webStateSession.getSnapshot().state);
    currentFen.current = phoneDrawingSeat(webStateSession.getSnapshot().state).fen;
    setName("");
    setFen("");
    setError(null);
    setDialog(kind);
    setOpened(true);
  }
  async function create(kind: "position" | "file" | "board") {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    if (kind === "board" && !opened)
      owner.current = phoneWorkspaceOwner(webStateSession.getSnapshot().state);
    onBeforeCreate?.();
    try {
      await startNewPhoneBoard(
        webStateSession,
        owner.current,
        kind === "file" ? name : kind === "position" ? "Position" : "Untitled",
        kind === "position" ? fen : INITIAL_FEN,
      );
      if (mounted.current) {
        setOpened(false);
        onCreated();
      }
    } catch (reason) {
      if (!mounted.current) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      // An owned retained-board save can acquire its first file identity.
      // Retry is only offered for a save error, never for a replaced workspace.
      if (reason instanceof NewBoardSaveError) owner.current = reason.retryOwner;
      setDialog(kind);
      setOpened(true);
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <Menu
        position="bottom-end"
        width={240}
        withinPortal
        classNames={{ dropdown: classes.menu, item: classes.menuItem }}
      >
        <Menu.Target>
          <Button
            variant="subtle"
            size="xs"
            className={classes.newButton}
            loading={busy}
            leftSection={<IconPlus size={18} />}
            aria-label="New board, position or file"
          >
            New
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<IconChess size={18} />} onClick={() => void create("board")}>
            New board
          </Menu.Item>
          <Menu.Item leftSection={<IconPlus size={18} />} onClick={() => open("position")}>
            New position
          </Menu.Item>
          <Menu.Item leftSection={<IconFilePlus size={18} />} onClick={() => open("file")}>
            New file
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      {onFlip && (
        <Menu
          position="bottom-end"
          width={230}
          withinPortal
          classNames={{ dropdown: classes.menu, item: classes.menuItem }}
        >
          <Menu.Target>
            <ActionIcon aria-label="Board menu" variant="subtle" color="gray" size={44}>
              <IconDots size={21} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              aria-label="Flip board"
              leftSection={<IconSwitchVertical size={18} />}
              onClick={onFlip}
            >
              Flip board
            </Menu.Item>
            <Menu.Item leftSection={<IconArrowBackUp size={18} />} onClick={onMainline}>
              Return to main line
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      )}
      <Drawer
        opened={opened}
        onClose={() => {
          if (!busy) setOpened(false);
        }}
        position="bottom"
        size="auto"
        styles={{
          content: { height: "auto", maxHeight: "85dvh", borderRadius: "16px 16px 0 0" },
          inner: { alignItems: "flex-end" },
        }}
        title={
          dialog === "position" ? "New position" : dialog === "file" ? "New file" : "New board"
        }
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        withCloseButton={!busy}
        closeButtonProps={{ size: 44, "aria-label": "Close new board panel" }}
        classNames={{
          content: classes.sheet,
          body: classes.sheetBody,
          header: classes.sheetHeader,
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (dialog) void create(dialog);
          }}
        >
          <Stack gap="md">
            {dialog === "file" && (
              <TextInput
                data-autofocus
                label="File name"
                placeholder="My analysis"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                disabled={busy}
                maxLength={120}
              />
            )}
            {dialog === "position" && (
              <>
                <Group gap={6}>
                  <Text size="sm" fw={600}>
                    Starting position
                  </Text>
                  <TournamentHelp label="Starting position">
                    Paste a FEN to set up the pieces and side to move, or use the position currently
                    on your board.
                  </TournamentHelp>
                </Group>
                <Textarea
                  data-autofocus
                  label="FEN"
                  placeholder="Paste a FEN position"
                  value={fen}
                  onChange={(event) => {
                    setFen(event.currentTarget.value);
                    setError(null);
                  }}
                  autosize
                  minRows={3}
                  maxRows={6}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  disabled={busy}
                />
                <Button
                  variant="light"
                  disabled={busy}
                  onClick={() => {
                    setFen(currentFen.current);
                    setError(null);
                  }}
                >
                  Use current position
                </Button>
              </>
            )}
            <Text size="sm" c="dimmed">
              Your current work stays saved. New boards appear in Files.
            </Text>
            {error && (
              <Text c="red" size="sm" role="alert">
                {error}
              </Text>
            )}
            <Group grow wrap="nowrap">
              <Button variant="default" disabled={busy} onClick={() => setOpened(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                loading={busy}
                disabled={
                  dialog === "position" ? !fen.trim() : dialog === "file" ? !name.trim() : false
                }
              >
                {error
                  ? "Try again"
                  : dialog === "position"
                    ? "Open position"
                    : dialog === "file"
                      ? "Create file"
                      : "New board"}
              </Button>
            </Group>
          </Stack>
        </form>
      </Drawer>
    </>
  );
}
