import { useStore } from "jotai";
import type { EngineConfig } from "@/bindings";
import { enginesAtom } from "@/state/atoms";
import type { LocalEngine } from "@/utils/engines";
import { prepareNativeProfileEdit, withAnalysisPatch } from "@/utils/nativeAnalysisEdits";
import { analysisLineBounds, analysisLines } from "@/utils/nativeAnalysisSettings";
import { AnalysisSearchControls } from "./AnalysisSearchControls";

export function NativeProfileSearchControls({
  engine,
  config,
}: {
  engine: LocalEngine;
  config: EngineConfig;
}) {
  const atoms = useStore();
  return (
    <AnalysisSearchControls
      go={engine.go ?? { t: "Infinite" }}
      lines={analysisLines(engine.settings ?? [])}
      lineBounds={analysisLineBounds(config)}
      scope="Saved defaults for this engine. Synced tabs use these search settings."
      successLabel="Search settings saved."
      prepare={(patch) =>
        prepareNativeProfileEdit(
          engine,
          () => atoms.get(enginesAtom),
          (value) => atoms.set(enginesAtom, value),
          (current) => withAnalysisPatch(current, patch),
        )
      }
    />
  );
}
