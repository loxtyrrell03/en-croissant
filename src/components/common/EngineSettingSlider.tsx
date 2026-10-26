import { TextInput } from "@mantine/core";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { PerformanceHelp } from "@/shared/PerformanceHelp";
import classes from "./EngineSettingSlider.module.css";

/** The saved value stays visible outside a new range. Only a completed edit
 * can replace it, and drafts never reach preferences or an engine request. */
export function EngineSettingSlider({
  label,
  value,
  bounds,
  disabled = false,
  onCommit,
  step = 1,
  unit = "",
  stops,
  help,
  color,
}: {
  label: string;
  value: number;
  bounds: { min: number; max: number };
  disabled?: boolean;
  onCommit: (value: number) => void;
  step?: number;
  unit?: string;
  stops?: number[];
  help?: ReactNode;
  color?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(value);
  saved.current = value;
  const submitted = useRef(value);
  const latest = useRef<{ draft: string; kind: "range" | "exact" | null; canceled: boolean }>({
    draft: String(value),
    kind: null,
    canceled: false,
  });
  function change(text: string, kind: "range" | "exact" | null) {
    latest.current = { draft: text, kind, canceled: false };
    setDraft(text);
    setError(null);
  }
  function cancel() {
    latest.current = { draft: String(saved.current), kind: null, canceled: true };
    submitted.current = saved.current;
    setDraft(String(saved.current));
    setError(null);
  }
  function finish() {
    if (!latest.current.kind || latest.current.canceled) return;
    const text = latest.current.draft.trim(),
      number = Number(text);
    latest.current.kind = null;
    if (
      !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) ||
      !Number.isFinite(number) ||
      number < bounds.min ||
      number > bounds.max ||
      Math.abs(number / step - Math.round(number / step)) > 0.00001
    ) {
      setError(
        `Choose ${step === 1 ? "a whole number" : "a value"} from ${bounds.min} to ${bounds.max}${unit ? ` ${unit}` : ""}.`,
      );
      return;
    }
    if (number !== submitted.current) {
      submitted.current = number;
      onCommit(number);
    }
  }
  useEffect(() => {
    cancel();
  }, [value]);
  useEffect(() => {
    if (latest.current.kind === "range") cancel();
  }, [bounds.min, bounds.max]);
  useEffect(() => {
    const blur = () => cancel();
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, []);
  const choices = stops
    ? [
        ...new Set([
          bounds.min,
          bounds.max,
          ...stops,
          ...(value >= bounds.min && value <= bounds.max ? [value] : []),
        ]),
      ]
        .filter((n) => n >= bounds.min && n <= bounds.max)
        .sort((a, b) => a - b)
    : null;
  const clamped = Math.max(bounds.min, Math.min(bounds.max, Number(draft) || bounds.min));
  const index =
    choices?.reduce(
      (closest, choice, i) =>
        Math.abs(choice - clamped) < Math.abs(choices[closest] - clamped) ? i : closest,
      0,
    ) ?? 0;
  const outOfRange = value < bounds.min || value > bounds.max;
  const hintId = `${id}-range-message`;
  const keys = [
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
    "PageUp",
    "PageDown",
  ];
  const displayed = (number: number) => `${number}${unit ? ` ${unit}` : ""}`;
  const message =
    error ??
    (outOfRange
      ? `Saved value ${displayed(value)} is outside the current range. It stays unchanged until you choose a new value.`
      : undefined);
  return (
    <div className={classes.field}>
      <label htmlFor={id}>
        {label}
        {help && <PerformanceHelp label={`About ${label.toLowerCase()}`}>{help}</PerformanceHelp>}
      </label>
      <input
        type="range"
        className={classes.range}
        aria-label={`${label} slider`}
        min={choices ? 0 : bounds.min}
        max={choices ? choices.length - 1 : bounds.max}
        step={choices ? 1 : step}
        value={choices ? index : clamped}
        aria-valuetext={
          Number.isFinite(Number(draft)) ? displayed(Number(draft)) : "Enter a valid value"
        }
        disabled={disabled || bounds.min === bounds.max}
        style={color ? { accentColor: `var(--mantine-color-${color}-6)` } : undefined}
        onFocus={() => {
          latest.current.canceled = false;
        }}
        onPointerDown={(event) => {
          const number = choices
            ? choices[Number(event.currentTarget.value)]
            : Number(event.currentTarget.value);
          change(outOfRange ? String(number) : draft, "range");
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onChange={(event) => {
          if (latest.current.canceled) return;
          const direct = latest.current.kind === null;
          change(
            choices
              ? String(choices[Number(event.currentTarget.value)])
              : event.currentTarget.value,
            "range",
          );
          if (direct) finish();
        }}
        onPointerUp={() => {
          if (latest.current.kind === "range") finish();
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={() => {
          if (latest.current.kind === "range") cancel();
        }}
        onBlur={() => {
          if (latest.current.kind === "range") finish();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          } else if (keys.includes(event.key)) {
            event.stopPropagation();
            latest.current.canceled = false;
            latest.current.kind = "range";
            if (outOfRange && ["Home", "End"].includes(event.key))
              change(String(event.key === "Home" ? bounds.min : bounds.max), "range");
          }
        }}
        onKeyUp={(event) => {
          if (keys.includes(event.key)) {
            event.stopPropagation();
            if (latest.current.kind === "range") finish();
          }
        }}
      />
      <TextInput
        id={id}
        className={classes.exact}
        aria-label={label}
        inputMode={step === 1 ? "numeric" : "decimal"}
        value={draft}
        disabled={disabled}
        error={message}
        errorProps={{ id: hintId }}
        inputWrapperOrder={["input"]}
        onChange={(event) => change(event.currentTarget.value, "exact")}
        onBlur={() => {
          if (latest.current.kind === "exact") finish();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            finish();
          }
        }}
      />
      <span className={classes.hint}>
        Min {displayed(bounds.min)} · Max {displayed(bounds.max)}
      </span>
      {message && (
        <span
          id={hintId}
          className={`${classes.hint} ${classes.error}`}
          role={error ? "alert" : "status"}
        >
          {message}
        </span>
      )}
    </div>
  );
}
