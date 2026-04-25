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
  getDefaultOnlineGameDatabaseTitle,
  getOnlineGameSourceLabel,
  importOnlineGamesToDatabase,
  resetDatabaseConversionState,
  type OnlineGameSource,
  upsertOnlineDatabaseUpdateRecord,
} from "@/utils/onlineGameImport";
import { unwrap } from "@/utils/unwrap";
import FileInput from "../common/FileInput";
import ProgressButton from "../common/ProgressButton";

type OnlineDatabaseFormValues = {
  source: OnlineGameSource;
  username: string;
  title: string;
  description: string;
  autoUpdate: boolean;
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

  const { defaultDatabases, error, isLoading } = useDefaultDatabases(opened);

  function getOnlineDatabaseTitle(values: OnlineDatabaseFormValues) {
    const username = values.username.trim();
    return (
      values.title.trim() ||
      (username ? getDefaultOnlineGameDatabaseTitle(values.source, username) : "")
    );
  }

  function getLichessToken(username: string) {
    return sessions.find(
      (session) =>
        session.lichess?.username.toLowerCase() === username.toLowerCase() &&
        session.lichess.accessToken,
    )?.lichess?.accessToken;
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
      title: "",
      description: "",
      autoUpdate: true,
    },

    validate: {
      username: (value) => {
        if (!value.trim()) return t("Home.Accounts.EnterUsername");
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

  const onlineTitlePlaceholder =
    onlineForm.values.username.trim() !== ""
      ? getDefaultOnlineGameDatabaseTitle(
          onlineForm.values.source,
          onlineForm.values.username.trim(),
        )
      : getOnlineGameSourceLabel(onlineForm.values.source);

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

              const source = values.source;
              const username = values.username.trim();
              const title = getOnlineDatabaseTitle(values);
              const dbPath = await resolve(databaseDir, `${title}.db3`);

              setOnlineImporting(true);
              setOpened(false);
              try {
                await importOnlineGamesToDatabase({
                  source,
                  username,
                  databaseDir,
                  dbPath,
                  title,
                  description: values.description.trim() || null,
                  since: null,
                  token: source === "lichess" ? getLichessToken(username) : undefined,
                  setConversionState,
                });
                const nextDatabases = await getDatabases();
                const createdDatabase = nextDatabases.find(
                  (database) => database.type === "success" && database.file === dbPath,
                );
                setDatabases(nextDatabases);
                setOnlineDatabaseUpdates((records) =>
                  upsertOnlineDatabaseUpdateRecord(records, {
                    source,
                    username,
                    dbPath,
                    title,
                    description: values.description.trim() || null,
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
                  ]}
                  value={onlineForm.values.source}
                  onChange={(value) =>
                    onlineForm.setFieldValue("source", value as OnlineGameSource)
                  }
                />
              </InputWrapper>

              <TextInput
                label={t("Home.Accounts.Username")}
                withAsterisk
                {...onlineForm.getInputProps("username")}
              />

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
