import { Select } from "@mantine/core";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { enginesAtom } from "@/state/atoms";
import type { LocalEngine } from "@/utils/engines";

export function EnginesSelect({
  engine,
  setEngine,
  filterEngine,
  label,
  description,
  placeholder,
}: {
  engine: LocalEngine | null;
  setEngine: (engine: LocalEngine | null) => void;
  filterEngine?: (engine: LocalEngine) => boolean;
  label?: string;
  description?: string;
  placeholder?: string;
}) {
  const allEngines = useAtomValue(enginesAtom);
  const engines = (allEngines ?? [])
    .filter((e): e is LocalEngine => e.type === "local")
    .filter((engine) => (filterEngine ? filterEngine(engine) : true));

  useEffect(() => {
    if (engines.length > 0 && engine === null) {
      setEngine(engines[0]);
    }
  }, [engine, engines, setEngine]);

  return (
    <Select
      label={label}
      description={description}
      placeholder={placeholder}
      allowDeselect={false}
      data={engines?.map((engine) => ({
        label: engine.name,
        value: engine.id,
      }))}
      value={engine?.id ?? ""}
      onChange={(e) => {
        setEngine(engines.find((engine) => engine.id === e) ?? null);
      }}
    />
  );
}
