import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconChessFilled,
  IconChessKnightFilled,
  IconDatabase,
  IconTrophy,
} from "@tabler/icons-react";
import { resolve } from "@tauri-apps/api/path";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import useSWR, { mutate as mutateSWR } from "swr";
import OtbGameImportPanel from "@/components/panels/prep/OtbGameImportPanel";
import {
  databaseConversionStateAtom,
  onlineDatabaseUpdatesAtom,
  sessionsAtom,
  storedDatabasesDirAtom,
} from "@/state/atoms";
import { getDatabases, type SuccessDatabaseInfo } from "@/utils/db";
import { getDatabasesDir } from "@/utils/directories";
import {
  HOME_GAME_DATABASE_IMPORT_SOURCES,
  getHomeGameDatabaseImportTitle,
  validateHomeOnlineDatabaseImport,
  type HomeGameDatabaseImportSource,
} from "@/utils/homeGameDatabaseImport";
import {
  importOnlineGameAccountsToDatabase,
  resetDatabaseConversionState,
  upsertOnlineDatabaseUpdateRecord,
} from "@/utils/onlineGameImport";
import { sanitizeOtbImportFilename } from "@/utils/otbGameImport";
import classes from "./HomeGameDatabaseImport.module.css";

export default function HomeGameDatabaseImport() {
  const [opened, setOpened] = useState(false);
  const [source, setSource] = useState<HomeGameDatabaseImportSource>("chesscom");
  const [username, setUsername] = useState("");
  const [requestedTitle, setRequestedTitle] = useState("");
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [databaseDir] = useAtom(storedDatabasesDirAtom);
  const [conversionState, setConversionState] = useAtom(databaseConversionStateAtom);
  const [, setOnlineDatabaseUpdates] = useAtom(onlineDatabaseUpdatesAtom);
  const sessions = useAtomValue(sessionsAtom);
  const {
    data: databaseRows,
    isLoading: databasesLoading,
    mutate: refreshDatabases,
  } = useSWR(opened ? "home-game-database-import-databases" : null, () => getDatabases());

  const databases = useMemo(
    () =>
      (databaseRows ?? []).filter(
        (database): database is SuccessDatabaseInfo => database.type === "success",
      ),
    [databaseRows],
  );
  const busy = importing || conversionState.inProgress;
  const onlineSource = source === "otb" ? null : source;
  const suggestedTitle = onlineSource
    ? getHomeGameDatabaseImportTitle(onlineSource, username, "")
    : "";

  useEffect(() => {
    if (!opened || username.trim() || source === "otb") return;
    const linkedUsername =
      source === "lichess"
        ? sessions.find((session) => session.lichess?.username)?.lichess?.username
        : sessions.find((session) => session.chessCom?.username)?.chessCom?.username;
    if (linkedUsername) setUsername(linkedUsername);
  }, [opened, sessions, source, username]);

  function chooseSource(nextSource: HomeGameDatabaseImportSource) {
    setSource(nextSource);
    setUsername("");
    setRequestedTitle("");
    setError(null);
  }

  function closeModal() {
    if (busy) return;
    setOpened(false);
    setError(null);
  }

  async function refreshDatabaseLists() {
    const nextDatabases = await getDatabases();
    await refreshDatabases(nextDatabases, { revalidate: false });
    await Promise.all([
      mutateSWR("databases", nextDatabases, { revalidate: false }),
      mutateSWR("databases-with-archived"),
    ]);
    return nextDatabases;
  }

  async function importOnlineDatabase() {
    if (!onlineSource || busy) return;
    const title = getHomeGameDatabaseImportTitle(onlineSource, username, requestedTitle);
    const validationError = validateHomeOnlineDatabaseImport({
      username,
      title,
      existingTitles: databases.map((database) => database.title),
    });
    if (validationError) {
      setError(validationError);
      return;
    }

    setImporting(true);
    setError(null);
    try {
      const targetDatabaseDir = databaseDir || (await getDatabasesDir());
      const dbPath = await resolve(targetDatabaseDir, `${sanitizeOtbImportFilename(title)}.db3`);
      const matchingSession = sessions.find(
        (session) =>
          onlineSource === "lichess" &&
          session.lichess?.username.toLowerCase() === username.trim().toLowerCase(),
      );
      const description = `Imported from ${onlineSource === "lichess" ? "Lichess" : "Chess.com"} account ${username.trim()}.`;
      const importedAccounts = await importOnlineGameAccountsToDatabase({
        accounts: [
          {
            source: onlineSource,
            username: username.trim(),
            token: matchingSession?.lichess?.accessToken,
          },
        ],
        databaseDir: targetDatabaseDir,
        dbPath,
        title,
        description,
        setConversionState,
      });
      const nextDatabases = await refreshDatabaseLists();
      const createdDatabase = nextDatabases.find(
        (database) => database.type === "success" && database.file === dbPath,
      );
      setOnlineDatabaseUpdates((records) =>
        upsertOnlineDatabaseUpdateRecord(records, {
          source: importedAccounts[0]!.source,
          username: importedAccounts[0]!.username,
          accounts: importedAccounts,
          dbPath,
          title,
          description,
          autoUpdate,
          lastCheckedAt: Date.now(),
          lastUpdatedAt: Date.now(),
          lastKnownGameCount:
            createdDatabase?.type === "success" ? createdDatabase.game_count : null,
        }),
      );
      notifications.show({
        title: "Game database ready",
        message: `${createdDatabase?.type === "success" ? createdDatabase.game_count : "Imported"} ${onlineSource === "lichess" ? "Lichess" : "Chess.com"} games saved to ${title}.`,
        color: "green",
      });
      setOpened(false);
      setUsername("");
      setRequestedTitle("");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      notifications.show({
        title: "Could not import games",
        message,
        color: "red",
      });
    } finally {
      setImporting(false);
      resetDatabaseConversionState(setConversionState);
    }
  }

  return (
    <>
      <Card withBorder radius="md" p="md">
        <Group justify="space-between" align="center" wrap="wrap" gap="md">
          <Group gap="sm" wrap="nowrap" className={classes.cardLead}>
            <ThemeIcon size={40} radius="md" variant="light" className={classes.databaseIcon}>
              <IconDatabase size="1.3rem" stroke={1.7} />
            </ThemeIcon>
            <Box>
              <Text fw={700}>Import player games</Text>
              <Text size="sm" c="dimmed">
                Collect a player’s Chess.com, Lichess, or over-the-board games into one searchable
                database.
              </Text>
            </Box>
          </Group>
          <Button radius="md" onClick={() => setOpened(true)} className={classes.openButton}>
            Import games
          </Button>
        </Group>
      </Card>

      <Modal
        opened={opened}
        onClose={closeModal}
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        withCloseButton={!busy}
        size="lg"
        radius="lg"
        title={
          <Text fw={700} size="lg">
            Import a player’s games
          </Text>
        }
      >
        <Stack gap="lg">
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
            {HOME_GAME_DATABASE_IMPORT_SOURCES.map((option) => {
              const selected = option.value === source;
              return (
                <UnstyledButton
                  key={option.value}
                  className={classes.sourceChoice}
                  data-selected={selected || undefined}
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() => chooseSource(option.value)}
                >
                  <Group gap="xs" wrap="nowrap" justify="center">
                    <Box className={classes.sourceChoiceMark}>
                      {option.value === "chesscom" ? (
                        <IconChessFilled size="1rem" />
                      ) : option.value === "lichess" ? (
                        <IconChessKnightFilled size="1rem" />
                      ) : (
                        <IconTrophy size="1rem" stroke={1.9} />
                      )}
                    </Box>
                    <Text size="sm" fw={650}>
                      {option.label}
                    </Text>
                  </Group>
                </UnstyledButton>
              );
            })}
          </SimpleGrid>

          {databasesLoading ? (
            <Alert color="blue" variant="light" icon={<IconDatabase size="1rem" />}>
              Reading your database library…
            </Alert>
          ) : source === "otb" ? (
            <OtbGameImportPanel
              initialPlayerName=""
              databaseDir={databaseDir}
              localDatabases={databases}
              controlSize="sm"
              dense={false}
              forceSaveDatabase
              variant="dialog"
              submitLabel="Create database"
              onImported={async () => {
                await refreshDatabaseLists();
                setOpened(false);
              }}
            />
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void importOnlineDatabase();
              }}
            >
              <Stack gap="md">
                <TextInput
                  label={`${source === "lichess" ? "Lichess" : "Chess.com"} username`}
                  placeholder={source === "lichess" ? "DrNykterstein" : "HikaruNakamura"}
                  value={username}
                  disabled={busy}
                  error={error?.includes("username") ? error : null}
                  onChange={(event) => {
                    setUsername(event.currentTarget.value);
                    setError(null);
                  }}
                  data-autofocus
                />
                <TextInput
                  label="Database name"
                  placeholder={suggestedTitle || "Account games"}
                  value={requestedTitle}
                  disabled={busy}
                  error={error && !error.includes("username") ? error : null}
                  onChange={(event) => {
                    setRequestedTitle(event.currentTarget.value);
                    setError(null);
                  }}
                />
                <Checkbox
                  checked={autoUpdate}
                  disabled={busy}
                  label="Keep this database updated"
                  onChange={(event) => setAutoUpdate(event.currentTarget.checked)}
                />
                <Group justify="flex-end" mt="xs">
                  <Button
                    type="submit"
                    loading={importing}
                    disabled={databasesLoading || (busy && !importing)}
                  >
                    Create database
                  </Button>
                </Group>
              </Stack>
            </form>
          )}
        </Stack>
      </Modal>
    </>
  );
}
