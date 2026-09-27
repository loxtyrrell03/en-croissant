import { useSyncExternalStore } from "react";
import { tournamentCountdown, type TournamentStartInfo } from "./tournamentStart";
import styles from "./TournamentStartCountdown.module.css";

const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
function tick() { now = Date.now(); listeners.forEach(listener => listener()); }
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    tick();
    timer = setInterval(tick, 30_000);
    globalThis.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer); timer = undefined;
      globalThis.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    }
  };
}

/** Shared clock across the directory, event, tracker and Home summary. */
export function TournamentStartCountdown({ info, compact = false }: { info: TournamentStartInfo; compact?: boolean }) {
  const current = useSyncExternalStore(subscribe, () => now, () => now);
  const countdown = tournamentCountdown(info, current);
  if (!countdown) return null;
  return <span className={styles.countdown} data-compact={compact || undefined} aria-label="Tournament start">
    <strong>{countdown.label}</strong>
    {countdown.detail && <time dateTime={countdown.dateTime}>{countdown.detail}</time>}
  </span>;
}
