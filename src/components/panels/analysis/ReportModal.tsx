import { Button, Checkbox, Group, Modal, Select, Stack } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useAtom, useAtomValue } from "jotai";
import { memo, useContext, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { commands } from "@/bindings";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { enginesAtom, referenceDbAtom } from "@/state/atoms";
import type { LocalEngine } from "@/utils/engines";
import { reportSettingsAtom } from "@/state/gameAnalysisSettings";
import { recordGameReportRun } from "@/utils/gameReportRun";
import { nativeGameReportLimits, validGameReportLimit } from "@/utils/gameAnalysisSettings";
import { beginGameReport } from "@/utils/gameReportOwnership";
import GameAnalysisLimitControls from "./GameAnalysisLimitControls";
import { getMainLine } from "@/utils/chess";

function ReportModal({
  tab,
  reportingMode,
  toggleReportingMode,
  setInProgress,
}: {
  tab: string;
  reportingMode: boolean;
  toggleReportingMode: () => void;
  setInProgress: (value: boolean) => void;
}) {
  const { t } = useTranslation();

  const referenceDb = useAtomValue(referenceDbAtom);
  const engines = useAtomValue(enginesAtom);
  const localEngines = useMemo(
    () => (engines ?? []).filter((e): e is LocalEngine => e.type === "local"),
    [engines],
  );
  const store = useContext(TreeStateContext)!;
  const addAnalysis = useStore(store, (s) => s.addAnalysis);

  const [reportSettings, setReportSettings] = useAtom(reportSettingsAtom);

  const form = useForm({
    initialValues: reportSettings,
    validate: {
      goMode: (value) => (validGameReportLimit(value) ? null : "Choose valid analysis limits."),
      engine: (value) => {
        if (!value) return t("Board.Analysis.EngineRequired");
      },
      novelty: (value) => {
        if (value && !referenceDb) return t("Board.Analysis.RefDBRequired");
      },
    },
  });

  const setFormValues = form.setValues;
  const setFormField = form.setFieldValue;
  const selectedEngine = form.values.engine;
  const hydrated = useRef(false);
  useEffect(() => {
    if (!reportingMode) {
      hydrated.current = false;
      return;
    }
    const preferredEngine = hydrated.current
      ? selectedEngine || reportSettings.engine
      : reportSettings.engine;
    const engine =
      localEngines.length === 0
        ? ""
        : !preferredEngine || !localEngines.some((l) => l.id === preferredEngine)
          ? localEngines[0].id
          : preferredEngine;

    if (!hydrated.current) {
      setFormValues({ ...reportSettings, engine });
      hydrated.current = true;
    } else if (engine !== selectedEngine) setFormField("engine", engine);
  }, [localEngines, reportSettings, reportingMode, selectedEngine, setFormField, setFormValues]);

  async function analyze() {
    const settings = form.values;
    const limits = nativeGameReportLimits(settings.goMode);
    const engine = localEngines.find((e) => e.id === settings.engine);
    if (!engine) {
      form.setFieldError("engine", t("Board.Analysis.EngineRequired"));
      return;
    }
    const id = `report_${tab}`;
    const snapshot = store.getState().root;
    let owner: ReturnType<typeof beginGameReport>;
    try {
      owner = beginGameReport(store, () => {
        store.getState().setReportError("The game changed. Run analysis again for this line.");
        void commands.cancelAnalysis(id).catch(() => {});
      });
    } catch (error) {
      store.getState().setReportError(error instanceof Error ? error.message : String(error));
      toggleReportingMode();
      return;
    }
    store.getState().setReportError(null);
    setReportSettings(settings);
    setInProgress(true);
    toggleReportingMode();
    const engineSettings = (engine.settings ?? []).map((s) => ({
      ...s,
      value: s.value?.toString() ?? "",
    }));

    try {
      const analysis = await commands.analyzeGame(
        id,
        engine.path,
        limits.goMode,
        {
          annotateNovelties: settings.novelty,
          fen: snapshot.fen,
          referenceDb,
          reversed: settings.reversed,
          moves: getMainLine(snapshot),
          searchLimits: limits.searchLimits,
        },
        engineSettings,
      );
      if (!owner.isOwner() || !owner.hasSameGame()) return;
      if (analysis.status === "ok") {
        addAnalysis(analysis.data, {
          showVariations: settings.variations,
        });
        await recordGameReportRun(
          store,
          { engine: engine.name, limit: settings.goMode },
          () => owner.isOwner() && owner.hasSameGame(),
        );
      } else if (!/cancel/i.test(analysis.error)) {
        store.getState().setReportError(analysis.error);
      }
    } catch (error) {
      if (owner.isOwner() && owner.hasSameGame())
        store.getState().setReportError(error instanceof Error ? error.message : String(error));
    } finally {
      if (owner.isOwner()) setInProgress(false);
      owner.finish();
    }
  }

  return (
    <Modal
      opened={reportingMode}
      onClose={() => toggleReportingMode()}
      title={t("Board.Analysis.GenerateReport")}
    >
      <form onSubmit={form.onSubmit(() => analyze())}>
        <Stack>
          <Select
            allowDeselect={false}
            withAsterisk
            label={t("Common.Engine")}
            placeholder="Pick one"
            data={
              localEngines.map((engine) => {
                return {
                  value: engine.id,
                  label: engine.name,
                };
              }) ?? []
            }
            {...form.getInputProps("engine")}
          />
          <GameAnalysisLimitControls
            value={form.values.goMode}
            onChange={(value) => form.setFieldValue("goMode", value)}
            error={form.errors.goMode}
          />

          <Checkbox
            label={t("Board.Analysis.Reversed")}
            description={t("Board.Analysis.Reversed.Desc")}
            {...form.getInputProps("reversed", { type: "checkbox" })}
          />

          <Checkbox
            label={t("Board.Analysis.AnnotateNovelties")}
            description={t("Board.Analysis.AnnotateNovelties.Desc")}
            {...form.getInputProps("novelty", { type: "checkbox" })}
          />

          <Checkbox
            label={t("Board.Analysis.ShowVariations")}
            description={t("Board.Analysis.ShowVariations.Desc")}
            {...form.getInputProps("variations", { type: "checkbox" })}
          />

          <Group justify="right">
            <Button type="submit">{t("Board.Analysis.Analyze")}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export default memo(ReportModal);
