import { create } from "zustand";
import { desktopApi, isDesktop, type DataPackEntry, type DataPackStatus, type OtbLibraryStatus } from "@/features/tournaments/platform";
import { otbCollectionDates, otbCutoff } from "./otbDownloadPresentation";
const AUTO = "otb.download.autoMonthly", CHECK = "otb.download.lastCheck", ATTEMPT = "otb.download.autoAttempt", AUTO_ERROR = "otb.download.autoError";
const QUEUE = "otb.download.pendingUpdates";
export interface OtbOperation { kind: "prepare" | "range" | "use" | "remove"; startedAt: number; keepYears?: number | null; dates?: ReturnType<typeof otbCollectionDates>; }
interface State { snapshot: DataPackStatus | null; library: OtbLibraryStatus | null; error: string; statusError: string; automatic: boolean; checking: boolean; managing: boolean; operation: OtbOperation | null; }
export const useOtbDownloads = create<State>(() => ({ snapshot: null, library: null, error: "", statusError: "", automatic: false, checking: false, managing: false, operation: null }));
let refreshing: Promise<void> | null = null;
let acting = false;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export const otbEntries = (snapshot: DataPackStatus | null) => (snapshot?.catalog ?? []).filter(e => e.kind === "otb").sort((a,b) => (a.periodStart ?? "").localeCompare(b.periodStart ?? ""));
export function otbMissingEntries(snapshot: DataPackStatus | null, library: OtbLibraryStatus | null, now = new Date()) {
  if (!library) return [];
  const cutoff = otbCutoff(library.keepYears, now);
  const stored = new Set(library.months);
  return otbEntries(snapshot).filter(entry => {
    if (!entry.periodStart || !entry.periodEnd || entry.periodEnd < cutoff) return false;
    let [year, month] = (entry.periodStart > cutoff ? entry.periodStart : cutoff).split("-").map(Number);
    for (let i = 0; i < 1200; i++) {
      const current = `${year}-${String(month).padStart(2, "0")}`;
      if (current > entry.periodEnd) return false;
      if (!stored.has(current)) return true;
      if (++month > 12) { year++; month = 1; }
    }
    return false;
  });
}
export async function refreshOtbDownloads(fresh = false): Promise<void> {
  if (refreshing) { await refreshing; if (fresh) return refreshOtbDownloads(); return; }
  refreshing = (async () => {
    try {
      const [snapshot, library] = await Promise.all([desktopApi.dataPackStatus(), desktopApi.otbLibraryStatus()]);
      useOtbDownloads.setState({ snapshot, library, statusError: "" });
    }
    catch (error) { useOtbDownloads.setState({ statusError: message(error) }); }
    finally { refreshing = null; }
  })();
  return refreshing;
}
export async function checkOtbUpdates() {
  if (useOtbDownloads.getState().checking) return;
  useOtbDownloads.setState({ checking: true, error: "" });
  try { await desktopApi.checkOtbPackUpdates(); await desktopApi.settingsSet(CHECK, String(Date.now())); await refreshOtbDownloads(); }
  catch (error) { useOtbDownloads.setState({ error: message(error) }); }
  finally { useOtbDownloads.setState({ checking: false }); }
}
export async function setOtbAutomatic(automatic: boolean) {
  await desktopApi.settingsSet(AUTO, automatic ? "true" : "false");
  if (automatic) { await desktopApi.settingsSet(ATTEMPT, ""); await desktopApi.settingsSet(AUTO_ERROR, ""); }
  useOtbDownloads.setState({ automatic, error: "" });
}
export async function removeOtbDownloads(token: string) {
  if (acting || useOtbDownloads.getState().managing) throw new Error("Wait for the current download operation to finish, then try again.");
  acting = true;
  const { snapshot, library } = useOtbDownloads.getState();
  const dates = otbCollectionDates(otbEntries(snapshot), library?.months ?? [], library?.keepYears ?? null);
  useOtbDownloads.setState({ managing: true, error: "", operation: { kind: "remove", startedAt: Date.now(), dates: { ...dates, removing: [...dates.removing, ...dates.keeping].sort(), keeping: [] } } });
  try { await desktopApi.removeDownloadedData(token); }
  catch (error) { useOtbDownloads.setState({ error: message(error) }); throw error; }
  finally {
    // Read back even after an uncertain response or partial filesystem failure.
    try { useOtbDownloads.setState({ automatic: await desktopApi.settingsGet(AUTO) === "true" }); }
    finally { await finishOtbOperation(); acting = false; }
  }
}
export async function setOtbPreferences(keepYears: number | null, enabled: boolean, parent: string) {
  if (useOtbDownloads.getState().managing) throw new Error("Wait for the current local game setup to finish.");
  const { snapshot, library } = useOtbDownloads.getState();
  const dates = otbCollectionDates(otbEntries(snapshot), library?.months ?? [], keepYears);
  const kind = dates.removing.length || library?.keepYears !== keepYears ? "range" : !library?.managed ? "prepare" : "use";
  useOtbDownloads.setState({ managing: true, error: "", operation: { kind, startedAt: Date.now(), keepYears, dates } });
  try { await desktopApi.setOtbLibraryPreferences(keepYears, enabled, parent); await desktopApi.settingsSet(AUTO_ERROR, ""); }
  catch (error) { useOtbDownloads.setState({ error: message(error) }); throw error; }
  finally { await finishOtbOperation(); }
}
export async function prepareOtbLibrary() {
  if (useOtbDownloads.getState().managing) throw new Error("Wait for the current local game setup to finish.");
  const { snapshot, library } = useOtbDownloads.getState();
  const dates = otbCollectionDates(otbEntries(snapshot), library?.months ?? [], library?.keepYears ?? null);
  useOtbDownloads.setState({ managing: true, error: "", operation: { kind: "prepare", startedAt: Date.now(), dates } });
  try { await desktopApi.maintainOtbLibrary(); await desktopApi.settingsSet(AUTO_ERROR, ""); useOtbDownloads.setState({ error: "" }); }
  catch (error) { useOtbDownloads.setState({ error: message(error) }); if (!message(error).startsWith("Wait for the current OTB import")) await desktopApi.settingsSet(AUTO_ERROR, message(error)); throw error; }
  finally { await finishOtbOperation(); }
}
async function finishOtbOperation() {
  // Keep the operation visible until readback settles; old saved months are not completion proof.
  try { await refreshOtbDownloads(true); }
  finally { useOtbDownloads.setState({ managing: false, operation: null }); }
}
export async function addOtbUpdates(parent: string) {
  let state = useOtbDownloads.getState();
  if (state.statusError || !state.library) throw new Error("Check downloaded games before starting an update.");
  if (!state.library.managed || !state.library.downloaded) {
    await setOtbPreferences(state.library.keepYears, state.library.downloaded ? state.library.enabled : true, parent);
  } else if (state.library.maintenanceNeeded) await prepareOtbLibrary();
  state = useOtbDownloads.getState();
  const missing = otbMissingEntries(state.snapshot, state.library);
  await desktopApi.settingsSet(QUEUE, JSON.stringify(missing.map(e => e.id)));
  await desktopApi.settingsSet(AUTO_ERROR, "");
  if (missing[0]) {
    const job = state.snapshot?.jobs.find(j => j.id === missing[0].id);
    await startOtbDownload(missing[0], job?.parent ?? parent);
  }
}
export async function cancelOtbUpdate(id: string) {
  await desktopApi.settingsSet(QUEUE, "[]");
  await desktopApi.settingsSet(ATTEMPT, id);
  await desktopApi.cancelDataPack(id);
  await refreshOtbDownloads(true);
}
export async function startOtbDownload(entry: DataPackEntry, parent: string) {
  const review = await desktopApi.reviewDataPack(entry.id, parent);
  const required = review.requiredBytes + 2 * entry.installedBytes + (useOtbDownloads.getState().library?.bytes ?? 0);
  if (review.availableBytes < required) throw new Error(`Not enough space. Need ${(required / 1e9).toFixed(2)} GB free while preparing games; ${(review.availableBytes / 1e9).toFixed(2)} GB available. Choose another folder.`);
  await desktopApi.startDataPack(review.token);
  useOtbDownloads.setState({ error: "" });
  await desktopApi.settingsSet(AUTO_ERROR, "");
  await refreshOtbDownloads();
}
/** One app-level owner keeps transfers alive after a dialog closes.
 * No automatic initial download. A failed/cancelled automatic attempt requires an explicit retry.
 */
