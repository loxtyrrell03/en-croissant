import { Button, Stack, Text } from "@mantine/core";
import { useAtomValue } from "jotai";
import { useRef } from "react";
import type { EngineConfig } from "@/bindings";
import { useNativeEngineConfig } from "@/hooks/useNativeEngineConfig";
import { useNativeTabSettings } from "@/hooks/useNativeTabSettings";
import { engineSearchErrorFamily } from "@/state/atoms";
import type { LocalEngine } from "@/utils/engines";
import { withAnalysisPatch, type NativeAnalysisPatch } from "@/utils/nativeAnalysisEdits";
import { analysisLineBounds, analysisLines } from "@/utils/nativeAnalysisSettings";
import { AnalysisSearchControls } from "./AnalysisSearchControls";

export function NativeTabSearchControls({ engine, tab }: { engine: LocalEngine; tab: string }) {
  const { data: config, error, mutate } = useNativeEngineConfig(engine.path);
  if (!config)
    return (
      <Stack gap="xs">
        <Text size="xs" role={error ? "alert" : "status"}>
          {error ? "Could not read this engine's search options." : "Reading search options…"}
        </Text>
        {error && (
          <Button size="compact-xs" variant="subtle" onClick={() => void mutate().catch(() => {})}>
            Retry search options
          </Button>
        )}
      </Stack>
    );
  return <NativeTabSearchEditor engine={engine} tab={tab} config={config} />;
}

function NativeTabSearchEditor({
  engine,
  tab,
  config,
}: {
  engine: LocalEngine;
  tab: string;
  config: EngineConfig;
}) {
  const { settings, scope, prepare } = useNativeTabSettings(engine, tab);
  const previous = useRef<NativeAnalysisPatch | null>(null);
  const error = useAtomValue(engineSearchErrorFamily({ engine: engine.id, tab }));
  return (
    <AnalysisSearchControls
      key={`${scope}:${settings.synced}`}
      go={settings.go}
      lines={analysisLines(settings.settings)}
      lineBounds={analysisLineBounds(config)}
      scope={
        settings.synced
          ? "Saved defaults for this engine and synced tabs."
          : "Applies to this tab. Saved defaults stay as selected."
      }
      successLabel={settings.synced ? "Search settings saved." : "Tab search updated."}
      requestError={error}
      previous={previous.current}
      prepare={(patch) =>
        prepare(
          (current) => withAnalysisPatch(current, patch),
          (before) => {
            previous.current = { go: before.go, lines: analysisLines(before.settings) };
          },
        )
      }
    />
  );
}
