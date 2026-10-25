import {
  Alert,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  SimpleGrid,
  Tabs,
  Text,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconAlertCircle } from "@tabler/icons-react";
import { useAtom, useStore } from "jotai";
import { useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { enginesAtom } from "@/state/atoms";
import { enginePreferences } from "@/utils/enginePreferences";
import { type LocalEngine, type RemoteEngine, useDefaultEngines } from "@/utils/engines";
import { usePlatform } from "@/utils/files";
import EngineForm from "./EngineForm";
import { CatalogEngineCard } from "./CatalogEngineCard";
import { catalogInstallKey } from "@/utils/catalogInstallState";
import { EnginePreferencesNotice } from "./EnginePreferencesNotice";
import { StockfishCatalogCard } from "./StockfishCatalogCard";

function AddEngine({
  opened,
  setOpened,
}: {
  opened: boolean;
  setOpened: (opened: boolean) => void;
}) {
  const { t } = useTranslation();

  const [allEngines, setEngines] = useAtom(enginesAtom);
  const atoms = useStore();
  const preferences = useSyncExternalStore(
    enginePreferences.subscribe,
    enginePreferences.getSnapshot,
  );
  const localRegistration = useRef<string | null>(null);
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>("download");
  const engines = (allEngines ?? []).filter((e): e is LocalEngine => e.type === "local");

  const { os } = usePlatform();

  const { defaultEngines, error, isLoading } = useDefaultEngines(os, opened);

  const form = useForm<LocalEngine>({
    initialValues: {
      type: "local",
      id: crypto.randomUUID(),
      version: "",
      name: "",
      path: "",
      image: "",
      elo: undefined,
    },

    validate: {
      name: (value) => {
        if (!value) return t("Common.RequireName");
        if (engines.find((e) => e.name === value && e.id !== localRegistration.current))
          return t("Common.NameAlreadyUsed");
      },
      path: (value) => {
        if (!value) return t("Common.RequirePath");
      },
    },
  });

  return (
    <Modal
      opened={opened}
      onClose={() => setOpened(false)}
      title={t("Engines.Add.Title")}
      size="80%"
    >
      <EnginePreferencesNotice />
      <Tabs value={tab} onChange={setTab}>
        <Tabs.List>
          <Tabs.Tab value="download">{t("Common.Download")}</Tabs.Tab>
          <Tabs.Tab value="cloud">{t("Engines.Add.Cloud")}</Tabs.Tab>
          <Tabs.Tab value="local">{t("Common.Local")}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="download" pt="xs">
          {isLoading && (
            <Center>
              <Loader />
            </Center>
          )}
          <ScrollArea.Autosize mah={720} offsetScrollbars>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
              {os === "windows" && <StockfishCatalogCard />}
              {defaultEngines?.map((engine) => (
                <CatalogEngineCard engine={engine} key={catalogInstallKey(engine)} />
              ))}
              {error && (
                <Alert icon={<IconAlertCircle size="1rem" />} title={t("Common.Error")} color="red">
                  {t("Engines.Add.ErrorFetch")}
                </Alert>
              )}
            </SimpleGrid>
          </ScrollArea.Autosize>
        </Tabs.Panel>
        <Tabs.Panel value="cloud" pt="xs">
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
            <CloudCard
              engine={{
                id: crypto.randomUUID(),
                name: "Local Lichess evals",
                type: "lichess",
                url: "local://lichess-evals",
              }}
            />
          </SimpleGrid>
        </Tabs.Panel>
        <Tabs.Panel value="local" pt="xs">
          <EngineForm
            submitLabel={t("Common.Add")}
            form={form}
            active={opened && tab === "local"}
            disabled={
              preferences.phase === "loading" ||
              preferences.phase === "error" ||
              preferences.saving ||
              (!registrationId && (preferences.pending || !!preferences.error))
            }
            registration={
              registrationId
                ? {
                    saved:
                      !preferences.saving &&
                      !preferences.pending &&
                      !preferences.error &&
                      enginePreferences.isSavedValue(allEngines),
                  }
                : undefined
            }
            onSuccess={() => {
              localRegistration.current = null;
              setRegistrationId(null);
              form.reset();
              setOpened(false);
            }}
            onSubmit={async (values: LocalEngine) => {
              if (localRegistration.current) {
                if (!enginePreferences.isSavedValue(atoms.get(enginesAtom)))
                  await enginePreferences.retry();
                await enginePreferences.flush();
                return;
              }
              const current = atoms.get(enginesAtom);
              if (!current || !enginePreferences.isSavedValue(current))
                throw new Error("Load and save engine settings before adding an engine.");
              const name = values.name.trim();
              if (!name || current.some((profile) => profile.name === name))
                throw new Error("Choose a name that is not already used.");
              const id = crypto.randomUUID();
              if (current.some((profile) => profile.id === id))
                throw new Error("Could not create a unique engine profile. Retry adding it.");
              localRegistration.current = id;
              setRegistrationId(id);
              setEngines([...current, { ...values, id, name }]);
              await enginePreferences.flush();
              if (!enginePreferences.isSavedValue(atoms.get(enginesAtom)))
                throw new Error("Engine settings have not finished saving.");
            }}
          />
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}

function CloudCard({ engine }: { engine: RemoteEngine }) {
  const { t } = useTranslation();

  const [engines, setEngines] = useAtom(enginesAtom);
  return (
    <Paper withBorder radius="md" p={0} key={engine.name}>
      <Group wrap="nowrap" gap={0} grow>
        <Box p="sm" flex={1}>
          <Text tt="uppercase" c="dimmed" fw={700} size="xs">
            ENGINE
          </Text>
          <Text fw="bold" size="sm">
            {engine.name}
          </Text>
          <Text size="xs" c="dimmed" mb="xs">
            {engine.url}
          </Text>
          <Button
            disabled={(engines ?? []).find((e) => e.type === engine.type) !== undefined}
            fullWidth
            size="xs"
            onClick={() => {
              setEngines(async (prev) => [
                ...(await prev),
                {
                  ...engine,
                  id: crypto.randomUUID(),
                  type: engine.type,
                  loaded: true,
                  settings: [
                    {
                      name: "MultiPV",
                      value: "1",
                    },
                  ],
                },
              ]);
            }}
          >
            {t("Common.Add")}
          </Button>
        </Box>
      </Group>
    </Paper>
  );
}

export default AddEngine;
