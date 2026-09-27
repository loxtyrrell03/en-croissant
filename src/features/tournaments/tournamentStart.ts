import type { TournamentSnapshot } from "@/features/tournaments/platform";

export type TournamentStartInfo = Pick<TournamentSnapshot, "dateRange"> & Partial<Pick<TournamentSnapshot, "roundOneStart" | "completedRound" | "publishedRound" | "liveRound" | "phase">>;
export interface TournamentCountdown { label: string; detail: string; dateTime?: string }

function calendarDate(value: string | null | undefined): Date | null {
  const match = value?.match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:$|\s+to\s+)/);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d) ? date : null;
}

export function tournamentCountdown(info: TournamentStartInfo, now: number): TournamentCountdown | null {
  if (info.phase === "complete" || (info.completedRound ?? 0) > 0 || (info.publishedRound ?? 0) > 1 || info.liveRound != null) return null;
  const start = info.roundOneStart;
  const precise = start?.startsAt;
  // Do not let Date.parse interpret a bare wall-clock time in the viewer's time zone.
  const timestamp = precise && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(precise) && calendarDate(precise.slice(0,10)) ? Date.parse(precise) : NaN;
  if (Number.isFinite(timestamp)) {
    const minutes = Math.ceil((timestamp - now) / 60_000);
    const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60);
    const amount = days > 0 ? `${days} day${days === 1 ? "" : "s"}${hours ? ` ${hours} hour${hours === 1 ? "" : "s"}` : ""}`
      : hours > 0 ? `${hours} hour${hours === 1 ? "" : "s"}${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;
    return {
      label: minutes > 0 ? `Round 1 in ${amount}` : "Round 1 start time passed",
      detail: new Intl.DateTimeFormat(undefined, { day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",timeZoneName:"short" }).format(timestamp),
      dateTime: precise!,
    };
  }
  const date = calendarDate(start?.date) ?? calendarDate(info.dateRange);
  if (!date) return { label: "Start date not published", detail: "" };
  const today = new Date(now);
  const days = Math.round((date.getTime() - Date.UTC(today.getFullYear(),today.getMonth(),today.getDate())) / 86_400_000);
  const label = days === 0 ? "Starts today" : days === 1 ? "Starts tomorrow" : days > 1 ? `Starts in ${days} days` : "Start date passed";
  const dateLabel = new Intl.DateTimeFormat(undefined, {day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(date);
  const time = start?.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(start.time) ? `${start.time} event local time · time zone unavailable` : start ? "time not published" : "start time unavailable";
  return { label, detail: `${dateLabel} · ${time}`, dateTime: date.toISOString().slice(0,10) };
}
