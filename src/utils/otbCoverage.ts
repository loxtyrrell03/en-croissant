export type OtbCoverage = {
  status: "complete" | "partial" | "unknown" | "stopped";
  gaps: string[];
};

type Report = { coverageComplete?: boolean; coverageGaps?: string[]; cancelled?: boolean };

/** Keep unavailable coverage distinct from zero games and unrecorded legacy data. */
export function getOtbCoverage(report: Report | null | undefined): OtbCoverage {
  const gaps = (Array.isArray(report?.coverageGaps) ? report.coverageGaps : [])
    .filter((gap): gap is string => typeof gap === "string" && !!gap.trim())
    .slice(0, 12)
    .map((gap) => {
      const clean = gap.split(/<!doctype|<html/i)[0].trim().replace(/:\s*$/, "");
      const source = clean.split(":")[0];
      if (/\b403\b|forbidden/i.test(clean)) return `${source}: access was refused (403).`;
      if (/\b429\b|too many requests/i.test(clean)) return `${source}: the source asked us to slow down (429).`;
      return clean.slice(0, 500);
    });
  return {
    status: report?.cancelled ? "stopped" : report?.coverageComplete === false || gaps.length
      ? "partial" : report?.coverageComplete === true ? "complete" : "unknown",
    gaps,
  };
}

export function otbCoverageWarning(coverage: OtbCoverage | null | undefined): string | null {
  if (!coverage || coverage.status === "complete") return null;
  if (coverage.status === "unknown") return "Source coverage was not recorded for this import. Saved games are usable, but may be incomplete.";
  if (coverage.status === "stopped") return "The search stopped before every source finished. Saved games are usable, but more games may be missing.";
  return "Some selected sources did not finish. Saved games are usable, but more games may be missing.";
}
