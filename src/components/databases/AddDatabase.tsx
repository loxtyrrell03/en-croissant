import {
  Alert,
  Box,
  Button,
  Center,
  Checkbox,
  Divider,
  Group,
  InputWrapper,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconAlertCircle } from "@tabler/icons-react";
import { basename, resolve } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { type Dispatch, type SetStateAction, useState } from "react";
import { useTranslation } from "react-i18next";
import type { KeyedMutator } from "swr";
import { commands, type DatabaseInfo } from "@/bindings";
import {
  databaseConversionStateAtom,
  onlineDatabaseUpdatesAtom,
  sessionsAtom,
  storedDatabasesDirAtom,
} from "@/state/atoms";
import { getDatabases, type SuccessDatabaseInfo, useDefaultDatabases } from "@/utils/db";
import { capitalize, formatBytes, formatNumber } from "@/utils/format";
import {
  getDefaultMergedOnlineGameDatabaseTitle,
  getDefaultOnlineGameDatabaseTitle,
  getOnlineGameSourceLabel,
  importOnlineGameAccountsToDatabase,
  resetDatabaseConversionState,
  type OnlineGameAccount,
  type OnlineGameSource,
  upsertOnlineDatabaseUpdateRecord,
} from "@/utils/onlineGameImport";
import {
  downloadLichessStudyPgnToDatabaseDir,
  getDefaultLichessStudyDatabaseTitle,
  getLichessStudyPgnFilename,
  parseLichessStudyLink,
  sanitizeFileSegment,
} from "@/utils/lichess/study";
import { unwrap } from "@/utils/unwrap";
import FileInput from "../common/FileInput";
import ProgressButton from "../common/ProgressButton";

type OnlineDatabaseFormValues = {
  source: OnlineGameSource | "merged";
  username: string;
  lichessUsername: string;
  chessComUsername: string;
  title: string;
  description: string;
  autoUpdate: boolean;
};

type LichessStudyDatabaseFormValues = {
  link: string;
  title: string;
  description: string;
};

