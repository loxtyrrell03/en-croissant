import { describe, expect, it } from "vitest";
import { otbArchiveDates, otbAvailableMonths, otbCollectionDates, otbCoverage, otbCutoff } from "../otbDownloadPresentation";
import type { DataPackEntry } from "@/features/tournaments/platform";
const entry = { periodStart: "2020-01", periodEnd: "2026-07" } as DataPackEntry;
describe("OTB coverage labels", () => {
  it("shows gaps, sorts and deduplicates rather than claiming uninterrupted coverage", () => {
    expect(otbCoverage(["2026-05", "2026-01", "2026-02", "2026-05", "bad"])).toBe("Jan 2026–Feb 2026; May 2026");
    expect(otbCoverage([])).toBe("None");
  });
  it("changes retained dates while keeping fixed archive coverage intact", () => {
    const cutoff = otbCutoff(3, new Date("2026-09-11T12:00:00Z"));
    expect(cutoff).toBe("2023-09");
    expect(otbCoverage(otbAvailableMonths([entry], cutoff))).toBe("Sept 2023–Jul 2026");
    expect(otbAvailableMonths([entry])).toHaveLength(79);
  });
  it("does not invent months between separate archives or after the available end", () => {
    expect(otbAvailableMonths([{ ...entry, periodStart: "2026-01", periodEnd: "2026-01" }, { ...entry, periodStart: "2026-03", periodEnd: "2026-03" }])).toEqual(["2026-01", "2026-03"]);
    expect(otbAvailableMonths([entry], "2027-01")).toEqual([]);
  });
});

describe("collection date changes", () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const august = { ...entry, periodStart: "2026-08", periodEnd: "2026-08" };
  const saved = otbAvailableMonths([{ ...entry, periodStart: "2021-09", periodEnd: "2026-08" }]);
  it("names the missing older months separately from the full archive being downloaded", () => {
    const dates = otbCollectionDates([entry, august], saved, 10, now);
    expect(otbCoverage(dates.missing)).toBe("Jan 2020–Aug 2021");
    expect(dates.missing).toHaveLength(20);
    const file = otbArchiveDates(entry, dates.missing);
    expect(otbCoverage(file.archive)).toBe("Jan 2020–Jul 2026");
    expect(file.adding).toEqual(dates.missing);
    expect(file.includesExtraMonths).toBe(true);
  });
  it("names only saved months being deleted when retention is shortened", () => {
    const dates = otbCollectionDates([entry, august], saved, 3, now);
    expect(otbCoverage(dates.removing)).toBe("Sept 2021–Aug 2023");
    expect(dates.removing).toHaveLength(24);
    expect(otbCoverage(dates.keeping)).toBe("Sept 2023–Aug 2026");
    expect(dates.missing).toEqual([]);
  });
  it("preserves holes in both missing and deleted months", () => {
    const dates = otbCollectionDates([entry], ["2020-01", "2020-03", "2020-03", "invalid"], 5, now);
    expect(otbCoverage(dates.removing)).toBe("Jan 2020; Mar 2020");
    const gaps = otbCollectionDates([{ ...entry, periodStart: "2026-01", periodEnd: "2026-06" }], ["2026-02", "2026-04"], null, now);
    expect(otbCoverage(gaps.missing)).toBe("Jan 2026; Mar 2026; May 2026–Jun 2026");
  });
  it("distinguishes other missing dates from the current archive", () => {
    const dates = otbCollectionDates([entry, august], saved.filter(month => month !== "2026-08"), 10, now);
    const file = otbArchiveDates(entry, dates.missing);
    expect(otbCoverage(file.adding)).toBe("Jan 2020–Aug 2021");
    expect(file.otherMissing).toEqual(["2026-08"]);
  });
  it("does not invent date coverage for unknown archive metadata", () => {
    expect(otbArchiveDates({ ...entry, periodStart: undefined }, ["2026-08"])).toMatchObject({ archive: [], adding: [], otherMissing: [] });
  });
});
