import {
  Center,
  Divider,
  Group,
  InputWrapper,
  NumberInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconCpu, IconRobot, IconUser } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { GoMode } from "@/bindings";
import GoModeInput from "@/components/common/GoModeInput";
import TimeInput, { type TimeType } from "@/components/common/TimeInput";
import EngineSettingsForm from "@/components/panels/analysis/EngineSettingsForm";
import type { TimeControlField } from "@/utils/clock";
import type { EngineSettings, LocalEngine } from "@/utils/engines";
import {
  createDefaultPracticeBotProfile,
  describePracticeBotBackend,
  type PracticeBotProfile,
} from "@/utils/practiceBot";
import { EnginesSelect } from "./EnginesSelect";

export type OpponentSettings =
  | {
      type: "human";
      timeControl?: TimeControlField;
      name?: string;
      timeUnit?: TimeType;
      incrementUnit?: TimeType;
    }
  | {
      type: "engine";
      timeControl?: TimeControlField;
      engine: LocalEngine | null;
      go: GoMode;
      engineSettings?: EngineSettings;
      botProfile?: PracticeBotProfile;
      timeUnit?: TimeType;
      incrementUnit?: TimeType;
    };

export const DEFAULT_TIME_CONTROL: TimeControlField = {
  seconds: 180_000,
  increment: 2_000,
};

