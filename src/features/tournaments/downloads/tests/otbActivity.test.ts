import { describe, expect, it } from "vitest";
import type { DataPackJob, OtbLibraryStatus } from "@/features/tournaments/platform";
import { otbActivity } from "../otbActivity";

const library: OtbLibraryStatus = { managed: true, downloaded: true, enabled: true, keepYears: null, months: ["2026-08"], bytes: 49e8, parent: "D:/data", importedIds: [], pendingIds: [], maintenanceNeeded: false };
const input = { library, operation: null, managing: false, pending: "", checking: false, statusError: "", issue: "", missing: 0, automatic: true, removed: false };
const job: DataPackJob = { id: "archive", state: "running", phase: "downloading", completedBytes: 40e6, totalBytes: 80e6, parent: "D:/data", path: "D:/data/archive", error: null, manifestSha256: "a".repeat(64) };

describe("current OTB activity", () => {
  it("does not say saved games are up to date during local preparation", () => {
    const result = otbActivity({ ...input, managing: true, operation: { kind: "prepare", startedAt: 123 } });
    expect(result).toMatchObject({ title: "Preparing local games…", busy: true });
    expect(result.detail).toContain("Nothing downloading");
    expect(result.progress).toBeUndefined();
  });
  it("distinguishes range/use/removal work from a network transfer", () => {
    for (const [kind, title] of [["range", "Applying local date range…"], ["use", "Updating local game use…"], ["remove", "Removing downloaded games…"]] as const) {
      expect(otbActivity({ ...input, managing: true, operation: { kind, startedAt: 123 } })).toMatchObject({ title, busy: true });
    }
  });
  it("scopes actual byte progress to the current archive and phase", () => {
    expect(otbActivity({ ...input, active: job })).toMatchObject({ title: "Downloading broadcast games…", progress: 50, progressLabel: "Current archive download" });
    const preparation = otbActivity({ ...input, active: { ...job, phase: "preparing", completedBytes: 10e6, totalBytes: 100e6 } });
    expect(preparation).toMatchObject({ title: "Preparing downloaded files…", progress: 10, progressLabel: "Current archive preparation" });
    expect(preparation.detail).toBe("10.0 MB of 100.0 MB prepared · this archive file");
  });
  it("does not fabricate percentages for unknown totals, verification, or cancellation", () => {
    for (const active of [{ ...job, totalBytes: 0 }, { ...job, totalBytes: NaN }, { ...job, phase: "checking" }, { ...job, state: "cancelling" as const }]) expect(otbActivity({ ...input, active }).progress).toBeUndefined();
  });
  it("does not confuse maintenance, read errors or future automatic work with completion", () => {
    expect(otbActivity({ ...input, library: { ...library, maintenanceNeeded: true } }).title).toBe("Setup needs finishing");
    expect(otbActivity({ ...input, statusError: "Drive unavailable" }).title).toBe("Could not check local games");
    expect(otbActivity({ ...input, missing: 1 }).detail).toContain("Nothing downloading yet");
    expect(otbActivity({ ...input, checking: true }).title).toBe("Checking for new games…");
  });
  it("preserves cancellation and failure instead of promising automatic retry", () => {
    expect(otbActivity({ ...input, missing: 1, interrupted: { ...job, state: "cancelled" } }).title).toBe("Download cancelled");
    expect(otbActivity({ ...input, missing: 1, issue: "Connection lost", interrupted: { ...job, state: "failed" } }).title).toBe("Download failed");
  });
  it("states explicitly when nothing is downloading, with automatic on and off", () => {
    expect(otbActivity(input)).toMatchObject({ title: "Up to date", tone: "good" });
    expect(otbActivity(input).detail).toContain("Nothing downloading");
    expect(otbActivity({ ...input, automatic: false }).detail).toContain("Automatic downloads are off");
  });
});
