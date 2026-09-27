import type { DataPackJob, OtbLibraryStatus } from "@/features/tournaments/platform";
import type { OtbOperation } from "./otbDownloads";
import { otbSize } from "./otbDownloadPresentation";

export interface OtbActivity {
  title: string;
  detail: string;
  busy?: boolean;
  tone?: "good" | "warning";
  progress?: number;
  progressLabel?: string;
}

/** Current work wins over archive coverage. A downloaded archive is not a ready collection. */
export function otbActivity({ active, operation, managing, pending, checking, statusError, issue, library, missing, automatic, interrupted, removed }: {
  active?: DataPackJob; operation: OtbOperation | null; managing: boolean; pending: string;
  checking: boolean; statusError: string; issue: string; library: OtbLibraryStatus | null;
  missing: number; automatic: boolean; interrupted?: DataPackJob; removed: boolean;
}): OtbActivity {
  if (active) {
    if (active.state === "cancelling") return { title: "Cancelling download…", detail: "Saved games will be kept.", busy: true };
    const downloading = active.phase === "downloading";
    const preparing = active.phase === "preparing";
    const measurable = (downloading || preparing) && Number.isFinite(active.totalBytes) && active.totalBytes > 0 && Number.isFinite(active.completedBytes) && active.completedBytes >= 0;
    return {
      title: downloading ? "Downloading broadcast games…" : preparing ? "Preparing downloaded files…" : "Checking download files…",
      detail: measurable ? `${otbSize(active.completedBytes)} of ${otbSize(active.totalBytes)} ${downloading ? "downloaded" : "prepared"} · this archive file` : preparing ? "Unpacking files already downloaded." : "Checking the archive before continuing.",
      busy: true,
      progress: measurable ? Math.min(100, active.completedBytes / active.totalBytes * 100) : undefined,
      progressLabel: downloading ? "Current archive download" : "Current archive preparation",
    };
  }
  if (managing) return {
    title: operation?.kind === "remove" ? "Removing downloaded games…" : operation?.kind === "range" ? "Applying local date range…" : operation?.kind === "use" ? "Updating local game use…" : "Preparing local games…",
    detail: operation?.kind === "remove" ? "Removing downloaded copies. Imported Library games stay." : "Working with files already on this computer. Nothing downloading.",
    busy: true,
  };
  if (pending) return { title: pending, detail: "Waiting for confirmation from this computer…", busy: true };
  if (statusError) return { title: "Could not check local games", detail: "Retry the check to see the current download status.", tone: "warning" };
  if (!library) return { title: "Checking local games…", detail: "Reading saved files and download status.", busy: true };
  if (checking) return { title: "Checking for new games…", detail: "Checking which broadcast archives are available.", busy: true };
  if (issue) return { title: interrupted?.state === "failed" ? "Download failed" : "Action needs attention", detail: "", tone: "warning" };
  if (interrupted) return { title: interrupted.state === "cancelled" ? "Download cancelled" : "Download interrupted", detail: "Downloaded parts are kept. Resume when you’re ready.", tone: "warning" };
  if (library.maintenanceNeeded) return { title: "Setup needs finishing", detail: "Saved files still need preparation before this collection is ready.", tone: "warning" };
  if (removed && !library.downloaded) return { title: "Downloaded games removed", detail: "Automatic downloads are off. Imported Library games stay." };
  if (missing) return {
    title: library.downloaded ? "Update available" : "Not downloaded",
    detail: library.downloaded && automatic ? "Nothing downloading yet. Automatic updates will start while En Croissant is open, or you can download now." : "Nothing downloading. Use the download button to get the selected dates.",
  };
  if (library.downloaded) return { title: "Up to date", detail: automatic ? "Nothing downloading. New months download automatically while En Croissant is open." : "Nothing downloading. Automatic downloads are off.", tone: "good" };
  return { title: "No downloads available", detail: "No available archives match the selected dates." };
}
