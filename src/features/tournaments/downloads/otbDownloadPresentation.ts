import type { DataPackEntry } from "@/features/tournaments/platform";

export const otbSize = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;
export const otbCutoff = (years: number | null, now = new Date()) => years === null ? "2020-01" : `${now.getUTCFullYear() - years}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
const valid = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const ordinal = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1;
const month = (value: string) => new Date(`${value}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
export function otbCoverage(months: string[]) {
  const sorted = [...new Set(months.filter(valid))].sort();
  const spans: string[] = [];
  for (let i = 0; i < sorted.length;) {
    const first = sorted[i]; let last = first;
    while (++i < sorted.length && ordinal(sorted[i]) === ordinal(last) + 1) last = sorted[i];
    spans.push(first === last ? month(first) : `${month(first)}–${month(last)}`);
  }
  return spans.join("; ") || "None";
}
export function otbAvailableMonths(entries: DataPackEntry[], cutoff = "2020-01") {
  const months = new Set<string>();
  for (const entry of entries) {
    if (!entry.periodStart || !entry.periodEnd || !valid(entry.periodStart) || !valid(entry.periodEnd)) continue;
    for (let n = ordinal(entry.periodStart); n <= ordinal(entry.periodEnd) && n < ordinal(entry.periodStart) + 1200; n++) {
      const value = `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`;
      if (value >= cutoff) months.add(value);
    }
  }
  return [...months].sort();
}

/** Compare actual saved months with the requested collection, preserving holes. */
export function otbCollectionDates(entries: DataPackEntry[], savedMonths: string[], years: number | null, now = new Date()) {
  const cutoff = otbCutoff(years, now);
  const saved = [...new Set(savedMonths.filter(valid))].sort();
  const savedSet = new Set(saved);
  const selected = otbAvailableMonths(entries, cutoff);
  return {
    selected,
    missing: selected.filter(month => !savedSet.has(month)),
    removing: saved.filter(month => month < cutoff),
    keeping: saved.filter(month => month >= cutoff),
  };
}

/** An archive may contain years that are already saved or outside retention. */
export function otbArchiveDates(entry: DataPackEntry, missingMonths: string[]) {
  const archive = otbAvailableMonths([entry]);
  const archiveSet = new Set(archive);
  const adding = missingMonths.filter(month => archiveSet.has(month));
  return { archive, adding, otherMissing: archive.length ? missingMonths.filter(month => !archiveSet.has(month)) : [], includesExtraMonths: archive.length > adding.length };
}

export const otbMonthCount = (months: string[]) => `${months.length} ${months.length === 1 ? "month" : "months"}`;