export function OpponentForm({
  sameTimeControl,
  opponent,
  setOpponent,
  setOtherOpponent,
}: {
  sameTimeControl: boolean;
  opponent: OpponentSettings;
  setOpponent: React.Dispatch<React.SetStateAction<OpponentSettings>>;
  setOtherOpponent: React.Dispatch<React.SetStateAction<OpponentSettings>>;
}) {
  const { t } = useTranslation();

  const opponentMode =
    opponent.type === "human" ? "human" : opponent.botProfile?.enabled ? "trainer" : "engine";

  function updateType(type: "engine" | "human" | "trainer") {
    if (type === "human") {
      setOpponent((prev) => ({
        ...prev,
        type: "human",
        name: "Player",
      }));
    } else if (type === "trainer") {
      setOpponent((prev) => ({
        ...prev,
        type: "engine",
        engine: null,
        go: { t: "Nodes", c: 1 },
        engineSettings: undefined,
        botProfile: {
          ...(("botProfile" in prev && prev.botProfile) || createDefaultPracticeBotProfile(null)),
          enabled: true,
          kind: "maia",
        },
      }));
    } else {
      setOpponent((prev) => ({
        ...prev,
        type: "engine",
        engine: null,
        go: ("go" in prev && prev.go) || { t: "Depth", c: 24 },
        engineSettings: undefined,
        botProfile: {
          ...(("botProfile" in prev && prev.botProfile) || createDefaultPracticeBotProfile(null)),
          enabled: false,
        },
      }));
    }
  }

  function updateBotProfile(fn: (profile: PracticeBotProfile) => PracticeBotProfile) {
    setOpponent((prev) => {
      if (prev.type === "human") return prev;
      const profile = prev.botProfile ?? createDefaultPracticeBotProfile(prev.engine);
      return {
        ...prev,
        botProfile: fn(profile),
      };
    });
  }

  return (
    <Stack flex={1}>
      <SegmentedControl
        data={[
          {
            value: "human",
            label: (
              <Center style={{ gap: 10 }}>
                <IconUser size={16} />
                <span>{t("Board.Opponent.Human")}</span>
              </Center>
            ),
          },
          {
            value: "trainer",
            label: (
              <Center style={{ gap: 10 }}>
                <IconRobot size={16} />
                <span>Trainer</span>
              </Center>
            ),
          },
          {
            value: "engine",
            label: (
              <Center style={{ gap: 10 }}>
                <IconCpu size={16} />
                <span>{t("Common.Engine")}</span>
              </Center>
            ),
          },
        ]}
        value={opponentMode}
        onChange={(v) => updateType(v as "human" | "trainer" | "engine")}
      />

      {opponent.type === "human" && (
        <TextInput
          value={opponent.name ?? ""}
          onChange={(e) => setOpponent((prev) => ({ ...prev, name: e.target.value }))}
        />
      )}

      {opponent.type === "engine" && !opponent.botProfile?.enabled && (
        <EnginesSelect
          engine={opponent.engine}
          setEngine={(engine) =>
            setOpponent((prev) => ({
              ...prev,
              engine,
              engineSettings: engine?.settings || undefined,
              botProfile:
                prev.type === "engine"
                  ? {
                      ...(prev.botProfile ?? createDefaultPracticeBotProfile(engine)),
                      enabled: false,
                    }
                  : undefined,
            }))
          }
        />
      )}

      {opponent.type === "engine" && opponent.botProfile?.enabled && (
        <Stack>
          <Divider variant="dashed" label="Trainer Bot" />
          <NumberInput
            label="FIDE Elo"
            min={800}
            max={2600}
            step={50}
            value={opponent.botProfile.fideElo}
            onChange={(value) =>
              updateBotProfile((profile) => ({
                ...profile,
                fideElo: typeof value === "number" ? value : profile.fideElo,
              }))
            }
          />
          <Text size="xs" c="dimmed">
            {describePracticeBotBackend(opponent.botProfile)}
          </Text>
        </Stack>
      )}

      <Divider variant="dashed" label={t("Board.Opponent.TimeSettings")} />
      <SegmentedControl
        data={[
          { value: "time", label: t("GoMode.Time") },
          { value: "unlimited", label: t("Board.Opponent.Unlimited") },
        ]}
        value={opponent.timeControl ? "time" : "unlimited"}
        onChange={(v) => {
          setOpponent((prev) => ({
            ...prev,
            timeControl: v === "time" ? DEFAULT_TIME_CONTROL : undefined,
          }));
          if (sameTimeControl) {
            setOtherOpponent((prev) => ({
              ...prev,
              timeControl: v === "time" ? DEFAULT_TIME_CONTROL : undefined,
            }));
          }
        }}
      />
      <Group grow wrap="nowrap">
        {opponent.timeControl && (
          <>
            <InputWrapper label={t("GoMode.Time")}>
              <TimeInput
                defaultType="m"
                type={opponent.timeUnit}
                onTypeChange={(t) => {
                  setOpponent((prev) => ({ ...prev, timeUnit: t }));
                  if (sameTimeControl) {
                    setOtherOpponent((prev) => ({ ...prev, timeUnit: t }));
                  }
                }}
                value={opponent.timeControl.seconds}
                setValue={(v) => {
                  setOpponent((prev) => ({
                    ...prev,
                    timeControl: {
                      seconds: v.t === "Time" ? v.c : 0,
                      increment: prev.timeControl?.increment ?? 0,
                    },
                  }));
                  if (sameTimeControl) {
                    setOtherOpponent((prev) => ({
                      ...prev,
                      timeControl: {
                        seconds: v.t === "Time" ? v.c : 0,
                        increment: prev.timeControl?.increment ?? 0,
                      },
                    }));
                  }
                }}
              />
            </InputWrapper>
            <InputWrapper label={t("Board.Opponent.Increment")}>
              <TimeInput
                defaultType="s"
                type={opponent.incrementUnit}
                onTypeChange={(t) => {
                  setOpponent((prev) => ({ ...prev, incrementUnit: t }));
                  if (sameTimeControl) {
                    setOtherOpponent((prev) => ({ ...prev, incrementUnit: t }));
                  }
                }}
                value={opponent.timeControl.increment ?? 0}
                setValue={(v) => {
                  setOpponent((prev) => ({
                    ...prev,
                    timeControl: {
                      seconds: prev.timeControl?.seconds ?? 0,
                      increment: v.t === "Time" ? v.c : 0,
                    },
                  }));
                  if (sameTimeControl) {
                    setOtherOpponent((prev) => ({
                      ...prev,
                      timeControl: {
                        seconds: prev.timeControl?.seconds ?? 0,
                        increment: v.t === "Time" ? v.c : 0,
                      },
                    }));
                  }
                }}
              />
            </InputWrapper>
          </>
        )}
      </Group>

      {opponent.type === "engine" && !opponent.botProfile?.enabled && (
        <Stack>
          {!opponent.timeControl && (
            <GoModeInput
              gameMode
              goMode={opponent.go}
              setGoMode={(go) =>
                setOpponent((prev) => {
                  if (prev.type === "human") {
                    return prev;
                  }
                  return {
                    ...prev,
                    go,
                  };
                })
              }
            />
          )}
          <Divider variant="dashed" label={t("Board.Opponent.EngineSettings", "Engine Settings")} />
          {opponent.engine && (
            <EngineSettingsForm
              engine={opponent.engine}
              remote={false}
              gameMode
              settings={{
                go: opponent.go,
                settings: opponent.engineSettings || opponent.engine.settings || [],
                enabled: true,
                synced: false,
              }}
              setSettings={(fn) =>
                setOpponent((prev) => {
                  if (prev.type === "human") {
                    return prev;
                  }
                  const newSettings = fn({
                    go: prev.go,
                    settings: prev.engineSettings || prev.engine?.settings || [],
                    enabled: true,
                    synced: false,
                  });
                  return {
                    ...prev,
                    go: newSettings.go,
                    engineSettings: newSettings.settings,
                  };
                })
              }
              minimal={true}
            />
          )}
        </Stack>
      )}
    </Stack>
  );
}
