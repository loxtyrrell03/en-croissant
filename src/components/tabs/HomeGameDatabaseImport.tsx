import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
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
  IconArrowRight,
  IconCloudDownload,
  IconDatabase,
  IconShieldCheck,
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
      <Card withBorder radius="lg" p={0} className={classes.importCard}>
        <Box className={classes.cardGlow} />
        <Group
          justify="space-between"
          align="center"
          wrap="wrap"
          gap="lg"
          px={{ base: "md", sm: "xl" }}
          py={{ base: "md", sm: "lg" }}
          className={classes.cardContent}
        >
          <Group gap="md" wrap="nowrap" className={classes.cardLead}>
            <ThemeIcon size={48} radius="md" variant="light" className={classes.databaseIcon}>
              <IconDatabase size="1.55rem" stroke={1.7} />
            </ThemeIcon>
            <Box>
              <Group gap="xs" mb={3}>
                <Text fw={700} size="lg">
                  Import games into a database
                </Text>
                <Badge variant="light" size="sm" color="blue">
                  NEW
                </Badge>
              </Group>
              <Text size="sm" c="dimmed" maw={560}>
                Build a searchable database from a Chess.com account, Lichess account, or public
                over-the-board games.
              </Text>
            </Box>
          </Group>

          <Group gap="md" wrap="wrap" className={classes.cardActions}>
            <Group gap={6} wrap="nowrap" aria-label="Available game sources">
              {HOME_GAME_DATABASE_IMPORT_SOURCES.map((option) => (
                <Box key={option.value} className={classes.sourceMark} title={option.label}>
                  {option.shortLabel}
                </Box>
              ))}
            </Group>
            <Button
              radius="md"
              rightSection={<IconArrowRight size="1rem" />}
              onClick={() => setOpened(true)}
              className={classes.openButton}
            >
              Import games
            </Button>
          </Group>
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
          <Box>
            <Text size="xs" fw={700} c="blue" tt="uppercase" lts="0.08em">
              Game database
            </Text>
            <Text fw={700} size="lg">
              Choose where the games come from
            </Text>
          </Box>
        }
      >
        <Stack gap="md">
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
                  <Group gap="sm" wrap="nowrap">
                    <Box className={classes.sourceChoiceMark}>{option.shortLabel}</Box>
                    <Box>
                      <Text size="sm" fw={650}>
                        {option.label}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {option.detail}
                      </Text>
                    </Box>
                  </Group>
                </UnstyledButton>
              );
            })}
          </SimpleGrid>

          <Divider />

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
              <Stack gap="sm">
                <Alert color="blue" variant="light" icon={<IconCloudDownload size="1rem" />}>
                  Import the account’s public standard games into one local database. Linked Lichess
                  accounts automatically use their access token.
                </Alert>
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
                  withAsterisk
                  data-autofocus
                />
                <TextInput
                  label="Database name"
                  description="Leave blank to use the account and source name."
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
                  description="Check for newly published account games during automatic database updates."
                  onChange={(event) => setAutoUpdate(event.currentTarget.checked)}
                />
                <Group justify="space-between" gap="sm" mt="xs">
                  <Group gap={6} wrap="nowrap">
                    <IconShieldCheck size="1rem" color="var(--mantine-color-teal-6)" />
                    <Text size="xs" c="dimmed">
                      Standard games only · duplicates removed
                    </Text>
                  </Group>
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
