import { useEffect, useId, useRef, useState } from "react";
import { HelpTip } from "@/features/tournaments/ui";
import { desktopApi, isDesktop, isNativeDesktop, type DownloadRemovalReview } from "@/features/tournaments/platform";
import { DownloadRemovalDialog } from "./DownloadRemovalDialog";
import { addOtbUpdates, cancelOtbUpdate, checkOtbUpdates, otbEntries, otbMissingEntries, refreshOtbDownloads, removeOtbDownloads, setOtbAutomatic, setOtbPreferences, useOtbDownloads } from "./otbDownloads";
import { otbArchiveDates, otbAvailableMonths, otbCollectionDates, otbCoverage, otbCutoff, otbMonthCount, otbSize as size } from "./otbDownloadPresentation";
import { otbActivity } from "./otbActivity";
import css from "./OtbDownloadControl.module.css";

function ActivityElapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return <span>Elapsed {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>;
}

export function OtbDownloadControl({ settings = false, sourceEnabled = true, fromYear, onEnableSource }: { settings?: boolean; sourceEnabled?: boolean; fromYear?: number; onEnableSource?: () => void }) {
  const { snapshot, library, error, statusError, automatic, checking, managing, operation } = useOtbDownloads();
  const [folder, setFolder] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState("");
  const pending = useRef(false);
  const retry = useRef<(() => Promise<unknown>) | null>(null);
  const [failure, setFailure] = useState("");
  const [removal, setRemoval] = useState<DownloadRemovalReview | null>(null);
  const [removed, setRemoved] = useState(false);
  const [range, setRange] = useState<number | null | undefined>(undefined);
  const confirmation = useRef<HTMLDialogElement>(null);
  const historyId = useId();
  useEffect(() => {
    if (!isDesktop()) return;
    void refreshOtbDownloads();
    const timer = setInterval(() => { if (!pending.current && !useOtbDownloads.getState().managing) void refreshOtbDownloads(); }, 1500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (range !== undefined) confirmation.current?.showModal(); else if (confirmation.current?.open) confirmation.current.close(); }, [range]);
  if (!isDesktop()) return null;

  const busy = !!pendingLabel;
  const entries = otbEntries(snapshot);
  const missing = otbMissingEntries(snapshot, library);
  const active = snapshot?.jobs.find(job => entries.some(e => e.id === job.id) && ["running", "cancelling"].includes(job.state));
  const interrupted = snapshot?.jobs.find(job => missing.some(e => e.id === job.id) && ["failed", "cancelled", "interrupted"].includes(job.state));
  const parent = folder ?? library?.parent ?? snapshot?.defaultParent ?? "";
  const unknown = !library || !!statusError;
  const downloaded = !unknown && library.downloaded;
  const localMonths = library?.months ?? [];
  const matched = localMonths.filter(m => !fromYear || Number(m.slice(0, 4)) >= fromYear);
  const locked = busy || managing || !!active || unknown || !!removal;
  const selectedYears = operation && "keepYears" in operation ? operation.keepYears ?? null : library?.keepYears ?? null;
  const dates = otbCollectionDates(entries, localMonths, selectedYears);
  const retained = dates.selected;
  const activeEntry = entries.find(entry => entry.id === active?.id);
  const archiveDates = activeEntry ? otbArchiveDates(activeEntry, dates.missing) : null;
  const operationDates = operation?.dates;
  const rangeDates = range !== undefined ? otbCollectionDates(entries, localMonths, range) : null;
  const downloadBytes = missing.reduce((sum, entry) => sum + entry.downloadBytes, 0);
  const setupBytes = missing.reduce((max, entry) => Math.max(max, entry.downloadBytes + 3 * entry.installedBytes), 0) + (library?.bytes ?? 0) + 256 * 1024 * 1024;
  const fullArchive = missing.some(e => e.periodStart && e.periodStart < otbCutoff(selectedYears));
  const issue = statusError || (active || managing || busy ? "" : failure || error || interrupted?.error || "");
  const activity = otbActivity({ active, operation, managing, pending: pendingLabel, checking, statusError, issue, library, missing: missing.length, automatic, interrupted, removed });
  const canDownload = !unknown && !active && !managing && !busy && (missing.length > 0 || library.maintenanceNeeded);
  const downloadAction = library?.maintenanceNeeded ? "Finish setup" : interrupted ? "Resume download" : downloaded ? "Download update" : "Download & enable";
  const useWarning = !library?.enabled ? "Off · local copies stay saved but are not used for imports." : !sourceEnabled ? "Lichess archives are off for this import." : !matched.length ? "No saved local games match this import’s dates." : library.partiallyEnabled ? "On for some saved archives." : "";

  async function act(action: () => Promise<unknown>, label = "Saving preferences…", retryAction = action) {
    if (pending.current) return;
    pending.current = true; setPendingLabel(label); setFailure(""); retry.current = retryAction;
    useOtbDownloads.setState({ error: "" });
    try { await action(); }
    catch (e) { setFailure(e instanceof Error ? e.message : String(e)); }
    finally { await refreshOtbDownloads(true); pending.current = false; setPendingLabel(""); }
  }
  function changeRange(years: number | null) {
    if (years === library?.keepYears && library.managed && !library.maintenanceNeeded) return;
    if (localMonths.some(m => m < otbCutoff(years))) setRange(years);
    else void act(() => setOtbPreferences(years, library?.enabled ?? false, parent), "Applying local date range…");
  }

  return <section className={css.root} aria-label="OTB importer downloads" data-settings={settings || undefined}>
    <header className={css.header}>
      <div className={css.heading}><h3>Local games for OTB imports</h3><HelpTip label="Faster player imports">Local games speed up the Lichess archive search. Other enabled sources still use the internet.</HelpTip></div>
      <span className={css.muted}>Lichess broadcasts · shared collection for all players</span>
    </header>

    <div className={css.activity} data-tone={activity.tone} data-active={activity.busy || undefined}>
      <div className={css.activityMain}>
        <div className={css.activityCopy} role="status" aria-live="polite" aria-atomic="true">
          <strong className={css.activityTitle}>{activity.busy && <span className={css.spinner} aria-hidden="true" />}{activity.tone === "good" && <span aria-hidden="true">✓ </span>}{activity.title}</strong>
          {!unknown && active && archiveDates && <>
            {archiveDates.adding.length > 0 && <span className={css.dateEmphasis}>Missing dates in this download: {otbCoverage(archiveDates.adding)} · {otbMonthCount(archiveDates.adding)}</span>}
            <span className={css.muted}>Archive file: {archiveDates.archive.length ? otbCoverage(archiveDates.archive) : "Dates unavailable"}{archiveDates.includesExtraMonths && archiveDates.adding.length > 0 ? ". The archive is downloaded as one file to fill these gaps." : ""}</span>
            {archiveDates.otherMissing.length > 0 && <span className={css.muted}>Other missing dates: {otbCoverage(archiveDates.otherMissing)}</span>}
          </>}
          {managing && operationDates && operation?.kind !== "use" && <>
            {operationDates.removing.length > 0 && <span className={css.dateEmphasis}>Removing saved months: {otbCoverage(operationDates.removing)} · {otbMonthCount(operationDates.removing)}</span>}
            {operation.kind !== "remove" && (operationDates.removing.length > 0
              ? <span>Keeping saved months: {otbCoverage(operationDates.keeping)}</span>
              : <span>Selected collection dates: {otbCoverage(operationDates.selected)}</span>)}
          </>}
          {!unknown && !active && !managing && dates.missing.length > 0 && <span className={css.dateEmphasis}>Missing dates to download: {otbCoverage(dates.missing)} · {otbMonthCount(dates.missing)}</span>}
          {activity.detail && <span>{activity.detail}</span>}
        </div>
        <div className={css.actions}>
          {active && <button type="button" disabled={busy || active.state === "cancelling"} onClick={() => void act(() => cancelOtbUpdate(active.id), "Cancelling download…")}>{active.state === "cancelling" ? "Cancelling…" : "Cancel download"}</button>}
          {canDownload && <button type="button" className={css.primary} disabled={locked} onClick={() => void act(() => addOtbUpdates(parent), "Starting download…")}>{downloadAction}</button>}
          {statusError && <button type="button" disabled={busy || managing} onClick={() => void act(() => refreshOtbDownloads(), "Checking local games…")}>Retry check</button>}
          {issue && !statusError && !active && !managing && !canDownload && <button type="button" disabled={busy} onClick={() => void act(retry.current ?? checkOtbUpdates, "Retrying…")}>Retry action</button>}
        </div>
      </div>
      {activity.busy && <progress className={css.progress} aria-label={activity.progressLabel ?? activity.title} value={activity.progress} max={100} />}
      {operation && <div className={css.muted}><ActivityElapsed startedAt={operation.startedAt} />{operation.kind !== "remove" && " · You can close this panel; setup continues."}</div>}
      {active && active.state !== "cancelling" && <span className={css.muted}>You can close this panel; the download and setup continue.</span>}
      {issue && <div role="alert" className={css.error}>{issue}</div>}
      {canDownload && missing.length > 0 && <div className={css.downloadCost}>
        <span>{size(downloadBytes)} download{fullArchive ? " · full archive, then keep the selected dates" : " · missing archive files"}</span>
        <span className={css.muted}>About {size(setupBytes)} free space needed during setup.<HelpTip label="Download size">Archive files have fixed sizes. Choosing fewer years changes what is kept after setup, not the size of an archive containing those years.</HelpTip></span>
      </div>}
    </div>

    {downloaded && <div className={css.coverage}><span className={css.muted}>Full saved collection</span><span>{otbCoverage(localMonths)} <span className={css.muted}>· {otbMonthCount(localMonths)} · {size(library.bytes)}</span></span></div>}
    <div className={css.preferences}>
      <div className={css.range}>
        <div className={css.inline}><label htmlFor={historyId}>Keep locally</label><HelpTip label="Local date range">Keeps the selected months on this computer. It does not limit the dates you can request in a player import.</HelpTip></div>
        <select id={historyId} aria-label="Downloaded game history" value={selectedYears ?? "all"} disabled={locked} onChange={event => changeRange(event.target.value === "all" ? null : Number(event.target.value))}>
          <option value="1">Last year</option><option value="3">Last 3 years</option><option value="5">Last 5 years</option><option value="10">Last 10 years</option><option value="all">All available games</option>
        </select>
        {!downloaded && snapshot && <span className={css.muted}>{otbCoverage(retained)}</span>}
      </div>
      <span className={css.muted}>Shorter ranges remove older local copies. Imported Library games stay.</span>
      {downloaded && <div className={css.preference}>
        <div className={css.optionRow}><label className={css.option}><input type="checkbox" aria-label="Use local games for player imports" ref={element => { if (element) element.indeterminate = !!library.partiallyEnabled; }} checked={library.enabled && !library.partiallyEnabled} disabled={locked} onChange={event => { const enabled = event.target.checked; void act(() => setOtbPreferences(library.keepYears, enabled, parent), "Updating local game use…"); }} />Use local games for player imports</label><HelpTip label="Local games and online sources">When checked, player imports search these saved Lichess games. Other enabled sources and dates outside local coverage can still be searched online.</HelpTip></div>
        {useWarning && <div className={css.inline}><span className={css.muted}>{useWarning}</span>{!sourceEnabled && onEnableSource && <button type="button" onClick={onEnableSource}>Enable Lichess archives</button>}</div>}
      </div>}
      <div className={css.optionRow}><label className={css.option}><input type="checkbox" checked={automatic} disabled={locked} onChange={event => {
        const on = event.target.checked;
        void act(async () => { if (downloaded && !library.managed) await setOtbPreferences(library.keepYears, library.enabled, parent); await setOtbAutomatic(on); }, "Saving automatic downloads…");
      }} />Download new months automatically</label><HelpTip label="Automatic updates">Downloads new months while En Croissant is open, keeping your selected date range. The first download and any failed or cancelled download need the download button.</HelpTip></div>
    </div>

    {!settings && fromYear !== undefined && <div className={css.importCoverage}>
      <div><span>This player search</span><span>January {fromYear}–today</span></div>
      <div><span>Saved part of this search</span><span>{unknown ? "Not yet checked" : otbCoverage(matched)}</span></div>
      {localMonths.some(month => Number(month.slice(0, 4)) < fromYear) && <span>Earlier saved games are outside this player search.</span>}
    </div>}
    <details className={css.details}><summary>Storage &amp; source details</summary><div className={css.detailContent}>
      <span>Available archive: {snapshot ? otbCoverage(otbAvailableMonths(entries)) : "Not yet checked"}</span>
      <span>Selected local dates: {snapshot ? otbCoverage(retained) : "Not yet checked"}</span>
      <span>Saved locally: {unknown ? "Not yet checked" : size(library?.bytes ?? 0)}</span>
      <span className={css.path}>Folder: {parent}</span>
      <div className={css.actions}>
        {isNativeDesktop() && !library?.managed && <button type="button" disabled={locked} onClick={() => void act(async () => { const { open } = await import("@tauri-apps/plugin-dialog"); const picked = await open({ directory: true, multiple: false }); if (typeof picked === "string") setFolder(picked); }, "Choosing download folder…")}>Choose download folder</button>}
        <button type="button" disabled={checking || busy || managing || !!active} onClick={() => void checkOtbUpdates()}>{checking ? "Checking…" : "Check for new games"}</button>
        {(downloaded || interrupted || library?.managed || library?.maintenanceNeeded) && <button type="button" disabled={busy || managing || !!active || !!removal || !snapshot} onClick={() => void act(async () => { setRemoved(false); setRemoval(await desktopApi.reviewDownloadRemoval("otb-library")); }, "Checking downloaded files…")}>Remove downloaded games…</button>}
      </div>
      <span>Lichess broadcast contributors · CC BY-SA 4.0 · <a href="https://database.lichess.org/#broadcasts" target="_blank" rel="noreferrer">Lichess broadcast exports</a></span>
    </div></details>

    <DownloadRemovalDialog review={removal} name="downloaded Lichess broadcasts" busy={busy || managing} onCancel={() => setRemoval(null)} onConfirm={() => void act(async () => { try { await removeOtbDownloads(removal!.token); setRemoved(true); } finally { setRemoval(null); } }, "Removing downloaded games…", async () => { setRemoval(await desktopApi.reviewDownloadRemoval("otb-library")); })} />
    <dialog ref={confirmation} className={css.dialog} aria-label="Change local date range" onCancel={() => setRange(undefined)}>
      <h3>Change the local date range?</h3><p>Remove saved months: <strong>{otbCoverage(rangeDates?.removing ?? [])}</strong> · {otbMonthCount(rangeDates?.removing ?? [])}.</p><p>Keep saved months: <strong>{otbCoverage(rangeDates?.keeping ?? [])}</strong>.</p><p>Your imported Library games stay.</p>
      <div className={css.actions}><button type="button" className={css.primary} disabled={locked} onClick={() => { const years = range ?? null; setRange(undefined); void act(() => setOtbPreferences(years, library?.enabled ?? false, parent), "Applying local date range…"); }}>Apply date range</button><button type="button" autoFocus onClick={() => setRange(undefined)}>Cancel</button></div>
    </dialog>
  </section>;
}
