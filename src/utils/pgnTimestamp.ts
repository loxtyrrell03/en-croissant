/** Read a UTC PGN date without allowing JavaScript's calendar rollover. */
export function parsePgnDateTime(date: string | null | undefined, time?: string | null): number | null {
  const parts = date?.trim().match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(.*)$/);
  if (!parts) return null;
  const [, yearText, monthText, dayText, suffix] = parts;
  const year = Number(yearText), month = Number(monthText) - 1, day = Number(dayText);
  const stamp = new Date(0);
  stamp.setUTCFullYear(year, month, day);
  if (stamp.getUTCFullYear() !== year || stamp.getUTCMonth() !== month || stamp.getUTCDate() !== day) return null;

  if (suffix) {
    const isoTime = suffix.match(/^T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/);
    if (!isoTime || Number(isoTime[1]) >= 24 || Number(isoTime[2]) >= 60 || Number(isoTime[3] ?? 0) >= 60) return null;
    const normalized = `${yearText}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}${suffix}`;
    const parsed = Date.parse(/[Z]|[+-]\d{2}:\d{2}$/.test(suffix) ? normalized : `${normalized}Z`);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // An unknown/malformed time must not discard a valid day or invent another.
  const clock = time?.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (clock && Number(clock[1]) < 24 && Number(clock[2]) < 60 && Number(clock[3] ?? 0) < 60) {
    stamp.setUTCHours(Number(clock[1]), Number(clock[2]), Number(clock[3] ?? 0));
  }
  return stamp.getTime();
}

/** Provider completion headers take precedence, matching existing import order. */
export function onlinePgnTimestamp(pgn: string): number {
  const header = (name: string) => pgn.match(new RegExp(`^\\s*\\[${name}\\s+"([^"]*)"\\]`, "m"))?.[1];
  return parsePgnDateTime(header("EndDate") ?? header("UTCDate") ?? header("Date"),
    header("EndTime") ?? header("UTCTime") ?? header("Time")) ?? 0;
}
