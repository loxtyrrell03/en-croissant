import {
  ActionIcon,
  Checkbox,
  Group,
  Select,
  type MantineColor,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconPlayerStopFilled, IconSettings } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { GoMode } from "@/bindings";
import GoModeInput from "@/components/common/GoModeInput";
import { activeTabAtom, enginesAtom } from "@/state/atoms";
import { type Engine, type EngineSettings, killEngine } from "@/utils/engines";
import {
  LC0_NETWORK_PROFILES,
  normalizeLc0NetworkProfile,
  readEngineSetting,
  replaceEngineSetting,
} from "@/utils/lc0Networks";
import CoresSlider from "./CoresSlider";
import HashSlider from "./HashSlider";
import LinesSlider from "./LinesSlider";

export type Settings = {
  enabled: boolean;
  go: GoMode;
  settings: EngineSettings;
  synced: boolean;
};

interface EngineSettingsProps {
  engine: Engine;
  settings: Settings;
  setSettings: (fn: (prev: Settings) => Settings) => void;
  color?: MantineColor;
  minimal?: boolean;
  remote: boolean;
  gameMode?: boolean;
}

function EngineSettingsForm({
  engine,
  settings,
  setSettings,
  color,
  minimal,
  remote,
  gameMode,
}: EngineSettingsProps) {
  const { t } = useTranslation();

  const multipv = settings.settings.find((o) => o.name === "MultiPV");
  const threads = settings.settings.find((o) => o.name === "Threads");
  const hash = settings.settings.find((o) => o.name === "Hash");
  const isPcLc0 = engine.type === "pc" && engine.engineKind === "lc0";
  const autoNetwork = readEngineSetting(settings.settings, "AutoNetwork") !== false;
  const selectedNetwork = normalizeLc0NetworkProfile(
    readEngineSetting(settings.settings, "OddsMode"),
  );
  const activeTab = useAtomValue(activeTabAtom);

  const setGoMode = useCallback(
    (v: GoMode) => {
      setSettings((prev) => ({
        ...prev,
        go: v,
      }));
    },
    [setSettings],
  );

  return (
    <Stack>
      {!remote && !minimal && (
        <GoModeInput gameMode={gameMode} goMode={settings.go} setGoMode={setGoMode} />
      )}

      {!minimal && multipv && (
        <Group grow>
          <Text size="sm" fw="bold">
            {t("Engines.Settings.NumOfLines")}
          </Text>
          <LinesSlider
            value={Number(multipv.value || 1)}
            setValue={(v) =>
              setSettings((prev) => {
                return {
                  ...prev,
                  settings: prev.settings.map((o) =>
                    o.name === "MultiPV" ? { ...o, value: v || 1 } : o,
                  ),
                };
              })
            }
            color={color}
          />
        </Group>
      )}

      {!minimal && isPcLc0 && (
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap">
            <Stack gap={0}>
              <Text size="sm" fw="bold">
                Auto network switching
              </Text>
              <Text size="xs" c="dimmed">
                Match BT4, T1, or LQO to the odds material on the board.
              </Text>
            </Stack>
            <Switch
              checked={autoNetwork}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  settings: replaceEngineSetting(
                    prev.settings,
                    "AutoNetwork",
                    event.currentTarget.checked,
                  ),
                }))
              }
              aria-label="Auto LC0 network switching"
            />
          </Group>
          <Select
            label="Odds network"
            description={
              autoNetwork
                ? "Auto switching is active. Turn it off to force one profile."
                : "Choose the odds profile LC0 should use."
            }
            allowDeselect={false}
            disabled={autoNetwork}
            value={selectedNetwork}
            data={LC0_NETWORK_PROFILES.map((profile) => ({
              value: profile.value,
              label: profile.label,
            }))}
            onChange={(value) =>
              setSettings((prev) => ({
                ...prev,
                settings: replaceEngineSetting(
                  prev.settings,
                  "OddsMode",
                  normalizeLc0NetworkProfile(value),
                ),
              }))
            }
          />
        </Stack>
      )}

      {!remote && threads && (
        <>
          <Group grow>
            <Text size="sm" fw="bold">
              {t("Engines.Settings.NumOfCores")}
            </Text>
            <CoresSlider
              value={Number(threads.value || 1)}
              setValue={(v) =>
                setSettings((prev) => ({
                  ...prev,
                  settings: prev.settings.map((o) =>
                    o.name === "Threads" ? { ...o, value: v || 1 } : o,
                  ),
                }))
              }
              color={color}
            />
          </Group>

          {hash && (
            <Group grow>
              <Text size="sm" fw="bold">
                {t("Engines.Settings.SizeOfHash")}
              </Text>
              <HashSlider
                value={Number(hash.value || 1)}
                setValue={(v) =>
                  setSettings((prev) => ({
                    ...prev,
                    settings: prev.settings.map((o) =>
                      o.name === "Hash" ? { ...o, value: v || 1 } : o,
                    ),
                  }))
                }
                color={color}
              />
            </Group>
          )}
        </>
      )}
      {!minimal && (
        <Group>
          <SyncSettings settings={settings} engine={engine.name} setSettings={setSettings} />
          <ActionIcon.Group>
            {engine.type === "local" && (
              <Tooltip label="Kill engine">
                <ActionIcon
                  variant="default"
                  onClick={() => {
                    killEngine(engine, activeTab!);
                    setSettings((prev) => ({
                      ...prev,
                      enabled: false,
                    }));
                  }}
                >
                  <IconPlayerStopFilled size="1rem" />
                </ActionIcon>
              </Tooltip>
            )}
            <AdvancedSettings engineName={engine.name} />
          </ActionIcon.Group>
        </Group>
      )}
    </Stack>
  );
}

function SyncSettings({
  engine,
  settings,
  setSettings,
}: {
  engine: string;
  settings: Settings;
  setSettings: (fn: (prev: Settings) => Settings) => void;
}) {
  const { t } = useTranslation();

  const engines = useAtomValue(enginesAtom);
  const engineDefault = useMemo(
    () => (engines ?? []).find((o) => o.name === engine)!,
    [engines, engine],
  );

  return (
    <Checkbox
      label={t("Board.Analysis.SyncGlobally")}
      checked={settings.synced}
      onChange={(e) => {
        if (e.currentTarget.checked) {
          setSettings((prev) => ({
            ...prev,
            go: engineDefault.go || prev.go,
            settings: engineDefault.settings || prev.settings,
            synced: true,
          }));
        } else {
          setSettings((prev) => ({
            ...prev,
            synced: false,
          }));
        }
      }}
    />
  );
}

function AdvancedSettings({ engineName }: { engineName: string }) {
  const { t } = useTranslation();

  const navigate = useNavigate();
  const engines = useAtomValue(enginesAtom);

  return (
    <Tooltip label={t("Engines.Settings.AdvancedSettings")}>
      <ActionIcon
        variant="default"
        onClick={() =>
          navigate({
            to: "/engines",
            search: {
              selected: (engines ?? []).findIndex((o) => o.name === engineName),
            },
          })
        }
      >
        <IconSettings size="1rem" />
      </ActionIcon>
    </Tooltip>
  );
}

export default memo(EngineSettingsForm);
