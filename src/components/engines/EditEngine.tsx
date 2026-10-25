import { useForm } from "@mantine/form";
import { useAtom, useStore } from "jotai";
import { useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { enginesAtom } from "@/state/atoms";
import type { LocalEngine } from "@/utils/engines";
import { enginePreferences } from "@/utils/enginePreferences";
import EngineForm from "./EngineForm";
import { EnginePreferencesNotice } from "./EnginePreferencesNotice";

export default function EditEngine({ initialEngine }: { initialEngine: LocalEngine }) {
  return <EditEngineForm key={initialEngine.id} initialEngine={initialEngine} />;
}
function EditEngineForm({ initialEngine }: { initialEngine: LocalEngine }) {
  const { t } = useTranslation();

  const [engines, setEngines] = useAtom(enginesAtom);
  const atoms = useStore();
  const preferences = useSyncExternalStore(
    enginePreferences.subscribe,
    enginePreferences.getSnapshot,
  );
  const baseline = useRef(JSON.stringify(initialEngine));
  const trustedPath = useRef(initialEngine.path);
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const form = useForm<LocalEngine>({
    initialValues: initialEngine,

    validate: {
      name: (value) => {
        if (!value) return "Name is required";
        if ((engines ?? []).find((e) => e.name === value && e.id !== initialEngine.id))
          return "Name already used";
      },
      path: (value) => {
        if (!value) return "Path is required";
      },
    },
  });

  return (
    <>
      <EnginePreferencesNotice />
      <EngineForm
        submitLabel={t("Common.Save")}
        form={form}
        trustedPath={trustedPath.current}
        disabled={
          preferences.phase === "loading" ||
          preferences.phase === "error" ||
          preferences.saving ||
          (!saving && (preferences.pending || !!preferences.error))
        }
        registration={
          saving
            ? {
                saved:
                  !preferences.saving &&
                  !preferences.pending &&
                  !preferences.error &&
                  enginePreferences.isSavedValue(engines),
              }
            : undefined
        }
        onSubmit={async (values) => {
          if (pending.current) {
            if (!enginePreferences.isSavedValue(atoms.get(enginesAtom)))
              await enginePreferences.retry();
          } else {
            const current = atoms.get(enginesAtom);
            if (!current || !enginePreferences.isSavedValue(current))
              throw new Error("Load and save engine settings before editing.");
            const original = current.find((engine) => engine.id === initialEngine.id);
            if (JSON.stringify(original) !== baseline.current)
              throw new Error("This engine profile changed. Reopen it before saving.");
            pending.current = true;
            setSaving(true);
            setEngines(current.map((engine) => (engine.id === initialEngine.id ? values : engine)));
          }
          await enginePreferences.flush();
          const saved = atoms.get(enginesAtom)?.find((engine) => engine.id === initialEngine.id);
          if (
            !saved ||
            saved.type !== "local" ||
            !enginePreferences.isSavedValue(atoms.get(enginesAtom))
          )
            throw new Error(
              "The engine profile was removed or has not saved. Reopen it before editing.",
            );
          baseline.current = JSON.stringify(saved);
          trustedPath.current = saved.path;
          form.setInitialValues(saved);
          form.setValues(saved);
          pending.current = false;
          setSaving(false);
        }}
      />
    </>
  );
}