function AddDatabase({
  databases,
  opened,
  setOpened,
  setLoading,
  disableLocalConversion,
  setDatabases,
}: {
  databases: DatabaseInfo[];
  opened: boolean;
  setOpened: (opened: boolean) => void;
  setLoading: Dispatch<SetStateAction<boolean>>;
  disableLocalConversion: boolean;
  setDatabases: KeyedMutator<DatabaseInfo[]>;
}) {
  const { t } = useTranslation();
  const [databaseDir] = useAtom(storedDatabasesDirAtom);
  const [, setOnlineDatabaseUpdates] = useAtom(onlineDatabaseUpdatesAtom);
  const setConversionState = useSetAtom(databaseConversionStateAtom);
  const sessions = useAtomValue(sessionsAtom);
  const [onlineImporting, setOnlineImporting] = useState(false);
  const [studyImporting, setStudyImporting] = useState(false);

  const { defaultDatabases, error, isLoading } = useDefaultDatabases(opened);

  function getOnlineDatabaseAccounts(values: OnlineDatabaseFormValues): OnlineGameAccount[] {
    if (values.source === "merged") {
      const accounts: OnlineGameAccount[] = [
        { source: "lichess", username: values.lichessUsername.trim() },
        { source: "chesscom", username: values.chessComUsername.trim() },
      ];
      return accounts.filter((account) => account.username);
    }

    return [{ source: values.source, username: values.username.trim() }].filter(
      (account) => account.username,
    );
  }

  function getOnlineDatabaseTitle(values: OnlineDatabaseFormValues) {
    const accounts = getOnlineDatabaseAccounts(values);
    if (values.title.trim()) return values.title.trim();
    if (accounts.length === 0) return "";
    if (values.source === "merged") return getDefaultMergedOnlineGameDatabaseTitle(accounts);
    return getDefaultOnlineGameDatabaseTitle(accounts[0]!.source, accounts[0]!.username);
  }

  function getLichessToken(username: string) {
    return sessions.find(
      (session) =>
        session.lichess?.username.toLowerCase() === username.toLowerCase() &&
        session.lichess.accessToken,
    )?.lichess?.accessToken;
  }

  function withAccountTokens(accounts: OnlineGameAccount[]) {
    return accounts.map((account) => ({
      ...account,
      token: account.source === "lichess" ? getLichessToken(account.username) : undefined,
    }));
  }

  function getAnyLichessToken() {
    return sessions.find((session) => session.lichess?.accessToken)?.lichess?.accessToken;
  }

  function getStudyDatabaseTitle(values: LichessStudyDatabaseFormValues) {
    return values.title.trim() || getDefaultLichessStudyDatabaseTitle(values.link);
  }

  function databaseTitleExists(title: string) {
    return databases.some(
      (database) =>
        database.type === "success" && database.title.toLowerCase() === title.toLowerCase(),
    );
  }

  function getAvailableDatabaseTitle(title: string) {
    const base = sanitizeFileSegment(title) || "Lichess Study";
    if (!databaseTitleExists(base)) return base;

    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base} ${index}`;
      if (!databaseTitleExists(candidate)) return candidate;
    }

    return `${base} ${Date.now()}`;
  }

  async function convertDB(path: string, title: string, description?: string) {
    setLoading(true);
    const dbPath = await resolve(databaseDir, `${title}.db3`);
    const sourceFileName = await basename(path);
    setConversionState((prev) => ({
      ...prev,
      inProgress: true,
      phase: "converting",
      progress: null,
      progressId: null,
      totalGames: 0,
      totalGamesExpected: null,
      elapsedSeconds: 0,
      targetDatabasePath: dbPath,
      targetDatabaseTitle: title,
      sourceFileName,
    }));
    try {
      unwrap(await commands.convertPgn(path, dbPath, null, title, description ?? null));
      setDatabases(await getDatabases());
    } finally {
      setLoading(false);
      setConversionState((prev) => ({
        ...prev,
        inProgress: false,
        totalGames: 0,
        elapsedSeconds: 0,
        targetDatabasePath: null,
        targetDatabaseTitle: null,
        sourceFileName: null,
      }));
    }
  }

  const form = useForm<Partial<Extract<DatabaseInfo, { type: "success" }>>>({
    initialValues: {
      title: "",
      description: "",
      file: "",
      filename: "",
      indexed: false,
    },

    validate: {
      title: (value) => {
        if (!value) return t("Common.RequireName");
        if (databases.find((e) => e.type === "success" && e.title === value))
          return t("Common.NameAlreadyUsed");
      },
      file: (value) => {
        if (!value) return t("Common.RequirePath");
      },
    },
  });

  const onlineForm = useForm<OnlineDatabaseFormValues>({
    initialValues: {
      source: "lichess",
      username: "",
      lichessUsername: "",
      chessComUsername: "",
      title: "",
      description: "",
      autoUpdate: true,
    },

    validate: {
      username: (value, values) => {
        if (values.source !== "merged" && !value.trim()) return t("Home.Accounts.EnterUsername");
      },
      lichessUsername: (value, values) => {
        if (values.source === "merged" && !value.trim()) return "Enter your Lichess username";
      },
      chessComUsername: (value, values) => {
        if (values.source === "merged" && !value.trim()) return "Enter your Chess.com username";
      },
      title: (_value, values) => {
        const title = getOnlineDatabaseTitle(values);
        if (
          title &&
          databases.find(
            (e) => e.type === "success" && e.title.toLowerCase() === title.toLowerCase(),
          )
        ) {
          return t("Common.NameAlreadyUsed");
        }
      },
    },
  });

  const studyForm = useForm<LichessStudyDatabaseFormValues>({
    initialValues: {
      link: "",
      title: "",
      description: "",
    },

    validate: {
      link: (value) => {
        if (!value.trim()) return "Paste a Lichess study link";
        if (!parseLichessStudyLink(value)) return "Paste a valid Lichess study link";
      },
      title: (_value, values) => {
        const explicitTitle = values.title.trim();
        if (explicitTitle && databaseTitleExists(explicitTitle)) {
          return t("Common.NameAlreadyUsed");
        }
      },
    },
  });

  const onlineAccounts = getOnlineDatabaseAccounts(onlineForm.values);
  const onlineTitlePlaceholder =
    onlineAccounts.length > 0
      ? onlineForm.values.source === "merged"
        ? getDefaultMergedOnlineGameDatabaseTitle(onlineAccounts)
        : getDefaultOnlineGameDatabaseTitle(onlineAccounts[0]!.source, onlineAccounts[0]!.username)
      : onlineForm.values.source === "merged"
        ? "Merged online games"
        : getOnlineGameSourceLabel(onlineForm.values.source);
  const studyTitlePlaceholder =
    getDefaultLichessStudyDatabaseTitle(studyForm.values.link) || "Lichess Study";

  return (
    <Modal
      opened={opened}
      onClose={() => setOpened(false)}
      title={t("Databases.Add.Title")}
      size="80%"
    >
      <Tabs defaultValue="web">
        <Tabs.List>
          <Tabs.Tab value="web">{t("Databases.Add.Web")}</Tabs.Tab>
          <Tabs.Tab value="online">{t("Home.Accounts.DownloadGames")}</Tabs.Tab>
          <Tabs.Tab value="study">Lichess Study</Tabs.Tab>
          <Tabs.Tab value="local">{t("Common.Local")}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="web" pt="xs">
          {isLoading && (
            <Center>
              <Loader />
            </Center>
          )}
          <ScrollArea.Autosize h={500} offsetScrollbars>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
              {defaultDatabases?.map((db, i) => (
                <DatabaseCard
                  database={db}
                  databaseId={i}
                  key={i}
                  setDatabases={setDatabases}
                  initInstalled={databases.some(
                    (e) => e.type === "success" && e.title === db.title,
                  )}
                />
              ))}
              {error && (
                <Alert icon={<IconAlertCircle size="1rem" />} title="Error" color="red">
                  {"Failed to fetch the database's info from the server."}
                </Alert>
              )}
            </SimpleGrid>
          </ScrollArea.Autosize>
        </Tabs.Panel>
        <Tabs.Panel value="online" pt="xs">
          <form
            onSubmit={onlineForm.onSubmit(async (values) => {
              if (disableLocalConversion || onlineImporting) return;

              const accounts = getOnlineDatabaseAccounts(values);
              if (accounts.length === 0) return;
              const title = getOnlineDatabaseTitle(values);
              const dbPath = await resolve(databaseDir, `${title}.db3`);

              setOnlineImporting(true);
              setOpened(false);
              try {
                const description = values.description.trim() || null;
                const importedAccounts = await importOnlineGameAccountsToDatabase({
                  accounts: withAccountTokens(accounts),
                  databaseDir,
                  dbPath,
                  title,
                  description,
                  setConversionState,
                });
                const nextDatabases = await getDatabases();
                const createdDatabase = nextDatabases.find(
                  (database) => database.type === "success" && database.file === dbPath,
                );
                setDatabases(nextDatabases);
                setOnlineDatabaseUpdates((records) =>
                  upsertOnlineDatabaseUpdateRecord(records, {
                    source: importedAccounts[0]!.source,
                    username: importedAccounts[0]!.username,
                    accounts: importedAccounts,
                    dbPath,
                    title,
                    description,
                    autoUpdate: values.autoUpdate,
                    lastCheckedAt: Date.now(),
                    lastUpdatedAt: Date.now(),
                    lastKnownGameCount:
                      createdDatabase?.type === "success" ? createdDatabase.game_count : null,
                  }),
                );
                onlineForm.reset();
              } catch (e) {
                console.error(e);
                onlineForm.setFieldError("username", e instanceof Error ? e.message : String(e));
              } finally {
                setOnlineImporting(false);
                resetDatabaseConversionState(setConversionState);
              }
            })}
          >
            <Stack gap="sm">
              <InputWrapper label={t("Home.Accounts.Website")} required>
                <SegmentedControl
                  fullWidth
                  data={[
                    { label: "Lichess", value: "lichess" },
                    { label: "Chess.com", value: "chesscom" },
                    { label: "Merged", value: "merged" },
                  ]}
                  value={onlineForm.values.source}
                  onChange={(value) =>
                    onlineForm.setFieldValue("source", value as OnlineGameSource | "merged")
                  }
                />
              </InputWrapper>

              {onlineForm.values.source === "merged" ? (
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                  <TextInput
                    label="Lichess username"
                    withAsterisk
                    {...onlineForm.getInputProps("lichessUsername")}
                  />
                  <TextInput
                    label="Chess.com username"
                    withAsterisk
                    {...onlineForm.getInputProps("chessComUsername")}
                  />
                </SimpleGrid>
              ) : (
                <TextInput
                  label={t("Home.Accounts.Username")}
                  withAsterisk
                  {...onlineForm.getInputProps("username")}
                />
              )}

              <TextInput
                label={t("Common.Name")}
                placeholder={onlineTitlePlaceholder}
                {...onlineForm.getInputProps("title")}
              />

              <TextInput
                label={t("Common.Description")}
                {...onlineForm.getInputProps("description")}
              />

              <Checkbox
                label={t("Databases.Online.AutoUpdate")}
                description={t("Databases.Online.AutoUpdate.Desc")}
                {...onlineForm.getInputProps("autoUpdate", { type: "checkbox" })}
              />

              <Button
                fullWidth
                mt="sm"
                type="submit"
                loading={onlineImporting}
                disabled={disableLocalConversion || onlineImporting}
              >
                {onlineImporting ? t("Import.Importing") : t("Home.Card.ImportGame.Button")}
              </Button>
            </Stack>
          </form>
        </Tabs.Panel>
        <Tabs.Panel value="study" pt="xs">
          <form
            onSubmit={studyForm.onSubmit(async (values) => {
              if (disableLocalConversion || studyImporting) return;

              const reference = parseLichessStudyLink(values.link);
              if (!reference) return;

              const initialTitle = getStudyDatabaseTitle(values);
              let title = initialTitle;
              let dbPath = await resolve(databaseDir, `${title}.db3`);
              const sourceFileName = getLichessStudyPgnFilename(reference.studyId);
              let description =
                values.description.trim() || `Imported from ${reference.canonicalUrl}`;

              setStudyImporting(true);
              setOpened(false);
              setConversionState((prev) => ({
                ...prev,
                inProgress: true,
                phase: "downloading",
                progress: null,
                progressId: null,
                totalGames: 0,
                totalGamesExpected: null,
                elapsedSeconds: 0,
                targetDatabasePath: dbPath,
                targetDatabaseTitle: title,
                sourceFileName,
              }));

              try {
                const download = await downloadLichessStudyPgnToDatabaseDir({
                  databaseDir,
                  link: values.link,
                  token: getAnyLichessToken(),
                });
                if (!values.title.trim()) {
                  title = getAvailableDatabaseTitle(download.title);
                  dbPath = await resolve(databaseDir, `${title}.db3`);
                  description =
                    values.description.trim() || `Imported from ${download.reference.canonicalUrl}`;
                  setConversionState((prev) => ({
                    ...prev,
                    targetDatabasePath: dbPath,
                    targetDatabaseTitle: title,
                  }));
                }
                const totalGamesExpected = unwrap(await commands.countPgnGames(download.path));
                if (totalGamesExpected === 0) {
                  throw new Error("That study did not contain any PGN chapters.");
                }

                setConversionState((prev) => ({
                  ...prev,
                  phase: "converting",
                  progress: totalGamesExpected > 0 ? 0 : null,
                  progressId: null,
                  totalGames: 0,
                  totalGamesExpected,
                  elapsedSeconds: 0,
                  sourceFileName,
                }));

                unwrap(await commands.convertPgn(download.path, dbPath, null, title, description));
                setDatabases(await getDatabases());
                studyForm.reset();
              } catch (e) {
                console.error(e);
                studyForm.setFieldError("link", e instanceof Error ? e.message : String(e));
                setOpened(true);
              } finally {
                setStudyImporting(false);
                resetDatabaseConversionState(setConversionState);
              }
            })}
          >
            <Stack gap="sm">
              <TextInput
                label="Study link"
                withAsterisk
                placeholder="https://lichess.org/study/..."
                {...studyForm.getInputProps("link")}
              />

              <TextInput
                label={t("Common.Name")}
                placeholder={studyTitlePlaceholder}
                {...studyForm.getInputProps("title")}
              />

              <TextInput
                label={t("Common.Description")}
                {...studyForm.getInputProps("description")}
              />

              <Button
                fullWidth
                mt="sm"
                type="submit"
                loading={studyImporting}
                disabled={disableLocalConversion || studyImporting}
              >
                {studyImporting ? t("Import.Importing") : "Import study"}
              </Button>
            </Stack>
          </form>
        </Tabs.Panel>
        <Tabs.Panel value="local" pt="xs">
          <form
            onSubmit={form.onSubmit(async (values) => {
              if (disableLocalConversion) return;
              convertDB(values.file!, values.title!, values.description);
              setOpened(false);
            })}
          >
            <TextInput label={t("Common.Name")} withAsterisk {...form.getInputProps("title")} />

            <TextInput label={t("Common.Description")} {...form.getInputProps("description")} />

            <FileInput
              label={t("Common.PGNFile")}
              description={t("Databases.Add.ClickToSelectPGN")}
              onClick={async () => {
                const selected = await open({
                  multiple: false,
                  filters: [
                    {
                      name: "PGN file",
                      extensions: ["pgn", "pgn.zst"],
                    },
                  ],
                });
                if (!selected || typeof selected === "object") return;
                form.setFieldValue("file", selected);
                const filename = await basename(selected);
                if (filename) {
                  form.setFieldValue("filename", filename);
                  if (!form.values.title) {
                    form.setFieldValue(
                      "title",
                      capitalize(filename.replaceAll(/[_-]/g, " ").replace(".pgn", "")),
                    );
                  }
                }
              }}
              filename={form.values.filename ?? null}
              {...form.getInputProps("path")}
            />

            <Button fullWidth mt="xl" type="submit" disabled={disableLocalConversion}>
              {t("Databases.Add.Convert")}
            </Button>
          </form>
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}

function DatabaseCard({
  setDatabases,
  database,
  databaseId,
  initInstalled,
}: {
  setDatabases: KeyedMutator<DatabaseInfo[]>;
  database: SuccessDatabaseInfo;
  databaseId: number;
  initInstalled: boolean;
}) {
  const { t } = useTranslation();
  const [databaseDir] = useAtom(storedDatabasesDirAtom);

  const [inProgress, setInProgress] = useState<boolean>(false);

  async function downloadDatabase(id: number, url: string, name: string) {
    setInProgress(true);
    const path = await resolve(databaseDir, `${name}.db3`);
    await commands.downloadFile(`db_${id}`, url, path, null, null, null);
    setDatabases(await getDatabases());
  }

  return (
    <Paper withBorder radius="md" p={0} key={database.title}>
      <Group wrap="nowrap" gap={0} grow>
        <Box p="md" flex={1}>
          <Text tt="uppercase" c="dimmed" fw={700} size="xs">
            DATABASE
          </Text>
          <Text fw="bold" mb="xs">
            {database.title}
          </Text>

          <Text size="xs" c="dimmed">
            {database.description}
          </Text>
          <Divider />
          <Group wrap="nowrap" grow my="md">
            <Stack gap={0} align="center">
              <Text tt="uppercase" c="dimmed" fw={700} size="xs">
                {t("Common.Size")}
              </Text>
              <Text size="xs">{formatBytes(database.storage_size ?? 0)}</Text>
            </Stack>
            <Stack gap={0} align="center">
              <Text tt="uppercase" c="dimmed" fw={700} size="xs">
                {t("Databases.Card.Games")}
              </Text>
              <Text size="xs">{formatNumber(database.game_count)}</Text>
            </Stack>
            <Stack gap={0} align="center">
              <Text tt="uppercase" c="dimmed" fw={700} size="xs">
                {t("Databases.Card.Players")}
              </Text>
              <Text size="xs">{formatNumber(database.player_count)}</Text>
            </Stack>
          </Group>
          <ProgressButton
            id={`db_${databaseId}`}
            initInstalled={initInstalled}
            labels={{
              completed: t("Common.Installed"),
              action: t("Common.Install"),
              inProgress: t("Common.Downloading"),
              finalizing: t("Common.Extracting"),
            }}
            onClick={() => downloadDatabase(databaseId, database.downloadLink!, database.title!)}
            inProgress={inProgress}
            setInProgress={setInProgress}
          />
        </Box>
      </Group>
    </Paper>
  );
}

export default AddDatabase;