export function startOtbDownloadManager() {
  if (!isDesktop()) return () => {};
  let nextCheckAt = 0;
  let stopped = false, timer: ReturnType<typeof setTimeout>;
  async function tick() {
    try {
      await refreshOtbDownloads();
      let { snapshot, library } = useOtbDownloads.getState();
      if (!snapshot || !library || stopped || useOtbDownloads.getState().statusError || useOtbDownloads.getState().managing) return;
      const entries = otbEntries(snapshot), jobs = snapshot.jobs.filter(j => entries.some(e => e.id === j.id));
      if ((library.downloaded || jobs.some(j => j.state === "ready")) && Date.now() >= nextCheckAt) {
        nextCheckAt = Date.now() + 86400000;
        await checkOtbUpdates();
        if (stopped) return;
      }
      if (!acting && !snapshot.jobs.some(j => j.state === "running" || j.state === "cancelling")) {
        acting = true;
        try {
          if (library.managed && library.maintenanceNeeded) {
            if (await desktopApi.settingsGet(AUTO_ERROR)) return;
            await prepareOtbLibrary();
            snapshot = useOtbDownloads.getState().snapshot!; library = useOtbDownloads.getState().library!;
          }
          const missing = otbMissingEntries(snapshot, library);
          let queue: string[] = []; try { queue = JSON.parse(await desktopApi.settingsGet(QUEUE) || "[]"); } catch { /* A damaged queue never authorizes a download. */ }
          if (!Array.isArray(queue)) queue = [];
          const next = missing.find(e => queue.includes(e.id)) ?? (useOtbDownloads.getState().automatic && library.downloaded ? missing[0] : undefined);
          if (next) {
            const previous = snapshot.jobs.find(job => job.id === next.id);
            if (!previous || previous.state === "ready") {
              if (await desktopApi.settingsGet(ATTEMPT) === next.id) return;
              await desktopApi.settingsSet(ATTEMPT, next.id);
              const parent = previous?.parent ?? library.parent;
              try { await startOtbDownload(next, parent); }
              catch (error) { await desktopApi.settingsSet(AUTO_ERROR, message(error)); throw error; }
            }
          }
        } finally { acting = false; }
      }
    } catch (error) { useOtbDownloads.setState({ error: message(error) }); }
    finally { if (!stopped) timer = setTimeout(tick, useOtbDownloads.getState().snapshot?.jobs.some(j => ["running","cancelling"].includes(j.state) && !useOtbDownloads.getState().snapshot!.selectedIds.includes(j.id)) ? 1500 : 15000); }
  }
  void (async () => {
    try {
      const [auto, checked, previousError] = await Promise.all([desktopApi.settingsGet(AUTO), desktopApi.settingsGet(CHECK), desktopApi.settingsGet(AUTO_ERROR)]);
      if (stopped) return;
      useOtbDownloads.setState({ automatic: auto === "true", error: previousError || "" });
      nextCheckAt = Number(checked || 0) + 86400000;
      await refreshOtbDownloads();
      if (!stopped) await tick();
    } catch (error) { useOtbDownloads.setState({ error: message(error) }); if (!stopped) timer = setTimeout(tick,15000); }
  })();
  return () => { stopped = true; clearTimeout(timer); };
}
